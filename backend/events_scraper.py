"""
events_scraper.py — Stock Events Calendar Data Pipeline

Fetches upcoming corporate events (quarterly results, dividends, bonuses, splits,
board meetings) from NSE India APIs and Yahoo Finance.

Designed for Oracle Cloud VM deployment with:
- Cache-first architecture (never real-time on user request)
- 3-5s pacing between NSE requests
- Rotating User-Agent strings
- Exponential backoff on 403/429 errors
- Graceful degradation (yfinance fallback if NSE blocks)
"""

import requests
import json
import time
import random
import traceback
from datetime import datetime, date, timedelta
from contextlib import contextmanager
import sqlite3
import os

# ─── Constants ────────────────────────────────────────────────────────────────

DATABASE_DIR = os.environ.get(
    "DATABASE_DIR",
    os.path.join(os.path.dirname(__file__), "data")
)
os.makedirs(DATABASE_DIR, exist_ok=True)
DATABASE_PATH = os.path.join(DATABASE_DIR, "watchlist_database.db")

# Rotating User-Agent pool to avoid fingerprinting
_USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:128.0) Gecko/20100101 Firefox/128.0",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0",
]

# NSE API endpoints
NSE_BASE = "https://www.nseindia.com"
NSE_BOARD_MEETINGS_URL = f"{NSE_BASE}/api/corporate-board-meetings?index=equities"
NSE_CORP_ACTIONS_URL = f"{NSE_BASE}/api/corporates-corporateActions?index=equities"

# Backoff state (module-level, persists across calls)
_nse_backoff_until = 0  # epoch timestamp; skip NSE calls until this time
_nse_backoff_level = 0  # 0=normal, 1=15min, 2=1hr, 3=6hr, 4=24hr

# ─── DB Helpers ───────────────────────────────────────────────────────────────

@contextmanager
def _get_db():
    """Local context manager for safe SQLite connections."""
    conn = sqlite3.connect(DATABASE_PATH, timeout=30.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL")
    try:
        yield conn
    finally:
        conn.close()


def init_events_table():
    """Create the stock_events table if it doesn't exist."""
    with _get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS stock_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            company_name TEXT,
            event_type TEXT NOT NULL,
            event_date TEXT NOT NULL,
            description TEXT,
            details_json TEXT,
            source TEXT DEFAULT 'nse',
            fetched_at TEXT NOT NULL,
            UNIQUE(symbol, event_type, event_date)
        )
        """)
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_events_date ON stock_events(event_date)")
        cursor.execute("CREATE INDEX IF NOT EXISTS idx_events_symbol ON stock_events(symbol)")
        conn.commit()
        print("[Events] stock_events table initialized.")


def _upsert_event(conn, symbol, company_name, event_type, event_date, description, details, source):
    """Insert or replace a single event record."""
    now = datetime.utcnow().isoformat() + "Z"
    details_str = json.dumps(details) if details else "{}"
    try:
        conn.execute(
            """INSERT OR REPLACE INTO stock_events
               (symbol, company_name, event_type, event_date, description, details_json, source, fetched_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (symbol, company_name, event_type, event_date, description, details_str, source, now)
        )
    except Exception as e:
        print(f"[Events] Failed to upsert event {symbol}/{event_type}/{event_date}: {e}")


# ─── NSE Session Management ──────────────────────────────────────────────────

def _create_nse_session():
    """Create a requests.Session with cookies from NSE homepage."""
    session = requests.Session()
    ua = random.choice(_USER_AGENTS)
    session.headers.update({
        "User-Agent": ua,
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Accept-Encoding": "gzip, deflate, br",
        "Referer": f"{NSE_BASE}/",
    })
    try:
        # Visit homepage to establish session cookies
        r = session.get(NSE_BASE, timeout=10)
        if r.status_code == 200:
            print(f"[Events] NSE session established (UA: ...{ua[-30:]})")
        else:
            print(f"[Events] NSE homepage returned {r.status_code}")
    except Exception as e:
        print(f"[Events] Failed to establish NSE session: {e}")
    return session


def _check_nse_backoff():
    """Return True if we should skip NSE calls due to backoff."""
    global _nse_backoff_until
    if _nse_backoff_until > 0 and time.time() < _nse_backoff_until:
        remaining = int(_nse_backoff_until - time.time())
        print(f"[Events] NSE backoff active — {remaining}s remaining. Skipping.")
        return True
    return False


def _apply_nse_backoff():
    """Escalate backoff level on failure."""
    global _nse_backoff_until, _nse_backoff_level
    delays = [900, 3600, 21600, 86400]  # 15min, 1hr, 6hr, 24hr
    _nse_backoff_level = min(_nse_backoff_level + 1, len(delays) - 1)
    delay = delays[_nse_backoff_level]
    _nse_backoff_until = time.time() + delay
    print(f"[Events] NSE backoff escalated to level {_nse_backoff_level} ({delay}s)")


def _reset_nse_backoff():
    """Reset backoff on successful NSE call."""
    global _nse_backoff_until, _nse_backoff_level
    if _nse_backoff_level > 0:
        print(f"[Events] NSE backoff reset (was level {_nse_backoff_level})")
    _nse_backoff_until = 0
    _nse_backoff_level = 0


# ─── NSE Fetchers ─────────────────────────────────────────────────────────────

def _parse_nse_date(date_str):
    """Parse NSE date formats like '13-Jul-2026' to ISO format YYYY-MM-DD."""
    if not date_str or date_str.strip() == "-":
        return None
    for fmt in ("%d-%b-%Y", "%d-%B-%Y", "%d/%m/%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(date_str.strip(), fmt).strftime("%Y-%m-%d")
        except ValueError:
            continue
    return None


def _classify_corp_action(subject):
    """Classify NSE corporate action subject text into event types."""
    subject_lower = (subject or "").lower()
    if "dividend" in subject_lower:
        return "dividend"
    elif "bonus" in subject_lower:
        return "bonus"
    elif "split" in subject_lower or "sub-division" in subject_lower or "subdivision" in subject_lower:
        return "split"
    elif "right" in subject_lower:
        return "rights"
    elif "buyback" in subject_lower:
        return "buyback"
    return "corporate_action"


def fetch_nse_board_meetings():
    """
    Fetch upcoming board meetings (quarterly results) from NSE API.
    Returns list of normalized event dicts.
    """
    if _check_nse_backoff():
        return []

    events = []
    try:
        session = _create_nse_session()
        time.sleep(random.uniform(2, 4))  # Pacing delay

        r = session.get(NSE_BOARD_MEETINGS_URL, timeout=15)
        if r.status_code == 403 or r.status_code == 429:
            print(f"[Events] NSE board meetings blocked ({r.status_code})")
            _apply_nse_backoff()
            return []

        if r.status_code != 200:
            print(f"[Events] NSE board meetings unexpected status: {r.status_code}")
            return []

        try:
            data = r.json()
        except Exception as e:
            print(f"[Events] NSE board meetings JSON decode failed (might be HTML blocked response): {e}")
            return []
        if not isinstance(data, list):
            print(f"[Events] NSE board meetings unexpected format: {type(data)}")
            return []

        _reset_nse_backoff()

        for item in data:
            event_date = _parse_nse_date(item.get("bm_date"))
            if not event_date:
                continue

            symbol = (item.get("bm_symbol") or "").strip()
            company_name = (item.get("sm_name") or "").strip()
            purpose = (item.get("bm_purpose") or "").strip()
            description = (item.get("bm_desc") or purpose).strip()

            # Determine event type from purpose
            purpose_lower = purpose.lower()
            if "financial result" in purpose_lower or "results" in purpose_lower:
                event_type = "quarterly_results"
            elif "dividend" in purpose_lower:
                event_type = "dividend"
            elif "bonus" in purpose_lower:
                event_type = "bonus"
            elif "split" in purpose_lower:
                event_type = "split"
            else:
                event_type = "board_meeting"

            details = {
                "purpose": purpose,
                "industry": item.get("sm_indusrty"),
                "isin": item.get("sm_isin"),
                "attachment": item.get("attachment"),
            }

            events.append({
                "symbol": symbol,
                "company_name": company_name,
                "event_type": event_type,
                "event_date": event_date,
                "description": description,
                "details": details,
                "source": "nse",
            })

        print(f"[Events] Fetched {len(events)} board meetings from NSE")

    except requests.exceptions.Timeout:
        print("[Events] NSE board meetings request timed out")
        _apply_nse_backoff()
    except Exception as e:
        print(f"[Events] NSE board meetings error: {e}")
        traceback.print_exc()

    return events


def fetch_nse_corporate_actions():
    """
    Fetch upcoming corporate actions (dividends, bonuses, splits) from NSE API.
    Returns list of normalized event dicts.
    """
    if _check_nse_backoff():
        return []

    events = []
    try:
        session = _create_nse_session()
        time.sleep(random.uniform(3, 5))  # Pacing delay

        r = session.get(NSE_CORP_ACTIONS_URL, timeout=15)
        if r.status_code == 403 or r.status_code == 429:
            print(f"[Events] NSE corporate actions blocked ({r.status_code})")
            _apply_nse_backoff()
            return []

        if r.status_code != 200:
            print(f"[Events] NSE corporate actions unexpected status: {r.status_code}")
            return []

        try:
            data = r.json()
        except Exception as e:
            print(f"[Events] NSE corporate actions JSON decode failed (might be HTML blocked response): {e}")
            return []
        if not isinstance(data, list):
            print(f"[Events] NSE corporate actions unexpected format: {type(data)}")
            return []

        _reset_nse_backoff()

        for item in data:
            ex_date = _parse_nse_date(item.get("exDate"))
            if not ex_date:
                continue

            symbol = (item.get("symbol") or "").strip()
            company_name = (item.get("comp") or "").strip()
            subject = (item.get("subject") or "").strip()
            event_type = _classify_corp_action(subject)

            details = {
                "subject": subject,
                "face_value": item.get("faceVal"),
                "record_date": _parse_nse_date(item.get("recDate")),
                "bc_start_date": _parse_nse_date(item.get("bcStartDate")),
                "bc_end_date": _parse_nse_date(item.get("bcEndDate")),
                "isin": item.get("isin"),
                "series": item.get("series"),
            }

            # Extract dividend amount from subject if possible
            if event_type == "dividend":
                import re
                match = re.search(r'Rs?\s*\.?\s*([\d.]+)', subject, re.IGNORECASE)
                if match:
                    try:
                        details["dividend_amount"] = float(match.group(1))
                    except ValueError:
                        pass

            # Extract split ratio from subject if possible
            if event_type == "split":
                import re
                match = re.search(r'(\d+)\s*/\s*-?\s*(\d+)', subject)
                if match:
                    details["split_from"] = int(match.group(1))
                    details["split_to"] = int(match.group(2))

            events.append({
                "symbol": symbol,
                "company_name": company_name,
                "event_type": event_type,
                "event_date": ex_date,
                "description": subject,
                "details": details,
                "source": "nse",
            })

        print(f"[Events] Fetched {len(events)} corporate actions from NSE")

    except requests.exceptions.Timeout:
        print("[Events] NSE corporate actions request timed out")
        _apply_nse_backoff()
    except Exception as e:
        print(f"[Events] NSE corporate actions error: {e}")
        traceback.print_exc()

    return events


# ─── yfinance Per-Stock Fetcher ───────────────────────────────────────────────

def fetch_stock_events(symbol):
    """
    Fetch upcoming events for a single stock using yfinance.
    Returns list of normalized event dicts.

    Args:
        symbol: Yahoo Finance symbol (e.g., 'RELIANCE.NS')
    """
    events = []
    base_symbol = symbol.replace(".NS", "").replace(".BO", "")

    try:
        import yfinance as yf
        ticker = yf.Ticker(symbol)

        # --- Calendar data (earnings date, ex-dividend) ---
        try:
            cal = ticker.calendar
            if isinstance(cal, dict):
                # Earnings date
                earnings_dates = cal.get("Earnings Date", [])
                if earnings_dates:
                    for ed in (earnings_dates if isinstance(earnings_dates, list) else [earnings_dates]):
                        try:
                            ed_str = ed.strftime("%Y-%m-%d") if hasattr(ed, 'strftime') else str(ed)
                            details = {
                                "earnings_estimate": cal.get("Earnings Average"),
                                "earnings_high": cal.get("Earnings High"),
                                "earnings_low": cal.get("Earnings Low"),
                                "revenue_average": cal.get("Revenue Average"),
                            }
                            events.append({
                                "symbol": base_symbol,
                                "company_name": None,  # Will be filled from info
                                "event_type": "quarterly_results",
                                "event_date": ed_str,
                                "description": "Quarterly Results (Earnings)",
                                "details": details,
                                "source": "yfinance",
                            })
                        except Exception:
                            pass

                # Ex-Dividend date from calendar
                ex_div = cal.get("Ex-Dividend Date")
                if ex_div:
                    try:
                        ex_div_str = ex_div.strftime("%Y-%m-%d") if hasattr(ex_div, 'strftime') else str(ex_div)
                        events.append({
                            "symbol": base_symbol,
                            "company_name": None,
                            "event_type": "dividend",
                            "event_date": ex_div_str,
                            "description": "Ex-Dividend Date",
                            "details": {"source_field": "calendar.ex_dividend_date"},
                            "source": "yfinance",
                        })
                    except Exception:
                        pass
        except Exception:
            pass

        # --- Info data (dividend rate, yield, last split) ---
        try:
            info = ticker.info or {}

            company_name = info.get("longName") or info.get("shortName") or base_symbol

            # Fill company name in all events
            for ev in events:
                if ev["company_name"] is None:
                    ev["company_name"] = company_name

            # Dividend rate + yield
            div_rate = info.get("dividendRate")
            div_yield = info.get("dividendYield")
            ex_div_epoch = info.get("exDividendDate")
            if ex_div_epoch and isinstance(ex_div_epoch, (int, float)) and ex_div_epoch > 0:
                ex_div_date = datetime.utcfromtimestamp(ex_div_epoch).strftime("%Y-%m-%d")
                # Check if we already have this from calendar
                existing = [e for e in events if e["event_type"] == "dividend" and e["event_date"] == ex_div_date]
                if not existing:
                    events.append({
                        "symbol": base_symbol,
                        "company_name": company_name,
                        "event_type": "dividend",
                        "event_date": ex_div_date,
                        "description": f"Dividend ₹{div_rate}" if div_rate else "Ex-Dividend Date",
                        "details": {
                            "dividend_rate": div_rate,
                            "dividend_yield": div_yield,
                            "trailing_annual_rate": info.get("trailingAnnualDividendRate"),
                            "five_year_avg_yield": info.get("fiveYearAvgDividendYield"),
                        },
                        "source": "yfinance",
                    })
                else:
                    # Enrich existing event
                    existing[0]["details"]["dividend_rate"] = div_rate
                    existing[0]["details"]["dividend_yield"] = div_yield
                    existing[0]["details"]["trailing_annual_rate"] = info.get("trailingAnnualDividendRate")
                    existing[0]["details"]["five_year_avg_yield"] = info.get("fiveYearAvgDividendYield")
                    if div_rate and "₹" not in (existing[0]["description"] or ""):
                        existing[0]["description"] = f"Dividend ₹{div_rate}"

            # Last split date
            last_split_epoch = info.get("lastSplitDate")
            last_split_factor = info.get("lastSplitFactor")
            if last_split_epoch and isinstance(last_split_epoch, (int, float)) and last_split_epoch > 0:
                split_date = datetime.utcfromtimestamp(last_split_epoch).strftime("%Y-%m-%d")
                events.append({
                    "symbol": base_symbol,
                    "company_name": company_name,
                    "event_type": "split",
                    "event_date": split_date,
                    "description": f"Stock Split {last_split_factor}" if last_split_factor else "Stock Split",
                    "details": {
                        "split_factor": last_split_factor,
                        "is_historical": True,
                    },
                    "source": "yfinance",
                })

            # Earnings timestamps
            earnings_ts_start = info.get("earningsTimestampStart")
            is_estimate = info.get("isEarningsDateEstimate", False)
            if earnings_ts_start and isinstance(earnings_ts_start, (int, float)) and earnings_ts_start > 0:
                earn_date = datetime.utcfromtimestamp(earnings_ts_start).strftime("%Y-%m-%d")
                existing = [e for e in events if e["event_type"] == "quarterly_results" and e["event_date"] == earn_date]
                if not existing:
                    events.append({
                        "symbol": base_symbol,
                        "company_name": company_name,
                        "event_type": "quarterly_results",
                        "event_date": earn_date,
                        "description": "Quarterly Results" + (" (Estimated)" if is_estimate else ""),
                        "details": {"is_estimate": is_estimate},
                        "source": "yfinance",
                    })

        except Exception:
            pass

        print(f"[Events] Fetched {len(events)} events for {symbol} from yfinance")

    except Exception as e:
        print(f"[Events] yfinance error for {symbol}: {e}")

    return events


# ─── Aggregation & Caching ────────────────────────────────────────────────────

def aggregate_and_cache_market_events():
    """
    Fetch from all NSE sources and store in SQLite.
    Called by background scheduler (2x/day).
    """
    print("[Events] Starting market events aggregation...")
    total = 0

    with _get_db() as conn:
        # 1. NSE Board Meetings
        board_events = fetch_nse_board_meetings()
        for ev in board_events:
            _upsert_event(conn, ev["symbol"], ev["company_name"], ev["event_type"],
                         ev["event_date"], ev["description"], ev["details"], ev["source"])
            total += 1

        # Pace between NSE calls
        if board_events:
            time.sleep(random.uniform(3, 5))

        # 2. NSE Corporate Actions
        corp_events = fetch_nse_corporate_actions()
        for ev in corp_events:
            _upsert_event(conn, ev["symbol"], ev["company_name"], ev["event_type"],
                         ev["event_date"], ev["description"], ev["details"], ev["source"])
            total += 1

        conn.commit()

    # 3. Clean up old events (more than 90 days in the past)
    _cleanup_old_events()

    print(f"[Events] Aggregation complete. {total} events cached.")
    return total


def cache_stock_events(symbol):
    """
    Fetch and cache events for a single stock via yfinance.
    Called on-demand when a user views a stock profile.
    """
    events = fetch_stock_events(symbol)
    if not events:
        return events

    with _get_db() as conn:
        for ev in events:
            _upsert_event(conn, ev["symbol"], ev["company_name"], ev["event_type"],
                         ev["event_date"], ev["description"], ev["details"], ev["source"])
        conn.commit()

    return events


def _cleanup_old_events():
    """Remove events older than 90 days."""
    cutoff = (date.today() - timedelta(days=90)).isoformat()
    try:
        with _get_db() as conn:
            result = conn.execute("DELETE FROM stock_events WHERE event_date < ?", (cutoff,))
            deleted = result.rowcount
            conn.commit()
            if deleted > 0:
                print(f"[Events] Cleaned up {deleted} old events (before {cutoff})")
    except Exception as e:
        print(f"[Events] Cleanup error: {e}")


# ─── Query Functions ──────────────────────────────────────────────────────────

def get_market_events(days=30, event_type=None):
    """
    Get upcoming market-wide events from cache.

    Args:
        days: Number of days ahead to look (default 30)
        event_type: Filter by type ('quarterly_results', 'dividend', 'bonus', 'split', 'board_meeting')
                    or None for all types
    Returns:
        List of event dicts sorted by date
    """
    start_date = (date.today() - timedelta(days=7)).isoformat()
    end_date = (date.today() + timedelta(days=days)).isoformat()

    with _get_db() as conn:
        if event_type:
            rows = conn.execute(
                """SELECT * FROM stock_events
                   WHERE event_date >= ? AND event_date <= ? AND event_type = ?
                   ORDER BY event_date ASC, symbol ASC""",
                (start_date, end_date, event_type)
            ).fetchall()
        else:
            rows = conn.execute(
                """SELECT * FROM stock_events
                   WHERE event_date >= ? AND event_date <= ?
                   ORDER BY event_date ASC, symbol ASC""",
                (start_date, end_date)
            ).fetchall()

    events = []
    for row in rows:
        ev = dict(row)
        # Parse details_json back to dict
        try:
            ev["details"] = json.loads(ev.get("details_json") or "{}")
        except Exception:
            ev["details"] = {}
        del ev["details_json"]

        # Add countdown_days
        try:
            event_d = datetime.strptime(ev["event_date"], "%Y-%m-%d").date()
            ev["countdown_days"] = (event_d - date.today()).days
        except Exception:
            ev["countdown_days"] = None

        events.append(ev)

    return events


def get_stock_events_cached(symbol):
    """
    Get cached events for a specific stock symbol.
    Returns events from cache; caller should trigger cache_stock_events() if stale.

    Args:
        symbol: Base symbol (e.g., 'RELIANCE') or full symbol ('RELIANCE.NS')
    """
    base_symbol = symbol.replace(".NS", "").replace(".BO", "")
    start_date = (date.today() - timedelta(days=7)).isoformat()

    with _get_db() as conn:
        rows = conn.execute(
            """SELECT * FROM stock_events
               WHERE symbol = ? AND event_date >= ?
               ORDER BY event_date ASC""",
            (base_symbol, start_date)
        ).fetchall()

    events = []
    for row in rows:
        ev = dict(row)
        try:
            ev["details"] = json.loads(ev.get("details_json") or "{}")
        except Exception:
            ev["details"] = {}
        del ev["details_json"]

        try:
            event_d = datetime.strptime(ev["event_date"], "%Y-%m-%d").date()
            ev["countdown_days"] = (event_d - date.today()).days
        except Exception:
            ev["countdown_days"] = None

        events.append(ev)

    return events


def is_stock_events_stale(symbol, max_age_hours=12):
    """Check if cached events for a stock are older than max_age_hours."""
    base_symbol = symbol.replace(".NS", "").replace(".BO", "")
    with _get_db() as conn:
        row = conn.execute(
            "SELECT fetched_at FROM stock_events WHERE symbol = ? ORDER BY fetched_at DESC LIMIT 1",
            (base_symbol,)
        ).fetchone()

    if not row:
        return True

    try:
        fetched = datetime.fromisoformat(row["fetched_at"].replace("Z", "+00:00"))
        age = datetime.now(fetched.tzinfo) - fetched if fetched.tzinfo else datetime.utcnow() - fetched
        return age.total_seconds() > (max_age_hours * 3600)
    except Exception:
        return True


def seed_events_if_empty():
    """Seed stock events cache with a set of default top stocks from the universe if empty."""
    try:
        with _get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(DISTINCT symbol) as cnt FROM stock_events")
            count = cursor.fetchone()["cnt"]
    except Exception as e:
        print(f"[Events] Failed to check database events count: {e}")
        return

    # If we have less than 10 stocks, fetch the first 25 symbols from the screener universe
    if count < 10:
        print(f"[Events] Event cache is sparse ({count} stocks). Seeding from Nifty universe...")
        try:
            # Query top 25 symbols from universe
            with _get_db() as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT symbol FROM screener_universe WHERE symbol NOT LIKE '%DUMMY%' LIMIT 25")
                symbols = [row["symbol"] for row in cursor.fetchall()]

            if not symbols:
                # Fallback list of top Indian stocks if screener_universe is not populated yet
                symbols = ["RELIANCE", "TCS", "INFY", "HDFCBANK", "ICICIBANK", "SBIN", "BHARTIARTL", 
                           "ITC", "LT", "HINDUNILVR", "BAJFINANCE", "ASIANPAINT", "HCLTECH", 
                           "MARUTI", "SUNPHARMA", "TATASTEEL", "NTPC", "POWERGRID", "TITAN", "AXISBANK"]

            # Crawl yfinance for these symbols in a paced loop
            for sym in symbols:
                full_sym = f"{sym.replace('.NS', '').replace('.BO', '')}.NS"
                try:
                    print(f"[Events] Seeding events for {full_sym}...")
                    cache_stock_events(full_sym)
                    time.sleep(random.uniform(1.0, 2.0))  # Paced fetch to avoid rate limits
                except Exception as ex:
                    print(f"[Events] Seeding failed for {full_sym}: {ex}")
            print("[Events] Seeding process complete.")
        except Exception as e:
            print(f"[Events] Failed to seed events: {e}")


# ─── Background Scheduler ────────────────────────────────────────────────────

async def run_background_events_scheduler():
    """
    Background async task that refreshes market events 2x/day.
    Runs on startup, then every 12 hours.
    """
    import asyncio

    # Initial short delay, then run database seeding if empty in a background thread
    await asyncio.sleep(5)
    try:
        await asyncio.to_thread(seed_events_if_empty)
    except Exception as e:
        print(f"[Events] Seeding error: {e}")

    # Wait for the remaining initial delay before standard scheduler starts
    await asyncio.sleep(25)

    while True:
        try:
            print("[Events] Background events refresh starting...")
            count = await asyncio.to_thread(aggregate_and_cache_market_events)
            print(f"[Events] Background refresh complete. {count} events updated.")
        except Exception as e:
            print(f"[Events] Background refresh error: {e}")
            traceback.print_exc()

        # Sleep for 12 hours
        await asyncio.sleep(12 * 3600)
