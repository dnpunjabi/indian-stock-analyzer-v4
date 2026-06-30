import time
import requests
from bs4 import BeautifulSoup
import re
import asyncio

class CommodityScraper:
    _cache = {}
    _last_fetch = 0
    _fetch_interval = 900  # 15 minutes cache lifetime

    @classmethod
    async def get_prices(cls):
        now = time.time()
        # If cache is empty or older than 15 minutes, trigger background fetch
        if not cls._cache or (now - cls._last_fetch) > cls._fetch_interval:
            await cls._fetch_all()
        return cls._cache

    @classmethod
    async def _fetch_all(cls):
        loop = asyncio.get_event_loop()
        try:
            # Run in executor to prevent blocking FastAPI's async event loop
            data = await loop.run_in_executor(None, cls._scrap_sync)
            if data:
                cls._cache = data
                cls._last_fetch = time.time()
                print("[SUCCESS] Successfully scraped commodity prices from GoodReturns")
        except Exception as e:
            print(f"[ERROR] Error scraping commodities: {e}")

    @classmethod
    def _scrap_sync(cls):
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
        res = {}
        
        # 1. Gold (10g Spot)
        try:
            r = requests.get("https://www.goodreturns.in/gold-rates/", headers=headers, timeout=10)
            if r.status_code == 200:
                soup = BeautifulSoup(r.text, 'html.parser')
                tables = soup.find_all('table')
                if tables and len(tables) > 0:
                    rows = tables[0].find_all('tr')
                    if len(rows) > 3:
                        row = rows[3]
                        cells = [cell.get_text(strip=True) for cell in row.find_all(['td', 'th'])]
                        if len(cells) > 2:
                            p_24k, c_24k, pct_24k = cls._parse_gold_cell(cells[1])
                            p_22k, c_22k, pct_22k = cls._parse_gold_cell(cells[2])
                            res["gold_24k"] = {"price": p_24k, "change": c_24k, "change_pct": pct_24k}
                            res["gold_22k"] = {"price": p_22k, "change": c_22k, "change_pct": pct_22k}
        except Exception as e:
            print(f"Error scraping gold: {e}")

        # 2. Silver (1kg Spot)
        try:
            r = requests.get("https://www.goodreturns.in/silver-rates/", headers=headers, timeout=10)
            if r.status_code == 200:
                soup = BeautifulSoup(r.text, 'html.parser')
                tables = soup.find_all('table')
                if tables and len(tables) > 0:
                    rows = tables[0].find_all('tr')
                    if len(rows) > 5:
                        row = rows[5]
                        cells = [cell.get_text(strip=True) for cell in row.find_all(['td', 'th'])]
                        if len(cells) > 3:
                            p_sil, c_sil, pct_sil = cls._parse_silver_platinum_row(cells)
                            res["silver_1kg"] = {"price": p_sil, "change": c_sil, "change_pct": pct_sil}
        except Exception as e:
            print(f"Error scraping silver: {e}")

        # 3. Platinum (10g Spot)
        try:
            r = requests.get("https://www.goodreturns.in/platinum-price.html", headers=headers, timeout=10)
            if r.status_code == 200:
                soup = BeautifulSoup(r.text, 'html.parser')
                tables = soup.find_all('table')
                if tables and len(tables) > 0:
                    rows = tables[0].find_all('tr')
                    if len(rows) > 3:
                        row = rows[3]
                        cells = [cell.get_text(strip=True) for cell in row.find_all(['td', 'th'])]
                        if len(cells) > 3:
                            p_plat, c_plat, pct_plat = cls._parse_silver_platinum_row(cells)
                            res["platinum_10g"] = {"price": p_plat, "change": c_plat, "change_pct": pct_plat}
        except Exception as e:
            print(f"Error scraping platinum: {e}")

        return res

    @staticmethod
    def _clean_val(val_str):
        return re.sub(r'[^\d\.\+\-]', '', val_str)

    @staticmethod
    def _parse_gold_cell(cell_str):
        price_part = cell_str.split('(')[0]
        price = float(CommodityScraper._clean_val(price_part))
        
        change = 0.0
        match = re.search(r'\(([^)]+)\)', cell_str)
        if match:
            change_str = match.group(1)
            cleaned_change = CommodityScraper._clean_val(change_str)
            if cleaned_change:
                is_neg = '-' in change_str
                val = float(cleaned_change)
                change = -val if is_neg else val
                
        yesterday = price - change
        change_pct = (change / yesterday * 100) if yesterday != 0 else 0.0
        return price, change, change_pct

    @staticmethod
    def _parse_silver_platinum_row(row_cells):
        today_str = row_cells[1]
        yesterday_str = row_cells[2]
        change_str = row_cells[3]
        
        today_price = float(CommodityScraper._clean_val(today_str))
        yesterday_price = float(CommodityScraper._clean_val(yesterday_str))
        
        is_negative = '-' in change_str
        change_val = float(CommodityScraper._clean_val(change_str))
        if is_negative and change_val > 0:
            change_val = -change_val
            
        change_pct = (change_val / yesterday_price * 100) if yesterday_price != 0 else 0.0
        return today_price, change_val, change_pct
