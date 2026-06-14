import os
import sys
import sqlite3
import json

sys.path.append(os.path.join(os.path.dirname(__file__), "..", ".."))
from backend.formula_parser import parse_formula_to_conditions, evaluate_ast_condition

def check_stocks():
    db_path = os.path.join("backend", "data", "watchlist_database.db")
    conn = sqlite3.connect(db_path)
    c = conn.cursor()
    
    formula = (
        "Daily Close >= ( ( ( 1 day ago High - 1 day ago Low ) / 1.618 ) + 1 day ago Low ) * .998\n"
        "Daily Close <= ( ( 1 day ago High - 1 day ago Low ) / 1.618 ) + 1 day ago Low"
    )
    conds = parse_formula_to_conditions(formula)
    
    targets = ["SBIN.NS", "MANKIND.NS", "MAXHEALTH.NS", "POWERGRID.NS"]
    
    # Query targets
    c.execute(
        "SELECT symbol, indicators_json FROM cached_timeframe_indicators "
        "WHERE symbol IN ('SBIN.NS', 'MANKIND.NS', 'MAXHEALTH.NS', 'POWERGRID.NS') "
        "AND timeframe = '1d'"
    )
    rows = c.fetchall()
    
    print("EVALUATIONS:")
    print("=" * 70)
    for sym, ind_json in rows:
        ts = json.loads(ind_json)
        ts.sort(key=lambda x: x["date"])
        tf_cache = {"1d": ts}
        
        print(f"Symbol: {sym}")
        print(f"  Date: {ts[-1]['date']}")
        print(f"  Close: {ts[-1]['Close']}")
        print(f"  1d ago Date: {ts[-2]['date']}")
        print(f"  1d ago High: {ts[-2]['High']}")
        print(f"  1d ago Low: {ts[-2]['Low']}")
        
        all_passed = True
        for i, (left, op, right) in enumerate(conds, 1):
            l_val = left.evaluate(tf_cache, -1, "1d")
            r_val = right.evaluate(tf_cache, -1, "1d")
            res = evaluate_ast_condition(left, op, right, tf_cache, -1, "1d")
            print(f"  Cond #{i}: {l_val:.2f} {op} {r_val:.2f} => Result: {res}")
            if not res:
                all_passed = False
        print(f"  Combined Match: {all_passed}")
        print("-" * 70)
        
    conn.close()

if __name__ == "__main__":
    check_stocks()
