# Event Calendar & Deals Sweep Integration Plan (Constrained/Refined)

This plan outlines how to integrate the existing **Corporate Event Calendar** and **Deals Sweep** features into the **Daily Closing Wrap-Up** WhatsApp alert and main dashboard under the specific constraints of an Oracle Cloud VM deployment and Meta's WhatsApp API.

---

## 🛑 Infrastructure & Platform Constraints

1. **Oracle Cloud VM & Rate-Limiting**:
   - External data providers (NSE India, Yahoo Finance, Screener.in) heavily rate-limit or ban cloud VM IPs (returning HTTP `403` or `429`).
   - The backend runs a cache-first architecture. Any real-time scraping of trades or calendar events during alert generation at 4:00 PM IST is highly risky and must be avoided.
2. **WhatsApp (Meta Cloud API) Constraints**:
   - Maximum text length is 4096 characters.
   - Mobile screens display a "Read More" cutoff if the vertical length is too long, reducing readability.
   - HTML/CSS are not supported; formatting relies on emojis and simple markdown.

---

## 💡 Refined Recommendations

To respect these constraints, we propose the following implementation choices:

### 1. Cache-Only Evaluation
- **No live API fetches** will be triggered when constructing the daily wrap-up message. The pipeline will strictly read from the `stock_events` and `cached_trades` SQLite tables in `watchlist_database.db`, which are updated in the background.

### 2. Portfolio-Centric Details (Watchlist Summarized)
- Detailed event lists and promoter deal highlights will be displayed **exclusively for active portfolio holdings** (which is a small, high-priority set, e.g., 5-15 stocks).
- Watchlist stocks will be aggregated into a single, compact summary line to save characters and prevent database overhead (e.g., `👀 Watchlist: 2 upcoming results, 0 recent insider trades`).

### 3. Timeframes & Strict Caps
- **Upcoming Events Calendar**: Lookahead of **7 days** (to catch earnings/dividends in advance). Max items capped at **3** (prioritized by closest date).
- **Insider Deals Sweep**: Lookback of **3 days** (to catch recent catalyst trades). Max items capped at **3** (prioritized by highest value in INR).
- If more events or deals exist, format a compact line: `• ...and X other portfolio events.`

---

## 🚀 Advanced Operational Recommendations

To elevate the robustness and value of this integration, we recommend implementing the following enhancements:

### A. AI Portfolio Doctor Synchronization
- Inject corporate events and recent promoter transactions into the **AI Portfolio Doctor** analysis prompts. This allows the portfolio diagnostic logic to detect critical structural anomalies, such as warning the user if a portfolio company has upcoming earnings and the promoters are actively selling down their stakes.

### B. Pre-Alert Cache Warm Up
- Set the background scraping task schedule to execute a sweep at **3:00 PM IST** (one hour prior to the wrap-up dispatch). This refreshes the local SQLite cache with the afternoon's corporate announcements and large block deals, ensuring that the 4:00 PM wrap-up is populated with fresh, current data.

### C. Proactive Cookie Diagnostics
- Render a warning badge (e.g. `⚠️ Deals Scanner Offline: Cookie Expired`) on the Alerts Tab UI if the Screener.in session cookie fails authentication diagnostics. This provides immediate visibility and lets the user refresh their cookie before the 4:00 PM alert runs.

---

## Proposed Changes

### Backend Implementation

#### [MODIFY] [daily_wrapup.py](file:///c:/Users/dheer/Desktop/AI/indian-stock-analyzer/backend/daily_wrapup.py)

- Implement a helper `fetch_upcoming_events_summary(portfolio_symbols: list, watchlist_symbols: list) -> dict`:
  - Query cached events in `stock_events` for `[today, today + 7 days]`.
  - Compile up to **3** portfolio events: `• TICKER: Event Type (Date)` (e.g., `• HDFCBANK: quarterly_results (08-Jul)`).
  - Compute a count of upcoming watchlist events.
  - Return a dictionary containing the formatted portfolio events string and the watchlist summary count.
- Implement a helper `fetch_recent_deals_summary(portfolio_symbols: list, watchlist_symbols: list) -> dict`:
  - Query cached trades in `cached_trades` for the last **3 days**.
  - Filter for portfolio transactions exceeding ₹10 Lakhs.
  - Group by ticker, sort by descending value, and take the top **3** items.
  - Format: `• TICKER: Promoter [Buy/Sell] of Rs. X [Qty @ Price]`
  - Compute watchlist matches as a summary count.
  - Return a dictionary with the formatted portfolio deals string and the watchlist summary count.
- Update `generate_daily_wrapup_text(persona_override: str = None)`:
  - Extract settings toggles `daily_wrapup_include_events` and `daily_wrapup_include_deals`.
  - Fetch portfolio symbols from `compute_active_holdings()`.
  - Generate the text blocks and feed them into the LLM context prompt for AI commentary.
  - Append the text sections to the final WhatsApp message payload.

#### [MODIFY] [main.py](file:///c:/Users/dheer/Desktop/AI/indian-stock-analyzer/backend/main.py)

- Seeding the new config values in `init_db()`:
  - `daily_wrapup_include_events`: `"true"` (default)
  - `daily_wrapup_include_deals`: `"true"` (default)
- Update settings endpoints `GET /api/alerts/daily-wrapup/settings` and `POST /api/alerts/daily-wrapup/settings` to expose and persist these toggles.

---

### Frontend Cockpit

#### [MODIFY] [index.html](file:///c:/Users/dheer/Desktop/AI/indian-stock-analyzer/backend/static/index.html)
- Insert UI checkboxes `#wrapup-include-events` and `#wrapup-include-deals` into the Daily Closing Wrap-Up cockpit card.

#### [MODIFY] [app.js](file:///c:/Users/dheer/Desktop/AI/indian-stock-analyzer/backend/static/app.js)
- Bind the UI checkboxes to the configuration payload in `fetchDailyWrapupSettings()` and `setupDailyWrapupListeners()`.

---

## WhatsApp Alert Formatting Mockup

Here is how the enhanced sections will render in the final message:

```text
════════════════════════
📈 APEX EQUITIES WORKSTATION
📅 Daily Close Wrap-Up | July 05, 2026
════════════════════════

... (Indices, Portfolio P&L, Sector Momentum, Watchlist Status) ...

📅 *6. UPCOMING PORTFOLIO EVENTS*
• HDFCBANK: quarterly_results (08-Jul) - Est. EPS: ₹24.50
• TCS: dividend (10-Jul) - Yield: 1.8% (₹28.00)
• ...and 2 other portfolio events.
• _Watchlist summary: 3 upcoming earnings/dividends scheduled._

🤝 *7. PORTFOLIO INSIDER FLOWS*
• INFY: Promoter Buy of Rs. 45.00 L (3,000 shares @ ₹1,500)
• TATAMOTORS: Promoter Buy of Rs. 1.20 Cr (15,000 shares @ ₹800)
• _Watchlist summary: 0 recent promoter deals detected._

🤖 *AI COPILOT BRIEFING* (Institutional)
_Nifty held technical support despite sector rotation. Promoters increased accumulation in Auto and IT, while upcoming earnings in HDFCBANK provide a near-term catalyst._
────────────────────────
_APEX AI Workstation Client Portal_
```

---

## Verification Plan

### Automated Tests
- Append unit tests to `backend/test_models.py` inside `TestWhatsAppDailyWrapup` to verify event and deal rendering logic.
- Run tests: `python -m backend.test_models`

### Manual Verification
- Save settings through the cockpit UI and ensure toggles persist on reload.
- Trigger an on-demand wrap-up and confirm that the preview modal and WhatsApp notification display the structured text blocks without overflow or formatting glitches.
