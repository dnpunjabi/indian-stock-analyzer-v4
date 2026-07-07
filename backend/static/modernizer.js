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
        const originalSwitchTab = window.switchTab;
        if (originalSwitchTab && typeof gsap !== 'undefined') {
            window.switchTab = function(tabKey) {
                const activeTabEl = document.querySelector('.active-tab-content');
                
                AudioCueManager.playTick(); // Play mechanically responsive tab click tick

                if (activeTabEl) {
                    gsap.to(activeTabEl, {
                        opacity: 0,
                        y: -8,
                        duration: 0.12,
                        ease: "power2.in",
                        onComplete: () => {
                            originalSwitchTab(tabKey);
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
                    originalSwitchTab(tabKey);
                }
            };
            console.log("APEX Modernizer: GSAP tab transitions configured.");
        }
    }

    // ==================== 4. CHAT TYPEWRITER & BOUNCING SKELETON ====================
    function setupChatUpgrades() {
        const originalAppendChatMessage = window.appendChatMessage;
        if (originalAppendChatMessage && typeof Typed !== 'undefined') {
            window.appendChatMessage = function(role, content) {
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
                const msgId = originalAppendChatMessage(role, content);

                // Run typewriter reveal on final assistant answer
                if (role === 'assistant') {
                    AudioCueManager.playChime(); // Play success synth chime
                    const msgEl = document.getElementById(msgId);
                    if (msgEl) {
                        const pEl = msgEl.querySelector('p');
                        if (pEl) {
                            const originalHTML = pEl.innerHTML;
                            pEl.innerHTML = ''; // Clear for streaming Typed.js execution

                            const typeContainer = document.createElement('span');
                            pEl.appendChild(typeContainer);

                            new Typed(typeContainer, {
                                strings: [originalHTML],
                                typeSpeed: 3, // slightly faster typing
                                showCursor: false,
                                contentType: 'html',
                                onComplete: () => {
                                    const box = document.getElementById('chat-messages');
                                    if (box) {
                                        box.scrollTop = box.scrollHeight;
                                    }
                                }
                            });
                        }
                    }
                }
                return msgId;
            };
            console.log("APEX Modernizer: Chat typewriter and bouncing dots configured.");
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

        // Observe main header active stock price
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
                const cardWidth = rect.width;
                const cardHeight = rect.height;
                
                // Track spotlight coordinates
                const x = e.clientX - rect.left;
                const y = e.clientY - rect.top;
                card.style.setProperty('--mouse-x', `${x}px`);
                card.style.setProperty('--mouse-y', `${y}px`);

                // 3D Parallax card tilting (desktops only)
                if (window.innerWidth > 768) {
                    const centerX = x - (cardWidth / 2);
                    const centerY = y - (cardHeight / 2);
                    const maxTilt = 2.0; 
                    
                    const tiltX = -(centerY / (cardHeight / 2)) * maxTilt;
                    const tiltY = (centerX / (cardWidth / 2)) * maxTilt;
                    
                    card.style.transform = `perspective(1000px) rotateX(${tiltX.toFixed(2)}deg) rotateY(${tiltY.toFixed(2)}deg) translateY(-2px)`;
                }
            }
        });

        document.addEventListener('mouseout', (e) => {
            const card = e.target.closest('.card');
            if (card && !card.contains(e.relatedTarget)) {
                card.style.transform = 'perspective(1000px) rotateX(0deg) rotateY(0deg) translateY(0px)';
            }
        });

        console.log("APEX Modernizer: Spotlight and 3D card tilt active.");
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

    // Initialize all visual modernization layers on load
    document.addEventListener('DOMContentLoaded', () => {
        setupLucideIcons();
        setupGSAPTransitions();
        setupChatUpgrades();
        setupCountUpObservers();
        setupSpotlightAnd3DTilt();
        setupViewTransitions();
        setupBullishSparkles();
        setupToastAudioHook();
        setupTTSEqualizer();
        setupMagneticButtons();
        console.log("APEX Modernizer: All modernization hooks active.");
    });

})();
