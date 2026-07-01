import os
import json
import sqlite3
import asyncio
from datetime import datetime
import yfinance as yf
import pandas as pd
import requests

from backend.main import get_db, compute_active_holdings, fetch_enriched_sector_regime, _MARKET_MOVERS_CACHE, get_market_news
from backend.financial_utils import get_complete_financial_profile
from backend.llm_config import call_llm, TASK_FAST

def fetch_portfolio_summary() -> dict:
    """
    Computes active holdings using FIFO netting and aggregates their performance.
    Calculates total daily valuation changes (both absolute in INR and percentage).
    Identifies top gainer and top loser in active holdings.
    """
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT id, symbol, name, sector, quantity, purchase_price, purchase_date, transaction_type FROM portfolio_items")
            all_txs = [dict(row) for row in cursor.fetchall()]
        
        # Calculate active holdings dynamically via FIFO netting
        active_holdings = compute_active_holdings(all_txs)
        if not active_holdings:
            return {"active": False}

        symbols = list(set(h["symbol"] for h in active_holdings))
        
        # Batch fetch price information using yfinance
        quotes = {}
        try:
            df = yf.download(symbols, period="2d", interval="1d", progress=False)
            if not df.empty:
                is_multi = isinstance(df.columns, pd.MultiIndex)
                for sym in symbols:
                    try:
                        if is_multi:
                            close_series = df['Close'][sym].dropna()
                        else:
                            close_series = df['Close'].dropna()
                        
                        if len(close_series) >= 1:
                            current_price = float(close_series.iloc[-1])
                            prev_close = float(close_series.iloc[-2]) if len(close_series) >= 2 else current_price
                            day_change_pct = ((current_price - prev_close) / prev_close * 100.0) if prev_close > 0 else 0.0
                            day_change_val = current_price - prev_close
                            quotes[sym] = {
                                "current_price": current_price,
                                "day_change_pct": day_change_pct,
                                "day_change_val": day_change_val
                            }
                    except Exception:
                        pass
        except Exception as batch_err:
            print(f"Daily Wrap-up: Portfolio batch download failed: {batch_err}")

        # Fallback to cached profiles if batch failed or is incomplete
        with get_db() as conn:
            cursor = conn.cursor()
            for h in active_holdings:
                sym = h["symbol"]
                if sym not in quotes:
                    cursor.execute("SELECT profile_json FROM cached_profiles WHERE symbol = ?", (sym,))
                    cache_row = cursor.fetchone()
                    if cache_row:
                        try:
                            profile = json.loads(cache_row["profile_json"])
                            curr = profile.get("fundamentals", {}).get("current_price")
                            chg = profile.get("technicals", {}).get("price_change_pct") or 0.0
                            if curr:
                                prev = curr / (1 + (chg / 100.0))
                                quotes[sym] = {
                                    "current_price": curr,
                                    "day_change_pct": chg,
                                    "day_change_val": curr - prev
                                }
                        except Exception:
                            pass
                
                # Ultimate yfinance fallback
                if sym not in quotes:
                    try:
                        ticker = yf.Ticker(sym)
                        info = ticker.info
                        curr = info.get("currentPrice") or info.get("regularMarketPrice")
                        prev = info.get("previousClose")
                        if curr and prev:
                            quotes[sym] = {
                                "current_price": curr,
                                "day_change_pct": ((curr - prev) / prev * 100.0),
                                "day_change_val": curr - prev
                            }
                    except Exception:
                        pass

        # Calculate portfolio performance totals
        total_cost = 0.0
        total_value = 0.0
        total_daily_change_val = 0.0
        
        enriched_holdings = []
        for h in active_holdings:
            sym = h["symbol"]
            qty = h["quantity"]
            purchase_price = h["purchase_price"]
            
            quote = quotes.get(sym, {"current_price": purchase_price, "day_change_pct": 0.0, "day_change_val": 0.0})
            curr_p = quote["current_price"]
            day_chg_pct = quote["day_change_pct"]
            day_chg_val = quote["day_change_val"]
            
            total_cost += qty * purchase_price
            total_value += qty * curr_p
            total_daily_change_val += qty * day_chg_val
            
            enriched_holdings.append({
                "symbol": sym,
                "name": h.get("name") or sym,
                "qty": qty,
                "cost": qty * purchase_price,
                "value": qty * curr_p,
                "day_change_pct": day_chg_pct,
                "day_change_val": qty * day_chg_val
            })

        total_daily_change_pct = (total_daily_change_val / (total_value - total_daily_change_val) * 100.0) if (total_value - total_daily_change_val) > 0 else 0.0
        total_return_val = total_value - total_cost
        total_return_pct = (total_return_val / total_cost * 100.0) if total_cost > 0 else 0.0

        # Sort holdings by day_change_pct to find leaders/laggards
        enriched_holdings.sort(key=lambda x: x["day_change_pct"], reverse=True)
        top_gainer = enriched_holdings[0] if enriched_holdings else None
        top_loser = enriched_holdings[-1] if enriched_holdings else None

        return {
            "active": True,
            "total_cost": total_cost,
            "total_value": total_value,
            "total_daily_change_val": total_daily_change_val,
            "total_daily_change_pct": total_daily_change_pct,
            "total_return_val": total_return_val,
            "total_return_pct": total_return_pct,
            "top_gainer": top_gainer,
            "top_loser": top_loser
        }
    except Exception as e:
        print(f"Daily Wrap-up: Portfolio aggregation error: {e}")
        return {"active": False}

def fetch_watchlist_summary() -> dict:
    """
    Gathers all watchlist stock tickers and fetches their daily returns.
    Identifies top watchlist gainers and losers.
    """
    try:
        symbols = set()
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT symbol FROM watchlist_items")
            for row in cursor.fetchall():
                symbols.add(row["symbol"])
                
        if not symbols:
            return {"active": False}
            
        watchlist_items = []
        try:
            df = yf.download(list(symbols), period="2d", interval="1d", progress=False)
            if not df.empty:
                is_multi = isinstance(df.columns, pd.MultiIndex)
                for sym in symbols:
                    try:
                        if is_multi:
                            close_series = df['Close'][sym].dropna()
                        else:
                            close_series = df['Close'].dropna()
                        if len(close_series) >= 1:
                            curr = float(close_series.iloc[-1])
                            prev = float(close_series.iloc[-2]) if len(close_series) >= 2 else curr
                            chg_pct = ((curr - prev) / prev * 100.0) if prev > 0 else 0.0
                            watchlist_items.append({
                                "symbol": sym,
                                "price": curr,
                                "change_pct": chg_pct
                            })
                    except Exception:
                        pass
        except Exception as w_err:
            print(f"Daily Wrap-up: Watchlist batch fetch failed: {w_err}")
            
        if not watchlist_items:
            return {"active": False}
            
        # Sort items by change_pct
        watchlist_items.sort(key=lambda x: x["change_pct"], reverse=True)
        gainers = [x for x in watchlist_items if x["change_pct"] > 0][:2]
        losers = [x for x in watchlist_items if x["change_pct"] < 0]
        # Sort losers ascending so top loser is first
        losers.sort(key=lambda x: x["change_pct"])
        losers = losers[:2]
        
        return {
            "active": True,
            "gainers": gainers,
            "losers": losers
        }
    except Exception as e:
        print(f"Daily Wrap-up: Watchlist aggregation error: {e}")
        return {"active": False}

def fetch_sector_momentum() -> dict:
    """
    Fetches daily sector returns from sector_regime_stats table.
    Ranks them to isolate top 2 strongest and top 2 weakest sectors.
    Finds leading and lagging stocks inside each sector.
    """
    try:
        with get_db() as conn:
            sectors = fetch_enriched_sector_regime(conn)
            
        if not sectors:
            return {"active": False}
            
        # Sort sectors by return_1d
        sectors_sorted = [s for s in sectors if s.get("return_1d") is not None]
        sectors_sorted.sort(key=lambda x: x["return_1d"], reverse=True)
        
        strongest = sectors_sorted[:2]
        weakest = sectors_sorted[-2:] if len(sectors_sorted) >= 4 else sectors_sorted[2:]
        weakest.reverse() # Sort worst performing first
        
        def enrich_sector_detail(sec_list):
            results = []
            for s in sec_list:
                sec_name = s["sector"]
                ret_1d = s["return_1d"]
                stocks = s.get("stocks", [])
                
                leader = None
                laggard = None
                if stocks:
                    # Sort stocks by return_1d
                    stocks_sorted = sorted(stocks, key=lambda x: x.get("return_1d", 0.0), reverse=True)
                    leader = stocks_sorted[0]
                    laggard = stocks_sorted[-1]
                    
                results.append({
                    "name": sec_name,
                    "return_1d": ret_1d,
                    "leader": leader,
                    "laggard": laggard
                })
            return results

        return {
            "active": True,
            "strongest": enrich_sector_detail(strongest),
            "weakest": enrich_sector_detail(weakest)
        }
    except Exception as e:
        print(f"Daily Wrap-up: Sector momentum aggregation error: {e}")
        return {"active": False}

async def fetch_global_news_summary() -> list:
    """
    Queries the latest global news items from the local feed cache.
    Extracts the top 3 headlines featuring high-impact Bullish or Bearish sentiments.
    """
    try:
        data = await get_market_news(refresh=False, run_llm=False)
        news_items = data.get("news_items", [])
        if not news_items:
            return []
            
        # Filter for items with clear sentiment if possible
        impactful = [n for n in news_items if n.get("sentiment") in ["Bullish", "Bearish"]]
        if len(impactful) < 3:
            impactful += [n for n in news_items if n not in impactful]
            
        selected_news = impactful[:3]
        formatted = []
        for n in selected_news:
            source = n.get("source", "Market News")
            sentiment = n.get("sentiment", "Neutral")
            title = n.get("title", "")
            
            emoji = "⚪"
            if sentiment == "Bullish":
                emoji = "🟢"
            elif sentiment == "Bearish":
                emoji = "🔴"
                
            formatted.append({
                "source": source,
                "emoji": emoji,
                "title": title
            })
        return formatted
    except Exception as e:
        print(f"Daily Wrap-up: Global news fetch error: {e}")
        return []

async def generate_daily_wrapup_text(persona_override: str = None) -> str:
    """
    Assembles data from all components, invokes LLM to compile commentary based on selected persona,
    and returns a formatted WhatsApp text payload.
    """
    # 1. Fetch settings to determine AI persona
    persona = "institutional"
    if persona_override:
        persona = persona_override
    else:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT value FROM alert_settings WHERE key = 'daily_wrapup_persona'")
            row = cursor.fetchone()
            if row:
                persona = row["value"]

    # 2. Gather market indices
    indices_str = ""
    breadth_str = ""
    import backend.main as bmain
    cache = bmain._MARKET_MOVERS_CACHE
    if cache and cache.get("status") == "success":
        indices = cache.get("indices", [])
        for idx in indices[:4]:
            indices_str += f"• {idx['name']}:   `{idx['price']:.2f} ({idx['change_pct']:+.2f}%)`\n"
        
        # Extract Gold and Silver prices if present
        comm_items = []
        for idx in indices:
            if idx["symbol"] in ["SPOTGOLD", "SPOTSILVER"]:
                chg_pct = idx.get("change_pct")
                chg_str = f" ({chg_pct:+.2f}%)" if chg_pct is not None else ""
                try:
                    price_val = float(idx['price'])
                    comm_items.append(f"  - {idx['name']}: `{price_val:,.2f}{chg_str}`")
                except Exception:
                    comm_items.append(f"  - {idx['name']}: `{idx['price']}{chg_str}`")
        if comm_items:
            indices_str += "✨ *Commodities Spot Rates:*\n" + "\n".join(comm_items) + "\n"

        adv = cache.get("advances", 0)
        dec = cache.get("declines", 0)
        breadth_str = f"📈 _Breadth: {adv} Advances | {dec} Declines_"
    else:
        # Robust fallback fetching multiple indices & spot commodities
        try:
            # 1. Fetch Nifty 50 and Sensex from yfinance in batch
            ticks = yf.download(["^NSEI", "^BSESN"], period="2d", interval="1d", progress=False)
            if not ticks.empty:
                for sym, name in [("^NSEI", "Nifty 50"), ("^BSESN", "BSE Sensex")]:
                    try:
                        # Handle multi-index or single index DataFrame
                        if isinstance(ticks.columns, pd.MultiIndex):
                            curr = ticks["Close"][sym].iloc[-1]
                            prev = ticks["Close"][sym].iloc[-2]
                        else:
                            curr = ticks["Close"].iloc[-1]
                            prev = ticks["Close"].iloc[-2]
                        pct = (curr - prev) / prev * 100.0
                        indices_str += f"• {name}:   `{curr:.2f} ({pct:+.2f}%)`\n"
                    except Exception:
                        pass
            if not indices_str:
                indices_str = "• Nifty 50: N/A\n"
        except Exception as e:
            print(f"Daily Wrap-up: Fallback index download error: {e}")
            indices_str = "• Nifty 50: N/A\n"
            
        # 2. Fetch Spot Gold & Silver from GoodReturns scraper
        try:
            from backend.commodity_scraper import CommodityScraper
            spots = await CommodityScraper.get_prices()
            comm_items = []
            if "gold_24k" in spots:
                g = spots["gold_24k"]
                comm_items.append(f"  - Gold 24K 10g (Spot): `{float(g['price']):,.2f} ({g['change_pct']:+.2f}%)`")
            if "silver_1kg" in spots:
                s = spots["silver_1kg"]
                comm_items.append(f"  - Silver 1kg (Spot): `{float(s['price']):,.2f} ({s['change_pct']:+.2f}%)`")
            if comm_items:
                indices_str += "✨ *Commodities Spot Rates:*\n" + "\n".join(comm_items) + "\n"
        except Exception as e:
            print(f"Daily Wrap-up: Fallback commodity scrape error: {e}")

    # 3. Gather Portfolio stats
    port = fetch_portfolio_summary()
    port_str = ""
    if port.get("active"):
        sign = "+" if port['total_daily_change_val'] >= 0 else ""
        port_str += f"• Daily Change:  `{sign}Rs. {port['total_daily_change_val']:,.2f} ({port['total_daily_change_pct']:+.2f}%)`\n"
        port_str += f"• Current Value: `Rs. {port['total_value']:,.2f}`\n"
        sign_ret = "+" if port['total_return_val'] >= 0 else ""
        port_str += f"• Total Return:  `{sign_ret}Rs. {port['total_return_val']:,.2f} ({port['total_return_pct']:+.2f}%)`\n"
        if port.get("top_gainer"):
            port_str += f"  ├─ 🏆 *Top Gainer:* {port['top_gainer']['symbol'].replace('.NS','')} (`{port['top_gainer']['day_change_pct']:+.2f}%`)\n"
        if port.get("top_loser"):
            port_str += f"  └─ ⚠️ *Top Loser:*  {port['top_loser']['symbol'].replace('.NS','')} (`{port['top_loser']['day_change_pct']:+.2f}%`)\n"
    else:
        port_str = "_No active holdings in portfolio ledger._\n"

    # 4. Gather Sector stats
    sectors = fetch_sector_momentum()
    sectors_str = ""
    if sectors.get("active"):
        sectors_str += "• 🔥 *Strongest Sectors:*\n"
        for s in sectors["strongest"]:
            sectors_str += f"  - {s['name']} (`{s['return_1d']:+.2f}%`)\n"
            if s.get("leader"):
                sectors_str += f"    ├─ 🏆 Leader: {s['leader']['symbol'].replace('.NS','')} (`{s['leader']['return_1d']:+.2f}%`)\n"
            if s.get("laggard"):
                sectors_str += f"    └─ ⚠️ Laggard: {s['laggard']['symbol'].replace('.NS','')} (`{s['laggard']['return_1d']:+.2f}%`)\n"
        
        sectors_str += "• ❄️ *Weakest Sectors:*\n"
        for s in sectors["weakest"]:
            sectors_str += f"  - {s['name']} (`{s['return_1d']:+.2f}%`)\n"
            if s.get("leader"):
                sectors_str += f"    ├─ 🏆 Leader: {s['leader']['symbol'].replace('.NS','')} (`{s['leader']['return_1d']:+.2f}%`)\n"
            if s.get("laggard"):
                sectors_str += f"    └─ ⚠️ Laggard: {s['laggard']['symbol'].replace('.NS','')} (`{s['laggard']['return_1d']:+.2f}%`)\n"
    else:
        sectors_str = "_No sector momentum stats compiled._\n"

    # 5. Gather Watchlist highlights
    watchlist = fetch_watchlist_summary()
    watchlist_str = ""
    if watchlist.get("active"):
        if watchlist.get("gainers"):
            watchlist_str += "• 🟢 *Watchlist Gainers:*\n"
            for w in watchlist["gainers"]:
                watchlist_str += f"  - {w['symbol'].replace('.NS','')}: `{w['price']:.2f} ({w['change_pct']:+.2f}%)`\n"
        if watchlist.get("losers"):
            watchlist_str += "• 🔴 *Watchlist Losers:*\n"
            for w in watchlist["losers"]:
                watchlist_str += f"  - {w['symbol'].replace('.NS','')}: `{w['price']:.2f} ({w['change_pct']:+.2f}%)`\n"
    else:
        watchlist_str = "_No items in watchlists or markets are closed._\n"

    # 6. Gather Global News
    news = await fetch_global_news_summary()
    news_str = ""
    if news:
        for n in news:
            news_str += f"• {n['emoji']} _{n['source']}_: {n['title']}\n"
    else:
        news_str = "_No significant market news cached._\n"

    # 7. Generate AI commentary
    system_prompts = {
        "institutional": (
            "You are an institutional portfolio manager. "
            "Based on the today's market performance metrics, write a sober, professional, 2-3 sentence market commentary (max 60 words) "
            "focusing on main indices, sector relative strength, and institutional flow catalysts. "
            "Keep it factual and direct. Do not include introductory remarks or emojis."
        ),
        "momentum": (
            "You are a momentum trading specialist. "
            "Based on the today's market metrics, write an action-oriented, technical 2-3 sentence swing analysis (max 60 words) "
            "focusing on volume breakouts, technical support/resistances, and breakout sectors/stocks on the watchlist. "
            "Keep it sharp and trading-focused. Do not include introductory remarks or emojis."
        ),
        "macro": (
            "You are a macro economist and commodities strategist. "
            "Based on the today's market metrics, write a macro-focused 2-3 sentence briefing (max 60 words) "
            "linking commodity movements, currency changes, global news stories, and underlying sector moves. "
            "Keep it strategic and high-level. Do not include introductory remarks or emojis."
        )
    }
    
    sys_prompt = system_prompts.get(persona, system_prompts["institutional"])
    user_prompt = (
        f"TODAY'S MARKET STATS:\n"
        f"Indices:\n{indices_str}\n"
        f"Portfolio P&L:\n{port_str}\n"
        f"Strongest Sectors:\n{sectors_str}\n"
        f"Global News Headlines:\n{news_str}\n"
        f"Output only the 2-3 sentence summary."
    )
    
    ai_commentary = ""
    try:
        ai_commentary = await asyncio.to_thread(call_llm, TASK_FAST, sys_prompt, user_prompt)
        ai_commentary = ai_commentary.strip().strip('"').strip("'").strip()
    except Exception as ai_err:
        print(f"Daily Wrap-up AI commentary failed: {ai_err}")
        ai_commentary = "Market closed with standard distributions. Rebalancing and sector rotation remained active within structural bands."

    # 8. Assemble final WhatsApp payload
    today_date = datetime.now().strftime("%B %d, %Y")
    
    msg = (
        f"════════════════════════\n"
        f"📈 *APEX EQUITIES WORKSTATION*\n"
        f"📅 Daily Close Wrap-Up | {today_date}\n"
        f"════════════════════════\n\n"
        
        f"📊 *1. KEY MARKET INDICES*\n"
        f"{indices_str}"
        f"{breadth_str}\n\n"
        
        f"💼 *2. PORTFOLIO DAILY STATUS*\n"
        f"{port_str}\n"
        
        f"⚡ *3. SECTOR MOMENTUM RADAR*\n"
        f"{sectors_str}\n"
        
        f"👀 *4. WATCHLIST HIGHLIGHTS*\n"
        f"{watchlist_str}\n"
        
        f"📰 *5. MARKET CATALYST HEADLINES*\n"
        f"{news_str}\n"
        
        f"🤖 *AI COPILOT BRIEFING* (_{persona.title()}_)\n"
        f"_{ai_commentary}_\n"
        f"────────────────────────\n"
        f"_APEX AI Workstation Client Portal_"
    )
    
    return msg

async def send_whatsapp_wrapup(msg_body: str) -> dict:
    """
    Dispatches a generated message body using the configured Meta WhatsApp Cloud API credentials.
    """
    wa_token = os.environ.get("WHATSAPP_TOKEN", "")
    wa_phone_id = os.environ.get("WHATSAPP_PHONE_ID", "")
    wa_recipient = os.environ.get("WHATSAPP_RECIPIENT", "")
    
    if not wa_token or not wa_phone_id or not wa_recipient:
        return {"status": "error", "message": "WhatsApp credentials not configured in .env file."}
        
    url = f"https://graph.facebook.com/v21.0/{wa_phone_id}/messages"
    headers = {
        "Authorization": f"Bearer {wa_token}",
        "Content-Type": "application/json"
    }
    payload = {
        "messaging_product": "whatsapp",
        "to": wa_recipient,
        "type": "text",
        "text": {
            "preview_url": False,
            "body": msg_body
        }
    }
    
    try:
        resp = await asyncio.to_thread(requests.post, url, headers=headers, json=payload, timeout=10)
        resp_data = resp.json()
        if resp.status_code == 200 and "messages" in resp_data:
            return {"status": "success", "message_id": resp_data["messages"][0].get("id", "")}
        else:
            error_msg = resp_data.get("error", {}).get("message", "Unknown error")
            return {"status": "error", "message": f"WhatsApp Cloud API error: {error_msg}"}
    except Exception as e:
        return {"status": "error", "message": f"Network error sending WhatsApp: {str(e)}"}
