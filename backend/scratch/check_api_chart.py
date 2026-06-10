import requests

ticker = "GVT&D.NS"
url = f"http://localhost:8000/api/chart?ticker={ticker}&period=1y&interval=1d"
try:
    print(f"Calling: {url}")
    # Wait, the server needs to be running. If it's not running, we can import backend.main and call get_chart_data directly!
    # Let's do that to be completely independent of server state!
    import sys
    sys.path.append(r"c:\Users\dheer\Desktop\AI\indian-stock-analyzer")
    import asyncio
    from backend.main import get_chart_data
    
    loop = asyncio.get_event_loop()
    res = loop.run_until_complete(get_chart_data(ticker, period="1y", interval="1d"))
    print("API returned successfully!")
    print("Keys returned:", res.keys())
    print("Sample prices count:", len(res.get("prices", [])))
    print("Sample prices:", res.get("prices", [])[:5])
    
except Exception as e:
    print("Failed with error:", e)
    import traceback
    traceback.print_exc()
