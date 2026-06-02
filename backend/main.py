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
from fastapi import FastAPI, HTTPException, Query
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
        cursor.execute("""
        CREATE TABLE IF NOT EXISTS portfolio_items (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            symbol TEXT UNIQUE NOT NULL,
            name TEXT,
            sector TEXT,
            quantity REAL DEFAULT 10.0,
            purchase_price REAL DEFAULT 100.0
        )
        """)
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

# Load env variables from root directory
load_dotenv(dotenv_path=os.path.join(os.path.dirname(__file__), "..", ".env"))

# Import analytical and agent engines
from backend.financial_utils import get_complete_financial_profile, resolve_company_ticker
from backend.agent import run_cio_parent_agent, run_ai_stock_screener, run_comparison_synthesizer, run_conversational_chat, run_portfolio_doctor, call_groq_llm, run_single_stock_audit

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

class PortfolioItemUpdate(BaseModel):
    quantity: Optional[float] = None
    purchase_price: Optional[float] = None

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
async def compare_rivals(tickers: str):
    """Benchmarks rivals side-by-side."""
    if not tickers:
        raise HTTPException(status_code=400, detail="Tickers parameter is required.")
    ticker_list = [t.strip().upper() for t in tickers.split(",")]
    try:
        comparison = await asyncio.to_thread(run_comparison_synthesizer, ticker_list)
        return comparison
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Comparison aggregator error: {str(e)}")

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

        scoring = profile.get("score_metrics", {})
        final_score = scoring.get("final_score", 50)
        recommendation = profile.get("analysis", {}).get("recommendation", scoring.get("action", "HOLD"))

        # Formulate institutional prompt
        system_prompt = (
            "You are the Chief Investment Officer (CIO) of a premier Indian equities advisory firm.\n"
            "Your task is to compile a highly coherent, institutional-grade 3-paragraph equity research prospectus for the specified stock.\n"
            "You must analyze and synthesize all provided workspace indicators into exactly three distinct, narrative-rich paragraphs:\n"
            "Paragraph 1: Operational & Solvency Health. Analyze operational cash flows, Piotroski F-Score, Altman Z-Score, and leverage constraints.\n"
            "Paragraph 2: Valuation & Margin of Safety. Synthesize the DCF intrinsic value against the current price, detail the margin of safety, and discuss pricing premiums relative to peers/historical valuation.\n"
            "Paragraph 3: Momentum & Technical Timing. Outline key technical levels (SMAs, RSI, support/resistance trendlines), discuss trading volume, and state broker targets.\n"
            "Maintain a neutral, highly professional tone. End all sentences with periods. Do not use exclamation marks. Avoid bullet points, list items, or arbitrary markdown headings; output only the three paragraphs of clean, flowing text. Highlight key numbers (e.g. ratios, prices, percentages) using bold formatting."
        )

        user_prompt = f"""
        Company: {profile.get('company_name', symbol)} ({ticker})
        Investor Profile: Horizon: {horizon} | Risk: {risk}
        
        1. Operational & Solvency Indicators:
        - Piotroski F-Score: {piotroski_score}/9 ({piotroski_label})
        - Altman Z-Score: {altman_z_score:.2f} ({altman_zone})
        - Debt-to-Equity: {fundamentals.get('debt_to_equity', 'N/A')}
        - CFO to PAT Ratio: {fundamentals.get('cfo_to_pat', 'N/A')}
        
        2. Valuation & Margin of Safety:
        - Current Price: Rs. {current_price}
        - DCF Intrinsic Value: Rs. {dcf_intrinsic_value:.2f}
        - Margin of Safety: {margin_of_safety:.1f}%
        - Valuation Status: {dcf.get('valuation_rating', 'N/A')}
        - PE Ratio: {fundamentals.get('pe_ratio', 'N/A')} (Sector Median: {fundamentals.get('sector_pe', 'N/A')})
        
        3. Technical & Momentum Indicators:
        - 14-day RSI: {rsi:.1f}
        - 50-day SMA: Rs. {sma_50}
        - 200-day SMA: Rs. {sma_200}
        - Technical Trend: {technicals.get('trend_50_vs_200', 'N/A')}
        - Analyst Targets: Median Target: Rs. {profile.get('consensus', {}).get('target_median', 'N/A')}, Recommendation: {profile.get('consensus', {}).get('recommendation', 'N/A')}
        """

        synthesis_text = await asyncio.to_thread(call_groq_llm, system_prompt, user_prompt)

        # Failsafe programmatic fallback if LLM is unavailable or errors
        if "ERROR" in synthesis_text or not synthesis_text.strip():
            p1 = (
                f"**{profile.get('company_name', symbol)}** demonstrates robust operational quality with a Piotroski F-Score "
                f"of **{piotroski_score}/9** ({piotroski_label}) and an Altman Z-Score of **{altman_z_score:.2f}** ({altman_zone}). "
                f"The leverage is comfortable with a Debt-to-Equity ratio of **{fundamentals.get('debt_to_equity', 0.0):.2f}x**, "
                f"underpinning solid cash generation from operations."
            )
            p2 = (
                f"From a valuation perspective, the stock trades at **Rs. {current_price}** relative to our Discounted Cash Flow (DCF) "
                f"estimated intrinsic value of **Rs. {dcf_intrinsic_value:.2f}**. This provides a **{margin_of_safety:.1f}% margin of safety**, "
                f"ranking it as **{dcf.get('valuation_rating', 'Fairly Valued')}** at current market price."
            )
            p3 = (
                f"Technically, the stock exhibits a stable trend structure with its 14-day RSI hovering at **{rsi:.1f}**. "
                f"It is currently trading relative to its 50-day SMA of **Rs. {sma_50}** and 200-day SMA of **Rs. {sma_200}**. "
                f"Broker consensus is aligned with a target median price of **Rs. {profile.get('consensus', {}).get('target_median', current_price * 1.15)}**."
            )
            synthesis_text = f"{p1}\n\n{p2}\n\n{p3}"

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
            "sma_200": sma_200
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
async def get_portfolio():
    import json
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT symbol, name, sector, quantity, purchase_price FROM portfolio_items")
        rows = [dict(row) for row in cursor.fetchall()]
        
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
                except Exception as e:
                    print(f"Error parsing cached profile for {sym}: {e}")
            
            hydrated_rows.append(row)
        return hydrated_rows

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
        profile = await asyncio.to_thread(get_complete_financial_profile, full_ticker)
        company_name = profile.get("company_name") or company_name
        sector = profile.get("sector") or sector
    except Exception:
        pass
        
    with get_db() as conn:
        cursor = conn.cursor()
        try:
            cursor.execute(
                "INSERT INTO portfolio_items (symbol, name, sector, quantity, purchase_price) VALUES (?, ?, ?, ?, ?)",
                (full_ticker, company_name, sector, data.quantity or 10.0, data.purchase_price or 100.0)
            )
            conn.commit()
            return {"symbol": full_ticker, "name": company_name, "sector": sector, "quantity": data.quantity or 10.0, "purchase_price": data.purchase_price or 100.0}
        except sqlite3.IntegrityError:
            raise HTTPException(status_code=400, detail="Stock already exists in the portfolio.")

@app.put("/api/portfolio/{symbol}")
async def update_portfolio_item(symbol: str, data: PortfolioItemUpdate):
    symbol = symbol.strip().upper()
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
            
        if not updates:
            raise HTTPException(status_code=400, detail="No fields to update.")
            
        query = f"UPDATE portfolio_items SET {', '.join(updates)} WHERE UPPER(symbol) = ?"
        params.append(symbol)
        
        cursor.execute(query, params)
        if cursor.rowcount == 0:
            raise HTTPException(status_code=404, detail="Stock not found in portfolio.")
        conn.commit()
    return {"status": "success"}

@app.delete("/api/portfolio/{symbol}")
async def delete_portfolio_item(symbol: str):
    symbol = symbol.strip().upper()
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("DELETE FROM portfolio_items WHERE UPPER(symbol) = ?", (symbol,))
        conn.commit()
    return {"status": "success"}

@app.get("/api/portfolio/watchlist-stocks")
async def get_portfolio_watchlist_stocks():
    """Returns all unique stocks from all watchlists that are not in the portfolio."""
    with get_db() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            SELECT DISTINCT symbol, name, sector 
            FROM watchlist_items 
            WHERE UPPER(symbol) NOT IN (SELECT UPPER(symbol) FROM portfolio_items)
        """)
        return [dict(row) for row in cursor.fetchall()]

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

static_dir = os.path.join(os.path.dirname(__file__), "static")
os.makedirs(static_dir, exist_ok=True)

app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")
