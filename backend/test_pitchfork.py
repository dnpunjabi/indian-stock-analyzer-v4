import unittest
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from backend.swing_utils import calculate_pitchfork_indicators

class TestPitchforkIndicators(unittest.TestCase):
    def test_calculate_pitchfork_indicators_empty_df(self):
        """Test calculation with empty dataframe returns empty results structure."""
        df = pd.DataFrame(columns=['Open', 'High', 'Low', 'Close', 'Volume'])
        res = calculate_pitchfork_indicators(df, depth=10)
        self.assertIn("zigzag", res)
        self.assertIn("pitchfork", res)
        self.assertEqual(res["zigzag"], [])
        self.assertEqual(res["pitchfork"]["median"], [])

    def test_calculate_pitchfork_with_synthetic_pivots(self):
        """Test calculation with synthetic data that forms clear pivot high/low/high points."""
        # We need at least 34 bars for the default depth or we can pass a smaller depth.
        # Let's create 60 bars of dummy data
        np.random.seed(42)
        base_time = datetime(2026, 6, 1)
        times = [base_time + timedelta(days=i) for i in range(60)]
        
        # Create a series with a clear peak at index 15, low at index 30, and peak at index 45
        close_vals = []
        for i in range(60):
            if i <= 15:
                val = 100.0 + i * 2.0  # Up to 130
            elif i <= 30:
                val = 130.0 - (i - 15) * 3.0  # Down to 85
            elif i <= 45:
                val = 85.0 + (i - 30) * 4.0  # Up to 145
            else:
                val = 145.0 - (i - 45) * 1.5  # Down to 122.5
            close_vals.append(val + np.random.normal(0, 0.2)) # add minor noise

        high_vals = [c + 1.0 for c in close_vals]
        low_vals = [c - 1.0 for c in close_vals]
        open_vals = [c - 0.1 for c in close_vals]
        volume_vals = [1000] * 60

        df = pd.DataFrame({
            'Open': open_vals,
            'High': high_vals,
            'Low': low_vals,
            'Close': close_vals,
            'Volume': volume_vals
        }, index=times)

        # Call with smaller depth/deviation so it identifies pivots easily
        res = calculate_pitchfork_indicators(df, deviation=2.0, depth=10, type_pf='Original')
        
        # Verify structure
        self.assertIn("zigzag", res)
        self.assertIn("pitchfork", res)
        self.assertIn("fibonacci", res)
        
        # Check that we have pitchfork lines plotted if pivots were found
        pf = res["pitchfork"]
        self.assertIn("median", pf)
        self.assertIn("upper_levels", pf)
        self.assertIn("lower_levels", pf)

    def test_schiff_pitchfork_type(self):
        """Test calculation with Schiff style pitchfork modifications."""
        np.random.seed(42)
        base_time = datetime(2026, 6, 1)
        times = [base_time + timedelta(days=i) for i in range(60)]
        close_vals = []
        for i in range(60):
            if i <= 15:
                val = 100.0 + i * 2.0
            elif i <= 30:
                val = 130.0 - (i - 15) * 3.0
            elif i <= 45:
                val = 85.0 + (i - 30) * 4.0
            else:
                val = 145.0 - (i - 45) * 1.5
            close_vals.append(val)

        high_vals = [c + 1.0 for c in close_vals]
        low_vals = [c - 1.0 for c in close_vals]
        open_vals = [c - 0.1 for c in close_vals]
        volume_vals = [1000] * 60

        df = pd.DataFrame({
            'Open': open_vals,
            'High': high_vals,
            'Low': low_vals,
            'Close': close_vals,
            'Volume': volume_vals
        }, index=times)

        res = calculate_pitchfork_indicators(df, deviation=2.0, depth=10, type_pf='Schiff')
        self.assertIn("pitchfork", res)
        pf = res["pitchfork"]
        self.assertIn("median", pf)

if __name__ == '__main__':
    unittest.main()
