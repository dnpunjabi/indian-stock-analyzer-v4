import os
import sys

if sys.platform.startswith('win'):
    sys.stdout.reconfigure(encoding='utf-8')

py_path = r"c:\Users\dheer\Desktop\AI\indian-stock-analyzer\backend\main.py"

if os.path.exists(py_path):
    with open(py_path, "r", encoding="utf-8", errors="ignore") as f:
        content = f.read()
    
    idx = content.find("def backtest_portfolio(")
    if idx == -1:
        idx = content.find("def backtest(")
    if idx != -1:
        start_line = content[:idx].count('\n') + 1
        print(f"backtest starts at line {start_line}")
        lines = content.split('\n')[start_line-1:start_line+60]
        for l_idx, l in enumerate(lines):
            print(f"{start_line + l_idx}: {l}")
    else:
        print("Endpoint method not found")
else:
    print("File not found")
