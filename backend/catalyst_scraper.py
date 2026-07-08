import os
import requests
import urllib.parse
from bs4 import BeautifulSoup

def fetch_latest_news_for_query(
    query: str, 
    timeframe: str = "7d", 
    use_tavily: bool = False, 
    use_serpapi: bool = False
) -> tuple[list[str], str]:
    """
    Fetch news snippets from multiple search endpoints in priority order,
    complying with user authorization toggles.
    
    Returns a tuple of (snippets_list, provider_name).
    """
    timeframe_map_qdr = {
        "1d": "d",
        "5d": "d5",
        "7d": "w",
        "14d": "w2",
        "30d": "m",
        "1m": "m",
        "3m": "m3",
        "6m": "m6",
        "1y": "y",
        "5y": "y5",
        "ytd": "ytd"
    }
    qdr = timeframe_map_qdr.get(timeframe.lower().strip(), "w")
    
    # Get all configured API keys
    serpapi_key = os.environ.get("SERPAPI_API_KEY", "")
    tavily_key = os.environ.get("TAVILY_API_KEY", "")

    # 1. TIER 1: SerpApi (If toggled ON and Key configured)
    if use_serpapi and serpapi_key:
        try:
            print(f"[Catalyst Scraper] Querying SerpApi for: {query}")
            encoded_query = urllib.parse.quote(query)
            tbs = f"qdr:{qdr}"
            url = f"https://serpapi.com/search.json?engine=google&q={encoded_query}&api_key={serpapi_key}&tbs={tbs}"
            r = requests.get(url, timeout=20.0)
            if r.status_code == 200:
                data = r.json()
                ai_overview = data.get("ai_overview", {})
                if ai_overview:
                    text = ai_overview.get("text", "")
                    if text:
                        print("[Catalyst Scraper] SerpApi SGE successfully returned AI Overview.")
                        # Return overview as a singular high-fidelity snapshot
                        return [f"Google AI Overview: {text}"], "SerpApi AI Overview"
                
                # Fallback: Parse organic snippets if no AI Overview exists
                organic_results = data.get("organic_results", [])
                snippets = []
                for item in organic_results[:6]:
                    title = item.get("title", "")
                    snippet = item.get("snippet", "")
                    if title or snippet:
                        snippets.append(f"Title: {title}\nSnippet: {snippet}")
                if snippets:
                    print(f"[Catalyst Scraper] SerpApi successfully returned {len(snippets)} organic snippets.")
                    return snippets, "SerpApi Search"
        except Exception as e:
            print(f"[Catalyst Scraper] SerpApi query failed: {e}. Moving to next tier.")

    # 2. TIER 2: Tavily Search API (If toggled ON and Key configured)
    if use_tavily and tavily_key:
        try:
            print(f"[Catalyst Scraper] Querying Tavily AI Search for: {query}")
            payload = {
                "api_key": tavily_key,
                "query": query,
                "search_depth": "basic",
                "max_results": 5
            }
            r = requests.post("https://api.tavily.com/search", json=payload, timeout=6.0)
            if r.status_code == 200:
                data = r.json()
                snippets = []
                for item in data.get("results", []):
                    title = item.get("title", "")
                    content = item.get("content", "")
                    if title or content:
                        snippets.append(f"Title: {title}\nSnippet: {content}")
                if snippets:
                    print(f"[Catalyst Scraper] Tavily successfully returned {len(snippets)} snippets.")
                    return snippets, "Tavily Search"
        except Exception as e:
            print(f"[Catalyst Scraper] Tavily search failed: {e}. Moving to next tier.")

    # 3. TIER 3: Free Google News RSS feed (Fallback)
    try:
        # Translate timeframe to Google News 'when' parameter
        rss_query = f"{query} when:{timeframe}"
        encoded_query = urllib.parse.quote(rss_query)
        rss_url = f"https://news.google.com/rss/search?q={encoded_query}&hl=en-IN&gl=IN&ceid=IN:en"
        print(f"[Catalyst Scraper] Querying free Google News RSS for: {rss_query}")
        
        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
        }
        r = requests.get(rss_url, headers=headers, timeout=6.0)
        if r.status_code == 200:
            soup = BeautifulSoup(r.content, "html.parser")
            items = soup.find_all("item")
            snippets = []
            for item in items[:8]:
                title = item.find("title").text if item.find("title") else ""
                description = item.find("description").text if item.find("description") else ""
                clean_desc = ""
                if description:
                    clean_desc = BeautifulSoup(description, "html.parser").get_text()
                pub_date = item.find("pubdate").text if item.find("pubdate") else ""
                
                if title:
                    snippets.append(f"Title: {title}\nDate: {pub_date}\nSnippet: {clean_desc}")
            if snippets:
                print(f"[Catalyst Scraper] Google News RSS successfully returned {len(snippets)} snippets.")
                return snippets, "Google News RSS"
    except Exception as e:
        print(f"[Catalyst Scraper] Google News RSS failed: {e}")
        
    return [], "None"
