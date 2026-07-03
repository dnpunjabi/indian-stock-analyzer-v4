import requests
from bs4 import BeautifulSoup
import re

def clean_label(label: str) -> str:
    # Remove trailing plus and whitespace
    label = re.sub(r'\s*\+\s*$', '', label)
    # Replace multiple spaces with single space
    label = re.sub(r'\s+', ' ', label)
    return label.strip()

def clean_value(val_str: str):
    val_str = val_str.strip().replace(",", "")
    if not val_str or val_str == "" or val_str == "--" or val_str == "N/A":
        return None
    try:
        # Check if percentage
        if "%" in val_str:
            val_str = val_str.replace("%", "")
            return float(val_str)
        if "." in val_str:
            return float(val_str)
        return int(val_str)
    except ValueError:
        return val_str

def parse_screener_table(table_el) -> dict:
    if not table_el:
        return {"headers": [], "rows": []}
        
    headers_cells = table_el.find_all("th")
    headers = [th.text.strip() for th in headers_cells]
    
    rows = []
    tbody = table_el.find("tbody")
    tr_elements = tbody.find_all("tr") if tbody else table_el.find_all("tr")[1:]
    
    for tr in tr_elements:
        cells = tr.find_all(["td", "th"])
        if not cells:
            continue
        label = clean_label(cells[0].text)
        if not label:
            continue
            
        values = [clean_value(c.text) for c in cells[1:]]
        # Skip empty rows (e.g. divider rows)
        if all(v is None for v in values) and len(values) > 0:
            continue
            
        rows.append({
            "label": label,
            "values": values
        })
        
    return {
        "headers": headers,
        "rows": rows
    }

def parse_screener_peers_table(table_el) -> dict:
    if not table_el:
        return {"headers": [], "rows": []}
        
    headers_cells = table_el.find_all("th")
    headers = [th.text.strip() for th in headers_cells]
    
    # Clean headers: remove S.No or blank first column
    if len(headers) > 1 and (headers[0] == "" or "s.no" in headers[0].lower()):
        headers = headers[1:]
        
    rows = []
    tbody = table_el.find("tbody")
    tr_elements = tbody.find_all("tr") if tbody else table_el.find_all("tr")[1:]
    
    for tr in tr_elements:
        cells = tr.find_all(["td", "th"])
        if len(cells) < 2:
            continue
            
        # If cells[0] is just a digit (serial number), then cells[1] is the company name
        c0_text = cells[0].text.strip().rstrip(".")
        if len(cells) > 2 and c0_text.isdigit():
            label = clean_label(cells[1].text)
            values = [clean_value(c.text) for c in cells[2:]]
        else:
            label = clean_label(cells[0].text)
            values = [clean_value(c.text) for c in cells[1:]]
            
        if not label:
            continue
            
        rows.append({
            "label": label,
            "values": values
        })
        
    return {
        "headers": headers,
        "rows": rows
    }

def scrape_financial_statements(symbol: str, view: str = "consolidated") -> dict:
    """
    Scrapes the Quarterly Results, annual Profit & Loss, and Balance Sheet statements
    from Screener.in without requiring any cookies.
    
    If 'view' is 'consolidated', it will target the /consolidated/ path on Screener.
    If it's 'standalone', it will target the default path.
    If the requested view is not available, it fallbacks automatically.
    """
    # 1. Resolve ticker symbol and name using our offline database first
    base_symbol = symbol.split(".")[0].strip().upper()
    company_name = None
    
    try:
        from backend.financial_utils import resolve_company_ticker
        resolution = resolve_company_ticker(symbol)
        if resolution:
            base_symbol = resolution.get("base_symbol") or base_symbol
            company_name = resolution.get("name")
    except Exception as e:
        print(f"Local ticker resolution failed in financial_statements_scraper: {e}")

    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }

    # 2. Resolve URL path using Screener's API search suggestion
    resolved_path = None
    search_queries = [base_symbol]
    if company_name:
        clean_name = company_name.replace("Limited", "").replace("Ltd.", "").replace("Ltd", "").strip()
        if clean_name and clean_name not in search_queries:
            search_queries.append(clean_name)
            
    for q in search_queries:
        search_url = f"https://www.screener.in/api/company/search/?q={requests.utils.quote(q)}"
        try:
            search_res = requests.get(search_url, headers=headers, timeout=5)
            if search_res.status_code == 200:
                results = search_res.json()
                if results and len(results) > 0:
                    for item in results:
                        url_val = item.get("url", "").lower()
                        name_val = item.get("name", "").lower()
                        q_lower = q.lower()
                        if q_lower in url_val or q_lower in name_val:
                            resolved_path = item.get("url")
                            break
                    if not resolved_path:
                        resolved_path = results[0].get("url")
                    if resolved_path:
                        break
        except Exception as search_err:
            print(f"Screener search suggest query failed in financial_statements_scraper for '{q}': {search_err}")

    # Remove trailing slash if present to make URL construction clean
    if resolved_path:
        base_path = resolved_path.rstrip("/")
        # If search suggest returned a consolidated path, extract the base slug
        if "/consolidated" in base_path:
            base_path = base_path.replace("/consolidated", "")
    else:
        base_path = f"/company/{base_symbol}"

    # Build URLs
    if view == "consolidated":
        url = f"https://www.screener.in{base_path}/consolidated/"
    else:
        url = f"https://www.screener.in{base_path}/"

    try:
        response = requests.get(url, headers=headers, timeout=12)
        
        # Fallback if consolidated returns 404 or redirects back to the main standalone profile page
        if view == "consolidated" and (response.status_code != 200 or len(response.history) > 0):
            fallback_url = f"https://www.screener.in{base_path}/"
            response = requests.get(fallback_url, headers=headers, timeout=12)
            
        if response.status_code != 200:
            return {"error": f"Failed to retrieve Screener financials. Status: {response.status_code}"}
            
        soup = BeautifulSoup(response.text, "html.parser")
        
        # Check actual consolidated state of the page we parsed
        p_text = ""
        quarters_sec = soup.find("section", id="quarters")
        if quarters_sec:
            p_el = quarters_sec.find("p")
            if p_el:
                p_text = p_el.text.strip()
        actual_is_consolidated = "consolidated figures" in p_text.lower()
        
        # Parse the company_id from main page to call peers API
        company_id_match = re.search(r'data-company-id=["\'](\d+)["\']', response.text)
        company_id = company_id_match.group(1) if company_id_match else None
        
        peers_table_el = None
        if company_id:
            try:
                peers_url = f"https://www.screener.in/api/company/{company_id}/peers/"
                peers_res = requests.get(peers_url, headers={"User-Agent": "Mozilla/5.0"}, timeout=10)
                if peers_res.status_code == 200:
                    peers_soup = BeautifulSoup(peers_res.text, "html.parser")
                    peers_table_el = peers_soup.find("table")
            except Exception as e:
                print(f"Error fetching peers API: {e}")
                
        return {
            "symbol": symbol,
            "resolved_symbol": base_symbol,
            "is_consolidated": actual_is_consolidated,
            "quarters": parse_screener_table(soup.find("section", id="quarters").find("table") if soup.find("section", id="quarters") else None),
            "profit_loss": parse_screener_table(soup.find("section", id="profit-loss").find("table") if soup.find("section", id="profit-loss") else None),
            "balance_sheet": parse_screener_table(soup.find("section", id="balance-sheet").find("table") if soup.find("section", id="balance-sheet") else None),
            "peers": parse_screener_peers_table(peers_table_el)
        }
    except Exception as err:
        return {"error": f"Exception occurred while scraping financials: {str(err)}"}
