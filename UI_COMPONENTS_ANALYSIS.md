# UI Components Analysis - Indian Stock Analyzer

## 1. AI Portfolio Doctor / Standalone AI Portfolio Doctor

### Location
- **HTML**: [backend/static/index.html](backend/static/index.html#L3762-L3810) - Lines 3762-3810
- **JavaScript Controller**: [backend/static/app.js](backend/static/app.js#L14878-L14950) - Lines 14878-14950
- **Backend API**: [backend/main.py](backend/main.py#L4607) - Line 4607
- **Backend Logic**: [backend/agent.py](backend/agent.py#L1555) - Line 1555

### HTML Structure
```html
<!-- SECTION 6: STANDALONE AI PORTFOLIO DOCTOR -->
<section class="workspace-tab" id="tab-portfolio" style="display: none;">
    <div class="section-header">
        <h2>Portfolio Optimization Doctor</h2>
        <p>Orchestrate institutional-grade diagnostic audits, analyze concentration indices, measure sector exposure, and receive active mathematical rebalancing strategies compiled by the AI agent.</p>
    </div>

    <!-- Portfolio Doctor Sub-navigation Tabs -->
    <div class="portfolio-subtabs-wrapper no-print">
        <button class="portfolio-subtab-btn active" id="port-tab-diagnostics-btn">🩺 Diagnostics Audit</button>
        <button class="portfolio-subtab-btn" id="port-tab-tax-btn">💸 Tax & Harvesting</button>
        <button class="portfolio-subtab-btn" id="port-tab-backtester-btn">📊 Historical Backtester</button>
    </div>

    <!-- PANEL 1: DIAGNOSTICS AUDIT -->
    <div id="port-panel-diagnostics" class="portfolio-panel">
        <div class="card" id="portfolio-doctor-card">
            <div class="card-header">
                <h3>
                    <span>🩺 Standalone AI Portfolio Doctor</span>
                    <span class="badge-rec">Advisor Active</span>
                </h3>
                <!-- Auto-Refresh Controls Group -->
                <div id="portfolio-refresh-controls-group" style="display: none; align-items: center; gap: 8px; flex-wrap: wrap;">
                    <span style="font-size: 10.5px; color: var(--text-secondary); font-weight: 600;">Auto-Refresh:</span>
                    <select id="portfolio-refresh-time-select" style="background: var(--bg-glass-input); border: 1px solid var(--border-glass); color: var(--text-primary); border-radius: 4px; padding: 4px 8px; font-size: 10.5px; cursor: pointer; outline: none; height: 28px;">
                        <option value="manual" selected>Manual</option>
                        <option value="180">3 min</option>
                        <option value="300">5 min</option>
                        <option value="600">10 min</option>
                        <option value="900">15 min</option>
                        <option value="1800">30 min</option>
                        <option value="3600">60 min</option>
                    </select>
                    <button class="btn-secondary" id="portfolio-refresh-btn" style="font-size: 11px; padding: 4px 10px; height: 28px; border-radius: 4px; display: inline-flex; align-items: center; gap: 4px; font-weight: 600;">
                        <span class="refresh-icon">🔄</span> Refresh Prices
                    </button>
                </div>
            </div>
```

### JavaScript Controller
```javascript
// Portfolio Doctor manual refresh button (Line 14896-14912)
const portfolioRefreshBtn = document.getElementById('portfolio-refresh-btn');
if (portfolioRefreshBtn) {
    portfolioRefreshBtn.addEventListener('click', async () => {
        showToast("Refreshing Portfolio Ledger...", "info");
        const icon = portfolioRefreshBtn.querySelector('.refresh-icon') || portfolioRefreshBtn;
        icon.classList.add('spin-loader-active');
        try {
            await loadPortfolioDoctorLedger(true);
            showToast("Portfolio Ledger refreshed.", "success");
        } catch (e) {
            console.error("Portfolio refresh failed:", e);
            showToast("Failed to refresh Portfolio Ledger.", "error");
        } finally {
            icon.classList.remove('spin-loader-active');
        }
    });
}

// Portfolio Doctor automatic auto-refresh interval select (Line 14915-14942)
const portfolioRefreshSelect = document.getElementById('portfolio-refresh-time-select');

function startPortfolioAutoRefresh(minutes) {
    if (window.portfolioRefreshIntervalId) {
        clearInterval(window.portfolioRefreshIntervalId);
        window.portfolioRefreshIntervalId = null;
    }
    if (minutes > 0) {
        const ms = minutes * 60 * 1000;
        window.portfolioRefreshIntervalId = setInterval(async () => {
            // Only refresh if the portfolio tab is active/visible
            const activeTab = document.querySelector('.nav-btn.active');
            if (activeTab && activeTab.id === 'tab-portfolio-btn') {
                console.log(`Auto-refreshing Portfolio Doctor (${minutes} min interval)...`);
                const icon = portfolioRefreshBtn ? (portfolioRefreshBtn.querySelector('.refresh-icon') || portfolioRefreshBtn) : null;
                if (icon) icon.classList.add('spin-loader-active');
                try {
                    await loadPortfolioDoctorLedger(true);
                } catch (e) {
                    console.error("Auto-refresh Portfolio Doctor failed:", e);
                } finally {
                    if (icon) icon.classList.remove('spin-loader-active');
                }
            }
        }, ms);
        console.log(`Portfolio Doctor auto-refresh scheduled every ${minutes} minute(s).`);
    }
}
```

### Display Data
The Portfolio Doctor shows:
- **Diagnostics Health Score**: Calculated by `/api/portfolio-doctor`
- **Total Capital Committed**: Sum of investment amounts
- **Current Market Valuation**: Current market value of holdings
- **Unrealized Net P&L**: Profit/Loss calculation
- **Sector Allocation Chart**: Diversification analysis
- **Holdings Ledger Table**: Stock details with quantities, cost basis
- **Portfolio Prescription**: AI-generated rebalancing recommendations

### Data Elements
```javascript
// From app.js line 16051-16070
const response = await fetch('/api/portfolio-doctor', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items })
});

const data = await response.json();

document.getElementById('port-total-investment').innerText = `₹${data.total_investment.toLocaleString('en-IN', {maximumFractionDigits:2})}`;
document.getElementById('port-total-value').innerText = `₹${data.total_current_value.toLocaleString('en-IN', {maximumFractionDigits:2})}`;

const plTextEl = document.getElementById('port-total-pl');
plTextEl.innerText = `₹${data.total_profit_loss.toLocaleString('en-IN', {maximumFractionDigits:2})} (${data.total_profit_loss_pct >= 0 ? '+' : ''}${data.total_profit_loss_pct}%)`;
plTextEl.className = data.total_profit_loss >= 0 ? 'green-text' : 'red-text';
```

---

## 2. Equity Research Terminal

### Location
- **HTML Main Tab Button**: [backend/static/index.html](backend/static/index.html#L66-L67) - Lines 66-67
- **Sub-Tabs Navigation**: [backend/static/index.html](backend/static/index.html#L691-L710) - Lines 691-710
- **JavaScript Sub-Tabs Controller**: [backend/static/app.js](backend/static/app.js#L14769-L14850) - Lines 14769-14850

### HTML Navigation Structure
```html
<!-- Main Tab Button (Line 66) -->
<button class="nav-btn active" id="tab-analyzer-btn" data-title="Equity Research Terminal">
    <span class="btn-icon">📈</span> <span class="btn-text">Equity Research Terminal</span>
</button>

<!-- Subsection Sub-Tabs navigation bar for Equity Research Terminal (Lines 691-710) -->
<div class="subtabs-scroll-container no-print">
    <button class="subtabs-nav-btn prev-btn hidden" aria-label="Scroll left">◀</button>
    <div class="analyzer-subtabs">
        <button class="subtab-btn active" data-subtab="summary">📋 Executive Summary</button>
        <button class="subtab-btn" data-subtab="valuation">📊 Valuation & DCF</button>
        <button class="subtab-btn" data-subtab="technical">📉 Technical Timing</button>
        <button class="subtab-btn" data-subtab="tv-chart">📈 Interactive Chart</button>
        <button class="subtab-btn" data-subtab="fundamental">🩺 Ratios & Earnings</button>
        <button class="subtab-btn" data-subtab="peers">👥 Peers & Ownership</button>
        <button class="subtab-btn" data-subtab="audit">🔬 Agent Strategy Audit</button>
        <button class="subtab-btn" data-subtab="volume">📋 Price Volume Dynamics</button>
    </div>
    <button class="subtabs-nav-btn next-btn hidden" aria-label="Scroll right">▶</button>
</div>
```

### Sub-Tabs Overview
Each sub-tab shows different aspects of equity analysis:

1. **📋 Executive Summary** - Corporate profile, business summary, SWOT analysis, price performance
2. **📊 Valuation & DCF** - Discounted cash flow analysis, valuation multiples
3. **📉 Technical Timing** - Technical indicators, trend analysis
4. **📈 Interactive Chart** - TradingView Lightweight Charts integration
5. **🩺 Ratios & Earnings** - Financial ratios, P&L data
6. **👥 Peers & Ownership** - Peer comparison, ownership structure
7. **🔬 Agent Strategy Audit** - AI strategy rationale and logic
8. **📋 Price Volume Dynamics** - Price and volume analysis

### JavaScript Sub-Tabs Controller
```javascript
function setupAnalyzerSubtabs() {
    const subtabButtons = document.querySelectorAll('.subtab-btn');
    if (subtabButtons.length === 0) return;

    const container = document.querySelector('.analyzer-subtabs');
    const prevBtn = document.querySelector('.subtabs-scroll-container .prev-btn');
    const nextBtn = document.querySelector('.subtabs-scroll-container .next-btn');

    // Scroll navigation logic
    subtabButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            // Remove active state from all buttons
            subtabButtons.forEach(b => {
                b.classList.remove('active');
            });
            // Add active state to clicked button
            btn.classList.add('active');

            // Programmatically center the selected tab
            btn.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });

            const activeSubtab = btn.getAttribute('data-subtab');

            // Handle specific sub-tab logic
            if (activeSubtab === 'volume') {
                if (activeStockProfile && activeStockProfile.ticker) {
                    loadPriceVolumeDynamics(activeStockProfile.ticker);
                } else {
                    showToast("Please load a stock analyzer profile first.", "warning");
                }
            }

            if (activeSubtab === 'tv-chart') {
                if (activeStockProfile && activeStockProfile.ticker) {
                    renderTVWorkstationChart(activeStockProfile.ticker);
                } else {
                    showToast("Please load a stock analyzer profile first.", "warning");
                }
            }

            // Toggle visibility of all cards
            const cards = document.querySelectorAll('.dashboard-grid > .card');
            cards.forEach(card => {
                const subtabAttr = card.getAttribute('data-subtab');
                card.style.display = (subtabAttr === activeSubtab || subtabAttr === null) ? 'block' : 'none';
            });
        });
    });
}
```

---

## 3. Stock Price Display and Refresh Mechanism

### WebSocket Live Ticks Connection
**Location**: [backend/static/app.js](backend/static/app.js#L1-L100) - Lines 1-100

```javascript
// ==================== LIVE TICKS WEBSOCKET MANAGER ====================
let liveTicksWS = null;
let liveTicksReconnectTimer = null;
let liveTicksConnected = false;
let _wsSubscribedSymbols = new Set();

function connectLiveTicksWS() {
    if (liveTicksWS && (liveTicksWS.readyState === WebSocket.CONNECTING || liveTicksWS.readyState === WebSocket.OPEN)) {
        return; // Already connected or connecting
    }

    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${location.host}/ws/live-ticks`;

    try {
        liveTicksWS = new WebSocket(wsUrl);
    } catch (e) {
        console.warn('WebSocket connection failed:', e);
        updateConnectionIndicator('offline');
        scheduleWsReconnect();
        return;
    }

    liveTicksWS.onopen = () => {
        console.log('🟢 Live Ticks WebSocket connected');
        liveTicksConnected = true;
        updateConnectionIndicator('live');
        // Re-subscribe to previously subscribed symbols
        if (_wsSubscribedSymbols.size > 0) {
            liveTicksWS.send(JSON.stringify({ action: 'subscribe', symbols: Array.from(_wsSubscribedSymbols) }));
        }
    };

    liveTicksWS.onmessage = (event) => {
        try {
            const msg = JSON.parse(event.data);
            if (msg.type === 'ticks') {
                handleLiveTickMessage(msg.data);
            } else if (msg.type === 'alert_triggered') {
                handleWsAlertTriggered(msg.alert);
            }
        } catch (e) {
            console.warn('Failed to parse WS message:', e);
        }
    };

    liveTicksWS.onclose = (event) => {
        console.warn('🔴 Live Ticks WebSocket closed:', event.code, event.reason);
        liveTicksConnected = false;
        updateConnectionIndicator('polling');
        scheduleWsReconnect();
    };

    liveTicksWS.onerror = (error) => {
        console.error('WebSocket error:', error);
        liveTicksConnected = false;
        updateConnectionIndicator('offline');
    };
}
```

### Live Tick Message Handler
**Location**: [backend/static/app.js](backend/static/app.js#L91-L145) - Lines 91-145

```javascript
function handleLiveTickMessage(ticksData) {
    // ticksData = { "TCS": { price, change, change_pct, high, low }, ... }
    if (!ticksData || typeof ticksData !== 'object') return;

    // Update in-memory watchlist item data for sorting
    const activeWatch = (typeof watchlistsList !== 'undefined') ? watchlistsList.find(w => w.id === activeWatchlistId) : null;
    if (activeWatch && activeWatch.items) {
        activeWatch.items.forEach(item => {
            const q = ticksData[item.symbol] || ticksData[item.symbol.replace('.NS', '')];
            if (q && q.price > 0) {
                item.live_price = q.price;
                item.change = q.change;
                item.change_pct = q.change_pct;
                item.day_high = q.high;
                item.day_low = q.low;
            }
        });
    }

    // Update active stock profile in Equity Research Terminal if it's currently loaded
    if (activeStockProfile && activeStockProfile.ticker) {
        const activeTicker = activeStockProfile.ticker;
        const q = ticksData[activeTicker] || ticksData[activeTicker.replace('.NS', '')] || ticksData[activeTicker.split('.')[0]];
        if (q && q.price > 0) {
            // Update activeStockProfile fundamentals & technicals
            if (activeStockProfile.fundamentals) {
                activeStockProfile.fundamentals.current_price = q.price;
            }
            if (activeStockProfile.technicals) {
                activeStockProfile.technicals.price_change_pct = q.change_pct;
                if (q.high > 0) activeStockProfile.technicals.daily_high = q.high;
                if (q.low > 0) activeStockProfile.technicals.daily_low = q.low;
            }

            // Update top meta banner price & change in DOM
            const priceEl = document.getElementById('meta-price');
            const changeEl = document.getElementById('meta-change');
            if (priceEl) {
                const oldPriceText = priceEl.getAttribute('data-last-price');
                const priceChanged = oldPriceText && parseFloat(oldPriceText) !== q.price;
                priceEl.innerText = safeFormatRupees(q.price, 2);
                priceEl.setAttribute('data-last-price', q.price);

                // Add tick flash animation to the banner price
                if (priceChanged) {
                    const isPositive = q.change >= 0;
                    priceEl.classList.add(isPositive ? 'tick-flash-green' : 'tick-flash-red');
                    setTimeout(() => {
                        priceEl.classList.remove('tick-flash-green', 'tick-flash-red');
                    }, 600);
                }
            }

            if (changeEl) {
                const isPositive = q.change_pct >= 0;
                const sign = isPositive ? '+' : '';
                const isBullish = activeStockProfile.technicals && activeStockProfile.technicals.trend_50_vs_200 === "Bullish";
                const trendLabel = isBullish ? 'Bullish trend' : 'Consolidating';
                changeEl.innerText = `${sign}${q.change_pct.toFixed(2)}% (${trendLabel})`;
                changeEl.className = isPositive ? "meta-change green-text" : "meta-change red-text";
            }
        }
    }
}
```

### Data Fields Updated in Real-Time
- `live_price` - Current stock price
- `change` - Absolute price change
- `change_pct` - Percentage change
- `day_high` - Day's high price
- `day_low` - Day's low price

---

## 4. Watchlist Refresh Implementation

### HTML Refresh Button
**Location**: [backend/static/index.html](backend/static/index.html#L3615) - Line 3615

```html
<button class="btn-secondary" id="watchlist-refresh-btn" style="font-size: 11px; padding: 6px 12px; display: none; align-items: center; gap: 4px;">🔄 Refresh Prices</button>
```

### Watchlist Display Table
**Location**: [backend/static/index.html](backend/static/index.html#L3620-L3645) - Lines 3620-3645

```html
<table class="data-table">
    <thead>
        <tr>
            <th data-sort="symbol">Stock Symbol <span>↕</span></th>
            <th data-sort="name">Company Name <span>↕</span></th>
            <th data-sort="sector">Sector <span>↕</span></th>
            <th class="wl-live-price" data-sort="live_price" style="text-align: right;">Live Price <span>↕</span></th>
            <th class="wl-change" data-sort="change" style="text-align: right;">Change <span>↕</span></th>
            <th class="wl-change-pct" data-sort="change_pct" style="text-align: right;">Change % <span>↕</span></th>
            <th class="wl-day-high" data-sort="day_high" style="text-align: right;">Day High <span>↕</span></th>
            <th class="wl-day-low" data-sort="day_low" style="text-align: right;">Day Low <span>↕</span></th>
            <th>Actions</th>
        </tr>
    </thead>
    <tbody id="watchlist-table-body">
        <!-- Rows dynamically populated -->
    </tbody>
</table>
```

### Price Display in Table
**Location**: [backend/static/app.js](backend/static/app.js#L10910-10920) - Lines 10910-10920

```javascript
const numericSortFields = ['live_price', 'change', 'change_pct', 'day_high', 'day_low'];

const priceHTML = (item.live_price !== undefined && item.live_price !== null)
    ? `<span style="font-family: 'Inter', monospace;">₹${item.live_price.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>`
    : '<span style="color: var(--text-secondary);">--</span>';
```

---

## 5. Time Interval/Refresh Dropdown Implementation

### Portfolio Doctor Auto-Refresh Dropdown
**Location**: [backend/static/index.html](backend/static/index.html#L3788-3798) - Lines 3788-3798

```html
<div id="portfolio-refresh-controls-group" style="display: none; align-items: center; gap: 8px; flex-wrap: wrap;">
    <span style="font-size: 10.5px; color: var(--text-secondary); font-weight: 600;">Auto-Refresh:</span>
    <select id="portfolio-refresh-time-select" style="background: var(--bg-glass-input); border: 1px solid var(--border-glass); color: var(--text-primary); border-radius: 4px; padding: 4px 8px; font-size: 10.5px; cursor: pointer; outline: none; height: 28px;">
        <option value="manual" selected>Manual</option>
        <option value="180">3 min</option>
        <option value="300">5 min</option>
        <option value="600">10 min</option>
        <option value="900">15 min</option>
        <option value="1800">30 min</option>
        <option value="3600">60 min</option>
    </select>
    <button class="btn-secondary" id="portfolio-refresh-btn">
        <span class="refresh-icon">🔄</span> Refresh Prices
    </button>
</div>
```

### General Refresh Cycle Setting
**Location**: [backend/static/index.html](backend/static/index.html#L260-265) - Lines 260-265

```html
<div class="setting-row">
    <label>Refresh Cycle</label>
    <select id="setting-refresh-interval" style="background:#000; color:#fff; border:1px solid var(--border-glass); border-radius:4px; padding:2px 4px; font-size:10px;">
        <option value="60s">60s interval</option>
        <option value="300s" selected>5m interval</option>
    </select>
</div>
```

### Chart Time Interval Selector
**Location**: [backend/static/index.html](backend/static/index.html#L1650) - Line 1650

```html
<select id="chart-interval" style="padding: 4px 8px; border-radius: 4px; font-size:11px; background: rgba(0,0,0,0.3); color: var(--text-primary); border: 1px solid var(--border-glass); cursor:pointer;">
    <!-- Options for 1m, 5m, 15m, 60m, daily, weekly intervals -->
</select>
```

---

## 6. Backend API Endpoint

### Portfolio Doctor Endpoint
**Location**: [backend/main.py](backend/main.py#L4607-4614) - Lines 4607-4614

```python
@app.post("/api/portfolio-doctor")
async def post_portfolio_doctor(input_data: PortfolioDoctorInput):
    try:
        portfolio_items = [item.dict() for item in input_data.items]
        diagnosis = await asyncio.to_thread(run_portfolio_doctor, portfolio_items)
        return diagnosis
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Portfolio Doctor Error: {str(e)}")
```

### Live Ticks WebSocket Server
**Location**: [backend/websocket_server.py](backend/websocket_server.py) - WebSocket endpoint: `/ws/live-ticks`

Handles:
- Real-time price streaming from Angel One API
- Symbol subscription/unsubscription
- Alert triggered notifications
- Automatic reconnection with exponential backoff

---

## 7. Component Summary Table

| Component | Location | Refresh Method | Data Update Frequency | Display Elements |
|-----------|----------|-----------------|----------------------|------------------|
| **Portfolio Doctor** | `index.html` L3762-3810 | Manual Button + Auto-interval Dropdown | 3-60 min (configurable) | Health Score, Total Investment, Market Value, P&L, Sector Chart |
| **Equity Research Terminal** | `index.html` L66-67, L691-710 | Stock profile load | Real-time via WebSocket | 8 sub-tabs with analysis data |
| **Watchlist** | `index.html` L3615+ | Refresh Prices Button | Real-time via WebSocket | Symbol, Price, Change, Change %, Day High/Low |
| **Price Banner** | `app.js` L91-145 | WebSocket tick handler | Real-time | Current Price with Flash Animation |
| **System Refresh Cycle** | `index.html` L260-265 | Global setting dropdown | 60s or 5m | General data refresh interval |
| **Chart Time Intervals** | `index.html` L1650 | Chart interval selector | Per-chart basis | OHLCV data at different timeframes |

---

## 8. Key JavaScript Functions

| Function | Location | Purpose |
|----------|----------|---------|
| `connectLiveTicksWS()` | `app.js` L1-100 | Establishes WebSocket connection for live price updates |
| `handleLiveTickMessage()` | `app.js` L91-145 | Processes incoming tick data and updates UI |
| `setupPortfolioDoctor()` | `app.js` L14878-14950 | Initializes Portfolio Doctor controls and auto-refresh |
| `setupAnalyzerSubtabs()` | `app.js` L14769-14850 | Sets up Equity Research Terminal sub-tab navigation |
| `loadPortfolioDoctorLedger()` | `app.js` | Fetches and renders portfolio diagnostics |
| `renderTVWorkstationChart()` | `app.js` | Renders TradingView interactive chart |
| `loadPriceVolumeDynamics()` | `app.js` | Loads price and volume analysis data |

