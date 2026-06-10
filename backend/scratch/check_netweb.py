import sys
sys.path.append(r"c:\Users\dheer\Desktop\AI\indian-stock-analyzer")
from backend.financial_utils import get_complete_financial_profile

ticker = "NETWEB.NS"
try:
    print(f"==================== Auditing {ticker} ====================\n")
    profile = get_complete_financial_profile(ticker, bypass_db_cache=True)
    
    fundamentals = profile.get("fundamentals", {})
    pe_bands = profile.get("pe_bands", {})
    
    current_pe = fundamentals.get("pe_ratio")
    median_pe = pe_bands.get("median_pe")
    max_pe = pe_bands.get("max_pe")
    min_pe = pe_bands.get("min_pe")
    
    print(f"Company Name:           {profile.get('company_name')}")
    print(f"Current Price:          Rs. {fundamentals.get('current_price'):.2f}")
    print(f"Current Trailing P/E:   {current_pe:.2f}" if current_pe else "Current Trailing P/E:   N/A")
    print(f"5Y Historical Median:   {median_pe:.2f}" if median_pe else "5Y Historical Median:   N/A")
    print(f"5Y Max P/E Peak:        {max_pe:.2f}" if max_pe else "5Y Max P/E Peak:        N/A")
    print(f"5Y Min P/E Floor:       {min_pe:.2f}" if min_pe else "5Y Min P/E Floor:       N/A")
    
    print("\nPE History Data count:", len(pe_bands.get("pe_history", [])))
    if pe_bands.get("pe_history"):
        print("Sample PE History points:", pe_bands.get("pe_history")[:3])
        
    print("\nChecking if price chart works by invoking get_chart_data...")
    from backend.main import get_chart_data
    import asyncio
    loop = asyncio.get_event_loop()
    res = loop.run_until_complete(get_chart_data(ticker, period="1y", interval="1d"))
    print("Chart data returned successfully! Count:", len(res.get("prices", [])))
    
except Exception as e:
    print("Failed with error:", e)
    import traceback
    traceback.print_exc()
