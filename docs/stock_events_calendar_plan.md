# 📅 Stock Events Calendar — Final Implementation Plan

## Overview

Build an **enterprise-grade "Stock Events Calendar"** feature that fetches and displays upcoming corporate events — quarterly results, dividends, bonuses, stock splits, and board meetings — for both **individual stocks** and as a **market-wide calendar view**.

### Quality Standards
- ✅ **Interactive & Dynamic** — Animated transitions, hover effects, live countdown timers, skeleton loaders
- ✅ **Enterprise-grade** — Exponential backoff, graceful degradation, error boundaries, structured logging
- ✅ **Fully responsive** — Mobile browser + Capacitor app, fluid layouts from 320px to 2560px
- ✅ **Light & Dark themes** — Full CSS variable theming using existing `var(--*)` design tokens
- ✅ **Accessibility** — ARIA labels, keyboard navigation, semantic HTML

---

## Data Source Strategy (Oracle Cloud VM Optimized)

> [!IMPORTANT]
> Since the app is hosted on an **Oracle Cloud VM**, cloud/datacenter IPs face aggressive rate-limiting from Indian financial APIs (especially NSE). The strategy below is designed to work safely within these constraints.

### Source Priority & Usage Pattern

| Priority | Source | Usage | Fetch Frequency | Risk Level |
|---|---|---|---|---|
| 🥇 Primary | **yfinance `.calendar` + `.info`** | Per-stock earnings, dividends, splits | On stock profile load (already working on VM) | 🟢 Low |
| 🥈 Secondary | **NSE Board Meetings API** | Market-wide quarterly results dates | 2x daily (6 AM, 6 PM IST) | 🟡 Medium |
| 🥉 Secondary | **NSE Corporate Actions API** | Market-wide dividends, bonuses, splits | 2x daily (6 AM, 6 PM IST) | 🟡 Medium |
| 🔄 Fallback | **SQLite cached stale data** | Serve last known events if sources fail | Always available | 🟢 None |

### Rate Limiting & Safety Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                    REQUEST FLOW                              │
│                                                              │
│  User Request ──→ SQLite Cache ──→ Fresh? ──→ Serve cached   │
│                                      │                       │
│                                      └── Stale? ───┐        │
│                                                     ▼        │
│                                   Background refresh job     │
│                                   (3-5s delay between reqs)  │
│                                           ↓                  │
│                                   yfinance first             │
│                                   NSE APIs second            │
│                                           ↓                  │
│                                   403? → Exponential backoff │
│                                   (15min → 1hr → 6hr → 24hr)│
│                                           ↓                  │
│                                   Store in SQLite            │
│                                   (12-24 hour TTL)           │
└──────────────────────────────────────────────────────────────┘
```

**Safeguards for Oracle Cloud VM:**

| Safeguard | Implementation |
|---|---|
| Cache-first architecture | All user requests served from SQLite, never real-time API calls |
| 2x/day batch fetch | NSE APIs called only at 6 AM and 6 PM IST |
| 3-5s request pacing | Delay between consecutive NSE requests |
| Rotating User-Agents | Pool of 5-6 browser UA strings |
| Session cookie refresh | Visit `nseindia.com` homepage before each batch |
| Exponential backoff | 403/429 → 15min → 1hr → 6hr → 24hr wait |
| Graceful degradation | NSE fails → yfinance still works per-stock |
| Stale data serving | Last cached events served even if all sources fail |

---

## Verified API Responses

### NSE Board Meetings (✅ 200 OK)

**Endpoint:** `GET https://www.nseindia.com/api/corporate-board-meetings?index=equities`

```json
{
  "bm_symbol": "PLASTIBLEN",
  "bm_date": "13-Jul-2026",
  "bm_purpose": "Financial Results",
  "bm_desc": "To consider and approve the financial results for Q1 FY27",
  "sm_name": "Plastiblends India Limited",
  "attachment": "https://nsearchives.nseindia.com/corporate/..."
}
```

### NSE Corporate Actions (✅ 200 OK)

**Endpoint:** `GET https://www.nseindia.com/api/corporates-corporateActions?index=equities`

```json
{
  "symbol": "CANFINHOME",
  "comp": "Can Fin Homes Limited",
  "exDate": "03-Jul-2026",
  "subject": "Dividend - Rs 8 Per Share",
  "recDate": "03-Jul-2026"
}
```

### Yahoo Finance Calendar (✅ Working on VM)

```python
ticker.calendar → {
  'Ex-Dividend Date': datetime.date(2026, 6, 5),
  'Earnings Date': [datetime.date(2026, 7, 17)],
  'Earnings Average': 16.87
}
ticker.info → {
  'exDividendDate': 1780617600,
  'earningsTimestampStart': 1784282400,
  'lastSplitDate': 1730073600,
  'dividendRate': 6.0
}
```

---

## Backend Architecture

### [NEW] `backend/events_scraper.py`

| Function | Source | Purpose |
|---|---|---|
| `fetch_stock_events(symbol)` | yfinance | Per-stock: earnings, ex-div, split history |
| `fetch_nse_board_meetings()` | NSE API | Market-wide: upcoming board meetings & results |
| `fetch_nse_corporate_actions()` | NSE API | Market-wide: dividends, bonuses, splits |
| `aggregate_market_events()` | All | Combine, deduplicate, normalize |
| `background_events_refresh()` | Internal | Scheduled 2x/day with rate limiting |
| `_create_nse_session()` | Internal | Session with cookies, UA rotation, pacing |

**Unified Event Schema:**
```python
{
    "symbol": "RELIANCE",
    "company_name": "Reliance Industries",
    "event_type": "quarterly_results",  # dividend | bonus | split | board_meeting
    "event_date": "2026-07-17",
    "description": "Q1 FY27 Results",
    "details": {
        "dividend_amount": null,
        "split_ratio": null,
        "earnings_estimate": 16.87
    },
    "source": "yfinance",
    "fetched_at": "2026-07-03T15:00:00Z",
    "countdown_days": 14
}
```

### [NEW] SQLite Table: `stock_events`

```sql
CREATE TABLE IF NOT EXISTS stock_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    symbol TEXT NOT NULL,
    company_name TEXT,
    event_type TEXT NOT NULL,
    event_date TEXT NOT NULL,
    description TEXT,
    details_json TEXT,
    source TEXT DEFAULT 'nse',
    fetched_at TEXT NOT NULL,
    UNIQUE(symbol, event_type, event_date)
);
CREATE INDEX IF NOT EXISTS idx_events_date ON stock_events(event_date);
CREATE INDEX IF NOT EXISTS idx_events_symbol ON stock_events(symbol);
```

### [MODIFY] `backend/main.py`

| Endpoint | Method | Description |
|---|---|---|
| `GET /api/events/calendar` | GET | Market-wide events (`?days=30&type=all`) |
| `GET /api/events/stock/{symbol}` | GET | Per-stock upcoming events |
| `POST /api/events/refresh` | POST | Admin: force background refresh |

Startup: register `background_events_refresh()` in existing scheduler.

---

## Frontend Architecture

### Design System Integration

All UI components will use the existing CSS variable system for seamless light/dark theme support:

```css
/* Leverages existing design tokens */
--bg-glass, --bg-glass-card       /* Card backgrounds */
--border-glass                     /* Borders */
--text-primary, --text-secondary   /* Typography */
--color-primary, --color-emerald   /* Accent colors */
--color-primary-glow               /* Hover/glow effects */
```

**New event-type color tokens:**
```css
--event-results:   rgba(59, 130, 246, 0.8)    /* Blue — quarterly results */
--event-dividend:  rgba(16, 185, 129, 0.8)    /* Green — dividends */
--event-bonus:     rgba(245, 158, 11, 0.8)    /* Amber — bonus */
--event-split:     rgba(168, 85, 247, 0.8)    /* Purple — splits */
--event-meeting:   rgba(107, 114, 128, 0.8)   /* Gray — board meetings */
```

---

### Component 1: Per-Stock Events Card (Stock Profile)

**Location:** Inside the stock analysis page, after existing cards

**Interactive Features:**
- 🔄 Skeleton loader during fetch (pulse animation)
- ⏳ Live countdown timer ("in 14 days", updates every minute)
- 🎯 Color-coded event type badges with glow on hover
- 📱 Stacks vertically on mobile, 2-column grid on desktop
- 🌗 Full light/dark theme support via CSS variables
- ✨ Slide-in animation on card appearance

```
┌──────────────────────────────────────────────────────────┐
│ 📅 UPCOMING EVENTS                    🔄 Last: 2h ago   │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ┌────────────────────────┐  ┌────────────────────────┐  │
│  │ 📊 Q1 FY27 Results     │  │ 💰 Ex-Dividend         │  │
│  │ Jul 17, 2026           │  │ Jun 05, 2026           │  │
│  │ ⏳ in 14 days          │  │ ✅ Passed              │  │
│  │ Est. EPS: ₹16.87       │  │ ₹6.00 per share       │  │
│  └────────────────────────┘  └────────────────────────┘  │
│                                                          │
│  ┌────────────────────────┐  ┌────────────────────────┐  │
│  │ ✂️ Last Stock Split    │  │ 💰 Dividend Yield      │  │
│  │ Oct 28, 2024           │  │ 0.46%                  │  │
│  │ 2:1 Split              │  │ Annual Rate: ₹6.00     │  │
│  │ ✅ Completed           │  │ 5Y Avg: 0.44%          │  │
│  └────────────────────────┘  └────────────────────────┘  │
│                                                          │
└──────────────────────────────────────────────────────────┘

Mobile (< 480px): Single column, full-width cards
```

---

### Component 2: Market-Wide Events Calendar Tab

**Location:** New subtab "📅 Events" in the main navigation bar

**Interactive Features:**
- 🔍 Real-time search filter (type-to-search company names)
- 🏷️ Animated filter pills with active state glow
- 📊 Sortable columns (date, company, type) with sort indicators
- ⭐ "Watchlist Only" toggle to filter personal stocks
- 📅 Date range selector (7d / 30d / 90d / Custom)
- 📱 Card-based layout on mobile, table on desktop
- 🌗 Full light/dark theme via CSS variables
- ✨ Row hover effects with glassmorphism highlight
- 🔄 Skeleton loading state with shimmer animation
- 📊 Summary stats bar ("12 results, 5 dividends, 3 bonuses upcoming")

**Desktop Layout (≥768px):**
```
┌────────────────────────────────────────────────────────────────┐
│ 📅 STOCK EVENTS CALENDAR                                      │
│                                                                │
│ ┌──────────────────────────────────────────────────────────┐   │
│ │ 🔍 Search company...        [7d] [30d] [90d] [Custom]   │   │
│ └──────────────────────────────────────────────────────────┘   │
│                                                                │
│ [All] [📊 Results] [💰 Dividends] [🎁 Bonus] [✂️ Splits]      │
│ [⭐ Watchlist Only]                                            │
│                                                                │
│ 📊 Summary: 28 events | 12 Results | 8 Dividends | 5 Bonus    │
│                                                                │
│ ┌──────┬────────────────────────┬──────────┬────────────────┐  │
│ │ Date │ Company                │ Type     │ Details        │  │
│ ├──────┼────────────────────────┼──────────┼────────────────┤  │
│ │Jul 7 │ TCS                    │📊 Results│ Q1 Board Meet  │  │
│ │Jul 10│ Infosys                │📊 Results│ Q1 Board Meet  │  │
│ │Jul 15│ HDFC Bank              │💰 Div    │ ₹19.50/share   │  │
│ │Jul 17│ Reliance Industries    │📊 Results│ Q1 Board Meet  │  │
│ │Jul 22│ Bajaj Finance          │🎁 Bonus  │ 1:2 Bonus      │  │
│ └──────┴────────────────────────┴──────────┴────────────────┘  │
│                                                                │
│                  [Load More Events ↓]                          │
└────────────────────────────────────────────────────────────────┘
```

**Mobile Layout (< 480px):**
```
┌────────────────────────────────────┐
│ 📅 STOCK EVENTS                    │
│                                    │
│ 🔍 Search...        [30d ▼]       │
│                                    │
│ [All][📊][💰][🎁][✂️] ← scrollable│
│                                    │
│ ┌────────────────────────────────┐ │
│ │ 📊 TCS              Jul 7     │ │
│ │ Q1 FY27 Results   ⏳ 4 days   │ │
│ └────────────────────────────────┘ │
│ ┌────────────────────────────────┐ │
│ │ 📊 Infosys          Jul 10    │ │
│ │ Q1 FY27 Results   ⏳ 7 days   │ │
│ └────────────────────────────────┘ │
│ ┌────────────────────────────────┐ │
│ │ 💰 HDFC Bank        Jul 15    │ │
│ │ Dividend ₹19.50   ⏳ 12 days  │ │
│ └────────────────────────────────┘ │
│                                    │
│        [Load More Events ↓]       │
└────────────────────────────────────┘
```

---

### Interactive & Dynamic Elements

| Element | Implementation |
|---|---|
| **Skeleton loader** | CSS shimmer animation on card placeholders during API fetch |
| **Countdown timer** | JS `setInterval` updating "in X days" badges every 60s |
| **Filter pills** | Animated background transition on click, glow effect on active |
| **Sort indicators** | Arrow rotation animation on column header click |
| **Row hover** | Glassmorphism highlight with subtle scale transform |
| **Card entrance** | `@keyframes slideUp` with staggered delay per card |
| **Empty state** | Illustrated "No upcoming events" with subtle pulse animation |
| **Error state** | Retry button with spin animation, fallback message |
| **Pull to refresh** | Touch gesture on mobile to trigger refresh |
| **Badge pulse** | Upcoming events within 3 days get a pulse glow animation |

### Responsive Breakpoints

| Breakpoint | Layout |
|---|---|
| **≥1024px** | Full table view, 2-column event cards, side filters |
| **768px-1023px** | Compact table, stacked filters above table |
| **480px-767px** | Card-based layout, horizontal filter pill scroll |
| **< 480px** | Full-width stacked cards, compact filter dropdown |

---

## Implementation Phases

### Phase 1: Backend Data Pipeline
- [ ] Create `events_scraper.py` with NSE session management + rate limiting
- [ ] Add `stock_events` SQLite table with migration in `main.py` startup
- [ ] Implement `fetch_stock_events(symbol)` using yfinance `.calendar` + `.info`
- [ ] Implement `fetch_nse_board_meetings()` with session cookies + pacing
- [ ] Implement `fetch_nse_corporate_actions()` with session cookies + pacing
- [ ] Add `aggregate_market_events()` with deduplication logic
- [ ] Register `background_events_refresh()` in startup scheduler (2x/day)
- [ ] Add exponential backoff on 403/429 + fallback chain
- [ ] Add `/api/events/calendar` and `/api/events/stock/{symbol}` endpoints
- [ ] Write unit tests for parsing, caching, and API responses

### Phase 2: Per-Stock Events Card
- [ ] Add "📅 Upcoming Events" card to stock profile (HTML + CSS)
- [ ] Implement `loadStockEvents(symbol)` JS function
- [ ] Skeleton loader during fetch
- [ ] Live countdown timer with `setInterval`
- [ ] Color-coded event type badges (results=blue, div=green, bonus=amber, split=purple)
- [ ] 2-column grid on desktop, single column on mobile
- [ ] Light/dark theme support via CSS variables
- [ ] Slide-in card animation
- [ ] Error/empty states with retry

### Phase 3: Market-Wide Calendar Tab
- [ ] Add "📅 Events" subtab in main navigation (HTML)
- [ ] Build event list/table component with sortable columns
- [ ] Implement filter pills (event type, date range, watchlist)
- [ ] Real-time search filter for company names
- [ ] Summary stats bar
- [ ] "Load More" pagination
- [ ] Desktop: table layout | Mobile: card layout
- [ ] Glassmorphism hover effects and row animations
- [ ] Skeleton shimmer loading state
- [ ] Light/dark theme via CSS variables
- [ ] Full responsive testing (320px to 2560px)

---

## Verification Plan

### Automated Tests
- Unit tests for NSE response parsing and normalization
- Mock API tests for `/api/events/calendar` and `/api/events/stock/{symbol}`
- SQLite caching TTL and deduplication tests
- Exponential backoff logic tests

### Cloud VM Validation
- Deploy to Oracle Cloud VM
- Test NSE API access from VM IP
- Verify fallback to yfinance if NSE blocks
- Monitor 403/429 responses over 48 hours

### Visual & Responsive Testing
- Browser DevTools: test at 320px, 375px, 480px, 768px, 1024px, 1440px
- Light theme + Dark theme visual verification
- Capacitor APK install and mobile app testing
- Animation performance on mobile (no jank)
