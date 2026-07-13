import re
import requests
from bs4 import BeautifulSoup
from backend.financial_utils import make_screener_request

def clean_symbol(symbol: str) -> str:
    """Cleans ticker symbols (e.g. RELIANCE.NS -> RELIANCE)."""
    if not symbol:
        return ""
    parts = symbol.split(".")
    return parts[0].strip().upper()

def get_session_cookies(session_cookie: str) -> dict:
    """Formats the session cookie string into a dictionary."""
    cookies = {}
    if session_cookie:
        cookie_val = session_cookie.strip()
        if "sessionid=" in cookie_val:
            cookie_val = cookie_val.split("sessionid=")[-1].split(";")[0].strip()
        cookies["sessionid"] = cookie_val
    return cookies

def scrape_saved_screens(session_cookie: str = None) -> list:
    """
    Scrapes the authenticated user's custom saved screens from Screener.in's explore dashboard.
    """
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    cookies = get_session_cookies(session_cookie)
    
    # We fetch /explore/ because it lists custom user screens under 'Your screens'
    url = "https://www.screener.in/explore/"
    try:
        res = make_screener_request(url, headers=headers, cookies=cookies, timeout=15)
        if res.status_code != 200:
            return []
            
        soup = BeautifulSoup(res.text, "html.parser")
        screens = []
        
        # 1. Look for the "Your screens" or "Custom screens" section header
        header = soup.find(lambda tag: tag.name in ['h1', 'h2', 'h3', 'h4'] and 'your screens' in tag.get_text().lower())
        if not header:
            header = soup.find(lambda tag: tag.name in ['h1', 'h2', 'h3', 'h4'] and 'custom screens' in tag.get_text().lower())
            
        container = None
        if header:
            container = header.find_parent('div', class_='card')
            if not container:
                container = header.find_parent()
                
        if container:
            for link in container.find_all('a', href=re.compile(r'/screens/\d+/')):
                href = link.get('href', '')
                div_tag = link.find('div', class_='font-weight-500')
                name = div_tag.get_text(strip=True) if div_tag else link.get_text(strip=True)
                if href and name:
                    screens.append({
                        "id": href,
                        "name": name
                    })
                    
        # 2. Fallback to any /screens/\d+/ link on page if no custom section was located
        if not screens:
            for link in soup.find_all('a', href=re.compile(r'/screens/\d+/')):
                href = link.get('href', '')
                div_tag = link.find('div', class_='font-weight-500')
                name = div_tag.get_text(strip=True) if div_tag else link.get_text(strip=True)
                if href and name and not any(s['id'] == href for s in screens):
                    screens.append({
                        "id": href,
                        "name": name
                    })
                    
        return screens
    except Exception as e:
        print(f"Failed to scrape saved screens: {e}")
        return []

def scrape_screen_results(screen_id: str, session_cookie: str = None, page: int = 1) -> dict:
    """
    Executes and scrapes matching companies of a specific screen.
    `screen_id` can be a raw numeric ID or a full path (e.g. /screens/156741/myfirst-query/)
    """
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    cookies = get_session_cookies(session_cookie)
    
    # Clean screen_id and determine the exact request URL
    clean_id = screen_id.strip()
    if "screens/" in clean_id:
        path = clean_id.lstrip("/")
        url = f"https://www.screener.in/{path}?page={page}"
    else:
        # Fallback to internal raw screen results if it's a numeric ID
        url = f"https://www.screener.in/screen/raw/{clean_id}/?page={page}"
        
    try:
        res = make_screener_request(url, headers=headers, cookies=cookies, timeout=15)
        if res.status_code != 200:
            if res.status_code == 404:
                return {"error": f"Screen not found (URL: {url}).", "companies": [], "total_pages": 1}
            return {"error": f"Failed to retrieve screen. Status: {res.status_code}", "companies": [], "total_pages": 1}
            
        soup = BeautifulSoup(res.text, "html.parser")
        
        # 1. Determine total pages from pagination links
        total_pages = 1
        page_links = soup.find_all('a', href=re.compile(r'\?page=\d+'))
        for pl in page_links:
            try:
                p_num = int(re.search(r'\?page=(\d+)', pl.get('href', '')).group(1))
                if p_num > total_pages:
                    total_pages = p_num
            except Exception:
                pass
                
        # 2. Parse table headers to map indices dynamically
        table = soup.find('table', class_='data-table')
        if not table:
            return {"companies": [], "total_pages": 1, "current_page": page}
            
        headers_row = table.find('thead').find('tr') if table.find('thead') else None
        header_cols = []
        if headers_row:
            header_cols = [th.get_text(strip=True).upper() for th in headers_row.find_all('th')]
            
        # Map dynamic headers to expected parameters
        col_indices = {
            "name": -1,
            "price": -1,
            "pe": -1,
            "market_cap": -1,
            "roce": -1
        }
        
        for idx, h in enumerate(header_cols):
            if "NAME" in h:
                col_indices["name"] = idx
            elif "CMP" in h or "PRICE" in h:
                col_indices["price"] = idx
            elif "P/E" in h or "PE" in h:
                col_indices["pe"] = idx
            elif "MAR CAP" in h or "MARKET CAP" in h or "CAPITALIZATION" in h:
                col_indices["market_cap"] = idx
            elif "ROCE" in h or "RETURN ON CAPITAL" in h:
                col_indices["roce"] = idx
                
        # Fallback to defaults if headers parsing fails
        if col_indices["name"] == -1:
            col_indices["name"] = 1
            
        companies = []
        tbody = table.find('tbody')
        if tbody:
            for row in tbody.find_all('tr'):
                cells = row.find_all('td')
                if len(cells) < 2:
                    continue
                    
                # Name cell (usually contains link)
                name_idx = col_indices["name"]
                name_cell = cells[name_idx] if name_idx < len(cells) else cells[1]
                link = name_cell.find('a')
                if not link:
                    continue
                    
                href = link.get('href', '')
                symbol_match = re.search(r'/company/([^/]+)/', href)
                if not symbol_match:
                    continue
                symbol = clean_symbol(symbol_match.group(1))
                name = link.get_text(strip=True)
                
                # Helper to safely parse float/int from table cell
                def parse_cell(idx, is_int=False):
                    if idx != -1 and idx < len(cells):
                        val_str = cells[idx].get_text(strip=True).replace(',', '')
                        if val_str == "" or val_str == "--" or val_str == "—":
                            return 0.0 if not is_int else 0
                        try:
                            return int(float(val_str)) if is_int else float(val_str)
                        except ValueError:
                            pass
                    return 0.0 if not is_int else 0

                price = parse_cell(col_indices["price"])
                pe = parse_cell(col_indices["pe"])
                market_cap = parse_cell(col_indices["market_cap"]) # In Cr
                roce = parse_cell(col_indices["roce"])
                
                companies.append({
                    "symbol": symbol,
                    "name": name,
                    "price": price,
                    "pe": pe,
                    "market_cap": market_cap,
                    "roce": roce
                })
                
        return {
            "companies": companies,
            "total_pages": total_pages,
            "current_page": page
        }
    except Exception as e:
        return {"error": f"Scraping error: {str(e)}", "companies": [], "total_pages": 1}
