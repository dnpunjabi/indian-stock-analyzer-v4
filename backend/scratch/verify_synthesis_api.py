import urllib.request
import json
import sys

def verify():
    url = "http://127.0.0.1:8000/api/synthesis?symbol=BSE.NS&horizon=Long-term%20(3%2B%20years)&risk=Moderate"
    print(f"Querying {url}...")
    try:
        with urllib.request.urlopen(url) as response:
            if response.status == 200:
                data = json.loads(response.read().decode('utf-8'))
                synthesis_text = data.get("synthesis_text", "")
                with open("backend/scratch/synthesis_output.md", "w", encoding="utf-8") as f:
                    f.write(synthesis_text)
                print("Written to backend/scratch/synthesis_output.md successfully.")
            else:
                print(f"Error: status {response.status}")
    except Exception as e:
        print(f"Verification failed: {e}")

if __name__ == '__main__':
    verify()
