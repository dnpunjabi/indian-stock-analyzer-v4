import unittest
import os
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

# Set database directory environment variable to test database path
os.environ["DATABASE_DIR"] = os.path.join(os.path.dirname(__file__), "test_data")

from backend.main import app
from backend.screens_scraper import scrape_saved_screens, scrape_screen_results

class TestScreensTrackerAPI(unittest.TestCase):
    
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    @patch("requests.get")
    def test_scrape_saved_screens_mock(self, mock_get):
        """Verify parsing of custom saved screens list from Screener.in."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.text = """
        <html>
            <body>
                <div class="user-screens">
                    <a href="/screen/user/10123/">High Growth Tech</a>
                    <a href="/screen/user/20456/">Consistent Roce</a>
                    <a href="/screen/raw/30789/">Value Under 15 PE</a>
                    <!-- Standard links to ignore -->
                    <a href="/screens/">Explore Screens</a>
                </div>
            </body>
        </html>
        """
        mock_get.return_value = mock_response

        screens = scrape_saved_screens("dummy_cookie")
        self.assertEqual(len(screens), 3)
        self.assertEqual(screens[0]["id"], "10123")
        self.assertEqual(screens[0]["name"], "High Growth Tech")
        self.assertEqual(screens[1]["id"], "20456")
        self.assertEqual(screens[2]["id"], "30789")

    @patch("requests.get")
    def test_scrape_screen_results_mock(self, mock_get):
        """Verify parsing of stocks result table from custom saved screen page."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.text = """
        <html>
            <body>
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>S.No.</th>
                            <th>Name</th>
                            <th>Current Price</th>
                            <th>P/E</th>
                            <th>Market Capitalization</th>
                            <th>ROCE</th>
                        </tr>
                    </thead>
                    <tbody>
                        <tr>
                            <td>1</td>
                            <td><a href="/company/TCS/consolidated/">Tata Consultancy Services Ltd</a></td>
                            <td>3,850.50</td>
                            <td>28.5</td>
                            <td>1400000.0</td>
                            <td>42.5</td>
                        </tr>
                        <tr>
                            <td>2</td>
                            <td><a href="/company/INFY/">Infosys Ltd</a></td>
                            <td>1,520.00</td>
                            <td>24.2</td>
                            <td>630000.0</td>
                            <td>31.8</td>
                        </tr>
                    </tbody>
                </table>
            </body>
        </html>
        """
        mock_get.return_value = mock_response

        data = scrape_screen_results("10123", "dummy_cookie")
        self.assertIn("companies", data)
        companies = data["companies"]
        self.assertEqual(len(companies), 2)
        
        self.assertEqual(companies[0]["symbol"], "TCS")
        self.assertEqual(companies[0]["name"], "Tata Consultancy Services Ltd")
        self.assertEqual(companies[0]["price"], 3850.5)
        self.assertEqual(companies[0]["pe"], 28.5)
        self.assertEqual(companies[0]["market_cap"], 1400000.0)
        self.assertEqual(companies[0]["roce"], 42.5)

        self.assertEqual(companies[1]["symbol"], "INFY")
        self.assertEqual(companies[1]["name"], "Infosys Ltd")
        self.assertEqual(companies[1]["price"], 1520.0)

    @patch("requests.get")
    def test_api_screener_screens_endpoint(self, mock_get):
        """Test the GET /api/screener/screens endpoint behavior when cookie is mock loaded."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.text = '<html><body><a href="/screen/user/10123/">High Growth Tech</a></body></html>'
        mock_get.return_value = mock_response

        with patch("backend.main.get_db") as mock_get_db:
            mock_conn = MagicMock()
            mock_cursor = MagicMock()
            mock_get_db.return_value.__enter__.return_value = mock_conn
            mock_conn.cursor.return_value = mock_cursor
            mock_cursor.fetchone.return_value = {"value": "dummy_cookie"}
            
            response = self.client.get("/api/screener/screens")
            self.assertEqual(response.status_code, 200)
            data = response.json()
            self.assertIn("screens", data)
            self.assertTrue(len(data["screens"]) > 0)
            self.assertEqual(data["screens"][0]["id"], "10123")

    @patch("requests.get")
    def test_api_screener_screens_preview_endpoint(self, mock_get):
        """Test the GET /api/screener/screens/{id}/preview endpoint."""
        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.text = """
        <html>
            <body>
                <table class="data-table">
                    <thead>
                        <tr><th>Name</th><th>CMP</th></tr>
                    </thead>
                    <tbody>
                        <tr><td><a href="/company/TCS/">TCS</a></td><td>3800</td></tr>
                    </tbody>
                </table>
            </body>
        </html>
        """
        mock_get.return_value = mock_response

        with patch("backend.main.get_db") as mock_get_db:
            mock_conn = MagicMock()
            mock_cursor = MagicMock()
            mock_get_db.return_value.__enter__.return_value = mock_conn
            mock_conn.cursor.return_value = mock_cursor
            mock_cursor.fetchone.return_value = {"value": "dummy_cookie"}
            
            response = self.client.get("/api/screener/screens/10123/preview")
            self.assertEqual(response.status_code, 200)
            data = response.json()
            self.assertIn("companies", data)
            self.assertTrue(len(data["companies"]) > 0)
            self.assertEqual(data["companies"][0]["symbol"], "TCS")
