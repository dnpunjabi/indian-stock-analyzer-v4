import os
import sqlite3
import json

DATABASE_DIR = os.environ.get("DATABASE_DIR", "backend/data")
DATABASE_PATH = os.path.join(DATABASE_DIR, "watchlist_database.db")

print(f"Opening DB: {DATABASE_PATH}")
conn = sqlite3.connect(DATABASE_PATH)
conn.row_factory = sqlite3.Row
cursor = conn.cursor()

# Check cached profiles
cursor.execute("SELECT symbol, profile_json FROM cached_profiles")
rows = cursor.fetchall()
print(f"Found {len(rows)} cached profiles.")

for r in rows:
    sym = r["symbol"]
    try:
        data = json.loads(r["profile_json"])
        eq = data.get("earnings_quality", {})
        t = data.get("technicals", {})
        f = data.get("fundamentals", {})
        
        piotroski = eq.get("piotroski_score") if eq else None
        altman = eq.get("altman_z_score") if eq else None
        
        print(f"{sym}: piotroski_score type={type(piotroski)} value={piotroski}, altman_z_score type={type(altman)} value={altman}")
        
        # Check technicals keys
        for key in ["rsi", "macd_hist", "macd", "macd_signal", "breakout_status", "sma_50", "sma_200", "atr", "volume_vs_avg20"]:
            val = t.get(key)
            if val is None:
                print(f"  WARNING: technicals.{key} is None")
            elif isinstance(val, str):
                print(f"  WARNING: technicals.{key} is str: {val}")
    except Exception as e:
        print(f"Error reading profile for {sym}: {e}")

# Check daily delivery history count
cursor.execute("SELECT COUNT(*), COUNT(delivery_qty) FROM daily_delivery_history")
hist_cnt, deliv_cnt = cursor.fetchone()
print(f"daily_delivery_history: total rows={hist_cnt}, non-null delivery_qty={deliv_cnt}")

# Check if there are any None in delivery_qty in daily_delivery_history
cursor.execute("SELECT symbol, trade_date FROM daily_delivery_history WHERE delivery_qty IS NULL")
null_rows = cursor.fetchall()
if null_rows:
    print(f"WARNING: Found {len(null_rows)} rows in daily_delivery_history with NULL delivery_qty")
    for nr in null_rows[:10]:
        print(f"  NULL row: {nr['symbol']} on {nr['trade_date']}")

conn.close()
