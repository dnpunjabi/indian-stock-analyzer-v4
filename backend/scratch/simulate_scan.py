import os
import sys
import sqlite3
import json
import asyncio

sys.path.append(os.path.join(os.path.dirname(__file__), "..", ".."))
from backend.formula_parser import parse_formula_to_conditions, evaluate_ast_condition
from backend.main import get_timeframe_indicators, get_indicator_value, compare_rule_values

class MockRequest:
    def __init__(self, formula, universe="all", logic_gate="AND", historical_range=30, rules=[]):
        self.formula = formula
        self.universe = universe
        self.logic_gate = logic_gate
        self.historical_range = historical_range
        self.rules = rules

async def simulate():
    db_path = os.path.join("backend", "data", "watchlist_database.db")
    # Set DATABASE_DIR so get_timeframe_indicators finds the database
    os.environ["DATABASE_DIR"] = os.path.join("backend", "data")
    
    formula = (
        "Daily Close >= ( ( ( 1 day ago High - 1 day ago Low ) / 1.618 ) + 1 day ago Low ) * .998\n"
        "Daily Close <= ( ( 1 day ago High - 1 day ago Low ) / 1.618 ) + 1 day ago Low"
    )
    req = MockRequest(formula)
    
    parsed_conditions = parse_formula_to_conditions(req.formula)
    required_timeframes = set()
    for left, op, right in parsed_conditions:
        required_timeframes |= left.get_required_timeframes()
        required_timeframes |= right.get_required_timeframes()
        
    if not required_timeframes:
        required_timeframes.add("1d")
        
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    cursor.execute("SELECT symbol FROM screener_universe WHERE symbol NOT LIKE '%DUMMY%'")
    stocks = [r["symbol"] for r in cursor.fetchall()]
    
    cursor.execute("SELECT symbol, profile_json FROM cached_profiles")
    cached_profiles = {}
    for r in cursor.fetchall():
        cached_profiles[r["symbol"]] = json.loads(r["profile_json"])
        
    conn.close()
    
    print(f"Total stocks in universe: {len(stocks)}")
    print(f"Total cached profiles: {len(cached_profiles)}")
    
    matched_symbols = []
    for sym in ["SBIN.NS", "MANKIND.NS", "MAXHEALTH.NS", "POWERGRID.NS"]:
        if sym not in cached_profiles:
            print(f"Skipping {sym} because it has no cached profile")
            continue
            
        profile = cached_profiles[sym]
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
            print(f"Skipping {sym} because it doesn't have all timeframe data")
            continue
            
        # Evaluate formula
        rule_evals = []
        for left, op, right in parsed_conditions:
            # -1 is latest index
            passed = evaluate_ast_condition(left, op, right, timeseries_cache, -1, "1d")
            rule_evals.append(passed)
            
        is_match = all(rule_evals)
        print(f"Symbol: {sym} | Evaluations: {rule_evals} | Match: {is_match}")
        if is_match:
            matched_symbols.append(sym)
            
    print(f"\nFinal Matched Symbols: {matched_symbols}")

if __name__ == "__main__":
    asyncio.run(simulate())
