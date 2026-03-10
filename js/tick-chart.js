'use strict';
/**
 * TickChart — lightweight canvas-based tick/line chart for sub-5s timeframes.
 * Renders trade-by-trade price as a continuous line.
 *
 * Usage:
 *   const tc = new TickChart(containerEl, { maxTicks: 2000 });
 *   tc.loadHistory(trades);      // [{price, time, qty}]
 *   tc.addTick({price, time, qty});
 *   tc.destroy();
 */
class TickChart {
    constructor(container, opts = {}) {
        this.container = container;
        this.maxTicks  = opts.maxTicks || 2000;
        this.ticks     = [];       // [{price, time, qty}]
        this._ws       = null;
        this._wsGen    = 0;
        this._raf      = null;
        this._dirty    = true;
        this._mouse    = null;     // {x, y} or null
        this._scrollOffset = 0;    // pan offset (0 = latest at right edge)
        this._isDragging   = false;
        this._dragStartX   = 0;
        this._dragStartOffset = 0;

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
        };

        // Create canvas
        this.canvas = document.createElement('canvas');
        this.canvas.style.cssText = 'width:100%;height:100%;display:block;cursor:crosshair;';
        this.container.innerHTML = '';
        this.container.appendChild(this.canvas);
        this.ctx = this.canvas.getContext('2d');

        // Resize
        this._ro = new ResizeObserver(() => this._resize());
        this._ro.observe(this.container);
        this._resize();

        // Events
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

    /** Connect to Binance aggTrade WS for a symbol (futures) */
    connectWs(symbol) {
        this.disconnectWs();
        const gen = ++this._wsGen;
        const stream = symbol.toLowerCase() + '@aggTrade';
        const url = 'wss://fstream.binance.com/ws/' + stream;

        const connect = () => {
            if (this._wsGen !== gen) return;
            const ws = new WebSocket(url);
            this._ws = ws;
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
                    setTimeout(connect, 2000);
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
        // Fetch history
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
        // Connect WS
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

    _onMouseMove(e) {
        const r = this.canvas.getBoundingClientRect();
        this._mouse = { x: e.clientX - r.left, y: e.clientY - r.top };
        if (this._isDragging) {
            const dx = e.clientX - this._dragStartX;
            const pxPerTick = this._pxPerTick || 2;
            this._scrollOffset = Math.max(0, this._dragStartOffset - Math.round(dx / pxPerTick));
            this.canvas.style.cursor = 'grabbing';
        }
        this._dirty = true;
    }

    _onMouseLeave() {
        this._mouse = null;
        this._dirty = true;
    }

    _onWheel(e) {
        e.preventDefault();
        const delta = Math.sign(e.deltaY) * 5;
        this._scrollOffset = Math.max(0, this._scrollOffset + delta);
        this._dirty = true;
    }

    _onMouseDown(e) {
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

        const PADDING_RIGHT = 70;
        const PADDING_TOP = 12;
        const PADDING_BOTTOM = 28;
        const chartW = W - PADDING_RIGHT;
        const chartH = H - PADDING_TOP - PADDING_BOTTOM;

        // Determine visible range
        const visibleCount = Math.max(100, Math.floor(chartW / 2));
        const endIdx = Math.max(0, ticks.length - 1 - this._scrollOffset);
        const startIdx = Math.max(0, endIdx - visibleCount);
        const visible = ticks.slice(startIdx, endIdx + 1);

        if (visible.length < 2) return;

        // Price range
        let minP = Infinity, maxP = -Infinity;
        for (const t of visible) {
            if (t.price < minP) minP = t.price;
            if (t.price > maxP) maxP = t.price;
        }
        const spread = maxP - minP || maxP * 0.001 || 1;
        const pad = spread * 0.08;
        minP -= pad;
        maxP += pad;

        const pxPerTick = chartW / (visible.length - 1);
        this._pxPerTick = pxPerTick;

        const priceToY = (p) => PADDING_TOP + chartH - ((p - minP) / (maxP - minP)) * chartH;
        const idxToX   = (i) => i * pxPerTick;

        // Background
        ctx.fillStyle = colors.bg;
        ctx.fillRect(0, 0, W, H);

        // Grid lines (horizontal)
        const gridSteps = 5;
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

        // Price line
        const firstPrice = visible[0].price;
        const lastPrice  = visible[visible.length - 1].price;
        const lineColor  = lastPrice >= firstPrice ? colors.up : colors.down;

        // Gradient fill under line
        const grad = ctx.createLinearGradient(0, PADDING_TOP, 0, PADDING_TOP + chartH);
        const baseRgb = lastPrice >= firstPrice ? '16,185,129' : '239,68,68';
        grad.addColorStop(0, `rgba(${baseRgb},0.12)`);
        grad.addColorStop(1, `rgba(${baseRgb},0.0)`);

        ctx.beginPath();
        ctx.moveTo(idxToX(0), priceToY(visible[0].price));
        for (let i = 1; i < visible.length; i++) {
            ctx.lineTo(idxToX(i), priceToY(visible[i].price));
        }
        // Fill area
        const fillPath = new Path2D();
        fillPath.moveTo(idxToX(0), priceToY(visible[0].price));
        for (let i = 1; i < visible.length; i++) {
            fillPath.lineTo(idxToX(i), priceToY(visible[i].price));
        }
        fillPath.lineTo(idxToX(visible.length - 1), PADDING_TOP + chartH);
        fillPath.lineTo(idxToX(0), PADDING_TOP + chartH);
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
        const lastX = idxToX(visible.length - 1);
        const lastY = priceToY(lastPrice);
        ctx.beginPath();
        ctx.arc(lastX, lastY, 3, 0, Math.PI * 2);
        ctx.fillStyle = lineColor;
        ctx.fill();
        // Glow
        ctx.beginPath();
        ctx.arc(lastX, lastY, 6, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(${baseRgb},0.3)`;
        ctx.fill();

        // Crosshair
        if (this._mouse && this._mouse.x < chartW && this._mouse.y > PADDING_TOP && this._mouse.y < H - PADDING_BOTTOM) {
            const mx = this._mouse.x;
            const my = this._mouse.y;

            // Vertical line
            ctx.strokeStyle = colors.crosshair;
            ctx.lineWidth = 1;
            ctx.setLineDash([3, 3]);
            ctx.beginPath();
            ctx.moveTo(mx, PADDING_TOP);
            ctx.lineTo(mx, H - PADDING_BOTTOM);
            ctx.stroke();
            // Horizontal line
            ctx.beginPath();
            ctx.moveTo(0, my);
            ctx.lineTo(chartW, my);
            ctx.stroke();
            ctx.setLineDash([]);

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
                const qtyStr = tick.qty ? ('Qty: ' + tick.qty.toFixed(4)) : '';

                ctx.font = '11px -apple-system, monospace';
                const lines = [priceStr, timeStr];
                if (qtyStr) lines.push(qtyStr);
                const tw = Math.max(...lines.map(l => ctx.measureText(l).width)) + 16;
                const th = lines.length * 16 + 8;
                let tx = sx + 12;
                let ty = sy - th - 6;
                if (tx + tw > chartW) tx = sx - tw - 12;
                if (ty < PADDING_TOP) ty = sy + 10;

                ctx.fillStyle = 'rgba(26,26,26,0.92)';
                ctx.beginPath();
                ctx.roundRect(tx, ty, tw, th, 6);
                ctx.fill();
                ctx.strokeStyle = 'rgba(255,255,255,0.1)';
                ctx.lineWidth = 1;
                ctx.stroke();

                ctx.fillStyle = '#fff';
                ctx.textAlign = 'left';
                ctx.font = 'bold 11px -apple-system, monospace';
                ctx.fillText(priceStr, tx + 8, ty + 16);
                ctx.font = '10px -apple-system, monospace';
                ctx.fillStyle = colors.textSec;
                ctx.fillText(timeStr, tx + 8, ty + 32);
                if (qtyStr) {
                    ctx.fillText(qtyStr, tx + 8, ty + 48);
                }
            }

            // Price on Y-axis
            const hoverPrice = minP + ((H - PADDING_BOTTOM - my) / chartH) * (maxP - minP);
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

    _fmtPrice(p) {
        if (p >= 1000)   return p.toFixed(2);
        if (p >= 1)      return p.toFixed(4);
        if (p >= 0.01)   return p.toFixed(6);
        return p.toFixed(8);
    }
}
