import unittest
import os
import json
import pandas as pd
import numpy as np
from datetime import datetime, timedelta
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

# Setup environment variables for test database
TEST_DIR = os.path.dirname(__file__)
TEST_DATA_DIR = os.path.join(TEST_DIR, "test_data")
os.makedirs(TEST_DATA_DIR, exist_ok=True)
os.environ["DATABASE_DIR"] = TEST_DATA_DIR

from backend.main import app, get_db

class TestChartChatAnalyst(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    def setUp(self):
        # Create database tables if not existing
        with get_db() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS cached_trades (
                    symbol TEXT PRIMARY KEY,
                    data_json TEXT,
                    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            conn.execute("DELETE FROM cached_trades")
            conn.commit()

    @patch("backend.main.fetch_history_df")
    @patch("backend.llm_config.call_llm")
    def test_chart_chat_analyst_success(self, mock_call_llm, mock_fetch_history_df):
        """Test chart chat analyst returns synthesis successfully when indicators are toggled."""
        # Create dummy dataframe
        times = [datetime(2026, 6, 1) + timedelta(days=i) for i in range(50)]
        df = pd.DataFrame({
            "Open": [100.0] * 50,
            "High": [105.0] * 50,
            "Low": [95.0] * 50,
            "Close": [101.0] * 50,
            "Volume": [1000] * 50
        }, index=times)
        
        mock_fetch_history_df.return_value = df
        mock_call_llm.return_value = "Mocked Technical Analysis Report"

        # Insert mock cached trades
        with get_db() as conn:
            conn.execute(
                "INSERT INTO cached_trades (symbol, data_json, last_updated) VALUES (?, ?, ?)",
                ("RELIANCE", json.dumps({
                    "insider_trades": [{"date": "2026-07-01", "acquirer": "Promoter A", "mode": "Acquisition", "shares": 5000, "value": 150000}],
                    "bulk_deals": [],
                    "block_deals": []
                }), datetime.now().isoformat())
            )
            conn.commit()

        req_body = {
            "symbol": "RELIANCE.NS",
            "indicator": "lux-algo,mxwll,lux-smc,lrtc,pitchfork",
            "length": 14,
            "mult": 1.0,
            "custom_prompt": "Is the stock near a major reversal level?",
            "chat_history": []
        }

        res = self.client.post("/api/chart/chat-analyst", json=req_body)
        self.assertEqual(res.status_code, 200)
        data = res.json()
        self.assertIn("analysis", data)
        self.assertEqual(data["analysis"], "Mocked Technical Analysis Report")
        
        # Verify LLM was called with correct context details
        mock_call_llm.assert_called_once()
        args = mock_call_llm.call_args[0]
        self.assertIn("Indian Stock Markets", args[1]) # Check system prompt content

    def test_chart_chat_analyst_missing_symbol(self):
        """Test request with empty or missing symbol returns validation or request body error."""
        req_body = {
            "symbol": "",
            "indicator": "general",
            "length": 14,
            "mult": 1.0,
            "custom_prompt": "What is the trend?",
            "chat_history": []
        }
        res = self.client.post("/api/chart/chat-analyst", json=req_body)
        self.assertEqual(res.status_code, 400)

if __name__ == '__main__':
    unittest.main()
