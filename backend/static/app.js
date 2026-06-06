/* 
   Indian Stock Analysis AI Workstation
   Unified Client-side State Machine & Dashboard Controller (Updated)
*/

// Safe formatting helpers to prevent "Cannot read properties of null (reading 'toLocaleString')" errors
function safeFormatRupees(val, decimals = 2) {
    if (val === null || val === undefined || isNaN(val)) return 'N/A';
    return 'Rs. ' + Number(val).toLocaleString('en-IN', {
        minimumFractionDigits: 0,
        maximumFractionDigits: decimals
    });
}

function safeFormatNumber(val, decimals = 2) {
    if (val === null || val === undefined || isNaN(val)) return 'N/A';
    return Number(val).toLocaleString('en-IN', {
        minimumFractionDigits: 0,
        maximumFractionDigits: decimals
    });
}

function safeFixed(val, decimals = 1) {
    if (val === null || val === undefined || isNaN(val)) return 'N/A';
    return Number(val).toFixed(decimals);
}

// Application State
let activeTab = 'analyzer';
let activeScreenerStrategy = 'hybrid';
let activeStockProfile = null;
let activeChartInstance = null;
let activeRiskChartInstance = null;
let currentRiskData = {
    beta: 1.0,
    annual_stock_ret: 0.0,
    annual_bench_ret: 0.0,
    correlation: 0.0
};
let chatHistory = [];
let watchlistsList = [];
let activeWatchlistId = null;
let activeWatchlistBatchData = null;
let activeScreenerResults = [];
let activeScreenerStyle = 'all';
let screenerSortCol = 'score';
let screenerSortAsc = false;
let activeAuditMatrixData = null;


// DOM Elements
const tabs = {
    screener: document.getElementById('tab-screener'),
    universe: document.getElementById('tab-universe'),
    analyzer: document.getElementById('tab-analyzer'),
    compare: document.getElementById('tab-compare'),
    alerts: document.getElementById('tab-alerts'),
    watchlist: document.getElementById('tab-watchlist'),
    portfolio: document.getElementById('tab-portfolio')
};

const tabBtns = {
    screener: document.getElementById('tab-screener-btn'),
    universe: document.getElementById('tab-universe-btn'),
    analyzer: document.getElementById('tab-analyzer-btn'),
    compare: document.getElementById('tab-compare-btn'),
    alerts: document.getElementById('tab-alerts-btn'),
    watchlist: document.getElementById('tab-watchlist-btn'),
    portfolio: document.getElementById('tab-portfolio-btn')
};

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
    setupThemeToggle();
    setupMobileMenu();
    setupTabNavigation();
    setupScreenerControls();
    setupAnalyzerControls();
    setupDCFSandbox();
    setupComparisonArena();
    setupAlertCenter();
    setupChatDrawer();
    setupPDFExport();
    setupDynamicChartControls(); // Finding 5 hook!
    setupWatchlistControls(); // Initialize Watchlist managers
    setupCSVExports();
    setupBusinessSummaryCollapsible();
    setupUniverseExplorer();
    setupAnalyzerSubtabs(); // Initialize Equity Research Terminal sub-tabs
    setupReturnCalculator(); // New Return Calculator
    setupPortfolioDoctor(); // New Portfolio Doctor
    setupPortfolioBacktester(); // Historical Backtester
    setupTaxHarvestingPanel(); // Initialize Tax & Harvesting Panel
    loadRebalancerStatus(); // Fix #4: load universe status on startup
    setupRebalanceButton(); // Fix #4: wire Sync button
    setupGlobalProfileListeners(); // Dynamic reactive profile switcher!
    setupSidebarToggle(); // Initialize Collapsible Sidebar Workspace
    setupEnterpriseHeader(); // Initialize Enterprise sticky header
    setupEnterpriseFooter(); // Initialize Enterprise diagnostics footer
    setupAuditSummary(); // Initialize Strategy Audit AI matrix summary
    setupWatchlistSummary(); // Initialize Watchlist AI Summary & Print Exporter
    setupBrandReset(); // Wire click to reset workspace
    setupRiskAnalytics(); // CAPM Risk Analytics

    // Restore persisted tab on reload
    const savedTab = localStorage.getItem('active-tab') || 'analyzer';
    switchTab(savedTab);
    if (savedTab === 'portfolio') {
        setTimeout(() => loadPortfolioDoctorLedger(true), 150);
    }
});

// Collapsible Sidebar Workstation Manager
function setupSidebarToggle() {
    const sidebar = document.getElementById('sidebar');
    const collapseBtn = document.getElementById('sidebar-collapse-btn');
    const logoToggle = document.getElementById('logo-icon-toggle');

    if (!sidebar || !collapseBtn) return;

    // Load saved preference
    const isCollapsed = localStorage.getItem('sidebar-collapsed') === 'true';
    if (isCollapsed) {
        sidebar.classList.add('collapsed');
        collapseBtn.innerText = '▶';
        collapseBtn.title = 'Expand Sidebar';
    }

    const toggleSidebar = () => {
        sidebar.classList.toggle('collapsed');
        const currentlyCollapsed = sidebar.classList.contains('collapsed');
        localStorage.setItem('sidebar-collapsed', currentlyCollapsed);
        collapseBtn.innerText = currentlyCollapsed ? '▶' : '◀';
        collapseBtn.title = currentlyCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar';

        // Trigger a window resize event to force Chart.js elements to resize perfectly
        setTimeout(() => {
            window.dispatchEvent(new Event('resize'));
        }, 300);
    };

    collapseBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleSidebar();
    });

    if (logoToggle) {
        logoToggle.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleSidebar();
        });
    }
}

// Enterprise Header & Footer Controllers
function setupEnterpriseHeader() {
    const bellBtn = document.getElementById('header-bell-btn');
    const settingsBtn = document.getElementById('header-settings-btn');
    const notifDropdown = document.getElementById('notification-dropdown-panel');
    const settingsDropdown = document.getElementById('settings-dropdown-panel');

    if (!bellBtn || !settingsBtn || !notifDropdown || !settingsDropdown) return;

    // Toggle Notification panel
    bellBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        notifDropdown.style.display = notifDropdown.style.display === 'none' ? 'block' : 'none';
        settingsDropdown.style.display = 'none'; // Close other dropdown
    });

    // Toggle Settings panel
    settingsBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        settingsDropdown.style.display = settingsDropdown.style.display === 'none' ? 'block' : 'none';
        notifDropdown.style.display = 'none'; // Close other dropdown
    });

    // Close on click outside
    document.addEventListener('click', (e) => {
        if (!bellBtn.contains(e.target) && !notifDropdown.contains(e.target)) {
            notifDropdown.style.display = 'none';
        }
        if (!settingsBtn.contains(e.target) && !settingsDropdown.contains(e.target)) {
            settingsDropdown.style.display = 'none';
        }
    });

    // Handle clearing notifications
    const clearBtn = document.getElementById('clear-all-alerts-btn');
    const notifBody = document.getElementById('notification-list-body');
    const badge = document.getElementById('bell-badge-count');
    
    if (clearBtn && notifBody && badge) {
        clearBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            notifBody.innerHTML = '<div style="font-size:10px; color:var(--text-muted); padding:20px; text-align:center;">No new system notifications.</div>';
            badge.style.display = 'none';
            showToast("System notifications cleared.", "success");
        });
    }

    // Dynamic indices rate fluctuations (Simulating live Bloomberg terminal)
    const marquee = document.getElementById('indices-marquee');
    if (marquee) {
        // Clone marquee content to make it a seamless, infinite loop!
        const clone = marquee.cloneNode(true);
        clone.id = 'indices-marquee-clone';
        marquee.parentElement.appendChild(clone);

        setInterval(() => {
            const items = document.querySelectorAll('.ticker-item');
            items.forEach(item => {
                const valEl = item.querySelector('strong.val');
                const changeEl = item.querySelector('span.change');
                if (!valEl || !changeEl) return;

                // Fluctuates value realistically
                let val = parseFloat(valEl.innerText.replace(/,/g, ''));
                const factor = (Math.random() - 0.5) * 4; // delta change
                val += factor;

                // Format back to locale string
                valEl.innerText = val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

                // Calculate a simulated percentage
                let pct = (factor / val) * 100;
                if (Math.abs(pct) < 0.01) pct = (Math.random() - 0.5) * 0.05;

                if (pct >= 0) {
                    changeEl.innerText = `▲ +${pct.toFixed(2)}%`;
                    changeEl.className = 'change green-text';
                } else {
                    changeEl.innerText = `▼ ${pct.toFixed(2)}%`;
                    changeEl.className = 'change red-text';
                }
            });
        }, 4000);
    }
}

function setupEnterpriseFooter() {
    const clockEl = document.getElementById('footer-system-clock');
    const latencyEl = document.getElementById('footer-latency');

    if (!clockEl || !latencyEl) return;

    // 1. Live ticking clock
    setInterval(() => {
        const now = new Date();
        clockEl.innerText = now.toLocaleTimeString('en-IN');
    }, 1000);

    // 2. Realistic API latency fluctuations (updated dynamically on action)
    const simulateLatency = () => {
        const latency = Math.floor(25 + Math.random() * 35); // fluctuates between 25ms and 60ms
        latencyEl.innerText = `${latency}ms`;
        if (latency < 45) {
            latencyEl.className = 'green-text';
        } else {
            latencyEl.className = 'yellow-text';
        }
    };

    // Update latency periodically and on every click of navigation tabs
    setInterval(simulateLatency, 7000);
    document.querySelectorAll('.nav-btn, .strategy-btn, button').forEach(btn => {
        btn.addEventListener('click', () => {
            setTimeout(simulateLatency, 100 + Math.random() * 200);
        });
    });
}

// 1. Tab Routing Navigation
function setupTabNavigation() {
    Object.keys(tabBtns).forEach(tabKey => {
        const btn = tabBtns[tabKey] || document.getElementById('tab-' + tabKey + '-btn');
        if (btn) {
            btn.addEventListener('click', () => {
                switchTab(tabKey);
            });
        } else {
            console.warn(`Tab button not found for key: ${tabKey}`);
        }
    });
}

function switchTab(tabKey) {
    activeTab = tabKey;
    localStorage.setItem('active-tab', tabKey);
    Object.keys(tabs).forEach(k => {
        const el = tabs[k] || document.getElementById('tab-' + k);
        const btn = tabBtns[k] || document.getElementById('tab-' + k + '-btn');
        if (el) {
            el.style.display = (k === tabKey) ? 'block' : 'none';
        }
        if (btn) {
            if (k === tabKey) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        }
    });
}

function setupBrandReset() {
    const brand = document.getElementById('logo-brand-reset');
    if (brand) {
        brand.addEventListener('click', () => {
            resetWorkspace();
        });
    }
    
    const mobileBrand = document.getElementById('mobile-logo-reset');
    if (mobileBrand) {
        mobileBrand.addEventListener('click', () => {
            resetWorkspace();
        });
    }
}

function resetWorkspace() {
    activeStockProfile = null;
    chatHistory = [];
    
    // Close mobile menu sidebar if open
    const sidebar = document.getElementById('sidebar');
    if (sidebar) {
        sidebar.classList.remove('open');
    }
    
    // Clear search inputs & suggestions box
    const searchInput = document.getElementById('analyzer-search-input');
    if (searchInput) searchInput.value = '';
    
    const suggestions = document.getElementById('analyzer-suggestions');
    if (suggestions) {
        suggestions.innerHTML = '';
        suggestions.style.display = 'none';
    }
    
    // Reset active stock meta text fields in the header
    const compName = document.getElementById('meta-company-name');
    if (compName) compName.innerText = '';
    const ticker = document.getElementById('meta-ticker');
    if (ticker) ticker.innerText = '';
    const sector = document.getElementById('meta-sector');
    if (sector) sector.innerText = '';
    const industry = document.getElementById('meta-industry');
    if (industry) industry.innerText = '';
    const price = document.getElementById('meta-price');
    if (price) price.innerText = '';
    const change = document.getElementById('meta-change');
    if (change) change.innerText = '';
    
    const conviction = document.getElementById('meta-ai-conviction-text');
    if (conviction) conviction.innerText = 'Score: --/100';
    
    // Toggles dashboard visibility back to empty state
    const dashboard = document.getElementById('analyzer-dashboard');
    if (dashboard) dashboard.style.display = 'none';
    
    const emptyState = document.getElementById('analyzer-empty-state');
    if (emptyState) emptyState.style.display = 'block';
    
    // Disable export PDF report button
    const exportBtn = document.getElementById('export-pdf-btn');
    if (exportBtn) exportBtn.setAttribute('disabled', 'true');
    
    // Navigate back to the Equity Research Terminal
    switchTab('analyzer');
}

// 2. Global Loader Utilities
function showLoader(title, subtitle) {
    const titleEl = document.getElementById('loader-title');
    if (titleEl) titleEl.innerText = title || "Analyzing...";
    const subEl = document.getElementById('loader-subtitle');
    if (subEl) subEl.innerText = subtitle || "Consulting subagents asynchronously.";
    const loaderEl = document.getElementById('global-loader');
    if (loaderEl) loaderEl.style.display = 'flex';
}

function hideLoader() {
    const loaderEl = document.getElementById('global-loader');
    if (loaderEl) loaderEl.style.display = 'none';
}

// 3. AI Screener Section (Finding 6 resolution!)
function setupScreenerControls() {
    const strategyBtns = document.querySelectorAll('.strategy-btn');
    strategyBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            strategyBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            activeScreenerStrategy = btn.getAttribute('data-strategy');
        });
    });
    
    const styleSelect = document.getElementById('screener-style-select');
    if (styleSelect) {
        styleSelect.addEventListener('change', (e) => {
            activeScreenerStyle = e.target.value;
        });
    }
    
    document.getElementById('run-screener-btn').addEventListener('click', (e) => {
        fireScreenerParticles();
        runAIScreener();
    });
    setupScreenerSorting();
}

function setupGlobalProfileListeners() {
    const horizonSelect = document.getElementById('profile-horizon');
    const riskSelect = document.getElementById('profile-risk');
    
    const triggerProfileRefresh = () => {
        if (activeStockProfile && activeStockProfile.ticker) {
            console.log(`Global Profile Changed: refreshing workspace & diagnostics for ${activeStockProfile.ticker}`);
            // Re-run single stock analysis in the background to refresh prospectus/checks
            loadStockAnalyzer(activeStockProfile.ticker);
        }
    };
    
    if (horizonSelect) horizonSelect.addEventListener('change', triggerProfileRefresh);
    if (riskSelect) riskSelect.addEventListener('change', triggerProfileRefresh);
}

// Particle burst for screener button
function fireScreenerParticles() {
    const container = document.getElementById('screener-btn-particles');
    if (!container) return;
    container.innerHTML = '';
    const colors = ['#6ee7b7', '#34d399', '#a7f3d0', '#fff', '#6ee7b7'];
    const count = 12;
    for (let i = 0; i < count; i++) {
        const p = document.createElement('span');
        p.className = 'particle';
        const angle = (i / count) * 360;
        const dist = 28 + Math.random() * 38;
        const rad = (angle * Math.PI) / 180;
        p.style.setProperty('--px', `${Math.cos(rad) * dist}px`);
        p.style.setProperty('--py', `${Math.sin(rad) * dist}px`);
        p.style.background = colors[i % colors.length];
        p.style.left = '50%'; p.style.top = '50%';
        p.style.marginLeft = '-2.5px'; p.style.marginTop = '-2.5px';
        p.style.animationDelay = `${i * 0.03}s`;
        container.appendChild(p);
    }
    setTimeout(() => { container.innerHTML = ''; }, 900);
}

// Stage cycling for screener button
let _screenerStageInterval = null;
const SCREENER_STAGES = [
    { icon: '🗄️', label: 'Loading universe…' },
    { icon: '🔎', label: 'Applying quality gates…' },
    { icon: '📐', label: 'Scoring constituents…' },
    { icon: '🏆', label: 'Ranking top picks…' },
    { icon: '⚡', label: 'Finalizing results…' },
];

function setScreenerBtnLoading(isLoading, resultCount) {
    const btn = document.getElementById('run-screener-btn');
    const iconEl = document.getElementById('screener-btn-icon');
    const labelEl = document.getElementById('screener-btn-label');
    if (!btn) return;
    if (isLoading) {
        btn.classList.add('loading');
        btn.classList.remove('success-flash');
        if (iconEl) iconEl.textContent = '⚙️';
        let idx = 0;
        if (labelEl) labelEl.textContent = SCREENER_STAGES[0].label;
        _screenerStageInterval = setInterval(() => {
            idx = (idx + 1) % SCREENER_STAGES.length;
            if (iconEl) iconEl.textContent = SCREENER_STAGES[idx].icon;
            if (labelEl) labelEl.textContent = SCREENER_STAGES[idx].label;
        }, 1600);
    } else {
        clearInterval(_screenerStageInterval);
        btn.classList.remove('loading');
        if (iconEl) iconEl.textContent = '✅';
        const countLabel = resultCount > 0 ? `${resultCount} stocks found!` : 'Scan Complete!';
        if (labelEl) labelEl.textContent = countLabel;
        btn.classList.add('success-flash');
        setTimeout(() => {
            btn.classList.remove('success-flash');
            if (iconEl) iconEl.textContent = '🔬';
            if (labelEl) labelEl.textContent = 'Run AI Screener Scan';
        }, 2500);
    }
}

function setupScreenerSorting() {
    const headers = document.querySelectorAll('#tab-screener th.sortable');
    headers.forEach(header => {
        header.addEventListener('click', () => {
            const field = header.getAttribute('data-sort');
            if (screenerSortCol === field) {
                screenerSortAsc = !screenerSortAsc;
            } else {
                screenerSortCol = field;
                screenerSortAsc = false; // default to descending
            }
            
            // Reset indicator icons and color of non-active headers
            headers.forEach(h => {
                h.style.color = 'var(--text-secondary)';
                h.innerText = h.innerText.replace(/[▲▼↕]/g, '↕');
            });
            
            header.style.color = 'var(--color-primary)';
            header.innerText = header.innerText.replace(/[▲▼↕]/g, screenerSortAsc ? '▲' : '▼');
            
            sortScreenerResults();
        });
    });
}

function sortScreenerResults() {
    if (!activeScreenerResults || activeScreenerResults.length === 0) return;
    
    activeScreenerResults.sort((a, b) => {
        let valA, valB;
        switch (screenerSortCol) {
            case 'rank':
                valA = a.rank || 999;
                valB = b.rank || 999;
                break;
            case 'name':
                valA = (a.name || '').toLowerCase();
                valB = (b.name || '').toLowerCase();
                break;
            case 'sector':
                valA = (a.sector || '').toLowerCase();
                valB = (b.sector || '').toLowerCase();
                break;
            case 'score':
                valA = a.score || 0;
                valB = b.score || 0;
                break;
            case 'fundamental':
                valA = a.fundamental_score || 0;
                valB = b.fundamental_score || 0;
                break;
            case 'valuation':
                valA = a.valuation_score || 0;
                valB = b.valuation_score || 0;
                break;
            case 'momentum':
                valA = a.technical_score || 0;
                valB = b.technical_score || 0;
                break;
            case 'cap_type':
                valA = (a.cap_type || '').toLowerCase();
                valB = (b.cap_type || '').toLowerCase();
                break;
            case 'action':
                valA = (a.action || '').toLowerCase();
                valB = (b.action || '').toLowerCase();
                break;
            default:
                valA = a.score || 0;
                valB = b.score || 0;
        }
        
        if (valA < valB) return screenerSortAsc ? -1 : 1;
        if (valA > valB) return screenerSortAsc ? 1 : -1;
        return 0;
    });
    
    renderScreenerResults(activeScreenerResults, true);
}

async function runAIScreener() {
    const universe = document.getElementById('screener-universe-select').value;
    const horizon = document.getElementById('profile-horizon')?.value || 'Long-term (3+ years)';
    const risk = document.getElementById('profile-risk')?.value || 'Moderate';
    
    setScreenerBtnLoading(true);
    showLoader(
        "Scanning Selected Cap Universe...",
        `Executing quantitative screening sweeps across the selected segment (${universe.toUpperCase()}) to filter the absolute best buy recommendations.`
    );
    
    try {
        const encodedHorizon = encodeURIComponent(horizon);
        const encodedRisk = encodeURIComponent(risk);
        const response = await fetch(`/api/discover?strategy=${activeScreenerStrategy}&universe=${universe}&horizon=${encodedHorizon}&risk=${encodedRisk}&style=${activeScreenerStyle}`);
        if (!response.ok) throw new Error("Screener scan failed.");
        const results = await response.json();
        
        // Assign ranks initially
        results.forEach((item, index) => {
            item.rank = index + 1;
        });
        
        activeScreenerResults = results;
        screenerSortCol = 'score';
        screenerSortAsc = false;
        
        // Reset header indicators
        const headers = document.querySelectorAll('#tab-screener th.sortable');
        headers.forEach(h => {
            h.style.color = 'var(--text-secondary)';
            h.innerText = h.innerText.replace(/[▲▼↕]/g, '↕');
            if (h.getAttribute('data-sort') === 'score') {
                h.style.color = 'var(--color-primary)';
                h.innerText = h.innerText.replace('↕', '▼');
            }
        });
        
        renderScreenerResults(results, true);
        setScreenerBtnLoading(false, results.length);
    } catch (e) {
        setScreenerBtnLoading(false, 0);
        showToast("Failed to execute screener scan: " + e.message, 'error');
    } finally {
        hideLoader();
    }
}

function renderScreenerResults(results, isSorted = false) {
    const tbody = document.getElementById('screener-results-body');
    tbody.innerHTML = '';
    
    const formatSubscore = (score, maxVal) => {
        if (score === undefined || score === null) return `0/${maxVal}`;
        const scoreStr = String(score);
        if (scoreStr.includes('/')) {
            const parts = scoreStr.split('/');
            return `<span style="font-size: 11px; font-weight: 600; color: var(--text-primary);">${parts[0]}</span><span style="font-size: 8.5px; color: var(--text-muted);">/${parts[1]}</span>`;
        }
        return `<span style="font-size: 11px; font-weight: 600; color: var(--text-primary);">${scoreStr}</span><span style="font-size: 8.5px; color: var(--text-muted);">/${maxVal}</span>`;
    };
    
    if (results.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" class="center-text text-muted">No matching assets found. Try adjusting selection strategy.</td></tr>';
        return;
    }
    
    if (!isSorted) {
        results.forEach((item, index) => {
            item.rank = index + 1;
        });
        activeScreenerResults = results;
    }
    
    results.forEach((item) => {
        const tr = document.createElement('tr');
        tr.style.transition = 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)';
        tr.style.cursor = 'default';
        
        tr.addEventListener('mouseenter', () => {
            tr.style.background = 'rgba(255, 255, 255, 0.025)';
            tr.style.transform = 'scale(1.004)';
        });
        tr.addEventListener('mouseleave', () => {
            tr.style.background = 'transparent';
            tr.style.transform = 'none';
        });
        
        let recClass = 'rec-hold';
        if (item.action.includes("BUY")) recClass = 'rec-buy';
        if (item.action.includes("STRONG BUY")) recClass = 'rec-strong-buy';
        if (item.action.includes("AVOID") || item.action.includes("SELL")) recClass = 'rec-sell';
        
        let scoreColor = 'var(--color-primary)';
        let scoreBg = 'rgba(59,130,246,0.1)';
        if (item.score >= 70) {
            scoreColor = 'var(--color-emerald)';
            scoreBg = 'rgba(16,185,129,0.1)';
        } else if (item.score >= 45) {
            scoreColor = 'var(--color-amber)';
            scoreBg = 'rgba(245,158,11,0.1)';
        } else {
            scoreColor = 'var(--color-crimson)';
            scoreBg = 'rgba(239,68,68,0.1)';
        }
        
        // Rank visual medals
        const rankMedal = item.rank === 1 ? '🥇' : item.rank === 2 ? '🥈' : item.rank === 3 ? '🥉' : `#${item.rank}`;
        const rankStyle = item.rank <= 3 ? 'font-size: 13px;' : 'font-size: 11px; color: var(--text-secondary);';
        
        tr.innerHTML = `
            <td><strong style="${rankStyle}">${rankMedal}</strong></td>
            <td>
                <strong style="color: var(--text-primary); font-family: 'Outfit', sans-serif;">${item.name}</strong><br>
                <span class="text-muted" style="font-size:9.5px; letter-spacing:0.02em;">${item.symbol}</span>
            </td>
            <td><span class="text-muted" style="font-size: 11px;">${item.sector}</span></td>
            <td><span class="text-muted" style="text-transform: uppercase; font-size: 10.5px; font-weight: 700; letter-spacing:0.02em;">${item.cap_type || 'N/A'}</span></td>
            <td><span class="badge-ticker" style="background-color:${scoreBg}; color:${scoreColor}; border: 1px solid ${scoreColor}30; font-family: 'Outfit', sans-serif; font-weight:800; font-size: 11px; padding: 3px 8px; border-radius: 6px;">${item.score}/100</span></td>
            <td>${formatSubscore(item.fundamental_score, 30)}</td>
            <td>${formatSubscore(item.valuation_score, 25)}</td>
            <td>${formatSubscore(item.technical_score, 25)}</td>
            <td><span class="badge-rec ${recClass}" style="font-size: 9.5px; padding: 3px 8px; font-weight: 700; border-radius: 5px; letter-spacing:0.04em;">${item.action}</span></td>
            <td><button class="btn-secondary load-analyzer-btn" data-ticker="${item.symbol}" style="font-size: 10.5px; padding: 5px 12px; font-family: 'Outfit', sans-serif; font-weight: 600; border-radius: 6px; cursor: pointer; transition: all 0.2s;">Load Workspace</button></td>
        `;
        
        tbody.appendChild(tr);
    });
    
    document.querySelectorAll('.load-analyzer-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const ticker = btn.getAttribute('data-ticker');
            loadStockAnalyzer(ticker);
        });
    });
    
    // Dynamic AI Screener Analyst Summary Block Generator
    const summaryBox = document.getElementById('screener-summary-block');
    const summaryText = document.getElementById('screener-summary-text');
    
    if (summaryBox && summaryText) {
        const totalCount = results.length;
        const avgScore = results.reduce((acc, r) => acc + r.score, 0) / totalCount;
        const buyCount = results.filter(r => r.action.includes("BUY")).length;
        const avoidCount = results.filter(r => r.action.includes("AVOID") || r.action.includes("SELL")).length;
        
        const topPick = results[0];
        
        let accentColor = '#EF4444';
        let cohortTitle = '⚠️ CLEARANCE MARKET BARGAIN (Distressed Cohort)';
        let cohortMetaphor = `Think of this cohort as a clearance market bargain bin. The vast majority of assets are struggling against severe macroeconomic headwinds, high promoter pledging, or technical momentum friction. You must proceed with extreme caution, as many carry high-risk deal-breakers.`;
        
        if (avgScore >= 65) {
            accentColor = '#10B981';
            cohortTitle = '🏆 HIGH-PERFORMANCE SPORTS ACADEMY (Prime Cohort)';
            cohortMetaphor = `Think of this screened cohort as a world-class sports academy. The vast majority of candidates here are physically elite, highly disciplined, and operate at peak efficiency. This represents a prime asset list with outstanding structural tailwinds where capital deployment has a high probability of capturing alpha.`;
        } else if (avgScore >= 45) {
            accentColor = '#F59E0B';
            cohortTitle = '🎓 SELECTIVE UNIVERSITY CLASS (Balanced Cohort)';
            cohortMetaphor = `Think of this cohort as a selective university classroom. Most candidates are reliable, above-average performers, but they are not uniform. You need to grade them carefully using individual quality gates to separate the honors graduates from the crowd before allocating capital.`;
        }
        
        summaryBox.style.borderLeft = `4px solid ${accentColor}`;
        
        let html = '';
        
        html += '<div style="display: grid; grid-template-columns: 1.15fr 0.85fr; gap: 18px; align-items: start;">';
        
        // Left Column: Metaphor
        html += '  <div>';
        html += `    <div style="font-size: 11px; font-weight: 700; color: ${accentColor}; margin-bottom: 5px; letter-spacing: 0.04em;">${cohortTitle}</div>`;
        html += `    <p style="font-size: 11px; color: var(--text-muted); line-height: 1.6; margin: 0; font-family: 'Inter', sans-serif;">${cohortMetaphor}</p>`;
        html += '  </div>';
        
        // Right Column: Metrics Grid
        html += '  <div style="display: grid; grid-template-columns: 1fr; gap: 8px;">';
        
        html += '    <div style="display: flex; gap: 8px;">';
        html += '      <div style="flex: 1; background: rgba(0,0,0,0.15); border: 1px solid rgba(255,255,255,0.03); padding: 8px 10px; border-radius: 6px; display: flex; flex-direction: column; justify-content: center;">';
        html += '        <span style="font-size: 8.5px; color: var(--text-secondary); text-transform: uppercase; font-weight: 600;">Cohort Avg Score</span>';
        html += `        <strong style="font-size: 13.5px; color: ${accentColor}; margin-top: 1px; font-family: 'Outfit', sans-serif;">${avgScore.toFixed(1)}/100</strong>`;
        html += '      </div>';
        html += '      <div style="flex: 1; background: rgba(0,0,0,0.15); border: 1px solid rgba(255,255,255,0.03); padding: 8px 10px; border-radius: 6px; display: flex; flex-direction: column; justify-content: center;">';
        html += '        <span style="font-size: 8.5px; color: var(--text-secondary); text-transform: uppercase; font-weight: 600;">Buy vs Avoid Tally</span>';
        html += `        <strong style="font-size: 13.5px; color: #ffffff; margin-top: 1px; font-family: 'Outfit', sans-serif;"><span style="color:#10B981;">${buyCount}B</span> <span style="color:var(--text-muted); font-size:10px;">/</span> <span style="color:#EF4444;">${avoidCount}A</span></strong>`;
        html += '      </div>';
        html += '    </div>';
        
        if (topPick) {
            const cleanTopPickName = topPick.name.length > 22 ? topPick.name.substring(0, 20) + '...' : topPick.name;
            html += `    <div class="top-pick-highlight-badge" style="background: rgba(59, 130, 246, 0.05); border: 1px solid rgba(59, 130, 246, 0.25); padding: 8px 12px; border-radius: 6px; display: flex; justify-content: space-between; align-items: center; cursor: pointer; transition: all 0.2s;" onclick="loadStockAnalyzer('${topPick.symbol}')" title="Click to load workspace instantly">`;
            html += '      <div style="display: flex; flex-direction: column; gap: 1px;">';
            html += '        <span style="font-size: 8.5px; color: var(--text-secondary); text-transform: uppercase; font-weight: 600;">👑 Top Conviction Pick</span>';
            html += `        <strong style="font-size: 12px; color: #ffffff; font-family: 'Outfit', sans-serif;">${cleanTopPickName} <span style="font-size: 9.5px; color: var(--text-muted); font-weight: 500;">(${topPick.symbol})</span></strong>`;
            html += '      </div>';
            html += `      <div style="background: rgba(59, 130, 246, 0.15); border: 1px solid rgba(59, 130, 246, 0.35); border-radius: 6px; padding: 3px 8px; font-size: 11px; font-weight: 700; color: #60a5fa; font-family: 'Outfit', sans-serif;">${topPick.score}/100</div>`;
            html += '    </div>';
        }
        
        html += '  </div>';
        html += '</div>';
        
        summaryText.innerHTML = html;
        summaryBox.style.display = 'block';
    }
    
    const resultsBox = document.getElementById('screener-results-box');
    if (resultsBox) resultsBox.style.display = 'block';
}

function setupAnalyzerControls() {
    document.getElementById('analyzer-search-btn').addEventListener('click', (e) => {
        const q = document.getElementById('analyzer-search-input').value.trim();
        if (q) {
            fireAnalyzeParticles(e);
            loadStockAnalyzer(q);
        }
    });
    
    document.getElementById('analyzer-search-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') {
            const q = document.getElementById('analyzer-search-input').value.trim();
            if (q) loadStockAnalyzer(q);
        }
    });

    // Autocomplete online suggestions for Single Stock Workspace
    const searchInput = document.getElementById('analyzer-search-input');
    const analyzerSuggestionsDiv = document.getElementById('analyzer-suggestions');
    if (searchInput && analyzerSuggestionsDiv) {
        searchInput.addEventListener('input', async () => {
            const query = searchInput.value.trim();
            if (query.length < 2) {
                analyzerSuggestionsDiv.style.display = 'none';
                return;
            }
            
            try {
                const res = await fetch(`/api/search/suggestions?q=${encodeURIComponent(query)}`);
                if (res.ok) {
                    const data = await res.json();
                    if (data.length > 0) {
                        analyzerSuggestionsDiv.innerHTML = '';
                        data.forEach(item => {
                            const div = document.createElement('div');
                            div.style.padding = '8px 12px';
                            div.style.cursor = 'pointer';
                            div.style.borderBottom = '1px solid rgba(255,255,255,0.05)';
                            div.style.transition = 'background 0.2s';
                            div.innerHTML = `<span style="color:#fff; font-weight:600;">${item.base_symbol}</span> - <span style="color:var(--text-secondary);">${item.name}</span> <span style="float:right; color:var(--text-muted); font-size:9.5px;">${item.sector}</span>`;
                            
                            div.addEventListener('mouseenter', () => {
                                div.style.background = 'rgba(255,255,255,0.05)';
                            });
                            div.addEventListener('mouseleave', () => {
                                div.style.background = 'transparent';
                            });
                            div.addEventListener('click', () => {
                                searchInput.value = item.base_symbol;
                                analyzerSuggestionsDiv.style.display = 'none';
                            });
                            analyzerSuggestionsDiv.appendChild(div);
                        });
                        analyzerSuggestionsDiv.style.display = 'block';
                    } else {
                        analyzerSuggestionsDiv.style.display = 'none';
                    }
                }
            } catch (err) {
                console.error("Analyzer suggestions error:", err);
            }
        });
        
        document.addEventListener('click', (e) => {
            if (e.target !== searchInput && e.target !== analyzerSuggestionsDiv) {
                analyzerSuggestionsDiv.style.display = 'none';
            }
        });
    }

    const quickCompareBtn = document.getElementById('quick-compare-peers-btn');
    if (quickCompareBtn) {
        quickCompareBtn.addEventListener('click', () => {
            if (!activeStockProfile) return;
            const targetBase = activeStockProfile.ticker.split('.')[0].toUpperCase();
            const targetName = activeStockProfile.company_name.toLowerCase();
            const cleanTargetName = targetName.replace(/limited|ltd|industries|ind|corp|co|corporation/gi, "").replace(/[^a-z0-9]/g, "");
            
            const tickers = [targetBase];
            
            // Query only checked checkboxes in the peer table
            const checkedCheckboxes = document.querySelectorAll('.peer-select-checkbox:checked');
            
            checkedCheckboxes.forEach(cb => {
                const name = cb.getAttribute('data-ticker');
                if (name) {
                    const cleanName = name.replace(/\(Target\)/gi, '').trim();
                    const cleanNorm = cleanName.toLowerCase();
                    const cleanStripped = cleanNorm.replace(/limited|ltd|industries|ind|corp|co|corporation/gi, "").replace(/[^a-z0-9]/g, "");
                    
                    // Skip if it is the target company itself to avoid duplicates
                    if (cleanNorm.includes("target") || 
                        cleanStripped === cleanTargetName || 
                        cleanName.toUpperCase() === targetBase) {
                        return;
                    }
                    
                    // Simplify the peer name to a clean search query by removing common suffixes
                    const queryName = cleanName
                        .replace(/\s+(ltd|limited|corp|co|corporation|industries|ind)\.?\s*$/gi, '')
                        .trim();
                    
                    if (queryName && !tickers.includes(queryName)) {
                        tickers.push(queryName);
                    }
                }
            });
            
            // Limit to 10 total comparison items (Target + 9 selected peers)
            const finalTickers = tickers.slice(0, 10);
            
            switchTab('compare');
            
            const compareInput = document.getElementById('compare-symbols-input');
            if (compareInput) {
                compareInput.value = finalTickers.join(', ');
                document.getElementById('run-comparison-btn').click();
            }
        });
    }

    // Master peer select-all checkbox event listener
    const selectAllCheckbox = document.getElementById('peer-select-all-checkbox');
    if (selectAllCheckbox) {
        selectAllCheckbox.addEventListener('change', (e) => {
            const isChecked = e.target.checked;
            document.querySelectorAll('.peer-select-checkbox').forEach(cb => {
                cb.checked = isChecked;
            });
            // Trigger peer chart update after all boxes are selected/deselected
            setTimeout(updatePeerComparisonChart, 50);
        });
    }

    // Custom peer input and add button listeners
    const addCustomPeerBtn = document.getElementById('add-custom-peer-btn');
    const customPeerInput = document.getElementById('custom-peer-input');
    
    const handleAddCustomPeer = async () => {
        if (!customPeerInput) return;
        const val = customPeerInput.value.trim();
        if (!val) return;
        
        if (addCustomPeerBtn) addCustomPeerBtn.disabled = true;
        customPeerInput.disabled = true;
        
        try {
            const originalText = addCustomPeerBtn ? addCustomPeerBtn.innerText : '+ Add Stock';
            if (addCustomPeerBtn) addCustomPeerBtn.innerText = 'Adding...';
            
            // Resolve company ticker first via API
            const searchRes = await fetch(`/api/search?q=${encodeURIComponent(val)}`);
            if (!searchRes.ok) {
                throw new Error('Search failed');
            }
            const resolved = await searchRes.json();
            const baseSymbol = resolved.base_symbol;
            const companyName = resolved.name || baseSymbol;
            const fullTicker = resolved.yf_ticker || `${baseSymbol}.NS`;
            
            // Now retrieve full stock profile metrics from analyze (SQLite cache or live scraper)
            const res = await fetch(`/api/analyze?query=${encodeURIComponent(fullTicker)}`);
            if (!res.ok) {
                throw new Error('Failed to load profile');
            }
            const profile = await res.json();
            
            const peerBody = document.getElementById('peer-table-body');
            if (peerBody) {
                // Ensure no duplications of target or existing peers
                const existingCheckboxes = peerBody.querySelectorAll('.peer-select-checkbox');
                let alreadyExists = false;
                existingCheckboxes.forEach(cb => {
                    const cbTicker = cb.getAttribute('data-ticker');
                    if (cbTicker && (cbTicker.toLowerCase() === baseSymbol.toLowerCase() || cbTicker.toLowerCase() === companyName.toLowerCase())) {
                        alreadyExists = true;
                    }
                });
                
                if (alreadyExists) {
                    alert(`Stock "${companyName}" is already in the benchmarking list.`);
                    return;
                }
                
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td style="text-align: center; width: 50px;">
                        <input type="checkbox" class="peer-select-checkbox" data-ticker="${baseSymbol}" checked style="cursor: pointer; transform: scale(1.15);">
                    </td>
                    <td><strong class="peer-name-click" style="color: var(--neon-blue); cursor: pointer;" title="Click to load workspace for this peer company">${companyName} (Custom)</strong></td>
                    <td>${profile.fundamentals && profile.fundamentals.pe_ratio ? profile.fundamentals.pe_ratio.toFixed(1) : 'N/A'}</td>
                    <td>${profile.fundamentals && profile.fundamentals.market_cap ? profile.fundamentals.market_cap.toLocaleString('en-IN') : 'N/A'}</td>
                    <td>${profile.fundamentals && profile.fundamentals.roce_pct ? profile.fundamentals.roce_pct.toFixed(1) : 'N/A'}%</td>
                    <td>${profile.fundamentals && profile.fundamentals.roe_pct ? profile.fundamentals.roe_pct.toFixed(1) : 'N/A'}%</td>
                    <td>N/A</td>
                `;
                
                // Stop event propagation when clicking the checkbox to avoid workspace reload triggers
                const checkbox = tr.querySelector('.peer-select-checkbox');
                checkbox.addEventListener('click', (e) => {
                    e.stopPropagation();
                });
                
                // Bind click to company name row only
                tr.querySelector('.peer-name-click').addEventListener('click', (e) => {
                    e.stopPropagation();
                    loadStockAnalyzer(fullTicker);
                });
                
                peerBody.appendChild(tr);
                customPeerInput.value = '';
            }
        } catch (err) {
            console.error("Error adding custom peer stock:", err);
            alert(`Could not add "${val}" for benchmarking. Please ensure it is a valid stock name or ticker symbol.`);
        } finally {
            if (addCustomPeerBtn) {
                addCustomPeerBtn.disabled = false;
                addCustomPeerBtn.innerText = '+ Add Stock';
            }
            customPeerInput.disabled = false;
            customPeerInput.focus();
        }
    };
    
    if (addCustomPeerBtn) {
        addCustomPeerBtn.addEventListener('click', handleAddCustomPeer);
    }
    if (customPeerInput) {
        customPeerInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                handleAddCustomPeer();
            }
        });
    }
    
    // Setup interactive capture period selection dropdown listener
    const capturePeriodSelect = document.getElementById('capture-period');
    if (capturePeriodSelect) {
        capturePeriodSelect.addEventListener('change', function() {
            if (activeStockProfile) {
                updateInteractiveCaptureCard(activeStockProfile, this.value);
            }
        });
    }
    
    // Setup event delegation for Sector Peer Benchmarking checkboxes
    const peerTableBody = document.getElementById('peer-table-body');
    if (peerTableBody) {
        peerTableBody.addEventListener('change', function(e) {
            if (e.target.classList.contains('peer-select-checkbox') || e.target.type === 'checkbox') {
                updatePeerComparisonChart();
            }
        });
    }
    

    
    // Setup peer chart period change listener
    const peerChartPeriodSelect = document.getElementById('peer-chart-period');
    if (peerChartPeriodSelect) {
        peerChartPeriodSelect.addEventListener('change', function() {
            updatePeerComparisonChart();
        });
    }
}

// Particle burst on Analyze button click
function fireAnalyzeParticles(e) {
    const container = document.getElementById('analyze-btn-particles');
    if (!container) return;
    container.innerHTML = '';
    const colors = ['#93c5fd', '#a5b4fc', '#c4b5fd', '#fff', '#60a5fa'];
    const count = 12;
    for (let i = 0; i < count; i++) {
        const p = document.createElement('span');
        p.className = 'particle';
        const angle = (i / count) * 360;
        const dist = 30 + Math.random() * 40;
        const rad = (angle * Math.PI) / 180;
        const px = Math.cos(rad) * dist;
        const py = Math.sin(rad) * dist;
        p.style.setProperty('--px', `${px}px`);
        p.style.setProperty('--py', `${py}px`);
        p.style.background = colors[i % colors.length];
        p.style.left = '50%';
        p.style.top = '50%';
        p.style.marginLeft = '-2.5px';
        p.style.marginTop = '-2.5px';
        p.style.animationDelay = `${i * 0.03}s`;
        container.appendChild(p);
    }
    setTimeout(() => { container.innerHTML = ''; }, 900);
}

// Cycle agent pipeline labels while loading
let _analyzeStageInterval = null;
const ANALYZE_STAGES = [
    { icon: '📊', label: 'CFA Analyst checking ratios…' },
    { icon: '📈', label: 'Chartist computing RSI & SMA…' },
    { icon: '🔍', label: 'Governance auditor scanning…' },
    { icon: '🧠', label: 'CIO synthesizing report…' },
    { icon: '⚡', label: 'Finalizing prospectus…' },
];

function setAnalyzeBtnLoading(isLoading) {
    const btn = document.getElementById('analyzer-search-btn');
    const iconEl = document.getElementById('analyze-btn-icon');
    const labelEl = document.getElementById('analyze-btn-label');
    if (!btn) return;

    if (isLoading) {
        btn.classList.add('loading');
        btn.classList.remove('success-flash');
        if (iconEl) iconEl.textContent = '⚙️';
        let stageIdx = 0;
        if (labelEl) labelEl.textContent = ANALYZE_STAGES[0].label;
        _analyzeStageInterval = setInterval(() => {
            stageIdx = (stageIdx + 1) % ANALYZE_STAGES.length;
            if (iconEl) iconEl.textContent = ANALYZE_STAGES[stageIdx].icon;
            if (labelEl) labelEl.textContent = ANALYZE_STAGES[stageIdx].label;
        }, 1800);
    } else {
        clearInterval(_analyzeStageInterval);
        btn.classList.remove('loading');
        if (iconEl) iconEl.textContent = '✅';
        if (labelEl) labelEl.textContent = 'Analysis Ready!';
        btn.classList.add('success-flash');
        setTimeout(() => {
            btn.classList.remove('success-flash');
            if (iconEl) iconEl.textContent = '⚡';
            if (labelEl) labelEl.textContent = 'Analyze Asset';
        }, 2200);
    }
}

async function loadStockAnalyzer(query) {
    const searchInput = document.getElementById('analyzer-search-input');
    if (searchInput) {
        searchInput.value = query;
    }
    
    const horizon = document.getElementById('profile-horizon').value;
    const risk = document.getElementById('profile-risk').value;
    
    setAnalyzeBtnLoading(true);
    showLoader(
        "Orchestrating Multi-Agent Workspace...",
        "Chief Investment Officer parent agent is spawning subagents. Fundamental CFA checking Screener.in ratios, technical chartist computing RSI, sentiment auditor auditing shareholding pledges..."
    );
    
    try {
        const response = await fetch(`/api/analyze?query=${encodeURIComponent(query)}&horizon=${encodeURIComponent(horizon)}&risk=${encodeURIComponent(risk)}`);
        if (!response.ok) throw new Error("Analysis failed.");
        const profile = await response.json();
        
        activeStockProfile = profile;
        chatHistory = [];
        
        // Reset dynamic chart select values to default when loading a new stock
        document.getElementById('chart-period').value = '1y';
        document.getElementById('chart-interval').value = '1d';
        
        switchTab('analyzer');
        renderStockDashboard(profile);
        if (window.resetAnalyzerSubtabs) window.resetAnalyzerSubtabs();
        setAnalyzeBtnLoading(false);
    } catch (e) {
        setAnalyzeBtnLoading(false);
        showToast("Analysis error: " + e.message, 'error');
    } finally {
        hideLoader();
    }
}

function renderStockDashboard(p) {
    const emptyStateEl = document.getElementById('analyzer-empty-state');
    if (emptyStateEl) emptyStateEl.style.display = 'none';
    const dashboardEl = document.getElementById('analyzer-dashboard');
    if (dashboardEl) dashboardEl.style.display = 'block';
    
    const exportBtn = document.getElementById('export-pdf-btn');
    if (exportBtn) exportBtn.removeAttribute('disabled');
    
    // Explicitly align search input with active stock
    const searchInput = document.getElementById('analyzer-search-input');
    if (searchInput) {
        searchInput.value = p.base_symbol || p.ticker.replace(".NS", "");
    }
    
    const companyNameEl = document.getElementById('meta-company-name');
    if (companyNameEl) companyNameEl.innerText = p.company_name;
    const tickerEl = document.getElementById('meta-ticker');
    if (tickerEl) tickerEl.innerText = p.ticker;
    const sectorEl = document.getElementById('meta-sector');
    if (sectorEl) sectorEl.innerText = p.sector;
    const industryEl = document.getElementById('meta-industry');
    if (industryEl) industryEl.innerText = p.industry;
    const priceEl = document.getElementById('meta-price');
    if (priceEl) priceEl.innerText = safeFormatRupees(p.fundamentals.current_price, 2);
    
    // Populate Corporate Business Summary Collapsible Card
    const summaryText = document.getElementById('business-summary-text');
    if (summaryText) {
        const text = p.business_summary || "No corporate business summary details returned from Yahoo Finance.";
        let laymanSummary = "";
        
        const textLower = text.toLowerCase();
        if (textLower.includes("software") || textLower.includes("technology") || textLower.includes("information technology") || textLower.includes("consulting")) {
            laymanSummary = `**In plain terms:** ${p.company_name} is like a **digital helper for large businesses**. They build software, manage computer systems, and help global companies run their systems online. Think of them as the high-tech engineers who make sure your favorite digital services stay fast, safe, and up and running around the clock.`;
        } else if (textLower.includes("bank") || textLower.includes("financial") || textLower.includes("lending") || textLower.includes("insurance") || textLower.includes("nbfc")) {
            laymanSummary = `**In plain terms:** ${p.company_name} acts as a **financial engine**. They take in deposits and lend money to families and businesses to buy homes, cars, or expand operations. Think of them as the vital circulatory system of the economy, pumping money to where it is needed most.`;
        } else if (textLower.includes("power") || textLower.includes("electricity") || textLower.includes("energy") || textLower.includes("solar") || textLower.includes("wind") || textLower.includes("coal")) {
            laymanSummary = `**In plain terms:** ${p.company_name} acts as a **power station**. They generate and distribute the electricity that lights up homes, keeps factories running, and powers cities. Think of them as the silent engine room of the country, keeping the lights on everywhere.`;
        } else if (textLower.includes("defense") || textLower.includes("aerospace") || textLower.includes("aircraft") || textLower.includes("ship")) {
            laymanSummary = `**In plain terms:** ${p.company_name} is a **national shield builder**. They manufacture advanced aircraft, ships, and defense equipment used by the military to secure the nation. Think of them as high-precision engineers building advanced armor and transport systems for domestic defense.`;
        } else if (textLower.includes("infrastructure") || textLower.includes("rail") || textLower.includes("construction") || textLower.includes("engineering") || textLower.includes("port")) {
            laymanSummary = `**In plain terms:** ${p.company_name} is a **heavy-duty builder**. They construct massive public works, railways, highways, ports, and industrial structures that shape the nation's backbone. Think of them as the structural muscle turning blueprints into massive physical realities.`;
        } else {
            laymanSummary = `**In plain terms:** ${p.company_name} is a **specialized provider of goods and services**. They operate in the ${p.sector || 'domestic market'} sector, serving institutional and retail customers across the country. Think of them as a primary engine driving products to commercial markets.`;
        }
        
        summaryText.innerHTML = `
            <div style="font-size:12.5px; line-height:1.6; color:var(--text-secondary); margin-bottom:12px; font-weight:400;">
                ${text}
            </div>
        `;
    }
    const bsContent = document.getElementById('business-summary-content');
    const bsArrow = document.getElementById('business-summary-arrow');
    if (bsContent) bsContent.style.maxHeight = '0px';
    if (bsArrow) bsArrow.style.transform = 'rotate(0deg)';
    
    const changePct = p.technicals ? p.technicals.price_change_pct : null;
    const isBullish = p.technicals && p.technicals.trend_50_vs_200 === "Bullish";
    let changeText = 'N/A';
    let isPositive = false;
    
    if (changePct !== null && changePct !== undefined) {
        isPositive = changePct >= 0;
        const sign = isPositive ? '+' : '';
        const trendLabel = isBullish ? 'Bullish trend' : 'Consolidating';
        changeText = `${sign}${changePct.toFixed(2)}% (${trendLabel})`;
    } else {
        changeText = 'N/A (No Price Change Data)';
    }
    
    const changeEl = document.getElementById('meta-change');
    changeEl.innerText = changeText;
    changeEl.className = isPositive ? "meta-change green-text" : "meta-change red-text";
    
    const scoring = p.score_metrics || {};
    const finalScore = scoring.final_score || 50;
    const finalAction = scoring.action || "HOLD";
    
    const scoreBadge = document.getElementById('cio-badge-score');
    if (scoreBadge) {
        scoreBadge.innerText = `Score: ${finalScore}/100`;
    }
    
    // Reset/update top banner conviction trigger badge with the score calculated from profile
    const triggerText = document.getElementById('meta-ai-conviction-text');
    const triggerBadge = document.getElementById('meta-ai-conviction-trigger');
    if (triggerText) {
        triggerText.innerText = `Score: ${finalScore}/100 (${finalAction})`;
    }
    if (triggerBadge) {
        triggerBadge.style.opacity = '1';
        // Adjust border and color based on recommendation
        if (finalAction.includes("BUY")) {
            triggerBadge.style.borderColor = 'rgba(16, 185, 129, 0.4)';
            triggerBadge.style.color = '#10b981';
        } else if (finalAction.includes("SELL") || finalAction.includes("AVOID")) {
            triggerBadge.style.borderColor = 'rgba(239, 68, 68, 0.4)';
            triggerBadge.style.color = '#ef4444';
        } else {
            triggerBadge.style.borderColor = 'rgba(245, 158, 11, 0.4)';
            triggerBadge.style.color = '#f59e0b';
        }
    }
    
    const recBadge = document.getElementById('cio-badge-rec');
    if (recBadge) {
        recBadge.innerText = finalAction + (finalAction === "BUY" ? " 🟢" : (finalAction === "HOLD" ? " 🟡" : " 🔴"));
        recBadge.className = 'badge-rec';
        if (finalAction.includes("BUY")) recBadge.classList.add('rec-buy');
        if (finalAction.includes("STRONG BUY")) recBadge.classList.add('rec-strong-buy');
        if (finalAction.includes("HOLD")) recBadge.classList.add('rec-hold');
        if (finalAction.includes("SELL") || finalAction.includes("AVOID")) recBadge.classList.add('rec-sell');
    }
    
    // Render the beautiful visual Checklist (Recommendation 3)
    const checklistContainer = document.getElementById('cio-checklist-container');
    if (checklistContainer) {
        checklistContainer.innerHTML = '';
        
        const fScore = scoring.fundamental_score || 0;
        const vScore = scoring.valuation_score || 0;
        const tScore = scoring.technical_score || 0;
        const gScore = scoring.growth_score || 0;
        const sScore = scoring.sentiment_score || 0;
        
        const activeHorizonSelect = document.getElementById('profile-horizon');
        const activeHorizon = activeHorizonSelect ? activeHorizonSelect.value.toLowerCase() : 'long-term';
        let rsiLowerLimit = 45;
        let rsiUpperLimit = 70;
        if (activeHorizon.includes("short")) {
            rsiLowerLimit = 40;
            rsiUpperLimit = 65;
        } else if (activeHorizon.includes("long")) {
            rsiLowerLimit = 35;
            rsiUpperLimit = 72;
        }
        const rsiVal = p.technicals.rsi !== null && p.technicals.rsi !== undefined ? p.technicals.rsi : 50;
        const rsiInsideBand = rsiVal >= rsiLowerLimit && rsiVal <= rsiUpperLimit;
        
        let rsiWarningText = '';
        if (!rsiInsideBand) {
            if (rsiVal > rsiUpperLimit) {
                rsiWarningText = ' (Overbought)';
            } else {
                rsiWarningText = ' (Oversold)';
            }
        }
        
        const fPass = fScore >= 18;
        const vPass = vScore >= 15;
        const tPass = (tScore >= 15) && rsiInsideBand;
        const gPass = gScore >= 9;
        const sPass = sScore >= 3;
        
        const formatROCE = p.fundamentals.roce_pct !== null && p.fundamentals.roce_pct !== undefined ? p.fundamentals.roce_pct.toFixed(0) : '0';
        const formatDE = p.fundamentals.debt_to_equity !== null && p.fundamentals.debt_to_equity !== undefined ? p.fundamentals.debt_to_equity.toFixed(1) : '0.0';
        const formatRSI = p.technicals.rsi !== null && p.technicals.rsi !== undefined ? p.technicals.rsi.toFixed(0) : '50';
        const formatPAT = p.fundamentals.profit_growth_3y_pct !== null && p.fundamentals.profit_growth_3y_pct !== undefined ? p.fundamentals.profit_growth_3y_pct.toFixed(0) : '0';

        const items = [
            { icon: fPass ? "✅" : "⚠️", text: `<strong>Fundamentals (${fScore}/30):</strong> ROCE ${formatROCE}%, D/E ${formatDE}` },
            { icon: vPass ? "✅" : "⚠️", text: `<strong>Valuation (${vScore}/25):</strong> PEG ${scoring.peg_ratio} — ${p.dcf_model.valuation_rating}` },
            { icon: tPass ? "✅" : "⚠️", text: `<strong>Technical (${tScore}/25):</strong> ${p.technicals.trend_50_vs_200} Trend, RSI ${formatRSI}${rsiWarningText}` },
            { icon: gPass ? "✅" : "⚠️", text: `<strong>Growth (${gScore}/15):</strong> 3Y PAT Growth of ${formatPAT}%` },
            { icon: "📰", text: `<strong>Sentiment (${sScore}/5):</strong> ${p.consensus.recommendation} — ${p.news.length} Catalysts detected` }
        ];
        
        const passStateMap = [fPass, vPass, tPass, gPass, sPass];
        items.forEach((item, idx) => {
            const isPassed = passStateMap[idx];
            const row = document.createElement('div');
            row.className = 'cio-checklist-row';
            row.style.display = 'flex';
            row.style.alignItems = 'center';
            row.style.gap = '12px';
            row.style.fontSize = '12px';
            row.style.padding = '8px 12px';
            row.style.borderRadius = '6px';
            
            let rowBg = 'rgba(245, 158, 11, 0.04)';
            let rowBorder = '1px solid rgba(245, 158, 11, 0.15)';
            let iconText = '⚠️';
            
            if (isPassed) {
                rowBg = 'rgba(16, 185, 129, 0.04)';
                rowBorder = '1px solid rgba(16, 185, 129, 0.15)';
                iconText = '✅';
            }
            if (idx === 4) { // News / Sentiment row is always a custom blue/primary style
                rowBg = 'rgba(59, 130, 246, 0.04)';
                rowBorder = '1px solid rgba(59, 130, 246, 0.15)';
                iconText = '📰';
            }
            
            row.style.background = rowBg;
            row.style.border = rowBorder;
            row.style.marginBottom = '6px';
            row.style.boxShadow = '0 2px 4px rgba(0,0,0,0.05)';
            
            row.innerHTML = `<span style="font-size:14px; display:inline-flex; align-items:center; justify-content:center;">${iconText}</span> <span style="color:var(--text-primary);">${item.text}</span>`;
            checklistContainer.appendChild(row);
        });
    }
    
    // Bind prospectus signal badges and price ranges
    const roeVal = p.fundamentals.roe_pct || 0;
    const marginSafetyVal = p.dcf_model.margin_of_safety || 0;
    let fundamentalSignal = "CONSERVATIVE / LEVERAGED";
    if (roeVal > 15 && marginSafetyVal > 10) {
        fundamentalSignal = "STRONG GROWTH";
    } else if (roeVal > 12) {
        fundamentalSignal = "SOLID CAPITAL";
    } else if (roeVal > 8 && marginSafetyVal > 5) {
        fundamentalSignal = "STABLE CAPITAL";
    }
    
    const activeHorizonSelect = document.getElementById('profile-horizon');
    const activeHorizon = activeHorizonSelect ? activeHorizonSelect.value.toLowerCase() : 'long-term';
    
    let rsiLowerLimit = 45;
    let rsiUpperLimit = 70;
    if (activeHorizon.includes("short")) {
        rsiLowerLimit = 40;
        rsiUpperLimit = 65;
    } else if (activeHorizon.includes("long")) {
        rsiLowerLimit = 35;
        rsiUpperLimit = 72;
    }
    
    let technicalSignal = "NEUTRAL TIMING";
    if (p.technicals.trend_50_vs_200 === "Bullish") {
        if (p.technicals.rsi >= rsiLowerLimit && p.technicals.rsi <= rsiUpperLimit) {
            technicalSignal = "BULLISH ENTRY";
        } else if (p.technicals.rsi > rsiUpperLimit) {
            technicalSignal = "OVERBOUGHT WATCH";
        } else {
            technicalSignal = "BULLISH TIMING";
        }
    } else if (p.technicals.rsi_status === "Oversold" || p.technicals.rsi < rsiLowerLimit) {
        technicalSignal = "ACCUMULATE ON DIP";
    } else if (p.technicals.trend_50_vs_200 === "Bearish") {
        technicalSignal = "BEARISH WATCH";
    }
    
    const consensusSignal = (p.consensus && p.consensus.recommendation) ? p.consensus.recommendation.toUpperCase() : "HOLD";
    
    document.getElementById('cio-fundamental-signal').innerText = fundamentalSignal;
    document.getElementById('cio-technical-signal').innerText = technicalSignal;
    document.getElementById('cio-consensus-signal').innerText = consensusSignal;
    
    document.getElementById('target-buy-range').innerText = p.analysis.suggested_buy_price_range || "N/A";
    document.getElementById('target-sell-range').innerText = p.analysis.suggested_sell_price_range || "N/A";
    
    // Bind 12M Target and Stop Loss
    const targetEl = document.getElementById('target-12m-price');
    const stopLossEl = document.getElementById('stop-loss-12m-price');
    if (targetEl && stopLossEl) {
        const basePrice = p.fundamentals.current_price;
        const targetVal = p.analysis.target_12m || (basePrice !== null && basePrice !== undefined ? basePrice * 1.15 : null);
        const stopLossVal = p.analysis.stop_loss_12m || (basePrice !== null && basePrice !== undefined ? basePrice * 0.88 : null);
        targetEl.innerText = safeFormatRupees(targetVal, 2);
        stopLossEl.innerText = safeFormatRupees(stopLossVal, 2);
    }
    
    // Bind Primary Risk Factor
    const primaryRiskEl = document.getElementById('cio-primary-risk-text');
    if (primaryRiskEl && p.analysis.major_risks && p.analysis.major_risks.length > 0) {
        primaryRiskEl.innerText = p.analysis.major_risks[0];
    }
    
    const thesisEl = document.getElementById('cio-investment-thesis');
    if (thesisEl) {
        thesisEl.innerText = p.analysis.investment_thesis;
    }
    
    const rsiVal = p.technicals.rsi;
    const rsiStatus = p.technicals.rsi_status || "Neutral";
    const rsiEl = document.getElementById('tech-rsi');
    if (rsiEl) {
        rsiEl.innerText = `${safeFixed(rsiVal, 1)} (${rsiStatus})`;
        if (rsiStatus.toLowerCase().includes("oversold")) {
            rsiEl.style.color = "var(--neon-green)";
        } else if (rsiStatus.toLowerCase().includes("overbought")) {
            rsiEl.style.color = "var(--neon-red)";
        } else {
            rsiEl.style.color = "var(--text-primary)";
        }
    }

    const smaTrend = p.technicals.trend_50_vs_200 || "Neutral";
    const smaTrendEl = document.getElementById('tech-sma-trend');
    if (smaTrendEl) {
        smaTrendEl.innerText = smaTrend;
        if (smaTrend.toLowerCase().includes("bullish") || smaTrend.toLowerCase().includes("golden")) {
            smaTrendEl.style.color = "var(--neon-green)";
        } else if (smaTrend.toLowerCase().includes("bearish") || smaTrend.toLowerCase().includes("death")) {
            smaTrendEl.style.color = "var(--neon-red)";
        } else {
            smaTrendEl.style.color = "var(--text-primary)";
        }
    }

    document.getElementById('tech-sma-50').innerText = safeFormatRupees(p.technicals.sma_50, 2);
    document.getElementById('tech-sma-200').innerText = safeFormatRupees(p.technicals.sma_200, 2);
    document.getElementById('tech-dist-high').innerText = `${safeFixed(p.technicals.dist_high_52w_pct, 1)}%`;
    document.getElementById('tech-dist-low').innerText = `${safeFixed(p.technicals.dist_low_52w_pct, 1)}%`;
    
    // Bind new daily and 52-week price indicators
    document.getElementById('tech-daily-open').innerText = safeFormatRupees(p.technicals.daily_open, 2);
    document.getElementById('tech-daily-high').innerText = safeFormatRupees(p.technicals.daily_high, 2);
    document.getElementById('tech-daily-low').innerText = safeFormatRupees(p.technicals.daily_low, 2);
    document.getElementById('tech-daily-close').innerText = safeFormatRupees(p.technicals.daily_close, 2);
    document.getElementById('tech-high-52w').innerText = safeFormatRupees(p.technicals.high_52w, 2);
    document.getElementById('tech-low-52w').innerText = safeFormatRupees(p.technicals.low_52w, 2);
    
    // Bind Up-Market & Down-Market Capture Ratios
    const upCapEl = document.getElementById('tech-up-capture');
    const downCapEl = document.getElementById('tech-down-capture');
    if (upCapEl && downCapEl) {
        const upCap = p.capture_ratios ? p.capture_ratios.up_capture : null;
        const downCap = p.capture_ratios ? p.capture_ratios.down_capture : null;
        const benchSymbol = p.capture_ratios ? p.capture_ratios.benchmark_symbol : '^NSEI';
        const benchName = benchSymbol === '^NSEI' ? 'Nifty 50' : 'Sensex';
        
        upCapEl.innerHTML = `${safeFixed(upCap, 1)}% <span style="font-size:8px; color: ${upCap !== null && upCap >= 100 ? 'var(--neon-green)' : 'var(--text-muted)'}; font-weight:normal; display:block;">(${upCap !== null && upCap >= 100 ? 'Outperforming' : 'Lagging'} vs ${benchName})</span>`;
        downCapEl.innerHTML = `${safeFixed(downCap, 1)}% <span style="font-size:8px; color: ${downCap !== null && downCap <= 100 ? 'var(--neon-green)' : 'var(--neon-red)'}; font-weight:normal; display:block;">(${downCap !== null && downCap <= 100 ? 'Protected' : 'Volatile'} vs ${benchName})</span>`;
    }

    // Technical Timing Layman Translation
    const timingLaymanEl = document.getElementById('tech-timing-layman-text');
    if (timingLaymanEl) {
        let timingLaymanDesc = "The stock is currently consolidating within standard parameters. Buyers and sellers are balanced, waiting for a definitive breakout direction.";
        if (technicalSignal === "BULLISH ENTRY") {
            timingLaymanDesc = "The Golden Cross is active and the RSI is perfectly balanced. This indicates the stock has strong speed but is not overheated yet. Think of a runner who is fully warmed up and just starting their sprint—this is typically an ideal entry window.";
        } else if (technicalSignal === "OVERBOUGHT WATCH") {
            timingLaymanDesc = `The stock is in a strong uptrend, but its RSI is at ${safeFixed(p.technicals.rsi, 1)}, indicating that buyers have driven the price up too fast. Think of a runner gasping for breath at the top of a steep hill. It is best to wait for a temporary price pullback before adding new cash.`;
        } else if (technicalSignal === "BULLISH TIMING") {
            timingLaymanDesc = "The stock is cruising in a healthy, broad upward trend. Moving averages are aligned, and the RSI is in a safe territory. Think of a high-speed train that has built up steady cruising speed—the trend remains highly supportive.";
        } else if (technicalSignal === "ACCUMULATE ON DIP") {
            timingLaymanDesc = `The stock has experienced short-term selling, pushing the RSI to a depressed level of ${safeFixed(p.technicals.rsi, 1)}. Think of this as a premium retail store offering a massive clearance sale on high-quality merchandise. It represents a lucrative dip-buying window.`;
        } else if (technicalSignal === "BEARISH WATCH") {
            timingLaymanDesc = "The stock has entered a downward crossover (Death Cross) or is showing severe technical weakness. Think of a vehicle rolling downhill with fading brakes. It is highly advised to avoid buying and hold current positions defensively.";
        }
        timingLaymanEl.innerHTML = timingLaymanDesc;
    }
    
    // Render Volatility & Momentum Indicator Labels
    document.getElementById('label-vol-bb').innerText = `${safeFormatRupees(p.technicals.bb_lower, 2)} - ${safeFormatRupees(p.technicals.bb_upper, 2)}`;
    document.getElementById('label-vol-atr').innerText = safeFormatRupees(p.technicals.atr, 2);
    
    const macdHistVal = p.technicals.macd_hist;
    const macdStatusStr = macdHistVal > 0 ? "Bullish Crossover" : (macdHistVal < 0 ? "Bearish Divergence" : "Neutral");
    document.getElementById('label-vol-macd').innerText = `${safeFixed(macdHistVal, 2)} (${macdStatusStr})`;
    
    const vptVal = p.technicals.vpt;
    const vptStatusStr = vptVal > 0 ? "Expanding Accumulation" : "Neutral/Contracting";
    document.getElementById('label-vol-vpt').innerText = `${safeFormatNumber(vptVal, 0)} (${vptStatusStr})`;
    
    // Render Breakout / Breakdown Signals
    const breakoutBadge = document.getElementById('tech-breakout-badge');
    const breakoutDesc = document.getElementById('tech-breakout-desc');
    if (breakoutBadge && breakoutDesc) {
        breakoutBadge.innerText = p.technicals.breakout_status;
        breakoutBadge.className = 'breakout-badge';
        if (p.technicals.breakout_status.includes("BREAKOUT")) {
            breakoutBadge.classList.add('breakout-bull');
        } else if (p.technicals.breakout_status.includes("BREAKDOWN")) {
            breakoutBadge.classList.add('breakout-bear');
        } else {
            breakoutBadge.classList.add('breakout-neutral');
        }
        breakoutDesc.innerText = p.technicals.breakout_desc;
    }

    // Render Fibonacci Retracement Levels Chart
    drawFibonacciChart(p);
    renderFibonacciSummary(p);
    renderVolatilitySummary(p);
    

    
    document.getElementById('sb-wacc').value = p.dcf_model.wacc !== null && p.dcf_model.wacc !== undefined ? p.dcf_model.wacc : 10.0;
    document.getElementById('sb-wacc-val').innerText = `${safeFixed(p.dcf_model.wacc, 1)}%`;
    document.getElementById('sb-growth').value = p.fundamentals.sales_growth_3y_pct || 12.0;
    document.getElementById('sb-growth-val').innerText = `${safeFixed(p.fundamentals.sales_growth_3y_pct || 12.0, 1)}%`;
    const opmEst = p.fundamentals.roe_pct * 1.2 || 25.0;
    document.getElementById('sb-opm').value = opmEst;
    document.getElementById('sb-opm-val').innerText = `${safeFixed(opmEst, 1)}%`;
    document.getElementById('sb-terminal').value = 4.5;
    document.getElementById('sb-terminal-val').innerText = `4.5%`;
    
    document.getElementById('dcf-intrinsic-price').innerText = safeFormatRupees(p.dcf_model.intrinsic_value, 2);
    const margin = p.dcf_model.margin_of_safety;
    const marginSafetyEl = document.getElementById('dcf-margin-safety');
    marginSafetyEl.innerText = margin !== null && margin !== undefined ? `${margin > 0 ? '+' : ''}${margin.toFixed(1)}%` : 'N/A';
    marginSafetyEl.className = margin !== null && margin !== undefined && margin >= 0 ? 'green-text' : 'red-text';
    
    const dcfStatusBadge = document.getElementById('dcf-status-badge');
    dcfStatusBadge.innerText = p.dcf_model.valuation_rating || 'N/A';
    dcfStatusBadge.className = 'dcf-indicator';
    if (margin !== null && margin !== undefined) {
        if (margin >= 5.0) dcfStatusBadge.classList.add('undervalued');
        else if (margin <= -5.0) dcfStatusBadge.classList.add('overvalued');
        else dcfStatusBadge.classList.add('fair');
    } else {
        dcfStatusBadge.classList.add('fair');
    }
    
    document.getElementById('pe-current').innerText = safeFixed(p.fundamentals.pe_ratio, 1);
    document.getElementById('pe-median').innerText = p.pe_bands ? safeFixed(p.pe_bands.median_pe, 1) : 'N/A';
    document.getElementById('pe-max').innerText = p.pe_bands ? safeFixed(p.pe_bands.max_pe, 1) : 'N/A';
    document.getElementById('pe-min').innerText = p.pe_bands ? safeFixed(p.pe_bands.min_pe, 1) : 'N/A';
    
    const peStatus = document.getElementById('pe-status');
    const peRatio = p.fundamentals.pe_ratio;
    const medianPe = p.pe_bands ? p.pe_bands.median_pe : null;
    const peLaymanTextEl = document.getElementById('pe-layman-text');
    
    if (peRatio !== null && peRatio !== undefined && medianPe) {
        const peDiff = ((peRatio - medianPe) / medianPe) * 100.0;
        peStatus.innerText = `${peDiff > 0 ? '+' : ''}${peDiff.toFixed(1)}% ${peDiff > 0 ? 'Premium' : 'Discount'}`;
        peStatus.className = peDiff <= 0 ? 'green-text' : 'red-text';
        
        if (peLaymanTextEl) {
            if (peDiff <= 0) {
                peLaymanTextEl.innerHTML = `The stock trades at a **${Math.abs(peDiff).toFixed(1)}% statistical discount** to its 5-year historical median. Think of this as purchasing premium luxury merchandise during a seasonal clearance sale—paying lower prices for historical peak earnings quality.`;
            } else {
                peLaymanTextEl.innerHTML = `The stock trades at a **${peDiff.toFixed(1)}% statistical premium** to its 5-year historical median. Think of this as paying a surge-pricing premium for an in-demand ride during peak hours. Investors are bidding up the price, expecting robust future growth to justify the premium cost.`;
            }
        }
    } else {
        peStatus.innerText = 'N/A';
        peStatus.className = 'text-muted';
        if (peLaymanTextEl) {
            peLaymanTextEl.innerHTML = `Insufficient historical valuation bandwidth data. Keep monitoring relative sector valuations and general market cycles.`;
        }
    }
    
    const selectAllCheckbox = document.getElementById('peer-select-all-checkbox');
    if (selectAllCheckbox) {
        selectAllCheckbox.checked = true;
    }
    const peerBody = document.getElementById('peer-table-body');
    peerBody.innerHTML = '';
    if (p.peers && p.peers.length > 0) {
        p.peers.forEach(peer => {
            const tr = document.createElement('tr');
            
            // Safe string clean and formatting for percentages
            const divYield = (peer["Div Yield %"] || peer["Div Yield"] || "N/A").toString().replace('%', '');
            const pbRatio = (peer["P/B"] || peer["PB"] || "N/A").toString().replace('%', '');
            const debtEquity = (peer["Debt to Equity"] || peer["Debt/Equity"] || peer["Debt/Eq"] || "N/A").toString().replace('%', '');
            const roce = (peer["ROCE %"] || peer["ROCE"] || "N/A").toString().replace('%', '');
            const roe = (peer["ROE %"] || peer["ROE"] || "N/A").toString().replace('%', '');
            const npm = (peer["NPM %"] || peer["NPM"] || "N/A").toString().replace('%', '');
            const profitQtr = (peer["Profit Qtr YoY %"] || peer["Profit Qtr YoY"] || peer["Qtr Profit Var %"] || "N/A").toString().replace('%', '');
            const salesQtr = (peer["Sales Qtr YoY %"] || peer["Sales Qtr YoY"] || "N/A").toString().replace('%', '');
            
            tr.innerHTML = `
                <td style="text-align: center; width: 50px;">
                    <input type="checkbox" class="peer-select-checkbox" data-ticker="${peer["Name"] || peer["Company"]}" checked style="cursor: pointer; transform: scale(1.15);">
                </td>
                <td><strong class="peer-name-click" style="color: var(--neon-blue); cursor: pointer;" title="Click to load workspace for this peer company">${peer["Name"] || peer["Company"] || "Peer"}</strong></td>
                <td>${peer["P/E"] || "N/A"}</td>
                <td>${peer["Mar Cap"] || "N/A"}</td>
                <td>${pbRatio}</td>
                <td>${debtEquity}</td>
                <td>${roce}${roce !== 'N/A' ? '%' : ''}</td>
                <td>${roe}${roe !== 'N/A' ? '%' : ''}</td>
                <td>${npm}${npm !== 'N/A' ? '%' : ''}</td>
                <td>${profitQtr}${profitQtr !== 'N/A' ? '%' : ''}</td>
                <td>${divYield}${divYield !== 'N/A' ? '%' : ''}</td>
                <td>${salesQtr}${salesQtr !== 'N/A' ? '%' : ''}</td>
            `;
            
            // Stop event propagation when clicking the checkbox to avoid workspace reload triggers
            const checkbox = tr.querySelector('.peer-select-checkbox');
            checkbox.addEventListener('click', (e) => {
                e.stopPropagation();
            });

            // Bind click to company name row only
            tr.querySelector('.peer-name-click').addEventListener('click', (e) => {
                e.stopPropagation();
                const peerName = peer["Name"] || peer["Company"];
                if (peerName) {
                    const cleanName = peerName.replace(/\(Target\)/gi, '').trim();
                    loadStockAnalyzer(cleanName);
                }
            });

            peerBody.appendChild(tr);
        });
    } else {
        peerBody.innerHTML = `<tr><td colspan="12" class="center-text text-muted">No peer companies retrieved from Screener.</td></tr>`;
    }
    
    // Dynamically calculate Sector Median P/E and relative premium/discount summaries
    const peValues = [];
    const targetPe = p.fundamentals.pe_ratio;
    if (targetPe) {
        peValues.push(targetPe);
    }
    if (p.peers && p.peers.length > 0) {
        p.peers.forEach(peer => {
            const peRaw = peer["P/E"] || peer["PE"];
            if (peRaw && peRaw !== "N/A" && peRaw !== "--") {
                const peVal = parseFloat(peRaw);
                if (!isNaN(peVal)) {
                    peValues.push(peVal);
                }
            }
        });
    }
    
    let sectorMedianPe = null;
    if (peValues.length > 0) {
        peValues.sort((a, b) => a - b);
        const half = Math.floor(peValues.length / 2);
        if (peValues.length % 2 !== 0) {
            sectorMedianPe = peValues[half];
        } else {
            sectorMedianPe = (peValues[half - 1] + peValues[half]) / 2.0;
        }
    }
    
    const peersSummaryBlock = document.getElementById('peers-summary-block');
    const peersSummaryText = document.getElementById('peers-summary-text');
    if (peersSummaryBlock && peersSummaryText) {
        if (targetPe && sectorMedianPe) {
            peersSummaryBlock.style.display = 'block';
            const peDiff = ((targetPe - sectorMedianPe) / sectorMedianPe) * 100.0;
            let rating = "aligned with sector averages";
            let premiumAnalogy = `trading completely in-line with the sector peer median of **${sectorMedianPe.toFixed(1)}** (current P/E of **${targetPe.toFixed(1)}**). Think of this as purchasing standard premium merchandise at its fair market list price.`;
            
            if (peDiff >= 15.0) {
                rating = "trading at a relative premium";
                premiumAnalogy = `trading at a **${peDiff.toFixed(1)}% premium** compared to its sector peers (active P/E of **${targetPe.toFixed(1)}** vs peer median of **${sectorMedianPe.toFixed(1)}**). Think of this as paying a markup for a certified brand-name phone compared to generic competitors—investors are bidding up the price, expecting superior earnings quality to justify the premium cost.`;
            } else if (peDiff <= -15.0) {
                rating = "trading at a relative discount";
                premiumAnalogy = `trading at a **${Math.abs(peDiff).toFixed(1)}% discount** compared to its sector peers (active P/E of **${targetPe.toFixed(1)}** vs peer median of **${sectorMedianPe.toFixed(1)}**). Think of this as purchasing high-quality merchandise during a premium clearance sale—paying lower prices for standard operational earnings power.`;
            }
            peersSummaryText.innerHTML = `⚔️ **Sector Valuation Assessment:** The stock is **${rating}** relative to its peer group.<br><br>💡 **Layman Analogy:** ${premiumAnalogy}`;
        } else {
            peersSummaryBlock.style.display = 'none';
        }
    }
    
    // Populate shareholding statistics grid pills
    document.getElementById('sh-promoter').innerText = `${(p.shareholding.Promoter || p.shareholding["Promoters"] || 50.0).toFixed(1)}%`;
    document.getElementById('sh-fii').innerText = `${(p.shareholding.FIIs || p.shareholding["FII"] || 15.0).toFixed(1)}%`;
    document.getElementById('sh-dii').innerText = `${(p.shareholding.DIIs || p.shareholding["DII"] || 15.0).toFixed(1)}%`;
    document.getElementById('sh-public').innerText = `${(p.shareholding.Public || p.shareholding["Public"] || 20.0).toFixed(1)}%`;
    
    const pledgePercentage = p.shareholding["Promoter Pledging %"] || 0.0;
    const pledgeAlert = document.getElementById('pledge-alert-box');
    const pledgeText = document.getElementById('pledge-percentage-text');
    
    pledgeText.innerText = `${pledgePercentage.toFixed(1)}% Pledged shares (${pledgePercentage > 5.0 ? 'Risk flagged' : 'Low Risk'})`;
    
    if (pledgePercentage > 5.0) {
        pledgeAlert.style.borderLeft = '3.5px solid var(--color-crimson)';
        pledgeAlert.style.background = 'rgba(239, 68, 68, 0.04)';
        pledgeAlert.querySelector('.alert-icon').innerText = '⚠️';
        pledgeAlert.querySelector('.alert-icon').style.color = 'var(--color-crimson)';
    } else {
        pledgeAlert.style.borderLeft = '3.5px solid var(--color-emerald)';
        pledgeAlert.style.background = 'rgba(16, 185, 129, 0.04)';
        pledgeAlert.querySelector('.alert-icon').innerText = '✓';
        pledgeAlert.querySelector('.alert-icon').style.color = 'var(--color-emerald)';
    }
    
    // Synthesize Promoter Skin-in-the-game and Institutional backing analogies
    const shLaymanEl = document.getElementById('shareholding-layman-text');
    if (shLaymanEl) {
        const promoterHold = p.shareholding.Promoter || p.shareholding["Promoters"] || 50.0;
        const instHold = (p.shareholding.FIIs || p.shareholding["FII"] || 15.0) + (p.shareholding.DIIs || p.shareholding["DII"] || 15.0);
        
        let promoterAnalogy = "Promoters have standard operational interest.";
        if (promoterHold >= 65.0) {
            promoterAnalogy = `With **${promoterHold.toFixed(1)}%** promoter holdings, skin-in-the-game is exceptionally high. Think of this as a restaurant where the head chef eats their own food every single day—they have massive personal incentives to ensure ultimate quality.`;
        } else if (promoterHold >= 50.0) {
            promoterAnalogy = `With **${promoterHold.toFixed(1)}%** promoter holdings, the founders retain absolute voting control. Think of this as a family-run business where the builders have long-term structural commitment to the brand.`;
        } else if (promoterHold < 35.0) {
            promoterAnalogy = `With promoter holdings at a low **${promoterHold.toFixed(1)}%**, control is highly diversified. Think of this as a public corporation run by professional managers rather than committed founders.`;
        }
        
        let instAnalogy = "Institutional smart-money represents standard backing.";
        if (instHold >= 30.0) {
            instAnalogy = `FII & DII holdings stand at **${instHold.toFixed(1)}%**, indicating a massive institutional floor. Smart-money backing creates a solid pricing support floor, similar to high-profile venture capitalists funding a project.`;
        } else if (instHold < 10.0) {
            instAnalogy = `Institutional backing is sparse at **${instHold.toFixed(1)}%**, meaning retail traders represent the core liquidity. This can lead to higher short-term price volatility.`;
        }
        
        let pledgingAnalogy = "Promoter shares are fully unpledged, representing clean corporate governance.";
        if (pledgePercentage >= 15.0) {
            pledgingAnalogy = `Critically, promoters have pledged **${pledgePercentage.toFixed(1)}%** of their stock as debt collateral. Think of this as putting your house up as mortgage collateral to fund a risky business—if the stock price crashes, lenders can sell shares, triggering severe panic.`;
        } else if (pledgePercentage > 0.0) {
            pledgingAnalogy = `Promoters have pledged a minor **${pledgePercentage.toFixed(1)}%** of their stock as debt collateral, representing low systemic risk.`;
        }
        
        // Update shareholding summary left border color based on pledging risk
        const shLaymanBlock = document.getElementById('shareholding-layman-block');
        if (shLaymanBlock) {
            if (pledgePercentage >= 15.0) {
                shLaymanBlock.style.borderLeft = '2.5px solid var(--color-crimson)';
                shLaymanBlock.style.background = 'rgba(239, 68, 68, 0.03)';
            } else if (pledgePercentage > 5.0) {
                shLaymanBlock.style.borderLeft = '2.5px solid var(--color-amber)';
                shLaymanBlock.style.background = 'rgba(245, 158, 11, 0.03)';
            } else {
                shLaymanBlock.style.borderLeft = '2.5px solid var(--color-emerald)';
                shLaymanBlock.style.background = 'rgba(16, 185, 129, 0.03)';
            }
        }
        
        shLaymanEl.innerHTML = `🛡️ **Institutional Synopsis:** FII & DII holdings account for **${instHold.toFixed(1)}%** of liquidity.<br><br>💡 **Layman Analogy:** ${promoterAnalogy} ${instAnalogy}<br><br>⚠️ **Solvency Warning:** ${pledgingAnalogy}`;
    }
    
    const growthList = document.getElementById('cio-growth-drivers-list');
    if (growthList) {
        growthList.innerHTML = '';
        if (p.analysis.key_growth_drivers && p.analysis.key_growth_drivers.length > 0) {
            p.analysis.key_growth_drivers.forEach((driver, idx) => {
                const row = document.createElement('div');
                row.className = 'catalyst-row';
                row.style.display = 'flex';
                row.style.gap = '12px';
                row.style.alignItems = 'flex-start';
                row.style.padding = '10px 12px';
                row.style.background = 'rgba(16, 185, 129, 0.02)';
                row.style.border = '1px solid var(--border-glass)';
                row.style.borderLeft = '3.5px solid var(--neon-green)';
                row.style.borderRadius = '6px';
                row.style.marginBottom = '10px';
                row.style.boxShadow = '0 2px 4px rgba(0,0,0,0.05)';
                
                const icons = ['🚀', '💡', '📈', '🔥'];
                const icon = icons[idx % icons.length];
                
                row.innerHTML = `<span style="font-size:16px; margin-top:2px;">${icon}</span> <span style="font-size:11.5px; color:var(--text-primary); line-height:1.45;">${driver}</span>`;
                growthList.appendChild(row);
            });
        } else {
            growthList.innerHTML = '<div style="padding: 10px; font-size: 11px; color: var(--text-secondary); text-align: center;">No growth catalysts identified.</div>';
        }
    }
    
    const riskList = document.getElementById('cio-risks-list');
    if (riskList) {
        riskList.innerHTML = '';
        if (p.analysis.major_risks && p.analysis.major_risks.length > 0) {
            p.analysis.major_risks.forEach((risk, idx) => {
                const row = document.createElement('div');
                row.className = 'risk-row';
                row.style.display = 'flex';
                row.style.gap = '12px';
                row.style.alignItems = 'flex-start';
                row.style.padding = '10px 12px';
                row.style.background = 'rgba(239, 68, 68, 0.02)';
                row.style.border = '1px solid var(--border-glass)';
                row.style.borderLeft = '3.5px solid var(--neon-red)';
                row.style.borderRadius = '6px';
                row.style.marginBottom = '10px';
                row.style.boxShadow = '0 2px 4px rgba(0,0,0,0.05)';
                
                const icons = ['🚨', '⚠️', '💸', '⚡'];
                const icon = icons[idx % icons.length];
                
                row.innerHTML = `<span style="font-size:16px; margin-top:2px;">${icon}</span> <span style="font-size:11.5px; color:var(--text-primary); line-height:1.45;">${risk}</span>`;
                riskList.appendChild(row);
            });
        } else {
            riskList.innerHTML = '<div style="padding: 10px; font-size: 11px; color: var(--text-secondary); text-align: center;">No risk vectors flagged.</div>';
        }
    }
    
    const newsFeed = document.getElementById('news-feed-container');
    if (newsFeed) {
        newsFeed.innerHTML = '';
        if (p.news && p.news.length > 0) {
            p.news.forEach(item => {
                const card = document.createElement('a');
                card.className = 'news-card';
                
                // Safeguard to prevent opening internal dev server URLs
                let finalLink = item.link;
                if (!finalLink || finalLink.trim() === '#' || finalLink.trim() === '') {
                    finalLink = `https://finance.yahoo.com/quote/${p.ticker}/news`;
                }
                card.href = finalLink;
                card.target = '_blank';
                
                // Simple sentiment analyzer based on words
                const tLower = item.title.toLowerCase();
                let sentimentText = "NEUTRAL";
                let sentimentColor = "var(--text-muted)";
                let borderLeftColor = "rgba(255, 255, 255, 0.1)";
                let bgTint = "rgba(255, 255, 255, 0.02)";
                
                const positiveWords = ["gain", "growth", "jump", "beat", "high", "surge", "rise", "record", "profit", "buy", "strong", "success", "expand", "expansion", "up", "bull", "outperform", "cagr", "dividend", "order", "win"];
                const negativeWords = ["drop", "fall", "sink", "lower", "plunge", "miss", "loss", "decline", "warn", "debt", "down", "bear", "sell", "audit", "risk", "probe", "investigate", "alert", "pledge", "concern"];
                
                let isPos = positiveWords.some(w => tLower.includes(w));
                let isNeg = negativeWords.some(w => tLower.includes(w));
                
                if (isPos && !isNeg) {
                    sentimentText = "🟢 BULLISH";
                    sentimentColor = "var(--neon-green)";
                    borderLeftColor = "var(--neon-green)";
                    bgTint = "rgba(0, 200, 115, 0.03)";
                } else if (isNeg) {
                    sentimentText = "🔴 BEARISH";
                    sentimentColor = "var(--neon-red)";
                    borderLeftColor = "var(--neon-red)";
                    bgTint = "rgba(255, 75, 75, 0.03)";
                }
                
                card.style.borderLeft = `3.5px solid ${borderLeftColor}`;
                card.style.background = bgTint;
                card.style.boxShadow = "0 4px 6px rgba(0,0,0,0.15)";
                card.style.borderRadius = "8px";
                card.style.padding = "15px";
                card.style.display = "flex";
                card.style.flexDirection = "column";
                card.style.justifyContent = "space-between";
                card.style.transition = "all 0.2s ease";
                card.style.textDecoration = "none";
                card.style.color = "inherit";
                card.style.minHeight = "110px";
                
                card.innerHTML = `
                    <div>
                        <span style="font-size: 8px; color: ${sentimentColor}; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; display: block; margin-bottom: 6px;">${sentimentText}</span>
                        <div class="news-title" style="font-size:12px; font-weight:600; line-height:1.4; color:var(--text-primary);">${item.title}</div>
                    </div>
                    <div class="news-footer" style="display:flex; justify-content:space-between; align-items:center; margin-top:12px; font-size:10px; color:var(--text-muted);">
                        <span style="font-weight:500;">📰 ${item.publisher}</span>
                        <span>🕒 ${item.date}</span>
                    </div>
                `;
                newsFeed.appendChild(card);
            });
        } else {
            newsFeed.innerHTML = '<div style="padding:20px; text-align: center; width: 100%; color: var(--text-muted);">No recent financial news articles found.</div>';
        }
    }
    
    // Initial fetch of the default chart duration (1 year daily)
    fetchAndRenderChart();
    
    // Render dynamic additions (Sensitivity Matrix & Consensus Comparator)
    renderDCFSensitivityMatrix(p);
    renderStreetConsensusComparator(p);
    
    // Render Feature Mega-Upgrade features
    renderEarningsQuality(p);
    loadDrawdownChart(p.ticker, '1y');
    
    // Render Interactive Market Capture Diagnostics (default 3Y)
    updateInteractiveCaptureCard(p, 3);
    
    // Render In-Place Peer Performance Comparison Chart (initial load)
    updatePeerComparisonChart();
    
    // Render the new AI Strategical Audit & Gate Diagnostics Matrix
    renderStrategyAuditMatrix(p.ticker);

    // Render CAPM Risk Analytics (Alpha & Beta)
    if (window.loadRiskFactorsData) {
        window.loadRiskFactorsData(p.ticker);
    }
}

async function updateInteractiveCaptureCard(p, customYears) {
    if (!p || !p.ticker) return;
    
    // Normalize customYears to standard string format
    let yearsStr = customYears.toString().toLowerCase().trim();
    if (yearsStr === "1") yearsStr = "1y";
    if (yearsStr === "3") yearsStr = "3y";
    if (yearsStr === "5") yearsStr = "5y";
    
    const periodSelect = document.getElementById('capture-period');
    if (periodSelect) {
        periodSelect.value = yearsStr;
    }
    
    const upValEl = document.getElementById('int-up-val');
    const upBarEl = document.getElementById('int-up-bar');
    const upLblEl = document.getElementById('int-up-lbl');
    const upCircleEl = document.getElementById('int-up-circle');
    
    const downValEl = document.getElementById('int-down-val');
    const downBarEl = document.getElementById('int-down-bar');
    const downLblEl = document.getElementById('int-down-lbl');
    const downCircleEl = document.getElementById('int-down-circle');
    
    const summaryEl = document.getElementById('int-capture-summary');
    
    // Visual indicators that we are loading/calculating
    if (upValEl) upValEl.innerText = '...';
    if (downValEl) downValEl.innerText = '...';
    if (upLblEl) upLblEl.innerText = 'Analyzing returns...';
    if (downLblEl) downLblEl.innerText = 'Analyzing returns...';
    if (summaryEl) summaryEl.innerText = 'Loading custom capture ratio thesis...';
    
    if (upCircleEl) {
        upCircleEl.style.strokeDashoffset = '213.6';
        upCircleEl.style.stroke = 'var(--text-muted)';
    }
    if (downCircleEl) {
        downCircleEl.style.strokeDashoffset = '213.6';
        downCircleEl.style.stroke = 'var(--text-muted)';
    }
    
    if (upBarEl) {
        upBarEl.style.width = '10%';
        upBarEl.style.background = 'var(--text-muted)';
    }
    if (downBarEl) {
        downBarEl.style.width = '10%';
        downBarEl.style.background = 'var(--text-muted)';
    }
    
    if (periodSelect) periodSelect.disabled = true;
    
    try {
        let ratios = null;
        
        // Optimization: Use pre-calculated 3Y ratios from activeStockProfile if possible
        if ((yearsStr === "3y" || yearsStr === "3") && p.capture_ratios) {
            ratios = p.capture_ratios;
        } else {
            const res = await fetch(`/api/stock/capture?symbol=${encodeURIComponent(p.ticker)}&period=${yearsStr}`);
            if (!res.ok) throw new Error("API responded with error");
            ratios = await res.json();
        }
        
        if (!ratios) throw new Error("No ratio data returned");
        
        const upCap = ratios.up_capture !== null && ratios.up_capture !== undefined ? ratios.up_capture : 100.0;
        const downCap = ratios.down_capture !== null && ratios.down_capture !== undefined ? ratios.down_capture : 100.0;
        const benchSymbol = ratios.benchmark_symbol || '^NSEI';
        const benchName = benchSymbol === '^NSEI' ? 'Nifty 50' : 'Sensex';
        
        // Render values
        if (upValEl) upValEl.innerText = `${upCap.toFixed(1)}%`;
        if (downValEl) downValEl.innerText = `${downCap.toFixed(1)}%`;
        
        // Circumference of circles is 213.6
        // Map 0% - 200% smoothly to 100% - 0% stroke-dashoffset (213.6 down to 0)
        const upCapClamped = Math.min(200.0, Math.max(0.0, upCap));
        const downCapClamped = Math.min(200.0, Math.max(0.0, downCap));
        
        const upOffset = 213.6 - (upCapClamped / 200.0) * 213.6;
        const downOffset = 213.6 - (downCapClamped / 200.0) * 213.6;
        
        let upColor = 'var(--neon-green)';
        if (upCap >= 100.0) {
            upColor = 'var(--neon-green)';
        } else if (upCap >= 80.0) {
            upColor = '#f59e0b';
        } else {
            upColor = 'var(--neon-red)';
        }
        
        let downColor = 'var(--neon-red)';
        if (downCap <= 80.0) {
            downColor = 'var(--neon-green)';
        } else if (downCap <= 100.0) {
            downColor = 'var(--text-muted)';
        } else {
            downColor = 'var(--neon-red)';
        }

        if (upCircleEl) {
            upCircleEl.style.strokeDashoffset = upOffset.toString();
            upCircleEl.style.stroke = upColor;
        }
        if (downCircleEl) {
            downCircleEl.style.strokeDashoffset = downOffset.toString();
            downCircleEl.style.stroke = downColor;
        }
        
        // Map legacy bar widths smoothly (0% - 200% maps to 5% - 100% width)
        const upWidth = Math.min(100, Math.max(5, (upCap / 200.0) * 100));
        const downWidth = Math.min(100, Math.max(5, (downCap / 200.0) * 100));
        
        if (upBarEl) {
            upBarEl.style.width = `${upWidth}%`;
            upBarEl.style.background = upColor;
        }
        if (downBarEl) {
            downBarEl.style.width = `${downWidth}%`;
            downBarEl.style.background = downColor;
        }
        
        // Labels
        if (upLblEl) {
            if (upCap >= 100.0) {
                upLblEl.innerHTML = `<span style="color:var(--neon-green); font-weight:600;">Outperforming</span> vs ${benchName}`;
            } else {
                upLblEl.innerHTML = `<span style="color:var(--text-muted); font-weight:500;">Lagging Upside</span> vs ${benchName}`;
            }
        }
        
        // Down market description matches up capture ratios bounds
        if (downLblEl) {
            if (downCap <= 80.0) {
                downLblEl.innerHTML = `<span style="color:var(--neon-green); font-weight:600;">Protected Downside</span> vs ${benchName}`;
            } else if (downCap <= 100.0) {
                downLblEl.innerHTML = `<span style="color:var(--text-muted); font-weight:500;">Index Co-movement</span> vs ${benchName}`;
            } else {
                downLblEl.innerHTML = `<span style="color:var(--neon-red); font-weight:600;">Volatile Downside</span> vs ${benchName}`;
            }
        }
        
        // Plurals-safe dynamic timeframe label
        let horizonText = `the last ${customYears} year(s)`;
        if (yearsStr === "3m") horizonText = "the last 3 months";
        else if (yearsStr === "6m") horizonText = "the last 6 months";
        else if (yearsStr === "9m") horizonText = "the last 9 months";
        else if (yearsStr === "1y") horizonText = "the last year";
        else if (yearsStr === "3y") horizonText = "the last 3 years";
        else if (yearsStr === "5y") horizonText = "the last 5 years";
        
        // Personalized Thesis Summary Text
        if (summaryEl) {
            let summaryText = "";
            let laymanDescription = "";
            
            if (upCap >= 100.0 && downCap <= 80.0) {
                summaryText = `<strong>Asymmetric Alpha (Premium Profile):</strong> Over ${horizonText}, ${p.company_name} captured ${upCap.toFixed(1)}% of the index gains while cushioning standard drawdowns to just ${downCap.toFixed(1)}%. This represents a classic asymmetric alpha asset with superior downside defense.`;
                laymanDescription = `This stock behaves like an **advanced performance sports hybrid**. It features a **high-octane outperformance engine** (upside capture of ${upCap.toFixed(1)}%) that speeds past the Nifty index during market surges, paired with an **impenetrable shock absorption shield** (downside capture of only ${downCap.toFixed(1)}%) that absorbs 80% of road bumps during downward market shocks. It offers the holy grail of high returns with strong safety.`;
            } else if (upCap >= 100.0 && downCap > 100.0) {
                summaryText = `<strong>High-Beta Momentum:</strong> Over ${horizonText}, ${p.company_name} captured ${upCap.toFixed(1)}% of the index gains but experienced highly magnified drawdowns of ${downCap.toFixed(1)}% during market declines. Suitable for aggressive growth seekers who can tolerate high short-term volatility.`;
                laymanDescription = `Think of this stock as a **turbocharged racing car without airbags**. It boasts a **massive outperformance engine** (upside capture of ${upCap.toFixed(1)}%) that leaves the index in the dust when going uphill, but has **zero downside shock shields** (downside capture of ${downCap.toFixed(1)}%), meaning you will feel every bump and crash at double the intensity when the market slides. Great for thrill-seekers, but keep your seatbelt fastened!`;
            } else if (upCap < 100.0 && downCap <= 80.0) {
                summaryText = `<strong>Defensive Stability:</strong> Over ${horizonText}, ${p.company_name} underperformed the index upside at ${upCap.toFixed(1)}% capture, but offered superb capital preservation with a low ${downCap.toFixed(1)}% downside co-movement. Fits conservative, income-oriented portfolios.`;
                laymanDescription = `This stock acts like a **heavy-armored family SUV**. Its **outperformance engine is modest** (upside capture of ${upCap.toFixed(1)}%), meaning it won't win drag races when the market climbs, but its **downside shock shield is incredibly robust** (downside capture of just ${downCap.toFixed(1)}%), neutralizing most of the market's turbulence and protecting your capital from steep drops. Perfect for a safe, smooth, stress-free journey.`;
            } else if (upCap < 100.0 && downCap > 100.0) {
                summaryText = `<strong>Unfavorable Asymmetry (Caution):</strong> Over ${horizonText}, ${p.company_name} underperformed on the upside (${upCap.toFixed(1)}% capture) while dropping faster than the index during declines (${downCap.toFixed(1)}% capture). Displays unfavorable asymmetry, presenting high relative risk.`;
                laymanDescription = `This is a **compromised vehicle with a sputtering engine and weak brakes**. It has a **weak engine** (upside capture of ${upCap.toFixed(1)}%) that lags far behind the index when going uphill, but has **no shock shields at all** (downside capture of ${downCap.toFixed(1)}%), falling faster and harder than the index when the road gets rough. Investors should handle this with extreme caution as the risk-reward math is highly unfavorable.`;
            } else {
                summaryText = `<strong>Balanced Market Tracker:</strong> Over ${horizonText}, ${p.company_name} moved in close harmony with ${benchName} (Up-Capture: ${upCap.toFixed(1)}%, Down-Capture: ${downCap.toFixed(1)}%). Core risk-return patterns mirror standard domestic stock cycles.`;
                laymanDescription = `This stock acts like a **standard commuter sedan**. Its **engine and shock shields are perfectly tuned to mimic the average traffic flow**. When the Nifty accelerates, it keeps pace (upside capture: ${upCap.toFixed(1)}%); when the market hits a pothole, it experiences the exact same bump (downside capture: ${downCap.toFixed(1)}%). It offers a balanced, standard ride that mirrors the broader index.`;
            }
            
            summaryEl.innerHTML = `
                <div style="margin-bottom: 8px;">
                    ${summaryText}
                </div>
                <div style="font-size:11px; color:var(--text-muted); line-height: 1.45; border-left: 2.5px solid var(--color-primary); padding-left: 8px; margin-top: 8px; background: rgba(59, 130, 246, 0.03); padding-top: 5px; padding-bottom: 5px; border-radius: 0 4px 4px 0; width: 100%; box-sizing: border-box;">
                    💡 <strong>Layman Translation:</strong> ${laymanDescription}
                </div>
            `;
        }
    } catch (err) {
        console.error("Error updating capture card:", err);
        if (upLblEl) upLblEl.innerText = 'Failed to load up-capture';
        if (downLblEl) downLblEl.innerText = 'Failed to load down-capture';
        if (summaryEl) summaryEl.innerHTML = '<span class="red-text">Error calculating time-horizon ratios. Stock listing history may be too short.</span>';
    } finally {
        if (periodSelect) periodSelect.disabled = false;
    }
}

let activePeerChartInstance = null;
let peerChartDebounceTimer = null;

async function updatePeerComparisonChart() {
    if (!activeStockProfile || !activeStockProfile.ticker) return;
    
    // Clear any pending debounced updates
    clearTimeout(peerChartDebounceTimer);
    
    peerChartDebounceTimer = setTimeout(async () => {
        const periodSelect = document.getElementById('peer-chart-period');
        const period = periodSelect ? periodSelect.value : '1y';
        
        // Scan checked peer checkboxes
        const checkedCheckboxes = document.querySelectorAll('.peer-select-checkbox:checked');
        const tickers = [activeStockProfile.ticker.split('.')[0]]; // Pinned target stock is core
        
        checkedCheckboxes.forEach(cb => {
            const tickerAttr = cb.getAttribute('data-ticker');
            if (tickerAttr) {
                const cleanTicker = tickerAttr.replace(/\(Target\)/gi, '').trim();
                // Filter out duplicates and target stock
                if (cleanTicker && !tickers.includes(cleanTicker) && cleanTicker !== activeStockProfile.ticker) {
                    tickers.push(cleanTicker);
                }
            }
        });
        
        const container = document.getElementById('peer-comparison-container');
        if (!container) return;
        
        // Show loading status inside the container visually
        const loadingOverlay = document.createElement('div');
        loadingOverlay.className = 'peer-chart-loading-overlay';
        loadingOverlay.style = 'position: absolute; top:0; left:0; width:100%; height:100%; background: rgba(0,0,0,0.4); display:flex; align-items:center; justify-content:center; font-size:11px; color:#fff; border-radius:4px; font-weight:500; backdrop-filter: blur(1px); z-index:10;';
        loadingOverlay.innerText = 'Syncing peer performance curves...';
        container.appendChild(loadingOverlay);
        
        try {
            const res = await fetch(`/api/stock/compare-chart?symbols=${encodeURIComponent(tickers.join(','))}&period=${period}`);
            if (!res.ok) throw new Error("Price overlay lookup failed");
            const data = await res.json();
            
            drawPeerComparisonChart(data.dates, data.series, data.benchmark_symbol);
        } catch (err) {
            console.error("Error loading peer comparison chart: ", err);
            // Display clean, small error inline
            container.innerHTML = `<canvas id="peer-comparison-chart"></canvas><div style="position: absolute; top:0; left:0; width:100%; height:100%; display:flex; align-items:center; justify-content:center; font-size:10.5px; color:var(--neon-red); text-align:center; padding:10px; font-weight:500;">Failed to compile price overlay. Peer stock histories may be too short.</div>`;
        } finally {
            const overlay = container.querySelector('.peer-chart-loading-overlay');
            if (overlay) overlay.remove();
        }
    }, 300); // 300ms premium debouncer
}

function drawPeerComparisonChart(dates, series, benchmarkSymbol) {
    const container = document.getElementById('peer-comparison-container');
    if (!container) return;

    // Check if TradingView Lightweight Charts is available
    if (typeof LightweightCharts === 'undefined') {
        console.warn("TradingView Lightweight Charts offline, falling back to Chart.js for peer comparison.");
        drawChartJSPeerComparisonChart(dates, series, benchmarkSymbol);
        return;
    }

    // Clean up previous Lightweight Peer Chart instance
    if (window.activeLightweightPeerChart) {
        window.activeLightweightPeerChart.remove();
        window.activeLightweightPeerChart = null;
    }
    
    // Clean up legacy Chart.js peer chart if exists
    if (activePeerChartInstance) {
        activePeerChartInstance.destroy();
        activePeerChartInstance = null;
    }

    container.innerHTML = ''; // Clear container for TradingView Canvas
    const isDarkTheme = document.body.getAttribute('data-theme') !== 'light';
    const legendEl = document.getElementById('peer-chart-legend');

    // 1. Create Chart
    const chart = LightweightCharts.createChart(container, {
        width: container.clientWidth,
        height: 320, // Match the index.html height of 320px!
        layout: {
            background: { type: 'solid', color: 'transparent' },
            textColor: isDarkTheme ? '#94a3b8' : '#334155',
            fontFamily: 'Inter, sans-serif',
        },
        grid: {
            vertLines: { color: isDarkTheme ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.03)' },
            horzLines: { color: isDarkTheme ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.03)' },
        },
        rightPriceScale: {
            borderColor: isDarkTheme ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
        },
        timeScale: {
            borderColor: isDarkTheme ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
            timeVisible: false,
        },
    });
    window.activeLightweightPeerChart = chart;

    const peerColors = [
        '#10b981', // Emerald Green
        '#f59e0b', // Amber/Gold
        '#a855f7', // Orchid Violet
        '#ec4899', // Rose Pink
        '#14b8a6', // Teal
        '#38bdf8'  // Light Blue
    ];
    let peerColorIdx = 0;
    const seriesLines = {};
    const seriesColors = {};
    const formattedDates = dates.map(d => d.split('T')[0]);

    // 2. Add each series
    Object.keys(series).forEach(key => {
        const isBenchmark = key === benchmarkSymbol;
        const isTarget = key === activeStockProfile.ticker;

        let strokeColor = '';
        let strokeWidth = 1.5;
        let lineStyle = LightweightCharts.LineStyle.Solid;

        if (isTarget) {
            strokeColor = '#00e5ff'; // Bright target cyan
            strokeWidth = 2.5;
        } else if (isBenchmark) {
            strokeColor = isDarkTheme ? 'rgba(255,255,255,0.45)' : 'rgba(31, 41, 55, 0.7)';
            strokeWidth = 2;
            lineStyle = LightweightCharts.LineStyle.Dashed;
        } else {
            strokeColor = peerColors[peerColorIdx % peerColors.length];
            peerColorIdx++;
        }

        seriesColors[key] = strokeColor;

        const lineSeries = chart.addLineSeries({
            color: strokeColor,
            lineWidth: strokeWidth,
            lineStyle: lineStyle,
            priceFormat: {
                type: 'custom',
                formatter: v => `${v >= 0 ? '+' : ''}${v.toFixed(1)}%`
            }
        });

        const lineData = formattedDates.map((d, idx) => ({
            time: d,
            value: series[key][idx] - 100.0 // Re-base starting point to 0.0%
        })).filter(item => item.value !== null && !isNaN(item.value));

        lineSeries.setData(lineData);
        seriesLines[key] = lineSeries;
    });

    chart.timeScale().fitContent();

    // 3. Implement Floating Crosshair HUD legend
    const updateHUD = (timeStr) => {
        if (!legendEl) return;
        const idx = formattedDates.indexOf(timeStr);
        if (idx === -1) return;

        let html = '';
        Object.keys(series).forEach(key => {
            const isBenchmark = key === benchmarkSymbol;
            const isTarget = key === activeStockProfile.ticker;
            let displayLabel = key.replace('.NS', '').replace('.BO', '');

            if (isBenchmark) {
                displayLabel = benchmarkSymbol === '^NSEI' ? 'Nifty 50' : 'Sensex';
            } else if (isTarget) {
                displayLabel = `${displayLabel} (Target)`;
            }

            const val = series[key][idx] - 100.0;
            const color = seriesColors[key];

            html += `<span style="color:${color}; font-weight:600; margin-right:12px;">
                ● ${displayLabel}: ${val >= 0 ? '+' : ''}${val.toFixed(2)}%
            </span>`;
        });
        legendEl.innerHTML = html;
    };

    // Default HUD value (latest session)
    if (formattedDates.length > 0) {
        updateHUD(formattedDates[formattedDates.length - 1]);
    }

    // Subscribe to mouse movement crosshair updates
    chart.subscribeCrosshairMove(param => {
        if (!legendEl) return;
        if (param.time) {
            const timeStr = typeof param.time === 'string' 
                ? param.time 
                : `${param.time.year}-${String(param.time.month).padStart(2,'0')}-${String(param.time.day).padStart(2,'0')}`;
            updateHUD(timeStr);
        } else {
            // Restore latest session details when cursor leaves canvas
            if (formattedDates.length > 0) {
                updateHUD(formattedDates[formattedDates.length - 1]);
            }
        }
    });

    // Resize observer alignment
    const resizeObserver = new ResizeObserver(entries => {
        for (let entry of entries) {
            chart.resize(entry.contentRect.width, 320);
        }
    });
    resizeObserver.observe(container);
    
    // Compile Peer Performance AI Summary block
    compilePeerPerformanceAISummary(series, benchmarkSymbol);
}

// Fallback legacy Chart.js drawer
function drawChartJSPeerComparisonChart(dates, series, benchmarkSymbol) {
    const container = document.getElementById('peer-comparison-container');
    if (!container) return;
    
    const restoredCanvas = getOrCreateCanvas('peer-comparison-chart', container);
    if (!restoredCanvas) return;
    
    const ctx = restoredCanvas.getContext('2d');
    
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
    const isLightTheme = currentTheme === 'light';

    const legendColor = isLightTheme ? '#1f2937' : '#94a3b8';
    const tickColor = isLightTheme ? '#4b5563' : '#64748b';
    const gridColor = isLightTheme ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.03)';
    const benchmarkColor = isLightTheme ? 'rgba(31, 41, 55, 0.7)' : 'rgba(255, 255, 255, 0.45)';

    const peerColors = ['#10b981', '#f59e0b', '#a855f7', '#ec4899', '#14b8a6', '#38bdf8'];
    const datasets = [];
    let peerColorIdx = 0;
    
    Object.keys(series).forEach(key => {
        const isBenchmark = key === benchmarkSymbol;
        const isTarget = key === activeStockProfile.ticker;
        
        let labelName = key.replace('.NS', '').replace('.BO', '');
        if (isBenchmark) {
            labelName = benchmarkSymbol === '^NSEI' ? 'Nifty 50 (Index)' : 'Sensex (Index)';
        } else if (isTarget) {
            labelName = `${labelName} (Target)`;
        }
        
        let strokeColor = '';
        let strokeWidth = 1.5;
        let borderDash = [];
        
        if (isTarget) {
            strokeColor = '#00e5ff';
            strokeWidth = 2.5;
        } else if (isBenchmark) {
            strokeColor = benchmarkColor;
            strokeWidth = 2;
            borderDash = [5, 5];
        } else {
            strokeColor = peerColors[peerColorIdx % peerColors.length];
            peerColorIdx++;
        }
        
        datasets.push({
            label: labelName,
            data: series[key],
            borderColor: strokeColor,
            borderWidth: strokeWidth,
            borderDash: borderDash,
            fill: false,
            tension: 0.25,
            pointRadius: 0,
            pointHoverRadius: 4
        });
    });
    
    activePeerChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: dates,
            datasets: datasets
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                tooltip: {
                    mode: 'index',
                    intersect: false,
                    callbacks: {
                        label: function(context) {
                            const val = context.parsed.y;
                            const pct = val - 100.0;
                            return `${context.dataset.label}: ${pct >= 0 ? '+' : ''}${pct.toFixed(2)}% (${val.toFixed(1)})`;
                        }
                    }
                },
                legend: {
                    position: 'top',
                    labels: {
                        color: legendColor,
                        boxWidth: 8,
                        boxHeight: 8,
                        padding: 8,
                        font: { size: 9, weight: 500 }
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: gridColor },
                    ticks: { color: tickColor, font: { size: 8 } }
                },
                y: {
                    grid: { color: gridColor },
                    ticks: { 
                        color: tickColor, 
                        font: { size: 8 },
                        callback: function(value) {
                            const pct = value - 100;
                            return `${pct >= 0 ? '+' : ''}${pct}%`;
                        }
                    }
                }
            }
        }
    });
    
    // Compile Peer Performance AI Summary block
    compilePeerPerformanceAISummary(series, benchmarkSymbol);
}

function compilePeerPerformanceAISummary(series, benchmarkSymbol) {
    if (!activeStockProfile || !activeStockProfile.ticker) return;

    const returns = {};
    Object.keys(series).forEach(key => {
        const dataArr = series[key];
        if (dataArr && dataArr.length > 0) {
            const finalVal = dataArr[dataArr.length - 1];
            // Cumulative return = final value - 100.0
            returns[key] = finalVal - 100.0;
        }
    });

    const targetTicker = activeStockProfile.ticker;
    const targetReturn = returns[targetTicker] !== undefined ? returns[targetTicker] : 0.0;
    
    // Core default colors
    const colorsList = ['#10b981', '#f59e0b', '#a855f7', '#ec4899', '#14b8a6', '#38bdf8'];
    let colorIdx = 0;
    const seriesColors = {};
    Object.keys(series).forEach(key => {
        if (key === targetTicker) {
            seriesColors[key] = '#00e5ff';
        } else if (key === benchmarkSymbol) {
            seriesColors[key] = '#94a3b8';
        } else {
            seriesColors[key] = colorsList[colorIdx % colorsList.length];
            colorIdx++;
        }
    });

    // Filter out benchmark symbol from rankings
    const peerReturns = Object.keys(returns)
        .filter(key => key !== targetTicker && key !== benchmarkSymbol)
        .map(key => ({ ticker: key, ret: returns[key] }));
        
    const allReturns = [{ ticker: targetTicker, ret: targetReturn }, ...peerReturns];
    allReturns.sort((a, b) => b.ret - a.ret); // descending order of return
    
    const targetRank = allReturns.findIndex(item => item.ticker === targetTicker) + 1;
    const totalItems = allReturns.length;
    
    let summaryHtml = '';
    
    summaryHtml += '<div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px; align-items: start; margin-top: 5px;">';
    
    // Column 1: Standing
    summaryHtml += '  <div style="background: rgba(0, 0, 0, 0.2); padding: 12px; border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.04);">';
    summaryHtml += '    <div style="font-size: 10px; font-weight: 700; color: #ffffff; letter-spacing: 0.04em; margin-bottom: 8px; text-transform: uppercase;">Momentum Standing Table</div>';
    
    allReturns.forEach((item, index) => {
        const isTarget = item.ticker === targetTicker;
        const color = seriesColors[item.ticker] || '#ffffff';
        const boldStyle = isTarget ? 'font-weight: 700;' : 'font-weight: 500;';
        const bgStyle = isTarget ? 'background: rgba(0, 229, 255, 0.05);' : '';
        const rankMedal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `[${index + 1}]`;
        const cleanTicker = item.ticker.replace('.NS', '').replace('.BO', '');
        
        summaryHtml += `    <div style="display: flex; justify-content: space-between; align-items: center; font-size: 10.5px; padding: 4px 8px; border-radius: 4px; margin-bottom: 4px; ${bgStyle}">`;
        summaryHtml += `      <span style="color: ${color}; ${boldStyle}">${rankMedal} ${cleanTicker} ${isTarget ? '(Target)' : ''}</span>`;
        summaryHtml += `      <strong style="color: ${item.ret >= 0 ? '#10b981' : '#ef4444'};">${item.ret >= 0 ? '+' : ''}${item.ret.toFixed(2)}%</strong>`;
        summaryHtml += `    </div>`;
    });
    summaryHtml += '  </div>';
    
    // Column 2: Metaphor
    summaryHtml += '  <div style="background: rgba(0, 0, 0, 0.2); padding: 12px; border-radius: 8px; border: 1px solid rgba(255, 255, 255, 0.04); display: flex; flex-direction: column; justify-content: space-between; height: 100%; min-height: 120px;">';
    summaryHtml += '    <div>';
    summaryHtml += '      <div style="font-size: 10px; font-weight: 700; color: #ffffff; letter-spacing: 0.04em; margin-bottom: 6px; text-transform: uppercase;">🚴 PEER RACE SYNOPIS (Layman Metaphor)</div>';
    
    let raceMetaphor = '';
    const cleanTargetTicker = targetTicker.replace('.NS', '').replace('.BO', '');
    if (targetRank === 1) {
        raceMetaphor = `**Target stock leads the race:** Think of this as a marathon where **${cleanTargetTicker}** has broken away from the pack. It has superior wind resistance and pacing, leaving rivals struggling to keep up with its superior operational stride over this period.`;
    } else if (targetRank === totalItems) {
        raceMetaphor = `**Target stock trails the race:** Think of this as a race where **${cleanTargetTicker}** has fallen behind due to strong headwinds or mechanical friction (e.g. margin compression or growth friction). It needs to optimize its gearing to catch up with the leaders.`;
    } else {
        raceMetaphor = `**Target stock is in the peloton:** Think of this as a bicycle race where **${cleanTargetTicker}** is riding comfortably in the middle of the pack. It is saving energy by drafting behind the front-runners, waiting for a fresh catalyst to launch a breakaway.`;
    }
    
    summaryHtml += `      <p style="font-size: 10.5px; color: var(--text-muted); line-height: 1.5; margin: 0; font-family: 'Inter', sans-serif;">${raceMetaphor}</p>`;
    summaryHtml += '    </div>';
    summaryHtml += '  </div>';
    summaryHtml += '</div>';

    const textEl = document.getElementById('peer-performance-summary-text');
    if (textEl) {
        textEl.innerHTML = summaryHtml;
    }
    const blockEl = document.getElementById('peer-performance-summary-block');
    if (blockEl) {
        blockEl.style.display = 'block';
    }
}

async function renderStrategyAuditMatrix(ticker) {
    const horizon = document.getElementById('profile-horizon')?.value || 'Long-term (3+ years)';
    const risk = document.getElementById('profile-risk')?.value || 'Moderate';
    
    // Set ticker badge
    const badge = document.getElementById('audit-ticker-badge');
    if (badge) badge.innerText = ticker;
    
    const colBottomUp = document.getElementById('audit-col-bottom_up');
    const colHybrid = document.getElementById('audit-col-hybrid');
    const colTopDown = document.getElementById('audit-col-top_down');
    
    if (colBottomUp) colBottomUp.innerHTML = '<div style="font-size:11px; color:var(--text-muted); text-align:center; padding:10px;">Loading...</div>';
    if (colHybrid) colHybrid.innerHTML = '<div style="font-size:11px; color:var(--text-muted); text-align:center; padding:10px;">Loading...</div>';
    if (colTopDown) colTopDown.innerHTML = '<div style="font-size:11px; color:var(--text-muted); text-align:center; padding:10px;">Loading...</div>';
    
    try {
        const response = await fetch(`/api/stock/audit?symbol=${encodeURIComponent(ticker)}&horizon=${encodeURIComponent(horizon)}&risk=${encodeURIComponent(risk)}`);
        if (!response.ok) throw new Error("Failed to load audit matrix.");
        const data = await response.json();
        activeAuditMatrixData = data;
        
        if (colBottomUp) colBottomUp.innerHTML = '';
        if (colHybrid) colHybrid.innerHTML = '';
        if (colTopDown) colTopDown.innerHTML = '';
        
        const styleNames = {
            "all": "All Styles",
            "value": "Value Style",
            "growth": "Growth Style",
            "contra": "Contra Style"
        };
        
        data.combinations.forEach(combo => {
            const cell = document.createElement('div');
            cell.className = 'audit-cell';
            cell.style.cursor = 'pointer';
            cell.style.padding = '12px 14px';
            cell.style.borderRadius = '8px';
            cell.style.border = '1px solid var(--border-glass)';
            cell.style.display = 'flex';
            cell.style.justifyContent = 'space-between';
            cell.style.alignItems = 'center';
            cell.style.background = combo.passed ? 'var(--audit-pass-bg)' : 'var(--audit-fail-bg)';
            cell.style.transition = 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)';
            
            cell.addEventListener('mouseenter', () => {
                cell.style.transform = 'translateY(-2px) scale(1.01)';
                cell.style.background = combo.passed ? 'var(--audit-pass-bg-hover)' : 'var(--audit-fail-bg-hover)';
                cell.style.borderColor = combo.passed ? 'var(--audit-pass-border-hover)' : 'var(--audit-fail-border-hover)';
                cell.style.boxShadow = combo.passed ? '0 4px 15px rgba(16, 185, 129, 0.12)' : '0 4px 15px rgba(239, 68, 68, 0.1)';
            });
            cell.addEventListener('mouseleave', () => {
                cell.style.transform = 'none';
                cell.style.background = combo.passed ? 'var(--audit-pass-bg)' : 'var(--audit-fail-bg)';
                cell.style.borderColor = 'var(--border-glass)';
                cell.style.boxShadow = 'none';
            });
            
            const titleSpan = document.createElement('span');
            titleSpan.style.fontSize = '11px';
            titleSpan.style.fontWeight = '600';
            titleSpan.style.color = 'var(--text-primary)';
            titleSpan.style.fontFamily = "'Outfit', sans-serif";
            titleSpan.style.letterSpacing = '0.02em';
            titleSpan.innerText = styleNames[combo.style] || combo.style;
            
            const statusSpan = document.createElement('span');
            statusSpan.className = 'badge-rec';
            statusSpan.style.fontSize = '9px';
            statusSpan.style.padding = '3px 8px';
            statusSpan.style.borderRadius = '5px';
            statusSpan.style.fontWeight = '700';
            statusSpan.style.letterSpacing = '0.04em';
            statusSpan.style.border = '1px solid';
            
            if (combo.passed) {
                statusSpan.style.background = 'rgba(16, 185, 129, 0.12)';
                statusSpan.style.color = '#10B981';
                statusSpan.style.borderColor = 'rgba(16, 185, 129, 0.3)';
                statusSpan.innerText = `🟢 PASS (${combo.score})`;
            } else {
                statusSpan.style.background = 'rgba(239, 68, 68, 0.12)';
                statusSpan.style.color = '#EF4444';
                statusSpan.style.borderColor = 'rgba(239, 68, 68, 0.3)';
                statusSpan.innerText = '🔴 FAIL';
            }
            
            cell.appendChild(titleSpan);
            cell.appendChild(statusSpan);
            
            // Wire click event to show full detail breakdown in description panel
            cell.addEventListener('click', () => {
                const expTitle = document.getElementById('audit-explain-title');
                const expDesc = document.getElementById('audit-explain-desc');
                const panel = document.getElementById('audit-explanation-panel');
                
                // Calculate gate compliance rate
                const totalGates = combo.gates ? combo.gates.length : 0;
                const passedGates = combo.gates ? combo.gates.filter(g => g.passed).length : 0;
                const passRate = totalGates > 0 ? (passedGates / totalGates) : 0;
                
                if (panel) {
                    // Update dynamically depending on selected cell pass rate
                    let accentColor = 'var(--color-crimson)';
                    let glowBg = 'rgba(239, 68, 68, 0.02)';
                    if (passRate >= 0.8) {
                        accentColor = '#10B981'; // emerald green
                        glowBg = 'rgba(16, 185, 129, 0.03)';
                    } else if (passRate >= 0.5) {
                        accentColor = '#F59E0B'; // amber gold
                        glowBg = 'rgba(245, 158, 11, 0.03)';
                    }
                    panel.style.background = glowBg;
                    panel.style.borderLeft = `4px solid ${accentColor}`;
                }
                
                if (expTitle) {
                    const stratText = combo.strategy === "bottom_up" ? "Bottom-Up" : combo.strategy === "hybrid" ? "Hybrid" : "Top-Down";
                    const styleText = styleNames[combo.style] || combo.style;
                    const actionBadge = combo.passed 
                        ? `<span style="background: rgba(16, 185, 129, 0.15); color: #10B981; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 700; border: 1px solid rgba(16,185,129,0.3); margin-left: 8px;">${combo.action}</span>` 
                        : `<span style="background: rgba(239, 68, 68, 0.15); color: #EF4444; padding: 2px 6px; border-radius: 4px; font-size: 10px; font-weight: 700; border: 1px solid rgba(239,68,68,0.3); margin-left: 8px;">EXCLUDED</span>`;
                    expTitle.innerHTML = `🔎 <span style="color:var(--text-primary); font-weight:700;">${stratText} Strategy + ${styleText}</span> Checklist Diagnostic ${actionBadge}`;
                }
                
                if (expDesc) {
                    let html = '';
                    
                    // Show final score calculation in 2-column widescreen layout
                    html += '<div style="display: grid; grid-template-columns: 1.2fr 0.8fr; gap: 15px; margin-bottom: 15px; align-items: start;">';
                    
                    // Column 1: Score progress bars
                    html += '  <div style="background: rgba(255, 255, 255, 0.015); padding: 12px; border-radius: 8px; border: 1px solid var(--border-glass);">';
                    html += '    <div style="font-size: 10px; font-weight: 700; color: var(--text-primary); letter-spacing: 0.04em; margin-bottom: 8px; text-transform: uppercase;">AI Conviction Score Parameters</div>';
                    
                    if (combo.scoring.fundamental_score !== undefined) {
                        const scores = [
                            { name: 'Fundamentals', score: combo.scoring.fundamental_score, max: 30 },
                            { name: 'Valuation', score: combo.scoring.valuation_score, max: 25 },
                            { name: 'Technicals', score: combo.scoring.technical_score, max: 25 },
                            { name: 'Growth Drivers', score: combo.scoring.growth_score, max: 15 },
                            { name: 'Sentiment & News', score: combo.scoring.sentiment_score, max: 5 }
                        ];
                        
                        scores.forEach(s => {
                            const pct = (s.score / s.max) * 100;
                            let barColor = '#EF4444'; // red
                            if (pct >= 70) {
                                barColor = '#10B981'; // emerald green
                            } else if (pct >= 40) {
                                barColor = '#F59E0B'; // amber yellow
                            }
                            
                            html += `    <div style="margin-bottom: 8px;">`;
                            html += `      <div style="display: flex; justify-content: space-between; font-size: 10px; color: var(--text-secondary); margin-bottom: 3px;">`;
                            html += `        <span>${s.name}</span>`;
                            html += `        <span style="font-weight: 600; color: var(--text-primary);">${s.score}/${s.max}</span>`;
                            html += `      </div>`;
                            html += `      <div style="height: 4px; background: rgba(255,255,255,0.08); border-radius: 2px; overflow: hidden; width: 100%;">`;
                            html += `        <div style="height: 100%; width: ${pct}%; background: ${barColor}; border-radius: 2px; transition: width 0.3s ease;"></div>`;
                            html += `      </div>`;
                            html += `    </div>`;
                        });
                    }
                    html += '  </div>';
                    
                    // Column 2: Strategy Summary Card
                    html += '  <div style="background: rgba(255, 255, 255, 0.015); padding: 12px; border-radius: 8px; border: 1px solid var(--border-glass); display: flex; flex-direction: column; justify-content: space-between; height: 100%; min-height: 165px;">';
                    html += '    <div>';
                    html += '      <div style="font-size: 10px; font-weight: 700; color: var(--text-primary); letter-spacing: 0.04em; margin-bottom: 8px; text-transform: uppercase;">Allocation Audit</div>';
                    html += `      <div style="display:flex; justify-content:space-between; font-size:10px; color:var(--text-secondary); margin-bottom:4px;">`;
                    html += `        <span>Base Strategy score:</span> <strong style="color: var(--text-primary);">${combo.scoring.base_score}/100</strong>`;
                    html += `      </div>`;
                    
                    if (combo.scoring.adjustments && combo.scoring.adjustments.length > 0) {
                        combo.scoring.adjustments.forEach(adj => {
                            const valSign = adj.value >= 0 ? `+${adj.value}` : adj.value;
                            const valColor = adj.value >= 0 ? '#10B981' : '#EF4444';
                            html += `      <div style="display:flex; justify-content:space-between; font-size:10px; color:var(--text-secondary); margin-bottom:4px;">`;
                            html += `        <span>Style adjustment (${adj.name}):</span> <strong style="color:${valColor};">${valSign}</strong>`;
                            html += `      </div>`;
                        });
                    }
                    html += '    </div>';
                    
                    // Large Final Score Badge
                    const finalColor = combo.passed ? '#10B981' : '#EF4444';
                    html += `    <div style="border-top: 1px dotted rgba(255,255,255,0.1); padding-top: 8px; margin-top: 8px; display: flex; justify-content: space-between; align-items: center;">`;
                    html += `      <span style="font-size: 10px; color: var(--text-secondary);">Final Conviction:</span>`;
                    html += `      <div style="background: rgba(255, 255, 255, 0.01); border: 1px solid var(--border-glass); border-radius: 8px; padding: 4px 10px; display: flex; align-items: center; gap: 4px;">`;
                    html += `        <span style="font-size: 14px; font-weight: 800; color: ${finalColor};">${combo.score}</span>`;
                    html += `        <span style="font-size: 9px; color: var(--text-muted);">/100</span>`;
                    html += `      </div>`;
                    html += `    </div>`;
                    html += '  </div>';
                    html += '</div>';
                    
                    // Sports/Scouting Layman Synopsis Callout Box
                    let analogyText = '';
                    let sportsTitle = '';
                    if (combo.strategy === 'bottom_up') {
                        sportsTitle = '🏃 INDIVIDUAL ATHLETE SCOUTING (Bottom-Up Analogy)';
                        analogyText = 'Individual Athlete Scouting is like selecting a world-class competitor purely based on their personal stats—speed, cardiac efficiency, and physical strength. You do not worry about the team they play for; you focus purely on their raw talent, expecting their high individual quality to shine through and win matches.';
                    } else if (combo.strategy === 'top_down') {
                        sportsTitle = '🛡️ CHAMPIONSHIP SYSTEM SCOUTING (Top-Down Analogy)';
                        analogyText = 'Championship System Scouting is like identifying a dominant, world-class system first (e.g. a premier league team with elite support structures, dieticians, and tactics), and then selecting players within that team. The environment is so strong that even average players are highly likely to succeed under this framework.';
                    } else {
                        sportsTitle = '⚡ ELITE FRANCHISE SCOUTING (Hybrid Analogy)';
                        analogyText = 'Elite Franchise Scouting is the optimal scouting design: it identifies a world-class player who possesses exceptional personal athletic metrics, and verifies they are already positioned within an elite, highly supportive championship system. This maximizes upside while minimizing operational failures.';
                    }
                    
                    const statusAnalogy = combo.passed 
                        ? 'This stock successfully satisfies all deal-breakers—the athlete is perfectly healthy and operates within a supportive tactical layout.'
                        : 'This stock introduces excessive structural risk—the player is currently carrying an active injury or the system\'s environment introduces deal-breaker hazards, leading to exclusion.';

                    html += `<div style="background: rgba(245, 158, 11, 0.02); border-left: 3px solid #F59E0B; border-radius: 4px; padding: 12px; margin-bottom: 15px; border-top: 1px solid rgba(245, 158, 11, 0.05); border-right: 1px solid rgba(245, 158, 11, 0.05); border-bottom: 1px solid rgba(245, 158, 11, 0.05);">`;
                    html += `  <div style="font-size: 10px; font-weight: 700; color: #F59E0B; margin-bottom: 4px; letter-spacing: 0.04em;">${sportsTitle}</div>`;
                    html += `  <p style="font-size: 10.5px; color: var(--text-muted); line-height: 1.55; margin: 0; margin-bottom: 6px; font-family: 'Inter', sans-serif;">${analogyText}</p>`;
                    html += `  <p style="font-size: 10.5px; color: var(--text-secondary); line-height: 1.55; margin: 0; font-weight: 500; font-family: 'Inter', sans-serif;">🔬 <span style="font-style: italic;">Status Verdict:</span> ${statusAnalogy}</p>`;
                    html += `</div>`;
                    
                    // Show Gate-by-Gate checks
                    html += '<div style="font-size:10px; font-weight:700; color:var(--text-primary); letter-spacing:0.04em; margin-bottom:8px; text-transform:uppercase;">Gate Diagnostic Checklist</div>';
                    html += '<div style="display:grid; grid-template-columns:1fr; gap:6px;">';
                    combo.gates.forEach(gate => {
                        const checkIcon = gate.passed ? '🟢 PASS' : '🔴 FAIL';
                        const checkColor = gate.passed ? '#10B981' : '#EF4444';
                        const bgTint = gate.passed ? 'rgba(16, 185, 129, 0.02)' : 'rgba(239, 68, 68, 0.02)';
                        const borderTint = gate.passed ? 'rgba(16, 185, 129, 0.12)' : 'rgba(239, 68, 68, 0.12)';
                        
                        html += `<div style="display:flex; justify-content:space-between; align-items:center; background:${bgTint}; border: 1px solid ${borderTint}; border-left: 3px solid ${checkColor}; padding:8px 12px; border-radius:6px; transition: background 0.2s;">`;
                        html += `  <div style="display: flex; flex-direction: column; gap: 2px;">`;
                        html += `    <span style="font-size: 11px; font-weight: 600; color: var(--text-primary);">${gate.name}</span>`;
                        html += `    <span style="font-size: 9.5px; color: var(--text-muted);">${gate.details}</span>`;
                        html += `  </div>`;
                        html += `  <strong style="color:${checkColor}; font-size:10px; font-family:'Outfit', sans-serif; letter-spacing:0.04em;">${checkIcon}</strong>`;
                        html += `</div>`;
                    });
                    html += '</div>';
                    
                    expDesc.innerHTML = html;
                }
            });
            
            // Append to the correct column
            if (combo.strategy === 'bottom_up' && colBottomUp) colBottomUp.appendChild(cell);
            if (combo.strategy === 'hybrid' && colHybrid) colHybrid.appendChild(cell);
            if (combo.strategy === 'top_down' && colTopDown) colTopDown.appendChild(cell);
        });
        
    } catch (err) {
        console.error("Audit matrix render error:", err);
    }
}

// 5. Dynamic Chart Fetcher (Finding 5 resolution!)
function redrawActiveChart() {
    if (!window.activeChartData) {
        console.log("APEX: No cached activeChartData. Fetching fresh series...");
        fetchAndRenderChart();
        return;
    }
    const isRSChecked = document.getElementById('toggle-rs')?.checked ?? false;
    console.log("APEX: Redrawing active chart instantly. isRSChecked:", isRSChecked);
    if (isRSChecked) {
        drawRSChartCanvas(window.activeChartData);
    } else {
        drawStockChartCanvas(window.activeChartData);
    }
}

function setupDynamicChartControls() {
    console.log("APEX: Setting up dynamic chart controls event listeners...");
    
    // Timeframe / Period / Interval / RS changes require a new network request
    document.getElementById('chart-period').addEventListener('change', () => {
        console.log("APEX: chart-period changed. Fetching new data...");
        fetchAndRenderChart();
    });
    document.getElementById('chart-interval').addEventListener('change', () => {
        console.log("APEX: chart-interval changed. Fetching new data...");
        fetchAndRenderChart();
    });
    document.getElementById('toggle-rs').addEventListener('change', () => {
        console.log("APEX: toggle-rs changed. Fetching new data...");
        fetchAndRenderChart();
    });
    
    // Visual overlays and style toggles can be redrawn instantly using cached data
    const instantRedrawElements = [
        'toggle-sma50',
        'toggle-sma200',
        'toggle-bb',
        'toggle-trendline',
        'toggle-ai-lines',
        'chart-style'
    ];
    
    instantRedrawElements.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('change', () => {
                console.log(`APEX: Control [${id}] changed. Toggling overlay instantly...`);
                redrawActiveChart();
            });
        } else {
            console.error(`APEX: Element with ID [${id}] not found in DOM!`);
        }
    });
}

async function fetchAndRenderChart() {
    if (!activeStockProfile) return;
    
    const ticker = activeStockProfile.ticker;
    const period = document.getElementById('chart-period').value;
    const interval = document.getElementById('chart-interval').value;
    
    console.log(`APEX: fetchAndRenderChart() called for ${ticker} (${period}, ${interval})`);
    
    const canvas = document.getElementById('stock-chart');
    const container = canvas?.parentElement;
    
    try {
        const isRSChecked = document.getElementById('toggle-rs')?.checked ?? false;
        let response;
        if (isRSChecked) {
            response = await fetch(`/api/relative-strength?symbol=${encodeURIComponent(ticker)}&period=${period}`);
        } else {
            response = await fetch(`/api/chart?ticker=${encodeURIComponent(ticker)}&period=${period}&interval=${interval}`);
        }
        if (!response.ok) throw new Error("Price series could not be retrieved.");
        const chartData = await response.json();
        
        window.activeChartData = chartData; // Cache the loaded data!
        console.log("APEX: Successfully fetched and cached chart data.");
        
        if (isRSChecked) {
            drawRSChartCanvas(chartData);
        } else {
            drawStockChartCanvas(chartData);
            drawVolatilityMomentumMiniCharts(chartData);
            drawFibonacciChart(activeStockProfile);
        }

        // Render dynamic price trend AI summary
        const trendSummaryEl = document.getElementById('price-trend-summary-text');
        if (trendSummaryEl && activeStockProfile) {
            const p = activeStockProfile;
            const curPrice = p.fundamentals.current_price;
            const sma50 = p.technicals.sma_50;
            const sma200 = p.technicals.sma_200;
            const trendStatus = p.technicals.trend_50_vs_200 || "Neutral";
            const breakoutDesc = p.technicals.breakout_desc || "Price currently trading inside standard range bounds.";
            
            let condition = "Consolidating Range";
            let technicalAnalystVerdict = breakoutDesc;
            let laymanExplanation = "The stock is moving sideways within a steady price channel. Buyers and sellers are in balance, waiting for a catalyst to push the price in a clear direction.";
            
            if (curPrice !== null && sma50 !== null && sma200 !== null) {
                if (curPrice >= sma50 && sma50 >= sma200) {
                    condition = "Bullish Cruising Speed";
                    technicalAnalystVerdict = `Price (Rs. ${safeFormatNumber(curPrice, 2)}) is comfortably sustained above the 50-Day SMA (Rs. ${safeFormatNumber(sma50, 2)}) and the 200-Day SMA (Rs. ${safeFormatNumber(sma200, 2)}). The structural trend is Bullish with positive moving average slope confirmation.`;
                    laymanExplanation = "The stock is driving smoothly in the fast lane of a clear highway. It has strong momentum behind it, and its major support cushions (the moving averages) are trailing right beneath it to catch any minor slips.";
                } else if (curPrice < sma50 && curPrice >= sma200) {
                    condition = "Mean Reversion Pullback";
                    technicalAnalystVerdict = `Price (Rs. ${safeFormatNumber(curPrice, 2)}) has pulled back below the 50-Day SMA (Rs. ${safeFormatNumber(sma50, 2)}) but remains structurally anchored above the 200-Day SMA (Rs. ${safeFormatNumber(sma200, 2)}). Crossover remains supportive, but short-term buying momentum has cooled.`;
                    laymanExplanation = "The stock is taking a temporary pit stop or meeting a brief traffic slowdown. While the long-term trend remains positive, it is wise to wait for the price to stop sliding and bounce off its main safety cushion (the 200-day moving average) before adding more capital.";
                } else if (curPrice < sma200 && sma50 < sma200) {
                    condition = "Bearish Downward Slope";
                    technicalAnalystVerdict = `Price (Rs. ${safeFormatNumber(curPrice, 2)}) is locked in a structural downtrend below both the 50-Day SMA (Rs. ${safeFormatNumber(sma50, 2)}) and the 200-Day SMA (Rs. ${safeFormatNumber(sma200, 2)}). Moving averages are in a Bearish state (Death Cross), indicating ongoing distribution.`;
                    laymanExplanation = "The stock is rolling down a steep hill with fading brakes. The road is muddy and slippery, and major support walls have cracked. It is highly advised to avoid buying new shares and hold defensively until a solid floor is established.";
                } else if (curPrice < sma200) {
                    condition = "Under-Shoring Transition";
                    technicalAnalystVerdict = `Price (Rs. ${safeFormatNumber(curPrice, 2)}) is trading below the 200-Day SMA (Rs. ${safeFormatNumber(sma200, 2)}) while the 50-Day SMA (Rs. ${safeFormatNumber(sma50, 2)}) is still sloping down. Watch for a potential capitulation dump or structural base building.`;
                    laymanExplanation = "The stock has slipped underneath its basement floor. It is in a dark and volatile zone. Unless you are an experienced contrarian looking for a deep-discount rebound, it is safest to watch from the sidelines until a supportive trend emerges.";
                }
            }
            
            trendSummaryEl.innerHTML = `
                <div style="margin-bottom: 8px;">
                    <strong>Indicator State:</strong> ${condition} | <strong>Trend Outlook:</strong> <span style="font-weight: 700; color: ${trendStatus === "Bullish" ? "var(--neon-green)" : "var(--neon-red)"};">${trendStatus.toUpperCase()}</span>
                </div>
                <div style="font-size:11px; color:var(--text-secondary); margin-bottom: 8px; line-height: 1.45;">
                    <strong>Analyst Verdict:</strong> ${technicalAnalystVerdict}
                </div>
                <div style="font-size:11px; color:var(--text-muted); line-height: 1.45; border-left: 2.5px solid var(--color-primary); padding-left: 8px; margin-top: 6px; background: rgba(59, 130, 246, 0.03); padding-top: 5px; padding-bottom: 5px; border-radius: 0 4px 4px 0; width: 100%; box-sizing: border-box;">
                    💡 <strong>Layman Translation:</strong> ${laymanExplanation}
                </div>
            `;
        }
    } catch (e) {
        console.error("Failed to load dynamic chart: ", e);
        if (container) {
            container.innerHTML = `<div class="chart-fallback" style="display:flex; align-items:center; justify-content:center; height:100%; font-size:12px; color:var(--text-muted); text-align:center; padding:15px; border: 1px dashed var(--border-glass); border-radius:6px; background:rgba(0,0,0,0.15);">Failed to load price chart: ${e.message}</div>`;
        }
    }
}

function getOrCreateCanvas(id, parentEl) {
    let canvas = document.getElementById(id);
    if (!canvas && parentEl) {
        parentEl.innerHTML = `<canvas id="${id}"></canvas>`;
        canvas = document.getElementById(id);
    }
    return canvas;
}

function calculateRegressionTrendline(prices) {
    const n = prices.length;
    if (n < 2) return [];
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;
    for (let i = 0; i < n; i++) {
        sumX += i;
        sumY += prices[i];
        sumXY += i * prices[i];
        sumXX += i * i;
    }
    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;
    
    const trendline = [];
    for (let i = 0; i < n; i++) {
        trendline.push(slope * i + intercept);
    }
    return trendline;
}

function drawStockChartCanvas(data) {
    const container = document.querySelector('#price-trend-chart-card .chart-container');
    if (!container) return;

    // Check if TradingView Lightweight Charts is available
    if (typeof LightweightCharts === 'undefined') {
        console.warn("TradingView Lightweight Charts offline, falling back to Chart.js.");
        drawChartJSStockChart(data); // Call legacy Chart.js drawer
        return;
    }

    // Clean up previous Lightweight Chart instance
    if (window.activeLightweightChart) {
        window.activeLightweightChart.remove();
        window.activeLightweightChart = null;
    }
    
    // Clean up Chart.js canvas if exists
    if (activeChartInstance) {
        activeChartInstance.destroy();
        activeChartInstance = null;
    }
    
    container.innerHTML = ''; // Clear container for TradingView Canvas
    const isDarkTheme = document.body.getAttribute('data-theme') !== 'light';

    // 1. Initialize TradingView Chart
    const chart = LightweightCharts.createChart(container, {
        width: container.clientWidth,
        height: 380,
        layout: {
            background: { type: 'solid', color: 'transparent' },
            textColor: isDarkTheme ? '#94a3b8' : '#334155',
            fontFamily: 'Inter, sans-serif',
        },
        grid: {
            vertLines: { color: isDarkTheme ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.03)' },
            horzLines: { color: isDarkTheme ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.03)' },
        },
        crosshair: {
            mode: LightweightCharts.CrosshairMode.Normal,
        },
        rightPriceScale: {
            borderColor: isDarkTheme ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
        },
        timeScale: {
            borderColor: isDarkTheme ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
            timeVisible: false,
        },
    });
    window.activeLightweightChart = chart;

    const showSma50 = document.getElementById('toggle-sma50')?.checked ?? true;
    const showSma200 = document.getElementById('toggle-sma200')?.checked ?? true;
    const showBB = document.getElementById('toggle-bb')?.checked ?? false;
    const showTrendline = document.getElementById('toggle-trendline')?.checked ?? true;
    const showAiLines = document.getElementById('toggle-ai-lines')?.checked ?? true;
    const chartStyle = document.getElementById('chart-style')?.value || 'line';

    console.log(`APEX: drawStockChartCanvas called. Config: [SMA50: ${showSma50}, SMA200: ${showSma200}, BB: ${showBB}, Trendline: ${showTrendline}, AI-Lines: ${showAiLines}, Style: ${chartStyle}]`);

    // 2. Add Price Series
    let priceSeries;
    const rawDates = data.dates || data.labels || [];
    const formattedDates = rawDates.map(d => d.split('T')[0]);
    
    if (chartStyle === 'candlestick') {
        priceSeries = chart.addCandlestickSeries({
            upColor: '#10b981',
            downColor: '#ef4444',
            borderVisible: false,
            wickUpColor: '#10b981',
            wickDownColor: '#ef4444',
        });
        const candleData = data.prices.map((close, i) => ({
            time: formattedDates[i],
            open: data.open[i] || close,
            high: data.high[i] || close,
            low: data.low[i] || close,
            close: close
        }));
        priceSeries.setData(candleData);
    } else {
        priceSeries = chart.addAreaSeries({
            lineColor: '#3b82f6',
            topColor: 'rgba(59, 130, 246, 0.2)',
            bottomColor: 'rgba(59, 130, 246, 0.0)',
            lineWidth: 2,
            priceFormat: { type: 'price', precision: 2, minMove: 0.01 },
        });
        const areaData = data.prices.map((close, i) => ({
            time: formattedDates[i],
            value: close
        }));
        priceSeries.setData(areaData);
    }

    // 3. Add Volumetric Bar Overlay
    if (data.volumes && data.volumes.length > 0) {
        const volumeSeries = chart.addHistogramSeries({
            color: 'rgba(59, 130, 246, 0.15)',
            priceFormat: { type: 'volume' },
            priceScaleId: '', // overlay on same price pane
        });
        
        volumeSeries.priceScale().applyOptions({
            scaleMargins: { top: 0.8, bottom: 0 }, // place in the bottom 20%
        });

        const volumeData = data.volumes.map((vol, i) => {
            const isUp = data.prices[i] >= (data.open[i] || data.prices[i]);
            return {
                time: formattedDates[i],
                value: vol,
                color: isUp ? 'rgba(16, 185, 129, 0.18)' : 'rgba(239, 68, 68, 0.18)'
            };
        });
        volumeSeries.setData(volumeData);
    }

    // 4. Add SMA Indicators
    if (showSma50 && data.sma50) {
        const sma50Series = chart.addLineSeries({
            color: '#10b981',
            lineWidth: 1.5,
            lineStyle: LightweightCharts.LineStyle.Solid,
            title: 'SMA 50',
        });
        const sma50Data = data.sma50.map((v, i) => ({ time: formattedDates[i], value: v })).filter(x => x.value !== null);
        sma50Series.setData(sma50Data);
    }

    if (showSma200 && data.sma200) {
        const sma200Series = chart.addLineSeries({
            color: '#ef4444',
            lineWidth: 1.5,
            lineStyle: LightweightCharts.LineStyle.Solid,
            title: 'SMA 200',
        });
        const sma200Data = data.sma200.map((v, i) => ({ time: formattedDates[i], value: v })).filter(x => x.value !== null);
        sma200Series.setData(sma200Data);
    }

    // 5. Add Bollinger Bands
    if (showBB && data.bb_upper && data.bb_lower) {
        const bbUpperSeries = chart.addLineSeries({
            color: 'rgba(245, 158, 11, 0.4)',
            lineWidth: 1,
            lineStyle: LightweightCharts.LineStyle.Dashed,
            title: 'BB Upper',
        });
        const bbUpperData = data.bb_upper.map((v, i) => ({ time: formattedDates[i], value: v })).filter(x => x.value !== null);
        bbUpperSeries.setData(bbUpperData);

        const bbLowerSeries = chart.addLineSeries({
            color: 'rgba(245, 158, 11, 0.4)',
            lineWidth: 1,
            lineStyle: LightweightCharts.LineStyle.Dashed,
            title: 'BB Lower',
        });
        const bbLowerData = data.bb_lower.map((v, i) => ({ time: formattedDates[i], value: v })).filter(x => x.value !== null);
        bbLowerSeries.setData(bbLowerData);
    }

    // 6. Add Support/Resistance Trendlines
    if (showAiLines) {
        if (data.ai_support) {
            const supportSeries = chart.addLineSeries({
                color: 'rgba(16, 185, 129, 0.6)',
                lineWidth: 1.5,
                lineStyle: LightweightCharts.LineStyle.Dotted,
                title: 'AI Support',
            });
            const supportData = data.ai_support.map((v, i) => ({ time: formattedDates[i], value: v })).filter(x => x.value !== null);
            supportSeries.setData(supportData);
        }
        if (data.ai_resistance) {
            const resistanceSeries = chart.addLineSeries({
                color: 'rgba(239, 68, 68, 0.6)',
                lineWidth: 1.5,
                lineStyle: LightweightCharts.LineStyle.Dotted,
                title: 'AI Resistance',
            });
            const resistanceData = data.ai_resistance.map((v, i) => ({ time: formattedDates[i], value: v })).filter(x => x.value !== null);
            resistanceSeries.setData(resistanceData);
        }
    }

    // 7. Add Regression Trendline
    if (showTrendline) {
        const trendPrices = calculateRegressionTrendline(data.prices);
        const trendSeries = chart.addLineSeries({
            color: '#c084fc',
            lineWidth: 1.5,
            lineStyle: LightweightCharts.LineStyle.Dashed,
            title: 'Linear Trendline',
        });
        const trendData = trendPrices.map((v, i) => ({ time: formattedDates[i], value: v }));
        trendSeries.setData(trendData);
    }

    // 8. Place Crossover Buy/Sell Triangle Markers on Price Chart
    const markers = [];
    for (let i = 1; i < data.prices.length; i++) {
        // Bullish Breakout crossover: Price crosses above SMA 50
        if (data.prices[i] > data.sma50[i] && data.prices[i-1] <= data.sma50[i-1]) {
            markers.push({
                time: formattedDates[i],
                position: 'belowBar',
                color: '#10b981',
                shape: 'arrowUp',
                text: 'B',
            });
        }
        // Bearish Breakdown crossover: Price crosses below SMA 200
        if (data.prices[i] < data.sma200[i] && data.prices[i-1] >= data.sma200[i-1]) {
            markers.push({
                time: formattedDates[i],
                position: 'aboveBar',
                color: '#ef4444',
                shape: 'arrowDown',
                text: 'S',
            });
        }
    }
    priceSeries.setMarkers(markers);

    // Auto-fit contents on render
    chart.timeScale().fitContent();

    // Trigger Resize Handler
    const resizeObserver = new ResizeObserver(entries => {
        for (let entry of entries) {
            chart.resize(entry.contentRect.width, 380);
        }
    });
    resizeObserver.observe(container);
}

function drawChartJSStockChart(data) {
    const container = document.querySelector('#price-trend-chart-card .chart-container');
    if (!container) return;

    const restoredCanvas = getOrCreateCanvas('stock-chart', container);
    if (!restoredCanvas) return;

    if (activeChartInstance) {
        activeChartInstance.destroy();
    }
    
    // Calculate breakout and breakdown strategy signal points overlay
    const breakoutPrices = new Array(data.prices.length).fill(null);
    const breakdownPrices = new Array(data.prices.length).fill(null);
    
    for (let i = 1; i < data.prices.length; i++) {
        // Bullish Breakout crossover: Price crosses above SMA 50
        if (data.prices[i] > data.sma50[i] && data.prices[i-1] <= data.sma50[i-1]) {
            breakoutPrices[i] = data.prices[i];
        }
        // Bearish Breakdown crossover: Price crosses below SMA 200
        if (data.prices[i] < data.sma200[i] && data.prices[i-1] >= data.sma200[i-1]) {
            breakdownPrices[i] = data.prices[i];
        }
    }
    
    try {
        const ctx = restoredCanvas.getContext('2d');
        
        const gradient = ctx.createLinearGradient(0, 0, 0, 300);
        gradient.addColorStop(0, 'rgba(59, 130, 246, 0.22)');
        gradient.addColorStop(1, 'rgba(59, 130, 246, 0.00)');
        
        const showSma50 = document.getElementById('toggle-sma50')?.checked ?? true;
        const showSma200 = document.getElementById('toggle-sma200')?.checked ?? true;
        const showBB = document.getElementById('toggle-bb')?.checked ?? false;
        const showTrendline = document.getElementById('toggle-trendline')?.checked ?? true;
        const chartStyle = document.getElementById('chart-style')?.value || 'line';
        
        const datasets = [];
        
        if (chartStyle === 'candlestick') {
            const candleData = data.prices.map((close, i) => {
                const open = data.open[i];
                return [open, close];
            });
            const colors = data.prices.map((close, i) => {
                const open = data.open[i];
                return close >= open ? '#10b981' : '#ef4444';
            });
            
            datasets.push({
                label: 'Candlestick',
                type: 'bar',
                data: candleData,
                backgroundColor: colors,
                borderColor: colors,
                borderWidth: 1,
                barPercentage: 0.65,
                high: data.high,
                low: data.low,
                colors: colors,
                order: 1
            });
        } else {
            datasets.push({
                label: 'Stock Price (Rs)',
                data: data.prices,
                borderColor: '#3b82f6',
                borderWidth: 2.2,
                fill: true,
                backgroundColor: gradient,
                tension: 0.15,
                pointRadius: data.prices.length > 100 ? 0 : 1,
                pointHoverRadius: 5,
                order: 1
            });
        }

        if (showSma50) {
            datasets.push({
                label: 'SMA 50 (Short-term)',
                data: data.sma50,
                borderColor: '#10b981',
                borderWidth: 1.2,
                borderDash: [5, 5],
                fill: false,
                tension: 0.1,
                pointRadius: 0,
                order: 3
            });
        }

        if (showSma200) {
            datasets.push({
                label: 'SMA 200 (Long-term)',
                data: data.sma200,
                borderColor: '#ef4444',
                borderWidth: 1.2,
                borderDash: [2, 2],
                fill: false,
                tension: 0.1,
                pointRadius: 0,
                order: 4
            });
        }

        if (showBB) {
            datasets.push({
                label: 'BB Upper',
                data: data.bb_upper,
                borderColor: 'rgba(245, 158, 11, 0.4)',
                borderWidth: 1,
                borderDash: [3, 3],
                fill: false,
                tension: 0.15,
                pointRadius: 0,
                order: 7
            });
            datasets.push({
                label: 'BB Lower',
                data: data.bb_lower,
                borderColor: 'rgba(245, 158, 11, 0.4)',
                borderWidth: 1,
                borderDash: [3, 3],
                fill: false,
                tension: 0.15,
                pointRadius: 0,
                order: 8
            });
        }

        if (showTrendline) {
            datasets.push({
                label: 'Linear Trendline',
                data: calculateRegressionTrendline(data.prices),
                borderColor: '#c084fc', // sleek purple trendline
                borderWidth: 1.5,
                borderDash: [4, 4],
                fill: false,
                tension: 0,
                pointRadius: 0,
                order: 5
            });
        }

        const showAILines = document.getElementById('toggle-ai-lines')?.checked ?? true;
        if (showAILines && data.ai_support && data.ai_resistance) {
            datasets.push({
                label: 'AI Support Trendline',
                data: data.ai_support,
                borderColor: '#10b981', // emerald green
                borderWidth: 2.0,
                borderDash: [5, 4],
                fill: false,
                tension: 0,
                pointRadius: 0,
                order: 2
            });
            datasets.push({
                label: 'AI Resistance Trendline',
                data: data.ai_resistance,
                borderColor: '#ef4444', // crimson red
                borderWidth: 2.0,
                borderDash: [5, 4],
                fill: false,
                tension: 0,
                pointRadius: 0,
                order: 2
            });
        }

        datasets.push(
            {
                label: 'Breakout Points (Buy)',
                data: breakoutPrices,
                borderColor: '#059669',
                backgroundColor: '#10b981',
                pointRadius: 5,
                pointHoverRadius: 7,
                showLine: false,
                fill: false,
                order: 0
            },
            {
                label: 'Breakdown Points (Sell)',
                data: breakdownPrices,
                borderColor: '#dc2626',
                backgroundColor: '#ef4444',
                pointRadius: 5,
                pointHoverRadius: 7,
                showLine: false,
                fill: false,
                order: 0
            },
            {
                label: 'Volume',
                type: 'bar',
                data: data.volumes || [],
                backgroundColor: 'rgba(59, 130, 246, 0.08)', // transparent blue bars
                borderColor: 'transparent',
                yAxisID: 'yVolume',
                order: 6,
                barPercentage: 0.8
            }
        );
        
        const candlestickWicksPlugin = {
            id: 'candlestickWicks',
            afterDatasetsDraw(chart) {
                const { ctx, data, chartArea: { top, bottom }, scales: { x, y } } = chart;
                const styleSelect = document.getElementById('chart-style');
                const chartStyle = styleSelect ? styleSelect.value : 'line';
                if (chartStyle !== 'candlestick') return;
                
                ctx.save();
                chart.data.datasets.forEach((dataset, datasetIndex) => {
                    if (dataset.label === 'Candlestick') {
                        const meta = chart.getDatasetMeta(datasetIndex);
                        meta.data.forEach((bar, index) => {
                            const high = dataset.high[index];
                            const low = dataset.low[index];
                            if (high === undefined || low === undefined) return;
                            
                            const xPos = bar.x;
                            const yHigh = y.getPixelForValue(high);
                            const yLow = y.getPixelForValue(low);
                            
                            ctx.strokeStyle = dataset.colors[index];
                            ctx.lineWidth = 1.5;
                            ctx.beginPath();
                            ctx.moveTo(xPos, yHigh);
                            ctx.lineTo(xPos, yLow);
                            ctx.stroke();
                        });
                    }
                });
                ctx.restore();
            }
        };

        activeChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: data.labels,
                datasets: datasets
            },
            plugins: [candlestickWicksPlugin],
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        labels: {
                            color: '#9ca3af',
                            font: { family: 'Outfit', size: 10 }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { color: 'rgba(255, 255, 255, 0.02)' },
                        ticks: { color: '#9ca3af', font: { size: 9 }, maxTicksLimit: 12 }
                    },
                    y: {
                        grid: { color: 'rgba(255, 255, 255, 0.03)' },
                        ticks: { color: '#9ca3af', font: { size: 9 } }
                    },
                    yVolume: {
                        position: 'right',
                        grid: { drawOnChartArea: false },
                        ticks: { display: false },
                        suggestedMax: Math.max(...(data.volumes || [1e6])) * 4
                    }
                }
            }
        });
    } catch (e) {
        container.innerHTML = `<div class="chart-fallback" style="display:flex; align-items:center; justify-content:center; height:100%; font-size:12px; color:var(--text-muted); text-align:center; padding:15px; border: 1px dashed var(--border-glass); border-radius:6px; background:rgba(0,0,0,0.15);">Failed to load chart: ${e.message}</div>`;
    }
}

// 6. Interactive DCF Sandbox Section
function setupDCFSandbox() {
    const sliders = ['sb-wacc', 'sb-growth', 'sb-opm', 'sb-terminal'];
    sliders.forEach(id => {
        const slider = document.getElementById(id);
        const valLabel = document.getElementById(`${id}-val`);
        
        slider.addEventListener('input', () => {
            valLabel.innerText = `${parseFloat(slider.value).toFixed(1)}%`;
            calculateClientSideDCF();
        });
    });
    
    document.getElementById('update-sandbox-btn').addEventListener('click', runDynamicSandboxAI);
}

function calculateClientSideDCF() {
    if (!activeStockProfile) return;
    
    const wacc = parseFloat(document.getElementById('sb-wacc').value) / 100;
    const growth = parseFloat(document.getElementById('sb-growth').value) / 100;
    const term = parseFloat(document.getElementById('sb-terminal').value) / 100;
    
    const currentPrice = activeStockProfile.fundamentals.current_price;
    const baselineFcf = activeStockProfile.dcf_model.cash_flow_projections[0].fcf / (1 + (activeStockProfile.fundamentals.sales_growth_3y_pct || 12.0)/100);
    
    let sumPv = 0;
    let currFcf = baselineFcf;
    const fadeStep = (growth - term) / 5.0;
    
    for (let yr = 1; yr <= 10; yr++) {
        let g = yr <= 5 ? growth : Math.max(growth - (yr - 5) * fadeStep, term);
        currFcf = currFcf * (1 + g);
        let pv = currFcf / ((1 + wacc) ** yr);
        sumPv += pv;
    }
    
    const termFcf = currFcf * (1 + term);
    const termVal = termFcf / (wacc - term);
    const pvTermVal = termVal / ((1 + wacc) ** 10);
    
    const ev = sumPv + pvTermVal;
    const mockMcap = activeStockProfile.fundamentals.market_cap_cr * 1e7;
    const mockOutstandingShares = mockMcap / currentPrice;
    
    let intrinsic = ev / mockOutstandingShares;
    intrinsic = Math.max(Math.min(intrinsic, currentPrice * 2.2), currentPrice * 0.4);
    
    document.getElementById('dcf-intrinsic-price').innerText = safeFormatRupees(intrinsic, 2);
    const margin = ((intrinsic - currentPrice) / intrinsic) * 100.0;
    
    const marginSafetyEl = document.getElementById('dcf-margin-safety');
    marginSafetyEl.innerText = !isNaN(margin) && margin !== null && margin !== undefined ? `${margin > 0 ? '+' : ''}${margin.toFixed(1)}%` : 'N/A';
    marginSafetyEl.className = !isNaN(margin) && margin !== null && margin !== undefined && margin >= 0 ? 'green-text' : 'red-text';
    
    // Dynamically update sandbox status badge
    const dcfStatusBadge = document.getElementById('dcf-status-badge');
    if (dcfStatusBadge) {
        dcfStatusBadge.className = 'dcf-indicator';
        if (margin >= 15.0) {
            dcfStatusBadge.innerText = 'Significantly Undervalued';
            dcfStatusBadge.classList.add('undervalued');
        } else if (margin >= 5.0) {
            dcfStatusBadge.innerText = 'Moderately Undervalued';
            dcfStatusBadge.classList.add('undervalued');
        } else if (margin <= -15.0) {
            dcfStatusBadge.innerText = 'Significantly Overvalued';
            dcfStatusBadge.classList.add('overvalued');
        } else if (margin <= -5.0) {
            dcfStatusBadge.innerText = 'Moderately Overvalued';
            dcfStatusBadge.classList.add('overvalued');
        } else {
            dcfStatusBadge.innerText = 'Fairly Valued';
            dcfStatusBadge.classList.add('fair');
        }
    }

    // Generate dynamic sandbox AI thesis narrative in real time
    const thesisTextEl = document.getElementById('dcf-sandbox-thesis-text');
    if (thesisTextEl) {
        const activeWaccPct = wacc * 100;
        const activeGrowthPct = growth * 100;
        
        let growthNarrative = "stable, defensive expansion patterns";
        if (activeGrowthPct >= 20.0) growthNarrative = "extremely aggressive hyper-growth expansion trajectory";
        else if (activeGrowthPct >= 12.0) growthNarrative = "robust, market-leading premium growth schedules";
        else if (activeGrowthPct < 6.0) growthNarrative = "conservative, low-single-digit defensive maturity";
        
        let waccNarrative = "standard moderate capital costs";
        if (activeWaccPct >= 13.0) waccNarrative = "punitive, high-risk equity premium hurdle rates, squeezing long-term present value";
        else if (activeWaccPct <= 9.0) waccNarrative = "favorable, institutional-grade low discount rates, boosting cash flow capitalization";
        
        let ratingNarrative = "fairly valued, demanding disciplined buy-limit execution";
        if (margin >= 15.0) ratingNarrative = "significantly undervalued, offering a massive margin of safety for capital allocation";
        else if (margin >= 5.0) ratingNarrative = "moderately undervalued, supporting standard accumulation strategies";
        else if (margin <= -15.0) ratingNarrative = "dangerously overvalued, indicating peak euphoria and elevated entry risks";
        else if (margin <= -5.0) ratingNarrative = "moderately overvalued, advising defensive holds and patient dip-buying";
        
        thesisTextEl.innerHTML = `Under active assumptions of **${activeGrowthPct.toFixed(1)}%** Revenue Growth (${growthNarrative}) discounted at a hurdle rate of **${activeWaccPct.toFixed(1)}%** Hurdle WACC (${waccNarrative}), the equity is estimated to be **${ratingNarrative}** (Margin of Safety: **${margin.toFixed(1)}%**).`;
    }

    // Highlight closest coordinates in sensitivity matrix heatmap
    highlightActiveMatrixCoordinate();
}

function highlightActiveMatrixCoordinate() {
    if (!activeStockProfile) return;
    
    // Read current slider values
    const waccEl = document.getElementById('sb-wacc');
    const growthEl = document.getElementById('sb-growth');
    if (!waccEl || !growthEl) return;
    
    const activeWacc = parseFloat(waccEl.value);
    const activeGrowth = parseFloat(growthEl.value);
    
    const baseWacc = activeStockProfile.dcf_model.wacc !== null && activeStockProfile.dcf_model.wacc !== undefined ? activeStockProfile.dcf_model.wacc : 10.0;
    const baseGrowth = activeStockProfile.fundamentals.sales_growth_3y_pct || 12.0;
    
    // WACC row factors (same as in renderDCFSensitivityMatrix)
    const waccRates = [baseWacc - 2.0, baseWacc - 1.0, baseWacc, baseWacc + 1.0, baseWacc + 2.0];
    // Revenue Growth column factors
    const growthRates = [baseGrowth - 4.0, baseGrowth - 2.0, baseGrowth, baseGrowth + 2.0, baseGrowth + 4.0];
    
    // Find closest indexes
    let closestRowIdx = 0;
    let minWaccDiff = Infinity;
    waccRates.forEach((w, idx) => {
        const diff = Math.abs(w - activeWacc);
        if (diff < minWaccDiff) {
            minWaccDiff = diff;
            closestRowIdx = idx;
        }
    });
    
    let closestColIdx = 0;
    let minGrowthDiff = Infinity;
    growthRates.forEach((g, idx) => {
        const diff = Math.abs(g - activeGrowth);
        if (diff < minGrowthDiff) {
            minGrowthDiff = diff;
            closestColIdx = idx;
        }
    });
    
    // Clear all existing coordinate highlights
    const cells = document.querySelectorAll('.sensitivity-matrix-table td');
    cells.forEach(cell => {
        cell.style.outline = 'none';
        cell.style.boxShadow = 'none';
        cell.style.transform = 'none';
        cell.style.fontWeight = 'normal';
        cell.style.zIndex = 'auto';
        cell.style.position = 'static';
    });
    
    // Get all rows in table body
    const rows = document.querySelectorAll('#dcf-sens-body tr');
    if (rows.length > closestRowIdx) {
        const targetRow = rows[closestRowIdx];
        // Target cell is at index closestColIdx + 1 (since index 0 is row label)
        const targetTd = targetRow.querySelectorAll('td')[closestColIdx + 1];
        if (targetTd) {
            targetTd.style.outline = '2px solid var(--neon-blue)';
            targetTd.style.boxShadow = '0 0 10px rgba(59, 130, 246, 0.8)';
            targetTd.style.transform = 'scale(1.05)';
            targetTd.style.fontWeight = '800';
            targetTd.style.zIndex = '15';
            targetTd.style.position = 'relative';
        }
    }
}

async function runDynamicSandboxAI() {
    if (!activeStockProfile) return;
    
    showLoader(
        "Recalculating Valuation Model...",
        "Feeding modified discount rates and revenue schedules back to the active CIO parent agent. Spawns specialized CFAs to update target buy/sell price boundaries..."
    );
    
    const query = activeStockProfile.company_name;
    const horizon = document.getElementById('profile-horizon').value;
    const risk = document.getElementById('profile-risk').value;
    
    const payload = {
        query: query,
        horizon: horizon,
        risk_profile: risk,
        wacc: parseFloat(document.getElementById('sb-wacc').value),
        revenue_growth: parseFloat(document.getElementById('sb-growth').value),
        opm: parseFloat(document.getElementById('sb-opm').value),
        terminal_growth: parseFloat(document.getElementById('sb-terminal').value)
    };
    
    try {
        const response = await fetch('/api/analyze-custom', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        if (!response.ok) throw new Error("Sandbox update failed.");
        const updatedProfile = await response.json();
        
        activeStockProfile = updatedProfile;
        
        document.getElementById('target-buy-range').innerText = updatedProfile.analysis.suggested_buy_price_range;
        document.getElementById('target-sell-range').innerText = updatedProfile.analysis.suggested_sell_price_range;
        document.getElementById('cio-investment-thesis').innerText = updatedProfile.analysis.investment_thesis;
        
        const dcfStatusBadge = document.getElementById('dcf-status-badge');
        dcfStatusBadge.innerText = updatedProfile.dcf_model.valuation_rating;
        dcfStatusBadge.className = 'dcf-indicator';
        if (updatedProfile.dcf_model.margin_of_safety >= 5.0) dcfStatusBadge.classList.add('undervalued');
        else if (updatedProfile.dcf_model.margin_of_safety <= -5.0) dcfStatusBadge.classList.add('overvalued');
        else dcfStatusBadge.classList.add('fair');
        
        showToast("Valuation model successfully updated. CIO has aligned target prices and investment thesis.", 'success');
    } catch (e) {
        showToast("Failed to update sandbox thesis: " + e.message, 'error');
    } finally {
        hideLoader();
    }
}

// 7. Comparison Arena Section
function setupComparisonArena() {
    document.getElementById('run-comparison-btn').addEventListener('click', runComparisonAnalysis);

    // Hook up suggestion pills for quick benchmarks
    const suggestionPills = document.querySelectorAll('#tab-compare .suggestion-tag-pill');
    suggestionPills.forEach(pill => {
        pill.addEventListener('click', () => {
            const symbolsInput = document.getElementById('compare-symbols-input');
            if (symbolsInput) {
                symbolsInput.value = pill.getAttribute('data-symbols');
                runComparisonAnalysis();
            }
        });
    });

    // Implement Premium Print Peer Battleground PDF Exporter
    const printBattlegroundBtn = document.getElementById('print-battleground-btn');
    if (printBattlegroundBtn) {
        printBattlegroundBtn.addEventListener('click', () => {
            const thesisHTML = document.getElementById('compare-ai-thesis')?.innerHTML;
            if (!thesisHTML || thesisHTML.trim() === '' || thesisHTML.includes('...')) {
                showToast("Please run the Peer Benchmarking Analysis before printing.", "warning");
                return;
            }

            // Gather inputs
            const symbolsInput = document.getElementById('compare-symbols-input')?.value || 'N/A';
            
            // Extract the comparative headers
            const headerThs = document.querySelectorAll('#compare-table-header th');
            const headers = Array.from(headerThs).map(th => th.innerText.replace(/🏆/g, '').trim());

            // Extract the comparative metrics rows
            const bodyTrs = document.querySelectorAll('#compare-table-body tr');
            const rowsData = [];
            bodyTrs.forEach(tr => {
                const tds = tr.querySelectorAll('td');
                if (tds.length > 0) {
                    const metricLabel = tds[0].innerText;
                    const values = Array.from(tds).slice(1).map(td => {
                        let text = td.innerText;
                        let isBuy = td.querySelector('.rec-buy') || text.toUpperCase().includes('BUY');
                        let isSell = td.querySelector('.rec-sell') || text.toUpperCase().includes('SELL');
                        let isHold = td.querySelector('.rec-hold') || text.toUpperCase().includes('HOLD');
                        let isGreen = td.classList.contains('green-text');
                        let isRed = td.classList.contains('red-text');
                        return { text, isBuy, isSell, isHold, isGreen, isRed };
                    });
                    rowsData.push({ metricLabel, values });
                }
            });



            const today = new Date().toLocaleDateString('en-IN', {
                day: '2-digit',
                month: 'long',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });

            let tableHTML = '<table class="compare-table"><thead><tr>';
            headers.forEach(h => {
                tableHTML += `<th>${h}</th>`;
            });
            tableHTML += '</tr></thead><tbody>';

            rowsData.forEach(row => {
                tableHTML += `<tr><td><strong>${row.metricLabel}</strong></td>`;
                row.values.forEach(val => {
                    let style = '';
                    if (val.isBuy) style = 'color: #047857; font-weight: 700; background: #f0fdf4; border-radius: 4px; padding: 2px 6px; display: inline-block;';
                    else if (val.isSell) style = 'color: #b91c1c; font-weight: 700; background: #fdf2f2; border-radius: 4px; padding: 2px 6px; display: inline-block;';
                    else if (val.isHold) style = 'color: #b45309; font-weight: 700; background: #fffdf5; border-radius: 4px; padding: 2px 6px; display: inline-block;';
                    else if (val.isGreen) style = 'color: #16a34a; font-weight: 600;';
                    else if (val.isRed) style = 'color: #dc2626; font-weight: 600;';
                    
                    tableHTML += `<td style="text-align: center;"><span style="${style}">${val.text}</span></td>`;
                });
                tableHTML += '</tr>';
            });
            tableHTML += '</tbody></table>';

            const printContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>AI Sector Peer Benchmarking Audit Dossier</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Outfit:wght@400;600;700;800&display=swap');
        
        @page {
            size: A4;
            margin: 20mm 15mm 20mm 15mm;
        }
        
        body {
            font-family: 'Inter', sans-serif;
            color: #111827;
            background: #ffffff;
            margin: 0;
            padding: 0;
            font-size: 10.5pt;
            line-height: 1.5;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
        }

        .header {
            border-bottom: 2px solid #2563eb;
            padding-bottom: 12px;
            margin-bottom: 20px;
        }

        .header-top {
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
        }

        .brand {
            font-family: 'Outfit', sans-serif;
            font-size: 14pt;
            font-weight: 800;
            color: #1e40af;
            letter-spacing: 0.05em;
            text-transform: uppercase;
        }

        .doc-type {
            font-size: 9pt;
            font-weight: 600;
            color: #6b7280;
            text-transform: uppercase;
            letter-spacing: 0.1em;
        }

        .report-title-row {
            margin-top: 15px;
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
        }

        .report-name {
            font-family: 'Outfit', sans-serif;
            font-size: 19pt;
            font-weight: 800;
            color: #111827;
            margin: 0;
            line-height: 1.2;
        }

        .meta-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 12px;
            background: #f9fafb;
            border: 1px solid #e5e7eb;
            border-radius: 6px;
            padding: 12px;
            margin-bottom: 20px;
        }

        .meta-item {
            display: flex;
            flex-direction: column;
        }

        .meta-label {
            font-size: 8pt;
            text-transform: uppercase;
            color: #6b7280;
            font-weight: 600;
            letter-spacing: 0.05em;
            margin-bottom: 2px;
        }

        .meta-value {
            font-size: 9.5pt;
            font-weight: 700;
            color: #1f2937;
        }

        .section-title {
            font-family: 'Outfit', sans-serif;
            font-size: 12pt;
            font-weight: 700;
            color: #1e40af;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            border-bottom: 1px solid #e5e7eb;
            padding-bottom: 5px;
            margin-top: 25px;
            margin-bottom: 12px;
            page-break-after: avoid;
        }

        .compare-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 9.5pt;
            margin-bottom: 25px;
        }

        .compare-table th {
            background: #f3f4f6;
            color: #1f2937;
            font-weight: 700;
            text-transform: uppercase;
            font-size: 8pt;
            letter-spacing: 0.05em;
            padding: 10px 8px;
            border-bottom: 2px solid #e5e7eb;
            text-align: center;
        }

        .compare-table th:first-child {
            text-align: left;
        }

        .compare-table td {
            padding: 8px;
            border-bottom: 1px solid #e5e7eb;
        }

        .compare-table td:first-child {
            font-weight: 600;
            color: #4b5563;
        }

        .thesis-content {
            font-size: 10pt;
            line-height: 1.6;
            color: #374151;
            text-align: justify;
        }

        .thesis-content h2, .thesis-content h3, .thesis-content h4 {
            font-family: 'Outfit', sans-serif;
            color: #111827;
            page-break-after: avoid;
        }

        .thesis-content h2 {
            font-size: 12pt;
            border-bottom: 1px solid #e5e7eb;
            padding-bottom: 4px;
            margin-top: 20px;
        }

        .thesis-content h3 {
            font-size: 11pt;
            margin-top: 16px;
        }

        .thesis-content blockquote {
            border-left: 3px solid #3b82f6;
            padding: 8px 12px;
            margin: 12px 0;
            background: #eff6ff;
            color: #111827;
            font-style: italic;
        }

        .footer {
            margin-top: 40px;
            border-top: 1px solid #e5e7eb;
            padding-top: 10px;
            font-size: 8pt;
            color: #9ca3af;
            text-align: center;
            display: flex;
            justify-content: space-between;
            page-break-inside: avoid;
        }

        @media print {
            body {
                background: none;
                color: #000000;
            }
            .no-print {
                display: none;
            }
            .compare-table th {
                background-color: #f3f4f6 !important;
            }
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="header-top">
            <span class="brand">Apex Agentic AI Workstation</span>
            <span class="doc-type">Competitive Benchmarking</span>
        </div>
        <div class="report-title-row">
            <div>
                <span class="report-name">AI Sector Battleground Thesis Audit</span>
            </div>
            <div style="text-align: right;">
                <div style="font-size: 8pt; color: #6b7280; font-weight: 600; text-transform: uppercase;">Generated Date</div>
                <div style="font-size: 11pt; font-weight: 700; color: #111827;">${today}</div>
            </div>
        </div>
    </div>

    <div class="meta-grid">
        <div class="meta-item">
            <span class="meta-label">Audit Engine</span>
            <span class="meta-value">Multi-Agent Peer Benchmarking</span>
        </div>
        <div class="meta-item">
            <span class="meta-label">Benchmarked Symbols</span>
            <span class="meta-value" style="color: #1d4ed8;">${symbolsInput.toUpperCase()}</span>
        </div>
        <div class="meta-item">
            <span class="meta-label">Total Rivals</span>
            <span class="meta-value">${headers.length - 1} Competitors</span>
        </div>
        <div class="meta-item">
            <span class="meta-label">Status</span>
            <span class="meta-value" style="color: #059669;">Institutional Cleared</span>
        </div>
    </div>

    <div class="section-title">I. Comparative Peer Benchmarking Valuation Grid</div>
    ${tableHTML}

    <div class="section-title" style="page-break-before: auto;">II. AI Sector Battleground Thesis & Tactical Analysis</div>
    <div class="thesis-content">
        ${thesisHTML}
    </div>

    <div class="footer">
        <span>Confidential - Quantitative Research Audit</span>
        <span>© ${new Date().getFullYear()} Apex Agentic Systems</span>
        <span>Page 1 of 1</span>
    </div>

    <script>
        window.addEventListener('DOMContentLoaded', () => {
            setTimeout(() => {
                window.print();
                window.close();
            }, 500);
        });
    </script>
</body>
</html>
            `;

            executeSystemPrint(printContent, 'width=850,height=900');
        });
    }
}

async function runComparisonAnalysis() {
    const input = document.getElementById('compare-symbols-input').value;
    if (!input) return;
    
    showLoader(
        "Benchmarking Rivals...",
        "Orchestrating simultaneous scraper runs and consulting senior sector strategists to produce a competitive Sector Battleground analysis."
    );
    
    try {
        const response = await fetch(`/api/compare?tickers=${encodeURIComponent(input)}`);
        if (!response.ok) throw new Error("Comparison scan failed.");
        const data = await response.json();
        
        renderComparisonArena(data);
    } catch (e) {
        showToast("Comparison Arena error: " + e.message, 'error');
    } finally {
        hideLoader();
    }
}

function renderComparisonArena(data) {
    const headerRow = document.getElementById('compare-table-header');
    const tbody = document.getElementById('compare-table-body');
    
    headerRow.innerHTML = '<th>Financial Metric</th>';
    tbody.innerHTML = '';
    
    if (data.error) {
        tbody.innerHTML = `<tr><td colspan="5" class="center-text text-muted">${data.error}</td></tr>`;
        return;
    }
    
    const matrix = data.matrix;
    
    // Highlight sector champion column (with the highest score)
    let bestScore = -1;
    let bestIndex = -1;
    matrix.forEach((item, index) => {
        if (item.score > bestScore) {
            bestScore = item.score;
            bestIndex = index;
        }
    });
    
    matrix.forEach((item, index) => {
        const isChamp = index === bestIndex;
        if (isChamp) {
            headerRow.innerHTML += `<th class="champion-column-header">${item.company_name} <span class="champion-trophy-badge">🏆 CHAMPION</span></th>`;
        } else {
            headerRow.innerHTML += `<th>${item.company_name}</th>`;
        }
    });
    
    const metrics = [
        { label: 'AI Advisory Score', key: 'score', icon: '📊', format: v => v !== null && v !== undefined ? `<strong>${v}/100</strong>` : 'N/A' },
        { label: 'AI Analyst Action', key: 'action', icon: '💎', format: v => {
            if (!v) return 'N/A';
            let cls = 'badge-hold';
            if (v.toUpperCase().includes('BUY')) cls = 'badge-buy';
            if (v.toUpperCase().includes('SELL') || v.toUpperCase().includes('UNDERPERFORM')) cls = 'badge-sell';
            return `<span class="rec-glowing-badge ${cls}">${v}</span>`;
        }},
        { label: 'Current Price', key: 'price', icon: '💰', format: v => v !== null && v !== undefined ? `Rs. ${v.toLocaleString('en-IN')}` : 'N/A' },
        { label: 'Stock Trailing P/E', key: 'pe', icon: '⚙️', format: v => v !== null && v !== undefined ? (typeof v === 'number' ? v.toFixed(1) : v) : 'N/A' },
        { label: 'Return on Equity (ROE)', key: 'roe', icon: '📈', format: v => v !== null && v !== undefined ? (typeof v === 'number' ? `${v.toFixed(1)}%` : `${v}%`) : 'N/A' },
        { label: 'Return on Capital (ROCE)', key: 'roce', icon: '📈', format: v => v !== null && v !== undefined ? (typeof v === 'number' ? `${v.toFixed(1)}%` : `${v}%`) : 'N/A' },
        { label: 'Debt to Equity', key: 'debt_eq', icon: '🛡️', format: v => v !== null && v !== undefined ? (typeof v === 'number' ? v.toFixed(2) : v) : 'N/A' },
        { label: 'DCF Margin of Safety', key: 'margin_of_safety', icon: '🛡️', format: v => v !== null && v !== undefined ? (typeof v === 'number' ? `${v > 0 ? '+' : ''}${v.toFixed(1)}%` : `${v}%`) : 'N/A' },
        { label: 'RSI-14 Momentum', key: 'rsi', icon: '⚡', format: v => v !== null && v !== undefined ? (typeof v === 'number' ? v.toFixed(1) : v) : 'N/A' },
        { label: 'Moving Average Trend', key: 'trend', icon: '⚡', format: v => v || 'N/A' }
    ];
    
    metrics.forEach(m => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td><span class="metric-lead-icon">${m.icon}</span><strong>${m.label}</strong></td>`;
        
        matrix.forEach((item, index) => {
            const val = item[m.key];
            const formatted = m.format(val);
            const isChamp = index === bestIndex;
            
            let tdClass = isChamp ? "champion-cell" : "";
            if (m.key === 'roe' && val > 15) tdClass += " green-text";
            if (m.key === 'margin_of_safety' && val > 10) tdClass += " green-text";
            if (m.key === 'margin_of_safety' && val < -10) tdClass += " red-text";
            if (m.key === 'debt_eq' && val > 1.5) tdClass += " red-text";
            if (m.key === 'trend' && val === 'Bullish') tdClass += " green-text";
            
            let style = "";
            if (isChamp && m.key === 'score') style += ' font-size: 14px;';
            
            tr.innerHTML += `<td class="${tdClass.trim()}" style="${style}">${formatted}</td>`;
        });
        
        tbody.appendChild(tr);
    });
    
    const compareThesisEl = document.getElementById('compare-ai-thesis');
    if (compareThesisEl) {
        const champCompany = bestIndex !== -1 ? matrix[bestIndex].company_name : "N/A";
        const champScore = bestIndex !== -1 ? matrix[bestIndex].score : 0;
        
        let thesisHTML = `
        <div class="battleground-playoff-card">
            <div class="playoff-header">
                <div class="playoff-title">⚔️ AI Competitive Arena Audits</div>
                <div class="playoff-badge">Playoff Playbook</div>
            </div>
            <p class="playoff-analogy-text">
                Think of benchmarking rival equities like analyzing a high-stakes sports championship playoff bracket. Every company enters the arena with distinct strengths—some have dominant offensive statistics (high ROE & momentum) while others boast fortress-like defensive lines (undervalued PE & large DCF Margin of Safety). Sector champion status is awarded not merely to the largest player, but to the competitor that displays the most balanced combination of capital efficiency, margin protection, and technical momentum to dominate the tournament.
            </p>
            <div class="playoff-champion-box">
                <span class="playoff-champ-label">Current Sector Playoff Leader:</span>
                <span class="playoff-champ-value">
                    🏆 <strong>${champCompany}</strong>
                    <span class="badge-rec rec-buy" style="font-size: 11px; padding: 2px 8px; border-radius: 4px; font-weight:700;">${champScore}/100</span>
                </span>
            </div>
        </div>
        `;
        
        if (data.thesis) {
            thesisHTML += data.thesis;
            compareThesisEl.innerHTML = thesisHTML;
        } else {
            thesisHTML += `
            <div id="generate-battleground-thesis-container" style="text-align: center; padding: 20px 10px; border: 1px dashed var(--border-glass); border-radius: 8px; margin-top: 20px; background: rgba(255,255,255,0.01);">
                <p style="margin-bottom: 15px; color: var(--text-secondary); font-size: 12.5px;">AI Sector Battleground Thesis analysis is ready to benchmark these assets.</p>
                <button id="generate-battleground-thesis-btn" class="btn-primary" style="padding: 8px 16px; font-size: 12px; font-weight: 600; border-radius: 6px;">
                    ⚔️ Generate AI Sector Battleground Thesis & Tactical Analysis
                </button>
            </div>
            `;
            compareThesisEl.innerHTML = thesisHTML;
            
            document.getElementById('generate-battleground-thesis-btn').addEventListener('click', async () => {
                const btnContainer = document.getElementById('generate-battleground-thesis-container');
                btnContainer.innerHTML = `
                    <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px;">
                        <span class="spinner" style="display: inline-block; width: 20px; height: 20px; border: 2px solid rgba(255,255,255,0.1); border-top-color: var(--neon-green); border-radius: 50%; animation: spin 1s linear infinite;"></span>
                        <p style="color: var(--neon-green); font-weight: 600; font-size: 12px; margin: 0;">Generating Battleground Thesis (calling LLM)...</p>
                    </div>
                `;
                
                try {
                    const symbolsInput = document.getElementById('compare-symbols-input').value;
                    const res = await fetch(`/api/compare?tickers=${encodeURIComponent(symbolsInput)}&generate_thesis=true`);
                    if (!res.ok) throw new Error("Failed to generate AI battleground thesis");
                    const responseData = await res.json();
                    
                    if (responseData.thesis) {
                        btnContainer.outerHTML = responseData.thesis;
                    } else {
                        btnContainer.innerHTML = `<p style="color: var(--neon-red); font-size: 12px;">Failed to load thesis content.</p>`;
                    }
                } catch (err) {
                    btnContainer.innerHTML = `<p style="color: var(--neon-red); font-size: 12px;">Error: ${err.message}</p>`;
                }
            });
        }
    }
    
    const compareBox = document.getElementById('comparison-results-box');
    if (compareBox) compareBox.style.display = 'block';
}

// 8. Automated Alert Center
function setupAlertCenter() {
    document.getElementById('save-alert-btn').addEventListener('click', setAlertRule);
    document.getElementById('scan-alerts-btn').addEventListener('click', checkAlertRules);
    fetchAlertsList();
    startRealTimeAlertScanner();
}

// Start Real-Time Alert Engine background scanner
function startRealTimeAlertScanner() {
    // Run a silent background scanner every 30 seconds
    setInterval(async () => {
        try {
            const response = await fetch('/api/alerts/check');
            if (!response.ok) return;
            const data = await response.json();
            
            // Check if there are any new triggers in this sweep
            if (data.triggers && data.triggers.length > 0) {
                // 1. Play premium institutional double-beep alert sound
                playAlertSound();
                
                // 2. Display a toast notification for each trigger
                data.triggers.forEach(msg => {
                    showToast(`⚠️ SYSTEM ALERT: ${msg}`, 'warning');
                });
                
                // 3. Append triggers dynamically to the header notifications list
                const notifBody = document.getElementById('notification-list-body');
                const badge = document.getElementById('bell-badge-count');
                
                if (notifBody) {
                    // Remove "No new system notifications" if present
                    if (notifBody.innerText.includes("No new system notifications")) {
                        notifBody.innerHTML = '';
                    }
                    
                    data.triggers.forEach(msg => {
                        const now = new Date();
                        const timeStr = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
                        
                        const item = document.createElement('div');
                        item.className = 'notification-item';
                        item.style.borderLeft = '3px solid var(--color-primary, #3b82f6)';
                        item.innerHTML = `
                            <div class="notif-header">
                                <span class="notif-badge badge-red">TRIGGERED</span>
                                <span class="notif-time">Just Now (${timeStr})</span>
                            </div>
                            <div class="notif-text" style="color: var(--text-primary); font-weight: 500;">
                                ${msg}
                            </div>
                        `;
                        notifBody.insertBefore(item, notifBody.firstChild);
                    });
                }
                
                // 4. Update the badge count
                if (badge) {
                    let currentCount = 0;
                    if (badge.style.display !== 'none' && badge.innerText !== '') {
                        currentCount = parseInt(badge.innerText) || 0;
                    }
                    currentCount += data.triggers.length;
                    badge.innerText = currentCount;
                    badge.style.display = 'flex'; // Ensure badge is visible
                }
                
                // 5. If user is currently looking at the alert center tab, update the list automatically!
                const alertsTab = document.getElementById('tab-alerts');
                if (alertsTab && alertsTab.style.display !== 'none') {
                    renderAlertsList(data.alerts);
                }
            }
        } catch (e) {
            console.warn("Silent alert background scanner failed:", e);
        }
    }, 30000); // 30 seconds interval
}

function playAlertSound() {
    const audioToggle = document.getElementById('setting-audio-toggle');
    if (audioToggle && !audioToggle.checked) return;
    
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        
        // First Beep
        const osc1 = audioCtx.createOscillator();
        const gain1 = audioCtx.createGain();
        osc1.connect(gain1);
        gain1.connect(audioCtx.destination);
        osc1.type = 'sine';
        osc1.frequency.value = 880; // A5
        gain1.gain.setValueAtTime(0.08, audioCtx.currentTime);
        gain1.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.15);
        osc1.start(audioCtx.currentTime);
        osc1.stop(audioCtx.currentTime + 0.15);
        
        // Second Beep (150ms later)
        const osc2 = audioCtx.createOscillator();
        const gain2 = audioCtx.createGain();
        osc2.connect(gain2);
        gain2.connect(audioCtx.destination);
        osc2.type = 'sine';
        osc2.frequency.value = 1200; // High tone
        gain2.gain.setValueAtTime(0.08, audioCtx.currentTime + 0.15);
        gain2.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);
        osc2.start(audioCtx.currentTime + 0.15);
        osc2.stop(audioCtx.currentTime + 0.3);
    } catch (e) {
        console.warn("AudioContext beep failed: ", e);
    }
}


async function fetchAlertsList() {
    try {
        const response = await fetch('/api/alerts/list');
        const list = await response.json();
        renderAlertsList(list);
    } catch (e) {
        console.error("Failed to load alerts list: ", e);
    }
}

async function setAlertRule() {
    const symbol = document.getElementById('alert-symbol').value;
    const cond = document.getElementById('alert-condition').value;
    const op = document.getElementById('alert-operator').value;
    const val = document.getElementById('alert-value').value;
    
    if (!symbol || !val) return;
    
    const payload = {
        ticker: symbol,
        condition_type: cond,
        operator: op,
        value: val
    };
    
    try {
        const response = await fetch('/api/alerts/set', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        if (!response.ok) throw new Error("Failed to set alert.");
        
        showToast("Alert rule successfully registered in the Center.", 'success');
        fetchAlertsList();
    } catch (e) {
        showToast("Alert save error: " + e.message, 'error');
    }
}

function renderAlertsList(list) {
    const tbody = document.getElementById('alerts-table-body');
    tbody.innerHTML = '';
    
    if (list.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="center-text text-muted">No alert rules configured. Create one on the left.</td></tr>';
        return;
    }
    
    list.forEach(item => {
        const tr = document.createElement('tr');
        
        let statusBadge = '';
        if (item.status === 'Triggered') {
            statusBadge = `<span class="alert-status-badge triggered">🚨 Triggered</span>`;
        } else {
            statusBadge = `<span class="alert-status-badge scanning">🟢 Scanning</span>`;
        }
        
        tr.innerHTML = `
            <td style="font-weight:600;">#${item.id}</td>
            <td><strong>${item.ticker}</strong></td>
            <td><span class="badge-ticker" style="font-size:10px;">${item.condition_type}</span></td>
            <td style="font-family: monospace; font-size:12px; font-weight:600;">${item.operator} ${item.value}</td>
            <td>${statusBadge}</td>
            <td><span class="text-muted" style="font-size:11px;">${item.trigger_date || 'Active scan...'}</span></td>
            <td>
                <button class="btn-translucent-delete" data-id="${item.id}">Delete 🗑️</button>
            </td>
        `;
        
        tr.querySelector('.btn-translucent-delete').addEventListener('click', async () => {
            if (confirm(`Are you sure you want to delete alert #${item.id}?`)) {
                try {
                    const response = await fetch(`/api/alerts/${item.id}`, { method: 'DELETE' });
                    if (!response.ok) throw new Error("Failed to delete alert.");
                    showToast("Alert successfully deleted.", "success");
                    fetchAlertsList();
                } catch (e) {
                    showToast("Failed to delete alert: " + e.message, "error");
                }
            }
        });
        
        tbody.appendChild(tr);
    });
}

async function checkAlertRules() {
    showLoader(
        "Scanning Alert Rules...",
        "Executing alert criteria scans against real-time financial metrics, historical PE floors, and RSI bands."
    );
    
    try {
        const response = await fetch('/api/alerts/check');
        const data = await response.json();
        
        renderAlertsList(data.alerts);
        
        if (data.triggers.length > 0) {
            showToast("ALERTS TRIGGERED: " + data.triggers.join(", "), "warning");
        } else {
            showToast("Alert scanning sweep complete. All asset conditions are currently holding within boundaries.", "success");
        }
    } catch (e) {
        showToast("Alert scanning failed: " + e.message, "error");
    } finally {
        hideLoader();
    }
}

// 9. Stateful Q&A Advisor Chat
function setupChatDrawer() {
    const drawer = document.getElementById('chat-drawer');
    const openBtn = document.getElementById('trigger-chat-btn');
    const closeBtn = document.getElementById('close-chat-btn');
    
    openBtn.addEventListener('click', () => drawer.classList.add('open'));
    closeBtn.addEventListener('click', () => drawer.classList.remove('open'));
    
    document.getElementById('send-chat-btn').addEventListener('click', sendUserChatMessage);
    document.getElementById('chat-user-input').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') sendUserChatMessage();
    });
    
    document.querySelectorAll('.chat-prompt-pill').forEach(pill => {
        pill.addEventListener('click', () => {
            document.getElementById('chat-user-input').value = pill.innerText;
            sendUserChatMessage();
        });
    });

    // Overhaul state machine tabs navigation
    const tabSynthesis = document.getElementById('tab-drawer-synthesis');
    const tabChat = document.getElementById('tab-drawer-chat');
    const synthesisContent = document.getElementById('drawer-synthesis-content');
    const chatContent = document.getElementById('drawer-chat-content');

    if (tabSynthesis && tabChat && synthesisContent && chatContent) {
        tabSynthesis.addEventListener('click', () => {
            tabSynthesis.classList.add('active');
            tabChat.classList.remove('active');
            synthesisContent.style.display = 'flex';
            chatContent.style.display = 'none';
        });

        tabChat.addEventListener('click', () => {
            tabChat.classList.add('active');
            tabSynthesis.classList.remove('active');
            chatContent.style.display = 'flex';
            synthesisContent.style.display = 'none';
        });
    }

    // Anchor the banner trigger click event: toggling drawer and focusing synthesis
    const convictionTrigger = document.getElementById('meta-ai-conviction-trigger');
    if (convictionTrigger) {
        convictionTrigger.addEventListener('click', (e) => {
            e.stopPropagation(); // Prevent immediate click-outside handler trigger
            if (drawer.classList.contains('open')) {
                drawer.classList.remove('open');
            } else {
                drawer.classList.add('open');
                if (tabSynthesis) {
                    tabSynthesis.click();
                }
                if (activeStockProfile) {
                    loadStockSynthesis(activeStockProfile.ticker);
                }
            }
        });
    }

    // Close drawer on clicking outside the drawer boundaries
    document.addEventListener('click', (e) => {
        if (!drawer || !drawer.classList.contains('open')) return;
        
        const isClickInsideDrawer = drawer.contains(e.target);
        const isClickOnPill = convictionTrigger && convictionTrigger.contains(e.target);
        const isClickOnOpenBtn = openBtn && openBtn.contains(e.target);

        if (!isClickInsideDrawer && !isClickOnPill && !isClickOnOpenBtn) {
            drawer.classList.remove('open');
        }
    });

    // Implement Premium Print Prospectus PDF Exporter
    const printProspectusBtn = document.getElementById('print-prospectus-btn');
    if (printProspectusBtn) {
        printProspectusBtn.addEventListener('click', () => {
            if (!activeStockProfile) {
                showToast("No active stock profile loaded. Please search for a stock first.", "warning");
                return;
            }
            
            const scoreNum = document.getElementById('synthesis-gauge-score-num')?.innerText;
            if (!scoreNum || scoreNum === '--') {
                showToast("Please wait for the AI Conviction Prospectus to load before printing.", "warning");
                return;
            }

            const companyName = activeStockProfile.company_name || 'N/A';
            const ticker = activeStockProfile.ticker || 'N/A';
            const sector = activeStockProfile.sector || 'N/A';
            const industry = activeStockProfile.industry || 'N/A';
            const price = document.getElementById('meta-price')?.innerText || 'N/A';
            
            const rating = document.getElementById('synthesis-badge-rec')?.innerText || 'N/A';
            const mos = document.getElementById('synthesis-micro-mos')?.innerText || 'N/A';
            const altman = document.getElementById('synthesis-micro-altman')?.innerText || 'N/A';
            const piotroski = document.getElementById('synthesis-micro-piotroski')?.innerText || 'N/A';
            
            const synthesisHTML = document.getElementById('synthesis-report-text')?.innerHTML || '';

            const today = new Date().toLocaleDateString('en-IN', {
                day: '2-digit',
                month: 'long',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });

            const ratingUpper = rating.toUpperCase();
            const ratingClass = ratingUpper.includes('BUY') ? 'highlight' : (ratingUpper.includes('SELL') || ratingUpper.includes('AVOID') ? 'highlight-sell' : 'highlight-hold');
            const badgeClass = ratingUpper.includes('BUY') ? 'badge-buy' : (ratingUpper.includes('SELL') || ratingUpper.includes('AVOID') ? 'badge-sell' : 'badge-hold');
            const ratingClean = rating.replace(/[🟡🟢🔴]/g, '').trim();

            const printContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>AI Research Prospectus - ${companyName} (${ticker})</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Outfit:wght@400;600;700;800&display=swap');
        
        @page {
            size: A4;
            margin: 20mm 15mm 20mm 15mm;
        }
        
        body {
            font-family: 'Inter', sans-serif;
            color: #111827;
            background: #ffffff;
            margin: 0;
            padding: 0;
            font-size: 11pt;
            line-height: 1.5;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
        }

        .header {
            border-bottom: 2px solid #1e3a8a;
            padding-bottom: 12px;
            margin-bottom: 20px;
        }

        .header-top {
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
        }

        .brand {
            font-family: 'Outfit', sans-serif;
            font-size: 14pt;
            font-weight: 800;
            color: #1e3a8a;
            letter-spacing: 0.05em;
            text-transform: uppercase;
        }

        .doc-type {
            font-size: 9pt;
            font-weight: 600;
            color: #6b7280;
            text-transform: uppercase;
            letter-spacing: 0.1em;
        }

        .company-title-row {
            margin-top: 15px;
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
        }

        .company-name {
            font-family: 'Outfit', sans-serif;
            font-size: 20pt;
            font-weight: 800;
            color: #111827;
            margin: 0;
            line-height: 1.2;
        }

        .company-ticker {
            font-size: 12pt;
            font-weight: 600;
            color: #2563eb;
            background: #eff6ff;
            padding: 2px 8px;
            border-radius: 4px;
            margin-left: 10px;
            display: inline-block;
            vertical-align: middle;
        }

        .meta-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 12px;
            background: #f9fafb;
            border: 1px solid #e5e7eb;
            border-radius: 6px;
            padding: 12px;
            margin-bottom: 20px;
        }

        .meta-item {
            display: flex;
            flex-direction: column;
        }

        .meta-label {
            font-size: 8pt;
            text-transform: uppercase;
            color: #6b7280;
            font-weight: 600;
            letter-spacing: 0.05em;
            margin-bottom: 2px;
        }

        .meta-value {
            font-size: 10pt;
            font-weight: 700;
            color: #1f2937;
        }

        .metrics-bar {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 12px;
            margin-bottom: 25px;
        }

        .metric-card {
            border: 1px solid #e5e7eb;
            border-radius: 6px;
            padding: 10px;
            text-align: center;
            background: #ffffff;
            box-shadow: 0 1px 2px rgba(0,0,0,0.02);
        }

        .metric-card.highlight {
            border-color: #10b981;
            background: #f0fdf4;
            border-left: 4px solid #10b981;
        }

        .metric-card.highlight-hold {
            border-color: #f59e0b;
            background: #fffdf5;
            border-left: 4px solid #f59e0b;
        }

        .metric-card.highlight-sell {
            border-color: #ef4444;
            background: #fdf2f2;
            border-left: 4px solid #ef4444;
        }

        .metric-score-large {
            font-family: 'Outfit', sans-serif;
            font-size: 22pt;
            font-weight: 800;
            color: #1e3a8a;
            line-height: 1.1;
        }

        .metric-badge {
            font-family: 'Outfit', sans-serif;
            font-size: 11pt;
            font-weight: 700;
            padding: 4px 8px;
            border-radius: 4px;
            display: inline-block;
            margin-top: 4px;
        }

        .badge-buy {
            background: #10b981;
            color: #ffffff;
        }

        .badge-hold {
            background: #f59e0b;
            color: #ffffff;
        }

        .badge-sell {
            background: #ef4444;
            color: #ffffff;
        }

        .section-title {
            font-family: 'Outfit', sans-serif;
            font-size: 12pt;
            font-weight: 700;
            color: #1e3a8a;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            border-bottom: 1px solid #e5e7eb;
            padding-bottom: 5px;
            margin-top: 25px;
            margin-bottom: 12px;
            page-break-after: avoid;
        }

        .prospectus-content {
            font-size: 10.5pt;
            line-height: 1.6;
            color: #374151;
            text-align: justify;
        }

        .prospectus-content p {
            margin-top: 0;
            margin-bottom: 12px;
        }

        .prospectus-content h3 {
            font-family: 'Outfit', sans-serif;
            font-size: 11pt;
            font-weight: 700;
            color: #111827;
            margin-top: 18px;
            margin-bottom: 8px;
            page-break-after: avoid;
        }

        .prospectus-content ul {
            margin-top: 0;
            margin-bottom: 12px;
            padding-left: 20px;
        }

        .prospectus-content li {
            margin-bottom: 4px;
        }

        .footer {
            margin-top: 40px;
            border-top: 1px solid #e5e7eb;
            padding-top: 10px;
            font-size: 8pt;
            color: #9ca3af;
            text-align: center;
            display: flex;
            justify-content: space-between;
            page-break-inside: avoid;
        }

        @media print {
            body {
                background: none;
                color: #000000;
            }
            .no-print {
                display: none;
            }
            .metric-card {
                box-shadow: none !important;
            }
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="header-top">
            <span class="brand">Apex Agentic AI Workstation</span>
            <span class="doc-type">Institutional Research Report</span>
        </div>
        <div class="company-title-row">
            <div>
                <span class="company-name">${companyName}</span>
                <span class="company-ticker">${ticker}</span>
            </div>
            <div style="text-align: right;">
                <div style="font-size: 8pt; color: #6b7280; font-weight: 600; text-transform: uppercase;">Reference Price</div>
                <div style="font-size: 14pt; font-weight: 800; color: #111827;">${price}</div>
            </div>
        </div>
    </div>

    <div class="meta-grid">
        <div class="meta-item">
            <span class="meta-label">Sector</span>
            <span class="meta-value">${sector}</span>
        </div>
        <div class="meta-item">
            <span class="meta-label">Industry</span>
            <span class="meta-value">${industry}</span>
        </div>
        <div class="meta-item">
            <span class="meta-label">Date Generated</span>
            <span class="meta-value">${today}</span>
        </div>
        <div class="meta-item">
            <span class="meta-label">Platform Engine</span>
            <span class="meta-value">Groq Llama 3 Synthesis</span>
        </div>
    </div>

    <div class="metrics-bar">
        <div class="metric-card">
            <div class="meta-label">Composite AI Score</div>
            <div class="metric-score-large" style="margin-top: 4px;">${scoreNum}<span style="font-size: 12pt; color: #6b7280; font-weight: 500;">/100</span></div>
        </div>
        
        <div class="metric-card ${ratingClass}">
            <div class="meta-label">AI Recommendation</div>
            <div class="metric-badge ${badgeClass}">${ratingClean}</div>
        </div>

         <div class="metric-card">
            <div class="meta-label">Margin of Safety</div>
            <div style="font-size: 13pt; font-weight: 800; margin-top: 6px; color: ${mos.includes('-') ? '#dc2626' : '#16a34a'};">${mos}</div>
        </div>

        <div class="metric-card">
            <div class="meta-label">Z-Score / Piotroski</div>
            <div style="font-size: 10.5pt; font-weight: 700; margin-top: 6px; color: #1f2937; line-height: 1.3;">
                Z: ${altman.split(' ')[0]}<br>
                F-Score: ${piotroski.split(' ')[0]}
            </div>
        </div>
    </div>

    <div class="section-title">I. Executive Summary & Synthesis Prospectus</div>
    <div class="prospectus-content">
        ${synthesisHTML}
    </div>

    <div class="footer">
        <span>Confidential - For Internal Institutional Use Only</span>
        <span>© ${new Date().getFullYear()} Apex Agentic Systems</span>
        <span>Page 1 of 1</span>
    </div>

    <script>
        window.addEventListener('DOMContentLoaded', () => {
            setTimeout(() => {
                window.print();
                window.close();
            }, 500);
        });
    </script>
</body>
</html>
            `;

            executeSystemPrint(printContent);
        });
    }
}

async function loadStockSynthesis(symbol) {
    if (!symbol) return;
    
    const horizon = document.getElementById('profile-horizon')?.value || 'Long-term (3+ years)';
    const risk = document.getElementById('profile-risk')?.value || 'Moderate';
    
    // Show compiling spinner in synthesis content
    const reportTextEl = document.getElementById('synthesis-report-text');
    if (reportTextEl) {
        reportTextEl.innerHTML = `
            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 40px 10px; gap: 12px;">
                <div class="spinner" style="width: 28px; height: 28px; border-width: 3px; border-color: rgba(168, 85, 247, 0.2); border-top-color: #a855f7;"></div>
                <div style="font-size: 11.5px; color: var(--text-secondary); font-weight: 500;">Synthesizing workspace indicators...</div>
            </div>
        `;
    }
    
    // Animate the trigger pill badge to show it's loading
    const triggerBadge = document.getElementById('meta-ai-conviction-trigger');
    const triggerText = document.getElementById('meta-ai-conviction-text');
    if (triggerBadge) {
        triggerBadge.style.opacity = '0.7';
    }
    if (triggerText) {
        triggerText.innerText = "Loading...";
    }
    
    try {
        const response = await fetch(`/api/synthesis?symbol=${encodeURIComponent(symbol)}&horizon=${encodeURIComponent(horizon)}&risk=${encodeURIComponent(risk)}`);
        if (!response.ok) throw new Error("Synthesis failed.");
        const data = await response.json();
        
        // Update top banner trigger badge
        if (triggerText) {
            triggerText.innerText = `Score: ${data.final_score}/100 (${data.recommendation})`;
        }
        if (triggerBadge) {
            triggerBadge.style.opacity = '1';
            // Adjust border and color based on recommendation
            if (data.recommendation.includes("BUY")) {
                triggerBadge.style.borderColor = 'rgba(16, 185, 129, 0.4)';
                triggerBadge.style.color = '#10b981';
            } else if (data.recommendation.includes("SELL") || data.recommendation.includes("AVOID")) {
                triggerBadge.style.borderColor = 'rgba(239, 68, 68, 0.4)';
                triggerBadge.style.color = '#ef4444';
            } else {
                triggerBadge.style.borderColor = 'rgba(245, 158, 11, 0.4)';
                triggerBadge.style.color = '#f59e0b';
            }
        }
        
        // Update drawer executive synthesis tab controls
        const scoreNumEl = document.getElementById('synthesis-gauge-score-num');
        if (scoreNumEl) scoreNumEl.innerText = data.final_score;
        
        const gaugeFill = document.getElementById('synthesis-gauge-fill');
        if (gaugeFill) {
            gaugeFill.setAttribute('stroke-dasharray', `${data.final_score}, 100`);
            if (data.final_score >= 70) {
                gaugeFill.style.stroke = 'var(--color-emerald)';
            } else if (data.final_score >= 45) {
                gaugeFill.style.stroke = 'var(--color-amber)';
            } else {
                gaugeFill.style.stroke = 'var(--color-crimson)';
            }
        }
        
        const ratingBadge = document.getElementById('synthesis-badge-rec');
        if (ratingBadge) {
            ratingBadge.innerText = data.recommendation + (data.recommendation.includes("BUY") ? " 🟢" : (data.recommendation.includes("HOLD") ? " 🟡" : " 🔴"));
            ratingBadge.className = 'badge-rec';
            if (data.recommendation.includes("BUY")) ratingBadge.classList.add('rec-buy');
            if (data.recommendation.includes("STRONG BUY")) ratingBadge.classList.add('rec-strong-buy');
            if (data.recommendation.includes("HOLD")) ratingBadge.classList.add('rec-hold');
            if (data.recommendation.includes("SELL") || data.recommendation.includes("AVOID")) ratingBadge.classList.add('rec-sell');
        }
        
        // Micro indicators
        const mosEl = document.getElementById('synthesis-micro-mos');
        if (mosEl) {
            mosEl.innerText = `${data.margin_of_safety > 0 ? '+' : ''}${data.margin_of_safety.toFixed(1)}%`;
            mosEl.className = data.margin_of_safety >= 0 ? 'green-text' : 'red-text';
        }
        
        const altmanEl = document.getElementById('synthesis-micro-altman');
        if (altmanEl) {
            altmanEl.innerText = `${data.altman_z_score.toFixed(2)} (${data.altman_zone.split(' ')[0]})`;
            if (data.altman_zone.includes("Safe")) altmanEl.className = 'green-text';
            else if (data.altman_zone.includes("Grey")) altmanEl.className = 'yellow-text';
            else altmanEl.className = 'red-text';
        }
        
        const piotroskiEl = document.getElementById('synthesis-micro-piotroski');
        if (piotroskiEl) {
            piotroskiEl.innerText = `${data.piotroski_score}/9 (${data.piotroski_label.split(' ')[0]})`;
            if (data.piotroski_score >= 7) piotroskiEl.className = 'green-text';
            else if (data.piotroski_score >= 4) piotroskiEl.className = 'yellow-text';
            else piotroskiEl.className = 'red-text';
        }
        
        // Process text formatting for raw markdown headers and bolding
        let formattedText = data.synthesis_text
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/### (.*?)\n/g, '<h3>$1</h3>')
            .replace(/\* (.*?)\n/g, '<li>$1</li>')
            .replace(/\n\n/g, '</p><p>');
        
        if (formattedText.includes('<li>')) {
            formattedText = formattedText.replace(/(<li>.*?<\/li>)/gs, '<ul>$1</ul>');
        }
        
        if (reportTextEl) {
            reportTextEl.innerHTML = `<p>${formattedText}</p>`;
        }
    } catch (e) {
        console.error("Synthesis load error:", e);
        if (triggerText) triggerText.innerText = "Error";
        if (reportTextEl) {
            reportTextEl.innerHTML = `<span class="red-text" style="font-size: 12px;">Failed to compile AI equities synthesis: ${e.message}. Please verify Groq API configurations.</span>`;
        }
    }
}

async function sendUserChatMessage() {
    const input = document.getElementById('chat-user-input');
    const message = input.value.trim();
    if (!message || !activeStockProfile) return;
    
    input.value = '';
    appendChatMessage('user', message);
    chatHistory.push({ role: 'user', content: message });
    
    const typingId = appendChatMessage('assistant', 'Consulting AI stock advisor...');
    
    try {
        const payload = {
            history: chatHistory,
            message: message,
            profile: activeStockProfile
        };
        
        const response = await fetch('/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        if (!response.ok) throw new Error("Chat transmission failed.");
        const data = await response.json();
        
        const chatReplyText = data.response || "No response received from Equities Advisor.";
        document.getElementById(typingId).remove();
        appendChatMessage('assistant', chatReplyText);
        chatHistory.push({ role: 'assistant', content: chatReplyText });
    } catch (e) {
        document.getElementById(typingId).remove();
        appendChatMessage('assistant', "I encountered a connection error. Please verify your API key configurations.");
    }
}

function appendChatMessage(role, content) {
    const box = document.getElementById('chat-messages');
    const msg = document.createElement('div');
    const msgId = 'msg-' + Math.random().toString(36).substr(2, 9);
    
    msg.id = msgId;
    msg.className = `chat-message ${role}`;
    
    if (role === 'assistant') {
        // Escape HTML to prevent XSS but allow specific markdown formatting
        let escaped = content
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");
            
        let formatted = escaped
            .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
            .replace(/### (.*?)(?:\n|$)/g, '<h3>$1</h3>')
            .replace(/\* (.*?)(?:\n|$)/g, '<li>$1</li>')
            .replace(/\n\n/g, '</p><p>')
            .replace(/\n/g, '<br>');
            
        if (formatted.includes('<li>')) {
            formatted = formatted.replace(/(<li>.*?<\/li>)/gs, '<ul>$1</ul>');
        }
        
        msg.innerHTML = `<p>${formatted}</p>`;
    } else {
        msg.innerText = content;
    }
    
    box.appendChild(msg);
    box.scrollTop = box.scrollHeight;
    
    return msgId;
}

// 10. PDF Export Stylesheet Binding
function setupPDFExport() {
    document.getElementById('export-pdf-btn').addEventListener('click', () => {
        // 1. Store the currently active sub-tab so we can restore it afterwards
        const activeSubtabBtn = document.querySelector('.subtab-btn.active');
        const activeSubtab = activeSubtabBtn ? activeSubtabBtn.getAttribute('data-subtab') : 'summary';

        // 1b. Temporarily change document.title to set a standard saved PDF filename
        const originalTitle = document.title;
        const tickerEl = document.getElementById('meta-ticker');
        const tickerRaw = tickerEl ? tickerEl.innerText.trim() : 'STOCK';
        const ticker = tickerRaw.replace('.NS', '').replace('.BO', '');
        
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        const hh = String(now.getHours()).padStart(2, '0');
        const min = String(now.getMinutes()).padStart(2, '0');
        const timestamp = `${yyyy}${mm}${dd}_${hh}${min}`;
        
        document.title = `${ticker}_Equity_Research_Report_${timestamp}`;

        // Helper to synchronously resize and update all Chart.js instances
        const forceUpdateCharts = () => {
            const chartInstances = [
                typeof activeChartInstance !== 'undefined' ? activeChartInstance : null,
                typeof activePeerChartInstance !== 'undefined' ? activePeerChartInstance : null,
                typeof activeFibChartInstance !== 'undefined' ? activeFibChartInstance : null,
                typeof activeDrawdownChartInstance !== 'undefined' ? activeDrawdownChartInstance : null,
                typeof miniCharts !== 'undefined' ? miniCharts.bb : null,
                typeof miniCharts !== 'undefined' ? miniCharts.atr : null,
                typeof miniCharts !== 'undefined' ? miniCharts.macd : null,
                typeof miniCharts !== 'undefined' ? miniCharts.vpt : null
            ];
            chartInstances.forEach(chart => {
                if (chart && typeof chart.resize === 'function') {
                    try {
                        chart.resize();
                        chart.update();
                    } catch (e) {
                        console.warn("Chart resize failed during print prep:", e);
                    }
                }
            });
        };

        // 2. Temporarily remove 'card-hidden' class from all cards that should print
        const cards = document.querySelectorAll('.dashboard-grid > .card');
        cards.forEach(card => {
            if (!card.classList.contains('print-exclude') && !card.classList.contains('no-print')) {
                card.classList.remove('card-hidden');
            }
        });

        // 3. Temporarily expand the business summary content accordion
        const summaryContent = document.getElementById('business-summary-content');
        let originalMaxHeight = '';
        if (summaryContent) {
            originalMaxHeight = summaryContent.style.maxHeight;
            summaryContent.style.maxHeight = 'none';
        }

        // 4. Force a window resize event and run synchronous chart updates on visible DOM elements
        window.dispatchEvent(new Event('resize'));
        forceUpdateCharts();

        // 5. Allow a 150ms delay for Chart.js rendering cycle, then fire the print dialog
        setTimeout(() => {
            window.print();

            // 6. Print dialog completed (or cancelled), restore active tab card visibilities
            cards.forEach(card => {
                const subtabAttr = card.getAttribute('data-subtab');
                if (subtabAttr !== activeSubtab) {
                    card.classList.add('card-hidden');
                }
            });

            // 7. Restore the business summary content accordion max-height
            if (summaryContent) {
                summaryContent.style.maxHeight = originalMaxHeight;
            }

            // 7b. Restore the original document title
            document.title = originalTitle;

            // 8. Re-trigger resize and sync charts to realign to active tab
            window.dispatchEvent(new Event('resize'));
            forceUpdateCharts();
        }, 150);
    });
    
    document.querySelectorAll('.print-toggle').forEach(checkbox => {
        checkbox.addEventListener('change', () => {
            const targetId = checkbox.getAttribute('data-target');
            const targetEl = document.getElementById(targetId);
            if (targetEl) {
                if (checkbox.checked) {
                    targetEl.classList.remove('print-exclude');
                } else {
                    targetEl.classList.add('print-exclude');
                }
            }
        });
    });

    // Toggle Print Checklist Accordion Window
    const toggle = document.getElementById('print-checklist-toggle');
    const content = document.getElementById('print-checklist-content');
    const arrow = document.getElementById('print-checklist-arrow');
    
    if (toggle && content) {
        toggle.addEventListener('click', () => {
            const isCollapsed = content.style.maxHeight === '0px' || content.style.maxHeight === '' || content.style.maxHeight === '0';
            if (isCollapsed) {
                content.style.maxHeight = content.scrollHeight + 'px';
                if (arrow) arrow.style.transform = 'rotate(180deg)';
                toggle.style.borderColor = 'rgba(59, 130, 246, 0.4)';
            } else {
                content.style.maxHeight = '0px';
                if (arrow) arrow.style.transform = 'rotate(0deg)';
                toggle.style.borderColor = 'var(--border-glass)';
            }
        });
    }
}

// 11. Custom Advanced Interactive Charts drawing routines (Fibonacci, Volatility Grid)
let activeFibChartInstance = null;
let miniCharts = {
    bb: null,
    atr: null,
    macd: null,
    vpt: null
};

function drawFibonacciChart(p) {
    const container = document.getElementById('fibonacci-chart-container');
    if (!container) return;

    // 1. Clean up previous Lightweight Fibonacci Chart instance
    if (window.activeFibLightweightChart) {
        try {
            window.activeFibLightweightChart.remove();
        } catch (e) {
            console.warn("Error removing Fibonacci chart:", e);
        }
        window.activeFibLightweightChart = null;
    }
    
    // Clean up legacy Chart.js instances if any exist
    if (activeFibChartInstance) {
        activeFibChartInstance.destroy();
        activeFibChartInstance = null;
    }

    // 2. Check if TradingView Lightweight Charts is available
    if (typeof LightweightCharts === 'undefined') {
        console.warn("TradingView Lightweight Charts offline, falling back to Chart.js for Fibonacci retracements.");
        drawChartJSFibonacciChart(p);
        return;
    }

    container.innerHTML = ''; // Clear container for TradingView Canvas
    const isDarkTheme = document.body.getAttribute('data-theme') !== 'light';
    const hudEl = document.getElementById('fibonacci-chart-hud');

    const fib = p.technicals ? p.technicals.fib_levels : null;
    const curPrice = p.fundamentals.current_price;
    const low_52w = p.technicals ? p.technicals.low_52w : null;
    const high_52w = p.technicals ? p.technicals.high_52w : null;

    if (!fib || curPrice === null || curPrice === undefined || low_52w === null || high_52w === null || isNaN(low_52w) || isNaN(high_52w)) {
        container.innerHTML = `<div class="chart-fallback" style="display:flex; align-items:center; justify-content:center; height:100%; font-size:11px; color:var(--text-muted); text-align:center; padding:10px; border: 1px dashed var(--border-glass); border-radius:6px; background:rgba(0,0,0,0.15);">Fibonacci retracement level indicators are currently unavailable for this asset.</div>`;
        return;
    }

    // 3. Create Lightweight Chart
    const chart = LightweightCharts.createChart(container, {
        width: container.clientWidth,
        height: 250,
        layout: {
            background: { type: 'solid', color: 'transparent' },
            textColor: isDarkTheme ? '#94a3b8' : '#334155',
            fontFamily: 'Inter, sans-serif',
        },
        grid: {
            vertLines: { color: isDarkTheme ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.03)' },
            horzLines: { color: isDarkTheme ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.03)' },
        },
        rightPriceScale: {
            borderColor: isDarkTheme ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
            scaleMargins: { top: 0.1, bottom: 0.1 }
        },
        timeScale: {
            borderColor: isDarkTheme ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
            timeVisible: false,
            fixLeftEdge: true,
            fixRightEdge: true
        },
        crosshair: {
            mode: LightweightCharts.CrosshairMode.Normal,
        }
    });
    window.activeFibLightweightChart = chart;

    // 4. Plot close price Area series
    const priceSeries = chart.addAreaSeries({
        topColor: 'rgba(0, 229, 255, 0.22)',
        bottomColor: 'rgba(0, 229, 255, 0.0)',
        lineColor: '#00e5ff',
        lineWidth: 2,
        priceFormat: { type: 'custom', formatter: v => `₹${v.toFixed(1)}` }
    });

    let dates = [];
    let prices = [];

    // Pull from active cached chart data if available
    if (window.activeChartData && window.activeChartData.prices && window.activeChartData.labels) {
        dates = window.activeChartData.labels.map(d => d.split('T')[0]);
        prices = window.activeChartData.prices.map(v => Number(v));
    } else {
        // Safe immediate timeline mock
        dates = [new Date().toISOString().split('T')[0]];
        prices = [curPrice];
    }

    const priceData = dates.map((d, idx) => ({
        time: d,
        value: prices[idx]
    })).filter(item => item.value !== null && !isNaN(item.value));

    priceSeries.setData(priceData);

    // 5. Overlay 7 Horizontal Fibonacci levels
    const levels = [
        { val: fib.fib_0, ratio: '0.0%', label: '0.0% (High Ceiling)', color: 'rgba(239, 68, 68, 0.8)' },
        { val: fib.fib_236, ratio: '23.6%', label: '23.6% Retracement', color: 'rgba(245, 158, 11, 0.7)' },
        { val: fib.fib_382, ratio: '38.2%', label: '38.2% Retracement', color: 'rgba(234, 179, 8, 0.7)' },
        { val: fib.fib_500, ratio: '50.0%', label: '50.0% Retracement Pivot', color: 'rgba(99, 102, 241, 0.7)' },
        { val: fib.fib_618, ratio: '61.8%', label: '61.8% Golden Support', color: 'rgba(16, 185, 129, 0.85)' },
        { val: fib.fib_786, ratio: '78.6%', label: '78.6% Retracement Floor', color: 'rgba(148, 163, 184, 0.7)' },
        { val: fib.fib_100, ratio: '100.0%', label: '100% (Low Floor)', color: 'rgba(239, 68, 68, 0.8)' }
    ];

    levels.forEach(lvl => {
        priceSeries.createPriceLine({
            price: Number(lvl.val),
            color: lvl.color,
            lineWidth: 1.2,
            lineStyle: LightweightCharts.LineStyle.Dashed,
            axisLabelVisible: true,
            title: lvl.label
        });
    });

    chart.timeScale().fitContent();

    // 6. Dynamic Crosshair Proximity Tracker
    const updateHUD = (timeStr) => {
        if (!hudEl) return;
        const idx = dates.indexOf(timeStr);
        const price = idx !== -1 ? prices[idx] : curPrice;

        // Find nearest Fibonacci level
        let nearestLvl = levels[0];
        let minDist = Math.abs(price - Number(levels[0].val));

        levels.forEach(lvl => {
            const dist = Math.abs(price - Number(lvl.val));
            if (dist < minDist) {
                minDist = dist;
                nearestLvl = lvl;
            }
        });

        const devPercent = Number(nearestLvl.val) > 0 ? ((minDist / Number(nearestLvl.val)) * 100).toFixed(1) : '0.0';
        const direction = price >= Number(nearestLvl.val) ? 'above' : 'below';

        hudEl.innerHTML = `
            <span style="color:var(--text-primary); font-weight:600; margin-right:15px;">📅 ${timeStr || 'Latest'}</span>
            <span style="color:#00e5ff; font-weight:600; margin-right:15px;">● Price: ₹${price.toFixed(1)}</span>
            <span style="color:#10b981; font-weight:600;">🛡️ Nearest Level: ${nearestLvl.ratio} (₹${Number(nearestLvl.val).toFixed(1)}) — ${devPercent}% ${direction}</span>
        `;
    };

    // Initialize with latest data points
    if (dates.length > 0) {
        updateHUD(dates[dates.length - 1]);
    }

    // Connect crosshair listeners
    chart.subscribeCrosshairMove(param => {
        if (param.time) {
            const timeStr = typeof param.time === 'string'
                ? param.time
                : `${param.time.year}-${String(param.time.month).padStart(2,'0')}-${String(param.time.day).padStart(2,'0')}`;
            updateHUD(timeStr);
        } else {
            if (dates.length > 0) {
                updateHUD(dates[dates.length - 1]);
            }
        }
    });

    // Resize Observer
    const resizeObserver = new ResizeObserver(entries => {
        for (let entry of entries) {
            chart.resize(entry.contentRect.width, 250);
        }
    });
    resizeObserver.observe(container);
}

function drawChartJSFibonacciChart(p) {
    const canvas = document.getElementById('fibonacci-chart');
    const container = canvas?.parentElement;
    if (!container) return;

    const restoredCanvas = getOrCreateCanvas('fibonacci-chart', container);
    if (!restoredCanvas) return;

    if (activeFibChartInstance) {
        activeFibChartInstance.destroy();
    }

    try {
        const ctx = restoredCanvas.getContext('2d');
        const fib = p.technicals ? p.technicals.fib_levels : null;
        const curPrice = p.fundamentals.current_price;
        const low_52w = p.technicals ? p.technicals.low_52w : null;
        const high_52w = p.technicals ? p.technicals.high_52w : null;

        if (!fib || curPrice === null || curPrice === undefined || low_52w === null || high_52w === null || isNaN(low_52w) || isNaN(high_52w)) {
            container.innerHTML = `<div class="chart-fallback" style="display:flex; align-items:center; justify-content:center; height:100%; font-size:11px; color:var(--text-muted); text-align:center; padding:10px; border: 1px dashed var(--border-glass); border-radius:6px; background:rgba(0,0,0,0.15);">Fibonacci retracement level indicators are currently unavailable for this asset.</div>`;
            return;
        }

        const labels = ['0% (High)', '23.6%', '38.2%', '50.0%', '61.8%', '78.6%', '100% (Low)'];
        const values = [
            fib.fib_0,
            fib.fib_236,
            fib.fib_382,
            fib.fib_500,
            fib.fib_618,
            fib.fib_786,
            fib.fib_100
        ];

        const gradient = ctx.createLinearGradient(0, 0, 300, 0);
        gradient.addColorStop(0, 'rgba(59, 130, 246, 0.4)');
        gradient.addColorStop(1, 'rgba(99, 102, 241, 0.7)');

        activeFibChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Fibonacci Level Price (Rs)',
                    data: values,
                    backgroundColor: gradient,
                    borderColor: '#6366f1',
                    borderWidth: 1,
                    borderRadius: 4,
                    barThickness: 12
                }]
            },
            options: {
                indexAxis: 'y',
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    currentPriceLine: { price: curPrice }
                },
                scales: {
                    x: {
                        min: Math.floor(low_52w * 0.95),
                        max: Math.ceil(high_52w * 1.05),
                        grid: { color: 'rgba(255, 255, 255, 0.02)' },
                        ticks: { color: '#9ca3af', font: { size: 9 } }
                    },
                    y: {
                        grid: { display: false },
                        ticks: { color: '#9ca3af', font: { size: 9 } }
                    }
                }
            },
            plugins: [{
                id: 'currentPriceLine',
                afterDraw(chart) {
                    const { ctx, chartArea: { top, bottom }, scales: { x } } = chart;
                    const price = chart.options.plugins.currentPriceLine.price;
                    if (price === undefined || price === null || isNaN(price)) return;
                    const xPos = x.getPixelForValue(price);
                    if (xPos < x.left || xPos > x.right) return;

                    ctx.save();
                    ctx.strokeStyle = '#10b981';
                    ctx.lineWidth = 1.5;
                    ctx.setLineDash([4, 4]);
                    ctx.beginPath();
                    ctx.moveTo(xPos, top);
                    ctx.lineTo(xPos, bottom);
                    ctx.stroke();

                    ctx.fillStyle = '#10b981';
                    ctx.font = 'bold 9px Outfit';
                    const formattedPrice = Number(price).toLocaleString('en-IN');
                    ctx.fillText(`Current: Rs. ${formattedPrice}`, xPos + 4, top + 10);
                    ctx.restore();
                }
            }]
        });
    } catch (e) {
        console.error("Error drawing Fibonacci chart: ", e);
        container.innerHTML = `<div class="chart-fallback" style="display:flex; align-items:center; justify-content:center; height:100%; font-size:11px; color:var(--text-muted); text-align:center; padding:10px; border: 1px dashed var(--border-glass); border-radius:6px; background:rgba(0,0,0,0.1);">Error rendering Fibonacci levels: ${e.message}</div>`;
    }
}

function drawVolatilityMomentumMiniCharts(data) {
    // 1. Clean up previous Lightweight Volatility Chart instances
    if (window.activeVolatilityLightweightCharts) {
        Object.keys(window.activeVolatilityLightweightCharts).forEach(key => {
            if (window.activeVolatilityLightweightCharts[key]) {
                try {
                    window.activeVolatilityLightweightCharts[key].remove();
                } catch (e) {
                    console.warn("Error removing volatility chart:", e);
                }
                window.activeVolatilityLightweightCharts[key] = null;
            }
        });
    }
    window.activeVolatilityLightweightCharts = { bb: null, atr: null, macd: null, vpt: null };

    // 2. Check if TradingView Lightweight Charts is available
    if (typeof LightweightCharts === 'undefined') {
        console.warn("TradingView Lightweight Charts offline, falling back to Chart.js for volatility mini-charts.");
        drawChartJSVolatilityMiniCharts(data);
        return;
    }

    // Clean up legacy Chart.js instances if any exist
    Object.keys(miniCharts).forEach(key => {
        if (miniCharts[key]) {
            miniCharts[key].destroy();
            miniCharts[key] = null;
        }
    });

    const isDarkTheme = document.body.getAttribute('data-theme') !== 'light';
    const hudEl = document.getElementById('volatility-chart-hud');

    // Containers
    const containers = {
        bb: document.getElementById('volatility-bb-container'),
        atr: document.getElementById('volatility-atr-container'),
        macd: document.getElementById('volatility-macd-container'),
        vpt: document.getElementById('volatility-vpt-container')
    };

    if (!containers.bb || !containers.atr || !containers.macd || !containers.vpt) return;

    // Clear contents
    Object.keys(containers).forEach(key => {
        containers[key].innerHTML = '';
    });

    // Formatting Helpers
    const formattedDates = data.labels.map(d => d.split('T')[0]);
    const getSeriesData = (arr) => {
        return formattedDates.map((d, idx) => ({
            time: d,
            value: Number(arr[idx])
        })).filter(item => item.value !== null && !isNaN(item.value));
    };

    // Shared Chart Constructor Options
    const getChartOptions = (container) => ({
        width: container.clientWidth,
        height: 120,
        layout: {
            background: { type: 'solid', color: 'transparent' },
            textColor: isDarkTheme ? '#94a3b8' : '#334155',
            fontFamily: 'Inter, sans-serif',
        },
        grid: {
            vertLines: { color: isDarkTheme ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.03)' },
            horzLines: { color: isDarkTheme ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.03)' },
        },
        rightPriceScale: {
            borderColor: isDarkTheme ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
            scaleMargins: { top: 0.15, bottom: 0.15 }
        },
        timeScale: {
            borderColor: isDarkTheme ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
            timeVisible: false,
            fixLeftEdge: true,
            fixRightEdge: true
        },
        crosshair: {
            mode: LightweightCharts.CrosshairMode.Normal,
        }
    });

    // Create Charts
    const bbChart = LightweightCharts.createChart(containers.bb, getChartOptions(containers.bb));
    const atrChart = LightweightCharts.createChart(containers.atr, getChartOptions(containers.atr));
    const macdChart = LightweightCharts.createChart(containers.macd, getChartOptions(containers.macd));
    const vptChart = LightweightCharts.createChart(containers.vpt, getChartOptions(containers.vpt));

    window.activeVolatilityLightweightCharts.bb = bbChart;
    window.activeVolatilityLightweightCharts.atr = atrChart;
    window.activeVolatilityLightweightCharts.macd = macdChart;
    window.activeVolatilityLightweightCharts.vpt = vptChart;

    const charts = [bbChart, atrChart, macdChart, vptChart];

    // 1. Bollinger Bands price lines
    const bbPriceSeries = bbChart.addLineSeries({
        color: '#00e5ff',
        lineWidth: 2,
        priceFormat: { type: 'custom', formatter: v => `₹${v.toFixed(1)}` }
    });
    const bbUpperSeries = bbChart.addLineSeries({
        color: 'rgba(239, 68, 68, 0.5)',
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dashed,
        priceFormat: { type: 'custom', formatter: v => `₹${v.toFixed(1)}` }
    });
    const bbLowerSeries = bbChart.addLineSeries({
        color: 'rgba(239, 68, 68, 0.5)',
        lineWidth: 1,
        lineStyle: LightweightCharts.LineStyle.Dashed,
        priceFormat: { type: 'custom', formatter: v => `₹${v.toFixed(1)}` }
    });

    bbPriceSeries.setData(getSeriesData(data.prices));
    bbUpperSeries.setData(getSeriesData(data.bb_upper));
    bbLowerSeries.setData(getSeriesData(data.bb_lower));

    // 2. ATR Area Series
    const atrSeries = atrChart.addAreaSeries({
        topColor: 'rgba(99, 102, 241, 0.25)',
        bottomColor: 'rgba(99, 102, 241, 0.0)',
        lineColor: '#6366f1',
        lineWidth: 2,
        priceFormat: { type: 'custom', formatter: v => `₹${v.toFixed(2)}` }
    });
    atrSeries.setData(getSeriesData(data.atr));

    // 3. MACD Hist Columns
    const macdSeries = macdChart.addHistogramSeries({
        priceFormat: { type: 'volume' }
    });
    const macdData = formattedDates.map((d, idx) => {
        const val = Number(data.macd_hist[idx]);
        return {
            time: d,
            value: val,
            color: val >= 0 ? 'rgba(16, 185, 129, 0.7)' : 'rgba(239, 68, 68, 0.7)'
        };
    }).filter(item => item.value !== null && !isNaN(item.value));
    macdSeries.setData(macdData);

    // 4. VPT Area Series
    const vptSeries = vptChart.addAreaSeries({
        topColor: 'rgba(168, 85, 247, 0.25)',
        bottomColor: 'rgba(168, 85, 247, 0.0)',
        lineColor: '#a855f7',
        lineWidth: 2,
        priceFormat: { type: 'volume' }
    });
    vptSeries.setData(getSeriesData(data.vpt));

    // Fit content
    charts.forEach(c => c.timeScale().fitContent());

    // Synchronize horizontal panned and zoomed visible scales!
    charts.forEach(srcChart => {
        srcChart.timeScale().subscribeVisibleLogicalRangeChange(range => {
            charts.forEach(targetChart => {
                if (targetChart !== srcChart) {
                    targetChart.timeScale().setVisibleLogicalRange(range);
                }
            });
        });
    });

    // Dynamic HUD Crosshair Update Router
    const updateHUD = (timeStr) => {
        if (!hudEl) return;
        const idx = formattedDates.indexOf(timeStr);
        if (idx === -1) return;

        const price = Number(data.prices[idx]);
        const bbUpper = Number(data.bb_upper[idx]);
        const bbLower = Number(data.bb_lower[idx]);
        const atrVal = Number(data.atr[idx]);
        const macdVal = Number(data.macd_hist[idx]);
        const vptVal = Number(data.vpt[idx]);

        const bbSqueeze = bbLower > 0 ? (((bbUpper - bbLower) / bbLower) * 100).toFixed(1) : '0.0';

        hudEl.innerHTML = `
            <span style="color:var(--text-primary); font-weight:600; margin-right:15px;">📅 ${timeStr}</span>
            <span style="color:#00e5ff; font-weight:600; margin-right:15px;">● Close: ₹${price.toFixed(1)}</span>
            <span style="color:#f87171; font-weight:600; margin-right:15px;">● BB Sqz: ${bbSqueeze}% (₹${bbLower.toFixed(1)}-₹${bbUpper.toFixed(1)})</span>
            <span style="color:#6366f1; font-weight:600; margin-right:15px;">● ATR: ₹${atrVal.toFixed(2)}</span>
            <span style="color:${macdVal >= 0 ? '#10b981' : '#ef4444'}; font-weight:600; margin-right:15px;">● MACD Hist: ${macdVal >= 0 ? '+' : ''}${macdVal.toFixed(2)}</span>
            <span style="color:#a855f7; font-weight:600;">● VPT: ${vptVal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
        `;

        // Update indicators text details synchronously
        document.getElementById('label-vol-bb').innerText = `₹${bbLower.toFixed(1)} - ₹${bbUpper.toFixed(1)} (Sqz: ${bbSqueeze}%)`;
        document.getElementById('label-vol-atr').innerText = `₹${atrVal.toFixed(2)}`;
        document.getElementById('label-vol-macd').innerText = `${macdVal.toFixed(2)} (${macdVal >= 0 ? 'Bullish' : 'Bearish'})`;
        document.getElementById('label-vol-vpt').innerText = vptVal.toLocaleString('en-IN', { maximumFractionDigits: 0 });
    };

    // Initialize with latest data points
    if (formattedDates.length > 0) {
        updateHUD(formattedDates[formattedDates.length - 1]);
    }

    // Connect Crosshair Hover Listeners
    charts.forEach(chartInstance => {
        chartInstance.subscribeCrosshairMove(param => {
            if (param.time) {
                const timeStr = typeof param.time === 'string'
                    ? param.time
                    : `${param.time.year}-${String(param.time.month).padStart(2,'0')}-${String(param.time.day).padStart(2,'0')}`;
                updateHUD(timeStr);
            } else {
                if (formattedDates.length > 0) {
                    updateHUD(formattedDates[formattedDates.length - 1]);
                }
            }
        });
    });

    // Resize Observer Alignment
    charts.forEach((chartInstance, chartIdx) => {
        const containerId = ['volatility-bb-container', 'volatility-atr-container', 'volatility-macd-container', 'volatility-vpt-container'][chartIdx];
        const containerEl = document.getElementById(containerId);
        if (containerEl) {
            const resizeObserver = new ResizeObserver(entries => {
                for (let entry of entries) {
                    chartInstance.resize(entry.contentRect.width, 120);
                }
            });
            resizeObserver.observe(containerEl);
        }
    });
}

function drawChartJSVolatilityMiniCharts(data) {
    const targets = {
        bb: 'chart-vol-bb',
        atr: 'chart-vol-atr',
        macd: 'chart-vol-macd',
        vpt: 'chart-vol-vpt'
    };

    Object.keys(miniCharts).forEach(key => {
        if (miniCharts[key]) {
            miniCharts[key].destroy();
            miniCharts[key] = null;
        }
    });

    const sparklineOptions = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: { display: false },
            tooltip: { enabled: true }
        },
        scales: {
            x: { display: false },
            y: { display: false }
        },
        elements: {
            point: { radius: 0, hoverRadius: 4 }
        }
    };

    // 1. Bollinger Bands Sparkline
    try {
        const canvas = document.getElementById('chart-vol-bb');
        const container = canvas?.parentElement;
        if (container) {
            const restoredCanvas = getOrCreateCanvas('chart-vol-bb', container);
            if (restoredCanvas) {
                const ctx = restoredCanvas.getContext('2d');
                miniCharts.bb = new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: data.labels,
                        datasets: [
                            {
                                label: 'Price',
                                data: data.prices,
                                borderColor: '#3b82f6',
                                borderWidth: 1.5,
                                fill: false
                            },
                            {
                                label: 'BB Upper',
                                data: data.bb_upper,
                                borderColor: 'rgba(239, 68, 68, 0.4)',
                                borderWidth: 1,
                                borderDash: [3, 3],
                                fill: false
                            },
                            {
                                label: 'BB Lower',
                                data: data.bb_lower,
                                borderColor: 'rgba(239, 68, 68, 0.4)',
                                borderWidth: 1,
                                borderDash: [3, 3],
                                fill: false
                            }
                        ]
                    },
                    options: sparklineOptions
                });
            }
        }
    } catch (e) {
        console.error("Error drawing BB mini chart: ", e);
    }

    // 2. ATR Area Sparkline
    try {
        const canvas = document.getElementById('chart-vol-atr');
        const container = canvas?.parentElement;
        if (container) {
            const restoredCanvas = getOrCreateCanvas('chart-vol-atr', container);
            if (restoredCanvas) {
                const ctx = restoredCanvas.getContext('2d');
                const gradient = ctx.createLinearGradient(0, 0, 0, restoredCanvas.height || 60);
                gradient.addColorStop(0, 'rgba(99, 102, 241, 0.3)');
                gradient.addColorStop(1, 'rgba(99, 102, 241, 0.0)');

                miniCharts.atr = new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: data.labels,
                        datasets: [{
                            label: 'ATR',
                            data: data.atr,
                            borderColor: '#6366f1',
                            borderWidth: 1.5,
                            backgroundColor: gradient,
                            fill: true
                        }]
                    },
                    options: sparklineOptions
                });
            }
        }
    } catch (e) {
        console.error("Error drawing ATR mini chart: ", e);
    }

    // 3. MACD Histogram Bar Sparkline
    try {
        const canvas = document.getElementById('chart-vol-macd');
        const container = canvas?.parentElement;
        if (container) {
            const restoredCanvas = getOrCreateCanvas('chart-vol-macd', container);
            if (restoredCanvas) {
                const ctx = restoredCanvas.getContext('2d');
                const barColors = data.macd_hist.map(v => v >= 0 ? 'rgba(16, 185, 129, 0.7)' : 'rgba(239, 68, 68, 0.7)');

                miniCharts.macd = new Chart(ctx, {
                    type: 'bar',
                    data: {
                        labels: data.labels,
                        datasets: [{
                            label: 'MACD Hist',
                            data: data.macd_hist,
                            backgroundColor: barColors,
                            borderWidth: 0,
                            categoryPercentage: 0.8,
                            barPercentage: 0.9
                        }]
                    },
                    options: sparklineOptions
                });
            }
        }
    } catch (e) {
        console.error("Error drawing MACD mini chart: ", e);
    }

    // 4. VPT Accumulation Line Sparkline
    try {
        const canvas = document.getElementById('chart-vol-vpt');
        const container = canvas?.parentElement;
        if (container) {
            const restoredCanvas = getOrCreateCanvas('chart-vol-vpt', container);
            if (restoredCanvas) {
                const ctx = restoredCanvas.getContext('2d');
                miniCharts.vpt = new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: data.labels,
                        datasets: [{
                            label: 'VPT',
                            data: data.vpt,
                            borderColor: '#a855f7',
                            borderWidth: 1.5,
                            fill: false
                        }]
                    },
                    options: sparklineOptions
                });
            }
        }
    } catch (e) {
        console.error("Error drawing VPT mini chart: ", e);
    }
}

// 12. Dynamic visual momentum summaries (Recommendation 1 & 4)
function renderFibonacciSummary(p) {
    const el = document.getElementById('fib-summary-text');
    if (!el) return;
    
    const curPrice = p.fundamentals.current_price;
    const fib = p.technicals ? p.technicals.fib_levels : null;
    
    if (!fib || curPrice === null || curPrice === undefined) {
        el.innerHTML = `<strong>Zone:</strong> N/A | <strong>Momentum Action:</strong> <span class="text-muted">N/A</span><br><span style="color:var(--text-secondary); margin-top:4px; display:block;">Fibonacci retracement level indicators are currently unavailable for this asset.</span>`;
        return;
    }
    
    let zone = "Neutral Pivot Zone";
    let action = "HOLD / WATCH";
    let momentumDesc = "Price is resting near the 50.0% retracement level. Stock momentum is consolidative. A break above 38.2% drives bullish velocity, whereas a drop below 61.8% golden support raises warning flags.";
    
    if (curPrice >= fib.fib_236) {
        zone = "Strong Bullish Breakout Zone";
        action = "BUY ON RECOVERY / HOLD";
        momentumDesc = `Trading at ${safeFormatRupees(curPrice, 2)} above the critical 23.6% retracement level (${safeFormatRupees(fib.fib_236, 2)}). Momentum is heavily driven by buyers, testing 52-week highs. Short-term corrections are highly likely to find immediate buying support here.`;
    } else if (curPrice >= fib.fib_382) {
        zone = "Bullish Consolidation Zone";
        action = "ACCUMULATE BUY";
        momentumDesc = `Positioned between 23.6% (${safeFormatRupees(fib.fib_236, 2)}) and 38.2% (${safeFormatRupees(fib.fib_382, 2)}). Stock is demonstrating robust aggregative momentum. Support is stable, suggesting constructive upward channel progressions.`;
    } else if (curPrice >= fib.fib_500) {
        zone = "Neutral Pivot Zone";
        action = "HOLD / ACCUMULATE";
        momentumDesc = `Trading near the 50.0% pivot retracement level of ${safeFormatRupees(fib.fib_500, 2)}. Price momentum is strictly neutral. Watch for consolidation patterns or an impending breakout above ${safeFormatRupees(fib.fib_382, 2)}.`;
    } else if (curPrice >= fib.fib_618) {
        zone = "Golden Retracement Support Zone";
        action = "HIGH-CONVICTION BUY LIMITS";
        momentumDesc = `Stock has corrected to the critical 61.8% Golden Retracement ratio of ${safeFormatRupees(fib.fib_618, 2)}. Statistically, this is the prime buy zone where major institutional rebounds occur. Stabilizing here is highly bullish; a breakdown below, however, triggers deeper bearish corrections.`;
    } else if (curPrice >= fib.fib_786) {
        zone = "Weak Support Correction Zone";
        action = "AVOID ENTRY / SELL ON BOUNCES";
        momentumDesc = `Price has breached the Golden support and is hovering near the 78.6% correction floor (${safeFormatRupees(fib.fib_786, 2)}). Bearish momentum dominates. Risk of structural breakdown to the 52-week low floor (100% retracement) remains high.`;
    } else {
        zone = "Deep Bearish Breakdown Zone";
        action = "STRICT AVOID / WATCH LOWS";
        momentumDesc = `Price is trading below the 78.6% floor, testing the 52-week low floor of ${safeFormatRupees(fib.fib_100, 2)}. Major supports have collapsed. Avoid active entries until clear accumulation indicators and double-bottom structures print.`;
    }
    
    el.innerHTML = `<strong>Zone:</strong> ${zone} | <strong>Momentum Action:</strong> <span class="green-text">${action}</span><br><span style="color:var(--text-secondary); margin-top:4px; display:block;">${momentumDesc}</span>`;
}

function renderVolatilitySummary(p) {
    const el = document.getElementById('vol-summary-text');
    if (!el) return;
    
    const curPrice = p.fundamentals.current_price;
    const bb_lower = p.technicals.bb_lower;
    const bb_upper = p.technicals.bb_upper;
    const rsi = p.technicals.rsi;
    const macd_hist = p.technicals.macd_hist;
    const vpt = p.technicals.vpt;
    const atr = p.technicals.atr;
    
    let condition = "Consolidative Range";
    let action = "HOLD";
    let momentumDesc = "Technical indicators are trading inside consolidative ranges. The stock remains in a standard range-bound channel.";
    let laymanDesc = "The stock is currently moving sideways, like a car cruising in the middle lane of a highway. Buyers and sellers are in balance, and there are no immediate signs of a major upward or downward move. It is a good time to hold and observe.";
    
    // Compute dynamic volatility-adjusted stop-loss (2x ATR below current price)
    const stopLossVal = atr !== null && atr !== undefined && curPrice ? (curPrice - 2 * atr) : null;
    const stopLossText = stopLossVal > 0 ? `₹${stopLossVal.toFixed(2)}` : 'N/A';
    
    // Compute Bollinger Squeeze
    const squeezePercent = bb_lower > 0 ? (((bb_upper - bb_lower) / bb_lower) * 100).toFixed(1) : 'N/A';
    
    if (macd_hist > 0 && curPrice <= bb_lower * 1.03) {
        condition = "Statistical Support Rebound";
        action = "STRONG BUY ENTRY";
        momentumDesc = `Stock is testing lower Bollinger Band support (Rs. ${bb_lower.toLocaleString('en-IN')}) while printing bullish MACD momentum crossover. Technical timing indicates an optimal low-risk accumulation window.`;
        laymanDesc = `The stock price has dropped to its typical 'cheap floor' level, and momentum has just started turning positive again. Think of it as a bouncy ball hitting the floor and starting to rebound. This is historically a very safe, low-risk time to buy.`;
    } else if (macd_hist < 0 && curPrice >= bb_upper * 0.97) {
        condition = "Overbought Band Exhaustion";
        action = "TAKE PROFIT / REDUCE RISK";
        momentumDesc = `Price is exhausting near upper Bollinger Band resistance (Rs. ${bb_upper.toLocaleString('en-IN')}) with negative MACD divergences. RSI is at ${rsi.toFixed(1)}, warning of near-term buying depletion. Reduce long positions.`;
        laymanDesc = `The stock has run up to its typical 'expensive ceiling' level and is running out of steam. Think of a runner gasping for breath at the top of a hill. It is highly likely the price will pull back shortly, so it is a wise time to lock in some profits or avoid buying more right now.`;
    } else if (macd_hist > 0 && vpt > 0) {
        condition = "Bullish Accumulation Continuation";
        action = "ACCUMULATE BUY";
        momentumDesc = `Bullish MACD momentum is backed by steady Volume Price Trend (VPT) expansion. Volume accumulation confirms strong institutional buying interest. Ride the upward trend.`;
        laymanDesc = `The stock is in a healthy upward trend, and this rise is backed by heavy trading volume. Large institutional players are actively acquiring shares. Think of a train that has built up strong forward speed with a full engine. It is safe to join the ride and buy.`;
    } else if (macd_hist < 0) {
        condition = "Bearish Momentum De-leveraging";
        action = "HOLD / DEFENSIVE REBALANCING";
        momentumDesc = `MACD is printing negative histogram bars, indicating near-term momentum cooling. Price is consolidative. Watch for support stabilization before adding new capital.`;
        laymanDesc = `The short-term momentum is currently cooling off, and the stock is taking a breather. Think of it as a car coasting after letting go of the gas pedal. The price is drifting sideways-to-down, so it is best to hold your shares defensively and wait for the price to find a solid floor before buying more.`;
    } else {
        condition = "Consolidative Squeeze";
        action = "HOLD";
        momentumDesc = `Bollinger Bands are squeezing (${squeezePercent}% width) with neutral RSI and MACD bars. A high-volatility breakout is building up. Watch the breakout directions.`;
        laymanDesc = `The stock price fluctuation has become extremely narrow, coiling up like a tightly compressed metal spring. This compression phase typically acts as a pre-breakout trigger. A sharp, high-speed price move is about to happen soon. It is best to wait and see which direction the spring pops before making big trades.`;
    }
    
    // Add ATR-based Volatility Insights
    let volInsight = "";
    if (atr > 0 && curPrice > 0) {
        const volatilityRatio = ((atr / curPrice) * 100).toFixed(1);
        let volLevel = "Low";
        if (volatilityRatio > 3.0) volLevel = "High";
        else if (volatilityRatio > 1.5) volLevel = "Moderate";
        
        volInsight = `<div style="margin-top: 8px; font-size:10.5px; padding: 6px 10px; background: rgba(255,255,255,0.03); border-radius: 4px; border: 1px solid rgba(255,255,255,0.05); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
            <span>🛡️ <strong>Volatility-Adjusted Stop Floor (2x ATR)</strong>: <strong style="color:var(--color-crimson); font-weight:700;">${stopLossText}</strong></span>
            <span>📊 <strong>Vol Rating</strong>: <strong style="color:var(--color-primary); font-weight:700;">${volLevel} (${volatilityRatio}%)</strong></span>
        </div>`;
    }
    
    el.innerHTML = `
        <div style="margin-bottom: 8px;">
            <strong>Indicator State:</strong> ${condition} | <strong>Recommendation:</strong> <span class="green-text" style="font-weight:700;">${action}</span>
        </div>
        <div style="font-size:11px; color:var(--text-secondary); margin-bottom: 8px; line-height: 1.45;">
            <strong>Analyst Verdict:</strong> ${momentumDesc}
        </div>
        <div style="font-size:11px; color:var(--text-muted); line-height: 1.45; border-left: 2.5px solid var(--color-primary); padding-left: 8px; margin-top: 6px; background: rgba(59, 130, 246, 0.03); padding-top: 5px; padding-bottom: 5px; border-radius: 0 4px 4px 0; width: 100%;">
            💡 <strong>Layman Translation:</strong> ${laymanDesc}
        </div>
        ${volInsight}
    `;
}

// 13. AI Watchlist Controller & State Handler
async function setupWatchlistControls() {
    // Select elements
    const createBtn = document.getElementById('create-watchlist-btn');
    const deleteBtn = document.getElementById('delete-watchlist-btn');
    const addBtn = document.getElementById('add-to-watchlist-btn');
    const analyzeBtn = document.getElementById('analyze-watchlist-btn');
    
    if (createBtn) {
        createBtn.addEventListener('click', createNewWatchlist);
    }
    if (deleteBtn) {
        deleteBtn.addEventListener('click', deleteActiveWatchlist);
    }
    if (addBtn) {
        addBtn.addEventListener('click', addCurrentStockToWatchlist);
    }
    if (analyzeBtn) {
        analyzeBtn.addEventListener('click', runWatchlistBatchAnalysis);
    }
    const inlineAddBtn = document.getElementById('watchlist-inline-add-btn');
    const inlineAddInput = document.getElementById('watchlist-inline-add-input');
    
    if (inlineAddBtn) {
        inlineAddBtn.addEventListener('click', addInlineStockToWatchlist);
    }
    if (inlineAddInput) {
        inlineAddInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                addInlineStockToWatchlist();
            }
        });

        // Autocomplete online suggestions for Personal Watchlists inline stock adder
        const watchlistInlineSuggestionsDiv = document.getElementById('watchlist-inline-suggestions');
        if (watchlistInlineSuggestionsDiv) {
            watchlistInlineSuggestionsDiv.className = 'watchlist-autocomplete-box';
            watchlistInlineSuggestionsDiv.removeAttribute('style'); // Remove inline styles to allow CSS to take over
            
            inlineAddInput.addEventListener('input', async () => {
                const query = inlineAddInput.value.trim();
                if (query.length < 2) {
                    watchlistInlineSuggestionsDiv.style.display = 'none';
                    return;
                }
                
                try {
                    const res = await fetch(`/api/search/suggestions?q=${encodeURIComponent(query)}`);
                    if (res.ok) {
                        const data = await res.json();
                        if (data.length > 0) {
                            watchlistInlineSuggestionsDiv.innerHTML = '';
                            data.forEach(item => {
                                const div = document.createElement('div');
                                div.className = 'watchlist-autocomplete-item';
                                div.innerHTML = `<div><span class="ticker-pill">${item.base_symbol}</span><span style="color:var(--text-secondary); margin-left: 6px; font-size:11px;">- ${item.name}</span></div><span class="sector-pill">${item.sector}</span>`;
                                
                                div.addEventListener('click', () => {
                                    inlineAddInput.value = item.base_symbol;
                                    watchlistInlineSuggestionsDiv.style.display = 'none';
                                });
                                watchlistInlineSuggestionsDiv.appendChild(div);
                            });
                            watchlistInlineSuggestionsDiv.style.display = 'block';
                        } else {
                            watchlistInlineSuggestionsDiv.style.display = 'none';
                        }
                    }
                } catch (err) {
                    console.error("Watchlist inline suggestions error:", err);
                }
            });
            
            document.addEventListener('click', (e) => {
                if (e.target !== inlineAddInput && e.target !== watchlistInlineSuggestionsDiv) {
                    watchlistInlineSuggestionsDiv.style.display = 'none';
                }
            });
        }
    }
    
    // Initial data fetch
    await fetchWatchlists();
}

async function addInlineStockToWatchlist() {
    if (activeWatchlistId === null) return;
    const input = document.getElementById('watchlist-inline-add-input');
    const btn = document.getElementById('watchlist-inline-add-btn');
    if (!input) return;
    
    const symbolQuery = input.value.trim();
    if (!symbolQuery) {
        showToast("Please enter a stock symbol or name.", "warning");
        return;
    }
    
    if (btn) btn.disabled = true;
    input.disabled = true;
    
    try {
        const originalText = btn ? btn.innerText : '+ Add Stock';
        if (btn) btn.innerText = 'Adding...';
        
        // 1. Resolve ticker query first via API
        const searchRes = await fetch(`/api/search?q=${encodeURIComponent(symbolQuery)}`);
        if (!searchRes.ok) {
            throw new Error('Search resolution failed.');
        }
        const resolved = await searchRes.json();
        const baseSymbol = resolved.base_symbol;
        const fullTicker = resolved.yf_ticker || `${baseSymbol}.NS`;
        
        // 2. Add to active watchlist database via POST API
        const response = await fetch(`/api/watchlists/${activeWatchlistId}/items`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ symbol: fullTicker })
        });
        
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.detail || "Failed to add stock to watchlist.");
        }
        
        const addedItem = await response.json();
        showToast(`Successfully added ${addedItem.name} (${addedItem.symbol}) to the watchlist.`, "success");
        
        input.value = '';
        await fetchWatchlists();
    } catch (e) {
        console.error("Error adding inline stock to watchlist:", e);
        showToast("Error: " + e.message, "error");
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerText = '+ Add Stock';
        }
        input.disabled = false;
        input.focus();
    }
}

async function fetchWatchlists() {
    try {
        const response = await fetch('/api/watchlists');
        if (!response.ok) throw new Error("Failed to load watchlists.");
        
        watchlistsList = await response.json();
        
        // Auto-select the first watchlist if none is selected and lists exist
        if (activeWatchlistId === null && watchlistsList.length > 0) {
            activeWatchlistId = watchlistsList[0].id;
        }
        
        renderWatchlistControls();
        renderWatchlistItems();
    } catch (e) {
        console.error("Watchlist fetch error:", e);
    }
}

function renderWatchlistControls() {
    // 1. Populate Stock workspace drop-down select
    const headerSelect = document.getElementById('watchlist-select');
    if (headerSelect) {
        headerSelect.innerHTML = '<option value="" disabled selected>Select Watchlist</option>';
        watchlistsList.forEach(w => {
            headerSelect.innerHTML += `<option value="${w.id}">${w.name}</option>`;
        });
    }
    
    // 2. Populate Watchlist Sidebar buttons
    const container = document.getElementById('watchlist-buttons-container');
    if (container) {
        container.innerHTML = '';
        if (watchlistsList.length === 0) {
            container.innerHTML = '<div style="font-size:11px; color:var(--text-muted); text-align:center; padding:10px;">No watchlists. Create one above.</div>';
            return;
        }
        
        watchlistsList.forEach(w => {
            const btn = document.createElement('button');
            btn.className = `btn-secondary w-full text-left watchlist-sidebar-btn ${w.id === activeWatchlistId ? 'active' : ''}`;
            btn.style.fontSize = '12px';
            btn.style.padding = '8px 12px';
            btn.style.borderRadius = '6px';
            btn.style.cursor = 'pointer';
            btn.style.display = 'block';
            btn.style.width = '100%';
            btn.style.marginBottom = '6px';
            
            btn.innerHTML = `⭐ <strong>${w.name}</strong> <span style="font-size:10px; color:var(--text-muted); float:right;">(${w.items.length})</span>`;
            
            btn.addEventListener('click', () => {
                activeWatchlistId = w.id;
                renderWatchlistControls();
                renderWatchlistItems();
            });
            
            container.appendChild(btn);
        });
    }
}

async function createNewWatchlist() {
    const input = document.getElementById('watchlist-name-input');
    const name = input?.value?.trim();
    if (!name) {
        showToast("Please enter a valid watchlist name.", "warning");
        return;
    }
    
    try {
        const response = await fetch('/api/watchlists', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: name })
        });
        
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.detail || "Failed to create watchlist.");
        }
        
        const newWatch = await response.json();
        activeWatchlistId = newWatch.id;
        
        if (input) input.value = '';
        await fetchWatchlists();
    } catch (e) {
        showToast("Error: " + e.message, "error");
    }
}

async function deleteActiveWatchlist() {
    if (activeWatchlistId === null) return;
    const activeWatch = watchlistsList.find(w => w.id === activeWatchlistId);
    if (!activeWatch) return;
    
    if (!confirm(`Are you sure you want to delete the watchlist "${activeWatch.name}"?`)) {
        return;
    }
    if (!confirm(`CONFIRM DELETION: Please confirm once more. This will permanently delete the watchlist "${activeWatch.name}" and all its holdings.`)) {
        return;
    }
    
    try {
        const response = await fetch(`/api/watchlists/${activeWatchlistId}`, {
            method: 'DELETE'
        });
        
        if (!response.ok) throw new Error("Failed to delete watchlist.");
        
        activeWatchlistId = null;
        await fetchWatchlists();
    } catch (e) {
        showToast("Error: " + e.message, "error");
    }
}

async function addCurrentStockToWatchlist() {
    if (!activeStockProfile) {
        showToast("Please search and load a stock inside the Single Stock Workspace first.", "warning");
        return;
    }
    
    const select = document.getElementById('watchlist-select');
    const watchlistId = select?.value;
    if (!watchlistId) {
        showToast("Please select a watchlist from the dropdown list first.", "warning");
        return;
    }
    
    try {
        const response = await fetch(`/api/watchlists/${watchlistId}/items`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ symbol: activeStockProfile.ticker })
        });
        
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.detail || "Failed to add stock to watchlist.");
        }
        
        showToast(`Successfully added ${activeStockProfile.ticker} to the selected watchlist.`, "success");
        await fetchWatchlists();
    } catch (e) {
        showToast("Error: " + e.message, "error");
    }
}

async function removeStockFromWatchlist(watchlistId, symbol) {
    if (!confirm(`Remove ${symbol} from this watchlist?`)) {
        return;
    }
    if (!confirm(`CONFIRM REMOVAL: Are you absolutely sure you want to remove ${symbol} from the watchlist?`)) {
        return;
    }
    
    try {
        const response = await fetch(`/api/watchlists/${watchlistId}/items/${symbol}`, {
            method: 'DELETE'
        });
        
        if (!response.ok) throw new Error("Failed to remove item.");
        
        await fetchWatchlists();
    } catch (e) {
        showToast("Error: " + e.message, "error");
    }
}

function renderWatchlistItems() {
    const titleEl = document.getElementById('active-watchlist-title');
    const deleteBtn = document.getElementById('delete-watchlist-btn');
    const analyzeWatchlistBtn = document.getElementById('analyze-watchlist-btn');
    const tbody = document.getElementById('watchlist-table-body');
    
    if (!tbody) return;
    tbody.innerHTML = '';
    
    const resultsContainer = document.getElementById('watchlist-analysis-results');
    if (resultsContainer) resultsContainer.style.display = 'none';
    const summaryBox = document.getElementById('watchlist-summary-box');
    if (summaryBox) summaryBox.style.display = 'none';
    activeWatchlistBatchData = null;
    
    const inlineAddContainer = document.getElementById('watchlist-inline-add-container');
    
    if (activeWatchlistId === null || watchlistsList.length === 0) {
        if (titleEl) titleEl.innerText = "SELECT A WATCHLIST";
        if (deleteBtn) deleteBtn.style.display = 'none';
        if (analyzeWatchlistBtn) analyzeWatchlistBtn.style.display = 'none';
        if (inlineAddContainer) inlineAddContainer.style.display = 'none';
        document.getElementById('watchlist-analysis-results').style.display = 'none';
        tbody.innerHTML = '<tr><td colspan="4" class="center-text text-muted">Select or create a watchlist on the left to display its constituents.</td></tr>';
        return;
    }
    
    const activeWatch = watchlistsList.find(w => w.id === activeWatchlistId);
    if (!activeWatch) {
        if (titleEl) titleEl.innerText = "SELECT A WATCHLIST";
        if (deleteBtn) deleteBtn.style.display = 'none';
        if (analyzeWatchlistBtn) analyzeWatchlistBtn.style.display = 'none';
        if (inlineAddContainer) inlineAddContainer.style.display = 'none';
        tbody.innerHTML = '<tr><td colspan="4" class="center-text text-muted">Watchlist data is loading...</td></tr>';
        return;
    }
    
    if (inlineAddContainer) inlineAddContainer.style.display = 'flex';
    
    if (titleEl) titleEl.innerText = `Watchlist: ${activeWatch.name}`;
    if (deleteBtn) deleteBtn.style.display = 'inline-block';
    
    if (activeWatch.items.length === 0) {
        tbody.innerHTML = '<tr><td colspan="4" class="center-text text-muted">This watchlist is empty. Load a stock inside the Analyzer and add it.</td></tr>';
        if (analyzeWatchlistBtn) analyzeWatchlistBtn.style.display = 'none';
        document.getElementById('watchlist-analysis-results').style.display = 'none';
        return;
    }
    
    if (analyzeWatchlistBtn) analyzeWatchlistBtn.style.display = 'inline-block';
    
    activeWatch.items.forEach(item => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${item.symbol}</strong></td>
            <td><strong>${item.name}</strong></td>
            <td><span class="text-muted" style="font-size:11px;">${item.sector}</span></td>
            <td>
                <button class="btn-secondary load-watchlist-workspace-btn" data-ticker="${item.symbol}" style="font-size: 11px; padding: 4px 10px; margin-right: 8px; cursor:pointer;">Load Workspace 📊</button>
                <button class="btn-secondary remove-watchlist-item-btn" data-ticker="${item.symbol}" style="font-size: 11px; padding: 4px 10px; cursor:pointer;">Remove 🗑️</button>
            </td>
        `;
        
        // Add click events
        tr.querySelector('.load-watchlist-workspace-btn').addEventListener('click', () => {
            loadStockAnalyzer(item.symbol);
        });
        
        tr.querySelector('.remove-watchlist-item-btn').addEventListener('click', () => {
            removeStockFromWatchlist(activeWatchlistId, item.symbol);
        });
        
        tbody.appendChild(tr);
    });
    
}

// Collapsible Business Summary Setup
function setupBusinessSummaryCollapsible() {
    const bsToggle = document.getElementById('business-summary-toggle');
    const bsContent = document.getElementById('business-summary-content');
    const bsArrow = document.getElementById('business-summary-arrow');
    if (bsToggle && bsContent && bsArrow) {
        bsToggle.addEventListener('click', () => {
            const isCollapsed = bsContent.style.maxHeight === '0px' || bsContent.style.maxHeight === '';
            if (isCollapsed) {
                bsContent.style.maxHeight = '500px';
                bsArrow.style.transform = 'rotate(180deg)';
            } else {
                bsContent.style.maxHeight = '0px';
                bsArrow.style.transform = 'rotate(0deg)';
            }
        });
    }
}

/* ==================== FRONTEND UX & MODULE ENHANCEMENTS (PHASE 2 & 3) ==================== */

// Toast Notifications System
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let icon = 'ℹ️';
    if (type === 'success') icon = '✅';
    if (type === 'error') icon = '❌';
    if (type === 'warning') icon = '⚠️';
    
    toast.innerHTML = `
        <div style="display:flex; align-items:center; gap:10px;">
            <span>${icon}</span>
            <span>${message}</span>
        </div>
        <button class="toast-close">&times;</button>
    `;
    
    toast.querySelector('.toast-close').addEventListener('click', () => {
        toast.style.animation = 'fadeOut 0.3s ease forwards';
        setTimeout(() => toast.remove(), 300);
    });
    
    container.appendChild(toast);
    
    // Auto-dismiss after 5s
    setTimeout(() => {
        if (toast.parentElement) {
            toast.style.animation = 'fadeOut 0.3s ease forwards';
            setTimeout(() => toast.remove(), 300);
        }
    }, 5000);
}

// Universal Printing Engine (Desktop & Mobile compatibility)
function executeSystemPrint(printContent, customFeatures = 'width=850,height=900') {
    const isMobile = window.innerWidth <= 768 || /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
    
    if (!isMobile) {
        // Desktop Workflow: Spawn a custom pop-up window
        const printWindow = window.open('', '_blank', customFeatures);
        if (!printWindow) {
            showToast("Popup blocked! Please allow popups for this site to print.", "error");
            return;
        }
        printWindow.document.write(printContent);
        printWindow.document.close();
    } else {
        // Mobile Workflow: Direct parent window print-swap to ensure Chrome/Brave spooler execution
        showToast("Generating mobile print report...", "success");
        
        let mobileContent = printContent;
        // Strip out autostart print scripts to prevent the parent tab from attempting window.close()
        mobileContent = mobileContent.replace(/<script>[\s\S]*?<\/script>/gi, '');
        
        // 1. Dynamic Title/Filename extraction from HTML title tag
        const titleMatch = printContent.match(/<title>(.*?)<\/title>/i);
        const reportTitle = titleMatch ? titleMatch[1] : "Apex_Agentic_Report";
        // Sanitize brackets and dashes to prevent Firefox/Chrome Android spooler fallback to "firefox"
        const sanitizedTitle = reportTitle.replace(/[()\[\]\-]/g, ' ').trim().replace(/\s+/g, ' ');
        const originalTitle = document.title;
        document.title = sanitizedTitle;
        
        // 2. Clear any existing mobile print container
        const oldWrapper = document.getElementById('mobile-print-wrapper');
        if (oldWrapper) oldWrapper.remove();
        
        // 3. Create full-screen swap overlay container
        const wrapper = document.createElement('div');
        wrapper.id = 'mobile-print-wrapper';
        wrapper.innerHTML = mobileContent;
        document.body.appendChild(wrapper);
        
        // 4. Set printing active state triggers
        document.body.classList.add('is-printing-mobile');
        
        // 5. Fire native print dialog directly on main window (universally supported)
        // Set a 800ms delay to allow the mobile OS to fully synchronize the document title
        setTimeout(() => {
            window.print();
        }, 800);
        
        // 6. Graceful cleanup and workspace restoration loops
        const cleanup = () => {
            // Check if still in printing mode before restoring
            if (document.body.classList.contains('is-printing-mobile')) {
                document.body.classList.remove('is-printing-mobile');
                document.title = originalTitle;
                const el = document.getElementById('mobile-print-wrapper');
                if (el) el.remove();
            }
        };
        
        // Delay cleanup on afterprint to allow mobile print spoolers to complete capturing the page
        window.addEventListener('afterprint', () => {
            setTimeout(cleanup, 3000);
        }, { once: true });
        
        // Fail-safe cleanup backup (increased to 25s for slow mobile printers)
        setTimeout(cleanup, 25000);
    }
}

// Dark/Light Theme Handler
function setupThemeToggle() {
    const savedTheme = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);
    
    const desktopBtn = document.getElementById('theme-toggle-btn');
    const mobileBtn = document.getElementById('mobile-theme-toggle');
    
    const toggle = () => {
        const currentTheme = document.documentElement.getAttribute('data-theme');
        const newTheme = currentTheme === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', newTheme);
        localStorage.setItem('theme', newTheme);
        showToast(`Switched to ${newTheme} theme`, 'success');
        if (typeof updateBacktestChartThemeColors === 'function') {
            updateBacktestChartThemeColors();
        }
        if (typeof updateRiskChartThemeColors === 'function') {
            updateRiskChartThemeColors();
        }
    };
    
    if (desktopBtn) desktopBtn.addEventListener('click', toggle);
    if (mobileBtn) mobileBtn.addEventListener('click', toggle);
}

// Mobile Responsive Toggler
function setupMobileMenu() {
    const toggleBtn = document.getElementById('mobile-menu-toggle');
    const sidebar = document.getElementById('sidebar');
    const closeBtnMobile = document.getElementById('sidebar-close-btn-mobile');
    
    if (toggleBtn && sidebar) {
        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            sidebar.classList.toggle('open');
        });
        
        if (closeBtnMobile) {
            closeBtnMobile.addEventListener('click', () => {
                sidebar.classList.remove('open');
            });
        }
        
        document.addEventListener('click', (e) => {
            if (sidebar.classList.contains('open') && !sidebar.contains(e.target) && e.target !== toggleBtn && e.target !== closeBtnMobile) {
                sidebar.classList.remove('open');
            }
        });
        
        const navBtns = document.querySelectorAll('.nav-btn');
        navBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                sidebar.classList.remove('open');
            });
        });
    }
}

// Interactive DCF 5x5 Sensitivity Matrix
function renderDCFSensitivityMatrix(p) {
    const headersRow = document.getElementById('dcf-sens-headers');
    const bodyContainer = document.getElementById('dcf-sens-body');
    if (!headersRow || !bodyContainer) return;
    
    headersRow.innerHTML = '<th style="background: rgba(255,255,255,0.02); font-weight: 700;">WACC \\ Growth</th>';
    bodyContainer.innerHTML = '';
    
    const currentWacc = p.dcf_model.wacc !== null && p.dcf_model.wacc !== undefined ? p.dcf_model.wacc : 10.0; // WACC rate (e.g. 10.5)
    const baseGrowth = p.fundamentals.sales_growth_3y_pct || 12.0;
    const currentPrice = p.fundamentals.current_price || 100.0;
    
    let baselineFcf = 10000000;
    if (p.dcf_model.cash_flow_projections && p.dcf_model.cash_flow_projections.length > 0) {
        baselineFcf = p.dcf_model.cash_flow_projections[0].fcf / (1 + baseGrowth/100);
    }
    
    const mockMcap = p.fundamentals.market_cap_cr * 1e7 || 1e10;
    const mockOutstandingShares = mockMcap / currentPrice;
    
    // WACC row factors (dynamic offsets)
    const waccRates = [currentWacc - 2.0, currentWacc - 1.0, currentWacc, currentWacc + 1.0, currentWacc + 2.0];
    // Revenue Growth column factors (dynamic offsets)
    const growthRates = [baseGrowth - 4.0, baseGrowth - 2.0, baseGrowth, baseGrowth + 2.0, baseGrowth + 4.0];
    
    // Render column headers
    growthRates.forEach(g => {
        headersRow.innerHTML += `<th style="background: rgba(255,255,255,0.02); font-weight: 700;">${g.toFixed(1)}%</th>`;
    });
    
    // Compute intrinsic values and build rows
    waccRates.forEach(wVal => {
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid rgba(255,255,255,0.03)';
        tr.innerHTML = `<td style="font-weight: 700; color: var(--text-secondary); background: rgba(0,0,0,0.1);">WACC ${wVal.toFixed(1)}%</td>`;
        
        const wDecimal = wVal / 100;
        
        growthRates.forEach(gVal => {
            const gDecimal = gVal / 100;
            const termDecimal = 0.045; // Terminal inflation 4.5%
            
            // FCF growth projection sweep
            let sumPv = 0;
            let currFcf = baselineFcf;
            const fadeStep = (gDecimal - termDecimal) / 5.0;
            
            for (let yr = 1; yr <= 10; yr++) {
                let gStep = yr <= 5 ? gDecimal : Math.max(gDecimal - (yr - 5) * fadeStep, termDecimal);
                currFcf = currFcf * (1 + gStep);
                let pv = currFcf / ((1 + wDecimal) ** yr);
                sumPv += pv;
            }
            
            const termFcf = currFcf * (1 + termDecimal);
            const termVal = termFcf / (wDecimal - termDecimal);
            const pvTermVal = termVal / ((1 + wDecimal) ** 10);
            
            const ev = sumPv + pvTermVal;
            let intrinsic = ev / mockOutstandingShares;
            intrinsic = Math.max(Math.min(intrinsic, currentPrice * 3), currentPrice * 0.3);
            
            const margin = ((intrinsic - currentPrice) / intrinsic) * 100.0;
            
            // Establish Bloomberg-Style soft heatmaps
            let cellStyle = "padding: 8px 10px; font-weight: 500; transition: all 0.25s ease;";
            if (margin >= 10.0) {
                cellStyle += "background: rgba(16, 185, 129, 0.15) !important; color: var(--color-emerald) !important; border: 1px solid rgba(16, 185, 129, 0.2) !important; font-weight: 700;";
            } else if (margin <= -10.0) {
                cellStyle += "background: rgba(239, 68, 68, 0.15) !important; color: var(--color-crimson) !important; border: 1px solid rgba(239, 68, 68, 0.2) !important; font-weight: 700;";
            } else {
                cellStyle += "background: rgba(245, 158, 11, 0.1) !important; color: var(--color-amber) !important; border: 1px solid rgba(245, 158, 11, 0.15) !important;";
            }
            
            tr.innerHTML += `<td style="${cellStyle}" title="Estimated Intrinsic: Rs. ${intrinsic.toFixed(2)} | Margin of safety: ${margin.toFixed(1)}%">Rs. ${intrinsic.toFixed(0)}</td>`;
        });
        
        bodyContainer.appendChild(tr);
    });
    
    // Pulse highlight closest coordinate matches on startup
    highlightActiveMatrixCoordinate();
}

// Street Consensus Comparator Renderer
function renderStreetConsensusComparator(p) {
    const fairEl = document.getElementById('comp-ai-fair');
    const buyEl = document.getElementById('comp-ai-buy');
    const stopEl = document.getElementById('comp-ai-stop');
    const medianEl = document.getElementById('comp-street-median');
    const highEl = document.getElementById('comp-street-high');
    const lowEl = document.getElementById('comp-street-low');
    const infoEl = document.getElementById('comp-analyst-opinion');
    
    if (!fairEl) return;
    
    fairEl.innerText = safeFormatRupees(p.dcf_model.intrinsic_value, 2);
    buyEl.innerText = p.analysis.suggested_buy_price_range ? p.analysis.suggested_buy_price_range.split("Rs. ")[1] || p.analysis.suggested_buy_price_range : "Rs. --";
    const basePrice = p.fundamentals.current_price || 1.0;
    const stopVal = p.analysis.stop_loss_12m || (basePrice !== null && basePrice !== undefined ? basePrice * 0.88 : null);
    stopEl.innerText = safeFormatRupees(stopVal, 2);
    
    const cons = p.consensus || {};
    medianEl.innerText = safeFormatRupees(cons.target_median, 0);
    highEl.innerText = safeFormatRupees(cons.target_high, 0);
    lowEl.innerText = safeFormatRupees(cons.target_low, 0);
    
    let recClass = "green-text";
    let recBorderColor = "var(--color-emerald)";
    let recBgColor = "rgba(16, 185, 129, 0.04)";
    if (cons.recommendation) {
        const recLower = cons.recommendation.toLowerCase();
        if (recLower.includes("sell") || recLower.includes("underperform")) {
            recClass = "red-text";
            recBorderColor = "var(--color-crimson)";
            recBgColor = "rgba(239, 68, 68, 0.04)";
        } else if (recLower.includes("hold") || recLower.includes("neutral") || recLower.includes("none")) {
            recClass = "yellow-text";
            recBorderColor = "var(--color-amber)";
            recBgColor = "rgba(245, 158, 11, 0.04)";
        }
    }
    
    // Style consensus-analyst-opinion-block border and background dynamically
    const opinionBlock = document.getElementById('consensus-analyst-opinion-block');
    if (opinionBlock) {
        opinionBlock.style.borderLeft = `2.5px solid ${recBorderColor}`;
        opinionBlock.style.background = recBgColor;
    }
    
    let opinionNarrative = `Based on institutional consensus of **${cons.analyst_count || 14}** analysts, the street recommendation is a solid <strong class="${recClass}">${cons.recommendation || 'BUY'}</strong>. `;
    const streetTarget = cons.target_median;
    const aiTarget = p.dcf_model.intrinsic_value;
    if (streetTarget && aiTarget) {
        const streetDiff = ((streetTarget - basePrice) / basePrice) * 100.0;
        const aiDiff = ((aiTarget - basePrice) / basePrice) * 100.0;
        opinionNarrative += `Brokers project a **${streetDiff.toFixed(1)}%** upside to their median target of **${safeFormatRupees(streetTarget, 0)}**, while our proprietary quantitative valuation highlights a **${aiDiff.toFixed(1)}%** potential return to fair value (**${safeFormatRupees(aiTarget, 0)}**).`;
    } else {
        opinionNarrative += `The broker consensus target estimates represent standard institutional tracking ranges, aligned with active macroeconomic variables.`;
    }
    
    infoEl.innerHTML = opinionNarrative;
}

// CSV Export Button Controller Bindings
// CSV Export Button Controller Bindings
function setupCSVExports() {
    const saveWatchlistBtn = document.getElementById('save-screener-watchlist-btn');
    const screenerBtn = document.getElementById('export-screener-csv-btn');
    const copyBtn = document.getElementById('copy-screener-btn');
    const printBtn = document.getElementById('print-screener-btn');
    const compareBtn = document.getElementById('export-compare-csv-btn');
    
    if (saveWatchlistBtn) {
        saveWatchlistBtn.addEventListener('click', async () => {
            if (!activeScreenerResults || activeScreenerResults.length === 0) {
                showToast("No screener results to save.", "warning");
                return;
            }
            
            const now = new Date();
            const datePart = now.toLocaleDateString('en-IN', {
                day: '2-digit',
                month: 'short',
                year: 'numeric'
            });
            const timePart = now.toLocaleTimeString('en-IN', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: true
            });
            
            const strategyMap = {
                'hybrid': 'Hybrid',
                'bottom_up': 'Bottom Up',
                'top_down': 'Top Down'
            };
            const strategyText = strategyMap[activeScreenerStrategy] || activeScreenerStrategy;
            
            const styleMap = {
                'all': '',
                'value': 'Value',
                'growth': 'Growth',
                'contra': 'Contra'
            };
            const styleText = styleMap[activeScreenerStyle] || '';
            const styleStr = styleText ? ` ${styleText}` : '';
            
            const universeSelect = document.getElementById('screener-universe-select');
            const universeVal = universeSelect ? universeSelect.value : 'all';
            const universeMap = {
                'all': 'All Segments',
                'large': 'Large Cap',
                'mid': 'Mid Cap',
                'small': 'Small Cap'
            };
            const universeText = universeMap[universeVal] || universeVal;
            
            const defaultName = `Screener ${strategyText}${styleStr} ${universeText} - ${datePart}, ${timePart}`;
            const watchlistName = prompt("Enter a name for the new watchlist:", defaultName);
            
            if (watchlistName === null) {
                return;
            }
            
            const trimmedName = watchlistName.trim();
            if (!trimmedName) {
                showToast("Watchlist name cannot be empty.", "warning");
                return;
            }
            
            showLoader("Creating Watchlist...", `Creating "${trimmedName}" and adding ${activeScreenerResults.length} stocks...`);
            
            try {
                // 1. Create watchlist
                const createRes = await fetch('/api/watchlists', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ name: trimmedName })
                });
                
                if (!createRes.ok) {
                    const err = await createRes.json();
                    throw new Error(err.detail || "Failed to create watchlist.");
                }
                
                const newWatch = await createRes.json();
                const watchlistId = newWatch.id;
                
                // 2. Add each symbol in parallel
                let addedCount = 0;
                let failedCount = 0;
                
                const promises = activeScreenerResults.map(async (item) => {
                    try {
                        const addRes = await fetch(`/api/watchlists/${watchlistId}/items`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ symbol: item.symbol })
                        });
                        if (addRes.ok) {
                            addedCount++;
                        } else {
                            failedCount++;
                        }
                    } catch (err) {
                        failedCount++;
                    }
                });
                
                await Promise.all(promises);
                
                // 3. Update active watchlist and fetch updated list
                activeWatchlistId = watchlistId;
                await fetchWatchlists();
                
                if (failedCount > 0) {
                    showToast(`Created watchlist "${trimmedName}". Added ${addedCount} stocks (${failedCount} failed/duplicates).`, "warning");
                } else {
                    showToast(`Successfully created watchlist "${trimmedName}" with ${addedCount} stocks!`, "success");
                }
            } catch (e) {
                console.error("Error saving screener watchlist:", e);
                showToast("Error: " + e.message, "error");
            } finally {
                hideLoader();
            }
        });
    }
    
    if (screenerBtn) {
        screenerBtn.addEventListener('click', () => {
            exportTableToCSV('screener-results-body', 'ai_screener_results.csv');
        });
    }
    
    if (copyBtn) {
        copyBtn.addEventListener('click', () => {
            if (!activeScreenerResults || activeScreenerResults.length === 0) {
                showToast("No screener results to copy.", "warning");
                return;
            }
            let text = "Rank\tSymbol\tCompany Name\tSector\tSegment\tAI Score\tAction\n";
            activeScreenerResults.forEach((item, idx) => {
                text += `${idx + 1}\t${item.symbol}\t${item.company_name || item.symbol}\t${item.sector}\t${(item.cap_type || 'all').toUpperCase()}\t${item.score}/100\t${item.action}\n`;
            });
            navigator.clipboard.writeText(text).then(() => {
                showToast("Successfully copied screener results to clipboard!", "success");
            }).catch(err => {
                showToast("Failed to copy table: " + err, "error");
            });
        });
    }
    
    if (printBtn) {
        printBtn.addEventListener('click', () => {
            if (!activeScreenerResults || activeScreenerResults.length === 0) {
                showToast("No screener results to print.", "warning");
                return;
            }

            const universeSelect = document.getElementById('screener-universe-select');
            const universeLabel = universeSelect ? universeSelect.options[universeSelect.selectedIndex].text : 'Selected Segment';
            const styleSelect = document.getElementById('screener-style-select');
            const styleLabel = styleSelect ? styleSelect.options[styleSelect.selectedIndex].text : 'All Styles (No Overlay)';
            const horizon = document.getElementById('profile-horizon')?.value || 'Long-term (3+ years)';
            const risk = document.getElementById('profile-risk')?.value || 'Moderate';
            
            let html = `
            <html>
            <head>
                <title>AI Stock Screener Report - ${activeScreenerStrategy.toUpperCase()}</title>
                <style>
                    body { font-family: 'Inter', system-ui, -apple-system, sans-serif; padding: 40px; color: #1e293b; background: #ffffff; line-height: 1.5; }
                    .header { border-bottom: 2px solid #e2e8f0; padding-bottom: 20px; margin-bottom: 30px; }
                    .header h1 { font-size: 24px; font-weight: 800; color: #0f172a; margin: 0 0 5px 0; letter-spacing: -0.02em; }
                    .header p { font-size: 13px; color: #64748b; margin: 0; }
                    .meta { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin-bottom: 25px; font-size: 12px; background: #f8fafc; padding: 15px; border-radius: 6px; border: 1px solid #e2e8f0; }
                    .meta-item strong { color: #0f172a; display: block; margin-bottom: 3px; }
                    table { width: 100%; border-collapse: collapse; margin-top: 20px; font-size: 12px; text-align: left; }
                    th { background: #f1f5f9; padding: 10px 12px; font-weight: 700; color: #334155; border-bottom: 2px solid #cbd5e1; }
                    td { padding: 10px 12px; border-bottom: 1px solid #e2e8f0; color: #334155; }
                    tr:nth-child(even) { background: #f8fafc; }
                    .badge { font-weight: 700; font-size: 10px; padding: 2px 6px; border-radius: 4px; display: inline-block; text-transform: uppercase; }
                    .buy { background: #dcfce7; color: #15803d; }
                    .hold { background: #fef9c3; color: #854d0e; }
                    .sell { background: #fee2e2; color: #b91c1c; }
                    .score { font-weight: 700; color: #0f172a; }
                    .footer { margin-top: 50px; font-size: 11px; color: #94a3b8; text-align: center; border-top: 1px solid #e2e8f0; padding-top: 15px; }
                </style>
            </head>
            <body>
                <div class="header">
                    <h1>AI STOCK SCREENER PROSPECTUS REPORT</h1>
                    <p>Automated Quantitative Research & Multi-Agent Investment Advisory Sweep</p>
                </div>
                <div class="meta">
                    <div class="meta-item"><strong>Screening Strategy</strong>${activeScreenerStrategy.replace('_', ' ').toUpperCase()} Pipeline</div>
                    <div class="meta-item"><strong>Universe Segment</strong>${universeLabel}</div>
                    <div class="meta-item"><strong>Investment Style</strong>${styleLabel}</div>
                    <div class="meta-item"><strong>Investor Profile</strong>Horizon: ${horizon} | Risk: ${risk}</div>
                </div>
                <table>
                    <thead>
                        <tr>
                            <th>Rank</th>
                            <th>Stock Symbol</th>
                            <th>Company Name</th>
                            <th>Sector</th>
                            <th>Segment</th>
                            <th>AI Score</th>
                            <th>Advisory Action</th>
                        </tr>
                    </thead>
                    <tbody>
            `;
            
            activeScreenerResults.forEach((item, idx) => {
                const actionClass = item.action.includes("BUY") ? "buy" : (item.action.includes("HOLD") ? "hold" : "sell");
                html += `
                        <tr>
                            <td>${idx + 1}</td>
                            <td><strong>${item.symbol}</strong></td>
                            <td>${item.company_name || item.symbol}</td>
                            <td>${item.sector || 'General'}</td>
                            <td>${(item.cap_type || 'all').toUpperCase()}</td>
                            <td class="score">${item.score}/100</td>
                            <td><span class="badge ${actionClass}">${item.action}</span></td>
                        </tr>
                `;
            });
            
            html += `
                    </tbody>
                </table>
                <div class="footer">
                    Generated on ${new Date().toLocaleString('en-IN')} by Apex Agentic AI Stock Prospectus Engine. All values calculated strictly from SQLite caching database.
                </div>
                <script>
                    window.onload = function() {
                        window.print();
                        setTimeout(function() { window.close(); }, 500);
                    }
                </script>
            </body>
            </html>
            `;
            executeSystemPrint(html, 'width=1100,height=850');
        });
    }
    
    if (compareBtn) {
        compareBtn.addEventListener('click', () => {
            exportTableToCSV('compare-table-body', 'rival_structural_comparison.csv', 'compare-table-header');
        });
    }
}

// CSV Tabular Data Exporter
function exportTableToCSV(tbodyId, filename, theadId = null) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody || tbody.rows.length === 0) {
        showToast("No data available to export to CSV", "warning");
        return;
    }
    
    let csv = [];
    
    // Append Table Headers
    if (theadId) {
        const thead = document.getElementById(theadId);
        if (thead) {
            const headerCols = thead.querySelectorAll('th');
            const headerRow = Array.from(headerCols).map(col => `"${col.innerText.replace(/"/g, '""')}"`);
            csv.push(headerRow.join(','));
        }
    } else {
        if (tbodyId === 'screener-results-body') {
            csv.push('"Rank","Stock","Sector","Segment","AI Score","Fundamental","Valuation","Momentum","Action"');
        }
    }
    
    const rows = tbody.querySelectorAll('tr');
    rows.forEach(row => {
        const cols = row.querySelectorAll('td');
        if (cols.length > 0) {
            // Read column cells, skipping actions buttons column
            const rowData = Array.from(cols)
                .slice(0, theadId ? cols.length : cols.length - 1)
                .map(col => {
                    let val = col.innerText.replace(/\n/g, ' ').replace(/"/g, '""');
                    return `"${val}"`;
                });
            csv.push(rowData.join(','));
        }
    });
    
    const csvContent = csv.join("\n");
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    showToast(`CSV file successfully exported: ${filename}`, 'success');
}

// Watchlist Batch Portfolio Analytics Run
async function runWatchlistBatchAnalysis() {
    if (activeWatchlistId === null) return;
    
    const resultsContainer = document.getElementById('watchlist-analysis-results');
    const tbody = document.getElementById('watchlist-analysis-body');
    if (!resultsContainer || !tbody) return;
    
    resultsContainer.style.display = 'block';
    const summaryBox = document.getElementById('watchlist-summary-box');
    if (summaryBox) summaryBox.style.display = 'none';
    
    tbody.innerHTML = '<tr><td colspan="9" class="center-text text-muted"><span class="skeleton skeleton-text" style="display:inline-block; width:100%; height:20px;"></span>Batch analyzing assets...</td></tr>';
    
    try {
        const response = await fetch(`/api/watchlists/${activeWatchlistId}/analyze`);
        if (!response.ok) throw new Error("Batch analysis endpoint failed.");
        const data = await response.json();
        
        activeWatchlistBatchData = data;
        
        tbody.innerHTML = '';
        if (data.results.length === 0) {
            tbody.innerHTML = '<tr><td colspan="9" class="center-text text-muted">No items in watchlist to analyze.</td></tr>';
            return;
        }
        
        data.results.forEach(res => {
            const tr = document.createElement('tr');
            
            let recClass = 'badge-hold';
            if (res.action.toUpperCase().includes("BUY")) recClass = 'badge-buy';
            if (res.action.toUpperCase().includes("SELL") || res.action.toUpperCase().includes("AVOID") || res.action.toUpperCase().includes("UNDERPERFORM")) recClass = 'badge-sell';
            
            let trendClass = "yellow-text";
            if (res.trend === 'Bullish') trendClass = "green-text";
            if (res.trend === 'Bearish') trendClass = "red-text";
            
            const formattedPrice = res.current_price !== null && res.current_price !== undefined ? `Rs. ${res.current_price.toLocaleString('en-IN')}` : 'N/A';
            const formattedPE = res.pe !== null && res.pe !== undefined && res.pe > 0 ? res.pe.toFixed(1) : 'N/A';
            const formattedROE = res.roe !== null && res.roe !== undefined && res.roe > 0 ? `${res.roe.toFixed(1)}%` : 'N/A';
            const formattedMargin = res.margin_of_safety !== null && res.margin_of_safety !== undefined ? `${res.margin_of_safety > 0 ? '+' : ''}${res.margin_of_safety.toFixed(1)}%` : 'N/A';
            const marginClass = res.margin_of_safety !== null && res.margin_of_safety !== undefined ? (res.margin_of_safety >= 0 ? 'green-text' : 'red-text') : 'text-muted';
            const formattedRSI = res.rsi !== null && res.rsi !== undefined ? res.rsi.toFixed(0) : 'N/A';
            
            tr.innerHTML = `
                <td><strong>${res.symbol}</strong><br><span style="font-size: 9px;" class="text-muted">${res.name}</span></td>
                <td><span style="font-size:11px; font-weight:700; color:var(--text-primary);">${res.score}/100</span></td>
                <td><span class="rec-glowing-badge ${recClass}">${res.action}</span></td>
                <td>${formattedPrice}</td>
                <td>${formattedPE}</td>
                <td>${formattedROE}</td>
                <td class="${marginClass}">${formattedMargin}</td>
                <td>${formattedRSI}</td>
                <td><span class="${trendClass} font-weight-bold" style="font-size:10px;">${res.trend}</span></td>
            `;
            tbody.appendChild(tr);
        });
        showToast("Batch watchlist analysis complete.", "success");
    } catch (e) {
        tbody.innerHTML = `<tr><td colspan="9" class="center-text red-text font-weight-bold">Batch analysis failed: ${e.message}</td></tr>`;
        showToast("Batch analysis failed: " + e.message, "error");
    }
}

// 12. Index Universe Explorer Section
let universeConstituents = [];
let universeSortCol = 'company_name';
let universeSortAsc = true;

function setupUniverseExplorer() {
    // Refresh listener
    const refreshBtn = document.getElementById('universe-explorer-refresh-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', loadUniverseExplorerData);
    }
    
    // Select change listener
    const selectEl = document.getElementById('universe-explorer-select');
    if (selectEl) {
        selectEl.addEventListener('change', filterAndRenderUniverse);
    }
    
    // Search input listener
    const searchEl = document.getElementById('universe-explorer-search');
    if (searchEl) {
        searchEl.addEventListener('input', filterAndRenderUniverse);
    }

    // Sortable header click listeners
    const headers = document.querySelectorAll('#tab-universe th.sortable-univ');
    headers.forEach(h => {
        h.addEventListener('click', () => {
            const field = h.getAttribute('data-sort');
            if (universeSortCol === field) {
                universeSortAsc = !universeSortAsc;
            } else {
                universeSortCol = field;
                universeSortAsc = true;
            }
            
            // Reset and set indicators
            headers.forEach(header => {
                header.style.color = 'var(--text-secondary)';
                header.innerText = header.innerText.replace(/[▲▼↕]/g, '↕');
            });
            
            h.style.color = 'var(--color-primary)';
            h.innerText = h.innerText.replace('↕', universeSortAsc ? '▲' : '▼');
            
            filterAndRenderUniverse();
        });
    });

    // Auto-load when clicking the tab button (always sync to get fresh cache states)
    const tabBtn = document.getElementById('tab-universe-btn');
    if (tabBtn) {
        tabBtn.addEventListener('click', () => {
            loadUniverseExplorerData();
        });
    }
}

async function loadUniverseExplorerData() {
    const tbody = document.getElementById('universe-explorer-body');
    if (tbody) {
        tbody.innerHTML = '<tr><td colspan="7" class="center-text text-muted" style="padding: 30px; text-align: center;">Loading registered index universe...</td></tr>';
    }
    
    try {
        const response = await fetch('/api/universe');
        if (!response.ok) throw new Error("Failed to load universe explorer data.");
        const data = await response.json();
        
        universeConstituents = data;
        filterAndRenderUniverse();
        showToast("Synchronized persistent index universe from SQLite.", "success");
    } catch (e) {
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan="7" class="center-text red-text font-weight-bold" style="padding: 30px; text-align: center;">Failed to load constituents: ${e.message}</td></tr>`;
        }
        showToast("Universe loading failed: " + e.message, "error");
    }
}

function filterAndRenderUniverse() {
    const segment = document.getElementById('universe-explorer-select').value;
    const query = document.getElementById('universe-explorer-search').value.toLowerCase().trim();
    const tbody = document.getElementById('universe-explorer-body');
    const countEl = document.getElementById('universe-explorer-count');
    
    if (!tbody) return;
    tbody.innerHTML = '';
    
    let filtered = [...universeConstituents];
    
    // 1. Filter by index segment
    if (segment !== 'all') {
        filtered = filtered.filter(item => item.cap_type === segment);
    }
    
    // 2. Filter by name/symbol query
    if (query) {
        filtered = filtered.filter(item => 
            item.symbol.toLowerCase().includes(query) || 
            item.company_name.toLowerCase().includes(query) ||
            item.sector.toLowerCase().includes(query)
        );
    }
    
    // 3. Sort constituents
    filtered.sort((a, b) => {
        let valA = a[universeSortCol];
        let valB = b[universeSortCol];
        
        if (typeof valA === 'string') valA = valA.toLowerCase();
        if (typeof valB === 'string') valB = valB.toLowerCase();
        
        if (valA < valB) return universeSortAsc ? -1 : 1;
        if (valA > valB) return universeSortAsc ? 1 : -1;
        return 0;
    });
    
    // Update count
    if (countEl) {
        countEl.innerText = `${filtered.length} Stocks`;
    }
    
    if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="center-text text-muted" style="padding: 30px; text-align: center;">No registered stocks matched the filters.</td></tr>';
        return;
    }
    
    filtered.forEach((item, idx) => {
        const tr = document.createElement('tr');
        tr.style.transition = 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)';
        tr.style.cursor = 'default';
        
        tr.addEventListener('mouseenter', () => {
            tr.style.background = 'rgba(255, 255, 255, 0.025)';
            tr.style.transform = 'scale(1.003)';
        });
        tr.addEventListener('mouseleave', () => {
            tr.style.background = 'transparent';
            tr.style.transform = 'none';
        });

        // Cap type badge
        let capBadge = `<span class="badge-rec rec-hold" style="font-size:9.5px; font-weight:700; padding:3px 8px; border-radius: 5px;">${item.cap_type.toUpperCase()}</span>`;
        if (item.cap_type === 'large') {
            capBadge = `<span class="badge-rec rec-buy" style="font-size:9.5px; font-weight:700; padding:3px 8px; border-radius: 5px; background: rgba(16, 185, 129, 0.12); color: #10B981; border: 1px solid rgba(16, 185, 129, 0.3);">LARGE</span>`;
        } else if (item.cap_type === 'mid') {
            capBadge = `<span class="badge-rec rec-strong-buy" style="font-size:9.5px; font-weight:700; padding:3px 8px; border-radius: 5px; background: rgba(59, 130, 246, 0.12); color: #60a5fa; border: 1px solid rgba(59, 130, 246, 0.3);">MID</span>`;
        } else if (item.cap_type === 'small') {
            capBadge = `<span class="badge-rec rec-sell" style="font-size:9.5px; font-weight:700; padding:3px 8px; border-radius: 5px; background: rgba(245, 158, 11, 0.12); color: #f59e0b; border: 1px solid rgba(245, 158, 11, 0.3);">SMALL</span>`;
        }

        // Cache status badge
        const cacheBadge = item.is_cached === 1 
            ? '<span class="badge-rec rec-buy" style="font-size:9.5px; font-weight:700; padding:3px 8px; border-radius: 5px; background: rgba(16, 185, 129, 0.15); color: #10B981; border: 1px solid rgba(16,185,129,0.35);">WARMED 🟢</span>'
            : '<span class="badge-rec rec-hold cache-cold-badge" style="font-size:9.5px; font-weight:500; padding:3px 8px; border-radius: 5px;">COLD ⚪</span>';

        // Build watchlist selection options
        let watchlistOptions = '<option value="">Select Watchlist...</option>';
        if (watchlistsList && watchlistsList.length > 0) {
            watchlistsList.forEach(w => {
                watchlistOptions += `<option value="${w.id}">${w.name}</option>`;
            });
        } else {
            watchlistOptions = '<option value="">No watchlists</option>';
        }

        tr.innerHTML = `
            <td style="padding: 12px 15px; color: var(--text-secondary);">${idx + 1}</td>
            <td style="padding: 12px 15px;"><strong style="color: var(--text-primary); font-family: 'Outfit', sans-serif;">${item.symbol}</strong></td>
            <td style="padding: 12px 15px; color: var(--text-primary); font-weight: 500;">${item.company_name}</td>
            <td style="padding: 12px 15px; color: var(--text-secondary);">${item.sector}</td>
            <td style="padding: 12px 15px;">${capBadge}</td>
            <td style="padding: 12px 15px; text-align: center;">${cacheBadge}</td>
            <td style="padding: 12px 15px; text-align: center;">
                <div style="display: inline-flex; gap: 8px; align-items: center; justify-content: center; width: 100%;">
                    <button class="btn-primary universe-action-analyze-btn" data-symbol="${item.symbol}" style="font-size: 10.5px; padding: 5px 12px; font-family: 'Outfit', sans-serif; font-weight: 600; border-radius: 6px; cursor: pointer; transition: all 0.2s;">Research 📊</button>
                    <select class="universe-action-select" style="padding: 5px 10px; border-radius: 6px; font-size: 11px; cursor: pointer; outline: none; transition: all 0.2s; min-width: 130px;">
                        ${watchlistOptions}
                    </select>
                    <button class="btn-secondary universe-action-add-btn" style="font-size: 10.5px; padding: 5px 12px; font-family: 'Outfit', sans-serif; font-weight: 600; border-radius: 6px; cursor: pointer; transition: all 0.2s;">➕ Add</button>
                </div>
            </td>
        `;
        
        // Add action listener
        tr.querySelector('.universe-action-analyze-btn').addEventListener('click', () => {
            const sym = item.symbol;
            const searchInput = document.getElementById('analyzer-search-input');
            if (searchInput) {
                searchInput.value = sym;
            }
            switchTab('analyzer');
            loadStockAnalyzer(sym);
        });

        // Add to watchlist listener
        tr.querySelector('.universe-action-add-btn').addEventListener('click', async () => {
            const sym = item.symbol;
            const selectEl = tr.querySelector('.universe-action-select');
            const wId = selectEl ? selectEl.value : '';
            if (!wId) {
                showToast("Please select a watchlist from the dropdown first.", "warning");
                return;
            }
            
            try {
                const response = await fetch(`/api/watchlists/${wId}/items`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ symbol: sym })
                });
                
                if (!response.ok) {
                    const err = await response.json();
                    throw new Error(err.detail || "Failed to add stock to watchlist.");
                }
                
                showToast(`Successfully added ${sym} to the selected watchlist.`, "success");
                await fetchWatchlists();
            } catch (e) {
                showToast("Error: " + e.message, "error");
            }
        });
        
        tbody.appendChild(tr);
    });
    
    // Dynamic AI Universe Explorer Analyst Summary Block Generator
    const summaryBox = document.getElementById('universe-summary-block');
    const summaryText = document.getElementById('universe-summary-text');
    
    if (summaryBox && summaryText) {
        const totalCount = filtered.length;
        const warmedCount = filtered.filter(item => item.is_cached === 1).length;
        const warmedPct = totalCount > 0 ? (warmedCount / totalCount) * 100 : 0;
        
        const largeCount = filtered.filter(item => item.cap_type === 'large').length;
        const midCount = filtered.filter(item => item.cap_type === 'mid').length;
        const smallCount = filtered.filter(item => item.cap_type === 'small').length;
        
        let accentColor = '#EF4444'; // red (cold cache warning)
        let ratingTitle = '❄️ COLD DATABASE STATUS (Latency Exists)';
        let ratingMetaphor = 'Think of this database as a kitchen where no fresh ingredients have been pre-chopped. Every single stock lookup will require remote NSE server queries over HTTP, introducing significant visual loading latency.';
        
        if (warmedPct >= 40) {
            accentColor = '#10B981'; // emerald green
            ratingTitle = '🔥 HIGHLY PRE-PREPPED KITCHEN (Warmed Cache Widescreen)';
            ratingMetaphor = 'Think of database caching as pre-prepping common fresh ingredients in a busy restaurant kitchen before rush hour begins. Warming the cache ensures that when a stock analysis is requested, the workstation compiles calculations instantly instead of fetching data from remote NSE servers, keeping terminals operating with zero latency.';
        } else if (warmedPct >= 10) {
            accentColor = '#F59E0B'; // amber yellow
            ratingTitle = '⚖️ SEMI-WARMED ENGINE (Moderate Latency Risk)';
            ratingMetaphor = 'Think of this as a restaurant kitchen where only half the ingredients are prepped. While major Large-Cap index assets will load instantly, queries for Small-Cap or niche industry tickers will trigger cold lookups, resulting in brief analysis delays.';
        }
        
        summaryBox.style.borderLeft = `4px solid ${accentColor}`;
        
        let html = '';
        html += '<div style="display: grid; grid-template-columns: 1.15fr 0.85fr; gap: 18px; align-items: start;">';
        
        // Left Column: Metaphor
        html += '  <div>';
        html += `    <div style="font-size: 11px; font-weight: 700; color: ${accentColor}; margin-bottom: 5px; letter-spacing: 0.04em;">${ratingTitle}</div>`;
        html += `    <p style="font-size: 11px; color: var(--text-muted); line-height: 1.6; margin: 0; font-family: 'Inter', sans-serif;">${ratingMetaphor}</p>`;
        html += '  </div>';
        
        // Right Column: Metrics Grid
        html += '  <div style="display: grid; grid-template-columns: 1fr; gap: 8px;">';
        html += '    <div style="display: flex; gap: 8px;">';
        html += '      <div style="flex: 1; background: rgba(0,0,0,0.15); border: 1px solid rgba(255,255,255,0.03); padding: 8px 10px; border-radius: 6px; display: flex; flex-direction: column; justify-content: center;">';
        html += '        <span style="font-size: 8.5px; color: var(--text-secondary); text-transform: uppercase; font-weight: 600;">Warmed Cache Rate</span>';
        html += `        <strong style="font-size: 13.5px; color: ${accentColor}; margin-top: 1px; font-family: 'Outfit', sans-serif;">${warmedPct.toFixed(1)}%</strong>`;
        html += '      </div>';
        html += '      <div style="flex: 1; background: rgba(0,0,0,0.15); border: 1px solid rgba(255,255,255,0.03); padding: 8px 10px; border-radius: 6px; display: flex; flex-direction: column; justify-content: center;">';
        html += '        <span style="font-size: 8.5px; color: var(--text-secondary); text-transform: uppercase; font-weight: 600;">Warmed vs Total</span>';
        html += `        <strong style="font-size: 13.5px; color: #ffffff; margin-top: 1px; font-family: 'Outfit', sans-serif;"><span style="color:#10B981;">${warmedCount}W</span> <span style="color:var(--text-muted); font-size:10px;">/</span> <span style="color:var(--text-secondary); font-size:12px;">${totalCount}T</span></strong>`;
        html += '      </div>';
        html += '    </div>';
        
        // Segment breakdown
        html += '    <div style="background: rgba(0, 0, 0, 0.15); border: 1px solid rgba(255, 255, 255, 0.03); padding: 8px 12px; border-radius: 6px; display: flex; justify-content: space-between; align-items: center;">';
        html += '      <span style="font-size: 8.5px; color: var(--text-secondary); text-transform: uppercase; font-weight: 600;">Segment Constituents</span>';
        html += '      <div style="display: flex; gap: 8px; font-family: \'Outfit\', sans-serif; font-size: 10.5px; font-weight: 700;">';
        html += `        <span style="color: #10B981;">${largeCount} Large</span>`;
        html += `        <span style="color: #60a5fa;">${midCount} Mid</span>`;
        html += `        <span style="color: #f59e0b;">${smallCount} Small</span>`;
        html += '      </div>';
        html += '    </div>';
        
        html += '  </div>';
        html += '</div>';
        
        summaryText.innerHTML = html;
        summaryBox.style.display = 'block';
    }
}

// Fix #4: Load universe status into the sidebar status card
async function loadRebalancerStatus() {
    try {
        const res = await fetch('/api/admin/rebalance-status');
        if (!res.ok) return;
        const data = await res.json();

        const lastTsEl = document.getElementById('rebalance-last-ts');
        const univCountEl = document.getElementById('rebalance-universe-count');
        const cachedCountEl = document.getElementById('rebalance-cached-count');

        if (lastTsEl) {
            let ts = data.last_rebalanced || 'Never';
            if (ts !== 'Never') {
                try {
                    const d = new Date(ts);
                    ts = d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' })
                       + ' ' + d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
                } catch(e) { /* keep raw if parsing fails */ }
            }
            lastTsEl.textContent = ts;
        }
        if (univCountEl) univCountEl.textContent = data.universe_count ?? '—';
        if (cachedCountEl) cachedCountEl.textContent = data.cached_count ?? '—';
    } catch (e) {
        console.warn('Could not load rebalancer status:', e.message);
    }
}

// Fix #4: Wire the sidebar Sync button
function setupRebalanceButton() {
    const btn = document.getElementById('rebalance-now-btn');
    if (!btn) return;

    btn.addEventListener('click', async () => {
        if (btn.classList.contains('syncing')) return;

        btn.classList.add('syncing');
        btn.textContent = '↻';

        try {
            const res = await fetch('/api/admin/rebalance', { method: 'POST' });
            const data = await res.json();
            showToast(data.message || 'Universe synced successfully!', 'success');
            await loadRebalancerStatus();
        } catch (e) {
            showToast('Sync failed: ' + e.message, 'error');
        } finally {
            btn.classList.remove('syncing');
            btn.textContent = '↻ Sync';
        }
    });
}


/* ==================== 9-FEATURE MEGA-UPGRADE CLIENT MODULES ==================== */

function drawRSChartCanvas(data) {
    const container = document.querySelector('#price-trend-chart-card .chart-container');
    if (!container) return;
    if (typeof Chart === 'undefined') return;
    const restoredCanvas = getOrCreateCanvas('stock-chart', container);
    if (!restoredCanvas) return;
    if (activeChartInstance) activeChartInstance.destroy();

    const ctx = restoredCanvas.getContext('2d');
    
    // Theme-aware color configuration for light/dark modes
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
    const isLightTheme = currentTheme === 'light';

    const legendColor = isLightTheme ? '#1f2937' : '#e5e7eb';
    const tickColor = isLightTheme ? '#4b5563' : '#9ca3af';
    const gridColor = isLightTheme ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.05)';
    
    const gradientStock = ctx.createLinearGradient(0, 0, 0, 300);
    gradientStock.addColorStop(0, isLightTheme ? 'rgba(16, 185, 129, 0.12)' : 'rgba(16, 185, 129, 0.2)');
    gradientStock.addColorStop(1, 'rgba(16, 185, 129, 0.0)');
    
    const gradientNifty = ctx.createLinearGradient(0, 0, 0, 300);
    gradientNifty.addColorStop(0, isLightTheme ? 'rgba(239, 68, 68, 0.08)' : 'rgba(239, 68, 68, 0.15)');
    gradientNifty.addColorStop(1, 'rgba(239, 68, 68, 0.0)');

    activeChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: data.chart_data.dates,
            datasets: [
                {
                    label: `${data.symbol} Normalized`,
                    data: data.chart_data.stock_normalized,
                    borderColor: '#10b981',
                    borderWidth: 2,
                    fill: true,
                    backgroundColor: gradientStock,
                    tension: 0.15,
                    pointRadius: 0
                },
                {
                    label: 'Nifty 50 Normalized',
                    data: data.chart_data.nifty_normalized,
                    borderColor: '#ef4444',
                    borderWidth: 1.5,
                    borderDash: [5, 5],
                    fill: false,
                    tension: 0.15,
                    pointRadius: 0
                },
                {
                    label: 'RS Ratio Line (vs Nifty)',
                    data: data.chart_data.ratio_normalized,
                    borderColor: '#60a5fa',
                    borderWidth: 2,
                    fill: false,
                    tension: 0.15,
                    pointRadius: 0
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true,
                    labels: { color: legendColor, font: { size: 10 } }
                },
                tooltip: { mode: 'index', intersect: false }
            },
            scales: {
                x: {
                    grid: { color: gridColor },
                    ticks: { color: tickColor, font: { size: 9 }, maxTicksLimit: 8 }
                },
                y: {
                    grid: { color: gridColor },
                    ticks: { color: tickColor, font: { size: 9 } }
                }
            }
        }
    });
}

// 2. Earnings Quality Scorecard Renderer
function renderEarningsQuality(p) {
    const eq = p.earnings_quality;
    if (!eq) return;
    
    // Target Elements
    const pRing = document.getElementById('piotroski-ring');
    const pScoreNum = document.getElementById('piotroski-score-num');
    const pLabelEl = document.getElementById('piotroski-label');
    const pBox = document.getElementById('piotroski-box');
    const pMatrix = document.getElementById('piotroski-matrix');
    
    const zScoreEl = document.getElementById('altman-score-value');
    const zLabelEl = document.getElementById('altman-zone-label');
    const zBox = document.getElementById('altman-box');
    const zSliderPin = document.getElementById('altman-slider-pin');
    const zComponents = document.getElementById('altman-components-breakdown');
    
    const pScore = eq.piotroski_score || 0;
    const zScore = eq.altman_z_score || 0;
    const zZone = eq.altman_zone || "Unknown Zone";
    
    // --- 1. Piotroski Circular SVG Gauge ---
    if (pScoreNum) pScoreNum.innerText = pScore;
    
    if (pRing) {
        // Map 0-9 score linearly to progress dasharray
        const percentage = (pScore / 9) * 100;
        pRing.style.strokeDasharray = `${percentage}, 100`;
        
        // Color stroke & drop-shadow based on active score rating
        if (pScore >= 7) {
            pRing.style.stroke = 'var(--color-emerald)';
            pRing.style.filter = 'drop-shadow(0 0 5px rgba(16, 185, 129, 0.4))';
        } else if (pScore >= 4) {
            pRing.style.stroke = 'var(--color-amber)';
            pRing.style.filter = 'drop-shadow(0 0 5px rgba(245, 158, 11, 0.4))';
        } else {
            pRing.style.stroke = 'var(--color-crimson)';
            pRing.style.filter = 'drop-shadow(0 0 5px rgba(239, 68, 68, 0.4))';
        }
    }
    
    if (pLabelEl) {
        pLabelEl.innerText = eq.piotroski_label;
        if (pScore >= 7) {
            pLabelEl.style.background = 'rgba(16, 185, 129, 0.15)';
            pLabelEl.style.color = 'var(--color-emerald)';
            pLabelEl.style.borderColor = 'rgba(16, 185, 129, 0.25)';
            if (pBox) {
                pBox.style.borderColor = 'rgba(16, 185, 129, 0.25)';
                pBox.style.boxShadow = '0 0 15px rgba(16, 185, 129, 0.1)';
            }
        } else if (pScore >= 4) {
            pLabelEl.style.background = 'rgba(245, 158, 11, 0.15)';
            pLabelEl.style.color = 'var(--color-amber)';
            pLabelEl.style.borderColor = 'rgba(245, 158, 11, 0.25)';
            if (pBox) {
                pBox.style.borderColor = 'rgba(245, 158, 11, 0.25)';
                pBox.style.boxShadow = '0 0 15px rgba(245, 158, 11, 0.1)';
            }
        } else {
            pLabelEl.style.background = 'rgba(239, 68, 68, 0.15)';
            pLabelEl.style.color = 'var(--color-crimson)';
            pLabelEl.style.borderColor = 'rgba(239, 68, 68, 0.25)';
            if (pBox) {
                pBox.style.borderColor = 'rgba(239, 68, 68, 0.25)';
                pBox.style.boxShadow = '0 0 15px rgba(239, 68, 68, 0.1)';
            }
        }
    }
    
    // --- 2. Interactive Piotroski Matrix Cells ---
    if (pMatrix && eq.piotroski_details) {
        pMatrix.innerHTML = '';
        
        // Define abbreviations for each index
        const abbrevs = ["ROA", "CFO", "ΔROA", "ACCR", "ΔLEV", "ΔLIQ", "DIL", "ΔMARGIN", "ΔTURN"];
        
        eq.piotroski_details.forEach((item, index) => {
            const abbrev = abbrevs[index] || "MET";
            const cell = document.createElement('div');
            cell.className = 'piotroski-matrix-cell';
            
            const cellColor = item.passed ? 'rgba(16, 185, 129, 0.04)' : 'rgba(239, 68, 68, 0.04)';
            const cellBorder = item.passed ? '1.5px solid rgba(16, 185, 129, 0.2)' : '1.5px solid rgba(239, 68, 68, 0.2)';
            
            cell.style.background = cellColor;
            cell.style.border = cellBorder;
            cell.style.borderRadius = '6px';
            cell.style.padding = '8px 6px';
            cell.style.cursor = 'pointer';
            cell.style.transition = 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)';
            cell.style.display = 'flex';
            cell.style.flexDirection = 'column';
            cell.style.alignItems = 'center';
            cell.style.justifyContent = 'center';
            cell.style.minHeight = '36px';
            cell.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
            
            const dotColor = item.passed ? 'var(--color-emerald)' : 'var(--color-crimson)';
            
            cell.innerHTML = `
                <span class="cell-abbrev" style="font-size: 8.5px; font-weight: 700; color: var(--text-secondary); letter-spacing:0.02em;">${abbrev}</span>
                <span class="cell-status-dot" style="background: ${dotColor}; box-shadow: 0 0 3px ${dotColor}; width: 5px; height: 5px; border-radius: 50%; margin-top: 4px;"></span>
            `;
            
            // Hover mouse events
            cell.addEventListener('mouseenter', () => {
                cell.style.transform = 'translateY(-2px) scale(1.03)';
                cell.style.boxShadow = item.passed ? '0 0 10px rgba(16, 185, 129, 0.3)' : '0 0 10px rgba(239, 68, 68, 0.3)';
                
                const titleEl = document.getElementById('eq-explain-title');
                const descEl = document.getElementById('eq-explain-desc');
                if (titleEl && descEl) {
                    titleEl.innerText = `${item.test} [${item.category}]`;
                    titleEl.style.color = item.passed ? 'var(--color-emerald)' : 'var(--color-crimson)';
                    descEl.innerText = `Status: ${item.passed ? 'PASSED 🟢' : 'FAILED 🔴'}. Audit targets ${item.test.toLowerCase()} YoY.`;
                }
            });
            
            cell.addEventListener('mouseleave', () => {
                cell.style.transform = 'none';
                cell.style.boxShadow = '0 2px 4px rgba(0,0,0,0.1)';
                
                const titleEl = document.getElementById('eq-explain-title');
                const descEl = document.getElementById('eq-explain-desc');
                if (titleEl && descEl) {
                    titleEl.innerText = 'Hover cells for audit details';
                    titleEl.style.color = 'var(--text-primary)';
                    descEl.innerText = 'Move cursor over the matrix cells above to verify dynamic pass/fail checks.';
                }
            });
            
            pMatrix.appendChild(cell);
        });
    }
    
    // --- 3. Altman Z-Score Indicators & Slider ---
    if (zScoreEl) zScoreEl.innerText = zScore.toFixed(2);
    
    if (zLabelEl) {
        zLabelEl.innerText = zZone;
        if (zZone === "Safe Zone") {
            zLabelEl.style.background = 'rgba(16, 185, 129, 0.15)';
            zLabelEl.style.color = 'var(--color-emerald)';
            zLabelEl.style.borderColor = 'rgba(16, 185, 129, 0.25)';
            if (zBox) {
                zBox.style.borderColor = 'rgba(16, 185, 129, 0.25)';
                zBox.style.boxShadow = '0 0 15px rgba(16, 185, 129, 0.1)';
            }
        } else if (zZone === "Grey Zone") {
            zLabelEl.style.background = 'rgba(245, 158, 11, 0.15)';
            zLabelEl.style.color = 'var(--color-amber)';
            zLabelEl.style.borderColor = 'rgba(245, 158, 11, 0.25)';
            if (zBox) {
                zBox.style.borderColor = 'rgba(245, 158, 11, 0.25)';
                zBox.style.boxShadow = '0 0 15px rgba(245, 158, 11, 0.1)';
            }
        } else {
            zLabelEl.style.background = 'rgba(239, 68, 68, 0.15)';
            zLabelEl.style.color = 'var(--color-crimson)';
            zLabelEl.style.borderColor = 'rgba(239, 68, 68, 0.25)';
            if (zBox) {
                zBox.style.borderColor = 'rgba(239, 68, 68, 0.25)';
                zBox.style.boxShadow = '0 0 15px rgba(239, 68, 68, 0.1)';
            }
        }
    }
    
    if (zSliderPin) {
        // Map 0.0 to 5.0 onto 5% to 95% left offset
        let posPct = (zScore / 5.0) * 90 + 5;
        posPct = Math.min(95, Math.max(5, posPct));
        zSliderPin.style.left = `${posPct}%`;
        
        // Custom pin color based on solvency rating
        if (zZone === "Safe Zone") {
            zSliderPin.style.borderColor = 'var(--color-emerald)';
            zSliderPin.style.boxShadow = '0 0 10px rgba(16, 185, 129, 0.6)';
        } else if (zZone === "Grey Zone") {
            zSliderPin.style.borderColor = 'var(--color-amber)';
            zSliderPin.style.boxShadow = '0 0 10px rgba(245, 158, 11, 0.6)';
        } else {
            zSliderPin.style.borderColor = 'var(--color-crimson)';
            zSliderPin.style.boxShadow = '0 0 10px rgba(239, 68, 68, 0.6)';
        }
    }
    
    // --- 4. Altman Ratios Mathematical Breakdown ---
    if (zComponents) {
        zComponents.innerHTML = '';
        const comps = eq.altman_components || {};
        
        const componentDefinitions = [
            { key: "working_capital_ta", name: "A: Net Liquidity", coef: 1.2, desc: "Working Capital / Total Assets" },
            { key: "retained_earnings_ta", name: "B: Profitability", coef: 1.4, desc: "Retained Earnings / Total Assets" },
            { key: "ebit_ta", name: "C: Operating EBIT", coef: 3.3, desc: "EBIT / Total Assets" },
            { key: "market_cap_tl", name: "D: Solvency Leverage", coef: 0.6, desc: "Market Cap / Total Liabilities" },
            { key: "revenue_ta", name: "E: Productivity", coef: 1.0, desc: "Revenue / Total Assets" }
        ];
        
        const activeColor = zZone === "Safe Zone" ? 'var(--color-emerald)' 
                          : zZone === "Grey Zone" ? 'var(--color-amber)' 
                          : 'var(--color-crimson)';
                          
        componentDefinitions.forEach(item => {
            const ratioVal = comps[item.key] !== undefined ? comps[item.key] : 0;
            const contrib = item.coef * ratioVal;
            
            // Map positive contribution to progress bar width
            let barPct = Math.min(100, Math.max(5, (contrib / 1.5) * 100));
            if (contrib < 0) barPct = 5; // Minimal bar for negative contributions
            
            const row = document.createElement('div');
            row.className = 'altman-comp-row';
            row.style.display = 'flex';
            row.style.alignItems = 'center';
            row.style.justifyContent = 'space-between';
            row.style.background = 'rgba(255, 255, 255, 0.01)';
            row.style.border = '1px solid rgba(255, 255, 255, 0.03)';
            row.style.borderRadius = '5px';
            row.style.padding = '4px 8px';
            row.style.fontSize = '9.5px';
            row.style.gap = '8px';
            row.style.marginBottom = '2px';
            
            row.innerHTML = `
                <span class="altman-comp-label" style="font-weight: 600; color: var(--text-secondary); width: 85px; text-align: left; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${item.desc}">${item.name}</span>
                <div class="altman-comp-progress-container" style="flex: 1; height: 6px; background: rgba(0,0,0,0.3); border-radius: 3px; overflow: hidden; border: 1px solid rgba(255,255,255,0.02);">
                    <div class="altman-comp-progress-fill" style="height: 100%; width: ${barPct}%; background: ${activeColor}; box-shadow: 0 0 3px ${activeColor}; border-radius: 3px; transition: width 0.8s ease;"></div>
                </div>
                <span class="altman-comp-val" style="font-family: monospace; width: 100px; text-align: right; font-size: 8.5px;">${item.coef}×${ratioVal.toFixed(2)} = <strong style="color: ${activeColor}">${contrib >= 0 ? '+' : ''}${contrib.toFixed(2)}</strong></span>
            `;
            zComponents.appendChild(row);
        });
    }
    
    // --- 5. Dynamic AI Synopsis Paragraph ---
    const summaryTextEl = document.getElementById('earnings-quality-summary-text');
    if (summaryTextEl) {
        let fEval = "";
        if (pScore >= 7) {
            fEval = `a stellar Piotroski F-Score of **${pScore}/9**, reflecting strong operational health, improving margins, and robust cash conversions.`;
        } else if (pScore >= 4) {
            fEval = `a moderate Piotroski F-Score of **${pScore}/9**, indicating a stable operating core but highlighting a few minor cash flow or asset utilization bottlenecks.`;
        } else {
            fEval = `a weak Piotroski F-Score of **${pScore}/9**, warning of structural operating inefficiencies, deteriorating profitability, or working capital strains.`;
        }
        
        let zEval = "";
        if (zZone.includes("Safe")) {
            zEval = `Additionally, with an Altman Z-Score of **${zScore.toFixed(2)}** (Safe Zone), the company rests in the low-risk solvency category, meaning near-term bankruptcy risk is mathematically negligible.`;
        } else if (zZone.includes("Grey")) {
            zEval = `However, the Altman Z-Score stands in the Grey Zone at **${zScore.toFixed(2)}**, suggesting moderate long-term solvency warnings and a need for cautious capital structure management.`;
        } else {
            zEval = `Critically, the Altman Z-Score of **${zScore.toFixed(2)}** puts it in the Distress Zone, indicating heightened leverage pressure and structural solvency risks that demand close monitoring.`;
        }
        
        let fLayman = "";
        if (pScore >= 7) {
            fLayman = "Think of this strong earnings quality F-Score as a clean, highly efficient engine running smoothly with zero oil leaks—reported profits are backed by solid operational cash flow rather than creative accounting tricks.";
        } else if (pScore >= 4) {
            fLayman = "Think of this moderate F-Score as a standard family car—it runs fine and is reliable, but has a few minor warning lights on the dashboard related to asset efficiency or cash conversion speed that require checkups.";
        } else {
            fLayman = "Think of this weak F-Score as a sputtering vehicle blowing thick smoke—reported earnings are largely paper profits with deteriorating margins and cash flow deficits, raising red flags about operational distress.";
        }
        
        let zLayman = "";
        if (zZone.includes("Safe")) {
            zLayman = "Additionally, the Altman solvency indicator places the company in the Safe Zone. Think of it as a fortress with thick, massive concrete walls and large cash reserves—near-term solvency pressure is practically non-existent.";
        } else if (zZone.includes("Grey")) {
            zLayman = "However, the Altman Z solvency indicator rests in the Grey Zone. Think of this as a boat sailing in choppy waters—it is not sinking, but the captain needs to carefully manage debts and liabilities to avoid drifting into storm cells.";
        } else {
            zLayman = "Critically, the Altman Z solvency indicator puts the company in the Distress Zone. Think of this as a vessel with a severe hull leak taking on water rapidly—the debt burden is heavily crushing equity, presenting solvency risks.";
        }
        
        // Dynamically color highlight the card bottom block borders
        const summaryBlock = document.getElementById('earnings-quality-summary-block');
        if (summaryBlock) {
            let zoneColor = 'var(--text-secondary)';
            let zoneBg = 'rgba(255,255,255,0.015)';
            if (zZone === "Safe Zone") {
                zoneColor = 'var(--color-emerald)';
                zoneBg = 'rgba(16, 185, 129, 0.03)';
            } else if (zZone === "Grey Zone") {
                zoneColor = 'var(--color-amber)';
                zoneBg = 'rgba(245, 158, 11, 0.03)';
            } else if (zZone === "Distress Zone") {
                zoneColor = 'var(--color-crimson)';
                zoneBg = 'rgba(239, 68, 68, 0.03)';
            }
            summaryBlock.style.borderLeft = `2.5px solid ${zoneColor}`;
            summaryBlock.style.background = zoneBg;
        }
        
        summaryTextEl.innerHTML = `🛡️ **Institutional Synopsis:** The company demonstrates ${fEval} ${zEval}<br><br>💡 **Layman Analogy:** ${fLayman} ${zLayman}`;
    }
}


// 5. Drawdown Analysis & Risk Profile Chart Loader
let activeDrawdownChartInstance = null;

async function loadDrawdownChart(ticker, period) {
    const container = document.getElementById('drawdown-chart-container');
    if (!container) return;

    // Clean up previous Lightweight Drawdown Chart instance
    if (window.activeDrawdownLightweightChart) {
        try {
            window.activeDrawdownLightweightChart.remove();
        } catch (e) {
            console.warn("Error removing drawdown chart:", e);
        }
        window.activeDrawdownLightweightChart = null;
    }

    // Clean up legacy Chart.js instances if any exist
    if (activeDrawdownChartInstance) {
        activeDrawdownChartInstance.destroy();
        activeDrawdownChartInstance = null;
    }

    try {
        const response = await fetch(`/api/drawdown?symbol=${encodeURIComponent(ticker)}&period=${period}`);
        if (!response.ok) throw new Error();
        const data = await response.json();

        const maxDd = Math.abs(data.max_drawdown_pct);
        const recDays = data.worst_drawdown_duration_days;

        document.getElementById('drawdown-max-pct').innerText = `${data.max_drawdown_pct.toFixed(1)}%`;
        document.getElementById('drawdown-recovery-days').innerText = `${data.worst_drawdown_duration_days} days`;

        // Render dynamic summary with Analyst Verdict and Layman Translation
        const summaryTextEl = document.getElementById('drawdown-summary-text');
        if (summaryTextEl) {
            let analystText = "";
            let laymanDescription = "";

            if (maxDd < 10) {
                analystText = `Asset demonstrates high fundamental stability. Maximum peak-to-trough drop is limited to ${maxDd.toFixed(1)}%, with a rapid worst-case recovery speed of ${recDays} days. High capital preservation profile.`;
                laymanDescription = `This stock is highly stable and steady, like driving a car over a tiny pothole on a beautifully paved highway. In its worst drop, it barely lost value and bounced back in just ${recDays} days. It is an extremely safe place to park your money.`;
            } else if (maxDd < 20) {
                analystText = `Moderate pricing drawdowns observed (Max Drop: ${maxDd.toFixed(1)}%). Symmetrical cyclical recovery cycle of ${recDays} days aligns with standard bluechip index volatility. Sizable capital defense.`;
                laymanDescription = `The stock has normal, moderate price swings—like riding a mild roller coaster with short, gentle drops. Its worst dip was a reasonable ${maxDd.toFixed(1)}% drop, and it crawled back to its previous peak within ${recDays} days. Very standard for high-quality bluechip companies.`;
            } else if (maxDd < 35) {
                analystText = `High cyclical beta swings (Max Drop: ${maxDd.toFixed(1)}%) with extended value-recovery timelines spanning ${recDays} days. Sizable risk premium requires a long-term capital focus.`;
                laymanDescription = `This stock experiences significant price swings—like riding a fast roller coaster with sudden, steep drops. It suffered a sizable ${maxDd.toFixed(1)}% drop from its high and took a lengthy ${recDays} days to climb back. Investors should expect temporary paper losses and must be patient.`;
            } else {
                analystText = `Extreme risk profiling with severe price drops (Max Drop: ${maxDd.toFixed(1)}%) and major cyclical capital recovery delays lasting ${recDays} days. Vulnerable to macro-shocks.`;
                laymanDescription = `This is a highly volatile, high-risk asset—like standing on the edge of a steep mountain cliff. The stock suffered a major crash of ${maxDd.toFixed(1)}% from its high and took an extremely long time (${recDays} days) to fully recover. Only invest here if you are comfortable with deep dips and have a multi-year horizon.`;
            }

            summaryTextEl.innerHTML = `
                <div style="margin-bottom: 8px;">
                    <strong>Analyst Verdict:</strong> ${analystText}
                </div>
                <div style="font-size:11px; color:var(--text-muted); line-height: 1.45; border-left: 2.5px solid var(--color-crimson); padding-left: 8px; margin-top: 6px; background: rgba(239, 68, 68, 0.03); padding-top: 5px; padding-bottom: 5px; border-radius: 0 4px 4px 0; width: 100%;">
                    💡 <strong>Layman Translation:</strong> ${laymanDescription}
                </div>
            `;
        }

        // Check if TradingView Lightweight Charts is available
        if (typeof LightweightCharts === 'undefined') {
            console.warn("TradingView Lightweight Charts offline, falling back to Chart.js for drawdown chart.");
            drawChartJSDrawdownChart(data);
            return;
        }

        container.innerHTML = ''; // Clear container for TradingView Canvas
        const isDarkTheme = document.body.getAttribute('data-theme') !== 'light';
        const hudEl = document.getElementById('drawdown-chart-hud');

        // Create Lightweight Chart
        const chart = LightweightCharts.createChart(container, {
            width: container.clientWidth,
            height: 200,
            layout: {
                background: { type: 'solid', color: 'transparent' },
                textColor: isDarkTheme ? '#94a3b8' : '#334155',
                fontFamily: 'Inter, sans-serif',
            },
            grid: {
                vertLines: { color: isDarkTheme ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.03)' },
                horzLines: { color: isDarkTheme ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.03)' },
            },
            rightPriceScale: {
                borderColor: isDarkTheme ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
                scaleMargins: { top: 0.1, bottom: 0.15 }
            },
            timeScale: {
                borderColor: isDarkTheme ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
                timeVisible: false,
                fixLeftEdge: true,
                fixRightEdge: true
            },
            crosshair: {
                mode: LightweightCharts.CrosshairMode.Normal,
            }
        });
        window.activeDrawdownLightweightChart = chart;

        // Plot Drawdown Area series (flips translucent crimson red downward)
        const drawdownSeries = chart.addAreaSeries({
            topColor: 'rgba(239, 68, 68, 0.0)',
            bottomColor: 'rgba(239, 68, 68, 0.25)',
            lineColor: '#ef4444',
            lineWidth: 2,
            priceFormat: {
                type: 'custom',
                formatter: v => `${v.toFixed(1)}%`
            }
        });

        const formattedDates = data.chart_data.dates.map(d => d.split('T')[0]);
        const drawdownsData = formattedDates.map((d, idx) => ({
            time: d,
            value: Number(data.chart_data.drawdowns[idx])
        })).filter(item => item.value !== null && !isNaN(item.value));

        drawdownSeries.setData(drawdownsData);
        chart.timeScale().fitContent();

        // Crosshair move listener to update HUD
        const updateHUD = (timeStr) => {
            if (!hudEl) return;
            const idx = formattedDates.indexOf(timeStr);
            const val = idx !== -1 ? Number(data.chart_data.drawdowns[idx]) : -data.max_drawdown_pct;

            hudEl.innerHTML = `
                <span style="color:var(--text-primary); font-weight:600; margin-right:15px;">📅 ${timeStr || 'Latest'}</span>
                <span style="color:#ef4444; font-weight:600; margin-right:15px;">📉 Peak-to-Trough Drawdown: ${val.toFixed(1)}%</span>
                <span style="color:#94a3b8; font-weight:500;">🛡️ Peak Volatility Drop Floor: ${data.max_drawdown_pct.toFixed(1)}%</span>
            `;
        };

        // Initialize with latest data points
        if (formattedDates.length > 0) {
            updateHUD(formattedDates[formattedDates.length - 1]);
        }

        chart.subscribeCrosshairMove(param => {
            if (param.time) {
                const timeStr = typeof param.time === 'string'
                    ? param.time
                    : `${param.time.year}-${String(param.time.month).padStart(2,'0')}-${String(param.time.day).padStart(2,'0')}`;
                updateHUD(timeStr);
            } else {
                if (formattedDates.length > 0) {
                    updateHUD(formattedDates[formattedDates.length - 1]);
                }
            }
        });

        // Resize Observer
        const resizeObserver = new ResizeObserver(entries => {
            for (let entry of entries) {
                chart.resize(entry.contentRect.width, 200);
            }
        });
        resizeObserver.observe(container);

    } catch (e) {
        console.error("Failed to load drawdown chart:", e);
    }
}

function drawChartJSDrawdownChart(data) {
    const restoredCanvas = getOrCreateCanvas('drawdown-chart', document.getElementById('drawdown-chart-container'));
    if (!restoredCanvas) return;
    
    if (activeDrawdownChartInstance) activeDrawdownChartInstance.destroy();
    
    const ctx = restoredCanvas.getContext('2d');
    
    activeDrawdownChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: data.chart_data.dates,
            datasets: [{
                label: 'Drawdown %',
                data: data.chart_data.drawdowns,
                borderColor: '#ef4444',
                borderWidth: 1.5,
                backgroundColor: 'rgba(239, 68, 68, 0.1)',
                fill: true,
                tension: 0.1,
                pointRadius: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { display: false },
                y: {
                    grid: { color: 'rgba(255,255,255,0.05)' },
                    ticks: { color: '#9ca3af', font: { size: 9 } }
                }
            }
        }
    });
}

// 6. Return Calculator Controller
let selectedReturnCalcType = 'cagr';

function setupReturnCalculator() {
    const cagrBtn = document.getElementById('calc-type-cagr-btn');
    const sipBtn = document.getElementById('calc-type-sip-btn');
    const runBtn = document.getElementById('run-calc-btn');
    const amountInput = document.getElementById('calc-amount-input');
    const amountSlider = document.getElementById('calc-amount-slider');
    const amountLabel = document.getElementById('calc-amount-label');
    const quickAmountsDiv = document.getElementById('calc-quick-amounts');
    
    // Quick amount lists
    const cagrQuickList = [10000, 50000, 100000, 250000, 500000];
    const sipQuickList = [1000, 2000, 5000, 10000, 20000];
    
    function renderQuickAmounts(amounts) {
        if (!quickAmountsDiv) return;
        quickAmountsDiv.innerHTML = '';
        amounts.forEach(amt => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.style.flex = '1';
            btn.style.padding = '4px 2px';
            btn.style.fontSize = '10px';
            btn.style.background = 'rgba(255,255,255,0.03)';
            btn.style.border = '1px solid var(--border-glass)';
            btn.style.borderRadius = '4px';
            btn.style.color = 'var(--text-secondary)';
            btn.style.cursor = 'pointer';
            btn.innerText = amt >= 100000 ? `₹${amt/100000}L` : `₹${amt/1000}K`;
            
            btn.addEventListener('click', () => {
                if (amountInput) amountInput.value = amt;
                if (amountSlider) amountSlider.value = amt;
            });
            quickAmountsDiv.appendChild(btn);
        });
    }
    
    function setCalculatorMode(type) {
        selectedReturnCalcType = type;
        if (type === 'cagr') {
            if (cagrBtn) {
                cagrBtn.className = 'btn-primary';
                cagrBtn.style.background = 'var(--color-primary)';
            }
            if (sipBtn) {
                sipBtn.className = 'btn-secondary';
                sipBtn.style.background = 'none';
                sipBtn.style.color = 'var(--text-secondary)';
            }
            if (amountLabel) amountLabel.innerText = "Lump Sum Investment (₹)";
            if (amountSlider) {
                amountSlider.min = "1000";
                amountSlider.max = "1000000";
                amountSlider.step = "1000";
                amountSlider.value = "100000";
            }
            if (amountInput) amountInput.value = "100000";
            renderQuickAmounts(cagrQuickList);
        } else {
            if (sipBtn) {
                sipBtn.className = 'btn-primary';
                sipBtn.style.background = 'var(--color-primary)';
            }
            if (cagrBtn) {
                cagrBtn.className = 'btn-secondary';
                cagrBtn.style.background = 'none';
                cagrBtn.style.color = 'var(--text-secondary)';
            }
            if (amountLabel) amountLabel.innerText = "Monthly SIP Amount (₹)";
            if (amountSlider) {
                amountSlider.min = "500";
                amountSlider.max = "100000";
                amountSlider.step = "500";
                amountSlider.value = "5000";
            }
            if (amountInput) amountInput.value = "5000";
            renderQuickAmounts(sipQuickList);
        }
    }
    
    // Mode toggles
    if (cagrBtn && sipBtn) {
        cagrBtn.addEventListener('click', () => setCalculatorMode('cagr'));
        sipBtn.addEventListener('click', () => setCalculatorMode('sip'));
    }
    
    // Initialise default mode
    setCalculatorMode('cagr');
    
    // Bidirectional sync between slider and input text
    if (amountSlider && amountInput) {
        amountSlider.addEventListener('input', (e) => {
            amountInput.value = e.target.value;
        });
        amountInput.addEventListener('change', (e) => {
            let val = parseFloat(e.target.value) || 0;
            const min = parseFloat(amountSlider.min);
            const max = parseFloat(amountSlider.max);
            if (val < min) val = min;
            if (val > max) val = max;
            amountInput.value = val;
            amountSlider.value = val;
        });
    }
    
    // === Custom Dropdown Calendar Logic ===
    const dateInput = document.getElementById('calc-date-input');
    const calendarDropdown = document.getElementById('custom-calendar-dropdown');
    const monthSelect = document.getElementById('cal-month-select');
    const yearSelect = document.getElementById('cal-year-select');
    const prevMonthBtn = document.getElementById('cal-prev-month');
    const nextMonthBtn = document.getElementById('cal-next-month');
    const daysGrid = document.getElementById('cal-days-grid');
    
    let currentCalDate = new Date(2021, 0, 1); // Default to 2021-01-01
    
    // Populate month options
    const months = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", 
        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"
    ];
    if (monthSelect) {
        monthSelect.innerHTML = '';
        months.forEach((m, idx) => {
            const opt = document.createElement('option');
            opt.value = idx;
            opt.innerText = m;
            monthSelect.appendChild(opt);
        });
    }
    
    // Populate year options (from 2010 to current year)
    if (yearSelect) {
        yearSelect.innerHTML = '';
        const currentYear = new Date().getFullYear();
        for (let y = 2010; y <= currentYear; y++) {
            const opt = document.createElement('option');
            opt.value = y;
            opt.innerText = y;
            yearSelect.appendChild(opt);
        }
    }
    
    function renderCustomCalendar() {
        if (!daysGrid || !monthSelect || !yearSelect) return;
        
        const year = currentCalDate.getFullYear();
        const month = currentCalDate.getMonth();
        
        monthSelect.value = month;
        yearSelect.value = year;
        
        daysGrid.innerHTML = '';
        
        // Find first day of the month and total days
        const firstDayIdx = new Date(year, month, 1).getDay();
        const totalDays = new Date(year, month + 1, 0).getDate();
        
        // Find total days in previous month for padding
        const prevMonthTotalDays = new Date(year, month, 0).getDate();
        
        // Active selected date parsed from text input
        let activeDateObj = null;
        if (dateInput && dateInput.value) {
            const parts = dateInput.value.split('-');
            if (parts.length === 3) {
                activeDateObj = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
            }
        }
        
        const today = new Date();
        
        // 1. Add days from previous month (as padding)
        for (let i = firstDayIdx - 1; i >= 0; i--) {
            const dayNum = prevMonthTotalDays - i;
            const cell = document.createElement('div');
            cell.className = 'cal-day-cell other-month';
            cell.innerText = dayNum;
            daysGrid.appendChild(cell);
        }
        
        // 2. Add current month days
        for (let d = 1; d <= totalDays; d++) {
            const cell = document.createElement('div');
            cell.className = 'cal-day-cell';
            cell.innerText = d;
            
            const cellDate = new Date(year, month, d);
            
            // Check if active selected date
            if (activeDateObj && 
                cellDate.getFullYear() === activeDateObj.getFullYear() && 
                cellDate.getMonth() === activeDateObj.getMonth() && 
                cellDate.getDate() === activeDateObj.getDate()) {
                cell.classList.add('active');
            }
            
            // Check if today
            if (cellDate.getFullYear() === today.getFullYear() && 
                cellDate.getMonth() === today.getMonth() && 
                cellDate.getDate() === today.getDate()) {
                cell.classList.add('today');
            }
            
            // Click to select date
            cell.addEventListener('click', () => {
                const formattedMonth = String(month + 1).padStart(2, '0');
                const formattedDay = String(d).padStart(2, '0');
                if (dateInput) {
                    dateInput.value = `${year}-${formattedMonth}-${formattedDay}`;
                    // Trigger change event to ensure any listener wakes up
                    dateInput.dispatchEvent(new Event('change'));
                }
                if (calendarDropdown) {
                    calendarDropdown.style.display = 'none';
                }
            });
            
            daysGrid.appendChild(cell);
        }
    }
    
    // Trigger open
    if (dateInput && calendarDropdown) {
        const toggleCalendar = (e) => {
            e.stopPropagation();
            const isOpen = calendarDropdown.style.display === 'block';
            if (isOpen) {
                calendarDropdown.style.display = 'none';
            } else {
                // Set calendar date based on current text input value
                if (dateInput.value) {
                    const parts = dateInput.value.split('-');
                    if (parts.length === 3) {
                        currentCalDate = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
                    }
                }
                calendarDropdown.style.display = 'block';
                renderCustomCalendar();
            }
        };
        
        dateInput.addEventListener('click', toggleCalendar);
        const triggerIcon = document.getElementById('calc-date-trigger-icon');
        if (triggerIcon) {
            triggerIcon.addEventListener('click', toggleCalendar);
        }
    }
    
    // Header navigation
    if (prevMonthBtn) {
        prevMonthBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            currentCalDate.setMonth(currentCalDate.getMonth() - 1);
            renderCustomCalendar();
        });
    }
    if (nextMonthBtn) {
        nextMonthBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            currentCalDate.setMonth(currentCalDate.getMonth() + 1);
            renderCustomCalendar();
        });
    }
    
    // Header drop menus selectors
    if (monthSelect) {
        monthSelect.addEventListener('change', (e) => {
            currentCalDate.setMonth(parseInt(e.target.value));
            renderCustomCalendar();
        });
    }
    if (yearSelect) {
        yearSelect.addEventListener('change', (e) => {
            currentCalDate.setFullYear(parseInt(e.target.value));
            renderCustomCalendar();
        });
    }
    
    // Stop event propagation inside dropdown calendar container to prevent auto close
    if (calendarDropdown) {
        calendarDropdown.addEventListener('click', (e) => {
            e.stopPropagation();
        });
    }
    
    // Outside click closer
    document.addEventListener('click', () => {
        if (calendarDropdown) {
            calendarDropdown.style.display = 'none';
        }
    });
    
    // Quick periods bindings
    const periodButtons = document.querySelectorAll('.period-quick-btn');
    periodButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const yearsAttr = btn.getAttribute('data-years');
            const dateInput = document.getElementById('calc-date-input');
            if (!dateInput) return;
            
            if (yearsAttr === 'max') {
                dateInput.value = '2016-01-01';
            } else {
                const years = parseInt(yearsAttr) || 1;
                const d = new Date();
                d.setFullYear(d.getFullYear() - years);
                // format as YYYY-MM-DD
                const yyyy = d.getFullYear();
                const mm = String(d.getMonth() + 1).padStart(2, '0');
                const dd = String(d.getDate()).padStart(2, '0');
                dateInput.value = `${yyyy}-${mm}-${dd}`;
            }
        });
    });
    
    if (runBtn) {
        runBtn.addEventListener('click', async () => {
            if (!activeStockProfile) return;
            const symbol = activeStockProfile.ticker;
            const amount = parseFloat(amountInput.value) || 100000;
            const date = document.getElementById('calc-date-input').value || '2021-01-01';
            
            const amountVal = (selectedReturnCalcType === 'cagr') ? amount : 0;
            const sipVal = (selectedReturnCalcType === 'sip') ? amount : 0;
            
            try {
                runBtn.innerText = 'Calculating...';
                const response = await fetch(`/api/returns?symbol=${encodeURIComponent(symbol)}&amount=${amountVal}&date_y=${date}&type=${selectedReturnCalcType}&sip_monthly=${sipVal}`);
                if (!response.ok) throw new Error("Calculation failed");
                const data = await response.json();
                
                document.getElementById('calc-results-box').style.display = 'grid';
                document.getElementById('calc-res-invested').innerText = `₹${data.invested_amount.toLocaleString('en-IN', {maximumFractionDigits:0})}`;
                document.getElementById('calc-res-value').innerText = `₹${data.final_value.toLocaleString('en-IN', {maximumFractionDigits:0})}`;
                
                const profitTextEl = document.getElementById('calc-res-profit');
                profitTextEl.innerText = `₹${data.profit_loss.toLocaleString('en-IN', {maximumFractionDigits:0})} (${data.absolute_return_pct >= 0 ? '+' : ''}${data.absolute_return_pct}%)`;
                profitTextEl.className = data.profit_loss >= 0 ? 'green-text' : 'red-text';
                
                const annualizedEl = document.getElementById('calc-res-annualized');
                annualizedEl.innerText = `${data.annualized_return_pct}% p.a.`;
                annualizedEl.className = data.annualized_return_pct >= 0 ? 'green-text' : 'red-text';
                
                const multiplier = data.final_value / (data.invested_amount || 1);
                const multiplierEl = document.getElementById('calc-capital-multiplier');
                if (multiplierEl) {
                    multiplierEl.innerText = `${multiplier.toFixed(1)}x Mult`;
                    multiplierEl.style.display = 'inline-block';
                }
                
                // Dynamic AI Summary
                const summaryBlock = document.getElementById('calc-summary-block');
                const summaryText = document.getElementById('calc-summary-text');
                if (summaryBlock && summaryText) {
                    summaryBlock.style.display = 'block';
                    
                    if (selectedReturnCalcType === 'cagr') {
                        summaryText.innerHTML = `🛡️ **Institutional Synopsis:** A lump sum of **₹${data.invested_amount.toLocaleString('en-IN')}** invested on **${data.start_date}** grew by **${multiplier.toFixed(1)}x** to **₹${data.final_value.toLocaleString('en-IN')}**, generating an annualized CAGR of **${data.annualized_return_pct}%**. This absolute gain of **₹${data.profit_loss.toLocaleString('en-IN')}** significantly outperforms average historical fixed deposit (FD) benchmarks (6-7% p.a.).`;
                    } else {
                        summaryText.innerHTML = `🛡️ **Institutional Synopsis:** Committing a monthly SIP of **₹${data.monthly_sip.toLocaleString('en-IN')}** starting **${data.start_date}** accumulated a principal of **₹${data.invested_amount.toLocaleString('en-IN')}**. This systematic cost-averaging grew your capital to **₹${data.final_value.toLocaleString('en-IN')}** (**${multiplier.toFixed(1)}x** multiplier), delivering an annualized IRR of **${data.annualized_return_pct}%**.`;
                    }
                }
            } catch (e) {
                showToast("Return calculator error: " + e.message, "error");
            } finally {
                runBtn.innerText = 'Calculate Returns';
            }
        });
    }
}


// 7b. Equity Research Terminal Sub-Tabs Controller
function setupAnalyzerSubtabs() {
    const subtabButtons = document.querySelectorAll('.subtab-btn');
    if (subtabButtons.length === 0) return;

    const container = document.querySelector('.analyzer-subtabs');
    const prevBtn = document.querySelector('.subtabs-scroll-container .prev-btn');
    const nextBtn = document.querySelector('.subtabs-scroll-container .next-btn');

    function updateNavButtons() {
        if (!container || !prevBtn || !nextBtn) return;
        const scrollLeft = container.scrollLeft;
        const maxScroll = container.scrollWidth - container.clientWidth;

        // Show prev button if we have scrolled right at all
        if (scrollLeft > 2) {
            prevBtn.classList.remove('hidden');
        } else {
            prevBtn.classList.add('hidden');
        }

        // Show next button if we have more room to scroll right
        if (scrollLeft < maxScroll - 2) {
            nextBtn.classList.remove('hidden');
        } else {
            nextBtn.classList.add('hidden');
        }
    }

    if (container) {
        container.addEventListener('scroll', updateNavButtons);
        window.addEventListener('resize', updateNavButtons);
        // Initial check
        setTimeout(updateNavButtons, 150);
    }

    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            container.scrollBy({ left: -200, behavior: 'smooth' });
        });
    }

    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            container.scrollBy({ left: 200, behavior: 'smooth' });
        });
    }

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

            // Toggle visibility of all cards within the dashboard-grid container
            const cards = document.querySelectorAll('.dashboard-grid > .card');
            cards.forEach(card => {
                const subtabAttr = card.getAttribute('data-subtab');
                // Show card if it matches the selected subtab, otherwise hide it
                if (subtabAttr === activeSubtab) {
                    card.classList.remove('card-hidden');
                } else {
                    card.classList.add('card-hidden');
                }
            });

            // Trigger window resize to force Chart.js to scale correctly to newly visible grids
            setTimeout(() => {
                window.dispatchEvent(new Event('resize'));
                updateNavButtons();
            }, 50);
        });
    });

    // Run tab filter whenever a new stock is successfully loaded in workspace
    window.resetAnalyzerSubtabs = () => {
        const firstBtn = document.querySelector('.subtab-btn[data-subtab="summary"]');
        if (firstBtn) {
            firstBtn.click();
        }
        setTimeout(updateNavButtons, 200);
    };
}


// 8. AI Portfolio Doctor Controller
function setupPortfolioDoctor() {
    // Acquisition Ledger collapsible toggle
    const ledgerToggle = document.getElementById('portfolio-ledger-toggle');
    const ledgerContent = document.getElementById('portfolio-ledger-content');
    if (ledgerToggle && ledgerContent) {
        ledgerToggle.addEventListener('click', () => {
            const isCollapsed = ledgerContent.style.display === 'none';
            if (isCollapsed) {
                ledgerContent.style.display = 'block';
                ledgerToggle.classList.remove('collapsed');
            } else {
                ledgerContent.style.display = 'none';
                ledgerToggle.classList.add('collapsed');
            }
        });
    }

    const runBtn = document.getElementById('run-portfolio-doctor-btn');
    if (runBtn) {
        runBtn.addEventListener('click', () => {
            runPortfolioDoctorAnalysis();
        });
    }
    
    // Wire loadPortfolioDoctorLedger when switching to the new standalone portfolio tab
    const portfolioBtn = document.getElementById('tab-portfolio-btn');
    if (portfolioBtn) {
        portfolioBtn.addEventListener('click', () => {
            setTimeout(() => loadPortfolioDoctorLedger(true), 100);
        });
    }



    // Implement Premium Print Portfolio Diagnostics Report PDF Exporter
    const printPortfolioBtn = document.getElementById('print-portfolio-report-btn');
    if (printPortfolioBtn) {
        printPortfolioBtn.addEventListener('click', () => {
            const prescriptionContent = document.getElementById('portfolio-prescription-content')?.innerHTML;
            if (!prescriptionContent || prescriptionContent.trim() === '' || prescriptionContent.includes('Diagnostic text loaded here')) {
                showToast("Please run the Portfolio Health Analysis before printing.", "warning");
                return;
            }

            const totalInvestment = document.getElementById('port-total-investment')?.innerText || 'N/A';
            const totalValue = document.getElementById('port-total-value')?.innerText || 'N/A';
            const totalPL = document.getElementById('port-total-pl')?.innerText || 'N/A';
            const healthScore = document.getElementById('port-health-score')?.innerText || 'N/A';
            const concentrationLabel = document.getElementById('port-concentration-label')?.innerText || 'N/A';

            // Gather ledger rows
            const ledgerRows = [];
            const rows = document.querySelectorAll('#portfolio-ledger-body tr:not(.targets-detail-row)');
            rows.forEach(row => {
                const stockNameText = row.querySelector('td:nth-child(1)')?.innerText || '';
                const parts = stockNameText.split('\n');
                const symbol = parts[0] || 'N/A';
                const name = parts[1] || '';
                const sector = row.querySelector('td:nth-child(2)')?.innerText || 'N/A';
                const qtyInput = row.querySelector('.portfolio-qty-input');
                const qty = qtyInput ? qtyInput.value : '0';
                const priceInput = row.querySelector('.portfolio-price-input');
                const price = priceInput ? priceInput.value : '0';
                ledgerRows.push({ symbol, name, sector, qty, price });
            });



            const today = new Date().toLocaleDateString('en-IN', {
                day: '2-digit',
                month: 'long',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });

            let ledgerTableRowsHTML = '';
            ledgerRows.forEach(item => {
                ledgerTableRowsHTML += `
                    <tr>
                        <td style="padding: 8px; border-bottom: 1px solid #e5e7eb;"><strong>${item.symbol}</strong><br><span style="font-size: 8pt; color: #6b7280;">${item.name}</span></td>
                        <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; color: #374151;">${item.sector}</td>
                        <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; text-align: center; color: #111827;">${item.qty}</td>
                        <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; text-align: right; color: #111827;">₹${parseFloat(item.price).toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                        <td style="padding: 8px; border-bottom: 1px solid #e5e7eb; text-align: right; font-weight: 700; color: #111827;">₹${(parseFloat(item.qty) * parseFloat(item.price)).toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2})}</td>
                    </tr>
                `;
            });

            const scoreNum = parseInt(healthScore.split('/')[0]) || 50;
            const healthColorClass = scoreNum >= 70 ? 'highlight-green' : (scoreNum >= 45 ? 'highlight-amber' : 'highlight-red');
            const healthBadgeClass = scoreNum >= 70 ? 'badge-green' : (scoreNum >= 45 ? 'badge-amber' : 'badge-red');

            const printContent = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>AI Portfolio Diagnostics Audit Report</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Outfit:wght@400;600;700;800&display=swap');
        
        @page {
            size: A4;
            margin: 20mm 15mm 20mm 15mm;
        }
        
        body {
            font-family: 'Inter', sans-serif;
            color: #111827;
            background: #ffffff;
            margin: 0;
            padding: 0;
            font-size: 11pt;
            line-height: 1.5;
            -webkit-print-color-adjust: exact;
            print-color-adjust: exact;
        }

        .header {
            border-bottom: 2px solid #10b981;
            padding-bottom: 12px;
            margin-bottom: 20px;
        }

        .header-top {
            display: flex;
            justify-content: space-between;
            align-items: flex-end;
        }

        .brand {
            font-family: 'Outfit', sans-serif;
            font-size: 14pt;
            font-weight: 800;
            color: #047857;
            letter-spacing: 0.05em;
            text-transform: uppercase;
        }

        .doc-type {
            font-size: 9pt;
            font-weight: 600;
            color: #6b7280;
            text-transform: uppercase;
            letter-spacing: 0.1em;
        }

        .report-title-row {
            margin-top: 15px;
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
        }

        .report-name {
            font-family: 'Outfit', sans-serif;
            font-size: 20pt;
            font-weight: 800;
            color: #111827;
            margin: 0;
            line-height: 1.2;
        }

        .meta-grid {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 12px;
            background: #f9fafb;
            border: 1px solid #e5e7eb;
            border-radius: 6px;
            padding: 12px;
            margin-bottom: 20px;
        }

        .meta-item {
            display: flex;
            flex-direction: column;
        }

        .meta-label {
            font-size: 8pt;
            text-transform: uppercase;
            color: #6b7280;
            font-weight: 600;
            letter-spacing: 0.05em;
            margin-bottom: 2px;
        }

        .meta-value {
            font-size: 10pt;
            font-weight: 700;
            color: #1f2937;
        }

        .metrics-bar {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 12px;
            margin-bottom: 25px;
        }

        .metric-card {
            border: 1px solid #e5e7eb;
            border-radius: 6px;
            padding: 10px;
            text-align: center;
            background: #ffffff;
            box-shadow: 0 1px 2px rgba(0,0,0,0.02);
        }

        .metric-card.highlight-green {
            border-color: #10b981;
            background: #f0fdf4;
            border-left: 4px solid #10b981;
        }

        .metric-card.highlight-amber {
            border-color: #f59e0b;
            background: #fffdf5;
            border-left: 4px solid #f59e0b;
        }

        .metric-card.highlight-red {
            border-color: #ef4444;
            background: #fdf2f2;
            border-left: 4px solid #ef4444;
        }

        .metric-score-large {
            font-family: 'Outfit', sans-serif;
            font-size: 22pt;
            font-weight: 800;
            color: #047857;
            line-height: 1.1;
        }

        .metric-badge {
            font-family: 'Outfit', sans-serif;
            font-size: 11pt;
            font-weight: 700;
            padding: 4px 8px;
            border-radius: 4px;
            display: inline-block;
            margin-top: 4px;
        }

        .badge-green {
            background: #10b981;
            color: #ffffff;
        }

        .badge-amber {
            background: #f59e0b;
            color: #ffffff;
        }

        .badge-red {
            background: #ef4444;
            color: #ffffff;
        }

        .section-title {
            font-family: 'Outfit', sans-serif;
            font-size: 12pt;
            font-weight: 700;
            color: #047857;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            border-bottom: 1px solid #e5e7eb;
            padding-bottom: 5px;
            margin-top: 25px;
            margin-bottom: 12px;
            page-break-after: avoid;
        }

        .ledger-table {
            width: 100%;
            border-collapse: collapse;
            font-size: 9.5pt;
            margin-bottom: 25px;
        }

        .ledger-table th {
            background: #f3f4f6;
            color: #4b5563;
            font-weight: 600;
            text-transform: uppercase;
            font-size: 8pt;
            letter-spacing: 0.05em;
            padding: 8px;
            border-bottom: 2px solid #e5e7eb;
        }

        .prescription-content {
            font-size: 10.5pt;
            line-height: 1.6;
            color: #374151;
            text-align: justify;
        }

        .prescription-content h2, .prescription-content h3, .prescription-content h4 {
            font-family: 'Outfit', sans-serif;
            color: #111827;
            page-break-after: avoid;
        }

        .prescription-content h2 {
            font-size: 13pt;
            border-bottom: 1px solid #e5e7eb;
            padding-bottom: 4px;
            margin-top: 22px;
        }

        .prescription-content h3 {
            font-size: 11.5pt;
            margin-top: 18px;
        }

        .prescription-content blockquote {
            border-left: 3px solid #f59e0b;
            padding: 8px 12px;
            margin: 12px 0;
            background: #fffdf5;
            color: #111827;
            font-style: italic;
        }

        .footer {
            margin-top: 40px;
            border-top: 1px solid #e5e7eb;
            padding-top: 10px;
            font-size: 8pt;
            color: #9ca3af;
            text-align: center;
            display: flex;
            justify-content: space-between;
            page-break-inside: avoid;
        }

        @media print {
            body {
                background: none;
                color: #000000;
            }
            .no-print {
                display: none;
            }
            .metric-card {
                box-shadow: none !important;
            }
        }
    </style>
</head>
<body>
    <div class="header">
        <div class="header-top">
            <span class="brand">Apex Agentic AI Workstation</span>
            <span class="doc-type">Portfolio Health Audit</span>
        </div>
        <div class="report-title-row">
            <div>
                <span class="report-name">AI Portfolio Diagnostics Report</span>
            </div>
            <div style="text-align: right;">
                <div style="font-size: 8pt; color: #6b7280; font-weight: 600; text-transform: uppercase;">Generated Date</div>
                <div style="font-size: 11pt; font-weight: 700; color: #111827;">${today}</div>
            </div>
        </div>
    </div>

    <div class="meta-grid">
        <div class="meta-item">
            <span class="meta-label">Audit Engine</span>
            <span class="meta-value">AI Portfolio Doctor</span>
        </div>
        <div class="meta-item">
            <span class="meta-label">Diversification</span>
            <span class="meta-value">${concentrationLabel}</span>
        </div>
        <div class="meta-item">
            <span class="meta-label">Total Assets</span>
            <span class="meta-value">${ledgerRows.length} Stocks</span>
        </div>
        <div class="meta-item">
            <span class="meta-label">Status</span>
            <span class="meta-value" style="color: #059669;">SEBI-Compliant Math</span>
        </div>
    </div>

    <div class="metrics-bar">
        <div class="metric-card ${healthColorClass}">
            <div class="meta-label">Diagnostics Health Score</div>
            <div class="metric-score-large" style="margin-top: 4px; color: ${scoreNum >= 70 ? '#059669' : (scoreNum >= 45 ? '#d97706' : '#dc2626')};">${healthScore}</div>
        </div>

        <div class="metric-card">
            <div class="meta-label">Total Capital Committed</div>
            <div style="font-size: 13pt; font-weight: 800; margin-top: 8px; color: #111827;">${totalInvestment}</div>
        </div>

        <div class="metric-card">
            <div class="meta-label">Current Market Valuation</div>
            <div style="font-size: 13pt; font-weight: 800; margin-top: 8px; color: #111827;">${totalValue}</div>
        </div>
        
        <div class="metric-card">
            <div class="meta-label">Unrealized Net P&L</div>
            <div style="font-size: 13pt; font-weight: 800; margin-top: 8px; color: ${totalPL.includes('-') ? '#dc2626' : '#059669'};">${totalPL}</div>
        </div>
    </div>

    <div class="section-title">I. Portfolio Holdings & Capital Allocation Ledger</div>
    <table class="ledger-table">
        <thead>
            <tr>
                <th style="text-align: left;">Stock Details</th>
                <th style="text-align: left;">Sector</th>
                <th style="text-align: center;">Qty Held</th>
                <th style="text-align: right;">Avg Cost (₹)</th>
                <th style="text-align: right;">Total Investment (₹)</th>
            </tr>
        </thead>
        <tbody>
            ${ledgerTableRowsHTML}
        </tbody>
    </table>

    <div class="section-title" style="page-break-before: auto;">II. Quantitative Diagnostics & Doctor's Prescription</div>
    <div class="prescription-content">
        ${prescriptionContent}
    </div>

    <div class="footer">
        <span>Confidential - SEBI Quantitative Disclosures Apply</span>
        <span>© ${new Date().getFullYear()} Apex Agentic Systems</span>
        <span>Page 1 of 1</span>
    </div>

    <script>
        window.addEventListener('DOMContentLoaded', () => {
            setTimeout(() => {
                window.print();
                window.close();
            }, 500);
        });
    </script>
</body>
</html>
            `;

            executeSystemPrint(printContent, 'width=850,height=900');
        });
    }
}



async function loadPortfolioDoctorLedger(forceRefresh = false) {
    const ledgerBody = document.getElementById('portfolio-ledger-body');
    const emptyState = document.getElementById('portfolio-doctor-empty-state');
    const inputsGrid = document.getElementById('portfolio-inputs-grid');
    const runBtn = document.getElementById('run-portfolio-doctor-btn');
    const prescriptionBox = document.getElementById('portfolio-doctor-prescription-box');
    const stockSelect = document.getElementById('portfolio-watchlist-stock-select');
    
    if (!ledgerBody) return;
    
    if (prescriptionBox) prescriptionBox.style.display = 'none';
    
    // Set UI to loading/syncing state
    if (inputsGrid) inputsGrid.style.display = 'grid';
    if (emptyState) emptyState.style.display = 'none';
    if (runBtn) runBtn.style.display = 'none';
    
    ledgerBody.innerHTML = `
        <tr>
            <td colspan="14" class="center-text" style="padding: 50px; text-align: center; color: var(--text-secondary);">
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 12px;">
                    <span style="font-size: 26px; animation: spin 2s linear infinite; display: inline-block; color: var(--neon-blue);">🔄</span>
                    <span style="font-weight: 600; letter-spacing: 0.02em;">Syncing Portfolio Tranches & Market Prices...</span>
                    <span style="font-size: 10.5px; color: var(--text-muted); max-width: 380px;">Querying yfinance feeds, refreshing technical trends, and calculating real-time margins of safety.</span>
                </div>
            </td>
        </tr>
    `;
    
    const setDiagLoading = (id, text = 'Loading...') => {
        const el = document.getElementById(id);
        if (el) el.innerText = text;
    };
    setDiagLoading('port-total-investment');
    setDiagLoading('port-total-value');
    setDiagLoading('port-total-pl');
    setDiagLoading('port-day-pl');
    setDiagLoading('port-health-score', '--/100');
    setDiagLoading('port-concentration-label', 'Calculating...');
    
    try {
        // 1. Fetch portfolio items (optionally forcing yfinance refresh)
        const url = forceRefresh ? '/api/portfolio?refresh=true' : '/api/portfolio';
        const response = await fetch(url);
        if (!response.ok) throw new Error("Failed to load portfolio.");
        const portfolioItems = await response.json();
        
        // 2. Fetch watchlist stocks not in portfolio
        const wlResponse = await fetch('/api/portfolio/watchlist-stocks');
        let nonPortfolioItems = [];
        if (wlResponse.ok) {
            nonPortfolioItems = await wlResponse.json();
        }
        
        // 3. Toggle Empty State vs Grid view
        if (portfolioItems.length === 0 && nonPortfolioItems.length === 0) {
            // Keep grid visible so they can add custom, but hide run button and empty state
            if (emptyState) emptyState.style.display = 'block';
            if (inputsGrid) inputsGrid.style.display = 'grid';
            if (runBtn) runBtn.style.display = 'none';
        } else {
            if (emptyState) emptyState.style.display = 'none';
            if (inputsGrid) inputsGrid.style.display = 'grid';
        }
        
        // 4. Populate the watchlist stock select dropdown
        if (stockSelect) {
            stockSelect.innerHTML = '<option value="" disabled selected>Choose from Watchlist</option>';
            if (nonPortfolioItems.length === 0) {
                stockSelect.innerHTML += '<option value="" disabled>All watchlist stocks added</option>';
            } else {
                nonPortfolioItems.forEach(item => {
                    stockSelect.innerHTML += `<option value="${item.symbol}">${item.symbol} - ${item.name}</option>`;
                });
            }
        }
        
        // 5. Render portfolio holdings in table
        ledgerBody.innerHTML = '';
        
        if (portfolioItems.length === 0) {
            if (runBtn) runBtn.style.display = 'none';
            
            // Reset portfolio diagnostics summary to 0 on empty
            document.getElementById('port-total-investment').innerText = '₹0.00';
            document.getElementById('port-total-value').innerText = '₹0.00';
            const plTextEl = document.getElementById('port-total-pl');
            if (plTextEl) {
                plTextEl.innerText = '₹0.00';
                plTextEl.style.color = 'var(--text-primary)';
            }
            const dayPLTextEl = document.getElementById('port-day-pl');
            if (dayPLTextEl) {
                dayPLTextEl.innerText = '₹0.00';
                dayPLTextEl.style.color = 'var(--text-primary)';
            }
            const healthEl = document.getElementById('port-health-score');
            if (healthEl) {
                healthEl.innerText = '--/100';
                healthEl.style.color = 'var(--text-secondary)';
            }
            const concEl = document.getElementById('port-concentration-label');
            if (concEl) {
                concEl.innerText = 'N/A';
                concEl.style.color = 'var(--text-secondary)';
            }
            
            ledgerBody.innerHTML = '<tr><td colspan="14" class="center-text text-muted" style="padding: 30px;">No stocks in your portfolio diagnostics ledger. Add them from watchlists or type custom symbols above.</td></tr>';
            return;
        }
        
        if (runBtn) runBtn.style.display = 'block';
        
        let totalInvestment = 0.0;
        let totalValue = 0.0;
        let totalDayPL = 0.0;
        
        portfolioItems.forEach(item => {
            const qty = item.quantity || 0;
            const avgPrice = item.purchase_price || 0;
            const currentPrice = item.current_price || avgPrice || 0;
            const dayChangePct = item.day_change_pct || 0.0;
            
            const investedVal = qty * avgPrice;
            const currentVal = qty * currentPrice;
            const dayPL = qty * (currentPrice - (currentPrice / (1 + dayChangePct / 100)));
            
            totalInvestment += investedVal;
            totalValue += currentVal;
            totalDayPL += dayPL;
        });

        // Group tranches by symbol for rendering in Standalone Acquisition Ledger
        const aggregatedItemsMap = {};
        portfolioItems.forEach(item => {
            const sym = item.symbol;
            if (!aggregatedItemsMap[sym]) {
                aggregatedItemsMap[sym] = {
                    ...item,
                    quantity: 0,
                    total_invested_cost: 0,
                    tranche_ids: []
                };
            }
            const agg = aggregatedItemsMap[sym];
            agg.quantity += item.quantity || 0;
            agg.total_invested_cost += (item.quantity || 0) * (item.purchase_price || 0);
            agg.tranche_ids.push(item.id);
        });

        const aggregatedItems = Object.values(aggregatedItemsMap).map(agg => {
            if (agg.quantity > 0) {
                agg.purchase_price = agg.total_invested_cost / agg.quantity;
            } else {
                agg.purchase_price = 0;
            }
            return agg;
        });
        
        aggregatedItems.forEach(item => {
            const tr = document.createElement('tr');
            tr.style.borderBottom = '1px solid var(--border-glass)';
            
            const isMultiTranche = item.tranche_ids.length > 1;
            
            // Dynamic value calculations
            const qty = item.quantity || 0;
            const avgPrice = item.purchase_price || 0;
            
            tr.setAttribute('data-symbol', item.symbol);
            tr.setAttribute('data-qty', qty);
            tr.setAttribute('data-price', avgPrice);
            
            const currentPrice = item.current_price || avgPrice || 0;
            const dayChangePct = item.day_change_pct || 0.0;
            
            const investedVal = qty * avgPrice;
            const currentVal = qty * currentPrice;
            const plVal = currentVal - investedVal;
            const plPct = investedVal > 0 ? (plVal / investedVal) * 100 : 0.0;
            
            const plColor = plVal >= 0 ? 'var(--neon-green)' : 'var(--neon-red)';
            const plSign = plVal >= 0 ? '+' : '';
            
            const netChgPct = plPct;
            const netChgColor = netChgPct >= 0 ? 'var(--neon-green)' : 'var(--neon-red)';
            const netChgSign = netChgPct >= 0 ? '+' : '';
            
            const dayChgColor = dayChangePct >= 0 ? 'var(--neon-green)' : 'var(--neon-red)';
            const dayChgSign = dayChangePct >= 0 ? '+' : '';
            
            const target12M = item.target_12m ? safeFormatRupees(item.target_12m, 0) : 'Rs. --';
            const stopLoss12M = item.stop_loss_12m ? safeFormatRupees(item.stop_loss_12m, 0) : 'Rs. --';
            
            let qtyHTML = '';
            let priceHTML = '';
            if (isMultiTranche) {
                qtyHTML = `<span style="font-weight: 600; color: var(--text-secondary);" title="Aggregated from multiple tranches (Edit in Tax tab)">${safeFormatNumber(qty, 3)} 🔗</span>`;
                priceHTML = `<span style="font-weight: 600; color: var(--text-secondary);" title="Weighted Average Price">${safeFormatRupees(avgPrice, 2)}</span>`;
            } else {
                qtyHTML = `<input type="number" class="portfolio-qty-input" data-id="${item.id}" data-symbol="${item.symbol}" value="${qty}" style="width: 70px; padding: 4px; border-radius:4px; background:rgba(0,0,0,0.3); border:1px solid var(--border-glass); color:#fff; font-size:11px; text-align: right;">`;
                priceHTML = `<input type="number" class="portfolio-price-input" data-id="${item.id}" data-symbol="${item.symbol}" value="${avgPrice}" style="width: 90px; padding: 4px; border-radius:4px; background:rgba(0,0,0,0.3); border:1px solid var(--border-glass); color:#fff; font-size:11px; text-align: right;">`;
            }
            
            tr.innerHTML = `
                <td style="padding: 10px;">
                    <a href="#" class="ledger-stock-analyze-link" data-symbol="${item.symbol}" style="font-weight: 700; color: var(--color-primary); text-decoration: underline; cursor: pointer;" title="Open in Equity Research Terminal">${item.symbol}</a><br>
                    <span style="font-size:10px; color:var(--text-muted);">${item.name}</span><br>
                    <span style="font-size:9.5px; color:var(--color-primary); font-weight:600;">${item.sector || 'Other'}</span>
                </td>
                <td style="padding: 10px; text-align: right;">
                    ${qtyHTML}
                </td>
                <td style="padding: 10px; text-align: right;">
                    ${priceHTML}
                </td>
                <td style="padding: 10px; text-align: right; font-weight: 600; color: var(--text-primary);">
                    ${safeFormatRupees(currentPrice, 2)}
                </td>
                <td style="padding: 10px; text-align: right; font-weight: 700; color: ${netChgColor};">
                    ${netChgSign}${netChgPct.toFixed(2)}%
                </td>
                <td style="padding: 10px; text-align: right; font-weight: 700; color: ${dayChgColor};">
                    ${dayChgSign}${dayChangePct.toFixed(2)}%
                </td>
                <td style="padding: 10px; text-align: right; color: var(--text-secondary);">
                    ${safeFormatRupees(investedVal, 2)}
                </td>
                <td style="padding: 10px; text-align: right; font-weight: 600; color: var(--text-primary);">
                    ${safeFormatRupees(currentVal, 2)}
                </td>
                <td style="padding: 10px; text-align: right; font-weight: 700; color: ${plColor};">
                    ${plSign}${safeFormatRupees(plVal, 2)}<br>
                    <span style="font-size: 10px; color: ${plColor};">${plSign}${plPct.toFixed(2)}%</span>
                </td>
                <td style="padding: 10px; text-align: right; color: var(--neon-green); font-weight: 600;">
                    ${item.suggested_buy_price_range || 'N/A'}
                </td>
                <td style="padding: 10px; text-align: right; color: var(--neon-red); font-weight: 600;">
                    ${item.suggested_sell_price_range || 'N/A'}
                </td>
                <td style="padding: 10px; text-align: right; color: var(--neon-green); font-weight: 600;">
                    ${target12M}
                </td>
                <td style="padding: 10px; text-align: right; color: var(--neon-red); font-weight: 600;">
                    ${stopLoss12M}
                </td>
                <td class="no-print" style="padding: 10px; text-align: center;">
                    <button class="btn-secondary remove-portfolio-ledger-item-btn" data-id="${item.id}" data-symbol="${item.symbol}" style="font-size: 11px; padding: 4px 8px; border-color: rgba(239,68,68,0.25); color: var(--color-crimson); background: rgba(239,68,68,0.03); cursor:pointer; font-weight: 600; border-radius: 4px; transition: all 0.2s;">Remove 🗑️</button>
                </td>
            `;
            
            // Wire Research Link
            tr.querySelector('.ledger-stock-analyze-link').addEventListener('click', (e) => {
                e.preventDefault();
                const sym = e.currentTarget.getAttribute('data-symbol');
                const searchInput = document.getElementById('analyzer-search-input');
                if (searchInput) {
                    searchInput.value = sym;
                }
                switchTab('analyzer');
                loadStockAnalyzer(sym);
            });
            
            // Wire edit listeners if NOT multi-tranche
            if (!isMultiTranche) {
                const qtyInput = tr.querySelector('.portfolio-qty-input');
                const priceInput = tr.querySelector('.portfolio-price-input');
                
                const saveHoldings = async () => {
                    const qtyVal = parseFloat(qtyInput.value) || 0.0;
                    const priceVal = parseFloat(priceInput.value) || 0.0;
                    
                    try {
                        await fetch(`/api/portfolio/${item.id}`, {
                            method: 'PUT',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ quantity: qtyVal, purchase_price: priceVal })
                        });
                        await loadTaxHarvestingPanel();
                        await loadPortfolioDoctorLedger(false);
                    } catch (err) {
                        console.error("Error saving portfolio holdings:", err);
                    }
                };
                
                qtyInput.addEventListener('change', saveHoldings);
                qtyInput.addEventListener('blur', saveHoldings);
                priceInput.addEventListener('change', saveHoldings);
                priceInput.addEventListener('blur', saveHoldings);
            }
            
            // Wire remove button to delete by symbol
            tr.querySelector('.remove-portfolio-ledger-item-btn').addEventListener('click', async () => {
                const confirmMsg = isMultiTranche 
                    ? `Remove all tranches of ${item.symbol} from your active diagnostics portfolio?`
                    : `Remove ${item.symbol} from your active portfolio diagnostics ledger?`;
                if (!confirm(confirmMsg)) return;
                if (!confirm(`CONFIRM REMOVAL: Are you absolutely sure?`)) return;
                
                try {
                    await fetch(`/api/portfolio/${item.symbol}`, {
                        method: 'DELETE'
                    });
                    showToast(`Removed ${item.symbol} from your portfolio diagnostics ledger.`, "success");
                    await loadPortfolioDoctorLedger(false);
                    await loadTaxHarvestingPanel();
                } catch (err) {
                    console.error("Error removing stock from ledger:", err);
                }
            });
            
            ledgerBody.appendChild(tr);
        });
        
        // 6. Update Vital Diagnostics summary cards with precalculated totals
        document.getElementById('port-total-investment').innerText = `₹${totalInvestment.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits:2})}`;
        document.getElementById('port-total-value').innerText = `₹${totalValue.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits:2})}`;
        
        const netPL = totalValue - totalInvestment;
        const netPLPct = totalInvestment > 0 ? (netPL / totalInvestment) * 100 : 0.0;
        const netPLColor = netPL >= 0 ? 'var(--neon-green)' : 'var(--neon-red)';
        const netPLSign = netPL >= 0 ? '+' : '';
        const plTextEl = document.getElementById('port-total-pl');
        if (plTextEl) {
            plTextEl.innerText = `₹${netPL.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits:2})} (${netPLSign}${netPLPct.toFixed(2)}%)`;
            plTextEl.style.color = netPLColor;
        }
        
        const dayPLPct = (totalValue - totalDayPL) > 0 ? (totalDayPL / (totalValue - totalDayPL)) * 100 : 0.0;
        const dayPLSign = totalDayPL >= 0 ? '+' : '';
        const dayPLColor = totalDayPL >= 0 ? 'var(--neon-green)' : 'var(--neon-red)';
        const dayPLTextEl = document.getElementById('port-day-pl');
        if (dayPLTextEl) {
            dayPLTextEl.innerText = `₹${totalDayPL.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits:2})} (${dayPLSign}${dayPLPct.toFixed(2)}%)`;
            dayPLTextEl.style.color = dayPLColor;
        }

        // Instant local calculations for Vital Diagnostics (Health Score & Concentration)
        let localWeightedScoreSum = 0.0;
        let localSectorExposure = {};
        portfolioItems.forEach(item => {
            const qty = item.quantity || 0;
            const currentPrice = item.current_price || item.purchase_price || 0;
            const score = item.score !== undefined ? item.score : 50;
            const sector = item.sector || 'Other';
            const currentVal = qty * currentPrice;
            
            localWeightedScoreSum += score * currentVal;
            localSectorExposure[sector] = (localSectorExposure[sector] || 0.0) + currentVal;
        });

        let localPortfolioScore = 50;
        let localHhi = 0.0;
        if (totalValue > 0) {
            localPortfolioScore = Math.round(localWeightedScoreSum / totalValue);
            for (const sector in localSectorExposure) {
                const pct = (localSectorExposure[sector] / totalValue) * 100.0;
                localHhi += Math.pow(pct / 100.0, 2);
            }
        }

        let localDivBonus = 5;
        let localConcentrationLabel = "Well Diversified";
        if (localHhi > 0.4) {
            localConcentrationLabel = "Highly Concentrated (Undiversified)";
            localDivBonus = -15;
        } else if (localHhi > 0.25) {
            localConcentrationLabel = "Moderately Concentrated";
            localDivBonus = -5;
        }
        const localHealthScore = Math.max(10, Math.min(100, localPortfolioScore + localDivBonus));

        const healthEl = document.getElementById('port-health-score');
        if (healthEl) {
            healthEl.innerText = `${localHealthScore}/100`;
            if (localHealthScore >= 70) healthEl.style.color = 'var(--neon-green)';
            else if (localHealthScore >= 45) healthEl.style.color = 'var(--color-amber)';
            else healthEl.style.color = 'var(--neon-red)';
        }

        const concEl = document.getElementById('port-concentration-label');
        if (concEl) {
            concEl.innerText = localConcentrationLabel;
            if (localConcentrationLabel.toLowerCase().includes('well')) {
                concEl.style.color = 'var(--color-emerald)';
            } else if (localConcentrationLabel.toLowerCase().includes('highly') || localConcentrationLabel.toLowerCase().includes('poor')) {
                concEl.style.color = 'var(--neon-red)';
            } else {
                concEl.style.color = 'var(--color-amber)';
            }
            concEl.style.fontWeight = '700';
        }

    } catch (e) {
        console.warn("Could not load portfolio ledger: ", e);
        if (emptyState) emptyState.style.display = 'block';
        if (inputsGrid) inputsGrid.style.display = 'none';
        if (runBtn) runBtn.style.display = 'none';
    }
}

async function runPortfolioDoctorAnalysis() {
    const runBtn = document.getElementById('run-portfolio-doctor-btn');
    if (!runBtn) return;
    
    const rows = document.querySelectorAll('#portfolio-ledger-body tr');
    
    const items = [];
    rows.forEach(tr => {
        const symbol = tr.getAttribute('data-symbol');
        if (!symbol) return;
        
        const qtyInput = tr.querySelector('.portfolio-qty-input');
        const priceInput = tr.querySelector('.portfolio-price-input');
        
        let qty = 0;
        let price = 0;
        
        if (qtyInput) {
            qty = parseFloat(qtyInput.value) || 0;
        } else {
            qty = parseFloat(tr.getAttribute('data-qty')) || 0;
        }
        
        if (priceInput) {
            price = parseFloat(priceInput.value) || 0;
        } else {
            price = parseFloat(tr.getAttribute('data-price')) || 0;
        }
        
        if (symbol && qty > 0) {
            items.push({ symbol, quantity: qty, buy_price: price });
        }
    });
    
    if (items.length === 0) {
        showToast("Please input quantities (>0) for at least one stock.", "warning");
        return;
    }
    
    try {
        runBtn.innerText = 'Analyzing Portfolio...';
        showLoader("Running AI Portfolio Diagnostics...", "Orchestrating mathematical diversification filters, measuring HHI sector indices, and formulating rebalancing rules...");
        
        const response = await fetch('/api/portfolio-doctor', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ items })
        });
        
        if (!response.ok) throw new Error("Portfolio Doctor request failed.");
        const data = await response.json();
        
        document.getElementById('port-total-investment').innerText = `₹${data.total_investment.toLocaleString('en-IN', {maximumFractionDigits:2})}`;
        document.getElementById('port-total-value').innerText = `₹${data.total_current_value.toLocaleString('en-IN', {maximumFractionDigits:2})}`;
        
        const plTextEl = document.getElementById('port-total-pl');
        plTextEl.innerText = `₹${data.total_profit_loss.toLocaleString('en-IN', {maximumFractionDigits:2})} (${data.total_profit_loss_pct >= 0 ? '+' : ''}${data.total_profit_loss_pct}%)`;
        plTextEl.className = data.total_profit_loss >= 0 ? 'green-text' : 'red-text';
        
        const healthEl = document.getElementById('port-health-score');
        healthEl.innerText = `${data.health_score}/100`;
        if (data.health_score >= 70) healthEl.style.color = 'var(--neon-green)';
        else if (data.health_score >= 45) healthEl.style.color = 'var(--color-amber)';
        else healthEl.style.color = 'var(--neon-red)';
        healthEl.style.textShadow = '0 0 10px rgba(16, 185, 129, 0.1)';
        
        const concEl = document.getElementById('port-concentration-label');
        concEl.innerText = data.concentration_label;
        if (data.concentration_label.toLowerCase().includes('well')) {
            concEl.style.color = 'var(--color-emerald)';
        } else if (data.concentration_label.toLowerCase().includes('highly') || data.concentration_label.toLowerCase().includes('poor')) {
            concEl.style.color = 'var(--neon-red)';
        } else {
            concEl.style.color = 'var(--color-amber)';
        }
        concEl.style.fontWeight = '700';
        
        const prescriptionBox = document.getElementById('portfolio-doctor-prescription-box');
        const prescriptionContent = document.getElementById('portfolio-prescription-content');
        
        if (prescriptionBox && prescriptionContent) {
            prescriptionBox.style.display = 'block';
            
            let mdText = data.prescription;
            
            let doctorHTML = `
            <div class="portfolio-prescription-card">
                <div class="prescription-header">
                    <div class="prescription-title">🩺 AI Structural Cardiology Audit</div>
                    <div class="prescription-badge">Vascular Diagnostics</div>
                </div>
                <p class="prescription-analogy-text">
                    Think of auditing a portfolio like a cardiologist running a high-precision cardiac stress test on an athlete. Each equity represents an essential valve or pathway inside the vascular system—some control blood flow efficiency (holding quantities and average buy prices) while others measure systemic pressure under heavy stress loads (sector concentrations & HHI indexes). Running a portfolio diagnostic allows the AI Doctor to locate single-point blockages (over-exposure to a single sector) and prescribe a targeted structural rebalancing regimen to keep your assets operating with maximum longevity and peak circulatory power.
                </p>
                <div class="prescription-health-box">
                    <span class="prescription-health-label">Systemic Composite Health Rating:</span>
                    <span class="prescription-health-value">
                        🩺 <strong>${data.health_score}/100</strong>
                        <span class="badge-rec rec-buy" style="font-size: 11px; padding: 2px 8px; border-radius: 4px; font-weight:700; ${data.health_score >= 70 ? 'background: rgba(16, 185, 129, 0.15); color: #10b981;' : (data.health_score >= 45 ? 'background: rgba(245, 158, 11, 0.15); color: #f59e0b;' : 'background: rgba(239, 68, 68, 0.15); color: #ef4444;')}">${data.health_score >= 70 ? 'STABLE' : (data.health_score >= 45 ? 'ADVISED' : 'CRITICAL')}</span>
                    </span>
                </div>
            </div>
            `;
            
            let html = doctorHTML + mdText
                .replace(/^# (.*$)/gim, '<h2 style="color:var(--neon-green); margin-top:20px; font-size:16px;">$1</h2>')
                .replace(/^## (.*$)/gim, '<h3 style="color:var(--text-primary); margin-top:15px; font-size:14px; border-bottom: 1px dashed var(--border-glass); padding-bottom:5px;">$1</h3>')
                .replace(/^### (.*$)/gim, '<h4 style="color:var(--text-secondary); margin-top:10px; font-size:12px;">$1</h4>')
                .replace(/^\> (.*$)/gim, '<blockquote style="border-left:3px solid var(--color-amber); padding-left:10px; margin:10px 0; color:var(--text-primary); background:rgba(245,158,11,0.05); padding:8px; border-radius:4px;">$1</blockquote>')
                .replace(/\*\*(.*?)\*\*/g, '<strong style="color:var(--text-primary);">$1</strong>')
                .replace(/\*(.*?)\*/g, '<em>$1</em>')
                .replace(/\n/g, '<br>');
                
            prescriptionContent.innerHTML = html;
        }
        
        showToast("Portfolio health report compiled successfully!", "success");
    } catch (e) {
        showToast("Doctor analysis failed: " + e.message, "error");
    } finally {
        hideLoader();
        runBtn.innerText = 'Analyze Portfolio Health';
    }
}

// 8b. Strategy Audit AI Matrix Summary Controller
function setupAuditSummary() {
    const summaryBtn = document.getElementById('run-audit-summary-btn');
    if (summaryBtn) {
        summaryBtn.addEventListener('click', async () => {
            if (!activeStockProfile) {
                showToast("No active stock profile loaded. Please search for a stock first.", "warning");
                return;
            }

            if (!activeAuditMatrixData || !activeAuditMatrixData.combinations || activeAuditMatrixData.combinations.length === 0) {
                showToast("Please wait for the Strategy Audit Matrix to finish loading.", "warning");
                return;
            }

            const summaryBox = document.getElementById('audit-summary-box');
            const summaryText = document.getElementById('audit-summary-text');
            if (!summaryBox || !summaryText) return;

            summaryBox.style.display = 'block';
            summaryText.innerHTML = `
                <div style="display: flex; align-items: center; justify-content: center; padding: 25px 10px; gap: 10px;">
                    <div class="spinner" style="width: 20px; height: 20px; border-width: 2.5px; border-color: rgba(16, 185, 129, 0.2); border-top-color: var(--neon-green);"></div>
                    <div style="font-size: 11px; color: var(--text-secondary); font-weight: 500;">Chief Equities Strategist is auditing 12 strategies...</div>
                </div>
            `;
            
            summaryBtn.disabled = true;
            summaryBtn.innerText = "Synthesizing...";

            try {
                const ticker = activeStockProfile.ticker;
                const styleNames = {
                    "all": "All Styles",
                    "value": "Value Style",
                    "growth": "Growth Style",
                    "contra": "Contra Style"
                };

                let promptText = `As a Senior Equities Strategist, analyze the following AI Strategical Audit & Gate Diagnostics Matrix results for ${activeStockProfile.company_name} (${ticker}). Benchmarked across 12 strategy combinations:\n`;
                
                activeAuditMatrixData.combinations.forEach(combo => {
                    const stratText = combo.strategy === "bottom_up" ? "Bottom-Up" : combo.strategy === "hybrid" ? "Hybrid" : "Top-Down";
                    const styleText = styleNames[combo.style] || combo.style;
                    promptText += `- ${stratText} + ${styleText}: ${combo.passed ? 'PASS' : 'FAIL'} (Score: ${combo.score}/100, Action: ${combo.action})\n`;
                });

                promptText += `\nProvide an executive operational audit brief in HTML style with the following exact headers styled cleanly:
<h4 style="color:#ffffff; margin-top:15px; font-size:12px;">🎯 Operational Champion Profile</h4>
Provide a synthesis of the absolute best-fit strategy.
<h4 style="color:#ffffff; margin-top:15px; font-size:12px;">⚠️ Core Gate Failures & Diagnostics</h4>
Analyze failing gates / deal-breakers across other setups and what operational risks they introduce.
<h4 style="color:#ffffff; margin-top:15px; font-size:12px;">💡 Strategic Allocation Verdict</h4>
Actionable fund manager mandate advice for capital commitment.
Keep the response professional, mathematically grounded, and extremely concise. Do not include introductory notes like "Here is the summary". Start directly with the Champion Profile.`;

                const payload = {
                    history: [],
                    message: promptText,
                    profile: activeStockProfile
                };

                const response = await fetch('/api/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                if (!response.ok) throw new Error("Synthesis failed.");
                const data = await response.json();

                const responseText = data.response || '';
                let html = responseText
                    .replace(/\*\*(.*?)\*\*/g, '<strong style="color:var(--text-primary);">$1</strong>')
                    .replace(/\*(.*?)\*/g, '<em>$1</em>')
                    .replace(/\n/g, '<br>');

                summaryText.innerHTML = html;
                summaryBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

            } catch (err) {
                console.error("Audit summary error:", err);
                summaryText.innerHTML = `<span class="red-text" style="font-size: 11px;">Failed to compile AI operational synthesis: ${err.message}. Please try again later.</span>`;
            } finally {
                summaryBtn.disabled = false;
                summaryBtn.innerText = "Generate AI Matrix Summary";
            }
        });
    }

    // Hide summary box on loading new stock profile
    const searchBtn = document.getElementById('analyzer-search-btn');
    const searchInput = document.getElementById('analyzer-search-input');
    if (searchBtn || searchInput) {
        const hideBox = () => {
            const summaryBox = document.getElementById('audit-summary-box');
            if (summaryBox) summaryBox.style.display = 'none';
        };
        if (searchBtn) searchBtn.addEventListener('click', hideBox);
        if (searchInput) searchInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') hideBox();
        });
    }
}

// 13b. AI Watchlist Summary & Print Exporter
function setupWatchlistSummary() {
    const summaryBtn = document.getElementById('run-watchlist-summary-btn');
    const printBtn = document.getElementById('print-watchlist-report-btn');
    
    if (summaryBtn) {
        summaryBtn.addEventListener('click', async () => {
            if (activeWatchlistId === null) {
                showToast("Please select a watchlist first.", "warning");
                return;
            }
            if (!activeWatchlistBatchData || !activeWatchlistBatchData.results || activeWatchlistBatchData.results.length === 0) {
                showToast("Please run 'Analyze All' batch analysis first.", "warning");
                return;
            }
            
            const summaryBox = document.getElementById('watchlist-summary-box');
            const summaryText = document.getElementById('watchlist-summary-text');
            if (!summaryBox || !summaryText) return;
            
            summaryBox.style.display = 'block';
            summaryText.innerHTML = `
                <div style="display: flex; align-items: center; justify-content: center; padding: 25px 10px; gap: 10px;">
                    <div class="spinner" style="width: 20px; height: 20px; border-width: 2.5px; border-color: rgba(16, 185, 129, 0.2); border-top-color: var(--color-emerald);"></div>
                    <div style="font-size: 11px; color: var(--text-secondary); font-weight: 500;">Equities Advisor is synthesizing watchlist batch metrics...</div>
                </div>
            `;
            
            summaryBtn.disabled = true;
            summaryBtn.innerText = "Synthesizing...";
            
            try {
                // Compile dynamic watchlist prompt
                const activeWatch = watchlistsList.find(w => w.id === activeWatchlistId);
                const watchlistName = activeWatch ? activeWatch.name : "Custom Watchlist";
                
                let promptText = `As a Senior Equities Portfolio Manager, analyze the following batch analysis scorecard results for my watchlist "${watchlistName}":\n\n`;
                
                activeWatchlistBatchData.results.forEach(res => {
                    promptText += `- Stock: ${res.symbol} (${res.name})\n`;
                    promptText += `  Score: ${res.score}/100, Action: ${res.action}\n`;
                    promptText += `  Price: Rs. ${res.current_price !== null && res.current_price !== undefined ? res.current_price.toLocaleString('en-IN') : 'N/A'}, P/E: ${res.pe !== null && res.pe !== undefined && res.pe > 0 ? res.pe.toFixed(1) : 'N/A'}, ROE: ${res.roe !== null && res.roe !== undefined && res.roe > 0 ? res.roe.toFixed(1) + '%' : 'N/A'}\n`;
                    promptText += `  Margin of Safety: ${res.margin_of_safety !== null && res.margin_of_safety !== undefined ? (res.margin_of_safety > 0 ? '+' : '') + res.margin_of_safety.toFixed(1) + '%' : 'N/A'}, RSI-14: ${res.rsi !== null && res.rsi !== undefined ? res.rsi.toFixed(0) : 'N/A'}, Trend: ${res.trend}\n\n`;
                });
                
                promptText += `Provide a concise, publication-grade AI Watchlist Portfolio Summary in HTML style using the following exact headers styled cleanly:
<h4 style="color:#ffffff; margin-top:15px; font-size:12px;">📊 Watchlist Aggregated Strength</h4>
Summarize the overall quality, average score, and style balance of the watchlist.
<h4 style="color:#ffffff; margin-top:15px; font-size:12px;">🔥 Key High-Conviction Champions</h4>
Highlight the highest scoring stock(s) and why they stand out fundamental/valuation wise.
<h4 style="color:#ffffff; margin-top:15px; font-size:12px;">⚠️ Critical Risk Warnings & Outliers</h4>
Highlight any stock(s) with dangerous valuations (high P/E), oversold RSI, bearish trends, or negative margins of safety.
<h4 style="color:#ffffff; margin-top:15px; font-size:12px;">💼 Tactical Asset Allocation Verdict</h4>
Actionable portfolio advisory for this batch.
Keep the response professional, mathematically grounded, and extremely concise. Do not include introductory notes. Start directly with the Aggregated Strength.`;

                const payload = {
                    history: [],
                    message: promptText,
                    profile: {}
                };
                
                const response = await fetch('/api/chat', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });
                
                if (!response.ok) throw new Error("LLM synthesis failed.");
                const chatRes = await response.json();
                
                // Calculate Portfolio Admiral (highest score asset)
                let bestWatchItem = null;
                let bestWatchScore = -1;
                if (activeWatchlistBatchData && activeWatchlistBatchData.results) {
                    activeWatchlistBatchData.results.forEach(item => {
                        if (item.score > bestWatchScore) {
                            bestWatchScore = item.score;
                            bestWatchItem = item;
                        }
                    });
                }
                
                let cockpitHTML = '';
                if (bestWatchItem) {
                    cockpitHTML = `
                    <div class="watchlist-cockpit-card">
                        <div class="cockpit-header">
                            <div class="cockpit-title">✈️ AI Watchlist Cockpit Diagnostics</div>
                            <div class="cockpit-badge">Pre-Flight Checklist</div>
                        </div>
                        <p class="cockpit-analogy-text">
                            Think of auditing a watchlist like a flight commander running a pre-flight cockpit diagnostic before takeoff. Each stock in the watchlist is an essential instrument panel metric—some represent engine thrust (AI Score & technical momentum) while others monitor fuel reserves and aerodynamic safety margins (Margin of Safety & P/E valuations). Conducting a batch scorecard audit ensures all systems show optimal green readings, indicating the portfolio is aerodynamically stable and cleared for immediate altitude gains with zero structural warning alerts.
                        </p>
                        <div class="cockpit-admiral-box">
                            <span class="cockpit-admiral-label">Current Watchlist Portfolio Admiral:</span>
                            <span class="cockpit-admiral-value">
                                🏆 <strong>${bestWatchItem.symbol} (${bestWatchItem.name})</strong>
                                <span class="badge-rec rec-buy" style="font-size: 11px; padding: 2px 8px; border-radius: 4px; font-weight:700;">${bestWatchItem.score}/100</span>
                            </span>
                        </div>
                    </div>
                    `;
                }
                
                const responseText = chatRes.response || '';
                let html = cockpitHTML + responseText
                    .replace(/\*\*(.*?)\*\*/g, '<strong style="color:var(--text-primary);">$1</strong>')
                    .replace(/\*(.*?)\*/g, '<em>$1</em>')
                    .replace(/\n/g, '<br>');
                    
                summaryText.innerHTML = html;
                summaryBox.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                
            } catch (err) {
                console.error("Watchlist summary error:", err);
                summaryText.innerHTML = `<span class="red-text" style="font-size: 11px;">Failed to compile AI portfolio summary: ${err.message}. Please try again later.</span>`;
            } finally {
                summaryBtn.disabled = false;
                summaryBtn.innerText = "Generate AI Watchlist Summary";
            }
        });
    }
    
    if (printBtn) {
        printBtn.addEventListener('click', () => {
            if (activeWatchlistId === null) {
                showToast("Please select a watchlist first.", "warning");
                return;
            }
            if (!activeWatchlistBatchData || !activeWatchlistBatchData.results || activeWatchlistBatchData.results.length === 0) {
                showToast("Please run 'Analyze All' batch analysis first.", "warning");
                return;
            }
            
            const activeWatch = watchlistsList.find(w => w.id === activeWatchlistId);
            const watchlistName = activeWatch ? activeWatch.name : "Custom Watchlist";
            
            // Build the table rows for printing
            let tableRows = '';
            activeWatchlistBatchData.results.forEach(res => {
                const formattedPrice = res.current_price !== null && res.current_price !== undefined ? `Rs. ${res.current_price.toLocaleString('en-IN')}` : 'N/A';
                const formattedPE = res.pe !== null && res.pe !== undefined && res.pe > 0 ? res.pe.toFixed(1) : 'N/A';
                const formattedROE = res.roe !== null && res.roe !== undefined && res.roe > 0 ? `${res.roe.toFixed(1)}%` : 'N/A';
                const formattedMargin = res.margin_of_safety !== null && res.margin_of_safety !== undefined ? `${res.margin_of_safety > 0 ? '+' : ''}${res.margin_of_safety.toFixed(1)}%` : 'N/A';
                const formattedRSI = res.rsi !== null && res.rsi !== undefined ? res.rsi.toFixed(0) : 'N/A';
                
                let recStyle = 'background: rgba(245,158,11,0.12); color: #f59e0b;';
                if (res.action.includes("BUY")) recStyle = 'background: rgba(16,185,129,0.12); color: #10b981;';
                if (res.action.includes("STRONG BUY")) recStyle = 'background: rgba(59,130,246,0.12); color: #3b82f6;';
                if (res.action.includes("SELL") || res.action.includes("AVOID")) recStyle = 'background: rgba(239,68,68,0.12); color: #ef4444;';
                
                let trendStyle = 'color: #f59e0b;';
                if (res.trend === 'Bullish') trendStyle = 'color: #10b981;';
                if (res.trend === 'Bearish') trendStyle = 'color: #ef4444;';
                
                tableRows += `
                    <tr style="border-bottom: 1px solid #cbd5e1;">
                        <td style="padding: 6px 8px; font-weight: 700; color: #0f172a;">${res.symbol}<br><span style="font-size: 8px; color: #475569; font-weight: 400;">${res.name}</span></td>
                        <td style="padding: 6px 8px; text-align: center;"><span style="background: rgba(15,23,42,0.05); color: #0f172a; padding: 2px 6px; border-radius: 4px; font-weight: 700; font-size: 10px;">${res.score}/100</span></td>
                        <td style="padding: 6px 8px; text-align: center;"><span style="font-size: 8.5px; padding: 2px 5px; border-radius: 4px; font-weight: 700; ${recStyle}">${res.action}</span></td>
                        <td style="padding: 6px 8px; text-align: right; color: #0f172a; font-weight: 500;">${formattedPrice}</td>
                        <td style="padding: 6px 8px; text-align: right; color: #334155;">${formattedPE}</td>
                        <td style="padding: 6px 8px; text-align: right; color: #334155;">${formattedROE}</td>
                        <td style="padding: 6px 8px; text-align: right; font-weight: 600; color: ${res.margin_of_safety >= 0 ? '#10b981' : '#ef4444'};">${formattedMargin}</td>
                        <td style="padding: 6px 8px; text-align: right; color: #334155;">${formattedRSI}</td>
                        <td style="padding: 6px 8px; text-align: center; font-weight: 700; ${trendStyle}">${res.trend}</td>
                    </tr>
                `;
            });
            
            // Check if AI Summary is generated and retrieve it
            const summaryBox = document.getElementById('watchlist-summary-box');
            const summaryText = document.getElementById('watchlist-summary-text');
            let summaryHTML = '';
            if (summaryBox && summaryBox.style.display !== 'none' && summaryText) {
                summaryHTML = `
                    <div style="margin-top: 20px; padding: 15px; border: 1px solid #cbd5e1; border-radius: 6px; background: #f8fafc; page-break-inside: avoid;">
                        <h3 style="margin-top: 0; margin-bottom: 10px; font-size: 12.5px; color: #0f172a; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1.5px solid #10b981; padding-bottom: 4px; font-family: 'Outfit', sans-serif;">
                            📊 AI Portfolio Advisor Watchlist Synthesis
                        </h3>
                        <div style="font-size: 10.5px; line-height: 1.55; color: #334155;">
                            ${summaryText.innerHTML}
                        </div>
                    </div>
                `;
            }
            

            
            const currentLocalDate = new Date().toLocaleDateString('en-IN', {
                year: 'numeric', month: 'long', day: 'numeric',
                hour: '2-digit', minute: '2-digit', second: '2-digit'
            });
            
            const watchlistReportContent = `
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Watchlist Registry Batch Analysis Report - ${watchlistName}</title>
                    <link rel="preconnect" href="https://fonts.googleapis.com">
                    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
                    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Outfit:wght@600;700;800&display=swap" rel="stylesheet">
                    <style>
                        @page {
                            size: A4 portrait;
                            margin: 15mm 15mm 20mm 15mm;
                        }
                        body {
                            font-family: 'Inter', sans-serif;
                            color: #1e293b;
                            background: #ffffff;
                            margin: 0;
                            padding: 0;
                            font-size: 9.5px;
                            line-height: 1.45;
                        }
                        h1, h2, h3, h4 {
                            font-family: 'Outfit', sans-serif;
                            margin: 0;
                        }
                        .header-container {
                            border-bottom: 2.5px solid #0f172a;
                            padding-bottom: 10px;
                            margin-bottom: 18px;
                            display: flex;
                            justify-content: space-between;
                            align-items: flex-end;
                        }
                        .header-title h1 {
                            font-size: 19px;
                            font-weight: 800;
                            color: #0f172a;
                            letter-spacing: -0.02em;
                        }
                        .header-title p {
                            margin: 3px 0 0 0;
                            font-size: 10.5px;
                            color: #475569;
                            font-weight: 600;
                            text-transform: uppercase;
                            letter-spacing: 0.05em;
                        }
                        .header-meta {
                            text-align: right;
                            font-size: 9px;
                            color: #475569;
                            line-height: 1.4;
                        }
                        .section-title {
                            font-size: 11.5px;
                            font-weight: 700;
                            color: #0f172a;
                            text-transform: uppercase;
                            letter-spacing: 0.05em;
                            margin-bottom: 8px;
                            border-left: 3px solid #10b981;
                            padding-left: 8px;
                        }
                        .data-table {
                            width: 100%;
                            border-collapse: collapse;
                            margin-bottom: 18px;
                            font-size: 9px;
                        }
                        .data-table th {
                            background: #f8fafc;
                            color: #475569;
                            font-weight: 700;
                            text-transform: uppercase;
                            font-size: 8px;
                            letter-spacing: 0.03em;
                            padding: 8px 10px;
                            border-bottom: 1.5px solid #cbd5e1;
                            border-top: 1px solid #e2e8f0;
                        }
                        .footer {
                            position: fixed;
                            bottom: 0;
                            left: 0;
                            right: 0;
                            border-top: 1px solid #cbd5e1;
                            padding-top: 6px;
                            font-size: 7px;
                            color: #64748b;
                            line-height: 1.35;
                            text-align: justify;
                        }
                        .no-break {
                            page-break-inside: avoid;
                        }
                    </style>
                </head>
                <body>
                    <div class="header-container">
                        <div class="header-title">
                            <h1>APEX AGENTIC AI RESEARCH TERMINAL</h1>
                            <p>Watchlist Registry: Batch Analysis Scorecard</p>
                        </div>
                        <div class="header-meta">
                            <strong>Watchlist:</strong> ${watchlistName}<br>
                            <strong>Generated:</strong> ${currentLocalDate}
                        </div>
                    </div>
                    
                    <div class="section-title">Constituent Assets Scorecard</div>
                    <table class="data-table">
                        <thead>
                            <tr>
                                <th style="text-align: left;">Stock Asset</th>
                                <th style="text-align: center; width: 60px;">Composite Score</th>
                                <th style="text-align: center; width: 85px;">AI Recommendation</th>
                                <th style="text-align: right; width: 85px;">Market Price</th>
                                <th style="text-align: right; width: 45px;">P/E</th>
                                <th style="text-align: right; width: 50px;">ROE %</th>
                                <th style="text-align: right; width: 75px;">Margin of Safety</th>
                                <th style="text-align: right; width: 45px;">RSI-14</th>
                                <th style="text-align: center; width: 65px;">Technical Trend</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${tableRows}
                        </tbody>
                    </table>
                    
                    ${summaryHTML}
                    
                    <div class="footer">
                        <strong>⚠️ SEBI Investment Advisory Disclosure:</strong> Apex Agentic AI acts strictly as an automated quantitative research workstation. We are not SEBI registered investment advisors. All composite scoring metrics, Piotroski matrix diagnostic summaries, Altman scores, and DCF sandboxes are computed based on historical NSE market datasets and mathematical models, representing simulations rather than direct buy/sell endorsements. Capital markets carry structural risks; execute audits before deploying capital.
                    </div>
                    
                    <script>
                        window.onload = function() {
                            setTimeout(function() {
                                window.print();
                                window.close();
                            }, 500);
                        };
                    </script>
                </body>
                </html>
            `;
            executeSystemPrint(watchlistReportContent, 'width=1100,height=850');
        });
    }
}


let backtestSandboxStocks = [];
let backtestChartInstance = null;
let activeBacktestLightweightChart = null;


    
// ==================== TAX & HARVESTING PANEL ====================

async function setupTaxHarvestingPanel() {
    // Tax holdings entry panel collapsible toggle
    const taxToggle = document.getElementById('tax-holdings-toggle');
    const taxContent = document.getElementById('tax-holdings-content');
    if (taxToggle && taxContent) {
        taxToggle.addEventListener('click', () => {
            const isCollapsed = taxContent.style.display === 'none';
            if (isCollapsed) {
                taxContent.style.display = 'block';
                taxToggle.classList.remove('collapsed');
            } else {
                taxContent.style.display = 'none';
                taxToggle.classList.add('collapsed');
            }
        });
    }

    const manualForm = document.getElementById('tax-manual-add-form');
    
    // Add Autocomplete suggestions logic for Tax tab custom stock search input
    const taxCustomInput = document.getElementById('tax-custom-stock-input');
    const taxSuggestionsDiv = document.getElementById('tax-custom-suggestions');
    if (taxCustomInput) {
        if (taxSuggestionsDiv) {
            taxSuggestionsDiv.className = 'watchlist-autocomplete-box';
            taxSuggestionsDiv.removeAttribute('style'); // Remove inline styles
        }
        
        taxCustomInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault(); // Don't trigger standard form submission immediately if suggestions are open
            }
        });
        
        taxCustomInput.addEventListener('input', async () => {
            const query = taxCustomInput.value.trim();
            if (!taxSuggestionsDiv) return;
            
            if (query.length < 2) {
                taxSuggestionsDiv.style.display = 'none';
                return;
            }
            
            try {
                const res = await fetch(`/api/search/suggestions?q=${encodeURIComponent(query)}`);
                if (res.ok) {
                    const data = await res.json();
                    if (data.length > 0) {
                        taxSuggestionsDiv.innerHTML = '';
                        data.forEach(item => {
                            const div = document.createElement('div');
                            div.className = 'watchlist-autocomplete-item';
                            div.innerHTML = `<div><span class="ticker-pill">${item.base_symbol}</span><span style="color:var(--text-secondary); margin-left: 6px; font-size:11px;">- ${item.name}</span></div><span class="sector-pill">${item.sector}</span>`;
                            
                            div.addEventListener('click', () => {
                                taxCustomInput.value = item.base_symbol;
                                taxSuggestionsDiv.style.display = 'none';
                            });
                            taxSuggestionsDiv.appendChild(div);
                        });
                        taxSuggestionsDiv.style.display = 'block';
                    } else {
                        taxSuggestionsDiv.style.display = 'none';
                    }
                }
            } catch (err) {
                console.error("Tax suggestions error:", err);
            }
        });
        
        // Close autocomplete list when clicking outside
        document.addEventListener('click', (e) => {
            if (taxSuggestionsDiv && e.target !== taxCustomInput && e.target !== taxSuggestionsDiv) {
                taxSuggestionsDiv.style.display = 'none';
            }
        });
    }

    if (manualForm) {
        manualForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const symbolSelect = document.getElementById('tax-watchlist-stock-select');
            const customInput = document.getElementById('tax-custom-stock-input');
            const qtyInput = document.getElementById('tax-add-qty');
            const priceInput = document.getElementById('tax-add-price');
            const dateInput = document.getElementById('tax-add-date');
            const typeSelect = document.getElementById('tax-add-type');
            
            if (!qtyInput || !priceInput || !dateInput) return;
            
            let symbol = "";
            if (customInput && customInput.value.trim()) {
                symbol = customInput.value.trim().toUpperCase();
            } else if (symbolSelect && symbolSelect.value) {
                symbol = symbolSelect.value;
            }
            
            const qty = parseFloat(qtyInput.value) || 0;
            const price = parseFloat(priceInput.value) || 0;
            const date = dateInput.value;
            const type = typeSelect ? typeSelect.value : "buy";
            
            if (!symbol) {
                showToast("Please search/type a stock symbol or choose from watchlist.", "warning");
                return;
            }
            if (qty <= 0) {
                showToast("Quantity must be greater than zero.", "warning");
                return;
            }
            if (price <= 0) {
                showToast("Price must be greater than zero.", "warning");
                return;
            }
            if (date > "2026-06-05") {
                showToast("Trade date cannot be in the future.", "warning");
                return;
            }
            
            try {
                const response = await fetch('/api/portfolio', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        symbol: symbol,
                        quantity: qty,
                        purchase_price: price,
                        purchase_date: date,
                        transaction_type: type
                    })
                });
                
                if (!response.ok) {
                    const err = await response.json();
                    throw new Error(err.detail || "Failed to add tranche.");
                }
                
                showToast(`Successfully added ${symbol} tranche.`, "success");
                
                if (customInput) customInput.value = "";
                if (symbolSelect) symbolSelect.value = "";
                qtyInput.value = "10";
                priceInput.value = "100";
                
                await loadTaxHarvestingPanel();
                await loadPortfolioDoctorLedger();
            } catch (err) {
                showToast("Error: " + err.message, "error");
            }
        });
    }
    
    // Set default date to 2026-06-05
    const taxAddDateInput = document.getElementById('tax-add-date');
    if (taxAddDateInput) {
        taxAddDateInput.value = "2026-06-05";
        taxAddDateInput.max = "2026-06-05";
    }
    
    // Clear ledger button
    const clearLedgerBtn = document.getElementById('tax-clear-all-btn');
    if (clearLedgerBtn) {
        clearLedgerBtn.addEventListener('click', async () => {
            if (!confirm("Are you sure you want to clear your entire holdings ledger? This cannot be undone.")) return;
            if (!confirm("CONFIRM CLEAR: Are you absolutely sure?")) return;
            
            try {
                const response = await fetch('/api/portfolio/transactions');
                if (!response.ok) throw new Error("Failed to fetch current transactions.");
                const items = await response.json();
                
                for (const item of items) {
                    await fetch(`/api/portfolio/${item.id}`, { method: 'DELETE' });
                }
                
                showToast("Clear ledger complete.", "success");
                await loadTaxHarvestingPanel();
                await loadPortfolioDoctorLedger();
            } catch (err) {
                showToast("Error clearing ledger: " + err.message, "error");
            }
        });
    }

    // Complete raw transaction history collapsible toggle
    const rawToggle = document.getElementById('tax-raw-ledger-toggle');
    const rawContent = document.getElementById('tax-raw-ledger-content');
    const rawArrow = document.getElementById('tax-raw-ledger-arrow');
    if (rawToggle && rawContent) {
        rawToggle.addEventListener('click', () => {
            const isCollapsed = rawContent.style.display === 'none';
            if (isCollapsed) {
                rawContent.style.display = 'block';
                if (rawArrow) rawArrow.style.transform = 'rotate(90deg)';
                loadTaxRawTransactionLedger();
            } else {
                rawContent.style.display = 'none';
                if (rawArrow) rawArrow.style.transform = 'rotate(0deg)';
            }
        });
    }
    
    // Setup Drag and Drop dropzone
    const dropzone = document.getElementById('tax-excel-dropzone');
    const fileInput = document.getElementById('tax-excel-file-input');
    
    if (dropzone && fileInput) {
        dropzone.addEventListener('click', () => fileInput.click());
        
        dropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropzone.style.borderColor = 'var(--color-primary)';
            dropzone.style.background = 'rgba(59, 130, 246, 0.05)';
        });
        
        ['dragleave', 'dragend'].forEach(evt => {
            dropzone.addEventListener(evt, () => {
                dropzone.style.borderColor = 'var(--border-glass)';
                dropzone.style.background = 'rgba(255,255,255,0.01)';
            });
        });
        
        dropzone.addEventListener('drop', async (e) => {
            e.preventDefault();
            dropzone.style.borderColor = 'var(--border-glass)';
            dropzone.style.background = 'rgba(255,255,255,0.01)';
            
            const files = e.dataTransfer.files;
            if (files.length > 0) {
                await uploadBrokerFile(files[0]);
            }
        });
        
        fileInput.addEventListener('change', async () => {
            if (fileInput.files.length > 0) {
                await uploadBrokerFile(fileInput.files[0]);
                fileInput.value = '';
            }
        });
    }
}

async function uploadBrokerFile(file) {
    const formData = new FormData();
    formData.append('file', file);
    
    const dropzone = document.getElementById('tax-excel-dropzone');
    if (dropzone) {
        dropzone.innerHTML = `<span style="font-size: 20px; display: block; margin-bottom: 5px;">⏳</span><span style="font-size: 11px; color: var(--text-secondary);">Uploading and parsing spreadsheet...</span>`;
        dropzone.style.pointerEvents = 'none';
    }
    
    try {
        const response = await fetch('/api/portfolio/upload', {
            method: 'POST',
            body: formData
        });
        
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.detail || "Spreadsheet upload failed.");
        }
        
        const resData = await response.json();
        showToast(`Import Success: Added ${resData.imported} tranches.`, "success");
        if (resData.errors && resData.errors.length > 0) {
            console.warn("Import warning errors:", resData.errors);
            showToast(`Skipped ${resData.errors.length} invalid rows during import.`, "warning");
        }
        
        await loadTaxHarvestingPanel();
        await loadPortfolioDoctorLedger();
    } catch (err) {
        showToast("Import error: " + err.message, "error");
    } finally {
        if (dropzone) {
            dropzone.innerHTML = `
                <span style="font-size: 24px; display: block; margin-bottom: 5px;">📁</span>
                <span style="font-size: 11px; color: var(--text-secondary); font-weight: 600;">Drag & drop broker Excel/CSV here or <span style="color: var(--color-primary); text-decoration: underline;">browse</span></span>
            `;
            dropzone.style.pointerEvents = 'auto';
        }
    }
}

async function populateTaxWatchlistStocks() {
    const stockSelect = document.getElementById('tax-watchlist-stock-select');
    if (!stockSelect) return;
    
    stockSelect.innerHTML = '<option value="" disabled selected>Choose Stock</option>';
    
    try {
        const wlResponse = await fetch('/api/watchlists');
        if (!wlResponse.ok) return;
        const watchlists = await wlResponse.json();
        
        let allSymbols = new Set();
        let uniqueStocks = [];
        
        for (const wl of watchlists) {
            const itemsRes = await fetch(`/api/watchlists/${wl.id}`);
            if (itemsRes.ok) {
                const wlDetail = await itemsRes.json();
                const items = wlDetail.items || [];
                for (const item of items) {
                    if (!allSymbols.has(item.symbol)) {
                        allSymbols.add(item.symbol);
                        uniqueStocks.push(item);
                    }
                }
            }
        }
        
        if (uniqueStocks.length === 0) {
            stockSelect.innerHTML += '<option value="" disabled>No stocks in watchlists</option>';
        } else {
            uniqueStocks.forEach(item => {
                stockSelect.innerHTML += `<option value="${item.symbol}">${item.symbol} - ${item.name || ''}</option>`;
            });
        }
    } catch (e) {
        console.error("Error populating watchlist select for tax:", e);
    }
}

async function loadTaxHarvestingPanel() {
    await populateTaxWatchlistStocks();
    await loadTaxHarvestingLedger();
}

async function loadTaxHarvestingLedger() {
    const ledgerBody = document.getElementById('tax-ledger-body');
    if (!ledgerBody) return;
    
    try {
        const response = await fetch('/api/portfolio');
        if (!response.ok) throw new Error("Failed to load portfolio tranches.");
        const items = await response.json();
        
        ledgerBody.innerHTML = '';
        
        if (items.length === 0) {
            ledgerBody.innerHTML = '<tr><td colspan="7" class="center-text text-muted" style="padding: 30px;">No holdings in your tax ledger. Add tranches manually above or upload your broker holdings sheet.</td></tr>';
            const reportContainer = document.getElementById('tax-report-container');
            if (reportContainer) reportContainer.style.display = 'none';
            return;
        }
        
        items.forEach(item => {
            const tr = document.createElement('tr');
            tr.style.borderBottom = '1px solid var(--border-glass)';
            
            let days = 0;
            try {
                const today = new Date('2026-06-05');
                const pDate = new Date(item.purchase_date);
                const diffTime = Math.abs(today - pDate);
                days = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
                if (today < pDate) days = 0;
            } catch (dErr) {
                days = 0;
            }
            
            const isLtcg = days > 365;
            const statusHTML = isLtcg 
                ? `<span class="badge-rec" style="background: rgba(16, 185, 129, 0.1); color: var(--neon-green); border-color: rgba(16, 185, 129, 0.2); font-size: 10px; padding: 2px 6px;">🌳 LTCG</span>`
                : `<span class="badge-rec" style="background: rgba(239, 68, 68, 0.1); color: var(--neon-red); border-color: rgba(239, 68, 68, 0.2); font-size: 10px; padding: 2px 6px;">⏳ STCG</span>`;
            
            tr.innerHTML = `
                <td style="padding: 8px;">
                    <strong>${item.symbol}</strong><br>
                    <span style="font-size: 9.5px; color: var(--text-muted);">${item.name || ''}</span>
                </td>
                <td style="padding: 8px;"><input type="number" class="tax-qty-input" data-id="${item.id}" value="${item.quantity}" style="width: 70px; padding: 4px; border-radius:4px; background:rgba(0,0,0,0.3); border:1px solid var(--border-glass); color:#fff; font-size:11px;"></td>
                <td style="padding: 8px;"><input type="number" class="tax-price-input" data-id="${item.id}" value="${item.purchase_price}" style="width: 80px; padding: 4px; border-radius:4px; background:rgba(0,0,0,0.3); border:1px solid var(--border-glass); color:#fff; font-size:11px;"></td>
                <td style="padding: 8px;"><input type="date" class="tax-date-input" data-id="${item.id}" value="${item.purchase_date}" max="2026-06-05" style="width: 110px; padding: 4px; border-radius:4px; background:rgba(0,0,0,0.3); border:1px solid var(--border-glass); color:#fff; font-size:11px;"></td>
                <td style="padding: 8px; color: var(--text-secondary); font-size: 11.5px;">${days} days</td>
                <td style="padding: 8px;">${statusHTML}</td>
                <td style="padding: 8px;"><button class="btn-secondary tax-remove-btn" data-id="${item.id}" style="font-size: 10px; padding: 4px 8px; border-color: rgba(239,68,68,0.25); color: var(--color-crimson); background: rgba(239,68,68,0.03); cursor:pointer; font-weight: 600; border-radius: 4px;">Remove 🗑️</button></td>
            `;
            
            const qtyInput = tr.querySelector('.tax-qty-input');
            const priceInput = tr.querySelector('.tax-price-input');
            const dateInput = tr.querySelector('.tax-date-input');
            const removeBtn = tr.querySelector('.tax-remove-btn');
            
            const updateTranche = async () => {
                const qVal = parseFloat(qtyInput.value) || 0;
                const pVal = parseFloat(priceInput.value) || 0;
                const dVal = dateInput.value;
                
                if (dVal > "2026-06-05") {
                    showToast("Purchase date cannot be in the future.", "warning");
                    dateInput.value = item.purchase_date;
                    return;
                }
                
                try {
                    const response = await fetch(`/api/portfolio/${item.id}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ quantity: qVal, purchase_price: pVal, purchase_date: dVal })
                    });
                    if (!response.ok) {
                        const err = await response.json();
                        throw new Error(err.detail || "Failed to update tranche.");
                    }
                    await loadTaxHarvestingReport();
                    await loadPortfolioDoctorLedger();
                } catch (err) {
                    console.error("Error updating tranche:", err);
                    showToast("Error updating tranche: " + err.message, "error");
                }
            };
            
            qtyInput.addEventListener('change', updateTranche);
            priceInput.addEventListener('change', updateTranche);
            dateInput.addEventListener('change', async () => {
                await updateTranche();
                await loadTaxHarvestingLedger();
            });
            
            removeBtn.addEventListener('click', async () => {
                if (!confirm(`Remove ${item.symbol} tranche purchased on ${item.purchase_date}?`)) return;
                try {
                    const res = await fetch(`/api/portfolio/${item.id}`, { method: 'DELETE' });
                    if (res.ok) {
                        showToast(`Removed tranche successfully.`, "success");
                        await loadTaxHarvestingPanel();
                        await loadPortfolioDoctorLedger();
                    }
                } catch (err) {
                    console.error("Error removing tranche:", err);
                }
            });
            
            ledgerBody.appendChild(tr);
        });
        
        // Refresh Complete Transaction History if visible
        const rawContent = document.getElementById('tax-raw-ledger-content');
        if (rawContent && rawContent.style.display === 'block') {
            loadTaxRawTransactionLedger();
        }
        
        await loadTaxHarvestingReport();
    } catch (e) {
        console.error(e);
        showToast("Error loading tax ledger: " + e.message, "error");
    }
}

async function loadTaxRawTransactionLedger() {
    const rawLedgerBody = document.getElementById('tax-raw-ledger-body');
    if (!rawLedgerBody) return;
    
    try {
        const response = await fetch('/api/portfolio/transactions');
        if (!response.ok) throw new Error("Failed to load raw transactions.");
        const txs = await response.json();
        
        rawLedgerBody.innerHTML = '';
        
        if (txs.length === 0) {
            rawLedgerBody.innerHTML = '<tr><td colspan="6" class="center-text text-muted" style="padding: 20px;">No transaction history found.</td></tr>';
            return;
        }
        
        txs.forEach(tx => {
            const tr = document.createElement('tr');
            tr.style.borderBottom = '1px solid var(--border-glass)';
            
            const isBuy = (tx.transaction_type || 'buy').toLowerCase() === 'buy';
            const typeBadge = isBuy
                ? `<span class="badge-rec" style="background: rgba(16, 185, 129, 0.15); color: var(--neon-green); border-color: rgba(16, 185, 129, 0.3); font-size: 9px; padding: 1px 4px;">BUY</span>`
                : `<span class="badge-rec" style="background: rgba(239, 68, 68, 0.15); color: var(--neon-red); border-color: rgba(239, 68, 68, 0.3); font-size: 9px; padding: 1px 4px;">SELL</span>`;
                
            tr.innerHTML = `
                <td style="padding: 8px;">
                    <strong>${tx.symbol}</strong><br>
                    <span style="font-size: 9px; color: var(--text-muted);">${tx.name || ''}</span>
                </td>
                <td style="padding: 8px;">${typeBadge}</td>
                <td style="padding: 8px; font-size: 11.5px; color: var(--text-primary);">${tx.quantity}</td>
                <td style="padding: 8px; font-size: 11.5px; color: var(--text-secondary);">₹${tx.purchase_price}</td>
                <td style="padding: 8px; font-size: 11.5px; color: var(--text-muted);">${tx.purchase_date}</td>
                <td style="padding: 8px;"><button class="btn-secondary tax-tx-remove-btn" data-id="${tx.id}" style="font-size: 9px; padding: 2px 6px; border-color: rgba(239,68,68,0.25); color: var(--color-crimson); background: rgba(239,68,68,0.03); cursor:pointer; font-weight: 600; border-radius: 4px;">Delete 🗑️</button></td>
            `;
            
            const removeBtn = tr.querySelector('.tax-tx-remove-btn');
            removeBtn.addEventListener('click', async () => {
                const actionLabel = isBuy ? "BUY" : "SELL";
                if (!confirm(`Delete raw transaction: ${actionLabel} ${tx.quantity} shares of ${tx.symbol} executed on ${tx.purchase_date}?`)) return;
                
                try {
                    const res = await fetch(`/api/portfolio/${tx.id}`, { method: 'DELETE' });
                    if (res.ok) {
                        showToast("Deleted raw transaction successfully.", "success");
                        await loadTaxRawTransactionLedger();
                        await loadTaxHarvestingPanel();
                        await loadPortfolioDoctorLedger();
                    }
                } catch (err) {
                    console.error("Error deleting raw transaction:", err);
                    showToast("Error deleting raw transaction: " + err.message, "error");
                }
            });
            
            rawLedgerBody.appendChild(tr);
        });
    } catch (e) {
        console.error("Error loading raw transactions:", e);
        rawLedgerBody.innerHTML = `<tr><td colspan="6" class="center-text text-muted" style="padding: 20px; color: var(--neon-red);">Error: ${e.message}</td></tr>`;
    }
}

async function loadTaxHarvestingReport() {
    const reportContainer = document.getElementById('tax-report-container');
    if (!reportContainer) return;
    
    try {
        const response = await fetch('/api/portfolio/tax-report');
        if (!response.ok) throw new Error("Failed to load tax report.");
        const report = await response.json();
        
        reportContainer.style.display = 'block';
        
        const sum = report.summary;
        
        document.getElementById('tax-metric-liability').innerText = `₹${sum.total_tax_liability.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
        document.getElementById('tax-metric-harvest-savings').innerText = `₹${sum.total_harvest_savings.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
        
        const netPLText = document.getElementById('tax-metric-net-pl');
        netPLText.innerText = `₹${sum.total_unrealized_pl.toLocaleString('en-IN', { maximumFractionDigits: 0 })} (${sum.total_unrealized_pl_pct > 0 ? '+' : ''}${sum.total_unrealized_pl_pct.toFixed(2)}%)`;
        netPLText.style.color = sum.total_unrealized_pl >= 0 ? 'var(--neon-green)' : 'var(--neon-red)';
        
        document.getElementById('tax-metric-harvest-losses').innerText = `₹${sum.total_harvestable_loss.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
        
        document.getElementById('tax-stcg-value').innerText = `₹${sum.stcg_value.toLocaleString('en-IN')}`;
        document.getElementById('tax-stcg-cost').innerText = `₹${sum.stcg_cost.toLocaleString('en-IN')}`;
        const stcgPl = document.getElementById('tax-stcg-pl');
        stcgPl.innerText = `₹${sum.stcg_unrealized_pl.toLocaleString('en-IN')}`;
        stcgPl.style.color = sum.stcg_unrealized_pl >= 0 ? 'var(--neon-green)' : 'var(--neon-red)';
        document.getElementById('tax-stcg-liability').innerText = `₹${sum.stcg_tax.toLocaleString('en-IN')}`;
        
        document.getElementById('tax-ltcg-value').innerText = `₹${sum.ltcg_value.toLocaleString('en-IN')}`;
        document.getElementById('tax-ltcg-cost').innerText = `₹${sum.ltcg_cost.toLocaleString('en-IN')}`;
        const ltcgPl = document.getElementById('tax-ltcg-pl');
        ltcgPl.innerText = `₹${sum.ltcg_unrealized_pl.toLocaleString('en-IN')}`;
        ltcgPl.style.color = sum.ltcg_unrealized_pl >= 0 ? 'var(--neon-green)' : 'var(--neon-red)';
        document.getElementById('tax-ltcg-liability').innerText = `₹${sum.ltcg_tax.toLocaleString('en-IN')}`;
        
        const emptyState = document.getElementById('tax-harvesting-empty-state');
        const listContainer = document.getElementById('tax-harvesting-list');
        
        if (!emptyState || !listContainer) return;
        
        listContainer.innerHTML = '';
        const candidates = report.harvesting_opportunities || [];
        
        if (candidates.length === 0) {
            emptyState.style.display = 'flex';
            listContainer.style.display = 'none';
        } else {
            emptyState.style.display = 'none';
            listContainer.style.display = 'flex';
            listContainer.style.flexDirection = 'column';
            
            candidates.forEach(c => {
                const card = document.createElement('div');
                card.style.background = 'rgba(255,255,255,0.01)';
                card.style.border = '1px solid var(--border-glass)';
                card.style.borderRadius = '6px';
                card.style.padding = '12px';
                card.style.display = 'flex';
                card.style.justifyContent = 'space-between';
                card.style.alignItems = 'center';
                
                card.innerHTML = `
                    <div>
                        <strong style="font-size: 12px; color: var(--text-primary);">${c.symbol}</strong>
                        <span style="font-size: 10px; color: var(--text-muted); margin-left: 5px;">(${c.name})</span>
                        <div style="font-size: 10.5px; color: var(--text-secondary); margin-top: 4px;">
                            Acquired: ${c.quantity} shares @ ₹${c.purchase_price} | Current: ₹${c.current_price}
                        </div>
                        <div style="font-size: 10px; color: var(--text-muted); margin-top: 2px;">
                            Holding period: <strong>${c.holding_days} days</strong> (${c.classification})
                        </div>
                    </div>
                    <div style="text-align: right;">
                        <span style="font-size: 12px; font-weight: 700; color: var(--neon-red); display: block;">Loss: -₹${Math.abs(c.unrealized_loss).toLocaleString('en-IN')}</span>
                        <span style="font-size: 10.5px; font-weight: 700; color: var(--neon-green); display: block; margin-top: 2px;">Savings: +₹${c.potential_savings.toLocaleString('en-IN')}</span>
                        <button class="btn-primary tax-harvest-action-btn" data-symbol="${c.symbol}" style="font-size: 9px; padding: 3px 6px; height: auto; border-radius: 4px; margin-top: 6px; font-weight: 700; border: none; background: rgba(16, 185, 129, 0.15); color: #10b981;">Harvest Loss</button>
                    </div>
                `;
                
                card.querySelector('.tax-harvest-action-btn').addEventListener('click', () => {
                    alert(`To harvest the tax loss for ${c.symbol}:\n\n` +
                          `1. Place a SELL order for ${c.quantity} shares of ${c.symbol} at the market price of ₹${c.current_price} to realize a capital loss of ₹${Math.abs(c.unrealized_loss).toLocaleString('en-IN')}.\n` +
                          `2. This registered loss offsets your tax liability, saving you ₹${c.potential_savings.toLocaleString('en-IN')} in capital gains tax.\n` +
                          `3. Re-invest the proceeds immediately into a similar sector asset (or buy back ${c.symbol} after the wash-sale boundary period if applicable) to maintain your equity market exposure.`);
                });
                
                listContainer.appendChild(card);
            });
        }
        
        // Render Detailed AI Summary / Prescription
        const prescriptionBox = document.getElementById('tax-prescription-box');
        const prescriptionContent = document.getElementById('tax-prescription-content');
        if (prescriptionBox && prescriptionContent) {
            prescriptionBox.style.display = 'block';
            if (report.prescription) {
                let mdText = report.prescription;
                let html = mdText
                    .replace(/^# (.*$)/gim, '<h2 style="color:var(--neon-green); margin-top:20px; font-size:16px;">$1</h2>')
                    .replace(/^## (.*$)/gim, '<h3 style="color:var(--text-primary); margin-top:15px; font-size:14px; border-bottom: 1px dashed var(--border-glass); padding-bottom:5px;">$1</h3>')
                    .replace(/^### (.*$)/gim, '<h4 style="color:var(--text-secondary); margin-top:10px; font-size:12px;">$1</h4>')
                    .replace(/^\> (.*$)/gim, '<blockquote style="border-left:3px solid var(--color-amber); padding-left:10px; margin:10px 0; color:var(--text-primary); background:rgba(245,158,11,0.05); padding:8px; border-radius:4px;">$1</blockquote>')
                    .replace(/\*\*(.*?)\*\*/g, '<strong style="color:var(--text-primary);">$1</strong>')
                    .replace(/\*(.*?)\*/g, '<em>$1</em>')
                    .replace(/\n/g, '<br>');
                prescriptionContent.innerHTML = html;
            } else {
                prescriptionContent.innerHTML = `
                    <div style="text-align: center; padding: 25px 15px;">
                        <p style="margin-bottom: 15px; color: var(--text-secondary); font-size: 13px;">AI Capital Gains Diagnostic Prescription is ready to analyze your tax harvesting strategy.</p>
                        <button id="generate-tax-prescription-btn" class="btn-primary" style="padding: 10px 20px; font-size: 12px; font-weight: 700; border-radius: 6px;">
                            📋 Generate Detailed AI Tax Prescription
                        </button>
                    </div>
                `;
                document.getElementById('generate-tax-prescription-btn').addEventListener('click', async () => {
                    prescriptionContent.innerHTML = `
                        <div style="text-align: center; padding: 25px 15px; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px;">
                            <span class="spinner" style="display: inline-block; width: 20px; height: 20px; border: 2px solid rgba(255,255,255,0.1); border-top-color: var(--neon-green); border-radius: 50%; animation: spin 1s linear infinite;"></span>
                            <p style="color: var(--neon-green); font-weight: 600; font-size: 13px; margin: 0;">Generating AI Tax Prescription (calling LLM)...</p>
                        </div>
                    `;
                    try {
                        const res = await fetch('/api/portfolio/tax-report?generate_prescription=true');
                        if (!res.ok) throw new Error("Failed to generate AI prescription");
                        const data = await res.json();
                        if (data.prescription) {
                            let mdText = data.prescription;
                            let html = mdText
                                .replace(/^# (.*$)/gim, '<h2 style="color:var(--neon-green); margin-top:20px; font-size:16px;">$1</h2>')
                                .replace(/^## (.*$)/gim, '<h3 style="color:var(--text-primary); margin-top:15px; font-size:14px; border-bottom: 1px dashed var(--border-glass); padding-bottom:5px;">$1</h3>')
                                .replace(/^### (.*$)/gim, '<h4 style="color:var(--text-secondary); margin-top:10px; font-size:12px;">$1</h4>')
                                .replace(/^\> (.*$)/gim, '<blockquote style="border-left:3px solid var(--color-amber); padding-left:10px; margin:10px 0; color:var(--text-primary); background:rgba(245,158,11,0.05); padding:8px; border-radius:4px;">$1</blockquote>')
                                .replace(/\*\*(.*?)\*\*/g, '<strong style="color:var(--text-primary);">$1</strong>')
                                .replace(/\*(.*?)\*/g, '<em>$1</em>')
                                .replace(/\n/g, '<br>');
                            prescriptionContent.innerHTML = html;
                        } else {
                            prescriptionContent.innerHTML = `<p style="color: var(--neon-red); text-align: center;">Failed to load prescription content.</p>`;
                        }
                    } catch (err) {
                        prescriptionContent.innerHTML = `<p style="color: var(--neon-red); text-align: center;">Error: ${err.message}</p>`;
                    }
                });
            }
        }
    } catch (err) {
        console.error("Error loading tax report:", err);
    }
}

// ==================== PORTFOLIO BACKTESTER ====================

function setupPortfolioBacktester() {
    const portTabDiagnosticsBtn = document.getElementById('port-tab-diagnostics-btn');
    const portTabTaxBtn = document.getElementById('port-tab-tax-btn');
    const portTabBacktesterBtn = document.getElementById('port-tab-backtester-btn');
    
    const portPanelDiagnostics = document.getElementById('port-panel-diagnostics');
    const portPanelTax = document.getElementById('port-panel-tax');
    const portPanelBacktester = document.getElementById('port-panel-backtester');
    
    // Collapsible Ledger Block Click Listener
    const ledgerHeader = document.getElementById('backtest-rebalance-ledger-header');
    if (ledgerHeader) {
        ledgerHeader.addEventListener('click', () => {
            const body = document.getElementById('backtest-rebalance-ledger-text');
            const arrow = document.getElementById('backtest-rebalance-ledger-arrow');
            if (body && arrow) {
                const isCollapsed = body.style.display === 'none';
                body.style.display = isCollapsed ? 'block' : 'none';
                arrow.style.transform = isCollapsed ? 'rotate(90deg)' : 'rotate(0deg)';
                ledgerHeader.style.marginBottom = isCollapsed ? '12px' : '0px';
                ledgerHeader.style.borderBottom = isCollapsed ? '1px dashed var(--border-glass)' : 'none';
            }
        });
    }
    
    if (!portTabDiagnosticsBtn || !portTabBacktesterBtn) return;
    
    const switchSubTab = (activeBtn, activePanel) => {
        [portTabDiagnosticsBtn, portTabTaxBtn, portTabBacktesterBtn].forEach(btn => {
            if (btn) {
                if (btn === activeBtn) {
                    btn.classList.add('active');
                    btn.style.borderColor = 'var(--border-glass)';
                    btn.style.background = 'rgba(255,255,255,0.03)';
                    btn.style.color = 'var(--text-primary)';
                } else {
                    btn.classList.remove('active');
                    btn.style.borderColor = 'transparent';
                    btn.style.background = 'transparent';
                    btn.style.color = 'var(--text-muted)';
                }
            }
        });
        
        [portPanelDiagnostics, portPanelTax, portPanelBacktester].forEach(panel => {
            if (panel) {
                panel.style.display = panel === activePanel ? 'block' : 'none';
            }
        });
    };
    
    if (portTabDiagnosticsBtn) {
        portTabDiagnosticsBtn.addEventListener('click', async () => {
            switchSubTab(portTabDiagnosticsBtn, portPanelDiagnostics);
            await loadPortfolioDoctorLedger(true);
        });
    }
    
    if (portTabTaxBtn) {
        portTabTaxBtn.addEventListener('click', async () => {
            switchSubTab(portTabTaxBtn, portPanelTax);
            await loadTaxHarvestingPanel();
        });
    }
    
    if (portTabBacktesterBtn) {
        portTabBacktesterBtn.addEventListener('click', async () => {
            switchSubTab(portTabBacktesterBtn, portPanelBacktester);
            if (backtestSandboxStocks.length === 0) {
                await syncLedgerToBacktestSandbox();
            }
        });
    }
    const today = new Date();
    const endStr = today.toISOString().split('T')[0];
    const threeYearsAgo = new Date();
    threeYearsAgo.setFullYear(today.getFullYear() - 3);
    const startStr = threeYearsAgo.toISOString().split('T')[0];
    
    const startDateInput = document.getElementById('backtest-start-date');
    const endDateInput = document.getElementById('backtest-end-date');
    if (startDateInput) startDateInput.value = startStr;
    if (endDateInput) endDateInput.value = endStr;
    
    // Fee slider listener
    const feeSlider = document.getElementById('backtest-fee');
    const feeLabel = document.getElementById('backtest-fee-label');
    if (feeSlider && feeLabel) {
        feeSlider.addEventListener('input', () => {
            feeLabel.innerText = parseFloat(feeSlider.value).toFixed(2) + '%';
        });
    }
    
    // Autocomplete trial stock input
    const trialInput = document.getElementById('backtest-custom-stock-input');
    const trialSuggestions = document.getElementById('backtest-custom-suggestions');
    if (trialInput && trialSuggestions) {
        trialInput.addEventListener('input', async () => {
            const query = trialInput.value.trim();
            if (query.length < 2) {
                trialSuggestions.style.display = 'none';
                return;
            }
            try {
                const res = await fetch(`/api/search/suggestions?q=${encodeURIComponent(query)}`);
                if (res.ok) {
                    const data = await res.json();
                    if (data.length > 0) {
                        trialSuggestions.innerHTML = '';
                        data.forEach(item => {
                            const div = document.createElement('div');
                            div.className = 'backtest-suggestion-item';
                            div.innerHTML = `<span><strong>${item.base_symbol}</strong> - ${item.name}</span><span style="color:var(--text-muted); font-size:9.5px;">${item.sector}</span>`;
                            div.addEventListener('click', () => {
                                trialInput.value = item.base_symbol;
                                trialSuggestions.style.display = 'none';
                            });
                            trialSuggestions.appendChild(div);
                        });
                        trialSuggestions.style.display = 'block';
                    } else {
                        trialSuggestions.style.display = 'none';
                    }
                }
            } catch (err) {
                console.error("Backtester suggestions error:", err);
            }
        });
        
        document.addEventListener('click', (e) => {
            if (e.target !== trialInput && e.target !== trialSuggestions) {
                trialSuggestions.style.display = 'none';
            }
        });
    }
    
    // Add trial ticker button
    const addAssetBtn = document.getElementById('backtest-add-custom-btn');
    if (addAssetBtn && trialInput) {
        addAssetBtn.addEventListener('click', () => {
            const sym = trialInput.value.trim().toUpperCase();
            if (!sym) {
                showToast("Please enter a stock symbol to add.", "warning");
                return;
            }
            // Check if already in sandbox
            if (backtestSandboxStocks.some(s => s.symbol === sym)) {
                showToast(`${sym} is already in the sandbox list.`, "warning");
                return;
            }
            // Determine default weight: remaining weight or 0
            const currentSum = backtestSandboxStocks.reduce((sum, s) => sum + s.weight, 0);
            const remaining = Math.max(0, 100 - currentSum);
            
            backtestSandboxStocks.push({
                symbol: sym,
                name: "Trial Stock",
                weight: remaining
            });
            trialInput.value = '';
            renderBacktestSandbox();
        });
    }
    
    const runBacktestBtn = document.getElementById('run-backtest-btn');
    if (runBacktestBtn) {
        runBacktestBtn.addEventListener('click', runPortfolioBacktest);
    }
    
    // Sync active ledger button listener
    const syncLedgerBtn = document.getElementById('backtest-sync-ledger-btn');
    if (syncLedgerBtn) {
        syncLedgerBtn.addEventListener('click', async () => {
            await syncLedgerToBacktestSandbox();
            showToast("Sandbox weights loaded from active portfolio ledger.", "info");
        });
    }

    // Clear all button listener
    const clearAllBtn = document.getElementById('backtest-clear-all-btn');
    if (clearAllBtn) {
        clearAllBtn.addEventListener('click', () => {
            backtestSandboxStocks = [];
            renderBacktestSandbox();
            showToast("Sandbox portfolio cleared.", "info");
        });
    }
    
    // Watch for theme/resize changes to dynamically update chart bounds
    window.addEventListener('resize', () => {
        if (window.activeBacktestLightweightChart) {
            const container = document.getElementById('backtest-chart-container');
            if (container) {
                window.activeBacktestLightweightChart.resize(container.clientWidth || 600, 300);
            }
            updateBacktestChartThemeColors();
        } else if (backtestChartInstance) {
            updateBacktestChartThemeColors();
        }
    });
}

async function syncLedgerToBacktestSandbox() {
    try {
        // Fetch current active portfolio items
        const response = await fetch('/api/portfolio');
        if (!response.ok) throw new Error("Failed to load portfolio details.");
        const portfolioItems = await response.json();
        
        if (portfolioItems.length === 0) {
            backtestSandboxStocks = [];
            renderBacktestSandbox();
            return;
        }
        
        // Calculate allocations based on current valuation: quantity * current_price, aggregated by symbol
        const aggregatedMap = new Map();
        let totalVal = 0;
        portfolioItems.forEach(item => {
            const price = item.current_price || item.purchase_price || 100;
            const itemVal = item.quantity * price;
            totalVal += itemVal;
            
            if (aggregatedMap.has(item.symbol)) {
                const existing = aggregatedMap.get(item.symbol);
                existing.current_value += itemVal;
            } else {
                aggregatedMap.set(item.symbol, {
                    symbol: item.symbol,
                    name: item.name || item.symbol,
                    current_value: itemVal
                });
            }
        });
        const itemsWithVal = Array.from(aggregatedMap.values());
        
        // Populate weights (normalize to sum to 100)
        let accumulatedWeight = 0;
        backtestSandboxStocks = itemsWithVal.map((item, idx) => {
            let weight = 0;
            if (totalVal > 0) {
                if (idx === itemsWithVal.length - 1) {
                    weight = Math.round((100 - accumulatedWeight) * 100) / 100;
                } else {
                    weight = Math.round((item.current_value / totalVal) * 100 * 100) / 100;
                    accumulatedWeight += weight;
                }
            } else {
                weight = Math.round((100 / itemsWithVal.length) * 100) / 100;
            }
            return {
                symbol: item.symbol,
                name: item.name,
                weight: weight
            };
        });
        
        renderBacktestSandbox();
    } catch (e) {
        console.error("Sync portfolio to backtest error:", e);
        showToast("Could not import holdings ledger: " + e.message, "error");
    }
}

function renderBacktestSandbox() {
    const sandboxBody = document.getElementById('backtest-sandbox-body');
    if (!sandboxBody) return;
    
    sandboxBody.innerHTML = '';
    
    if (backtestSandboxStocks.length === 0) {
        sandboxBody.innerHTML = '<tr><td colspan="3" class="center-text text-muted" style="padding: 20px;">No assets selected. Add experimental tickers above or sync active holdings to initialize.</td></tr>';
        validateSandboxAllocation();
        return;
    }
    
    backtestSandboxStocks.forEach((stock, index) => {
        const tr = document.createElement('tr');
        tr.style.borderBottom = '1px solid var(--border-glass)';
        
        tr.innerHTML = `
            <td style="padding: 10px;">
                <strong>${stock.symbol}</strong><br>
                <span style="font-size: 10px; color: var(--text-muted);">${stock.name}</span>
            </td>
            <td style="padding: 10px; text-align: right;">
                <input type="number" min="0" max="100" step="1" value="${stock.weight}" class="backtest-weight-input" style="padding: 4px 8px; font-size:11px; border-radius: 4px; background: rgba(0,0,0,0.3); color: var(--text-primary); border: 1px solid var(--border-glass); width: 80px; text-align: right;">
            </td>
            <td style="padding: 10px; text-align: center;">
                <button class="btn-secondary" style="font-size: 10px; padding: 2px 6px; height: auto; border-radius: 4px; color: var(--color-crimson); border-color: rgba(239,68,68,0.2);" onclick="deleteSandboxAsset(${index})">Delete</button>
            </td>
        `;
        
        // Listen to weight input changes
        const weightInput = tr.querySelector('.backtest-weight-input');
        if (weightInput) {
            weightInput.addEventListener('input', () => {
                let val = parseFloat(weightInput.value);
                if (isNaN(val) || val < 0) val = 0;
                if (val > 100) val = 100;
                backtestSandboxStocks[index].weight = val;
                validateSandboxAllocation();
            });
        }
        
        sandboxBody.appendChild(tr);
    });
    
    validateSandboxAllocation();
}

window.deleteSandboxAsset = function(index) {
    backtestSandboxStocks.splice(index, 1);
    renderBacktestSandbox();
};

function validateSandboxAllocation() {
    const totalWeightLabel = document.getElementById('backtest-total-weight-label');
    const validationBadge = document.getElementById('backtest-validation-badge');
    const validationText = document.getElementById('backtest-validation-text');
    const runBtn = document.getElementById('run-backtest-btn');
    
    if (!totalWeightLabel || !validationBadge || !validationText || !runBtn) return;
    
    const sum = Math.round(backtestSandboxStocks.reduce((sum, s) => sum + s.weight, 0) * 100) / 100;
    totalWeightLabel.innerText = sum + '%';
    
    if (sum === 100) {
        validationBadge.style.background = 'rgba(16, 185, 129, 0.15)';
        validationBadge.style.borderColor = 'rgba(16, 185, 129, 0.3)';
        validationBadge.style.color = '#10b981';
        validationBadge.innerText = 'Valid Weights';
        
        totalWeightLabel.style.color = '#10b981';
        validationText.innerHTML = `Allocated: <strong style="color: #10b981;">100%</strong>. Weights match target constraints. Ready to simulate.`;
        
        runBtn.disabled = false;
        runBtn.style.opacity = '1.0';
        runBtn.style.cursor = 'pointer';
    } else {
        validationBadge.style.background = 'rgba(239, 68, 68, 0.15)';
        validationBadge.style.borderColor = 'rgba(239, 68, 68, 0.3)';
        validationBadge.style.color = '#ef4444';
        validationBadge.innerText = 'Weight Mismatch';
        
        totalWeightLabel.style.color = '#ef4444';
        validationText.innerHTML = `Allocated: <strong style="color: #ef4444;">${sum}%</strong>. Weights must equal 100% to run simulation.`;
        
        runBtn.disabled = true;
        runBtn.style.opacity = '0.5';
        runBtn.style.cursor = 'not-allowed';
    }
}

async function runPortfolioBacktest() {
    const runBtn = document.getElementById('run-backtest-btn');
    const startDateInput = document.getElementById('backtest-start-date');
    const endDateInput = document.getElementById('backtest-end-date');
    const rebalanceSelect = document.getElementById('backtest-rebalance-select');
    const capitalInput = document.getElementById('backtest-capital');
    const feeSlider = document.getElementById('backtest-fee');
    
    const resultsContainer = document.getElementById('backtest-results-container');
    const warningBox = document.getElementById('backtest-warning-box');
    const warningText = document.getElementById('backtest-warning-text');
    const summaryBlock = document.getElementById('backtest-summary-block');
    const summaryText = document.getElementById('backtest-summary-text');
    
    if (backtestSandboxStocks.length === 0) return;
    
    const sum = backtestSandboxStocks.reduce((sum, s) => sum + s.weight, 0);
    if (Math.round(sum) !== 100) {
        showToast("Sum of weights must equal 100%.", "warning");
        return;
    }
    
    runBtn.disabled = true;
    runBtn.innerText = "Simulating...";
    runBtn.style.opacity = '0.7';
    
    if (warningBox) warningBox.style.display = 'none';
    if (resultsContainer) resultsContainer.style.display = 'none';
    
    try {
        const payload = {
            tickers: backtestSandboxStocks.map(s => s.symbol),
            weights: backtestSandboxStocks.map(s => s.weight),
            start_date: startDateInput.value,
            end_date: endDateInput.value,
            rebalance_freq: rebalanceSelect.value,
            starting_capital: parseFloat(capitalInput.value),
            transaction_fee_pct: parseFloat(feeSlider.value)
        };
        
        const response = await fetch('/api/portfolio/backtest', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        
        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.detail || "Backtest failed.");
        }
        
        const data = await response.json();
        
        // 1. Check for warnings
        if (data.warnings && data.warnings.length > 0) {
            if (warningBox && warningText) {
                warningText.innerText = data.warnings.join(' ');
                warningBox.style.display = 'block';
            }
        }
        
        // 2. Render comparative metrics table
        const safeFormatVal = (val, formatFn) => {
            return (val !== null && val !== undefined) ? formatFn(val) : '--';
        };
        
        document.getElementById('backtest-final-val').innerText = safeFormatVal(data.metrics.portfolio.final_value, v => '₹' + v.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2}));
        document.getElementById('bench-final-val').innerText = safeFormatVal(data.metrics.benchmark.final_value, v => '₹' + v.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2}));
        
        document.getElementById('backtest-cagr').innerText = safeFormatVal(data.metrics.portfolio.cagr, v => v + '%');
        document.getElementById('bench-cagr').innerText = safeFormatVal(data.metrics.benchmark.cagr, v => v + '%');
        
        document.getElementById('backtest-max-dd').innerText = safeFormatVal(data.metrics.portfolio.max_drawdown, v => v + '%');
        document.getElementById('bench-max-dd').innerText = safeFormatVal(data.metrics.benchmark.max_drawdown, v => v + '%');
        
        document.getElementById('backtest-volatility').innerText = safeFormatVal(data.metrics.portfolio.volatility, v => v + '%');
        document.getElementById('bench-volatility').innerText = safeFormatVal(data.metrics.benchmark.volatility, v => v + '%');
        
        document.getElementById('backtest-sharpe').innerText = safeFormatVal(data.metrics.portfolio.sharpe_ratio, v => v);
        document.getElementById('bench-sharpe').innerText = safeFormatVal(data.metrics.benchmark.sharpe_ratio, v => v);
        
        document.getElementById('backtest-dividends').innerText = safeFormatVal(data.metrics.portfolio.total_dividends, v => '₹' + v.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2}));
        document.getElementById('backtest-fees-paid').innerText = safeFormatVal(data.metrics.portfolio.total_fees, v => '₹' + v.toLocaleString('en-IN', {minimumFractionDigits: 2, maximumFractionDigits: 2}));
        
        // Render Rebalancing Transaction Ledger
        const ledgerBlock = document.getElementById('backtest-rebalance-ledger-block');
        const ledgerText = document.getElementById('backtest-rebalance-ledger-text');
        const ledgerCount = document.getElementById('backtest-rebalance-ledger-count');
        const ledgerArrow = document.getElementById('backtest-rebalance-ledger-arrow');
        
        if (ledgerBlock && ledgerText) {
            const rebalHistory = data.metrics.rebalancing_history || [];
            if (rebalHistory.length > 0) {
                ledgerCount.innerText = `${rebalHistory.length} Rebalance${rebalHistory.length > 1 ? 's' : ''}`;
                
                // Initialize block to expanded state
                ledgerText.style.display = 'block';
                if (ledgerArrow) ledgerArrow.style.transform = 'rotate(90deg)';
                const header = document.getElementById('backtest-rebalance-ledger-header');
                if (header) {
                    header.style.marginBottom = '12px';
                    header.style.borderBottom = '1px dashed var(--border-glass)';
                }
                
                let html = '<div style="display: flex; flex-direction: column; gap: 10px; margin-top: 8px;">';
                rebalHistory.forEach((event, idx) => {
                    const isFirst = idx === 0;
                    html += `
                        <div style="background: rgba(255, 255, 255, 0.01); border: 1px solid var(--border-glass); border-radius: 6px; overflow: hidden;">
                            <div class="rebalance-event-header" style="display: flex; justify-content: space-between; align-items: center; padding: 10px 14px; background: rgba(255,255,255,0.02); cursor: pointer; user-select: none; transition: background 0.2s;" onclick="toggleRebalanceEventDetails(${idx})">
                                <div style="display: flex; align-items: center; gap: 8px;">
                                    <span id="rebalance-collapse-arrow-${idx}" style="font-size: 8px; transition: transform 0.2s; display: inline-block; transform: ${isFirst ? 'rotate(90deg)' : 'rotate(0deg)'}; color: var(--text-muted);">▶</span>
                                    <strong style="color: var(--text-primary); font-size: 11.5px;">📅 Date: ${event.date}</strong>
                                    <span style="font-size: 10px; color: var(--text-muted);">(${event.trades.length} trade${event.trades.length > 1 ? 's' : ''})</span>
                                </div>
                                <div style="display: flex; align-items: center; gap: 12px;">
                                    <span style="font-size: 10.5px; color: var(--neon-green); font-weight: 600;">Fees: ₹${event.fees.toFixed(2)}</span>
                                </div>
                            </div>
                            <div id="rebalance-event-details-${idx}" style="padding: 10px 14px; border-top: 1px solid var(--border-glass); display: ${isFirst ? 'block' : 'none'};">
                                <div class="table-scroll" style="border: 1px solid rgba(255,255,255,0.04); border-radius: 4px; overflow: hidden;">
                                    <table style="width: 100%; border-collapse: collapse; text-align: left; font-size: 11px; line-height: 1.4;">
                                        <thead>
                                            <tr style="background: rgba(255,255,255,0.03); border-bottom: 1px solid rgba(255,255,255,0.06);">
                                                <th style="padding: 6px 10px; color: var(--text-secondary); font-weight: 600;">Stock</th>
                                                <th style="padding: 6px 10px; color: var(--text-secondary); font-weight: 600;">Action</th>
                                                <th style="padding: 6px 10px; color: var(--text-secondary); text-align: right; font-weight: 600;">Shares</th>
                                                <th style="padding: 6px 10px; color: var(--text-secondary); text-align: right; font-weight: 600;">Price</th>
                                                <th style="padding: 6px 10px; color: var(--text-secondary); text-align: right; font-weight: 600;">Total Value</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                    `;
                    
                    event.trades.forEach(t => {
                        const isBuy = t.action === "BUY";
                        const actionBadge = isBuy 
                            ? `<span style="background: rgba(16, 185, 129, 0.15); color: #10b981; padding: 1px 6px; border-radius: 4px; font-weight: 700; font-size: 9px;">BUY</span>`
                            : `<span style="background: rgba(239, 68, 68, 0.15); color: #ef4444; padding: 1px 6px; border-radius: 4px; font-weight: 700; font-size: 9px;">SELL</span>`;
                        
                        html += `
                                            <tr style="border-bottom: 1px solid rgba(255,255,255,0.03);">
                                                <td style="padding: 6px 10px; font-weight: 700; color: var(--text-primary);">${t.ticker}</td>
                                                <td style="padding: 6px 10px;">${actionBadge}</td>
                                                <td style="padding: 6px 10px; text-align: right; color: var(--text-primary);">${t.shares.toLocaleString('en-IN')}</td>
                                                <td style="padding: 6px 10px; text-align: right; color: var(--text-secondary);">₹${t.price.toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                                                <td style="padding: 6px 10px; text-align: right; color: var(--text-primary); font-weight: 600;">₹${t.value.toLocaleString('en-IN', {minimumFractionDigits: 2})}</td>
                                            </tr>
                        `;
                    });
                    
                    html += `
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    `;
                });
                html += '</div>';
                
                ledgerText.innerHTML = html;
                ledgerBlock.style.display = 'block';
            } else {
                ledgerBlock.style.display = 'none';
            }
        }
        
        // 3. Render Chart
        if (resultsContainer) resultsContainer.style.display = 'block';
        renderBacktestChart(data);
        
        // 4. Trigger LLM summary synthesis
        if (summaryText) {
            summaryText.innerHTML = `
                <div style="display: flex; align-items: center; gap: 8px; padding: 10px 0;">
                    <div class="spinner" style="width:16px; height:16px; border-width:2px; border-top-color:#3b82f6;"></div>
                    <span style="font-size:11.5px; color:var(--text-secondary);">Equities Advisor is synthesizing backtesting metrics...</span>
                </div>
            `;
            
            try {
                const synthPayload = {
                    metrics: data.metrics,
                    tickers_weights: backtestSandboxStocks.map(s => ({ symbol: s.symbol, weight: s.weight }))
                };
                
                const synthResponse = await fetch('/api/portfolio/backtest-synthesis', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(synthPayload)
                });
                
                if (synthResponse.ok) {
                    const synthData = await synthResponse.json();
                    summaryText.innerHTML = synthData.synthesis
                        .replace(/\*\*(.*?)\*\*/g, '<strong style="color:var(--text-primary);">$1</strong>')
                        .replace(/\*(.*?)\*/g, '<em>$1</em>')
                        .replace(/\n/g, '<br>');
                } else {
                    throw new Error("Synthesis API failed.");
                }
            } catch (err) {
                console.error("Backtest synthesis error:", err);
                summaryText.innerHTML = `<span style="color:#ef4444; font-size:11.5px;">Unable to fetch AI Advisor summary. Please review the table metrics above.</span>`;
            }
        }
        
    } catch (e) {
        console.error(e);
        showToast("Error running simulation: " + e.message, "error");
    } finally {
        runBtn.disabled = false;
        runBtn.innerText = "Run Backtest Simulation";
        runBtn.style.opacity = '1.0';
    }
}

function renderBacktestChart(data) {
    const container = document.getElementById('backtest-chart-container');
    if (!container) return;

    // Check if TradingView Lightweight Charts is available
    if (typeof LightweightCharts === 'undefined') {
        console.warn("TradingView Lightweight Charts offline, falling back to Chart.js for backtest chart.");
        drawChartJSBacktestChart(data);
        return;
    }

    // Clean up previous Lightweight Chart instance
    if (window.activeBacktestLightweightChart) {
        window.activeBacktestLightweightChart.remove();
        window.activeBacktestLightweightChart = null;
    }
    
    // Clean up legacy Chart.js chart if exists
    if (backtestChartInstance) {
        backtestChartInstance.destroy();
        backtestChartInstance = null;
    }

    container.innerHTML = ''; // Clear container
    const isDarkTheme = document.documentElement.getAttribute('data-theme') !== 'light';

    // 1. Initialize TradingView Chart
    const chart = LightweightCharts.createChart(container, {
        width: container.clientWidth || 600,
        height: 300,
        layout: {
            background: { type: 'solid', color: 'transparent' },
            textColor: isDarkTheme ? '#94a3b8' : '#334155',
            fontFamily: 'Inter, sans-serif',
        },
        grid: {
            vertLines: { color: isDarkTheme ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.03)' },
            horzLines: { color: isDarkTheme ? 'rgba(255,255,255,0.02)' : 'rgba(0,0,0,0.03)' },
        },
        crosshair: {
            mode: LightweightCharts.CrosshairMode.Normal,
        },
        rightPriceScale: {
            borderColor: isDarkTheme ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
        },
        timeScale: {
            borderColor: isDarkTheme ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)',
            timeVisible: false,
        },
    });
    window.activeBacktestLightweightChart = chart;

    // 2. Add Area Series for Custom Portfolio
    const portfolioSeries = chart.addAreaSeries({
        topColor: 'rgba(59, 130, 246, 0.45)',
        bottomColor: 'rgba(59, 130, 246, 0.0)',
        lineColor: '#3b82f6',
        lineWidth: 2.5,
        priceFormat: {
            type: 'custom',
            formatter: price => '₹' + price.toLocaleString('en-IN', { maximumFractionDigits: 0 }),
        },
        title: 'Portfolio',
    });

    // 3. Add Line Series for Nifty 50 Index
    const benchmarkSeries = chart.addLineSeries({
        color: isDarkTheme ? 'rgba(156, 163, 175, 0.6)' : 'rgba(75, 85, 99, 0.7)',
        lineWidth: 1.5,
        lineStyle: LightweightCharts.LineStyle.Dashed,
        priceFormat: {
            type: 'custom',
            formatter: price => '₹' + price.toLocaleString('en-IN', { maximumFractionDigits: 0 }),
        },
        title: 'Nifty 50',
    });

    // 4. Map and set data
    const portfolioData = [];
    const benchmarkData = [];
    for (let i = 0; i < data.dates.length; i++) {
        const dateStr = data.dates[i].split('T')[0];
        portfolioData.push({ time: dateStr, value: data.portfolio_values[i] });
        benchmarkData.push({ time: dateStr, value: data.benchmark_values[i] });
    }

    portfolioSeries.setData(portfolioData);
    benchmarkSeries.setData(benchmarkData);
    chart.timeScale().fitContent();
}

function drawChartJSBacktestChart(data) {
    const container = document.getElementById('backtest-chart-container');
    if (!container) return;

    const restoredCanvas = getOrCreateCanvas('backtest-chart', container);
    if (!restoredCanvas) return;

    const ctx = restoredCanvas.getContext('2d');
    if (backtestChartInstance) {
        backtestChartInstance.destroy();
    }
    
    const activeTheme = document.documentElement.getAttribute('data-theme') || 'dark';
    const gridColor = activeTheme === 'light' ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.06)';
    const textColor = activeTheme === 'light' ? '#334155' : '#f8fafc';
    
    backtestChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: data.dates,
            datasets: [
                {
                    label: 'Custom Portfolio',
                    data: data.portfolio_values,
                    borderColor: '#3b82f6',
                    borderWidth: 2,
                    backgroundColor: 'rgba(59, 130, 246, 0.05)',
                    fill: true,
                    tension: 0.15,
                    pointRadius: 0
                },
                {
                    label: 'Nifty 50 Index',
                    data: data.benchmark_values,
                    borderColor: '#9ca3af',
                    borderWidth: 1.5,
                    borderDash: [5, 5],
                    backgroundColor: 'transparent',
                    fill: false,
                    tension: 0.1,
                    pointRadius: 0
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true,
                    labels: { color: textColor, font: { family: 'Inter', size: 10 } }
                }
            },
            scales: {
                x: {
                    grid: { color: gridColor },
                    ticks: { color: textColor, font: { family: 'Inter', size: 9 } }
                },
                y: {
                    grid: { color: gridColor },
                    ticks: {
                        color: textColor,
                        font: { family: 'Inter', size: 9 },
                        callback: function(value) {
                            return '₹' + value.toLocaleString('en-IN');
                        }
                    }
                }
            }
        }
    });
}

function updateBacktestChartThemeColors() {
    const activeTheme = document.documentElement.getAttribute('data-theme') || 'dark';
    const isLightTheme = activeTheme === 'light';

    if (window.activeBacktestLightweightChart) {
        window.activeBacktestLightweightChart.applyOptions({
            layout: {
                textColor: isLightTheme ? '#334155' : '#94a3b8',
            },
            grid: {
                vertLines: { color: isLightTheme ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.02)' },
                horzLines: { color: isLightTheme ? 'rgba(0,0,0,0.03)' : 'rgba(255,255,255,0.02)' },
            },
            rightPriceScale: {
                borderColor: isLightTheme ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)',
            },
            timeScale: {
                borderColor: isLightTheme ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)',
            },
        });
        return;
    }

    if (!backtestChartInstance) return;
    
    const gridColor = isLightTheme ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.06)';
    const textColor = isLightTheme ? '#334155' : '#f8fafc';
    
    backtestChartInstance.options.plugins.legend.labels.color = textColor;
    backtestChartInstance.options.scales.x.grid.color = gridColor;
    backtestChartInstance.options.scales.x.ticks.color = textColor;
    backtestChartInstance.options.scales.y.grid.color = gridColor;
    backtestChartInstance.options.scales.y.ticks.color = textColor;
    
    backtestChartInstance.update();
}

window.toggleRebalanceEventDetails = function(idx) {
    const details = document.getElementById(`rebalance-event-details-${idx}`);
    const arrow = document.getElementById(`rebalance-collapse-arrow-${idx}`);
    if (details && arrow) {
        const isCollapsed = details.style.display === 'none';
        details.style.display = isCollapsed ? 'block' : 'none';
        arrow.style.transform = isCollapsed ? 'rotate(90deg)' : 'rotate(0deg)';
    }
};

// ==========================================
// CAPM Risk Analytics (Alpha & Beta)
// ==========================================
function setupRiskAnalytics() {
    const benchmarkSelect = document.getElementById('risk-benchmark-select');
    if (benchmarkSelect) {
        benchmarkSelect.addEventListener('change', () => {
            if (activeStockProfile && activeStockProfile.ticker) {
                const activePeriodBtn = document.querySelector('.risk-horizon-btn.active');
                const period = activePeriodBtn ? activePeriodBtn.getAttribute('data-period') : '1y';
                loadRiskFactorsData(activeStockProfile.ticker, benchmarkSelect.value, period);
            }
        });
    }

    const horizonBtns = document.querySelectorAll('.risk-horizon-btn');
    horizonBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            const period = btn.getAttribute('data-period');
            const activePeriodBtn = document.querySelector('.risk-horizon-btn.active');
            if (activePeriodBtn === btn) return; // already active
            
            horizonBtns.forEach(b => {
                if (b === btn) {
                    b.classList.add('active');
                    b.style.background = 'var(--color-primary)';
                    b.style.color = '#fff';
                } else {
                    b.classList.remove('active');
                    b.style.background = 'transparent';
                    b.style.color = 'var(--text-muted)';
                }
            });
            
            if (activeStockProfile && activeStockProfile.ticker) {
                const benchmark = benchmarkSelect ? benchmarkSelect.value : '^NSEI';
                loadRiskFactorsData(activeStockProfile.ticker, benchmark, period);
            }
        });
    });

    const rfSlider = document.getElementById('risk-rf-slider');
    if (rfSlider) {
        rfSlider.addEventListener('input', () => {
            recalculateAlphaClientSide();
        });
    }

    const aiBtn = document.getElementById('generate-risk-synthesis-btn');
    if (aiBtn) {
        aiBtn.addEventListener('click', async () => {
            if (!activeStockProfile || !activeStockProfile.ticker) {
                showToast("Please load a stock first.", "error");
                return;
            }
            
            const symbol = activeStockProfile.ticker;
            const beta = currentRiskData.beta;
            
            const rfVal = rfSlider ? parseFloat(rfSlider.value) : 7.0;
            const annualStock = currentRiskData.annual_stock_ret;
            const annualBench = currentRiskData.annual_bench_ret;
            const alpha = annualStock - (rfVal + beta * (annualBench - rfVal));
            const correlation = currentRiskData.correlation;
            
            const activePeriodBtn = document.querySelector('.risk-horizon-btn.active');
            const periodText = activePeriodBtn ? activePeriodBtn.innerText : '1Y';
            
            const riskProfile = document.getElementById('profile-risk')?.value || 'Moderate';
            const investmentHorizon = document.getElementById('profile-horizon')?.value || 'Medium Term';
            
            const textEl = document.getElementById('risk-synthesis-text');
            if (textEl) {
                textEl.innerHTML = `<span style="color:var(--text-muted);">Consulting CIO risk model for ${symbol}...</span>`;
            }
            
            aiBtn.setAttribute('disabled', 'true');
            aiBtn.innerText = 'Synthesizing...';
            
            try {
                const response = await fetch('/api/analyze/risk-synthesis', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        symbol: symbol,
                        beta: beta,
                        alpha: alpha,
                        correlation: correlation,
                        horizon: periodText,
                        risk_profile: riskProfile,
                        investment_horizon: investmentHorizon
                    })
                });
                if (!response.ok) throw new Error("Synthesis failed.");
                const data = await response.json();
                
                if (textEl) {
                    textEl.innerHTML = data.synthesis;
                }
            } catch (e) {
                showToast("AI Risk Synthesis error: " + e.message, 'error');
                if (textEl) {
                    textEl.innerHTML = `<span style="color:#f43f5e;">Error synthesizing risk analysis: ${e.message}</span>`;
                }
            } finally {
                aiBtn.removeAttribute('disabled');
                aiBtn.innerText = '🔬 Generate AI Risk Analysis';
            }
        });
    }
}

async function loadRiskFactorsData(symbol, benchmark = null, period = null) {
    if (!symbol) return;
    
    const benchmarkSelect = document.getElementById('risk-benchmark-select');
    const activeBenchmark = benchmark || (benchmarkSelect ? benchmarkSelect.value : '^NSEI');
    
    const activePeriodBtn = document.querySelector('.risk-horizon-btn.active');
    const activePeriod = period || (activePeriodBtn ? activePeriodBtn.getAttribute('data-period') : '1y');
    
    if (benchmarkSelect && benchmarkSelect.value !== activeBenchmark) {
        benchmarkSelect.value = activeBenchmark;
    }
    
    if (activePeriod) {
        const horizonBtns = document.querySelectorAll('.risk-horizon-btn');
        horizonBtns.forEach(btn => {
            if (btn.getAttribute('data-period') === activePeriod) {
                btn.classList.add('active');
                btn.style.background = 'var(--color-primary)';
                btn.style.color = '#fff';
            } else {
                btn.classList.remove('active');
                btn.style.background = 'transparent';
                btn.style.color = 'var(--text-muted)';
            }
        });
    }

    const synthesisText = document.getElementById('risk-synthesis-text');
    if (synthesisText) {
        synthesisText.innerText = "Adjust inputs and click the button to synthesize target portfolio risk exposure...";
    }
    
    try {
        const response = await fetch(`/api/analyze/risk-factors?symbol=${encodeURIComponent(symbol)}&benchmark=${encodeURIComponent(activeBenchmark)}&period=${encodeURIComponent(activePeriod)}`);
        if (!response.ok) throw new Error("Failed to fetch risk factors.");
        
        const data = await response.json();
        
        currentRiskData.beta = data.beta;
        currentRiskData.annual_stock_ret = data.annual_stock_ret;
        currentRiskData.annual_bench_ret = data.annual_bench_ret;
        currentRiskData.correlation = data.correlation;
        
        const betaValEl = document.getElementById('risk-beta-value');
        const betaLabelEl = document.getElementById('risk-beta-label');
        if (betaValEl) {
            betaValEl.innerText = data.beta.toFixed(3);
            if (data.beta < 0.95) {
                betaLabelEl.innerText = "Defensive";
                betaLabelEl.style.color = 'var(--color-emerald)';
            } else if (data.beta >= 0.95 && data.beta <= 1.05) {
                betaLabelEl.innerText = "Market Equivalent";
                betaLabelEl.style.color = 'var(--text-secondary)';
            } else {
                betaLabelEl.innerText = "High Volatility";
                betaLabelEl.style.color = '#f59e0b';
            }
        }
        
        const corrValEl = document.getElementById('risk-corr-value');
        const corrLabelEl = document.getElementById('risk-corr-label');
        if (corrValEl) {
            corrValEl.innerText = data.correlation.toFixed(3);
            const absCorr = Math.abs(data.correlation);
            if (absCorr >= 0.7) {
                corrLabelEl.innerText = "Strong Market Sync";
                corrLabelEl.style.color = '#38bdf8';
            } else if (absCorr >= 0.4) {
                corrLabelEl.innerText = "Moderate Sync";
                corrLabelEl.style.color = 'var(--text-secondary)';
            } else {
                corrLabelEl.innerText = "De-correlated";
                corrLabelEl.style.color = 'var(--text-muted)';
            }
        }
        
        recalculateAlphaClientSide();
        drawRiskScatterChart(data.scatter_points, data.beta);
        
    } catch (e) {
        showToast("Error loading CAPM Risk data: " + e.message, "error");
        console.error(e);
    }
}

function recalculateAlphaClientSide() {
    const rfSlider = document.getElementById('risk-rf-slider');
    const rfVal = rfSlider ? parseFloat(rfSlider.value) : 7.0;
    
    const rfLabel = document.getElementById('risk-rf-val');
    if (rfLabel) {
        rfLabel.innerText = `${rfVal.toFixed(1)}%`;
    }
    
    const beta = currentRiskData.beta;
    const annualStock = currentRiskData.annual_stock_ret;
    const annualBench = currentRiskData.annual_bench_ret;
    
    const alpha = annualStock - (rfVal + beta * (annualBench - rfVal));
    
    const alphaValueEl = document.getElementById('risk-alpha-value');
    const alphaLabelEl = document.getElementById('risk-alpha-label');
    
    if (alphaValueEl) {
        alphaValueEl.innerText = `${alpha >= 0 ? '+' : ''}${alpha.toFixed(2)}%`;
        if (alpha > 0) {
            alphaValueEl.style.color = 'var(--color-emerald)';
            if (alphaLabelEl) {
                alphaLabelEl.innerText = 'Value Creator';
                alphaLabelEl.style.color = 'var(--color-emerald)';
            }
        } else if (alpha < 0) {
            alphaValueEl.style.color = '#f43f5e';
            if (alphaLabelEl) {
                alphaLabelEl.innerText = 'Value Destroyer';
                alphaLabelEl.style.color = '#f43f5e';
            }
        } else {
            alphaValueEl.style.color = 'var(--text-primary)';
            if (alphaLabelEl) {
                alphaLabelEl.innerText = 'Value Neutral';
                alphaLabelEl.style.color = 'var(--text-muted)';
            }
        }
    }
}

function drawRiskScatterChart(points, beta) {
    const canvas = document.getElementById('risk-scatter-chart');
    if (!canvas) return;

    if (activeRiskChartInstance) {
        activeRiskChartInstance.destroy();
    }

    if (points.length < 2) return;

    let xMin = points[0].x;
    let xMax = points[0].x;
    let sumX = 0;
    let sumY = 0;

    for (let i = 0; i < points.length; i++) {
        const pt = points[i];
        if (pt.x < xMin) xMin = pt.x;
        if (pt.x > xMax) xMax = pt.x;
        sumX += pt.x;
        sumY += pt.y;
    }

    const n = points.length;
    const meanX = sumX / n;
    const meanY = sumY / n;
    const intercept = meanY - beta * meanX;

    const yStart = beta * xMin + intercept;
    const yEnd = beta * xMax + intercept;

    const regressionLine = [
        { x: xMin, y: yStart },
        { x: xMax, y: yEnd }
    ];

    const ctx = canvas.getContext('2d');
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
    const isLightTheme = currentTheme === 'light';

    const textColor = isLightTheme ? '#4b5563' : '#94a3b8';
    const gridColor = isLightTheme ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.03)';
    const pointColor = isLightTheme ? 'rgba(59, 130, 246, 0.5)' : 'rgba(0, 229, 255, 0.5)';
    const lineColor = isLightTheme ? '#ef4444' : '#f43f5e';

    activeRiskChartInstance = new Chart(ctx, {
        type: 'scatter',
        data: {
            datasets: [
                {
                    label: 'Daily Returns',
                    data: points,
                    backgroundColor: pointColor,
                    pointRadius: 3.5,
                    pointHoverRadius: 5.5,
                    borderWidth: 0
                },
                {
                    type: 'line',
                    label: `Regression Trendline (Beta: ${beta.toFixed(2)})`,
                    data: regressionLine,
                    borderColor: lineColor,
                    borderWidth: 2,
                    pointRadius: 0,
                    fill: false,
                    showLine: true,
                    tension: 0
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'top',
                    labels: {
                        color: textColor,
                        boxWidth: 8,
                        boxHeight: 8,
                        padding: 8,
                        font: { size: 9, weight: 500 }
                    }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            if (context.datasetIndex === 1) {
                                return `Trend: Bench ${context.parsed.x.toFixed(2)}% -> Stock ${context.parsed.y.toFixed(2)}%`;
                            }
                            const raw = context.raw;
                            if (raw && raw.date) {
                                return `${raw.date} | Bench: ${raw.x.toFixed(2)}%, Stock: ${raw.y.toFixed(2)}%`;
                            }
                            return `Bench: ${context.parsed.x.toFixed(2)}%, Stock: ${context.parsed.y.toFixed(2)}%`;
                        }
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: gridColor },
                    ticks: { color: textColor, font: { size: 8 } },
                    title: {
                        display: true,
                        text: 'Benchmark Daily Return (%)',
                        color: textColor,
                        font: { size: 9, weight: 600 }
                    }
                },
                y: {
                    grid: { color: gridColor },
                    ticks: { color: textColor, font: { size: 8 } },
                    title: {
                        display: true,
                        text: 'Stock Daily Return (%)',
                        color: textColor,
                        font: { size: 9, weight: 600 }
                    }
                }
            }
        }
    });
}

function updateRiskChartThemeColors() {
    if (!activeRiskChartInstance) return;
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'dark';
    const isLightTheme = currentTheme === 'light';
    
    const textColor = isLightTheme ? '#4b5563' : '#94a3b8';
    const gridColor = isLightTheme ? 'rgba(0, 0, 0, 0.06)' : 'rgba(255, 255, 255, 0.03)';
    const pointColor = isLightTheme ? 'rgba(59, 130, 246, 0.5)' : 'rgba(0, 229, 255, 0.5)';
    const lineColor = isLightTheme ? '#ef4444' : '#f43f5e';
    
    activeRiskChartInstance.data.datasets[0].backgroundColor = pointColor;
    activeRiskChartInstance.data.datasets[1].borderColor = lineColor;
    
    activeRiskChartInstance.options.scales.x.grid.color = gridColor;
    activeRiskChartInstance.options.scales.x.ticks.color = textColor;
    activeRiskChartInstance.options.scales.x.title.color = textColor;
    
    activeRiskChartInstance.options.scales.y.grid.color = gridColor;
    activeRiskChartInstance.options.scales.y.ticks.color = textColor;
    activeRiskChartInstance.options.scales.y.title.color = textColor;
    
    activeRiskChartInstance.options.plugins.legend.labels.color = textColor;
    
    activeRiskChartInstance.update();
}

window.loadRiskFactorsData = loadRiskFactorsData;

