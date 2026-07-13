import unittest
import os
import json
import base64
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient
from datetime import datetime, timedelta

# Setup test DB directory
os.environ["DATABASE_DIR"] = os.path.join(os.path.dirname(__file__), "test_data")

from backend.main import app, get_db, encode_key, decode_key
from backend.llm_config import (
    _get_gemini_keys_pool,
    _select_gemini_key,
    get_gemini_keys_health,
    GEMINI_KEYS_COOLDOWN,
    GEMINI_KEYS_BLACKLIST,
    call_llm,
    TASK_FAST
)

class TestGeminiRotationEngine(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)
        
    def setUp(self):
        # Reset rotation structures
        GEMINI_KEYS_COOLDOWN.clear()
        GEMINI_KEYS_BLACKLIST.clear()
        
        # Reset database tables
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM alert_settings WHERE key IN ('gemini_keys_pool', 'serpapi_api_key', 'tavily_api_key')")
            conn.commit()

    def test_base64_obfuscation(self):
        """Verify key encoding and decoding is secure and backward-compatible."""
        raw_key = "AIzaSyTest12345"
        encoded = encode_key(raw_key)
        self.assertTrue(encoded.startswith("b64_"))
        
        decoded = decode_key(encoded)
        self.assertEqual(decoded, raw_key)
        
        # Test backward compatibility (unencoded returns as-is)
        self.assertEqual(decode_key("plain_key_here"), "plain_key_here")

    @patch.dict(os.environ, {
        "GEMINI_API_KEY_1": "env_key_1",
        "GEMINI_API_KEY_2": "env_key_2",
        "GEMINI_API_KEY": "env_default"
    })
    def test_key_pool_aggregation(self):
        """Verify merging of env variables and dynamic SQLite database keys."""
        # Clear external keys starting with GEMINI_API_KEY to prevent test pollution
        for k in list(os.environ.keys()):
            if k.startswith("GEMINI_API_KEY") and k not in ("GEMINI_API_KEY_1", "GEMINI_API_KEY_2", "GEMINI_API_KEY"):
                del os.environ[k]
                
        # Setup DB key
        encoded_db_keys = [encode_key("db_key_1"), encode_key("db_key_2")]
        with get_db() as conn:
            cursor = conn.cursor()
            cursor.execute(
                "INSERT INTO alert_settings (key, value) VALUES ('gemini_keys_pool', ?)",
                (json.dumps(encoded_db_keys),)
            )
            conn.commit()
            
        pool = _get_gemini_keys_pool()
        self.assertIn("env_key_1", pool)
        self.assertIn("env_key_2", pool)
        self.assertIn("env_default", pool)
        self.assertIn("db_key_1", pool)
        self.assertIn("db_key_2", pool)
        self.assertEqual(len(pool), 5)

    def test_key_selection_and_cooldown(self):
        """Verify key rotation skips keys in cooldown."""
        keys = ["key_A", "key_B", "key_C"]
        
        # Select first key
        key, mask = _select_gemini_key(keys)
        self.assertEqual(key, "key_A")
        
        # Put key_A in cooldown
        GEMINI_KEYS_COOLDOWN[mask] = datetime.now() + timedelta(seconds=10)
        
        # Next selection should skip key_A and pick key_B
        key, mask = _select_gemini_key(keys)
        self.assertEqual(key, "key_B")

    def test_key_blacklisting(self):
        """Verify unauthorized keys (401/403) are blacklisted."""
        keys = ["key_A", "key_B"]
        
        # Blacklist key_A (which masks to "key_A" directly because len < 10)
        GEMINI_KEYS_BLACKLIST.add("key_A")
        
        # Selector should skip A and return B
        key, mask = _select_gemini_key(keys)
        self.assertEqual(key, "key_B")

    @patch("requests.get")
    @patch("requests.post")
    def test_api_settings_endpoints(self, mock_post, mock_get):
        """Verify GET and POST endpoints for API key configuration."""
        # Mock requests check to succeed
        mock_get_response = MagicMock()
        mock_get_response.status_code = 200
        mock_get.return_value = mock_get_response
        
        mock_post_response = MagicMock()
        mock_post_response.status_code = 200
        mock_post.return_value = mock_post_response
        
        # 1. Post new keys (with comma-separated search key lists)
        payload = {
            "keys": ["AIzaSyKey111", "AIzaSyKey222"],
            "serpapi_api_key": "serp_secret_1, serp_secret_2",
            "tavily_api_key": "tavily_secret_1, tavily_secret_2"
        }
        res = self.client.post("/api/settings/llm-keys", json=payload)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json(), {"status": "success"})
        
        # 2. Get keys (should return joined comma-separated values)
        res_get = self.client.get("/api/settings/llm-keys")
        self.assertEqual(res_get.status_code, 200)
        data = res_get.json()
        self.assertEqual(data["keys"], ["AIzaSyKey111", "AIzaSyKey222"])
        self.assertEqual(data["serpapi_api_key"], "serp_secret_1, serp_secret_2")
        self.assertEqual(data["tavily_api_key"], "tavily_secret_1, tavily_secret_2")

    def test_settings_validation_failure(self):
        """Verify dynamic verification smoke testing catches invalid keys."""
        # Mock a bad key checking response
        with patch("requests.get") as mock_get:
            bad_response = MagicMock()
            bad_response.status_code = 400
            bad_response.json.return_value = {
                "error": {
                    "status": "INVALID_ARGUMENT",
                    "message": "API_KEY_INVALID"
                }
            }
            mock_get.return_value = bad_response
            
            payload = {
                "keys": ["AIzaSyBadKey"],
                "serpapi_api_key": "",
                "tavily_api_key": ""
            }
            res = self.client.post("/api/settings/llm-keys", json=payload)
            self.assertEqual(res.status_code, 400)
            self.assertIn("verification failed", res.json()["detail"])

    @patch("backend.llm_config._select_gemini_key")
    @patch("backend.llm_config._get_client")
    def test_rotation_engine_fallback(self, mock_get_client, mock_select_key):
        """Verify fallback to Groq when all Gemini keys fail."""
        # Make key selection return None (exhausted)
        mock_select_key.return_value = (None, None)
        
        # Mock the Groq fallback client completion
        mock_client = MagicMock()
        mock_get_client.return_value = mock_client
        mock_completion = MagicMock()
        mock_completion.choices = [MagicMock()]
        mock_completion.choices[0].message.content = "Groq fallback synthesis result"
        mock_client.chat.completions.create.return_value = mock_completion
        
        with patch.dict(os.environ, {"LLM_PROVIDER": "gemini"}):
            res = call_llm(TASK_FAST, "system prompt", "user prompt")
            self.assertEqual(res, "Groq fallback synthesis result")

if __name__ == "__main__":
    unittest.main()
