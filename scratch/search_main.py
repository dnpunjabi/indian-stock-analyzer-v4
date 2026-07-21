import os

main_path = r"c:\Users\dheer\Desktop\AI\indian-stock-analyzer - 3.0\backend\agent.py"
search_term = "calculate_portfolio_taxes"

with open(main_path, "r", encoding="utf-8", errors="ignore") as f:
    for i, line in enumerate(f, 1):
        if search_term in line:
            print(f"{i}: {line.strip()}")
