// ═══════════════════════════════════════════
//  FORMATTERS
// ═══════════════════════════════════════════
const fmtPrice = v => {
    const n = parseFloat(v);
    if (isNaN(n)) return '—';
    if (Math.abs(n) >= 1000) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (Math.abs(n) >= 1) return n.toFixed(2);
    return n.toPrecision(4);
};
const fmtPct = v => (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
const fmtVol = v => {
    if (v >= 1e9) return (v/1e9).toFixed(1) + 'B';
    if (v >= 1e6) return (v/1e6).toFixed(1) + 'M';
    if (v >= 1e3) return (v/1e3).toFixed(1) + 'K';
    return v.toFixed(0);
};

// ═══════════════════════════════════════════
//  RENDER ALL
// ═══════════════════════════════════════════
function renderAll() {
    renderHeader();
    renderSymbolSelector();
    renderSummary();
    renderKPIs();
    renderEquityChart();
    renderRiskAssessment();
    renderLongShort();
    renderStreaks();
    renderCalendar();
    renderPairs();
    renderHourly();
    renderDrawdownChart();
    renderRecentTrades();
    renderLiveChart();
    renderSubscribeSection();
    renderLivePosition();
    renderTelegramSection();
}

// ═══════════════════════════════════════════
//  HEADER
// ═══════════════════════════════════════════
function renderHeader() {
    document.getElementById('botTitle').textContent = getBotName();
    const badge = document.getElementById('botBadge');
    badge.textContent = isTestMode() ? 'ТЕСТ' : 'LIVE';
    badge.className = 'bot-badge ' + (isTestMode() ? 'test' : 'live');
    const isAdmin = currentUser && (currentUser.role === 'admin' || currentUser.role === 'moderator');
    document.getElementById('backBtn').href = isAdmin ? `/bot/${botId}` : '/bots';
    document.title = `Yamato — ${getBotName()} Статистика`;

    const symbolBadge = document.getElementById('symbolBadge');
    if (symbolBadge) symbolBadge.textContent = getSymbol();

    // Nav avatar
    renderNavAvatar();
}

function renderNavAvatar() {
    const el = document.getElementById('navAvatar');
    if (!el || !currentUser) return;

    if (currentUser.avatar) {
        el.innerHTML = `<img src="${currentUser.avatar}" alt="" class="nav-avatar-img">`;
    } else {
        const name = currentUser.fullName || currentUser.email || '';
        const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?';
        el.innerHTML = `<span class="nav-avatar-initials">${initials}</span>`;
    }

    // Admin link
    if (currentUser.role === 'admin' || currentUser.role === 'moderator') {
        const adminLink = document.getElementById('adminNavLink');
        if (adminLink) adminLink.style.display = '';
    }
}

// ═══════════════════════════════════════════
//  SUMMARY STRIP
// ═══════════════════════════════════════════
function renderSummary() {
    const trades = filteredTrades;
    const el = id => document.getElementById(id);

    if (trades.length === 0) {
        el('sTotalPnl').textContent = '$0.00';
        el('sWinRate').textContent = '—';
        el('sProfitFactor').textContent = '—';
        el('sTotalTrades').textContent = '0';
        el('sMaxDD').textContent = '—';
        el('sSubscribers').textContent = getSubscribersCount();
        return;
    }

    const totalPnl = trades.reduce((s, t) => s + pnlOf(t), 0);
    const wins = trades.filter(t => pnlOf(t) > 0);
    const losses = trades.filter(t => pnlOf(t) < 0);
    const winRate = trades.length > 0 ? (wins.length / trades.length * 100) : 0;
    const grossProfit = wins.reduce((s, t) => s + pnlOf(t), 0);
    const grossLoss = Math.abs(losses.reduce((s, t) => s + pnlOf(t), 0));
    const pf = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

    el('sTotalPnl').textContent = fmt(totalPnl);
    el('sTotalPnl').className = 'sc-value ' + (totalPnl >= 0 ? 'up' : 'down');

    const investment = botDetails?.bot?.investment || 0;
    if (investment > 0) {
        el('sTotalPnlPct').textContent = fmtPct(totalPnl / investment * 100);
    }

    el('sWinRate').textContent = winRate.toFixed(1) + '%';
    el('sWinCount').textContent = `${wins.length}W / ${losses.length}L`;
    el('sProfitFactor').textContent = pf === Infinity ? '∞' : pf.toFixed(2);
    el('sTotalTrades').textContent = trades.length;

    const days = new Set(trades.map(t => (t.closedAt || t.openedAt || '').slice(0, 10))).size;
    el('sAvgPerDay').textContent = days > 0 ? `~${(trades.length / days).toFixed(1)}/день` : '';

    let peak = 0, maxDD = 0, cum = 0;
    trades.forEach(t => { cum += pnlOf(t); if (cum > peak) peak = cum; const dd = peak - cum; if (dd > maxDD) maxDD = dd; });
    el('sMaxDD').textContent = '-$' + maxDD.toFixed(2);
    el('sSubscribers').textContent = getSubscribersCount();
}

// ═══════════════════════════════════════════
//  KPIs
// ═══════════════════════════════════════════
function renderKPIs() {
    const trades = filteredTrades;
    const wins = trades.filter(t => pnlOf(t) > 0);
    const losses = trades.filter(t => pnlOf(t) < 0);
    const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + pnlOf(t), 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + pnlOf(t), 0) / losses.length) : 0;
    const best = trades.length > 0 ? Math.max(...trades.map(pnlOf)) : 0;
    const worst = trades.length > 0 ? Math.min(...trades.map(pnlOf)) : 0;
    const rr = avgLoss > 0 ? (avgWin / avgLoss).toFixed(2) : '—';

    let totalMs = 0, durCount = 0;
    trades.forEach(t => { if (t.openedAt && t.closedAt) { totalMs += new Date(t.closedAt) - new Date(t.openedAt); durCount++; } });
    const avgMin = durCount > 0 ? Math.floor(totalMs / durCount / 60000) : 0;
    const avgDurStr = avgMin >= 1440 ? `${Math.floor(avgMin/1440)}d ${Math.floor((avgMin%1440)/60)}h` : avgMin >= 60 ? `${Math.floor(avgMin/60)}h ${avgMin%60}m` : `${avgMin}m`;

    const days = new Set(trades.map(t => (t.closedAt || t.openedAt || '').slice(0, 10))).size;

    const dailyPnl = {};
    trades.forEach(t => { const d = (t.closedAt || t.openedAt || '').slice(0, 10); dailyPnl[d] = (dailyPnl[d] || 0) + pnlOf(t); });
    const vals = Object.values(dailyPnl);
    const mean = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    const std = vals.length > 1 ? Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / (vals.length - 1)) : 0;
    const sharpe = std > 0 ? (mean / std * Math.sqrt(252)).toFixed(2) : '—';

    const el = id => document.getElementById(id);
    el('kAvgWin').textContent = fmt(avgWin); el('kAvgWin').style.color = 'var(--accent-green)';
    el('kAvgLoss').textContent = '-$' + avgLoss.toFixed(2); el('kAvgLoss').style.color = 'var(--accent-red)';
    el('kBestTrade').textContent = fmt(best); el('kBestTrade').style.color = 'var(--accent-green)';
    el('kWorstTrade').textContent = fmt(worst); el('kWorstTrade').style.color = 'var(--accent-red)';
    el('kRiskReward').textContent = rr;
    el('kAvgDuration').textContent = avgDurStr;
    el('kTradingDays').textContent = days;
    el('kSharpe').textContent = sharpe;
}

// ═══════════════════════════════════════════
//  RISK ASSESSMENT
// ═══════════════════════════════════════════
function renderRiskAssessment() {
    const trades = filteredTrades;
    if (trades.length === 0) return;
    const el = id => document.getElementById(id);

    let peak = 0, maxDD = 0, cum = 0;
    trades.forEach(t => { cum += pnlOf(t); if (cum > peak) peak = cum; const dd = peak - cum; if (dd > maxDD) maxDD = dd; });
    const investment = botDetails?.bot?.investment || 10000;
    const ddPct = (maxDD / investment * 100);
    el('riskMaxDD').textContent = ddPct.toFixed(1) + '%';
    el('riskMaxDDBar').style.width = Math.min(ddPct, 100) + '%';
    el('riskMaxDDBar').className = 'risk-meter-fill ' + (ddPct < 10 ? 'risk-low' : ddPct < 25 ? 'risk-medium' : 'risk-high');

    const dailyPnl = {};
    trades.forEach(t => { const d = (t.closedAt || t.openedAt || '').slice(0, 10); dailyPnl[d] = (dailyPnl[d] || 0) + pnlOf(t); });
    const vals = Object.values(dailyPnl);
    const mean = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0;
    const std = vals.length > 1 ? Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / (vals.length - 1)) : 0;
    const volPct = investment > 0 ? (std / investment * 100) : 0;
    el('riskVolatility').textContent = volPct.toFixed(1) + '%';
    el('riskVolBar').style.width = Math.min(volPct * 5, 100) + '%';
    el('riskVolBar').className = 'risk-meter-fill ' + (volPct < 2 ? 'risk-low' : volPct < 5 ? 'risk-medium' : 'risk-high');

    const positions = liveData?.positions?.filter(p => parseFloat(p.positionAmt) !== 0) || [];
    const totalExposure = positions.reduce((s, p) => s + Math.abs(parseFloat(p.notional || 0)), 0);
    const exposurePct = investment > 0 ? (totalExposure / investment * 100) : 0;
    el('riskExposure').textContent = exposurePct.toFixed(0) + '%';
    el('riskExpBar').style.width = Math.min(exposurePct, 100) + '%';
    el('riskExpBar').className = 'risk-meter-fill ' + (exposurePct < 50 ? 'risk-low' : exposurePct < 100 ? 'risk-medium' : 'risk-high');

    const riskScore = (ddPct / 50 + volPct / 10 + exposurePct / 200) / 3;
    const riskLevel = riskScore < 0.3 ? 'Низький' : riskScore < 0.6 ? 'Середній' : 'Високий';
    const riskColor = riskScore < 0.3 ? 'var(--accent-green)' : riskScore < 0.6 ? 'var(--accent-yellow)' : 'var(--accent-red)';
    el('riskOverall').textContent = riskLevel;
    el('riskOverall').style.color = riskColor;
}

// ═══════════════════════════════════════════
//  LIVE POSITION
// ═══════════════════════════════════════════
function renderLivePosition() {
    const container = document.getElementById('livePositionWrap');
    if (!container) return;

    const positions = liveData?.positions?.filter(p => parseFloat(p.positionAmt) !== 0) || [];
    if (positions.length === 0) {
        container.innerHTML = '<div style="padding:14px;color:var(--text-tertiary);font-size:12px;">Немає відкритих позицій</div>';
        return;
    }

    container.innerHTML = positions.map(p => {
        const side = parseFloat(p.positionAmt) > 0 ? 'LONG' : 'SHORT';
        const sideColor = side === 'LONG' ? 'var(--accent-green)' : 'var(--accent-red)';
        const pnl = parseFloat(p.unRealizedProfit || 0);
        const pnlColor = pnl >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
        const leverage = p.leverage || '—';
        return `<div style="padding:10px 14px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;">
            <div>
                <span style="font-family:var(--font-mono);font-weight:600;font-size:12px;">${p.symbol}</span>
                <span style="color:${sideColor};font-size:10px;font-weight:700;margin-left:6px;">${side} ${leverage}x</span>
            </div>
            <div style="text-align:right;">
                <div style="font-family:var(--font-mono);font-size:12px;font-weight:600;color:${pnlColor}">${fmt(pnl)}</div>
                <div style="font-family:var(--font-mono);font-size:10px;color:var(--text-tertiary)">Entry: ${fmtPrice(p.entryPrice)}</div>
            </div>
        </div>`;
    }).join('');
}

// ═══════════════════════════════════════════
//  LONG vs SHORT
// ═══════════════════════════════════════════
function renderLongShort() {
    const trades = filteredTrades;
    const longs = trades.filter(isLong);
    const shorts = trades.filter(t => !isLong(t));
    const longPnl = longs.reduce((s, t) => s + pnlOf(t), 0);
    const shortPnl = shorts.reduce((s, t) => s + pnlOf(t), 0);
    const longWr = longs.length > 0 ? (longs.filter(t => pnlOf(t) > 0).length / longs.length * 100).toFixed(0) : '—';
    const shortWr = shorts.length > 0 ? (shorts.filter(t => pnlOf(t) > 0).length / shorts.length * 100).toFixed(0) : '—';
    const wins = trades.filter(t => pnlOf(t) > 0).length;
    const losses = trades.filter(t => pnlOf(t) < 0).length;
    const total = wins + losses || 1;

    const el = id => document.getElementById(id);
    el('lsLongCount').textContent = longs.length;
    el('lsLongPnl').textContent = fmt(longPnl);
    el('lsLongPnl').style.color = longPnl >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
    el('lsLongWr').textContent = longWr + '%';
    el('lsShortCount').textContent = shorts.length;
    el('lsShortPnl').textContent = fmt(shortPnl);
    el('lsShortPnl').style.color = shortPnl >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
    el('lsShortWr').textContent = shortWr + '%';
    el('wlWins').textContent = `${wins} прибуткових`;
    el('wlLosses').textContent = `${losses} збиткових`;
    el('wlWinBar').style.width = (wins / total * 100) + '%';
    el('wlLossBar').style.width = (losses / total * 100) + '%';
}

// ═══════════════════════════════════════════
//  STREAKS
// ═══════════════════════════════════════════
function renderStreaks() {
    const trades = filteredTrades;
    let maxW = 0, maxL = 0, curW = 0, curL = 0;
    trades.forEach(t => { if (pnlOf(t) > 0) { curW++; curL = 0; if (curW > maxW) maxW = curW; } else if (pnlOf(t) < 0) { curL++; curW = 0; if (curL > maxL) maxL = curL; } });
    const lastPnl = trades.length > 0 ? pnlOf(trades[trades.length - 1]) : 0;
    const curStr = lastPnl > 0 ? `${curW}W` : lastPnl < 0 ? `${curL}L` : '—';

    const dailyPnl = {};
    trades.forEach(t => { const d = (t.closedAt || t.openedAt || '').slice(0, 10); dailyPnl[d] = (dailyPnl[d] || 0) + pnlOf(t); });
    const bestDay = Object.entries(dailyPnl).sort((a, b) => b[1] - a[1])[0];

    const el = id => document.getElementById(id);
    el('strWinStreak').textContent = maxW;
    el('strLossStreak').textContent = maxL;
    el('strCurStreak').textContent = curStr;
    el('strCurStreak').style.color = lastPnl > 0 ? 'var(--accent-green)' : lastPnl < 0 ? 'var(--accent-red)' : '';
    el('strBestDay').textContent = bestDay ? fmt(bestDay[1]) : '—';
    el('strBestDay').style.color = bestDay && bestDay[1] >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
}

// ═══════════════════════════════════════════
//  PNL CALENDAR (compact)
// ═══════════════════════════════════════════
function renderCalendar() {
    const year = calDate.getFullYear();
    const month = calDate.getMonth();
    const monthNames = ['Січень','Лютий','Березень','Квітень','Травень','Червень','Липень','Серпень','Вересень','Жовтень','Листопад','Грудень'];
    document.getElementById('calMonth').textContent = `${monthNames[month]} ${year}`;

    const dailyPnl = {};
    allTrades.forEach(t => { const d = (t.closedAt || t.openedAt || '').slice(0, 10); dailyPnl[d] = (dailyPnl[d] || 0) + pnlOf(t); });

    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const offset = firstDay === 0 ? 6 : firstDay - 1;

    let html = ['Пн','Вт','Ср','Чт','Пт','Сб','Нд'].map(d => `<div class="cal-header">${d}</div>`).join('');
    for (let i = 0; i < offset; i++) html += '<div class="cal-day empty"></div>';
    for (let d = 1; d <= daysInMonth; d++) {
        const key = `${year}-${String(month+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const pnl = dailyPnl[key] || 0;
        let cls = 'zero';
        if (pnl > 10) cls = 'profit-strong'; else if (pnl > 0) cls = 'profit';
        else if (pnl < -10) cls = 'loss-strong'; else if (pnl < 0) cls = 'loss';
        const title = pnl !== 0 ? `${key}: ${fmt(pnl)}` : key;
        html += `<div class="cal-day ${cls}" title="${title}"><span class="cal-num">${d}</span>${pnl !== 0 ? `<span class="cal-pnl">${pnl > 0 ? '+' : ''}${pnl.toFixed(0)}</span>` : ''}</div>`;
    }
    document.getElementById('calGrid').innerHTML = html;
}

function calNav(dir) { calDate.setMonth(calDate.getMonth() + dir); renderCalendar(); }

// ═══════════════════════════════════════════
//  PAIRS DISTRIBUTION
// ═══════════════════════════════════════════
function renderPairs() {
    const trades = filteredTrades;
    const byPair = {};
    trades.forEach(t => { const s = t.symbol || 'Unknown'; if (!byPair[s]) byPair[s] = { count: 0, pnl: 0 }; byPair[s].count++; byPair[s].pnl += pnlOf(t); });
    const sorted = Object.entries(byPair).sort((a, b) => b[1].count - a[1].count);
    const maxCount = sorted.length > 0 ? sorted[0][1].count : 1;

    document.getElementById('pairsBody').innerHTML = sorted.map(([sym, data]) => {
        const pct = (data.count / maxCount * 100).toFixed(0);
        const color = data.pnl >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
        return `<div class="pair-bar-row">
            <span class="pair-bar-label">${sym.replace('USDT','')}</span>
            <div class="pair-bar-track"><div class="pair-bar-fill" style="width:${pct}%;background:${color}"></div></div>
            <span class="pair-bar-value" style="color:${color}">${fmt(data.pnl)}</span>
        </div>`;
    }).join('') || '<div style="color:var(--text-tertiary);font-size:12px;">Немає даних</div>';
}

// ═══════════════════════════════════════════
//  HOURLY HEATMAP
// ═══════════════════════════════════════════
function renderHourly() {
    const hourData = Array(24).fill(null).map(() => ({ count: 0, pnl: 0 }));
    filteredTrades.forEach(t => { const h = t.closedAt ? new Date(t.closedAt).getUTCHours() : null; if (h !== null) { hourData[h].count++; hourData[h].pnl += pnlOf(t); } });
    const maxCount = Math.max(...hourData.map(h => h.count), 1);

    let html = '';
    for (let i = 0; i < 24; i++) {
        const d = hourData[i];
        const intensity = d.count / maxCount;
        let bg = 'var(--surface-secondary)';
        if (d.count > 0) bg = d.pnl >= 0 ? `rgba(16,185,129,${0.08 + intensity * 0.25})` : `rgba(239,68,68,${0.08 + intensity * 0.25})`;
        const color = d.count === 0 ? 'var(--text-tertiary)' : d.pnl >= 0 ? '#10B981' : '#EF4444';
        html += `<div class="hour-cell" style="background:${bg}" title="${i}:00 — ${d.count} угод, ${fmt(d.pnl)}"><div class="hour-label">${String(i).padStart(2,'0')}</div><div style="color:${color}">${d.count || '·'}</div></div>`;
    }
    document.getElementById('hourGrid').innerHTML = html;
}

// ═══════════════════════════════════════════
//  EQUITY CHART
// ═══════════════════════════════════════════
function renderEquityChart() {
    const canvas = document.getElementById('equityCanvas');
    const wrap = document.getElementById('equityChartWrap');
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = wrap.clientWidth * 2; canvas.height = wrap.clientHeight * 2;
    ctx.scale(2, 2);
    const W = wrap.clientWidth, H = wrap.clientHeight;
    ctx.clearRect(0, 0, W, H);

    if (filteredTrades.length === 0) {
        ctx.fillStyle = '#636363'; ctx.font = '13px Plus Jakarta Sans'; ctx.textAlign = 'center';
        ctx.fillText('Немає даних', W / 2, H / 2); return;
    }

    const cumPnl = []; let cum = 0;
    filteredTrades.forEach(t => { cum += pnlOf(t); cumPnl.push(cum); });
    const minV = Math.min(0, ...cumPnl), maxV = Math.max(0, ...cumPnl), range = maxV - minV || 1;
    const pad = { top: 20, bottom: 20, left: 10, right: 10 };
    const chartW = W - pad.left - pad.right, chartH = H - pad.top - pad.bottom;
    const toX = i => pad.left + (i / (cumPnl.length - 1 || 1)) * chartW;
    const toY = v => pad.top + (1 - (v - minV) / range) * chartH;

    const zeroY = toY(0);
    ctx.strokeStyle = 'rgba(255,255,255,0.06)'; ctx.lineWidth = 1; ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(pad.left, zeroY); ctx.lineTo(W - pad.right, zeroY); ctx.stroke(); ctx.setLineDash([]);

    // Helper: draw filled area between curve and zero line using clipping
    const drawFill = (isAbove) => {
        const clipTop    = isAbove ? pad.top        : zeroY;
        const clipBottom = isAbove ? zeroY          : H - pad.bottom;
        const gradTop    = isAbove ? pad.top        : zeroY;
        const gradBot    = isAbove ? zeroY          : H - pad.bottom;
        const colFull    = isAbove ? 'rgba(16,185,129,' : 'rgba(239,68,68,';

        const g = ctx.createLinearGradient(0, gradTop, 0, gradBot);
        if (isAbove) {
            // shadow strongest near the curve (top), fades to zero at the baseline
            g.addColorStop(0,    colFull + '0.22)');
            g.addColorStop(0.55, colFull + '0.07)');
            g.addColorStop(1,    colFull + '0.00)');
        } else {
            // shadow strongest near the curve (bottom), fades to zero at the baseline
            g.addColorStop(0,    colFull + '0.00)');
            g.addColorStop(0.45, colFull + '0.07)');
            g.addColorStop(1,    colFull + '0.22)');
        }

        ctx.save();
        ctx.beginPath();
        ctx.rect(pad.left, clipTop, chartW, clipBottom - clipTop + 1);
        ctx.clip();

        ctx.beginPath();
        ctx.moveTo(toX(0), toY(cumPnl[0]));
        for (let i = 1; i < cumPnl.length; i++) ctx.lineTo(toX(i), toY(cumPnl[i]));
        ctx.lineTo(toX(cumPnl.length - 1), zeroY);
        ctx.lineTo(toX(0), zeroY);
        ctx.closePath();
        ctx.fillStyle = g;
        ctx.fill();
        ctx.restore();
    };

    if (maxV > 0) drawFill(true);
    if (minV < 0) drawFill(false);

    const lastVal = cumPnl[cumPnl.length - 1];
    ctx.beginPath(); ctx.moveTo(toX(0), toY(cumPnl[0]));
    for (let i = 1; i < cumPnl.length; i++) ctx.lineTo(toX(i), toY(cumPnl[i]));
    ctx.strokeStyle = lastVal >= 0 ? '#10B981' : '#EF4444'; ctx.lineWidth = 2; ctx.stroke();

    const lastX = toX(cumPnl.length - 1), lastY = toY(lastVal);
    ctx.beginPath(); ctx.arc(lastX, lastY, 4, 0, Math.PI * 2);
    ctx.fillStyle = lastVal >= 0 ? '#10B981' : '#EF4444'; ctx.fill();
    ctx.font = '600 11px JetBrains Mono'; ctx.textAlign = 'right';
    ctx.fillStyle = lastVal >= 0 ? '#10B981' : '#EF4444';
    ctx.fillText(fmt(lastVal), lastX - 8, lastY - 8);
}

// ═══════════════════════════════════════════
//  DRAWDOWN CHART
// ═══════════════════════════════════════════
function renderDrawdownChart() {
    const canvas = document.getElementById('ddCanvas');
    const wrap = document.getElementById('ddChartWrap');
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext('2d');
    canvas.width = wrap.clientWidth * 2; canvas.height = wrap.clientHeight * 2;
    ctx.scale(2, 2);
    const W = wrap.clientWidth, H = wrap.clientHeight;
    ctx.clearRect(0, 0, W, H);
    if (filteredTrades.length === 0) return;

    const dd = []; let cum = 0, peak = 0;
    filteredTrades.forEach(t => { cum += pnlOf(t); if (cum > peak) peak = cum; dd.push(peak - cum); });
    const maxDD = Math.max(...dd, 0.01);
    const pad = { top: 10, bottom: 10, left: 10, right: 10 };
    const chartW = W - pad.left - pad.right, chartH = H - pad.top - pad.bottom;
    const toX = i => pad.left + (i / (dd.length - 1 || 1)) * chartW;
    const toY = v => pad.top + (v / maxDD) * chartH;

    ctx.beginPath(); ctx.moveTo(toX(0), pad.top);
    for (let i = 0; i < dd.length; i++) ctx.lineTo(toX(i), toY(dd[i]));
    ctx.lineTo(toX(dd.length - 1), pad.top); ctx.closePath();
    ctx.fillStyle = 'rgba(239,68,68,0.1)'; ctx.fill();

    ctx.beginPath(); ctx.moveTo(toX(0), toY(dd[0]));
    for (let i = 1; i < dd.length; i++) ctx.lineTo(toX(i), toY(dd[i]));
    ctx.strokeStyle = 'rgba(239,68,68,0.5)'; ctx.lineWidth = 1.5; ctx.stroke();

    const maxIdx = dd.indexOf(maxDD);
    ctx.fillStyle = '#EF4444'; ctx.font = '600 10px JetBrains Mono'; ctx.textAlign = 'center';
    ctx.fillText('-$' + maxDD.toFixed(2), toX(maxIdx), toY(maxDD) + 14);
}

// ═══════════════════════════════════════════
//  INTERACTIVE CANDLESTICK CHART — klinecharts
// ═══════════════════════════════════════════
let _klineChart = null;
let _klineMarkerGroup = 'trm-0';
let _klineMarkerIdx = 0;
let _klineMarkerRegistered = false;
let _tradeGroupingEnabled = true;

function toggleTradeGrouping() {
    _tradeGroupingEnabled = !_tradeGroupingEnabled;
    const btn = document.getElementById('indGroupTrades');
    if (btn) btn.classList.toggle('active', _tradeGroupingEnabled);
    renderLiveChart();
}

function _groupMarkersByCandle(markers) {
    if (!markers || markers.length === 0) return [];
    // Determine candle interval in seconds from currentTF
    const tfMap = { '1s':1, '2s':2, '5s':5, '15s':15, '30s':30, '1m':60, '3m':180, '5m':300, '15m':900, '30m':1800, '1h':3600, '2h':7200, '4h':14400, '1d':86400, '1w':604800 };
    const ivSec = tfMap[currentTF] || 900;
    const buckets = {};
    for (const m of markers) {
        const bucket = Math.floor(m.time / ivSec) * ivSec;
        const key = bucket + '_' + (m.isEntry ? 'entry' : 'exit');
        if (!buckets[key]) buckets[key] = { time: bucket, side: m.side, price: 0, pnl: 0, isEntry: m.isEntry, qty: 0, count: 0, symbol: m.symbol, status: m.status };
        const g = buckets[key];
        g.qty += (m.qty || 0);
        g.pnl += (m.pnl || 0);
        g.count++;
        // Weighted average price
        g.price = g.count === 1 ? m.price : (g.price * (g.count - 1) + m.price) / g.count;
    }
    return Object.values(buckets).sort((a, b) => a.time - b.time);
}

function _scheduleChartRender() {
    // klinecharts handles its own render loop — just call renderLiveChart directly
    renderLiveChart();
}

function _registerTradeMarkerOverlay() {
    if (_klineMarkerRegistered || !window.klinecharts) return;
    try {
        window.klinecharts.registerOverlay({
            name: 'tradeMarker',
            totalStep: 1,
            needDefaultPointFigure: false,
            needDefaultXAxisFigure: false,
            needDefaultYAxisFigure: false,
            createPointFigures({ overlay, coordinates }) {
                const c = coordinates && coordinates[0];
                if (!c) return [];
                const data  = overlay.extendData || {};
                const isBuy = data.isBuy === true;
                // Contrasting colors so markers don't blend with candles
                const color = isBuy ? '#22D3EE' : '#F59E0B';
                const size  = 7, offset = 12;
                let coords;
                if (isBuy) {
                    const tipY = c.y + offset;
                    coords = [
                        { x: c.x,        y: tipY },
                        { x: c.x - size, y: tipY + size * 1.5 },
                        { x: c.x + size, y: tipY + size * 1.5 },
                    ];
                } else {
                    const tipY = c.y - offset;
                    coords = [
                        { x: c.x,        y: tipY },
                        { x: c.x - size, y: tipY - size * 1.5 },
                        { x: c.x + size, y: tipY - size * 1.5 },
                    ];
                }
                return [
                    { type: 'circle', attrs: { x: c.x, y: coords[0].y, r: size + 2 }, styles: { style: 'fill', color: 'rgba(0,0,0,0.4)' }, ignoreEvent: true },
                    { type: 'polygon', attrs: { coordinates: coords }, styles: { style: 'fill', color }, ignoreEvent: true },
                ];
            },
        });
        _klineMarkerRegistered = true;
    } catch (e) { /* already registered */ }
}

function _getOrInitKlineChart() {
    if (_klineChart) return _klineChart;
    const el = document.getElementById('liveChartCanvas');
    if (!el || !window.klinecharts) return null;

    _registerTradeMarkerOverlay();

    _klineChart = window.klinecharts.init(el);
    if (!_klineChart) return null;
    window._klineChart = _klineChart; // expose for chart expand resize

    // Dark theme styles
    _klineChart.setStyles({
        grid: {
            horizontal: { color: 'rgba(255,255,255,0.04)' },
            vertical:   { color: 'rgba(255,255,255,0.04)' },
        },
        candle: {
            upColor:       '#10B981',
            downColor:     '#EF4444',
            noChangeColor: '#A1A1A1',
            bar: {
                upColor:         '#10B981', downColor:         '#EF4444', noChangeColor:   '#A1A1A1',
                upBorderColor:   '#10B981', downBorderColor:   '#EF4444', noChangeBorderColor: '#A1A1A1',
                upWickColor:     '#10B981', downWickColor:     '#EF4444', noChangeWickColor:   '#A1A1A1',
            },
        },
    });

    return _klineChart;
}

function initChartInteraction() {
    // klinecharts handles its own scroll/zoom/crosshair/touch interactions
    // This function is kept for API compatibility with init.js
    _getOrInitKlineChart();
}

function renderLiveChart() {
    const chart = _getOrInitKlineChart();

    // Update symbol label
    const symbolLabel = document.getElementById('chartSymbolLabel');
    if (symbolLabel) symbolLabel.textContent = getSymbol();

    if (!chart) return;

    if (!klineData || klineData.length === 0) return;

    // Normalize kline data → klinecharts format (timestamp in ms)
    const data = klineData.map(k => {
        if (Array.isArray(k)) {
            return { timestamp: k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5] };
        }
        // k.time is in seconds (from API), klinecharts expects ms
        return { timestamp: k.time * 1000, open: +k.open, high: +k.high, low: +k.low, close: +k.close, volume: +(k.volume || 0) };
    });

    chart.applyNewData(data);

    // Remove old trade marker overlays and redraw
    try { chart.removeOverlay({ groupId: _klineMarkerGroup }); } catch (e) { /* ok */ }
    _klineMarkerGroup = `trm-${++_klineMarkerIdx}`;

    if (tradeMarkers && tradeMarkers.length > 0) {
        const displayMarkers = _tradeGroupingEnabled ? _groupMarkersByCandle(tradeMarkers) : tradeMarkers;
        for (const m of displayMarkers) {
            const isLongSide = m.side === 'LONG' || m.side === 'BUY';
            try {
                chart.createOverlay({
                    name:       'tradeMarker',
                    groupId:    _klineMarkerGroup,
                    lock:       true,
                    points:     [{ timestamp: m.time * 1000, value: m.price }],
                    extendData: { isBuy: m.isEntry ? isLongSide : null, isExit: !m.isEntry },
                });
            } catch (e) { /* ok */ }
        }
    }
}

// ═══════════════════════════════════════════
//  RECENT TRADES TABLE
// ═══════════════════════════════════════════
function renderRecentTrades() {
    const trades = filteredTrades.slice(-50).reverse();
    document.getElementById('recentTradesCount').textContent = `${trades.length} з ${filteredTrades.length}`;

    document.getElementById('recentTradesBody').innerHTML = trades.map(t => {
        const pnl = pnlOf(t);
        const side = isLong(t) ? 'LONG' : 'SHORT';
        const badgeCls = isLong(t) ? 'badge-long' : 'badge-short';
        const dt = t.closedAt ? new Date(t.closedAt) : null;
        const openDt = t.openedAt ? new Date(t.openedAt) : null;
        let dur = '—';
        if (dt && openDt) {
            const mins = Math.floor((dt - openDt) / 60000);
            dur = mins >= 1440 ? `${Math.floor(mins/1440)}d` : mins >= 60 ? `${Math.floor(mins/60)}h ${mins%60}m` : `${mins}m`;
        }
        const dateStr = dt ? dt.toLocaleDateString('uk-UA', { day:'2-digit', month:'2-digit', timeZone:'UTC' }) + ' ' + dt.toLocaleTimeString('uk-UA', { hour:'2-digit', minute:'2-digit', timeZone:'UTC' }) : '—';
        return `<tr>
            <td class="mono">${(t.symbol||'').replace('USDT','')}</td>
            <td><span class="${badgeCls}">${side}</span></td>
            <td class="mono">$${fmtPrice(t.price||0)}</td>
            <td class="mono">${parseFloat(t.quantity||0).toFixed(4)}</td>
            <td class="mono" style="color:${pnl >= 0 ? 'var(--accent-green)' : 'var(--accent-red)'}">${fmt(pnl)}</td>
            <td style="color:var(--text-tertiary)">${dur}</td>
            <td style="color:var(--text-tertiary);font-size:11px;">${dateStr}</td>
        </tr>`;
    }).join('');
}

// ═══════════════════════════════════════════
//  SUBSCRIBE SECTION
// ═══════════════════════════════════════════
function renderSubscribeSection() {
    const btn = document.getElementById('subscribeBtn');
    const statusEl = document.getElementById('subscribeStatus');
    const badge = document.getElementById('connectFormBadge');
    if (!btn) return;

    if (isSubscribed) {
        btn.textContent = 'Підписано';
        btn.className = 'btn-connect-main subscribed';
        statusEl.textContent = `${getSubscribersCount()} підписників`;
        if (badge) { badge.textContent = 'Підключено'; badge.className = 'connect-form-badge active'; }
    } else {
        btn.textContent = 'Підписатися';
        btn.className = 'btn-connect-main';
        statusEl.textContent = `${getSubscribersCount()} підписників`;
        if (badge) { badge.textContent = 'Не підключено'; badge.className = 'connect-form-badge'; }
    }
}

// ═══════════════════════════════════════════
//  TELEGRAM NOTIFICATIONS
// ═══════════════════════════════════════════
function renderTelegramSection() {
    const body = document.getElementById('telegramBody');
    const badge = document.getElementById('tgStatusBadge');
    if (!body || !badge) return;

    const isLinked = telegramStatus?.linked || telegramStatus?.isLinked || false;

    if (isLinked) {
        badge.textContent = "Під'єднано";
        badge.className = 'tg-status-badge linked';
    } else {
        badge.textContent = "Не під'єднано";
        badge.className = 'tg-status-badge not-linked';
    }

    if (!isLinked) {
        body.innerHTML = `
            <div class="tg-link-section">
                <p>Підключіть Telegram — отримуйте сповіщення про угоди, SL/TP, звіти прямо в месенджер.</p>
                <button class="btn-tg btn-tg-save" id="tgLinkBtn" style="width:auto;padding:8px 20px;">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>
                    Під'єднати
                </button>
                <div id="tgLinkCode" style="display:none;"></div>
            </div>`;
        document.getElementById('tgLinkBtn')?.addEventListener('click', startTelegramLink);
        return;
    }

    const s = notificationSettings || {};
    const chk = (val) => val ? 'checked' : '';

    const toggleItem = (id, icon, label, val) =>
        `<label class="tg-chip ${val ? 'on' : ''}" for="${id}">
            <input type="checkbox" id="${id}" ${chk(val)}>
            <span class="tg-chip-icon">${icon}</span>
            <span class="tg-chip-text">${label}</span>
        </label>`;

    body.innerHTML = `
        <div class="tg-compact">
            <div class="tg-toggles-grid">
                ${toggleItem('tgNewTrade', '📈', 'Нова угода', s.notify_new_trade)}
                ${toggleItem('tgCloseTrade', '📊', 'Закриття', s.notify_close_trade)}
                ${toggleItem('tgStopLoss', '🛑', 'Стоп-лосс', s.notify_stop_loss)}
                ${toggleItem('tgTakeProfit', '🎯', 'Тейк-профіт', s.notify_take_profit)}
                ${toggleItem('tgPositionChange', '🔄', 'Зміна позиції', s.notify_position_change)}
                ${toggleItem('tgDailySummary', '📋', 'Денний звіт', s.notify_daily_summary)}
                ${toggleItem('tgWeeklySummary', '📅', 'Тижневий звіт', s.notify_weekly_summary)}
                ${toggleItem('tgDrawdownAlert', '⚠️', 'Просадка', s.notify_drawdown_alert)}
            </div>

            <div class="tg-inline-settings">
                <div class="tg-inline-item">
                    <span class="tg-inline-label">Поріг PnL</span>
                    <div class="tg-inline-input-wrap">
                        <input type="number" class="tg-inline-input" id="tgPnlThreshold" value="${s.notify_pnl_threshold || 0}" placeholder="0">
                        <span class="tg-inline-suffix">$</span>
                    </div>
                </div>
                <div class="tg-inline-item">
                    <span class="tg-inline-label">Поріг просадки</span>
                    <div class="tg-inline-input-wrap">
                        <input type="number" class="tg-inline-input" id="tgDrawdownThreshold" value="${s.notify_drawdown_threshold || 10}" placeholder="10">
                        <span class="tg-inline-suffix">%</span>
                    </div>
                </div>
                <div class="tg-inline-item">
                    <span class="tg-inline-label">Доставка</span>
                    <select class="tg-inline-select" id="tgMethod">
                        <option value="both" ${s.notify_method === 'both' || !s.notify_method ? 'selected' : ''}>TG + App</option>
                        <option value="telegram" ${s.notify_method === 'telegram' ? 'selected' : ''}>Telegram</option>
                        <option value="in-app" ${s.notify_method === 'in-app' ? 'selected' : ''}>В додатку</option>
                    </select>
                </div>
                <div class="tg-inline-item">
                    <span class="tg-inline-label">Тиха година</span>
                    <div style="display:flex;gap:3px;align-items:center;">
                        <input type="number" class="tg-inline-input" id="tgQuietFrom" value="${s.quiet_hour_from ?? ''}" placeholder="—" min="0" max="23" style="width:38px;">
                        <span style="color:var(--text-tertiary);font-size:10px;">–</span>
                        <input type="number" class="tg-inline-input" id="tgQuietTo" value="${s.quiet_hour_to ?? ''}" placeholder="—" min="0" max="23" style="width:38px;">
                        <span class="tg-inline-suffix">UTC</span>
                    </div>
                </div>
            </div>

            <div class="tg-bottom-bar">
                <button class="btn-tg btn-tg-save" id="tgSaveBtn">Зберегти</button>
                <button class="btn-tg btn-tg-test" id="tgTestBtn">Тест</button>
                <button class="btn-tg btn-tg-unlink" id="tgUnlinkBtn">Від'єднати</button>
            </div>
        </div>`;

    // Bind chip toggle class updates
    body.querySelectorAll('.tg-chip input[type="checkbox"]').forEach(cb => {
        cb.addEventListener('change', () => cb.parentElement.classList.toggle('on', cb.checked));
    });

    document.getElementById('tgSaveBtn')?.addEventListener('click', saveTgSettings);
    document.getElementById('tgTestBtn')?.addEventListener('click', testTgNotification);
    document.getElementById('tgUnlinkBtn')?.addEventListener('click', unlinkTg);
}

// ═══════════════════════════════════════════
//  RESIZABLE PANELS
// ═══════════════════════════════════════════
function initResizablePanels() {
    document.querySelectorAll('.card[data-resizable]').forEach(card => {
        if (card._resizeBound) return;
        card._resizeBound = true;

        const handle = card.querySelector('.resize-handle');
        if (!handle) return;

        let startY, startH;
        handle.addEventListener('mousedown', e => {
            e.preventDefault();
            startY = e.clientY;
            startH = card.offsetHeight;
            const onMove = ev => {
                const newH = Math.max(120, startH + ev.clientY - startY);
                card.style.height = newH + 'px';
                // Re-render charts inside card after resize
                requestAnimationFrame(() => {
                    const canvas = card.querySelector('canvas');
                    if (canvas) {
                        if (canvas.id === 'equityCanvas') renderEquityChart();
                        else if (canvas.id === 'ddCanvas') renderDrawdownChart();
                    }
                    // klinecharts handles its own resize via ResizeObserver
                    if (card.querySelector('#liveChartCanvas')) renderLiveChart();
                });
            };
            const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
        });
    });
}
