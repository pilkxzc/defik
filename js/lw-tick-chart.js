'use strict';
/**
 * LWTickChart — Lightweight Charts based tick chart for sub-5s timeframes.
 * Drop-in replacement for canvas-based TickChart with drawing tools.
 *
 * Usage:
 *   const tc = new LWTickChart(containerEl, { maxTicks: 2000 });
 *   tc.start(symbol);
 *   tc.setMarkers(markers);
 *   tc.startDrawing('trendLine');
 *   tc.destroy();
 */

// ── Constants ────────────────────────────────────────────────────────────────
const LW_MAX_TICKS      = 20000;  // increased for deeper history
const LW_WS_MAX_RETRIES = 10;
const LW_WS_BASE_DELAY  = 2000;
const LW_HISTORY_FETCH_LIMIT = 1000;  // trades per REST request
const LW_DOWNSAMPLE_THRESHOLD = 3000; // visible points above which to downsample

// Drawing tool name mapping: klinecharts name → internal name
const LW_DRAWING_MAP = {
    'segment':              'trendLine',
    'horizontalStraightLine': 'horizontalLine',
    'verticalStraightLine': 'verticalLine',
    'priceChannelLine':     'channel',
    'rect':                 'rectangle',
    'arrow':                'arrow',
    'text':                 'text',
    // Also accept internal names directly
    'trendLine':            'trendLine',
    'horizontalLine':       'horizontalLine',
    'verticalLine':         'verticalLine',
    'channel':              'channel',
    'rectangle':            'rectangle',
    'fibonacci':            'fibonacci',
    'fibonacciLine':        'fibonacci',
};

// How many points each drawing type needs
const LW_DRAWING_POINTS = {
    trendLine:      2,
    horizontalLine: 1,
    verticalLine:   1,
    channel:        3,
    rectangle:      2,
    arrow:          2,
    text:           1,
    fibonacci:      2,
};

// ── LWTickChart class ────────────────────────────────────────────────────────
class LWTickChart {
    constructor(container, opts = {}) {
        this.container = container;
        this.maxTicks = opts.maxTicks || LW_MAX_TICKS;

        // Public state (compatible with TickChart API)
        this.ticks = [];        // [{price, time, qty}] — original format
        this.markers = [];
        this.levels = [];
        this.magnet = false;
        this._dirty = false;
        this.onRedraw = null;

        // Internal state
        this._ws = null;
        this._wsRetries = 0;
        this._wsReconnectTimer = null;
        this._symbol = '';
        this._lastLwTime = 0;  // last time value sent to LW (for uniqueness)
        this._lwData = [];     // [{time, value}] — LW format
        this._priceLines = []; // active price line objects
        this._crosshairPos = null; // {time, price, x, y}
        this._userScrolled = false;
        this.autoScrollLocked = false; // when true, _userScrolled stays true (free scroll mode)

        // Lazy history loading
        this._oldestTradeTime = null;  // ms — oldest trade we have
        this._historyLoading = false;  // prevent concurrent fetches
        this._historyExhausted = false; // true when Binance returns 0 older trades

        // Downsampling
        this._fullData = [];     // always holds ALL ticks as {time, value}
        this._isDownsampled = false; // true when series shows simplified data

        // Drawing tools
        this._drawings = [];       // completed drawings
        this._drawingMode = null;  // current tool type or null
        this._drawingPoints = [];  // points for current drawing in progress
        this._drawingPreview = null; // preview point (follows cursor)
        this._drawingIdCounter = 0;
        this._drawCanvas = null;
        this._drawCtx = null;
        this._drawRAF = null;

        // Create chart
        this._createChart();
        this._createDrawingCanvas();
        this._setupInteraction();
    }

    // ── Chart creation ───────────────────────────────────────────────────────
    _createChart() {
        const lc = window.LightweightCharts;
        if (!lc) {
            console.error('[LWTickChart] LightweightCharts not loaded!');
            return;
        }

        const cs = getComputedStyle(document.documentElement);
        const bgColor = cs.getPropertyValue('--chart-background').trim() || cs.getPropertyValue('--bg-app').trim() || '#141414';
        const textColor = cs.getPropertyValue('--chart-text-color').trim() || '#A1A1A1';
        const gridColor = cs.getPropertyValue('--chart-grid-color').trim() || 'rgba(255,255,255,0.03)';
        const borderColor = 'rgba(255,255,255,0.08)';

        this._chart = lc.createChart(this.container, {
            width: this.container.clientWidth,
            height: this.container.clientHeight,
            layout: {
                background: { type: 'solid', color: bgColor },
                textColor: textColor,
                fontFamily: "'Plus Jakarta Sans', sans-serif",
                fontSize: 11,
            },
            grid: {
                vertLines: { color: gridColor },
                horzLines: { color: gridColor },
            },
            rightPriceScale: {
                borderColor: borderColor,
                scaleMargins: { top: 0.08, bottom: 0.08 },
            },
            timeScale: {
                borderColor: borderColor,
                timeVisible: true,
                secondsVisible: true,
                rightOffset: 5,
                barSpacing: 3,
                minBarSpacing: 0.5,
            },
            localization: {
                timeFormatter: function(ts) {
                    // ts already has tz offset baked in from _msToUnique
                    var d = new Date(ts * 1000);
                    var h = d.getUTCHours().toString().padStart(2, '0');
                    var m = d.getUTCMinutes().toString().padStart(2, '0');
                    var s = d.getUTCSeconds().toString().padStart(2, '0');
                    return h + ':' + m + ':' + s;
                },
            },
            crosshair: {
                mode: 0,
                vertLine: {
                    color: 'rgba(255,255,255,0.2)',
                    width: 1,
                    style: 3, // dotted
                    labelBackgroundColor: 'rgba(20,20,20,0.95)',
                },
                horzLine: {
                    color: 'rgba(255,255,255,0.2)',
                    width: 1,
                    style: 3,
                    labelBackgroundColor: 'rgba(20,20,20,0.95)',
                },
            },
            handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
            handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
        });

        // Line series for tick data
        const seriesOpts = {
            color: '#10B981',
            lineWidth: 1.5,
            crosshairMarkerVisible: true,
            crosshairMarkerRadius: 4,
            crosshairMarkerBorderColor: '#10B981',
            crosshairMarkerBackgroundColor: 'rgba(16,185,129,0.3)',
            lastValueVisible: true,
            priceLineVisible: true,
            priceLineColor: 'rgba(16,185,129,0.4)',
            priceLineWidth: 1,
            priceLineStyle: 2,
        };

        // v4: chart.addLineSeries() / v5: chart.addSeries(LineSeries)
        if (typeof this._chart.addLineSeries === 'function') {
            this._series = this._chart.addLineSeries(seriesOpts);
        } else if (lc.LineSeries) {
            this._series = this._chart.addSeries(lc.LineSeries, seriesOpts);
        } else {
            this._series = this._chart.addLineSeries(seriesOpts);
        }

        // Crosshair tracking
        this._chart.subscribeCrosshairMove((param) => {
            if (param.point) {
                const price = this._series.coordinateToPrice(param.point.y);
                this._crosshairPos = {
                    time: param.time || null,
                    price: isNaN(price) ? null : price,
                    x: param.point.x,
                    y: param.point.y,
                };
            } else {
                this._crosshairPos = null;
            }
        });

        // Track user scroll
        this._snapbackHintShown = false;
        this._snapbackDragStart = null;
        this._chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
            if (this.autoScrollLocked) {
                this._userScrolled = true;
                return;
            }
            if (range && this._lwData.length > 0) {
                const rightEdge = range.to;
                const leftEdge = range.from;
                const dataLen = this._lwData.length;
                const wasScrolled = this._userScrolled;
                this._userScrolled = rightEdge < dataLen - 3;

                // ── Lazy-load: fetch older history when user scrolls near left edge ──
                if (leftEdge < 20 && !this._historyLoading && !this._historyExhausted) {
                    this._loadOlderHistory();
                }

                // ── Downsampling: simplify when zoomed out too far ──
                const visibleCount = Math.floor(rightEdge - leftEdge);
                if (visibleCount > LW_DOWNSAMPLE_THRESHOLD && !this._isDownsampled) {
                    this._applyDownsample(visibleCount);
                } else if (visibleCount <= LW_DOWNSAMPLE_THRESHOLD && this._isDownsampled) {
                    this._removeDownsample();
                }

                // Detect user dragging away from live edge
                if (this._userScrolled && !wasScrolled) {
                    this._snapbackDragStart = Date.now();
                }
                // Detect snap-back: user was scrolled, now snapped back to live
                if (wasScrolled && !this._userScrolled && this._snapbackDragStart) {
                    const dragDuration = Date.now() - this._snapbackDragStart;
                    this._snapbackDragStart = null;
                    if (dragDuration > 300 && !this._snapbackHintShown) {
                        this._snapbackHintShown = true;
                        this._showSnapbackHint();
                        setTimeout(() => { this._snapbackHintShown = false; }, 60000);
                    }
                }
            }
        });

        // Resize observer
        this._resizeObserver = new ResizeObserver(() => {
            if (this._chart) {
                this._chart.resize(this.container.clientWidth, this.container.clientHeight);
                this._resizeDrawingCanvas();
            }
        });
        this._resizeObserver.observe(this.container);
    }

    // ── Drawing canvas overlay ───────────────────────────────────────────────
    _createDrawingCanvas() {
        this._drawCanvas = document.createElement('canvas');
        this._drawCanvas.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:3;';
        this.container.appendChild(this._drawCanvas);
        this._drawCtx = this._drawCanvas.getContext('2d');
        this._resizeDrawingCanvas();

        // Start render loop for drawings
        this._startDrawingLoop();
    }

    _resizeDrawingCanvas() {
        if (!this._drawCanvas) return;
        const r = this.container.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        this._drawCanvas.width = Math.round(r.width * dpr);
        this._drawCanvas.height = Math.round(r.height * dpr);
        this._drawCanvas.style.width = r.width + 'px';
        this._drawCanvas.style.height = r.height + 'px';
        if (this._drawCtx) this._drawCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    _startDrawingLoop() {
        const loop = () => {
            // Only render if there are drawings or we're in drawing mode
            if (this._drawings.length > 0 || this._drawingMode) {
                this._renderDrawings();
            } else if (this._drawCtx) {
                // Clear canvas when no drawings
                this._drawCtx.clearRect(0, 0, this._drawCanvas.clientWidth, this._drawCanvas.clientHeight);
            }
            this._drawRAF = requestAnimationFrame(loop);
        };
        this._drawRAF = requestAnimationFrame(loop);
    }

    // ── Mouse interaction for drawings ───────────────────────────────────────
    _setupInteraction() {
        this._onDrawClick = (e) => {
            if (!this._drawingMode) return;
            if (!this._crosshairPos || this._crosshairPos.price === null) return;

            const point = {
                time: this._crosshairPos.time,
                price: this._crosshairPos.price,
            };

            // For horizontal line, only need price (use last data time as reference)
            if (this._drawingMode === 'horizontalLine' && !point.time && this._lwData.length > 0) {
                point.time = this._lwData[this._lwData.length - 1].time;
            }
            // For vertical line, only need time
            if (this._drawingMode === 'verticalLine' && point.time) {
                point.price = point.price || 0;
            }

            // For text, prompt for label
            if (this._drawingMode === 'text' && this._drawingPoints.length === 0) {
                const text = prompt('Текст:');
                if (!text) { this._cancelDrawing(); return; }
                point.text = text;
            }

            this._drawingPoints.push(point);

            const needed = LW_DRAWING_POINTS[this._drawingMode] || 2;
            if (this._drawingPoints.length >= needed) {
                this._finalizeDrawing();
            }
        };

        this._onDrawDblClick = () => {
            // Double-click cancels current drawing
            if (this._drawingMode) {
                this._cancelDrawing();
            }
        };

        this._onKeyDown = (e) => {
            if (e.key === 'Escape' && this._drawingMode) {
                this._cancelDrawing();
            }
            // Delete key removes last drawing
            if (e.key === 'Delete' && this._drawings.length > 0 && !this._drawingMode) {
                this._drawings.pop();
            }
        };

        this.container.addEventListener('click', this._onDrawClick);
        this.container.addEventListener('dblclick', this._onDrawDblClick);
        document.addEventListener('keydown', this._onKeyDown);
    }

    // ── Data management ──────────────────────────────────────────────────────
    _msToUnique(timeMs) {
        // Convert ms timestamp to unique seconds-level value for lightweight-charts
        // Add local timezone offset so chart displays user's local time
        const tzOffsetSec = -(new Date().getTimezoneOffset()) * 60;
        let t = (timeMs / 1000) + tzOffsetSec;
        if (t <= this._lastLwTime) {
            t = this._lastLwTime + 0.001;
        }
        this._lastLwTime = t;
        return t;
    }

    loadHistory(trades) {
        this._lastLwTime = 0;
        this.ticks = [];
        this._lwData = [];
        this._fullData = [];
        this._isDownsampled = false;
        this._historyExhausted = false;

        if (!trades || trades.length === 0) return;

        for (let i = 0; i < trades.length; i++) {
            const t = trades[i];
            const price = parseFloat(t.price || t.p);
            let timeMs = t.time || t.T;
            if (typeof timeMs === 'number' && timeMs < 1e12) timeMs *= 1000;
            const qty = parseFloat(t.qty || t.q || 0);

            this.ticks.push({ price, time: timeMs, qty });
            const lwTime = this._msToUnique(timeMs);
            this._lwData.push({ time: lwTime, value: price });
        }

        this._fullData = this._lwData.slice(); // copy for downsampling
        this._oldestTradeTime = this.ticks.length > 0 ? this.ticks[0].time : null;

        if (this._series) {
            this._series.setData(this._lwData);
            const showCount = Math.min(300, this._lwData.length);
            this._chart.timeScale().setVisibleLogicalRange({
                from: this._lwData.length - showCount,
                to: this._lwData.length + 5,
            });
        }

        this._userScrolled = false;
        this._updateMarkers();
        if (typeof this.onRedraw === 'function') this.onRedraw();
    }

    addTick(t) {
        const price = parseFloat(t.price || t.p);
        let timeMs = t.time || t.T;
        if (typeof timeMs === 'number' && timeMs < 1e12) timeMs *= 1000;
        const qty = parseFloat(t.qty || t.q || 0);

        this.ticks.push({ price, time: timeMs, qty });
        const lwTime = this._msToUnique(timeMs);
        const lwPoint = { time: lwTime, value: price };
        this._lwData.push(lwPoint);
        this._fullData.push(lwPoint);

        // Trim if over limit
        if (this.ticks.length > this.maxTicks) {
            const excess = this.ticks.length - this.maxTicks;
            this.ticks.splice(0, excess);
            this._lwData.splice(0, excess);
            this._fullData.splice(0, excess);
            if (this._series && !this._isDownsampled) this._series.setData(this._lwData);
        } else {
            if (this._series && !this._isDownsampled) this._series.update(lwPoint);
        }

        // Auto-scroll to latest if user hasn't manually scrolled away
        if (!this._userScrolled && this._chart) {
            this._chart.timeScale().scrollToRealTime();
        }

        if (typeof this.onRedraw === 'function') this.onRedraw();
    }

    // ── Markers ──────────────────────────────────────────────────────────────
    setMarkers(markers) {
        this.markers = markers || [];
        this._updateMarkers();
    }

    _updateMarkers() {
        if (!this._series || !this.markers.length || !this._lwData.length) {
            if (this._series) this._series.setMarkers([]);
            return;
        }

        // Convert markers to lightweight-charts format
        const lwMarkers = [];
        for (const m of this.markers) {
            let timeMs = m.time;
            if (typeof timeMs === 'number' && timeMs < 1e12) timeMs *= 1000; // sec → ms

            // Find nearest data point time
            const nearestLwTime = this._findNearestLwTime(timeMs);
            if (nearestLwTime === null) continue;

            const isEntry = m.isEntry !== false;
            const isLong = m.side === 'LONG' || m.side === 'BUY';
            const pnl = parseFloat(m.pnl || 0);

            let shape, position, color, text;

            if (isEntry) {
                shape = isLong ? 'arrowUp' : 'arrowDown';
                position = isLong ? 'belowBar' : 'aboveBar';
                color = isLong ? '#22D3EE' : '#F59E0B';
                text = isLong ? 'L' : 'S';
            } else {
                shape = 'circle';
                position = isLong ? 'aboveBar' : 'belowBar';
                color = pnl >= 0 ? '#34D399' : '#F97316';
                text = pnl !== 0 ? (pnl > 0 ? '+' : '') + pnl.toFixed(2) : '';
            }

            // Grouped marker
            if (m.count && m.count > 1) {
                shape = 'square';
                text = String(m.count);
                color = '#8B5CF6';
            }

            lwMarkers.push({
                time: nearestLwTime,
                position: position,
                color: color,
                shape: shape,
                text: text,
                size: m.count > 1 ? 2 : 1.5,
            });
        }

        // Sort by time (required by lightweight-charts)
        lwMarkers.sort((a, b) => a.time - b.time);

        // Deduplicate same time+position (LW doesn't handle well)
        const deduped = [];
        for (let i = 0; i < lwMarkers.length; i++) {
            const m = lwMarkers[i];
            const prev = deduped[deduped.length - 1];
            if (prev && prev.time === m.time && prev.position === m.position) {
                // Merge: keep the more important marker
                if (m.shape === 'square' || m.text.length > prev.text.length) {
                    deduped[deduped.length - 1] = m;
                }
            } else {
                deduped.push(m);
            }
        }

        try {
            this._series.setMarkers(deduped);
        } catch (e) {
            console.warn('[LWTickChart] setMarkers error:', e);
        }
    }

    _findNearestLwTime(timeMs) {
        if (this._lwData.length === 0) return null;
        const targetSec = timeMs / 1000;

        // Binary search for nearest
        let lo = 0, hi = this._lwData.length - 1;
        while (lo < hi) {
            const mid = (lo + hi) >> 1;
            if (this._lwData[mid].time < targetSec) lo = mid + 1;
            else hi = mid;
        }

        // Check lo and lo-1 for closest
        let best = lo;
        if (lo > 0) {
            const diffLo = Math.abs(this._lwData[lo].time - targetSec);
            const diffPrev = Math.abs(this._lwData[lo - 1].time - targetSec);
            if (diffPrev < diffLo) best = lo - 1;
        }

        // Only match if within 60 seconds
        if (Math.abs(this._lwData[best].time - targetSec) > 60) return null;
        return this._lwData[best].time;
    }

    // ── Price levels ─────────────────────────────────────────────────────────
    setLevels(levels) {
        this.levels = levels || [];
        this._updateLevels();
    }

    _updateLevels() {
        if (!this._series) return;

        // Remove existing price lines
        for (const pl of this._priceLines) {
            try { this._series.removePriceLine(pl); } catch (e) {}
        }
        this._priceLines = [];

        // Create new price lines
        for (const lvl of this.levels) {
            const price = parseFloat(lvl.price);
            if (!price || isNaN(price)) continue;

            // Map dash array to LineStyle
            let lineStyle = 2; // LargeDashed default
            if (lvl.dash) {
                const d = lvl.dash;
                if (Array.isArray(d) && d[0] <= 4) lineStyle = 3; // Dotted
                else if (Array.isArray(d) && d[0] >= 8) lineStyle = 1; // Dashed
            }

            const pl = this._series.createPriceLine({
                price: price,
                color: lvl.color || '#A1A1A1',
                lineWidth: lvl.type === 'entry' ? 2 : 1,
                lineStyle: lineStyle,
                axisLabelVisible: true,
                title: lvl.label || '',
            });

            this._priceLines.push(pl);
        }
    }

    // ── WebSocket ────────────────────────────────────────────────────────────
    connectWs(symbol) {
        this.disconnectWs();
        this._symbol = symbol.toUpperCase();
        const wsSymbol = this._symbol.toLowerCase();
        const url = `wss://fstream.binance.com/ws/${wsSymbol}@aggTrade`;

        try {
            this._ws = new WebSocket(url);
        } catch (e) {
            console.error('[LWTickChart] WS connect error:', e);
            return;
        }

        this._ws.onopen = () => {
            this._wsRetries = 0;
            this._updateWsStatus(true);
        };

        this._ws.onmessage = (evt) => {
            try {
                const msg = JSON.parse(evt.data);
                if (msg.e === 'aggTrade') {
                    this.addTick({ price: msg.p, time: msg.T, qty: msg.q });
                }
            } catch (e) {}
        };

        this._ws.onclose = (evt) => {
            this._updateWsStatus(false);
            if (evt.code !== 1000 && this._wsRetries < LW_WS_MAX_RETRIES) {
                const delay = Math.min(LW_WS_BASE_DELAY * Math.pow(2, this._wsRetries), 30000);
                this._wsRetries++;
                this._wsReconnectTimer = setTimeout(() => this.connectWs(this._symbol), delay);
            }
        };

        this._ws.onerror = () => {};
    }

    disconnectWs() {
        if (this._wsReconnectTimer) {
            clearTimeout(this._wsReconnectTimer);
            this._wsReconnectTimer = null;
        }
        if (this._ws) {
            this._ws.onclose = null;
            this._ws.onmessage = null;
            this._ws.onerror = null;
            try { this._ws.close(1000); } catch (e) {}
            this._ws = null;
        }
    }

    _updateWsStatus(connected) {
        const dot = document.getElementById('wsStatusDot');
        const txt = document.getElementById('wsStatusText');
        if (dot) {
            dot.style.background = connected ? '#10B981' : '#EF4444';
            dot.style.boxShadow = connected ? '0 0 6px rgba(16,185,129,0.5)' : '0 0 6px rgba(239,68,68,0.5)';
        }
        if (txt) txt.textContent = connected ? 'Підключено' : 'Відключено';
    }

    async start(symbol) {
        this._symbol = symbol.toUpperCase();

        // Fetch initial trades — 3 pages of 1000 for deeper history
        try {
            const url1 = `https://fapi.binance.com/fapi/v1/aggTrades?symbol=${this._symbol}&limit=1000`;
            const resp1 = await fetch(url1);
            if (!resp1.ok) throw new Error(`HTTP ${resp1.status}`);
            const data1 = await resp1.json();

            let allTrades = data1;

            // Fetch 2 more pages of older trades
            if (data1.length > 0) {
                const oldest = data1[0].T;
                try {
                    const url2 = `https://fapi.binance.com/fapi/v1/aggTrades?symbol=${this._symbol}&endTime=${oldest - 1}&limit=1000`;
                    const resp2 = await fetch(url2);
                    if (resp2.ok) {
                        const data2 = await resp2.json();
                        if (data2.length > 0) {
                            allTrades = [...data2, ...allTrades];
                            try {
                                const url3 = `https://fapi.binance.com/fapi/v1/aggTrades?symbol=${this._symbol}&endTime=${data2[0].T - 1}&limit=1000`;
                                const resp3 = await fetch(url3);
                                if (resp3.ok) {
                                    const data3 = await resp3.json();
                                    if (data3.length > 0) allTrades = [...data3, ...allTrades];
                                }
                            } catch(e) {}
                        }
                    }
                } catch(e) {}
            }

            this.loadHistory(allTrades.map(d => ({ price: d.p, time: d.T, qty: d.q })));
        } catch (e) {
            console.error('[LWTickChart] REST fetch error:', e);
        }

        // Connect WebSocket for live updates
        this.connectWs(this._symbol);
    }

    // ── Navigation ───────────────────────────────────────────────────────────
    centerOnTime(timeMs) {
        if (!this._chart || this._lwData.length === 0) return;
        const targetSec = timeMs / 1000;

        // Find index of nearest point
        let bestIdx = 0;
        let bestDiff = Infinity;
        for (let i = 0; i < this._lwData.length; i++) {
            const diff = Math.abs(this._lwData[i].time - targetSec);
            if (diff < bestDiff) {
                bestDiff = diff;
                bestIdx = i;
            }
        }

        // Show ±150 ticks around the target
        const from = Math.max(0, bestIdx - 150);
        const to = Math.min(this._lwData.length, bestIdx + 150);
        this._chart.timeScale().setVisibleLogicalRange({ from, to });
        this._userScrolled = true;
    }

    // ── Coordinate conversion (for ruler/range tools) ────────────────────────
    getLastPrice() {
        if (this.ticks.length === 0) return 0;
        return this.ticks[this.ticks.length - 1].price;
    }

    pixelToChart(px, py) {
        if (!this._chart || !this._series) return { price: 0, tickIndex: 0, time: 0, snappedX: px, snappedY: py };

        const time = this._chart.timeScale().coordinateToTime(px);
        const price = this._series.coordinateToPrice(py);

        // Find nearest tick
        let tickIndex = 0;
        let snappedTime = 0;
        let snappedPrice = 0;
        let snappedX = px;
        let snappedY = py;

        if (time !== null && this._lwData.length > 0) {
            // Binary search for nearest
            let lo = 0, hi = this._lwData.length - 1;
            while (lo < hi) {
                const mid = (lo + hi) >> 1;
                if (this._lwData[mid].time < time) lo = mid + 1;
                else hi = mid;
            }
            if (lo > 0) {
                const d1 = Math.abs(this._lwData[lo].time - time);
                const d2 = Math.abs(this._lwData[lo - 1].time - time);
                if (d2 < d1) lo--;
            }
            tickIndex = lo;
            const pt = this._lwData[lo];
            snappedTime = pt.time * 1000; // back to ms
            snappedPrice = pt.value;
            const sx = this._chart.timeScale().timeToCoordinate(pt.time);
            const sy = this._series.priceToCoordinate(pt.value);
            if (sx !== null) snappedX = sx;
            if (sy !== null) snappedY = sy;
        }

        return {
            price: this.magnet ? snappedPrice : (price || 0),
            tickIndex: tickIndex,
            time: this.magnet ? snappedTime : (time ? time * 1000 : 0),
            snappedX: this.magnet ? snappedX : px,
            snappedY: this.magnet ? snappedY : py,
        };
    }

    chartToPixel(tickIndex, price, time) {
        if (!this._chart || !this._series) return { x: 0, y: 0 };

        let x = 0, y = 0;

        if (time) {
            // time is in ms, convert to seconds
            const timeSec = time / 1000;
            // Find nearest LW time
            let bestTime = timeSec;
            if (this._lwData.length > 0) {
                let lo = 0, hi = this._lwData.length - 1;
                while (lo < hi) {
                    const mid = (lo + hi) >> 1;
                    if (this._lwData[mid].time < timeSec) lo = mid + 1;
                    else hi = mid;
                }
                if (lo > 0) {
                    const d1 = Math.abs(this._lwData[lo].time - timeSec);
                    const d2 = Math.abs(this._lwData[lo - 1].time - timeSec);
                    if (d2 < d1) lo--;
                }
                bestTime = this._lwData[lo].time;
            }
            const coord = this._chart.timeScale().timeToCoordinate(bestTime);
            if (coord !== null) x = coord;
        } else if (tickIndex >= 0 && tickIndex < this._lwData.length) {
            const coord = this._chart.timeScale().timeToCoordinate(this._lwData[tickIndex].time);
            if (coord !== null) x = coord;
        }

        if (price) {
            const coord = this._series.priceToCoordinate(price);
            if (coord !== null) y = coord;
        }

        return { x, y };
    }

    // ── Drawing tools ────────────────────────────────────────────────────────
    startDrawing(toolName) {
        // Map klinecharts names to internal names
        const type = LW_DRAWING_MAP[toolName] || toolName;
        if (!LW_DRAWING_POINTS[type]) {
            console.warn('[LWTickChart] Unknown drawing tool:', toolName);
            return;
        }

        // Cancel any in-progress drawing
        this._cancelDrawing();

        this._drawingMode = type;
        this._drawingPoints = [];
        this._drawingPreview = null;

        // Set cursor on container (overlay stays pointer-events:none so chart still gets events)
        this.container.style.cursor = 'crosshair';
    }

    _cancelDrawing() {
        this._drawingMode = null;
        this._drawingPoints = [];
        this._drawingPreview = null;
        this.container.style.cursor = '';
    }

    _finalizeDrawing() {
        if (!this._drawingMode || this._drawingPoints.length === 0) return;

        const drawing = {
            id: ++this._drawingIdCounter,
            type: this._drawingMode,
            points: [...this._drawingPoints],
            color: this._getDrawingColor(this._drawingMode),
        };

        this._drawings.push(drawing);
        this._cancelDrawing();
    }

    _getDrawingColor(type) {
        switch (type) {
            case 'trendLine': return '#3B82F6';
            case 'horizontalLine': return '#8B5CF6';
            case 'verticalLine': return '#8B5CF6';
            case 'fibonacci': return '#F59E0B';
            case 'rectangle': return 'rgba(59,130,246,0.3)';
            case 'channel': return '#06B6D4';
            case 'arrow': return '#3B82F6';
            case 'text': return '#E2E8F0';
            default: return '#3B82F6';
        }
    }

    clearAllDrawings() {
        this._drawings = [];
        this._cancelDrawing();
    }

    // ── Render drawings ──────────────────────────────────────────────────────
    _renderDrawings() {
        if (!this._drawCtx || !this._chart || !this._series) return;
        const ctx = this._drawCtx;
        const w = this._drawCanvas.clientWidth;
        const h = this._drawCanvas.clientHeight;
        ctx.clearRect(0, 0, w, h);

        // Render completed drawings
        for (const d of this._drawings) {
            this._drawShape(ctx, d.type, d.points, d.color, false);
        }

        // Render in-progress drawing preview
        if (this._drawingMode && this._drawingPoints.length > 0 && this._crosshairPos) {
            const previewPoints = [...this._drawingPoints, {
                time: this._crosshairPos.time,
                price: this._crosshairPos.price,
            }];
            this._drawShape(ctx, this._drawingMode, previewPoints, this._getDrawingColor(this._drawingMode), true);
        }

        // Draw mode indicator
        if (this._drawingMode) {
            ctx.save();
            ctx.font = '10px "Plus Jakarta Sans", sans-serif';
            ctx.fillStyle = 'rgba(255,255,255,0.5)';
            const label = this._drawingMode.replace(/([A-Z])/g, ' $1').trim();
            ctx.fillText('✏ ' + label + ' — натисніть для точок, Esc для скасування', 12, 16);
            ctx.restore();
        }

        if (typeof this.onRedraw === 'function') this.onRedraw();
    }

    _toPixel(point) {
        if (!point || !this._chart || !this._series) return null;
        let x = null, y = null;

        if (point.time !== null && point.time !== undefined) {
            x = this._chart.timeScale().timeToCoordinate(point.time);
        }
        if (point.price !== null && point.price !== undefined) {
            y = this._series.priceToCoordinate(point.price);
        }

        if (x === null || y === null) return null;
        return { x, y };
    }

    _drawShape(ctx, type, points, color, isPreview) {
        ctx.save();
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = isPreview ? 1 : 1.5;
        ctx.setLineDash(isPreview ? [4, 4] : []);
        ctx.globalAlpha = isPreview ? 0.6 : 1;

        const pixels = points.map(p => this._toPixel(p)).filter(p => p !== null);

        switch (type) {
            case 'trendLine':
            case 'arrow': {
                if (pixels.length < 2) break;
                const [p1, p2] = pixels;
                ctx.beginPath();
                ctx.moveTo(p1.x, p1.y);
                ctx.lineTo(p2.x, p2.y);
                ctx.stroke();

                // Draw points
                for (const p of [p1, p2]) {
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
                    ctx.fill();
                }

                // Arrow head
                if (type === 'arrow' && !isPreview) {
                    const angle = Math.atan2(p2.y - p1.y, p2.x - p1.x);
                    const headLen = 10;
                    ctx.beginPath();
                    ctx.moveTo(p2.x, p2.y);
                    ctx.lineTo(p2.x - headLen * Math.cos(angle - 0.4), p2.y - headLen * Math.sin(angle - 0.4));
                    ctx.moveTo(p2.x, p2.y);
                    ctx.lineTo(p2.x - headLen * Math.cos(angle + 0.4), p2.y - headLen * Math.sin(angle + 0.4));
                    ctx.stroke();
                }

                // Price labels
                if (!isPreview) {
                    this._drawPriceLabel(ctx, points[0].price, p1, color);
                    this._drawPriceLabel(ctx, points[1].price, p2, color);
                }
                break;
            }

            case 'horizontalLine': {
                if (pixels.length < 1) break;
                const py = pixels[0].y;
                const w = this._drawCanvas.clientWidth;
                ctx.beginPath();
                ctx.moveTo(0, py);
                ctx.lineTo(w, py);
                ctx.stroke();

                // Label
                if (!isPreview && points[0]) {
                    ctx.font = '10px "Plus Jakarta Sans", sans-serif';
                    ctx.fillStyle = color;
                    const priceStr = points[0].price.toFixed(this._getPriceDecimals());
                    ctx.fillText(priceStr, 8, py - 4);
                }
                break;
            }

            case 'verticalLine': {
                if (pixels.length < 1) break;
                const px = pixels[0].x;
                const h = this._drawCanvas.clientHeight;
                ctx.beginPath();
                ctx.moveTo(px, 0);
                ctx.lineTo(px, h);
                ctx.stroke();
                break;
            }

            case 'rectangle': {
                if (pixels.length < 2) break;
                const [r1, r2] = pixels;
                const rx = Math.min(r1.x, r2.x);
                const ry = Math.min(r1.y, r2.y);
                const rw = Math.abs(r2.x - r1.x);
                const rh = Math.abs(r2.y - r1.y);

                ctx.globalAlpha = isPreview ? 0.15 : 0.12;
                ctx.fillRect(rx, ry, rw, rh);
                ctx.globalAlpha = isPreview ? 0.6 : 0.8;
                ctx.strokeRect(rx, ry, rw, rh);
                break;
            }

            case 'channel': {
                if (pixels.length < 2) break;
                const [c1, c2] = pixels;
                // Draw baseline
                ctx.beginPath();
                ctx.moveTo(c1.x, c1.y);
                ctx.lineTo(c2.x, c2.y);
                ctx.stroke();

                // If 3rd point, draw parallel channel line
                if (pixels.length >= 3) {
                    const c3 = pixels[2];
                    const dy = c3.y - c1.y;
                    ctx.beginPath();
                    ctx.moveTo(c1.x, c1.y + dy);
                    ctx.lineTo(c2.x, c2.y + dy);
                    ctx.stroke();

                    // Fill between
                    ctx.globalAlpha = 0.08;
                    ctx.beginPath();
                    ctx.moveTo(c1.x, c1.y);
                    ctx.lineTo(c2.x, c2.y);
                    ctx.lineTo(c2.x, c2.y + dy);
                    ctx.lineTo(c1.x, c1.y + dy);
                    ctx.closePath();
                    ctx.fill();
                }
                break;
            }

            case 'text': {
                if (pixels.length < 1 || !points[0]) break;
                const text = points[0].text || 'Text';
                ctx.font = '12px "Plus Jakarta Sans", sans-serif';
                ctx.fillStyle = color;
                ctx.fillText(text, pixels[0].x, pixels[0].y);
                break;
            }

            case 'fibonacci': {
                if (points.length < 2 || !this._series) break;
                const fibLevels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
                const fibColors = ['#EF4444', '#F59E0B', '#EAB308', '#10B981', '#06B6D4', '#3B82F6', '#EF4444'];
                const w = this._drawCanvas.clientWidth;
                const priceDiff = points[1].price - points[0].price;

                for (let fi = 0; fi < fibLevels.length; fi++) {
                    const level = fibLevels[fi];
                    const price = points[0].price + priceDiff * level;
                    const y = this._series.priceToCoordinate(price);
                    if (y === null) continue;

                    ctx.beginPath();
                    ctx.strokeStyle = fibColors[fi] || color;
                    ctx.globalAlpha = level === 0 || level === 1 ? 0.8 : 0.5;
                    ctx.setLineDash(level === 0.5 ? [] : [3, 3]);
                    ctx.lineWidth = level === 0.5 ? 1.5 : 1;
                    ctx.moveTo(0, y);
                    ctx.lineTo(w, y);
                    ctx.stroke();

                    // Label
                    ctx.font = '10px "Plus Jakarta Sans", sans-serif';
                    ctx.fillStyle = fibColors[fi] || color;
                    ctx.globalAlpha = 0.8;
                    const dec = this._getPriceDecimals();
                    ctx.fillText(`${(level * 100).toFixed(1)}% — ${price.toFixed(dec)}`, 8, y - 4);
                }
                break;
            }
        }

        ctx.restore();
    }

    _drawPriceLabel(ctx, price, pixel, color) {
        if (!price || !pixel) return;
        const text = price.toFixed(this._getPriceDecimals());
        ctx.save();
        ctx.font = '9px "Plus Jakarta Sans", sans-serif';
        const tw = ctx.measureText(text).width;
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(pixel.x + 5, pixel.y - 12, tw + 6, 14);
        ctx.fillStyle = color;
        ctx.fillText(text, pixel.x + 8, pixel.y - 2);
        ctx.restore();
    }

    _getPriceDecimals() {
        if (this.ticks.length === 0) return 2;
        const price = this.ticks[this.ticks.length - 1].price;
        if (price >= 1000) return 2;
        if (price >= 1) return 4;
        if (price >= 0.01) return 6;
        return 8;
    }

    // ── Lazy history loading ────────────────────────────────────────────────
    async _loadOlderHistory() {
        if (this._historyLoading || this._historyExhausted || !this._symbol) return;
        if (!this._oldestTradeTime) return;

        this._historyLoading = true;
        try {
            const endTime = this._oldestTradeTime - 1;
            const startTime = endTime - 5 * 60 * 1000; // fetch 5 min chunk
            const url = `https://fapi.binance.com/fapi/v1/aggTrades?symbol=${this._symbol}&startTime=${startTime}&endTime=${endTime}&limit=${LW_HISTORY_FETCH_LIMIT}`;
            const resp = await fetch(url);
            if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
            const data = await resp.json();

            if (!Array.isArray(data) || data.length === 0) {
                this._historyExhausted = true;
                return;
            }

            // Parse new older trades
            const olderTicks = data.map(d => ({
                price: parseFloat(d.p),
                time: d.T,
                qty: parseFloat(d.q)
            }));

            // Prepend to ticks array
            this.ticks.unshift(...olderTicks);
            this._oldestTradeTime = olderTicks[0].time;

            // Rebuild _lwData from scratch (needed for time uniqueness)
            this._lastLwTime = 0;
            this._lwData = [];
            for (const t of this.ticks) {
                this._lwData.push({ time: this._msToUnique(t.time), value: t.price });
            }
            this._fullData = this._lwData.slice();

            // Save current visible range to restore after setData
            const savedRange = this._chart.timeScale().getVisibleLogicalRange();
            const addedCount = olderTicks.length;

            if (this._series) {
                if (this._isDownsampled) {
                    // Re-apply downsample with new data
                    const visibleCount = savedRange ? Math.floor(savedRange.to - savedRange.from) : LW_DOWNSAMPLE_THRESHOLD + 1;
                    this._applyDownsample(visibleCount);
                } else {
                    this._series.setData(this._lwData);
                }
            }

            // Restore scroll position (shifted by newly added points)
            if (savedRange && this._chart) {
                this._chart.timeScale().setVisibleLogicalRange({
                    from: savedRange.from + addedCount,
                    to: savedRange.to + addedCount,
                });
            }

            this._updateMarkers();

            // Trim right side if over limit
            if (this.ticks.length > this.maxTicks) {
                const excess = this.ticks.length - this.maxTicks;
                this.ticks.splice(this.ticks.length - excess, excess);
                this._lwData.splice(this._lwData.length - excess, excess);
                this._fullData.splice(this._fullData.length - excess, excess);
            }
        } catch (e) {
            console.warn('[LWTickChart] Failed to load older history:', e.message);
        } finally {
            this._historyLoading = false;
        }
    }

    // ── Downsampling for zoom-out ───────────────────────────────────────────
    _applyDownsample(visibleCount) {
        if (!this._series || this._fullData.length === 0) return;
        // Calculate step: keep ~1000 points on screen
        const step = Math.max(2, Math.floor(visibleCount / 1000));
        const sampled = [];

        // LTTB-like: for each bucket, pick the point with the largest triangle area
        for (let i = 0; i < this._fullData.length; i += step) {
            const bucketEnd = Math.min(i + step, this._fullData.length);
            if (bucketEnd - i === 1) {
                sampled.push(this._fullData[i]);
                continue;
            }
            // Pick min and max in bucket to preserve peaks/valleys
            let minP = this._fullData[i], maxP = this._fullData[i];
            for (let j = i + 1; j < bucketEnd; j++) {
                if (this._fullData[j].value < minP.value) minP = this._fullData[j];
                if (this._fullData[j].value > maxP.value) maxP = this._fullData[j];
            }
            // Add in time order
            if (minP.time <= maxP.time) {
                sampled.push(minP);
                if (minP !== maxP) sampled.push(maxP);
            } else {
                sampled.push(maxP);
                if (minP !== maxP) sampled.push(minP);
            }
        }

        this._series.setData(sampled);
        this._isDownsampled = true;
    }

    _removeDownsample() {
        if (!this._series || !this._isDownsampled) return;
        this._series.setData(this._fullData);
        this._lwData = this._fullData.slice();
        this._isDownsampled = false;
    }

    // ── Snap-back hint ────────────────────────────────────────────────────────
    _showSnapbackHint() {
        // Pulse the Live button
        var btn = document.getElementById('tickAutoScrollBtn');
        if (btn) {
            btn.style.transition = 'none';
            btn.style.boxShadow = '0 0 0 0 rgba(16,185,129,0.7)';
            requestAnimationFrame(function() {
                btn.style.transition = 'box-shadow 0.6s ease-out';
                btn.style.boxShadow = '0 0 12px 4px rgba(16,185,129,0.5)';
                setTimeout(function() { btn.style.boxShadow = ''; btn.style.transition = ''; }, 2000);
            });
        }

        // Show toast hint
        var existing = document.getElementById('_tickScrollHint');
        if (existing) existing.remove();

        var hint = document.createElement('div');
        hint.id = '_tickScrollHint';
        hint.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);z-index:10000;' +
            'background:rgba(20,20,20,0.95);border:1px solid rgba(16,185,129,0.3);border-radius:12px;' +
            'padding:10px 16px;display:flex;align-items:center;gap:10px;backdrop-filter:blur(12px);' +
            'box-shadow:0 8px 32px rgba(0,0,0,0.5);animation:_hintIn 0.3s ease-out;max-width:90vw;';
        hint.innerHTML =
            '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2">' +
                '<circle cx="12" cy="12" r="3" fill="#10B981"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>' +
            '</svg>' +
            '<span style="font-size:12px;color:#e0e0e0;line-height:1.4;">' +
                'Натисніть <b style="color:#10B981;cursor:pointer;" onclick="toggleTickAutoScroll()">Live</b>' +
                ' щоб вимкнути магніт і вільно рухати графік' +
            '</span>' +
            '<button onclick="this.parentElement.remove()" style="background:none;border:none;color:#636363;cursor:pointer;font-size:16px;padding:0 0 0 4px;line-height:1;">&times;</button>';

        // Add animation keyframes if not exists
        if (!document.getElementById('_hintAnimStyle')) {
            var style = document.createElement('style');
            style.id = '_hintAnimStyle';
            style.textContent = '@keyframes _hintIn{from{opacity:0;transform:translateX(-50%) translateY(10px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}';
            document.head.appendChild(style);
        }

        document.body.appendChild(hint);
        setTimeout(function() {
            if (hint.parentNode) {
                hint.style.transition = 'opacity 0.4s';
                hint.style.opacity = '0';
                setTimeout(function() { if (hint.parentNode) hint.remove(); }, 400);
            }
        }, 5000);
    }

    // ── Cleanup ──────────────────────────────────────────────────────────────
    destroy() {
        this.disconnectWs();

        if (this._drawRAF) cancelAnimationFrame(this._drawRAF);
        if (this._resizeObserver) this._resizeObserver.disconnect();

        this.container.removeEventListener('click', this._onDrawClick);
        this.container.removeEventListener('dblclick', this._onDrawDblClick);
        document.removeEventListener('keydown', this._onKeyDown);

        if (this._drawCanvas && this._drawCanvas.parentNode) {
            this._drawCanvas.parentNode.removeChild(this._drawCanvas);
        }

        if (this._chart) {
            try { this._chart.remove(); } catch (e) {}
            this._chart = null;
        }

        this._series = null;
        this._lwData = [];
        this.ticks = [];
        this._priceLines = [];
        this._drawings = [];
    }
}

// Expose globally
window.LWTickChart = LWTickChart;
