// ============================================================================
//  Panel Management — bot-detail
//  Resizing, collapsing, hiding, drag-reorder, panel manager dropdown
//  Extracted from page/bot-detail.html
// ============================================================================
//
//  External dependencies (must be available in global scope before this file):
//    - botId                 (var)
//    - rightPanelWidth       (let)
//    - currentLayout         (let)
//    - saveDashboardLayout() (function)
//    - closeAllDropdowns()   (function)
//    - openDropdownSafe()    (function)
//    - drawEquityCurve()     (function)
//    - loadPanelColors()     (function)
// ============================================================================

        // ==================== PANEL WIDTH RESIZER ====================
        function initPanelWidthResizer() {
            const resizer = document.getElementById('panelWidthResizer');
            if (!resizer) return;
            let dragging = false;
            let startX = 0;
            let startW = 0;

            resizer.addEventListener('mousedown', (e) => {
                e.preventDefault();
                dragging = true;
                startX = e.clientX;
                startW = rightPanelWidth;
                resizer.classList.add('active');
                document.body.style.cursor = 'ew-resize';
                document.body.style.userSelect = 'none';
            });

            document.addEventListener('mousemove', (e) => {
                if (!dragging) return;
                const delta = startX - e.clientX; // dragging left makes panel wider
                const newW = Math.max(250, Math.min(800, startW + delta));
                rightPanelWidth = newW;
                const container = document.querySelector('.app-container');
                if (currentLayout === 'default') {
                    container.style.gridTemplateColumns = `auto 1fr ${newW}px`;
                }
                window.dispatchEvent(new Event('resize'));
            });

            document.addEventListener('mouseup', () => {
                if (dragging) {
                    dragging = false;
                    resizer.classList.remove('active');
                    document.body.style.cursor = '';
                    document.body.style.userSelect = '';
                    saveDashboardLayout();
                    setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
                }
            });

            // Touch support
            resizer.addEventListener('touchstart', (e) => {
                dragging = true;
                startX = e.touches[0].clientX;
                startW = rightPanelWidth;
                resizer.classList.add('active');
            });

            document.addEventListener('touchmove', (e) => {
                if (!dragging) return;
                const delta = startX - e.touches[0].clientX;
                const newW = Math.max(250, Math.min(800, startW + delta));
                rightPanelWidth = newW;
                const container = document.querySelector('.app-container');
                if (currentLayout === 'default') {
                    container.style.gridTemplateColumns = `auto 1fr ${newW}px`;
                }
            });

            document.addEventListener('touchend', () => {
                if (dragging) {
                    dragging = false;
                    resizer.classList.remove('active');
                    saveDashboardLayout();
                }
            });
        }

        // ==================== PANEL WIDTH RESIZE HANDLES (individual) ====================
        function initPanelWidthHandles() {
            document.querySelectorAll('.resize-handle-w').forEach(handle => {
                let dragging = false;
                let startX = 0;
                let startW = 0;
                let panel = null;

                handle.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    dragging = true;
                    panel = document.getElementById(handle.dataset.panel);
                    startX = e.clientX;
                    startW = panel.offsetWidth;
                    handle.classList.add('active');
                    document.body.style.cursor = 'ew-resize';
                    document.body.style.userSelect = 'none';
                });

                handle.addEventListener('touchstart', (e) => {
                    e.stopPropagation();
                    dragging = true;
                    panel = document.getElementById(handle.dataset.panel);
                    startX = e.touches[0].clientX;
                    startW = panel.offsetWidth;
                    handle.classList.add('active');
                });

                document.addEventListener('mousemove', (e) => {
                    if (!dragging || !panel) return;
                    const delta = e.clientX - startX;
                    const newW = Math.max(220, startW + delta);
                    panel.style.width = newW + 'px';
                    panel.style.minWidth = newW + 'px';
                    panel.style.maxWidth = newW + 'px';
                    panel.style.flex = '0 0 ' + newW + 'px';
                });

                document.addEventListener('touchmove', (e) => {
                    if (!dragging || !panel) return;
                    const delta = e.touches[0].clientX - startX;
                    const newW = Math.max(220, startW + delta);
                    panel.style.width = newW + 'px';
                    panel.style.minWidth = newW + 'px';
                    panel.style.maxWidth = newW + 'px';
                    panel.style.flex = '0 0 ' + newW + 'px';
                });

                const endDrag = () => {
                    if (dragging) {
                        dragging = false;
                        handle.classList.remove('active');
                        document.body.style.cursor = '';
                        document.body.style.userSelect = '';
                        savePanelSizes();
                        panel = null;
                    }
                };
                document.addEventListener('mouseup', endDrag);
                document.addEventListener('touchend', endDrag);
            });
        }

        // ==================== CHART RESIZE ====================
        function initChartResize() {
            const chartContainer = document.getElementById('chartContainer');
            if (!chartContainer) return;
            const resizeRight = document.getElementById('chartResizeRight');
            const resizeBottom = document.getElementById('chartResizeBottom');
            const resizeCorner = document.getElementById('chartResizeCorner');

            let dragging = false;
            let mode = ''; // 'right' | 'bottom' | 'corner'
            let startX = 0, startY = 0, startW = 0, startH = 0;

            function onStart(e, m) {
                e.preventDefault();
                e.stopPropagation();
                dragging = true;
                mode = m;
                const touch = e.touches ? e.touches[0] : e;
                startX = touch.clientX;
                startY = touch.clientY;
                startW = chartContainer.offsetWidth;
                startH = chartContainer.offsetHeight;
                document.body.style.userSelect = 'none';
                if (m === 'right') document.body.style.cursor = 'ew-resize';
                else if (m === 'bottom') document.body.style.cursor = 'ns-resize';
                else document.body.style.cursor = 'nwse-resize';
                (e.target).classList.add('active');
            }

            if (resizeRight) {
                resizeRight.addEventListener('mousedown', (e) => onStart(e, 'right'));
                resizeRight.addEventListener('touchstart', (e) => onStart(e, 'right'));
            }
            if (resizeBottom) {
                resizeBottom.addEventListener('mousedown', (e) => onStart(e, 'bottom'));
                resizeBottom.addEventListener('touchstart', (e) => onStart(e, 'bottom'));
            }
            if (resizeCorner) {
                resizeCorner.addEventListener('mousedown', (e) => onStart(e, 'corner'));
                resizeCorner.addEventListener('touchstart', (e) => onStart(e, 'corner'));
            }

            function onMove(e) {
                if (!dragging) return;
                const touch = e.touches ? e.touches[0] : e;
                const dx = touch.clientX - startX;
                const dy = touch.clientY - startY;

                if (mode === 'right' || mode === 'corner') {
                    const newW = Math.max(300, startW + dx);
                    chartContainer.style.width = newW + 'px';
                    chartContainer.style.minWidth = newW + 'px';
                }
                if (mode === 'bottom' || mode === 'corner') {
                    const newH = Math.max(200, startH + dy);
                    chartContainer.style.height = newH + 'px';
                    chartContainer.style.minHeight = newH + 'px';
                }
                window.dispatchEvent(new Event('resize'));
            }

            document.addEventListener('mousemove', onMove);
            document.addEventListener('touchmove', onMove);

            function onEnd() {
                if (dragging) {
                    dragging = false;
                    document.body.style.cursor = '';
                    document.body.style.userSelect = '';
                    document.querySelectorAll('.chart-resize-right,.chart-resize-bottom,.chart-resize-corner').forEach(el => el.classList.remove('active'));
                    // Save chart size
                    const chartSizes = {
                        width: chartContainer.style.width || '',
                        height: chartContainer.style.height || '',
                        minWidth: chartContainer.style.minWidth || '',
                        minHeight: chartContainer.style.minHeight || ''
                    };
                    localStorage.setItem(`yamato_bot_${botId}_chartSize`, JSON.stringify(chartSizes));
                    setTimeout(() => window.dispatchEvent(new Event('resize')), 50);
                }
            }

            document.addEventListener('mouseup', onEnd);
            document.addEventListener('touchend', onEnd);
        }

        function loadChartSize() {
            try {
                const saved = localStorage.getItem(`yamato_bot_${botId}_chartSize`);
                if (!saved) return;
                const s = JSON.parse(saved);
                const cc = document.getElementById('chartContainer');
                if (!cc) return;
                if (s.width) cc.style.width = s.width;
                if (s.height) cc.style.height = s.height;
                if (s.minWidth) cc.style.minWidth = s.minWidth;
                if (s.minHeight) cc.style.minHeight = s.minHeight;
            } catch(e) {}
        }

        // ==================== RESIZABLE PANELS ====================

        var resizing = false;
        var currentResizePanel = null;
        var startY = 0;
        var startHeight = 0;

        // ── Panel state: save/load (sizes + collapsed + hidden + order) ──────────
        function loadPanelSizes() {
            const saved = localStorage.getItem(`yamato_bot_${botId}_panelSizes`);
            if (!saved) return;
            // Bust old oversized panelStats cache
            try {
                const s = JSON.parse(saved);
                if (s.panelStats?.height > 500) { delete s.panelStats.height; localStorage.setItem(`yamato_bot_${botId}_panelSizes`, JSON.stringify(s)); }
            } catch(e) {}
            try {
                const sizes = JSON.parse(saved);
                // Restore order first
                if (sizes._order) {
                    const container = document.getElementById('rightPanel');
                    sizes._order.forEach(panelId => {
                        const panel = document.getElementById(panelId);
                        if (panel) container.appendChild(panel);
                    });
                }
                const isHorizontal = document.getElementById('rightPanel')?.classList.contains('horizontal-layout');
                Object.keys(sizes).forEach(panelId => {
                    if (panelId === '_order') return;
                    const panel = document.getElementById(panelId);
                    if (!panel) return;
                    // Skip height/width restore in horizontal layout — CSS handles it
                    if (!isHorizontal) {
                        if (sizes[panelId].height && !sizes[panelId].collapsed) {
                            const minH = panel.dataset.minHeight ? parseInt(panel.dataset.minHeight) : 80;
                            panel.style.height = Math.max(sizes[panelId].height, minH) + 'px';
                        }
                        if (sizes[panelId].width) {
                            panel.style.width = sizes[panelId].width;
                            panel.style.minWidth = sizes[panelId].width;
                            panel.style.maxWidth = sizes[panelId].width;
                        }
                    } else {
                        // In horizontal: clear all size overrides
                        panel.style.height = '';
                        panel.style.width = '';
                        panel.style.minWidth = '';
                        panel.style.maxWidth = '';
                        panel.style.flex = '';
                    }
                    if (sizes[panelId].flex) {
                        panel.style.flex = sizes[panelId].flex;
                    }
                    if (sizes[panelId].collapsed) panel.classList.add('collapsed');
                    if (sizes[panelId].hidden) {
                        panel.classList.add('panel-hidden');
                        const btn = document.getElementById('pmToggle_' + panelId);
                        if (btn) btn.classList.remove('on');
                    }
                });
            } catch (e) { console.error('Error loading panel sizes:', e); }
        }

        function savePanelSizes() {
            const container = document.getElementById('rightPanel');
            const panels = container.querySelectorAll('.resizable-panel');
            const sizes = { _order: [] };
            panels.forEach(panel => {
                sizes._order.push(panel.id);
                const isCollapsed = panel.classList.contains('collapsed');
                const entry = {
                    height: isCollapsed ? 48 : panel.offsetHeight,
                    collapsed: isCollapsed,
                    hidden: panel.classList.contains('panel-hidden'),
                    width: panel.style.width || '',
                    flex: panel.style.flex || ''
                };
                // Preserve heightBeforeCollapse if panel is collapsed
                if (isCollapsed) {
                    const prev = localStorage.getItem(`yamato_bot_${botId}_panelSizes`);
                    try {
                        const p = prev ? JSON.parse(prev) : {};
                        if (p[panel.id]?.heightBeforeCollapse) entry.heightBeforeCollapse = p[panel.id].heightBeforeCollapse;
                    } catch(e) {}
                }
                sizes[panel.id] = entry;
            });
            localStorage.setItem(`yamato_bot_${botId}_panelSizes`, JSON.stringify(sizes));
        }

        // Toggle panel collapse
        function togglePanelCollapse(panelId) {
            const panel = document.getElementById(panelId);
            if (!panel) return;
            const wasCollapsed = panel.classList.contains('collapsed');
            if (wasCollapsed) {
                // Uncollapsing: restore saved height or default
                panel.classList.remove('collapsed');
                const saved = localStorage.getItem(`yamato_bot_${botId}_panelSizes`);
                let restoredH = null;
                if (saved) {
                    try {
                        const s = JSON.parse(saved);
                        if (s[panelId]?.heightBeforeCollapse) restoredH = s[panelId].heightBeforeCollapse;
                    } catch(e) {}
                }
                if (restoredH && restoredH > 36) {
                    panel.style.height = restoredH + 'px';
                } else if (!panel.style.height || panel.style.height === '36px') {
                    // Default heights per panel
                    const defaults = { panelStats: 'auto', positionPanel: '160px', panelOrders: '' };
                    panel.style.height = defaults[panelId] || '160px';
                    if (panelId === 'panelOrders') panel.style.flex = '1';
                }
            } else {
                // Collapsing: save current height first
                const curH = panel.offsetHeight;
                panel.classList.add('collapsed');
                // Save pre-collapse height
                const saved = localStorage.getItem(`yamato_bot_${botId}_panelSizes`);
                try {
                    const s = saved ? JSON.parse(saved) : {};
                    if (!s[panelId]) s[panelId] = {};
                    s[panelId].heightBeforeCollapse = curH;
                    localStorage.setItem(`yamato_bot_${botId}_panelSizes`, JSON.stringify(s));
                } catch(e) {}
            }
            savePanelSizes();
        }

        // Toggle panel hidden (via eye icon or panel manager)
        function togglePanelHidden(panelId) {
            const panel = document.getElementById(panelId);
            if (!panel) return;
            const isHidden = panel.classList.toggle('panel-hidden');
            const btn = document.getElementById('pmToggle_' + panelId);
            if (btn) btn.classList.toggle('on', !isHidden);
            savePanelSizes();
        }

        // Panel manager dropdown
        function togglePanelManager() {
            const dd = document.getElementById('panelManagerDropdown');
            const btn = document.getElementById('panelManagerBtn');
            if (!dd || !btn) return;
            var wasOpen = dd.classList.contains('open');
            if (wasOpen) {
                closeAllDropdowns();
                dd.classList.remove('open');
            } else {
                dd.classList.add('open');
                openDropdownSafe(dd, btn);
            }
        }

        function resetPanelLayout() {
            localStorage.removeItem(`yamato_bot_${botId}_panelSizes`);
            localStorage.removeItem(`yamato_bot_${botId}_chartSize`);
            location.reload();
        }

        // ── Drag-to-reorder panels ────────────────────────────────────────────
        function initPanelDrag() {
            const container = document.getElementById('rightPanel');
            let dragSrc = null;
            let fromHandle = false;

            // Global mouseup — reset draggable to avoid resize conflicts
            document.addEventListener('mouseup', () => {
                if (!dragSrc) {
                    container.querySelectorAll('.panel-card').forEach(p => { p.draggable = false; });
                }
                fromHandle = false;
            });

            container.querySelectorAll('.panel-card').forEach(panel => {
                const handle = panel.querySelector('.panel-drag-handle');
                if (!handle) return;

                handle.addEventListener('mousedown', (e) => {
                    fromHandle = true;
                    panel.draggable = true;
                    e.stopPropagation(); // don't bubble to resize handle
                });

                panel.addEventListener('dragstart', (e) => {
                    if (!fromHandle) { e.preventDefault(); panel.draggable = false; return; }
                    dragSrc = panel;
                    panel.classList.add('dragging');
                    e.dataTransfer.effectAllowed = 'move';
                });
                panel.addEventListener('dragend', () => {
                    panel.classList.remove('dragging');
                    panel.draggable = false;
                    dragSrc = null; fromHandle = false;
                    container.querySelectorAll('.panel-card').forEach(p => p.classList.remove('drag-over'));
                    savePanelSizes();
                });
                panel.addEventListener('dragover', (e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    if (panel !== dragSrc) panel.classList.add('drag-over');
                });
                panel.addEventListener('dragleave', () => { panel.classList.remove('drag-over'); });
                panel.addEventListener('drop', (e) => {
                    e.preventDefault();
                    if (!dragSrc || dragSrc === panel) return;
                    const allPanels = [...container.querySelectorAll('.panel-card')];
                    const srcIdx = allPanels.indexOf(dragSrc);
                    const tgtIdx = allPanels.indexOf(panel);
                    if (srcIdx < tgtIdx) container.insertBefore(dragSrc, panel.nextSibling);
                    else container.insertBefore(dragSrc, panel);
                    panel.classList.remove('drag-over');
                });
            });
        }

        // Initialize resize handles
        function initResizeHandles() {
            const handles = document.querySelectorAll('.resize-handle');

            handles.forEach(handle => {
                handle.addEventListener('mousedown', (e) => {
                    e.preventDefault();
                    resizing = true;
                    currentResizePanel = document.getElementById(handle.dataset.panel);
                    startY = e.clientY;
                    // Use parsed style.height (not offsetHeight) so flex compression doesn't offset our drag
                    startHeight = parseFloat(currentResizePanel.style.height) || currentResizePanel.offsetHeight;
                    handle.classList.add('active');
                    document.body.style.cursor = 'ns-resize';
                    document.body.style.userSelect = 'none';
                });

                // Touch support
                handle.addEventListener('touchstart', (e) => {
                    resizing = true;
                    currentResizePanel = document.getElementById(handle.dataset.panel);
                    startY = e.touches[0].clientY;
                    startHeight = parseFloat(currentResizePanel.style.height) || currentResizePanel.offsetHeight;
                    handle.classList.add('active');
                });
            });

            function calcMaxHeight(panel) {
                const hardCap = panel.dataset.maxHeight ? parseInt(panel.dataset.maxHeight) : 99999;
                const container = panel.parentElement;
                const containerH = container.offsetHeight;
                const gap = parseFloat(getComputedStyle(container).gap) || 8;
                let othersH = 0;
                let visibleCount = 0;
                Array.from(container.querySelectorAll('.resizable-panel')).forEach(p => {
                    if (p === panel || p.classList.contains('panel-hidden') || p.classList.contains('collapsed')) return;
                    visibleCount++;
                    // Use per-panel min-height or 80px fallback
                    const pMinH = p.dataset.minHeight ? parseInt(p.dataset.minHeight) : (p.id === 'panelOrders' ? 200 : 80);
                    othersH += Math.max(pMinH, p.classList.contains('collapsed') ? 48 : pMinH);
                });
                visibleCount++; // count the panel being resized
                const gapsH = gap * Math.max(0, visibleCount - 1);
                const panelMinH = panel.dataset.minHeight ? parseInt(panel.dataset.minHeight) : 80;
                return Math.min(hardCap, Math.max(panelMinH, containerH - othersH - gapsH));
            }

            document.addEventListener('mousemove', (e) => {
                if (!resizing || !currentResizePanel) return;
                const deltaY = e.clientY - startY;
                const maxH = calcMaxHeight(currentResizePanel);
                const minH = currentResizePanel.dataset.minHeight ? parseInt(currentResizePanel.dataset.minHeight) : 80;
                const newHeight = Math.max(minH, Math.min(maxH, startHeight + deltaY));
                currentResizePanel.style.height = newHeight + 'px';
                if (currentResizePanel.classList.contains('collapsed')) {
                    currentResizePanel.classList.remove('collapsed');
                }
            });

            document.addEventListener('touchmove', (e) => {
                if (!resizing || !currentResizePanel) return;
                const deltaY = e.touches[0].clientY - startY;
                const maxH = calcMaxHeight(currentResizePanel);
                const minH = currentResizePanel.dataset.minHeight ? parseInt(currentResizePanel.dataset.minHeight) : 80;
                const newHeight = Math.max(minH, Math.min(maxH, startHeight + deltaY));
                currentResizePanel.style.height = newHeight + 'px';
                if (currentResizePanel.classList.contains('collapsed')) {
                    currentResizePanel.classList.remove('collapsed');
                }
            });

            document.addEventListener('mouseup', () => {
                if (resizing) {
                    if (currentResizePanel && currentResizePanel.id === 'panelStats') drawEquityCurve();
                    resizing = false;
                    document.querySelectorAll('.resize-handle').forEach(h => h.classList.remove('active'));
                    document.body.style.cursor = '';
                    document.body.style.userSelect = '';
                    savePanelSizes();
                    currentResizePanel = null;
                }
            });

            document.addEventListener('touchend', () => {
                if (resizing) {
                    if (currentResizePanel && currentResizePanel.id === 'panelStats') drawEquityCurve();
                    resizing = false;
                    document.querySelectorAll('.resize-handle').forEach(h => h.classList.remove('active'));
                    savePanelSizes();
                    currentResizePanel = null;
                }
            });
        }

        // Double-click to reset panel size
        function initPanelResizeDoubleClick() {
            document.querySelectorAll('.resize-handle').forEach(handle => {
                handle.addEventListener('dblclick', () => {
                    const panel = document.getElementById(handle.dataset.panel);
                    if (panel) {
                        panel.style.height = '';
                        panel.classList.remove('collapsed');
                        savePanelSizes();
                    }
                });
            });
        }
