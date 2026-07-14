/* 
   APEX Stock Workstation - Modernization JavaScript Layer
   Integrates GSAP, CountUp, Typed.js, Lucide, Web Audio Cues, Sparkles, and Magnetism
*/

(function() {
    console.log("APEX Modernizer: Initializing core visual upgrades...");

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
        
        const url = `/api/stock-catalysts?symbol=${encodeURIComponent(currentCatalystSymbol)}&sector=${encodeURIComponent(currentCatalystSector)}&is_sector=${currentCatalystIsSector}&ai_engine=${aiEngine}&timeframe=${searchHorizon}&use_tavily_search=${useTavily}&use_serpapi=${useSerpApi}&use_brave=${useBrave}&direction=${currentCatalystDirection}`;

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
                                <strong style="font-size: 12px; color: var(--text-primary); font-family: 'Outfit'; flex: 1; min-width: 150px; text-align: left;">${d.title}</strong>
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
                fetch('/api/llm-config')
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
                fetch('/api/llm-config')
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
                fetch('/api/llm-config')
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
            } else {
                removeMobileBottomNav();
            }
        });

        // Note: switchTab interception and nav highlights are fully handled by the global routing interceptor property defined at the top of the file.

        // 2. Swipe Gestures for Tab Navigation
        let touchstartX = 0;
        let touchendX = 0;
        let touchstartY = 0;
        let touchendY = 0;
        const swipeMinDistance = 75;
        const swipeMaxCrossDistance = 45;

        function handleSwipeGesture(e) {
            if (e.target.closest('#tv-chart-workstation, input, textarea, select, button, .pin-key, .rs-bottom-sheet, tr, .swipeable-row-container, .swipeable-row-content, .swipe-actions, .tearsheet-range-slider, .tearsheet-range-marker, .watchlist-scroll-wrapper, .data-table-wrapper')) {
                return;
            }
            const isSwipeLeft = touchendX < touchstartX - swipeMinDistance && Math.abs(touchendY - touchstartY) < swipeMaxCrossDistance;
            const isSwipeRight = touchendX > touchstartX + swipeMinDistance && Math.abs(touchendY - touchstartY) < swipeMaxCrossDistance;

            if (isSwipeLeft || isSwipeRight) {
                const currentHash = location.hash.substring(1) || 'analyzer';
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
                        <h3 style="margin:0;font-family:'Outfit';font-size:16px;font-weight:800;color:var(--text-primary);">${ticker}</h3>
                        <span style="font-size:10px;color:var(--text-secondary);">${name}</span>
                    </div>
                    <div class="tearsheet-price-area" style="text-align:right;">
                        <span style="font-size:18px;font-family:'Outfit';font-weight:800;color:var(--text-primary);">${formatRupees(price)}</span>
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
                    </div>
                    <div>
                        <h5 style="margin:0 0 8px 0; font-size:11px; text-transform:uppercase; color:var(--text-secondary); font-family:Outfit;">Recent Searches</h5>
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

            setTimeout(() => {
                const input = document.getElementById('mobile-quick-search-input');
                if (input) input.focus();
            }, 300);

            utilityContainer.querySelectorAll('.quick-search-pill-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    executeQuickSearch(btn.getAttribute('data-symbol'), sheet);
                });
            });

            const inputEl = document.getElementById('mobile-quick-search-input');
            inputEl.addEventListener('keypress', e => {
                if (e.key === 'Enter') {
                    executeQuickSearch(inputEl.value.trim(), sheet);
                }
            });

            document.getElementById('mobile-quick-search-submit-btn').addEventListener('click', () => {
                executeQuickSearch(inputEl.value.trim(), sheet);
            });
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
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initModernizer);
    } else {
        initModernizer();
    }

})();
