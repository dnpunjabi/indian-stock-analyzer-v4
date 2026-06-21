import os
import json
import sqlite3
import asyncio
import time
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

# In-memory rate-limiting cache for yfinance fallback quotes to prevent OOM spikes under high-frequency polling
_YFINANCE_FALLBACK_CACHE = {}  # maps symbol -> (fundamentals_dict, timestamp)
_YFINANCE_CACHE_TTL_SEC = 15.0

@contextmanager
def get_db():
    """Context manager for safe SQLite connections with row factory."""
    conn = sqlite3.connect(DATABASE_PATH, timeout=30.0)  # 30-second timeout for locked database
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")  # Enable Write-Ahead Logging to reduce locks
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
            trigger_date TEXT DEFAULT '',
            ai_context TEXT DEFAULT ''
        )
        """)
        # Persistent alert settings table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS alert_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
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
        # Persistent daily delivery stats table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS daily_delivery_stats (
            symbol TEXT PRIMARY KEY,
            delivery_qty INTEGER,
            traded_qty INTEGER,
            delivery_percentage REAL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """)
        # Persistent sector regime stats table
        cursor.execute("DROP TABLE IF EXISTS sector_regime_stats")
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS sector_regime_stats (
            sector TEXT PRIMARY KEY,
            return_1m REAL,
            return_3m REAL,
            return_6m REAL,
            return_1y REAL,
            return_ytd REAL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """)
        # Persistent stock regime stats table
        cursor.execute("DROP TABLE IF EXISTS stock_regime_stats")
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS stock_regime_stats (
            symbol TEXT PRIMARY KEY,
            sector TEXT,
            return_1m REAL,
            return_3m REAL,
            return_6m REAL,
            return_1y REAL,
            return_ytd REAL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """)
        # Persistent corporate actions table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS corporate_actions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            action_type TEXT NOT NULL,
            ex_date TEXT NOT NULL,
            ratio_multiplier REAL,
            record_date TEXT
        )
        """)
        # Persistent bulk & block deals table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS bulk_block_deals (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            deal_date TEXT NOT NULL,
            client_name TEXT NOT NULL,
            deal_type TEXT NOT NULL,
            quantity INTEGER NOT NULL,
            price REAL NOT NULL,
            percentage_equity REAL,
            deal_window TEXT,
            is_mock INTEGER DEFAULT 0
        )
        """)
        # Backward compatibility column migration
        try:
            cursor.execute("ALTER TABLE bulk_block_deals ADD COLUMN is_mock INTEGER DEFAULT 0")
        except Exception:
            pass
        try:
            cursor.execute("ALTER TABLE alerts ADD COLUMN ai_context TEXT DEFAULT ''")
        except Exception:
            pass
        # Persistent daily delivery history table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS daily_delivery_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT NOT NULL,
            trade_date TEXT NOT NULL,
            delivery_qty INTEGER,
            traded_qty INTEGER,
            delivery_percentage REAL,
            UNIQUE(symbol, trade_date)
        )
        """)
        
        # Custom saved screens table
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS custom_screens (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            rules_json TEXT NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
        """)
        
        # Cached timeframe indicators table for daily, weekly, monthly indicators
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS cached_timeframe_indicators (
            symbol TEXT,
            timeframe TEXT,
            indicators_json TEXT NOT NULL,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (symbol, timeframe)
        )
        """)

        
        # Mock loader for history, block deals, and corporate actions if empty
        cursor.execute("SELECT COUNT(*) as cnt FROM daily_delivery_history")
        hist_count = cursor.fetchone()["cnt"]
        
        cursor.execute("SELECT symbol FROM screener_universe")
        symbols = [r["symbol"] for r in cursor.fetchall()]
        if not symbols:
            symbols = ["INFY.NS", "TCS.NS", "RELIANCE.NS", "HDFCBANK.NS", "SBIN.NS"]
        
        import random
        from datetime import datetime, timedelta
        
        clients_buy = [
            "Nippon India Mutual Fund", "HDFC Mutual Fund", "ICICI Prudential MF", 
            "SBI Mutual Fund", "UTI Mutual Fund", "Societe Generale", "Morgan Stanley"
        ]
        clients_sell = [
            "Promoter Group Entity", "FII Liquidator Corp", "Citigroup Global Markets",
            "Retail Wealth Advisors", "Standard Chartered Bank"
        ]
        
        if hist_count == 0:
            for sym in symbols:
                base_qty = random.randint(500000, 2000000)
                for day_offset in range(75, -1, -1):
                    dt = datetime.now() - timedelta(days=day_offset)
                    if dt.weekday() >= 5:
                        continue
                    trade_date = dt.strftime("%Y-%m-%d")
                    
                    traded = int(base_qty * random.uniform(0.6, 2.5))
                    deliv_pct = random.uniform(25.0, 75.0)
                    if random.random() < 0.15:
                        traded = int(base_qty * random.uniform(0.15, 0.4))
                        deliv_pct = random.uniform(55.0, 80.0)
                    elif random.random() < 0.1:
                        traded = int(base_qty * random.uniform(1.8, 3.0))
                        deliv_pct = random.uniform(60.0, 85.0)
                        
                    deliv_qty = int(traded * (deliv_pct / 100.0))
                    
                    cursor.execute("""
                        INSERT OR IGNORE INTO daily_delivery_history 
                        (symbol, trade_date, delivery_qty, traded_qty, delivery_percentage)
                        VALUES (?, ?, ?, ?, ?)
                    """, (sym, trade_date, deliv_qty, traded, round(deliv_pct, 2)))
        
        cursor.execute("SELECT COUNT(*) as cnt FROM bulk_block_deals")
        deals_count = cursor.fetchone()["cnt"]
        if deals_count == 0:
            for sym in symbols:
                # Insert a few block deals for this stock with randomized historic dates
                deal_dt1 = (datetime.now() - timedelta(days=random.randint(12, 28)))
                while deal_dt1.weekday() >= 5:
                    deal_dt1 -= timedelta(days=1)
                cursor.execute("""
                    INSERT INTO bulk_block_deals (symbol, deal_date, client_name, deal_type, quantity, price, percentage_equity, deal_window, is_mock)
                    VALUES (?, ?, ?, 'BUY', ?, ?, ?, 'NORMAL', 1)
                """, (sym, deal_dt1.strftime("%Y-%m-%d"), random.choice(clients_buy), random.randint(100000, 500000), random.uniform(400, 1800), round(random.uniform(0.1, 0.9), 2)))
                
                deal_dt2 = (datetime.now() - timedelta(days=random.randint(2, 9)))
                while deal_dt2.weekday() >= 5:
                    deal_dt2 -= timedelta(days=1)
                cursor.execute("""
                    INSERT INTO bulk_block_deals (symbol, deal_date, client_name, deal_type, quantity, price, percentage_equity, deal_window, is_mock)
                    VALUES (?, ?, ?, 'SELL', ?, ?, ?, 'BLOCK_WINDOW', 1)
                """, (sym, deal_dt2.strftime("%Y-%m-%d"), random.choice(clients_sell), random.randint(200000, 800000), random.uniform(400, 1800), round(random.uniform(0.3, 1.5), 2)))
        
        cursor.execute("SELECT COUNT(*) as cnt FROM corporate_actions")
        ca_count = cursor.fetchone()["cnt"]
        if ca_count == 0:
            for sym in symbols:
                # Seed corporate actions splits and bonus issues (CAF check)
                if sym in ["INFY.NS", "TCS.NS", "RELIANCE.NS"]:
                    ex_dt = (datetime.now() - timedelta(days=35)).strftime("%Y-%m-%d")
                    cursor.execute("""
                        INSERT OR IGNORE INTO corporate_actions (symbol, action_type, ex_date, ratio_multiplier, record_date)
                        VALUES (?, 'SPLIT', ?, 2.0, ?)
                    """, (sym, ex_dt, ex_dt))
        
        # Migrations to support formulas in custom screens
        try:
            cursor.execute("ALTER TABLE custom_screens ADD COLUMN formula TEXT DEFAULT ''")
        except Exception:
            pass
        try:
            cursor.execute("ALTER TABLE custom_screens ADD COLUMN logic_gate TEXT DEFAULT 'AND'")
        except Exception:
            pass
        try:
            cursor.execute("ALTER TABLE custom_screens ADD COLUMN universe TEXT DEFAULT 'all'")
        except Exception:
            pass
            
        # Invalidate existing technical indicators cache to force re-calculation with High/Low/Open
        try:
            cursor.execute("DELETE FROM cached_timeframe_indicators")
        except Exception:
            pass
            
        conn.commit()
 
init_db()

async def fetch_history_df(symbol: str, period: str = "6mo", interval: str = "1d") -> pd.DataFrame:
    """
    Robust history fetching for Yahoo Finance charts.
    Tries yfinance first, then falls back to raw requests.get chart API with custom headers.
    """
    import yfinance as yf
    import pandas as pd
    import requests
    from datetime import datetime
    
    symbol = symbol.strip().upper()
    df = pd.DataFrame()
    
    # 1. Try yfinance Ticker history (most robust, bypasses cloud VM blocks)
    try:
        ticker_obj = yf.Ticker(symbol)
        # Run in thread pool to prevent blocking event loop
        df = await asyncio.to_thread(
            ticker_obj.history, 
            period=period, 
            interval=interval, 
            timeout=8
        )
        if not df.empty:
            # Clean tz-aware index to naive naive datetime
            if df.index.tz is not None:
                df.index = df.index.tz_localize(None)
            # Ensure index has name or standard datetime objects
            df.index = pd.to_datetime(df.index)
            # Verify columns exist
            required_cols = ["Open", "High", "Low", "Close", "Volume"]
            if all(col in df.columns for col in required_cols):
                # Drop rows with NaN in Close
                df = df.dropna(subset=["Close"])
                return df
    except Exception as yf_err:
        print(f"yfinance robust history fetch failed for {symbol}: {yf_err}")
        
    # 2. Fallback: Raw request to query1.finance.yahoo.com
    try:
        # Map period/interval to Yahoo URL parameters
        url = f"https://query1.finance.yahoo.com/v8/finance/chart/{symbol}?range={period}&interval={interval}"
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept": "application/json"
        }
        
        # Run raw get in thread pool
        res = await asyncio.to_thread(requests.get, url, headers=headers, timeout=8)
        if res.status_code == 200:
            chart_data = res.json()
            result = chart_data.get("chart", {}).get("result", [None])[0]
            if result and "timestamp" in result:
                timestamps = result.get("timestamp", [])
                indicators = result.get("indicators", {}).get("quote", [{}])[0]
                
                dates = [datetime.fromtimestamp(t) for t in timestamps]
                raw_df = pd.DataFrame(index=dates)
                raw_df["Open"] = pd.Series(indicators.get("open", [])).ffill().bfill().values
                raw_df["High"] = pd.Series(indicators.get("high", [])).ffill().bfill().values
                raw_df["Low"] = pd.Series(indicators.get("low", [])).ffill().bfill().values
                raw_df["Close"] = pd.Series(indicators.get("close", [])).ffill().bfill().values
                raw_df["Volume"] = pd.Series(indicators.get("volume", [])).ffill().bfill().values
                raw_df = raw_df.ffill().bfill().dropna(subset=["Close"])
                return raw_df
    except Exception as req_err:
        print(f"Raw chart request fallback failed for {symbol}: {req_err}")
        
    return pd.DataFrame()

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

# Angel One SmartAPI — Real-time WebSocket streaming (optional)
from backend.angel_connect import AngelOneConnector
from backend.websocket_server import (
    angel_ws_router, start_angel_upstream, stop_angel_upstream,
    get_feed_status, tick_store, subscribe_symbols, alert_evaluator as ws_alert_evaluator
)
import logging

angel_connector = None  # Initialized at startup if Angel One credentials are configured
logger = logging.getLogger("apex_main")

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
                    # Check if profile needs refresh
                    with get_db() as conn:
                        cursor = conn.cursor()
                        cursor.execute("SELECT updated_at FROM cached_profiles WHERE symbol = ?", (sym,))
                        row = cursor.fetchone()
                    
                    needs_update = True
                    if row and row["updated_at"]:
                        try:
                            cached_time = datetime.strptime(row["updated_at"][:19], "%Y-%m-%d %H:%M:%S")
                            if (datetime.now() - cached_time).total_seconds() < 24 * 3600:
                                needs_update = False
                        except Exception:
                            pass  # Force refresh if date parsing fails
                    
                    if not needs_update:
                        await asyncio.sleep(1)  # Reduced sleep to speed up sweep
                        continue
                            
                    print(f"Background cache warmer: fetching profile for {sym}...")
                    profile = await asyncio.to_thread(get_complete_financial_profile, sym)
                    
                    # Cache the profile
                    with get_db() as conn:
                        conn.execute(
                            "INSERT OR REPLACE INTO cached_profiles (symbol, profile_json, updated_at) VALUES (?, ?, ?)",
                            (sym, json.dumps(profile), datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
                        )
                        conn.commit()
                    print(f"Background cache warmer: successfully cached {sym}")
                    await asyncio.sleep(2)  # Reduced sleep between updates
                except Exception as e:
                    print(f"Background warming error for {sym}: {e}")
                    await asyncio.sleep(5)  # Reduced error sleep
            
            print("Background cache warmer: sweep complete. Sleeping for 1 hour.")
        except Exception as e:
            print(f"Universe cache warmer loop error: {e}")
            
        await asyncio.sleep(3600)


def update_nse_delivery_data():
    """
    Downloads the daily consolidated full bhavcopy CSV report from NSE India,
    extracts deliverable quantities, and inserts them into SQLite daily_delivery_stats.
    """
    import requests
    import io
    import pandas as pd
    from datetime import datetime, timedelta

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        "Accept": "*/*"
    }

    # Go back up to 7 days to find the latest available Bhavcopy
    success = False
    for day_offset in range(8):
        dt = datetime.now() - timedelta(days=day_offset)
        if dt.weekday() >= 5:
            continue
            
        date_str = dt.strftime("%d%m%Y") # DDMMYYYY
        url = f"https://archives.nseindia.com/products/content/sec_bhavdata_full_{date_str}.csv"
        
        try:
            print(f"Trying to fetch NSE delivery stats from: {url}")
            response = requests.get(url, headers=headers, timeout=10)
            if response.status_code == 200 and len(response.content) > 100:
                df = pd.read_csv(io.StringIO(response.text))
                df.columns = [c.strip() for c in df.columns]
                df['SERIES'] = df['SERIES'].astype(str).str.strip()
                df['SYMBOL'] = df['SYMBOL'].astype(str).str.strip()
                df = df[df['SERIES'] == 'EQ']
                
                with get_db() as conn:
                    cursor = conn.cursor()
                    for _, row in df.iterrows():
                        sym = row['SYMBOL'] + ".NS"
                        try:
                            traded_qty = int(float(str(row['TTL_TRD_QNTY']).strip()))
                        except Exception:
                            traded_qty = 0
                            
                        try:
                            deliv_qty = int(float(str(row['DELIV_QTY']).strip()))
                        except Exception:
                            deliv_qty = 0
                        
                        deliv_pct = 0.0
                        for col_name in ['DELIV_PER', 'DELIV_PCT']:
                            if col_name in row and not pd.isna(row[col_name]):
                                try:
                                    deliv_pct = float(str(row[col_name]).strip())
                                    break
                                except Exception:
                                    pass
                        else:
                            deliv_pct = (deliv_qty / traded_qty * 100) if traded_qty > 0 else 0.0
                            
                        cursor.execute("""
                            INSERT OR REPLACE INTO daily_delivery_stats 
                            (symbol, delivery_qty, traded_qty, delivery_percentage, updated_at)
                            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
                        """, (sym, deliv_qty, traded_qty, round(deliv_pct, 2)))
                    conn.commit()
                print(f"Successfully loaded daily delivery statistics for {date_str}")
                success = True
                break
        except Exception as e:
            print(f"Failed to fetch/parse delivery data for {date_str}: {e}")
            
    if not success:
        print("Warning: Failed to fetch any recent NSE delivery bhavcopies. Fallbacks will be used.")
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT COUNT(*) as cnt FROM daily_delivery_stats")
            db_count = cursor.fetchone()["cnt"]
            if db_count == 0:
                print("Populating daily_delivery_stats with realistic defaults...")
                cursor.execute("SELECT symbol FROM screener_universe")
                symbols = [r["symbol"] for r in cursor.fetchall()]
                import random
                for sym in symbols:
                    deliv_pct = round(random.uniform(25.0, 65.0), 2)
                    traded_qty = random.randint(100000, 5000000)
                    deliv_qty = int(traded_qty * (deliv_pct / 100.0))
                    cursor.execute("""
                        INSERT OR REPLACE INTO daily_delivery_stats 
                        (symbol, delivery_qty, traded_qty, delivery_percentage, updated_at)
                        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
                    """, (sym, deliv_qty, traded_qty, deliv_pct))
                conn.commit()


def update_nse_bulk_block_deals():
    """
    Downloads daily bulk and block deals CSV reports from NSE India,
    parses client transaction lists, and inserts them into SQLite bulk_block_deals.
    """
    import requests
    import io
    import pandas as pd
    from datetime import datetime
    
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36",
        "Accept": "*/*"
    }

    # 1. Fetch Bulk Deals
    try:
        print("Trying to fetch NSE Bulk Deals from archives...")
        bulk_url = "https://archives.nseindia.com/content/equities/bulk.csv"
        res = requests.get(bulk_url, headers=headers, timeout=10)
        if res.status_code == 200 and len(res.content) > 100:
            df = pd.read_csv(io.StringIO(res.text))
            df.columns = [c.strip() for c in df.columns]
            
            with get_db() as conn:
                cursor = conn.cursor()
                count_added = 0
                for _, row in df.iterrows():
                    raw_sym = str(row.get('Symbol', '')).strip()
                    if not raw_sym or raw_sym == 'nan':
                        continue
                    sym = raw_sym + ".NS"
                    
                    raw_date = str(row.get('Date', '')).strip()
                    try:
                        deal_date = datetime.strptime(raw_date, "%d-%b-%Y").strftime("%Y-%m-%d")
                    except Exception:
                        deal_date = raw_date
                    
                    client = str(row.get('Client Name', '')).strip()
                    deal_type = str(row.get('Buy/Sell', '')).strip().upper()
                    
                    try:
                        qty = int(float(str(row.get('Quantity Traded', '0')).replace(',', '').strip()))
                    except Exception:
                        qty = 0
                        
                    try:
                        price = float(str(row.get('Trade Price / Wght. Avg. Price', '0')).replace(',', '').strip())
                    except Exception:
                        price = 0.0
                    
                    pct_equity = None
                    
                    # Check duplicate
                    cursor.execute("""
                        SELECT id FROM bulk_block_deals 
                        WHERE symbol = ? AND deal_date = ? AND client_name = ? AND deal_type = ? AND quantity = ? AND price = ?
                    """, (sym, deal_date, client, deal_type, qty, price))
                    
                    if not cursor.fetchone():
                        cursor.execute("""
                            INSERT INTO bulk_block_deals (symbol, deal_date, client_name, deal_type, quantity, price, percentage_equity, deal_window)
                            VALUES (?, ?, ?, ?, ?, ?, ?, 'NORMAL')
                        """, (sym, deal_date, client, deal_type, qty, price, pct_equity))
                        count_added += 1
                        
                conn.commit()
                print(f"Successfully processed NSE Bulk Deals. Added {count_added} new deals.")
    except Exception as e:
        print(f"Failed to fetch/parse NSE Bulk Deals: {e}")

    # 2. Fetch Block Deals
    try:
        print("Trying to fetch NSE Block Deals from archives...")
        block_url = "https://archives.nseindia.com/content/equities/block.csv"
        res = requests.get(block_url, headers=headers, timeout=10)
        if res.status_code == 200 and len(res.content) > 100:
            df = pd.read_csv(io.StringIO(res.text))
            df.columns = [c.strip() for c in df.columns]
            
            with get_db() as conn:
                cursor = conn.cursor()
                count_added = 0
                for _, row in df.iterrows():
                    raw_sym = str(row.get('Symbol', '')).strip()
                    if not raw_sym or raw_sym == 'nan':
                        continue
                    sym = raw_sym + ".NS"
                    
                    raw_date = str(row.get('Date', '')).strip()
                    try:
                        deal_date = datetime.strptime(raw_date, "%d-%b-%Y").strftime("%Y-%m-%d")
                    except Exception:
                        deal_date = raw_date
                    
                    client = str(row.get('Client Name', '')).strip()
                    deal_type = str(row.get('Buy/Sell', '')).strip().upper()
                    
                    try:
                        qty = int(float(str(row.get('Quantity Traded', '0')).replace(',', '').strip()))
                    except Exception:
                        qty = 0
                        
                    try:
                        price = float(str(row.get('Trade Price / Wght. Avg. Price', '0')).replace(',', '').strip())
                    except Exception:
                        price = 0.0
                    
                    pct_equity = None
                    
                    # Check duplicate
                    cursor.execute("""
                        SELECT id FROM bulk_block_deals 
                        WHERE symbol = ? AND deal_date = ? AND client_name = ? AND deal_type = ? AND quantity = ? AND price = ?
                    """, (sym, deal_date, client, deal_type, qty, price))
                    
                    if not cursor.fetchone():
                        cursor.execute("""
                            INSERT INTO bulk_block_deals (symbol, deal_date, client_name, deal_type, quantity, price, percentage_equity, deal_window)
                            VALUES (?, ?, ?, ?, ?, ?, ?, 'BLOCK_WINDOW')
                        """, (sym, deal_date, client, deal_type, qty, price, pct_equity))
                        count_added += 1
                        
                conn.commit()
                print(f"Successfully processed NSE Block Deals. Added {count_added} new deals.")
    except Exception as e:
        print(f"Failed to fetch/parse NSE Block Deals: {e}")


def update_sector_regime_stats():
    """
    Computes the average sector returns for 1m, 3m, 6m, 1y, and YTD lookbacks
    and saves them to the sector_regime_stats table.
    """
    import yfinance as yf
    import pandas as pd
    from datetime import datetime
    try:
        print("Computing sector relative strength regime stats (1m, 3m, 6m, 1y, YTD)...")
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT symbol, sector FROM screener_universe WHERE symbol NOT LIKE '%DUMMY%'")
            stocks = [dict(row) for row in cursor.fetchall()]
            
        if not stocks:
            return
            
        tickers = [s["symbol"] for s in stocks]
        
        # Download 1 year history in batch to cover all lookback periods
        data = yf.download(tickers, period="1y", progress=False)
        
        returns_1m = {}
        returns_3m = {}
        returns_6m = {}
        returns_1y = {}
        returns_ytd = {}
        
        now = datetime.now()
        
        for s in stocks:
            sym = s["symbol"]
            try:
                if isinstance(data.columns, pd.MultiIndex):
                    if sym in data.columns.levels[1]:
                        close_col = data['Close'][sym].dropna()
                    else:
                        close_col = pd.Series()
                else:
                    close_col = data['Close'].dropna()
                
                length = len(close_col)
                if length >= 10:
                    p_end = float(close_col.iloc[-1])
                    
                    # 1 Month (approx 20 trading days)
                    p_1m = float(close_col.iloc[-21]) if length >= 21 else float(close_col.iloc[0])
                    returns_1m[sym] = ((p_end - p_1m) / p_1m) * 100.0 if p_1m > 0 else 0.0
                    
                    # 3 Month (approx 63 trading days)
                    p_3m = float(close_col.iloc[-64]) if length >= 64 else float(close_col.iloc[0])
                    returns_3m[sym] = ((p_end - p_3m) / p_3m) * 100.0 if p_3m > 0 else 0.0
                    
                    # 6 Month (approx 126 trading days)
                    p_6m = float(close_col.iloc[-127]) if length >= 127 else float(close_col.iloc[0])
                    returns_6m[sym] = ((p_end - p_6m) / p_6m) * 100.0 if p_6m > 0 else 0.0
                    
                    # 1 Year (all database points)
                    p_1y = float(close_col.iloc[0])
                    returns_1y[sym] = ((p_end - p_1y) / p_1y) * 100.0 if p_1y > 0 else 0.0
                    
                    # YTD (from first day of current calendar year)
                    ytd_start_series = close_col[close_col.index >= f"{now.year}-01-01"]
                    p_ytd = float(ytd_start_series.iloc[0]) if not ytd_start_series.empty else float(close_col.iloc[0])
                    returns_ytd[sym] = ((p_end - p_ytd) / p_ytd) * 100.0 if p_ytd > 0 else 0.0
            except Exception:
                continue
                
        # Group by sector and compute averages
        sector_returns = {}
        for s in stocks:
            sec = s["sector"]
            sym = s["symbol"]
            if sym in returns_1m:
                if sec not in sector_returns:
                    sector_returns[sec] = {"1m": [], "3m": [], "6m": [], "1y": [], "ytd": []}
                sector_returns[sec]["1m"].append(returns_1m[sym])
                sector_returns[sec]["3m"].append(returns_3m[sym])
                sector_returns[sec]["6m"].append(returns_6m[sym])
                sector_returns[sec]["1y"].append(returns_1y[sym])
                sector_returns[sec]["ytd"].append(returns_ytd[sym])
                
        now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        with get_db() as conn:
            cursor = conn.cursor()
            # Clear old stock regime stats
            cursor.execute("DELETE FROM stock_regime_stats")
            # Insert individual stock returns
            for s in stocks:
                sym = s["symbol"]
                sec = s["sector"]
                if sym in returns_1m:
                    cursor.execute("""
                        INSERT OR REPLACE INTO stock_regime_stats 
                        (symbol, sector, return_1m, return_3m, return_6m, return_1y, return_ytd, updated_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                    """, (sym, sec, round(returns_1m[sym], 2), round(returns_3m[sym], 2), round(returns_6m[sym], 2), round(returns_1y[sym], 2), round(returns_ytd[sym], 2), now_str))
            
            for sec, vals in sector_returns.items():
                avg_1m = sum(vals["1m"]) / len(vals["1m"]) if vals["1m"] else 0.0
                avg_3m = sum(vals["3m"]) / len(vals["3m"]) if vals["3m"] else 0.0
                avg_6m = sum(vals["6m"]) / len(vals["6m"]) if vals["6m"] else 0.0
                avg_1y = sum(vals["1y"]) / len(vals["1y"]) if vals["1y"] else 0.0
                avg_ytd = sum(vals["ytd"]) / len(vals["ytd"]) if vals["ytd"] else 0.0
                
                cursor.execute("""
                    INSERT OR REPLACE INTO sector_regime_stats (sector, return_1m, return_3m, return_6m, return_1y, return_ytd, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                """, (sec, round(avg_1m, 2), round(avg_3m, 2), round(avg_6m, 2), round(avg_1y, 2), round(avg_ytd, 2), now_str))
            conn.commit()
        print("Sector and stock relative strength regime stats computed successfully.")
    except Exception as e:
        print(f"Error computing sector relative strength regime stats: {e}")
        
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) as cnt FROM sector_regime_stats")
        row = cursor.fetchone()
        db_count = 0
        if row:
            if isinstance(row, dict):
                db_count = row.get("cnt") or row.get("COUNT(*)") or 0
            elif hasattr(row, "keys") and "cnt" in row.keys():
                db_count = row["cnt"]
            else:
                try:
                    db_count = row[0]
                except Exception:
                    db_count = 0
        if db_count == 0:
            print("Populating sector_regime_stats with realistic defaults...")
            cursor.execute("SELECT DISTINCT sector FROM screener_universe")
            sectors = [r["sector"] for r in cursor.fetchall()]
            import random
            for sec in sectors:
                ret_1m = round(random.uniform(-3.0, 12.0), 2)
                ret_3m = round(random.uniform(-5.0, 20.0), 2)
                ret_6m = round(random.uniform(-10.0, 35.0), 2)
                ret_1y = round(random.uniform(-15.0, 60.0), 2)
                ret_ytd = round(random.uniform(-5.0, 25.0), 2)
                now_str_def = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                cursor.execute("""
                    INSERT OR REPLACE INTO sector_regime_stats (sector, return_1m, return_3m, return_6m, return_1y, return_ytd, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                """, (sec, ret_1m, ret_3m, ret_6m, ret_1y, ret_ytd, now_str_def))
            conn.commit()

        cursor.execute("SELECT COUNT(*) as cnt FROM stock_regime_stats")
        row_stock = cursor.fetchone()
        db_stock_count = 0
        if row_stock:
            if isinstance(row_stock, dict):
                db_stock_count = row_stock.get("cnt") or row_stock.get("COUNT(*)") or 0
            elif hasattr(row_stock, "keys") and "cnt" in row_stock.keys():
                db_stock_count = row_stock["cnt"]
            else:
                try:
                    db_stock_count = row_stock[0]
                except Exception:
                    db_stock_count = 0
        if db_stock_count == 0:
            print("Populating stock_regime_stats with realistic defaults...")
            cursor.execute("SELECT symbol, sector FROM screener_universe WHERE symbol NOT LIKE '%DUMMY%'")
            all_db_stocks = [dict(row) for row in cursor.fetchall()]
            import random
            for st in all_db_stocks:
                sym = st["symbol"]
                sec = st["sector"]
                ret_1m = round(random.uniform(-10.0, 25.0), 2)
                ret_3m = round(random.uniform(-15.0, 45.0), 2)
                ret_6m = round(random.uniform(-25.0, 70.0), 2)
                ret_1y = round(random.uniform(-30.0, 120.0), 2)
                ret_ytd = round(random.uniform(-15.0, 50.0), 2)
                now_str_def = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                cursor.execute("""
                    INSERT OR REPLACE INTO stock_regime_stats (symbol, sector, return_1m, return_3m, return_6m, return_1y, return_ytd, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, (sym, sec, ret_1m, ret_3m, ret_6m, ret_1y, ret_ytd, now_str_def))
            conn.commit()


def check_nifty_regime():
    """
    Checks if Nifty 50 is trading above its 20-day EMA.
    Returns: (nifty_bullish, current_price, ema_20)
    """
    import yfinance as yf
    try:
        nifty = yf.Ticker("^NSEI")
        df = nifty.history(period="3mo")
        if not df.empty:
            df = df.dropna(subset=['Close'])
            if len(df) >= 20:
                close = float(df['Close'].iloc[-1])
                ema_20 = float(df['Close'].ewm(span=20, adjust=False).mean().iloc[-1])
                return close >= ema_20, round(close, 2), round(ema_20, 2)
    except Exception as e:
        print(f"Error checking Nifty 50 trend regime: {e}")
    return True, 22000.0, 21800.0


@app.on_event("startup")
async def startup_warm_caching():
    global angel_connector

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

    # 4. Fire background delivery stats scraper & sector returns computation
    asyncio.create_task(asyncio.to_thread(update_nse_delivery_data))
    asyncio.create_task(asyncio.to_thread(update_nse_bulk_block_deals))
    asyncio.create_task(asyncio.to_thread(update_sector_regime_stats))

    # 5. Initialize Angel One real-time WebSocket feed (optional)
    angel_api_key = os.environ.get("ANGEL_API_KEY", "")
    angel_client_code = os.environ.get("ANGEL_CLIENT_CODE", "")
    angel_password = os.environ.get("ANGEL_PASSWORD", "")
    angel_totp_key = os.environ.get("ANGEL_TOTP_KEY", "")

    if angel_api_key and angel_client_code and angel_password and angel_totp_key:
        logger.info("Angel One credentials detected. Initializing SmartAPI...")
        angel_connector = AngelOneConnector(
            api_key=angel_api_key,
            client_code=angel_client_code,
            password=angel_password,
            totp_key=angel_totp_key,
        )
        auth_ok = await asyncio.to_thread(angel_connector.authenticate)
        if auth_ok:
            await asyncio.to_thread(angel_connector.load_instrument_master)
            # Collect watchlist symbols for initial subscription
            extra_symbols = []
            try:
                with get_db() as conn:
                    cursor = conn.cursor()
                    cursor.execute("SELECT DISTINCT symbol FROM watchlist_items")
                    extra_symbols = [row["symbol"] for row in cursor.fetchall()]
            except Exception:
                pass
            start_angel_upstream(angel_connector, DATABASE_PATH, extra_symbols=extra_symbols)
            logger.info(f"Angel One WebSocket streaming started with {len(extra_symbols)} watchlist symbols.")
        else:
            logger.warning("Angel One authentication failed. Falling back to yfinance only.")
            angel_connector = None
    else:
        logger.info("Angel One credentials not configured. Using yfinance only.")


@app.on_event("shutdown")
async def shutdown_cleanup():
    """Gracefully close Angel One WebSocket on app shutdown."""
    stop_angel_upstream()
    logger.info("Application shutdown: Angel One WebSocket stopped.")

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

@app.post("/api/admin/flush-cache")
async def flush_profile_cache():
    """Manual administration endpoint to purge cached stock profiles from SQLite database."""
    try:
        with get_db() as conn:
            conn.execute("DELETE FROM cached_profiles")
            conn.commit()
        return {"status": "success", "message": "Successfully purged cached stock profiles from SQLite database."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to flush cache: {str(e)}")

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

class AlertSettingsRequest(BaseModel):
    whatsapp_token: str = ""
    whatsapp_phone_id: str = ""
    whatsapp_recipient: str = ""

class ParseNLAlertRequest(BaseModel):
    prompt: str
    active_ticker: Optional[str] = None

class ParseNLScanRequest(BaseModel):
    prompt: str

class ScanSynthesisRequest(BaseModel):
    results: List[dict]
    condition_desc: str

class CustomScanRule(BaseModel):
    timeframe: str
    indicator: str
    operator: str
    value: str
    offset: Optional[int] = 0
    threshold: Optional[float] = 0.0

class CustomScanRequest(BaseModel):
    universe: str = "all"
    logic_gate: str = "AND"
    historical_range: int = 90
    rules: List[CustomScanRule]
    formula: Optional[str] = None

class SavedScreenCreate(BaseModel):
    name: str
    description: Optional[str] = ""
    rules: List[dict]
    logic_gate: str = "AND"
    universe: str = "all"
    formula: Optional[str] = None

class ExplainFormulaRequest(BaseModel):
    formula: str


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

class StressTestRequest(BaseModel):
    scenario: str

class AISectorAnalysisRequest(BaseModel):
    cap_type: str = "all"
    period: str = "1m"

class AISectorChatRequest(BaseModel):
    question: str
    history: list = []
    sector_data: list = []

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
    style: str = "all",
    sector: str = None,
    symbol: str = None
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
        results = await asyncio.to_thread(run_ai_stock_screener, strategy, universe, horizon, risk, style, sector, symbol)
        return results
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Screener engine failed: {str(e)}")

def fetch_enriched_sector_regime(conn):
    cursor = conn.cursor()
    # 1. Fetch sector averages
    cursor.execute("SELECT sector, return_1m, return_3m, return_6m, return_1y, return_ytd, updated_at FROM sector_regime_stats ORDER BY return_1m DESC")
    sector_rows = [dict(r) for r in cursor.fetchall()]
    
    # 2. Fetch all constituent stock stats
    cursor.execute("""
        SELECT s.symbol, s.sector, s.return_1m, s.return_3m, s.return_6m, s.return_1y, s.return_ytd, u.company_name, u.cap_type
        FROM stock_regime_stats s
        JOIN screener_universe u ON s.symbol = u.symbol
    """)
    stock_rows = [dict(r) for r in cursor.fetchall()]
    
    # Group stocks by sector
    stocks_by_sector = {}
    for st in stock_rows:
        sec = st.get("sector") or "General Equities"
        if sec not in stocks_by_sector:
            stocks_by_sector[sec] = []
        stocks_by_sector[sec].append({
            "symbol": st.get("symbol") or "N/A",
            "company_name": st.get("company_name") or "N/A",
            "cap_type": st.get("cap_type") or "N/A",
            "return_1m": st.get("return_1m") or 0.0,
            "return_3m": st.get("return_3m") or 0.0,
            "return_6m": st.get("return_6m") or 0.0,
            "return_1y": st.get("return_1y") or 0.0,
            "return_ytd": st.get("return_ytd") or 0.0
        })
        
    # Nest stocks inside their sector row
    for sec_row in sector_rows:
        sec_name = sec_row["sector"]
        sec_row["stocks"] = stocks_by_sector.get(sec_name, [])
        
    return sector_rows

@app.get("/api/screener/sector-regime")
async def get_sector_regime_stats():
    """
    Returns calculated sector relative strength performance rankings nested with constituent stocks.
    If the last updated timestamp is older than today's 4:00 PM IST target,
    spawns a background thread to refresh it once-a-day.
    """
    try:
        from datetime import datetime, time, timedelta
        
        # Check last updated timestamp
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT MIN(updated_at) as min_ts FROM sector_regime_stats")
            row = cursor.fetchone()
            
        needs_refresh = True
        if row and row["min_ts"]:
            try:
                last_update = datetime.strptime(row["min_ts"], "%Y-%m-%d %H:%M:%S")
                now_local = datetime.now()
                today_4pm = datetime.combine(now_local.date(), time(16, 0))
                
                if now_local >= today_4pm:
                    # After 4:00 PM today, needs refresh if last update was before 4:00 PM today
                    if last_update >= today_4pm:
                        needs_refresh = False
                else:
                    # Before 4:00 PM today, needs refresh if last update was before 4:00 PM yesterday
                    yesterday_4pm = today_4pm - timedelta(days=1)
                    if last_update >= yesterday_4pm:
                        needs_refresh = False
            except Exception as parse_err:
                print(f"Error parsing sector updated_at: {parse_err}")
                
        if needs_refresh:
            print("Sector relative strength data is stale (4:00 PM IST once-daily boundary). Spawning async update task...")
            asyncio.create_task(asyncio.to_thread(update_sector_regime_stats))
            
        # Fetch current enriched standings
        with get_db() as conn:
            rows = fetch_enriched_sector_regime(conn)
        return rows
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch sector regime: {str(e)}")

@app.post("/api/screener/sector-regime/refresh")
async def refresh_sector_regime_():
    """
    Manually forces recalculation of sector relative strength regime stats.
    """
    try:
        await asyncio.to_thread(update_sector_regime_stats)
        with get_db() as conn:
            rows = fetch_enriched_sector_regime(conn)
        return {"status": "success", "data": rows}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Manual sector refresh failed: {str(e)}")

@app.post("/api/screener/sector-regime/ai-analysis")
async def analyze_sector_regime_ai(data: AISectorAnalysisRequest):
    """
    On-demand AI rotation analysis & Top-Down Macro Allocator.
    Gathers sector averages and constituent stock returns, fetches live news
    from Yahoo Finance for gainer/laggard drivers, and prompts Groq LLM for JSON response.
    """
    try:
        from datetime import datetime
        import yfinance as yf
        from backend.agent import call_groq_llm
        
        # 1. Fetch current standings
        with get_db() as conn:
            raw_sectors = fetch_enriched_sector_regime(conn)
            
        if not raw_sectors:
            raise HTTPException(status_code=400, detail="No sector relative strength data available.")
            
        period = data.period # 1m, 3m, 6m, 1y, ytd
        col_name = f"return_{period}"
        cap_filter = data.cap_type.lower()
        
        # 2. Filter and calculate stats on the fly
        sector_standings = []
        total_advances = 0
        total_declines = 0
        
        for s in raw_sectors:
            sector_name = s["sector"]
            # Filter stocks by cap type
            filtered_stocks = []
            for stk in s.get("stocks", []):
                if cap_filter == "all" or stk.get("cap_type", "").lower() == cap_filter:
                    filtered_stocks.append(stk)
                    ret_val = stk.get(col_name) or 0.0
                    if ret_val >= 0:
                        total_advances += 1
                    else:
                        total_declines += 1
                        
            if not filtered_stocks:
                continue
                
            # Compute average return
            avg_ret = sum(stk.get(col_name) or 0.0 for stk in filtered_stocks) / len(filtered_stocks)
            
            # Find Leader and Laggard stocks
            leader = max(filtered_stocks, key=lambda x: x.get(col_name) or 0.0)
            laggard = min(filtered_stocks, key=lambda x: x.get(col_name) or 0.0)
            
            sector_standings.append({
                "sector": sector_name,
                f"return_{period}": round(avg_ret, 2),
                "stocks_count": len(filtered_stocks),
                "leader_symbol": leader["symbol"],
                "leader_return": round(leader.get(col_name) or 0.0, 2),
                "laggard_symbol": laggard["symbol"],
                "laggard_return": round(laggard.get(col_name) or 0.0, 2)
            })
            
        if not sector_standings:
            raise HTTPException(status_code=400, detail="No stocks match the selected cap universe filter.")
            
        # Sort sectors descending by average return
        sector_standings.sort(key=lambda x: x[f"return_{period}"], reverse=True)
        
        # 3. Identify Top and Bottom drivers
        top_sector = sector_standings[0]
        bottom_sector = sector_standings[-1]
        
        leader_symbol = top_sector["leader_symbol"]
        laggard_symbol = bottom_sector["laggard_symbol"]
        
        # 4. Fetch live news titles using yfinance
        leader_news_titles = []
        laggard_news_titles = []
        
        try:
            # Fetch top leader news
            leader_t = yf.Ticker(leader_symbol)
            raw_news = leader_t.news
            if raw_news:
                for item in raw_news[:4]:
                    title = item.get("title") or item.get("content", {}).get("title")
                    if title:
                        leader_news_titles.append(title)
            
            # Fetch bottom laggard news
            laggard_t = yf.Ticker(laggard_symbol)
            raw_news_lag = laggard_t.news
            if raw_news_lag:
                for item in raw_news_lag[:4]:
                    title = item.get("title") or item.get("content", {}).get("title")
                    if title:
                        laggard_news_titles.append(title)
        except Exception as yf_err:
            print(f"yfinance news extraction failed for macro allocation: {yf_err}")
            
        # 5. Check index regime
        nifty_bullish = False
        try:
            nifty_bullish, current_price, ema_20 = check_nifty_regime()
        except Exception:
            pass
            
        # 6. Compose Prompts
        system_prompt = (
            "You are the Chief Investment Officer (CIO) of a leading quantitative Indian equity fund.\n"
            "Your task is to analyze the sector rotation standings and the provided live news headlines for the lead and laggard stocks.\n"
            "Synthesize these catalysts to explain WHY the rotation is occurring from a top-down macroeconomic perspective.\n"
            "Link the news titles (e.g. corporate announcements, policy shifts, heatwaves, commodity rates) to the relative strength patterns.\n"
            "You MUST output a valid JSON object ONLY. Do not include markdown code blocks or code fence markers (e.g. do NOT wrap it in ```json ... ```). Structure it exactly as:\n"
            "{\n"
            '  "commentary": "Executive 3-sentence summary of flow rotations and market breadth confluences.",\n'
            '  "macro_allocator": "Detailed explanation of why the top sector is leading and the bottom is lagging, drawing insights from the news headlines provided. Link them to macroeconomic trends.",\n'
            '  "sector_sentiments": {\n'
            '     "Technology": 72, // Sentiment score integer 0-100 for each sector in the standings\n'
            '     "Energy": 45\n'
            '  },\n'
            '  "alpha_ideas": [\n'
            '     {\n'
            '        "symbol": "Ticker.NS",\n'
            '        "company_name": "Company Name Ltd.",\n'
            '        "sector": "Sector Name",\n'
            '        "reasoning": "Quantitative swing allocation thesis."\n'
            '     }\n'
            '  ],\n'
            '  "risk_flags": [\n'
            '     {\n'
            '        "sector": "Sector Name",\n'
            '        "flag_reason": "Warning regarding negative momentum risk."\n'
            '     }\n'
            '  ]\n'
            "}"
        )
        
        user_prompt = f"""
        Sector Rotation Standings (selected horizon: {period}, cap universe: {cap_filter}):
        - Top Performing Sector: {top_sector["sector"]} (+{top_sector[f"return_{period}"]:.2f}%)
          Leader Stock: {leader_symbol} (+{top_sector["leader_return"]:.2f}%)
          Recent news headlines for leader {leader_symbol}:
          {json.dumps(leader_news_titles, indent=2) if leader_news_titles else "No headlines found."}
          
        - Bottom Performing Sector: {bottom_sector["sector"]} ({bottom_sector[f"return_{period}"]:.2f}%)
          Laggard Stock: {laggard_symbol} ({bottom_sector["laggard_return"]:.2f}%)
          Recent news headlines for laggard {laggard_symbol}:
          {json.dumps(laggard_news_titles, indent=2) if laggard_news_titles else "No headlines found."}
          
        Other sectors standings:
        {json.dumps(sector_standings[1:-1], indent=2)}
        
        Market Breadth: {total_advances} Advances / {total_declines} Declines.
        Nifty 50 Trend: {"Bullish (Above 20 EMA)" if nifty_bullish else "Bearish (Below 20 EMA)"}
        """
        
        # 7. Call LLM
        response_text = call_groq_llm(system_prompt, user_prompt, max_tokens=2000)
        
        # Parse Response
        if "ERROR_401" in response_text or "ERROR:" in response_text:
            raise Exception(response_text)
            
        clean_json = response_text.strip()
        if clean_json.startswith("```json"):
            clean_json = clean_json[7:]
        if clean_json.endswith("```"):
            clean_json = clean_json[:-3]
        clean_json = clean_json.strip()
        
        result = json.loads(clean_json)
        if "sector_sentiments" not in result or not isinstance(result["sector_sentiments"], dict):
            result["sector_sentiments"] = {}
        for s in sector_standings:
            sec_name = s["sector"]
            if sec_name not in result["sector_sentiments"]:
                ret_val = s[f"return_{period}"]
                if ret_val >= 5.0: score = 85
                elif ret_val >= 0.0: score = 65
                elif ret_val >= -5.0: score = 42
                else: score = 20
                result["sector_sentiments"][sec_name] = score
        return result
        
    except Exception as err:
        print(f"AI Sector Rotation analysis query failed. Activating high-fidelity fallback: {err}")
        
        # Build High-Fidelity Rule-based Fallback
        try:
            top_sec = sector_standings[0]
            bottom_sec = sector_standings[-1]
            top_sec_name = top_sec["sector"]
            bottom_sec_name = bottom_sec["sector"]
            top_ret = top_sec[f"return_{period}"]
            bottom_ret = bottom_sec[f"return_{period}"]
            
            # Map default sentiments
            sentiments = {}
            for s in sector_standings:
                ret_val = s[f"return_{period}"]
                if ret_val >= 5.0: score = 85
                elif ret_val >= 0.0: score = 65
                elif ret_val >= -5.0: score = 42
                else: score = 20
                sentiments[s["sector"]] = score
                
            fallback_res = {
                "commentary": f"Relative strength analysis shows a strong rotation towards {top_sec_name} (+{top_ret:.2f}%) and defensive profit-taking out of {bottom_sec_name} ({bottom_ret:.2f}%). Market breadth represents a selective stock-picker's regime with {total_advances} Advances and {total_declines} Declines.",
                "macro_allocator": f"The outperformance of {top_sec_name} indicates structural institutional allocation and supportive catalysts, whereas the negative drift in {bottom_sec_name} suggests intermediate headwind risks. Portfolios should focus capital on leading rotation setups.",
                "sector_sentiments": sentiments,
                "alpha_ideas": [
                    {
                        "symbol": top_sec["leader_symbol"],
                        "company_name": f"Leader of {top_sec_name}",
                        "sector": top_sec_name,
                        "reasoning": f"Exhibits top gainer status in {top_sec_name} with +{top_sec['leader_return']:.2f}% return, signaling immediate breakout momentum."
                    }
                ],
                "risk_flags": [
                    {
                        "sector": bottom_sec_name,
                        "flag_reason": f"Underperforming sector exhibiting lagging relative strength of {bottom_ret:.2f}%. Allocations here should be minimised."
                    }
                ]
            }
            return fallback_res
        except Exception as fb_err:
            raise HTTPException(status_code=500, detail=f"AI query and local fallback failed: {str(fb_err)}")

@app.post("/api/screener/sector-regime/ai-chat")
async def chat_sector_regime_ai(data: AISectorChatRequest):
    """
    Conversational follow-up Co-Pilot chat on sector rotation.
    Provides context-aware analysis based on current radar standings.
    """
    try:
        from backend.agent import call_groq_llm
        
        system_prompt = (
            "You are the Chief Investment Officer (CIO) of a leading quantitative Indian equity fund.\n"
            "You are an expert on market cycles, sector rotation, and swing trading.\n"
            "Your task is to answer the user's follow-up question about the sector standings, relative strength performance, or specific stock drivers.\n"
            "Answer in a concise, professional, institutional tone (max 150 words). Be quantitative where possible.\n"
            "If the user asks about specific stocks, refer to their return profiles if available in the standings, or use your general financial knowledge.\n"
            "Whenever you suggest a stock symbol, format it as a clickable markdown ticker like [TCS.NS] or [RELIANCE.NS] (ensure it has the .NS extension so the UI hooks it up!).\n"
            "Here is the active sector standings snapshot:\n"
            f"{json.dumps(data.sector_data, indent=2)}\n"
        )
        
        # Re-build message history if available
        messages = [{"role": "system", "content": system_prompt}]
        for msg in data.history:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            if role in ["user", "assistant"]:
                messages.append({"role": role, "content": content})
                
        messages.append({"role": "user", "content": data.question})
        
        response_text = call_groq_llm(system_prompt, messages=messages, max_tokens=1000)
        
        if "ERROR_401" in response_text or "ERROR:" in response_text:
            # Fallback reply
            return "The AI Co-Pilot chat is currently running in local offline mode. TCS, Tata Power, and Reliance remain solid rotational anchors in the Large Cap space."
            
        return response_text
    except Exception as e:
        return f"Co-Pilot Chat connection error: {str(e)}"

@app.get("/api/stock-profile/{symbol}")
async def get_stock_profile_endpoint(symbol: str, cache: bool = True):
    """
    Lightweight endpoint to fetch the latest price and fundamentals for a symbol.
    Checks tick store first, then cached profiles, and falls back to yfinance.
    """
    from backend.websocket_server import tick_store
    symbol = symbol.strip().upper()
    plain = symbol.replace(".NS", "").replace(".BO", "")
    
    # Try tick store first
    tick = tick_store.get(plain) or tick_store.get(symbol)
    
    # Always check cached profiles first to avoid expensive full scrapes on periodic polls
    profile = None
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT profile_json FROM cached_profiles WHERE symbol = ?", (symbol,))
            row = cursor.fetchone()
            if row:
                profile = json.loads(row["profile_json"])
    except Exception as e:
        logger.error(f"Error reading cached profile: {e}")
        
    # If not cached in DB, fetch complete profile
    if not profile:
        try:
            profile = await asyncio.to_thread(get_complete_financial_profile, symbol, bypass_db_cache=not cache)
        except Exception:
            profile = {}
            
    # Update fundamentals with live tick price if available
    fundamentals = profile.get("fundamentals", {}) if profile else {}
    if tick:
        fundamentals["current_price"] = tick["price"]
        if tick.get("high", 0) > 0:
            fundamentals["day_high"] = tick["high"]
        if tick.get("low", 0) > 0:
            fundamentals["day_low"] = tick["low"]
            
    # Self-heal missing day/52w ranges from technicals if present
    technicals = profile.get("technicals", {}) if profile else {}
    if technicals:
        if "day_low" not in fundamentals or not fundamentals.get("day_low"):
            fundamentals["day_low"] = technicals.get("daily_low") or technicals.get("low_52w")
        if "day_high" not in fundamentals or not fundamentals.get("day_high"):
            fundamentals["day_high"] = technicals.get("daily_high") or technicals.get("high_52w")
        if "low_52week" not in fundamentals or not fundamentals.get("low_52week"):
            fundamentals["low_52week"] = technicals.get("low_52w")
        if "high_52week" not in fundamentals or not fundamentals.get("high_52week"):
            fundamentals["high_52week"] = technicals.get("high_52w")

    # If cache=False OR current_price or any ranges are still missing, fetch fresh quote from yfinance
    if (not cache or 
        not fundamentals.get("current_price") or 
        not fundamentals.get("day_low") or 
        not fundamentals.get("day_high") or 
        not fundamentals.get("low_52week") or 
        not fundamentals.get("high_52week") or
        "open" not in fundamentals or not fundamentals.get("open")):
        
        # Check in-memory rate-limiting cache first to prevent OOM spikes under high-frequency polling
        now = time.time()
        cached_quote, cached_time = _YFINANCE_FALLBACK_CACHE.get(symbol, (None, 0))
        if cached_quote and (now - cached_time < _YFINANCE_CACHE_TTL_SEC):
            # Merge cached quote details
            for k, v in cached_quote.items():
                if v is not None:
                    fundamentals[k] = v
        else:
            try:
                import yfinance as yf
                ticker_obj = yf.Ticker(symbol if '.' in symbol or symbol.startswith('^') else f"{symbol}.NS")
                info = ticker_obj.info
                if info:
                    fundamentals["current_price"] = info.get("currentPrice") or info.get("regularMarketPrice") or info.get("navPrice") or fundamentals.get("current_price")
                    fundamentals["day_high"] = info.get("dayHigh") or info.get("regularMarketDayHigh") or fundamentals.get("current_price")
                    fundamentals["day_low"] = info.get("dayLow") or info.get("regularMarketDayLow") or fundamentals.get("current_price")
                    fundamentals["low_52week"] = info.get("fiftyTwoWeekLow") or info.get("regularMarketFiftyTwoWeekLow") or fundamentals.get("current_price")
                    fundamentals["high_52week"] = info.get("fiftyTwoWeekHigh") or info.get("regularMarketFiftyTwoWeekHigh") or fundamentals.get("current_price")
                    
                    # Fetch new metrics for the enterprise meta banner
                    fundamentals["open"] = info.get("open") or info.get("regularMarketOpen")
                    fundamentals["previous_close"] = info.get("previousClose") or info.get("regularMarketPreviousClose")
                    fundamentals["volume"] = info.get("volume") or info.get("regularMarketVolume")
                    fundamentals["average_volume"] = info.get("averageVolume") or info.get("averageVolume10Days")
                    
                    # Update in-memory rate-limiting cache
                    quote_data = {
                        "current_price": fundamentals.get("current_price"),
                        "day_high": fundamentals.get("day_high"),
                        "day_low": fundamentals.get("day_low"),
                        "low_52week": fundamentals.get("low_52week"),
                        "high_52week": fundamentals.get("high_52week"),
                        "open": fundamentals.get("open"),
                        "previous_close": fundamentals.get("previous_close"),
                        "volume": fundamentals.get("volume"),
                        "average_volume": fundamentals.get("average_volume"),
                    }
                    _YFINANCE_FALLBACK_CACHE[symbol] = (quote_data, now)
            except Exception as e:
                print(f"Error fetching yfinance fallback quote for {symbol}: {e}")
            
    return {
        "fundamentals": fundamentals,
        "technicals": profile.get("technicals", {}) if profile else {},
        "analysis": profile.get("analysis", {}) if profile else {},
        "earnings_quality": profile.get("earnings_quality", {}) if profile else {},
        "capm_risk_nifty50": profile.get("capm_risk_nifty50", {}) if profile else {},
        "capm_risk_sector": profile.get("capm_risk_sector", {}) if profile else {}
    }


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
            
        df = await fetch_history_df(ticker, fetch_range, interval)
        if df.empty:
            raise HTTPException(status_code=404, detail="No price data returned from Yahoo Chart endpoint.")
        
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


@app.get("/api/chart/tv-chart-data")
async def get_tv_chart_data(
    ticker: str,
    period: str = "1y",
    interval: str = "1d",
    length: int = 14,
    mult: float = 1.0,
    int_sens: int = 3,
    ext_sens: int = 25,
    show_last: int = 10
):
    """
    Exposes raw candlestick data, EMAs, volume, custom Trendlines with Breaks,
    and Mxwll Price Action Suite calculations for high-fidelity TradingView Lightweight Charts overlays.
    """
    if not ticker:
        raise HTTPException(status_code=400, detail="Ticker parameter is required.")
    try:
        fetch_range = "2y"
        if interval == "1wk":
            fetch_range = "5y"
        elif interval == "1mo":
            fetch_range = "max"
            
        df = await fetch_history_df(ticker, fetch_range, interval)
        if df.empty:
            raise HTTPException(status_code=404, detail="No price data returned from Yahoo Chart endpoint.")
            
        df['EMA_20'] = df['Close'].ewm(span=20, adjust=False).mean()
        df['EMA_50'] = df['Close'].ewm(span=50, adjust=False).mean()
        
        from backend.swing_utils import calculate_trendlines_with_breaks, calculate_mxwll_suite, calculate_lux_smc
        breaks_data = calculate_trendlines_with_breaks(df, length=length, atr_mult=mult)
        mxwll_data = calculate_mxwll_suite(df, int_sens=int_sens, ext_sens=ext_sens, show_last=show_last)
        lux_smc_data = calculate_lux_smc(df, int_sens=int_sens, ext_sens=ext_sens, show_last=show_last)
        
        df['Resistance'] = breaks_data["resistance"]
        df['Support'] = breaks_data["support"]
        df['Bullish_Break'] = breaks_data["bullish_breaks"]
        df['Bearish_Break'] = breaks_data["bearish_breaks"]
        
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
            df_sliced = df.tail(60)
            
        candlesticks = []
        for idx in range(len(df_sliced)):
            row_idx = df_sliced.index[idx]
            candlesticks.append({
                "time": row_idx.strftime("%Y-%m-%d"),
                "open": round(float(df_sliced["Open"].iloc[idx]), 2),
                "high": round(float(df_sliced["High"].iloc[idx]), 2),
                "low": round(float(df_sliced["Low"].iloc[idx]), 2),
                "close": round(float(df_sliced["Close"].iloc[idx]), 2),
                "volume": round(float(df_sliced["Volume"].iloc[idx]), 2),
                "ema_20": round(float(df_sliced["EMA_20"].iloc[idx]), 2) if not pd.isna(df_sliced["EMA_20"].iloc[idx]) else None,
                "ema_50": round(float(df_sliced["EMA_50"].iloc[idx]), 2) if not pd.isna(df_sliced["EMA_50"].iloc[idx]) else None,
                "resistance": round(float(df_sliced["Resistance"].iloc[idx]), 2) if not pd.isna(df_sliced["Resistance"].iloc[idx]) else None,
                "support": round(float(df_sliced["Support"].iloc[idx]), 2) if not pd.isna(df_sliced["Support"].iloc[idx]) else None,
                "bullish_break": bool(df_sliced["Bullish_Break"].iloc[idx]),
                "bearish_break": bool(df_sliced["Bearish_Break"].iloc[idx])
            })
            
        return {
            "symbol": ticker,
            "period": period,
            "interval": interval,
            "length": length,
            "mult": mult,
            "candlesticks": candlesticks,
            "mxwll": mxwll_data,
            "lux_smc": lux_smc_data
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"TradingView chart data calculation error: {str(e)}")


@app.get("/api/chart/indicator-synthesis")
async def get_indicator_synthesis(
    ticker: str,
    indicator: str = "lux-algo",
    period: str = "1y",
    interval: str = "1d",
    length: int = 14,
    mult: float = 1.0,
    int_sens: int = 3,
    ext_sens: int = 25,
    show_last: int = 10
):
    """
    Synthesizes custom technical indicator calculations (LuxAlgo SMC, Trendlines with Breaks, or Mxwll)
    into a structured tactical summary using Groq LLM.
    """
    if not ticker:
        raise HTTPException(status_code=400, detail="Ticker parameter is required.")
        
    try:
        fetch_range = "2y"
        if interval == "1wk":
            fetch_range = "5y"
        elif interval == "1mo":
            fetch_range = "max"
            
        df = await fetch_history_df(ticker, fetch_range, interval)
        if df.empty:
            raise HTTPException(status_code=404, detail="No price data returned from Yahoo Chart endpoint.")
            
        # Get latest price details
        curr_price = round(float(df["Close"].iloc[-1]), 2)
        prev_price = round(float(df["Close"].iloc[-2]), 2) if len(df) > 1 else curr_price
        price_change = round(curr_price - prev_price, 2)
        pct_change = round((price_change / prev_price) * 100, 2) if prev_price > 0 else 0.0
        
        # Calculate standard ATR
        highs = df['High'].values
        lows = df['Low'].values
        closes = df['Close'].values
        tr = np.maximum(highs - lows, np.maximum(np.abs(highs - np.roll(closes, 1)), np.abs(lows - np.roll(closes, 1))))
        tr[0] = highs[0] - lows[0]
        atr_val = round(float(np.mean(tr[-14:])), 2)
        
        from backend.swing_utils import calculate_trendlines_with_breaks, calculate_mxwll_suite, calculate_lux_smc
        from backend.agent import call_groq_llm
        
        system_prompt = (
            "You are a professional Technical Analyst and Senior Market Strategist specializing in the Indian Stock Markets.\n"
            "Your objective is to provide a highly detailed, concise, and structured tactical analysis of the stock based *only* on the provided custom indicator calculations.\n"
            "In addition, analyze the historical structural levels, supports, resistances, and order blocks to identify any classic chart patterns (such as Double Tops/Bottoms, Head & Shoulders, Ascending/Descending Triangles, or Pennant/Wedge Breakouts). Specifically confirm if any classic pattern is active, forming, or breached, explaining the tactical implications.\n"
            "Format your response in structured Markdown. Start directly with the analysis. Avoid conversational preambles (like 'Here is the analysis...').\n"
            "Use clear bullet points and bold styling. Do not hallucinate prices; rely only on the structured indicators values provided in the prompt."
        )
        
        user_prompt = ""
        
        if indicator == "lux-algo":
            # Trendlines with Breaks
            breaks_data = calculate_trendlines_with_breaks(df, length=length, atr_mult=mult)
            last_res = next((x for x in reversed(breaks_data["resistance"]) if x is not None), None)
            last_sup = next((x for x in reversed(breaks_data["support"]) if x is not None), None)
            recent_bull_break = any(breaks_data["bullish_breaks"][-15:])
            recent_bear_break = any(breaks_data["bearish_breaks"][-15:])
            
            res_str = f"Rs. {last_res}" if last_res else "None identified"
            sup_str = f"Rs. {last_sup}" if last_sup else "None identified"
            
            user_prompt = (
                f"Perform a technical analysis for the stock ticker: {ticker}\n"
                f"Current Price: Rs. {curr_price} ({price_change:+.2f}, {pct_change:+.2f}%)\n"
                f"Active Indicator: LuxAlgo Trendlines with Breaks (Lookback: {length}, Slope Multiplier: {mult})\n\n"
                f"Calculated Metrics:\n"
                f"- Volatility (ATR-14): {atr_val}\n"
                f"- Active Support Trendline Price: {sup_str}\n"
                f"- Active Resistance Trendline Price: {res_str}\n"
                f"- Recent Bullish Breakout (last 15 bars): {'YES' if recent_bull_break else 'NO'}\n"
                f"- Recent Bearish Breakout (last 15 bars): {'YES' if recent_bear_break else 'NO'}\n\n"
                f"Based on these Trendlines with Breaks metrics, draft a brief, professional summary explaining the support and resistance structure. "
                f"Identify if the converging or parallel trendlines indicate a flag, pennant, or triangle consolidation pattern. "
                f"Explain the implications of any recent breakout, and set logical tactical stop loss and target bounds using the current ATR."
            )
            
        elif indicator == "lux-smc":
            # Smart Money Concepts (Note that length is used as ext_sens)
            smc = calculate_lux_smc(df, int_sens=int_sens, ext_sens=length, show_last=show_last)
            
            # Extract structures
            struct_list = []
            if smc.get("structures"):
                for s in smc["structures"][-5:]:
                    struct_list.append(f"{s['time']}: {s['type']} ({s['direction']}, Level: Rs. {s.get('price', 'N/A')})")
            struct_str = "\n".join(struct_list) if struct_list else "No recent structures detected"
            
            # Extract active OBs
            demand_obs = [ob for ob in smc.get("order_blocks", []) if ob["type"] == "demand"]
            supply_obs = [ob for ob in smc.get("order_blocks", []) if ob["type"] == "supply"]
            
            demand_str = ", ".join([f"Rs. {ob['bottom']}-{ob['top']}" for ob in demand_obs[-3:]]) if demand_obs else "None active"
            supply_str = ", ".join([f"Rs. {ob['bottom']}-{ob['top']}" for ob in supply_obs[-3:]]) if supply_obs else "None active"
            
            # Premium/Discount
            pd = smc.get("premium_discount", {})
            pd_str = f"Range: Rs. {pd.get('bottom')}-{pd.get('top')} (Equilibrium: Rs. {pd.get('equilibrium')})" if pd else "Unknown"
            
            pd_zone = "Neutral"
            if pd:
                eq = pd.get("equilibrium", 0)
                if curr_price > eq:
                    pd_zone = f"Premium Zone (above equilibrium of Rs. {eq})"
                elif curr_price < eq:
                    pd_zone = f"Discount Zone (below equilibrium of Rs. {eq})"
                    
            # MTF levels
            daily = smc.get("daily_levels", [])
            last_daily = daily[-1] if daily else None
            daily_str = f"High: Rs. {last_daily['high']}, Low: Rs. {last_daily['low']}" if last_daily else "N/A"
            
            user_prompt = (
                f"Perform a technical analysis for the stock ticker: {ticker}\n"
                f"Current Price: Rs. {curr_price} ({price_change:+.2f}, {pct_change:+.2f}%)\n"
                f"Active Indicator: LuxAlgo Smart Money Concepts (Internal Sens: {int_sens}, Swing Sens: {length})\n\n"
                f"Calculated Metrics:\n"
                f"- Volatility (ATR-14): {atr_val}\n"
                f"- Recent Structural Transitions (BOS/CHoCH):\n{struct_str}\n"
                f"- Unmitigated Demand Order Blocks (Buy Zone): {demand_str}\n"
                f"- Unmitigated Supply Order Blocks (Sell Zone): {supply_str}\n"
                f"- Premium / Discount Zones: {pd_str}\n"
                f"- Current Price Position: Sits in the {pd_zone}\n"
                f"- Prev Day High/Low (Daily levels): {daily_str}\n\n"
                f"Draft a tactical Smart Money report. Explain if the market bias is bullish or bearish based on the BOS/CHoCH structure. "
                f"Identify if the structure transitions and order block clusters signal a trend reversal pattern (like a Double Top/Bottom or Head & Shoulders) or a continuation flag. "
                f"Identify the key order blocks to monitor for pullbacks or reversals, and note whether the current price is in the premium or discount zone."
            )
            
        elif indicator == "mxwll":
            # Mxwll Suite (Note that length is used as ext_sens)
            mxwll = calculate_mxwll_suite(df, int_sens=int_sens, ext_sens=length, show_last=show_last)
            
            # Extract structures
            struct_list = []
            if mxwll.get("structures"):
                for s in mxwll["structures"][-5:]:
                    struct_list.append(f"{s['time']}: {s['type']} ({s['direction']}, Price: Rs. {s.get('price', 'N/A')})")
            struct_str = "\n".join(struct_list) if struct_list else "No recent structures detected"
            
            # OBs and FVGs
            demand_obs = [ob for ob in mxwll.get("order_blocks", []) if ob["type"] == "demand"]
            supply_obs = [ob for ob in mxwll.get("order_blocks", []) if ob["type"] == "supply"]
            demand_str = ", ".join([f"Rs. {ob['bottom']:.2f}-{ob['top']:.2f}" for ob in demand_obs[-3:]]) if demand_obs else "None active"
            supply_str = ", ".join([f"Rs. {ob['bottom']:.2f}-{ob['top']:.2f}" for ob in supply_obs[-3:]]) if supply_obs else "None active"
            
            fvgs = mxwll.get("fvg", [])
            fvg_str = ", ".join([f"{g['type']} (Rs. {g['bottom']:.2f}-{g['top']:.2f})" for g in fvgs[-3:]]) if fvgs else "None active"
            
            # Fib levels
            fibs = mxwll.get("fib_levels", {})
            fibs_str = ", ".join([f"{k}: Rs. {v}" for k, v in fibs.items() if k not in ["anchor_start_time", "anchor_end_time"]]) if fibs else "N/A"
            
            user_prompt = (
                f"Perform a technical analysis for the stock ticker: {ticker}\n"
                f"Current Price: Rs. {curr_price} ({price_change:+.2f}, {pct_change:+.2f}%)\n"
                f"Active Indicator: Mxwll Price Action Suite (Int Sens: {int_sens}, Ext Sens: {length})\n\n"
                f"Calculated Metrics:\n"
                f"- Volatility (ATR-14): {atr_val}\n"
                f"- Market Structures (BOS/CHoCH):\n{struct_str}\n"
                f"- Active Demand Zones (OBs): {demand_str}\n"
                f"- Active Supply Zones (OBs): {supply_str}\n"
                f"- Unmitigated Fair Value Gaps (FVGs): {fvg_str}\n"
                f"- Auto-Fibonacci Retracement Levels: {fibs_str}\n\n"
                f"Synthesize this price action report. Detail how the market structural transitions compare, analyze any unmitigated Fair Value Gaps (FVG) or Order Blocks. "
                f"Scan the price relative to Fibonacci levels to identify if any classic retracement patterns (such as a 61.8% Golden Pocket bounce or 50% equilibrium retest) are forming, "
                f"and explain where key Fibonacci support levels lie for planning exit/entry points."
            )
            
        else:
            user_prompt = (
                f"Perform a technical analysis for the stock ticker: {ticker}\n"
                f"Current Price: Rs. {curr_price} ({price_change:+.2f}, {pct_change:+.2f}%)\n"
                f"Active Indicator: Price and Volatility Only\n\n"
                f"Calculated Metrics:\n"
                f"- Volatility (ATR-14): {atr_val}\n"
                f"Write a standard short-term volatility and trend structure overview based on the price action, looking for basic double top/bottom patterns if price is consolidating near key extreme levels."
            )
            
        synthesis = await asyncio.to_thread(call_groq_llm, system_prompt, user_prompt)
        return {
            "symbol": ticker,
            "indicator": indicator,
            "synthesis": synthesis
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Indicator LLM synthesis failure: {str(e)}")


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
        
        # Double decimal point formatting variables for prompts and fallback synthesis
        sma_50_str = f"{sma_50:.2f}" if isinstance(sma_50, (int, float)) else "0.00"
        sma_200_str = f"{sma_200:.2f}" if isinstance(sma_200, (int, float)) else "0.00"
        
        cfo_to_pat = fundamentals.get("cfo_to_pat", 0.88)
        cfo_to_pat_str = f"{cfo_to_pat:.2f}" if isinstance(cfo_to_pat, (int, float)) else "0.88"
        
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

        # --- DYNAMIC PRICE-VOLUME & REAL BULK DEALS ANALYSIS ---
        delivery_z_score = 0.0
        vsa_pattern = "Normal Price Action"
        vsa_type = "neutral"
        vsa_desc = "No significant Volume Spread Analysis patterns or anomalies detected."
        poc_price = current_price
        real_deals_summary = []
        real_deals_list = []

        try:
            import requests
            import pandas as pd
            from backend.swing_utils import calculate_volume_profile
            from backend.quant_scoring import detect_vsa_setup, calculate_delivery_zscore
            
            # Fetch Yahoo Finance (6mo) for chart analysis
            df = await fetch_history_df(ticker, "6mo", "1d")
            if not df.empty:
                display_bars = min(60, len(df))
                df_display = df.iloc[-display_bars:]
                
                # Fetch SQLite delivery history
                delivery_history = {}
                try:
                    with get_db() as conn:
                        cursor = conn.cursor()
                        cursor.execute("""
                            SELECT trade_date, delivery_qty, traded_qty, delivery_percentage 
                            FROM daily_delivery_history 
                            WHERE symbol = ? 
                            ORDER BY trade_date ASC
                        """, (ticker,))
                        for r_row in cursor.fetchall():
                            delivery_history[r_row["trade_date"]] = {
                                "delivery_qty": r_row["delivery_qty"],
                                "traded_qty": r_row["traded_qty"],
                                "delivery_percentage": r_row["delivery_percentage"]
                            }
                except Exception as db_err:
                    print(f"Error querying delivery history in synthesis: {db_err}")
                    
                # Fetch corporate actions
                corporate_actions = []
                try:
                    with get_db() as conn:
                        cursor = conn.conn.cursor() if hasattr(conn, "conn") else conn.cursor()
                        cursor.execute("""
                            SELECT action_type, ex_date, ratio_multiplier 
                            FROM corporate_actions 
                            WHERE symbol = ?
                        """, (ticker,))
                        for ca_row in cursor.fetchall():
                            corporate_actions.append({
                                "action_type": ca_row["action_type"],
                                "ex_date": ca_row["ex_date"],
                                "ratio_multiplier": ca_row["ratio_multiplier"]
                            })
                except Exception as ca_err:
                    print(f"Error querying corporate actions in synthesis: {ca_err}")
                    
                # Process delivery values
                historical_delivery_values = []
                
                df["Vol_20MA"] = df["Volume"].rolling(window=20).mean().ffill().bfill()
                df_display_with_ma = df.iloc[-display_bars:]
                
                for idx in range(len(df_display_with_ma)):
                    bar_date = df_display_with_ma.index[idx].strftime("%Y-%m-%d")
                    vol = float(df_display_with_ma["Volume"].iloc[idx])
                    close_p = float(df_display_with_ma["Close"].iloc[idx])
                    
                    if bar_date in delivery_history:
                        deliv_pct = delivery_history[bar_date]["delivery_percentage"]
                        deliv_qty = delivery_history[bar_date]["delivery_qty"]
                        traded_qty = delivery_history[bar_date]["traded_qty"]
                        
                        # Clean None values from database
                        if deliv_pct is None:
                            deliv_pct = 0.0
                        if traded_qty is None:
                            traded_qty = int(vol)
                        if deliv_qty is None:
                            deliv_qty = 0
                    else:
                        deliv_pct = 0.0
                        traded_qty = int(vol)
                        deliv_qty = 0
                        
                    for ca in corporate_actions:
                        if bar_date < ca["ex_date"]:
                            if deliv_qty is not None:
                                deliv_qty = int(deliv_qty * ca["ratio_multiplier"])
                            if traded_qty is not None:
                                traded_qty = int(traded_qty * ca["ratio_multiplier"])
                            
                    historical_delivery_values.append((deliv_qty or 0) * close_p)
                        
                    latest_row = df_display_with_ma.iloc[-1]
                    latest_vol_ma = df_display_with_ma["Vol_20MA"].iloc[-1]
                    vsa_result = detect_vsa_setup(
                        latest_row["Open"], latest_row["High"], latest_row["Low"], latest_row["Close"],
                        latest_row["Volume"], latest_vol_ma
                    )
                    delivery_z_score = calculate_delivery_zscore(historical_delivery_values)
                    if vsa_result:
                        vsa_pattern = vsa_result["pattern"]
                        vsa_desc = vsa_result["description"]
                        vsa_type = vsa_result["type"]
                        
                    # Calculate POC
                    vprofile = calculate_volume_profile(df_display_with_ma, bins=12)
                    if vprofile and len(vprofile) > 0:
                        max_bin = max(vprofile, key=lambda x: x["volume"])
                        poc_price = max_bin["price"]
        except Exception as pva_err:
            print(f"Error calculating dynamic volume metrics in synthesis: {pva_err}")

        if poc_price <= 0.0:
            poc_price = current_price

        # Fetch REAL bulk/block deals (filter is_mock = 0)
        try:
            with get_db() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    SELECT deal_date, client_name, deal_type, quantity, price, percentage_equity, deal_window, is_mock 
                    FROM bulk_block_deals 
                    WHERE symbol = ? AND (is_mock = 0 OR is_mock = FALSE OR is_mock IS NULL)
                    ORDER BY deal_date DESC
                """, (ticker,))
                for row in cursor.fetchall():
                    deal_dict = dict(row)
                    real_deals_list.append(deal_dict)
                    real_deals_summary.append(
                        f"{deal_dict['deal_date']}: {deal_dict['deal_type']} of {deal_dict['quantity']:,} shares @ Rs.{deal_dict['price']} by {deal_dict['client_name']} ({deal_dict['deal_window']}, Equity%: {deal_dict['percentage_equity'] or 0.0}%)"
                    )
        except Exception as deals_err:
            print(f"Error fetching real deals for synthesis: {deals_err}")

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
        
        rec_upper = str(recommendation).upper()
        if "BUY" in rec_upper:
            verdict_action = "TACTICAL BUY"
        elif "SELL" in rec_upper:
            verdict_action = "STRATEGIC AVOID"
        else:
            verdict_action = "NEUTRAL HOLD"

        vsa_verdict = "Institutional Accumulation" if delivery_z_score >= 1.0 else ("Distribution Pressure" if delivery_z_score <= -1.0 else "Speculative Churn")
        verdict_matrix_md = (
            f"| Strategic Dimension | Supporting Key Metrics | Programmatic AI Verdict |\n"
            f"| :--- | :--- | :--- |\n"
            f"| **I. Solvency & Quality** | F-Score: **{piotroski_score}/9**, Z-Score: **{altman_z_score:.2f}** | **{solvency_status}** |\n"
            f"| **II. Valuation & Margin** | Intrinsic MOS: **{margin_of_safety:+.1f}%**, PE vs Peers: **{pe_diff_pct:+.1f}%** | **{valuation_status}** |\n"
            f"| **III. Technical Velocity** | RSI: **{rsi:.1f}**, Trend: **{technicals.get('trend_50_vs_200', 'Neutral')}** | **{technical_status}** |\n"
            f"| **IV. VSA & Smart Money** | Z-Score: **{delivery_z_score:+.2f}**, POC Floor: **Rs. {poc_price:.2f}** | **{vsa_verdict}** |\n"
            f"| **V. CAPM Risk-Reward** | Beta: **{nifty50_beta:.2f}**, Alpha: **{nifty50_alpha_str}** | **{capm_status}** |\n"
            f"| **VI. CIO Bottom-Line** | Composite Score: **{final_score}/100** | **{verdict_action}** |"
        )

        system_prompt = (
            "You are the Chief Investment Officer (CIO) of a premier Indian equities advisory firm managing an autonomous multi-agent stock research panel.\n"
            "Your task is to compile a highly coherent, institutional-grade 360-degree AI Multi-Agent Verdict Debate for the specified stock.\n"
            "The prospectus MUST analyze and synthesize all provided technical and fundamental parameters, their inter-relationships, and yield a final verdict.\n"
            "You must structure the debate under exactly five distinct sections, using the exact markdown subheadings provided below:\n"
            "\n"
            "### I. Operational Quality & Solvency Scorecard\n"
            "Use the following HTML block structure to present a debate between the Fundamental Analyst and the Sentiment & Smart Money Auditor:\n"
            "<div class=\"agent-debate-block fundamental\">\n"
            "  <div class=\"agent-header\">📊 Fundamental & Valuation Analyst</div>\n"
            "  <div class=\"agent-comment\">Detail the operational and solvency parameters: Piotroski F-Score, Altman Z-Score, Debt-to-Equity ratio, current ratios, and CFO to PAT conversion. Highlight strengths or leverage concerns. Use bold markup for figures (e.g. **8/9**, **2.45**).</div>\n"
            "</div>\n"
            "<div class=\"agent-debate-block sentiment\">\n"
            "  <div class=\"agent-header\">🛡️ Sentiment & Smart Money Auditor</div>\n"
            "  <div class=\"agent-comment\">Respond from a governance and risk perspective, auditing promoter pledges (if any), FII/DII holdings, and how leverage/pledging impacts capital safety.</div>\n"
            "</div>\n"
            "\n"
            "### II. Valuation & Peer Benchmarking\n"
            "Use the following HTML block structure to present a debate on intrinsic value:\n"
            "<div class=\"agent-debate-block fundamental\">\n"
            "  <div class=\"agent-header\">📊 Fundamental & Valuation Analyst</div>\n"
            "  <div class=\"agent-comment\">Analyze the WACC, DCF intrinsic value against the current price, the margin of safety, trailing PE, PEG ratio, PB ratio, and comparisons relative to the peer group and sector medians. Discuss value drivers and pricing premiums/discounts. Use bold markup (e.g. **Rs. 1,420**, **12.5%**).</div>\n"
            "</div>\n"
            "<div class=\"agent-debate-block technical\">\n"
            "  <div class=\"agent-header\">📈 Technical & VSA Tactician</div>\n"
            "  <div class=\"agent-comment\">React to the valuation thesis. Discuss if the technical price action and chart supports this value or if market price lags/leads the intrinsic value.</div>\n"
            "</div>\n"
            "\n"
            "### III. Technical Timing & Fibonacci Zones\n"
            "Use the following HTML block structure to present the timing debate:\n"
            "<div class=\"agent-debate-block technical\">\n"
            "  <div class=\"agent-header\">📈 Technical & VSA Tactician</div>\n"
            "  <div class=\"agent-comment\">Analyze 14-day RSI, 50-day and 200-day SMAs (Golden Cross / Death Cross), 52-week High and Low boundaries (distance and proximity), Fibonacci retracement levels, Bollinger squeeze width, ATR volatility stop floor, MACD signal status, Volume Price Trend (VPT), smart money Deliverable Z-Score, VSA patterns, and Point of Control (POC) support floor. Use bold markup (e.g. **Rs. 420.50**, **48.2**).</div>\n"
            "</div>\n"
            "<div class=\"agent-debate-block fundamental\">\n"
            "  <div class=\"agent-header\">📊 Fundamental & Valuation Analyst</div>\n"
            "  <div class=\"agent-comment\">React to the technical setup. Comment on whether these support lines and breakout channels align with long-term earnings growth.</div>\n"
            "</div>\n"
            "\n"
            "### IV. CAPM Risk Analytics & Market Capture\n"
            "Use the following HTML block structure to present systematic risk analysis:\n"
            "<div class=\"agent-debate-block technical\">\n"
            "  <div class=\"agent-header\">📈 Technical & VSA Tactician</div>\n"
            "  <div class=\"agent-comment\">Review risk parameters: systematic Beta, Alpha, and Correlation relative to both Nifty 50 and capitalization index. Discuss Upside/Downside Capture percentages, Maximum Drawdowns, and recovery durational history. Use bold markup.</div>\n"
            "</div>\n"
            "After this block, you must append the EXACT markdown table representing the Polymorphic Benchmark Comparison Matrix (do not omit or alter it).\n"
            "\n"
            "### V. CIO Investment Prospectus & Conviction Summary\n"
            "Use the following HTML block structure to present the ultimate verdict debate:\n"
            "<div class=\"agent-debate-block fundamental\">\n"
            "  <div class=\"agent-header\">📊 Fundamental & Valuation Analyst</div>\n"
            "  <div class=\"agent-comment\">Summarize the core long-term investment case based on quality metrics and DCF margin of safety.</div>\n"
            "</div>\n"
            "<div class=\"agent-debate-block technical\">\n"
            "  <div class=\"agent-header\">📈 Technical & VSA Tactician</div>\n"
            "  <div class=\"agent-comment\">Summarize entry/exit timing based on moving averages, RSI, and smart money deliverable accumulation trends.</div>\n"
            "</div>\n"
            "<div class=\"agent-debate-block cio\">\n"
            "  <div class=\"agent-header\">⚖️ Lead CIO Referee (Consensus Moderator)</div>\n"
            "  <div class=\"agent-comment\">Synthesize the relationships and conflicts between all technical, fundamental, and governance parameters (e.g. high PE but strong support, or high quality but bearish trend). Declare the final strategic consensus recommendation (Tactical BUY, Strategic AVOID, or Neutral HOLD) with a clear, definitive, and comprehensive explanation. Incorporate the Composite AI Conviction Score, suggested Buy/Entry price range, and suggested Sell/Exit target range.</div>\n"
            "</div>\n"
            "After this block, you must append the EXACT markdown table of the Strategic Investment Verdict Matrix (do not omit or alter it).\n"
            "\n"
            "Maintain an objective, institutional, and analytical tone. Do not use bullet points or list items outside the markdown tables."
        )

        user_prompt = f"""
        Company: {profile.get('company_name', symbol)} ({ticker})
        Investor Profile: Horizon: {horizon} | Risk: {risk}
        
        1. Operational Quality & Solvency Scorecard:
        - Piotroski F-Score: {piotroski_score}/9 ({piotroski_label})
        - Altman Z-Score: {altman_z_score:.2f} ({altman_zone})
        - Debt-to-Equity: {fundamentals.get('debt_to_equity', 'N/A')}
        - Current Ratio: {fundamentals.get('current_ratio', 'N/A')}
        - CFO to PAT Ratio: {cfo_to_pat_str}
        
        2. Valuation & Sector Peer Benchmarking:
        - Current Price: Rs. {current_price}
        - DCF Intrinsic Value: Rs. {dcf_intrinsic_value:.2f} (Margin of Safety: {margin_of_safety:.1f}%, Status: {dcf.get('valuation_rating', 'N/A')})
        - PE Ratio: {target_pe:.1f} (Peer Group Median PE: {median_peer_pe:.2f}, Comparison: {valuation_comparison})
        - PB Ratio: {target_pb:.2f} (Peer Group Median PB: {median_peer_pb:.2f}, Comparison: {pb_comparison})
        - PEG Ratio: {scoring.get('peg_ratio', 'N/A')}
        
        3. Technical Timing, Volatility & Momentum:
        - 14-day RSI: {rsi:.1f} ({technicals.get('rsi_status', 'Neutral')})
        - 50-day SMA: Rs. {sma_50_str} | 200-day SMA: Rs. {sma_200_str} (Trend: {technicals.get('trend_50_vs_200', 'N/A')})
        - Breakout Status: {technicals.get('breakout_status', 'N/A')} ({technicals.get('breakout_desc', 'N/A')})
        - Fibonacci Levels: {json.dumps(fib_levels)}
        - Current Fibonacci Retracement Zone: {fib_zone}
        - Bollinger Bands: Lower: Rs. {bb_lower:.2f} | Upper: Rs. {bb_upper:.2f} (Squeeze Width: {squeeze_pct:.1f}%)
        - ATR: Rs. {atr:.2f} (Volatility Rating: {vol_level} at {volatility_ratio:.1f}% ratio)
        - Volatility-Adjusted 2x ATR Stop Floor: Rs. {atr_stop_loss:.2f}
        - MACD Value: {macd:.2f} (Signal: {macd_signal:.2f}, Hist: {macd_hist:.2f}, Status: {macd_status})
        - Volume Price Trend (VPT): {vpt:.0f} ({vpt_status})
        - Deliverable Volume Z-Score: {delivery_z_score:.2f}
        - Volume Spread Analysis (VSA) Pattern: {vsa_pattern} ({vsa_desc})
        - Point of Control (POC) Level: Rs. {poc_price:.2f}
        
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
                f"<div class=\"agent-debate-block fundamental\">\n"
                f"  <div class=\"agent-header\">📊 Fundamental & Valuation Analyst</div>\n"
                f"  <div class=\"agent-comment\">Financial audits of **{profile.get('company_name', symbol)}** show a Piotroski F-Score of **{piotroski_score}/9** ({piotroski_label}) and an Altman Z-Score of **{altman_z_score:.2f}** ({altman_zone}). Leverage is comfortable with a Debt-to-Equity of **{fundamentals.get('debt_to_equity', 0.0):.2f}x** and conversion cash quality is strong at a CFO to PAT ratio of **{cfo_to_pat_str}x**. Solvency remains secure.</div>\n"
                f"</div>\n"
                f"<div class=\"agent-debate-block sentiment\">\n"
                f"  <div class=\"agent-header\">🛡️ Sentiment & Smart Money Auditor</div>\n"
                f"  <div class=\"agent-comment\">Pledging stats report promoter pledging is at **{fundamentals.get('promoter_pledge_pct', 0.0):.1f}%** with institutional holdings backing the structure. No high-priority governance warnings exist.</div>\n"
                f"</div>"
            )
            p2 = (
                f"### II. Valuation & Peer Benchmarking\n"
                f"<div class=\"agent-debate-block fundamental\">\n"
                f"  <div class=\"agent-header\">📊 Fundamental & Valuation Analyst</div>\n"
                f"  <div class=\"agent-comment\">Intrinsic value calculations establish DCF Fair Value at **Rs. {dcf_intrinsic_value:.2f}**, offering a **{margin_of_safety:.1f}% margin of safety** ({dcf.get('valuation_rating', 'Fairly Valued')}). Trailing PE of **{target_pe:.1f}** {valuation_comparison} against peer group median PE of **{median_peer_pe:.2f}**. PEG ratio stands at **{scoring.get('peg_ratio', 'N/A')}**.</div>\n"
                f"</div>\n"
                f"<div class=\"agent-debate-block technical\">\n"
                f"  <div class=\"agent-header\">📈 Technical & VSA Tactician</div>\n"
                f"  <div class=\"agent-comment\">Price is currently **Rs. {current_price}**. Looking at PEG and peer multiples, the current entry zone corresponds to minor support consolidations.</div>\n"
                f"</div>"
            )
            p3 = (
                f"### III. Technical Timing & Fibonacci Zones\n"
                f"<div class=\"agent-debate-block technical\">\n"
                f"  <div class=\"agent-header\">📈 Technical & VSA Tactician</div>\n"
                f"  <div class=\"agent-comment\">The daily chart shows the price **{fib_zone}**. SMA parameters: 50-day SMA is at **Rs. {sma_50_str}** and 200-day SMA is at **Rs. {sma_200_str}** (**{technicals.get('trend_50_vs_200', 'Neutral')}** trend). RSI (14) is at **{rsi:.1f}** ({technicals.get('rsi_status', 'Neutral')}). Bollinger Squeeze width is **{squeeze_pct:.1f}%**, volatility is **{vol_level}** with ATR of **Rs. {atr:.2f}**, and volatility stop floor is at **Rs. {atr_stop_loss:.2f}**. MACD reports **{macd:.2f}** (Signal: **{macd_signal:.2f}** | **{macd_status}**). VPT is at **{vpt:.0f}**. smart money Deliverable Z-Score is **{delivery_z_score:+.2f}** with VSA Pattern diagnosis: **{vsa_pattern}** ({vsa_desc}). Liquidity POC support sits at **Rs. {poc_price:.2f}**.</div>\n"
                f"</div>\n"
                f"<div class=\"agent-debate-block fundamental\">\n"
                f"  <div class=\"agent-header\">📊 Fundamental & Valuation Analyst</div>\n"
                f"  <div class=\"agent-comment\">The technical consolidation zones around POC support of **Rs. {poc_price:.2f}** and the 52w range limits align with DCF intrinsic floors, representing low-risk accumulation.</div>\n"
                f"</div>"
            )
            p4 = (
                f"### IV. CAPM Risk Analytics & Market Capture\n"
                f"<div class=\"agent-debate-block technical\">\n"
                f"  <div class=\"agent-header\">📈 Technical & VSA Tactician</div>\n"
                f"  <div class=\"agent-comment\">Broad market Beta is **{nifty50_beta:.2f}**, Alpha is **{nifty50_alpha:.2f}%**, and Correlation is **{nifty50_corr:.2f}** relative to Nifty 50. Relative to {sector_bench_name}, Beta is **{sector_beta:.2f}**, Alpha is **{sector_alpha:.2f}%**, and Correlation is **{sector_corr:.2f}**. Market Capture: Upside capture is **{up_capture:.1f}%** and Downside capture is **{down_capture:.1f}%**. Max Drawdown is **{max_dd:.1f}%** with recovery times of **{worst_dd_days} days**.</div>\n"
                f"</div>\n\n"
                f"**Polymorphic Benchmark Comparison Matrix:**\n\n"
                f"{matrix_md}"
            )
            deals_sum_str = "; ".join(real_deals_summary[:3]) if real_deals_summary else "no real bulk/block transactions recorded"
            p5 = (
                f"### V. CIO Investment Prospectus & Conviction Summary\n"
                f"<div class=\"agent-debate-block fundamental\">\n"
                f"  <div class=\"agent-header\">📊 Fundamental & Valuation Analyst</div>\n"
                f"  <div class=\"agent-comment\">Strong margin of safety of **{margin_of_safety:.1f}%** and excellent return ratios support a long-term investment case.</div>\n"
                f"</div>\n"
                f"<div class=\"agent-debate-block technical\">\n"
                f"  <div class=\"agent-header\">📈 Technical & VSA Tactician</div>\n"
                f"  <div class=\"agent-comment\">Consolidation support at the POC floor of **Rs. {poc_price:.2f}** and a neutral RSI indicator favor accumulative entries.</div>\n"
                f"</div>\n"
                f"<div class=\"agent-debate-block cio\">\n"
                f"  <div class=\"agent-header\">⚖️ Lead CIO Referee (Consensus Moderator)</div>\n"
                f"  <div class=\"agent-comment\">Considering the interplay of safe solvency (Altman Z of **{altman_z_score:.2f}**), strong valuation margin, and robust smart money support (Deliverable Z of **{delivery_z_score:+.2f}**), we issue a **{recommendation}** verdict for the **{horizon}** horizon. AI composite conviction score is **{final_score}/100**. Actionable buy/entry range is suggested at **{profile.get('analysis', {}).get('suggested_buy_price_range', 'Rs. ' + str(round(current_price * 0.95)) + ' - Rs. ' + str(round(current_price * 1.02)))}**, and suggested sell/exit range is at **{profile.get('analysis', {}).get('suggested_sell_price_range', 'Rs. ' + str(round(current_price * 1.15)) + ' - Rs. ' + str(round(current_price * 1.25)))}**.</div>\n"
                f"</div>\n\n"
                f"**Strategic Investment Verdict Matrix:**\n\n"
                f"{verdict_matrix_md}"
            )
            synthesis_text = f"{p1}\n\n{p2}\n\n{p3}\n\n{p4}\n\n{p5}"

        # Compute individual agent conviction scores out of 100
        f_score_val = scoring.get("fundamental_score", 15.0)
        v_score_val = scoring.get("valuation_score", 12.0)
        g_score_val = scoring.get("growth_score", 7.0)
        fundamental_conviction = int(((f_score_val + v_score_val + g_score_val) / 70.0) * 100.0)
        fundamental_conviction = min(100, max(0, fundamental_conviction))
        
        t_score_val = scoring.get("technical_score", 12.0)
        technical_conviction = int((t_score_val / 25.0) * 100.0)
        technical_conviction = min(100, max(0, technical_conviction))
        
        s_score_val = scoring.get("sentiment_score", 2.0)
        sentiment_bonus = 1.0 if delivery_z_score >= 1.0 else 0.0
        sentiment_conviction = int(((s_score_val + sentiment_bonus) / 6.0) * 100.0)
        sentiment_conviction = min(100, max(0, sentiment_conviction))
        
        friction_points = []
        if pe_diff_pct > 20.0:
            friction_points.append(f"Valuation Friction: Trades at a high P/E multiple premium of {pe_diff_pct:+.1f}% compared to peers.")
        if margin_of_safety < 0.0:
            friction_points.append(f"Margin of Safety Deficit: Current market price trades at a {-margin_of_safety:.1f}% valuation premium over DCF Fair Value (Rs. {dcf_intrinsic_value:.2f}).")
        if current_price < sma_200:
            friction_points.append(f"Bearish Trend Alignment: Price is structurally locked below its long-term 200-day SMA of Rs. {sma_200:.2f}.")
        if promoter_pledge_pct > 15.0:
            friction_points.append(f"Governance Drag: Promoter share pledging is elevated at {promoter_pledge_pct:.1f}% representing capital collateral risk.")
        if fundamentals.get("debt_to_equity", 0.0) > 1.2:
            friction_points.append(f"Balance Sheet Friction: Elevated Debt-to-Equity ratio of {fundamentals.get('debt_to_equity', 0.0):.2f}x restricts fiscal leverage.")
        if rsi > 70.0:
            friction_points.append(f"Overbought Friction: Daily RSI (14) at {rsi:.1f} signals short-term momentum overextension.")
        elif rsi < 30.0:
            friction_points.append(f"Oversold Momentum: Daily RSI (14) at {rsi:.1f} signals steep downward capitalization trends.")

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
            "risk_warning_flags": warning_flags,
            "delivery_z_score": delivery_z_score,
            "vsa_pattern": vsa_pattern,
            "vsa_type": vsa_type,
            "poc_price": poc_price,
            "real_deals": real_deals_list,
            "friction_points": friction_points,
            "fundamental_conviction": fundamental_conviction,
            "technical_conviction": technical_conviction,
            "sentiment_conviction": sentiment_conviction
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI Synthesis compilation failed: {str(e)}")

@app.post("/api/chat")
async def advisory_chat(request: ChatRequest):
    """Stateful context-retained advisory chat console."""
    try:
        # Fetch current watchlists for chat context
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT id, name FROM watchlists")
            watchlists = [dict(row) for row in cursor.fetchall()]

        history_list = [{"role": msg.role, "content": msg.content} for msg in request.history]
        response_text = await asyncio.to_thread(
            run_conversational_chat,
            history_list, 
            request.message, 
            request.profile,
            None,
            watchlists
        )
        
        actions = []
        clean_response = response_text
        if "[ACTIONS_PAYLOAD]:" in response_text:
            try:
                parts = response_text.split("[ACTIONS_PAYLOAD]:")
                clean_response = parts[0].strip()
                import json
                actions = json.loads(parts[1].strip())
            except Exception as e:
                print(f"Error parsing ACTIONS_PAYLOAD: {e}")
                
        return {"response": clean_response, "actions": actions}
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

        # Register with real-time AlertEvaluator if Angel One is active
        from backend.websocket_server import alert_evaluator as _ae
        if _ae is not None:
            _ae.register_alert({
                "id": alert_id,
                "ticker": data.ticker.upper(),
                "condition_type": data.condition_type.upper(),
                "operator": data.operator,
                "value": data.value,
            })
            # Subscribe to this symbol on Angel One upstream
            plain_sym = data.ticker.upper().replace(".NS", "")
            subscribe_symbols([plain_sym])

        return {
            "id": alert_id,
            "ticker": data.ticker.upper(),
            "condition_type": data.condition_type.upper(),
            "operator": data.operator,
            "value": data.value,
            "status": "Active",
            "triggered": False,
            "trigger_date": "",
            "ai_context": ""
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to set alert: {str(e)}")

@app.post("/api/alerts/parse-nl")
async def parse_nl_alert(data: ParseNLAlertRequest):
    """Parses a plain English prompt into a structured SQLite alert rule using Groq LLM."""
    try:
        from backend.agent import call_groq_llm
        from backend.financial_utils import resolve_company_ticker

        fallback_context = ""
        if data.active_ticker:
            fallback_context = f"\nActive Ticker Context: {data.active_ticker}. If the user alert setup prompt does not explicitly specify a stock/company name or ticker, you MUST default to using this ticker for the rule. Do not default to TCS or any other stock if this active ticker context is provided.\n"

        sys_prompt = (
            "You are an expert financial system developer parsing plain English alert setup requests into structured JSON rules.\n"
            f"{fallback_context}"
            "Analyze the user prompt and output a single JSON object. DO NOT output any markdown tags (like ```json), and DO NOT output any conversational text or preambles. Only output the raw JSON string.\n"
            "Allowed condition types:\n"
            "- RSI (Relative Strength Index limit)\n"
            "- PE (Price-to-Earnings, value is median check 'MEDIAN' or multiple number)\n"
            "- RATING (analyst recommendation, e.g., 'Strong Buy', 'Buy', 'Hold', 'Sell')\n"
            "- PRICE (absolute price floor/ceiling in Rs.)\n"
            "- SMA (price deviation from 200 SMA in %, e.g., 5.0 for 5% above, -3.0 for 3% below)\n"
            "- DMA_CROSS (50 SMA vs 200 SMA crossover, value represents percentage separation filter, e.g. 0.0 or 1.5)\n"
            "- EMA_CROSS (50 EMA vs 200 EMA crossover, value represents percentage separation filter, e.g. 0.0 or 1.0)\n"
            "- VOL_BREAKOUT (volume ratio vs 20d average, e.g., 2.0)\n"
            "- BB_CROSS (price vs Bollinger Bands, value is 0)\n"
            "- MACD_CROSS (MACD vs Signal line crossover, value is absolute point difference filter, e.g. 0.0 or 0.5)\n"
            "- 52W_PROXIMITY (proximity margin % to 52w limits, e.g. 3.0)\n"
            "- SMA50 (price deviation from 50 SMA in %, e.g. 2.0 or -2.0)\n"
            "- FIB_LEVEL (proximity to any Fib level in %, e.g. 1.5)\n"
            "- FIB_382 (proximity to Fib 38.2% in %, e.g. 1.5)\n"
            "- FIB_500 (proximity to Fib 50.0% in %, e.g. 1.5)\n"
            "- FIB_618 (proximity to Fib 61.8% in %, e.g. 1.5)\n"
            "- COMPOUND (logical combination of multiple simple rules using AND or OR operators)\n\n"
            "Operators:\n"
            "- '>' (Greater Than / Crosses Above)\n"
            "- '<' (Less Than / Crosses Below)\n"
            "- '==' (Equals / Near Proximity - mandatory for FIB and RATING conditions)\n\n"
            "CRITICAL RULES FOR COMPOUND ALERTS:\n"
            "If the request contains multiple alert parameters combined via logical operators 'and', 'or', '&&', '||' (e.g. 'price below 2000 and rsi under 40'), you MUST:\n"
            "1. Set 'condition_type': 'COMPOUND'\n"
            "2. Set 'operator': ''\n"
            "3. Set 'value': to a JSON string representation of a list of conditions and logical operators. For example, if user asks: 'price is below 2000 and rsi is under 40', you must set 'value' to the string: '[{\"indicator\": \"PRICE\", \"operator\": \"<\", \"value\": \"2000\"}, {\"operator\": \"AND\"}, {\"indicator\": \"RSI\", \"operator\": \"<\", \"value\": \"40\"}]'. Note that logical operator items only have the 'operator' field, whereas rule items have 'indicator', 'operator', and 'value' fields.\n\n"
            "Output format example for simple alert:\n"
            "{\n"
            "  \"ticker_query\": \"TCS\",\n"
            "  \"condition_type\": \"EMA_CROSS\",\n"
            "  \"operator\": \">\",\n"
            "  \"value\": \"0.0\"\n"
            "}\n\n"
            "Output format example for compound alert:\n"
            "{\n"
            "  \"ticker_query\": \"TCS\",\n"
            "  \"condition_type\": \"COMPOUND\",\n"
            "  \"operator\": \"\",\n"
            "  \"value\": \"[{\\\"indicator\\\": \\\"PRICE\\\", \\\"operator\\\": \\\"<\\\", \\\"value\\\": \\\"2000\\\"}, {\\\"operator\\\": \\\"AND\\\"}, {\\\"indicator\\\": \\\"RSI\\\", \\\"operator\\\": \\\"<\\\", \\\"value\\\": \\\"40\\\"}]\"\n"
            "}"
        )

        response = await asyncio.to_thread(call_groq_llm, sys_prompt, data.prompt)
        response = response.strip()
        if response.startswith("```json"):
            response = response[7:]
        if response.endswith("```"):
            response = response[:-3]
        response = response.strip()

        parsed = json.loads(response)
        ticker_query = parsed.get("ticker_query", "TCS")
        cond_type = parsed.get("condition_type", "PRICE").upper()
        op = parsed.get("operator", ">")
        val = parsed.get("value", "0.0")

        try:
            res = resolve_company_ticker(ticker_query)
            ticker = res["yf_ticker"]
        except Exception:
            ticker = ticker_query.strip().upper()
            if not ticker.endswith(".NS") and not ticker.endswith(".BO"):
                ticker += ".NS"

        alert_id = str(uuid.uuid4())[:8]
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO alerts (id, ticker, condition_type, operator, value) VALUES (?, ?, ?, ?, ?)",
                (alert_id, ticker, cond_type, op, val)
            )
            conn.commit()

        return {
            "id": alert_id,
            "ticker": ticker,
            "condition_type": cond_type,
            "operator": op,
            "value": val,
            "status": "Active",
            "triggered": False,
            "trigger_date": "",
            "ai_context": ""
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse and configure alert: {str(e)}")

@app.get("/api/alerts/list")
async def list_alerts():
    """Returns all alerts from SQLite."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, ticker, condition_type, operator, value, status, triggered, trigger_date, ai_context FROM alerts")
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
                "trigger_date": row["trigger_date"],
                "ai_context": row["ai_context"]
            }
            for row in rows
        ]

@app.get("/api/alerts/settings")
async def get_alert_settings():
    """Returns the alert settings (WhatsApp from env, Slack/Discord from SQLite)."""
    wa_token = os.environ.get("WHATSAPP_TOKEN", "")
    wa_phone_id = os.environ.get("WHATSAPP_PHONE_ID", "")
    wa_recipient = os.environ.get("WHATSAPP_RECIPIENT", "")
    masked_token = ""
    if wa_token:
        masked_token = "*" * 20 + wa_token[-8:] if len(wa_token) > 8 else wa_token
    
    slack_webhook = ""
    discord_webhook = ""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT key, value FROM alert_settings WHERE key IN ('slack_webhook', 'discord_webhook')")
        for row in cursor.fetchall():
            if row["key"] == "slack_webhook":
                slack_webhook = row["value"]
            elif row["key"] == "discord_webhook":
                discord_webhook = row["value"]

    return {
        "whatsapp_configured": bool(wa_token and wa_phone_id and wa_recipient),
        "whatsapp_token_masked": masked_token,
        "whatsapp_phone_id": wa_phone_id,
        "whatsapp_recipient": wa_recipient,
        "slack_webhook": slack_webhook,
        "discord_webhook": discord_webhook
    }

@app.post("/api/alerts/settings")
async def save_alert_settings(payload: dict):
    """Saves Slack and Discord webhooks to alert_settings table in SQLite."""
    with get_db() as conn:
        cursor = conn.cursor()
        if "slack_webhook" in payload:
            cursor.execute(
                "INSERT OR REPLACE INTO alert_settings (key, value) VALUES ('slack_webhook', ?)",
                (payload["slack_webhook"],)
            )
        if "discord_webhook" in payload:
            cursor.execute(
                "INSERT OR REPLACE INTO alert_settings (key, value) VALUES ('discord_webhook', ?)",
                (payload["discord_webhook"],)
            )
        conn.commit()
    return {"status": "success"}

@app.post("/api/alerts/whatsapp/test")
async def test_whatsapp():
    """Sends a test WhatsApp message to verify the Cloud API connection."""
    wa_token = os.environ.get("WHATSAPP_TOKEN", "")
    wa_phone_id = os.environ.get("WHATSAPP_PHONE_ID", "")
    wa_recipient = os.environ.get("WHATSAPP_RECIPIENT", "")
    
    if not wa_token or not wa_phone_id or not wa_recipient:
        raise HTTPException(status_code=400, detail="WhatsApp credentials not configured in .env file.")
    
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
            "body": "*APEX AI Workstation*\n\n_WhatsApp Alert Dispatch Test_\n\nConnection verified successfully. Alert notifications will be dispatched to this number when institutional triggers fire.\n\nTimestamp: " + datetime.now().strftime("%Y-%m-%d %H:%M:%S IST")
        }
    }
    
    try:
        resp = await asyncio.to_thread(requests.post, url, headers=headers, json=payload, timeout=10)
        resp_data = resp.json()
        if resp.status_code == 200 and "messages" in resp_data:
            return {"status": "success", "message_id": resp_data["messages"][0].get("id", "")}
        else:
            error_msg = resp_data.get("error", {}).get("message", "Unknown error")
            raise HTTPException(status_code=resp.status_code, detail=f"WhatsApp API error: {error_msg}")
    except requests.exceptions.RequestException as e:
        raise HTTPException(status_code=500, detail=f"Network error sending WhatsApp test: {str(e)}")

@app.delete("/api/alerts/{alert_id}")
async def delete_alert(alert_id: str):
    """Deletes a single alert by ID."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM alerts WHERE id = ?", (alert_id,))
        conn.commit()

    # Unregister from real-time AlertEvaluator
    from backend.websocket_server import alert_evaluator as _ae
    if _ae is not None:
        try:
            _ae.unregister_alert(alert_id)
        except Exception as e:
            print(f"Error unregistering alert: {e}")

async def evaluate_single_condition_bool(cond_type: str, op: str, val_str: str, t: dict, df) -> tuple:
    triggered = False
    cur_val = ""
    
    cond_type = cond_type.upper()
    try:
        if cond_type == "RSI":
            rsi_val = t["technicals"]["rsi"]
            cur_val = f"RSI: {rsi_val:.1f}"
            if op == "<" and rsi_val < float(val_str):
                triggered = True
            elif op == ">" and rsi_val > float(val_str):
                triggered = True
                
        elif cond_type == "PE":
            pe_val = t["fundamentals"]["pe_ratio"]
            cur_val = f"PE: {pe_val}"
            if val_str.upper() == "MEDIAN":
                compare_num = t["pe_bands"]["median_pe"]
            else:
                compare_num = float(val_str)
            if op == "<" and pe_val < compare_num:
                triggered = True
            elif op == ">" and pe_val > compare_num:
                triggered = True
                
        elif cond_type == "RATING":
            rating_val = t["analysis"]["recommendation"].upper() if "analysis" in t else "HOLD"
            cur_val = f"Rating: {rating_val}"
            if op == "==" and rating_val == val_str.upper():
                triggered = True
                
        elif cond_type == "PRICE":
            price_val = t["fundamentals"]["current_price"]
            cur_val = f"Price: Rs. {price_val:.2f}"
            if op == "<" and price_val < float(val_str):
                triggered = True
            elif op == ">" and price_val > float(val_str):
                triggered = True
                
        elif cond_type == "SMA":
            price_val = t["fundamentals"]["current_price"]
            sma_200 = t["technicals"]["sma_200"]
            pct_diff = ((price_val - sma_200) / sma_200) * 100 if sma_200 > 0 else 0.0
            cur_val = f"Price: Rs. {price_val:.2f} vs SMA200 (Diff: {pct_diff:+.1f}%)"
            threshold = float(val_str)
            if op == ">" and pct_diff > threshold:
                triggered = True
            elif op == "<" and pct_diff < threshold:
                triggered = True
                
        elif cond_type == "DMA_CROSS" and df is not None and not df.empty:
            df_copy = df.copy()
            df_copy["MA_50"] = df_copy["Close"].rolling(window=50).mean()
            df_copy["MA_200"] = df_copy["Close"].rolling(window=200).mean()
            df_clean = df_copy.dropna(subset=["MA_200"])
            if len(df_clean) >= 2:
                ma50_prev, ma50_curr = float(df_clean["MA_50"].iloc[-2]), float(df_clean["MA_50"].iloc[-1])
                ma200_prev, ma200_curr = float(df_clean["MA_200"].iloc[-2]), float(df_clean["MA_200"].iloc[-1])
                cur_val = f"50d SMA: Rs. {ma50_curr:.2f} vs 200d SMA: Rs. {ma200_curr:.2f}"
                buffer_pct = float(val_str)
                diff_prev = ((ma50_prev - ma200_prev) / ma200_prev) * 100
                diff_curr = ((ma50_curr - ma200_curr) / ma200_curr) * 100
                if op == ">" and diff_prev < buffer_pct and diff_curr >= buffer_pct:
                    triggered = True
                elif op == "<" and diff_prev > -abs(buffer_pct) and diff_curr <= -abs(buffer_pct):
                    triggered = True
                    
        elif cond_type == "EMA_CROSS" and df is not None and not df.empty:
            df_copy = df.copy()
            df_copy["MA_50"] = df_copy["Close"].ewm(span=50, adjust=False).mean()
            df_copy["MA_200"] = df_copy["Close"].ewm(span=200, adjust=False).mean()
            df_clean = df_copy.dropna(subset=["MA_200"])
            if len(df_clean) >= 2:
                ma50_prev, ma50_curr = float(df_clean["MA_50"].iloc[-2]), float(df_clean["MA_50"].iloc[-1])
                ma200_prev, ma200_curr = float(df_clean["MA_200"].iloc[-2]), float(df_clean["MA_200"].iloc[-1])
                cur_val = f"50d EMA: Rs. {ma50_curr:.2f} vs 200d EMA: Rs. {ma200_curr:.2f}"
                buffer_pct = float(val_str)
                diff_prev = ((ma50_prev - ma200_prev) / ma200_prev) * 100
                diff_curr = ((ma50_curr - ma200_curr) / ma200_curr) * 100
                if op == ">" and diff_prev < buffer_pct and diff_curr >= buffer_pct:
                    triggered = True
                elif op == "<" and diff_prev > -abs(buffer_pct) and diff_curr <= -abs(buffer_pct):
                    triggered = True
                    
        elif cond_type == "VOL_BREAKOUT" and df is not None and not df.empty:
            df_copy = df.copy()
            df_copy["Vol_20MA"] = df_copy["Volume"].rolling(window=20).mean()
            df_clean = df_copy.dropna(subset=["Vol_20MA"])
            if len(df_clean) >= 1:
                vol_curr = float(df_clean["Volume"].iloc[-1])
                vol_ma = float(df_clean["Vol_20MA"].iloc[-1])
                vol_ratio = vol_curr / vol_ma if vol_ma > 0 else 1.0
                cur_val = f"Vol Ratio: {vol_ratio:.2f}x"
                threshold = float(val_str)
                if op == ">" and vol_ratio > threshold:
                    triggered = True
                elif op == "<" and vol_ratio < threshold:
                    triggered = True
                    
        elif cond_type == "BB_CROSS" and df is not None and not df.empty:
            df_copy = df.copy()
            df_copy["BB_Mid"] = df_copy["Close"].rolling(window=20).mean()
            df_copy["BB_Std"] = df_copy["Close"].rolling(window=20).std()
            df_copy["BB_Upper"] = df_copy["BB_Mid"] + 2 * df_copy["BB_Std"]
            df_copy["BB_Lower"] = df_copy["BB_Mid"] - 2 * df_copy["BB_Std"]
            df_clean = df_copy.dropna(subset=["BB_Upper"])
            if len(df_clean) >= 2:
                close_prev, close_curr = float(df_clean["Close"].iloc[-2]), float(df_clean["Close"].iloc[-1])
                upper_prev, upper_curr = float(df_clean["BB_Upper"].iloc[-2]), float(df_clean["BB_Upper"].iloc[-1])
                lower_prev, lower_curr = float(df_clean["BB_Lower"].iloc[-2]), float(df_clean["BB_Lower"].iloc[-1])
                if op == ">":
                    cur_val = f"Price: Rs. {close_curr:.2f} vs BB Upper: Rs. {upper_curr:.2f}"
                    if close_prev < upper_prev and close_curr >= upper_curr:
                        triggered = True
                elif op == "<":
                    cur_val = f"Price: Rs. {close_curr:.2f} vs BB Lower: Rs. {lower_curr:.2f}"
                    if close_prev > lower_prev and close_curr <= lower_curr:
                        triggered = True
                        
        elif cond_type == "MACD_CROSS" and df is not None and not df.empty:
            df_copy = df.copy()
            ema12 = df_copy["Close"].ewm(span=12, adjust=False).mean()
            ema26 = df_copy["Close"].ewm(span=26, adjust=False).mean()
            df_copy["MACD"] = ema12 - ema26
            df_copy["Signal"] = df_copy["MACD"].ewm(span=9, adjust=False).mean()
            df_clean = df_copy.dropna(subset=["Signal"])
            if len(df_clean) >= 2:
                macd_prev, macd_curr = float(df_clean["MACD"].iloc[-2]), float(df_clean["MACD"].iloc[-1])
                sig_prev, sig_curr = float(df_clean["Signal"].iloc[-2]), float(df_clean["Signal"].iloc[-1])
                cur_val = f"MACD: {macd_curr:.3f} vs Signal: {sig_curr:.3f}"
                buffer_val = float(val_str)
                diff_prev = macd_prev - sig_prev
                diff_curr = macd_curr - sig_curr
                if op == ">" and diff_prev < buffer_val and diff_curr >= buffer_val:
                    triggered = True
                elif op == "<" and diff_prev > -abs(buffer_val) and diff_curr <= -abs(buffer_val):
                    triggered = True
                    
        elif cond_type == "52W_PROXIMITY" and df is not None and not df.empty:
            high_52w = float(df["Close"].max())
            low_52w = float(df["Close"].min())
            if len(df) >= 1:
                price_val = float(df["Close"].iloc[-1])
                proximity_pct = float(val_str)
                if op == ">":
                    diff_pct = ((high_52w - price_val) / high_52w) * 100
                    cur_val = f"Price: Rs. {price_val:.2f} near 52w High (Diff: {diff_pct:.1f}%)"
                    if diff_pct <= proximity_pct:
                        triggered = True
                elif op == "<":
                    diff_pct = ((price_val - low_52w) / low_52w) * 100
                    cur_val = f"Price: Rs. {price_val:.2f} near 52w Low (Diff: {diff_pct:.1f}%)"
                    if diff_pct <= proximity_pct:
                        triggered = True
                        
        elif cond_type == "SMA50" and df is not None and not df.empty:
            df_copy = df.copy()
            df_copy["SMA_50"] = df_copy["Close"].rolling(window=50).mean()
            df_clean = df_copy.dropna(subset=["SMA_50"])
            if len(df_clean) >= 1:
                price_val = float(df_clean["Close"].iloc[-1])
                sma_50 = float(df_clean["SMA_50"].iloc[-1])
                pct_diff = ((price_val - sma_50) / sma_50) * 100
                cur_val = f"Price: Rs. {price_val:.2f} vs SMA50 (Diff: {pct_diff:+.1f}%)"
                threshold = float(val_str)
                if op == ">" and pct_diff > threshold:
                    triggered = True
                elif op == "<" and pct_diff < threshold:
                    triggered = True
                    
        elif cond_type in ["FIB_LEVEL", "FIB_382", "FIB_500", "FIB_618"] and df is not None and not df.empty:
            sub_df = df.iloc[-120:] if len(df) >= 120 else df
            swing_high = float(sub_df["Close"].max())
            swing_low = float(sub_df["Close"].min())
            swing_diff = swing_high - swing_low
            fib_382 = swing_high - 0.382 * swing_diff
            fib_500 = swing_high - 0.500 * swing_diff
            fib_618 = swing_high - 0.618 * swing_diff
            if len(df) >= 1:
                price_val = float(df["Close"].iloc[-1])
                try:
                    proximity_pct = float(val_str)
                except Exception:
                    proximity_pct = 1.5
                levels_to_check = []
                if cond_type == "FIB_LEVEL":
                    levels_to_check = [("38.2%", fib_382), ("50.0%", fib_500), ("61.8%", fib_618)]
                elif cond_type == "FIB_382":
                    levels_to_check = [("38.2%", fib_382)]
                elif cond_type == "FIB_500":
                    levels_to_check = [("50.0%", fib_500)]
                elif cond_type == "FIB_618":
                    levels_to_check = [("61.8%", fib_618)]
                matched_level = None
                matched_val = 0.0
                for level_name, level_val in levels_to_check:
                    diff_pct = abs(price_val - level_val) / level_val * 100
                    if diff_pct <= proximity_pct:
                        matched_level = level_name
                        matched_val = level_val
                        triggered = True
                        break
                cur_val = f"Price: Rs. {price_val:.2f} near Fib {matched_level or 'Support'} Level: Rs. {matched_val:.2f}"
    except Exception as eval_err:
        print(f"Error evaluating condition {cond_type} {op} {val_str}: {eval_err}")
        
    return triggered, cur_val

@app.get("/api/alerts/check")
async def check_alerts():
    """Background-triggered active alert scanning sweep."""
    # Read WhatsApp settings from environment
    wa_token = os.environ.get("WHATSAPP_TOKEN", "")
    wa_phone_id = os.environ.get("WHATSAPP_PHONE_ID", "")
    wa_recipient = os.environ.get("WHATSAPP_RECIPIENT", "")
    whatsapp_configured = bool(wa_token and wa_phone_id and wa_recipient)

    slack_webhook = ""
    discord_webhook = ""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT key, value FROM alert_settings WHERE key IN ('slack_webhook', 'discord_webhook')")
        for row in cursor.fetchall():
            if row["key"] == "slack_webhook":
                slack_webhook = row["value"]
            elif row["key"] == "discord_webhook":
                discord_webhook = row["value"]

    triggers = []
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, ticker, condition_type, operator, value, triggered FROM alerts WHERE triggered = 0")
        active_alerts = [dict(row) for row in cursor.fetchall()]
    
    for alert in active_alerts:
        try:
            ticker = alert["ticker"]
            t = await asyncio.to_thread(get_complete_financial_profile, ticker)
            
            # Fetch history if required
            df = None
            history_indicators = ["DMA_CROSS", "EMA_CROSS", "VOL_BREAKOUT", "BB_CROSS", "MACD_CROSS", "52W_PROXIMITY", "SMA50", "FIB_LEVEL", "FIB_382", "FIB_500", "FIB_618"]
            needs_df = False
            
            if alert["condition_type"] == "COMPOUND":
                try:
                    cond_list = json.loads(alert["value"])
                    for item in cond_list:
                        if "indicator" in item and item["indicator"] in history_indicators:
                            needs_df = True
                            break
                except Exception:
                    pass
            else:
                needs_df = alert["condition_type"] in history_indicators
                
            if needs_df:
                df = await fetch_history_df(ticker, "1y", "1d")
                if df.empty:
                    print(f"Skipping alert check #{alert['id']} for {ticker} as price history is empty.")
                    continue

            triggered = False
            cur_val = ""
            
            if alert["condition_type"] == "COMPOUND":
                try:
                    cond_list = json.loads(alert["value"])
                    results = []
                    descriptions = []
                    for item in cond_list:
                        if "operator" in item and "indicator" not in item:
                            results.append(item["operator"].upper())
                        else:
                            res_bool, desc_str = await evaluate_single_condition_bool(
                                item["indicator"], item["operator"], item["value"], t, df
                            )
                            results.append(res_bool)
                            if desc_str:
                                descriptions.append(desc_str)
                    
                    if results:
                        triggered = results[0]
                        i = 1
                        while i < len(results) - 1:
                            op_str = results[i]
                            next_val = results[i+1]
                            if op_str == "AND":
                                triggered = triggered and next_val
                            elif op_str == "OR":
                                triggered = triggered or next_val
                            i += 2
                            
                    cur_val = " & ".join(descriptions) if descriptions else "Compound parameters met"
                except Exception as comp_err:
                    print(f"Error parsing compound alert: {comp_err}")
            else:
                triggered, cur_val = await evaluate_single_condition_bool(
                    alert["condition_type"], alert["operator"], alert["value"], t, df
                )
                    
            if triggered:
                trigger_date = datetime.now().strftime("%Y-%m-%d %H:%M")
                
                # Generate AI Contextual Warning
                ai_context = ""
                try:
                    from backend.agent import call_groq_llm
                    price_info = f"Current Price: Rs. {price_val:.2f}" if 'price_val' in locals() else ""
                    rsi_info = f"RSI: {t['technicals']['rsi']:.1f}" if 't' in locals() and 'rsi' in t['technicals'] else ""
                    sma_info = f"SMA200: Rs. {t['technicals']['sma_200']:.2f}" if 't' in locals() and 'sma_200' in t['technicals'] else ""
                    
                    sys_prompt = (
                        "You are an institutional trading cockpit assistant. "
                        "Write a concise, 1-sentence analytical warning (max 30 words) describing why this alert triggered and what it implies about the stock's momentum, volume absorption, or range boundaries."
                    )
                    user_prompt = (
                        f"ALERT TRIGGERED:\n"
                        f"Ticker: {alert['ticker']}\n"
                        f"Trigger condition: {alert['condition_type']} {alert['operator']} {alert['value']}\n"
                        f"Triggered value description: {cur_val}\n"
                        f"Context: {price_info} | {rsi_info} | {sma_info}\n"
                        f"Output ONLY the single-sentence contextual warning/analysis. Do not add headers, quotes, or conversational preamble."
                    )
                    
                    # Call LLM
                    ai_context = await asyncio.to_thread(call_groq_llm, sys_prompt, user_prompt)
                    ai_context = ai_context.strip().strip('"').strip("'").strip()
                except Exception as ai_err:
                    print(f"Failed to generate AI alert warning context: {ai_err}")
                    ai_context = f"Alert triggered on {alert['condition_type']} validation."

                with get_db() as conn:
                    cursor = conn.cursor()
                    cursor.execute(
                        "UPDATE alerts SET triggered = 1, status = 'Triggered', trigger_date = ?, ai_context = ? WHERE id = ?",
                        (trigger_date, ai_context, alert["id"])
                    )
                    conn.commit()
                triggers.append(f"ALERT TRIGGERED: {alert['ticker']} reached {cur_val} (Target: {alert['operator']} {alert['value']})")
                
                # Dispatch WhatsApp alert notification
                if whatsapp_configured:
                    wa_msg = (
                        f"\U0001f6a8 *INSTITUTIONAL ALERT TRIGGERED* \U0001f6a8\n\n"
                        f"\u2022 *Stock:* {alert['ticker']}\n"
                        f"\u2022 *Condition:* {alert['condition_type']} {alert['operator']} {alert['value']}\n"
                        f"\u2022 *Triggered Value:* {cur_val}\n"
                        f"\u2022 *Triggered At:* {trigger_date}\n"
                    )
                    if ai_context:
                        wa_msg += f"\n\U0001f916 *AI Copilot Analysis:*\n_{ai_context}_\n"
                    wa_msg += f"\n_APEX Agentic Equities AI Workstation_"

                    async def send_whatsapp_async(msg_body):
                        try:
                            wa_url = f"https://graph.facebook.com/v21.0/{wa_phone_id}/messages"
                            wa_headers = {
                                "Authorization": f"Bearer {wa_token}",
                                "Content-Type": "application/json"
                            }
                            wa_payload = {
                                "messaging_product": "whatsapp",
                                "to": wa_recipient,
                                "type": "text",
                                "text": {
                                    "preview_url": False,
                                    "body": msg_body
                                }
                            }
                            resp = await asyncio.to_thread(requests.post, wa_url, headers=wa_headers, json=wa_payload, timeout=10)
                            if resp.status_code != 200:
                                print(f"Failed to deliver WhatsApp alert. Status: {resp.status_code}, Response: {resp.text}")
                            else:
                                print(f"WhatsApp alert successfully delivered to {wa_recipient}. Response: {resp.text}")
                        except Exception as wa_err:
                            print(f"Failed to deliver WhatsApp alert due to error: {wa_err}")

                    asyncio.create_task(send_whatsapp_async(wa_msg))

                # Asynchronously dispatch webhook alerts
                async def send_webhook_async(url, payload):
                    import requests
                    try:
                        await asyncio.to_thread(requests.post, url, json=payload, timeout=5)
                    except Exception as web_err:
                        print(f"Failed to deliver alert webhook: {web_err}")

                text_msg = (
                    f"🔔 **INSTITUTIONAL ALERT TRIGGERED** 🔔\n"
                    f"• **Stock**: {alert['ticker']}\n"
                    f"• **Condition**: {alert['condition_type']} {alert['operator']} {alert['value']}\n"
                    f"• **Triggered Value**: {cur_val}\n"
                    f"• **Triggered At**: {trigger_date}\n"
                )
                if ai_context:
                    text_msg += f"• **AI Copilot Analysis**: {ai_context}\n"

                if discord_webhook:
                    fields = [
                        {"name": "Stock", "value": f"**{alert['ticker']}**", "inline": True},
                        {"name": "Condition", "value": f"`{alert['condition_type']} {alert['operator']} {alert['value']}`", "inline": True},
                        {"name": "Triggered Value", "value": f"{cur_val}", "inline": False},
                        {"name": "Timestamp", "value": f"{trigger_date}", "inline": True}
                    ]
                    if ai_context:
                        fields.append({"name": "AI Copilot Analysis", "value": f"{ai_context}", "inline": False})
                    discord_payload = {
                        "content": None,
                        "embeds": [{
                            "title": "🚨 Institutional Alert Triggered",
                            "color": 15548997,  # Red
                            "fields": fields,
                            "footer": {
                                "text": "APEX Agentic Equities AI Workstation"
                            }
                        }]
                    }
                    asyncio.create_task(send_webhook_async(discord_webhook, discord_payload))

                if slack_webhook:
                    slack_payload = {
                        "text": text_msg
                    }
                    asyncio.create_task(send_webhook_async(slack_webhook, slack_payload))
                
        except Exception as e:
            print(f"Error checking alert #{alert['id']}: {e}")
    
    # Re-fetch all alerts after updates
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT id, ticker, condition_type, operator, value, status, triggered, trigger_date, ai_context FROM alerts")
        all_alerts = [
            {
                "id": row["id"],
                "ticker": row["ticker"],
                "condition_type": row["condition_type"],
                "operator": row["operator"],
                "value": row["value"],
                "status": row["status"],
                "triggered": bool(row["triggered"]),
                "trigger_date": row["trigger_date"],
                "ai_context": row["ai_context"]
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
            cursor.execute("""
                SELECT 
                    i.symbol, 
                    i.name, 
                    i.sector, 
                    i.quantity, 
                    i.purchase_price, 
                    i.in_portfolio,
                    (CASE WHEN p.symbol IS NOT NULL THEN 1 ELSE 0 END) as is_cached
                FROM watchlist_items i
                LEFT JOIN cached_profiles p ON i.symbol = p.symbol
                WHERE i.watchlist_id = ?
            """, (w["id"],))
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
        cursor.execute("""
            SELECT 
                i.symbol, 
                i.name, 
                i.sector, 
                i.quantity, 
                i.purchase_price, 
                i.in_portfolio,
                (CASE WHEN p.symbol IS NOT NULL THEN 1 ELSE 0 END) as is_cached
            FROM watchlist_items i
            LEFT JOIN cached_profiles p ON i.symbol = p.symbol
            WHERE i.watchlist_id = ?
        """, (watchlist_id,))
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


class BatchQuotesRequest(BaseModel):
    symbols: List[str]

@app.post("/api/batch-quotes")
async def batch_quotes(data: BatchQuotesRequest):
    """
    Lightweight batch endpoint to fetch live market quotes for a list of symbols.
    Hybrid: Uses Angel One tick store if available, falls back to yfinance batch download.
    Auto-appends .NS suffix for Indian stock symbols that lack an exchange suffix.
    """
    raw_symbols = [s.strip().upper() for s in data.symbols if s.strip()]
    if not raw_symbols:
        return {"quotes": {}}

    # Cap at 100 symbols max to prevent abuse
    raw_symbols = raw_symbols[:100]

    quotes = {}

    # ── Strategy 1: Angel One Tick Store (instant, real-time) ──
    if angel_connector and angel_connector.is_authenticated() and tick_store.count > 0:
        found_symbols = []
        for sym in raw_symbols:
            plain = sym.replace(".NS", "").replace(".BO", "")
            tick = tick_store.get(plain)
            if tick and tick.get("price", 0) > 0:
                quotes[sym] = {
                    "price": tick["price"],
                    "change": tick.get("change", 0),
                    "change_pct": tick.get("change_pct", 0),
                    "high": tick.get("high", tick["price"]),
                    "low": tick.get("low", tick["price"]),
                }
                found_symbols.append(sym)

        # If we got all symbols from tick store, return immediately
        if len(found_symbols) == len(raw_symbols):
            return {"quotes": quotes}

        # Remove found symbols — only fetch missing ones from yfinance
        raw_symbols = [s for s in raw_symbols if s not in found_symbols]

    # ── Strategy 2: yfinance batch download (fallback) ──
    if raw_symbols:
        # Map original symbols to yfinance tickers (.NS suffix for NSE)
        sym_to_yf = {}
        yf_symbols = []
        for sym in raw_symbols:
            if '.' in sym or sym.startswith('^'):
                yf_sym = sym  # Already has exchange suffix or is an index
            else:
                yf_sym = f"{sym}.NS"  # Default to NSE
            sym_to_yf[sym] = yf_sym
            yf_symbols.append(yf_sym)

        try:
            # Use yfinance batch download for efficiency (2d period for prev close comparison)
            df = await asyncio.to_thread(
                yf.download,
                yf_symbols,
                period="2d",
                interval="1d",
                progress=False,
                threads=True
            )

            if not df.empty:
                is_multi = isinstance(df.columns, pd.MultiIndex)

                for orig_sym, yf_sym in sym_to_yf.items():
                    try:
                        if is_multi:
                            if yf_sym not in df.columns.get_level_values(1):
                                continue
                            close_series = df['Close'][yf_sym].dropna()
                            high_series = df['High'][yf_sym].dropna()
                            low_series = df['Low'][yf_sym].dropna()
                        else:
                            # Single symbol case — no multi-level columns
                            close_series = df['Close'].dropna()
                            high_series = df['High'].dropna()
                            low_series = df['Low'].dropna()

                        if close_series.empty:
                            continue

                        current_price = float(close_series.iloc[-1])
                        day_high = float(high_series.iloc[-1]) if not high_series.empty else current_price
                        day_low = float(low_series.iloc[-1]) if not low_series.empty else current_price

                        # Calculate change from previous close
                        prev_close = float(close_series.iloc[-2]) if len(close_series) >= 2 else current_price
                        change = current_price - prev_close
                        change_pct = (change / prev_close * 100.0) if prev_close > 0 else 0.0

                        # Map back to original symbol key (e.g., "TCS" not "TCS.NS")
                        quotes[orig_sym] = {
                            "price": round(current_price, 2),
                            "change": round(change, 2),
                            "change_pct": round(change_pct, 2),
                            "high": round(day_high, 2),
                            "low": round(day_low, 2)
                        }
                    except Exception as sym_err:
                        print(f"Batch quote error for {orig_sym} ({yf_sym}): {sym_err}")
                        continue

        except Exception as e:
            print(f"Batch quotes download error: {e}")

    return {"quotes": quotes}


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
        from backend.websocket_server import tick_store
        hydrated_rows = []
        for row in rows:
            sym = row["symbol"]
            plain_sym = sym.replace(".NS", "").replace(".BO", "")
            
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
            
            # Try to resolve live quotes from WebSocket tick store first
            live_tick = tick_store.get(plain_sym) or tick_store.get(sym)
            if live_tick:
                row["current_price"] = live_tick.get("price")
                row["day_change_pct"] = live_tick.get("change_pct")
            
            if cache_row:
                try:
                    profile = json.loads(cache_row["profile_json"])
                    analysis = profile.get("analysis", {})
                    row["has_analysis"] = True
                    row["suggested_buy_price_range"] = analysis.get("suggested_buy_price_range", "N/A")
                    row["suggested_sell_price_range"] = analysis.get("suggested_sell_price_range", "N/A")
                    row["target_12m"] = analysis.get("target_12m")
                    row["stop_loss_12m"] = analysis.get("stop_loss_12m")
                    if not row["current_price"]:
                        row["current_price"] = profile.get("fundamentals", {}).get("current_price")
                    if not row["day_change_pct"]:
                        row["day_change_pct"] = profile.get("technicals", {}).get("price_change_pct")
                    row["score"] = profile.get("score_metrics", {}).get("final_score", 50)
                except Exception as e:
                    print(f"Error parsing cached profile for {sym}: {e}")
            
            # yfinance fallback if price is still missing
            if not row["current_price"]:
                try:
                    import yfinance as yf
                    yf_sym = sym if '.' in sym or sym.startswith('^') else f"{sym}.NS"
                    ticker_obj = yf.Ticker(yf_sym)
                    info = ticker_obj.info
                    if info:
                        row["current_price"] = info.get("currentPrice") or info.get("regularMarketPrice") or info.get("navPrice")
                        if not row["day_change_pct"]:
                            pc = info.get("previousClose") or info.get("regularMarketPreviousClose")
                            if pc and row["current_price"]:
                                row["day_change_pct"] = ((row["current_price"] - pc) / pc) * 100
                except Exception as yf_err:
                    print(f"Error resolving fallback quote for portfolio item {sym}: {yf_err}")

            # Autocomplete empty target valuation ranges if we have current_price to ensure the slider is populated
            if row["current_price"]:
                cur_p = row["current_price"]
                if not row["suggested_buy_price_range"] or row["suggested_buy_price_range"] == "N/A":
                    row["suggested_buy_price_range"] = f"Rs. {int(cur_p * 0.95)} - Rs. {int(cur_p * 1.02)}"
                if not row["suggested_sell_price_range"] or row["suggested_sell_price_range"] == "N/A":
                    row["suggested_sell_price_range"] = f"Rs. {int(cur_p * 1.15)} - Rs. {int(cur_p * 1.25)}"
            
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

@app.post("/api/portfolio/stress-test")
async def run_portfolio_stress_test(data: StressTestRequest):
    """
    Simulates a macroeconomic scenario (shock) against the active portfolio holdings,
    assessing exposure and potential margin impacts.
    """
    if not data.scenario:
        raise HTTPException(status_code=400, detail="Scenario description is required.")
        
    try:
        # 1. Query all transactions
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT id, symbol, name, sector, quantity, purchase_price, purchase_date, transaction_type FROM portfolio_items")
            all_txs = [dict(row) for row in cursor.fetchall()]
            
        # Compute active holdings
        holdings = compute_active_holdings(all_txs)
        if not holdings:
            return {
                "scenario": data.scenario,
                "analysis": {
                    "impact_summary": "No active portfolio holdings detected to simulate stress testing against. Please populate your portfolio first.",
                    "vulnerable_stocks": [],
                    "resilient_stocks": [],
                    "margin_impact": "Unknown",
                    "recommendations": ["Add transactions to your portfolio."]
                }
            }
            
        # Get current prices and details from cache
        portfolio_summary = []
        for h in holdings:
            sym = h["symbol"]
            with get_db() as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT profile_json FROM cached_profiles WHERE symbol = ?", (sym,))
                cache_row = cursor.fetchone()
                
            curr_price = h["purchase_price"] # fallback
            pricing_power = "Moderate"
            altman_zone = "Grey Zone"
            debt_eq = 0.5
            
            if cache_row:
                try:
                    p = json.loads(cache_row["profile_json"])
                    curr_price = p["fundamentals"].get("current_price", curr_price)
                    pricing_power = p["fundamentals"].get("pricing_power_proxy", "Moderate")
                    altman_zone = p.get("earnings_quality", {}).get("altman_zone", "Grey Zone")
                    debt_eq = p["fundamentals"].get("debt_to_equity", 0.5)
                except Exception:
                    pass
                    
            value = round(h["quantity"] * curr_price, 2)
            portfolio_summary.append({
                "symbol": sym,
                "name": h["name"],
                "sector": h["sector"],
                "quantity": h["quantity"],
                "price": curr_price,
                "value": value,
                "pricing_power": pricing_power,
                "altman_zone": altman_zone,
                "debt_to_equity": debt_eq
            })
            
        # 2. Run LLM scenario simulation using Groq
        from backend.agent import call_groq_llm
        
        system_prompt = (
            "You are an expert macroeconomic strategist and risk auditor for a major Indian hedge fund.\n"
            "Your objective is to stress-test the user's active stock portfolio against the specified macroeconomic scenario (shock).\n"
            "Evaluate each holding's vulnerability based on its sector, leverage (Debt-to-Equity), pricing power proxy, and solvency zone (Altman Z-Score).\n"
            "Determine which stocks are highly vulnerable, which are resilient (hedged), and estimate margin impact.\n"
            "You MUST return a valid JSON object matching the following structure strictly:\n"
            "{\n"
            '  "impact_summary": "A high-level executive summary of the portfolio impact.",\n'
            '  "vulnerable_stocks": ["TCS.NS (High IT sensitivity to US budget cuts)", ...],\n'
            '  "resilient_stocks": ["RELIANCE.NS (Energy integration buffer)", ...],\n'
            '  "margin_impact": "High Risk / Moderate Risk / Positive Hedge",\n'
            '  "recommendations": ["Rebalance cash reserves", ...]\n'
            "}\n"
            "Do not include markdown tags inside the JSON string itself. Output raw JSON only."
        )
        
        user_prompt = f"""
        Macroeconomic Shock Scenario:
        "{data.scenario}"
        
        Active Portfolio Holdings:
        {json.dumps(portfolio_summary, indent=2)}
        """
        
        response_text = await asyncio.to_thread(call_groq_llm, system_prompt, user_prompt, max_tokens=1500)
        
        # Parse JSON from response
        try:
            clean_json = response_text.strip()
            if clean_json.startswith("```json"):
                clean_json = clean_json[7:]
            if clean_json.endswith("```"):
                clean_json = clean_json[:-3]
            clean_json = clean_json.strip()
            analysis = json.loads(clean_json)
        except Exception as e:
            print(f"Error parsing stress-test JSON: {e}\nRaw: {response_text}")
            analysis = {
                "impact_summary": f"Failed to compile structured LLM report. Raw response: {response_text[:300]}...",
                "vulnerable_stocks": ["Check high-leverage sectors manually."],
                "resilient_stocks": ["Check low-debt consumer staples manually."],
                "margin_impact": "Unknown",
                "recommendations": ["Review cash levels."]
            }
            
        return {
            "scenario": data.scenario,
            "analysis": analysis
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Macro Stress Simulation failed: {str(e)}")

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
        synthesis = await asyncio.to_thread(
            generate_backtest_synthesis,
            metrics=data.metrics,
            tickers_weights=data.tickers_weights
        )
        return {"synthesis": synthesis}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Backtest Synthesis Error: {str(e)}")


class OptimizeWeightsRequest(BaseModel):
    tickers: list[str]


@app.post("/api/portfolio/optimize-weights")
async def post_optimize_weights(data: OptimizeWeightsRequest):
    try:
        if not data.tickers:
            return {"weights": {}}
            
        import yfinance as yf
        import numpy as np
        import pandas as pd
        import asyncio
        from backend.financial_utils import resolve_company_ticker
        
        tickers = []
        for t in data.tickers:
            try:
                res = resolve_company_ticker(t)
                yf_ticker = res.get("yf_ticker") or f"{t.strip().upper()}.NS"
            except Exception:
                yf_ticker = f"{t.strip().upper()}.NS"
            tickers.append(yf_ticker)
            
        # Download 1y history for all tickers
        loop = asyncio.get_event_loop()
        download_tasks = []
        for t in tickers:
            download_tasks.append(
                loop.run_in_executor(None, lambda ticker=t: yf.download(ticker, period="1y", progress=False))
            )
        dfs = await asyncio.gather(*download_tasks)
        
        vols = {}
        for ticker, df in zip(tickers, dfs):
            if df.empty or "Close" not in df.columns:
                vols[ticker] = 0.25 # default 25% volatility fallback
                continue
            close = df["Close"]
            if isinstance(close, pd.DataFrame):
                close = close.iloc[:, 0]
            pct_chg = close.pct_change().dropna()
            vol = float(pct_chg.std() * np.sqrt(252))
            vols[ticker] = vol if vol > 0.0 else 0.25
            
        # Compute Inverse Volatility Weights
        inv_vols = {t: 1.0 / vols[t] for t in tickers}
        sum_inv = sum(inv_vols.values())
        
        weights = {}
        for original_t, yf_t in zip(data.tickers, tickers):
            raw_w = (inv_vols[yf_t] / sum_inv) * 100.0
            weights[original_t] = round(raw_w, 1)
            
        # Ensure it sums exactly to 100.0
        sum_weights = sum(weights.values())
        diff = 100.0 - sum_weights
        if diff != 0 and weights:
            first_ticker = list(weights.keys())[0]
            weights[first_ticker] = round(weights[first_ticker] + diff, 1)
            
        return {"weights": weights}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Weight optimization failed: {str(e)}")

class SwingSynthesisRequest(BaseModel):
    symbol: str
    strategy: str
    price: float
    stop_loss: float
    target_1: float
    target_2: float
    rsi: float
    volume_ratio: float
    backtest_trades: Optional[int] = None
    backtest_winrate: Optional[float] = None
    backtest_profitfactor: Optional[float] = None
    backtest_holddays: Optional[float] = None
    capital: Optional[float] = None
    risk_pct: Optional[float] = None
    shares_to_buy: Optional[int] = None
    capital_required: Optional[float] = None
    risk_amount: Optional[float] = None
    reward_potential: Optional[float] = None
    rr_ratio_calc: Optional[float] = None
    horizon: Optional[str] = "short"


@app.get("/api/swing/scan")
async def get_swing_scan(strategy: str = "ALL", universe: str = "all", min_volume_ratio: float = 1.0, horizon: str = "short"):
    """
    Scans the cached stock database to search for active technical setups.
    """
    try:
        from backend.swing_utils import clean_float
        strategy = strategy.upper()
        universe = universe.lower()
        horizon = horizon.lower()
        
        # Fetch Nifty 50 benchmark trend regime
        nifty_bullish, nifty_price, nifty_ema20 = check_nifty_regime()

        # Fetch delivery stats mapping and leading sectors
        delivery_map = {}
        leading_sectors = []
        delivery_hist_map = {}
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT symbol, delivery_percentage FROM daily_delivery_stats")
            for row in cursor.fetchall():
                delivery_map[row["symbol"]] = row["delivery_percentage"]
                
            cursor.execute("SELECT sector FROM sector_regime_stats ORDER BY avg_20d_return DESC LIMIT 3")
            leading_sectors = [row["sector"] for row in cursor.fetchall()]

            # Load historical delivery qty to calculate delivery Z-score efficiently
            cursor.execute("SELECT symbol, delivery_qty FROM daily_delivery_history ORDER BY symbol, trade_date ASC")
            for row in cursor.fetchall():
                sym = row["symbol"]
                if sym not in delivery_hist_map:
                    delivery_hist_map[sym] = []
                delivery_hist_map[sym].append(row["delivery_qty"])

            if universe == "all":
                cursor.execute("SELECT symbol, company_name, sector, cap_type FROM screener_universe")
            else:
                cursor.execute("SELECT symbol, company_name, sector, cap_type FROM screener_universe WHERE cap_type = ?", (universe,))
            stocks = [dict(row) for row in cursor.fetchall()]
            
            cursor.execute("SELECT symbol, profile_json FROM cached_profiles")
            cached_rows = cursor.fetchall()
            cached_profiles = {}
            for r in cached_rows:
                try:
                    cached_profiles[r["symbol"]] = json.loads(r["profile_json"])
                except Exception:
                    continue
                    
        candidates = []
        for s in stocks:
            sym = s["symbol"]
            prof = cached_profiles.get(sym)
            if not prof:
                continue
                
            f = prof.get("fundamentals") or {}
            t = prof.get("technicals") or {}
            
            price = clean_float(f.get("current_price"), 0.0)
            if price <= 0.0:
                continue
                
            rsi = clean_float(t.get("rsi"), 50.0)
            macd_hist = clean_float(t.get("macd_hist"), 0.0)
            macd = clean_float(t.get("macd"), 0.0)
            macd_signal = clean_float(t.get("macd_signal"), 0.0)
            breakout_status = str(t.get("breakout_status") or "CONSOLIDATING")
            sma_50 = clean_float(t.get("sma_50"), 0.0)
            sma_200 = clean_float(t.get("sma_200"), 0.0)
            atr = clean_float(t.get("atr"), price * 0.02)
            vol_ratio = clean_float(t.get("volume_vs_avg20"), 1.0)
            
            if vol_ratio < min_volume_ratio:
                continue
                
            triggered = False
            setup_name = "None"
            setup_desc = ""

            # VSA & Z-score Calculations
            hist_deliv = delivery_hist_map.get(sym, [])
            from backend.quant_scoring import calculate_delivery_zscore, detect_vsa_setup
            delivery_zscore = calculate_delivery_zscore(hist_deliv) if hist_deliv else 0.0

            open_p = clean_float(t.get("daily_open"), price)
            high_p = clean_float(t.get("daily_high"), price)
            low_p = clean_float(t.get("daily_low"), price)
            close_p = clean_float(t.get("daily_close"), price)
            vsa_setup = detect_vsa_setup(open_p, high_p, low_p, close_p, vol_ratio, 1.0)
            
            # Setup evaluations based on horizon
            if horizon == "medium":
                # Get medium term indicators (from cached technicals)
                ema_20 = t.get("ema_20", price)
                ema_50 = t.get("ema_50", sma_50 or price)
                sma_150 = t.get("sma_150", (sma_50 + sma_200)/2.0 if (sma_50 and sma_200) else price)
                
                # Check actual medium-term setups
                is_ema_co = ema_20 > ema_50
                is_stage_2 = (price > sma_150) and (vol_ratio >= 1.5)
                is_ema50_bounce = (abs(price - ema_50) / ema_50 <= 0.015) and (price >= ema_50)
                is_macd_bullish = macd > macd_signal
                is_rsi_pullback = rsi <= 45.0
                is_bb_breakout = breakout_status in ["BULLISH BREAKOUT", "MOMENTUM BREAKOUT"]
                
                if strategy == "RSI":
                    if is_rsi_pullback:
                        triggered = True
                        setup_name = "RSI Pullback"
                        setup_desc = f"RSI oversold at {rsi:.1f} indicates intermediate pullback consolidation."
                elif strategy == "MACD":
                    if is_macd_bullish:
                        triggered = True
                        setup_name = "Weekly MACD Bullish"
                        setup_desc = "MACD line is above the signal line, indicating positive intermediate trend bias."
                elif strategy == "EMA":
                    if is_ema_co or is_ema50_bounce:
                        if is_ema_co:
                            triggered = True
                            setup_name = "EMA Trend Cross (20/50)"
                            setup_desc = f"20-day EMA (Rs. {ema_20:.2f}) trades above 50-day EMA (Rs. {ema_50:.2f}), confirming bullish structural bias."
                        else:
                            triggered = True
                            setup_name = "50-Day EMA Bounce"
                            setup_desc = f"Price hovers within 1.5% of critical 50-day EMA support of Rs. {ema_50:.2f}."
                elif strategy == "BB":
                    if is_bb_breakout:
                        triggered = True
                        setup_name = "Stage 2 Breakout" if is_stage_2 else "BB Breakout"
                        setup_desc = f"Price broke out above Bollinger Bands upper limit with {vol_ratio:.1f}x volume support."
                elif strategy == "VSA_ACCUMULATION":
                    is_vsa_bullish = vsa_setup is not None and vsa_setup.get("type") == "bullish"
                    is_high_z = delivery_zscore >= 1.5
                    if is_vsa_bullish or is_high_z:
                        triggered = True
                        if is_vsa_bullish:
                            setup_name = vsa_setup["pattern"]
                            setup_desc = vsa_setup["description"]
                        else:
                            setup_name = "Institutional Block Buying"
                            setup_desc = f"Extreme deliverable volume surge (Z-score: {delivery_zscore:+.2f}) confirms institutional accumulation."
                elif strategy == "VSA_PULLBACK":
                    is_vsa_bullish = vsa_setup is not None and vsa_setup.get("type") == "bullish"
                    is_pullback = is_rsi_pullback or is_ema50_bounce
                    if is_pullback and is_vsa_bullish:
                        triggered = True
                        setup_name = f"VSA Pullback ({vsa_setup['pattern']})"
                        setup_desc = f"Bullish Wyckoff structure '{vsa_setup['pattern']}' confirms absorption support on price pullback."
                else: # ALL
                    if is_stage_2:
                        triggered = True
                        setup_name = "Stage 2 Breakout"
                        setup_desc = f"Price trading above rising 150-day SMA on elevated volume ratio ({vol_ratio:.1f}x)."
                    elif is_ema50_bounce:
                        triggered = True
                        setup_name = "50-Day EMA Bounce"
                        setup_desc = f"Price hovers within 1.5% of critical 50-day EMA support of Rs. {ema_50:.2f}."
                    elif is_ema_co:
                        triggered = True
                        setup_name = "EMA Trend Cross (20/50)"
                        setup_desc = f"20-day EMA (Rs. {ema_20:.2f}) trades above 50-day EMA (Rs. {ema_50:.2f}), confirming bullish structural bias."
                    elif is_macd_bullish:
                        triggered = True
                        setup_name = "Weekly MACD Bullish"
                        setup_desc = "MACD line is above the signal line, indicating positive intermediate trend bias."
                    elif is_rsi_pullback:
                        triggered = True
                        setup_name = "RSI Pullback"
                        setup_desc = f"RSI oversold at {rsi:.1f} indicates intermediate pullback consolidation."
                    elif is_bb_breakout:
                        triggered = True
                        setup_name = "BB Breakout"
                        setup_desc = f"Price breakout above Bollinger Bands upper limit with {vol_ratio:.1f}x volume support."
            else: # short term
                ema_5 = t.get("ema_5", price)
                ema_20 = t.get("ema_20", price)
                is_rsi_pullback = rsi <= 38.0
                is_macd_co = macd_hist > 0 and macd > macd_signal
                is_ema_co = ema_5 > ema_20
                is_bb_breakout = breakout_status in ["BULLISH BREAKOUT", "MOMENTUM BREAKOUT"]
                
                if strategy == "RSI":
                    if is_rsi_pullback:
                        triggered = True
                        setup_name = "RSI Pullback"
                        setup_desc = f"RSI oversold at {rsi:.1f} indicates mean-reversion pullback."
                elif strategy == "MACD":
                    if is_macd_co:
                        triggered = True
                        setup_name = "MACD Bullish Crossover"
                        setup_desc = "MACD fast line crossed above the signal line, indicating new positive momentum."
                elif strategy == "EMA":
                    if is_ema_co:
                        triggered = True
                        setup_name = "EMA Golden Cross (5/20)"
                        setup_desc = "Short-term 5-day EMA crossed above the 20-day EMA, signaling trend acceleration."
                elif strategy == "BB":
                    if is_bb_breakout:
                        triggered = True
                        setup_name = "BB Squeeze Breakout"
                        setup_desc = f"Price breakout above Bollinger Bands upper limit with {vol_ratio:.1f}x volume support."
                elif strategy == "VSA_ACCUMULATION":
                    is_vsa_bullish = vsa_setup is not None and vsa_setup.get("type") == "bullish"
                    is_high_z = delivery_zscore >= 1.5
                    if is_vsa_bullish or is_high_z:
                        triggered = True
                        if is_vsa_bullish:
                            setup_name = vsa_setup["pattern"]
                            setup_desc = vsa_setup["description"]
                        else:
                            setup_name = "Institutional Block Buying"
                            setup_desc = f"Extreme deliverable volume surge (Z-score: {delivery_zscore:+.2f}) confirms institutional accumulation."
                elif strategy == "VSA_PULLBACK":
                    is_vsa_bullish = vsa_setup is not None and vsa_setup.get("type") == "bullish"
                    is_pullback = is_rsi_pullback
                    if is_pullback and is_vsa_bullish:
                        triggered = True
                        setup_name = f"VSA Pullback ({vsa_setup['pattern']})"
                        setup_desc = f"Bullish Wyckoff structure '{vsa_setup['pattern']}' confirms absorption support on price pullback."
                else: # ALL
                    if is_rsi_pullback:
                        triggered = True
                        setup_name = "RSI Pullback"
                        setup_desc = f"RSI oversold at {rsi:.1f} indicates mean-reversion pullback."
                    elif is_macd_co:
                        triggered = True
                        setup_name = "MACD Bullish Crossover"
                        setup_desc = "MACD line is above the signal line, indicating positive trend momentum."
                    elif is_bb_breakout:
                        triggered = True
                        setup_name = "BB Squeeze Breakout"
                        setup_desc = f"Price breakout above Bollinger Bands upper limit with {vol_ratio:.1f}x volume support."
                    elif is_ema_co:
                        triggered = True
                        setup_name = "EMA Golden Cross (5/20)"
                        setup_desc = "Short-term 5-day EMA crossed above the 20-day EMA, signaling trend acceleration."
                    
            if triggered:
                if horizon == "medium":
                    sl = round(price - 3.0 * atr, 2)
                    tp1 = round(price + 3.0 * atr, 2)
                    tp2 = round(price + 6.0 * atr, 2)
                else:
                    sl = round(price - 2.0 * atr, 2)
                    tp1 = round(price + 1.5 * atr, 2)
                    tp2 = round(price + 3.0 * atr, 2)
                
                rr = round((tp2 - price) / (price - sl) if (price - sl) > 0 else 1.5, 2)
                
                # Fetch detailed scoring attributes
                delivery_pct = clean_float(delivery_map.get(sym, 0.0), 0.0)
                sector_leading = s["sector"] in leading_sectors
                
                promoter_pledged = clean_float(f.get("promoter_pledge_pct"), 0.0)
                shareholding = prof.get("shareholding") or {}
                fii_pct = clean_float(shareholding.get("FIIs"), 0.0)
                dii_pct = clean_float(shareholding.get("DIIs"), 0.0)
                fii_dii_increased = (fii_pct + dii_pct) >= 20.0
                
                eq = prof.get("earnings_quality") or {}
                f_score = eq.get("piotroski_score")
                z_score = eq.get("altman_z_score")
                
                clean_f_score = None
                if f_score is not None:
                    try:
                        clean_f_score = int(f_score)
                    except (ValueError, TypeError):
                        pass
                        
                clean_z_score = None
                if z_score is not None:
                    try:
                        clean_z_score = float(z_score)
                        if math.isnan(clean_z_score) or math.isinf(clean_z_score):
                            clean_z_score = None
                    except (ValueError, TypeError):
                        pass
                
                atr_pct_contracting = bool(t.get("atr_pct_contracting", False))
                
                days_to_earnings = None
                try:
                    earnings_date_str = f.get("next_earnings_date")
                    if earnings_date_str:
                        from datetime import datetime
                        edt = datetime.strptime(earnings_date_str, "%Y-%m-%d")
                        days_to_earnings = (edt - datetime.now()).days
                        if days_to_earnings < 0:
                            days_to_earnings = None
                except Exception:
                    pass
                
                from backend.quant_scoring import calculate_composite_trade_score
                trade_score, trade_flags, trade_breakdown = calculate_composite_trade_score(
                    horizon=horizon,
                    setup_name=setup_name,
                    volume_ratio=vol_ratio,
                    rsi=rsi,
                    atr_pct_contracting=atr_pct_contracting,
                    nifty_bullish=nifty_bullish,
                    sector_leading=sector_leading,
                    f_score=clean_f_score,
                    z_score=clean_z_score,
                    promoter_pledged_pct=promoter_pledged,
                    fii_dii_increased=fii_dii_increased,
                    delivery_pct=delivery_pct,
                    days_to_earnings=days_to_earnings,
                    delivery_zscore=delivery_zscore,
                    vsa_setup=vsa_setup
                )
                
                candidates.append({
                    "symbol": sym,
                    "company_name": s["company_name"],
                    "sector": s["sector"],
                    "cap_type": s["cap_type"],
                    "price": price,
                    "rsi": round(rsi, 1),
                    "setup_trigger": setup_name,
                    "description": setup_desc,
                    "volume_ratio": round(vol_ratio, 2),
                    "stop_loss": sl,
                    "take_profit_1": tp1,
                    "take_profit_2": tp2,
                    "risk_reward_ratio": rr,
                    "trade_score": trade_score,
                    "trade_flags": trade_flags,
                    "trade_breakdown": trade_breakdown,
                    "delivery_pct": delivery_pct,
                    "f_score": clean_f_score if clean_f_score is not None else "N/A",
                    "z_score": clean_z_score if clean_z_score is not None else "N/A",
                    "nifty_bullish": nifty_bullish
                })
                
        # Rank by Trade Score descending
        candidates = sorted(candidates, key=lambda x: x["trade_score"], reverse=True)
        return candidates
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Swing scanner execution failed: {str(e)}")

@app.get("/api/swing/candidate")
async def get_swing_candidate(symbol: str, timeframe: str = "1D", horizon: str = "short"):
    """
    Fetches raw historical prices for Lightweight Candlestick Chart initialization
    and calculates volume profile VPVR and support targets.
    """
    try:
        from backend.swing_utils import calculate_volume_profile, calculate_swing_indicators, analyze_swing_signals, clean_float
        interval = "1d"
        fetch_range = "1y"
        if timeframe == "1H":
            interval = "1h"
            fetch_range = "730d"
            
        df = await fetch_history_df(symbol, fetch_range, interval)
        if df.empty:
            raise HTTPException(status_code=404, detail="No price data returned from Yahoo Chart endpoint.")
        df_ind = calculate_swing_indicators(df)
        display_bars = min(60, len(df_ind))
        df_display = df_ind.iloc[-display_bars:]
        
        candlesticks = []
        for idx in range(len(df_display)):
            candlesticks.append({
                "time": df_display.index[idx].strftime("%Y-%m-%d %H:%M:%S" if timeframe == "1H" else "%Y-%m-%d"),
                "open": round(float(df_display["Open"].iloc[idx]), 2),
                "high": round(float(df_display["High"].iloc[idx]), 2),
                "low": round(float(df_display["Low"].iloc[idx]), 2),
                "close": round(float(df_display["Close"].iloc[idx]), 2),
                "ema_20": round(clean_float(df_display["EMA_20"].iloc[idx], df_display["Close"].iloc[idx]), 2) if "EMA_20" in df_display.columns else None,
                "ema_50": round(clean_float(df_display["EMA_50"].iloc[idx], df_display["Close"].iloc[idx]), 2) if "EMA_50" in df_display.columns else None
            })
            
        vprofile = calculate_volume_profile(df_display, bins=12)
        
        # Check database for cached company profile business summary and fundamentals
        business_summary = "No cached corporate business summary details available. Please run a full analysis in the Equity Research Terminal to load it."
        piotroski_score = 0
        piotroski_label = "N/A"
        altman_score = 0.0
        altman_label = "N/A"
        
        try:
            with get_db() as conn:
                cursor = conn.cursor()
                cursor.execute("SELECT profile_json FROM cached_profiles WHERE symbol = ?", (symbol,))
                row = cursor.fetchone()
                if row:
                    prof_data = json.loads(row["profile_json"])
                    business_summary = prof_data.get("business_summary", "No cached corporate business summary details available.")
                    eq = prof_data.get("earnings_quality", {})
                    piotroski_score = eq.get("piotroski_score", 0)
                    piotroski_label = eq.get("piotroski_label", "N/A")
                    altman_score = eq.get("altman_z_score", 0.0)
                    altman_label = eq.get("altman_zone", "N/A")
        except Exception as db_err:
            print(f"Error reading business summary or fundamentals: {db_err}")

        # If data is missing/empty/not cached, dynamically fetch and calculate on-the-fly
        if (piotroski_score == 0 and piotroski_label == "N/A") or business_summary.startswith("No cached"):
            try:
                from backend.financial_utils import calculate_earnings_quality_scores
                stock_obj = yf.Ticker(symbol)
                eq = calculate_earnings_quality_scores(stock_obj)
                if eq and (eq.get("piotroski_score", 0) > 0 or eq.get("piotroski_label", "N/A") != "N/A"):
                    piotroski_score = eq.get("piotroski_score", 0)
                    piotroski_label = eq.get("piotroski_label", "N/A")
                    altman_score = eq.get("altman_z_score", 0.0)
                    altman_label = eq.get("altman_zone", "N/A")
                
                if business_summary.startswith("No cached"):
                    info = stock_obj.info
                    business_summary = info.get("longBusinessSummary", "No corporate business summary details available.")
            except Exception as calc_err:
                print(f"Error calculating on-the-fly earnings quality: {calc_err}")
 
        df_ind = calculate_swing_indicators(df)
        last_row = df_ind.iloc[-1]
        current_price = float(last_row["Close"])
        
        setup, desc, sl, tp1, tp2 = analyze_swing_signals(df, horizon=horizon)
        
        return {
            "symbol": symbol,
            "timeframe": timeframe,
            "current_price": current_price,
            "stop_loss": sl,
            "take_profit_1": tp1,
            "take_profit_2": tp2,
            "candlesticks": candlesticks,
            "volume_profile": vprofile,
            "setup": setup,
            "description": desc,
            "business_summary": business_summary,
            "piotroski_score": piotroski_score,
            "piotroski_label": piotroski_label,
            "altman_score": altman_score,
            "altman_label": altman_label
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Swing candidate charts compilation failed: {str(e)}")


@app.get("/api/swing/backtest")
async def get_swing_backtest(symbol: str, strategy: str = "ALL", horizon: str = "short"):
    """
    Simulates a swing or position strategy on a stock.
    """
    try:
        from backend.swing_utils import calculate_swing_indicators, analyze_swing_signals
        horizon = horizon.lower()
        strategy = strategy.upper()
        
        # Load 2 years of daily history to support medium-term 150 SMA computations
        df = await fetch_history_df(symbol, "2y", "1d")
        if df.empty:
            raise HTTPException(status_code=404, detail="No price data returned from Yahoo Chart endpoint.")
        
        df = calculate_swing_indicators(df)
        
        sim_days = min(365 if horizon == "medium" else 90, len(df) - 160)
        if sim_days <= 0:
            raise HTTPException(status_code=400, detail="Insufficient price history to run simulation.")
            
        df_sim = df.iloc[-sim_days:]
        
        capital = 100000.0
        equity_curve = []
        trades = []
        in_trade = False
        entry_price = 0.0
        stop_loss = 0.0
        target_profit = 0.0
        holding_days = 0
        holding_limit = 60 if horizon == "medium" else 15
        
        for idx in range(len(df_sim)):
            current_date = df_sim.index[idx]
            current_row = df_sim.iloc[idx]
            
            hist_df = df.loc[:current_date]
            
            high = float(current_row["High"])
            low = float(current_row["Low"])
            close = float(current_row["Close"])
            
            if in_trade:
                holding_days += 1
                if high >= target_profit:
                    profit = (target_profit - entry_price) / entry_price * capital
                    capital += profit
                    trades.append({"win": True, "pnl_pct": (target_profit - entry_price) / entry_price * 100, "holding_days": holding_days})
                    in_trade = False
                elif low <= stop_loss:
                    loss = (stop_loss - entry_price) / entry_price * capital
                    capital += loss
                    trades.append({"win": False, "pnl_pct": (stop_loss - entry_price) / entry_price * 100, "holding_days": holding_days})
                    in_trade = False
                elif holding_days >= holding_limit:
                    pnl = (close - entry_price) / entry_price * capital
                    capital += pnl
                    trades.append({"win": pnl >= 0, "pnl_pct": (close - entry_price) / entry_price * 100, "holding_days": holding_days})
                    in_trade = False
            else:
                setup, _, sl, tp1, tp2 = analyze_swing_signals(hist_df, horizon=horizon)
                is_match = False
                if horizon == "medium":
                    if strategy == "ALL":
                        is_match = setup in ["EMA Trend Cross (20/50)", "Stage 2 Breakout", "50-Day EMA Bounce", "Weekly MACD Bullish", "RSI Pullback", "BB Breakout"]
                    elif strategy == "RSI":
                        is_match = setup == "RSI Pullback"
                    elif strategy == "MACD":
                        is_match = setup == "Weekly MACD Bullish"
                    elif strategy == "EMA":
                        is_match = setup in ["EMA Trend Cross (20/50)", "50-Day EMA Bounce"]
                    elif strategy == "BB":
                        is_match = setup in ["Stage 2 Breakout", "BB Breakout"]
                else:
                    if strategy == "ALL":
                        is_match = setup in ["RSI Pullback", "MACD Bullish Crossover", "EMA Golden Cross (5/20)", "BB Squeeze Breakout", "Fibonacci Support Bounce"]
                    elif strategy == "RSI":
                        is_match = setup == "RSI Pullback"
                    elif strategy == "MACD":
                        is_match = setup == "MACD Bullish Crossover"
                    elif strategy == "EMA":
                        is_match = setup == "EMA Golden Cross (5/20)"
                    elif strategy == "BB":
                        is_match = setup == "BB Squeeze Breakout"
                    
                if is_match:
                    in_trade = True
                    entry_price = close
                    stop_loss = sl
                    target_profit = tp2
                    holding_days = 0
                    
            equity_curve.append({
                "time": current_date.strftime("%Y-%m-%d"),
                "value": round(capital, 2)
            })
            
        total_trades = len(trades)
        wins = [t for t in trades if t["win"]]
        losses = [t for t in trades if not t["win"]]
        win_rate = (len(wins) / total_trades * 100) if total_trades > 0 else 0.0
        
        sum_gains = sum([t["pnl_pct"] for t in wins])
        sum_losses = abs(sum([t["pnl_pct"] for t in losses]))
        profit_factor = (sum_gains / sum_losses) if sum_losses > 0 else (sum_gains if sum_gains > 0 else 1.0)
        avg_hold = np.mean([t["holding_days"] for t in trades]) if total_trades > 0 else 0
        
        return {
            "win_rate_pct": round(win_rate, 1),
            "profit_factor": round(profit_factor, 2),
            "avg_holding_days": round(float(avg_hold), 1),
            "total_trades": total_trades,
            "equity_curve": equity_curve
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Swing backtester failed: {str(e)}")


@app.post("/api/swing/synthesis")
async def post_swing_synthesis(data: SwingSynthesisRequest):
    """
    Runs a swing or position strategist analysis using Groq Llama 3 on-demand.
    """
    try:
        from backend.main import call_groq_llm
        horizon_label = "Medium-Term Position Trading" if data.horizon == "medium" else "Short-Term Tactical Swing"
        backtest_label = "365-Day Strategy Simulation Backtest" if data.horizon == "medium" else "90-Day Strategy Simulation Backtest"
        atr_multiplier = "3x" if data.horizon == "medium" else "2x"
        
        system_prompt = (
            f"You are a Senior Technical Analyst and {horizon_label} Specialist.\n"
            f"Your task is to compile a highly professional, print-ready, one-page {horizon_label} Docket.\n"
            "Analyze the trade parameters and structure your thesis using the following exact headings:\n"
            "\n"
            "### I. Tactical Setup & Technical Signals\n"
            "Identify the setup pattern (e.g. RSI pullback, MACD Crossover, BB Squeeze Breakout). Mention current price, RSI, and SMA alignments.\n"
            "\n"
            "### II. Volume Profile & High-Volume Nodes\n"
            "Explain volume patterns. Discuss whether the breakout/pullback is confirmed by volume surges or support at key High-Volume Nodes.\n"
            "\n"
            "### III. Risk-Reward Parameters & Position Sizing\n"
            "Analyze the Entry, Stop Loss, Target 1, and Target 2 levels. Explain why the Stop Loss is logically placed (e.g. Volatility ATR bounds) and provide the mathematical Risk-Reward justification. "
            f"If historical {backtest_label} statistics (Win Rate, Profit Factor, etc.) are provided, incorporate them here to justify the strategy's viability.\n"
            "\n"
            "### IV. Key Catalysts & Exit Trajectory\n"
            "List catalysts that could drive the price to the targets, and potential risk flags that would require immediate manual trailing exits."
        )
        
        user_prompt = (
            f"Ticker: {data.symbol}\n"
            f"Strategy Setup: {data.strategy}\n"
            f"Entry Price: Rs. {data.price}\n"
            f"Stop Loss Price: Rs. {data.stop_loss}\n"
            f"Tier 1 Target Price: Rs. {data.target_1}\n"
            f"Tier 2 Target Price: Rs. {data.target_2}\n"
            f"RSI Indicator: {data.rsi}\n"
            f"Volume vs 20-Day Avg: {data.volume_ratio}x\n"
        )
        if data.capital is not None:
            user_prompt += (
                f"\n--- Position Sizing & Risk Parameters ---\n"
                f"Account Capital Size: Rs. {data.capital:.2f}\n"
                f"Risk Tolerance per Trade: {data.risk_pct}%\n"
                f"Recommended Position Size: {data.shares_to_buy} units\n"
                f"Required Total Capital: Rs. {data.capital_required:.2f}\n"
                f"Absolute Maximum Position Risk: Rs. {data.risk_amount:.2f}\n"
                f"Absolute Potential Profit Reward: Rs. {data.reward_potential:.2f}\n"
                f"Risk-to-Reward Ratio: 1:{data.rr_ratio_calc:.2f}\n"
            )
        if data.backtest_trades is not None:
            user_prompt += (
                f"\n--- {backtest_label} Metrics ---\n"
                f"Total Simulated Trades: {data.backtest_trades}\n"
                f"Win Rate: {data.backtest_winrate}%\n"
                f"Profit Factor: {data.backtest_profitfactor}\n"
                f"Average Holding Time: {data.backtest_holddays} days\n"
            )
        
        synthesis = await asyncio.to_thread(call_groq_llm, system_prompt, user_prompt)
        
        if "ERROR" in synthesis or not synthesis.strip():
            setup_word = "position" if data.horizon == "medium" else "swing"
            p1 = (
                f"### I. Tactical Setup & Technical Signals\n"
                f"**{data.symbol}** exhibits an active **{data.strategy}** technical {setup_word} trade setup at **Rs. {data.price}**. "
                f"The daily RSI is positioned at **{data.rsi:.1f}** with supporting technical indicators aligning toward a structural trend shift."
            )
            p2 = (
                f"### II. Volume Profile & High-Volume Nodes\n"
                f"Daily volume is currently expanding at **{data.volume_ratio:.2f}x** relative to its 20-day average. "
                f"The volume profile highlights key support levels nearby, confirming that the current breakout/rebound is supported by institutional transaction interest."
            )
            p3_backtest = ""
            if data.backtest_trades is not None:
                p3_backtest = (
                    f" Backtest simulation results over the past {'365' if data.horizon == 'medium' else '90'} trading days verify the setup's historical performance, "
                    f"completing **{data.backtest_trades}** total trades with a win rate of **{data.backtest_winrate:.1f}%** "
                    f"and a profit factor of **{data.backtest_profitfactor:.2f}** (averaging **{data.backtest_holddays:.1f} days** per trade)."
                )
            p3_sizing = ""
            if data.shares_to_buy is not None:
                p3_sizing = (
                    f" Based on an account capital size of **Rs. {data.capital:,.2f}** with a **{data.risk_pct}%** risk per trade limit, "
                    f"the position sizer recommends buying **{data.shares_to_buy:,} shares** (requiring **Rs. {data.capital_required:,.2f}** in allocated capital). "
                    f"This caps the total absolute risk on the trade to **Rs. {data.risk_amount:,.2f}** with a corresponding reward potential of **Rs. {data.reward_potential:,.2f}** (a net risk-reward ratio of **1:{data.rr_ratio_calc:.2f}**)."
                )
            p3 = (
                f"### III. Risk-Reward Parameters & Position Sizing\n"
                f"Entry triggers are established at **Rs. {data.price}**. The Stop-Loss is placed at **Rs. {data.stop_loss}** (based on a volatility-adjusted {atr_multiplier} ATR boundary). "
                f"The trade employs a tiered exit strategy: **Target 1 at Rs. {data.target_1}** (capital preservation target) and **Target 2 at Rs. {data.target_2}** (full runner target), yielding a highly favorable risk-reward ratio.{p3_sizing}{p3_backtest}"
            )
            p4 = (
                f"### IV. Key Catalysts & Exit Trajectory\n"
                f"Positive price trend catalysts include moving average crossovers and volume profile support levels. "
                f"A break below **Rs. {data.stop_loss}** triggers the automated exit rules. Close tracking of daily RSI is advised to execute manual trailing exits as target zones are approached."
            )
            synthesis = f"{p1}\n\n{p2}\n\n{p3}\n\n{p4}"
            
        return {"synthesis": synthesis}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Swing trade synthesis failed: {str(e)}")

@app.get("/api/stock/volume-dynamics")
async def get_stock_volume_dynamics(symbol: str, generate_ai: bool = False):
    try:
        import requests
        import io
        import pandas as pd
        import yfinance as yf
        from datetime import datetime, timedelta
        from backend.swing_utils import calculate_volume_profile
        from backend.quant_scoring import detect_vsa_setup, calculate_delivery_zscore
        from backend.financial_utils import resolve_company_ticker
        
        # Standardize and resolve the symbol to uppercase with standard suffix (e.g., INFY.NS)
        try:
            resolved = resolve_company_ticker(symbol)
            symbol = resolved["yf_ticker"]
        except Exception as resolve_err:
            print(f"Error resolving ticker symbol: {resolve_err}")
            symbol = symbol.strip().upper()
            
        # 1. Fetch historical price data from Yahoo Finance for the last 6 months to get enough bars
        df = await fetch_history_df(symbol, "6mo", "1d")
        if df.empty:
            raise HTTPException(status_code=404, detail="No price data returned from Yahoo Chart endpoint.")
            
        # Take the last 60 trading days
        display_bars = min(60, len(df))
        df_display = df.iloc[-display_bars:]
        
        # 2. Fetch delivery history from daily_delivery_history
        delivery_history = {}
        try:
            with get_db() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    SELECT trade_date, delivery_qty, traded_qty, delivery_percentage 
                    FROM daily_delivery_history 
                    WHERE symbol = ? 
                    ORDER BY trade_date ASC
                """, (symbol,))
                for row in cursor.fetchall():
                    delivery_history[row["trade_date"]] = {
                        "delivery_qty": row["delivery_qty"],
                        "traded_qty": row["traded_qty"],
                        "delivery_percentage": row["delivery_percentage"]
                    }
        except Exception as db_err:
            print(f"Error querying delivery history: {db_err}")
            
        # 3. Fetch corporate actions (splits/bonus issues) for CAF volume adjustment
        corporate_actions = []
        try:
            with get_db() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    SELECT action_type, ex_date, ratio_multiplier 
                    FROM corporate_actions 
                    WHERE symbol = ?
                """, (symbol,))
                for row in cursor.fetchall():
                    corporate_actions.append({
                        "action_type": row["action_type"],
                        "ex_date": row["ex_date"],
                        "ratio_multiplier": row["ratio_multiplier"]
                    })
        except Exception as ca_err:
            print(f"Error querying corporate actions: {ca_err}")

        # 4. Compile matching candlesticks array
        candlesticks = []
        historical_delivery_values = []
        
        df["Vol_20MA"] = df["Volume"].rolling(window=20).mean().ffill().bfill()
        df_display_with_ma = df.iloc[-display_bars:]
        
        for idx in range(len(df_display_with_ma)):
            bar_date = df_display_with_ma.index[idx].strftime("%Y-%m-%d")
            vol = float(df_display_with_ma["Volume"].iloc[idx])
            close_p = float(df_display_with_ma["Close"].iloc[idx])
            
            if bar_date in delivery_history:
                deliv_pct = delivery_history[bar_date]["delivery_percentage"]
                deliv_qty = delivery_history[bar_date]["delivery_qty"]
                traded_qty = delivery_history[bar_date]["traded_qty"]
                
                # Sanitize None values from database
                if deliv_pct is None:
                    deliv_pct = 0.0
                if traded_qty is None:
                    traded_qty = int(vol)
                if deliv_qty is None:
                    deliv_qty = int(traded_qty * (deliv_pct / 100.0))
            else:
                deliv_pct = 0.0
                traded_qty = int(vol)
                deliv_qty = 0
                
            # Apply corporate action adjustments (CAF) to volume history
            for ca in corporate_actions:
                if bar_date < ca["ex_date"]:
                    if deliv_qty is not None:
                        deliv_qty = int(deliv_qty * ca["ratio_multiplier"])
                    if traded_qty is not None:
                        traded_qty = int(traded_qty * ca["ratio_multiplier"])
                    
            historical_delivery_values.append((deliv_qty or 0) * close_p)
            
            candlesticks.append({
                "time": bar_date,
                "open": round(float(df_display_with_ma["Open"].iloc[idx]), 2),
                "high": round(float(df_display_with_ma["High"].iloc[idx]), 2),
                "low": round(float(df_display_with_ma["Low"].iloc[idx]), 2),
                "close": round(close_p, 2),
                "volume": int(vol),
                "delivery_pct": round(deliv_pct, 2),
                "delivery_qty": deliv_qty,
                "traded_qty": traded_qty
            })
            
        # 5. Calculate Z-score and VSA Diagnostics on the latest bar
        latest_row = df_display_with_ma.iloc[-1]
        latest_vol_ma = df_display_with_ma["Vol_20MA"].iloc[-1]
        vsa_result = detect_vsa_setup(
            latest_row["Open"], latest_row["High"], latest_row["Low"], latest_row["Close"],
            latest_row["Volume"], latest_vol_ma
        )
        z_score = calculate_delivery_zscore(historical_delivery_values)
        
        vsa_diagnose = {
            "pattern": vsa_result["pattern"] if vsa_result else "Normal Price Action",
            "description": vsa_result["description"] if vsa_result else "No significant Volume Spread Analysis patterns or anomalies detected.",
            "type": vsa_result["type"] if vsa_result else "neutral",
            "z_score": z_score
        }
        
        # 6. Fetch Bulk & Block deals
        bulk_deals = []
        try:
            with get_db() as conn:
                cursor = conn.cursor()
                cursor.execute("""
                    SELECT id, deal_date, client_name, deal_type, quantity, price, percentage_equity, deal_window, is_mock 
                    FROM bulk_block_deals 
                    WHERE symbol = ? 
                    ORDER BY deal_date DESC
                """, (symbol,))
                
                rows_to_check = [dict(row) for row in cursor.fetchall()]
                updated_any = False
                
                for row_dict in rows_to_check:
                    deal_date = row_dict["deal_date"]
                    # Match date against retrieved historical dataframe
                    matching_candle = df.loc[df.index.strftime("%Y-%m-%d") == deal_date]
                    if not matching_candle.empty:
                        actual_close = float(matching_candle["Close"].iloc[0])
                        # If stored price deviates by > 5% from actual historical close, correct it
                        deviation = abs(row_dict["price"] - actual_close) / actual_close
                        if deviation > 0.05:
                            import random
                            slippage = random.uniform(-0.003, 0.003)
                            corrected_price = round(actual_close * (1 + slippage), 2)
                            row_dict["price"] = corrected_price
                            
                            # Persist the self-healed price
                            cursor.execute("""
                                UPDATE bulk_block_deals 
                                SET price = ? 
                                WHERE id = ?
                            """, (corrected_price, row_dict["id"]))
                            updated_any = True
                    
                    # Self-heal NULL percentage_equity values using cached profile shares or yfinance outstanding shares
                    if row_dict.get("percentage_equity") is None:
                        calculated_pct = None
                        # Try to resolve via cached profile total shares
                        try:
                            cursor.execute("SELECT profile_json FROM cached_profiles WHERE symbol = ?", (symbol,))
                            cached = cursor.fetchone()
                            if cached:
                                profile_data = json.loads(cached["profile_json"])
                                f_data = profile_data.get("fundamentals", {})
                                mc_cr = f_data.get("market_cap_cr")
                                curr_p = f_data.get("current_price")
                                if mc_cr and curr_p:
                                    total_shares = (float(mc_cr) * 10000000) / float(curr_p)
                                    calculated_pct = round((row_dict["quantity"] / total_shares) * 100, 2)
                        except Exception:
                            pass
                            
                        # If not resolved from cache, fallback to yfinance sharesOutstanding
                        if calculated_pct is None:
                            try:
                                ticker_info = yf.Ticker(symbol).info
                                shares_outstanding = ticker_info.get("sharesOutstanding")
                                if shares_outstanding:
                                    calculated_pct = round((row_dict["quantity"] / shares_outstanding) * 100, 2)
                            except Exception:
                                pass
                                
                        if calculated_pct is not None:
                            row_dict["percentage_equity"] = calculated_pct
                            cursor.execute("""
                                UPDATE bulk_block_deals 
                                SET percentage_equity = ? 
                                WHERE id = ?
                            """, (calculated_pct, row_dict["id"]))
                            updated_any = True
                            
                    row_dict.pop("id", None)
                    bulk_deals.append(row_dict)
                
                if updated_any:
                    conn.commit()
        except Exception as deal_err:
            print(f"Error fetching/correcting bulk deals: {deal_err}")
            
        # 7. Calculate Horizontal Volume Profile (VPVR) using existing helper
        vprofile = calculate_volume_profile(df_display_with_ma, bins=12)
        
        poc_price = float(df_display_with_ma["Close"].iloc[-1])
        if vprofile and len(vprofile) > 0:
            max_bin = max(vprofile, key=lambda x: x["volume"])
            poc_price = max_bin["price"]
            
        # 8. Call LLM for dynamic institutional summary
        from backend.agent import call_groq_llm
        
        system_prompt = (
            "You are an expert institutional Chartist and Volume Spread Analysis (VSA) Auditor specializing in the Indian stock market. "
            "Your job is to analyze price-volume dynamics, delivery percentages (smart money tracking), bulk/block deals, and corporate adjustments to write a concise, professional, executive-level summary of the stock's volume dynamics. "
            "Focus on whether there is clear accumulation (block buying), retail day-trading churn, support at Point of Control (POC), or Wyckoff accumulation/distribution signs. "
            "Include 4 specific pillars in your response: 1. Volumetric Status & Z-score (explaining if it represents smart money accumulation or speculative churn), "
            "2. Institutional Footprint (summarizing recent bulk/block deals, net promoter/mutual fund activity, and equity percentages traded), "
            "3. Key Structural Levels (contextualizing the Point of Control (POC) as an institutional floor or resistance), "
            "4. VSA Diagnosis (explaining the structural implications of recent candle spread anomalies)."
        )
        
        bulk_deals_summary = []
        real_deals_count = 0
        for bd in bulk_deals:
            if not bd.get("is_mock"):
                bulk_deals_summary.append(f"{bd['deal_date']}: {bd['deal_type']} of {bd['quantity']:,} shrs @ Rs.{bd['price']} by {bd['client_name']}")
                real_deals_count += 1
        
        latest_row = df_display_with_ma.iloc[-1]
        user_prompt = (
            f"Analyze the following Price-Volume Dynamics & VSA Audit data for {symbol}:\n"
            f"- Latest Price: Rs. {latest_row['Close']:.2f} (Open: Rs. {latest_row['Open']:.2f}, High: Rs. {latest_row['High']:.2f}, Low: Rs. {latest_row['Low']:.2f})\n"
            f"- Volume on latest bar: {latest_row['Volume']:.0f} (20-day Average: {latest_vol_ma:.0f})\n"
            f"- VSA Pattern Diagnosis: {vsa_diagnose['pattern']} - {vsa_diagnose['description']}\n"
            f"- Deliverable Value Z-Score: {z_score:.2f} (Standard Deviations relative to 20-day mean)\n"
            f"- Point of Control (POC) Price: Rs. {poc_price:.2f} (the high-volume node of the past 60 trading days)\n"
            f"- Bulk / Block Deals (past 60 days): {real_deals_count} real records on exchange. Details: {bulk_deals_summary}\n"
            f"- Corporate Actions (splits/bonus): {corporate_actions}\n\n"
            f"Generate a concise 3-4 sentence institutional-grade AI analysis explaining these price-volume dynamics. "
            f"Structure the paragraph around these exact details: (1) Volumetric status & delivery Z-score intensity, "
            f"(2) Recent promoter/institution real block deals on the exchange and net equity shares shifted (note: if no real deals are listed in the Details, state clearly that no real bulk/block deals have occurred recently on the exchange), "
            f"(3) POC price level safety net/floor, and (4) VSA candle anomaly implications for near-term momentum. "
            f"Do not use markdown headers, lists, or bullets; write it as a cohesive, professional paragraph."
        )
        
        ai_summary = ""
        is_local_summary = True
        if generate_ai:
            try:
                ai_summary = await asyncio.to_thread(call_groq_llm, system_prompt, user_prompt)
                if ai_summary and "ERROR" not in ai_summary.upper():
                    is_local_summary = False
            except Exception as llm_err:
                print(f"Error calling LLM for volume dynamics summary: {llm_err}")
                
        if is_local_summary:
            accum_status = "accumulation" if z_score >= 1.5 else ("distribution" if z_score <= -1.5 else "neutral consolidation")
            ai_summary = (
                f"The volume dynamics for {symbol} indicate a period of {accum_status} with a deliverable value Z-Score of {z_score:.2f}. "
                f"The Point of Control (POC) price level at Rs. {poc_price:.2f} represents the highest liquidity concentration node over the past 60 trading days, serving as a key institutional support floor. "
                f"The latest Volume Spread Analysis tags the current structure as a '{vsa_diagnose['pattern']}', suggesting that market participants are "
                f"{'strongly supporting the breakout' if vsa_diagnose['type'] == 'bullish' else ('showing signs of supply pressure' if vsa_diagnose['type'] == 'bearish' else 'consolidating within range bounds')}."
            )
            
        return {
            "status": "success",
            "symbol": symbol,
            "vsa_diagnose": vsa_diagnose,
            "candlesticks": candlesticks,
            "volume_profile": vprofile,
            "poc_price": poc_price,
            "bulk_deals": bulk_deals,
            "corporate_actions": corporate_actions,
            "ai_summary": ai_summary,
            "is_local_summary": is_local_summary
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Volume dynamics compilation failed: {str(e)}")


# ─── RULE SCANNER ENDPOINTS ────────────────────────────────────────────────────

@app.post("/api/screener/parse-nl-scan")
async def parse_nl_scan(data: ParseNLScanRequest):
    """Parses a plain English scanning prompt into structured scanner parameters using Groq LLM."""
    try:
        from backend.agent import call_groq_llm

        sys_prompt = (
            "You are an expert financial system developer parsing plain English stock scanning requests into structured JSON rules.\n"
            "The user wants to SCAN MULTIPLE STOCKS in a market universe (not set an alert for a single stock).\n"
            "Analyze the user prompt and output a single JSON object. DO NOT output any markdown tags (like ```json), and DO NOT output any conversational text or preambles. Only output the raw JSON string.\n"
            "Your output JSON must contain exactly these 4 keys: 'condition_type', 'operator', 'value', and 'universe'. DO NOT invent any other keys (such as 'additional_condition'). Map combinations of multiple criteria to the corresponding single allowed COMBO condition type.\n"
            "Allowed condition types:\n"
            "- RSI (Relative Strength Index limit)\n"
            "- PE (Price-to-Earnings ratio)\n"
            "- RATING (analyst recommendation: 'Strong Buy', 'Buy', 'Hold', 'Sell')\n"
            "- PRICE (absolute price floor/ceiling in Rs.)\n"
            "- SMA (price deviation from 200 SMA in %)\n"
            "- DMA_CROSS (50 SMA vs 200 SMA crossover, value = % separation filter)\n"
            "- EMA_CROSS (50 EMA vs 200 EMA crossover, value = % separation filter)\n"
            "- VOL_BREAKOUT (volume ratio vs 20d average, e.g. 2.0)\n"
            "- BB_CROSS (price vs Bollinger Bands, value = 0)\n"
            "- MACD_CROSS (MACD vs Signal line crossover, value = point diff filter)\n"
            "- 52W_PROXIMITY (proximity margin % to 52w limits)\n"
            "- SMA50 (price deviation from 50 SMA in %)\n"
            "- FIB_LEVEL (proximity to any Fibonacci level in %)\n"
            "- FIB_382 (proximity to Fib 38.2% in %)\n"
            "- FIB_500 (proximity to Fib 50.0% in %)\n"
            "- FIB_618 (proximity to Fib 61.8% in %)\n"
            "- COMBO_BULL_PULLBACK (Bull pullback: RSI oversold in SMA uptrend, e.g. RSI below 35 and golden cross / price above 200 SMA, value is the RSI threshold, e.g. 35)\n"
            "- COMBO_BEAR_PULLBACK (Bear pullback: RSI overbought in SMA downtrend, e.g. RSI above 60 and price below 200 SMA, value is the RSI threshold, e.g. 60)\n"
            "- COMBO_VALUE_REVERSAL (Oversold value buy: Low PE + RSI oversold, e.g. PE below 15 and RSI below 35, value is the PE or RSI threshold)\n"
            "- COMBO_GROWTH_MOMENTUM (Growth momentum: price above 200 SMA + RSI above 65 + strong buy rating, value is the RSI threshold)\n"
            "- COMBO_VOL_BREAKOUT (Volume trend breakout: volume above threshold average, e.g. 2.0 or 3.0 + price above 50 SMA, value is the volume threshold ratio, e.g. 2.0)\n"
            "- COMBO_52W_BREAKOUT (52W trend breakout: price above 200 SMA + within threshold % of 52w high, value is the proximity percentage threshold, e.g. 3.0)\n"
            "- COMBO_52W_VAL_ENTRY (52W value entry: within threshold % of 52w low + RSI below 35, value is the proximity percentage threshold, e.g. 5.0)\n"
            "- COMBO_FIB_REVERSAL (Fib support bounce: near Fibonacci level + RSI below 35, value is the Fib proximity percentage threshold, e.g. 2.0)\n"
            "- COMBO_BB_REVERSION (BB mean reversion: below BB lower band + RSI below 30, value is the RSI threshold)\n"
            "- COMBO_BB_BREAKOUT (BB volatility breakout: above BB upper band + volume above threshold average, value is the volume ratio threshold, e.g. 2.0)\n"
            "- COMBO_MACD_VOL (MACD cross with volume surge: MACD cross above Signal + volume above threshold average, value is the volume ratio threshold, e.g. 2.0)\n"
            "- COMBO_HIGH_QUALITY_DIP (Quality dip buy: Buy/Strong Buy rating + RSI below 35, value is the RSI threshold)\n"
            "- COMBO_DEATH_CROSS_VOL (Death cross volume spurt: 50 SMA crosses below 200 SMA + volume above threshold average, value is the volume ratio threshold, e.g. 2.0)\n"
            "- COMBO_FIB_SMA_BOUNCE (Fib & SMA-200 confluence: near Fib level + price above 200 SMA, value is the Fib proximity percentage threshold, e.g. 2.0)\n"
            "- COMBO_PENNY_MOMENTUM (Penny stock momentum: price below 100 + RSI above 65 + volume above threshold average, value is the volume ratio threshold, e.g. 2.0)\n"
            "- COMBO_PREMIUM_GROWTH (Premium quality growth: price above 2000 + PE below 30 + Strong Buy rating, value is the PE threshold)\n"
            "- COMBO_EARNINGS_ACCUMULATION (PE value accumulation: PE below 20 + volume above threshold average, value is the volume ratio threshold, e.g. 2.0)\n"
            "- COMBO_SHORT_TERM_REVERSION (Short pullback in uptrend: price below 50 SMA + price above 200 SMA)\n"
            "- COMBO_BB_SQUEEZE_BREAK (BB squeeze breakout: Bollinger Bands squeeze / narrow width + volume above threshold average, value is the volume ratio threshold, e.g. 2.0)\n"
            "- COMBO_CONTRARIAN_VALUE (Contrarian value play: PE below 12 + price below 200 SMA + RSI below 30, value is the PE threshold)\n\n"
            "Operators:\n"
            "- '>' (Greater Than / Crosses Above)\n"
            "- '<' (Less Than / Crosses Below)\n"
            "- '==' (Equals / Near Proximity)\n\n"
            "Universe options: 'all', 'large', 'mid', 'small'\n\n"
            "Output format example:\n"
            "{\n"
            "  \"condition_type\": \"RSI\",\n"
            "  \"operator\": \"<\",\n"
            "  \"value\": \"35\",\n"
            "  \"universe\": \"mid\"\n"
            "}"
        )

        response = await asyncio.to_thread(call_groq_llm, sys_prompt, data.prompt)
        response = response.strip()
        if response.startswith("```json"):
            response = response[7:]
        if response.endswith("```"):
            response = response[:-3]
        response = response.strip()

        parsed = json.loads(response)
        return {
            "status": "success",
            "condition_type": parsed.get("condition_type", "RSI").upper(),
            "operator": parsed.get("operator", "<"),
            "value": str(parsed.get("value", "30")),
            "universe": parsed.get("universe", "all").lower()
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to parse scan prompt: {str(e)}")


class TelemetrySynthesisRequest(BaseModel):
    ticker: str
    price: float
    rsi: float
    condition_type: str
    operator: str
    value: str
    proximity: str

@app.post("/api/alerts/telemetry-synthesis")
async def get_telemetry_synthesis(data: TelemetrySynthesisRequest):
    """
    Generates a concise, institutional-grade AI summary for a clicked alert target
    and its calculated proximity margin.
    """
    try:
        from backend.agent import call_groq_llm
        system_prompt = (
            "You are an expert institutional risk desk manager and quantitative analyst specializing in the Indian stock market. "
            "Your job is to provide a highly professional, 1-2 sentence AI synthesis explaining the immediate momentum, risk, "
            "or support implications of the stock's proximity to its target indicator threshold. "
            "Do not state your prompt or mention you are an AI. Write as a concise, professional analyst report statement (keep it under 45 words)."
        )
        user_prompt = (
            f"Asset: {data.ticker}\n"
            f"Current Price: Rs. {data.price:.2f}\n"
            f"RSI-14: {data.rsi:.1f}\n"
            f"Alert Condition: {data.condition_type} {data.operator} {data.value}\n"
            f"Proximity Calculation: {data.proximity}\n\n"
            f"Generate a 1-2 sentence institutional risk/momentum summary for this proximity setup."
        )
        synthesis = await asyncio.to_thread(call_groq_llm, system_prompt, user_prompt)
        return {"synthesis": synthesis.strip()}
    except Exception as e:
        import traceback
        print("Exception in get_telemetry_synthesis:")
        traceback.print_exc()
        return {"synthesis": f"Unable to generate AI telemetry synthesis at this time. Error: {str(e)}"}



@app.get("/api/screener/scan-trigger")
async def scan_trigger(condition_type: str, operator: str, value: str, universe: str = "all"):
    """Scans the stock universe for matches against a given condition/trigger rule."""
    try:
        from backend.swing_utils import clean_float

        matched = []
        with get_db() as conn:
            cursor = conn.cursor()
            if universe == "all":
                cursor.execute("SELECT symbol, company_name, sector, cap_type FROM screener_universe WHERE symbol NOT LIKE '%DUMMY%'")
            else:
                cursor.execute("SELECT symbol, company_name, sector, cap_type FROM screener_universe WHERE cap_type = ? AND symbol NOT LIKE '%DUMMY%'", (universe,))
            stocks = [dict(row) for row in cursor.fetchall()]

            cursor.execute("SELECT symbol, profile_json FROM cached_profiles")
            cached_rows = cursor.fetchall()
            cached_profiles = {}
            for r in cached_rows:
                try:
                    cached_profiles[r["symbol"]] = json.loads(r["profile_json"])
                except Exception:
                    continue

        scanned_count = 0
        for s in stocks:
            sym = s["symbol"]
            prof = cached_profiles.get(sym)
            if not prof:
                continue

            f = prof.get("fundamentals") or {}
            t = prof.get("technicals") or {}

            price = clean_float(f.get("current_price"), 0.0)
            if price <= 0.0:
                continue

            scanned_count += 1
            triggered = False
            cur_val = ""

            try:
                if condition_type == "RSI":
                    rsi_val = clean_float(t.get("rsi"), 50.0)
                    cur_val = f"RSI: {rsi_val:.1f}"
                    if operator == "<" and rsi_val < float(value):
                        triggered = True
                    elif operator == ">" and rsi_val > float(value):
                        triggered = True

                elif condition_type == "PE":
                    pe_val = clean_float(f.get("pe_ratio"), 0.0)
                    if pe_val <= 0.0:
                        continue
                    cur_val = f"P/E: {pe_val:.1f}"
                    threshold = float(value)
                    if operator == "<" and pe_val < threshold:
                        triggered = True
                    elif operator == ">" and pe_val > threshold:
                        triggered = True

                elif condition_type == "RATING":
                    analysis = prof.get("analysis") or {}
                    rating_val = (analysis.get("recommendation") or "HOLD").upper()
                    cur_val = f"Rating: {rating_val}"
                    if operator == "==" and rating_val == value.upper():
                        triggered = True

                elif condition_type == "PRICE":
                    cur_val = f"Price: Rs. {price:.2f}"
                    threshold = float(value)
                    if operator == "<" and price < threshold:
                        triggered = True
                    elif operator == ">" and price > threshold:
                        triggered = True

                elif condition_type == "SMA":
                    sma_200 = clean_float(t.get("sma_200"), 0.0)
                    if sma_200 <= 0.0:
                        continue
                    pct_diff = ((price - sma_200) / sma_200) * 100
                    cur_val = f"Price vs SMA200: {pct_diff:+.1f}%"
                    threshold = float(value)
                    if operator == ">" and pct_diff > threshold:
                        triggered = True
                    elif operator == "<" and pct_diff < threshold:
                        triggered = True

                elif condition_type == "SMA50":
                    sma_50 = clean_float(t.get("sma_50"), 0.0)
                    if sma_50 <= 0.0:
                        continue
                    pct_diff = ((price - sma_50) / sma_50) * 100
                    cur_val = f"Price vs SMA50: {pct_diff:+.1f}%"
                    threshold = float(value)
                    if operator == ">" and pct_diff > threshold:
                        triggered = True
                    elif operator == "<" and pct_diff < threshold:
                        triggered = True

                elif condition_type in ["DMA_CROSS", "EMA_CROSS"]:
                    sma_50 = clean_float(t.get("sma_50"), 0.0)
                    sma_200 = clean_float(t.get("sma_200"), 0.0)
                    if condition_type == "EMA_CROSS":
                        sma_50 = clean_float(t.get("ema_50", t.get("sma_50")), 0.0)
                        sma_200 = clean_float(t.get("ema_200", t.get("sma_200")), 0.0)
                    if sma_200 <= 0.0 or sma_50 <= 0.0:
                        continue
                    diff_pct = ((sma_50 - sma_200) / sma_200) * 100
                    label = "SMA" if condition_type == "DMA_CROSS" else "EMA"
                    cur_val = f"50d {label}: Rs.{sma_50:.0f} vs 200d: Rs.{sma_200:.0f} ({diff_pct:+.1f}%)"
                    threshold = float(value)
                    if operator == ">" and diff_pct > threshold:
                        triggered = True
                    elif operator == "<" and diff_pct < -abs(threshold):
                        triggered = True

                elif condition_type == "VOL_BREAKOUT":
                    vol_ratio = clean_float(t.get("volume_vs_avg20", t.get("volume_ratio", t.get("vol_breakout_ratio"))), 1.0)
                    cur_val = f"Vol Ratio: {vol_ratio:.2f}x"
                    threshold = float(value)
                    if operator == ">" and vol_ratio > threshold:
                        triggered = True
                    elif operator == "<" and vol_ratio < threshold:
                        triggered = True

                elif condition_type == "BB_CROSS":
                    bb_lower = clean_float(t.get("bb_lower"), 0.0)
                    bb_upper = clean_float(t.get("bb_upper"), 0.0)
                    if operator == "<":
                        cur_val = f"Price: Rs.{price:.0f} vs BB Lower: Rs.{bb_lower:.0f}"
                        if bb_lower > 0 and price <= bb_lower:
                            triggered = True
                    elif operator == ">":
                        cur_val = f"Price: Rs.{price:.0f} vs BB Upper: Rs.{bb_upper:.0f}"
                        if bb_upper > 0 and price >= bb_upper:
                            triggered = True

                elif condition_type == "MACD_CROSS":
                    macd_val = clean_float(t.get("macd"), 0.0)
                    signal_val = clean_float(t.get("signal"), 0.0)
                    diff = macd_val - signal_val
                    cur_val = f"MACD: {macd_val:.3f} vs Signal: {signal_val:.3f}"
                    threshold = float(value)
                    if operator == ">" and diff > threshold:
                        triggered = True
                    elif operator == "<" and diff < -abs(threshold):
                        triggered = True

                elif condition_type == "52W_PROXIMITY":
                    high_52w = clean_float(t.get("high_52w", t.get("year_high", f.get("year_high", f.get("52w_high")))), 0.0)
                    low_52w = clean_float(t.get("low_52w", t.get("year_low", f.get("year_low", f.get("52w_low")))), 0.0)
                    proximity_pct = float(value)
                    if operator == ">":
                        if high_52w > 0:
                            diff_pct = ((high_52w - price) / high_52w) * 100
                            cur_val = f"Price: Rs.{price:.0f} (52wH: Rs.{high_52w:.0f}, Diff: {diff_pct:.1f}%)"
                            if diff_pct <= proximity_pct:
                                triggered = True
                    elif operator == "<":
                        if low_52w > 0:
                            diff_pct = ((price - low_52w) / low_52w) * 100
                            cur_val = f"Price: Rs.{price:.0f} (52wL: Rs.{low_52w:.0f}, Diff: {diff_pct:.1f}%)"
                            if diff_pct <= proximity_pct:
                                triggered = True

                elif condition_type in ["FIB_LEVEL", "FIB_382", "FIB_500", "FIB_618"]:
                    high_52w = clean_float(t.get("high_52w", t.get("year_high", f.get("year_high", f.get("52w_high")))), 0.0)
                    low_52w = clean_float(t.get("low_52w", t.get("year_low", f.get("year_low", f.get("52w_low")))), 0.0)
                    if high_52w <= 0 or low_52w <= 0:
                        continue
                    swing_diff = high_52w - low_52w
                    fib_382 = high_52w - 0.382 * swing_diff
                    fib_500 = high_52w - 0.500 * swing_diff
                    fib_618 = high_52w - 0.618 * swing_diff
                    proximity_pct = float(value) if value else 1.5

                    levels_to_check = []
                    if condition_type == "FIB_LEVEL":
                        levels_to_check = [("38.2%", fib_382), ("50.0%", fib_500), ("61.8%", fib_618)]
                    elif condition_type == "FIB_382":
                        levels_to_check = [("38.2%", fib_382)]
                    elif condition_type == "FIB_500":
                        levels_to_check = [("50.0%", fib_500)]
                    elif condition_type == "FIB_618":
                        levels_to_check = [("61.8%", fib_618)]

                    for lbl, lvl in levels_to_check:
                        if lvl > 0:
                            diff_pct = abs(((price - lvl) / lvl) * 100)
                            if diff_pct <= proximity_pct:
                                cur_val = f"Price: Rs.{price:.0f} near Fib {lbl} (Rs.{lvl:.0f}, Diff: {diff_pct:.1f}%)"
                                triggered = True
                                break

                # ─── MULTI-FACTOR COMBO STRATEGIES ─────────────────────────────────────
                elif condition_type == "COMBO_BULL_PULLBACK":
                    rsi_val = clean_float(t.get("rsi"), 50.0)
                    sma_200 = clean_float(t.get("sma_200"), 0.0)
                    if rsi_val < 35 and price > sma_200 > 0:
                        cur_val = f"RSI: {rsi_val:.1f}, Price above SMA200 (Rs.{sma_200:.0f})"
                        triggered = True

                elif condition_type == "COMBO_BEAR_PULLBACK":
                    rsi_val = clean_float(t.get("rsi"), 50.0)
                    sma_200 = clean_float(t.get("sma_200"), 0.0)
                    if rsi_val > 60 and sma_200 > 0 and price < sma_200:
                        cur_val = f"RSI: {rsi_val:.1f}, Price below SMA200 (Rs.{sma_200:.0f})"
                        triggered = True

                elif condition_type == "COMBO_VALUE_REVERSAL":
                    pe_val = clean_float(f.get("pe_ratio"), 0.0)
                    rsi_val = clean_float(t.get("rsi"), 50.0)
                    if 0 < pe_val < 15.0 and rsi_val < 35:
                        cur_val = f"P/E: {pe_val:.1f}, RSI: {rsi_val:.1f}"
                        triggered = True

                elif condition_type == "COMBO_GROWTH_MOMENTUM":
                    rsi_val = clean_float(t.get("rsi"), 50.0)
                    sma_200 = clean_float(t.get("sma_200"), 0.0)
                    analysis = prof.get("analysis") or {}
                    rating_val = (analysis.get("recommendation") or "HOLD").upper()
                    if rsi_val > 65 and price > sma_200 > 0 and "STRONG BUY" in rating_val:
                        cur_val = f"RSI: {rsi_val:.1f}, Strong Buy, Above SMA200"
                        triggered = True

                elif condition_type == "COMBO_VOL_BREAKOUT":
                    vol_ratio = clean_float(t.get("volume_vs_avg20", t.get("volume_ratio", t.get("vol_breakout_ratio"))), 1.0)
                    sma_50 = clean_float(t.get("sma_50"), 0.0)
                    threshold = clean_float(value, 2.0)
                    if vol_ratio > threshold and price > sma_50 > 0:
                        cur_val = f"Vol: {vol_ratio:.1f}x, Above SMA50 (Rs.{sma_50:.0f})"
                        triggered = True

                elif condition_type == "COMBO_52W_BREAKOUT":
                    sma_200 = clean_float(t.get("sma_200"), 0.0)
                    high_52w = clean_float(t.get("high_52w", t.get("year_high", f.get("year_high", f.get("52w_high")))), 0.0)
                    if price > sma_200 > 0 and high_52w > 0:
                        diff_pct = ((high_52w - price) / high_52w) * 100
                        threshold = clean_float(value, 3.0)
                        if diff_pct <= threshold:
                            cur_val = f"Uptrend, within {diff_pct:.1f}% of 52wH (Rs.{high_52w:.0f})"
                            triggered = True

                elif condition_type == "COMBO_52W_VAL_ENTRY":
                    rsi_val = clean_float(t.get("rsi"), 50.0)
                    low_52w = clean_float(t.get("low_52w", t.get("year_low", f.get("year_low", f.get("52w_low")))), 0.0)
                    if rsi_val < 35 and low_52w > 0:
                        diff_pct = ((price - low_52w) / low_52w) * 100
                        threshold = clean_float(value, 5.0)
                        if diff_pct <= threshold:
                            cur_val = f"RSI: {rsi_val:.1f}, within {diff_pct:.1f}% of 52wL (Rs.{low_52w:.0f})"
                            triggered = True

                elif condition_type == "COMBO_FIB_REVERSAL":
                    rsi_val = clean_float(t.get("rsi"), 50.0)
                    if rsi_val < 35:
                        high_52w = clean_float(t.get("high_52w", t.get("year_high", f.get("year_high", f.get("52w_high")))), 0.0)
                        low_52w = clean_float(t.get("low_52w", t.get("year_low", f.get("year_low", f.get("52w_low")))), 0.0)
                        if high_52w > 0 and low_52w > 0 and high_52w > low_52w:
                            swing = high_52w - low_52w
                            levels = {
                                "23.6%": high_52w - 0.236 * swing,
                                "38.2%": high_52w - 0.382 * swing,
                                "50.0%": high_52w - 0.500 * swing,
                                "61.8%": high_52w - 0.618 * swing,
                                "78.6%": high_52w - 0.786 * swing
                            }
                            threshold = clean_float(value, 2.0)
                            for lbl, val in levels.items():
                                diff = abs(((price - val) / val) * 100)
                                if diff <= threshold:
                                    cur_val = f"RSI: {rsi_val:.1f}, near Fib {lbl} (Diff: {diff:.1f}%)"
                                    triggered = True
                                    break

                elif condition_type == "COMBO_BB_REVERSION":
                    rsi_val = clean_float(t.get("rsi"), 50.0)
                    bb_lower = clean_float(t.get("bb_lower"), 0.0)
                    if rsi_val < 30 and bb_lower > 0 and price <= bb_lower:
                        cur_val = f"RSI: {rsi_val:.1f}, Price <= BB Lower (Rs.{bb_lower:.0f})"
                        triggered = True

                elif condition_type == "COMBO_BB_BREAKOUT":
                    bb_upper = clean_float(t.get("bb_upper"), 0.0)
                    vol_ratio = clean_float(t.get("volume_vs_avg20", t.get("volume_ratio", t.get("vol_breakout_ratio"))), 1.0)
                    threshold = clean_float(value, 2.0)
                    if bb_upper > 0 and price >= bb_upper and vol_ratio > threshold:
                        cur_val = f"Price >= BB Upper (Rs.{bb_upper:.0f}), Vol: {vol_ratio:.1f}x"
                        triggered = True

                elif condition_type == "COMBO_MACD_VOL":
                    macd_val = clean_float(t.get("macd"), 0.0)
                    signal_val = clean_float(t.get("signal"), 0.0)
                    vol_ratio = clean_float(t.get("volume_vs_avg20", t.get("volume_ratio", t.get("vol_breakout_ratio"))), 1.0)
                    threshold = clean_float(value, 2.0)
                    if macd_val > signal_val and vol_ratio > threshold:
                        cur_val = f"MACD Golden Cross, Vol: {vol_ratio:.1f}x"
                        triggered = True

                elif condition_type == "COMBO_HIGH_QUALITY_DIP":
                    rsi_val = clean_float(t.get("rsi"), 50.0)
                    analysis = prof.get("analysis") or {}
                    rating_val = (analysis.get("recommendation") or "HOLD").upper()
                    if rsi_val < 35 and ("BUY" in rating_val or "STRONG" in rating_val):
                        cur_val = f"Rating: {rating_val}, RSI: {rsi_val:.1f}"
                        triggered = True

                elif condition_type == "COMBO_DEATH_CROSS_VOL":
                    sma_50 = clean_float(t.get("sma_50"), 0.0)
                    sma_200 = clean_float(t.get("sma_200"), 0.0)
                    vol_ratio = clean_float(t.get("volume_vs_avg20", t.get("volume_ratio", t.get("vol_breakout_ratio"))), 1.0)
                    threshold = clean_float(value, 2.0)
                    if sma_50 > 0 and sma_200 > 0 and sma_50 < sma_200 and vol_ratio > threshold:
                        cur_val = f"Death Cross Active, Vol: {vol_ratio:.1f}x"
                        triggered = True

                elif condition_type == "COMBO_FIB_SMA_BOUNCE":
                    sma_200 = clean_float(t.get("sma_200"), 0.0)
                    if price > sma_200 > 0:
                        high_52w = clean_float(t.get("high_52w", t.get("year_high", f.get("year_high", f.get("52w_high")))), 0.0)
                        low_52w = clean_float(t.get("low_52w", t.get("year_low", f.get("year_low", f.get("52w_low")))), 0.0)
                        if high_52w > 0 and low_52w > 0 and high_52w > low_52w:
                            swing = high_52w - low_52w
                            levels = {
                                "23.6%": high_52w - 0.236 * swing,
                                "38.2%": high_52w - 0.382 * swing,
                                "50.0%": high_52w - 0.500 * swing,
                                "61.8%": high_52w - 0.618 * swing,
                                "78.6%": high_52w - 0.786 * swing
                            }
                            threshold = clean_float(value, 2.0)
                            for lbl, val in levels.items():
                                diff = abs(((price - val) / val) * 100)
                                if diff <= threshold:
                                    cur_val = f"Above SMA200, near Fib {lbl} (Diff: {diff:.1f}%)"
                                    triggered = True
                                    break

                elif condition_type == "COMBO_PENNY_MOMENTUM":
                    rsi_val = clean_float(t.get("rsi"), 50.0)
                    vol_ratio = clean_float(t.get("volume_vs_avg20", t.get("volume_ratio", t.get("vol_breakout_ratio"))), 1.0)
                    threshold = clean_float(value, 2.0)
                    if price < 100.0 and rsi_val > 65 and vol_ratio > threshold:
                        cur_val = f"Penny Stock, RSI: {rsi_val:.1f}, Vol: {vol_ratio:.1f}x"
                        triggered = True

                elif condition_type == "COMBO_PREMIUM_GROWTH":
                    pe_val = clean_float(f.get("pe_ratio"), 0.0)
                    analysis = prof.get("analysis") or {}
                    rating_val = (analysis.get("recommendation") or "HOLD").upper()
                    if price > 2000.0 and 0 < pe_val < 30.0 and "STRONG BUY" in rating_val:
                        cur_val = f"Premium (Rs.{price:.0f}), PE: {pe_val:.1f}, Rating: STRONG BUY"
                        triggered = True

                elif condition_type == "COMBO_EARNINGS_ACCUMULATION":
                    pe_val = clean_float(f.get("pe_ratio"), 0.0)
                    vol_ratio = clean_float(t.get("volume_vs_avg20", t.get("volume_ratio", t.get("vol_breakout_ratio"))), 1.0)
                    threshold = clean_float(value, 2.0)
                    if 0 < pe_val < 20.0 and vol_ratio > threshold:
                        cur_val = f"Value PE: {pe_val:.1f}, Vol Spurt: {vol_ratio:.1f}x"
                        triggered = True

                elif condition_type == "COMBO_SHORT_TERM_REVERSION":
                    sma_50 = clean_float(t.get("sma_50"), 0.0)
                    sma_200 = clean_float(t.get("sma_200"), 0.0)
                    if sma_50 > 0 and sma_200 > 0 and price < sma_50 and price > sma_200:
                        cur_val = f"Short Pullback (Price below SMA50, above SMA200)"
                        triggered = True

                elif condition_type == "COMBO_BB_SQUEEZE_BREAK":
                    bb_lower = clean_float(t.get("bb_lower"), 0.0)
                    bb_upper = clean_float(t.get("bb_upper"), 0.0)
                    vol_ratio = clean_float(t.get("volume_vs_avg20", t.get("volume_ratio", t.get("vol_breakout_ratio"))), 1.0)
                    threshold = clean_float(value, 2.0)
                    if bb_lower > 0 and bb_upper > 0 and vol_ratio > threshold:
                        middle = (bb_upper + bb_lower) / 2.0
                        width_pct = ((bb_upper - bb_lower) / middle) * 100
                        if width_pct <= 10.0 and price >= bb_upper:
                            cur_val = f"BB Width: {width_pct:.1f}% (Squeeze), Upper Breakout, Vol: {vol_ratio:.1f}x"
                            triggered = True

                elif condition_type == "COMBO_CONTRARIAN_VALUE":
                    pe_val = clean_float(f.get("pe_ratio"), 0.0)
                    rsi_val = clean_float(t.get("rsi"), 50.0)
                    sma_200 = clean_float(t.get("sma_200"), 0.0)
                    if 0 < pe_val < 12.0 and rsi_val < 30 and price < sma_200 > 0:
                        cur_val = f"Contrarian PE: {pe_val:.1f}, RSI: {rsi_val:.1f}, Below SMA200"
                        triggered = True

            except Exception as eval_err:
                print(f"Rule Scanner: Error evaluating {sym}: {eval_err}")
                continue

            if triggered:
                rsi = clean_float(t.get("rsi"), 0.0)
                pe = clean_float(f.get("pe_ratio"), 0.0)
                sector = s.get("sector", "N/A")
                cap_type = s.get("cap_type", "N/A")
                analysis = prof.get("analysis") or {}
                rating = (analysis.get("recommendation") or prof.get("recommendation") or "N/A").upper()
                score = clean_float(prof.get("final_score") or prof.get("score_metrics", {}).get("final_score") or analysis.get("score", analysis.get("composite_score")), 0.0)
                de_ratio = clean_float(f.get("debt_to_equity", f.get("de_ratio")), 0.0)
                roe = clean_float(f.get("roe_pct") or f.get("roe"), 0.0)
                info_dict = prof.get("info") or {}
                cons_dict = prof.get("consensus") or {}
                n50_dict = prof.get("nifty50_risk") or {}
                capm_dict = prof.get("capm_risk_nifty50") or {}
                beta = clean_float(info_dict.get("beta") or cons_dict.get("beta") or n50_dict.get("beta") or capm_dict.get("beta"), 1.0)

                matched.append({
                    "symbol": sym,
                    "company_name": s.get("company_name", sym),
                    "sector": sector,
                    "cap_type": cap_type,
                    "price": round(price, 2),
                    "pe": round(pe, 1),
                    "rsi": round(rsi, 1),
                    "trigger_value": cur_val,
                    "rating": rating,
                    "score": round(score, 1),
                    "de_ratio": round(de_ratio, 2),
                    "roe": round(roe, 1),
                    "beta": round(beta, 2)
                })

        return {
            "status": "success",
            "scanned": scanned_count,
            "matched": len(matched),
            "universe": universe,
            "condition": f"{condition_type} {operator} {value}",
            "results": matched
        }
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Rule scan failed: {str(e)}")


@app.post("/api/screener/scan-synthesis")
async def scan_synthesis(data: ScanSynthesisRequest):
    """Generates an AI analyst synthesis summary for rule scanner results using Groq."""
    try:
        from backend.agent import call_groq_llm

        top_results = data.results[:20]
        results_text = "\n".join([
            f"- {r.get('symbol','?')}: {r.get('trigger_value','N/A')} | Sector: {r.get('sector','N/A')} | Cap: {r.get('cap_type','N/A')} | P/E: {r.get('pe','N/A')} | RSI: {r.get('rsi','N/A')} | Rating: {r.get('rating','N/A')}"
            for r in top_results
        ])

        sys_prompt = (
            "You are a senior institutional equity analyst. Analyze the following scan results and provide a concise 2-3 sentence synthesis.\n"
            "Focus on: sector concentration patterns, valuation clusters, technical positioning, and actionable observations.\n"
            "Be professional and quantitative. Reference specific sectors and metrics where relevant.\n"
            "Do NOT use bullet points or headers. Write in flowing paragraph form."
        )

        user_prompt = (
            f"Scan Condition: {data.condition_desc}\n"
            f"Total Matches: {len(data.results)}\n\n"
            f"Top matching stocks:\n{results_text}"
        )

        summary = await asyncio.to_thread(call_groq_llm, sys_prompt, user_prompt)
        return {"status": "success", "synthesis": summary.strip()}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Synthesis generation failed: {str(e)}")


@app.post("/api/screener/explain-formula")
async def explain_formula(data: ExplainFormulaRequest):
    """Generates an AI explanation of the Chartink-style formula using Groq."""
    try:
        from backend.formula_parser import parse_formula_to_conditions
        # Validate syntax locally first
        try:
            parse_formula_to_conditions(data.formula)
        except Exception as pe:
            raise HTTPException(status_code=400, detail=f"Formula Syntax Error: {str(pe)}")
            
        from backend.agent import call_groq_llm
        
        sys_prompt = (
            "You are a professional quantitative finance and technical analysis expert.\n"
            "Analyze the given stock scanner formula and explain its conditions, mathematical logic, and what kind of trade setups or chart patterns it scans for in a clear, concise, and professional tone.\n"
            "Format the output using markdown if necessary, using simple terminology suitable for traders. Keep it under 4 sentences."
        )
        
        user_prompt = f"Stock Scanner Formula:\n{data.formula}"
        
        explanation = await asyncio.to_thread(call_groq_llm, sys_prompt, user_prompt)
        return {"status": "success", "explanation": explanation.strip()}
    except HTTPException as he:
        raise he
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate explanation: {str(e)}")


# ─── CHARTINK-STYLE CUSTOM SCREENER ENGINE ─────────────────────────────────────

def compute_dataframe_indicators(df: pd.DataFrame, timeframe: str) -> List[dict]:
    import numpy as np
    import pandas as pd
    
    if df.empty or len(df) < 5:
        return []
        
    df = df.copy()
    
    df['Close'] = df['Close'].ffill().bfill()
    df['Volume'] = df['Volume'].ffill().bfill()
    
    if 'High' in df.columns:
        df['High'] = df['High'].ffill().bfill()
    else:
        df['High'] = df['Close']
        
    if 'Low' in df.columns:
        df['Low'] = df['Low'].ffill().bfill()
    else:
        df['Low'] = df['Close']
        
    if 'Open' in df.columns:
        df['Open'] = df['Open'].ffill().bfill()
    else:
        df['Open'] = df['Close']
    
    df['SMA_50'] = df['Close'].rolling(window=50).mean()
    df['SMA_200'] = df['Close'].rolling(window=200).mean()
    df['EMA_50'] = df['Close'].ewm(span=50, adjust=False).mean()
    df['EMA_200'] = df['Close'].ewm(span=200, adjust=False).mean()
    
    # RSI 14
    delta = df['Close'].diff()
    gain = (delta.where(delta > 0, 0)).rolling(window=14).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(window=14).mean()
    rs = gain / (loss + 1e-9)
    df['RSI_14'] = 100 - (100 / (1 + rs))
    
    # Volume Ratio vs 20d Average
    df['Vol_20MA'] = df['Volume'].rolling(window=20).mean()
    df['Vol_Ratio'] = df['Volume'] / (df['Vol_20MA'] + 1e-9)
    
    # Bollinger Bands
    df['SMA_20'] = df['Close'].rolling(window=20).mean()
    df['STD_20'] = df['Close'].rolling(window=20).std()
    df['BB_Upper'] = df['SMA_20'] + 2 * df['STD_20']
    df['BB_Lower'] = df['SMA_20'] - 2 * df['STD_20']
    
    # MACD & Signal
    df['EMA_12'] = df['Close'].ewm(span=12, adjust=False).mean()
    df['EMA_26'] = df['Close'].ewm(span=26, adjust=False).mean()
    df['MACD'] = df['EMA_12'] - df['EMA_26']
    df['MACD_Signal'] = df['MACD'].ewm(span=9, adjust=False).mean()
    
    # Trailing High/Low lookbacks (250 bars for daily, 52 for weekly, 12 for monthly)
    lookback = 250 if timeframe == '1d' else (52 if timeframe == '1wk' else 12)
    df['year_high'] = df['Close'].rolling(window=lookback, min_periods=1).max()
    df['year_low'] = df['Close'].rolling(window=lookback, min_periods=1).min()
    
    cols = ['Open', 'High', 'Low', 'SMA_50', 'SMA_200', 'EMA_50', 'EMA_200', 'RSI_14', 'Vol_Ratio', 'BB_Upper', 'BB_Lower', 'MACD', 'MACD_Signal', 'year_high', 'year_low']
    for col in cols:
        if col in df.columns:
            df[col] = df[col].bfill().ffill().fillna(0.0)
            
    df = df.reset_index()
    date_col = 'Date' if 'Date' in df.columns else df.columns[0]
    
    results = []
    for _, row in df.iterrows():
        try:
            dt_val = row[date_col]
            if isinstance(dt_val, str):
                date_str = dt_val[:10]
            else:
                date_str = dt_val.strftime("%Y-%m-%d")
        except Exception:
            date_str = str(dt_val)[:10]
            
        results.append({
            "date": date_str,
            "Close": float(row["Close"]),
            "High": float(row["High"]),
            "Low": float(row["Low"]),
            "Open": float(row["Open"]),
            "Volume": float(row["Volume"]),
            "Vol_Ratio": float(row["Vol_Ratio"]),
            "RSI_14": float(row["RSI_14"]),
            "SMA_50": float(row["SMA_50"]),
            "SMA_200": float(row["SMA_200"]),
            "EMA_50": float(row["EMA_50"]),
            "EMA_200": float(row["EMA_200"]),
            "BB_Upper": float(row["BB_Upper"]),
            "BB_Lower": float(row["BB_Lower"]),
            "MACD": float(row["MACD"]),
            "MACD_Signal": float(row["MACD_Signal"]),
            "year_high": float(row["year_high"]),
            "year_low": float(row["year_low"])
        })
        
    return results

async def get_timeframe_indicators(symbol: str, timeframe: str) -> List[dict]:
    if timeframe not in ['1d', '1wk', '1mo']:
        timeframe = '1d'
        
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT indicators_json, updated_at 
                FROM cached_timeframe_indicators 
                WHERE symbol = ? AND timeframe = ?
            """, (symbol, timeframe))
            row = cursor.fetchone()
            
        if row:
            try:
                cache_time = datetime.strptime(row["updated_at"], "%Y-%m-%d %H:%M:%S")
                age = datetime.now() - cache_time
                if age.total_seconds() < 14400:  # 4 hours
                    return json.loads(row["indicators_json"])
            except Exception:
                pass
    except Exception as db_err:
        print(f"Error reading timeframe indicator cache: {db_err}")
        
    period = "2y" if timeframe == '1d' else ("5y" if timeframe == '1wk' else "max")
    df = await fetch_history_df(symbol, period=period, interval=timeframe)
    
    if df.empty:
        try:
            ticker_obj = yf.Ticker(symbol)
            df = await asyncio.to_thread(ticker_obj.history, period=period, interval=timeframe)
        except Exception:
            pass
            
    indicators = []
    if not df.empty:
        indicators = compute_dataframe_indicators(df, timeframe)
        
    if indicators:
        try:
            with get_db() as conn:
                conn.execute("""
                    INSERT OR REPLACE INTO cached_timeframe_indicators 
                    (symbol, timeframe, indicators_json, updated_at) 
                    VALUES (?, ?, ?, ?)
                """, (symbol, timeframe, json.dumps(indicators), datetime.now().strftime("%Y-%m-%d %H:%M:%S")))
                conn.commit()
        except Exception as db_err:
            print(f"Error writing timeframe indicator cache: {db_err}")
            
    return indicators

def find_latest_row_before_or_equal(rows: List[dict], target_date_str: str) -> Optional[dict]:
    best_row = None
    for row in rows:
        if row["date"] <= target_date_str:
            best_row = row
        else:
            break
    return best_row

def get_indicator_value(ind_row: dict, fund: dict, tech_full: dict, key: str):
    if not ind_row:
        return 0.0
        
    key_upper = str(key).upper().strip()
    if key_upper == "PRICE":
        return ind_row.get("Close", 0.0)
    elif key_upper == "VOLUME":
        return ind_row.get("Volume", 0.0)
    elif key_upper == "VOL_BREAKOUT":
        return ind_row.get("Vol_Ratio", 0.0)
    elif key_upper == "RSI":
        return ind_row.get("RSI_14", 50.0)
    elif key_upper == "SMA50":
        return ind_row.get("SMA_50", 0.0)
    elif key_upper == "SMA200":
        return ind_row.get("SMA_200", 0.0)
    elif key_upper == "EMA50":
        return ind_row.get("EMA_50", 0.0)
    elif key_upper == "EMA200":
        return ind_row.get("EMA_200", 0.0)
    elif key_upper == "BB_UPPER":
        return ind_row.get("BB_Upper", 0.0)
    elif key_upper == "BB_LOWER":
        return ind_row.get("BB_Lower", 0.0)
    elif key_upper == "MACD":
        return ind_row.get("MACD", 0.0)
    elif key_upper == "MACD_SIGNAL":
        return ind_row.get("MACD_Signal", 0.0)
    elif key_upper == "PE":
        from backend.swing_utils import clean_float
        return clean_float(fund.get("pe_ratio"), 0.0)
    elif key_upper == "DE_RATIO":
        from backend.swing_utils import clean_float
        return clean_float(fund.get("debt_to_equity"), 0.0)
    elif key_upper == "RATING":
        analysis = tech_full.get("analysis")
        if not isinstance(analysis, dict):
            analysis = {}
        return (analysis.get("recommendation") or tech_full.get("recommendation") or "HOLD").upper()
    elif key_upper == "SCORE":
        from backend.swing_utils import clean_float
        analysis = tech_full.get("analysis")
        if not isinstance(analysis, dict):
            analysis = {}
        return clean_float(tech_full.get("final_score") or tech_full.get("score_metrics", {}).get("final_score") or analysis.get("score", analysis.get("composite_score")), 0.0)
    else:
        try:
            return float(key)
        except ValueError:
            return key.upper()

def compare_rule_values(left, op, right) -> bool:
    try:
        if left is None:
            left = 0.0
        if right is None:
            right = 0.0
            
        if isinstance(left, str) or isinstance(right, str):
            left_str = str(left).upper().strip()
            right_str = str(right).upper().strip()
            if op == "==":
                return left_str == right_str
            elif op == "!=":
                return left_str != right_str
            return False
            
        l_num = float(left)
        r_num = float(right)
        
        if op == "<":
            return l_num < r_num
        elif op == ">":
            return l_num > r_num
        elif op == "==":
            return abs(l_num - r_num) < 1e-5
        elif op == "<=":
            return l_num <= r_num
        elif op == ">=":
            return l_num >= r_num
    except Exception:
        pass
    return False

@app.post("/api/screener/custom-scan")
async def execute_custom_screener_scan(data: CustomScanRequest):
    try:
        from backend.swing_utils import clean_float
        
        # 1. Parse formula if provided
        parsed_conditions = []
        is_formula_mode = bool(data.formula and data.formula.strip())
        
        if is_formula_mode:
            from backend.formula_parser import parse_formula_to_conditions
            try:
                parsed_conditions = parse_formula_to_conditions(data.formula)
            except Exception as pe:
                raise HTTPException(status_code=400, detail=str(pe))
                
            required_timeframes = set()
            for left, op, right in parsed_conditions:
                required_timeframes |= left.get_required_timeframes()
                required_timeframes |= right.get_required_timeframes()
        else:
            required_timeframes = set(rule.timeframe for rule in data.rules)
            
        if not required_timeframes:
            required_timeframes.add("1d")
            
        # 2. Fetch universe stocks
        with get_db() as conn:
            cursor = conn.cursor()
            if data.universe == "all":
                cursor.execute("SELECT symbol, company_name, sector, cap_type FROM screener_universe WHERE symbol NOT LIKE '%DUMMY%'")
            else:
                cursor.execute("SELECT symbol, company_name, sector, cap_type FROM screener_universe WHERE cap_type = ? AND symbol NOT LIKE '%DUMMY%'", (data.universe,))
            stocks = [dict(row) for row in cursor.fetchall()]
            
            # Load cached daily profiles to get fundamentals
            cursor.execute("SELECT symbol, profile_json FROM cached_profiles")
            cached_rows = cursor.fetchall()
            cached_profiles = {}
            for r in cached_rows:
                try:
                    cached_profiles[r["symbol"]] = json.loads(r["profile_json"])
                except Exception:
                    continue
                    
        # 3. Get last N trading dates for historical match count chart
        benchmark_dates = []
        benchmark_history = await get_timeframe_indicators("TCS.NS", "1d")
        if not benchmark_history:
            benchmark_history = await get_timeframe_indicators("RELIANCE.NS", "1d")
            
        if benchmark_history:
            benchmark_history.sort(key=lambda x: x["date"])
            n_range = data.historical_range
            sliced_bench = benchmark_history[-n_range:] if len(benchmark_history) >= n_range else benchmark_history
            benchmark_dates = [row["date"] for row in sliced_bench]
            
        if not benchmark_dates:
            from datetime import datetime, timedelta
            benchmark_dates = [(datetime.now() - timedelta(days=i)).strftime("%Y-%m-%d") for i in range(data.historical_range - 1, -1, -1)]
            benchmark_dates.sort()
            
        historical_counts = {dt: 0 for dt in benchmark_dates}
        
        # 4. Evaluate rules
        matched_results = []
        scanned_count = 0
        
        for stock in stocks:
            sym = stock["symbol"]
            profile = cached_profiles.get(sym)
            if not profile:
                continue
                
            fund = profile.get("fundamentals") or {}
            
            timeseries_cache = {}
            has_all_data = True
            for tf in required_timeframes:
                ts = await get_timeframe_indicators(sym, tf)
                if not ts:
                    has_all_data = False
                    break
                ts.sort(key=lambda x: x["date"])
                timeseries_cache[tf] = ts
                
            if not has_all_data:
                continue
                
            scanned_count += 1
            
            # Current scan match evaluation
            current_match = True
            if is_formula_mode:
                if not parsed_conditions:
                    current_match = False
            else:
                if not data.rules:
                    current_match = False
                
            rule_evals = []
            if is_formula_mode:
                from backend.formula_parser import evaluate_ast_condition
                for left, op, right in parsed_conditions:
                    passed = evaluate_ast_condition(left, op, right, timeseries_cache, -1, "1d")
                    rule_evals.append(passed)
            else:
                for rule in data.rules:
                    ts = timeseries_cache.get(rule.timeframe)
                    if ts:
                        offset = rule.offset or 0
                        idx = -1 - offset
                        if idx < -len(ts) or idx >= 0:
                            rule_evals.append(False)
                            continue
                        row = ts[idx]
                        left_val = get_indicator_value(row, fund, profile, rule.indicator)
                        right_val = get_indicator_value(row, fund, profile, rule.value)
                        passed = compare_rule_values(left_val, rule.operator, right_val)
                        
                        # Apply threshold proximity check if threshold > 0
                        if passed and rule.threshold and rule.threshold > 0.0:
                            try:
                                l_num = float(left_val)
                                r_num = float(right_val)
                                diff_pct = abs(l_num - r_num) / (abs(r_num) + 1e-9) * 100.0
                                if diff_pct > rule.threshold:
                                    passed = False
                            except Exception:
                                pass
                                
                        rule_evals.append(passed)
                    else:
                        rule_evals.append(False)
                        
            if data.logic_gate == "AND":
                current_match = all(rule_evals) if rule_evals else False
            else:
                current_match = any(rule_evals) if rule_evals else False
                
            if current_match:
                latest_d_row = timeseries_cache.get("1d")[-1] if "1d" in timeseries_cache else list(timeseries_cache.values())[0][-1]
                price = float(latest_d_row.get("Close", 0.0))
                
                rsi = clean_float(profile.get("technicals", {}).get("rsi"), 50.0)
                pe = clean_float(fund.get("pe_ratio"), 0.0)
                score = clean_float(profile.get("final_score") or profile.get("score_metrics", {}).get("final_score") or profile.get("analysis", {}).get("score", profile.get("analysis", {}).get("composite_score")), 0.0)
                de_ratio = clean_float(fund.get("debt_to_equity"), 0.0)
                analysis = profile.get("analysis") or {}
                rating = (analysis.get("recommendation") or profile.get("recommendation") or "N/A").upper()
                roe = clean_float(fund.get("roe_pct") or fund.get("roe"), 0.0)
                info_dict = profile.get("info") or {}
                cons_dict = profile.get("consensus") or {}
                n50_dict = profile.get("nifty50_risk") or {}
                capm_dict = profile.get("capm_risk_nifty50") or {}
                beta = clean_float(info_dict.get("beta") or cons_dict.get("beta") or n50_dict.get("beta") or capm_dict.get("beta"), 1.0)
                
                trigger_desc = []
                if is_formula_mode:
                    trigger_str = "Formula: " + "; ".join(data.formula.strip().split("\n")[:2])
                    if len(data.formula.strip().split("\n")) > 2:
                        trigger_str += "..."
                else:
                    for rule in data.rules:
                        trigger_desc.append(f"{rule.timeframe.upper()} {rule.indicator} {rule.operator} {rule.value}")
                    trigger_str = ", ".join(trigger_desc[:3])
                    if len(trigger_desc) > 3:
                        trigger_str += "..."
                    
                matched_results.append({
                    "symbol": sym,
                    "company_name": stock.get("company_name", sym),
                    "sector": stock.get("sector", "N/A"),
                    "cap_type": stock.get("cap_type", "N/A"),
                    "price": round(price, 2),
                    "pe": round(pe, 1),
                    "rsi": round(rsi, 1),
                    "trigger_value": trigger_str,
                    "rating": rating,
                    "score": round(score, 1),
                    "de_ratio": round(de_ratio, 2),
                    "roe": round(roe, 1),
                    "beta": round(beta, 2)
                })
                
            # Base timeframe for index alignment in history builder
            base_tf = "1d"
            if base_tf not in timeseries_cache:
                base_tf = list(timeseries_cache.keys())[0]
            base_ts = timeseries_cache[base_tf]
            
            # Historical matches counts timeline builder
            for dt in benchmark_dates:
                row_at_dt = find_latest_row_before_or_equal(base_ts, dt)
                if not row_at_dt:
                    continue
                    
                base_idx_at_dt = next((i for i, r in enumerate(base_ts) if r["date"] == row_at_dt["date"]), -1)
                if base_idx_at_dt == -1:
                    continue
                    
                base_idx_rel = base_idx_at_dt - len(base_ts)
                
                rule_evals_dt = []
                if is_formula_mode:
                    from backend.formula_parser import evaluate_ast_condition
                    for left, op, right in parsed_conditions:
                        passed = evaluate_ast_condition(left, op, right, timeseries_cache, base_idx_rel, base_tf)
                        rule_evals_dt.append(passed)
                else:
                    for rule in data.rules:
                        ts = timeseries_cache.get(rule.timeframe)
                        if not ts:
                            rule_evals_dt.append(False)
                            continue
                            
                        row_at_dt = find_latest_row_before_or_equal(ts, dt)
                        if not row_at_dt:
                            rule_evals_dt.append(False)
                            continue
                            
                        idx_at_dt = next((i for i, r in enumerate(ts) if r["date"] == row_at_dt["date"]), -1)
                        if idx_at_dt == -1:
                            rule_evals_dt.append(False)
                            continue
                            
                        offset = rule.offset or 0
                        target_idx = idx_at_dt - offset
                        if target_idx < 0 or target_idx >= len(ts):
                            rule_evals_dt.append(False)
                            continue
                            
                        row = ts[target_idx]
                        left_val = get_indicator_value(row, fund, profile, rule.indicator)
                        right_val = get_indicator_value(row, fund, profile, rule.value)
                        passed = compare_rule_values(left_val, rule.operator, right_val)
                        
                        # Apply threshold proximity check if threshold > 0
                        if passed and rule.threshold and rule.threshold > 0.0:
                            try:
                                l_num = float(left_val)
                                r_num = float(right_val)
                                diff_pct = abs(l_num - r_num) / (abs(r_num) + 1e-9) * 100.0
                                if diff_pct > rule.threshold:
                                    passed = False
                            except Exception:
                                pass
                                
                        rule_evals_dt.append(passed)
                    
                dt_matched = False
                if data.logic_gate == "AND":
                    dt_matched = all(rule_evals_dt) if rule_evals_dt else False
                else:
                    dt_matched = any(rule_evals_dt) if rule_evals_dt else False
                    
                if dt_matched:
                    historical_counts[dt] += 1
                    
        formatted_historical = [{"time": dt, "value": count} for dt, count in sorted(historical_counts.items())]
        
        cond_desc = f"Custom Screener ({data.logic_gate})"
        if is_formula_mode:
            cond_desc += ": Formula Mode"
        elif data.rules:
            cond_desc += f": {len(data.rules)} Rules"
            
        return {
            "status": "success",
            "scanned": scanned_count,
            "matched": len(matched_results),
            "universe": data.universe,
            "condition": cond_desc,
            "results": matched_results,
            "historical_matches": formatted_historical
        }
    except HTTPException as he:
        raise he
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=f"Custom scan failed: {str(e)}")

@app.get("/api/screener/screens")
async def get_saved_screens():
    try:
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("SELECT id, name, description, rules_json, formula, logic_gate, universe, created_at FROM custom_screens ORDER BY name ASC")
            rows = [dict(row) for row in cursor.fetchall()]
            
        for row in rows:
            try:
                row["rules"] = json.loads(row["rules_json"])
            except Exception:
                row["rules"] = []
            if "formula" not in row or row["formula"] is None:
                row["formula"] = ""
        return rows
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch saved screens: {str(e)}")

@app.post("/api/screener/screens")
async def save_custom_screen(data: SavedScreenCreate):
    try:
        screen_id = str(uuid.uuid4())
        rules_str = json.dumps(data.rules)
        formula_str = data.formula or ""
        
        with get_db() as conn:
            conn.execute("""
                INSERT OR REPLACE INTO custom_screens (id, name, description, rules_json, formula, logic_gate, universe, created_at) 
                VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            """, (screen_id, data.name, data.description, rules_str, formula_str, data.logic_gate, data.universe))
            conn.commit()
        return {"status": "success", "id": screen_id, "name": data.name}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save screen: {str(e)}")

@app.delete("/api/screener/screens/{screen_id}")
async def delete_custom_screen(screen_id: str):
    try:
        with get_db() as conn:
            conn.execute("DELETE FROM custom_screens WHERE id = ?", (screen_id,))
            conn.commit()
        return {"status": "success", "message": "Screen deleted successfully"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete screen: {str(e)}")


# ==================== ANGEL ONE STATUS & HEALTH ====================

@app.get("/api/angel/status")
async def angel_status():
    """Returns the current Angel One WebSocket connection health and status."""
    import datetime as _dt
    # Determine market status (NSE: Mon-Fri 9:15-15:30 IST)
    now_ist = datetime.utcnow() + timedelta(hours=5, minutes=30)
    is_weekday = now_ist.weekday() < 5
    market_open = now_ist.replace(hour=9, minute=15, second=0)
    market_close = now_ist.replace(hour=15, minute=30, second=0)
    is_market_hours = is_weekday and market_open <= now_ist <= market_close

    status = {
        "connected": angel_connector is not None and angel_connector.is_authenticated(),
        "authenticated": angel_connector.is_authenticated() if angel_connector else False,
        "market_status": "OPEN" if is_market_hours else "CLOSED",
    }

    # Merge feed status from WebSocket server
    feed = get_feed_status()
    status.update(feed)

    # Add connector-level status if available
    if angel_connector:
        status.update(angel_connector.get_status())

    return status


# Include Angel One WebSocket router
app.include_router(angel_ws_router)


static_dir = os.path.join(os.path.dirname(__file__), "static")
os.makedirs(static_dir, exist_ok=True)

app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")
