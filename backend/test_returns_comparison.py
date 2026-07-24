import unittest
import pandas as pd
import numpy as np
from backend.main import compute_returns_comparison

class TestReturnsComparison(unittest.TestCase):
    def test_compute_returns_comparison_with_df(self):
        # Generate dummy 5-year daily price dataframe
        dates = pd.date_range(end='2026-03-31', periods=1300, freq='B')
        np.random.seed(42)
        prices = 100 * (1 + np.random.randn(1300)*0.01).cumprod()
        df = pd.DataFrame({'Close': prices}, index=dates)

        res = compute_returns_comparison('RELIANCE', df=df)
        self.assertIn('matrix', res)
        self.assertIn('summary', res)
        self.assertIn('periods', res)

        matrix = res['matrix']
        for p in ["1D", "1W", "1M", "3M", "6M", "1Y", "3Y", "5Y", "10Y"]:
            self.assertIn(p, matrix)
            self.assertIn('stock', matrix[p])
            self.assertIn('nifty50', matrix[p])
            self.assertIn('sensex', matrix[p])
            self.assertIn('industry', matrix[p])

        # Check 1Y summary text exists
        self.assertTrue(len(res['summary']['1Y']) > 0)
        print("Test passed! Sample 1Y return:", matrix['1Y'])
        print("Sample 1Y summary:", res['summary']['1Y'])

if __name__ == '__main__':
    unittest.main()
