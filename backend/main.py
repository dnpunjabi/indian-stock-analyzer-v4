import os
import json
import sqlite3
import asyncio
import uuid
import requests
import yfinance as yf
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from contextlib import contextmanager
import math
from fastapi import FastAPI, HTTPException, Query, UploadFile, File
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from dotenv import load_dotenv
from typing import List, Optional

# Database path: relative to project with env override
DATABASE_DIR = os.environ.get(
    "DATABASE_DIR",
    os.path.join(os.path.dirname(__file__), "data")
)
os.makedirs(DATABASE_DIR, exist_ok=True)
DATABASE_PATH = os.path.join(DATABASE_DIR, "watchlist_database.db")

@contextmanager
def get_db():
    """Context manager for safe SQLite connections with row factory."""
    conn = sqlite3.connect(DATABASE_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
    finally:
        conn.close()

def init_db():
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS watchlists (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL
        )
        """)
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS watchlist_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            watchlist_id INTEGER,
            symbol TEXT NOT NULL,
            name TEXT,
            sector TEXT,
            quantity REAL DEFAULT 0.0,
            purchase_price REAL DEFAULT 0.0,
            in_portfolio INTEGER DEFAULT 0,
            FOREIGN KEY(watchlist_id) REFERENCES watchlists(id) ON DELETE CASCADE,
            UNIQUE(watchlist_id, symbol)
        )
        """)
        # Run alter table commands inside try-catch block for backward-compatibility
        try:
            cursor.execute("ALTER TABLE watchlist_items ADD COLUMN quantity REAL DEFAULT 0.0")
        except Exception:
            pass
        try:
            cursor.execute("ALTER TABLE watchlist_items ADD COLUMN purchase_price REAL DEFAULT 0.0")
        except Exception:
            pass
        try:
            cursor.execute("ALTER TABLE watchlist_items ADD COLUMN in_portfolio INTEGER DEFAULT 0")
        except Exception:
            pass
        # Dedicated Portfolio Items table for AI Portfolio Doctor
        try:
            cursor.execute("SELECT purchase_date FROM portfolio_items LIMIT 1")
        except Exception:
            cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='portfolio_items'")
            exists = cursor.fetchone()
            if exists:
                # Migrate by creating a temporary table without UNIQUE on symbol
                cursor.execute("CREATE TABLE IF NOT EXISTS portfolio_items_temp (id INTEGER PRIMARY KEY AUTOINCREMENT, symbol TEXT NOT NULL, name TEXT, sector TEXT, quantity REAL DEFAULT 10.0, purchase_price REAL DEFAULT 100.0, purchase_date TEXT DEFAULT '2026-06-05')")
                cursor.execute("INSERT INTO portfolio_items_temp (symbol, name, sector, quantity, purchase_price, purchase_date) SELECT symbol, name, sector, quantity, purchase_price, '2026-06-05' FROM portfolio_items")
                cursor.execute("DROP TABLE portfolio_items")
                cursor.execute("ALTER TABLE portfolio_items_temp RENAME TO portfolio_items")
            else:
                # Create fresh table
                cursor.execute("""
                CREATE TABLE IF NOT EXISTS portfolio_items (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    symbol TEXT NOT NULL,
                    name TEXT,
                    sector TEXT,
                    quantity REAL DEFAULT 10.0,
                    purchase_price REAL DEFAULT 100.0,
                    purchase_date TEXT DEFAULT '2026-06-05',
                    transaction_type TEXT DEFAULT 'buy'
                )
                """)
        try:
            cursor.execute("ALTER TABLE portfolio_items ADD COLUMN transaction_type TEXT DEFAULT 'buy'")
        except Exception:
            pass
        # Persistent alerts table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS alerts (
            id TEXT PRIMARY KEY,
            ticker TEXT NOT NULL,
            condition_type TEXT NOT NULL,
            operator TEXT NOT NULL,
            value TEXT NOT NULL,
            status TEXT DEFAULT 'Active',
            triggered INTEGER DEFAULT 0,
            trigger_date TEXT DEFAULT ''
        )
        """)
        # Persistent screener universe table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS screener_universe (
            symbol TEXT PRIMARY KEY,
            base_symbol TEXT NOT NULL,
            company_name TEXT NOT NULL,
            sector TEXT NOT NULL,
            cap_type TEXT NOT NULL,
            last_rebalanced TEXT NOT NULL
        )
        """)
        # Persistent cached profiles table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS cached_profiles (
            symbol TEXT PRIMARY KEY,
            profile_json TEXT NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """)
        conn.commit()

init_db()

def compute_active_holdings(transactions: list) -> list:
    """
    Applies chronological First-In-First-Out (FIFO) netting on a list of raw transaction records.
    Returns the list of active buy tranches (with remaining quantities > 0).
    """
    from collections import defaultdict
    from datetime import datetime

    # Group transactions by symbol
    grouped = defaultdict(list)
    for tx in transactions:
        symbol = tx.get("symbol", "").strip().upper()
        if symbol:
            grouped[symbol].append(tx)

    active_tranches = []
    for symbol, symbol_txs in grouped.items():
        # Sort chronologically by date, then by transaction ID to preserve original order
        def get_sort_key(x):
            date_str = x.get("purchase_date") or "2026-06-05"
            try:
                dt = datetime.strptime(date_str, "%Y-%m-%d")
            except Exception:
                dt = datetime.strptime("2026-06-05", "%Y-%m-%d")
            return (dt, x.get("id") or 0)

        symbol_txs.sort(key=get_sort_key)

        buys = []
        for tx in symbol_txs:
            t_type = (tx.get("transaction_type") or "buy").strip().lower()
            qty = float(tx.get("quantity") or 0.0)
            if qty <= 0:
                continue

            if t_type == "buy":
                # Create a copy to prevent modifying the database dict in-place
                buys.append({
                    "id": tx.get("id"),
                    "symbol": tx.get("symbol"),
                    "name": tx.get("name"),
                    "sector": tx.get("sector") or "General Equities",
                    "quantity": qty,
                    "purchase_price": float(tx.get("purchase_price") or 0.0),
                    "purchase_date": tx.get("purchase_date"),
                    "transaction_type": "buy"
                })
            elif t_type == "sell":
                sell_qty = qty
                while sell_qty > 0 and buys:
                    oldest_buy = buys[0]
                    if oldest_buy["quantity"] > sell_qty:
                        oldest_buy["quantity"] = round(oldest_buy["quantity"] - sell_qty, 6)
                        sell_qty = 0
                    else:
                        sell_qty = round(sell_qty - oldest_buy["quantity"], 6)
                        buys.pop(0)

        for buy in buys:
            if buy["quantity"] > 0:
                active_tranches.append(buy)

    return active_tranches

# Load env variables from root directory
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"))

# Import analytical and agent engines
from backend.financial_utils import get_complete_financial_profile, resolve_company_ticker, calculate_portfolio_backtest
from backend.agent import run_cio_parent_agent, run_ai_stock_screener, run_comparison_synthesizer, run_conversational_chat, run_portfolio_doctor, call_groq_llm, run_single_stock_audit, generate_backtest_synthesis, calculate_portfolio_taxes

def sanitize_nan_values(x):
    """Recursively replaces float('nan'), inf, and -inf with None for JSON compliance."""
    if isinstance(x, dict):
        return {k: sanitize_nan_values(v) for k, v in x.items()}
    elif isinstance(x, list):
        return [sanitize_nan_values(v) for v in x]
    elif isinstance(x, float):
        if math.isnan(x) or math.isinf(x):
            return None
        return x
    return x

class SafeJSONResponse(JSONResponse):
    """A JSONResponse subclass that safely handles non-compliant floats globally."""
    def render(self, content) -> bytes:
        return super().render(sanitize_nan_values(content))

app = FastAPI(
    title="Indian Stock Analysis AI Workstation",
    description="Institutional-grade AI advisory and stock discovery terminal.",
    version="2.0.0",
    default_response_class=SafeJSONResponse
)

# --- Universe Seeding, Index Rebalancing, & Warm Caching ---

DEFAULT_SEED_STOCKS = [
    {"symbol": "RELIANCE.NS", "base": "RELIANCE", "name": "Reliance Industries", "sector": "Energy & Oil", "cap_type": "large"},
    {"symbol": "TCS.NS", "base": "TCS", "name": "Tata Consultancy Services", "sector": "Technology (IT)", "cap_type": "large"},
    {"symbol": "INFY.NS", "base": "INFY", "name": "Infosys", "sector": "Technology (IT)", "cap_type": "large"},
    {"symbol": "WIPRO.NS", "base": "WIPRO", "name": "Wipro", "sector": "Technology (IT)", "cap_type": "large"},
    {"symbol": "HDFCBANK.NS", "base": "HDFCBANK", "name": "HDFC Bank", "sector": "Financial Services (Banking)", "cap_type": "large"},
    {"symbol": "ICICIBANK.NS", "base": "ICICIBANK", "name": "ICICI Bank", "sector": "Financial Services (Banking)", "cap_type": "large"},
    {"symbol": "SBIN.NS", "base": "SBIN", "name": "State Bank of India", "sector": "Financial Services (Banking)", "cap_type": "large"},
    {"symbol": "TATAMOTORS.NS", "base": "TATAMOTORS", "name": "Tata Motors", "sector": "Automobile", "cap_type": "large"},
    {"symbol": "MARUTI.NS", "base": "MARUTI", "name": "Maruti Suzuki", "sector": "Automobile", "cap_type": "large"},
    {"symbol": "LT.NS", "base": "LT", "name": "Larsen & Toubro", "sector": "Infrastructure", "cap_type": "large"},
    {"symbol": "ITC.NS", "base": "ITC", "name": "ITC Limited", "sector": "Consumer Goods", "cap_type": "large"},
    {"symbol": "HINDUNILVR.NS", "base": "HINDUNILVR", "name": "Hindustan Unilever", "sector": "Consumer Goods", "cap_type": "large"},
    {"symbol": "BHARTIARTL.NS", "base": "BHARTIARTL", "name": "Bharti Airtel", "sector": "Telecommunication", "cap_type": "large"},
    {"symbol": "AXISBANK.NS", "base": "AXISBANK", "name": "Axis Bank", "sector": "Financial Services (Banking)", "cap_type": "large"},
    {"symbol": "KOTAKBANK.NS", "base": "KOTAKBANK", "name": "Kotak Mahindra Bank", "sector": "Financial Services (Banking)", "cap_type": "large"},
    {"symbol": "TATASTEEL.NS", "base": "TATASTEEL", "name": "Tata Steel", "sector": "Metals & Mining", "cap_type": "large"},
    {"symbol": "COALINDIA.NS", "base": "COALINDIA", "name": "Coal India", "sector": "Energy & Oil", "cap_type": "large"},
    {"symbol": "NTPC.NS", "base": "NTPC", "name": "NTPC Limited", "sector": "Power & Utilities", "cap_type": "large"},
    {"symbol": "SUNPHARMA.NS", "base": "SUNPHARMA", "name": "Sun Pharmaceutical", "sector": "Pharmaceuticals", "cap_type": "large"},
    {"symbol": "TITAN.NS", "base": "TITAN", "name": "Titan Company", "sector": "Consumer Goods", "cap_type": "large"},
    {"symbol": "BAJFINANCE.NS", "base": "BAJFINANCE", "name": "Bajaj Finance", "sector": "Financial Services", "cap_type": "large"},
    {"symbol": "JSWSTEEL.NS", "base": "JSWSTEEL", "name": "JSW Steel", "sector": "Metals & Mining", "cap_type": "large"},
    {"symbol": "POWERGRID.NS", "base": "POWERGRID", "name": "Power Grid Corporation", "sector": "Power & Utilities", "cap_type": "large"},
    {"symbol": "ONGC.NS", "base": "ONGC", "name": "ONGC", "sector": "Energy & Oil", "cap_type": "large"},
    {"symbol": "M&M.NS", "base": "M&M", "name": "Mahindra & Mahindra", "sector": "Automobile", "cap_type": "large"},
    
    {"symbol": "HAL.NS", "base": "HAL", "name": "Hindustan Aeronautics", "sector": "Defense & Aerospace", "cap_type": "mid"},
    {"symbol": "RVNL.NS", "base": "RVNL", "name": "Rail Vikas Nigam Ltd", "sector": "Infrastructure", "cap_type": "mid"},
    {"symbol": "DIXON.NS", "base": "DIXON", "name": "Dixon Technologies", "sector": "Consumer Electronics", "cap_type": "mid"},
    {"symbol": "IRFC.NS", "base": "IRFC", "name": "Indian Railway Finance", "sector": "Financial Services", "cap_type": "mid"},
    {"symbol": "COFORGE.NS", "base": "COFORGE", "name": "Coforge Ltd", "sector": "Technology (IT)", "cap_type": "mid"},
    {"symbol": "PFC.NS", "base": "PFC", "name": "Power Finance Corp", "sector": "Financial Services", "cap_type": "mid"},
    {"symbol": "RECLTD.NS", "base": "RECLTD", "name": "REC Limited", "sector": "Financial Services", "cap_type": "mid"},
    
    {"symbol": "CDSL.NS", "base": "CDSL", "name": "Central Depository Services", "sector": "Financial Services", "cap_type": "small"},
    {"symbol": "ANGELONE.NS", "base": "ANGELONE", "name": "Angel One", "sector": "Financial Services", "cap_type": "small"},
    {"symbol": "SUZLON.NS", "base": "SUZLON", "name": "Suzlon Energy", "sector": "Renewable Energy", "cap_type": "small"},
    {"symbol": "IREDA.NS", "base": "IREDA", "name": "IREDA Ltd", "sector": "Renewable Energy", "cap_type": "small"},
    {"symbol": "IRCON.NS", "base": "IRCON", "name": "IRCON International", "sector": "Infrastructure", "cap_type": "small"},
    {"symbol": "RITES.NS", "base": "RITES", "name": "RITES Ltd", "sector": "Infrastructure", "cap_type": "small"},
    {"symbol": "NHPC.NS", "base": "NHPC", "name": "NHPC Limited", "sector": "Power & Utilities", "cap_type": "small"}
]

def seed_default_universe() -> int:
    timestamp = datetime.now().isoformat()
    seed_data = []
    for item in DEFAULT_SEED_STOCKS:
        seed_data.append({
            "symbol": item["symbol"],
            "base": item["base"],
            "name": item["name"],
            "sector": item["sector"],
            "cap_type": item["cap_type"],
            "timestamp": timestamp
        })
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM screener_universe")
        cursor.executemany("""
        INSERT OR REPLACE INTO screener_universe 
        (symbol, base_symbol, company_name, sector, cap_type, last_rebalanced) 
        VALUES (:symbol, :base, :name, :sector, :cap_type, :timestamp)
        """, seed_data)
        conn.commit()
    return len(seed_data)

def rebalance_index_universe() -> int:
    import io
    urls = {
        "large": "https://archives.nseindia.com/content/indices/ind_nifty100list.csv",
        "mid": "https://archives.nseindia.com/content/indices/ind_niftymidcap150list.csv",
        "small": "https://archives.nseindia.com/content/indices/ind_niftysmallcap250list.csv"
    }
    
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    
    timestamp = datetime.now().isoformat()
    new_universe = []
    
    for cap, url in urls.items():
        try:
            res = requests.get(url, headers=headers, timeout=10)
            if res.status_code == 200:
                df = pd.read_csv(io.StringIO(res.text))
                for _, row in df.iterrows():
                    symbol = f"{row['Symbol'].strip()}.NS"
                    new_universe.append({
                        "symbol": symbol,
                        "base": row['Symbol'].strip(),
                        "name": row['Company Name'].strip(),
                        "sector": row['Industry'].strip(),
                        "cap_type": cap,
                        "timestamp": timestamp
                    })
        except Exception as e:
            print(f"Error downloading {cap} CSV list: {e}")
            
    if new_universe:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM screener_universe")
            cursor.executemany("""
            INSERT OR REPLACE INTO screener_universe 
            (symbol, base_symbol, company_name, sector, cap_type, last_rebalanced) 
            VALUES (:symbol, :base, :name, :sector, :cap_type, :timestamp)
            """, new_universe)
            conn.commit()
        return len(new_universe)
    return 0

async def run_background_cache_warmer():
    print("Background cache warmer: initial 10s delay before start...")
    await asyncio.sleep(10)
    while True:
        try:
            with get_db() as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT symbol FROM screener_universe WHERE symbol NOT LIKE '%DUMMY%'")
                symbols = [row["symbol"] for row in cursor.fetchall()]
            
            print(f"Background cache warmer: starting sweep for {len(symbols)} symbols...")
            
            for sym in symbols:
                try:
                    with get_db() as conn:
                        cursor = conn.cursor()
                        cursor.execute("SELECT updated_at FROM cached_profiles WHERE symbol = ?", (sym,))
                        row = cursor.fetchone()
                        
                    if row and row["updated_at"]:
                        try:
                            cached_time = datetime.strptime(row["updated_at"][:19], "%Y-%m-%d %H:%M:%S")
                            if (datetime.now() - cached_time).total_seconds() < 24 * 3600:
                                continue
                        except Exception:
                            # If date format is weird, force refresh
                            pass
                            
                    print(f"Background cache warmer: fetching profile for {sym}...")
                    profile = await asyncio.to_thread(get_complete_financial_profile, sym)
                    
                    with get_db() as conn:
                        conn.execute(
                            "INSERT OR REPLACE INTO cached_profiles (symbol, profile_json, updated_at) VALUES (?, ?, ?)",
                            (sym, json.dumps(profile), datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
                        )
                        conn.commit()
                    print(f"Background cache warmer: successfully cached {sym}")
                    await asyncio.sleep(4)
                except Exception as e:
                    print(f"Background warming error for {sym}: {e}")
                    await asyncio.sleep(10)
            
            print("Background cache warmer: sweep complete. Sleeping for 1 hour.")
        except Exception as e:
            print(f"Universe cache warmer loop error: {e}")
            
        await asyncio.sleep(3600)


@app.on_event("startup")
async def startup_warm_caching():
    # 1. Initialize universe seeds if empty
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) as cnt FROM screener_universe")
        count = cursor.fetchone()["cnt"]
        
    if count == 0:
        seed_default_universe()
        
    # 2. Fire index rebalancing asynchronously
    asyncio.create_task(asyncio.to_thread(rebalance_index_universe))
    
    # 3. Fire background cache warmer
    asyncio.create_task(run_background_cache_warmer())

@app.post("/api/admin/rebalance")
async def trigger_index_rebalance():
    """Manual administration endpoint to fetch official NSE index constituent listings."""
    try:
        count = await asyncio.to_thread(rebalance_index_universe)
        if count > 0:
            return {"status": "success", "message": f"Successfully rebalanced. Synced {count} index constituents in SQLite."}
        count = await asyncio.to_thread(seed_default_universe)
        return {"status": "success", "message": f"NSE downloads failed. Synced {count} local default constituents in SQLite."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Index rebalancing failed: {str(e)}")

@app.get("/api/admin/rebalance-status")
async def get_rebalance_status():
    """Returns current universe sync status: last rebalanced timestamp, universe size, cached profiles count."""
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "SELECT COUNT(*) as cnt, MAX(last_rebalanced) as last_ts FROM screener_universe WHERE symbol NOT LIKE '%DUMMY%'"
            )
            uni_row = cursor.fetchone()
            cursor.execute("SELECT COUNT(*) as cnt FROM cached_profiles")
            cache_row = cursor.fetchone()
        return {
            "last_rebalanced": uni_row["last_ts"] or "Never",
            "universe_count": uni_row["cnt"] or 0,
            "cached_count": cache_row["cnt"] or 0,
            "next_scheduled": "On next server restart or manual trigger"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Status fetch failed: {str(e)}")

# Environment-gated CORS
cors_origins_env = os.environ.get("CORS_ORIGINS", "*")
if cors_origins_env == "*":
    allow_origins = ["*"]
else:
    allow_origins = [o.strip() for o in cors_origins_env.split(",")]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Pydantic models for structured endpoints
class DCFOverrideRequest(BaseModel):
    query: str
    horizon: str
    risk_profile: str
    revenue_growth: float
    opm: float
    wacc: float
    terminal_growth: float = 4.5

class ChatMessage(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    history: List[ChatMessage]
    message: str
    profile: dict

class AlertRequest(BaseModel):
    ticker: str
    condition_type: str
    operator: str
    value: str

class WatchlistCreate(BaseModel):
    name: str

class WatchlistItemCreate(BaseModel):
    symbol: str
    quantity: Optional[float] = 0.0
    purchase_price: Optional[float] = 0.0
    in_portfolio: Optional[int] = 0

class WatchlistItemUpdate(BaseModel):
    quantity: Optional[float] = None
    purchase_price: Optional[float] = None
    in_portfolio: Optional[int] = None

class PortfolioItemCreate(BaseModel):
    symbol: str
    quantity: Optional[float] = 10.0
    purchase_price: Optional[float] = 100.0
    purchase_date: Optional[str] = "2026-06-05"
    transaction_type: Optional[str] = "buy"

class PortfolioItemUpdate(BaseModel):
    quantity: Optional[float] = None
    purchase_price: Optional[float] = None
    purchase_date: Optional[str] = None
    transaction_type: Optional[str] = None

class WatchlistRename(BaseModel):
    name: str

@app.get("/api/search")
async def search_ticker(q: str):
    """Resolves conversational company queries into NSE tickers."""
    if not q:
        raise HTTPException(status_code=400, detail="Search query parameter 'q' is required.")
    try:
        resolved = resolve_company_ticker(q)
        return resolved
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Ticker search error: {str(e)}")

@app.get("/api/analyze")
async def analyze_stock(
    query: str,
    horizon: str = "Long-term (3+ years)",
    risk: str = "Moderate"
):
    """Triggers the hierarchical multi-agent analysis on the selected stock."""
    if not query:
        raise HTTPException(status_code=400, detail="Stock query is required.")
    try:
        profile = await run_cio_parent_agent(query, horizon, risk)
        # Commit to persistent SQLite cache to warm it up for Screener & Explorer
        try:
            with get_db() as conn:
                conn.execute(
                    "INSERT OR REPLACE INTO cached_profiles (symbol, profile_json, updated_at) VALUES (?, ?, ?)",
                    (profile["ticker"], json.dumps(profile), datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
                )
                conn.commit()
        except Exception as db_err:
            print(f"Error caching analyzed profile to persistent SQLite: {db_err}")
        return profile
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Orchestration Analysis error: {str(e)}")

@app.post("/api/analyze-custom")
async def analyze_custom_dcf(data: DCFOverrideRequest):
    """Recalculates DCF sandbox overlays and returns updated AI prospectus."""
    try:
        custom_dcf = {
            "revenue_growth": data.revenue_growth,
            "opm": data.opm,
            "wacc": data.wacc,
            "terminal_growth": data.terminal_growth
        }
        profile = await run_cio_parent_agent(data.query, data.horizon, data.risk_profile, custom_dcf=custom_dcf)
        return profile
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Custom valuation modeling error: {str(e)}")

@app.get("/api/discover")
async def discover_stocks(
    strategy: str = "hybrid",
    universe: str = "all",
    horizon: str = "Long-term (3+ years)",
    risk: str = "Moderate",
    style: str = "all"
):
    """
    Runs AI Screener Engine across the selected strategy (Bottom-Up, Top-Down, Hybrid)
    and selected cap category (All, Large, Mid, Small), with an optional style overlay.
    Investor profile (horizon + risk) adjusts quality gates and recommendation thresholds.
    """
    if strategy not in ["bottom_up", "top_down", "hybrid"]:
        raise HTTPException(status_code=400, detail="Invalid strategy selector.")
    if style not in ["all", "value", "growth", "contra"]:
        raise HTTPException(status_code=400, detail="Invalid investment style selector.")
    try:
        results = await asyncio.to_thread(run_ai_stock_screener, strategy, universe, horizon, risk, style)
        return results
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Screener engine failed: {str(e)}")

@app.get("/api/stock/audit")
async def audit_stock(
    symbol: str,
    horizon: str = "Long-term (3+ years)",
    risk: str = "Moderate"
):
    """
    Simulates the selected stock against all 12 operational + style screening combinations,
    returning detailed pass/failed checklists and style score calculations.
    """
    try:
        result = await asyncio.to_thread(run_single_stock_audit, symbol, horizon, risk)
        if "error" in result:
            raise HTTPException(status_code=400, detail=result["error"])
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Strategic audit simulation failed: {str(e)}")


@app.get("/api/stock/capture")
async def get_interactive_capture(
    symbol: str,
    years: Optional[str] = None,
    period: Optional[str] = None
):
    """
    Calculates Up-Market Capture and Down-Market Capture ratios over the selected time horizon
    (e.g., 3m, 6m, 9m, 1y, 3y, 5y).
    """
    if not symbol:
        raise HTTPException(status_code=400, detail="Stock symbol is required.")
        
    time_horizon = period or years or "3y"
    time_horizon = time_horizon.strip().lower()
    
    if time_horizon not in ["3m", "6m", "9m", "1y", "3y", "5y", "1", "3", "5"]:
        raise HTTPException(status_code=400, detail="Time period must be 3m, 6m, 9m, 1y, 3y, or 5y.")
        
    if time_horizon == "1":
        time_horizon = "1y"
    elif time_horizon == "3":
        time_horizon = "3y"
    elif time_horizon == "5":
        time_horizon = "5y"
        
    try:
        from backend.financial_utils import calculate_capture_ratios, resolve_company_ticker
        resolved = resolve_company_ticker(symbol)
        ticker = resolved["yf_ticker"]
        
        # Calculate fresh capture ratios in another thread to keep FastAPI responsive
        ratios = await asyncio.to_thread(calculate_capture_ratios, ticker, None, time_horizon)
        return ratios
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Capture ratio calculation failed: {str(e)}")


@app.get("/api/stock/compare-chart")
async def get_compare_chart(
    symbols: str,
    period: str = "1y"
):
    """
    Returns aligned, normalized daily price histories for multiple stock symbols + benchmark index.
    Allows side-by-side performance overlays inside the benchmarking panel.
    """
    if not symbols:
        raise HTTPException(status_code=400, detail="Symbols parameter is required.")
    if period not in ["3mo", "6mo", "1y", "2y", "3y", "5y"]:
        raise HTTPException(status_code=400, detail="Supported periods are 3mo, 6mo, 1y, 2y, 3y, or 5y.")
        
    try:
        from backend.financial_utils import resolve_company_ticker
        ticker_list = [s.strip().upper() for s in symbols.split(",") if s.strip()]
        if not ticker_list:
            raise HTTPException(status_code=400, detail="Invalid symbols list.")
            
        # Resolve tickers through company index lookup first
        resolved_tickers = []
        for s in ticker_list:
            if s.startswith("^"):
                resolved_tickers.append(s)
            else:
                try:
                    res = resolve_company_ticker(s)
                    resolved_tickers.append(res["yf_ticker"])
                except Exception:
                    # Fallback directly to symbol if resolution fails
                    resolved_tickers.append(s)
                    
        # Add Nifty 50 or Sensex based on first symbol's exchange suffix
        primary = resolved_tickers[0]
        benchmark = "^BSESN" if primary.endswith(".BO") else "^NSEI"
        if benchmark not in resolved_tickers:
            resolved_tickers.append(benchmark)
            
        # Fetch price histories concurrently using thread pool execution
        def fetch_ticker_data(ticker):
            try:
                t = yf.Ticker(ticker)
                # auto_adjust=True guarantees proper stock splits / dividends adjustments
                df = t.history(period=period, interval="1d", auto_adjust=True)
                if df.empty:
                    return ticker, None
                return ticker, df["Close"]
            except Exception as e:
                print(f"Error fetching data for {ticker}: {e}")
                return ticker, None
                
        # Concurrently query yfinance
        loop = asyncio.get_event_loop()
        tasks = [loop.run_in_executor(None, fetch_ticker_data, ticker) for ticker in resolved_tickers]
        results = await asyncio.gather(*tasks)
        
        # Build DataFrame with aligned series
        series_dict = {}
        for ticker, series in results:
            if series is not None and not series.empty:
                series_dict[ticker] = series
                
        if not series_dict:
            raise HTTPException(status_code=400, detail="No historical price data could be loaded for any symbols.")
            
        # Use pandas to align date indices via outer join and forward-fill occasional gaps
        combined_df = pd.DataFrame(series_dict)
        # Drop dates with completely missing values (e.g. weekend alignment gaps)
        combined_df = combined_df.dropna(how="all")
        # Forward fill individual missing prices for trading holiday alignments
        combined_df = combined_df.ffill().bfill()
        
        if combined_df.empty:
            raise HTTPException(status_code=400, detail="Aligned price series DataFrame is empty.")
            
        dates = [d.strftime("%Y-%m-%d") for d in combined_df.index]
        
        # Normalize each series to start exactly at 100.0 relative to its first valid price index
        normalized_series = {}
        for col in combined_df.columns:
            first_idx = combined_df[col].first_valid_index()
            if first_idx is not None:
                first_price = combined_df.loc[first_idx, col]
                if first_price > 0.0:
                    normalized_series[col] = [
                        round((val / first_price) * 100.0, 2) for val in combined_df[col]
                    ]
                else:
                    normalized_series[col] = [100.0] * len(combined_df)
            else:
                normalized_series[col] = [100.0] * len(combined_df)
                
        return {
            "dates": dates,
            "series": normalized_series,
            "benchmark_symbol": benchmark
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Comparison overlay calculation failed: {str(e)}")


@app.get("/api/universe")
async def get_index_universe(cap_type: Optional[str] = None):
    """
    Returns the list of stocks in each index stored in the database,
    indicating their symbol, name, industry/sector, cap type, rebalance date,
    and whether they have a cached profile.
    """
    query = """
        SELECT 
            u.symbol, 
            u.base_symbol, 
            u.company_name, 
            u.sector, 
            u.cap_type, 
            u.last_rebalanced,
            (CASE WHEN p.symbol IS NOT NULL THEN 1 ELSE 0 END) as is_cached
        FROM screener_universe u
        LEFT JOIN cached_profiles p ON u.symbol = p.symbol
        WHERE u.symbol NOT LIKE '%DUMMY%'
    """
    params = []
    if cap_type:
        query += " AND u.cap_type = ?"
        params.append(cap_type)
        
    query += " ORDER BY u.company_name ASC"
    
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute(query, params)
            rows = [dict(row) for row in cursor.fetchall()]
        return rows
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch index universe: {str(e)}")

def calculate_support_resistance_lines(prices: list) -> tuple:
    """
    Finds structural support and resistance channels using the trendln library.
    Selects the primary support/resistance trendlines based on extrema pivot count.
    """
    import numpy as np
    n = len(prices)
    sup_series = [None] * n
    res_series = [None] * n
    
    try:
        import trendln
        h = np.array(prices, dtype=np.float64)
        
        # accuracy=8 sweeps multiple pivot directions to find best fit
        (minima, maxima, sup_lines, res_lines) = trendln.calc_support_resistance(h, accuracy=8)
        
        # Sort and select the line with the maximum pivot touch points
        if sup_lines:
            best_sup = max(sup_lines, key=lambda x: len(x[2]))
            slope, intercept = best_sup[0], best_sup[1]
            for i in range(n):
                sup_series[i] = float(slope * i + intercept)
                
        if res_lines:
            best_res = max(res_lines, key=lambda x: len(x[2]))
            slope, intercept = best_res[0], best_res[1]
            for i in range(n):
                res_series[i] = float(slope * i + intercept)
                
        # Fill empty series fallback
        if all(x is None for x in sup_series):
            sup_series = [float(min(prices))] * n
        if all(x is None for x in res_series):
            res_series = [float(max(prices))] * n
            
        return sup_series, res_series
    except Exception as e:
        print(f"Error calculating trendlines via trendln: {e}")
        # Mathematical failsafe boundaries fallback
        try:
            p_min = float(min(prices))
            p_max = float(max(prices))
            return [p_min] * n, [p_max] * n
        except Exception:
            return [0.0] * n, [1.0] * n

@app.get("/api/chart")
async def get_chart_data(ticker: str, period: str = "1y", interval: str = "1d"):
    """
    Dynamically fetches Yahoo Finance historical price series supporting dynamic 
    durations and frequencies, calculating SMAs over extended histories to avoid NaN values.
    Uses the direct public Chart CDN endpoint for maximum speed and rate-limit immunity.
    """
    if not ticker:
        raise HTTPException(status_code=400, detail="Ticker parameter is required.")
    try:
        # Map parameters to raw chart endpoint
        fetch_range = "2y"
        if interval == "1wk":
            fetch_range = "5y"
        elif interval == "1mo":
            fetch_range = "max"
            
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?range={fetch_range}&interval={interval}"
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
        res = requests.get(url, headers=headers, timeout=8)
        if res.status_code != 200:
            raise HTTPException(status_code=500, detail=f"Yahoo Chart API returned status code {res.status_code}")
            
        chart_data = res.json()
        result = chart_data.get("chart", {}).get("result", [None])[0]
        if not result:
            raise HTTPException(status_code=404, detail="No price data returned from Yahoo Chart endpoint.")
            
        timestamps = result.get("timestamp", [])
        indicators = result.get("indicators", {}).get("quote", [{}])[0]
        
        if not timestamps or not indicators:
            raise HTTPException(status_code=404, detail="Missing timestamps or indicator quote data.")
            
        dates = [datetime.fromtimestamp(t) for t in timestamps]
        df = pd.DataFrame(index=dates)
        
        # Clean and ffill/bfill to avoid None/NaN values in indicators quotes
        df["Open"] = pd.Series(indicators.get("open", [])).ffill().bfill().values
        df["High"] = pd.Series(indicators.get("high", [])).ffill().bfill().values
        df["Low"] = pd.Series(indicators.get("low", [])).ffill().bfill().values
        df["Close"] = pd.Series(indicators.get("close", [])).ffill().bfill().values
        df["Volume"] = pd.Series(indicators.get("volume", [])).ffill().bfill().values
        
        # Double check if any NaNs remain (e.g. if the series was entirely empty) and fill
        df = df.ffill().bfill()
        
        # Calculate moving averages dynamically on the loaded frequency
        df['SMA_50'] = df['Close'].rolling(window=50).mean()
        df['SMA_200'] = df['Close'].rolling(window=200).mean()
        
        # Calculate Volatility & Momentum Series (Bollinger Bands, ATR, MACD, VPT)
        df['SMA_20'] = df['Close'].rolling(window=20).mean()
        df['STD_20'] = df['Close'].rolling(window=20).std()
        df['BB_Upper'] = df['SMA_20'] + 2 * df['STD_20']
        df['BB_Lower'] = df['SMA_20'] - 2 * df['STD_20']
        
        df['H-L'] = df['High'] - df['Low']
        df['H-Cp'] = (df['High'] - df['Close'].shift(1)).abs()
        df['L-Cp'] = (df['Low'] - df['Close'].shift(1)).abs()
        df['TR'] = df[['H-L', 'H-Cp', 'L-Cp']].max(axis=1)
        df['ATR'] = df['TR'].rolling(window=14).mean()
        
        df['EMA_12'] = df['Close'].ewm(span=12, adjust=False).mean()
        df['EMA_26'] = df['Close'].ewm(span=26, adjust=False).mean()
        df['MACD'] = df['EMA_12'] - df['EMA_26']
        df['MACD_Signal'] = df['MACD'].ewm(span=9, adjust=False).mean()
        df['MACD_Hist'] = df['MACD'] - df['MACD_Signal']
        
        df['Price_Chg_Pct'] = df['Close'].pct_change()
        df['VPT_Flow'] = df['Volume'] * df['Price_Chg_Pct']
        df['VPT'] = df['VPT_Flow'].cumsum()
        
        # Replace NaN with first available values for flawless charting
        df['SMA_50'] = df['SMA_50'].bfill().ffill()
        df['SMA_200'] = df['SMA_200'].bfill().ffill()
        df['BB_Upper'] = df['BB_Upper'].bfill().ffill()
        df['BB_Lower'] = df['BB_Lower'].bfill().ffill()
        df['ATR'] = df['ATR'].bfill().ffill()
        df['MACD'] = df['MACD'].bfill().ffill()
        df['MACD_Signal'] = df['MACD_Signal'].bfill().ffill()
        df['MACD_Hist'] = df['MACD_Hist'].bfill().ffill()
        df['VPT'] = df['VPT'].bfill().ffill()
        
        # Slice the resulting series to only return the requested period
        period_days = {
            "1mo": 30,
            "3mo": 90,
            "6mo": 180,
            "1y": 365,
            "2y": 365 * 2,
            "3y": 365 * 3,
            "5y": 365 * 5
        }
        days = period_days.get(period, 365)
        cutoff_date = datetime.now() - timedelta(days=days)
            
        df_sliced = df[df.index >= cutoff_date]
        if len(df_sliced) < 5:
            df_sliced = df.tail(20) # Failsafe if slicing left too few rows
            
        labels = [index.strftime("%Y-%m-%d") for index in df_sliced.index]
        prices = df_sliced['Close'].tolist()
        sma50 = df_sliced['SMA_50'].tolist()
        sma200 = df_sliced['SMA_200'].tolist()
        volumes = df_sliced['Volume'].tolist()
        
        bb_upper = df_sliced['BB_Upper'].tolist()
        bb_lower = df_sliced['BB_Lower'].tolist()
        atr = df_sliced['ATR'].tolist()
        macd = df_sliced['MACD'].tolist()
        macd_signal = df_sliced['MACD_Signal'].tolist()
        macd_hist = df_sliced['MACD_Hist'].tolist()
        vpt = df_sliced['VPT'].tolist()
        
        opens = df_sliced['Open'].tolist()
        highs = df_sliced['High'].tolist()
        lows = df_sliced['Low'].tolist()
        
        # Calculate dynamic support and resistance trendlines using trendln
        ai_sup, ai_res = calculate_support_resistance_lines(prices)
        
        return {
            "labels": labels,
            "prices": [float(p) for p in prices],
            "open": [float(o) if not pd.isna(o) else float(prices[i]) for i, o in enumerate(opens)],
            "high": [float(h) if not pd.isna(h) else float(prices[i]) for i, h in enumerate(highs)],
            "low": [float(l) if not pd.isna(l) else float(prices[i]) for i, l in enumerate(lows)],
            "sma50": [float(s) if not pd.isna(s) else float(prices[i]) for i, s in enumerate(sma50)],
            "sma200": [float(s) if not pd.isna(s) else float(prices[i]) for i, s in enumerate(sma200)],
            "bb_upper": [float(s) if not pd.isna(s) else float(prices[i]) for i, s in enumerate(bb_upper)],
            "bb_lower": [float(s) if not pd.isna(s) else float(prices[i]) for i, s in enumerate(bb_lower)],
            "atr": [float(s) if not pd.isna(s) else 0.0 for i, s in enumerate(atr)],
            "macd": [float(s) if not pd.isna(s) else 0.0 for i, s in enumerate(macd)],
            "macd_signal": [float(s) if not pd.isna(s) else 0.0 for i, s in enumerate(macd_signal)],
            "macd_hist": [float(s) if not pd.isna(s) else 0.0 for i, s in enumerate(macd_hist)],
            "vpt": [float(s) if not pd.isna(s) else 0.0 for i, s in enumerate(vpt)],
            "volumes": [float(v) if not pd.isna(v) else 0.0 for v in volumes],
            "ai_support": [float(s) if s is not None else float(prices[i]) for i, s in enumerate(ai_sup)],
            "ai_resistance": [float(s) if s is not None else float(prices[i]) for i, s in enumerate(ai_res)]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Price series could not be retrieved from Yahoo Chart API: {str(e)}")

@app.get("/api/compare")
async def compare_rivals(tickers: str, generate_thesis: bool = False):
    """Benchmarks rivals side-by-side."""
    if not tickers:
        raise HTTPException(status_code=400, detail="Tickers parameter is required.")
    ticker_list = [t.strip().upper() for t in tickers.split(",")]
    try:
        comparison = await asyncio.to_thread(run_comparison_synthesizer, ticker_list, generate_thesis)
        return comparison
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Comparison aggregator error: {str(e)}")


def get_fibonacci_retracement_zone(current_price: float, fib_levels: dict) -> str:
    """
    Classifies where the current price sits relative to its Fibonacci levels.
    """
    if not fib_levels or not isinstance(fib_levels, dict):
        return "Neutral Zone"
    try:
        # Sort levels by price to find interval
        levels = [
            ("0.0% (52W High)", float(fib_levels.get("fib_0", 0.0))),
            ("23.6%", float(fib_levels.get("fib_236", 0.0))),
            ("38.2%", float(fib_levels.get("fib_382", 0.0))),
            ("50.0% (Mid-point)", float(fib_levels.get("fib_500", 0.0))),
            ("61.8% (Golden Ratio)", float(fib_levels.get("fib_618", 0.0))),
            ("78.6%", float(fib_levels.get("fib_786", 0.0))),
            ("100.0% (52W Low)", float(fib_levels.get("fib_100", 0.0)))
        ]
        # Sort in ascending order (Low price to High price)
        levels_sorted = sorted(levels, key=lambda x: x[1])
        
        if current_price < levels_sorted[0][1]:
            return f"Below 100.0% 52W Low (Rs. {levels_sorted[0][1]:.2f})"
        if current_price > levels_sorted[-1][1]:
            return f"Above 0.0% 52W High (Rs. {levels_sorted[-1][1]:.2f})"
            
        for i in range(len(levels_sorted) - 1):
            low_lbl, low_val = levels_sorted[i]
            high_lbl, high_val = levels_sorted[i+1]
            if low_val <= current_price <= high_val:
                return f"Between {low_lbl} (Rs. {low_val:.2f}) and {high_lbl} (Rs. {high_val:.2f})"
    except Exception:
        pass
    return "Neutral Zone"


@app.get("/api/synthesis")
async def get_synthesis(
    symbol: str,
    horizon: str = "Long-term (3+ years)",
    risk: str = "Moderate"
):
    """
    Overhauls workstation to support the Hybrid SaaS AI Equities Synthesis feature.
    Provides a comprehensive, dynamic, multi-agent financial synthesis of the loaded stock
    compiled by the parent LLM.
    """
    if not symbol:
        raise HTTPException(status_code=400, detail="Symbol query parameter is required.")
    try:
        # Resolve ticker first
        resolved = resolve_company_ticker(symbol)
        ticker = resolved.get("yf_ticker")
        if not ticker:
            ticker = symbol.upper()
            if not (ticker.endswith(".NS") or ticker.endswith(".BO")):
                ticker = f"{ticker}.NS"

        # Check cache
        profile = None
        try:
            with get_db() as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT profile_json FROM cached_profiles WHERE symbol = ?", (ticker,))
                row = cursor.fetchone()
                if row:
                    profile = json.loads(row["profile_json"])
        except Exception as e:
            print(f"Error checking cache for synthesis: {e}")

        # If not cached, trigger parent agent
        if not profile:
            profile = await run_cio_parent_agent(ticker, horizon, risk)
            # Cache the newly generated profile
            try:
                with get_db() as conn:
                    conn.execute(
                        "INSERT OR REPLACE INTO cached_profiles (symbol, profile_json, updated_at) VALUES (?, ?, ?)",
                        (ticker, json.dumps(profile), datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
                    )
                    conn.commit()
            except Exception as db_err:
                print(f"Error caching profile: {db_err}")

        # Package indicators safely
        eq = profile.get("earnings_quality", {})
        piotroski_score = eq.get("piotroski_score", 0)
        piotroski_label = eq.get("piotroski_label", "Unknown Quality")
        altman_z_score = eq.get("altman_z_score", 0.0)
        altman_zone = eq.get("altman_zone", "Unknown Zone")

        dcf = profile.get("dcf_model", {})
        dcf_intrinsic_value = dcf.get("intrinsic_value", 0.0)
        margin_of_safety = dcf.get("margin_of_safety", 0.0)

        fundamentals = profile.get("fundamentals", {})
        current_price = fundamentals.get("current_price", 0.0)

        technicals = profile.get("technicals", {})
        rsi = technicals.get("rsi", 50.0)
        sma_50 = technicals.get("sma_50", 0.0)
        sma_200 = technicals.get("sma_200", 0.0)
        
        # Advanced Volatility & Momentum Indicators
        bb_lower = technicals.get("bb_lower", 0.0)
        bb_upper = technicals.get("bb_upper", 0.0)
        atr = technicals.get("atr", 0.0)
        macd = technicals.get("macd", 0.0)
        macd_signal = technicals.get("macd_signal", 0.0)
        macd_hist = technicals.get("macd_hist", 0.0)
        vpt = technicals.get("vpt", 0.0)
        adx = technicals.get("adx", 22.0)
        volume_vs_avg20 = technicals.get("volume_vs_avg20", 1.0)

        # Volatility Squeeze & ATR ratio calculation
        squeeze_pct = ((bb_upper - bb_lower) / bb_lower * 100) if bb_lower > 0 else 0.0
        volatility_ratio = (atr / current_price * 100) if current_price > 0 else 0.0
        vol_level = "Low"
        if volatility_ratio > 3.0:
            vol_level = "High"
        elif volatility_ratio > 1.5:
            vol_level = "Moderate"
            
        atr_stop_loss = (current_price - 2 * atr) if (atr > 0 and current_price > 0) else 0.0
        macd_status = "Bullish Crossover" if macd_hist > 0 else ("Bearish Divergence" if macd_hist < 0 else "Neutral")
        vpt_status = "Expanding Accumulation" if vpt > 0 else "Neutral/Contracting"
        
        scoring = profile.get("score_metrics", {})
        final_score = scoring.get("final_score", 50)
        recommendation = profile.get("analysis", {}).get("recommendation", scoring.get("action", "HOLD"))

        # CAPM Risk factors (Nifty 50)
        nifty50_risk = profile.get("capm_risk_nifty50", {})
        nifty50_beta = nifty50_risk.get("beta", profile.get("info", {}).get("beta", 1.0))
        try:
            nifty50_beta = float(nifty50_beta)
        except Exception:
            nifty50_beta = 1.0
        nifty50_alpha = nifty50_risk.get("capm_alpha_pct", 0.0)
        nifty50_corr = nifty50_risk.get("correlation", 0.5)

        # CAPM Risk factors (Cap-specific Index)
        sector_risk = profile.get("capm_risk_sector", {})
        sector_beta = sector_risk.get("beta", nifty50_beta)
        try:
            sector_beta = float(sector_beta)
        except Exception:
            sector_beta = nifty50_beta
        sector_alpha = sector_risk.get("capm_alpha_pct", nifty50_alpha)
        sector_corr = sector_risk.get("correlation", nifty50_corr)
        sector_bench_symbol = sector_risk.get("benchmark_symbol", "^NSEI")
        sector_bench_name = sector_risk.get("benchmark_name", "Nifty 50")

        nifty50_stock_ret = nifty50_risk.get("annual_stock_ret_pct", 0.0)
        nifty50_bench_ret = nifty50_risk.get("annual_bench_ret_pct", 0.0)
        sector_stock_ret = sector_risk.get("annual_stock_ret_pct", nifty50_stock_ret)
        sector_bench_ret = sector_risk.get("annual_bench_ret_pct", nifty50_bench_ret)

        nifty50_alpha_str = f"+{nifty50_alpha:.2f}%" if nifty50_alpha >= 0 else f"{nifty50_alpha:.2f}%"
        sector_alpha_str = f"+{sector_alpha:.2f}%" if sector_alpha >= 0 else f"{sector_alpha:.2f}%"

        matrix_md = (
            f"| Benchmark | Beta (β) | Alpha (α) | Correlation (ρ) | Benchmark Ret |\n"
            f"| :--- | :---: | :---: | :---: | :---: |\n"
            f"| Nifty 50 Index (Broad Market) | {nifty50_beta:.3f} | {nifty50_alpha_str} | {nifty50_corr:.3f} | {nifty50_bench_ret:.2f}% vs {nifty50_stock_ret:.2f}% |\n"
            f"| {sector_bench_name} Index (Suggested) | {sector_beta:.3f} | {sector_alpha_str} | {sector_corr:.3f} | {sector_bench_ret:.2f}% vs {sector_stock_ret:.2f}% |"
        )

        # Market capture ratios
        capture_ratios = profile.get("capture_ratios", {})
        up_capture = capture_ratios.get("up_capture", 100.0)
        down_capture = capture_ratios.get("down_capture", 100.0)
        bench_symbol = capture_ratios.get("benchmark_symbol", "^NSEI")

        # Drawdown metrics
        drawdown_metrics = profile.get("drawdown_metrics", {})
        max_dd = drawdown_metrics.get("max_drawdown_pct", -20.0)
        worst_dd_days = drawdown_metrics.get("worst_drawdown_duration_days", 365)

        # Fibonacci zone analysis
        fib_levels = technicals.get("fib_levels", {})
        fib_zone = get_fibonacci_retracement_zone(current_price, fib_levels)

        # Evaluating high-priority critical warning alerts
        warning_flags = []
        if altman_z_score < 1.81:
            warning_flags.append(f"Insolvency Risk: Altman Z-Score of {altman_z_score:.2f} sits in the Distress Zone.")
        if piotroski_score <= 3:
            warning_flags.append(f"Weak Earnings Quality: Piotroski F-Score is critical at {piotroski_score}/9.")
        shareholding = profile.get("shareholding", {})
        promoter_pledge_pct = float(shareholding.get("Promoter Pledging %", 0.0))
        if promoter_pledge_pct > 25.0:
            warning_flags.append(f"High Promoter Pledge: {promoter_pledge_pct:.1f}% of promoter shares are pledged as collateral.")
        if rsi > 75.0:
            warning_flags.append(f"Overheated Momentum: Daily RSI at {rsi:.1f} indicates near-term overbought exhaustion.")
        if max_dd < -35.0:
            warning_flags.append(f"Historical Drawdown Risk: Stock has registered a severe historical peak-to-trough drawdown of {max_dd:.1f}%.")
        if down_capture > 150.0:
            warning_flags.append(f"Elevated Downside Risk: Downside market capture is exceptionally high at {down_capture:.1f}%.")

        # Peer benchmarking and valuations
        peers = profile.get("peers", [])
        median_peer_pe = 0.0
        median_peer_pb = 0.0
        if len(peers) > 1:
            pe_vals = []
            pb_vals = []
            for p in peers[1:]:
                try:
                    pe_str = str(p.get("P/E", "N/A")).replace(",", "").strip()
                    if pe_str != "N/A" and pe_str != "":
                        pe_vals.append(float(pe_str))
                except ValueError:
                    pass
                try:
                    pb_str = str(p.get("P/B", "N/A")).replace(",", "").strip()
                    if pb_str != "N/A" and pb_str != "":
                        pb_vals.append(float(pb_str))
                except ValueError:
                    pass
            if pe_vals:
                median_peer_pe = float(np.median(pe_vals))
            if pb_vals:
                median_peer_pb = float(np.median(pb_vals))

        target_pe = fundamentals.get("pe_ratio", 0.0)
        valuation_comparison = "N/A"
        if target_pe > 0 and median_peer_pe > 0:
            diff_pe = ((target_pe - median_peer_pe) / median_peer_pe) * 100
            comparison_type = "premium" if diff_pe > 0 else "discount"
            valuation_comparison = f"trades at a **{abs(diff_pe):.1f}% {comparison_type}** to peer group median PE (**{median_peer_pe:.2f}**)"

        target_pb = fundamentals.get("pb_ratio", 0.0)
        try:
            target_pb = float(target_pb)
        except Exception:
            target_pb = 0.0
        pb_comparison = "N/A"
        if target_pb > 0 and median_peer_pb > 0:
            diff_pb = ((target_pb - median_peer_pb) / median_peer_pb) * 100
            pb_comp_type = "premium" if diff_pb > 0 else "discount"
            pb_comparison = f"trades at a **{abs(diff_pb):.1f}% {pb_comp_type}** to peer group median PB (**{median_peer_pb:.2f}**)"

        pe_diff_pct = 0.0
        if target_pe > 0 and median_peer_pe > 0:
            pe_diff_pct = ((target_pe - median_peer_pe) / median_peer_pe) * 100
            
        solvency_status = "Solvency: Safe" if altman_z_score >= 1.81 else "Solvency: Distress"
        valuation_status = "Undervalued" if margin_of_safety >= 15.0 else ("Overvalued" if margin_of_safety < -5.0 else "Fairly Valued")
        technical_status = technicals.get("breakout_status", "Consolidating")
        capm_status = "Defensive Value Creator" if (nifty50_beta < 0.95 and nifty50_alpha > 0) else ("Value Destroyer" if nifty50_alpha < 0 else "Hot Beta Ride")
        
        verdict_action = "TACTICAL BUY" if recommendation == "BUY" else ("STRATEGIC AVOID" if recommendation == "SELL" else "NEUTRAL HOLD")
        
        verdict_matrix_md = (
            f"| Strategic Dimension | Supporting Key Metrics | Programmatic AI Verdict |\n"
            f"| :--- | :--- | :--- |\n"
            f"| **I. Solvency & Quality** | F-Score: **{piotroski_score}/9**, Z-Score: **{altman_z_score:.2f}** | **{solvency_status}** |\n"
            f"| **II. Valuation & Margin** | Intrinsic MOS: **{margin_of_safety:+.1f}%**, PE vs Peers: **{pe_diff_pct:+.1f}%** | **{valuation_status}** |\n"
            f"| **III. Technical Velocity** | RSI: **{rsi:.1f}**, Trend: **{technicals.get('trend_50_vs_200', 'Neutral')}** | **{technical_status}** |\n"
            f"| **IV. CAPM Risk-Reward** | Beta: **{nifty50_beta:.2f}**, Alpha: **{nifty50_alpha_str}** | **{capm_status}** |\n"
            f"| **V. CIO Bottom-Line** | Composite Score: **{final_score}/100** | **{verdict_action}** |"
        )

        system_prompt = (
            "You are the Chief Investment Officer (CIO) of a premier Indian equities advisory firm.\n"
            "Your task is to compile a highly coherent, institutional-grade 360-degree equity research prospectus for the specified stock.\n"
            "You must analyze and synthesize all provided workspace indicators into exactly five distinct sections, each using the exact markdown subheadings provided below:\n"
            "\n"
            "### I. Operational Quality & Solvency Scorecard\n"
            "Synthesize earnings quality metrics, including the Piotroski F-Score, Altman Z-Score, debt-to-equity, current ratios, and operational cash flows (CFO to PAT). Discuss insolvency risk, financial flexibility, and structural safety.\n"
            "\n"
            "### II. Valuation & Peer Benchmarking\n"
            "Analyze the DCF intrinsic value against the current price, the margin of safety, and historical valuation bands. Compare trailing/forward PE and Price-to-Book ratios relative to the peer group and sector medians. Describe any valuation premium or discount.\n"
            "\n"
            "### III. Technical Timing & Fibonacci Zones\n"
            "Detail moving averages (50-day and 200-day SMAs), 14-day RSI momentum, volume patterns, breakout status, and current price positioning relative to Fibonacci retracement levels. You MUST analyze and synthesize the advanced Volatility & Momentum indicators, including the Bollinger Band squeeze width, ATR volatility ratio, Volatility-adjusted 2x ATR stop floor, MACD signal status, and Volume Price Trend (VPT) dynamics.\n"
            "\n"
            "### IV. CAPM Risk Analytics & Market Capture\n"
            "Synthesize the asset's risk profile relative to BOTH the Nifty 50 benchmark index AND its size-specific capitalization index. Compare the systematic Beta (sensitivity), Alpha (excess return), and Pearson Correlation for both indices. Discuss the Upside/Downside Market Capture percentages, and historical drawdown/volatility limits (Max Drawdown % and recovery profile). Make sure to append the EXACT markdown table representing the Polymorphic Benchmark Comparison Matrix at the end of this section (do not omit or alter it).\n"
            "\n"
            "### V. CIO Investment Prospectus & Conviction Summary\n"
            "State your final strategic consensus recommendation (BUY/SELL/HOLD) aligned with the investor's horizon and risk profile. Incorporate the Composite Conviction Score (1-100), define actionable suggested Entry (Buy) and Exit (Sell) Price Ranges, and synthesize key catalysts and risk flags. Finally, you MUST append the exact markdown table of the Strategic Investment Verdict Matrix at the end of this section to summarize all programmatic dimensions and verdicts.\n"
            "\n"
            "Maintain a professional, objective, and analytical tone. Highlight key figures, scores, ratios, and price limits using bold formatting (e.g. **Rs. 1,420**, **78.6%**, **Beta of 1.15**). Do not use bullet points or list items; write in clean, narrative paragraphs under each heading, except for the tables under section IV and V which must be formatted as markdown tables."
        )

        user_prompt = f"""
        Company: {profile.get('company_name', symbol)} ({ticker})
        Investor Profile: Horizon: {horizon} | Risk: {risk}
        
        1. Operational Quality & Solvency Scorecard:
        - Piotroski F-Score: {piotroski_score}/9 ({piotroski_label})
        - Altman Z-Score: {altman_z_score:.2f} ({altman_zone})
        - Debt-to-Equity: {fundamentals.get('debt_to_equity', 'N/A')}
        - Current Ratio: {fundamentals.get('current_ratio', 'N/A')}
        - CFO to PAT Ratio: {fundamentals.get('cfo_to_pat', 'N/A')}
        
        2. Valuation & Sector Peer Benchmarking:
        - Current Price: Rs. {current_price}
        - DCF Intrinsic Value: Rs. {dcf_intrinsic_value:.2f} (Margin of Safety: {margin_of_safety:.1f}%, Status: {dcf.get('valuation_rating', 'N/A')})
        - PE Ratio: {target_pe:.1f} (Peer Group Median PE: {median_peer_pe:.2f}, Comparison: {valuation_comparison})
        - PB Ratio: {target_pb:.2f} (Peer Group Median PB: {median_peer_pb:.2f}, Comparison: {pb_comparison})
        
        3. Technical Timing, Volatility & Momentum:
        - 14-day RSI: {rsi:.1f} ({technicals.get('rsi_status', 'Neutral')})
        - 50-day SMA: Rs. {sma_50} | 200-day SMA: Rs. {sma_200} (Trend: {technicals.get('trend_50_vs_200', 'N/A')})
        - Breakout Status: {technicals.get('breakout_status', 'N/A')} ({technicals.get('breakout_desc', 'N/A')})
        - Fibonacci Levels: {json.dumps(fib_levels)}
        - Current Fibonacci Retracement Zone: {fib_zone}
        - Bollinger Bands: Lower: Rs. {bb_lower:.2f} | Upper: Rs. {bb_upper:.2f} (Squeeze Width: {squeeze_pct:.1f}%)
        - ATR: Rs. {atr:.2f} (Volatility Rating: {vol_level} at {volatility_ratio:.1f}% ratio)
        - Volatility-Adjusted 2x ATR Stop Floor: Rs. {atr_stop_loss:.2f}
        - MACD Value: {macd:.2f} (Signal: {macd_signal:.2f}, Hist: {macd_hist:.2f}, Status: {macd_status})
        - Volume Price Trend (VPT): {vpt:.0f} ({vpt_status})
        
        4. CAPM Risk Analytics & Market Capture:
        - Relative to Nifty 50: Beta: {nifty50_beta:.2f}, Alpha: {nifty50_alpha:.2f}%, Correlation: {nifty50_corr:.2f}
        - Relative to {sector_bench_name} ({sector_bench_symbol}): Beta: {sector_beta:.2f}, Alpha: {sector_alpha:.2f}%, Correlation: {sector_corr:.2f}
        - Market Capture Ratios: Upside Market Capture: {up_capture:.1f}% | Downside Market Capture: {down_capture:.1f}% (relative to {bench_symbol})
        - Max Drawdown: {max_dd:.1f}% (Worst Drawdown Duration: {worst_dd_days} days)
        - Exact Polymorphic Benchmark Comparison Matrix Markdown Table (print this EXACT table at the end of Section IV):
{matrix_md}
        
        5. CIO Investment Prospectus & Conviction:
        - Composite AI Score: {final_score}/100
        - Strategic recommendation: {recommendation}
        - Suggested Buy Range: {profile.get('analysis', {}).get('suggested_buy_price_range', 'N/A')}
        - Suggested Sell Range: {profile.get('analysis', {}).get('suggested_sell_price_range', 'N/A')}
        - Analyst Target Median: Rs. {profile.get('consensus', {}).get('target_median', 'N/A')}
        - Exact Strategic Investment Verdict Matrix Markdown Table (print this EXACT table at the end of Section V):
{verdict_matrix_md}
        """

        synthesis_text = await asyncio.to_thread(call_groq_llm, system_prompt, user_prompt)

        # Failsafe programmatic fallback if LLM is unavailable or errors
        if "ERROR" in synthesis_text or not synthesis_text.strip():
            p1 = (
                f"### I. Operational Quality & Solvency Scorecard\n"
                f"**{profile.get('company_name', symbol)}** shows a Piotroski F-Score of "
                f"**{piotroski_score}/9** ({piotroski_label}) and an Altman Z-Score of **{altman_z_score:.2f}** ({altman_zone}). "
                f"With a Debt-to-Equity ratio of **{fundamentals.get('debt_to_equity', 0.0):.2f}x** and a CFO to PAT ratio of "
                f"**{fundamentals.get('cfo_to_pat', 0.88):.2f}x**, the company exhibits strong financial solvency and robust cash flows from operations."
            )
            p2 = (
                f"### II. Valuation & Peer Benchmarking\n"
                f"Trading at **Rs. {current_price}** relative to a DCF intrinsic value of **Rs. {dcf_intrinsic_value:.2f}**, the stock "
                f"features a **{margin_of_safety:.1f}% margin of safety** ({dcf.get('valuation_rating', 'Fairly Valued')}). "
                f"Compared to its peers, the target's P/E of **{target_pe:.1f}** {valuation_comparison} against the median peer group P/E of **{median_peer_pe:.2f}**."
            )
            p3 = (
                f"### III. Technical Timing & Fibonacci Zones\n"
                f"Technically, the stock is in a **{technicals.get('trend_50_vs_200', 'Neutral')}** trend structure, trading relative to its "
                f"50-day SMA of **Rs. {sma_50}** and 200-day SMA of **Rs. {sma_200}**. Momentum is **{technicals.get('rsi_status', 'Neutral')}** "
                f"with an RSI of **{rsi:.1f}**. Breakout status is currently **{technicals.get('breakout_status', 'CONSOLIDATING')}** ({technicals.get('breakout_desc', '')}). "
                f"The price is positioned **{fib_zone}**.\n\n"
                f"**Volatility & Momentum Metrics:**\n"
                f"- **Bollinger Bands**: Lower: **Rs. {bb_lower:.2f}** | Upper: **Rs. {bb_upper:.2f}** (Squeeze Width: **{squeeze_pct:.1f}%**)\n"
                f"- **Average True Range (ATR)**: **Rs. {atr:.2f}** (Volatility Rating: **{vol_level}** at **{volatility_ratio:.1f}%** ratio)\n"
                f"- **Volatility Stop-Loss Floor (2x ATR)**: **Rs. {atr_stop_loss:.2f}**\n"
                f"- **MACD**: **{macd:.2f}** (Signal: **{macd_signal:.2f}** | Status: **{macd_status}**)\n"
                f"- **Volume Price Trend (VPT)**: **{vpt:.0f}** (**{vpt_status}**)"
            )
            p4 = (
                f"### IV. CAPM Risk Analytics & Market Capture\n"
                f"Under CAPM risk parameters, the stock exhibits a **Beta of {nifty50_beta:.2f}**, an **Alpha of {nifty50_alpha:.2f}%**, and a correlation of **{nifty50_corr:.2f}** relative to the Nifty 50 index. "
                f"Relative to {sector_bench_name}, it reports a **Beta of {sector_beta:.2f}**, an **Alpha of {sector_alpha:.2f}%**, and a correlation of **{sector_corr:.2f}**. "
                f"The systematic pricing sensitivity is supported by an **Upside Capture of {up_capture:.1f}%** and a **Downside Capture of {down_capture:.1f}%**. "
                f"Historically, the asset has a **Maximum Drawdown of {max_dd:.1f}%** with a recovery period of **{worst_dd_days} days**.\n\n"
                f"**Polymorphic Benchmark Comparison Matrix:**\n\n"
                f"{matrix_md}"
            )
            p5 = (
                f"### V. CIO Investment Prospectus & Conviction Summary\n"
                f"Our institutional Composite AI Score is **{final_score}/100** with a recommended action of **{recommendation}** "
                f"for a **{horizon}** horizon. Actionable entry ranges are identified at **{profile.get('analysis', {}).get('suggested_buy_price_range', 'Rs. ' + str(round(current_price * 0.95)) + ' - Rs. ' + str(round(current_price * 1.02)))}**, "
                f"targeting an exit range of **{profile.get('analysis', {}).get('suggested_sell_price_range', 'Rs. ' + str(round(current_price * 1.15)) + ' - Rs. ' + str(round(current_price * 1.25)))}**.\n\n"
                f"**Strategic Investment Verdict Matrix:**\n\n"
                f"{verdict_matrix_md}"
            )
            synthesis_text = f"{p1}\n\n{p2}\n\n{p3}\n\n{p4}\n\n{p5}"

        return {
            "synthesis_text": synthesis_text,
            "final_score": final_score,
            "recommendation": recommendation,
            "dcf_intrinsic_value": dcf_intrinsic_value,
            "current_price": current_price,
            "margin_of_safety": margin_of_safety,
            "altman_z_score": altman_z_score,
            "altman_zone": altman_zone,
            "piotroski_score": piotroski_score,
            "piotroski_label": piotroski_label,
            "rsi": rsi,
            "sma_50": sma_50,
            "sma_200": sma_200,
            "capm_risk_nifty50": nifty50_risk,
            "capm_risk_sector": sector_risk,
            "risk_warning_flags": warning_flags
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI Synthesis compilation failed: {str(e)}")

@app.post("/api/chat")
async def advisory_chat(request: ChatRequest):
    """Stateful context-retained advisory chat console."""
    try:
        history_list = [{"role": msg.role, "content": msg.content} for msg in request.history]
        response_text = await asyncio.to_thread(
            run_conversational_chat,
            history_list, 
            request.message, 
            request.profile
        )
        return {"response": response_text}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Chat session failed: {str(e)}")

# ==================== ALERTS (Persistent SQLite) ====================

@app.post("/api/alerts/set")
async def set_alert(data: AlertRequest):
    """Configures a custom alert trigger, persisted to SQLite."""
    try:
        alert_id = str(uuid.uuid4())[:8]
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO alerts (id, ticker, condition_type, operator, value) VALUES (?, ?, ?, ?, ?)",
                (alert_id, data.ticker.upper(), data.condition_type.upper(), data.operator, data.value)
            )
            conn.commit()
        return {
            "id": alert_id,
            "ticker": data.ticker.upper(),
            "condition_type": data.condition_type.upper(),
            "operator": data.operator,
            "value": data.value,
            "status": "Active",
            "triggered": False,
            "trigger_date": ""
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to set alert: {str(e)}")

@app.get("/api/alerts/list")
async def list_alerts():
    """Returns all alerts from SQLite."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, ticker, condition_type, operator, value, status, triggered, trigger_date FROM alerts")
        rows = cursor.fetchall()
        return [
            {
                "id": row["id"],
                "ticker": row["ticker"],
                "condition_type": row["condition_type"],
                "operator": row["operator"],
                "value": row["value"],
                "status": row["status"],
                "triggered": bool(row["triggered"]),
                "trigger_date": row["trigger_date"]
            }
            for row in rows
        ]

@app.delete("/api/alerts/{alert_id}")
async def delete_alert(alert_id: str):
    """Deletes a single alert by ID."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM alerts WHERE id = ?", (alert_id,))
        conn.commit()
    return {"status": "success"}

@app.get("/api/alerts/check")
async def check_alerts():
    """Background-triggered active alert scanning sweep."""
    triggers = []
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, ticker, condition_type, operator, value, triggered FROM alerts WHERE triggered = 0")
        active_alerts = [dict(row) for row in cursor.fetchall()]
    
    for alert in active_alerts:
        try:
            ticker = alert["ticker"]
            t = await asyncio.to_thread(get_complete_financial_profile, ticker)
            triggered = False
            cur_val = ""
            
            if alert["condition_type"] == "RSI":
                rsi_val = t["technicals"]["rsi"]
                cur_val = f"RSI: {rsi_val:.1f}"
                if alert["operator"] == "<" and rsi_val < float(alert["value"]):
                    triggered = True
                elif alert["operator"] == ">" and rsi_val > float(alert["value"]):
                    triggered = True
                    
            elif alert["condition_type"] == "PE":
                pe_val = t["fundamentals"]["pe_ratio"]
                cur_val = f"PE: {pe_val}"
                val_to_compare = alert["value"]
                if val_to_compare.upper() == "MEDIAN":
                    compare_num = t["pe_bands"]["median_pe"]
                else:
                    compare_num = float(val_to_compare)
                    
                if alert["operator"] == "<" and pe_val < compare_num:
                    triggered = True
                elif alert["operator"] == ">" and pe_val > compare_num:
                    triggered = True
                    
            elif alert["condition_type"] == "RATING":
                rating_val = t["analysis"]["recommendation"].upper() if "analysis" in t else "HOLD"
                cur_val = f"Rating: {rating_val}"
                if alert["operator"] == "==" and rating_val == alert["value"].upper():
                    triggered = True
                    
            elif alert["condition_type"] == "PRICE":
                price_val = t["fundamentals"]["current_price"]
                cur_val = f"Price: Rs. {price_val:.2f}"
                if alert["operator"] == "<" and price_val < float(alert["value"]):
                    triggered = True
                elif alert["operator"] == ">" and price_val > float(alert["value"]):
                    triggered = True
                    
            elif alert["condition_type"] == "SMA":
                price_val = t["fundamentals"]["current_price"]
                sma_200 = t["technicals"]["sma_200"]
                cur_val = f"Price: Rs. {price_val:.2f} vs SMA200: Rs. {sma_200:.2f}"
                if alert["operator"] == ">" and price_val > sma_200:
                    triggered = True
                elif alert["operator"] == "<" and price_val < sma_200:
                    triggered = True
                    
            if triggered:
                trigger_date = datetime.now().strftime("%Y-%m-%d %H:%M")
                with get_db() as conn:
                    cursor = conn.cursor()
                    cursor.execute(
                        "UPDATE alerts SET triggered = 1, status = 'Triggered', trigger_date = ? WHERE id = ?",
                        (trigger_date, alert["id"])
                    )
                    conn.commit()
                triggers.append(f"ALERT TRIGGERED: {alert['ticker']} reached {cur_val} (Target: {alert['operator']} {alert['value']})")
                
        except Exception as e:
            print(f"Error checking alert #{alert['id']}: {e}")
    
    # Re-fetch all alerts after updates
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, ticker, condition_type, operator, value, status, triggered, trigger_date FROM alerts")
        all_alerts = [
            {
                "id": row["id"],
                "ticker": row["ticker"],
                "condition_type": row["condition_type"],
                "operator": row["operator"],
                "value": row["value"],
                "status": row["status"],
                "triggered": bool(row["triggered"]),
                "trigger_date": row["trigger_date"]
            }
            for row in cursor.fetchall()
        ]
            
    return {"status": "success", "triggers": triggers, "alerts": all_alerts}

# ==================== WATCHLISTS ====================

@app.get("/api/watchlists")
async def get_watchlists():
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, name FROM watchlists")
        watchlists = [dict(row) for row in cursor.fetchall()]
        
        for w in watchlists:
            cursor.execute("SELECT symbol, name, sector, quantity, purchase_price, in_portfolio FROM watchlist_items WHERE watchlist_id = ?", (w["id"],))
            w["items"] = [dict(row) for row in cursor.fetchall()]
        
    return watchlists

@app.post("/api/watchlists")
async def create_watchlist(data: WatchlistCreate):
    name = data.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Watchlist name cannot be empty.")
    
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Check max limit of 10 watchlists
        cursor.execute("SELECT COUNT(*) as cnt FROM watchlists")
        if cursor.fetchone()["cnt"] >= 10:
            raise HTTPException(status_code=400, detail="Maximum limit of 10 watchlists reached.")
            
        try:
            cursor.execute("INSERT INTO watchlists (name) VALUES (?)", (name,))
            watchlist_id = cursor.lastrowid
            conn.commit()
            return {"id": watchlist_id, "name": name, "items": []}
        except sqlite3.IntegrityError:
            raise HTTPException(status_code=400, detail="Watchlist with this name already exists.")

@app.put("/api/watchlists/{watchlist_id}")
async def rename_watchlist(watchlist_id: int, data: WatchlistRename):
    """Rename an existing watchlist."""
    name = data.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Watchlist name cannot be empty.")
    with get_db() as conn:
        cursor = conn.cursor()
        try:
            cursor.execute("UPDATE watchlists SET name = ? WHERE id = ?", (name, watchlist_id))
            conn.commit()
            return {"id": watchlist_id, "name": name}
        except sqlite3.IntegrityError:
            raise HTTPException(status_code=400, detail="Watchlist with this name already exists.")

@app.delete("/api/watchlists/{watchlist_id}")
async def delete_watchlist(watchlist_id: int):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM watchlist_items WHERE watchlist_id = ?", (watchlist_id,))
        cursor.execute("DELETE FROM watchlists WHERE id = ?", (watchlist_id,))
        conn.commit()
    return {"status": "success"}

@app.post("/api/watchlists/{watchlist_id}/items")
async def add_watchlist_item(watchlist_id: int, data: WatchlistItemCreate):
    symbol = data.symbol.strip().upper()
    if not symbol:
        raise HTTPException(status_code=400, detail="Stock symbol is required.")
        
    with get_db() as conn:
        cursor = conn.cursor()
        
        # Check if watchlist exists
        cursor.execute("SELECT id FROM watchlists WHERE id = ?", (watchlist_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Watchlist not found.")
            
        # Check max limit of 100 stocks
        cursor.execute("SELECT COUNT(*) as cnt FROM watchlist_items WHERE watchlist_id = ?", (watchlist_id,))
        if cursor.fetchone()["cnt"] >= 100:
            raise HTTPException(status_code=400, detail="Maximum limit of 100 stocks per watchlist reached.")
            
        # Resolve name and sector using financial profile search
        company_name = symbol
        sector = "General Equities"
        try:
            resolved = await asyncio.to_thread(get_complete_financial_profile, symbol)
            company_name = resolved.get("company_name") or symbol
            sector = resolved.get("sector") or "General Equities"
        except Exception:
            pass
            
        try:
            cursor.execute(
                "INSERT INTO watchlist_items (watchlist_id, symbol, name, sector, quantity, purchase_price, in_portfolio) VALUES (?, ?, ?, ?, ?, ?, ?)",
                (watchlist_id, symbol, company_name, sector, data.quantity or 0.0, data.purchase_price or 0.0, data.in_portfolio or 0)
            )
            conn.commit()
            return {"symbol": symbol, "name": company_name, "sector": sector, "quantity": data.quantity or 0.0, "purchase_price": data.purchase_price or 0.0, "in_portfolio": data.in_portfolio or 0}
        except sqlite3.IntegrityError:
            raise HTTPException(status_code=400, detail="Stock already exists in this watchlist.")

@app.get("/api/watchlists/{watchlist_id}")
async def get_single_watchlist(watchlist_id: int):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, name FROM watchlists WHERE id = ?", (watchlist_id,))
        watchlist = cursor.fetchone()
        if not watchlist:
            raise HTTPException(status_code=404, detail="Watchlist not found.")
            
        w_dict = dict(watchlist)
        cursor.execute("SELECT symbol, name, sector, quantity, purchase_price, in_portfolio FROM watchlist_items WHERE watchlist_id = ?", (watchlist_id,))
        w_dict["items"] = [dict(row) for row in cursor.fetchall()]
        
    return w_dict

@app.put("/api/watchlists/{watchlist_id}/items/{symbol}")
async def update_watchlist_item_holdings(watchlist_id: int, symbol: str, data: WatchlistItemUpdate):
    symbol = symbol.strip().upper()
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id FROM watchlists WHERE id = ?", (watchlist_id,))
        if not cursor.fetchone():
            raise HTTPException(status_code=404, detail="Watchlist not found.")
            
        updates = []
        params = []
        if data.quantity is not None:
            updates.append("quantity = ?")
            params.append(data.quantity)
        if data.purchase_price is not None:
            updates.append("purchase_price = ?")
            params.append(data.purchase_price)
        if data.in_portfolio is not None:
            updates.append("in_portfolio = ?")
            params.append(data.in_portfolio)
            
        if not updates:
            raise HTTPException(status_code=400, detail="No fields to update.")
            
        query = f"UPDATE watchlist_items SET {', '.join(updates)} WHERE watchlist_id = ? AND UPPER(symbol) = ?"
        params.extend([watchlist_id, symbol])
        
        cursor.execute(query, params)
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Stock not found in this watchlist.")
        conn.commit()
    return {"status": "success"}

@app.delete("/api/watchlists/{watchlist_id}/items/{symbol}")
async def remove_watchlist_item(watchlist_id: int, symbol: str):
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "DELETE FROM watchlist_items WHERE watchlist_id = ? AND symbol = ?",
            (watchlist_id, symbol.strip().upper())
        )
        conn.commit()
    return {"status": "success"}

@app.get("/api/watchlists/{watchlist_id}/analyze")
async def analyze_watchlist(watchlist_id: int):
    """Batch-analyzes every stock in a watchlist and returns scored rankings."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT symbol, name, sector FROM watchlist_items WHERE watchlist_id = ?", (watchlist_id,))
        items = [dict(row) for row in cursor.fetchall()]
    
    if not items:
        return {"results": [], "message": "Watchlist is empty."}
    
    results = []
    for item in items:
        try:
            profile = await asyncio.to_thread(get_complete_financial_profile, item["symbol"])
            sm = profile.get("score_metrics", {})
            f = profile.get("fundamentals", {})
            results.append({
                "symbol": item["symbol"],
                "name": profile.get("company_name", item["name"]),
                "sector": profile.get("sector", item["sector"]),
                "current_price": float(f.get("current_price", 0)),
                "pe": float(f.get("pe_ratio", 0)),
                "roe": float(f.get("roe_pct", 0)),
                "score": int(sm.get("final_score", 50)),
                "action": sm.get("action", "HOLD"),
                "margin_of_safety": float(profile.get("dcf_model", {}).get("margin_of_safety", 0)),
                "rsi": float(profile.get("technicals", {}).get("rsi", 50)),
                "trend": profile.get("technicals", {}).get("trend_50_vs_200", "Neutral")
            })
        except Exception as e:
            print(f"Error analyzing watchlist item {item['symbol']}: {e}")
            results.append({
                "symbol": item["symbol"],
                "name": item["name"],
                "sector": item["sector"],
                "current_price": 0,
                "pe": 0,
                "roe": 0,
                "score": 0,
                "action": "ERROR",
                "margin_of_safety": 0,
                "rsi": 0,
                "trend": "N/A"
            })
    
    results = sorted(results, key=lambda x: x["score"], reverse=True)
    return {"results": results}

class PortfolioItemInput(BaseModel):
    symbol: str
    quantity: float
    buy_price: float
    purchase_date: Optional[str] = "2026-06-05"

class PortfolioDoctorInput(BaseModel):
    items: List[PortfolioItemInput]

@app.get("/api/returns")
async def get_returns(
    symbol: str,
    amount: float = 100000.0,
    date_y: str = "2021-01-01",
    type: str = "cagr",
    sip_monthly: float = 5000.0
):
    try:
        resolution = resolve_company_ticker(symbol)
        yf_ticker = resolution["yf_ticker"]
        stock = yf.Ticker(yf_ticker)
        
        # Fetch daily history from date_y
        hist = stock.history(start=date_y)
        if hist.empty:
            raise HTTPException(status_code=400, detail="No historical price data found for this period.")
            
        start_date = hist.index[0]
        end_date = hist.index[-1]
        years = (end_date - start_date).days / 365.25
        if years <= 0:
            years = 0.01
            
        start_price = float(hist["Close"].iloc[0])
        end_price = float(hist["Close"].iloc[-1])
        
        if type == "cagr":
            initial_investment = amount
            final_shares = initial_investment / start_price
            final_value = final_shares * end_price
            total_profit = final_value - initial_investment
            absolute_return = (total_profit / initial_investment) * 100.0
            cagr = (((final_value / initial_investment) ** (1 / years)) - 1) * 100.0
            
            return {
                "symbol": symbol,
                "company_name": resolution["name"] or symbol,
                "type": "CAGR",
                "start_date": start_date.strftime("%Y-%m-%d"),
                "end_date": end_date.strftime("%Y-%m-%d"),
                "start_price": round(start_price, 2),
                "end_price": round(end_price, 2),
                "invested_amount": round(initial_investment, 2),
                "final_value": round(final_value, 2),
                "profit_loss": round(total_profit, 2),
                "absolute_return_pct": round(absolute_return, 2),
                "annualized_return_pct": round(cagr, 2),
                "years_elapsed": round(years, 2)
            }
        else:
            # SIP calculation
            # For SIP, we invest sip_monthly on the first trading day of each month
            # We group by year and month
            hist["Year"] = hist.index.year
            hist["Month"] = hist.index.month
            
            # Find first available trading day of each month
            first_days = hist.groupby(["Year", "Month"]).first()
            
            total_invested = 0.0
            total_shares = 0.0
            investments = []
            
            for idx, row in first_days.iterrows():
                close_pr = float(row["Close"])
                shares_bought = sip_monthly / close_pr
                total_shares += shares_bought
                total_invested += sip_monthly
                
                # Find the index date
                matching_rows = hist[(hist.index.year == idx[0]) & (hist.index.month == idx[1])]
                date_str = matching_rows.index[0].strftime("%Y-%m-%d")
                
                investments.append({
                    "date": date_str,
                    "amount": sip_monthly,
                    "price": round(close_pr, 2),
                    "shares_bought": round(shares_bought, 4)
                })
                
            final_value = total_shares * end_price
            total_profit = final_value - total_invested
            absolute_return = (total_profit / total_invested) * 100.0 if total_invested > 0 else 0.0
            
            # Approximate annualized return for SIP (IRR)
            irr = 0.0
            if total_invested > 0:
                # Cashflows are [-sip, -sip, ..., +final_value]
                cashflows = [-sip_monthly] * len(investments)
                cashflows[-1] += final_value
                
                # Bisection solver
                low = -0.99
                high = 5.0
                for _ in range(50):
                    mid = (low + high) / 2
                    npv = 0.0
                    for t, cf in enumerate(cashflows):
                        factor = max(1e-6, 1 + mid)
                        npv += cf / (factor ** t)
                    if npv > 0:
                        low = mid
                    else:
                        high = mid
                
                monthly_irr = (low + high) / 2
                irr = (((1 + monthly_irr) ** 12) - 1) * 100.0
                
            return {
                "symbol": symbol,
                "company_name": resolution["name"] or symbol,
                "type": "SIP",
                "start_date": start_date.strftime("%Y-%m-%d"),
                "end_date": end_date.strftime("%Y-%m-%d"),
                "monthly_sip": sip_monthly,
                "invested_amount": round(total_invested, 2),
                "final_value": round(final_value, 2),
                "profit_loss": round(total_profit, 2),
                "absolute_return_pct": round(absolute_return, 2),
                "annualized_return_pct": round(irr, 2),
                "years_elapsed": round(years, 2),
                "investments_breakdown": investments
            }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Return Calculator Error: {str(e)}")

@app.get("/api/drawdown")
async def get_drawdown(symbol: str, period: str = "5y"):
    try:
        resolution = resolve_company_ticker(symbol)
        yf_ticker = resolution["yf_ticker"]
        stock = yf.Ticker(yf_ticker)
        
        hist = stock.history(period=period)
        if hist.empty:
            raise HTTPException(status_code=400, detail="No historical price data found for drawdown analysis.")
            
        prices = hist["Close"].tolist()
        dates = [d.strftime("%Y-%m-%d") for d in hist.index]
        
        peaks = []
        drawdowns = []
        max_dd = 0.0
        max_dd_date = ""
        current_peak = 0.0
        
        for d, p in zip(dates, prices):
            if p > current_peak:
                current_peak = p
            dd = ((p - current_peak) / current_peak * 100.0) if current_peak > 0 else 0.0
            peaks.append(current_peak)
            drawdowns.append(dd)
            
            if dd < max_dd:
                max_dd = dd
                max_dd_date = d
                
        # Find drawdown recovery periods
        in_drawdown = False
        dd_start = None
        max_duration = 0
        current_duration = 0
        
        for d_str, dd in zip(dates, drawdowns):
            if dd < -0.5:
                if not in_drawdown:
                    in_drawdown = True
                    dd_start = datetime.strptime(d_str, "%Y-%m-%d")
                current_duration = (datetime.strptime(d_str, "%Y-%m-%d") - dd_start).days
                if current_duration > max_duration:
                    max_duration = current_duration
            else:
                in_drawdown = False
                current_duration = 0
                
        return {
            "symbol": symbol,
            "company_name": resolution["name"] or symbol,
            "period": period,
            "max_drawdown_pct": round(max_dd, 2),
            "max_drawdown_date": max_dd_date,
            "current_drawdown_pct": round(drawdowns[-1], 2),
            "worst_drawdown_duration_days": max_duration,
            "chart_data": {
                "dates": dates,
                "prices": [round(p, 2) for p in prices],
                "peaks": [round(pk, 2) for pk in peaks],
                "drawdowns": [round(dd, 2) for dd in drawdowns]
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Drawdown Analysis Error: {str(e)}")

@app.get("/api/relative-strength")
async def get_relative_strength(symbol: str, period: str = "1y"):
    try:
        resolution = resolve_company_ticker(symbol)
        yf_ticker = resolution["yf_ticker"]
        
        stock = yf.Ticker(yf_ticker)
        nifty = yf.Ticker("^NSEI")
        
        stock_hist = stock.history(period=period)
        nifty_hist = nifty.history(period=period)
        
        if stock_hist.empty or nifty_hist.empty:
            raise HTTPException(status_code=400, detail="Insufficient historical price data for relative strength.")
            
        combined = pd.DataFrame({
            "stock": stock_hist["Close"],
            "nifty": nifty_hist["Close"]
        }).dropna()
        
        if combined.empty:
            raise HTTPException(status_code=400, detail="Aligned date indices are empty.")
            
        dates = [d.strftime("%Y-%m-%d") for d in combined.index]
        
        stock_norm = (combined["stock"] / combined["stock"].iloc[0]) * 100.0
        nifty_norm = (combined["nifty"] / combined["nifty"].iloc[0]) * 100.0
        
        ratio = combined["stock"] / combined["nifty"]
        ratio_norm = (ratio / ratio.iloc[0]) * 100.0
        
        ratio_ma = ratio_norm.rolling(window=20).mean().fillna(100.0)
        
        stock_perf = ((combined["stock"].iloc[-1] - combined["stock"].iloc[0]) / combined["stock"].iloc[0]) * 100.0
        nifty_perf = ((combined["nifty"].iloc[-1] - combined["nifty"].iloc[0]) / combined["nifty"].iloc[0]) * 100.0
        outperformance = stock_perf - nifty_perf
        
        return {
            "symbol": symbol,
            "company_name": resolution["name"] or symbol,
            "period": period,
            "stock_performance_pct": round(stock_perf, 2),
            "nifty_performance_pct": round(nifty_perf, 2),
            "outperformance_pct": round(outperformance, 2),
            "chart_data": {
                "dates": dates,
                "stock_normalized": [round(v, 2) for v in stock_norm],
                "nifty_normalized": [round(v, 2) for v in nifty_norm],
                "ratio_normalized": [round(v, 2) for v in ratio_norm],
                "ratio_ma_20": [round(v, 2) for v in ratio_ma]
            }
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Relative Strength Error: {str(e)}")

# ==================== STANDALONE AI PORTFOLIO DOCTOR ====================

@app.get("/api/portfolio")
async def get_portfolio(refresh: bool = False):
    import json
    
    # 1. Handle price refreshing if requested
    if refresh:
        try:
            with get_db() as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT id, symbol, name, sector, quantity, purchase_price, purchase_date, transaction_type FROM portfolio_items")
                all_txs = [dict(row) for row in cursor.fetchall()]
                active_txs = compute_active_holdings(all_txs)
                symbols = list(set(row["symbol"] for row in active_txs))
            if symbols:
                tasks = [asyncio.to_thread(get_complete_financial_profile, sym, True) for sym in symbols]
                await asyncio.gather(*tasks)
        except Exception as ref_err:
            print(f"Error refreshing portfolio prices: {ref_err}")

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, symbol, name, sector, quantity, purchase_price, purchase_date, transaction_type FROM portfolio_items")
        all_txs = [dict(row) for row in cursor.fetchall()]
        
        # Calculate active holdings dynamically via FIFO netting
        rows = compute_active_holdings(all_txs)
        
        # Hydrate target ranges and current price from cached_profiles if available
        hydrated_rows = []
        for row in rows:
            sym = row["symbol"]
            cursor.execute("SELECT profile_json FROM cached_profiles WHERE symbol = ?", (sym,))
            cache_row = cursor.fetchone()
            
            # Default values
            row["has_analysis"] = False
            row["suggested_buy_price_range"] = "N/A"
            row["suggested_sell_price_range"] = "N/A"
            row["target_12m"] = None
            row["stop_loss_12m"] = None
            row["current_price"] = None
            row["day_change_pct"] = None
            row["score"] = 50
            
            if cache_row:
                try:
                    profile = json.loads(cache_row["profile_json"])
                    analysis = profile.get("analysis", {})
                    row["has_analysis"] = True
                    row["suggested_buy_price_range"] = analysis.get("suggested_buy_price_range", "N/A")
                    row["suggested_sell_price_range"] = analysis.get("suggested_sell_price_range", "N/A")
                    row["target_12m"] = analysis.get("target_12m")
                    row["stop_loss_12m"] = analysis.get("stop_loss_12m")
                    row["current_price"] = profile.get("fundamentals", {}).get("current_price")
                    row["day_change_pct"] = profile.get("technicals", {}).get("price_change_pct")
                    row["score"] = profile.get("score_metrics", {}).get("final_score", 50)
                except Exception as e:
                    print(f"Error parsing cached profile for {sym}: {e}")
            
            hydrated_rows.append(row)
        return hydrated_rows

@app.get("/api/portfolio/transactions")
async def get_portfolio_transactions():
    """Returns the complete list of raw buy and sell transactions stored in the database."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, symbol, name, sector, quantity, purchase_price, purchase_date, transaction_type FROM portfolio_items ORDER BY id DESC")
        return [dict(row) for row in cursor.fetchall()]

@app.post("/api/portfolio")
async def add_portfolio_item(data: PortfolioItemCreate):
    symbol = data.symbol.strip().upper()
    if not symbol:
        raise HTTPException(status_code=400, detail="Stock symbol is required.")
        
    # Resolve symbol and fetch company details online
    try:
        resolved = resolve_company_ticker(symbol)
        full_ticker = resolved.get("yf_ticker") or f"{symbol}.NS"
        base_symbol = resolved.get("base_symbol") or symbol
    except Exception:
        full_ticker = f"{symbol}.NS"
        base_symbol = symbol
        
    company_name = resolved.get("name") or base_symbol
    sector = "General Equities"
    
    # Fetch detailed profile online/cache to resolve sector and longname
    try:
        # Run the CIO parent agent to get complete multi-agent audit & warm cached_profiles
        profile = await run_cio_parent_agent(full_ticker, "Long-term (3+ years)", "Moderate")
        company_name = profile.get("company_name") or company_name
        sector = profile.get("sector") or sector
        
        # Save to cached_profiles persistent SQLite cache
        try:
            with get_db() as conn:
                conn.execute(
                    "INSERT OR REPLACE INTO cached_profiles (symbol, profile_json, updated_at) VALUES (?, ?, ?)",
                    (full_ticker, json.dumps(profile), datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
                )
                conn.commit()
        except Exception as db_err:
            print(f"Error caching added portfolio item profile: {db_err}")
    except Exception as e:
        print(f"Orchestration warning on add_portfolio_item (falling back to yfinance scrape): {e}")
        try:
            profile = await asyncio.to_thread(get_complete_financial_profile, full_ticker)
            company_name = profile.get("company_name") or company_name
            sector = profile.get("sector") or sector
        except Exception:
            pass
        
    p_date = data.purchase_date or "2026-06-05"
    t_type = (data.transaction_type or "buy").strip().lower()
    try:
        datetime.strptime(p_date, "%Y-%m-%d")
    except ValueError:
        raise HTTPException(status_code=400, detail="Purchase date must be in YYYY-MM-DD format.")
        
    if p_date > "2026-06-05":
        raise HTTPException(status_code=400, detail="Purchase date cannot be in the future.")

    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO portfolio_items (symbol, name, sector, quantity, purchase_price, purchase_date, transaction_type) VALUES (?, ?, ?, ?, ?, ?, ?)",
            (full_ticker, company_name, sector, data.quantity or 10.0, data.purchase_price or 100.0, p_date, t_type)
        )
        inserted_id = cursor.lastrowid
        conn.commit()
        return {
            "id": inserted_id,
            "symbol": full_ticker,
            "name": company_name,
            "sector": sector,
            "quantity": data.quantity or 10.0,
            "purchase_price": data.purchase_price or 100.0,
            "purchase_date": p_date,
            "transaction_type": t_type
        }

@app.put("/api/portfolio/{item_id_or_symbol}")
async def update_portfolio_item(item_id_or_symbol: str, data: PortfolioItemUpdate):
    is_id = item_id_or_symbol.isdigit()
    with get_db() as conn:
        cursor = conn.cursor()
        updates = []
        params = []
        if data.quantity is not None:
            updates.append("quantity = ?")
            params.append(data.quantity)
        if data.purchase_price is not None:
            updates.append("purchase_price = ?")
            params.append(data.purchase_price)
        if data.purchase_date is not None:
            try:
                datetime.strptime(data.purchase_date, "%Y-%m-%d")
            except ValueError:
                raise HTTPException(status_code=400, detail="Purchase date must be in YYYY-MM-DD format.")
            if data.purchase_date > "2026-06-05":
                raise HTTPException(status_code=400, detail="Purchase date cannot be in the future.")
            updates.append("purchase_date = ?")
            params.append(data.purchase_date)
        if data.transaction_type is not None:
            updates.append("transaction_type = ?")
            params.append(data.transaction_type.strip().lower())
            
        if not updates:
            raise HTTPException(status_code=400, detail="No fields to update.")
            
        if is_id:
            query = f"UPDATE portfolio_items SET {', '.join(updates)} WHERE id = ?"
            params.append(int(item_id_or_symbol))
        else:
            query = f"UPDATE portfolio_items SET {', '.join(updates)} WHERE UPPER(symbol) = ?"
            params.append(item_id_or_symbol.upper())
            
        cursor.execute(query, params)
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Stock tranche not found in portfolio.")
        conn.commit()
    return {"status": "success"}

@app.delete("/api/portfolio/{item_id_or_symbol}")
async def delete_portfolio_item(item_id_or_symbol: str):
    is_id = item_id_or_symbol.isdigit()
    with get_db() as conn:
        cursor = conn.cursor()
        if is_id:
            cursor.execute("DELETE FROM portfolio_items WHERE id = ?", (int(item_id_or_symbol),))
        else:
            cursor.execute("DELETE FROM portfolio_items WHERE UPPER(symbol) = ?", (item_id_or_symbol.upper(),))
            
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Stock tranche not found in portfolio.")
        conn.commit()
    return {"status": "success"}

@app.get("/api/portfolio/watchlist-stocks")
async def get_portfolio_watchlist_stocks():
    """Returns all unique stocks from all watchlists that are not in the portfolio."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, symbol, name, sector, quantity, purchase_price, purchase_date, transaction_type FROM portfolio_items")
        all_txs = [dict(row) for row in cursor.fetchall()]
        active_holdings = compute_active_holdings(all_txs)
        active_symbols = set(item["symbol"].upper() for item in active_holdings)
        
        cursor.execute("SELECT DISTINCT symbol, name, sector FROM watchlist_items")
        wl_items = [dict(row) for row in cursor.fetchall()]
        
        filtered = [item for item in wl_items if item["symbol"].upper() not in active_symbols]
        return filtered

@app.post("/api/portfolio/upload")
async def upload_portfolio_file(file: UploadFile = File(...)):
    import pandas as pd
    import io
    import json
    
    contents = await file.read()
    filename = file.filename.lower()
    
    try:
        if filename.endswith('.csv'):
            df = pd.read_csv(io.BytesIO(contents))
        elif filename.endswith(('.xls', '.xlsx')):
            df = pd.read_excel(io.BytesIO(contents))
        else:
            raise HTTPException(status_code=400, detail="Unsupported file format. Please upload an Excel (.xlsx/.xls) or CSV file.")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to parse spreadsheet file: {str(e)}")
        
    df.columns = [str(c).strip().lower() for c in df.columns]
    
    symbol_aliases = ['symbol', 'ticker', 'stock', 'isin', 'instrument', 'code', 'stock symbol', 'instrument name', 'token']
    qty_aliases = ['quantity', 'qty', 'volume', 'shares', 'units', 'available qty', 'holding qty', 'qty.', 'balance']
    price_aliases = ['average cost', 'avg price', 'buy price', 'purchase price', 'price', 'cost', 'avg. price', 'avg_cost', 'cost price', 'acquisition price']
    date_aliases = ['date', 'purchase date', 'buy date', 'trade date', 'acquired date', 'purchase_date', 'buy_date', 'order_execution_time', 'order execution time']
    type_aliases = ['trade_type', 'trade type', 'type', 'action', 'transaction_type', 'transaction type', 'buy/sell', 'buy or sell']
    
    symbol_col = None
    qty_col = None
    price_col = None
    date_col = None
    type_col = None
    
    for c in df.columns:
        if c in symbol_aliases:
            symbol_col = c
        elif c in qty_aliases:
            qty_col = c
        elif c in price_aliases:
            price_col = c
        elif c in date_aliases:
            date_col = c
        elif c in type_aliases:
            type_col = c
            
    if not symbol_col:
        for c in df.columns:
            sample = df[c].dropna().head(3).tolist()
            if sample and all(isinstance(x, str) and (x.isupper() or x.endswith('.NS') or len(x) <= 10) for x in sample):
                symbol_col = c
                break
                
    if not symbol_col or not qty_col or not price_col:
        found_cols = ", ".join(df.columns)
        raise HTTPException(status_code=400, detail=f"Could not map columns. Required: Symbol, Quantity, and Buy Price. Found columns: [{found_cols}]. Please align your spreadsheet columns.")
        
    imported_count = 0
    errors = []
    today_str = "2026-06-05"
    
    trades = []
    for idx, row in df.iterrows():
        try:
            raw_sym = str(row[symbol_col]).strip()
            if not raw_sym or raw_sym.lower() in ['nan', 'null']:
                continue
            raw_sym = raw_sym.upper()
            
            # Resolve symbol
            try:
                resolved = resolve_company_ticker(raw_sym)
                full_ticker = resolved.get("yf_ticker") or f"{raw_sym}.NS"
            except Exception:
                full_ticker = f"{raw_sym}.NS"
            
            # Quantity
            qty_val = row[qty_col]
            if pd.isna(qty_val):
                continue
            qty = float(qty_val)
            if qty <= 0:
                continue
                
            # Price
            price_val = row[price_col]
            if pd.isna(price_val):
                continue
            price = float(price_val)
            if price < 0:
                continue
                
            # Date
            p_date = today_str
            dt_for_sorting = pd.to_datetime(today_str)
            if date_col and not pd.isna(row[date_col]):
                raw_date = str(row[date_col]).strip()
                try:
                    parsed_dt = pd.to_datetime(raw_date)
                    p_date = parsed_dt.strftime('%Y-%m-%d')
                    dt_for_sorting = parsed_dt
                except Exception:
                    pass
            
            # Type (buy/sell)
            t_type = 'buy'
            if type_col and not pd.isna(row[type_col]):
                raw_type = str(row[type_col]).strip().lower()
                if 'sell' in raw_type or 'short' in raw_type:
                    t_type = 'sell'
                    
            trades.append({
                "symbol": full_ticker,
                "quantity": qty,
                "price": price,
                "date": p_date,
                "dt": dt_for_sorting,
                "type": t_type,
                "row_idx": idx + 2
            })
        except Exception as row_err:
            errors.append(f"Row {idx+2}: {str(row_err)}")
            
    # Sort all trades chronologically
    trades.sort(key=lambda x: x["dt"])
    
    # Insert all parsed buy and sell transactions into the SQLite database, clearing it first
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM portfolio_items")
        
        for trade in trades:
            try:
                full_ticker = trade["symbol"]
                qty = trade["quantity"]
                price = trade["price"]
                p_date = trade["date"]
                t_type = trade["type"]
                
                # Resolve base symbol
                base_symbol = full_ticker.split('.')[0] if '.' in full_ticker else full_ticker
                company_name = base_symbol
                sector = "General Equities"
                
                # Try cached_profiles first
                cursor.execute("SELECT profile_json FROM cached_profiles WHERE symbol = ?", (full_ticker,))
                cache_row = cursor.fetchone()
                if cache_row:
                    profile = json.loads(cache_row["profile_json"])
                    company_name = profile.get("company_name") or company_name
                    sector = profile.get("sector") or sector
                
                cursor.execute(
                    "INSERT INTO portfolio_items (symbol, name, sector, quantity, purchase_price, purchase_date, transaction_type) VALUES (?, ?, ?, ?, ?, ?, ?)",
                    (full_ticker, company_name, sector, qty, price, p_date, t_type)
                )
                imported_count += 1
            except Exception as ins_err:
                errors.append(f"Insert error for {trade['symbol']}: {str(ins_err)}")
        conn.commit()
        
    return {"status": "success", "imported": imported_count, "errors": errors}

@app.get("/api/portfolio/tax-report")
async def get_portfolio_tax_report(generate_prescription: bool = False):
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT id, symbol, name, sector, quantity, purchase_price, purchase_date, transaction_type FROM portfolio_items")
            portfolio_items = [dict(row) for row in cursor.fetchall()]
        
        # Calculate active holdings dynamically via FIFO netting for unrealized loss harvesting
        active_holdings = compute_active_holdings(portfolio_items)
        tax_report = await asyncio.to_thread(calculate_portfolio_taxes, active_holdings, generate_prescription)
        return tax_report
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Tax Analysis Error: {str(e)}")


@app.get("/api/analyze/risk-factors")
async def get_risk_factors(symbol: str, benchmark: str = "^NSEI", period: str = "1y"):
    try:
        # Translate period
        valid_periods = {"6mo", "1y", "3y", "5y"}
        if period not in valid_periods:
            period = "1y"
            
        # Determine cap-specific benchmark
        import sqlite3
        import os
        from backend.financial_utils import resolve_benchmark_by_mcap
        
        cap_type = None
        DATABASE_DIR = os.environ.get("DATABASE_DIR", os.path.join(os.path.dirname(__file__), "data"))
        DATABASE_PATH = os.path.join(DATABASE_DIR, "watchlist_database.db")
        if os.path.exists(DATABASE_PATH):
            try:
                conn = sqlite3.connect(DATABASE_PATH)
                cursor = conn.cursor()
                clean_sym = symbol.split(".")[0].upper()
                cursor.execute("SELECT cap_type FROM screener_universe WHERE symbol = ? OR base_symbol = ?", (symbol, clean_sym))
                row = cursor.fetchone()
                if row:
                    cap_type = row[0]
                conn.close()
            except Exception as e:
                print(f"Error querying cap_type for {symbol}: {e}")
                
        # Resolve suggested benchmark
        suggested_sym = "^CNX100"
        suggested_name = "Nifty 100"
        if cap_type:
            cap_type_lower = cap_type.lower()
            if "mid" in cap_type_lower:
                suggested_sym = "NIFTYMIDCAP150.NS"
                suggested_name = "Nifty Midcap 150"
            elif "small" in cap_type_lower:
                suggested_sym = "MOSMALL250.NS"
                suggested_name = "Nifty Smallcap 250"
        else:
            # Fallback to yfinance if not in DB
            try:
                ticker_obj = yf.Ticker(symbol)
                info = ticker_obj.info
                mcap = info.get("marketCap", 0)
                mcap_cr = mcap / 1e7 if mcap else 0
                if mcap_cr > 0:
                    suggested_sym, suggested_name = resolve_benchmark_by_mcap(mcap_cr)
            except Exception as e:
                print(f"Error resolving mcap from yf for {symbol}: {e}")
                
        # Collect unique tickers to download
        tickers_to_download = list(set([symbol, benchmark, "^NSEI", suggested_sym]))
        
        # Download all price data concurrently
        loop = asyncio.get_event_loop()
        download_tasks = []
        for ticker in tickers_to_download:
            download_tasks.append(
                loop.run_in_executor(None, lambda t=ticker: yf.download(t, period=period, progress=False))
            )
        dfs = await asyncio.gather(*download_tasks)
        df_map = dict(zip(tickers_to_download, dfs))
        
        df_stock = df_map.get(symbol)
        df_bench = df_map.get(benchmark)
        df_nifty50 = df_map.get("^NSEI")
        df_suggested = df_map.get(suggested_sym)
        
        if df_stock is None or df_stock.empty:
            raise HTTPException(status_code=400, detail=f"No price data found for stock {symbol}")
        if df_bench is None or df_bench.empty:
            raise HTTPException(status_code=400, detail=f"No price data found for selected benchmark {benchmark}")
            
        def compute_risk_metrics(df_s, df_b, rf_rate=0.07):
            if df_s is None or df_s.empty or df_b is None or df_b.empty:
                return {
                    "beta": 1.0,
                    "correlation": 0.5,
                    "annual_stock_ret": 12.0,
                    "annual_bench_ret": 10.0,
                    "alpha": 1.5
                }
            close_s = df_s['Close']
            if isinstance(close_s, pd.DataFrame):
                close_s = close_s.iloc[:, 0]
            close_b = df_b['Close']
            if isinstance(close_b, pd.DataFrame):
                close_b = close_b.iloc[:, 0]
                
            df_aligned = pd.DataFrame({'stock': close_s, 'bench': close_b}).dropna()
            if df_aligned.empty:
                return {
                    "beta": 1.0,
                    "correlation": 0.5,
                    "annual_stock_ret": 12.0,
                    "annual_bench_ret": 10.0,
                    "alpha": 1.5
                }
            df_aligned['stock_ret'] = df_aligned['stock'].pct_change()
            df_aligned['bench_ret'] = df_aligned['bench'].pct_change()
            df_aligned = df_aligned.dropna()
            
            if len(df_aligned) < 5:
                return {
                    "beta": 1.0,
                    "correlation": 0.5,
                    "annual_stock_ret": 12.0,
                    "annual_bench_ret": 10.0,
                    "alpha": 1.5
                }
                
            covariance = float(df_aligned['stock_ret'].cov(df_aligned['bench_ret']))
            bench_variance = float(df_aligned['bench_ret'].var())
            beta = covariance / bench_variance if bench_variance != 0.0 else 1.0
            correlation = float(df_aligned['stock_ret'].corr(df_aligned['bench_ret']))
            
            cum_s = float((1 + df_aligned['stock_ret']).prod() - 1)
            cum_b = float((1 + df_aligned['bench_ret']).prod() - 1)
            
            num_days = len(df_aligned)
            ann_s = float(((cum_s + 1) ** (252.0 / num_days) - 1)) if num_days > 0 else 0.0
            ann_b = float(((cum_b + 1) ** (252.0 / num_days) - 1)) if num_days > 0 else 0.0
            
            alpha_val = ann_s - (rf_rate + beta * (ann_b - rf_rate))
            
            return {
                "beta": round(beta, 3),
                "correlation": round(correlation, 3),
                "annual_stock_ret": round(ann_s * 100, 2),
                "annual_bench_ret": round(ann_b * 100, 2),
                "alpha": round(alpha_val * 100, 2)
            }
            
        # Calculate selected benchmark metrics
        main_metrics = compute_risk_metrics(df_stock, df_bench)
        
        # Calculate Nifty 50 metrics
        n50_metrics = compute_risk_metrics(df_stock, df_nifty50)
        n50_metrics["benchmark_name"] = "Nifty 50"
        n50_metrics["benchmark_symbol"] = "^NSEI"
        
        # Calculate Suggested Cap index metrics
        suggested_metrics = compute_risk_metrics(df_stock, df_suggested)
        suggested_metrics["benchmark_name"] = suggested_name
        suggested_metrics["benchmark_symbol"] = suggested_sym
        
        # Format daily scatter points for main benchmark chart
        close_stock = df_stock['Close']
        if isinstance(close_stock, pd.DataFrame):
            close_stock = close_stock.iloc[:, 0]
        close_bench = df_bench['Close']
        if isinstance(close_bench, pd.DataFrame):
            close_bench = close_bench.iloc[:, 0]
        df_aligned_main = pd.DataFrame({'stock': close_stock, 'bench': close_bench}).dropna()
        df_aligned_main['stock_ret'] = df_aligned_main['stock'].pct_change()
        df_aligned_main['bench_ret'] = df_aligned_main['bench'].pct_change()
        df_aligned_main = df_aligned_main.dropna()
        
        scatter_points = []
        for date, row in df_aligned_main.iterrows():
            scatter_points.append({
                "x": float(row['bench_ret'] * 100),
                "y": float(row['stock_ret'] * 100),
                "date": date.strftime('%Y-%m-%d')
            })
            
        cum_stock = float((1 + df_aligned_main['stock_ret']).prod() - 1)
        cum_bench = float((1 + df_aligned_main['bench_ret']).prod() - 1)
        
        return {
            "status": "success",
            "symbol": symbol,
            "benchmark": benchmark,
            "period": period,
            "beta": main_metrics["beta"],
            "correlation": main_metrics["correlation"],
            "annual_stock_ret": main_metrics["annual_stock_ret"],
            "annual_bench_ret": main_metrics["annual_bench_ret"],
            "cum_stock_ret": cum_stock * 100,
            "cum_bench_ret": cum_bench * 100,
            "scatter_points": scatter_points,
            "nifty50_risk": n50_metrics,
            "suggested_risk": suggested_metrics
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"CAPM Calculation Error: {str(e)}")


class RiskSynthesisRequest(BaseModel):
    symbol: str
    beta: float
    alpha: float
    correlation: float
    horizon: str
    risk_profile: str
    investment_horizon: str


@app.post("/api/analyze/risk-synthesis")
async def post_risk_synthesis(data: RiskSynthesisRequest):
    try:
        from backend.agent import call_groq_llm
        
        system_prompt = (
            "You are an institutional-grade risk analyst and portfolio manager. "
            "Your task is to synthesize a high-fidelity risk analysis for a stock based on its CAPM metrics. "
            "Keep the tone professional, objective, and clear. Format the response in concise HTML/Markdown paragraphs."
        )
        
        user_prompt = (
            f"Please write an investment risk synthesis for the stock {data.symbol}.\n"
            f"Calculated CAPM Risk Metrics (vs benchmark index):\n"
            f"- Beta: {data.beta:.3f} (Volatility relative to market benchmark)\n"
            f"- Annualized CAPM Alpha: {data.alpha:.2f}% (Risk-adjusted excess return)\n"
            f"- Correlation Coefficient: {data.correlation:.3f} (Linear correlation with benchmark)\n"
            f"- Calculation Horizon: {data.horizon}\n"
            f"\n"
            f"Active Investor Profile:\n"
            f"- Time Horizon: {data.investment_horizon}\n"
            f"- Risk Tolerance: {data.risk_profile}\n"
            f"\n"
            f"Provide a clear 2-paragraph breakdown. Paragraph 1: What do these specific Alpha/Beta/Correlation "
            f"numbers tell us about the stock's market sensitivity and risk-adjusted return? Paragraph 2: Does it match "
            f"the investor's risk profile and time horizon, and what action or warning checks do you recommend?"
        )
        
        synthesis = await asyncio.to_thread(call_groq_llm, system_prompt, user_prompt)
        return {"synthesis": synthesis}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Risk Synthesis Error: {str(e)}")

@app.get("/api/search/suggestions")
async def search_suggestions(q: str):
    """Returns a list of search suggestions for autocomplete, checking both local database and online fallback."""
    if not q or len(q.strip()) < 2:
        return []
    
    query = q.strip().lower()
    results = []
    seen_symbols = set()
    
    # 1. Query local database screener_universe
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT symbol, base_symbol, company_name, sector 
                FROM screener_universe 
                WHERE LOWER(base_symbol) LIKE ? OR LOWER(company_name) LIKE ?
                LIMIT 10
            """, (f"%{query}%", f"%{query}%"))
            
            for row in cursor.fetchall():
                symbol = row["symbol"]
                if symbol not in seen_symbols:
                    seen_symbols.add(symbol)
                    results.append({
                        "symbol": symbol,
                        "base_symbol": row["base_symbol"],
                        "name": row["company_name"],
                        "sector": row["sector"]
                    })
    except Exception as db_err:
        print(f"Error querying offline suggestions: {db_err}")
        
    # 2. Online search fallback from Yahoo Finance if less than 5 results
    if len(results) < 5:
        try:
            import urllib.parse
            import requests
            encoded_query = urllib.parse.quote(query)
            url = f"https://query2.finance.yahoo.com/v1/finance/search?q={encoded_query}&quotesCount=10"
            headers = {"User-Agent": "Mozilla/5.0"}
            response = requests.get(url, headers=headers, timeout=3)
            if response.status_code == 200:
                quotes = response.json().get("quotes", [])
                for q_item in quotes:
                    symbol = q_item.get("symbol", "")
                    if symbol.endswith(".NS") or symbol.endswith(".BO"):
                        if symbol not in seen_symbols:
                            seen_symbols.add(symbol)
                            base = symbol.split(".")[0]
                            results.append({
                                "symbol": symbol,
                                "base_symbol": base,
                                "name": q_item.get("shortname") or q_item.get("longname") or base,
                                "sector": q_item.get("sector") or "General Equities"
                            })
        except Exception as online_err:
            print(f"Error fetching online suggestions: {online_err}")
            
    return results[:10]

@app.post("/api/portfolio-doctor")
async def post_portfolio_doctor(input_data: PortfolioDoctorInput):
    try:
        portfolio_items = [item.dict() for item in input_data.items]
        diagnosis = await asyncio.to_thread(run_portfolio_doctor, portfolio_items)
        return diagnosis
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Portfolio Doctor Error: {str(e)}")


class PortfolioBacktestRequest(BaseModel):
    tickers: list
    weights: list
    start_date: str
    end_date: str
    rebalance_freq: str = "none"
    starting_capital: float = 100000.0
    transaction_fee_pct: float = 0.1


class PortfolioBacktestSynthesisRequest(BaseModel):
    metrics: dict
    tickers_weights: list


@app.post("/api/portfolio/backtest")
async def post_portfolio_backtest(data: PortfolioBacktestRequest):
    try:
        result = await asyncio.to_thread(
            calculate_portfolio_backtest,
            tickers=data.tickers,
            weights=data.weights,
            start_date=data.start_date,
            end_date=data.end_date,
            rebalance_freq=data.rebalance_freq,
            starting_capital=data.starting_capital,
            transaction_fee_pct=data.transaction_fee_pct
        )
        return sanitize_nan_values(result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Portfolio Backtest Simulation Error: {str(e)}")


@app.post("/api/portfolio/backtest-synthesis")
async def post_portfolio_backtest_synthesis(data: PortfolioBacktestSynthesisRequest):
    try:
        result = await asyncio.to_thread(
            generate_backtest_synthesis,
            metrics=data.metrics,
            tickers_weights=data.tickers_weights
        )
        return {"synthesis": result}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Portfolio Backtest LLM Synthesis Error: {str(e)}")


static_dir = os.path.join(os.path.dirname(__file__), "static")
os.makedirs(static_dir, exist_ok=True)

app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")

