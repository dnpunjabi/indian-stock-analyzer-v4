/**
 * APEX AI - Unified Export & Clipboard Manager
 * Enterprise-grade utility for exporting chatbot transcripts and report summaries.
 */
(function() {
    const AIExportManager = {
        /**
         * Dynamic action bar generator for target elements.
         * @param {HTMLElement|string} target - The DOM element or ID to decorate.
         * @param {string} type - 'report' or 'chat'
         * @param {object} metadata - Optional context data { module: 'VSA', ticker: 'TCS' }
         */
        decorate: function(target, type = 'report', metadata = {}) {
            const el = typeof target === 'string' ? document.getElementById(target) : target;
            if (!el) return;

            // Avoid double decoration
            if (el.querySelector('.ai-export-action-bar')) {
                return;
            }

            // Ensure the container is positioned relatively to anchor the floating bar
            const computedStyle = window.getComputedStyle(el);
            if (computedStyle.position === 'static') {
                el.style.position = 'relative';
            }

            const bar = document.createElement('div');
            bar.className = `ai-export-action-bar no-print ${type === 'chat' ? 'chat-header-bar' : 'report-floating-bar'}`;
            
            // Build action buttons
            bar.innerHTML = `
                <button class="ai-export-btn btn-copy" title="Copy to Clipboard" type="button">
                    <span class="btn-icon">📋</span><span class="btn-lbl">Copy</span>
                </button>
                <button class="ai-export-btn btn-md" title="Download as Markdown" type="button">
                    <span class="btn-icon">📥</span><span class="btn-lbl">Markdown</span>
                </button>
                <button class="ai-export-btn btn-pdf" title="Save as PDF" type="button">
                    <span class="btn-icon">🖨️</span><span class="btn-lbl">PDF</span>
                </button>
            `;

            // Append action bar
            if (type === 'chat') {
                // For chat logs, prepend to the container or place at the top
                el.insertBefore(bar, el.firstChild);
            } else {
                // For cards/report blocks, float it in the top-right corner
                el.appendChild(bar);
            }

            // Hook event listeners
            bar.querySelector('.btn-copy').addEventListener('click', (e) => {
                e.stopPropagation();
                this.copyContent(el, type);
            });
            bar.querySelector('.btn-md').addEventListener('click', (e) => {
                e.stopPropagation();
                this.exportMarkdown(el, type, metadata);
            });
            bar.querySelector('.btn-pdf').addEventListener('click', (e) => {
                e.stopPropagation();
                this.printContent(el, type, metadata);
            });
        },

        /**
         * Extracts clean plain text and writes to clipboard.
         */
        copyContent: function(el, type) {
            const rawContent = this.extractCleanText(el);
            
            if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
                navigator.clipboard.writeText(rawContent)
                    .then(() => this.showToast("📋 Copied to clipboard successfully!"))
                    .catch(() => this.copyFallback(rawContent));
            } else {
                this.copyFallback(rawContent);
            }
        },

        /**
         * Fallback clipboard copy using off-screen textarea.
         */
        copyFallback: function(text) {
            try {
                const textarea = document.createElement('textarea');
                textarea.value = text;
                textarea.style.position = 'fixed';
                textarea.style.left = '-9999px';
                textarea.style.top = '-9999px';
                document.body.appendChild(textarea);
                textarea.focus();
                textarea.select();
                const success = document.execCommand('copy');
                document.body.removeChild(textarea);
                
                if (success) {
                    this.showToast("📋 Copied to clipboard (fallback)!");
                } else {
                    this.showToast("❌ Clipboard copy failed.", "danger");
                }
            } catch (err) {
                console.error("Copy fallback exception: ", err);
                this.showToast("❌ Unable to copy.", "danger");
            }
        },

        /**
         * High-fidelity HTML to Markdown parser.
         */
        exportMarkdown: function(el, type, metadata) {
            try {
                const markdown = this.convertToMarkdown(el, type);
                if (!markdown) {
                    this.showToast("⚠️ Export content is empty.", "warning");
                    return;
                }
                const filename = this.getExportFilename(metadata, type, false);

                // Step 1: Prepare download payload on backend to cache metadata and contents securely
                fetch('/api/export/prepare', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        filename: filename,
                        content: markdown
                    })
                })
                .then(res => {
                    if (!res.ok) throw new Error("Failed to prepare file export on server.");
                    return res.json();
                })
                .then(data => {
                    const downloadId = data.download_id;
                    if (!downloadId) throw new Error("No download ID received from server.");
                    
                    // Step 2: Trigger standard browser GET download.
                    // Serving via standard GET Content-Disposition attachment is fully trusted by all local proxies and enterprise security layers, preserving the exact custom filename.
                    window.location.href = `/api/export/download?id=${downloadId}`;
                    this.showToast(`📥 Exported: ${filename}`);
                })
                .catch(err => {
                    console.error("Export preparation failed: ", err);
                    this.showToast("❌ Markdown export failed.", "danger");
                });
            } catch (err) {
                console.error("Export Markdown failed: ", err);
                this.showToast("❌ Markdown export failed.", "danger");
            }
        },

        /**
         * Opens temporary styled print window and triggers window.print()
         */
        printContent: function(el, type, metadata) {
            try {
                const contentHtml = this.extractCleanHtml(el);
                const printWindow = window.open('', '_blank', 'width=850,height=700');
                if (!printWindow) {
                    this.showToast("❌ Pop-up blocker intercepted PDF print. Please allow popups.", "warning");
                    return;
                }

                const docTitle = this.getExportFilename(metadata, type, true);
                const moduleName = (metadata.module || 'AI Synthesis Report').toUpperCase().replace(/_/g, ' ');
                let tickerName = 'Global Portfolio';
                if (metadata.ticker) {
                    tickerName = metadata.ticker.replace('.NS', '').replace('.BO', '').toUpperCase();
                } else if (window.activeStockProfile && window.activeStockProfile.ticker) {
                    tickerName = window.activeStockProfile.ticker.replace('.NS', '').replace('.BO', '').toUpperCase();
                }

                const timestamp = new Date().toLocaleString();

                // Populate clean Light Mode PDF printable layout document
                printWindow.document.write(`
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <title>${docTitle}</title>
                    <meta charset="UTF-8">
                    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Outfit:wght@500;700;800&display=swap" rel="stylesheet">
                    <style>
                        body {
                            font-family: 'Inter', sans-serif;
                            color: #1e293b;
                            background-color: #ffffff;
                            margin: 40px;
                            line-height: 1.6;
                            font-size: 14px;
                        }
                        header {
                            border-bottom: 2px solid #0f172a;
                            padding-bottom: 12px;
                            margin-bottom: 30px;
                            display: flex;
                            justify-content: space-between;
                            align-items: flex-end;
                        }
                        .logo {
                            font-family: 'Outfit', sans-serif;
                            font-weight: 800;
                            font-size: 20px;
                            color: #0f172a;
                            letter-spacing: 0.5px;
                        }
                        .meta-info {
                            text-align: right;
                            font-size: 11px;
                            color: #64748b;
                        }
                        h1, h2, h3, h4 {
                            font-family: 'Outfit', sans-serif;
                            color: #0f172a;
                            margin-top: 24px;
                            margin-bottom: 12px;
                        }
                        h1 { font-size: 24px; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; }
                        h2 { font-size: 18px; }
                        h3 { font-size: 15px; }
                        p { margin-bottom: 16px; text-align: justify; }
                        ul, ol { margin-bottom: 20px; padding-left: 20px; }
                        li { margin-bottom: 6px; }
                        strong { color: #0f172a; font-weight: 600; }
                        
                        /* Table layout */
                        table {
                            width: 100%;
                            border-collapse: collapse;
                            margin: 20px 0;
                            font-size: 13px;
                        }
                        th, td {
                            padding: 10px 12px;
                            border: 1px solid #cbd5e1;
                            text-align: left;
                        }
                        th {
                            background-color: #f1f5f9;
                            color: #0f172a;
                            font-weight: 700;
                        }
                        tr:nth-child(even) td {
                            background-color: #f8fafc;
                        }
                        
                        /* Chat messages layout styling if chat */
                        .chat-message-print {
                            margin-bottom: 15px;
                            padding: 12px 16px;
                            border-radius: 6px;
                            border: 1px solid #e2e8f0;
                        }
                        .chat-message-print.user {
                            background-color: #f8fafc;
                            border-left: 4px solid #64748b;
                        }
                        .chat-message-print.assistant {
                            background-color: #f0fdf4;
                            border-left: 4px solid #16a34a;
                        }
                        .sender-lbl {
                            font-weight: 700;
                            font-size: 11px;
                            text-transform: uppercase;
                            margin-bottom: 6px;
                            color: #475569;
                            display: block;
                        }
                        
                        /* Conflict items and alert containers */
                        .synthesis-warning-container, .synthesis-conflict-banner {
                            border-left: 4px solid #dc2626;
                            background-color: #fef2f2;
                            padding: 12px;
                            border-radius: 4px;
                            margin-bottom: 15px;
                        }
                        .synthesis-conflict-title {
                            font-weight: bold;
                            color: #b91c1c;
                            margin-bottom: 6px;
                        }
                        .agent-header {
                            font-weight: bold;
                            background: #f1f5f9;
                            padding: 6px 10px;
                            border-radius: 4px;
                            margin-top: 15px;
                        }

                        @media print {
                            body { margin: 20px; }
                            button { display: none !important; }
                        }
                    </style>
                </head>
                <body>
                    <header>
                        <div>
                            <div class="logo">▲ APEX AGENTIC EQUITIES WORKSTATION</div>
                            <div style="font-size: 12px; color: #475569; font-weight: 600; margin-top: 4px;">${moduleName} - ${tickerName}</div>
                        </div>
                        <div class="meta-info">
                            <div>Generated: ${timestamp}</div>
                            <div>System: Apex AI Co-Pilot Console</div>
                        </div>
                    </header>
                    <main>
                        ${contentHtml}
                    </main>
                    <footer style="margin-top: 50px; border-top: 1px solid #e2e8f0; padding-top: 10px; font-size: 10px; color: #94a3b8; text-align: center;">
                        CONFIDENTIAL - FOR PROFESSIONAL AND INSTITUTIONAL ADVISORY USE ONLY
                    </footer>
                    <script>
                        window.onload = function() {
                            setTimeout(function() {
                                window.print();
                                // Do not close automatically so user can save or cancel comfortably
                            }, 500);
                        }
                    </script>
                </body>
                </html>
            `);
            printWindow.document.close();
            } catch (err) {
                console.error("PDF print failed: ", err);
                this.showToast("❌ PDF print failed.", "danger");
            }
        },

        /**
         * Resolves the standardized dynamic filename or page title
         */
        getExportFilename: function(metadata, type, isTitle = false) {
            const safeMeta = metadata || {};
            const moduleName = String(safeMeta.module || 'REPORT').toUpperCase();
            
            let tickerName = 'PORTFOLIO';
            if (safeMeta.ticker) {
                tickerName = String(safeMeta.ticker);
            } else if (window.activeStockProfile && window.activeStockProfile.ticker) {
                tickerName = String(window.activeStockProfile.ticker);
            }
            
            // Trim ticker name to remove .NS or .BO suffix
            tickerName = tickerName.replace('.NS', '').replace('.BO', '').toUpperCase();
            
            // Fallback module scopes
            const activeTab = window.activeTab || '';
            if (tickerName === 'PORTFOLIO') {
                if (activeTab === 'screener') {
                    tickerName = 'SCREENER';
                } else if (activeTab === 'watchlist') {
                    tickerName = 'WATCHLIST';
                } else if (activeTab === 'sector-regime') {
                    tickerName = 'SECTOR_REGIME';
                } else if (activeTab === 'market-news') {
                    tickerName = 'GLOBAL_NEWS';
                }
            }

            // Standardize dates
            const now = new Date();
            const yyyy = now.getFullYear();
            const mm = String(now.getMonth() + 1).padStart(2, '0');
            const dd = String(now.getDate()).padStart(2, '0');
            const hh = String(now.getHours()).padStart(2, '0');
            const min = String(now.getMinutes()).padStart(2, '0');
            
            let timestamp = `${yyyy}-${mm}-${dd}`;
            if (type === 'chat') {
                timestamp = `${yyyy}-${mm}-${dd}_${hh}${min}`;
            }

            const baseName = `APEX_AI_${moduleName}_${tickerName}_${timestamp}`;
            return isTitle ? baseName : `${baseName}.md`;
        },

        /**
         * Helper: Shows Toast notifications matching our custom design
         */
        showToast: function(msg, type = 'success') {
            if (typeof window.showToast === 'function') {
                window.showToast(msg, type);
            } else {
                console.log(`[Toast ${type}]: ${msg}`);
            }
        },

        /**
         * HTML-to-Markdown parser engine
         */
        convertToMarkdown: function(element, type) {
            // Clone node to manipulate it without affecting active view
            const clone = element.cloneNode(true);
            
            // Remove export action bars, typing indicators, speech buttons or loading skeletons
            const removeSelectors = [
                '.ai-export-action-bar',
                '.chat-speech-btn',
                '.chat-typing-bubble',
                '.spinner-loader',
                'button',
                '.section-speak-btn',
                '.tv-chat-speak-btn',
                '.fs-chat-speak-btn'
            ];
            removeSelectors.forEach(sel => {
                Array.from(clone.querySelectorAll(sel)).forEach(node => {
                    if (node.parentNode) node.parentNode.removeChild(node);
                });
            });

            let markdown = '';

            // Handle Chat Log formatting specifically
            if (type === 'chat') {
                // Find all child elements that represent chat bubbles
                const messages = Array.from(clone.children).filter(node => {
                    if (node.classList.contains('ai-export-action-bar')) return false;
                    if (node.classList.contains('chat-prompt-container')) return false;
                    if (node.id && node.id.includes('loading')) return false;
                    if (node.textContent.includes('thinking...') || node.textContent.includes('Analyzing...') || node.textContent.includes('Consulting AI')) return false;
                    if (node.style.fontStyle === 'italic' || node.querySelector('i') || node.textContent.includes('No messages yet') || node.textContent.includes('Conversation history is empty')) return false;
                    return true;
                });

                messages.forEach(msg => {
                    const isUser = msg.classList.contains('user') || 
                                   msg.style.alignSelf === 'flex-end' || 
                                   msg.innerHTML.includes('[User]') || 
                                   msg.textContent.includes('[User]');
                    
                    const sender = isUser ? 'USER' : 'APEX ADVISOR CO-PILOT';
                    let msgMarkdown = this.nodeToMarkdown(msg);
                    
                    // Strip off prefixes like [User], [Co-Pilot], USER:, etc. to make it clean
                    msgMarkdown = msgMarkdown.replace(/^###?\s*👤?\s*\[(USER|APEX ADVISOR CO-PILOT)\]\s*/gi, '');
                    msgMarkdown = msgMarkdown.replace(/^\[(User|Co-Pilot)\]\s*/gi, '');
                    msgMarkdown = msgMarkdown.replace(/^\b(User|Co-Pilot|Co-pilot|CoPilot):\s*/gi, '');

                    markdown += `### 👤 [${sender}]\n\n`;
                    markdown += msgMarkdown.trim() + '\n\n---\n\n';
                });
            } else {
                markdown = this.nodeToMarkdown(clone);
            }

            return markdown.trim();
        },

        /**
         * Recursive DOM Node to Markdown compiler
         */
        nodeToMarkdown: function(node) {
            if (node.nodeType === 3) { // Text Node
                return node.nodeValue;
            }
            if (node.nodeType !== 1) { // Not Element Node
                return '';
            }

            let content = '';
            Array.from(node.childNodes).forEach(child => {
                content += this.nodeToMarkdown(child);
            });

            const tag = node.tagName.toLowerCase();
            switch (tag) {
                case 'p':
                    return '\n' + content.trim() + '\n\n';
                case 'h1':
                    return '\n# ' + content.trim() + '\n\n';
                case 'h2':
                    return '\n## ' + content.trim() + '\n\n';
                case 'h3':
                    return '\n### ' + content.trim() + '\n\n';
                case 'h4':
                    return '\n#### ' + content.trim() + '\n\n';
                case 'h5':
                    return '\n##### ' + content.trim() + '\n\n';
                case 'strong':
                case 'b':
                    return `**${content.trim()}**`;
                case 'em':
                case 'i':
                    return `*${content.trim()}*`;
                case 'br':
                    return '\n';
                case 'li':
                    return `* ${content.trim()}\n`;
                case 'ul':
                    return '\n' + content + '\n';
                case 'ol':
                    // Just compile as unordered lists to prevent numbering resets
                    return '\n' + content + '\n';
                case 'table':
                    return '\n' + this.compileTableToMarkdown(node) + '\n\n';
                default:
                    // Preserve content of divs, spans, sections
                    if (node.classList.contains('synthesis-warning-container') || node.classList.contains('synthesis-conflict-banner')) {
                        return '\n> **[WARNING / FRICTION POINT]**\n' + content.replace(/\n/g, '\n> ') + '\n\n';
                    }
                    if (node.classList.contains('agent-header')) {
                        return `\n## 🧠 ${content.trim()}\n\n`;
                    }
                    return content;
            }
        },

        /**
         * Compiles HTML table elements to Markdown grids.
         */
        compileTableToMarkdown: function(tableEl) {
            const rows = Array.from(tableEl.querySelectorAll('tr'));
            if (rows.length === 0) return '';

            let tableMarkdown = '';
            let colCount = 0;

            rows.forEach((row, rowIdx) => {
                const cells = Array.from(row.querySelectorAll('th, td')).map(c => c.textContent.trim().replace(/\|/g, '\\|'));
                if (cells.length === 0) return;

                if (rowIdx === 0) {
                    colCount = cells.length;
                    tableMarkdown += '| ' + cells.join(' | ') + ' |\n';
                    tableMarkdown += '| ' + Array(colCount).fill('---').join(' | ') + ' |\n';
                } else {
                    // Match cell count to columns to prevent broken tables
                    const alignedCells = cells.slice(0, colCount);
                    while (alignedCells.length < colCount) {
                        alignedCells.push('');
                    }
                    tableMarkdown += '| ' + alignedCells.join(' | ') + ' |\n';
                }
            });

            return tableMarkdown;
        },

        /**
         * Extracts text contents recursively from target, ignoring action bars.
         */
        extractCleanText: function(el) {
            const clone = el.cloneNode(true);
            const removeSelectors = [
                '.ai-export-action-bar', 
                '.chat-speech-btn', 
                'button', 
                '.chat-typing-bubble',
                '.section-speak-btn',
                '.tv-chat-speak-btn',
                '.fs-chat-speak-btn'
            ];
            removeSelectors.forEach(sel => {
                Array.from(clone.querySelectorAll(sel)).forEach(node => {
                    if (node.parentNode) node.parentNode.removeChild(node);
                });
            });
            return clone.innerText.trim();
        },

        /**
         * Extracts clean innerHTML, wrapping messages in print wrappers if chat.
         */
        extractCleanHtml: function(el) {
            const clone = el.cloneNode(true);
            const removeSelectors = [
                '.ai-export-action-bar', 
                '.chat-speech-btn', 
                'button', 
                '.chat-typing-bubble',
                '.section-speak-btn',
                '.tv-chat-speak-btn',
                '.fs-chat-speak-btn'
            ];
            removeSelectors.forEach(sel => {
                Array.from(clone.querySelectorAll(sel)).forEach(node => {
                    if (node.parentNode) node.parentNode.removeChild(node);
                });
            });

            // If a chat log, wrap each message in clear block markers for printable sheets
            const isChatContainer = clone.classList.contains('chat-drawer-messages') || 
                                    clone.classList.contains('academy-ai-messages') || 
                                    clone.id === 'chat-messages' || 
                                    clone.id === 'audit-chatbot-history' || 
                                    clone.id === 'margin-chatbot-history' ||
                                    clone.id === 'tv-chart-chat-history' ||
                                    clone.id === 'sector-regime-chat-stream' ||
                                    clone.id === 'fs-chat-history';

            if (isChatContainer) {
                let formattedHtml = '';
                const messages = Array.from(clone.children).filter(node => {
                    if (node.classList.contains('ai-export-action-bar')) return false;
                    if (node.id && node.id.includes('loading')) return false;
                    if (node.textContent.includes('thinking...') || node.textContent.includes('Analyzing...')) return false;
                    if (node.style.fontStyle === 'italic') return false;
                    return true;
                });

                messages.forEach(msg => {
                    const isUser = msg.classList.contains('user') || 
                                   msg.style.alignSelf === 'flex-end' ||
                                   msg.innerHTML.includes('[User]') ||
                                   msg.textContent.includes('[User]');
                    
                    const sender = isUser ? 'USER' : 'APEX ADVISOR CO-PILOT';
                    let textContent = msg.innerHTML;
                    
                    // Strip off speaker/control buttons or text badges
                    textContent = textContent.replace(/^###?\s*👤?\s*\[(USER|APEX ADVISOR CO-PILOT)\]\s*/gi, '');
                    textContent = textContent.replace(/^\[(User|Co-Pilot)\]\s*/gi, '');

                    formattedHtml += `
                        <div class="chat-message-print ${isUser ? 'user' : 'assistant'}">
                            <span class="sender-lbl">${sender}</span>
                            <div>${textContent}</div>
                        </div>
                    `;
                });
                return formattedHtml;
            }

            return clone.innerHTML;
        }
    };

    // Expose globally
    window.AIExportManager = AIExportManager;
})();
