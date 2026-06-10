import asyncio
import os
import sys

# Ensure backend can be imported
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..")))

from backend.main import scan_trigger

# Enforce UTF-8 encoding on Windows to prevent UnicodeEncodeError on emojis
if sys.platform == "win32":
    sys.stdout.reconfigure(encoding="utf-8")

async def main():
    print("Starting Rule Scanner Multi-Factor Combo validation...")
    combos = [
        "COMBO_BULL_PULLBACK", "COMBO_BEAR_PULLBACK", "COMBO_VALUE_REVERSAL", "COMBO_GROWTH_MOMENTUM",
        "COMBO_VOL_BREAKOUT", "COMBO_52W_BREAKOUT", "COMBO_52W_VAL_ENTRY", "COMBO_FIB_REVERSAL",
        "COMBO_BB_REVERSION", "COMBO_BB_BREAKOUT", "COMBO_MACD_VOL", "COMBO_HIGH_QUALITY_DIP",
        "COMBO_DEATH_CROSS_VOL", "COMBO_FIB_SMA_BOUNCE", "COMBO_PENNY_MOMENTUM", "COMBO_PREMIUM_GROWTH",
        "COMBO_EARNINGS_ACCUMULATION", "COMBO_SHORT_TERM_REVERSION", "COMBO_BB_SQUEEZE_BREAK", "COMBO_CONTRARIAN_VALUE"
    ]
    
    all_ok = True
    for combo in combos:
        try:
            # We pass typical operators (< for pullbacks/reversions, > for breakouts)
            operator = "<" if any(x in combo for x in ["PULLBACK", "REVERSION", "REVERSAL", "DIP", "ENTRY", "VAL"]) else ">"
            value = "35" if "RSI" in combo or "MOM" in combo or "PULLBACK" in combo or "VAL" in combo or "DIP" in combo else "2.0"
            
            res = await scan_trigger(combo, operator, value)
            print(f"✅ {combo}: Scanned: {res.get('scanned', 0)}, Matched: {res.get('matched', 0)}")
        except Exception as e:
            print(f"❌ {combo}: FAILED! Error: {e}")
            all_ok = False
            
    if all_ok:
        print("\n🎉 All 20 Multi-Factor Combo Strategies verified successfully!")
    else:
        print("\n⚠️ Some combo strategy verifications failed. Check output errors.")

if __name__ == '__main__':
    asyncio.run(main())
