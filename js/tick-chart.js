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

// Layout constants
const TC_PADDING_RIGHT  = 70;
const TC_PADDING_TOP    = 12;
const TC_PADDING_BOTTOM = 28;
const TC_MAX_TICKS      = 2000;
const TC_MIN_VISIBLE    = 30;
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

        // Touch state
        this._touchId      = null;
        this._touchStartX  = 0;
        this._touchStartOffset = 0;
        this._pinchDist    = 0;
        this._pinchBarSpacing = 0;

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
        this.ticks = trades.slice(-this.maxTicks).map(t => ({
            price: +t.price || +t.p || 0,
            time:  +t.time  || +t.T || +t.E || Date.now(),
            qty:   +t.qty   || +t.q || 0
        }));
        this._scrollOffset = 0;
        this._barSpacing = 0; // auto-init on next draw
        this._dirty = true;
    }

    addTick(t) {
        this.ticks.push({
            price: +t.price || +t.p || 0,
            time:  +t.time  || +t.T || +t.E || Date.now(),
            qty:   +t.qty   || +t.q || 0
        });
        if (this.ticks.length > this.maxTicks) {
            this.ticks.splice(0, this.ticks.length - this.maxTicks);
        }
        // Auto-scroll to latest if user hasn't panned
        if (this._scrollOffset <= 2) this._scrollOffset = 0;
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

    /** Set price level lines. Each level: {price, label, color, dash} */
    setLevels(levels) {
        this.levels = (levels || []).map(l => ({
            price: +l.price || 0,
            label: l.label || '',
            color: l.color || '#C4B5FD',
            dash:  l.dash || [6, 4],
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
        try {
            const url = `https://fapi.binance.com/fapi/v1/aggTrades?symbol=${symbol.toUpperCase()}&limit=1000`;
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
        this._mouse = { x: e.clientX - r.left, y: e.clientY - r.top };
        if (this._isDragging) {
            const dx = e.clientX - this._dragStartX;
            const spacing = this._barSpacing || this._pxPerTick || 2;
            const chartW = (this.W || 600) - TC_PADDING_RIGHT;
            const visibleCount = Math.max(TC_MIN_VISIBLE, Math.round(chartW / spacing));
            const maxOffset = Math.max(0, this.ticks.length - visibleCount);
            this._scrollOffset = Math.max(0, Math.min(maxOffset, this._dragStartOffset - dx / spacing));
            this.canvas.style.cursor = 'grabbing';
        }
        this._dirty = true;
    }

    _onMouseLeave() {
        this._mouse = null;
        this._hoveredMarker = null;
        this._dirty = true;
    }

    _onWheel(e) {
        e.preventDefault();
        const chartW = (this.W || 600) - TC_PADDING_RIGHT;
        const r = this.canvas.getBoundingClientRect();
        const mx = e.clientX - r.left;

        // Init barSpacing if needed
        if (this._barSpacing <= 0) {
            this._barSpacing = chartW / Math.min(this.ticks.length || 200, 300);
        }

        // Zoom speed: 15% per wheel notch (matches klinecharts feel)
        const factor = e.deltaY > 0 ? 0.85 : 1.176;
        const minSpacing = Math.max(0.3, chartW / Math.max(this.ticks.length, 100));
        const maxSpacing = chartW / 5;
        const newSpacing = Math.max(minSpacing, Math.min(maxSpacing, this._barSpacing * factor));

        // Anchor zoom on cursor position (keep tick under cursor stationary)
        const oldVisible = chartW / this._barSpacing;
        const newVisible = chartW / newSpacing;
        const f = Math.max(0, Math.min(1, mx / chartW));

        this._scrollOffset = Math.max(0, this._scrollOffset + (1 - f) * (oldVisible - newVisible));
        this._barSpacing = newSpacing;
        this._dirty = true;
    }

    _onMouseDown(e) {
        if (e.button !== 0) return; // left button only
        this._isDragging = true;
        this._dragStartX = e.clientX;
        this._dragStartOffset = this._scrollOffset;
    }

    _onMouseUp() {
        if (this._isDragging) {
            this._isDragging = false;
            this.canvas.style.cursor = 'crosshair';
        }
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
                const minSpacing = Math.max(0.3, chartW / Math.max(this.ticks.length, 100));
                const maxSpacing = chartW / 5;
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
            this._scrollOffset = Math.max(0, Math.min(maxOffset, this._touchStartOffset - dx / spacing));
            const r = this.canvas.getBoundingClientRect();
            this._mouse = { x: t.clientX - r.left, y: t.clientY - r.top };
            this._dirty = true;
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
        const endIdx = Math.max(0, ticks.length - 1 - Math.round(this._scrollOffset));
        const startIdx = Math.max(0, endIdx - visibleCount);
        const visible = ticks.slice(startIdx, endIdx + 1);

        if (visible.length < 2) return;

        // Time range of visible ticks
        const visStartTime = visible[0].time;
        const visEndTime   = visible[visible.length - 1].time;

        // Price range
        let minP = Infinity, maxP = -Infinity;
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

        const pxPerTick = chartW / (visible.length - 1);
        this._pxPerTick = pxPerTick;

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

        // Grid lines (horizontal)
        const gridSteps = TC_GRID_STEPS;
        ctx.strokeStyle = colors.gridLine;
        ctx.lineWidth = 1;
        ctx.font = '10px -apple-system, monospace';
        ctx.fillStyle = colors.textDim;
        ctx.textAlign = 'right';
        for (let i = 0; i <= gridSteps; i++) {
            const price = minP + (maxP - minP) * (i / gridSteps);
            const y = priceToY(price);
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(chartW, y);
            ctx.stroke();
            ctx.fillText(this._fmtPrice(price), W - 4, y + 3);
        }

        // Time labels (bottom)
        ctx.textAlign = 'center';
        ctx.fillStyle = colors.textDim;
        const timeSteps = Math.min(6, visible.length - 1);
        for (let i = 0; i <= timeSteps; i++) {
            const idx = Math.floor((visible.length - 1) * i / timeSteps);
            const t = visible[idx];
            const x = idxToX(idx);
            const d = new Date(t.time);
            const lbl = d.getHours().toString().padStart(2, '0') + ':' +
                        d.getMinutes().toString().padStart(2, '0') + ':' +
                        d.getSeconds().toString().padStart(2, '0');
            ctx.fillText(lbl, x, H - 6);
        }

        // ── Level lines (limit, stop, avg) ──
        for (const lv of this.levels) {
            if (lv.price <= 0) continue;
            const ly = priceToY(lv.price);
            if (ly < TC_PADDING_TOP - 10 || ly > H - TC_PADDING_BOTTOM + 10) continue;
            ctx.save();
            ctx.setLineDash(lv.dash || [6, 4]);
            ctx.strokeStyle = lv.color + '66';
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(0, Math.round(ly) + 0.5);
            ctx.lineTo(chartW, Math.round(ly) + 0.5);
            ctx.stroke();
            ctx.setLineDash([]);
            // Label bg
            ctx.font = 'bold 9px -apple-system, monospace';
            const tw = ctx.measureText(lv.label).width + 8;
            ctx.fillStyle = lv.color + '22';
            ctx.fillRect(4, ly - 8, tw, 16);
            ctx.strokeStyle = lv.color + '44';
            ctx.lineWidth = 1;
            ctx.strokeRect(4, ly - 8, tw, 16);
            ctx.fillStyle = lv.color;
            ctx.textAlign = 'left';
            ctx.fillText(lv.label, 8, ly + 3);
            // Right side price tag
            const rpLabel = this._fmtPrice(lv.price);
            const rpw = ctx.measureText(rpLabel).width + 6;
            ctx.fillStyle = lv.color + '33';
            ctx.fillRect(chartW + 2, ly - 8, rpw, 16);
            ctx.fillStyle = lv.color;
            ctx.fillText(rpLabel, chartW + 5, ly + 3);
            ctx.restore();
        }

        // Price line — single color, no blinking
        const lastPrice  = visible[visible.length - 1].price;
        const lineColor  = colors.accent;
        const baseRgb = '16,185,129';

        // Gradient fill under line
        const grad = ctx.createLinearGradient(0, TC_PADDING_TOP, 0, TC_PADDING_TOP + chartH);
        grad.addColorStop(0, `rgba(${baseRgb},0.12)`);
        grad.addColorStop(1, `rgba(${baseRgb},0.0)`);

        const fillPath = new Path2D();
        fillPath.moveTo(idxToX(0), priceToY(visible[0].price));
        for (let i = 1; i < visible.length; i++) {
            fillPath.lineTo(idxToX(i), priceToY(visible[i].price));
        }
        fillPath.lineTo(idxToX(visible.length - 1), TC_PADDING_TOP + chartH);
        fillPath.lineTo(idxToX(0), TC_PADDING_TOP + chartH);
        fillPath.closePath();
        ctx.fillStyle = grad;
        ctx.fill(fillPath);

        // Stroke line
        ctx.beginPath();
        ctx.moveTo(idxToX(0), priceToY(visible[0].price));
        for (let i = 1; i < visible.length; i++) {
            ctx.lineTo(idxToX(i), priceToY(visible[i].price));
        }
        ctx.strokeStyle = lineColor;
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

        // Dot at latest point
        if (this._scrollOffset <= 2) {
            const lastX = idxToX(visible.length - 1);
            const lastY = priceToY(lastPrice);
            ctx.beginPath();
            ctx.arc(lastX, lastY, 3, 0, Math.PI * 2);
            ctx.fillStyle = lineColor;
            ctx.fill();
            ctx.beginPath();
            ctx.arc(lastX, lastY, 6, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${baseRgb},0.3)`;
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
        for (const m of visibleMarkers) {
            if (!m._primary) continue;
            const px = timeToX(m.time);
            const py = priceToY(m.price);
            if (px < 0 || px > chartW) continue;
            const isLong = m.side === 'LONG' || m.side === 'BUY';
            const pColor = isLong ? colors.markerLong : colors.markerShort;

            // Vertical guide line
            ctx.save();
            ctx.strokeStyle = pColor;
            ctx.lineWidth = 1;
            ctx.setLineDash([4, 3]);
            ctx.globalAlpha = 0.5;
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
                const sz = 7;
                ctx.beginPath();
                ctx.moveTo(mx, my - sz);
                ctx.lineTo(mx + sz, my);
                ctx.lineTo(mx, my + sz);
                ctx.lineTo(mx - sz, my);
                ctx.closePath();
                ctx.fillStyle = mColor + '30';
                ctx.fill();
                ctx.strokeStyle = mColor;
                ctx.lineWidth = 1.5;
                ctx.stroke();
                // Count label
                ctx.fillStyle = mColor;
                ctx.font = 'bold 9px -apple-system, monospace';
                ctx.textAlign = 'center';
                ctx.fillText(String(m.count), mx, my + 3);
            } else if (m.isEntry) {
                // Entry: triangle
                const sz = 6;
                const tipY = my;
                const baseY = isLong ? my + sz * 2 : my - sz * 2;
                ctx.beginPath();
                ctx.moveTo(mx, tipY);
                ctx.lineTo(mx - sz, baseY);
                ctx.lineTo(mx + sz, baseY);
                ctx.closePath();
                // Dark outline
                ctx.strokeStyle = 'rgba(0,0,0,0.6)';
                ctx.lineWidth = 3;
                ctx.stroke();
                ctx.strokeStyle = mColor;
                ctx.lineWidth = 1.5;
                ctx.stroke();
                ctx.fillStyle = mColor + '25';
                ctx.fill();
            } else {
                // Exit: circle
                const r = 5;
                ctx.beginPath();
                ctx.arc(mx, my, r + 1.5, 0, Math.PI * 2);
                ctx.fillStyle = 'rgba(0,0,0,0.5)';
                ctx.fill();
                ctx.beginPath();
                ctx.arc(mx, my, r, 0, Math.PI * 2);
                ctx.fillStyle = m.pnl >= 0 ? colors.up + '30' : colors.down + '30';
                ctx.fill();
                ctx.strokeStyle = m.pnl >= 0 ? colors.up : colors.down;
                ctx.lineWidth = 1.5;
                ctx.stroke();
            }

            // Check if mouse is near this marker
            if (this._mouse) {
                const dx = this._mouse.x - mx;
                const dy = this._mouse.y - my;
                if (dx * dx + dy * dy < 200) { // ~14px radius
                    this._hoveredMarker = { ...m, _x: mx, _y: my, _isLong: isLong };
                }
            }
        }

        // ── Crosshair ──
        if (this._mouse && this._mouse.x < chartW && this._mouse.y > TC_PADDING_TOP && this._mouse.y < H - TC_PADDING_BOTTOM) {
            const mx = this._mouse.x;
            const my = this._mouse.y;

            // Vertical line
            ctx.strokeStyle = colors.crosshair;
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(mx, TC_PADDING_TOP);
            ctx.lineTo(mx, H - TC_PADDING_BOTTOM);
            ctx.stroke();
            // Horizontal line
            ctx.beginPath();
            ctx.moveTo(0, my);
            ctx.lineTo(chartW, my);
            ctx.stroke();
            ctx.setLineDash([]);

            // Marker tooltip takes priority over regular tooltip
            if (this._hoveredMarker) {
                const hm = this._hoveredMarker;
                const isLong = hm._isLong;
                const lines = [];
                if (hm.isEntry) {
                    lines.push((isLong ? 'LONG' : 'SHORT') + ' Entry');
                } else {
                    lines.push((isLong ? 'LONG' : 'SHORT') + ' Exit');
                }
                lines.push('Price: ' + this._fmtPrice(hm.price));
                if (!hm.isEntry) {
                    const pnlStr = (hm.pnl >= 0 ? '+' : '') + hm.pnl.toFixed(2);
                    lines.push('PnL: ' + pnlStr);
                }
                if (hm.count > 1) lines.push('Count: ' + hm.count);
                const d = new Date(hm.time);
                lines.push(d.getHours().toString().padStart(2, '0') + ':' +
                           d.getMinutes().toString().padStart(2, '0') + ':' +
                           d.getSeconds().toString().padStart(2, '0'));

                this._drawTooltip(ctx, hm._x, hm._y, lines, chartW, TC_PADDING_TOP);
            } else {
                // Snap to nearest tick
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
                    const priceStr = this._fmtPrice(tick.price);
                    const lines = [priceStr, timeStr];
                    if (tick.qty) lines.push('Qty: ' + tick.qty.toFixed(4));

                    this._drawTooltip(ctx, sx, sy, lines, chartW, TC_PADDING_TOP);
                }
            }

            // Price on Y-axis
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
}
