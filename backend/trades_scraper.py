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

def scrape_trades(symbol: str, session_cookie: str = None, company_name: str = None) -> dict:
    """
    Scrapes the insider trades, bulk deals, and block deals of a stock from Screener.in.
    
    Requires session_cookie (format: 'sessionid=xxx' or just 'xxx').
    """
    if not session_cookie:
        return {"error": "Screener.in session cookie is not configured."}
        
    base_symbol = clean_symbol(symbol)
    if not base_symbol:
        return {}
        
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    
    cookies = {}
    if session_cookie:
        cookie_val = session_cookie.strip()
        if "sessionid=" in cookie_val:
            cookie_val = cookie_val.split("sessionid=")[-1].split(";")[0].strip()
        cookies["sessionid"] = cookie_val
        
    # 1. Resolve company ID from suggest search API or company_name
    resolved_id = None
    search_queries = []
    if base_symbol:
        search_queries.append(base_symbol)
    if company_name:
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
                    resolved_id = results[0].get("id")
                    if resolved_id:
                        break
        except Exception as search_err:
            print(f"Screener search suggestion query failed for '{q}': {search_err}")
            
    # Fallback to main company page parsing if Search API did not yield an ID
    if not resolved_id:
        company_url = f"https://www.screener.in/company/{base_symbol}/"
        try:
            res_main = make_screener_request(company_url, headers=headers, timeout=10)
            if res_main.status_code == 200:
                id_match = re.search(r'data-company-id=["\'](\d+)["\']', res_main.text)
                if id_match:
                    resolved_id = id_match.group(1)
        except Exception as fallback_err:
            print(f"Fallback company page scrape failed: {fallback_err}")
            
    if not resolved_id:
        return {"error": "Could not resolve company ID from Screener.in"}
        
    url = f"https://www.screener.in/trades/company-{resolved_id}/"
    try:
        res = make_screener_request(url, headers=headers, cookies=cookies, timeout=15)
        if res.status_code != 200:
            if res.status_code == 404:
                return {"error": f"Trades page not found for symbol {base_symbol}"}
            return {"error": f"Failed to fetch Screener trades page. Status: {res.status_code}"}
            
        is_redirect = False
        if isinstance(res.history, list) and len(res.history) > 0:
            is_redirect = True
        elif isinstance(res.url, str) and "/login/" in res.url:
            is_redirect = True
        elif isinstance(res.text, str) and ("Login to Screener" in res.text or 'name="username"' in res.text):
            is_redirect = True
            
        if is_redirect:
            return {"error": "Screener.in session cookie is invalid or expired."}
            
        soup = BeautifulSoup(res.text, "html.parser")
        result = {
            "symbol": base_symbol,
            "company_id": resolved_id,
            "insider_trades": [],
            "bulk_deals": [],
            "block_deals": [],
            "sast_deals": [],
            "last_updated": datetime_now_str()
        }
        
        # Parse Insider Trades
        insider_section = soup.find('div', id='trades-insider-trades')
        if insider_section:
            table = insider_section.find('table')
            if table:
                current_date = None
                for row in table.find('tbody').find_all('tr'):
                    # Check for grouped date row
                    date_td = row.find('td', colspan='4')
                    if date_td:
                        current_date = date_td.get_text(strip=True)
                        continue
                        
                    cells = row.find_all('td')
                    if len(cells) >= 4:
                        person_cell = cells[0]
                        name_text = ""
                        relation_text = ""
                        br = person_cell.find('br')
                        if br:
                            name_text = person_cell.decode_contents().split('<br')[0].strip()
                            name_text = BeautifulSoup(name_text, "html.parser").get_text(strip=True)
                            relation_span = person_cell.find('span')
                            if relation_span:
                                relation_text = relation_span.get_text(strip=True)
                        else:
                            name_text = person_cell.get_text(strip=True)
                            
                        qty_str = cells[1].get_text(strip=True).replace(',', '')
                        avg_price_str = cells[2].get_text(strip=True).replace(',', '')
                        value_str = cells[3].get_text(strip=True).replace(',', '')
                        
                        is_sell = False
                        if qty_str.startswith('-') or 'down' in cells[1].get('class', []):
                            is_sell = True
                            qty_str = qty_str.replace('-', '')
                            
                        try:
                            qty = int(qty_str)
                        except ValueError:
                            qty = 0
                            
                        try:
                            price = float(avg_price_str)
                        except ValueError:
                            price = 0.0
                            
                        try:
                            val_lacs = float(value_str)
                            value_rupees = int(val_lacs * 100000)
                        except ValueError:
                            value_rupees = 0
                            
                        result["insider_trades"].append({
                            "date": current_date,
                            "person": name_text,
                            "relation": relation_text,
                            "type": "Sell" if is_sell else "Buy",
                            "quantity": qty,
                            "price": price,
                            "value": value_rupees
                        })
                        
        # Parse Bulk & Block Deals
        for deal_type, div_id in [("bulk_deals", "trades-bulk-deals"), ("block_deals", "trades-block-deals")]:
            section = soup.find('div', id=div_id)
            if section:
                table = section.find('table')
                if table:
                    current_date = None
                    for row in table.find('tbody').find_all('tr'):
                        date_td = row.find('td', colspan='4')
                        if date_td:
                            current_date = date_td.get_text(strip=True)
                            continue
                            
                        cells = row.find_all('td')
                        if len(cells) >= 4:
                            person_cell = cells[0]
                            name_text = person_cell.get_text(strip=True)
                            
                            action_text = cells[1].get_text(strip=True).upper()
                            is_sell = any(k in action_text for k in ["SELL", "SALE", "S"])
                            
                            qty_str = cells[2].get_text(strip=True).replace(',', '')
                            price_str = cells[3].get_text(strip=True).replace(',', '')
                            
                            try:
                                qty = int(qty_str)
                            except ValueError:
                                qty = 0
                                
                            try:
                                price = float(price_str)
                            except ValueError:
                                price = 0.0
                                
                            value_rupees = int(qty * price)
                            
                            result[deal_type].append({
                                "date": current_date,
                                "person": name_text,
                                "type": "Sell" if is_sell else "Buy",
                                "quantity": qty,
                                "price": price,
                                "value": value_rupees
                            })
                            
        # Parse SAST Trades
        sast_section = soup.find('div', id='trades-sast-trades')
        if sast_section:
            table = sast_section.find('table')
            if table:
                current_date = None
                for row in table.find('tbody').find_all('tr'):
                    date_td = row.find('td', attrs={"colspan": True})
                    if date_td:
                        current_date = date_td.get_text(strip=True)
                        continue
                        
                    cells = row.find_all('td')
                    if len(cells) >= 5:
                        person_name = cells[0].get_text(strip=True)
                        transaction = cells[1].get_text(strip=True).upper()
                        mode = cells[2].get_text(strip=True)
                        qty_str = cells[3].get_text(strip=True).replace(',', '')
                        percent = cells[4].get_text(strip=True)
                        
                        is_sell = "SALE" in transaction or qty_str.startswith('-') or "PLEDGE" in mode.upper()
                        qty_str = qty_str.replace('-', '')
                        
                        try:
                            qty = int(qty_str)
                        except ValueError:
                            qty = 0
                            
                        # Formulate a descriptive relation
                        rel_parts = []
                        if mode:
                            rel_parts.append(mode)
                        if percent and percent != "--":
                            rel_parts.append(percent)
                            
                        relation_text = " - ".join(rel_parts)
                        
                        result["sast_deals"].append({
                            "date": current_date,
                            "person": person_name,
                            "relation": relation_text,
                            "type": "Sell" if is_sell else "Buy",
                            "quantity": qty,
                            "price": 0.0,
                            "value": 0
                        })
                        
        return result
    except Exception as e:
        return {"error": f"Scraping error: {str(e)}"}

def datetime_now_str() -> str:
    from datetime import datetime
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")
