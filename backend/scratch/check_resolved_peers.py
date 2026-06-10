import sys
import os

# Add root directory to path to import backend
sys.path.append(os.path.join(os.path.dirname(__file__), "..", ".."))

from backend.financial_utils import resolve_company_ticker

def test_resolve(query):
    try:
        res = resolve_company_ticker(query)
        print(f"Query: '{query}' -> Ticker: {res.get('yf_ticker')} | Base: {res.get('base_symbol')} | Name: {res.get('name')}")
    except Exception as e:
        print(f"Query: '{query}' -> FAILED: {e}")

test_resolve("CG Power & Ind")
test_resolve("CG Power")
test_resolve("Siemens Ener.Ind")
test_resolve("Siemens Energy")
