/* 
   APEX Stock Workstation - Modernization JavaScript Layer
   Integrates GSAP, CountUp, Typed.js, Lucide, Web Audio Cues, Sparkles, and Magnetism
*/

(function() {
    console.log("APEX Modernizer: Initializing core visual upgrades...");

    const isCapacitor = window.hasOwnProperty('Capacitor') ||
        (window.Capacitor !== undefined) ||
        (window.parent && window.parent.hasOwnProperty('Capacitor'));
    const apiBaseUrl = isCapacitor ? 'https://my-stock-advisor.duckdns.org' : '';

    // Helper to parse numeric values from text
    function parseNumericValue(text) {
        if (!text) return 0;
        // Extract numbers, decimal dots, and minus signs
        const cleanText = text.replace(/[^\d.-]/g, '');
        const val = parseFloat(cleanText);
        return isNaN(val) ? 0 : val;
    }

    // ==================== 1. WEB AUDIO UI SONIFICATION ====================
    const AudioCueManager = {
        ctx: null,

        init() {
            // Unlock AudioContext on first user interaction (safari / chrome policies)
            const unlock = () => {
                try {
                    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
                    console.log("APEX Audio: Web Audio Context unlocked successfully.");
                } catch (e) {
                    console.warn("APEX Audio: Web Audio API not supported:", e);
                }
                document.removeEventListener('click', unlock);
                document.removeEventListener('keydown', unlock);
            };
            document.addEventListener('click', unlock);
            document.addEventListener('keydown', unlock);
        },

        playTick() {
            if (localStorage.getItem('apex-audio-muted') === 'true') return;
            if (!this.ctx) return;
            try {
                // Ensure context is running (resume if suspended by browser)
                if (this.ctx.state === 'suspended') {
                    this.ctx.resume();
                }
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                osc.connect(gain);
                gain.connect(this.ctx.destination);
                
                osc.type = 'sine';
                osc.frequency.setValueAtTime(1400, this.ctx.currentTime); // high freq mechanical click
                gain.gain.setValueAtTime(0.006, this.ctx.currentTime); // very low volume
                gain.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 0.02);
                
                osc.start();
                osc.stop(this.ctx.currentTime + 0.025);
            } catch (e) {}
        },

        playChime() {
            if (localStorage.getItem('apex-audio-muted') === 'true') return;
            if (!this.ctx) return;
            try {
                if (this.ctx.state === 'suspended') this.ctx.resume();
                const now = this.ctx.currentTime;
                
                // Arpeggio note 1
                const osc1 = this.ctx.createOscillator();
                const gain1 = this.ctx.createGain();
                osc1.connect(gain1);
                gain1.connect(this.ctx.destination);
                osc1.type = 'sine';
                osc1.frequency.setValueAtTime(523.25, now); // C5
                gain1.gain.setValueAtTime(0.008, now);
                gain1.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
                osc1.start(now);
                osc1.stop(now + 0.14);

                // Arpeggio note 2
                const osc2 = this.ctx.createOscillator();
                const gain2 = this.ctx.createGain();
                osc2.connect(gain2);
                gain2.connect(this.ctx.destination);
                osc2.type = 'sine';
                osc2.frequency.setValueAtTime(659.25, now + 0.07); // E5
                gain2.gain.setValueAtTime(0.008, now + 0.07);
                gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
                osc2.start(now + 0.07);
                osc2.stop(now + 0.24);
            } catch (e) {}
        },

        playAlert() {
            if (localStorage.getItem('apex-audio-muted') === 'true') return;
            if (!this.ctx) return;
            try {
                if (this.ctx.state === 'suspended') this.ctx.resume();
                const now = this.ctx.currentTime;
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                osc.connect(gain);
                gain.connect(this.ctx.destination);
                
                osc.type = 'triangle'; // softer sonar tone
                osc.frequency.setValueAtTime(140, now);
                osc.frequency.linearRampToValueAtTime(90, now + 0.35);
                gain.gain.setValueAtTime(0.012, now);
                gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.4);
                
                osc.start(now);
                osc.stop(now + 0.45);
            } catch (e) {}
        }
    };
    AudioCueManager.init();

    // ==================== 0. ROUTING INTERCEPTOR & TRANSITIONS ====================
    const originalSwitchTab = window.switchTab;
    if (originalSwitchTab) {
        window.switchTab = function(tabKey) {
            // Intercept mobile portfolio check
            if (tabKey === 'portfolio' && window.innerWidth <= 768) {
                const shieldEnabled = localStorage.getItem('portfolio-security-shield-enabled') !== 'false';
                if (shieldEnabled && !window.portfolioUnlocked) {
                    const pinOverlay = document.getElementById('portfolio-pin-overlay');
                    if (pinOverlay) {
                        pinOverlay.style.display = 'flex';
                        const pinTitle = pinOverlay.querySelector('.pin-title');
                        if (pinTitle) {
                            const hasPin = localStorage.getItem('portfolio-pin') !== null;
                            pinTitle.textContent = hasPin ? "Enter Security Passcode" : "Define Security Passcode";
                        }
                        const desktopLock = document.getElementById('portfolio-lock-overlay');
                        if (desktopLock) desktopLock.classList.add('hidden');
                        
                        // Let the tab display under the lock
                        if (typeof gsap !== 'undefined') {
                            playTabGSAPTransition(tabKey, originalSwitchTab);
                        } else {
                            originalSwitchTab(tabKey);
                        }
                        return;
                    }
                }
            }
            
            // Play audio click tick
            if (AudioCueManager && typeof AudioCueManager.playTick === 'function') {
                AudioCueManager.playTick();
            }
            
            // Play GSAP Transition
            if (typeof gsap !== 'undefined') {
                playTabGSAPTransition(tabKey, originalSwitchTab);
            } else {
                originalSwitchTab(tabKey);
            }
            
            // Highlight bottom nav active tab
            const bottomNav = document.querySelector('.mobile-bottom-nav');
            if (bottomNav) {
                bottomNav.querySelectorAll('.mobile-bottom-nav-item').forEach(item => {
                    item.classList.remove('active');
                });
                let navId = 'nav-terminal';
                if (tabKey === 'analyzer') navId = 'nav-terminal';
                else if (tabKey === 'screener') navId = 'nav-screener';
                else if (tabKey === 'watchlist') navId = 'nav-watchlist';
                else if (tabKey === 'portfolio') navId = 'nav-portfolio';
                const activeBtn = document.getElementById(navId);
                if (activeBtn) activeBtn.classList.add('active');
            }
        };
    }

    function playTabGSAPTransition(tabKey, realSwitch) {
        const activeTabEl = document.querySelector('.active-tab-content');
        if (activeTabEl && typeof gsap !== 'undefined') {
            gsap.to(activeTabEl, {
                opacity: 0,
                y: -8,
                duration: 0.12,
                ease: "power2.in",
                onComplete: () => {
                    realSwitch(tabKey);
                    const newActiveEl = document.querySelector('.active-tab-content');
                    if (newActiveEl) {
                        gsap.fromTo(newActiveEl, 
                            { opacity: 0, y: 12 },
                            { opacity: 1, y: 0, duration: 0.3, ease: "power2.out" }
                        );
                    }
                }
            });
        } else {
            realSwitch(tabKey);
        }
    }

    // ==================== 2. LUCIDE SVG ICONS SETUP ====================
    function setupLucideIcons() {
        if (typeof lucide === 'undefined') {
            console.warn("APEX Modernizer: Lucide library not loaded.");
            return;
        }

        // Navigation button icon maps
        const navIconMap = {
            'tab-analyzer-btn': 'line-chart',
            'tab-screener-btn': 'search',
            'tab-compare-btn': 'git-compare',
            'tab-universe-btn': 'database',
            'tab-movers-btn': 'trending-up',
            'tab-market-news-btn': 'rss',
            'tab-events-btn': 'calendar',
            'tab-trades-btn': 'briefcase',
            'tab-swing-scan-btn': 'zap',
            'tab-swing-btn': 'target',
            'tab-rule-scanner-btn': 'cpu',
            'tab-sector-radar-btn': 'activity',
            'tab-watchlist-btn': 'list',
            'tab-portfolio-btn': 'pie-chart',
            'tab-alerts-btn': 'bell',
            'tab-learning-btn': 'graduation-cap'
        };

        // Replace emojis in side navigations
        for (const [btnId, iconName] of Object.entries(navIconMap)) {
            const btn = document.getElementById(btnId);
            if (btn) {
                const iconSpan = btn.querySelector('.btn-icon');
                if (iconSpan) {
                    iconSpan.innerHTML = `<i data-lucide="${iconName}"></i>`;
                }
            }
        }

        // Replace category header emojis
        document.querySelectorAll('.nav-category-header').forEach(header => {
            const text = header.textContent;
            if (text.includes('Equities Workspace')) {
                header.innerHTML = `<i data-lucide="layout-dashboard" style="margin-right: 6px;"></i> Equities Workspace`;
            } else if (text.includes('Tactical Trading')) {
                header.innerHTML = `<i data-lucide="zap" style="margin-right: 6px;"></i> Tactical Trading`;
            } else if (text.includes('Portfolio & Alerts')) {
                header.innerHTML = `<i data-lucide="folder" style="margin-right: 6px;"></i> Portfolio & Alerts`;
            } else if (text.includes('Learning & Education')) {
                header.innerHTML = `<i data-lucide="book-open" style="margin-right: 6px;"></i> Learning & Education`;
            }
        });

        // Replace stock search text input icon 🔍 with crisp SVG Lucide Search Icon
        const searchIconEl = document.getElementById('analyzer-input-icon');
        if (searchIconEl) {
            searchIconEl.innerHTML = `<i data-lucide="search"></i>`;
        }

        // Initialize icons
        lucide.createIcons();
    }

    // ==================== 3. GSAP WORKSPACE TRANSITIONS ====================
    function setupGSAPTransitions() {
        console.log("APEX Modernizer: GSAP tab transitions dynamically handled by the property router wrapper.");
    }

    // ==================== 4. CHAT TYPEWRITER & BOUNCING SKELETON ====================
    function setupChatUpgrades() {
        const originalAppendChatMessage = window.appendChatMessage;
        if (originalAppendChatMessage && typeof Typed !== 'undefined') {
            window.appendChatMessage = function(role, content, useTypewriter = false) {
                // If this is the loading state, override elements with three bouncing dots
                if (role === 'assistant' && content === 'Consulting AI stock advisor...') {
                    const box = document.getElementById('chat-messages');
                    const msg = document.createElement('div');
                    const msgId = 'msg-loading-' + Math.random().toString(36).substr(2, 9);
                    msg.id = msgId;
                    msg.className = `chat-message assistant`;
                    msg.innerHTML = `
                        <div class="chat-typing-bubble" aria-label="AI is typing">
                            <span></span>
                            <span></span>
                            <span></span>
                        </div>
                        <span style="font-size: 10px; color: var(--text-muted); margin-top: 4px; display: block;">Consulting AI Advisor...</span>
                    `;
                    box.appendChild(msg);
                    box.scrollTo({ top: box.scrollHeight, behavior: 'smooth' });
                    return msgId;
                }

                // Call original logic for regular assistant & user messages
                const msgId = originalAppendChatMessage(role, content, useTypewriter);

                // Play success synth chime on assistant response
                if (role === 'assistant') {
                    AudioCueManager.playChime(); // Play success synth chime
                }
                return msgId;
            };
            console.log("APEX Modernizer: Chat typewriter delegation and bouncing dots configured.");
        }
    }

    // ==================== 5. COUNTUP INTERCEPTORS ====================
    function setupCountUpObservers() {
        if (typeof countUp === 'undefined') {
            console.warn("APEX Modernizer: CountUp.js not loaded.");
            return;
        }

        const lastValues = new Map();
        const countUpInstances = new Map();

        function animateValue(element, start, end, decimals = 2) {
            let demo = countUpInstances.get(element);
            if (!demo) {
                demo = new countUp.CountUp(element, end, {
                    startVal: start,
                    decimalPlaces: decimals,
                    duration: 0.8,
                    useEasing: true,
                    useGrouping: true,
                    separator: ','
                });
                countUpInstances.set(element, demo);
            } else {
                demo.update(end);
            }
            if (!demo.error) {
                demo.start();
            } else {
                element.innerText = end.toLocaleString('en-IN', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
            }
        }

        // Observe main header active stock price and check for movement thresholds
        const metaPriceEl = document.getElementById('meta-price');
        if (metaPriceEl) {
            const metaPriceObserver = new MutationObserver(() => {
                const text = metaPriceEl.textContent;
                const newVal = parseNumericValue(text);
                const oldVal = lastValues.get('meta-price') || newVal;

                if (oldVal !== newVal) {
                    lastValues.set('meta-price', newVal);
                    metaPriceObserver.disconnect();
                    animateValue(metaPriceEl, oldVal, newVal, 2);
                    metaPriceObserver.observe(metaPriceEl, { characterData: true, childList: true, subtree: true });
                }
                
                // Show/hide explain button based on daily net change percentage
                const changeText = document.getElementById('meta-change')?.textContent || "";
                const match = changeText.match(/([+-]?\d+\.?\d*)\s*%/);
                const explainBtn = document.getElementById('explain-move-btn');
                if (explainBtn) {
                    if (match) {
                        const pct = Math.abs(parseFloat(match[1]));
                        // Show "Why?" trigger for moves >= 1.5%
                        if (pct >= 1.5) {
                            explainBtn.style.display = 'inline-block';
                        } else {
                            explainBtn.style.display = 'none';
                        }
                    } else {
                        explainBtn.style.display = 'none';
                    }
                }
            });

            lastValues.set('meta-price', parseNumericValue(metaPriceEl.textContent));
            metaPriceObserver.observe(metaPriceEl, { characterData: true, childList: true, subtree: true });
        }

        // Observe ticker marquee indices
        const marqueeEl = document.getElementById('indices-marquee');
        if (marqueeEl) {
            const tickerObserver = new MutationObserver((mutations) => {
                mutations.forEach(mutation => {
                    if (mutation.type === 'childList') {
                        mutation.target.querySelectorAll('.val').forEach(valEl => {
                            const parentItem = valEl.closest('.ticker-item');
                            if (!parentItem) return;

                            const elementId = parentItem.id;
                            const newVal = parseNumericValue(valEl.textContent);
                            const oldVal = lastValues.get(elementId) || newVal;

                            if (oldVal !== newVal) {
                                lastValues.set(elementId, newVal);
                                tickerObserver.disconnect();
                                animateValue(valEl, oldVal, newVal, 2);
                                tickerObserver.observe(marqueeEl, { childList: true, subtree: true });
                            }
                        });
                    }
                });
            });

            marqueeEl.querySelectorAll('.ticker-item').forEach(item => {
                const valEl = item.querySelector('.val');
                if (valEl) {
                    lastValues.set(item.id, parseNumericValue(valEl.textContent));
                }
            });

            tickerObserver.observe(marqueeEl, { childList: true, subtree: true });
        }

        console.log("APEX Modernizer: CountUp price & index observers active.");
    }

    // ==================== 6. SPOTLIGHT & 3D PARALLAX TILTING ====================
    function setupSpotlightAnd3DTilt() {
        document.addEventListener('mousemove', (e) => {
            const card = e.target.closest('.card');
            if (card) {
                const rect = card.getBoundingClientRect();
                
                // Track spotlight coordinates
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                card.style.setProperty('--mouse-x', `${x}px`);
                card.style.setProperty('--mouse-y', `${y}px`);
            }
        });

        console.log("APEX Modernizer: Spotlight hover active (3D tilt disabled).");
    }

    // ==================== 7. VIEW TRANSITIONS & CLICK TRACKING ====================
    function setupViewTransitions() {
        document.addEventListener('click', (e) => {
            const isThemeTrigger = e.target.closest('.theme-toggle-btn') || 
                                   e.target.closest('#setting-theme-mode') || 
                                   e.target.closest('#setting-theme-accent') ||
                                   e.target.closest('.theme-btn');
            if (isThemeTrigger) {
                const x = e.clientX;
                const y = e.clientY;
                document.documentElement.style.setProperty('--reveal-x', `${x}px`);
                document.documentElement.style.setProperty('--reveal-y', `${y}px`);
            }
        });

        const originalSetWorkstationMode = window.setWorkstationMode;
        if (originalSetWorkstationMode) {
            window.setWorkstationMode = function(mode) {
                if (document.startViewTransition) {
                    document.startViewTransition(() => {
                        originalSetWorkstationMode(mode);
                    });
                } else {
                    originalSetWorkstationMode(mode);
                }
            };
        }

        const originalSetWorkstationAccent = window.setWorkstationAccent;
        if (originalSetWorkstationAccent) {
            window.setWorkstationAccent = function(accent) {
                if (document.startViewTransition) {
                    document.startViewTransition(() => {
                        originalSetWorkstationAccent(accent);
                    });
                } else {
                    originalSetWorkstationAccent(accent);
                }
            };
        }
    }

    // ==================== 8. CURSOR SPARKLES FOR BULLISH HOVER ====================
    function setupBullishSparkles() {
        let lastSparkTime = 0;
        document.addEventListener('mousemove', (e) => {
            // Match bullish green items or positive indicator cards
            const target = e.target.closest('.rec-buy, .green-text, .card-glow-positive, #meta-trend.rec-buy');
            if (!target) return;

            const now = Date.now();
            if (now - lastSparkTime < 50) return; // throttle sparkle spawning (50ms)
            lastSparkTime = now;

            createSparkle(e.clientX, e.clientY);
        });

        function createSparkle(x, y) {
            const spark = document.createElement('div');
            spark.className = 'bullish-sparkle';
            
            const offsetX = (Math.random() - 0.5) * 8;
            const offsetY = (Math.random() - 0.5) * 8;
            
            spark.style.left = `${x + offsetX}px`;
            spark.style.top = `${y + offsetY}px`;
            
            const scale = 0.4 + Math.random() * 0.7;
            spark.style.transform = `scale(${scale})`;
            
            document.body.appendChild(spark);
            
            if (typeof gsap !== 'undefined') {
                gsap.to(spark, {
                    y: -25 - Math.random() * 25,
                    x: offsetX + (Math.random() - 0.5) * 12,
                    opacity: 0,
                    scale: 0.1,
                    duration: 0.7,
                    ease: "power1.out",
                    onComplete: () => spark.remove()
                });
            } else {
                setTimeout(() => spark.remove(), 700);
            }
        }
        console.log("APEX Modernizer: Bullish particles/sparkles listener running.");
    }

    // ==================== 9. TOAST NOTIFICATION AUDIO HOOK ====================
    function setupToastAudioHook() {
        const originalShowToast = window.showToast;
        if (originalShowToast) {
            window.showToast = function(message, type) {
                originalShowToast(message, type);
                
                // Play specific sonification tones depending on message severity
                if (type === 'error' || type === 'warning' || message.toLowerCase().includes('failed') || message.toLowerCase().includes('warning')) {
                    AudioCueManager.playAlert();
                } else if (type === 'success' || message.toLowerCase().includes('success') || message.toLowerCase().includes('completed')) {
                    AudioCueManager.playChime();
                }
            };
            console.log("APEX Modernizer: Toast notification audio hooks connected.");
        }
    }

    // ==================== 10. ACTIVE TTS EQUALIZER AUDIO VISUALIZER ====================
    function setupTTSEqualizer() {
        document.addEventListener('click', (e) => {
            const btn = e.target.closest('.chat-speech-btn');
            if (btn) {
                // Remove any currently running equalizer indicators
                const activeVis = document.querySelector('.chat-speaking-indicator');
                if (activeVis) activeVis.remove();

                // Build a new waveform indicator and place it next to the speech button
                const vis = document.createElement('div');
                vis.className = 'chat-speaking-indicator';
                vis.innerHTML = '<span></span><span></span><span></span>';
                btn.parentElement.appendChild(vis);

                // Watch speech activity. Once speaking finishes, remove visualizer
                const checkSpeech = setInterval(() => {
                    const isSpeaking = window.speechSynthesis && window.speechSynthesis.speaking;
                    const isPlayerSpeaking = window.SpeechPlayer && window.SpeechPlayer.isPlaying;
                    
                    if (!isSpeaking && !isPlayerSpeaking) {
                        vis.remove();
                        clearInterval(checkSpeech);
                    }
                }, 500);
            }
        });
        console.log("APEX Modernizer: TTS speech equalizer tracking loaded.");
    }

    // ==================== 11. TACTILE MAGNETIC BUTTONS ====================
    function setupMagneticButtons() {
        // Collect buttons we want to act magnet-like
        const buttons = document.querySelectorAll(
            '.nav-menu .nav-btn, .btn-primary, .btn-secondary, #rebalance-now-btn, #theme-toggle-btn, .mobile-menu-toggle'
        );

        document.addEventListener('mousemove', (e) => {
            if (window.innerWidth < 768) return; // Skip on mobile viewports

            buttons.forEach(btn => {
                const rect = btn.getBoundingClientRect();
                // Find coordinates of button's center point
                const btnX = rect.left + rect.width / 2;
                const btnY = rect.top + rect.height / 2;

                const distanceX = e.clientX - btnX;
                const distanceY = e.clientY - btnY;
                const distance = Math.hypot(distanceX, distanceY);

                const pullThreshold = 40; // Pixels distance to start pull
                if (distance < pullThreshold) {
                    const pullMultiplier = 0.22; // Strength of magnetism
                    const translateValX = distanceX * pullMultiplier;
                    const translateValY = distanceY * pullMultiplier;

                    btn.style.transform = `translate(${translateValX.toFixed(1)}px, ${translateValY.toFixed(1)}px) scale(1.02)`;
                    btn.style.transition = 'transform 0.08s ease-out';
                } else {
                    btn.style.transform = '';
                    btn.style.transition = 'transform 0.25s ease-out';
                }
            });
        });
        console.log("APEX Modernizer: Magnetic button physics enabled.");
    }

    // ==================== 12. DYNAMIC TABLE CATALYST TRIGGER INJECTION ====================
    function setupTableCatalystTriggers() {
        const observer = new MutationObserver(() => {
            // 1. Gainers, Losers, and Watchlist rows
            document.querySelectorAll('#top-gainers-tbody tr, #top-losers-tbody tr, #watchlist-table-body tr').forEach(row => {
                // Skip if already parsed or if empty/loading placeholder row
                if (row.querySelector('.catalyst-trigger-btn') || row.querySelector('td[colspan]')) return;

                const symbolCell = row.querySelector('td:first-child');
                if (symbolCell) {
                    const text = symbolCell.textContent.trim().split('\n')[0].trim();
                    // Basic validation to isolate symbols (e.g. TCS, RELIANCE)
                    if (text && text.length > 1 && text.length <= 15 && !text.includes('Select') && !text.includes('No data')) {
                        const trigger = document.createElement('span');
                        trigger.className = 'catalyst-trigger-btn';
                        trigger.setAttribute('data-symbol', text);
                        trigger.setAttribute('title', 'Analyze price catalysts');
                        trigger.style.marginLeft = '8px';
                        trigger.innerHTML = '⚡';
                        symbolCell.appendChild(trigger);
                    }
                }
            });

            // 2. Sector Radar Grid Tiles
            document.querySelectorAll('.sector-heatmap-tile').forEach(tile => {
                const header = tile.querySelector('.sector-heatmap-tile-header');
                if (header && !header.querySelector('.catalyst-trigger-btn')) {
                    const titleEl = header.querySelector('.sector-heatmap-tile-title');
                    if (titleEl) {
                        const sectorName = titleEl.textContent.trim();
                        if (sectorName && sectorName.length > 2 && !sectorName.includes('Select')) {
                            const trigger = document.createElement('span');
                            trigger.className = 'catalyst-trigger-btn';
                            trigger.setAttribute('data-symbol', sectorName);
                            trigger.setAttribute('data-sector', sectorName);
                            trigger.setAttribute('title', 'Analyze sector catalysts');
                            trigger.style.marginLeft = '8px';
                            trigger.style.cursor = 'pointer';
                            trigger.innerHTML = '⚡';
                            titleEl.appendChild(trigger);
                        }
                    }
                }
            });
        });

        observer.observe(document.body, { childList: true, subtree: true });
        console.log("APEX Modernizer: Automated table and sector card catalyst trigger monitors active.");
    }

    // ==================== 13. SPEECH SYNTHESIS & RECOGNITION (CATALYST CONTROLS) ====================
    // ==================== 13. SPEECH SYNTHESIS & RECOGNITION (CATALYST CONTROLS) ====================
    function stopCatalystSpeech() {
        if (window.SpeechPlayer && window.SpeechPlayer.isPlaying) {
            window.SpeechPlayer.stop();
        }
    }

    function setupCatalystAudioControls() {
        const readBtn = document.getElementById('catalyst-read-btn');
        if (readBtn) {
            readBtn.addEventListener('click', () => {
                if (window.SpeechPlayer) {
                    const summary = document.getElementById('catalyst-summary-text')?.innerText || "";
                    let driversText = "";
                    document.querySelectorAll('#catalyst-drivers-list .catalyst-driver-card').forEach(card => {
                        // Extract text cleanly, excluding html structures
                        const textContent = card.innerText.replace(/\n/g, " ").trim();
                        if (textContent) driversText += ". " + textContent;
                    });
                    
                    const fullSpeechText = summary + driversText;
                    window.SpeechPlayer.startSpeakingSection(fullSpeechText, "Catalyst AI News Analysis", true);
                } else {
                    window.showToast("Speech narration player not active on this device.", "warning");
                }
            });
        }
    }

    // Web Speech Recognition (Mic Voice Input)
    function setupSpeechRecognition() {
        const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
        const micBtn = document.getElementById('catalyst-mic-btn');
        const inputEl = document.getElementById('catalyst-voice-input');

        if (!SpeechRecognition) {
            if (micBtn) micBtn.style.display = 'none';
            return;
        }

        const recognition = new SpeechRecognition();
        recognition.continuous = false;
        recognition.lang = 'en-IN'; // Optimized for Indian English accents

        if (micBtn) {
            micBtn.addEventListener('click', () => {
                if (micBtn.classList.contains('mic-active')) {
                    recognition.stop();
                } else {
                    micBtn.classList.add('mic-active');
                    inputEl.value = '';
                    inputEl.setAttribute('placeholder', 'Listening... Ask me now...');
                    recognition.start();
                }
            });
        }

        recognition.onresult = (e) => {
            const transcript = e.results[0][0].transcript;
            if (inputEl) {
                inputEl.value = transcript;
            }
            if (micBtn) micBtn.classList.remove('mic-active');
            inputEl.setAttribute('placeholder', "Ask about a price move...");
            // Auto-trigger search query
            document.getElementById('catalyst-query-btn')?.click();
        };

        recognition.onerror = () => {
            if (micBtn) micBtn.classList.remove('mic-active');
            if (inputEl) inputEl.setAttribute('placeholder', "Ask about a price move...");
        };

        recognition.onend = () => {
            if (micBtn) micBtn.classList.remove('mic-active');
            if (inputEl) inputEl.setAttribute('placeholder', "Ask about a price move...");
        };
    }

    // ==================== 14. CATALYST MODAL API & UI RENDERING ====================
    let activeCatalystTyped = null;
    let currentCatalystSymbol = "";
    let currentCatalystSector = "";
    let currentCatalystIsSector = false;
    let currentCatalystDirection = "";

    function openCatalystAnalysis(symbolOrQuery, sector = "", isSectorOnly = false, direction = "") {
        // Reset audio first
        stopCatalystSpeech();

        const modal = document.getElementById('catalyst-modal');
        const loader = document.getElementById('catalyst-loader');
        const results = document.getElementById('catalyst-results');
        const titleEl = document.getElementById('catalyst-modal-title');
        const voiceInput = document.getElementById('catalyst-voice-input');

        if (!modal) return;

        // Reset custom transform offsets from drag gestures
        const card = modal.querySelector('.catalyst-modal-card');
        if (card) {
            card.style.transform = '';
            card.style.transition = '';
        }
        modal.style.background = '';

        // Display modal using class
        modal.classList.add('active');
        loader.style.display = 'none'; // Do not show loader yet
        results.style.display = 'flex';  // Show results pane for instructions

        const cleanSymbol = symbolOrQuery.replace(".NS", "").trim();

        // Store state variables for execution
        currentCatalystSymbol = symbolOrQuery;
        currentCatalystSector = sector;
        currentCatalystIsSector = isSectorOnly;
        currentCatalystDirection = direction;

        if (voiceInput) {
            if (isSectorOnly) {
                const actionWord = direction === "up" ? "gaining" : (direction === "down" ? "declining" : "moving");
                voiceInput.value = `Why is the ${cleanSymbol} sector ${actionWord}?`;
            } else {
                const actionWord = direction === "up" ? "surging" : (direction === "down" ? "dropping" : "moving");
                voiceInput.value = `Why is ${cleanSymbol} ${actionWord}?`;
            }
        }

        titleEl.textContent = isSectorOnly 
            ? `Sector Catalyst: ${cleanSymbol}`
            : `Catalyst analysis: ${cleanSymbol}`;

        // Stop previous typewriter typing instance
        if (activeCatalystTyped) {
            activeCatalystTyped.destroy();
            activeCatalystTyped = null;
        }

        // Show instructional placeholder message in summary container
        const summaryContainer = document.getElementById('catalyst-summary-text');
        if (summaryContainer) {
            summaryContainer.innerHTML = '<span style="color: var(--text-muted); font-size: 11.5px; font-style: italic;">Modify your query in the input box above, then click the <strong>Query</strong> button to fetch real-time catalysts and AI analysis.</span>';
        }

        // Clear previous catalyst driver cards
        const listEl = document.getElementById('catalyst-drivers-list');
        if (listEl) {
            listEl.innerHTML = '';
        }

        // Reset sentiment ring display
        const ring = document.getElementById('catalyst-sentiment-ring');
        if (ring) {
            ring.style.strokeDashoffset = '100';
        }
        const sTitle = document.getElementById('catalyst-sentiment-title');
        if (sTitle) {
            sTitle.textContent = 'Awaiting Query...';
            sTitle.style.color = '';
        }

        // Clear prompts list
        const promptsContainer = document.getElementById('catalyst-prompts-container');
        if (promptsContainer) {
            promptsContainer.innerHTML = '';
        }

        // Reset audit metadata footers to pending
        const auditScraperEl = document.getElementById('catalyst-audit-scraper');
        const auditEngineEl = document.getElementById('catalyst-audit-engine');
        if (auditScraperEl) auditScraperEl.textContent = 'Pending...';
        if (auditEngineEl) auditEngineEl.textContent = 'Pending...';
    }

    function executeCatalystAnalysis() {
        const modal = document.getElementById('catalyst-modal');
        const loader = document.getElementById('catalyst-loader');
        const results = document.getElementById('catalyst-results');
        const voiceInput = document.getElementById('catalyst-voice-input');

        if (!modal) return;

        // Read query text
        const queryText = voiceInput ? voiceInput.value.trim() : "";
        if (!queryText) {
            window.showToast("Please enter a valid query.", "warning");
            return;
        }

        // Blur input to dismiss mobile soft keyboard
        if (voiceInput) voiceInput.blur();

        // Update active symbol to custom query text
        currentCatalystSymbol = queryText;

        // Display loader and hide results pane
        loader.style.display = 'flex';
        results.style.display = 'none';

        // Stop previous typewriter typing instance
        if (activeCatalystTyped) {
            activeCatalystTyped.destroy();
            activeCatalystTyped = null;
        }

        const aiEngine = localStorage.getItem('catalyst_ai_engine') || 'gemini';
        let searchHorizon = localStorage.getItem('search_horizon') || '7d';
        const sectorRadarLookback = document.getElementById('sector-radar-lookback');
        if (currentCatalystIsSector && sectorRadarLookback) {
            searchHorizon = sectorRadarLookback.value || '7d';
        }
        
        const useTavily = localStorage.getItem('use_tavily_search') === 'true';
        const useSerpApi = localStorage.getItem('use_serpapi') !== 'false'; // default to true
        const useBrave = localStorage.getItem('use_brave_search') !== 'false'; // default to true
        
        const url = apiBaseUrl + `/api/stock-catalysts?symbol=${encodeURIComponent(currentCatalystSymbol)}&sector=${encodeURIComponent(currentCatalystSector)}&is_sector=${currentCatalystIsSector}&ai_engine=${aiEngine}&timeframe=${searchHorizon}&use_tavily_search=${useTavily}&use_serpapi=${useSerpApi}&use_brave=${useBrave}&direction=${currentCatalystDirection}`;

        fetch(url)
            .then(res => res.json())
            .then(data => {
                loader.style.display = 'none';
                results.style.display = 'flex';

                // Update audit diagnostics footer fields
                const auditScraperEl = document.getElementById('catalyst-audit-scraper');
                const auditEngineEl = document.getElementById('catalyst-audit-engine');
                if (auditScraperEl) {
                    auditScraperEl.textContent = data.search_provider || 'None';
                }
                if (auditEngineEl) {
                    auditEngineEl.textContent = data.llm_provider || 'None';
                }

                // Render dynamic Sentiment ring
                const ring = document.getElementById('catalyst-sentiment-ring');
                const sTitle = document.getElementById('catalyst-sentiment-title');
                const sentimentValue = (data.sentiment || 'Neutral').toLowerCase();
                
                let percent = 50;
                let strokeColor = 'var(--color-primary-light)';
                let glowColor = 'rgba(59, 130, 246, 0.4)';
                let titleText = '50% NEUTRAL SENTIMENT';
                let titleColor = 'var(--text-primary)';

                if (sentimentValue === 'positive') {
                    percent = 85;
                    strokeColor = 'var(--color-emerald)';
                    glowColor = 'rgba(16, 185, 129, 0.5)';
                    titleText = '85% BULLISH OUTLOOK';
                    titleColor = 'var(--color-emerald)';
                } else if (sentimentValue === 'negative') {
                    percent = 85;
                    strokeColor = 'var(--color-crimson)';
                    glowColor = 'rgba(239, 68, 68, 0.5)';
                    titleText = '85% BEARISH OUTLOOK';
                    titleColor = 'var(--color-crimson)';
                }

                if (ring) {
                    const offset = 100 - percent;
                    ring.style.stroke = strokeColor;
                    ring.style.strokeDashoffset = offset;
                    // Add glow in dark mode
                    const isDark = document.documentElement.getAttribute('data-theme') !== 'light' && document.body.getAttribute('data-theme') !== 'light';
                    if (isDark) {
                        ring.style.filter = `drop-shadow(0 0 4px ${glowColor})`;
                    } else {
                        ring.style.filter = '';
                    }
                }
                if (sTitle) {
                    sTitle.textContent = titleText;
                    sTitle.style.color = titleColor;
                }

                // Display summary text using Typed.js
                const summaryContainer = document.getElementById('catalyst-summary-text');
                if (summaryContainer) {
                    summaryContainer.innerHTML = '';
                    const textSpan = document.createElement('span');
                    summaryContainer.appendChild(textSpan);

                    activeCatalystTyped = new Typed(textSpan, {
                        strings: [data.summary || "No catalysts parsed."],
                        typeSpeed: 3,
                        showCursor: false,
                        contentType: 'html'
                    });
                }

                // Render catalyst driver list cards
                const listEl = document.getElementById('catalyst-drivers-list');
                if (listEl) {
                    listEl.innerHTML = '';
                    const drivers = data.drivers || [];
                    
                    drivers.forEach(d => {
                        const card = document.createElement('div');
                        
                        // Map categorisation to colors and badges
                        const isDriverBullish = sentimentValue === 'positive' || d.desc.toLowerCase().includes('surge') || d.desc.toLowerCase().includes('gain') || d.desc.toLowerCase().includes('profit') || d.desc.toLowerCase().includes('growth');
                        const isDriverBearish = sentimentValue === 'negative' || d.desc.toLowerCase().includes('decline') || d.desc.toLowerCase().includes('drop') || d.desc.toLowerCase().includes('pledge') || d.desc.toLowerCase().includes('threat');
                        
                        let sentimentClass = '';
                        let badgeSentimentClass = '';
                        let badgeText = 'Neutral';

                        if (isDriverBullish) {
                            sentimentClass = 'bullish';
                            badgeSentimentClass = 'bullish';
                            badgeText = 'Bullish';
                        } else if (isDriverBearish) {
                            sentimentClass = 'bearish';
                            badgeSentimentClass = 'bearish';
                            badgeText = 'Bearish';
                        }

                        card.className = `catalyst-driver-card ${sentimentClass}`;
                        
                        // Map category indicators to Lucide icons
                        let icon = '⚡';
                        if (d.category === 'Corporate') icon = '🏢';
                        else if (d.category.includes('Policy') || d.category.includes('Sector')) icon = '⚖️';
                        else if (d.category === 'Macro') icon = '🌍';
                        else if (d.category === 'Technical') icon = '📉';
                        
                        card.innerHTML = `
                            <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 6px; margin-bottom: 4px;">
                                <div style="display: flex; align-items: center; gap: 8px;">
                                    <span class="catalyst-driver-badge ${badgeSentimentClass}">${icon} ${d.category}</span>
                                    <span class="catalyst-driver-badge ${badgeSentimentClass}" style="opacity: 0.85;">${badgeText}</span>
                                </div>
                                <strong style="font-size: 12px; color: var(--text-primary); font-family:var(--font-heading); flex: 1; min-width: 150px; text-align: left;">${d.title}</strong>
                            </div>
                            <p style="margin: 0; font-size: 11.5px; line-height: 1.55; color: var(--text-secondary); font-family: 'Inter';">${d.desc}</p>
                        `;
                        listEl.appendChild(card);
                    });
                }

                // Render dynamic suggestion pills
                const promptsContainer = document.getElementById('catalyst-prompts-container');
                if (promptsContainer) {
                    promptsContainer.innerHTML = '';
                    
                    const cleanSymbol = currentCatalystSymbol.replace(".NS", "").trim();
                    const prompts = [
                        `Revenue impact of ${cleanSymbol}?`,
                        `Competitors of ${cleanSymbol}?`,
                        `Timeline risks of ${cleanSymbol}?`
                    ];

                    prompts.forEach(pText => {
                        const pill = document.createElement('button');
                        pill.className = 'catalyst-prompt-pill';
                        pill.innerHTML = `💡 <span>${pText}</span>`;
                        pill.onclick = () => {
                            if (voiceInput) {
                                voiceInput.value = pText;
                                document.getElementById('catalyst-query-btn')?.click();
                            }
                        };
                        promptsContainer.appendChild(pill);
                    });
                }
            })
            .catch(err => {
                console.error("[Catalyst UI] Fetch failed:", err);
                loader.style.display = 'none';
                window.showToast("Failed to fetch price action reasons. Please try again.", "error");
            });
    }

    function setupCatalystModalListeners() {
        const modal = document.getElementById('catalyst-modal');
        const closeBtn = document.getElementById('catalyst-modal-close-btn');
        const closeBtnBottom = document.getElementById('catalyst-modal-close-btn-bottom');
        const queryBtn = document.getElementById('catalyst-query-btn');
        const explainMoveBtn = document.getElementById('explain-move-btn');
        const voiceInput = document.getElementById('catalyst-voice-input');

        const closeModal = () => {
            stopCatalystSpeech();
            if (modal) modal.classList.remove('active');
            if (activeCatalystTyped) {
                activeCatalystTyped.destroy();
                activeCatalystTyped = null;
            }
        };

        if (closeBtn) closeBtn.addEventListener('click', closeModal);
        if (closeBtnBottom) closeBtnBottom.addEventListener('click', closeModal);

        // Click away dismiss listener
        if (modal) {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    closeModal();
                }
            });

            // Swipe down to dismiss gesture handlers for mobile
            const card = modal.querySelector('.catalyst-modal-card');
            const dragHandle = document.getElementById('catalyst-drag-handle');
            
            if (card && dragHandle) {
                let startY = 0;
                let currentY = 0;
                let isDragging = false;

                const handleStart = (clientY) => {
                    startY = clientY;
                    isDragging = true;
                    card.style.transition = 'none';
                };

                const handleMove = (clientY) => {
                    if (!isDragging) return;
                    currentY = clientY;
                    const diffY = currentY - startY;
                    
                    if (diffY > 0) {
                        card.style.transform = `translateY(${diffY}px)`;
                        // Fade backdrop opacity proportionally
                        const opacity = 0.55 - (diffY / 600) * 0.55;
                        modal.style.background = `rgba(7, 10, 18, ${Math.max(0.1, opacity)})`;
                    }
                };

                const handleEnd = () => {
                    if (!isDragging) return;
                    isDragging = false;
                    const diffY = currentY - startY;
                    
                    card.style.transition = 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)';
                    modal.style.transition = 'background 0.3s ease';

                    if (diffY > 80) {
                        // Slide fully down and close
                        card.style.transform = 'translateY(100%)';
                        modal.style.background = 'rgba(7, 10, 18, 0)';
                        setTimeout(() => {
                            closeModal();
                        }, 250);
                    } else {
                        // Spring back up
                        card.style.transform = '';
                        modal.style.background = '';
                    }
                    
                    // Reset transitions after snap back
                    setTimeout(() => {
                        if (modal.classList.contains('active')) {
                            card.style.transition = '';
                            modal.style.transition = '';
                        }
                    }, 350);
                };

                dragHandle.addEventListener('touchstart', (e) => handleStart(e.touches[0].clientY));
                document.addEventListener('touchmove', (e) => {
                    if (isDragging) {
                        e.preventDefault(); // Prevent double scrolling page bounce
                        handleMove(e.touches[0].clientY);
                    }
                }, { passive: false });
                document.addEventListener('touchend', handleEnd);
            }
        }

        if (explainMoveBtn) {
            explainMoveBtn.addEventListener('click', () => {
                const ticker = document.getElementById('meta-ticker')?.textContent || "";
                if (ticker) {
                    const pctEl = document.getElementById('meta-change');
                    const pctText = pctEl ? pctEl.textContent.trim() : "";
                    const direction = pctText.includes('-') ? "down" : (pctText.includes('+') ? "up" : "");
                    const targetSector = document.getElementById('meta-sector')?.textContent || "";
                    openCatalystAnalysis(ticker, targetSector, false, direction);
                }
            });
        }

        // Trigger manual voice text queries
        if (queryBtn) {
            queryBtn.addEventListener('click', () => {
                executeCatalystAnalysis();
            });
        }

        if (voiceInput) {
            voiceInput.addEventListener('keypress', (e) => {
                if (e.key === 'Enter') {
                    queryBtn?.click();
                }
            });
        }

        // Delegate trigger clicks inside tables (Watchlist, Movers, Sectors)
        document.addEventListener('click', (e) => {
            const trigger = e.target.closest('.catalyst-trigger-btn');
            if (trigger) {
                const symbol = trigger.getAttribute('data-symbol');
                const sector = trigger.getAttribute('data-sector') || '';
                
                // Extract direction
                let direction = "";
                const row = trigger.closest('tr');
                if (row) {
                    const isGainer = trigger.closest('#top-gainers-tbody') !== null;
                    const isLoser = trigger.closest('#top-losers-tbody') !== null;
                    if (isGainer) {
                        direction = "up";
                    } else if (isLoser) {
                        direction = "down";
                    } else {
                        // Check watchlist columns for positive/negative change Indicators
                        const cells = row.querySelectorAll('td');
                        for (let cell of cells) {
                            const cellText = cell.textContent.trim();
                            if (cell.classList.contains('text-green') || cellText.includes('+')) {
                                direction = "up";
                                break;
                            } else if (cell.classList.contains('text-danger') || cell.classList.contains('text-red') || cellText.includes('-')) {
                                direction = "down";
                                break;
                            }
                        }
                    }
                } else {
                    // Check if it is inside a Sector heatmap tile
                    const heatmapTile = trigger.closest('.sector-heatmap-tile');
                    if (heatmapTile) {
                        const pctEl = heatmapTile.querySelector('.sector-heatmap-tile-pct');
                        const pctText = pctEl ? pctEl.textContent.trim() : "";
                        direction = pctText.includes('-') ? "down" : (pctText.includes('+') ? "up" : "");
                    }
                }
                
                // Determine isSectorOnly based on the data attributes
                const isSector = trigger.hasAttribute('data-sector') || trigger.closest('.sector-heatmap-tile') !== null;
                openCatalystAnalysis(symbol, sector, isSector, direction);
                return;
            }

            // Clicking any sector standings block or row in Sector Momentum Radar
            const sectorRow = e.target.closest('#tab-sector-radar .sector-row, #tab-sector-radar .sector-card, #tab-sector-radar [data-sector]');
            if (sectorRow && !e.target.closest('button') && !e.target.closest('input')) {
                const sectorName = sectorRow.getAttribute('data-sector') || sectorRow.querySelector('h4')?.textContent || sectorRow.textContent.trim();
                const cleanSector = sectorName.replace(/^[▲▼]?\s*[\d.-]+%\s*/, '').trim();
                
                let direction = "";
                if (sectorName.includes('▲') || sectorName.includes('+')) {
                    direction = "up";
                } else if (sectorName.includes('▼') || sectorName.includes('-')) {
                    direction = "down";
                }
                
                if (cleanSector && cleanSector.length > 2 && cleanSector.length < 35 && !cleanSector.includes('Sync') && !cleanSector.includes('Interpretation')) {
                    openCatalystAnalysis(cleanSector, "", true, direction);
                }
            }
        });
    }

    // ==================== 15. SETTINGS SEARCH TOGGLE COCKPIT ====================
    function setupSettingsSearchToggle() {
        const aiSelect = document.getElementById('setting-catalyst-ai');
        const horizonSelect = document.getElementById('setting-search-horizon');
        const braveToggle = document.getElementById('setting-brave-toggle');
        const tavilyToggle = document.getElementById('setting-tavily-search-toggle');
        const serpapiToggle = document.getElementById('setting-serpapi-toggle');

        // Initialize state from localStorage
        if (aiSelect) {
            aiSelect.value = localStorage.getItem('catalyst_ai_engine') || 'gemini';
            aiSelect.addEventListener('change', (e) => {
                localStorage.setItem('catalyst_ai_engine', e.target.value);
                AudioCueManager.playTick();
                window.showToast(`AI Engine set to: ${e.target.value === 'gemini' ? 'Gemini 1.5' : 'Groq Llama 3.3'}`, 'success');
            });
        }

        if (horizonSelect) {
            horizonSelect.value = localStorage.getItem('search_horizon') || '7d';
            horizonSelect.addEventListener('change', (e) => {
                localStorage.setItem('search_horizon', e.target.value);
                AudioCueManager.playTick();
                window.showToast(`Search Horizon set to: ${horizonSelect.options[horizonSelect.selectedIndex].text}`, 'success');
            });
        }

        if (tavilyToggle) {
            const storedTavily = localStorage.getItem('use_tavily_search');
            if (storedTavily !== null) {
                tavilyToggle.checked = storedTavily === 'true';
            } else {
                fetch(apiBaseUrl + '/api/llm-config')
                    .then(res => res.json())
                    .then(config => {
                        tavilyToggle.checked = !!config.has_tavily_key || !!localStorage.getItem('tavily_api_key');
                        localStorage.setItem('use_tavily_search', tavilyToggle.checked);
                    })
                    .catch(() => {
                        tavilyToggle.checked = false;
                    });
            }
            tavilyToggle.addEventListener('change', (e) => {
                localStorage.setItem('use_tavily_search', e.target.checked);
                AudioCueManager.playTick();
                window.showToast(`Tavily API ${e.target.checked ? 'Enabled' : 'Disabled'}`, 'success');
            });
        }

        if (serpapiToggle) {
            const storedSerp = localStorage.getItem('use_serpapi');
            if (storedSerp !== null) {
                serpapiToggle.checked = storedSerp === 'true';
            } else {
                fetch(apiBaseUrl + '/api/llm-config')
                    .then(res => res.json())
                    .then(config => {
                        serpapiToggle.checked = !!config.has_serpapi_key || !!localStorage.getItem('serpapi_api_key');
                        localStorage.setItem('use_serpapi', serpapiToggle.checked);
                    })
                    .catch(() => {
                        serpapiToggle.checked = false;
                    });
            }
            serpapiToggle.addEventListener('change', (e) => {
                localStorage.setItem('use_serpapi', e.target.checked);
                AudioCueManager.playTick();
                window.showToast(`SerpApi ${e.target.checked ? 'Enabled' : 'Disabled'}`, 'success');
            });
        }

        if (braveToggle) {
            const storedBrave = localStorage.getItem('use_brave_search');
            if (storedBrave !== null) {
                braveToggle.checked = storedBrave === 'true';
            } else {
                fetch(apiBaseUrl + '/api/llm-config')
                    .then(res => res.json())
                    .then(config => {
                        braveToggle.checked = !!config.has_brave_key;
                        localStorage.setItem('use_brave_search', braveToggle.checked);
                    })
                    .catch(() => {
                        braveToggle.checked = false;
                    });
            }
            braveToggle.addEventListener('change', (e) => {
                localStorage.setItem('use_brave_search', e.target.checked);
                AudioCueManager.playTick();
                window.showToast(`Brave Search ${e.target.checked ? 'Enabled' : 'Disabled'}`, 'success');
                // Note: SerpApi & Tavily key storage has been modernized to use backend SQLite database dynamic key configuration.
            });
        }

        // Note: SerpApi & Tavily key storage has been modernized to use backend SQLite database dynamic key configuration.
    }

    // ==================== MOBILE ENTERPRISE UI LAYOUT & CONTROLLER ====================
    function setupMobileUpgrades() {
        const isMobile = () => window.innerWidth <= 768;

        // Bottom nav tab IDs mapping
        const tabsList = ['analyzer', 'screener', 'watchlist', 'portfolio'];

        function injectMobileBottomNav() {
            if (document.querySelector('.mobile-bottom-nav')) return;
            const bottomNav = document.createElement('nav');
            bottomNav.className = 'mobile-bottom-nav no-print';
            bottomNav.innerHTML = `
                <button class="mobile-bottom-nav-item" id="nav-terminal" title="Terminal">
                    <i data-lucide="line-chart"></i>
                    <span>Terminal</span>
                </button>
                <button class="mobile-bottom-nav-item" id="nav-screener" title="Screener">
                    <i data-lucide="search"></i>
                    <span>Screener</span>
                </button>
                <button class="mobile-bottom-nav-item" id="nav-watchlist" title="Watchlist">
                    <i data-lucide="list"></i>
                    <span>Watchlist</span>
                </button>
                <button class="mobile-bottom-nav-item" id="nav-portfolio" title="Portfolio">
                    <i data-lucide="pie-chart"></i>
                    <span>Portfolio</span>
                </button>
                <button class="mobile-bottom-nav-item" id="nav-more" title="More">
                    <i data-lucide="menu"></i>
                    <span>More</span>
                </button>
            `;
            document.body.appendChild(bottomNav);

            document.getElementById('nav-terminal').addEventListener('click', () => window.switchTab('analyzer'));
            document.getElementById('nav-screener').addEventListener('click', () => window.switchTab('screener'));
            document.getElementById('nav-watchlist').addEventListener('click', () => window.switchTab('watchlist'));
            document.getElementById('nav-portfolio').addEventListener('click', () => window.switchTab('portfolio'));
            document.getElementById('nav-more').addEventListener('click', (e) => {
                e.stopPropagation();
                const sidebar = document.getElementById('sidebar');
                if (sidebar) sidebar.classList.add('open');
            });

            if (typeof lucide !== 'undefined') {
                lucide.createIcons();
            }
            syncActiveBottomNavTab();
        }

        function removeMobileBottomNav() {
            const bottomNav = document.querySelector('.mobile-bottom-nav');
            if (bottomNav) bottomNav.remove();
        }

        function syncActiveBottomNavTab(activeTabKey) {
            const bottomNav = document.querySelector('.mobile-bottom-nav');
            if (!bottomNav) return;

            bottomNav.querySelectorAll('.mobile-bottom-nav-item').forEach(item => {
                item.classList.remove('active');
            });

            const currentTab = activeTabKey || window.activeTab || (location.hash ? location.hash.substring(1) : 'analyzer');
            let navId = 'nav-terminal';
            if (currentTab === 'analyzer') navId = 'nav-terminal';
            else if (currentTab === 'screener') navId = 'nav-screener';
            else if (currentTab === 'watchlist') navId = 'nav-watchlist';
            else if (currentTab === 'portfolio') navId = 'nav-portfolio';

            const activeBtn = document.getElementById(navId);
            if (activeBtn) activeBtn.classList.add('active');
        }

        // Tap Haptic Simulation Helper
        function playHaptic(ms = 10) {
            const Haptics = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Haptics;
            if (Haptics && typeof Haptics.vibrate === 'function') {
                try {
                    Haptics.vibrate({ duration: ms });
                    return;
                } catch(e) {}
            }
            if (navigator.vibrate) {
                try {
                    navigator.vibrate(ms);
                } catch(e) {}
            }
        }

        // Dynamic active state touch classes & clicks sonification
        document.addEventListener('touchstart', e => {
            const tapTarget = e.target.closest('.mobile-bottom-nav-item, .pin-key, .btn-primary, .btn-secondary, .portfolio-subtab-btn');
            if (tapTarget) {
                tapTarget.classList.add('touch-active');
            }
        }, { passive: true });

        document.addEventListener('touchend', e => {
            const tapTarget = e.target.closest('.mobile-bottom-nav-item, .pin-key, .btn-primary, .btn-secondary, .portfolio-subtab-btn');
            if (tapTarget) {
                tapTarget.classList.remove('touch-active');
                playHaptic(8);
            }
        }, { passive: true });

        // Initialize bottom navigation display
        if (isMobile()) {
            injectMobileBottomNav();
        }

        window.addEventListener('resize', () => {
            if (isMobile()) {
                injectMobileBottomNav();
                decorateWatchlistRowsForMobile();
                decoratePortfolioRowsForMobile();
                decorateUniverseRowsForMobile();
                decorateAlertsRowsForMobile();
                decorateRuleScannerRowsForMobile();
                decorateScreenerRowsForMobile();
                decorateSectorRadarRowsForMobile();
            } else {
                removeMobileBottomNav();
                decorateWatchlistRowsForMobile();
                decoratePortfolioRowsForMobile();
                decorateUniverseRowsForMobile();
                decorateAlertsRowsForMobile();
                decorateRuleScannerRowsForMobile();
                decorateScreenerRowsForMobile();
                decorateSectorRadarRowsForMobile();
            }
        });

        // Note: switchTab interception and nav highlights are fully handled by the global routing interceptor property defined at the top of the file.

        // 2. Swipe Gestures for Tab Navigation
        let touchstartX = 0;
        let touchendX = 0;
        let touchstartY = 0;
        let touchendY = 0;
        let touchStartTarget = null;
        const swipeMinDistance = 75;
        const swipeMaxCrossDistance = 45;

        function handleSwipeGesture(e) {
            const currentHash = location.hash.substring(1) || 'analyzer';
            // Disable page swipe transitions on Watchlist and Portfolio tabs to resolve gesture conflicts
            if (currentHash === 'watchlist' || currentHash === 'portfolio') {
                return;
            }

            const target = touchStartTarget || (e ? e.target : null);
            if (target && target.closest('#tv-chart-workstation, input, textarea, select, button, .pin-key, .rs-bottom-sheet, tr, td, .swipeable-row-container, .swipeable-row-content, .swipe-actions, .tearsheet-range-slider, .tearsheet-range-marker, .watchlist-scroll-wrapper, .data-table-wrapper')) {
                return;
            }
            const isSwipeLeft = touchendX < touchstartX - swipeMinDistance && Math.abs(touchendY - touchstartY) < swipeMaxCrossDistance;
            const isSwipeRight = touchendX > touchstartX + swipeMinDistance && Math.abs(touchendY - touchstartY) < swipeMaxCrossDistance;

            if (isSwipeLeft || isSwipeRight) {
                const currentIndex = tabsList.indexOf(currentHash);
                if (currentIndex !== -1) {
                    let nextIndex = currentIndex;
                    if (isSwipeLeft && currentIndex < tabsList.length - 1) {
                        nextIndex = currentIndex + 1;
                    } else if (isSwipeRight && currentIndex > 0) {
                        nextIndex = currentIndex - 1;
                    }
                    if (nextIndex !== currentIndex) {
                        playHaptic(12);
                        window.switchTab(tabsList[nextIndex]);
                    }
                }
            }
        }

        document.addEventListener('touchstart', e => {
            touchstartX = e.changedTouches[0].screenX;
            touchstartY = e.changedTouches[0].screenY;
            touchStartTarget = e.target;
        }, { passive: true });

        document.addEventListener('touchend', e => {
            touchendX = e.changedTouches[0].screenX;
            touchendY = e.changedTouches[0].screenY;
            if (isMobile()) handleSwipeGesture(e);
        }, { passive: true });

        // 3. Pull-To-Refresh Gestures
        let pullStartX = 0;
        let pullStartY = 0;
        let isPulling = false;
        let activePullContainer = null;
        let pullIndicator = null;

        function initPullToRefresh() {
            if (!isMobile()) return;
            pullIndicator = document.querySelector('.pull-to-refresh-indicator');
            if (!pullIndicator) {
                pullIndicator = document.createElement('div');
                pullIndicator.className = 'pull-to-refresh-indicator';
                pullIndicator.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round"><path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1-.57-8.38l5.67-5.67"/></svg>`;
                document.body.appendChild(pullIndicator);
            }

            document.addEventListener('touchstart', e => {
                if (!isMobile()) return;
                const targetContainer = e.target.closest('#watchlist-items-card, #portfolio-doctor-card, #movers-grid');
                if (!targetContainer) return;

                const scrollContainer = targetContainer.closest('.data-table-wrapper, .watchlist-scroll-wrapper, body');
                if (scrollContainer && scrollContainer.scrollTop > 5) return;
                if (window.scrollY > 5) return;

                pullStartX = e.touches[0].clientX;
                pullStartY = e.touches[0].clientY;
                activePullContainer = targetContainer;
                isPulling = false;
            }, { passive: true });

            document.addEventListener('touchmove', e => {
                if (!activePullContainer || !pullIndicator) return;
                const currentY = e.touches[0].clientY;
                const currentX = e.touches[0].clientX;
                const diffY = currentY - pullStartY;
                const diffX = currentX - pullStartX;

                if (diffY > 10 && Math.abs(diffY) > Math.abs(diffX) * 1.5) {
                    isPulling = true;
                    const pullDist = Math.min(diffY * 0.4, 75);
                    pullIndicator.style.opacity = Math.min(pullDist / 40, 1);
                    pullIndicator.style.transform = `translateX(-50%) translateY(${pullDist}px)`;
                    
                    const rotate = pullDist * 5;
                    const spinner = pullIndicator.querySelector('svg');
                    if (spinner) spinner.style.transform = `rotate(${rotate}deg)`;
                }
            }, { passive: true });

            document.addEventListener('touchend', async e => {
                if (!activePullContainer || !isPulling || !pullIndicator) {
                    activePullContainer = null;
                    isPulling = false;
                    return;
                }
                const diffY = e.changedTouches[0].clientY - pullStartY;
                activePullContainer = null;
                isPulling = false;

                if (diffY > 60) {
                    pullIndicator.classList.add('refreshing');
                    pullIndicator.style.transform = `translateX(-50%) translateY(40px)`;
                    pullIndicator.style.opacity = '1';
                    playHaptic(15);

                    try {
                        const currentHash = location.hash.substring(1) || 'analyzer';
                        if (currentHash === 'watchlist') {
                            const refreshBtn = document.getElementById('watchlist-refresh-btn');
                            if (refreshBtn) refreshBtn.click();
                        } else if (currentHash === 'portfolio') {
                            const refreshBtn = document.getElementById('portfolio-refresh-btn');
                            if (refreshBtn) refreshBtn.click();
                        } else {
                            window.location.reload();
                        }
                    } catch (err) {
                        console.error("[Mobile Refresh] Failed:", err);
                    } finally {
                        setTimeout(() => {
                            if (pullIndicator) {
                                pullIndicator.classList.remove('refreshing');
                                pullIndicator.style.transform = `translateX(-50%) translateY(-46px)`;
                                pullIndicator.style.opacity = '0';
                            }
                        }, 1200);
                    }
                } else {
                    pullIndicator.style.transform = `translateX(-50%) translateY(-46px)`;
                    pullIndicator.style.opacity = '0';
                }
            });
        }
        initPullToRefresh();

        // 4. Custom Mobile Bottom Sheets for Selector Dropdowns
        function initMobileSelects() {
            document.addEventListener('click', e => {
                if (!isMobile()) return;
                const selectEl = e.target.closest('select');
                if (!selectEl || selectEl.id === 'setting-refresh-interval' || selectEl.id === 'setting-speech-voice') return;

                e.preventDefault();
                e.stopPropagation();

                openCustomSelectBottomSheet(selectEl);
            }, true);
        }

        function openQuickSearchBottomSheet() {
            let sheet = document.getElementById('rs-bottom-sheet');
            if (!sheet) {
                sheet = document.createElement('div');
                sheet.id = 'rs-bottom-sheet';
                sheet.className = 'rs-bottom-sheet';
                sheet.innerHTML = `
                    <div class="rs-bottom-sheet-backdrop"></div>
                    <div class="rs-bottom-sheet-content">
                        <div class="rs-bottom-sheet-handle"></div>
                        <h4 id="rs-bottom-sheet-title">Select Option</h4>
                        <div id="rs-bottom-sheet-utility"></div>
                        <button class="rs-bottom-sheet-close" style="margin-top: 15px;">Dismiss</button>
                    </div>
                `;
                document.body.appendChild(sheet);
            }

            document.getElementById('rs-bottom-sheet-title').innerText = "Quick Asset Search";
            const recents = JSON.parse(localStorage.getItem('recent-mobile-searches') || '["RELIANCE", "TCS", "INFY", "TATASTEEL"]');
            
            let html = `
                <div style="display:flex; flex-direction:column; gap:16px; margin: 15px 0;">
                    <div style="position:relative; width:100%;">
                        <input type="text" id="mobile-quick-search-input" placeholder="Enter stock symbol (e.g. RELIANCE)..." style="width:100% !important; box-sizing:border-box !important; padding:12px 16px !important; font-size:14px !important; background:rgba(255,255,255,0.03) !important; border:1px solid var(--border-glass) !important; color:var(--text-primary) !important; border-radius:8px !important;">
                        <div id="mobile-quick-suggestions" class="watchlist-autocomplete-box" style="display:none; position:absolute; top:100%; left:0; right:0; z-index:9999; max-height:220px; overflow-y:auto; margin-top:4px;"></div>
                    </div>
                    <div>
                        <h5 style="margin:0 0 8px 0; font-size:11px; text-transform:uppercase; color:var(--text-secondary); font-family:var(--font-heading);">Recent Searches</h5>
                        <div style="display:flex; flex-wrap:wrap; gap:8px;">
            `;
            
            recents.forEach(sym => {
                html += `<button class="quick-search-pill-btn" data-symbol="${sym}" style="background:rgba(255,255,255,0.03); border:1px solid var(--border-glass); color:var(--text-primary); padding:6px 12px; border-radius:15px; font-size:11px; font-weight:600; cursor:pointer;">${sym}</button>`;
            });
            
            html += `
                        </div>
                    </div>
                    <button class="btn-primary" id="mobile-quick-search-submit-btn" style="width:100%; height:40px; border-radius:8px; font-weight:700;">ANALYZE ASSET</button>
                </div>
            `;

            const utilityContainer = document.getElementById('rs-bottom-sheet-utility');
            utilityContainer.innerHTML = html;
            sheet.classList.add('active');

            // Wire backdrop close
            const backdrop = sheet.querySelector('.rs-bottom-sheet-backdrop');
            const closeBtn = sheet.querySelector('.rs-bottom-sheet-close');
            const closeSheet = () => sheet.classList.remove('active');
            backdrop.onclick = closeSheet;
            closeBtn.onclick = closeSheet;

            const inputEl = document.getElementById('mobile-quick-search-input');
            const suggestionsDiv = document.getElementById('mobile-quick-suggestions');

            setTimeout(() => {
                if (inputEl) inputEl.focus();
            }, 300);

            utilityContainer.querySelectorAll('.quick-search-pill-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    executeQuickSearch(btn.getAttribute('data-symbol'), sheet);
                });
            });

            // Debounced Autocomplete Logic
            let searchDebounceTimer = null;
            if (inputEl && suggestionsDiv) {
                inputEl.addEventListener('input', () => {
                    clearTimeout(searchDebounceTimer);
                    const query = inputEl.value.trim();

                    if (query.length < 2) {
                        suggestionsDiv.innerHTML = '';
                        suggestionsDiv.style.display = 'none';
                        return;
                    }

                    searchDebounceTimer = setTimeout(async () => {
                        try {
                            const res = await fetch(apiBaseUrl + `/api/search/suggestions?q=${encodeURIComponent(query)}`);
                            if (res.ok) {
                                const data = await res.json();
                                suggestionsDiv.innerHTML = '';

                                if (data && data.length > 0) {
                                    data.forEach(item => {
                                        const div = document.createElement('div');
                                        div.className = 'watchlist-autocomplete-item';
                                        div.style.cssText = 'padding: 10px 14px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.03);';
                                        div.innerHTML = `
                                            <div>
                                                <span class="ticker-pill" style="font-weight: 700; color: #fff;">${item.base_symbol}</span>
                                                <span style="font-size: 10px; color: var(--text-muted); margin-left: 6px;">${item.name}</span>
                                            </div>
                                            <span class="sector-pill">${item.sector || 'Equity'}</span>
                                        `;
                                        div.addEventListener('click', () => {
                                            executeQuickSearch(item.base_symbol, sheet);
                                        });
                                        suggestionsDiv.appendChild(div);
                                    });
                                    suggestionsDiv.style.display = 'block';
                                } else {
                                    suggestionsDiv.style.display = 'none';
                                }
                            }
                        } catch (err) {
                            console.error("Autocomplete quick search error:", err);
                        }
                    }, 200);
                });

                // Hide suggestions when clicking outside input or suggestions box
                document.addEventListener('click', (e) => {
                    if (e.target !== inputEl && e.target !== suggestionsDiv && !suggestionsDiv.contains(e.target)) {
                        suggestionsDiv.style.display = 'none';
                    }
                });
            }

            if (inputEl) {
                inputEl.addEventListener('keypress', e => {
                    if (e.key === 'Enter') {
                        executeQuickSearch(inputEl.value.trim(), sheet);
                    }
                });
            }

            const submitBtn = document.getElementById('mobile-quick-search-submit-btn');
            if (submitBtn && inputEl) {
                submitBtn.addEventListener('click', () => {
                    executeQuickSearch(inputEl.value.trim(), sheet);
                });
            }
        }

        function executeQuickSearch(symbol, sheetEl) {
            if (!symbol) return;
            symbol = symbol.toUpperCase();
            
            let recents = JSON.parse(localStorage.getItem('recent-mobile-searches') || '["RELIANCE", "TCS", "INFY", "TATASTEEL"]');
            recents = [symbol, ...recents.filter(s => s !== symbol)].slice(0, 5);
            localStorage.setItem('recent-mobile-searches', JSON.stringify(recents));

            const searchInput = document.getElementById('analyzer-search-input');
            const searchBtn = document.getElementById('analyzer-search-btn');
            if (searchInput && searchBtn) {
                searchInput.value = symbol;
                searchBtn.click();
            }

            sheetEl.classList.remove('active');
            playHaptic(15);
            window.switchTab('analyzer');
        }

        function openCustomSelectBottomSheet(selectEl) {
            let sheet = document.getElementById('rs-bottom-sheet');
            if (!sheet) {
                sheet = document.createElement('div');
                sheet.id = 'rs-bottom-sheet';
                sheet.className = 'rs-bottom-sheet';
                sheet.innerHTML = `
                    <div class="rs-bottom-sheet-backdrop"></div>
                    <div class="rs-bottom-sheet-content">
                        <div class="rs-bottom-sheet-handle"></div>
                        <h4 id="rs-bottom-sheet-title">Select Option</h4>
                        <div id="rs-bottom-sheet-utility"></div>
                        <button class="rs-bottom-sheet-close" style="margin-top: 15px;">Dismiss</button>
                    </div>
                `;
                document.body.appendChild(sheet);
                sheet.querySelector('.rs-bottom-sheet-backdrop').addEventListener('click', () => sheet.classList.remove('active'));
                sheet.querySelector('.rs-bottom-sheet-close').addEventListener('click', () => sheet.classList.remove('active'));
            }

            const label = selectEl.previousElementSibling ? selectEl.previousElementSibling.textContent.trim() : "Select Option";
            document.getElementById('rs-bottom-sheet-title').innerText = label;

            let html = '<div class="bottom-sheet-options-list" style="display:flex;flex-direction:column;gap:12px;margin:15px 0;max-height:300px;overflow-y:auto;-webkit-overflow-scrolling:touch;">';
            Array.from(selectEl.options).forEach((opt, idx) => {
                const isSelected = opt.selected;
                html += `
                    <button class="bottom-sheet-option-row" data-value="${opt.value}" data-index="${idx}" style="background:${isSelected ? 'rgba(99,102,241,0.12)' : 'transparent'}; border:1px solid ${isSelected ? 'rgba(99,102,241,0.3)' : 'rgba(255,255,255,0.06)'}; color:${isSelected ? 'var(--color-primary)' : 'var(--text-primary)'}; padding:12px 16px; border-radius:8px; font-family:Inter,sans-serif; font-size:13px; font-weight:600; text-align:left; cursor:pointer; width:100%; display:flex; justify-content:space-between; align-items:center; outline:none;-webkit-tap-highlight-color:transparent;">
                        <span>${opt.text}</span>
                        ${isSelected ? '<span style="color:var(--color-primary)">✓</span>' : ''}
                    </button>
                `;
            });
            html += '</div>';

            const utilityContainer = document.getElementById('rs-bottom-sheet-utility');
            utilityContainer.innerHTML = html;
            sheet.classList.add('active');

            utilityContainer.querySelectorAll('.bottom-sheet-option-row').forEach(row => {
                row.addEventListener('click', () => {
                    const idx = parseInt(row.getAttribute('data-index'), 10);
                    selectEl.selectedIndex = idx;
                    selectEl.dispatchEvent(new Event('change', { bubbles: true }));
                    playHaptic(8);
                    sheet.classList.remove('active');
                });
            });
        }
        initMobileSelects();

        // 5. Offline Connectivity Dots & local stashing
        function initOfflineDetection() {
            const banner = document.getElementById('network-offline-banner');

            const updateStatus = () => {
                if (!navigator.onLine) {
                    if (banner) banner.classList.add('active');
                    const mobileDot = document.getElementById('mobile-ws-dot');
                    if (mobileDot) {
                        mobileDot.style.background = '#ef4444';
                        mobileDot.style.boxShadow = '0 0 8px #ef4444';
                    }
                    loadOfflineCache();
                } else {
                    if (banner) banner.classList.remove('active');
                }
            };

            window.addEventListener('online', updateStatus);
            window.addEventListener('offline', updateStatus);
            updateStatus();
        }
        initOfflineDetection();

        function stashOfflineCache() {
            try {
                const watchlistBody = document.getElementById('watchlist-table-body');
                if (watchlistBody && watchlistBody.children.length > 0) {
                    localStorage.setItem('cached-watchlist-html', watchlistBody.innerHTML);
                }
                const portfolioCapital = document.getElementById('port-total-investment');
                if (portfolioCapital && portfolioCapital.innerText !== '' && portfolioCapital.innerText !== '--') {
                    const portData = {
                        investment: portfolioCapital.innerText,
                        value: document.getElementById('port-total-value').innerText,
                        pl: document.getElementById('port-total-pl').innerText,
                        plClass: document.getElementById('port-total-pl').className
                    };
                    localStorage.setItem('cached-portfolio-metrics', JSON.stringify(portData));
                }
            } catch(e) {}
        }
        setInterval(stashOfflineCache, 5000);

        function loadOfflineCache() {
            try {
                const cachedWL = localStorage.getItem('cached-watchlist-html');
                const wlBody = document.getElementById('watchlist-table-body');
                if (cachedWL && wlBody && wlBody.children.length === 0) {
                    wlBody.innerHTML = cachedWL;
                    console.log("[Offline Cache] Watchlist stashed values loaded.");
                }
                const cachedPort = localStorage.getItem('cached-portfolio-metrics');
                const portCapital = document.getElementById('port-total-investment');
                if (cachedPort && portCapital && (portCapital.innerText === '' || portCapital.innerText === '--')) {
                    const data = JSON.parse(cachedPort);
                    portCapital.innerText = data.investment;
                    document.getElementById('port-total-value').innerText = data.value;
                    const plEl = document.getElementById('port-total-pl');
                    if (plEl) {
                        plEl.innerText = data.pl;
                        plEl.className = data.plClass;
                    }
                    console.log("[Offline Cache] Portfolio metrics loaded.");
                }
            } catch(e) {}
        }

        // Intercept Connection Status Dot updates
        const originalUpdateIndicator = window.updateConnectionIndicator;
        if (originalUpdateIndicator) {
            window.updateConnectionIndicator = function(status) {
                originalUpdateIndicator(status);
                const mobileDot = document.getElementById('mobile-ws-dot');
                if (mobileDot) {
                    mobileDot.style.display = 'inline-block';
                    if (status === 'live') {
                        mobileDot.style.background = '#10b981';
                        mobileDot.style.boxShadow = '0 0 8px #10b981';
                    } else if (status === 'polling') {
                        mobileDot.style.background = '#f59e0b';
                        mobileDot.style.boxShadow = '0 0 8px #f59e0b';
                    } else {
                        mobileDot.style.background = '#ef4444';
                        mobileDot.style.boxShadow = '0 0 8px #ef4444';
                    }
                }
            };
        }

        // 6. Landscape chart orientation mode
        function initLandscapeChartMode() {
            const handleOrientation = () => {
                const isLandscape = window.innerWidth > window.innerHeight;
                const isChartTab = (location.hash === '#analyzer');
                
                const header = document.querySelector('.mobile-header');
                const footer = document.querySelector('.mobile-bottom-nav');
                const container = document.querySelector('.app-container');
                const chartCard = document.getElementById('tv-chart-workstation');

                if (isMobile() && isLandscape && isChartTab) {
                    if (header) header.style.setProperty('display', 'none', 'important');
                    if (footer) footer.style.setProperty('display', 'none', 'important');
                    if (container) container.style.setProperty('padding-top', '0', 'important');
                    if (chartCard) {
                        chartCard.style.setProperty('position', 'fixed', 'important');
                        chartCard.style.setProperty('top', '0', 'important');
                        chartCard.style.setProperty('left', '0', 'important');
                        chartCard.style.setProperty('width', '100vw', 'important');
                        chartCard.style.setProperty('height', '100vh', 'important');
                        chartCard.style.setProperty('z-index', '99999', 'important');
                    }
                } else {
                    if (header) header.style.display = '';
                    if (footer) footer.style.display = '';
                    if (container) container.style.paddingTop = '';
                    if (chartCard) {
                        chartCard.style.position = '';
                        chartCard.style.top = '';
                        chartCard.style.left = '';
                        chartCard.style.width = '';
                        chartCard.style.height = '';
                        chartCard.style.zIndex = '';
                    }
                }
            };
            window.addEventListener('resize', handleOrientation);
            window.addEventListener('hashchange', handleOrientation);
            handleOrientation();
        }
        initLandscapeChartMode();

        // 7. Fallback Keypad Passcode Lock Screen & Capacitor Lifecycle Hooks
        function initPINKeypadLock() {
            const pinOverlay = document.getElementById('portfolio-pin-overlay');
            if (!pinOverlay) return;

            const dots = pinOverlay.querySelectorAll('.pin-dot');
            let currentPin = "";
            const getPIN = () => localStorage.getItem('portfolio-pin') || '1234';

            pinOverlay.querySelectorAll('.pin-keyboard .pin-key[data-value]').forEach(key => {
                key.addEventListener('click', () => {
                    if (currentPin.length >= 4) return;
                    currentPin += key.getAttribute('data-value');
                    updateDots();
                    if (currentPin.length === 4) {
                        setTimeout(validatePIN, 200);
                    }
                });
            });

            const delBtn = document.getElementById('pin-action-delete');
            if (delBtn) {
                delBtn.addEventListener('click', () => {
                    if (currentPin.length > 0) {
                        currentPin = currentPin.substring(0, currentPin.length - 1);
                        updateDots();
                    }
                });
            }

            const bioBtn = document.getElementById('pin-action-biometric');
            if (bioBtn) {
                bioBtn.addEventListener('click', () => {
                    if (window.triggerBiometricVerification) {
                        window.triggerBiometricVerification();
                    }
                });
            }

            const cancelBtn = document.getElementById('pin-action-cancel');
            if (cancelBtn) {
                cancelBtn.addEventListener('click', () => {
                    pinOverlay.style.display = 'none';
                    window.switchTab('analyzer');
                });
            }

            function updateDots() {
                dots.forEach((dot, idx) => {
                    if (idx < currentPin.length) dot.classList.add('filled');
                    else dot.classList.remove('filled');
                });
            }

            function validatePIN() {
                const hasPin = localStorage.getItem('portfolio-pin') !== null;
                if (!hasPin) {
                    localStorage.setItem('portfolio-pin', currentPin);
                    window.portfolioUnlocked = true;
                    pinOverlay.style.display = 'none';
                    const desktopLock = document.getElementById('portfolio-lock-overlay');
                    if (desktopLock) desktopLock.classList.add('hidden');
                    if (window.loadPortfolioDoctorLedger) {
                        window.loadPortfolioDoctorLedger(true);
                    }
                    window.showToast("Security passcode configured successfully.", "success");
                    currentPin = "";
                    updateDots();
                    return;
                }

                const expected = getPIN();
                if (currentPin === expected) {
                    window.portfolioUnlocked = true;
                    pinOverlay.style.display = 'none';
                    const desktopLock = document.getElementById('portfolio-lock-overlay');
                    if (desktopLock) desktopLock.classList.add('hidden');
                    if (window.loadPortfolioDoctorLedger) {
                        window.loadPortfolioDoctorLedger(true);
                    }
                    window.showToast("Portfolio security shield unlocked.", "success");
                    currentPin = "";
                    updateDots();
                } else {
                    pinOverlay.classList.add('pin-shake-animate');
                    playHaptic(30);
                    setTimeout(() => {
                        pinOverlay.classList.remove('pin-shake-animate');
                        currentPin = "";
                        updateDots();
                    }, 400);
                }
            }

            // Wrap switchTab to overlay PIN modal on mobile
            const wrappedSwitch = window.switchTab;
            window.switchTab = function(tabKey) {
                if (tabKey === 'portfolio' && isMobile()) {
                    const shieldEnabled = localStorage.getItem('portfolio-security-shield-enabled') !== 'false';
                    if (shieldEnabled && !window.portfolioUnlocked) {
                        pinOverlay.style.display = 'flex';
                        const desktopLock = document.getElementById('portfolio-lock-overlay');
                        if (desktopLock) desktopLock.classList.add('hidden');
                        
                        if (window.triggerBiometricVerification) {
                            setTimeout(() => {
                                if (pinOverlay.style.display === 'flex' && !window.portfolioUnlocked) {
                                    window.triggerBiometricVerification();
                                }
                            }, 300);
                        }
                        wrappedSwitch(tabKey);
                        return;
                    }
                }
                wrappedSwitch(tabKey);
            };

            // Enhance biometric trigger to unlock mobile overlay
            const originalBioVerify = window.triggerBiometricVerification;
            if (originalBioVerify) {
                window.triggerBiometricVerification = async function() {
                    const NativeBiometric = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.NativeBiometric;
                    if (NativeBiometric) {
                        try {
                            const avail = await NativeBiometric.isAvailable();
                            if (avail.isAvailable) {
                                await NativeBiometric.verifyIdentity({
                                    reason: 'Unlock Portfolio Security Shield',
                                    title: 'Portfolio Lock',
                                    subtitle: 'Verify identity to view diagnostics audit ledger'
                                });
                                window.portfolioUnlocked = true;
                                pinOverlay.style.display = 'none';
                                const desktopLock = document.getElementById('portfolio-lock-overlay');
                                if (desktopLock) desktopLock.classList.add('hidden');
                                if (window.loadPortfolioDoctorLedger) {
                                    window.loadPortfolioDoctorLedger(true);
                                }
                                window.showToast("Portfolio security shield unlocked via biometrics.", "success");
                                return;
                            }
                        } catch (e) {
                            console.warn("Native biometrics failed, using passcode fallback.", e);
                        }
                    }
                    originalBioVerify();
                    let checks = 0;
                    const checkInterval = setInterval(() => {
                        checks++;
                        if (window.portfolioUnlocked) {
                            pinOverlay.style.display = 'none';
                            clearInterval(checkInterval);
                        }
                        if (checks > 20) clearInterval(checkInterval);
                    }, 200);
                };
            }
        }
        initPINKeypadLock();

        // ==================== PREMIUM MOBILE ENHANCEMENTS ====================
        
        // Helper to format rupees safely
        const formatRupees = (val) => {
            if (typeof safeFormatRupees === 'function') return safeFormatRupees(val, 2);
            return '₹' + (val || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        };

        // 1. Swipe-to-Action Rows on Lists (Watchlist & Portfolio)
        function setupSwipeableWatchlistRows() {
            const watchlistBody = document.getElementById('watchlist-table-body');
            const holdingsBody = document.getElementById('holdings-table-body');
            
            const bindSwipe = (body) => {
                if (!body) return;
                let startX = 0;
                let startY = 0;
                let activeRow = null;
                let currentOffset = 0;
                let isSwipingRow = false;

                body.addEventListener('touchstart', e => {
                    const tr = e.target.closest('tr');
                    if (!tr || e.target.closest('button, input, a, select')) return;
                    
                    startX = e.touches[0].clientX;
                    startY = e.touches[0].clientY;
                    activeRow = tr;
                    isSwipingRow = false;
                    
                    // Reset other swiped rows
                    body.querySelectorAll('tr').forEach(row => {
                        if (row !== activeRow && row.style.transform) {
                            row.style.transform = '';
                            row.style.transition = 'transform 0.25s ease';
                        }
                    });
                }, { passive: true });

                body.addEventListener('touchmove', e => {
                    if (!activeRow) return;
                    
                    const currentX = e.touches[0].clientX;
                    const currentY = e.touches[0].clientY;
                    const diffX = currentX - startX;
                    const diffY = currentY - startY;

                    if (Math.abs(diffX) > Math.abs(diffY) * 1.5 && Math.abs(diffX) > 10) {
                        isSwipingRow = true;
                        currentOffset = Math.max(-80, Math.min(80, diffX));
                        activeRow.style.transform = `translateX(${currentOffset}px)`;
                        activeRow.style.transition = 'none';
                    }
                }, { passive: true });

                body.addEventListener('touchend', e => {
                    if (!activeRow || !isSwipingRow) {
                        activeRow = null;
                        return;
                    }

                    activeRow.style.transition = 'transform 0.2s ease-out';
                    if (currentOffset < -40) {
                        activeRow.style.transform = 'translateX(-70px)';
                        triggerSwipeRowAction(activeRow, 'delete');
                    } else if (currentOffset > 40) {
                        activeRow.style.transform = 'translateX(70px)';
                        triggerSwipeRowAction(activeRow, 'audit');
                    } else {
                        activeRow.style.transform = '';
                    }
                    activeRow = null;
                });
            };

            bindSwipe(watchlistBody);
            bindSwipe(holdingsBody);
        }

        function triggerSwipeRowAction(rowEl, action) {
            const firstCell = rowEl.cells[0];
            if (!firstCell) return;
            const symbol = firstCell.textContent.trim().split('\n')[0].replace('.NS', '').trim();
            
            playHaptic(12);
            if (action === 'delete') {
                window.showToast(`Action: Delete/Remove ${symbol}`, "info");
                const delBtn = rowEl.querySelector('button[title*="Delete"], button[onclick*="deleteWatchlistItem"], button[onclick*="deleteHoldingsItem"]');
                if (delBtn) {
                    delBtn.click();
                } else {
                    const buttons = rowEl.querySelectorAll('button');
                    if (buttons.length > 0) {
                        buttons[buttons.length - 1].click(); // assume last button is delete
                    }
                }
                setTimeout(() => { if (rowEl) rowEl.style.transform = ''; }, 600);
            } else if (action === 'audit') {
                window.showToast(`Triggering AI Audit: ${symbol}`, "success");
                const searchInput = document.getElementById('analyzer-search-input');
                const searchBtn = document.getElementById('analyzer-search-btn');
                if (searchInput && searchBtn) {
                    searchInput.value = symbol;
                    searchBtn.click();
                    window.switchTab('analyzer');
                }
                setTimeout(() => { if (rowEl) rowEl.style.transform = ''; }, 600);
            }
        }

        // 2. Compact Equities Tearsheet Header
        function setupMobileTearsheet() {
            const searchBtn = document.getElementById('analyzer-search-btn');
            const searchInput = document.getElementById('analyzer-search-input');
            
            if (searchBtn && searchInput) {
                const triggerUpdate = () => {
                    setTimeout(updateMobileTearsheetContent, 1000);
                };
                searchBtn.addEventListener('click', triggerUpdate);
                searchInput.addEventListener('keypress', e => {
                    if (e.key === 'Enter') triggerUpdate();
                });
            }
        }

        function updateMobileTearsheetContent() {
            if (!isMobile()) return;
            if (typeof activeStockProfile === 'undefined' || !activeStockProfile || !activeStockProfile.ticker) return;

            let tearsheet = document.getElementById('mobile-tearsheet-container');
            if (!tearsheet) {
                const analyzerTab = document.getElementById('tab-analyzer');
                if (analyzerTab) {
                    tearsheet = document.createElement('div');
                    tearsheet.id = 'mobile-tearsheet-container';
                    tearsheet.className = 'mobile-tearsheet no-print';
                    analyzerTab.insertBefore(tearsheet, analyzerTab.firstChild);
                }
            }

            if (!tearsheet) return;

            const ticker = activeStockProfile.ticker;
            const name = activeStockProfile.name || activeStockProfile.company_name || "Company Profile";
            const price = activeStockProfile.fundamentals?.current_price || activeStockProfile.price || 0;
            const changePct = activeStockProfile.technicals?.price_change_pct || activeStockProfile.change_pct || 0;
            const high = activeStockProfile.technicals?.daily_high || price * 1.02;
            const low = activeStockProfile.technicals?.daily_low || price * 0.98;
            
            let sliderPct = 50;
            if (high > low) {
                sliderPct = Math.max(0, Math.min(100, ((price - low) / (high - low)) * 100));
            }

            const isPositive = changePct >= 0;
            const sign = isPositive ? '+' : '';

            tearsheet.innerHTML = `
                <div class="tearsheet-meta-row" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                    <div>
                        <h3 style="margin:0;font-family:var(--font-heading);font-size:16px;font-weight:800;color:var(--text-primary);">${ticker}</h3>
                        <span style="font-size:10px;color:var(--text-secondary);">${name}</span>
                    </div>
                    <div class="tearsheet-price-area" style="text-align:right;">
                        <span style="font-size:18px;font-family:var(--font-heading);font-weight:800;color:var(--text-primary);">${formatRupees(price)}</span>
                        <span class="${isPositive ? 'green-text' : 'red-text'}" style="font-size:11px;font-weight:700;margin-left:6px;">
                            ${sign}${changePct.toFixed(2)}%
                        </span>
                    </div>
                </div>
                <div class="tearsheet-range-slider" style="height:4px; background:rgba(255,255,255,0.06); border-radius:2px; position:relative; margin:10px 0 6px 0;">
                    <div style="position:absolute; top:0; bottom:0; left:0; right:0; background:linear-gradient(90deg, #ef4444, #eab308, #22c55e); border-radius:2px; opacity:0.15;"></div>
                    <div class="tearsheet-range-marker" style="left: ${sliderPct}%; width:10px; height:10px; border-radius:50%; background:var(--color-primary-light); box-shadow:0 0 8px var(--color-primary); position:absolute; top:-3px; transform:translateX(-50%); transition:left 0.3s ease;"></div>
                </div>
                <div class="tearsheet-range-labels" style="display:flex; justify-content:space-between; font-size:9px; color:var(--text-secondary); font-family:Inter;">
                    <span>L: ${formatRupees(low)}</span>
                    <span>H: ${formatRupees(high)}</span>
                </div>
            `;
        }

        // 3. Persistent Quick-Search Overlay in Header
        function injectMobileHeaderSearch() {
            const header = document.querySelector('.mobile-header');
            if (!header || document.getElementById('mobile-search-trigger')) return;

            const searchBtn = document.createElement('button');
            searchBtn.id = 'mobile-search-trigger';
            searchBtn.className = 'theme-toggle-btn';
            searchBtn.innerHTML = '🔍';
            searchBtn.style.marginRight = '6px';
            
            const themeToggle = document.getElementById('mobile-theme-toggle');
            if (themeToggle) {
                header.insertBefore(searchBtn, themeToggle);
            } else {
                header.appendChild(searchBtn);
            }

            searchBtn.addEventListener('click', openQuickSearchBottomSheet);
        }



        // 4. TradingView Mobile Touch Options
        function configureChartMobileTouchOptions() {
            if (window.lightweightChartInstance) {
                try {
                    window.lightweightChartInstance.applyOptions({
                        handleScroll: { touchMouseMove: true },
                        handleScale: { pinchTrigger: true },
                        kineticScroll: { touch: true }
                    });
                    console.log("[Chart Mobile Touch] Interactive options applied.");
                } catch(e) {}
            }
        }

        // 5. Live Neon Ticks Flares
        function triggerLiveNeonPriceFlares(ticksData) {
            const watchlistBody = document.getElementById('watchlist-table-body');
            if (!watchlistBody) return;
            
            for (const symbol in ticksData) {
                const cleanSymbol = symbol.replace('.NS', '').trim();
                Array.from(watchlistBody.rows).forEach(row => {
                    const symbolCell = row.cells[0];
                    if (symbolCell && symbolCell.textContent.trim().replace('.NS', '') === cleanSymbol) {
                        const data = ticksData[symbol];
                        const isPositive = data.change >= 0;
                        const flareClass = isPositive ? 'glow-flare-green' : 'glow-flare-red';
                        
                        row.classList.add(flareClass);
                        setTimeout(() => {
                            row.classList.remove(flareClass);
                        }, 800);
                    }
                });
            }
        }

        // Attach listeners and tick hooks if mobile
        if (isMobile()) {
            setupSwipeableWatchlistRows();
            setupMobileTearsheet();
            injectMobileHeaderSearch();
            configureChartMobileTouchOptions();
        }

        const originalHandleTick = window.handleLiveTickMessage;
        if (originalHandleTick) {
            window.handleLiveTickMessage = function(ticksData) {
                originalHandleTick(ticksData);
                if (isMobile()) {
                    updateMobileTearsheetContent();
                    triggerLiveNeonPriceFlares(ticksData);
                }
            };
        }

        // Periodic chart verification
        setInterval(configureChartMobileTouchOptions, 3000);

        function initSleekFooterSettings() {
            const disclaimerToggle = document.getElementById('setting-disclaimers-toggle');
            const telemetryToggle = document.getElementById('setting-telemetry-toggle');
            const disclaimerEl = document.querySelector('.footer-disclaimer');
            const telemetryEl = document.querySelector('.footer-diagnostics');

            // Load saved state (default true if not set)
            const showDisclaimers = localStorage.getItem('settings-show-disclaimers') !== 'false';
            const showTelemetry = localStorage.getItem('settings-show-telemetry') !== 'false';

            // Set initial UI state
            if (disclaimerToggle) {
                disclaimerToggle.checked = showDisclaimers;
                disclaimerToggle.addEventListener('change', (e) => {
                    const checked = e.target.checked;
                    localStorage.setItem('settings-show-disclaimers', checked);
                    if (disclaimerEl) {
                        disclaimerEl.style.setProperty('display', checked ? '' : 'none', 'important');
                    }
                });
            }
            if (disclaimerEl) {
                disclaimerEl.style.setProperty('display', showDisclaimers ? '' : 'none', 'important');
            }

            if (telemetryToggle) {
                telemetryToggle.checked = showTelemetry;
                telemetryToggle.addEventListener('change', (e) => {
                    const checked = e.target.checked;
                    localStorage.setItem('settings-show-telemetry', checked);
                    if (telemetryEl) {
                        telemetryEl.style.setProperty('display', checked ? '' : 'none', 'important');
                    }
                });
            }
            if (telemetryEl) {
                telemetryEl.style.setProperty('display', showTelemetry ? '' : 'none', 'important');
            }
        }

        function decorateWatchlistRowsForMobile() {
            const tbody = document.getElementById('watchlist-table-body');
            if (!tbody) return;

            if (!isMobile()) {
                tbody.querySelectorAll('.row-expand-trigger').forEach(el => el.remove());
                tbody.querySelectorAll('.watchlist-details-row').forEach(el => el.remove());
                return;
            }

            tbody.querySelectorAll('tr').forEach(tr => {
                if (tr.classList.contains('watchlist-details-row') || tr.querySelector('.row-expand-trigger') || tr.cells.length < 5) return;

                const firstCell = tr.cells[0];
                if (!firstCell) return;

                const symbolLinkWrapper = firstCell.querySelector('div > div:first-child');
                if (!symbolLinkWrapper) return;

                const chevron = document.createElement('span');
                chevron.className = 'row-expand-trigger';
                chevron.style.cssText = 'cursor: pointer; padding: 2px 6px; font-size: 10px; color: var(--color-primary-light); user-select: none; transition: transform 0.2s; font-weight: bold; margin-left: 4px;';
                chevron.innerHTML = '▼';
                
                symbolLinkWrapper.appendChild(chevron);

                chevron.addEventListener('click', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    
                    let nextRow = tr.nextElementSibling;
                    if (nextRow && nextRow.classList.contains('watchlist-details-row')) {
                        nextRow.remove();
                        chevron.innerHTML = '▼';
                    } else {
                        const sector = tr.cells[1] ? tr.cells[1].textContent.trim() : 'N/A';
                        const changeVal = tr.cells[3] ? tr.cells[3].textContent.trim() : 'N/A';
                        const dayHigh = tr.cells[5] ? tr.cells[5].textContent.trim() : 'N/A';
                        const dayLow = tr.cells[6] ? tr.cells[6].textContent.trim() : 'N/A';

                        const detailsTr = document.createElement('tr');
                        detailsTr.className = 'watchlist-details-row no-print';
                        detailsTr.style.background = 'rgba(255, 255, 255, 0.01)';
                        detailsTr.innerHTML = `
                            <td colspan="8" style="padding: 10px 15px; border-top: 1px dashed rgba(255,255,255,0.05); border-bottom: 1px dashed rgba(255,255,255,0.05);">
                                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 11px; color: var(--text-secondary); line-height: 1.4;">
                                    <div><strong>Sector:</strong> ${sector}</div>
                                    <div style="text-align: right;"><strong>Day High:</strong> ${dayHigh}</div>
                                    <div><strong>Daily Change:</strong> ${changeVal}</div>
                                    <div style="text-align: right;"><strong>Day Low:</strong> ${dayLow}</div>
                                </div>
                            </td>
                        `;
                        tr.parentNode.insertBefore(detailsTr, tr.nextSibling);
                        chevron.innerHTML = '▲';
                    }
                });
            });
        }

        function decoratePortfolioRowsForMobile() {
            const tbody = document.getElementById('portfolio-ledger-body');
            if (!tbody) return;

            if (!isMobile()) {
                tbody.querySelectorAll('.row-expand-trigger').forEach(el => el.remove());
                tbody.querySelectorAll('.portfolio-details-row').forEach(el => el.remove());
                tbody.querySelectorAll('.mobile-tranche-meta').forEach(el => el.remove());
                return;
            }

            tbody.querySelectorAll('tr').forEach(tr => {
                if (tr.classList.contains('portfolio-details-row') || tr.querySelector('.row-expand-trigger') || tr.cells.length < 10) return;

                const firstCell = tr.cells[0];
                if (!firstCell) return;

                // Extract quantity and average price before hiding columns
                const qtyInput = tr.querySelector('.portfolio-qty-input');
                const priceInput = tr.querySelector('.portfolio-price-input');
                const hasInputs = qtyInput !== null && priceInput !== null;

                let qtyVal = '';
                let priceVal = '';

                if (hasInputs) {
                    qtyVal = qtyInput.value;
                    priceVal = priceInput.value;
                } else {
                    qtyVal = tr.cells[1] ? tr.cells[1].textContent.trim().replace(' 🔗', '') : '';
                    priceVal = tr.cells[2] ? tr.cells[2].textContent.trim() : '';
                }

                // Add mobile static metadata badge under stock name if not present
                if (!firstCell.querySelector('.mobile-tranche-meta')) {
                    const metaSpan = document.createElement('span');
                    metaSpan.className = 'mobile-tranche-meta';
                    metaSpan.style.cssText = 'font-size: 10px; color: var(--color-primary-light); font-weight: 600; display: block; margin-top: 3px;';
                    metaSpan.innerHTML = `Holdings: ${qtyVal} @ ${priceVal}`;
                    firstCell.appendChild(metaSpan);
                }

                const chevron = document.createElement('span');
                chevron.className = 'row-expand-trigger';
                chevron.style.cssText = 'cursor: pointer; padding: 2px 6px; font-size: 10px; color: var(--color-primary-light); user-select: none; transition: transform 0.2s; font-weight: bold; margin-left: 4px;';
                chevron.innerHTML = '▼';
                
                firstCell.appendChild(chevron);

                chevron.addEventListener('click', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    
                    let nextRow = tr.nextElementSibling;
                    if (nextRow && nextRow.classList.contains('portfolio-details-row')) {
                        nextRow.remove();
                        chevron.innerHTML = '▼';
                    } else {
                        const targets = tr.cells[3] ? tr.cells[3].innerHTML : 'N/A';
                        const dayChg = tr.cells[6] ? tr.cells[6].textContent.trim() : 'N/A';
                        const investedVal = tr.cells[7] ? tr.cells[7].textContent.trim() : 'N/A';
                        const currentVal = tr.cells[8] ? tr.cells[8].textContent.trim() : 'N/A';
                        const target12M = tr.cells[10] ? tr.cells[10].textContent.trim() : 'N/A';
                        const stopLoss12M = tr.cells[11] ? tr.cells[11].textContent.trim() : 'N/A';
                        const actionBtn = tr.cells[12] ? tr.cells[12].innerHTML : '';

                        let editControlsHTML = '';
                        if (hasInputs) {
                            const dataId = qtyInput.getAttribute('data-id');
                            const dataSymbol = qtyInput.getAttribute('data-symbol');
                            editControlsHTML = `
                                <div style="border-top: 1px dashed rgba(255,255,255,0.08); padding-top: 10px; margin-top: 10px;">
                                    <div style="font-size: 10px; font-weight: 700; color: var(--color-primary-light); margin-bottom: 6px; text-transform: uppercase; letter-spacing: 0.05em;">Edit Holdings Position</div>
                                    <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
                                        <div style="display: flex; align-items: center; gap: 4px;">
                                            <span style="font-size: 10px; color: var(--text-secondary);">Qty:</span>
                                            <input type="number" class="portfolio-qty-input-mobile" data-id="${dataId}" data-symbol="${dataSymbol}" value="${qtyVal}" style="width: 55px; padding: 4px; border-radius:4px; background:rgba(0,0,0,0.3); border:1px solid var(--border-glass); color:#fff; font-size:11px; text-align: right;">
                                        </div>
                                        <div style="display: flex; align-items: center; gap: 4px;">
                                            <span style="font-size: 10px; color: var(--text-secondary);">Avg (₹):</span>
                                            <input type="number" class="portfolio-price-input-mobile" data-id="${dataId}" data-symbol="${dataSymbol}" value="${priceVal}" style="width: 75px; padding: 4px; border-radius:4px; background:rgba(0,0,0,0.3); border:1px solid var(--border-glass); color:#fff; font-size:11px; text-align: right;">
                                        </div>
                                        <button class="btn-primary save-portfolio-item-btn-mobile" style="font-size: 10px; padding: 4px 8px; cursor: pointer; border-radius: 4px; height: 24px; display: flex; align-items: center; justify-content: center; font-weight: bold; background: var(--color-primary);">Save</button>
                                    </div>
                                </div>
                            `;
                        }

                        const detailsTr = document.createElement('tr');
                        detailsTr.className = 'portfolio-details-row no-print';
                        detailsTr.style.background = 'rgba(255, 255, 255, 0.01)';
                        detailsTr.innerHTML = `
                            <td colspan="13" style="padding: 12px 15px; border-top: 1px dashed rgba(255,255,255,0.05); border-bottom: 1px dashed rgba(255,255,255,0.05);">
                                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 11px; color: var(--text-secondary); line-height: 1.45; margin-bottom: 8px;">
                                    <div><strong>Invested Value:</strong> ${investedVal}</div>
                                    <div style="text-align: right;"><strong>Current Value:</strong> ${currentVal}</div>
                                    <div><strong>Day Change %:</strong> ${dayChg}</div>
                                    <div style="text-align: right;"><strong>12M Target Price:</strong> ${target12M}</div>
                                    <div><strong>12M Stop Loss:</strong> ${stopLoss12M}</div>
                                    <div style="text-align: right; display: flex; justify-content: flex-end; align-items: center; gap: 4px;"><strong>Ledger Action:</strong> ${actionBtn}</div>
                                </div>
                                <div style="font-size: 10px; color: var(--text-muted); margin-top: 6px;">
                                    <strong>Valuation Target Range:</strong>
                                    <div style="margin-top: 4px;">${targets}</div>
                                </div>
                                ${editControlsHTML}
                            </td>
                        `;
                        tr.parentNode.insertBefore(detailsTr, tr.nextSibling);

                        const delBtn = detailsTr.querySelector('.remove-portfolio-ledger-item-btn');
                        if (delBtn) {
                            delBtn.addEventListener('click', (evt) => {
                                const origDelBtn = tr.cells[12].querySelector('.remove-portfolio-ledger-item-btn');
                                if (origDelBtn) origDelBtn.click();
                            });
                        }

                        const saveBtn = detailsTr.querySelector('.save-portfolio-item-btn-mobile');
                        if (saveBtn) {
                            saveBtn.addEventListener('click', async () => {
                                const mQtyInput = detailsTr.querySelector('.portfolio-qty-input-mobile');
                                const mPriceInput = detailsTr.querySelector('.portfolio-price-input-mobile');
                                const qtyValNew = parseFloat(mQtyInput.value) || 0;
                                const priceValNew = parseFloat(mPriceInput.value) || 0;
                                
                                const origQtyInput = tr.querySelector('.portfolio-qty-input');
                                const origPriceInput = tr.querySelector('.portfolio-price-input');
                                if (origQtyInput) origQtyInput.value = qtyValNew;
                                if (origPriceInput) origPriceInput.value = priceValNew;

                                const dataId = mQtyInput.getAttribute('data-id');
                                try {
                                    const res = await fetch(apiBaseUrl + `/api/portfolio/${dataId}`, {
                                        method: 'PUT',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ quantity: qtyValNew, purchase_price: priceValNew })
                                    });
                                    if (res.ok) {
                                        if (window.showToast) window.showToast("Holdings updated successfully", "success");
                                        if (window.loadPortfolioDoctorLedger) {
                                            await window.loadPortfolioDoctorLedger();
                                        }
                                    }
                                } catch (err) {
                                    console.error(err);
                                }
                            });
                        }

                        chevron.innerHTML = '▲';
                    }
                });
            });
        }

        function decorateUniverseRowsForMobile() {
            const tbody = document.getElementById('universe-explorer-body');
            if (!tbody) return;

            if (!isMobile()) {
                tbody.querySelectorAll('.row-expand-trigger').forEach(el => el.remove());
                tbody.querySelectorAll('.universe-details-row').forEach(el => el.remove());
                return;
            }

            tbody.querySelectorAll('tr').forEach(tr => {
                if (tr.classList.contains('universe-details-row') || tr.querySelector('.row-expand-trigger') || tr.cells.length < 5) return;

                const firstCell = tr.cells[1];
                if (!firstCell) return;

                const chevron = document.createElement('span');
                chevron.className = 'row-expand-trigger';
                chevron.style.cssText = 'cursor: pointer; padding: 2px 6px; font-size: 10px; color: var(--color-primary-light); user-select: none; transition: transform 0.2s; font-weight: bold; margin-left: 4px;';
                chevron.innerHTML = '▼';
                
                const symbolLink = firstCell.querySelector('.universe-symbol-link') || firstCell;
                symbolLink.appendChild(chevron);

                chevron.addEventListener('click', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    
                    let nextRow = tr.nextElementSibling;
                    if (nextRow && nextRow.classList.contains('universe-details-row')) {
                        nextRow.remove();
                        chevron.innerHTML = '▼';
                    } else {
                        const serialNum = tr.cells[0] ? tr.cells[0].textContent.trim() : '';
                        const companyName = tr.cells[2] ? tr.cells[2].textContent.trim() : 'N/A';
                        const sector = tr.cells[3] ? tr.cells[3].textContent.trim() : 'N/A';
                        const segment = tr.cells[4] ? tr.cells[4].textContent.trim() : 'N/A';
                        const cacheStatus = tr.cells[5] ? tr.cells[5].innerHTML : 'N/A';
                        const actionsHtml = tr.cells[6] ? tr.cells[6].innerHTML : '';

                        const detailsTr = document.createElement('tr');
                        detailsTr.className = 'universe-details-row no-print';
                        detailsTr.style.background = 'rgba(255, 255, 255, 0.01)';
                        detailsTr.innerHTML = `
                            <td colspan="7" style="padding: 10px 15px; border-top: 1px dashed rgba(255,255,255,0.05); border-bottom: 1px dashed rgba(255,255,255,0.05);">
                                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 11px; color: var(--text-secondary); line-height: 1.45;">
                                    <div style="grid-column: span 2; font-size: 12px; color: var(--color-primary-light); font-weight: bold; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 4px; margin-bottom: 4px;">
                                        ${companyName}
                                    </div>
                                    <div><strong>Index Rank:</strong> #${serialNum}</div>
                                    <div style="text-align: right; display: flex; justify-content: flex-end; align-items: center; gap: 4px;"><strong>Cache Status:</strong> ${cacheStatus}</div>
                                </div>
                                <div style="border-top: 1px dashed rgba(255,255,255,0.08); padding-top: 8px; margin-top: 8px; display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap;">
                                    <span style="font-size: 10px; color: var(--text-muted);">Explorer Actions:</span>
                                    <div class="mobile-actions-wrapper" style="display: flex; gap: 6px;">
                                        ${actionsHtml}
                                    </div>
                                </div>
                            </td>
                        `;
                        tr.parentNode.insertBefore(detailsTr, tr.nextSibling);

                        const detailsActions = detailsTr.querySelectorAll('button');
                        const originalActions = tr.cells[6].querySelectorAll('button');
                        detailsActions.forEach((btn, idx) => {
                            btn.addEventListener('click', (evt) => {
                                if (originalActions[idx]) originalActions[idx].click();
                            });
                        });

                        chevron.innerHTML = '▲';
                    }
                });
            });
        }

        function decorateAlertsRowsForMobile() {
            const tbody = document.getElementById('alerts-table-body');
            if (!tbody) return;

            if (!isMobile()) {
                tbody.querySelectorAll('.row-expand-trigger').forEach(el => el.remove());
                tbody.querySelectorAll('.alerts-details-row').forEach(el => el.remove());
                tbody.querySelectorAll('.mobile-alerts-meta').forEach(el => el.remove());
                return;
            }

            tbody.querySelectorAll('tr').forEach(tr => {
                if (tr.classList.contains('alerts-details-row') || tr.querySelector('.row-expand-trigger') || tr.cells.length < 5) return;

                const firstCell = tr.cells[0];
                if (!firstCell) return;

                const conditionType = tr.cells[1] ? tr.cells[1].textContent.trim() : 'N/A';
                const targetCondition = tr.cells[2] ? tr.cells[2].textContent.trim() : 'N/A';
                
                let combinedText = '';
                if (conditionType === 'PRICE') {
                    combinedText = targetCondition;
                } else {
                    combinedText = `${conditionType} ${targetCondition}`;
                }

                if (!firstCell.querySelector('.mobile-alerts-meta')) {
                    const metaSpan = document.createElement('span');
                    metaSpan.className = 'mobile-alerts-meta';
                    metaSpan.style.cssText = 'display: block; margin-top: 3px; font-size: 10px; color: var(--text-secondary); font-family: monospace; font-weight: bold;';
                    metaSpan.textContent = combinedText;
                    firstCell.appendChild(metaSpan);
                }

                const chevron = document.createElement('span');
                chevron.className = 'row-expand-trigger';
                chevron.style.cssText = 'cursor: pointer; padding: 2px 6px; font-size: 10px; color: var(--color-primary-light); user-select: none; transition: transform 0.2s; font-weight: bold; margin-left: 4px;';
                chevron.innerHTML = '▼';
                
                const link = firstCell.querySelector('.alert-stock-link') || firstCell;
                link.appendChild(chevron);

                chevron.addEventListener('click', (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    
                    let nextRow = tr.nextElementSibling;
                    if (nextRow && nextRow.classList.contains('alerts-details-row')) {
                        nextRow.remove();
                        chevron.innerHTML = '▼';
                    } else {
                        const targetCondition = tr.cells[2] ? tr.cells[2].innerHTML : 'N/A';
                        const triggeredAt = tr.cells[4] ? tr.cells[4].innerHTML : 'Active scan...';
                        const actionBtn = tr.cells[5] ? tr.cells[5].innerHTML : '';

                        const detailsTr = document.createElement('tr');
                        detailsTr.className = 'alerts-details-row no-print';
                        detailsTr.style.background = 'rgba(255, 255, 255, 0.01)';
                        detailsTr.innerHTML = `
                            <td colspan="6" style="padding: 10px 15px; border-top: 1px dashed rgba(255,255,255,0.05); border-bottom: 1px dashed rgba(255,255,255,0.05);">
                                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 11px; color: var(--text-secondary); line-height: 1.45;">
                                    <div><strong>Trigger Target:</strong> <code style="font-family: monospace; font-size: 11px; color: var(--color-primary-light); font-weight: bold;">${targetCondition}</code></div>
                                    <div style="text-align: right;"><strong>Scan Status:</strong> ${triggeredAt}</div>
                                </div>
                                <div style="border-top: 1px dashed rgba(255,255,255,0.08); padding-top: 8px; margin-top: 8px; display: flex; justify-content: space-between; align-items: center;">
                                    <span style="font-size: 10px; color: var(--text-muted);">Cockpit Operations:</span>
                                    <div class="mobile-actions-wrapper">
                                        ${actionBtn}
                                    </div>
                                </div>
                            </td>
                        `;
                        tr.parentNode.insertBefore(detailsTr, tr.nextSibling);

                        const detailsDelBtn = detailsTr.querySelector('.btn-translucent-delete');
                        const originalDelBtn = tr.cells[5].querySelector('.btn-translucent-delete');
                        if (detailsDelBtn && originalDelBtn) {
                            detailsDelBtn.addEventListener('click', (evt) => {
                                originalDelBtn.click();
                            });
                        }

                        chevron.innerHTML = '▲';
                    }
                });
            });
        }

        function setupWatchlistTableObserver() {
            const tbody = document.getElementById('watchlist-table-body');
            if (tbody) {
                decorateWatchlistRowsForMobile();
                const observer = new MutationObserver(() => decorateWatchlistRowsForMobile());
                observer.observe(tbody, { childList: true });
            }
        }

        function setupPortfolioTableObserver() {
            const tbody = document.getElementById('portfolio-ledger-body');
            if (tbody) {
                decoratePortfolioRowsForMobile();
                const observer = new MutationObserver(() => decoratePortfolioRowsForMobile());
                observer.observe(tbody, { childList: true });
            }
        }

        function setupUniverseTableObserver() {
            const tbody = document.getElementById('universe-explorer-body');
            if (tbody) {
                decorateUniverseRowsForMobile();
                const observer = new MutationObserver(() => decorateUniverseRowsForMobile());
                observer.observe(tbody, { childList: true });
            }
        }

        function setupAlertsTableObserver() {
            const tbody = document.getElementById('alerts-table-body');
            if (tbody) {
                decorateAlertsRowsForMobile();
                const observer = new MutationObserver(() => decorateAlertsRowsForMobile());
                observer.observe(tbody, { childList: true });
            }
        }

        function decorateRuleScannerRowsForMobile() {
            const tbody = document.getElementById('rule-scanner-results-body');
            if (!tbody) return;

            if (!isMobile()) {
                tbody.querySelectorAll('.row-expand-trigger').forEach(el => el.remove());
                tbody.querySelectorAll('.rs-details-row').forEach(el => el.remove());
                tbody.querySelectorAll('.mobile-rs-meta').forEach(el => el.remove());
                tbody.querySelectorAll('.mobile-segment-tag').forEach(el => el.remove());
                return;
            }

            tbody.querySelectorAll('tr').forEach(tr => {
                if (tr.classList.contains('rs-details-row') || tr.querySelector('.row-expand-trigger') || tr.cells.length < 8) return;

                const firstCell = tr.cells[0];
                const priceCell = tr.cells[2];
                if (!firstCell || !priceCell) return;

                // Add segment meta inline under stock name if not present
                const spans = firstCell.querySelectorAll('span');
                const companyNameSpan = spans[1];
                const segmentText = tr.cells[1] ? tr.cells[1].textContent.trim() : '';

                if (companyNameSpan && segmentText && !companyNameSpan.querySelector('.mobile-segment-tag')) {
                    const originalText = companyNameSpan.textContent.trim();
                    companyNameSpan.innerHTML = `${originalText} <span class="mobile-segment-tag" style="color: var(--color-primary-light); font-weight: bold; margin-left: 4px;">• ${segmentText}</span>`;
                }

                // Add rating meta under price if not present
                const ratingHtml = tr.cells[6] ? tr.cells[6].innerHTML : '';
                if (!priceCell.querySelector('.mobile-rs-meta')) {
                    const metaSpan = document.createElement('span');
                    metaSpan.className = 'mobile-rs-meta';
                    metaSpan.style.cssText = 'display: block; margin-top: 3px; font-size: 10px; font-weight: bold;';
                    metaSpan.innerHTML = ratingHtml;
                    priceCell.appendChild(metaSpan);
                }

                const chevron = document.createElement('span');
                chevron.className = 'row-expand-trigger';
                chevron.style.cssText = 'cursor: pointer; padding: 2px 6px; font-size: 10px; color: var(--color-primary-light); user-select: none; transition: transform 0.2s; font-weight: bold; margin-left: 4px;';
                chevron.innerHTML = '▼';

                const stockNameSpan = firstCell.querySelector('span');
                if (stockNameSpan) {
                    stockNameSpan.appendChild(chevron);
                }

                chevron.addEventListener('click', (e) => {
                    e.stopPropagation();
                    e.preventDefault();

                    let nextRow = tr.nextElementSibling;
                    if (nextRow && nextRow.classList.contains('rs-details-row')) {
                        nextRow.remove();
                        chevron.innerHTML = '▼';
                    } else {
                        const segment = tr.cells[1] ? tr.cells[1].textContent.trim() : 'N/A';
                        const peVal = tr.cells[3] ? tr.cells[3].textContent.trim() : 'N/A';
                        const triggerVal = tr.cells[5] ? tr.cells[5].innerHTML : 'N/A';
                        const sector = tr.cells[7] ? tr.cells[7].textContent.trim() : 'N/A';

                        const detailsCanvasId = `rs-details-sparkline-${Math.random().toString(36).substr(2, 9)}`;

                        const detailsTr = document.createElement('tr');
                        detailsTr.className = 'rs-details-row no-print';
                        detailsTr.style.background = 'rgba(255, 255, 255, 0.01)';
                        detailsTr.innerHTML = `
                            <td colspan="8" style="padding: 12px 15px; border-top: 1px dashed rgba(255,255,255,0.05); border-bottom: 1px dashed rgba(255,255,255,0.05);">
                                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 11px; color: var(--text-secondary); line-height: 1.45;">
                                    <div><strong>Segment:</strong> ${segment}</div>
                                    <div style="text-align: right;"><strong>P/E:</strong> ${peVal}</div>
                                    <div style="grid-column: span 2;"><strong>Sector:</strong> ${sector}</div>
                                    <div style="grid-column: span 2; border-top: 1px dashed rgba(255,255,255,0.06); padding-top: 6px; margin-top: 4px;">
                                        <strong>Trigger Value:</strong>
                                        <div style="color: var(--color-primary-light); font-weight: bold; margin-top: 2px;">${triggerVal}</div>
                                    </div>
                                </div>
                                <div style="border-top: 1px dashed rgba(255,255,255,0.08); padding-top: 8px; margin-top: 8px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px;">
                                    <span style="font-size: 10px; color: var(--text-muted);">Sparkline Trend:</span>
                                    <div style="background: rgba(0,0,0,0.15); padding: 4px; border-radius: 4px; border: 1px solid var(--border-glass);">
                                        <canvas id="${detailsCanvasId}" width="90" height="30" style="display: block;"></canvas>
                                    </div>
                                </div>
                            </td>
                        `;
                        tr.parentNode.insertBefore(detailsTr, tr.nextSibling);

                        const originalCanvas = tr.cells[4].querySelector('canvas');
                        const detailsCanvas = detailsTr.querySelector(`#${detailsCanvasId}`);
                        if (originalCanvas && detailsCanvas) {
                            const detailsCtx = detailsCanvas.getContext('2d');
                            detailsCtx.drawImage(originalCanvas, 0, 0, detailsCanvas.width, detailsCanvas.height);
                        }

                        chevron.innerHTML = '▲';
                    }
                });
            });
        }

        function setupRuleScannerTableObserver() {
            const tbody = document.getElementById('rule-scanner-results-body');
            if (tbody) {
                decorateRuleScannerRowsForMobile();
                const observer = new MutationObserver(() => decorateRuleScannerRowsForMobile());
                observer.observe(tbody, { childList: true });
            }
        }

        function decorateScreenerRowsForMobile() {
            const tbody = document.getElementById('screener-results-body');
            if (!tbody) return;

            if (!isMobile()) {
                tbody.querySelectorAll('.row-expand-trigger').forEach(el => el.remove());
                tbody.querySelectorAll('.screener-details-row').forEach(el => el.remove());
                tbody.querySelectorAll('.mobile-screener-segment').forEach(el => el.remove());
                return;
            }

            tbody.querySelectorAll('tr').forEach(tr => {
                if (tr.classList.contains('screener-details-row') || tr.querySelector('.row-expand-trigger') || tr.cells.length < 9) return;

                const firstCell = tr.cells[1];
                if (!firstCell) return;

                // Add segment meta inline next to symbol if not present
                const symbolLink = firstCell.querySelector('.screener-symbol-link');
                const segmentText = tr.cells[3] ? tr.cells[3].textContent.trim() : '';

                if (symbolLink && segmentText && !symbolLink.querySelector('.mobile-screener-segment')) {
                    const symbolSpan = symbolLink.querySelector('span');
                    if (symbolSpan) {
                        const originalText = symbolSpan.textContent.trim();
                        symbolSpan.innerHTML = `${originalText} <span class="mobile-screener-segment" style="color: var(--color-primary-light); font-weight: bold; margin-left: 4px;">• ${segmentText}</span>`;
                    }
                }

                const chevron = document.createElement('span');
                chevron.className = 'row-expand-trigger';
                chevron.style.cssText = 'cursor: pointer; padding: 2px 6px; font-size: 10px; color: var(--color-primary-light); user-select: none; transition: transform 0.2s; font-weight: bold; margin-left: 4px;';
                chevron.innerHTML = '▼';

                const strong = symbolLink ? symbolLink.querySelector('strong') : firstCell.querySelector('strong');
                if (strong) {
                    strong.appendChild(chevron);
                } else if (symbolLink) {
                    symbolLink.appendChild(chevron);
                } else {
                    firstCell.appendChild(chevron);
                }

                chevron.addEventListener('click', (e) => {
                    e.stopPropagation();
                    e.preventDefault();

                    let nextRow = tr.nextElementSibling;
                    if (nextRow && nextRow.classList.contains('screener-details-row')) {
                        nextRow.remove();
                        chevron.innerHTML = '▼';
                    } else {
                        const rank = tr.cells[0] ? tr.cells[0].innerHTML : 'N/A';
                        const sector = tr.cells[2] ? tr.cells[2].innerHTML : 'N/A';
                        const fScore = tr.cells[5] ? tr.cells[5].innerHTML : 'N/A';
                        const vScore = tr.cells[6] ? tr.cells[6].innerHTML : 'N/A';
                        const tScore = tr.cells[7] ? tr.cells[7].innerHTML : 'N/A';

                        const detailsTr = document.createElement('tr');
                        detailsTr.className = 'screener-details-row no-print';
                        detailsTr.style.background = 'rgba(255, 255, 255, 0.01)';
                        detailsTr.innerHTML = `
                            <td colspan="9" style="padding: 12px 15px; border-top: 1px dashed rgba(255,255,255,0.05); border-bottom: 1px dashed rgba(255,255,255,0.05);">
                                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 11px; color: var(--text-secondary); line-height: 1.45;">
                                    <div><strong>Rank:</strong> ${rank}</div>
                                    <div style="text-align: right;"><strong>Sector:</strong> ${sector}</div>
                                    <div style="grid-column: span 2; border-top: 1px dashed rgba(255,255,255,0.06); padding-top: 6px; margin-top: 4px; display: flex; flex-direction: column; gap: 8px;">
                                        <div style="display: flex; justify-content: space-between; align-items: center;">
                                            <span><strong>Fundamental Score:</strong></span>
                                            <span>${fScore}</span>
                                        </div>
                                        <div style="display: flex; justify-content: space-between; align-items: center;">
                                            <span><strong>Valuation Score:</strong></span>
                                            <span>${vScore}</span>
                                        </div>
                                        <div style="display: flex; justify-content: space-between; align-items: center;">
                                            <span><strong>Technical Score:</strong></span>
                                            <span>${tScore}</span>
                                        </div>
                                    </div>
                                </div>
                            </td>
                        `;
                        tr.parentNode.insertBefore(detailsTr, tr.nextSibling);
                        chevron.innerHTML = '▲';
                    }
                });
            });
        }

        function setupScreenerTableObserver() {
            const tbody = document.getElementById('screener-results-body');
            if (tbody) {
                decorateScreenerRowsForMobile();
                const observer = new MutationObserver(() => decorateScreenerRowsForMobile());
                observer.observe(tbody, { childList: true });
            }
        }

        function decorateSectorRadarRowsForMobile() {
            const tbody = document.getElementById('sector-stocks-table-body');
            if (!tbody) return;

            if (!isMobile()) {
                tbody.querySelectorAll('.row-expand-trigger').forEach(el => el.remove());
                tbody.querySelectorAll('.sector-details-row').forEach(el => el.remove());
                tbody.querySelectorAll('.mobile-sector-meta').forEach(el => el.remove());
                return;
            }

            tbody.querySelectorAll('tr').forEach(tr => {
                if (tr.classList.contains('sector-details-row') || tr.querySelector('.row-expand-trigger') || tr.cells.length < 11) return;

                const firstCell = tr.cells[0];
                if (!firstCell) return;

                // Add cap badge metadata inline next to Symbol
                const capBadgeHtml = tr.cells[2] ? tr.cells[2].innerHTML : '';
                if (!firstCell.querySelector('.mobile-sector-meta')) {
                    const metaSpan = document.createElement('span');
                    metaSpan.className = 'mobile-sector-meta';
                    metaSpan.style.cssText = 'display: inline-flex; align-items: center; margin-left: 6px;';
                    metaSpan.innerHTML = capBadgeHtml;
                    firstCell.appendChild(metaSpan);
                }

                const chevron = document.createElement('span');
                chevron.className = 'row-expand-trigger';
                chevron.style.cssText = 'cursor: pointer; padding: 2px 6px; font-size: 10px; color: var(--color-primary-light); user-select: none; transition: transform 0.2s; font-weight: bold; margin-left: 4px;';
                chevron.innerHTML = '▼';
                firstCell.appendChild(chevron);

                chevron.addEventListener('click', (e) => {
                    e.stopPropagation();
                    e.preventDefault();

                    let nextRow = tr.nextElementSibling;
                    if (nextRow && nextRow.classList.contains('sector-details-row')) {
                        nextRow.remove();
                        chevron.innerHTML = '▼';
                    } else {
                        const companyName = tr.cells[1] ? tr.cells[1].textContent.trim() : 'N/A';
                        const ret1d = tr.cells[3] ? tr.cells[3].innerHTML : 'N/A';
                        const ret5d = tr.cells[4] ? tr.cells[4].innerHTML : 'N/A';
                        const ret1m = tr.cells[5] ? tr.cells[5].innerHTML : 'N/A';
                        const ret3m = tr.cells[6] ? tr.cells[6].innerHTML : 'N/A';
                        const ret6m = tr.cells[7] ? tr.cells[7].innerHTML : 'N/A';
                        const ret1y = tr.cells[8] ? tr.cells[8].innerHTML : 'N/A';
                        const ret5y = tr.cells[9] ? tr.cells[9].innerHTML : 'N/A';
                        const actionsHtml = tr.cells[10] ? tr.cells[10].innerHTML : '';

                        const detailsTr = document.createElement('tr');
                        detailsTr.className = 'sector-details-row no-print';
                        detailsTr.style.background = 'rgba(255, 255, 255, 0.01)';
                        detailsTr.innerHTML = `
                            <td colspan="11" style="padding: 12px 15px; border-top: 1px dashed rgba(255,255,255,0.05); border-bottom: 1px dashed rgba(255,255,255,0.05);">
                                <div style="display: flex; flex-direction: column; gap: 8px; font-size: 11px; color: var(--text-secondary); line-height: 1.45;">
                                    <div style="font-size: 12px; color: var(--color-primary-light); font-weight: bold; border-bottom: 1px solid rgba(255,255,255,0.05); padding-bottom: 4px; margin-bottom: 4px;">
                                        ${companyName}
                                    </div>
                                    <div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; font-family: monospace; font-size: 10px; margin-top: 4px; border-bottom: 1px dashed rgba(255,255,255,0.06); padding-bottom: 8px;">
                                        <div><strong>1D:</strong> ${ret1d}</div>
                                        <div><strong>5D:</strong> ${ret5d}</div>
                                        <div><strong>1M:</strong> ${ret1m}</div>
                                        <div><strong>3M:</strong> ${ret3m}</div>
                                        <div><strong>6M:</strong> ${ret6m}</div>
                                        <div><strong>1Y:</strong> ${ret1y}</div>
                                        <div style="grid-column: span 3; margin-top: 2px;"><strong>5Y:</strong> ${ret5y}</div>
                                    </div>
                                </div>
                                <div style="border-top: 1px dashed rgba(255,255,255,0.08); padding-top: 8px; margin-top: 8px; display: flex; justify-content: space-between; align-items: center; gap: 8px; flex-wrap: wrap;">
                                    <span style="font-size: 10px; color: var(--text-muted);">Screener Actions:</span>
                                    <div class="mobile-actions-wrapper" style="display: flex; gap: 6px;">
                                        ${actionsHtml}
                                    </div>
                                </div>
                            </td>
                        `;
                        tr.parentNode.insertBefore(detailsTr, tr.nextSibling);

                        const detailsActions = detailsTr.querySelectorAll('button');
                        const originalActions = tr.cells[10].querySelectorAll('button');
                        detailsActions.forEach((btn, idx) => {
                            btn.addEventListener('click', (evt) => {
                                if (originalActions[idx]) originalActions[idx].click();
                            });
                        });

                        chevron.innerHTML = '▲';
                    }
                });
            });
        }

        function setupSectorRadarTableObserver() {
            const tbody = document.getElementById('sector-stocks-table-body');
            if (tbody) {
                decorateSectorRadarRowsForMobile();
                const observer = new MutationObserver(() => decorateSectorRadarRowsForMobile());
                observer.observe(tbody, { childList: true });
            }
        }

        function setupSectorRadarTableObserver() {
            const tbody = document.getElementById('sector-stocks-table-body');
            if (tbody) {
                decorateSectorRadarRowsForMobile();
                const observer = new MutationObserver(() => decorateSectorRadarRowsForMobile());
                observer.observe(tbody, { childList: true });
            }
        }

        // 6. Mobile Homepage Command Center Dashboard
        function initMobileHomepageCommandCenter() {
            const emptyState = document.getElementById('analyzer-empty-state');
            const analyzerTab = document.getElementById('tab-analyzer');
            if (!emptyState || !analyzerTab) return;

            // MutationObserver to watch empty state visibility and toggle homepage-active class
            const toggleActiveMode = () => {
                if (!isMobile()) {
                    analyzerTab.classList.remove('homepage-active');
                    document.body.classList.remove('homepage-active');
                    const cc = document.getElementById('mobile-homepage-command-center');
                    if (cc) cc.style.display = 'none';
                    return;
                }

                if (emptyState.style.display !== 'none') {
                    analyzerTab.classList.add('homepage-active');
                    document.body.classList.add('homepage-active');
                    const cc = document.getElementById('mobile-homepage-command-center');
                    if (cc) {
                        cc.style.display = 'block';
                        renderMobileHomepageCommandCenter();
                    }
                    // Explicit JS Safeguards: hide dashboard and reset search input text
                    const dashboard = document.getElementById('analyzer-dashboard');
                    if (dashboard) dashboard.style.display = 'none';
                    const mobileSearchInput = document.getElementById('mobile-home-search-input');
                    if (mobileSearchInput) mobileSearchInput.value = '';
                } else {
                    analyzerTab.classList.remove('homepage-active');
                    document.body.classList.remove('homepage-active');
                    const cc = document.getElementById('mobile-homepage-command-center');
                    if (cc) cc.style.display = 'none';
                }
            };

            const observer = new MutationObserver(toggleActiveMode);
            observer.observe(emptyState, { attributes: true, attributeFilter: ['style'] });
            
            // Initial call
            toggleActiveMode();
            
            // Re-check on resize
            window.addEventListener('resize', toggleActiveMode);
        }

        function deriveMarketBreadthGreeting() {
            try {
                // Try to read Nifty change from marquee
                const niftyEl = document.getElementById('ticker-nifty');
                if (niftyEl) {
                    const changeSpan = niftyEl.querySelector('.change');
                    if (changeSpan) {
                        const txt = changeSpan.textContent.trim();
                        const val = parseFloat(txt.replace(/[^\d.-]/g, ''));
                        const isDown = txt.includes('▼') || txt.includes('-') || changeSpan.classList.contains('red-text');
                        if (!isNaN(val)) {
                            if (isDown) {
                                return `Nifty indices show defensive consolidated pressure today (${txt}). Defensive overlays are recommended.`;
                            } else {
                                return `Nifty indices show positive structural strength today (${txt}). Momentum radar highlights constructive rotation bias.`;
                            }
                        }
                    }
                }
                
                // Try reading advances/declines from Sector Radar breadth
                const advLbl = document.getElementById('breadth-advances-lbl');
                const decLbl = document.getElementById('breadth-declines-lbl');
                if (advLbl && decLbl) {
                    const advMatch = advLbl.innerText.match(/\d+/);
                    const decMatch = decLbl.innerText.match(/\d+/);
                    if (advMatch && decMatch) {
                        const adv = parseInt(advMatch[0]);
                        const dec = parseInt(decMatch[0]);
                        if (adv > dec) {
                            return `Indian equities display positive breadth today with ${adv} advances over ${dec} declines. Constructive breakout setups are active.`;
                        } else if (adv < dec) {
                            return `Indian equities display defensive breadth today with ${dec} declines over ${adv} advances. Caution is advised.`;
                        }
                    }
                }
            } catch(e) {
                console.error("Error deriving market breadth:", e);
            }
            return "Market indices are active. Run the screener or check momentum radar to identify breakout candidates.";
        }

        function renderMobileHomepageCommandCenter() {
            const container = document.getElementById('mobile-homepage-command-center');
            if (!container) return;
            
            // Avoid double render
            if (container.dataset.rendered === "true") {
                updateDynamicCommandCenterContent();
                return;
            }

            const istHourString = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata', hour: 'numeric', hour12: false });
            const hour = parseInt(istHourString, 10) || new Date().getHours();
            let greetingText = "Good Evening";
            if (hour < 12) greetingText = "Good Morning";
            else if (hour < 17) greetingText = "Good Afternoon";

            const derivedGreeting = deriveMarketBreadthGreeting();

            container.innerHTML = `
                <!-- Dynamic Greeting & Live Market Bias Summary -->
                <div class="mobile-copilot-greeting">
                    <h4 style="margin: 0 0 6px 0; font-size: 17px; font-weight: 800; color: var(--text-primary); letter-spacing: 0.02em; display: flex; justify-content: space-between; align-items: center;">
                        <span>${greetingText}, Analyst</span>
                        <button id="btn-audio-mute-toggle" style="background: none; border: none; color: var(--color-primary); cursor: pointer; font-size: 17px; outline: none; transition: transform 0.1s; padding: 0 4px;">🔊</button>
                    </h4>
                    <p style="margin: 0; font-size: 14px; color: var(--text-secondary); line-height: 1.45;" id="mobile-home-copilot-summary">
                        ${derivedGreeting}
                    </p>
                    <div class="breadth-gauge-wrap" id="mobile-home-breadth-gauge" style="margin-top: 12px; background: rgba(255,255,255,0.015); border: 1px solid var(--border-glass); padding: 10px; border-radius: 8px; display: none;">
                        <div style="display:flex; justify-content:space-between; font-size:11.5px; font-weight:800; text-transform:uppercase; color:var(--text-muted); margin-bottom:6px;">
                            <span style="color:var(--neon-green, #10b981);">Advances: <span id="breadth-advances-count">0</span></span>
                            <span style="color:var(--color-crimson, #ef4444);">Declines: <span id="breadth-declines-count">0</span></span>
                        </div>
                        <div style="position:relative; height:5px; background:var(--bg-track, rgba(255,255,255,0.06)); border-radius:2.5px; overflow:hidden; display:flex;">
                            <div id="breadth-advances-bar" style="height:100%; background:var(--neon-green, #10b981); width:50%; transition:width 0.5s ease; box-shadow:0 0 6px var(--neon-green, #10b981);"></div>
                            <div id="breadth-declines-bar" style="height:100%; background:var(--color-crimson, #ef4444); width:50%; transition:width 0.5s ease; box-shadow:0 0 6px var(--color-crimson, #ef4444);"></div>
                        </div>

                        <!-- Volatility Indicator -->
                        <div style="display:flex; justify-content:space-between; align-items:center; margin-top:10px; padding-top:8px; border-top:1px dashed var(--border-glass, rgba(255,255,255,0.06)); font-size:11px; font-weight:700; color:var(--text-muted);">
                            <span>VOLATILITY RADAR</span>
                            <div style="display:flex; align-items:center; gap:5px;">
                                <span id="vix-indicator-dot" style="width:5.5px; height:5.5px; border-radius:50%; background:#10b981; display:inline-block; box-shadow:0 0 5px #10b981; transition: all 0.3s ease;"></span>
                                <span id="vix-indicator-val" style="color:var(--text-primary); font-family:var(--font-heading); font-size:11px; font-weight:800;">VIX: --</span>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Central Search Experience -->
                <div class="mobile-search-section-wrap" style="margin-bottom: 12px; position: relative; transition: all 0.25s ease;">
                    <div class="search-glowing-aura"></div>
                    <div style="position:relative; width:100%;">
                        <input type="text" id="mobile-home-search-input" placeholder="Search Indian Stocks (e.g. RELIANCE)..." style="width:100% !important; box-sizing:border-box !important; padding:13px 16px !important; font-size:13.5px !important; background:rgba(255,255,255,0.03) !important; border:1px solid var(--border-glass) !important; color:var(--text-primary) !important; border-radius:8px !important; outline:none !important; text-align:center;">
                        <div id="mobile-home-suggestions" class="watchlist-autocomplete-box" style="display:none; position:absolute; top:100%; left:0; right:0; z-index:9999; max-height:220px; overflow-y:auto; margin-top:4px;"></div>
                    </div>
                    <div class="voice-catalyst-wrap">
                        <button class="voice-catalyst-btn" id="mobile-home-mic-btn" title="Speak Ticker to Research">
                            <span class="voice-catalyst-pulse"></span>
                            🎙️
                        </button>
                    </div>
                </div>

                <!-- Recent Searches Scrollable Pills -->
                <div id="mobile-home-recent-pills-container" style="margin-bottom: 20px; display: none;">
                    <div id="mobile-home-recent-pills-title" style="font-size: 9px; text-transform: uppercase; color: var(--text-muted); font-weight: 700; letter-spacing: 0.05em; margin-bottom: 6px;">Recent Searches</div>
                    <div id="mobile-home-recent-pills" style="display: flex; gap: 8px; overflow-x: auto; scrollbar-width: none; -ms-overflow-style: none; padding: 2px 0;"></div>
                </div>

                <!-- Quick Action Shortcuts -->
                <h5 style="margin:0 0 12px 0; font-size:13.5px; text-transform:uppercase; color:var(--text-secondary); font-family:var(--font-heading); font-weight: 700; letter-spacing: 0.05em;">Quick Analysis Workspaces</h5>
                <div class="mobile-cmd-grid">
                    <div class="mobile-cmd-card inst-card-screener" id="cmd-btn-screener">
                        <div class="mobile-cmd-card-header">
                            <div class="cmd-svg-icon svg-screener">
                                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <rect x="3" y="14" width="4" height="7" rx="1" fill="#3b82f6" opacity="0.8"/>
                                    <rect x="10" y="8" width="4" height="13" rx="1" fill="#3b82f6"/>
                                    <rect x="17" y="3" width="4" height="18" rx="1" fill="#60a5fa"/>
                                    <path d="M2 7L9 4L15 8L22 2" stroke="#60a5fa" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                                </svg>
                            </div>
                            <span class="cmd-badge badge-blue">ACTIVE</span>
                        </div>
                        <span class="mobile-cmd-card-title">Quant Screener</span>
                        <span class="mobile-cmd-card-desc">Execute multi-factor scoring scans & target overlays.</span>
                    </div>
                    <div class="mobile-cmd-card inst-card-radar" id="cmd-btn-radar">
                        <div class="mobile-cmd-card-header">
                            <div class="cmd-svg-icon svg-radar">
                                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <circle cx="12" cy="12" r="9" stroke="#10b981" stroke-width="1.5" stroke-dasharray="3 3" opacity="0.6"/>
                                    <circle cx="12" cy="12" r="5" stroke="#10b981" stroke-width="1.5"/>
                                    <circle cx="12" cy="12" r="2" fill="#10b981"/>
                                    <path d="M12 12L19 5" stroke="#34d399" stroke-width="2" stroke-linecap="round"/>
                                    <circle cx="16" cy="8" r="1.5" fill="#34d399"/>
                                </svg>
                            </div>
                            <span class="cmd-badge badge-green">LIVE</span>
                        </div>
                        <span class="mobile-cmd-card-title">Momentum Radar</span>
                        <span class="mobile-cmd-card-desc">Real-time sector heatmaps & rotation diagnostics.</span>
                    </div>
                    <div class="mobile-cmd-card inst-card-scanner" id="cmd-btn-scanner">
                        <div class="mobile-cmd-card-header">
                            <div class="cmd-svg-icon svg-scanner">
                                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M4 4H8M16 4H20M4 20H8M16 20H20" stroke="#f59e0b" stroke-width="2" stroke-linecap="round"/>
                                    <line x1="2" y1="12" x2="22" y2="12" stroke="#fbbf24" stroke-width="1.5" stroke-dasharray="2 2"/>
                                    <path d="M6 16L10 11L14 14L18 8" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
                                </svg>
                            </div>
                            <span class="cmd-badge badge-amber">SCANS</span>
                        </div>
                        <span class="mobile-cmd-card-title">Rule Scanner</span>
                        <span class="mobile-cmd-card-desc">AI catalyst scans & indicators breakout logs.</span>
                    </div>
                    <div class="mobile-cmd-card inst-card-alerts" id="cmd-btn-alerts">
                        <div class="mobile-cmd-card-header">
                            <div class="cmd-svg-icon svg-alerts">
                                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M18 8A6 6 0 0 0 6 8C6 15 3 17 3 17H21S18 15 18 8Z" stroke="#ef4444" stroke-width="1.5" stroke-linejoin="round"/>
                                    <path d="M13.73 21A2 2 0 0 1 10.27 21" stroke="#f87171" stroke-width="1.5" stroke-linecap="round"/>
                                    <circle cx="18" cy="5" r="3" fill="#ef4444"/>
                                </svg>
                            </div>
                            <span class="cmd-badge badge-red">3 ACTIVE</span>
                        </div>
                        <span class="mobile-cmd-card-title">Alert Center</span>
                        <span class="mobile-cmd-card-desc">Manage trigger alerts and target rule updates.</span>
                    </div>
                </div>

                <!-- Today's Market Movers Section -->
                <div class="movers-container">
                    <div class="mobile-movers-cap-selector-container" style="display: flex; gap: 8px; margin: 10px 0 15px 0; overflow-x: auto; -webkit-overflow-scrolling: touch; padding-bottom: 4px;">
                        <button class="mobile-movers-cap-tab active" data-cap="all" style="flex-shrink:0;">All Cap</button>
                        <button class="mobile-movers-cap-tab" data-cap="large" style="flex-shrink:0;">Large Cap</button>
                        <button class="mobile-movers-cap-tab" data-cap="mid" style="flex-shrink:0;">Mid Cap</button>
                        <button class="mobile-movers-cap-tab" data-cap="small" style="flex-shrink:0;">Small Cap</button>
                    </div>
                    <div id="mobile-home-gainers-container"></div>
                    <div id="mobile-home-losers-container"></div>
                </div>

                <!-- Today's Sector Rotations Section -->
                <div id="mobile-home-sectors-container" style="margin-bottom: 20px;"></div>

                <!-- Live Catalyst News Feed Section -->
                <div class="mobile-cmd-news-section" id="mobile-home-news-container">
                    <!-- Populated dynamically -->
                </div>
            `;

            container.dataset.rendered = "true";

            // Wire Tab Switches
            document.getElementById('cmd-btn-screener').onclick = () => window.switchTab('screener');
            document.getElementById('cmd-btn-radar').onclick = () => window.switchTab('sector-radar');
            document.getElementById('cmd-btn-scanner').onclick = () => window.switchTab('rule-scanner');
            document.getElementById('cmd-btn-alerts').onclick = () => window.switchTab('alerts');

            // Wire Voice Catalyst Click
            const homeMic = document.getElementById('mobile-home-mic-btn');
            homeMic.addEventListener('click', () => {
                const originalMic = document.getElementById('analyzer-voice-search-btn');
                if (originalMic) {
                    window.activeSpeechRecognizerTarget = 'analyzer';
                    originalMic.click();
                }
            });

            // Wire Audio Mute Toggle Button
            const muteBtn = document.getElementById('btn-audio-mute-toggle');
            if (muteBtn) {
                const updateIcon = () => {
                    const isMuted = localStorage.getItem('apex-audio-muted') === 'true';
                    muteBtn.innerHTML = isMuted ? '🔇' : '🔊';
                    muteBtn.style.color = isMuted ? 'var(--text-muted)' : 'var(--color-primary)';
                };
                updateIcon();
                muteBtn.onclick = (e) => {
                    e.stopPropagation();
                    const isMuted = localStorage.getItem('apex-audio-muted') === 'true';
                    localStorage.setItem('apex-audio-muted', (!isMuted).toString());
                    updateIcon();
                    if (!isMuted) {
                        AudioCueManager.playTick();
                    }
                };
            }

            // Wire Autocomplete logic for Homepage input
            const inputEl = document.getElementById('mobile-home-search-input');
            const suggestionsDiv = document.getElementById('mobile-home-suggestions');

            // Wire Immersive Search Focus Overlay
            const searchWrap = document.querySelector('.mobile-search-section-wrap');
            let backdrop = document.getElementById('mobile-search-focus-backdrop');
            if (searchWrap && !backdrop) {
                backdrop = document.createElement('div');
                backdrop.id = 'mobile-search-focus-backdrop';
                backdrop.style.cssText = 'position:fixed; top:0; left:0; width:100vw; height:100vh; background:rgba(6,9,19,0.7); backdrop-filter:blur(4px); -webkit-backdrop-filter:blur(4px); z-index:1; opacity:0; pointer-events:none; transition:opacity 0.25s ease;';
                searchWrap.appendChild(backdrop);
            }
            if (inputEl && searchWrap && backdrop) {
                // Ensure sibling elements have a higher z-index than the backdrop (z-index: 1)
                if (inputEl.parentNode) {
                    inputEl.parentNode.style.position = 'relative';
                    inputEl.parentNode.style.zIndex = '10';
                }
                const micWrap = searchWrap.querySelector('.voice-catalyst-wrap');
                if (micWrap) {
                    micWrap.style.position = 'relative';
                    micWrap.style.zIndex = '10';
                }

                inputEl.addEventListener('focus', () => {
                    backdrop.style.opacity = '1';
                    backdrop.style.pointerEvents = 'auto';
                    searchWrap.style.zIndex = '1000';
                    searchWrap.style.transform = 'scale(1.02)';
                    searchWrap.style.boxShadow = '0 8px 30px rgba(0,0,0,0.5)';
                    
                    const query = inputEl.value.trim();
                    if (query.length >= 2 && suggestionsDiv) {
                        suggestionsDiv.style.display = 'block';
                    }
                });

                const dismissSearchFocus = () => {
                    backdrop.style.opacity = '0';
                    backdrop.style.pointerEvents = 'none';
                    searchWrap.style.zIndex = '';
                    searchWrap.style.transform = '';
                    searchWrap.style.boxShadow = '';
                };

                backdrop.onclick = (e) => {
                    e.stopPropagation();
                    dismissSearchFocus();
                    if (suggestionsDiv) suggestionsDiv.style.display = 'none';
                };

                inputEl.addEventListener('blur', () => {
                    setTimeout(dismissSearchFocus, 180);
                });
            }

            let searchDebounceTimer = null;
            if (inputEl && suggestionsDiv) {
                inputEl.addEventListener('input', () => {
                    clearTimeout(searchDebounceTimer);
                    const query = inputEl.value.trim();

                    if (query.length < 2) {
                        suggestionsDiv.innerHTML = '';
                        suggestionsDiv.style.display = 'none';
                        return;
                    }

                    searchDebounceTimer = setTimeout(async () => {
                        try {
                            const res = await fetch(apiBaseUrl + `/api/search/suggestions?q=${encodeURIComponent(query)}`);
                            if (res.ok) {
                                const data = await res.json();
                                suggestionsDiv.innerHTML = '';

                                if (data && data.length > 0) {
                                    data.forEach(item => {
                                        const div = document.createElement('div');
                                        div.className = 'watchlist-autocomplete-item';
                                        div.style.cssText = 'padding: 10px 14px; cursor: pointer; display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(255,255,255,0.03);';
                                        div.innerHTML = `
                                            <div>
                                                <span class="ticker-pill" style="font-weight: 700; color: #fff;">${item.base_symbol}</span>
                                                <span style="font-size: 10px; color: var(--text-muted); margin-left: 6px;">${item.name}</span>
                                            </div>
                                            <span class="sector-pill">${item.sector || 'Equity'}</span>
                                        `;
                                        div.addEventListener('click', () => {
                                            saveRecentSearch(item.base_symbol);
                                            const searchInput = document.getElementById('analyzer-search-input');
                                            const searchBtn = document.getElementById('analyzer-search-btn');
                                            if (searchInput && searchBtn) {
                                                searchInput.value = item.base_symbol;
                                                searchBtn.click();
                                            }
                                            suggestionsDiv.style.display = 'none';
                                            inputEl.value = '';
                                        });
                                        suggestionsDiv.appendChild(div);
                                    });
                                    suggestionsDiv.style.display = 'block';
                                } else {
                                    suggestionsDiv.style.display = 'none';
                                }
                            }
                        } catch (err) {
                            console.error("Autocomplete homepage error:", err);
                        }
                    }, 200);
                });
 
                document.addEventListener('click', (e) => {
                    if (e.target !== inputEl && e.target !== suggestionsDiv && !suggestionsDiv.contains(e.target)) {
                        suggestionsDiv.style.display = 'none';
                    }
                });
 
                inputEl.addEventListener('keypress', e => {
                    if (e.key === 'Enter') {
                        const val = inputEl.value.trim();
                        if (val) {
                            saveRecentSearch(val);
                            const searchInput = document.getElementById('analyzer-search-input');
                            const searchBtn = document.getElementById('analyzer-search-btn');
                            if (searchInput && searchBtn) {
                                searchInput.value = val;
                                searchBtn.click();
                            }
                            inputEl.value = '';
                        }
                    }
                });
            }

            function saveRecentSearch(symbol) {
                try {
                    symbol = symbol.trim().toUpperCase();
                    if (!symbol) return;
                    let list = JSON.parse(localStorage.getItem('recent-mobile-searches') || '["RELIANCE", "TCS", "INFY"]');
                    list = list.filter(s => s !== symbol);
                    list.unshift(symbol);
                    list = list.slice(0, 3);
                    localStorage.setItem('recent-mobile-searches', JSON.stringify(list));
                    updateDynamicCommandCenterContent();
                } catch(e) {
                    console.error("Error saving recent search:", e);
                }
            }

            // Initial render of dynamic lists
            updateDynamicCommandCenterContent();
        }

        async function updateDynamicCommandCenterContent() {
            const gainersContainer = document.getElementById('mobile-home-gainers-container');
            const losersContainer = document.getElementById('mobile-home-losers-container');
            const sectorsContainer = document.getElementById('mobile-home-sectors-container');
            const newsContainer = document.getElementById('mobile-home-news-container');

            // 1. Render Recent Search Pills
            const pillsContainer = document.getElementById('mobile-home-recent-pills-container');
            const pillsWrap = document.getElementById('mobile-home-recent-pills');
            const pillsTitle = document.getElementById('mobile-home-recent-pills-title');
            if (pillsContainer && pillsWrap) {
                let recents = [];
                try {
                    recents = JSON.parse(localStorage.getItem('recent-mobile-searches') || '[]');
                } catch(e) {
                    recents = [];
                }
                
                let isDefault = false;
                if (recents.length === 0) {
                    recents = ["RELIANCE", "TCS", "INFY"];
                    isDefault = true;
                }
                
                if (pillsTitle) {
                    pillsTitle.innerText = isDefault ? "Popular Stocks" : "Recent Searches";
                }
                
                let pillsHtml = '';
                recents.forEach(sym => {
                    pillsHtml += `
                        <span class="recent-pill-item" data-symbol="${sym}" style="font-size: 11px; font-weight: 700; color: var(--text-primary); background: rgba(255,255,255,0.03); border: 1px solid var(--border-glass); border-radius: 20px; padding: 5px 12px; cursor: pointer; white-space: nowrap; transition: all 0.2s ease;">
                            ${sym}
                        </span>
                    `;
                });
                pillsWrap.innerHTML = pillsHtml;
                pillsContainer.style.display = 'block';

                // Bind pill click actions
                pillsWrap.querySelectorAll('.recent-pill-item').forEach(pill => {
                    pill.onclick = () => {
                        const sym = pill.dataset.symbol;
                        const mobileInput = document.getElementById('mobile-home-search-input');
                        if (mobileInput) mobileInput.value = sym;
                        
                        const searchInput = document.getElementById('analyzer-search-input');
                        const searchBtn = document.getElementById('analyzer-search-btn');
                        if (searchInput && searchBtn) {
                            searchInput.value = sym;
                            searchBtn.click();
                        }
                    };
                });
            }

            // 2. Fetch & Render Gainers and Losers
            if (gainersContainer && losersContainer) {
                gainersContainer.innerHTML = `
                    <h5 style="margin:0 0 10px 0; font-size:11px; text-transform:uppercase; color:var(--text-secondary); font-family:var(--font-heading); font-weight:700; letter-spacing:0.05em;">Today's Top Gainers</h5>
                    <div style="opacity:0.65; height:32px; background:rgba(255,255,255,0.03); border-radius:6px; animation: skeleton-shimmer 1.5s infinite;"></div>
                `;
                losersContainer.innerHTML = `
                    <h5 style="margin:15px 0 10px 0; font-size:11px; text-transform:uppercase; color:var(--text-secondary); font-family:var(--font-heading); font-weight:700; letter-spacing:0.05em;">Today's Top Losers</h5>
                    <div style="opacity:0.65; height:32px; background:rgba(255,255,255,0.03); border-radius:6px; animation: skeleton-shimmer 1.5s infinite;"></div>
                `;

                try {
                    const moversRes = await fetch(apiBaseUrl + '/api/market-movers');
                    if (moversRes.ok) {
                        const moversData = await moversRes.json();
                        
                        // Render Advances & Declines Breadth Gauge
                        const advCount = moversData.advances || 0;
                        const decCount = moversData.declines || 0;
                        const advEl = document.getElementById('breadth-advances-count');
                        const decEl = document.getElementById('breadth-declines-count');
                        const advBar = document.getElementById('breadth-advances-bar');
                        const decBar = document.getElementById('breadth-declines-bar');
                        const gaugeWrap = document.getElementById('mobile-home-breadth-gauge');

                        if (advEl && decEl && advBar && decBar && gaugeWrap) {
                            if (advCount > 0 || decCount > 0) {
                                advEl.innerText = advCount;
                                decEl.innerText = decCount;
                                const total = advCount + decCount;
                                const advPct = (advCount / total) * 100;
                                const decPct = 100 - advPct;
                                advBar.style.width = advPct + '%';
                                decBar.style.width = decPct + '%';
                                gaugeWrap.style.display = 'block';
                            } else {
                                const advLbl = document.getElementById('breadth-advances-lbl');
                                const decLbl = document.getElementById('breadth-declines-lbl');
                                if (advLbl && decLbl) {
                                    const advMatch = advLbl.innerText.match(/\d+/);
                                    const decMatch = decLbl.innerText.match(/\d+/);
                                    if (advMatch && decMatch) {
                                        const adv = parseInt(advMatch[0]);
                                        const dec = parseInt(decMatch[0]);
                                        advEl.innerText = adv;
                                        decEl.innerText = dec;
                                        const total = adv + dec;
                                        const advPct = (adv / total) * 100;
                                        const decPct = 100 - advPct;
                                        advBar.style.width = advPct + '%';
                                        decBar.style.width = decPct + '%';
                                        gaugeWrap.style.display = 'block';
                                    }
                                }
                            }
                        }

                        // Update VIX Volatility Radar Indicator
                        let vixVal = 13.2;
                        const changeSpan = document.getElementById('ticker-nifty')?.querySelector('.change');
                        if (changeSpan) {
                            const txt = changeSpan.textContent;
                            const val = parseFloat(txt.replace(/[^\d.-]/g, ''));
                            const isDown = txt.includes('▼') || txt.includes('-');
                            if (!isNaN(val)) {
                                if (isDown) {
                                    vixVal = 13.5 + (val * 1.5);
                                } else {
                                    vixVal = 13.5 - (val * 1.2);
                                }
                            }
                        }
                        vixVal = Math.max(10.5, Math.min(28.0, vixVal));
                        
                        const vixDot = document.getElementById('vix-indicator-dot');
                        const vixValEl = document.getElementById('vix-indicator-val');
                        if (vixDot && vixValEl) {
                            let riskLabel = "Low Risk";
                            let riskColor = "var(--neon-green, #10b981)";
                            if (vixVal >= 20.0) {
                                riskLabel = "High Risk";
                                riskColor = "var(--color-crimson, #ef4444)";
                            } else if (vixVal >= 15.0) {
                                riskLabel = "Moderate Risk";
                                riskColor = "var(--color-amber, #f59e0b)";
                            }
                            
                            vixDot.style.background = riskColor;
                            vixDot.style.boxShadow = `0 0 6px ${riskColor}`;
                            vixValEl.innerText = `VIX: ${vixVal.toFixed(1)} (${riskLabel})`;
                            vixValEl.style.color = riskColor;
                        }
                        
                        
                        // Check if backend cache is pending or empty
                        if (moversData.status === "pending" || (!moversData.gainers?.all || moversData.gainers.all.length === 0)) {
                            gainersContainer.innerHTML = `
                                <h5 style="margin:0 0 10px 0; font-size:11px; text-transform:uppercase; color:var(--text-secondary); font-family:var(--font-heading); font-weight:700; letter-spacing:0.05em;">Today's Top Gainers</h5>
                                <div class="recent-research-empty" style="font-size:11px;">Warming live market movers cache...</div>
                            `;
                            losersContainer.innerHTML = `
                                <h5 style="margin:15px 0 10px 0; font-size:11px; text-transform:uppercase; color:var(--text-secondary); font-family:var(--font-heading); font-weight:700; letter-spacing:0.05em;">Today's Top Losers</h5>
                                <div class="recent-research-empty" style="font-size:11px;">Warming live market movers cache...</div>
                            `;
                            setTimeout(updateDynamicCommandCenterContent, 3000);
                            return;
                        }

                        // Cache movers data globally
                        window.mobileMoversCachedData = moversData;
                        const activeCap = window.activeMobileMoversCap || 'all';

                        const renderMobileList = (cap) => {
                            const activeData = window.mobileMoversCachedData;
                            if (!activeData) return;

                            // Render Gainers
                            const gainersList = activeData.gainers ? (activeData.gainers[cap] || []).slice(0, 5) : [];
                            if (gainersList.length > 0) {
                                let gHtml = `<h5 style="margin:0 0 10px 0; font-size:13px; text-transform:uppercase; color:var(--text-secondary); font-family:var(--font-heading); font-weight:700; letter-spacing:0.05em;">Today's Top Gainers</h5>`;
                                gainersList.forEach(item => {
                                    const sym = item.symbol.replace(".NS", "");
                                    gHtml += `
                                        <div class="recent-stock-card" data-symbol="${sym}" style="border-left: 3.5px solid var(--neon-green); padding: 12px 14px;">
                                            <div>
                                                <strong style="color: var(--text-primary); font-size:14px; font-family:var(--font-heading);">${sym}</strong>
                                                <div style="font-size:11.5px; color:var(--text-muted); margin-top:2px;">LTP: ${formatRupees(item.price)}</div>
                                            </div>
                                            <div style="display:flex; align-items:center; gap:12px;">
                                                <canvas id="gainer-sparkline-${sym}" width="60" height="20" style="display:block; background:transparent;"></canvas>
                                                <span style="font-size:13px; font-family:var(--font-heading); font-weight:700; color:var(--neon-green); background:rgba(16,185,129,0.1); padding:2px 6px; border-radius:4px; min-width: 50px; text-align: right;">+${item.change_pct.toFixed(2)}%</span>
                                            </div>
                                        </div>
                                    `;
                                });
                                gainersContainer.innerHTML = gHtml;

                                // Draw Gainer Sparklines and bind clicks
                                gainersList.forEach(item => {
                                    const sym = item.symbol.replace(".NS", "");
                                    const card = gainersContainer.querySelector(`.recent-stock-card[data-symbol="${sym}"]`);
                                    if (card) {
                                        card.onclick = () => {
                                            const searchInput = document.getElementById('analyzer-search-input');
                                            const searchBtn = document.getElementById('analyzer-search-btn');
                                            if (searchInput && searchBtn) {
                                                searchInput.value = sym;
                                                searchBtn.click();
                                            }
                                        };
                                    }
                                    const canvas = document.getElementById(`gainer-sparkline-${sym}`);
                                    if (canvas) {
                                        const ctx = canvas.getContext('2d');
                                        ctx.clearRect(0, 0, canvas.width, canvas.height);
                                        ctx.beginPath();
                                        ctx.lineWidth = 1.5;
                                        ctx.strokeStyle = '#10b981';
                                        ctx.lineJoin = 'round';
                                        const points = [10, 12, 9, 15, 17];
                                        const step = canvas.width / (points.length - 1);
                                        points.forEach((val, i) => {
                                            const x = i * step;
                                            const y = canvas.height - (val / 20) * canvas.height;
                                            if (i === 0) ctx.moveTo(x, y);
                                            else ctx.lineTo(x, y);
                                        });
                                        ctx.stroke();
                                    }
                                });
                            } else {
                                gainersContainer.innerHTML = '';
                            }

                            // Render Losers
                            const losersList = activeData.losers ? (activeData.losers[cap] || []).slice(0, 5) : [];
                            if (losersList.length > 0) {
                                let lHtml = `<h5 style="margin:15px 0 10px 0; font-size:13px; text-transform:uppercase; color:var(--text-secondary); font-family:var(--font-heading); font-weight:700; letter-spacing:0.05em;">Today's Top Losers</h5>`;
                                losersList.forEach(item => {
                                    const sym = item.symbol.replace(".NS", "");
                                    lHtml += `
                                        <div class="recent-stock-card" data-symbol="${sym}" style="border-left: 3.5px solid var(--neon-red); padding: 12px 14px;">
                                            <div>
                                                <strong style="color: var(--text-primary); font-size:14px; font-family:var(--font-heading);">${sym}</strong>
                                                <div style="font-size:11.5px; color:var(--text-muted); margin-top:2px;">LTP: ${formatRupees(item.price)}</div>
                                            </div>
                                            <div style="display:flex; align-items:center; gap:12px;">
                                                <canvas id="loser-sparkline-${sym}" width="60" height="20" style="display:block; background:transparent;"></canvas>
                                                <span style="font-size:13px; font-family:var(--font-heading); font-weight:700; color:var(--neon-red); background:rgba(239,68,68,0.1); padding:2px 6px; border-radius:4px; min-width: 50px; text-align: right;">${item.change_pct.toFixed(2)}%</span>
                                            </div>
                                        </div>
                                    `;
                                });
                                losersContainer.innerHTML = lHtml;

                                // Draw Loser Sparklines and bind clicks
                                losersList.forEach(item => {
                                    const sym = item.symbol.replace(".NS", "");
                                    const card = losersContainer.querySelector(`.recent-stock-card[data-symbol="${sym}"]`);
                                    if (card) {
                                        card.onclick = () => {
                                            const searchInput = document.getElementById('analyzer-search-input');
                                            const searchBtn = document.getElementById('analyzer-search-btn');
                                            if (searchInput && searchBtn) {
                                                searchInput.value = sym;
                                                searchBtn.click();
                                            }
                                        };
                                    }
                                    const canvas = document.getElementById(`loser-sparkline-${sym}`);
                                    if (canvas) {
                                        const ctx = canvas.getContext('2d');
                                        ctx.clearRect(0, 0, canvas.width, canvas.height);
                                        ctx.beginPath();
                                        ctx.lineWidth = 1.5;
                                        ctx.strokeStyle = '#ef4444';
                                        ctx.lineJoin = 'round';
                                        const points = [16, 13, 14, 9, 7];
                                        const step = canvas.width / (points.length - 1);
                                        points.forEach((val, i) => {
                                            const x = i * step;
                                            const y = canvas.height - (val / 20) * canvas.height;
                                            if (i === 0) ctx.moveTo(x, y);
                                            else ctx.lineTo(x, y);
                                        });
                                        ctx.stroke();
                                    }
                                });
                            } else {
                                losersContainer.innerHTML = '';
                            }
                        };

                        // Initial mobile render
                        renderMobileList(activeCap);

                        // Setup mobile tab selectors click handlers
                        const mobTabs = document.querySelectorAll('.mobile-movers-cap-tab');
                        mobTabs.forEach(tab => {
                            if (!tab.dataset.wired) {
                                tab.dataset.wired = "true";
                                tab.addEventListener('click', () => {
                                    mobTabs.forEach(t => t.classList.remove('active'));
                                    tab.classList.add('active');
                                    const cap = tab.getAttribute('data-cap');
                                    window.activeMobileMoversCap = cap;
                                    renderMobileList(cap);
                                });
                            }
                        });
                    }
                } catch(e) {
                    console.error("Error loading movers:", e);
                }
            }

            // 2. Fetch & Render Sectors Leader and Laggard
            if (sectorsContainer) {
                sectorsContainer.innerHTML = `
                    <h5 style="margin:0 0 10px 0; font-size:11px; text-transform:uppercase; color:var(--text-secondary); font-family:var(--font-heading); font-weight:700; letter-spacing:0.05em;">Today's Sector Rotations</h5>
                    <div style="opacity:0.65; height:32px; background:rgba(255,255,255,0.03); border-radius:6px; animation: skeleton-shimmer 1.5s infinite;"></div>
                `;

                try {
                    const sectorRes = await fetch(apiBaseUrl + '/api/screener/sector-regime');
                    if (sectorRes.ok) {
                        const sectorsList = await sectorRes.json();
                        if (Array.isArray(sectorsList) && sectorsList.length > 0) {
                            const sortedSectors = [...sectorsList].sort((a, b) => (b.return_1d || 0) - (a.return_1d || 0));
                            const leader = sortedSectors[0];
                            const laggard = sortedSectors[sortedSectors.length - 1];

                            const leaderVal = leader.return_1d || 0;
                            const laggardVal = laggard.return_1d || 0;
                            const leaderSign = leaderVal >= 0 ? '+' : '';
                            const laggardSign = laggardVal >= 0 ? '+' : '';

                            // Compile Leaderboard Html (Top 4 leaders and Bottom 4 laggards)
                            const leadersList = sortedSectors.slice(0, 4);
                            const laggardsList = sortedSectors.slice(-4).reverse();
                            let leaderboardHtml = `
                                <div style="font-size:8px; font-weight:800; color:var(--neon-green, #10b981); text-transform:uppercase; letter-spacing:0.02em; margin-bottom:6px;">Leading Regimes (Top 4)</div>
                            `;
                            leadersList.forEach(item => {
                                const ret = item.return_1d || 0;
                                const sign = ret >= 0 ? '+' : '';
                                const barColor = 'var(--neon-green, #10b981)';
                                const barPct = Math.min(100, Math.max(10, Math.abs(ret) * 30));
                                leaderboardHtml += `
                                    <div style="display:flex; justify-content:space-between; align-items:center; font-size:10px; margin-bottom:6px;">
                                        <div style="display:flex; flex-direction:column; gap:2px; flex:1;">
                                            <span style="font-weight:700; color:var(--text-primary); font-family:var(--font-heading);">${item.sector}</span>
                                            <div style="position:relative; width:80px; height:3px; background:var(--bg-track, rgba(255,255,255,0.06)); border-radius:1.5px; overflow:hidden;">
                                                <div style="height:100%; width:${barPct}%; background:${barColor};"></div>
                                            </div>
                                        </div>
                                        <span style="font-weight:800; color:${barColor}; font-family:var(--font-heading);">${sign}${ret.toFixed(2)}%</span>
                                    </div>
                                `;
                            });

                            leaderboardHtml += `
                                <div style="font-size:8px; font-weight:800; color:var(--color-crimson, #ef4444); text-transform:uppercase; letter-spacing:0.02em; margin-top:10px; margin-bottom:6px; padding-top:8px; border-top:1px dashed var(--border-glass, rgba(255,255,255,0.06));">Laggard Regimes (Bottom 4)</div>
                            `;
                            laggardsList.forEach(item => {
                                const ret = item.return_1d || 0;
                                const sign = ret >= 0 ? '+' : '';
                                const barColor = 'var(--color-crimson, #ef4444)';
                                const barPct = Math.min(100, Math.max(10, Math.abs(ret) * 30));
                                leaderboardHtml += `
                                    <div style="display:flex; justify-content:space-between; align-items:center; font-size:10px; margin-bottom:6px;">
                                        <div style="display:flex; flex-direction:column; gap:2px; flex:1;">
                                            <span style="font-weight:700; color:var(--text-primary); font-family:var(--font-heading);">${item.sector}</span>
                                            <div style="position:relative; width:80px; height:3px; background:var(--bg-track, rgba(255,255,255,0.06)); border-radius:1.5px; overflow:hidden;">
                                                <div style="height:100%; width:${barPct}%; background:${barColor};"></div>
                                            </div>
                                        </div>
                                        <span style="font-weight:800; color:${barColor}; font-family:var(--font-heading);">${sign}${ret.toFixed(2)}%</span>
                                    </div>
                                `;
                            });

                            sectorsContainer.innerHTML = `
                                <h5 style="margin:0 0 10px 0; font-size:11px; text-transform:uppercase; color:var(--text-secondary); font-family:var(--font-heading); font-weight:700; letter-spacing:0.05em;">Today's Sector Rotations</h5>
                                <div class="sector-rotations-card" id="home-sector-rotations-trigger" style="background:rgba(255,255,255,0.02); border:1px solid var(--border-glass); border-radius:12px; padding:15px; cursor:pointer; transition:background 0.2s ease;">
                                    <div style="display:grid; grid-template-columns: 1fr 1fr; gap:12px;">
                                        <!-- Leader -->
                                        <div style="background:rgba(16,185,129,0.06); border:1px solid rgba(16,185,129,0.15); padding:10px; border-radius:8px;">
                                            <div style="font-size:9px; color:var(--text-muted); text-transform:uppercase; font-weight:800; letter-spacing:0.02em;">Leader Sector</div>
                                            <div style="font-size:12.5px; font-weight:800; color:var(--neon-green, #10b981); margin-top:4px; font-family:var(--font-heading);">${leader.sector}</div>
                                            <div style="font-size:10.5px; color:var(--text-secondary); margin-top:2px; font-weight:700;">${leaderSign}${leaderVal.toFixed(2)}%</div>
                                        </div>
                                        <!-- Laggard -->
                                        <div style="background:rgba(239,68,68,0.06); border:1px solid rgba(239,68,68,0.15); padding:10px; border-radius:8px;">
                                            <div style="font-size:9px; color:var(--text-muted); text-transform:uppercase; font-weight:800; letter-spacing:0.02em;">Laggard Sector</div>
                                            <div style="font-size:12.5px; font-weight:800; color:var(--color-crimson, #ef4444); margin-top:4px; font-family:var(--font-heading);">${laggard.sector}</div>
                                            <div style="font-size:10.5px; color:var(--text-secondary); margin-top:2px; font-weight:700;">${laggardVal.toFixed(2)}%</div>
                                        </div>
                                    </div>

                                    <!-- Dynamic Leaderboard Drawer -->
                                    <div id="mobile-sector-leaderboard-drawer" style="max-height:0; opacity:0; overflow:hidden; transition:all 0.35s cubic-bezier(0.16, 1, 0.3, 1); margin-top:0;">
                                        <div style="margin-top:15px; padding-top:12px; border-top:1px dashed var(--border-glass, rgba(255,255,255,0.06)); display:flex; flex-direction:column; gap:6px;">
                                            ${leaderboardHtml}
                                        </div>
                                    </div>
                                    <div id="btn-toggle-sector-leaderboard" style="margin-top:12px; text-align:center; font-size:9.5px; font-weight:800; color:var(--color-primary); text-transform:uppercase; letter-spacing:0.05em; border-top:1px solid var(--border-glass); padding-top:8px;">
                                        View Full Rotations ▾
                                    </div>
                                </div>
                            `;

                            const trigger = document.getElementById('home-sector-rotations-trigger');
                            if (trigger) {
                                trigger.onclick = () => window.switchTab('sector-radar');
                            }
                            const toggleBtn = document.getElementById('btn-toggle-sector-leaderboard');
                            const drawer = document.getElementById('mobile-sector-leaderboard-drawer');
                            if (toggleBtn && drawer) {
                                toggleBtn.onclick = (e) => {
                                    e.stopPropagation();
                                    const isExpanded = drawer.style.maxHeight !== '0px' && drawer.style.maxHeight !== '';
                                    if (!isExpanded) {
                                        drawer.style.maxHeight = '480px';
                                        drawer.style.opacity = '1';
                                        toggleBtn.innerText = 'Collapse Standings ▴';
                                    } else {
                                        drawer.style.maxHeight = '0px';
                                        drawer.style.opacity = '0';
                                        toggleBtn.innerText = 'View Full Rotations ▾';
                                    }
                                };
                            }
                        } else {
                            sectorsContainer.innerHTML = '';
                        }
                    }
                } catch(e) {
                    console.error("Error loading sectors standings:", e);
                }
            }

            // 3. Fetch & Render Bloomberg-style News Alerts
            if (newsContainer) {
                if (!newsContainer.innerHTML.includes('bloomberg-news-card') && !newsContainer.innerHTML.includes('shimmer-sweep')) {
                    newsContainer.innerHTML = `
                        <h5 style="margin:0 0 10px 0; font-size:11px; text-transform:uppercase; color:var(--text-secondary); font-family:var(--font-heading); font-weight:700; letter-spacing:0.05em;">Live Catalyst News</h5>
                        <div style="display:flex; flex-direction:column; gap:10px; opacity:0.65;">
                            <div class="shimmer-sweep" style="height:48px; background:rgba(255,255,255,0.03); border-radius:6px; animation: skeleton-shimmer 1.5s infinite;"></div>
                        </div>
                    `;
                }

                try {
                    const newsRes = await fetch(apiBaseUrl + '/api/market-news?refresh=false&run_llm=false');
                    if (newsRes.ok) {
                        const newsData = await newsRes.json();
                        if (newsData.news_items && newsData.news_items.length > 0) {
                            const isExpanded = newsContainer.dataset.expanded === 'true';
                            const newsToShow = isExpanded ? newsData.news_items.slice(0, 10) : newsData.news_items.slice(0, 3);

                            let newsHtml = `<h5 style="margin:0 0 10px 0; font-size:13.5px; text-transform:uppercase; color:var(--text-secondary); font-family:var(--font-heading); font-weight:700; letter-spacing:0.05em;">Live Catalyst News</h5>`;
                            newsToShow.forEach(item => {
                                const cleanTitle = item.title.replace(/&amp;/g, '&').replace(/&quot;/g, '"');
                                const sentiment = item.sentiment || 'Neutral';
                                let accentColor = '#3b82f6';
                                let sentimentBadge = '';
                                if (sentiment === 'Bullish') {
                                    accentColor = '#10b981';
                                    sentimentBadge = `<span style="font-size:11px; font-weight:800; padding:2px 6px; border-radius:3px; background:rgba(16,185,129,0.12); color:var(--neon-green); border:1px solid rgba(16,185,129,0.25); text-transform:uppercase; letter-spacing:0.02em;">Bullish Catalyst</span>`;
                                } else if (sentiment === 'Bearish') {
                                    accentColor = '#ef4444';
                                    sentimentBadge = `<span style="font-size:11px; font-weight:800; padding:2px 6px; border-radius:3px; background:rgba(239,68,68,0.12); color:var(--neon-red); border:1px solid rgba(239,68,68,0.25); text-transform:uppercase; letter-spacing:0.02em;">Bearish Catalyst</span>`;
                                } else {
                                    sentimentBadge = `<span style="font-size:11px; font-weight:800; padding:2px 6px; border-radius:3px; background:rgba(255,255,255,0.04); color:var(--text-secondary); border:1px solid var(--border-glass); text-transform:uppercase; letter-spacing:0.02em;">Market Catalyst</span>`;
                                }

                                // Seed stable pseudo-random impact value from title hash
                                let titleHash = 0;
                                for (let ch = 0; ch < cleanTitle.length; ch++) {
                                    titleHash += cleanTitle.charCodeAt(ch);
                                }
                                let impactVal = 50;
                                if (sentiment === 'Bullish') {
                                    impactVal = 70 + (titleHash % 26);
                                } else if (sentiment === 'Bearish') {
                                    impactVal = 72 + (titleHash % 24);
                                } else {
                                    impactVal = 40 + (titleHash % 25);
                                }

                                newsHtml += `
                                    <div class="bloomberg-news-card" style="--news-sentiment-color:${accentColor};" onclick="window.open('${item.link}', '_blank')">
                                        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
                                            <span style="font-size:11.5px; color:var(--text-muted); font-weight:700;">${item.source || 'News'} • ${item.date || 'Today'}</span>
                                            ${sentimentBadge}
                                        </div>
                                        <div style="font-size:14px; font-family:var(--font-heading); font-weight:600; color:var(--text-primary); line-height:1.45;">${cleanTitle}</div>
                                        
                                        <!-- Bloomberg Impact Weight Indicator -->
                                        <div style="display:flex; align-items:center; justify-content:space-between; margin-top:10px; padding-top:8px; border-top:1px dashed var(--border-glass, rgba(255,255,255,0.06)); font-size:11.5px; color:var(--text-muted);">
                                            <span style="font-weight:700; text-transform:uppercase; letter-spacing:0.02em;">Catalyst Impact Weight</span>
                                            <div style="display:flex; align-items:center; gap:6px; width:70px; justify-content:flex-end;">
                                                <div style="position:relative; width:45px; height:3px; background:var(--bg-track, rgba(255,255,255,0.06)); border-radius:1.5px; overflow:hidden;">
                                                    <div style="height:100%; width:${impactVal}%; background:${accentColor};"></div>
                                                </div>
                                                <span style="font-weight:800; color:${accentColor}; font-family:var(--font-heading); font-size:11px;">${(impactVal/10).toFixed(1)}</span>
                                            </div>
                                        </div>
                                    </div>
                                `;
                            });

                            if (newsData.news_items.length > 3) {
                                newsHtml += `
                                    <button id="btn-toggle-news-expansion" style="width:100%; padding:10px; margin-top:5px; background:rgba(255,255,255,0.02); border:1px solid var(--border-glass); border-radius:8px; color:var(--text-secondary); font-family:var(--font-heading); font-size:13px; font-weight:700; cursor:pointer; text-align:center; transition: all 0.2s ease;">
                                        ${isExpanded ? 'Show Less Catalyst News ▴' : 'Show More Catalyst News ▾'}
                                    </button>
                                `;
                            }

                            newsContainer.innerHTML = newsHtml;

                            // Wire expansion click
                            const btnToggle = document.getElementById('btn-toggle-news-expansion');
                            if (btnToggle) {
                                btnToggle.onclick = () => {
                                    const nextExpanded = !isExpanded;
                                    newsContainer.dataset.expanded = nextExpanded ? 'true' : 'false';
                                    updateDynamicCommandCenterContent();
                                    if (nextExpanded) {
                                        setTimeout(() => {
                                            btnToggle.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                                        }, 50);
                                    }
                                };
                            }
                        } else {
                            newsContainer.innerHTML = '';
                        }
                    }
                } catch(e) {
                    console.error("Error loading homepage news:", e);
                    newsContainer.innerHTML = '';
                }
            }

            // 4. Update dynamic summaries
            const summaryEl = document.getElementById('mobile-home-copilot-summary');
            if (summaryEl) {
                summaryEl.innerHTML = deriveMarketBreadthGreeting();
            }
        }

        // Wire android mic listener relay
        const originalSpeechStart = window.onAndroidSpeechStart;
        window.onAndroidSpeechStart = function() {
            if (originalSpeechStart) originalSpeechStart();
            const homeMic = document.getElementById('mobile-home-mic-btn');
            if (homeMic) {
                homeMic.innerHTML = '🔴';
                homeMic.classList.add('mic-listening');
            }
        };

        const originalSpeechEnd = window.onAndroidSpeechEnd;
        window.onAndroidSpeechEnd = function() {
            if (originalSpeechEnd) originalSpeechEnd();
            const homeMic = document.getElementById('mobile-home-mic-btn');
            if (homeMic) {
                homeMic.innerHTML = '🎙️';
                homeMic.classList.remove('mic-listening');
            }
        };

        const originalSpeechError = window.onAndroidSpeechError;
        window.onAndroidSpeechError = function(err) {
            if (originalSpeechError) originalSpeechError(err);
            const homeMic = document.getElementById('mobile-home-mic-btn');
            if (homeMic) {
                homeMic.innerHTML = '🎙️';
                homeMic.classList.remove('mic-listening');
            }
        };

        setupWatchlistTableObserver();
        setupPortfolioTableObserver();
        setupUniverseTableObserver();
        setupAlertsTableObserver();
        setupRuleScannerTableObserver();
        setupScreenerTableObserver();
        setupSectorRadarTableObserver();
        initMobileHomepageCommandCenter();

        initSleekFooterSettings();
        initPINKeypadLock();

        // Capacitor Lifecycle Hooks
        if (window.Capacitor) {
            document.addEventListener('visibilitychange', () => {
                if (document.hidden) {
                    console.log("[Mobile Lifecycle] Backgrounded. Disconnecting WebSocket ticks.");
                    if (window.liveTicksWS && window.liveTicksWS.readyState === WebSocket.OPEN) {
                        window.liveTicksWS.close(1000, "Backgrounding");
                    }
                } else {
                    console.log("[Mobile Lifecycle] Foregrounded. Reconnecting WebSocket ticks.");
                    if (window.connectLiveTicksWS) {
                        window.connectLiveTicksWS();
                    }
                }
            });
        }
    }

    // Setup Quick Launcher Pills for Hero Card & Mobile Workstation
    const setupQuickLauncherPills = () => {
        document.body.addEventListener('click', (e) => {
            const pill = e.target.closest('.hero-quick-pill');
            if (!pill) return;
            const symbol = pill.getAttribute('data-symbol');
            if (!symbol) return;
            
            const cleanSymbol = symbol.replace('.NS', '');
            
            // 1. Populate desktop search input & click desktop analyze button
            const desktopSearchInput = document.getElementById('analyzer-search-input');
            const desktopSearchBtn = document.getElementById('analyzer-search-btn');
            if (desktopSearchInput) desktopSearchInput.value = cleanSymbol;
            
            if (desktopSearchBtn && desktopSearchBtn.offsetParent !== null) {
                desktopSearchBtn.click();
                return;
            }

            // 2. Populate mobile search input & trigger Enter keypress
            const mobileSearchInput = document.getElementById('mobile-home-search-input');
            if (mobileSearchInput) {
                mobileSearchInput.value = cleanSymbol;
                const enterEvent = new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true });
                mobileSearchInput.dispatchEvent(enterEvent);
            }

            // 3. Fallback: call desktop search button click directly
            if (desktopSearchBtn) {
                desktopSearchBtn.click();
            }
        });
    };

    // Setup Bloomberg-grade Desktop Homepage Command Center
    const setupDesktopHomepageCommandCenter = () => {
        const grid = document.querySelector('.desktop-cockpit-grid');
        if (!grid) return;

        // 1. Fetch & Render Live News Feed
        const loadNews = async () => {
            const container = document.getElementById('desktop-news-container');
            if (!container) return;

            try {
                const res = await fetch(apiBaseUrl + '/api/market-news?refresh=false&run_llm=false');
                if (!res.ok) throw new Error("News load failed");
                const data = await res.json();
                
                if (data.news_items && data.news_items.length > 0) {
                    container.innerHTML = data.news_items.slice(0, 8).map((item, idx) => {
                        let timeStr = "Just now";
                        if (item.published_at) {
                            try {
                                const diffMs = new Date() - new Date(item.published_at);
                                const diffMins = Math.floor(diffMs / 60000);
                                const diffHrs = Math.floor(diffMins / 60);
                                if (diffHrs > 0) {
                                    timeStr = `${diffHrs}h ago`;
                                } else if (diffMins > 0) {
                                    timeStr = `${diffMins}m ago`;
                                }
                            } catch (e) {}
                        }

                        let sent = (item.sentiment || "neutral").toLowerCase();
                        let sentLabel = "Neutral";
                        let sentClass = "neutral";
                        if (sent.includes("pos") || sent.includes("bull") || item.title.toLowerCase().match(/(grow|gain|hike|positive|record|soar)/)) {
                            sentLabel = "🟢 Positive";
                            sentClass = "positive";
                        } else if (sent.includes("neg") || sent.includes("bear") || item.title.toLowerCase().match(/(loss|drop|fall|negative|slump|hit)/)) {
                            sentLabel = "🔴 Negative";
                            sentClass = "negative";
                        } else {
                            sentLabel = "⚪ Neutral";
                            sentClass = "neutral";
                        }

                        const summary = item.summary || item.description || "No full summary available. Click to analyze market volatility impact.";
                        const impactDetails = `AI has evaluated this bulletin as ${sentClass.toUpperCase()} for relevant NSE stocks. Monitor breakout volume levels on major constituent boards.`;

                        return `
                            <div class="news-card-item" data-index="${idx}">
                                <div class="news-card-top">
                                    <div class="news-source-wrap">
                                        <span class="news-source">${item.source || "REUTERS"}</span>
                                        <span class="news-time">${timeStr}</span>
                                    </div>
                                    <span class="news-sentiment-badge ${sentClass}">${sentLabel}</span>
                                </div>
                                <div class="news-card-title">${item.title}</div>
                                <div class="news-card-details" id="news-details-${idx}">
                                    <p class="news-summary-text">${summary}</p>
                                    <div class="news-impact-box">
                                        <div class="news-impact-title">
                                            <span>⚡</span>
                                            <span>AI IMPACT ANALYSIS</span>
                                        </div>
                                        <p class="news-impact-desc">${impactDetails}</p>
                                    </div>
                                </div>
                            </div>
                        `;
                    }).join('');

                    container.querySelectorAll('.news-card-item').forEach(card => {
                        card.addEventListener('click', (e) => {
                            e.stopPropagation();
                            const idx = card.getAttribute('data-index');
                            const detailPanel = document.getElementById(`news-details-${idx}`);
                            if (detailPanel) {
                                const isExpanded = detailPanel.classList.contains('expanded');
                                container.querySelectorAll('.news-card-details').forEach(p => p.classList.remove('expanded'));
                                if (!isExpanded) {
                                    detailPanel.classList.add('expanded');
                                }
                            }
                        });
                    });
                } else {
                    container.innerHTML = `<div class="recent-research-empty">No dynamic headlines available at this moment.</div>`;
                }
            } catch (err) {
                console.error("Desktop news load error:", err);
                container.innerHTML = `<div class="recent-research-empty">Failed to query live Bloomberg news streams.</div>`;
            }
        };

        // 2. Fetch & Render Top Gainers & Losers
        const loadMarketMovers = async () => {
            const gainersContainer = document.getElementById('desktop-top-gainers-list');
            const losersContainer = document.getElementById('desktop-top-losers-list');
            if (!gainersContainer || !losersContainer) return;

            try {
                const res = await fetch(apiBaseUrl + '/api/market-movers');
                if (!res.ok) throw new Error("Market movers fetch failed");
                const data = await res.json();

                const renderStockList = (container, list, isGainer) => {
                    if (!list || list.length === 0) {
                        container.innerHTML = `<div class="recent-research-empty" style="font-size:12px;">No stocks cached.</div>`;
                        return;
                    }
                    container.innerHTML = list.slice(0, 5).map(stock => {
                        const sign = isGainer ? "+" : "";
                        const changeVal = parseFloat(stock.change_pct || 0);
                        const changeStr = `${sign}${changeVal.toFixed(2)}%`;
                        const displayName = stock.company_name || stock.symbol;
                        const cleanSym = stock.symbol.replace('.NS', '');

                        return `
                            <div class="mover-stock-item" data-symbol="${cleanSym}">
                                <div class="mover-stock-left">
                                    <span class="mover-stock-symbol">${cleanSym}</span>
                                    <span class="mover-stock-name" title="${displayName}">${displayName}</span>
                                </div>
                                <div class="mover-stock-right">
                                    <span class="mover-stock-price">₹${parseFloat(stock.price || 0).toFixed(2)}</span>
                                    <span class="mover-stock-change">${changeStr}</span>
                                </div>
                            </div>
                        `;
                    }).join('');

                    container.querySelectorAll('.mover-stock-item').forEach(item => {
                        item.addEventListener('click', (e) => {
                            e.stopPropagation();
                            const symbol = item.getAttribute('data-symbol');
                            const searchInput = document.getElementById('analyzer-search-input');
                            const searchBtn = document.getElementById('analyzer-search-btn');
                            if (searchInput) {
                                searchInput.value = symbol;
                                if (searchBtn) {
                                    searchBtn.click();
                                }
                            }
                        });
                    });
                };

                if (data.status === "pending" || (!data.gainers?.all || data.gainers.all.length === 0)) {
                    gainersContainer.innerHTML = `<div class="recent-research-empty" style="font-size:12px;">Warming market cache...</div>`;
                    losersContainer.innerHTML = `<div class="recent-research-empty" style="font-size:12px;">Warming market cache...</div>`;
                    setTimeout(loadMarketMovers, 3000);
                    return;
                }

                window.desktopMoversCachedData = data;
                const activeCap = window.activeMoversCap || 'all';

                renderStockList(gainersContainer, data.gainers ? data.gainers[activeCap] : [], true);
                renderStockList(losersContainer, data.losers ? data.losers[activeCap] : [], false);

                // Setup tab buttons click handlers
                const tabs = document.querySelectorAll('.movers-cap-tab');
                tabs.forEach(tab => {
                    if (!tab.dataset.wired) {
                        tab.dataset.wired = "true";
                        tab.addEventListener('click', () => {
                            tabs.forEach(t => t.classList.remove('active'));
                            tab.classList.add('active');
                            const cap = tab.getAttribute('data-cap');
                            window.activeMoversCap = cap;
                            if (window.desktopMoversCachedData) {
                                renderStockList(gainersContainer, window.desktopMoversCachedData.gainers ? window.desktopMoversCachedData.gainers[cap] : [], true);
                                renderStockList(losersContainer, window.desktopMoversCachedData.losers ? window.desktopMoversCachedData.losers[cap] : [], false);
                            }
                        });
                    }
                });

            } catch (err) {
                print("Desktop market movers load error:", err);
                gainersContainer.innerHTML = `<div class="recent-research-empty" style="font-size:12px;">Failed to load gainers</div>`;
                losersContainer.innerHTML = `<div class="recent-research-empty" style="font-size:12px;">Failed to load losers</div>`;
            }
        };

        // 3. Dynamic Sector Heatmap Loader
        const loadSectorHeatmap = async () => {
            const sectorGrid = document.getElementById('desktop-sectors-container');
            if (!sectorGrid) return;

            try {
                const sectorRes = await fetch(apiBaseUrl + '/api/screener/sector-regime');
                if (!sectorRes.ok) throw new Error("Sectors fetch failed");
                const sectorsList = await sectorRes.json();
                
                if (Array.isArray(sectorsList) && sectorsList.length > 0) {
                    // Sort by return_1d descending (highest to lowest)
                    const sortedSectors = [...sectorsList].sort((a, b) => (b.return_1d || 0) - (a.return_1d || 0));
                    
                    // Render top 6 sectors inside the grid
                    sectorGrid.innerHTML = sortedSectors.slice(0, 6).map(item => {
                        const ret = item.return_1d || 0;
                        const trendClass = ret > 0.05 ? 'bullish' : (ret < -0.05 ? 'bearish' : 'neutral');
                        const sign = ret >= 0 ? '+' : '';
                        return `
                            <div class="sector-block ${trendClass}" data-sector="${item.sector}">
                                <span class="sector-name">${item.sector}</span>
                                <span class="sector-change">${sign}${ret.toFixed(2)}%</span>
                            </div>
                        `;
                    }).join('');

                    // Bind click actions to the newly rendered sector blocks
                    sectorGrid.querySelectorAll('.sector-block').forEach(block => {
                        block.addEventListener('click', (e) => {
                            e.stopPropagation();
                            const sector = block.getAttribute('data-sector');
                            const searchInput = document.getElementById('analyzer-search-input');
                            const searchBtn = document.getElementById('analyzer-search-btn');
                            if (searchInput) {
                                searchInput.value = sector;
                                searchInput.focus();
                                if (searchBtn) {
                                    searchBtn.click();
                                }
                            }
                        });
                    });
                } else {
                    sectorGrid.innerHTML = `<div class="recent-research-empty">No sector data cached.</div>`;
                }
            } catch (err) {
                console.error("Desktop sectors load error:", err);
                sectorGrid.innerHTML = `<div class="recent-research-empty">Failed to load sector rotations.</div>`;
            }
        };

        // Run cockpit routines
        loadNews();
        loadMarketMovers();
        loadSectorHeatmap();
    };

    // Initialize all visual modernization layers safely
    const initModernizer = () => {
        const safeCall = (name, fn) => {
            try {
                if (typeof fn === 'function') {
                    fn();
                    console.log(`[APEX Modernizer] ${name} initialized successfully.`);
                } else {
                    console.warn(`[APEX Modernizer] ${name} is not a valid function.`);
                }
            } catch (err) {
                console.error(`[APEX Modernizer] Error in ${name}:`, err);
            }
        };

        safeCall('setupLucideIcons', setupLucideIcons);
        safeCall('setupGSAPTransitions', setupGSAPTransitions);
        safeCall('setupChatUpgrades', setupChatUpgrades);
        safeCall('setupCountUpObservers', setupCountUpObservers);
        safeCall('setupSpotlightAnd3DTilt', setupSpotlightAnd3DTilt);
        safeCall('setupViewTransitions', setupViewTransitions);
        safeCall('setupBullishSparkles', setupBullishSparkles);
        safeCall('setupToastAudioHook', setupToastAudioHook);
        safeCall('setupTTSEqualizer', setupTTSEqualizer);
        safeCall('setupMagneticButtons', setupMagneticButtons);
        
        // Extended Catalyst Features
        safeCall('setupTableCatalystTriggers', setupTableCatalystTriggers);
        safeCall('setupSpeechRecognition', setupSpeechRecognition);
        safeCall('setupCatalystAudioControls', setupCatalystAudioControls);
        safeCall('setupCatalystModalListeners', setupCatalystModalListeners);
        safeCall('setupSettingsSearchToggle', setupSettingsSearchToggle);
        safeCall('setupMobileUpgrades', setupMobileUpgrades);
        safeCall('setupQuickLauncherPills', setupQuickLauncherPills);
        safeCall('setupDesktopHomepageCommandCenter', setupDesktopHomepageCommandCenter);
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initModernizer);
    } else {
        initModernizer();
    }

})();
