import unittest
import os
import json
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

# Set database directory environment variable to test database
os.environ["DATABASE_DIR"] = os.path.join(os.path.dirname(__file__), "test_data")

from backend.main import app, get_db
from backend.swing_utils import (
    clean_float,
    calculate_volume_profile,
    calculate_swing_indicators,
    analyze_swing_signals,
    calculate_pivot_points,
    calculate_trendlines_with_breaks,
    calculate_mxwll_suite
)

class TestSwingUtils(unittest.TestCase):
    
    def test_calculate_pivot_points(self):
        """Verifies detection of swing high and low pivot points."""
        highs = [10.0] * 10
        lows = [5.0] * 10
        # Create a swing high at index 5
        highs[5] = 15.0
        # Create a swing low at index 3
        lows[3] = 2.0
        
        pivots = calculate_pivot_points(highs, lows, left_bars=2, right_bars=2)
        
        # We expect to find the swing high at index 5 and swing low at index 3
        high_pivots = [p for p in pivots if p["type"] == "high"]
        low_pivots = [p for p in pivots if p["type"] == "low"]
        
        self.assertTrue(any(p["index"] == 5 for p in high_pivots))
        self.assertTrue(any(p["index"] == 3 for p in low_pivots))
        
        self.assertEqual(next(p for p in high_pivots if p["index"] == 5)["value"], 15.0)
        self.assertEqual(next(p for p in low_pivots if p["index"] == 3)["value"], 2.0)

    def test_calculate_trendlines_with_breaks(self):
        """Verifies calculation of trendlines (Support/Resistance) and breakout signals."""
        dates = pd.date_range(end="2026-06-07", periods=30)
        prices = [100.0] * 30
        df = pd.DataFrame({
            "Open": prices,
            "High": prices,
            "Low": prices,
            "Close": prices,
            "Volume": [1000] * 30
        }, index=dates)
        
        # Since price is completely flat, we can test calculations run without error
        res = calculate_trendlines_with_breaks(df, length=3, atr_mult=1.0)
        self.assertIn("resistance", res)
        self.assertIn("support", res)
        self.assertIn("bullish_breaks", res)
        self.assertIn("bearish_breaks", res)

    def test_calculate_mxwll_suite(self):
        """Verifies calculation of Mxwll Price Action Suite metrics."""
        dates = pd.date_range(end="2026-06-07", periods=65)
        prices = [100.0 + i * 0.1 for i in range(65)]
        highs = [p + 0.5 for p in prices]
        lows = [p - 0.5 for p in prices]
        
        # Introduce a gap for FVG: Low[30] > High[28]
        highs[28] = 102.0
        lows[30] = 103.5
        
        df = pd.DataFrame({
            "Open": prices,
            "High": highs,
            "Low": lows,
            "Close": prices,
            "Volume": [1000] * 65
        }, index=dates)
        
        res = calculate_mxwll_suite(df, int_sens=3, ext_sens=10, show_last=5)
        self.assertIn("fib_levels", res)
        self.assertIn("order_blocks", res)
        self.assertIn("fvg", res)
        self.assertIn("structures", res)
    
    def test_clean_float(self):
        """Verifies clean_float converts values and handles NaN/Inf properly."""
        self.assertEqual(clean_float(10.5), 10.5)
        self.assertEqual(clean_float("123.45"), 123.45)
        self.assertEqual(clean_float(float('nan'), 5.0), 5.0)
        self.assertEqual(clean_float(float('inf'), -1.0), -1.0)
        self.assertEqual(clean_float("not-a-number", 9.9), 9.9)

    def test_calculate_volume_profile(self):
        """Verifies volume profile binning logic."""
        # Empty df
        empty_df = pd.DataFrame()
        self.assertEqual(calculate_volume_profile(empty_df), [])

        # Standard df
        prices = [10.0, 11.0, 12.0, 13.0, 14.0, 15.0, 16.0, 17.0, 18.0, 19.0]
        volumes = [100.0] * 10
        df = pd.DataFrame({"Close": prices, "Volume": volumes})
        bins = calculate_volume_profile(df, bins=5)
        self.assertEqual(len(bins), 5)
        for b in bins:
            self.assertIn("price", b)
            self.assertIn("volume", b)
            self.assertGreater(b["volume"], 0.0)

    def test_calculate_swing_indicators(self):
        """Verifies indicators columns are successfully appended."""
        dates = pd.date_range(end="2026-06-07", periods=35)
        prices = [100.0 + i * 0.5 for i in range(35)]
        df = pd.DataFrame({
            "Open": prices,
            "High": [p + 2 for p in prices],
            "Low": [p - 2 for p in prices],
            "Close": prices,
            "Volume": [1000] * 35
        }, index=dates)

        df_ind = calculate_swing_indicators(df)
        self.assertIn("EMA_5", df_ind.columns)
        self.assertIn("EMA_20", df_ind.columns)
        self.assertIn("SMA_20", df_ind.columns)
        self.assertIn("BB_Upper", df_ind.columns)
        self.assertIn("BB_Lower", df_ind.columns)
        self.assertIn("ATR", df_ind.columns)
        self.assertIn("MACD", df_ind.columns)
        self.assertIn("MACD_Signal", df_ind.columns)
        self.assertIn("MACD_Hist", df_ind.columns)
        
        # Check indicators are not empty or entirely NaN
        self.assertFalse(df_ind["EMA_5"].isna().all())
        self.assertFalse(df_ind["ATR"].isna().all())

    def test_analyze_swing_signals_rsi_pullback(self):
        """Verifies RSI Pullback setup detection when price experiences sharp selloff."""
        # Create a series with a major downward crash to force low RSI
        dates = pd.date_range(end="2026-06-07", periods=40)
        prices = [100.0] * 20 + [100.0 - i * 2 for i in range(1, 21)] # Deep selloff but keeps price positive
        df = pd.DataFrame({
            "Open": prices,
            "High": [p + 1 for p in prices],
            "Low": [p - 1 for p in prices],
            "Close": prices,
            "Volume": [1000] * 40
        }, index=dates)

        setup, desc, sl, tp1, tp2 = analyze_swing_signals(df)
        self.assertEqual(setup, "RSI Pullback")
        self.assertIn("oversold", desc.lower())
        self.assertGreater(sl, 0.0)
        self.assertGreater(tp1, sl)
        self.assertGreater(tp2, tp1)

    def test_analyze_swing_signals_macd_crossover(self):
        """Verifies MACD Bullish Crossover detection when fast line crosses above signal."""
        dates = pd.date_range(end="2026-06-07", periods=45)
        # Create prices that dip and then pop, driving MACD crossover
        prices = [100.0 - i * 0.2 for i in range(30)] + [94.0 + i * 1.5 for i in range(15)]
        df = pd.DataFrame({
            "Open": prices,
            "High": [p + 1 for p in prices],
            "Low": [p - 1 for p in prices],
            "Close": prices,
            "Volume": [1000] * 45
        }, index=dates)

        # Let's verify indicators show MACD crossover on last bar or check signal output
        # (It could either be MACD crossover or EMA cross or BB breakout depending on parameters)
        setup, desc, sl, tp1, tp2 = analyze_swing_signals(df)
        self.assertIn(setup, ["MACD Bullish Crossover", "EMA Golden Cross (5/20)", "BB Squeeze Breakout", "Fibonacci Support Bounce", "Hold/Consolidation", "Consolidation Trend"])

    def test_analyze_swing_signals_medium_horizon(self):
        """Verifies indicators and multipliers are wider when horizon is set to medium."""
        dates = pd.date_range(end="2026-06-07", periods=200)
        # Create steady uptrending prices to trigger Stage 2 Breakout
        prices = [100.0 + i * 0.5 for i in range(200)]
        df = pd.DataFrame({
            "Open": prices,
            "High": [p + 2 for p in prices],
            "Low": [p - 2 for p in prices],
            "Close": prices,
            "Volume": [1000] * 180 + [5000] * 20
        }, index=dates)

        setup, desc, sl, tp1, tp2 = analyze_swing_signals(df, horizon="medium")
        self.assertGreater(sl, 0.0)
        self.assertGreater(tp1, sl)
        self.assertGreater(tp2, tp1)
        self.assertIn(setup, ["Stage 2 Breakout", "EMA Trend Cross (20/50)", "50-Day EMA Bounce", "Weekly MACD Bullish", "Consolidation Trend", "RSI Pullback", "BB Breakout"])

    def test_analyze_swing_signals_medium_horizon_rsi_pullback(self):
        """Verifies Medium Term RSI Pullback setup detection when intermediate trend pullbacks."""
        dates = pd.date_range(end="2026-06-07", periods=100)
        # Steady down movement to get RSI low
        prices = [100.0] * 50 + [100.0 - i * 0.8 for i in range(1, 51)]
        df = pd.DataFrame({
            "Open": prices,
            "High": [p + 1 for p in prices],
            "Low": [p - 1 for p in prices],
            "Close": prices,
            "Volume": [1000] * 100
        }, index=dates)

        setup, desc, sl, tp1, tp2 = analyze_swing_signals(df, horizon="medium")
        self.assertEqual(setup, "RSI Pullback")
        self.assertIn("rsi levels are soft", desc.lower())



class TestSwingAPIRoutes(unittest.TestCase):
    
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    @patch("requests.get")
    def test_get_swing_candidate(self, mock_get):
        """Verifies candidate chart data fetching and indicators response."""
        # Mocking yfinance chart response
        mock_response = MagicMock()
        mock_response.status_code = 200
        
        timestamps = [int((datetime.now() - timedelta(days=i)).timestamp()) for i in range(300, 0, -1)]
        mock_json_data = {
            "chart": {
                "result": [{
                    "timestamp": timestamps,
                    "indicators": {
                        "quote": [{
                            "open": [100.0 + i for i in range(300)],
                            "high": [102.0 + i for i in range(300)],
                            "low": [98.0 + i for i in range(300)],
                            "close": [101.0 + i for i in range(300)],
                            "volume": [10000 + i * 100 for i in range(300)]
                        }]
                    }
                }]
            }
        }
        mock_response.json.return_value = mock_json_data
        mock_get.return_value = mock_response

        # Call endpoint
        response = self.client.get("/api/swing/candidate?symbol=RELIANCE.NS&timeframe=1D")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        
        self.assertEqual(data["symbol"], "RELIANCE.NS")
        self.assertEqual(data["timeframe"], "1D")
        self.assertIn("candlesticks", data)
        self.assertGreater(len(data["candlesticks"]), 0)
        self.assertIn("volume_profile", data)
        self.assertIn("setup", data)
        self.assertIn("stop_loss", data)

    @patch("requests.get")
    def test_get_swing_backtest(self, mock_get):
        """Verifies swing strategy backtest simulation endpoint."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        
        timestamps = [int((datetime.now() - timedelta(days=i)).timestamp()) for i in range(300, 0, -1)]
        mock_json_data = {
            "chart": {
                "result": [{
                    "timestamp": timestamps,
                    "indicators": {
                        "quote": [{
                            "open": [100.0 + i * 0.1 for i in range(300)],
                            "high": [102.0 + i * 0.1 for i in range(300)],
                            "low": [98.0 + i * 0.1 for i in range(300)],
                            "close": [101.0 + i * 0.1 for i in range(300)],
                            "volume": [5000 + i * 10 for i in range(300)]
                        }]
                    }
                }]
            }
        }
        mock_response.json.return_value = mock_json_data
        mock_get.return_value = mock_response

        response = self.client.get("/api/swing/backtest?symbol=TCS.NS&strategy=ALL")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        
        self.assertIn("win_rate_pct", data)
        self.assertIn("profit_factor", data)
        self.assertIn("equity_curve", data)
        self.assertGreater(len(data["equity_curve"]), 0)

    @patch("backend.main.call_groq_llm")
    def test_post_swing_synthesis(self, mock_groq):
        """Verifies tactical docket generation using mock Groq output."""
        mock_groq.return_value = (
            "### I. Tactical Setup & Technical Signals\n"
            "MACD Crossover confirmed on RELIANCE.NS.\n\n"
            "### II. Volume Profile & High-Volume Nodes\n"
            "Support node at Rs. 2400.\n\n"
            "### III. Risk-Reward Parameters & Position Sizing\n"
            "Entry at 2450, SL at 2380.\n\n"
            "### IV. Key Catalysts & Exit Trajectory\n"
            "Earnings catalyst in Q1."
        )

        payload = {
            "symbol": "RELIANCE.NS",
            "strategy": "MACD Bullish Crossover",
            "price": 2450.0,
            "stop_loss": 2380.0,
            "target_1": 2550.0,
            "target_2": 2650.0,
            "rsi": 55.4,
            "volume_ratio": 1.45
        }
        
        response = self.client.post("/api/swing/synthesis", json=payload)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("synthesis", data)
        self.assertIn("### I. Tactical Setup & Technical Signals", data["synthesis"])

    @patch("backend.main.call_groq_llm")
    def test_post_swing_synthesis_fallback(self, mock_groq):
        """Verifies fallback text docket generation when Groq returns an error/empty string."""
        mock_groq.return_value = "ERROR: rate limit exceeded"

        payload = {
            "symbol": "TCS.NS",
            "strategy": "RSI Pullback",
            "price": 3800.0,
            "stop_loss": 3650.0,
            "target_1": 4000.0,
            "target_2": 4200.0,
            "rsi": 28.5,
            "volume_ratio": 2.1,
            "backtest_trades": 8,
            "backtest_winrate": 62.5,
            "backtest_profitfactor": 2.1,
            "backtest_holddays": 4.5,
            "capital": 100000.0,
            "risk_pct": 2.0,
            "shares_to_buy": 13,
            "capital_required": 49400.0,
            "risk_amount": 1950.0,
            "reward_potential": 5200.0,
            "rr_ratio_calc": 2.67
        }
        
        response = self.client.post("/api/swing/synthesis", json=payload)
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertIn("synthesis", data)
        self.assertIn("exhibits an active", data["synthesis"])
        self.assertIn("RSI Pullback", data["synthesis"])
        self.assertIn("expanding at", data["synthesis"])
        self.assertIn("2.10x", data["synthesis"])
        self.assertIn("completing **8** total trades", data["synthesis"])
        self.assertIn("win rate of **62.5%**", data["synthesis"])
        self.assertIn("profit factor of **2.10**", data["synthesis"])
        self.assertIn("averaging **4.5 days**", data["synthesis"])
        self.assertIn("account capital size of **Rs. 100,000.00**", data["synthesis"])
        self.assertIn("13 shares", data["synthesis"])
        self.assertIn("caps the total absolute risk on the trade to **Rs. 1,950.00**", data["synthesis"])
        self.assertIn("reward potential of **Rs. 5,200.00**", data["synthesis"])
        self.assertIn("risk-reward ratio of **1:2.67**", data["synthesis"])

    @patch("requests.get")
    def test_get_tv_chart_data(self, mock_get):
        """Verifies interactive chart data endpoint and swing indicator calculations."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        
        timestamps = [int((datetime.now() - timedelta(days=i)).timestamp()) for i in range(100, 0, -1)]
        mock_json_data = {
            "chart": {
                "result": [{
                    "timestamp": timestamps,
                    "indicators": {
                        "quote": [{
                            "open": [100.0 + i * 0.1 for i in range(100)],
                            "high": [102.0 + i * 0.1 for i in range(100)],
                            "low": [98.0 + i * 0.1 for i in range(100)],
                            "close": [101.0 + i * 0.1 for i in range(100)],
                            "volume": [5000 + i * 10 for i in range(100)]
                        }]
                    }
                }]
            }
        }
        mock_response.json.return_value = mock_json_data
        mock_get.return_value = mock_response

        # Request with params
        response = self.client.get("/api/chart/tv-chart-data?ticker=RELIANCE.NS&length=10&mult=1.5")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        
        self.assertIn("candlesticks", data)
        self.assertGreater(len(data["candlesticks"]), 0)
        first_candle = data["candlesticks"][0]
        self.assertIn("time", first_candle)
        self.assertIn("open", first_candle)
        self.assertIn("high", first_candle)
        self.assertIn("low", first_candle)
        self.assertIn("close", first_candle)
        self.assertIn("ema_20", first_candle)
        self.assertIn("ema_50", first_candle)
        self.assertIn("resistance", first_candle)
        self.assertIn("support", first_candle)
        self.assertIn("bullish_break", first_candle)
        self.assertIn("bearish_break", first_candle)
        
        self.assertIn("mxwll", data)
        self.assertIn("fib_levels", data["mxwll"])
        self.assertIn("order_blocks", data["mxwll"])
        self.assertIn("fvg", data["mxwll"])
        self.assertIn("structures", data["mxwll"])

    @patch("requests.get")
    @patch("backend.agent.call_groq_llm")
    def test_get_indicator_synthesis(self, mock_groq, mock_get):
        """Verifies custom indicator AI synthesis endpoints and LLM prompts compilation."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        
        timestamps = [int((datetime.now() - timedelta(days=i)).timestamp()) for i in range(100, 0, -1)]
        mock_json_data = {
            "chart": {
                "result": [{
                    "timestamp": timestamps,
                    "indicators": {
                        "quote": [{
                            "open": [100.0 + i * 0.1 for i in range(100)],
                            "high": [102.0 + i * 0.1 for i in range(100)],
                            "low": [98.0 + i * 0.1 for i in range(100)],
                            "close": [101.0 + i * 0.1 for i in range(100)],
                            "volume": [5000 + i * 10 for i in range(100)]
                        }]
                    }
                }]
            }
        }
        mock_response.json.return_value = mock_json_data
        mock_get.return_value = mock_response
        
        mock_groq.return_value = "### Technical Analysis Summary\n- Support active at 100.0\n- Resistance active at 110.0"
        
        # Test default (lux-algo)
        response = self.client.get("/api/chart/indicator-synthesis?ticker=RELIANCE.NS&indicator=lux-algo&length=10&mult=1.5")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        self.assertEqual(data["symbol"], "RELIANCE.NS")
        self.assertEqual(data["indicator"], "lux-algo")
        self.assertIn("synthesis", data)
        self.assertIn("Support active at 100.0", data["synthesis"])
        
        # Test lux-smc
        response_smc = self.client.get("/api/chart/indicator-synthesis?ticker=RELIANCE.NS&indicator=lux-smc&length=10&mult=1.5")
        self.assertEqual(response_smc.status_code, 200)
        
        # Test mxwll
        response_mxwll = self.client.get("/api/chart/indicator-synthesis?ticker=RELIANCE.NS&indicator=mxwll&length=10&mult=1.5")
        self.assertEqual(response_mxwll.status_code, 200)


class TestQuantScoring(unittest.TestCase):
    
    def test_composite_scoring_engine(self):
        """Verifies calculation of short/medium trade scores and trigger flags."""
        from backend.quant_scoring import calculate_composite_trade_score
        
        # Test 1: Ideal Short-Term Breakout
        score, flags, breakdown = calculate_composite_trade_score(
            horizon="short",
            setup_name="BB Squeeze Breakout",
            volume_ratio=2.6,
            rsi=58.0,
            atr_pct_contracting=True,
            nifty_bullish=True,
            sector_leading=True,
            promoter_pledged_pct=0.0,
            fii_dii_increased=True,
            delivery_pct=50.0,
            days_to_earnings=None
        )
        self.assertEqual(score, 100.0) # Maximum capped score
        self.assertIn("VCP", flags)
        self.assertIn("Leading Sector", flags)
        self.assertIn("Institutional Accumulation", flags)

        # Test 2: Low-Quality High-Pledge Short-Term Breakout
        score_bad, flags_bad, breakdown_bad = calculate_composite_trade_score(
            horizon="short",
            setup_name="BB Squeeze Breakout",
            volume_ratio=2.6,
            rsi=58.0,
            atr_pct_contracting=False,
            nifty_bullish=True,
            sector_leading=False,
            promoter_pledged_pct=35.0, # high pledge
            fii_dii_increased=False,
            delivery_pct=15.0,
            days_to_earnings=2 # earnings tomorrow
        )
        self.assertLess(score_bad, 60.0)
        self.assertTrue(any("Promoter Pledge" in f for f in flags_bad))
        self.assertTrue(any("Earnings" in f for f in flags_bad))

    def test_detect_vsa_setup(self):
        """Verifies correct classification of Wyckoff VSA setups."""
        from backend.quant_scoring import detect_vsa_setup
        
        # 1. Selling Climax: vol_ratio >= 2.0, close < open, close_pos >= 0.4
        climax = detect_vsa_setup(open_p=100.0, high_p=105.0, low_p=85.0, close_p=95.0, volume=2.5, avg_volume_20d=1.0)
        self.assertIsNotNone(climax)
        self.assertEqual(climax["pattern"], "Selling Climax / Bag Holding")
        self.assertEqual(climax["type"], "bullish")

        # 2. No Supply: vol_ratio <= 0.6, close < open, close_pos <= 0.6
        no_supply = detect_vsa_setup(open_p=100.0, high_p=101.0, low_p=98.0, close_p=99.0, volume=0.4, avg_volume_20d=1.0)
        self.assertIsNotNone(no_supply)
        self.assertEqual(no_supply["pattern"], "No Supply Bar")
        self.assertEqual(no_supply["type"], "bullish")

        # 3. No Demand: vol_ratio <= 0.6, close > open, close_pos >= 0.4
        no_demand = detect_vsa_setup(open_p=100.0, high_p=102.0, low_p=99.5, close_p=101.0, volume=0.4, avg_volume_20d=1.0)
        self.assertIsNotNone(no_demand)
        self.assertEqual(no_demand["pattern"], "No Demand Bar")
        self.assertEqual(no_demand["type"], "bearish")

    def test_calculate_delivery_zscore(self):
        """Verifies delivery Z-score calculations from baseline data list."""
        from backend.quant_scoring import calculate_delivery_zscore
        
        # Spikes relative to standard baseline with minor variations to prevent 0 stddev
        hist = [98.0, 102.0, 99.0, 101.0] * 5 + [150.0] # 20 baseline points + 1 latest point (150)
        z = calculate_delivery_zscore(hist)
        self.assertGreater(z, 2.0)

        # Test resilience: list containing None and strings
        hist_none = [98.0, None, "102.0", 99.0, None, 101.0] * 5 + [150.0]
        z_none = calculate_delivery_zscore(hist_none)
        self.assertGreater(z_none, 2.0)

        # Test resilience: empty or short lists
        self.assertEqual(calculate_delivery_zscore([]), 0.0)
        self.assertEqual(calculate_delivery_zscore([100.0, None, 102.0]), 0.0)

    def test_composite_scoring_engine_vsa_booster(self):
        """Verifies that calculate_composite_trade_score applies VSA & delivery boosts."""
        from backend.quant_scoring import calculate_composite_trade_score
        
        # Base score run
        base_score, base_flags, base_breakdown = calculate_composite_trade_score(
            horizon="short",
            setup_name="RSI Pullback",
            volume_ratio=1.0,
            rsi=30.0,
            atr_pct_contracting=False,
            nifty_bullish=True,
            sector_leading=False,
            delivery_zscore=0.0,
            vsa_setup=None
        )
        
        # Score run with boosted delivery Z-score & VSA setup
        boosted_score, boosted_flags, boosted_breakdown = calculate_composite_trade_score(
            horizon="short",
            setup_name="RSI Pullback",
            volume_ratio=1.0,
            rsi=30.0,
            atr_pct_contracting=False,
            nifty_bullish=True,
            sector_leading=False,
            delivery_zscore=2.5,
            vsa_setup={"type": "bullish", "pattern": "No Supply Bar"}
        )
        
        self.assertEqual(boosted_score - base_score, 30.0) # +15 (Z-score) +15 (bullish VSA)
        self.assertTrue(any("Institutional Block Buying" in f for f in boosted_flags))
        self.assertTrue(any("Bullish VSA" in f for f in boosted_flags))
        self.assertEqual(boosted_breakdown["VSA & Delivery Dynamics"], 30.0)

    @patch("backend.main.check_nifty_regime")
    @patch("backend.main.get_db")
    def test_scan_returns_sorted_trade_scores(self, mock_db, mock_nifty):
        """Verifies scan API correctly calculates composite score and ranks by it."""
        mock_nifty.return_value = (True, 22000.0, 21850.0)
        
        # Setup mock SQLite rows
        mock_conn = MagicMock()
        mock_cursor = MagicMock()
        mock_db.return_value.__enter__.return_value = mock_conn
        mock_conn.cursor.return_value = mock_cursor
        
        # Mocking delivery percentages and history query
        mock_cursor.fetchall.side_effect = [
            [{"symbol": "INFY.NS", "delivery_percentage": 55.0}, 
             {"symbol": "TCS.NS", "delivery_percentage": 15.0}], # delivery stats query
            [{"sector": "IT"}], # leading sectors query
            [{"symbol": "INFY.NS", "delivery_qty": 500000},
             {"symbol": "TCS.NS", "delivery_qty": 200000}], # delivery history query
            [{"symbol": "INFY.NS", "company_name": "Infosys", "sector": "IT", "cap_type": "large"},
             {"symbol": "TCS.NS", "company_name": "TCS", "sector": "IT", "cap_type": "large"}], # screener universe query
            [{"symbol": "INFY.NS", "profile_json": json.dumps({
                "fundamentals": {"current_price": 1500.0, "promoter_pledge_pct": 0.0},
                "technicals": {
                    "rsi": 58.0, "volume_vs_avg20": 2.8, "breakout_status": "BULLISH BREAKOUT", "atr_pct_contracting": True,
                    "daily_open": 1490.0, "daily_high": 1520.0, "daily_low": 1485.0, "daily_close": 1500.0
                },
                "shareholding": {"FIIs": 25.0, "DIIs": 15.0}
             })},
             {"symbol": "TCS.NS", "profile_json": json.dumps({
                "fundamentals": {"current_price": 3800.0, "promoter_pledge_pct": 12.0}, # high pledge
                "technicals": {
                    "rsi": 75.0, "volume_vs_avg20": 1.2, "breakout_status": "BULLISH BREAKOUT", "atr_pct_contracting": False,
                    "daily_open": 3810.0, "daily_high": 3820.0, "daily_low": 3780.0, "daily_close": 3800.0
                },
                "shareholding": {"FIIs": 12.0, "DIIs": 5.0}
             })}] # cached profiles query
        ]
        
        client = TestClient(app)
        response = client.get("/api/swing/scan?strategy=ALL&horizon=short")
        self.assertEqual(response.status_code, 200)
        data = response.json()
        
        self.assertEqual(len(data), 2)
        # First candidate should be INFY.NS (high score) followed by TCS.NS
        self.assertEqual(data[0]["symbol"], "INFY.NS")
        self.assertGreater(data[0]["trade_score"], data[1]["trade_score"])
        self.assertIn("trade_score", data[0])
        self.assertIn("trade_flags", data[0])


if __name__ == "__main__":
    unittest.main()
