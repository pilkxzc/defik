// ═══════════════════════════════════════════
//  RULER / RANGE / DRAWING TOOLS  (canvas overlay)
//  Extracted from page/bot-detail.html
// ═══════════════════════════════════════════
(function() {
    // ── Drawing tools ──────────────────────────────────────────────────────
    var _drawingGroup = 'user-0';
    var _drawingGroupIdx = 0;
    var _activeDrawingTool = null;
    var _activeDrawingId = null;

    function toggleDrawingMenu() {
        var menu = document.getElementById('drawingToolsMenu');
        var btn = document.getElementById('drawingToolsBtn');
        if (!menu || !btn) return;
        // Cancel any in-progress drawing when toggling the menu
        if (_activeDrawingId) {
            try { klChart && klChart.removeOverlay({ id: _activeDrawingId }); } catch(e) {}
            _activeDrawingId = null;
            _activeDrawingTool = null;
        }
        var wasOpen = menu.style.display !== 'none';
        if (wasOpen) {
            closeAllDropdowns();
            menu.style.display = 'none';
        } else {
            menu.style.display = 'block';
            openDropdownSafe(menu, btn);
        }
    }

    function startDrawing(toolName) {
        var menu = document.getElementById('drawingToolsMenu');
        if (menu) menu.style.display = 'none';
        if (!klChart) return;
        // Cancel any previous in-progress drawing before starting a new one
        if (_activeDrawingId) {
            try { klChart.removeOverlay({ id: _activeDrawingId }); } catch(e) {}
            _activeDrawingId = null;
        }
        try {
            var result = klChart.createOverlay({ name: toolName, groupId: _drawingGroup });
            _activeDrawingId = Array.isArray(result) ? result[0] : result;
            _activeDrawingTool = toolName;
        } catch(e) {
            console.warn('[drawing] createOverlay failed:', e);
            _activeDrawingId = null;
            _activeDrawingTool = null;
        }
    }

    function clearAllUserDrawings() {
        var menu = document.getElementById('drawingToolsMenu');
        if (menu) menu.style.display = 'none';
        if (!klChart) return;
        try {
            klChart.removeOverlay({ groupId: _drawingGroup });
            _drawingGroup = 'user-' + (++_drawingGroupIdx);
        } catch(e) {}
    }
    // Expose to global scope for onclick handlers
    window.toggleDrawingMenu = toggleDrawingMenu;
    window.startDrawing = startDrawing;
    window.clearAllUserDrawings = clearAllUserDrawings;
    // ── End drawing tools ──────────────────────────────────────────────────

    var rulerActive = false;
    var rulerStep = 0; // 0 = idle, 1 = set start, waiting 2nd click, 2 = finalized
    var rulerStartData = null; // { price, dataIndex, x, y }
    var rulerEndData   = null; // { price, dataIndex, x, y }
    var rulerCanvas = null;
    var rulerLabel = null;
    var rulerBtn = document.getElementById('rulerBtn');
    var chartEl = document.getElementById('chart');

    // Last known cursor state from chart crosshair (price-snapped x/y)
    var _rulerLastCursor = { price: null, dataIndex: null, x: 0, y: 0 };

    function ensureCanvas() {
        if (rulerCanvas && rulerCanvas.isConnected) return rulerCanvas;
        rulerCanvas = document.createElement('canvas');
        rulerCanvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:40;';
        chartEl.appendChild(rulerCanvas);
        return rulerCanvas;
    }

    function sizeCanvas() {
        var c = ensureCanvas();
        var r = chartEl.getBoundingClientRect();
        var dpr = window.devicePixelRatio || 1;
        c.width  = Math.round(r.width  * dpr);
        c.height = Math.round(r.height * dpr);
        c.style.width  = r.width  + 'px';
        c.style.height = r.height + 'px';
        return { ctx: c.getContext('2d'), dpr: dpr, w: r.width, h: r.height };
    }

    function clearCanvas() {
        if (!rulerCanvas) return;
        rulerCanvas.getContext('2d').clearRect(0, 0, rulerCanvas.width, rulerCanvas.height);
    }

    function drawRulerLine(x1, y1, x2, y2, finalized) {
        var s = sizeCanvas();
        var ctx = s.ctx, dpr = s.dpr;
        ctx.clearRect(0, 0, s.w * dpr, s.h * dpr);
        ctx.save();
        ctx.scale(dpr, dpr);

        // Background tint between start and end (horizontal band)
        var pct = (y2 > y1) ? 'neg' : 'pos';
        var bandColor = pct === 'pos' ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)';
        ctx.fillStyle = bandColor;
        ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));

        // Dashed main line
        ctx.strokeStyle = finalized ? '#3B82F6' : 'rgba(59,130,246,0.7)';
        ctx.lineWidth = finalized ? 2 : 1.5;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        // Horizontal dashed guide at start
        ctx.strokeStyle = 'rgba(148,163,184,0.35)';
        ctx.lineWidth = 1;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y1);
        ctx.stroke();

        // Vertical dashed guide at end
        ctx.beginPath();
        ctx.moveTo(x2, y1);
        ctx.lineTo(x2, y2);
        ctx.stroke();

        // Dots
        ctx.setLineDash([]);
        ctx.fillStyle = '#3B82F6';
        ctx.beginPath(); ctx.arc(x1, y1, 4.5, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(x2, y2, 4.5, 0, Math.PI * 2); ctx.fill();
        // Inner white dot
        ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(x1, y1, 2, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(x2, y2, 2, 0, Math.PI * 2); ctx.fill();

        ctx.restore();
    }

    function cleanupRuler() {
        clearCanvas();
        if (rulerLabel) { rulerLabel.remove(); rulerLabel = null; }
        rulerStep = 0;
        rulerStartData = null;
        rulerEndData = null;
    }

    // Convert chart coords {dataIndex, price} → pixel {x, y}
    function _rulerToPixel(dataIndex, price, time) {
        // Tick chart mode — use time for stable anchor
        if (_tickChart) {
            var tp = _tickChart.chartToPixel(dataIndex, price, time);
            if (tp) return tp;
            return null;
        }
        if (!klChart || dataIndex == null || price == null) return null;
        try {
            var r = klChart.convertToPixel({ dataIndex: dataIndex, value: price }, { paneId: 'candle_pane' });
            if (r && r.x != null && r.y != null) return r;
        } catch(e) {}
        return null;
    }

    // Convert pixel {x, y} → chart coords {dataIndex, price, time, snappedX, snappedY}
    function _rulerFromPixel(px, py) {
        // Tick chart mode — returns snapped coordinates
        if (_tickChart) {
            var tc = _tickChart.pixelToChart(px, py);
            if (tc) return { dataIndex: tc.tickIndex, price: tc.price, time: tc.time, snappedX: tc.snappedX, snappedY: tc.snappedY };
            return null;
        }
        if (!klChart) return null;
        try {
            var arr = klChart.convertFromPixel([{ x: px, y: py }], { paneId: 'candle_pane' });
            var r = Array.isArray(arr) ? arr[0] : arr;
            if (r && r.dataIndex != null && r.value != null) return { dataIndex: r.dataIndex, price: r.value };
        } catch(e) {}
        return null;
    }

    // Redraw ruler from stored chart coords (called on scroll/zoom)
    function redrawRulerFromChart() {
        if (!rulerActive || !rulerStartData || rulerStep === 0) return;
        var p1 = _rulerToPixel(rulerStartData.dataIndex, rulerStartData.price, rulerStartData.time);
        if (!p1) return;
        if (rulerStep === 2 && rulerEndData) {
            var p2 = _rulerToPixel(rulerEndData.dataIndex, rulerEndData.price, rulerEndData.time);
            if (!p2) return;
            rulerStartData.x = p1.x; rulerStartData.y = p1.y;
            rulerEndData.x   = p2.x; rulerEndData.y   = p2.y;
            drawRulerLine(p1.x, p1.y, p2.x, p2.y, true);
            updateRulerLabel(rulerStartData.price, rulerEndData.price,
                             rulerStartData.dataIndex, rulerEndData.dataIndex, p2.x, p2.y);
        }
    }

    function toggleRuler() {
        rulerActive = !rulerActive;
        if (rulerActive) {
            rulerBtn.classList.add('active');
            chartEl.classList.add('ruler-mode');
            cleanupRuler();
        } else {
            rulerBtn.classList.remove('active');
            chartEl.classList.remove('ruler-mode');
            cleanupRuler();
        }
    }

    function formatPrice(p) {
        if (p == null || isNaN(p)) return '—';
        var a = Math.abs(p);
        if (a >= 1000) return p.toFixed(2);
        if (a >= 1)    return p.toFixed(4);
        if (a >= 0.01) return p.toFixed(5);
        return p.toFixed(7);
    }

    function updateRulerLabel(startPrice, endPrice, startIdx, endIdx, x, y) {
        if (startPrice == null || endPrice == null) return;
        if (!rulerLabel) {
            rulerLabel = document.createElement('div');
            rulerLabel.className = 'ruler-label';
            chartEl.appendChild(rulerLabel);
        }
        var diff = endPrice - startPrice;
        var pct  = (startPrice !== 0 && isFinite(startPrice)) ? (diff / startPrice) * 100 : 0;
        if (!isFinite(pct)) pct = 0;
        var bars = Math.abs((endIdx || 0) - (startIdx || 0));
        var pctClass = pct >= 0 ? 'pos' : 'neg';
        var sign = pct >= 0 ? '+' : '';

        var barUnit = _tickChart ? 'тік' : 'бар';
        var barSuffix = _tickChart
            ? (bars === 1 ? '' : bars < 5 ? 'и' : 'ів')
            : (bars === 1 ? '' : bars < 5 ? 'и' : 'ів');
        rulerLabel.innerHTML =
            '<span class="rl-price">' + formatPrice(endPrice) + '</span>  ' +
            '<span class="rl-pct ' + pctClass + '">' + sign + pct.toFixed(2) + '%</span>  ' +
            '(<span class="rl-price">' + sign + formatPrice(diff) + '</span>)<br>' +
            '<span class="rl-bars">' + bars + '\u00a0' + barUnit + barSuffix + '</span>';

        var rect = chartEl.getBoundingClientRect();
        var lw = rulerLabel.offsetWidth || 160;
        var lx = x + 16;
        if (lx + lw > rect.width - 4) lx = x - lw - 16;
        if (lx < 4) lx = 4;
        rulerLabel.style.left      = lx + 'px';
        rulerLabel.style.top       = y + 'px';
        rulerLabel.style.transform = 'translateY(-50%)';
    }

    // mousedown — capture phase so we intercept before klinecharts panning
    function onRulerMouseDown(e) {
        if (!rulerActive) return;
        e.stopImmediatePropagation();
        e.preventDefault();

        var r = chartEl.getBoundingClientRect();
        var cx = e.clientX - r.left;
        var cy = e.clientY - r.top;
        // Get chart coords at raw pixel position
        var cp = _rulerFromPixel(cx, cy);
        var price     = (cp && cp.price     != null) ? cp.price     : _rulerLastCursor.price;
        var dataIndex = (cp && cp.dataIndex  != null) ? cp.dataIndex : _rulerLastCursor.dataIndex;
        var time      = (cp && cp.time) || 0;
        // For tick chart: snap to actual tick position
        var snapX = (cp && cp.snappedX != null) ? cp.snappedX : cx;
        var snapY = (cp && cp.snappedY != null) ? cp.snappedY : cy;

        if (rulerStep === 0 || rulerStep === 2) {
            cleanupRuler();
            rulerStartData = { price: price, dataIndex: dataIndex, x: snapX, y: snapY, time: time };
            rulerStep = 1;
        } else if (rulerStep === 1) {
            rulerEndData = { price: price, dataIndex: dataIndex, x: snapX, y: snapY, time: time };
            drawRulerLine(rulerStartData.x, rulerStartData.y, snapX, snapY, true);
            updateRulerLabel(rulerStartData.price, price,
                             rulerStartData.dataIndex, dataIndex, snapX, snapY);
            rulerStep = 2;
        }
    }

    // mousemove — live preview
    var _rulerRafPending = false;
    function onRulerMouseMove(e) {
        if (!rulerActive || rulerStep !== 1 || !rulerStartData) return;
        if (_rulerRafPending) return;
        _rulerRafPending = true;
        requestAnimationFrame(function() {
            _rulerRafPending = false;
            var r = chartEl.getBoundingClientRect();
            var cx = e.clientX - r.left;
            var cy = e.clientY - r.top;
            var cp = _rulerFromPixel(cx, cy);
            var price     = (cp && cp.price     != null) ? cp.price     : _rulerLastCursor.price;
            var dataIndex = (cp && cp.dataIndex  != null) ? cp.dataIndex : _rulerLastCursor.dataIndex;
            // For tick chart: snap end point and recalculate start position from chart coords
            var endX = (cp && cp.snappedX != null) ? cp.snappedX : cx;
            var endY = (cp && cp.snappedY != null) ? cp.snappedY : cy;
            var startX = rulerStartData.x, startY = rulerStartData.y;
            if (_tickChart && rulerStartData.time) {
                var sp = _rulerToPixel(rulerStartData.dataIndex, rulerStartData.price, rulerStartData.time);
                if (sp) { startX = sp.x; startY = sp.y; rulerStartData.x = startX; rulerStartData.y = startY; }
            }
            drawRulerLine(startX, startY, endX, endY, false);
            if (price !== null) {
                updateRulerLabel(rulerStartData.price, price,
                                 rulerStartData.dataIndex, dataIndex, endX, endY);
            }
        });
    }

    // ── Range stats tool ──────────────────────────────────────────────────
    var rangeActive = false;
    var rangeStep = 0; // 0=idle, 1=start set, 2=finalized
    var rangeStartData = null;
    var rangeStatsPopup = null;

    function cleanupRange() {
        clearCanvas();
        if (rangeStatsPopup) { rangeStatsPopup.remove(); rangeStatsPopup = null; }
        rangeStep = 0;
        rangeStartData = null;
    }

    function toggleRangeTool() {
        rangeActive = !rangeActive;
        if (rangeActive) {
            document.getElementById('rangeBtn').classList.add('active');
            chartEl.classList.add('range-mode');
            cleanupRange();
            if (rulerActive) toggleRuler(); // cancel ruler
        } else {
            document.getElementById('rangeBtn').classList.remove('active');
            chartEl.classList.remove('range-mode');
            cleanupRange();
        }
    }

    function drawRangeSelection(x1, x2, finalized) {
        var s = sizeCanvas();
        var ctx = s.ctx, dpr = s.dpr;
        ctx.clearRect(0, 0, s.w * dpr, s.h * dpr);
        ctx.save();
        ctx.scale(dpr, dpr);
        var lx = Math.min(x1, x2), rx = Math.max(x1, x2);

        // Tinted fill between lines
        ctx.fillStyle = 'rgba(245,158,11,0.07)';
        ctx.fillRect(lx, 0, rx - lx, s.h);

        // Vertical lines
        ctx.strokeStyle = finalized ? '#F59E0B' : 'rgba(245,158,11,0.65)';
        ctx.lineWidth = finalized ? 1.5 : 1;
        ctx.setLineDash([5, 4]);
        ctx.beginPath(); ctx.moveTo(x1, 0); ctx.lineTo(x1, s.h); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(x2, 0); ctx.lineTo(x2, s.h); ctx.stroke();

        // Dots at top/bottom
        ctx.setLineDash([]);
        ctx.fillStyle = '#F59E0B';
        [x1, x2].forEach(function(x) {
            ctx.beginPath(); ctx.arc(x, 4, 3, 0, Math.PI * 2); ctx.fill();
            ctx.beginPath(); ctx.arc(x, s.h - 4, 3, 0, Math.PI * 2); ctx.fill();
        });
        ctx.restore();
    }

    function _fp(p) {
        var a = Math.abs(p);
        if (a >= 1000) return p.toFixed(2);
        if (a >= 1)    return p.toFixed(4);
        if (a >= 0.01) return p.toFixed(5);
        return p.toFixed(7);
    }
    function _fv(v) {
        if (v >= 1e9) return (v/1e9).toFixed(2) + 'B';
        if (v >= 1e6) return (v/1e6).toFixed(2) + 'M';
        if (v >= 1e3) return (v/1e3).toFixed(2) + 'K';
        return v.toFixed(2);
    }

    function computeRangeStats(t1, t2) {
        if (t1 == null || t2 == null) return null;
        var tMin = Math.min(t1, t2);
        var tMax = Math.max(t1, t2);
        // Filter candles strictly by open-time within [tMin, tMax]
        var candles = klinesData.filter(function(k) { return k.time >= tMin && k.time <= tMax; });
        if (candles.length === 0) {
            // If user selected within a single candle, grab the containing candle
            candles = klinesData.filter(function(k) { return k.time <= tMax; });
            if (candles.length) candles = [candles[candles.length - 1]];
        }
        if (candles.length === 0) return null;

        var tStart = candles[0].time;
        var tEnd   = candles[candles.length - 1].time;
        // interval seconds — needed to include trades within the last candle
        var ivSec = klinesData.length > 1 ? klinesData[1].time - klinesData[0].time : 900;
        var open   = candles[0].open;
        var close  = candles[candles.length - 1].close;
        var high   = candles.reduce(function(m,c){ return Math.max(m, c.high); }, -Infinity);
        var low    = candles.reduce(function(m,c){ return Math.min(m, c.low);  },  Infinity);
        var change    = close - open;
        var changePct = open !== 0 ? change / open * 100 : 0;
        var range     = high - low;
        var rangePct  = open !== 0 ? range / open * 100 : 0;

        var bulls = candles.filter(function(c){ return c.close >= c.open; }).length;
        var bears = candles.length - bulls;
        var avgBody  = candles.reduce(function(s,c){ return s + Math.abs(c.close - c.open); }, 0) / candles.length;
        var avgRange = candles.reduce(function(s,c){ return s + (c.high - c.low); }, 0) / candles.length;
        var maxRange = candles.reduce(function(m,c){ return Math.max(m, c.high - c.low); }, 0);
        var minRange = candles.reduce(function(m,c){ return Math.min(m, c.high - c.low); }, Infinity);
        var volatility = avgRange > 0 ? (maxRange - minRange) / avgRange * 100 : 0;

        var hasVol   = candles.some(function(c){ return c.volume > 0; });
        var totalVol = hasVol ? candles.reduce(function(s,c){ return s + (c.volume || 0); }, 0) : 0;
        var avgVol   = hasVol ? totalVol / candles.length : 0;
        var maxVol   = hasVol ? candles.reduce(function(m,c){ return Math.max(m, c.volume||0); }, 0) : 0;

        // Trade stats from lastRawMarkers
        // tEnd + ivSec to include trades that happened within the last candle period
        var mkrs = (lastRawMarkers || []).filter(function(m){ return m.time >= tStart && m.time < tEnd + ivSec; });
        var entries = mkrs.filter(function(m){ return m.isEntry; });
        var exits   = mkrs.filter(function(m){ return !m.isEntry; });
        var pnlArr  = exits.map(function(m){ return parseFloat(m.pnl || m.realizedPnl || 0); });
        var totalPnl = pnlArr.reduce(function(s,v){ return s+v; }, 0);
        var wins  = pnlArr.filter(function(v){ return v > 0; });
        var losses = pnlArr.filter(function(v){ return v < 0; });
        var bestPnl  = wins.length  ? Math.max.apply(null, wins)  : null;
        var worstPnl = losses.length ? Math.min.apply(null, losses) : null;
        var avgPnl   = pnlArr.length ? totalPnl / pnlArr.length : 0;
        var winRate  = pnlArr.length ? wins.length / pnlArr.length * 100 : 0;
        var profitFactor = losses.length ?
            Math.abs(wins.reduce(function(s,v){return s+v;},0)) / Math.abs(losses.reduce(function(s,v){return s+v;},0)) : null;

        // Long vs Short breakdown (use positionSide when available — hedge mode)
        var longs  = mkrs.filter(function(m){ return m.positionSide === 'LONG'  || (!m.positionSide && (m.side === 'LONG'  || m.side === 'BUY')); });
        var shorts = mkrs.filter(function(m){ return m.positionSide === 'SHORT' || (!m.positionSide && (m.side === 'SHORT' || m.side === 'SELL')); });

        // Max consecutive wins/losses from exits
        var maxStreak = function(arr, positive) {
            var cur = 0, best = 0;
            arr.forEach(function(v) {
                if (positive ? v > 0 : v < 0) { cur++; best = Math.max(best, cur); } else cur = 0;
            });
            return best;
        };
        var maxWinStreak  = maxStreak(pnlArr, true);
        var maxLossStreak = maxStreak(pnlArr, false);

        return {
            tStart, tEnd, total: candles.length, bulls, bears,
            open, close, high, low, change, changePct, range, rangePct,
            avgBody, avgRange, maxRange, minRange, volatility,
            hasVol, totalVol, avgVol, maxVol,
            mkrsTotal: mkrs.length, entries: entries.length, exits: exits.length,
            totalPnl, wins: wins.length, losses: losses.length, winRate,
            bestPnl, worstPnl, avgPnl, profitFactor,
            longs: longs.length, shorts: shorts.length,
            maxWinStreak, maxLossStreak
        };
    }

    function showRangeStatsPopup(stats) {
        if (rangeStatsPopup) { rangeStatsPopup.remove(); rangeStatsPopup = null; }
        if (!stats) return;

        function fdate(ts) {
            var d = new Date(ts * 1000);
            return d.toLocaleDateString('uk-UA',{day:'2-digit',month:'2-digit',year:'2-digit'}) + ' ' +
                   d.toLocaleTimeString('uk-UA',{hour:'2-digit',minute:'2-digit'});
        }
        function row(lbl, val, cls) {
            return '<div class="rsp-row"><span class="rsp-lbl">' + lbl + '</span><span class="rsp-val' + (cls ? ' ' + cls : '') + '">' + val + '</span></div>';
        }
        var pc = stats.changePct >= 0 ? 'rsp-up' : 'rsp-dn';
        var ps = stats.changePct >= 0 ? '+' : '';
        var pp = stats.totalPnl  >= 0 ? 'rsp-up' : 'rsp-dn';
        var pps = stats.totalPnl >= 0 ? '+' : '';

        var tradesSection = '';
        if (stats.mkrsTotal > 0) {
            tradesSection = '<div class="rsp-section">' +
                '<div class="rsp-section-title">Угоди бота</div>' +
                '<div class="rsp-grid">' +
                row('Всього маркерів', stats.mkrsTotal) +
                row('Входів / Виходів', stats.entries + ' / ' + stats.exits) +
                row('Лонг / Шорт', stats.longs + ' / ' + stats.shorts) +
                (stats.exits > 0 ? [
                    row('Реаліз. PnL', pps + stats.totalPnl.toFixed(4) + ' $', pp),
                    row('Переможних', stats.wins + ' (' + stats.winRate.toFixed(0) + '%)', 'rsp-up'),
                    row('Збиткових', stats.losses, stats.losses > 0 ? 'rsp-dn' : ''),
                    row('Win rate', stats.winRate.toFixed(1) + '%', stats.winRate >= 50 ? 'rsp-up' : 'rsp-dn'),
                    stats.bestPnl  !== null ? row('Найкраща', '+' + stats.bestPnl.toFixed(4) + ' $', 'rsp-up') : '',
                    stats.worstPnl !== null ? row('Найгірша', stats.worstPnl.toFixed(4) + ' $', 'rsp-dn') : '',
                    row('Сер. виходу', (stats.avgPnl >= 0 ? '+' : '') + stats.avgPnl.toFixed(4) + ' $', stats.avgPnl >= 0 ? 'rsp-up' : 'rsp-dn'),
                    stats.profitFactor !== null ? row('Profit factor', stats.profitFactor.toFixed(2)) : '',
                    row('Макс. серія прибутків', stats.maxWinStreak),
                    row('Макс. серія збитків', stats.maxLossStreak, stats.maxLossStreak > 2 ? 'rsp-dn' : ''),
                ].join('') : '<div style="color:var(--text-tertiary);font-size:10px;padding:2px 0">Немає закритих позицій у діапазоні</div>') +
                '</div></div>';
        } else {
            tradesSection = '<div class="rsp-section"><div class="rsp-section-title">Угоди бота</div>' +
                '<div style="color:var(--text-tertiary);font-size:10px;padding:2px 0">Немає угод у вибраному діапазоні</div></div>';
        }

        var volSection = stats.hasVol ? '<div class="rsp-section">' +
            '<div class="rsp-section-title">Об\'єм</div>' +
            '<div class="rsp-grid">' +
            row('Загальний', _fv(stats.totalVol)) +
            row('Середній/бар', _fv(stats.avgVol)) +
            row('Максимальний', _fv(stats.maxVol)) +
            '</div></div>' : '';

        rangeStatsPopup = document.createElement('div');
        rangeStatsPopup.className = 'range-stats-popup';
        rangeStatsPopup.innerHTML =
            '<div class="rsp-header">' +
              '<div class="rsp-title">' +
                '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="3" y1="4" x2="3" y2="20"/><line x1="21" y1="4" x2="21" y2="20"/></svg>' +
                'Статистика діапазону<span class="rsp-bars">' + stats.total + ' барів</span>' +
              '</div>' +
              '<button class="rsp-close" onclick="this.closest(\'.range-stats-popup\').remove()">' +
                '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
              '</button>' +
            '</div>' +
            '<div class="rsp-dates">' + fdate(stats.tStart) + ' — ' + fdate(stats.tEnd) + '</div>' +
            '<div class="rsp-section">' +
              '<div class="rsp-section-title">Ціна</div>' +
              '<div class="rsp-grid">' +
              row('Відкриття', _fp(stats.open)) +
              row('Закриття', _fp(stats.close)) +
              row('Максимум', _fp(stats.high), 'rsp-up') +
              row('Мінімум', _fp(stats.low), 'rsp-dn') +
              row('Зміна $', ps + _fp(stats.change), pc) +
              row('Зміна %', ps + stats.changePct.toFixed(2) + '%', pc) +
              row('Розмах $', _fp(stats.range)) +
              row('Розмах %', stats.rangePct.toFixed(2) + '%') +
              '</div></div>' +
            '<div class="rsp-section">' +
              '<div class="rsp-section-title">Свічки</div>' +
              '<div class="rsp-grid">' +
              row('Всього', stats.total) +
              row('Бичачих', stats.bulls + ' (' + (stats.bulls/stats.total*100).toFixed(0) + '%)', 'rsp-up') +
              row('Ведмежих', stats.bears + ' (' + (stats.bears/stats.total*100).toFixed(0) + '%)', 'rsp-dn') +
              row('Сер. тіло', _fp(stats.avgBody)) +
              row('Сер. розмах', _fp(stats.avgRange)) +
              row('Макс. розмах', _fp(stats.maxRange)) +
              row('Мін. розмах', _fp(stats.minRange)) +
              row('Волатильність', stats.volatility.toFixed(1) + '%') +
              '</div></div>' +
            volSection +
            tradesSection;

        chartEl.appendChild(rangeStatsPopup);

        // Initial position — centered at top
        var rect = chartEl.getBoundingClientRect();
        var pw = rangeStatsPopup.offsetWidth || 272;
        var lx = (rect.width - pw) / 2;
        lx = Math.max(4, Math.min(lx, rect.width - pw - 4));
        rangeStatsPopup.style.left = lx + 'px';
        rangeStatsPopup.style.top  = '12px';
        rangeStatsPopup.style.transform = 'none';

        // Make draggable via header
        (function makeDraggable(popup) {
            var header = popup.querySelector('.rsp-header');
            if (!header) return;
            header.style.cursor = 'grab';
            var dragStartX, dragStartY, popStartX, popStartY, dragging = false;

            header.addEventListener('mousedown', function(e) {
                if (e.target.closest('.rsp-close')) return;
                dragging = true;
                dragStartX = e.clientX;
                dragStartY = e.clientY;
                popStartX = parseInt(popup.style.left) || 0;
                popStartY = parseInt(popup.style.top)  || 0;
                header.style.cursor = 'grabbing';
                e.preventDefault();
                e.stopPropagation();
            });
            document.addEventListener('mousemove', function(e) {
                if (!dragging) return;
                var dx = e.clientX - dragStartX;
                var dy = e.clientY - dragStartY;
                var r = chartEl.getBoundingClientRect();
                var newX = Math.max(0, Math.min(r.width  - popup.offsetWidth,  popStartX + dx));
                var newY = Math.max(0, Math.min(r.height - popup.offsetHeight, popStartY + dy));
                popup.style.left = newX + 'px';
                popup.style.top  = newY + 'px';
            });
            document.addEventListener('mouseup', function() {
                if (dragging) { dragging = false; header.style.cursor = 'grab'; }
            });
        })(rangeStatsPopup);
    }

    function _rangeTimeFromCursor() {
        // Get candle time by dataIndex, fallback to closest in klinesData
        var idx = _rulerLastCursor.dataIndex;
        if (idx != null && klinesData[idx]) return klinesData[idx].time;
        // fallback: use price crosshair to binary-search closest candle time
        if (klinesData.length === 0) return null;
        return klinesData[Math.max(0, Math.min(klinesData.length - 1, idx || 0))].time;
    }

    function onRangeMouseDown(e) {
        if (!rangeActive) return;
        if (rangeStatsPopup && rangeStatsPopup.contains(e.target)) return;
        e.stopImmediatePropagation();
        e.preventDefault();
        var cx = _rulerLastCursor.x || (e.clientX - chartEl.getBoundingClientRect().left);

        if (rangeStep === 0 || rangeStep === 2) {
            cleanupRange();
            rangeStartData = { x: cx, time: _rangeTimeFromCursor() };
            rangeStep = 1;
        } else if (rangeStep === 1) {
            drawRangeSelection(rangeStartData.x, cx, true);
            var stats = computeRangeStats(rangeStartData.time, _rangeTimeFromCursor());
            showRangeStatsPopup(stats);
            rangeStep = 2;
        }
    }

    var _rangeRafPending = false;
    function onRangeMouseMove(e) {
        if (!rangeActive || rangeStep !== 1 || !rangeStartData) return;
        if (_rangeRafPending) return;
        _rangeRafPending = true;
        requestAnimationFrame(function() {
            _rangeRafPending = false;
            var cx = _rulerLastCursor.x || (e.clientX - chartEl.getBoundingClientRect().left);
            drawRangeSelection(rangeStartData.x, cx, false);
        });
    }
    // ── End range stats tool ──────────────────────────────────────────────

    // Escape cancels both tools
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            if (rulerActive) toggleRuler();
            if (rangeActive) toggleRangeTool();
        }
    });

    // Subscribe to klinecharts crosshair — get price-snapped x/y
    // Exposed as window._rulerResubscribe so _buildKlChart can re-call after chart rebuild
    window._rulerResubscribe = function() {
        if (!klChart || !window.klinecharts) return;
        try {
            klChart.subscribeAction(window.klinecharts.ActionType.OnCrosshairChange, function(data) {
                if (!data) return;
                if (data.dataIndex != null) _rulerLastCursor.dataIndex = data.dataIndex;
                if (data.x != null) _rulerLastCursor.x = data.x;
                if (data.y != null) _rulerLastCursor.y = data.y;
                var p = data.price;
                if (p == null && data.kLineData) p = data.kLineData.close;
                if (p == null && data.dataIndex != null && klinesData[data.dataIndex]) p = klinesData[data.dataIndex].close;
                if (p != null && p !== 0) _rulerLastCursor.price = p;
            });
        } catch(e) {}
        // Redraw finalized ruler when chart scrolls or zooms
        try {
            klChart.subscribeAction(window.klinecharts.ActionType.OnScroll, redrawRulerFromChart);
            klChart.subscribeAction(window.klinecharts.ActionType.OnZoom,   redrawRulerFromChart);
            klChart.subscribeAction(window.klinecharts.ActionType.OnVisibleRangeChange, redrawRulerFromChart);
        } catch(e) {}
        try {
            klChart.subscribeAction(window.klinecharts.ActionType.OnDrawEnd, function() {
                _activeDrawingId = null;
                _activeDrawingTool = null;
            });
        } catch(e) {}
    };

    // Attach ruler/range listeners immediately (work for both klChart and tick chart)
    chartEl.addEventListener('mousedown', onRulerMouseDown,  { capture: true });
    chartEl.addEventListener('mousemove', onRulerMouseMove);
    chartEl.addEventListener('mousedown', onRangeMouseDown,  { capture: true });
    chartEl.addEventListener('mousemove', onRangeMouseMove);

    // Subscribe klinecharts-specific events when klChart becomes available
    var waitChart = setInterval(function() {
        if (klChart) {
            clearInterval(waitChart);
            window._rulerResubscribe();
        }
    }, 200);

    if (rulerBtn) rulerBtn.addEventListener('click', toggleRuler);
    var _rangeBtn = document.getElementById('rangeBtn');
    if (_rangeBtn) _rangeBtn.addEventListener('click', toggleRangeTool);
})();
