import sys

with open('backend/financial_utils.py', 'r', encoding='utf-8') as f:
    for i, line in enumerate(f):
        if any(w in line.lower() for w in ['52', 'high', 'low', 'open', 'close', 'current_price']):
            if '=' in line or '"' in line or "'" in line:
                print(f"{i+1}: {line.strip()}")
