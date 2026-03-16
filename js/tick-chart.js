'use strict';
/**
 * TickChart — lightweight canvas-based tick/line chart for sub-5s timeframes.
 * Renders trade-by-trade price as a continuous line with trade markers.
 *
 * Usage:
 *   const tc = new TickChart(containerEl, { maxTicks: 2000 });
 *   tc.start(symbol);
 *   tc.setMarkers(markers);  // [{time (sec), price, side, isEntry, pnl, count}]
 *   tc.destroy();
 */

// roundRect polyfill for older browsers
if (typeof CanvasRenderingContext2D !== 'undefined' && !CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function(x, y, w, h, radii) {
        let r = typeof radii === 'number' ? radii : (Array.isArray(radii) ? radii[0] : 0);
        if (r < 0) r = 0;
        if (r > w / 2) r = w / 2;
        if (r > h / 2) r = h / 2;
        this.beginPath();
        this.moveTo(x + r, y);
        this.lineTo(x + w - r, y);
        this.arcTo(x + w, y, x + w, y + r, r);
        this.lineTo(x + w, y + h - r);
        this.arcTo(x + w, y + h, x + w - r, y + h, r);
        this.lineTo(x + r, y + h);
        this.arcTo(x, y + h, x, y + h - r, r);
        this.lineTo(x, y + r);
        this.arcTo(x, y, x + r, y, r);
        this.closePath();
        return this;
    };
}

// Layout constants
const TC_PADDING_RIGHT  = 70;
const TC_PADDING_TOP    = 12;
const TC_PADDING_BOTTOM = 28;
const TC_MAX_TICKS      = 2000;
const TC_MIN_VISIBLE    = 10;
const TC_FUTURE_SCROLL_RATIO = 0.5;
const TC_GRID_STEPS     = 5;
const TC_WS_MAX_RETRIES = 10;
const TC_WS_BASE_DELAY  = 2000;

class TickChart {
    constructor(container, opts = {}) {
        this.container = container;
        this.maxTicks  = opts.maxTicks || TC_MAX_TICKS;
        this.ticks     = [];       // [{price, time, qty}]
        this.markers   = [];       // [{time (ms), price, side, isEntry, pnl, count, symbol}]
        this._ws       = null;
        this._wsGen    = 0;
        this._raf      = null;
        this._dirty    = true;
        this._mouse    = null;     // {x, y} or null
        this._scrollOffset = 0;    // pan offset in ticks (0 = latest at right edge)
        this._barSpacing   = 0;    // px per tick (0 = auto-init on first draw)
        this._isDragging   = false;
        this._dragStartX   = 0;
        this._dragStartOffset = 0;
        this._hoveredMarker = null; // marker under cursor
        this.magnet = false;       // snap crosshair to nearest tick (off by default)
        this._userScrolled = false; // true when user has scrolled away from live edge

        // Manual Y-axis control
        this._yAutoScale = true;
        this._manualMinP = 0;
        this._manualMaxP = 0;
        this._yDragging = false;
        this._yDragStartY = 0;
        this._yDragStartMinP = 0;
        this._yDragStartMaxP = 0;

        // Touch state
        this._touchId      = null;
        this._touchStartX  = 0;
        this._touchStartOffset = 0;
        this._pinchDist    = 0;
        this._pinchBarSpacing = 0;

        // Infinite scroll (load older history)
        this._symbol       = '';      // current symbol for history fetches
        this._loadingMore  = false;   // prevents concurrent fetches
        this._noMoreHistory = false;  // true when Binance returns 0 results
        this._maxHistoryTicks = 50000; // max total ticks to keep in memory

        // Colors from CSS vars
        const cs = getComputedStyle(document.documentElement);
        this.colors = {
            bg:         cs.getPropertyValue('--bg-app').trim()        || '#0D0D0D',
            surface:    cs.getPropertyValue('--surface').trim()       || '#1A1A1A',
            gridLine:   'rgba(255,255,255,0.04)',
            textDim:    cs.getPropertyValue('--text-tertiary').trim() || '#636363',
            textSec:    cs.getPropertyValue('--text-secondary').trim()|| '#A1A1A1',
            up:         cs.getPropertyValue('--color-up').trim()      || '#10B981',
            down:       cs.getPropertyValue('--color-down').trim()    || '#EF4444',
            accent:     cs.getPropertyValue('--accent-primary').trim()|| '#10B981',
            crosshair:  'rgba(255,255,255,0.2)',
            markerLong:  '#22D3EE',
            markerShort: '#F59E0B',
            markerMixed: '#8B5CF6',
        };

        this.levels = [];  // [{price, label, color, dash}]

        // Create canvas
        this.canvas = document.createElement('canvas');
        this.canvas.style.cssText = 'width:100%;height:100%;display:block;cursor:crosshair;touch-action:none;';
        this.container.innerHTML = '';
        this.container.appendChild(this.canvas);
        this.ctx = this.canvas.getContext('2d');

        // Resize
        this._ro = new ResizeObserver(() => this._resize());
        this._ro.observe(this.container);
        this._resize();

        // Mouse events
        this._onMouseMove = this._onMouseMove.bind(this);
        this._onMouseLeave = this._onMouseLeave.bind(this);
        this._onWheel = this._onWheel.bind(this);
        this._onMouseDown = this._onMouseDown.bind(this);
        this._onMouseUp = this._onMouseUp.bind(this);
        this.canvas.addEventListener('mousemove', this._onMouseMove);
        this.canvas.addEventListener('mouseleave', this._onMouseLeave);
        this.canvas.addEventListener('wheel', this._onWheel, { passive: false });
        this.canvas.addEventListener('mousedown', this._onMouseDown);
        window.addEventListener('mouseup', this._onMouseUp);
        this._onDblClick = this._onDblClick.bind(this);
        this.canvas.addEventListener('dblclick', this._onDblClick);

        // Touch events
        this._onTouchStart = this._onTouchStart.bind(this);
        this._onTouchMove  = this._onTouchMove.bind(this);
        this._onTouchEnd   = this._onTouchEnd.bind(this);
        this.canvas.addEventListener('touchstart', this._onTouchStart, { passive: false });
        this.canvas.addEventListener('touchmove',  this._onTouchMove,  { passive: false });
        this.canvas.addEventListener('touchend',    this._onTouchEnd);
        this.canvas.addEventListener('touchcancel', this._onTouchEnd);

        // Render loop
        this._loop();
    }

    // ── Public API ──────────────────────────────────────────────

    loadHistory(trades) {
        this.ticks = trades.slice(-this._maxHistoryTicks).map(t => ({
            price: +t.price || +t.p || 0,
            time:  +t.time  || +t.T || +t.E || Date.now(),
            qty:   +t.qty   || +t.q || 0
        }));
        this._scrollOffset = 0;
        this._barSpacing = 0; // auto-init on next draw
        this._noMoreHistory = false;
        this._loadingMore = false;
        this._userScrolled = false;
        this._yAutoScale = true;
        this._dirty = true;
    }

    addTick(t) {
        this.ticks.push({
            price: +t.price || +t.p || 0,
            time:  +t.time  || +t.T || +t.E || Date.now(),
            qty:   +t.qty   || +t.q || 0
        });
        const limit = Math.max(this.maxTicks, this._maxHistoryTicks);
        if (this.ticks.length > limit) {
            const excess = this.ticks.length - limit;
            this.ticks.splice(0, excess);
            // Adjust scrollOffset so the view stays in the same place
            if (this._scrollOffset > 0) {
                this._scrollOffset = Math.max(0, this._scrollOffset - excess);
            }
        }
        // Auto-scroll to latest only if user hasn't intentionally scrolled away
        if (!this._userScrolled && this._scrollOffset < 3) this._scrollOffset = 0;
        this._dirty = true;
    }

    /** Set trade markers. Each marker: {time (seconds!), price, side, isEntry, pnl, count, symbol} */
    setMarkers(markers) {
        // Convert time from seconds to ms for internal use
        this.markers = (markers || []).map(m => ({
            time:    (m.time || 0) * 1000,
            price:   +m.price || 0,
            side:    m.side || '',
            isEntry: !!m.isEntry,
            pnl:     +m.pnl || 0,
            count:   m.count || 1,
            symbol:  m.symbol || '',
            _primary: !!m._primary,
        }));
        this._dirty = true;
    }

    /** Set price level lines. Each level: {price, label, color, dash, type} */
    setLevels(levels) {
        this.levels = (levels || []).map(l => ({
            price: +l.price || 0,
            label: l.label || '',
            color: l.color || '#C4B5FD',
            dash:  l.dash || [6, 4],
            type:  l.type || '',
        }));
        this._dirty = true;
    }

    /** Center the viewport on a specific time (ms) */
    centerOnTime(timeMs) {
        if (this.ticks.length < 2) return;
        // Find the tick index closest to timeMs
        let bestIdx = 0, bestDist = Infinity;
        for (let i = 0; i < this.ticks.length; i++) {
            const d = Math.abs(this.ticks[i].time - timeMs);
            if (d < bestDist) { bestDist = d; bestIdx = i; }
        }
        // Calculate scroll offset to center this index
        const W = this.W || 600;
        const chartW = W - TC_PADDING_RIGHT;
        if (this._barSpacing <= 0) {
            this._barSpacing = chartW / Math.min(this.ticks.length, 300);
        }
        const visibleCount = Math.max(TC_MIN_VISIBLE, Math.round(chartW / this._barSpacing));
        const halfVisible = Math.floor(visibleCount / 2);
        // scrollOffset = distance from end
        this._scrollOffset = Math.max(0, this.ticks.length - 1 - bestIdx - halfVisible);
        this._dirty = true;
    }

    /** Connect to Binance aggTrade WS for a symbol (futures) */
    connectWs(symbol) {
        this.disconnectWs();
        const gen = ++this._wsGen;
        const stream = symbol.toLowerCase() + '@aggTrade';
        const url = 'wss://fstream.binance.com/ws/' + stream;

        let retryCount = 0;
        const connect = () => {
            if (this._wsGen !== gen) return;
            if (retryCount >= TC_WS_MAX_RETRIES) {
                console.warn('[TickChart] WS max retries reached for', symbol);
                return;
            }
            const ws = new WebSocket(url);
            this._ws = ws;
            ws.onopen = () => { retryCount = 0; };
            ws.onmessage = (ev) => {
                try {
                    const msg = JSON.parse(ev.data);
                    if (msg.e === 'aggTrade') {
                        this.addTick({ price: msg.p, time: msg.T, qty: msg.q });
                    }
                } catch (e) {}
            };
            ws.onclose = (ev) => {
                if (this._wsGen === gen && ev.code !== 1000) {
                    const delay = Math.min(TC_WS_BASE_DELAY * Math.pow(2, retryCount), 30000);
                    retryCount++;
                    setTimeout(connect, delay);
                }
            };
            ws.onerror = () => {};
        };
        connect();
    }

    disconnectWs() {
        this._wsGen++;
        if (this._ws) {
            try { this._ws.close(1000); } catch (e) {}
            this._ws = null;
        }
    }

    /** Fetch recent trades from Binance REST + connect WS */
    async start(symbol) {
        this._symbol = symbol.toUpperCase();
        this._noMoreHistory = false;
        try {
            const url = `https://fapi.binance.com/fapi/v1/aggTrades?symbol=${this._symbol}&limit=1000`;
            const resp = await fetch(url);
            const data = await resp.json();
            if (Array.isArray(data)) {
                this.loadHistory(data.map(d => ({ price: d.p, time: d.T, qty: d.q })));
            }
        } catch (e) {
            console.warn('[TickChart] Failed to fetch history:', e.message);
        }
        this.connectWs(symbol);
    }

    /** Load older history when user scrolls to left edge */
    async _loadMoreHistory() {
        if (this._loadingMore || this._noMoreHistory || !this._symbol || this.ticks.length < 2) return;
        this._loadingMore = true;
        try {
            const oldestTime = this.ticks[0].time;
            const url = `https://fapi.binance.com/fapi/v1/aggTrades?symbol=${this._symbol}&endTime=${oldestTime - 1}&limit=1000`;
            const resp = await fetch(url);
            const data = await resp.json();
            if (!Array.isArray(data) || data.length === 0) {
                this._noMoreHistory = true;
                return;
            }
            const newTicks = data.map(d => ({
                price: +d.p || 0,
                time:  +d.T || 0,
                qty:   +d.q || 0
            }));
            // Prepend and trim from end if over limit
            const oldLen = this.ticks.length;
            this.ticks = [...newTicks, ...this.ticks];
            if (this.ticks.length > this._maxHistoryTicks) {
                this.ticks = this.ticks.slice(0, this._maxHistoryTicks);
            }
            // Adjust scroll offset so the view stays in the same place
            this._scrollOffset += (this.ticks.length - oldLen);
            this._dirty = true;
        } catch (e) {
            console.warn('[TickChart] Failed to load more history:', e.message);
        } finally {
            this._loadingMore = false;
        }
    }

    getLastPrice() {
        return this.ticks.length > 0 ? this.ticks[this.ticks.length - 1].price : 0;
    }

    destroy() {
        this.disconnectWs();
        if (this._raf) cancelAnimationFrame(this._raf);
        this._ro.disconnect();
        this.canvas.removeEventListener('mousemove', this._onMouseMove);
        this.canvas.removeEventListener('mouseleave', this._onMouseLeave);
        this.canvas.removeEventListener('wheel', this._onWheel);
        this.canvas.removeEventListener('mousedown', this._onMouseDown);
        window.removeEventListener('mouseup', this._onMouseUp);
        this.canvas.removeEventListener('dblclick', this._onDblClick);
        this.canvas.removeEventListener('touchstart', this._onTouchStart);
        this.canvas.removeEventListener('touchmove', this._onTouchMove);
        this.canvas.removeEventListener('touchend', this._onTouchEnd);
        this.canvas.removeEventListener('touchcancel', this._onTouchEnd);
        this.container.innerHTML = '';
    }

    // ── Internals ───────────────────────────────────────────────

    _resize() {
        const r  = this.container.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        this.canvas.width  = r.width * dpr;
        this.canvas.height = r.height * dpr;
        this.W = r.width;
        this.H = r.height;
        this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        this._dirty = true;
    }

    // ── Mouse ──

    _onMouseMove(e) {
        const r = this.canvas.getBoundingClientRect();
        const mx = e.clientX - r.left, my = e.clientY - r.top;
        // Only mark dirty if mouse actually moved (avoids redundant redraws)
        if (!this._mouse || Math.abs(this._mouse.x - mx) > 0.5 || Math.abs(this._mouse.y - my) > 0.5) {
            this._mouse = { x: mx, y: my };
            this._dirty = true;
        }
        const chartW = (this.W || 600) - TC_PADDING_RIGHT;
        // Y-axis drag — shift price range
        if (this._yDragging) {
            const chartH = (this.H || 400) - TC_PADDING_TOP - TC_PADDING_BOTTOM;
            const dy = e.clientY - this._yDragStartY;
            const range = this._yDragStartMaxP - this._yDragStartMinP;
            const priceShift = (dy / chartH) * range;
            this._manualMinP = this._yDragStartMinP + priceShift;
            this._manualMaxP = this._yDragStartMaxP + priceShift;
            this._dirty = true;
            return;
        }
        // Cursor: ns-resize when hovering Y-axis zone
        if (!this._isDragging) {
            this.canvas.style.cursor = mx > chartW ? 'ns-resize' : 'crosshair';
        }
        if (this._isDragging) {
            const dx = e.clientX - this._dragStartX;
            const spacing = this._barSpacing || this._pxPerTick || 2;
            const visibleCount = Math.max(TC_MIN_VISIBLE, Math.round(chartW / spacing));
            const maxOffset = Math.max(0, this.ticks.length - visibleCount);
            const futureLimit = Math.round(visibleCount * TC_FUTURE_SCROLL_RATIO);
            this._scrollOffset = Math.max(-futureLimit, Math.min(maxOffset, this._dragStartOffset - dx / spacing));
            // Track whether user scrolled away from live edge
            if (this._scrollOffset > 3) this._userScrolled = true;
            else if (this._scrollOffset <= 3) this._userScrolled = false;
            this.canvas.style.cursor = 'grabbing';
            this._dirty = true;
            // Load more history when near left edge
            if (this._scrollOffset >= maxOffset - visibleCount * 0.3) {
                this._loadMoreHistory();
            }
        }
    }

    _onMouseLeave() {
        this._mouse = null;
        this._hoveredMarker = null;
        this._dirty = true;
    }

    _onWheel(e) {
        e.preventDefault();
        const chartW = (this.W || 600) - TC_PADDING_RIGHT;

        // Init barSpacing if needed
        if (this._barSpacing <= 0) {
            this._barSpacing = chartW / Math.min(this.ticks.length || 200, 300);
        }

        const r = this.canvas.getBoundingClientRect();
        const mx = e.clientX - r.left;

        // Y-axis zone: cursor in the right padding (price label area)
        if (mx > chartW) {
            // Vertical scroll on Y-axis → zoom Y-axis
            const my = e.clientY - r.top;
            const chartH = (this.H || 400) - TC_PADDING_TOP - TC_PADDING_BOTTOM;
            const factor = e.deltaY > 0 ? 1.12 : 0.88;
            // If first manual Y interaction, capture current auto-scale range
            if (this._yAutoScale && this._drawState) {
                this._manualMinP = this._drawState.minP;
                this._manualMaxP = this._drawState.maxP;
            }
            this._yAutoScale = false;
            // Zoom anchored on cursor price position
            const cursorFrac = Math.max(0, Math.min(1, (my - TC_PADDING_TOP) / chartH));
            const cursorPrice = this._manualMaxP - cursorFrac * (this._manualMaxP - this._manualMinP);
            const range = this._manualMaxP - this._manualMinP;
            const newRange = range * factor;
            this._manualMinP = cursorPrice - (cursorPrice - this._manualMinP) / range * newRange;
            this._manualMaxP = cursorPrice + (this._manualMaxP - cursorPrice) / range * newRange;
            this._dirty = true;
            return;
        }

        const absX = Math.abs(e.deltaX);
        const absY = Math.abs(e.deltaY);

        // Horizontal scroll or Shift+scroll → PAN (like klinecharts drag)
        if (absX > absY || e.shiftKey) {
            const delta = e.shiftKey ? e.deltaY : e.deltaX;
            const spacing = this._barSpacing || 2;
            const panTicks = -delta / spacing; // negated: scroll-right gesture → show newer data
            const visibleCount = Math.max(TC_MIN_VISIBLE, Math.round(chartW / spacing));
            const maxOffset = Math.max(0, this.ticks.length - visibleCount);
            const futureLimit = Math.round(visibleCount * TC_FUTURE_SCROLL_RATIO);
            this._scrollOffset = Math.max(-futureLimit, Math.min(maxOffset, this._scrollOffset + panTicks));
            // Track whether user scrolled away from live edge
            if (this._scrollOffset > 3) this._userScrolled = true;
            else if (this._scrollOffset <= 3) this._userScrolled = false;
            this._dirty = true;
            // Load more history when near left edge
            if (this._scrollOffset >= maxOffset - visibleCount * 0.3) {
                this._loadMoreHistory();
            }
            return;
        }

        // Vertical scroll → ZOOM X (klinecharts formula: proportional to gesture intensity)
        let zoomDelta = -(e.deltaY / 100);
        if (e.deltaMode === 1) zoomDelta *= 32;  // DOM_DELTA_LINE
        if (e.deltaMode === 2) zoomDelta *= 120; // DOM_DELTA_PAGE
        const scale = Math.sign(zoomDelta) * Math.min(1, Math.abs(zoomDelta));
        const newSpacing = Math.max(
            Math.max(0.15, chartW / Math.max(this.ticks.length, 100)),
            Math.min(chartW / 2, this._barSpacing + scale * (this._barSpacing / 10))
        );

        const oldVisible = chartW / this._barSpacing;
        const newVisible = chartW / newSpacing;
        const f = Math.max(0, Math.min(1, mx / chartW));

        const visibleCount = Math.max(TC_MIN_VISIBLE, Math.round(chartW / newSpacing));
        const futureLimit = Math.round(visibleCount * TC_FUTURE_SCROLL_RATIO);
        this._scrollOffset = Math.max(-futureLimit, this._scrollOffset + (1 - f) * (oldVisible - newVisible));
        this._barSpacing = newSpacing;
        this._dirty = true;
    }

    _onMouseDown(e) {
        if (e.button !== 0) return; // left button only
        const r = this.canvas.getBoundingClientRect();
        const mx = e.clientX - r.left;
        const chartW = (this.W || 600) - TC_PADDING_RIGHT;

        // Y-axis drag (price label area)
        if (mx > chartW) {
            if (this._yAutoScale && this._drawState) {
                this._manualMinP = this._drawState.minP;
                this._manualMaxP = this._drawState.maxP;
            }
            this._yAutoScale = false;
            this._yDragging = true;
            this._yDragStartY = e.clientY;
            this._yDragStartMinP = this._manualMinP;
            this._yDragStartMaxP = this._manualMaxP;
            return;
        }

        this._isDragging = true;
        this._dragStartX = e.clientX;
        this._dragStartOffset = this._scrollOffset;
    }

    _onMouseUp() {
        if (this._yDragging) {
            this._yDragging = false;
        }
        if (this._isDragging) {
            this._isDragging = false;
            this.canvas.style.cursor = 'crosshair';
        }
    }

    _onDblClick() {
        // Reset zoom to default (show ~300 ticks), scroll to latest, auto-scale Y
        const chartW = (this.W || 600) - TC_PADDING_RIGHT;
        this._barSpacing = chartW / Math.min(this.ticks.length || 200, 300);
        this._scrollOffset = 0;
        this._userScrolled = false;
        this._yAutoScale = true;
        this._dirty = true;
    }

    // ── Touch ──

    _onTouchStart(e) {
        e.preventDefault();
        if (e.touches.length === 2) {
            // Pinch zoom
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            this._pinchDist = Math.sqrt(dx * dx + dy * dy);
            if (this._barSpacing <= 0) {
                const chartW = (this.W || 600) - TC_PADDING_RIGHT;
                this._barSpacing = chartW / Math.min(this.ticks.length || 200, 300);
            }
            this._pinchBarSpacing = this._barSpacing;
        } else if (e.touches.length === 1) {
            const t = e.touches[0];
            this._touchId = t.identifier;
            this._touchStartX = t.clientX;
            this._touchStartOffset = this._scrollOffset;
            const r = this.canvas.getBoundingClientRect();
            this._mouse = { x: t.clientX - r.left, y: t.clientY - r.top };
            this._dirty = true;
        }
    }

    _onTouchMove(e) {
        e.preventDefault();
        if (e.touches.length === 2) {
            const dx = e.touches[0].clientX - e.touches[1].clientX;
            const dy = e.touches[0].clientY - e.touches[1].clientY;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (this._pinchDist > 0 && this._pinchBarSpacing > 0) {
                const chartW = (this.W || 600) - TC_PADDING_RIGHT;
                const minSpacing = Math.max(0.15, chartW / Math.max(this.ticks.length, 100));
                const maxSpacing = chartW / 2;
                this._barSpacing = Math.max(minSpacing, Math.min(maxSpacing, this._pinchBarSpacing * (dist / this._pinchDist)));
                this._dirty = true;
            }
        } else if (e.touches.length === 1) {
            const t = e.touches[0];
            const dx = t.clientX - this._touchStartX;
            const spacing = this._barSpacing || this._pxPerTick || 2;
            const chartW = (this.W || 600) - TC_PADDING_RIGHT;
            const visibleCount = Math.max(TC_MIN_VISIBLE, Math.round(chartW / spacing));
            const maxOffset = Math.max(0, this.ticks.length - visibleCount);
            const futureLimit = Math.round(visibleCount * TC_FUTURE_SCROLL_RATIO);
            this._scrollOffset = Math.max(-futureLimit, Math.min(maxOffset, this._touchStartOffset - dx / spacing));
            // Track whether user scrolled away from live edge
            if (this._scrollOffset > 3) this._userScrolled = true;
            else if (this._scrollOffset <= 3) this._userScrolled = false;
            const r = this.canvas.getBoundingClientRect();
            this._mouse = { x: t.clientX - r.left, y: t.clientY - r.top };
            this._dirty = true;
            // Load more history when near left edge
            if (this._scrollOffset >= maxOffset - visibleCount * 0.3) {
                this._loadMoreHistory();
            }
        }
    }

    _onTouchEnd(e) {
        if (e.touches.length === 0) {
            this._touchId = null;
            this._pinchDist = 0;
            this._mouse = null;
            this._dirty = true;
        }
    }

    // ── Render loop ──

    _loop() {
        if (this._dirty) {
            this._draw();
            this._dirty = false;
            if (this.onRedraw) this.onRedraw();
        }
        this._raf = requestAnimationFrame(() => this._loop());
    }

    _draw() {
        const { ctx, W, H, ticks, colors } = this;
        if (!W || !H || ticks.length < 2) {
            ctx.fillStyle = colors.bg;
            ctx.fillRect(0, 0, W, H);
            ctx.fillStyle = colors.textDim;
            ctx.font = '13px -apple-system, sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(ticks.length === 0 ? 'Waiting for trades...' : 'Loading...', W / 2, H / 2);
            return;
        }

        const chartW = W - TC_PADDING_RIGHT;
        const chartH = H - TC_PADDING_TOP - TC_PADDING_BOTTOM;

        // Init barSpacing on first draw (show ~300 ticks by default, similar to klinecharts)
        if (this._barSpacing <= 0) {
            this._barSpacing = chartW / Math.min(ticks.length, 300);
        }

        // Determine visible range from barSpacing (px per tick)
        const visibleCount = Math.max(TC_MIN_VISIBLE, Math.round(chartW / this._barSpacing));
        const maxOffset = Math.max(0, ticks.length - visibleCount);
        if (this._scrollOffset > maxOffset) this._scrollOffset = maxOffset;

        // Handle negative offset (future scroll — empty space on right)
        const futureTicks = Math.max(0, -Math.round(this._scrollOffset));
        const clampedOffset = Math.max(0, this._scrollOffset);
        const endIdx = Math.max(0, ticks.length - 1 - Math.round(clampedOffset));
        const startIdx = Math.max(0, endIdx - (visibleCount - futureTicks));
        const visible = ticks.slice(startIdx, endIdx + 1);

        if (visible.length < 2) return;

        // Total slots including future empty space
        const totalSlots = visible.length + futureTicks;

        // Time range of visible ticks
        const visStartTime = visible[0].time;
        const visEndTime   = visible[visible.length - 1].time;

        // Price range
        let minP = Infinity, maxP = -Infinity;
        if (this._yAutoScale) {
            for (const t of visible) {
                if (t.price < minP) minP = t.price;
                if (t.price > maxP) maxP = t.price;
            }
            // Include only VISIBLE markers in price range (markers within visible time window)
            const timeMargin = (visEndTime - visStartTime) * 0.5;
            for (const m of this.markers) {
                if (m.time >= visStartTime - timeMargin && m.time <= visEndTime + timeMargin) {
                    if (m.price < minP) minP = m.price;
                    if (m.price > maxP) maxP = m.price;
                }
            }
            // Include levels only if they're within reasonable range of visible prices (±20% of spread)
            const visSpread = maxP - minP || maxP * 0.001 || 1;
            for (const lv of this.levels) {
                if (lv.price > 0 && lv.price >= minP - visSpread * 0.5 && lv.price <= maxP + visSpread * 0.5) {
                    if (lv.price < minP) minP = lv.price;
                    if (lv.price > maxP) maxP = lv.price;
                }
            }
            const spread = maxP - minP || maxP * 0.001 || 1;
            const pad = spread * 0.1;
            minP -= pad;
            maxP += pad;
        } else {
            // Manual Y-axis mode
            minP = this._manualMinP;
            maxP = this._manualMaxP;
        }

        const pxPerTick = chartW / Math.max(1, totalSlots - 1);
        this._pxPerTick = pxPerTick;

        // Store draw state for external coordinate conversion (ruler tool)
        this._drawState = { minP, maxP, chartW, chartH, startIdx, visibleLen: visible.length, pxPerTick, futureTicks };

        const priceToY = (p) => TC_PADDING_TOP + chartH - ((p - minP) / (maxP - minP)) * chartH;
        const idxToX   = (i) => i * pxPerTick;
        const timeToX  = (ms) => {
            // Binary search for nearest tick index by time
            let lo = 0, hi = visible.length - 1;
            while (lo < hi) {
                const mid = (lo + hi) >> 1;
                if (visible[mid].time < ms) lo = mid + 1; else hi = mid;
            }
            // Interpolate between lo-1 and lo
            if (lo > 0 && lo < visible.length) {
                const t0 = visible[lo - 1].time, t1 = visible[lo].time;
                if (t1 !== t0) {
                    const frac = (ms - t0) / (t1 - t0);
                    return idxToX(lo - 1 + frac);
                }
            }
            return idxToX(lo);
        };

        // Background
        ctx.fillStyle = colors.bg;
        ctx.fillRect(0, 0, W, H);

        // Grid lines (horizontal) — "nice numbers" for readable price labels
        ctx.strokeStyle = colors.gridLine;
        ctx.lineWidth = 1;
        ctx.font = '10px -apple-system, monospace';
        ctx.fillStyle = colors.textDim;
        ctx.textAlign = 'right';
        {
            const range = maxP - minP || 1;
            // Calculate nice step size
            const rawStep = range / TC_GRID_STEPS;
            const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
            const norm = rawStep / mag;
            let niceStep;
            if (norm <= 1) niceStep = 1 * mag;
            else if (norm <= 2) niceStep = 2 * mag;
            else if (norm <= 5) niceStep = 5 * mag;
            else niceStep = 10 * mag;
            // Draw grid from rounded start to end
            const gridStart = Math.ceil(minP / niceStep) * niceStep;
            for (let price = gridStart; price <= maxP; price += niceStep) {
                const y = priceToY(price);
                if (y < TC_PADDING_TOP - 5 || y > H - TC_PADDING_BOTTOM + 5) continue;
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(chartW, y);
                ctx.stroke();
                ctx.fillText(this._fmtPrice(price), W - 4, y + 3);
            }
        }

        // "MANUAL" label on Y-axis when not auto-scaling
        if (!this._yAutoScale) {
            ctx.save();
            ctx.font = '8px -apple-system, sans-serif';
            ctx.fillStyle = colors.markerLong;
            ctx.textAlign = 'center';
            ctx.fillText('MANUAL', chartW + TC_PADDING_RIGHT / 2, TC_PADDING_TOP - 2);
            ctx.restore();
        }

        // Time labels (bottom) — adaptive format based on visible time range
        ctx.textAlign = 'center';
        ctx.fillStyle = colors.textDim;
        const visTimeRange = visEndTime - visStartTime;
        const timeSteps = Math.min(6, visible.length - 1);
        for (let i = 0; i <= timeSteps; i++) {
            const idx = Math.floor((visible.length - 1) * i / timeSteps);
            const t = visible[idx];
            const x = idxToX(idx);
            const d = new Date(t.time);
            let lbl;
            if (visTimeRange > 86400000) {
                // > 1 day: show date + hours
                lbl = (d.getMonth() + 1) + '/' + d.getDate() + ' ' +
                      d.getHours().toString().padStart(2, '0') + ':' +
                      d.getMinutes().toString().padStart(2, '0');
            } else if (visTimeRange > 3600000) {
                // > 1 hour: show HH:MM
                lbl = d.getHours().toString().padStart(2, '0') + ':' +
                      d.getMinutes().toString().padStart(2, '0');
            } else {
                // < 1 hour: show HH:MM:SS
                lbl = d.getHours().toString().padStart(2, '0') + ':' +
                      d.getMinutes().toString().padStart(2, '0') + ':' +
                      d.getSeconds().toString().padStart(2, '0');
            }
            ctx.fillText(lbl, x, H - 6);
        }

        // ── Level lines (limit, stop, avg) ──
        // Sort by price for overlap prevention
        const sortedLevels = [...this.levels].filter(lv => lv.price > 0).sort((a, b) => a.price - b.price);
        let lastLabelY = -100; // track last label Y to prevent overlap
        for (const lv of sortedLevels) {
            const ly = priceToY(lv.price);
            if (ly < TC_PADDING_TOP - 10 || ly > H - TC_PADDING_BOTTOM + 10) continue;
            const isEntry = lv.type === 'entry';
            const lineW = isEntry ? 1.5 : 1;
            const lineAlpha = isEntry ? '88' : '55';

            ctx.save();
            ctx.setLineDash(lv.dash || [6, 4]);
            ctx.strokeStyle = lv.color + lineAlpha;
            ctx.lineWidth = lineW;
            ctx.beginPath();
            ctx.moveTo(0, Math.round(ly) + 0.5);
            ctx.lineTo(chartW, Math.round(ly) + 0.5);
            ctx.stroke();
            ctx.setLineDash([]);

            // Left label with price included
            const priceStr = this._fmtPrice(lv.price);
            const fullLabel = lv.label + '  ' + priceStr;
            ctx.font = isEntry ? 'bold 10px -apple-system, monospace' : '10px -apple-system, monospace';
            const tw = ctx.measureText(fullLabel).width + 12;
            const lh = 18;
            // Offset label if too close to previous
            let labelY = ly;
            if (Math.abs(labelY - lastLabelY) < lh + 2) {
                labelY = lastLabelY + lh + 2;
            }
            lastLabelY = labelY;
            // Background pill
            ctx.fillStyle = lv.color + '18';
            ctx.beginPath();
            ctx.roundRect(4, labelY - lh / 2, tw, lh, 4);
            ctx.fill();
            ctx.strokeStyle = lv.color + '44';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.roundRect(4, labelY - lh / 2, tw, lh, 4);
            ctx.stroke();
            // Text
            ctx.fillStyle = lv.color;
            ctx.textAlign = 'left';
            ctx.fillText(fullLabel, 10, labelY + 3.5);
            // Connector line from label to actual price level (if offset)
            if (Math.abs(labelY - ly) > 2) {
                ctx.strokeStyle = lv.color + '33';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(4, ly);
                ctx.lineTo(4, labelY);
                ctx.stroke();
            }

            // Right side price tag (prominent)
            const rpLabel = priceStr;
            ctx.font = 'bold 10px -apple-system, monospace';
            const rpw = ctx.measureText(rpLabel).width + 10;
            ctx.fillStyle = lv.color + (isEntry ? '44' : '28');
            ctx.beginPath();
            ctx.roundRect(chartW + 2, ly - lh / 2, rpw, lh, 3);
            ctx.fill();
            ctx.fillStyle = lv.color;
            ctx.textAlign = 'left';
            ctx.fillText(rpLabel, chartW + 7, ly + 3.5);
            ctx.restore();
        }

        // Price line — single color, no blinking
        const lastPrice  = visible[visible.length - 1].price;
        const lineColor  = colors.accent;
        const strokeColor = 'rgba(255,255,255,0.9)';

        // Subsample step — skip ticks when density is very high (performance)
        // Use pixel-based sampling: collapse ticks that map to the same pixel column
        const step = pxPerTick < 0.5 ? Math.ceil(0.8 / pxPerTick) : 1;

        // Stroke line (white, no gradient fill)
        ctx.beginPath();
        ctx.moveTo(idxToX(0), priceToY(visible[0].price));
        if (step > 1) {
            // Stable subsampling: for each pixel-bucket, use min/max to preserve shape
            for (let i = 1; i < visible.length - 1; i += step) {
                const end = Math.min(i + step, visible.length - 1);
                let minI = i, maxI = i;
                for (let j = i; j < end; j++) {
                    if (visible[j].price < visible[minI].price) minI = j;
                    if (visible[j].price > visible[maxI].price) maxI = j;
                }
                // Draw min then max (or max then min) in order of appearance
                if (minI < maxI) {
                    ctx.lineTo(idxToX(minI), priceToY(visible[minI].price));
                    ctx.lineTo(idxToX(maxI), priceToY(visible[maxI].price));
                } else {
                    ctx.lineTo(idxToX(maxI), priceToY(visible[maxI].price));
                    ctx.lineTo(idxToX(minI), priceToY(visible[minI].price));
                }
            }
        } else {
            for (let i = 1; i < visible.length; i++) {
                ctx.lineTo(idxToX(i), priceToY(visible[i].price));
            }
        }
        ctx.lineTo(idxToX(visible.length - 1), priceToY(visible[visible.length - 1].price));
        ctx.strokeStyle = strokeColor;
        ctx.lineWidth = 1.5;
        ctx.lineJoin = 'round';
        ctx.stroke();

        // Current price line + label
        const curPrice = lastPrice;
        const curY = priceToY(curPrice);
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = lineColor;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, curY);
        ctx.lineTo(chartW, curY);
        ctx.stroke();
        ctx.setLineDash([]);

        // Price label box
        const lblW = 64, lblH = 18;
        ctx.fillStyle = lineColor;
        ctx.beginPath();
        ctx.roundRect(chartW + 2, curY - lblH / 2, lblW, lblH, 3);
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 10px -apple-system, monospace';
        ctx.textAlign = 'center';
        ctx.fillText(this._fmtPrice(curPrice), chartW + 2 + lblW / 2, curY + 3.5);

        // Dot at latest point (solid, no glow)
        if (this._scrollOffset <= 2) {
            const lastX = idxToX(visible.length - 1);
            const lastY = priceToY(lastPrice);
            ctx.beginPath();
            ctx.arc(lastX, lastY, 3, 0, Math.PI * 2);
            ctx.fillStyle = strokeColor;
            ctx.fill();
        }

        // ── Trade markers ──
        this._hoveredMarker = null;
        // Show all markers — clamp time to visible range so they stay on-screen
        const visibleMarkers = this.markers.filter(m => {
            // Always show markers within the loaded tick time range + some margin
            const margin = (visEndTime - visStartTime) * 0.5;
            return m.time >= visStartTime - margin && m.time <= visEndTime + margin;
        });

        // Draw primary marker guidelines first (behind everything)
        // Only show guidelines for recent markers (within 3 minutes)
        const guidelineMaxAge = 3 * 60 * 1000; // 3 minutes in ms
        const nowMs = Date.now();
        for (const m of visibleMarkers) {
            if (!m._primary) continue;
            // Hide guidelines for markers older than 3 minutes
            if (nowMs - m.time > guidelineMaxAge) continue;
            const px = timeToX(m.time);
            const py = priceToY(m.price);
            if (px < 0 || px > chartW) continue;
            const isLong = m.side === 'LONG' || m.side === 'BUY';
            const pColor = isLong ? colors.markerLong : colors.markerShort;
            // Fade out: full opacity until 2min, then fade to 0 at 3min
            const age = nowMs - m.time;
            const fadeStart = 2 * 60 * 1000;
            const baseAlpha = age < fadeStart ? 0.5 : 0.5 * (1 - (age - fadeStart) / (guidelineMaxAge - fadeStart));

            // Vertical guide line
            ctx.save();
            ctx.strokeStyle = pColor;
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 3]);
            ctx.globalAlpha = Math.max(0, baseAlpha);
            ctx.beginPath();
            ctx.moveTo(px, TC_PADDING_TOP);
            ctx.lineTo(px, H - TC_PADDING_BOTTOM);
            ctx.stroke();

            // Horizontal price guide line
            ctx.beginPath();
            ctx.moveTo(0, py);
            ctx.lineTo(chartW, py);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.globalAlpha = 1;
            ctx.restore();

            // Price label on Y-axis
            const plblW = 64, plblH = 18;
            ctx.fillStyle = pColor;
            ctx.beginPath();
            ctx.roundRect(chartW + 2, py - plblH / 2, plblW, plblH, 3);
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 10px -apple-system, monospace';
            ctx.textAlign = 'center';
            ctx.fillText(this._fmtPrice(m.price), chartW + 2 + plblW / 2, py + 3.5);

            // Time label on X-axis
            const d = new Date(m.time);
            const tLbl = d.getHours().toString().padStart(2, '0') + ':' +
                         d.getMinutes().toString().padStart(2, '0') + ':' +
                         d.getSeconds().toString().padStart(2, '0');
            const tLblW = 52;
            ctx.fillStyle = pColor;
            ctx.beginPath();
            ctx.roundRect(px - tLblW / 2, H - TC_PADDING_BOTTOM + 2, tLblW, 16, 3);
            ctx.fill();
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 9px -apple-system, monospace';
            ctx.textAlign = 'center';
            ctx.fillText(tLbl, px, H - TC_PADDING_BOTTOM + 13);

            // Glow circle at the point
            ctx.beginPath();
            ctx.arc(px, py, 10, 0, Math.PI * 2);
            ctx.fillStyle = pColor + '20';
            ctx.fill();
            ctx.beginPath();
            ctx.arc(px, py, 6, 0, Math.PI * 2);
            ctx.fillStyle = pColor + '40';
            ctx.fill();
        }

        for (const m of visibleMarkers) {
            const mx = timeToX(m.time);
            const my = priceToY(m.price);
            if (mx < 0 || mx > chartW) continue;

            const isLong = m.side === 'LONG' || m.side === 'BUY';
            const isMixed = m.count > 1 && !m.isEntry;
            const mColor = isMixed ? colors.markerMixed : (isLong ? colors.markerLong : colors.markerShort);

            if (m.count > 1) {
                // Grouped: diamond
                const sz = 9;
                ctx.beginPath();
                ctx.moveTo(mx, my - sz);
                ctx.lineTo(mx + sz, my);
                ctx.lineTo(mx, my + sz);
                ctx.lineTo(mx - sz, my);
                ctx.closePath();
                ctx.fillStyle = mColor + '40';
                ctx.fill();
                ctx.strokeStyle = mColor;
                ctx.lineWidth = 2;
                ctx.stroke();
                // Count label
                ctx.fillStyle = '#fff';
                ctx.font = 'bold 10px -apple-system, monospace';
                ctx.textAlign = 'center';
                ctx.fillText(String(m.count), mx, my + 4);
            } else if (m.isEntry) {
                // Entry: triangle (bigger, filled)
                const sz = 8;
                const tipY = my;
                const baseY = isLong ? my + sz * 2 : my - sz * 2;
                ctx.beginPath();
                ctx.moveTo(mx, tipY);
                ctx.lineTo(mx - sz, baseY);
                ctx.lineTo(mx + sz, baseY);
                ctx.closePath();
                ctx.strokeStyle = 'rgba(0,0,0,0.6)';
                ctx.lineWidth = 3;
                ctx.stroke();
                ctx.fillStyle = mColor + '50';
                ctx.fill();
                ctx.strokeStyle = mColor;
                ctx.lineWidth = 2;
                ctx.stroke();
            } else {
                // Exit: circle (bigger)
                const r = 6;
                ctx.beginPath();
                ctx.arc(mx, my, r + 2, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(0,0,0,0.5)';
                ctx.fill();
                ctx.beginPath();
                ctx.arc(mx, my, r, 0, Math.PI * 2);
                ctx.fillStyle = m.pnl >= 0 ? colors.up + '40' : colors.down + '40';
                ctx.fill();
                ctx.strokeStyle = m.pnl >= 0 ? colors.up : colors.down;
                ctx.lineWidth = 2;
                ctx.stroke();
            }

            // Side label near marker (when zoomed in enough)
            if (pxPerTick > 3) {
                const sideLabel = isLong ? 'B' : 'S';
                ctx.font = 'bold 8px -apple-system, monospace';
                ctx.fillStyle = mColor;
                ctx.textAlign = 'center';
                ctx.fillText(sideLabel, mx, m.isEntry ? (isLong ? my - 14 : my + 18) : my - 12);
            }

            // Check if mouse is near this marker
            if (this._mouse) {
                const dx = this._mouse.x - mx;
                const dy = this._mouse.y - my;
                if (dx * dx + dy * dy < 400) { // ~20px radius — easier to hover
                    this._hoveredMarker = { ...m, _x: mx, _y: my, _isLong: isLong };
                }
            }
        }

        // ── Crosshair ──
        if (this._mouse && this._mouse.x < chartW && this._mouse.y > TC_PADDING_TOP && this._mouse.y < H - TC_PADDING_BOTTOM && !this._isDragging) {
            const mx = this._mouse.x;
            const my = this._mouse.y;

            // Crosshair lines
            ctx.strokeStyle = colors.crosshair;
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(mx, TC_PADDING_TOP);
            ctx.lineTo(mx, H - TC_PADDING_BOTTOM);
            ctx.stroke();
            ctx.beginPath();
            ctx.moveTo(0, my);
            ctx.lineTo(chartW, my);
            ctx.stroke();
            ctx.setLineDash([]);

            // Marker tooltip takes priority
            if (this._hoveredMarker) {
                const hm = this._hoveredMarker;
                const isLong = hm._isLong;
                const lines = [];
                lines.push((isLong ? 'LONG' : 'SHORT') + (hm.isEntry ? ' Entry' : ' Exit'));
                lines.push('Price: ' + this._fmtPrice(hm.price));
                if (!hm.isEntry) {
                    lines.push('PnL: ' + (hm.pnl >= 0 ? '+' : '') + hm.pnl.toFixed(2));
                }
                if (hm.count > 1) lines.push('Count: ' + hm.count);
                const d = new Date(hm.time);
                lines.push(d.getHours().toString().padStart(2, '0') + ':' +
                           d.getMinutes().toString().padStart(2, '0') + ':' +
                           d.getSeconds().toString().padStart(2, '0') + '.' +
                           d.getMilliseconds().toString().padStart(3, '0'));
                this._drawTooltip(ctx, hm._x, hm._y, lines, chartW, TC_PADDING_TOP);
            } else if (this.magnet) {
                // Magnet mode: snap to nearest tick
                const nearIdx = Math.round(mx / pxPerTick);
                if (nearIdx >= 0 && nearIdx < visible.length) {
                    const tick = visible[nearIdx];
                    const sx = idxToX(nearIdx);
                    const sy = priceToY(tick.price);
                    // Snap dot
                    ctx.beginPath();
                    ctx.arc(sx, sy, 4, 0, Math.PI * 2);
                    ctx.fillStyle = colors.accent;
                    ctx.fill();
                    ctx.strokeStyle = '#fff';
                    ctx.lineWidth = 1.5;
                    ctx.stroke();
                    // Tooltip
                    const d = new Date(tick.time);
                    const timeStr = d.getHours().toString().padStart(2, '0') + ':' +
                                    d.getMinutes().toString().padStart(2, '0') + ':' +
                                    d.getSeconds().toString().padStart(2, '0') + '.' +
                                    d.getMilliseconds().toString().padStart(3, '0');
                    const lines = [this._fmtPrice(tick.price), timeStr];
                    if (tick.qty) lines.push('Qty: ' + (+tick.qty).toFixed(4));
                    this._drawTooltip(ctx, sx, sy, lines, chartW, TC_PADDING_TOP);
                }
            } else {
                // Free crosshair: interpolate price/time at cursor position
                const hoverPrice = minP + ((H - TC_PADDING_BOTTOM - my) / chartH) * (maxP - minP);
                // Interpolate time from cursor X
                const tickIdx = mx / pxPerTick;
                const loIdx = Math.max(0, Math.min(visible.length - 1, Math.floor(tickIdx)));
                const hiIdx = Math.min(visible.length - 1, loIdx + 1);
                const frac = tickIdx - loIdx;
                const interpTime = visible[loIdx].time + (visible[hiIdx].time - visible[loIdx].time) * frac;
                const d = new Date(interpTime);
                const timeStr = d.getHours().toString().padStart(2, '0') + ':' +
                                d.getMinutes().toString().padStart(2, '0') + ':' +
                                d.getSeconds().toString().padStart(2, '0');
                // Time label on X-axis
                const tLblW = 52;
                ctx.fillStyle = 'rgba(255,255,255,0.08)';
                ctx.beginPath();
                ctx.roundRect(mx - tLblW / 2, H - TC_PADDING_BOTTOM + 2, tLblW, 16, 3);
                ctx.fill();
                ctx.fillStyle = colors.textSec;
                ctx.font = '9px -apple-system, monospace';
                ctx.textAlign = 'center';
                ctx.fillText(timeStr, mx, H - TC_PADDING_BOTTOM + 13);
            }

            // Price on Y-axis (always show)
            const hoverPrice = minP + ((H - TC_PADDING_BOTTOM - my) / chartH) * (maxP - minP);
            ctx.fillStyle = 'rgba(255,255,255,0.08)';
            ctx.beginPath();
            ctx.roundRect(chartW + 2, my - 9, 64, 18, 3);
            ctx.fill();
            ctx.fillStyle = colors.textSec;
            ctx.font = '10px -apple-system, monospace';
            ctx.textAlign = 'center';
            ctx.fillText(this._fmtPrice(hoverPrice), chartW + 34, my + 3);
        }
    }

    _drawTooltip(ctx, anchorX, anchorY, lines, chartW, paddingTop) {
        ctx.font = '11px -apple-system, monospace';
        const tw = Math.max(...lines.map(l => ctx.measureText(l).width)) + 16;
        const th = lines.length * 16 + 8;
        let tx = anchorX + 12;
        let ty = anchorY - th - 6;
        if (tx + tw > chartW) tx = anchorX - tw - 12;
        if (ty < paddingTop) ty = anchorY + 10;

        ctx.fillStyle = 'rgba(26,26,26,0.92)';
        ctx.beginPath();
        ctx.roundRect(tx, ty, tw, th, 6);
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.1)';
        ctx.lineWidth = 1;
        ctx.stroke();

        ctx.textAlign = 'left';
        for (let i = 0; i < lines.length; i++) {
            if (i === 0) {
                ctx.fillStyle = '#fff';
                ctx.font = 'bold 11px -apple-system, monospace';
            } else {
                ctx.fillStyle = this.colors.textSec;
                ctx.font = '10px -apple-system, monospace';
            }
            ctx.fillText(lines[i], tx + 8, ty + 16 + i * 16);
        }
    }

    _fmtPrice(p) {
        if (p >= 1000)   return p.toFixed(2);
        if (p >= 1)      return p.toFixed(4);
        if (p >= 0.01)   return p.toFixed(6);
        return p.toFixed(8);
    }

    /** Convert pixel {x, y} relative to canvas → { price, tickIndex, time, snappedX, snappedY }
     *  Snaps to the nearest tick's actual price and X position. */
    pixelToChart(px, py) {
        const s = this._drawState;
        if (!s || !s.visibleLen) return null;
        // Tick index from X
        const localIdx = px / s.pxPerTick;
        const absIdx = Math.round(s.startIdx + localIdx);
        const clampedIdx = Math.max(0, Math.min(this.ticks.length - 1, absIdx));
        const tick = this.ticks[clampedIdx];
        if (!tick) return null;
        // Snap to actual tick price and position
        const snappedX = (clampedIdx - s.startIdx) * s.pxPerTick;
        const snappedY = TC_PADDING_TOP + s.chartH - ((tick.price - s.minP) / (s.maxP - s.minP)) * s.chartH;
        return { price: tick.price, tickIndex: clampedIdx, time: tick.time, snappedX, snappedY };
    }

    /** Convert { tickIndex, price } → pixel { x, y } relative to canvas.
     *  tickIndex can be an absolute index OR if `time` is provided, finds by time.
     */
    chartToPixel(tickIndex, price, time) {
        const s = this._drawState;
        if (!s || !s.visibleLen) return null;
        // If time is provided, find the actual index by time (stable across splice)
        let idx = tickIndex;
        if (time && this.ticks.length > 0) {
            // Binary search for closest tick by time
            let lo = 0, hi = this.ticks.length - 1;
            while (lo < hi) {
                const mid = (lo + hi) >> 1;
                if (this.ticks[mid].time < time) lo = mid + 1; else hi = mid;
            }
            idx = lo;
            // Check neighbor for closer match
            if (lo > 0 && Math.abs(this.ticks[lo - 1].time - time) < Math.abs(this.ticks[lo].time - time)) {
                idx = lo - 1;
            }
        }
        const localIdx = idx - s.startIdx;
        const x = localIdx * s.pxPerTick;
        const y = TC_PADDING_TOP + s.chartH - ((price - s.minP) / (s.maxP - s.minP)) * s.chartH;
        return { x, y };
    }
}
