import urllib.request
import json
import sys

def test_endpoint(refresh, run_llm):
    url = f"http://127.0.0.1:8000/api/portfolio/news-impact?symbol=RELIANCE.NS&refresh={str(refresh).lower()}&run_llm={str(run_llm).lower()}"
    print(f"\n--- Calling API with refresh={refresh}, run_llm={run_llm} ---")
    try:
        req = urllib.request.Request(url)
        with urllib.request.urlopen(req, timeout=45) as response:
            content = response.read().decode('utf-8')
            data = json.loads(content)
            print("Status Code: 200 OK")
            items = data.get("news_items", [])
            print("Total Items:", len(items))
            for idx, item in enumerate(items):
                print(f"  Item {idx+1}: {item.get('title')[:55]}... | Date: {item.get('date')} | Publisher: {item.get('publisher')}")
    except Exception as e:
        print("Request failed:", e)

# Test the sorting and filtering
test_endpoint(refresh=True, run_llm=False)
