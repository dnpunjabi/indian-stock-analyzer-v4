import requests

ticker = "GVT&D.NS"
print("Unencoded URL:")
url1 = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?range=2y&interval=1d"
headers = {"User-Agent": "Mozilla/5.0"}
res1 = requests.get(url1, headers=headers)
print("Status Code:", res1.status_code)
if res1.status_code == 200:
    print("Success")
else:
    print("Response text:", res1.text[:200])

import urllib.parse
encoded_ticker = urllib.parse.quote(ticker)
print("\nEncoded URL:")
url2 = f"https://query1.finance.yahoo.com/v8/finance/chart/{encoded_ticker}?range=2y&interval=1d"
res2 = requests.get(url2, headers=headers)
print("Status Code:", res2.status_code)
if res2.status_code == 200:
    print("Success, length of timestamps:", len(res2.json().get("chart", {}).get("result", [{}])[0].get("timestamp", [])))
else:
    print("Response text:", res2.text[:200])
