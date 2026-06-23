import urllib.request
import json
import sys

def test_market_news_endpoint(refresh, run_llm):
    url = f"http://127.0.0.1:8000/api/market-news?refresh={str(refresh).lower()}&run_llm={str(run_llm).lower()}"
    print(f"\n--- Calling /api/market-news with refresh={refresh}, run_llm={run_llm} ---")
    try:
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=45) as response:
            content = response.read().decode('utf-8')
            data = json.loads(content)
            print("Status Code: 200 OK")
            items = data.get("news_items", [])
            print("Total Items Returned:", len(items))
            print("Has AI Report:", data.get("has_ai_report", False))
            
            # Print first 3 headlines for verification
            for idx, item in enumerate(items[:3]):
                print(f"  Catalyst {idx+1}: {item.get('title')[:60]}... | Date: {item.get('date')} | Source: {item.get('source')} | Sentiment: {item.get('sentiment')}")
                
            if data.get("has_ai_report"):
                report = data.get("ai_report", {})
                print("\nAI Synthesis Consensus:")
                print("  Report:", report.get("synthesis_report"))
                print("  Top Drivers:")
                for driver in report.get("top_drivers", []):
                    print(f"    - {driver}")
    except Exception as e:
        print("Request failed:", e)

if __name__ == "__main__":
    # Test 1: Fetch live feed (no AI)
    test_market_news_endpoint(refresh=True, run_llm=False)
    
    # Test 2: Fetch feed with AI Synthesis
    test_market_news_endpoint(refresh=False, run_llm=True)
