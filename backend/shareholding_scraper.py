import re
import requests
from bs4 import BeautifulSoup
from backend.financial_utils import make_screener_request

def clean_symbol(symbol: str) -> str:
    """Cleans ticker symbols (e.g. RELIANCE.NS -> RELIANCE)."""
    if not symbol:
        return ""
    # Strip any suffix like .NS or .BO
    parts = symbol.split(".")
    return parts[0].strip().upper()

def scrape_shareholding_pattern(symbol: str, session_cookie: str = None, company_name: str = None) -> dict:
    """
    Scrapes the shareholding pattern of a stock from Screener.in.
    
    If session_cookie is provided (format: 'sessionid=xxx' or just 'xxx'),
    it will attempt to fetch detailed lists of individual promoters, FIIs, DIIs, and public holders.
    """
    base_symbol = clean_symbol(symbol)
    if not base_symbol:
        return {}

    # Attempt local offline resolution to find standard tickers/names
    try:
        from backend.financial_utils import resolve_company_ticker
        resolution = resolve_company_ticker(symbol)
        if resolution:
            base_symbol = resolution.get("base_symbol") or base_symbol
            if not company_name:
                company_name = resolution.get("name")
    except Exception as e:
        print(f"Failed local resolution in shareholding_scraper: {e}")
        
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    
    # Format cookie header if provided
    cookies = {}
    if session_cookie:
        cookie_val = session_cookie.strip()
        if "sessionid=" in cookie_val:
            cookie_val = cookie_val.split("sessionid=")[-1].split(";")[0].strip()
        cookies["sessionid"] = cookie_val
        
    # 1. Resolve URL from Screener Search API to support custom slugs (e.g. TMCV for Tata Motors)
    resolved_path = None
    resolved_id = None
    search_queries = []
    if base_symbol:
        search_queries.append(base_symbol)
    if company_name:
        # Clean company name keywords
        clean_name = company_name.replace("Limited", "").replace("Ltd.", "").replace("Ltd", "").strip()
        if clean_name and clean_name not in search_queries:
            search_queries.append(clean_name)
            
    for q in search_queries:
        search_url = f"https://www.screener.in/api/company/search/?q={requests.utils.quote(q)}"
        try:
            search_res = make_screener_request(search_url, headers=headers, timeout=5)
            if search_res.status_code == 200:
                results = search_res.json()
                if results and len(results) > 0:
                    # Find a close match in the list of search suggestions
                    match_found = False
                    for item in results:
                        url_val = item.get("url", "").lower()
                        name_val = item.get("name", "").lower()
                        q_lower = q.lower()
                        if q_lower in url_val or q_lower in name_val:
                            resolved_path = item.get("url")
                            resolved_id = item.get("id")
                            match_found = True
                            break
                    if not match_found:
                        resolved_path = results[0].get("url")
                        resolved_id = results[0].get("id")
                    if resolved_path:
                        break
        except Exception as search_err:
            print(f"Screener search suggestion query failed for '{q}': {search_err}")
            
    if resolved_path:
        url = f"https://www.screener.in{resolved_path}"
    else:
        url = f"https://www.screener.in/company/{base_symbol}/"
        
    try:
        res = make_screener_request(url, headers=headers, cookies=cookies, timeout=15)
        if res.status_code != 200:
            raise Exception(f"Failed to fetch Screener page. Status: {res.status_code}")
            
        soup = BeautifulSoup(res.text, "html.parser")
        sh_section = soup.find("section", id="shareholding")
        if not sh_section:
            raise Exception("Shareholding section not found in page HTML.")
            
        # Parse quarterly table (usually the first table in section)
        tables = sh_section.find_all("table")
        if not tables:
            raise Exception("No shareholding tables found.")
            
        quarterly_table = tables[0]
        
        # 1. Parse Quarters (headers)
        headers_els = quarterly_table.find("thead").find_all("th")
        quarters = [h.get_text(strip=True) for h in headers_els[1:]]
        
        # 2. Parse Categories
        categories = {}
        rows = quarterly_table.find("tbody").find_all("tr")
        for r in rows:
            cells = r.find_all(["td", "th"])
            if len(cells) > 1:
                cat_name = cells[0].get_text(strip=True).replace("+", "").strip()
                pcts = []
                for c in cells[1:]:
                    val_str = c.get_text(strip=True).replace("%", "").strip()
                    try:
                        pcts.append(float(val_str))
                    except ValueError:
                        pcts.append(0.0)
                categories[cat_name] = pcts
                
        # 3. If logged in, fetch detailed holdings
        detailed = {}
        if cookies.get("sessionid"):
            company_id = resolved_id
            if not company_id:
                company_id_match = re.search(r'data-company-id=["\'](\d+)["\']', res.text)
                if company_id_match:
                    company_id = company_id_match.group(1)
            
            if company_id:
                headers["Referer"] = url
                headers["X-Requested-With"] = "XMLHttpRequest"
                
                category_mapping = {
                    "promoters": "promoters",
                    "foreign_institutions": "fii",
                    "domestic_institutions": "dii",
                    "public": "public"
                }
                
                for c, frontend_key in category_mapping.items():
                    api_url = f"https://www.screener.in/api/3/{company_id}/investors/{c}/quarterly/"
                    try:
                        api_res = make_screener_request(api_url, headers=headers, cookies=cookies, timeout=10)
                        if api_res.status_code == 200:
                            api_data = api_res.json()
                            if api_data:
                                cat_details = {}
                                for holder_name, quarterly_values in api_data.items():
                                    parsed_vals = {}
                                    for q, val in quarterly_values.items():
                                        if q != "setAttributes" and val:
                                            try:
                                                parsed_vals[q] = float(val.replace("%", "").strip())
                                            except ValueError:
                                                parsed_vals[q] = 0.0
                                    if parsed_vals:
                                        cat_details[holder_name] = parsed_vals
                                if cat_details:
                                    detailed[frontend_key] = cat_details
                    except Exception as api_err:
                        print(f"Failed to fetch detailed list for {c}: {api_err}")
                        
        return {
            "symbol": base_symbol,
            "quarters": quarters,
            "categories": categories,
            "detailed": detailed,
            "last_updated": datetime_now_str()
        }
    except Exception as e:
        print(f"Screener shareholding scrape failed for {symbol}: {e}. Attempting yfinance fallback...")
        try:
            return scrape_yfinance_shareholding_fallback(symbol)
        except Exception as yf_err:
            print(f"yfinance fallback also failed for {symbol}: {yf_err}")
            return {"error": f"Scraping error: {str(e)} (yfinance fallback error: {str(yf_err)})"}


def scrape_yfinance_shareholding_fallback(symbol: str) -> dict:
    """
    Fallback data resolver using yfinance when Screener.in blocks connections or is down.
    Resolves the promoter, institutional, and public holder percentages.
    """
    import yfinance as yf
    import pandas as pd
    from datetime import datetime
    
    base_symbol = symbol.split(".")[0].strip().upper()
    yf_ticker = symbol.upper()
    if not (yf_ticker.endswith(".NS") or yf_ticker.endswith(".BO")):
        yf_ticker = f"{base_symbol}.NS"
        
    stock = yf.Ticker(yf_ticker)
    
    # Defaults
    promoters_pct = 0.0
    institutions_pct = 0.0
    
    try:
        mh = stock.major_holders
        if mh is not None and not mh.empty:
            if "insidersPercentHeld" in mh.index:
                val = mh.loc["insidersPercentHeld", "Value"]
                promoters_pct = round(float(val) * 100.0, 2)
            if "institutionsPercentHeld" in mh.index:
                val = mh.loc["institutionsPercentHeld", "Value"]
                institutions_pct = round(float(val) * 100.0, 2)
    except Exception as e:
        print(f"Error reading yfinance major_holders: {e}")
        
    public_pct = round(max(0.0, 100.0 - promoters_pct - institutions_pct), 2)
    
    now = datetime.now()
    current_q = now.strftime("%b %Y")
    
    categories = {
        "Promoters": [promoters_pct],
        "FIIs": [round(institutions_pct / 2, 2)],
        "DIIs": [round(institutions_pct / 2, 2)],
        "Public": [public_pct]
    }
    
    return {
        "symbol": base_symbol,
        "quarters": [current_q],
        "categories": categories,
        "detailed": {},
        "last_updated": now.strftime("%Y-%m-%d %H:%M:%S")
    }

def datetime_now_str() -> str:
    from datetime import datetime
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")
