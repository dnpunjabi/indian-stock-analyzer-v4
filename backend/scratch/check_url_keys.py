import requests

ticker = "GVT&D.NS"
headers = {"User-Agent": "Mozilla/5.0"}

url1 = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?range=2y&interval=1d"
res1 = requests.get(url1, headers=headers).json()
result1 = res1.get("chart", {}).get("result", [{}])[0]
print("Unencoded URL resolved symbol:", result1.get("meta", {}).get("symbol"))

import urllib.parse
encoded_ticker = urllib.parse.quote(ticker)
url2 = f"https://query1.finance.yahoo.com/v8/finance/chart/{encoded_ticker}?range=2y&interval=1d"
res2 = requests.get(url2, headers=headers).json()
result2 = res2.get("chart", {}).get("result", [{}])[0]
print("Encoded URL resolved symbol:", result2.get("meta", {}).get("symbol"))
