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
    document.getElementById('backBtn').href = `/bot/${botId}`;
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

    const lastVal = cumPnl[cumPnl.length - 1];
    const grad = ctx.createLinearGradient(0, pad.top, 0, H - pad.bottom);
    if (lastVal >= 0) { grad.addColorStop(0, 'rgba(16,185,129,0.15)'); grad.addColorStop(1, 'rgba(16,185,129,0)'); }
    else { grad.addColorStop(0, 'rgba(239,68,68,0)'); grad.addColorStop(1, 'rgba(239,68,68,0.15)'); }

    ctx.beginPath(); ctx.moveTo(toX(0), toY(cumPnl[0]));
    for (let i = 1; i < cumPnl.length; i++) ctx.lineTo(toX(i), toY(cumPnl[i]));
    ctx.lineTo(toX(cumPnl.length - 1), H - pad.bottom); ctx.lineTo(toX(0), H - pad.bottom);
    ctx.closePath(); ctx.fillStyle = grad; ctx.fill();

    ctx.beginPath(); ctx.moveTo(toX(0), toY(cumPnl[0]));
    for (let i = 1; i < cumPnl.length; i++) ctx.lineTo(toX(i), toY(cumPnl[i]));
    ctx.strokeStyle = lastVal >= 0 ? '#10B981' : '#EF4444'; ctx.lineWidth = 2; ctx.stroke();

    const lastX = toX(cumPnl.length - 1), lastY = toY(lastVal);
    ctx.beginPath(); ctx.arc(lastX, lastY, 4, 0, Math.PI * 2);
    ctx.fillStyle = lastVal >= 0 ? '#10B981' : '#EF4444'; ctx.fill();
    ctx.font = '600 11px JetBrains Mono'; ctx.textAlign = 'right';
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
//  INTERACTIVE CANDLESTICK CHART
//  - scroll (mouse wheel), drag to pan
//  - crosshair on hover, OHLCV tooltip
//  - trade markers overlay
// ═══════════════════════════════════════════
const chartState = {
    offset: 0, visibleCount: 80,
    isDragging: false, dragStartX: 0, dragStartOffset: 0,
    mouseX: -1, mouseY: -1,
    autoScroll: true, // pin to right edge when true
    _rafId: 0,
};

function _scheduleChartRender() {
    if (chartState._rafId) return;
    chartState._rafId = requestAnimationFrame(() => { chartState._rafId = 0; renderLiveChart(); });
}

function initChartInteraction() {
    const canvas = document.getElementById('liveChartCanvas');
    if (!canvas || canvas._chartBound) return;
    canvas._chartBound = true;

    // Wheel → zoom (centered around cursor)
    canvas.addEventListener('wheel', e => {
        e.preventDefault();
        const rect = canvas.getBoundingClientRect();
        const mouseRatio = (e.clientX - rect.left) / rect.width; // 0..1 where cursor is
        const oldCount = chartState.visibleCount;

        // Smoother zoom: proportional to current zoom level
        const zoomFactor = e.deltaY > 0 ? 1.08 : 0.93;
        chartState.visibleCount = Math.round(Math.max(10, Math.min(klineData.length, chartState.visibleCount * zoomFactor)));

        // Adjust offset to keep candle under cursor stable
        const delta = chartState.visibleCount - oldCount;
        const offsetShift = Math.round(delta * mouseRatio);
        chartState.offset = Math.max(0, Math.min(klineData.length - chartState.visibleCount, chartState.offset - offsetShift));
        chartState.autoScroll = (chartState.offset >= klineData.length - chartState.visibleCount);
        _scheduleChartRender();
    }, { passive: false });

    // Drag to pan
    canvas.addEventListener('mousedown', e => {
        if (e.button !== 0) return;
        chartState.isDragging = true;
        chartState.dragStartX = e.clientX;
        chartState.dragStartOffset = chartState.offset;
        canvas.style.cursor = 'grabbing';
    });
    window.addEventListener('mousemove', e => {
        if (chartState.isDragging) {
            const rect = canvas.getBoundingClientRect();
            const pxPerCandle = rect.width / chartState.visibleCount;
            const dx = chartState.dragStartX - e.clientX;
            const candleDelta = Math.round(dx / pxPerCandle);
            chartState.offset = Math.max(0, Math.min(klineData.length - chartState.visibleCount, chartState.dragStartOffset + candleDelta));
            chartState.autoScroll = (chartState.offset >= klineData.length - chartState.visibleCount);
            _scheduleChartRender();
        }
    });
    window.addEventListener('mouseup', () => {
        if (chartState.isDragging) {
            chartState.isDragging = false;
            const c = document.getElementById('liveChartCanvas');
            if (c) c.style.cursor = 'crosshair';
        }
    });

    // Double-click → reset to latest (auto-scroll on)
    canvas.addEventListener('dblclick', () => {
        chartState.visibleCount = 80;
        chartState.offset = Math.max(0, klineData.length - chartState.visibleCount);
        chartState.autoScroll = true;
        _scheduleChartRender();
    });

    // Crosshair
    canvas.addEventListener('mousemove', e => {
        if (chartState.isDragging) return;
        const rect = canvas.getBoundingClientRect();
        chartState.mouseX = e.clientX - rect.left;
        chartState.mouseY = e.clientY - rect.top;
        _scheduleChartRender();
    });
    canvas.addEventListener('mouseleave', () => {
        chartState.mouseX = -1; chartState.mouseY = -1;
        _scheduleChartRender();
    });

    // Touch support (mobile pan)
    let touchStartX = 0, touchStartOffset = 0;
    canvas.addEventListener('touchstart', e => {
        if (e.touches.length === 1) {
            touchStartX = e.touches[0].clientX;
            touchStartOffset = chartState.offset;
        }
    }, { passive: true });
    canvas.addEventListener('touchmove', e => {
        if (e.touches.length === 1) {
            e.preventDefault();
            const rect = canvas.getBoundingClientRect();
            const pxPerCandle = rect.width / chartState.visibleCount;
            const dx = touchStartX - e.touches[0].clientX;
            chartState.offset = Math.max(0, Math.min(klineData.length - chartState.visibleCount, touchStartOffset + Math.round(dx / pxPerCandle)));
            chartState.autoScroll = (chartState.offset >= klineData.length - chartState.visibleCount);
            _scheduleChartRender();
        }
    }, { passive: false });
}

function renderLiveChart() {
    const canvas = document.getElementById('liveChartCanvas');
    const wrap = document.querySelector('.chart-area');
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 2;
    canvas.width = wrap.clientWidth * dpr; canvas.height = wrap.clientHeight * dpr;
    ctx.scale(dpr, dpr);
    const W = wrap.clientWidth, H = wrap.clientHeight;
    ctx.clearRect(0, 0, W, H);

    if (!klineData || klineData.length === 0) {
        ctx.fillStyle = '#636363'; ctx.font = '13px Plus Jakarta Sans'; ctx.textAlign = 'center';
        ctx.fillText('Завантаження графіка...', W / 2, H / 2); return;
    }

    // Parse all klines
    const allCandles = klineData.map(k => Array.isArray(k)
        ? { time: k[0], open: parseFloat(k[1]), high: parseFloat(k[2]), low: parseFloat(k[3]), close: parseFloat(k[4]), volume: parseFloat(k[5]) }
        : { time: k.time, open: parseFloat(k.open), high: parseFloat(k.high), low: parseFloat(k.low), close: parseFloat(k.close), volume: parseFloat(k.volume) }
    );

    // Clamp offset
    if (chartState.visibleCount > allCandles.length) chartState.visibleCount = allCandles.length;
    if (chartState.autoScroll) chartState.offset = Math.max(0, allCandles.length - chartState.visibleCount);
    if (chartState.offset > allCandles.length - chartState.visibleCount) chartState.offset = Math.max(0, allCandles.length - chartState.visibleCount);

    const start = chartState.offset;
    const candles = allCandles.slice(start, start + chartState.visibleCount);
    if (candles.length === 0) return;

    const pad = { top: 20, bottom: 30, left: 60, right: 80 };
    const cW = W - pad.left - pad.right, cH = H - pad.top - pad.bottom;
    const allH = candles.map(c => c.high), allL = candles.map(c => c.low);
    const minP = Math.min(...allL), maxP = Math.max(...allH), range = maxP - minP || 1;
    const candleW = Math.max(1.5, (cW / candles.length) * 0.7);
    const gap = cW / candles.length;
    const toX = i => pad.left + i * gap + gap / 2;
    const toY = p => pad.top + (1 - (p - minP) / range) * cH;

    const firstTime = candles[0].time;
    const lastTime = candles[candles.length - 1].time;
    const candleInterval = candles.length > 1 ? candles[1].time - candles[0].time : 1;

    // Grid lines + price labels
    ctx.strokeStyle = 'rgba(255,255,255,0.04)'; ctx.lineWidth = 1;
    const gridSteps = 6;
    for (let i = 0; i <= gridSteps; i++) {
        const p = minP + (range / gridSteps) * i;
        const y = toY(p);
        ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke();
        ctx.fillStyle = '#505050'; ctx.font = '500 9px JetBrains Mono'; ctx.textAlign = 'right';
        ctx.fillText(fmtPrice(p), pad.left - 6, y + 3);
    }

    // Time labels at bottom
    ctx.fillStyle = '#505050'; ctx.font = '500 9px JetBrains Mono'; ctx.textAlign = 'center';
    const labelEvery = Math.max(1, Math.floor(candles.length / 6));
    candles.forEach((c, i) => {
        if (i % labelEvery !== 0) return;
        const d = new Date(c.time * 1000);
        const label = d.getUTCHours() === 0 && d.getUTCMinutes() === 0
            ? `${d.getUTCDate()}/${d.getUTCMonth()+1}`
            : `${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`;
        ctx.fillText(label, toX(i), H - pad.bottom + 14);
    });

    // Volume
    const maxVol = Math.max(...candles.map(c => c.volume), 1);
    const volH = cH * 0.1;
    candles.forEach((c, i) => {
        const x = toX(i), h = (c.volume / maxVol) * volH;
        ctx.fillStyle = c.close >= c.open ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)';
        ctx.fillRect(x - candleW / 2, pad.top + cH - h, candleW, h);
    });

    // Candles
    candles.forEach((c, i) => {
        const x = toX(i);
        const color = c.close >= c.open ? '#10B981' : '#EF4444';
        ctx.strokeStyle = color; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, toY(c.high)); ctx.lineTo(x, toY(c.low)); ctx.stroke();
        const bodyTop = toY(Math.max(c.open, c.close));
        const bodyBot = toY(Math.min(c.open, c.close));
        ctx.fillStyle = color; ctx.fillRect(x - candleW / 2, bodyTop, candleW, Math.max(bodyBot - bodyTop, 1));
    });

    // ── Trade Markers ──
    if (tradeMarkers && tradeMarkers.length > 0) {
        const firstSec = firstTime;
        const lastSec = lastTime;
        const intervalSec = candleInterval;

        const visible = tradeMarkers.filter(m => m.time >= firstSec - intervalSec && m.time <= lastSec + intervalSec);

        const entries = visible.filter(m => m.isEntry);
        const exits = visible.filter(m => !m.isEntry);
        for (const entry of entries) {
            const exit = exits.find(e => e.side === entry.side && e.time > entry.time);
            if (exit) {
                const ei = (entry.time - firstTime) / (candleInterval || 1);
                const xi = (exit.time - firstTime) / (candleInterval || 1);
                const pnl = parseFloat(exit.pnl || 0);
                ctx.strokeStyle = pnl >= 0 ? 'rgba(16,185,129,0.25)' : 'rgba(239,68,68,0.25)';
                ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
                ctx.beginPath(); ctx.moveTo(toX(ei), toY(entry.price)); ctx.lineTo(toX(xi), toY(exit.price)); ctx.stroke();
                ctx.setLineDash([]);
            }
        }

        for (const m of visible) {
            const iFloat = (m.time - firstTime) / (candleInterval || 1);
            const mx = toX(iFloat), my = toY(m.price);
            const isLongSide = m.side === 'LONG' || m.side === 'BUY';
            const size = 6;

            if (m.isEntry) {
                const color = isLongSide ? '#10B981' : '#EF4444';
                ctx.fillStyle = color;
                ctx.beginPath();
                if (isLongSide) { const ty = my + 6; ctx.moveTo(mx, ty); ctx.lineTo(mx - size, ty + size * 1.4); ctx.lineTo(mx + size, ty + size * 1.4); }
                else { const ty = my - 6; ctx.moveTo(mx, ty); ctx.lineTo(mx - size, ty - size * 1.4); ctx.lineTo(mx + size, ty - size * 1.4); }
                ctx.closePath(); ctx.fill();
            } else {
                const pnl = parseFloat(m.pnl || 0);
                const color = pnl >= 0 ? '#10B981' : '#EF4444';
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.moveTo(mx, my - size); ctx.lineTo(mx + size, my); ctx.lineTo(mx, my + size); ctx.lineTo(mx - size, my);
                ctx.closePath(); ctx.fill();
                ctx.font = '600 8px JetBrains Mono'; ctx.textAlign = 'center'; ctx.fillStyle = color;
                ctx.fillText((pnl >= 0 ? '+' : '') + pnl.toFixed(1), mx, my - size - 4);
            }
        }
    }

    // Current price line
    const lastClose = candles[candles.length - 1].close;
    const lastY = toY(lastClose);
    ctx.strokeStyle = 'rgba(139,92,246,0.4)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(pad.left, lastY); ctx.lineTo(W - pad.right, lastY); ctx.stroke(); ctx.setLineDash([]);

    // Price label on right
    ctx.fillStyle = '#8B5CF6';
    const priceTag = fmtPrice(lastClose);
    ctx.beginPath(); ctx.roundRect(W - pad.right + 4, lastY - 10, pad.right - 8, 20, 4); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = '600 10px JetBrains Mono'; ctx.textAlign = 'center';
    ctx.fillText(priceTag, W - pad.right / 2, lastY + 3);

    // ── Crosshair ──
    if (chartState.mouseX >= pad.left && chartState.mouseX <= W - pad.right && chartState.mouseY >= pad.top && chartState.mouseY <= pad.top + cH) {
        const mx = chartState.mouseX, my = chartState.mouseY;
        // Vertical line
        ctx.strokeStyle = 'rgba(255,255,255,0.15)'; ctx.lineWidth = 1; ctx.setLineDash([2, 2]);
        ctx.beginPath(); ctx.moveTo(mx, pad.top); ctx.lineTo(mx, pad.top + cH); ctx.stroke();
        // Horizontal line
        ctx.beginPath(); ctx.moveTo(pad.left, my); ctx.lineTo(W - pad.right, my); ctx.stroke();
        ctx.setLineDash([]);

        // Price on right axis
        const hoverPrice = minP + (1 - (my - pad.top) / cH) * range;
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.beginPath(); ctx.roundRect(W - pad.right + 4, my - 10, pad.right - 8, 20, 4); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.font = '600 9px JetBrains Mono'; ctx.textAlign = 'center';
        ctx.fillText(fmtPrice(hoverPrice), W - pad.right / 2, my + 3);

        // Find nearest candle
        const ci = Math.round((mx - pad.left - gap / 2) / gap);
        if (ci >= 0 && ci < candles.length) {
            const c = candles[ci];
            const d = new Date(c.time * 1000);
            const timeStr = `${d.getUTCDate()}/${d.getUTCMonth()+1} ${String(d.getUTCHours()).padStart(2,'0')}:${String(d.getUTCMinutes()).padStart(2,'0')}`;
            const chg = c.close - c.open;
            const chgPct = ((chg / c.open) * 100).toFixed(2);
            const chgColor = chg >= 0 ? '#10B981' : '#EF4444';

            // OHLCV tooltip
            const tx = Math.min(mx + 12, W - 180), ty = Math.max(pad.top, my - 80);
            ctx.fillStyle = 'rgba(17,17,17,0.95)';
            ctx.beginPath(); ctx.roundRect(tx, ty, 165, 76, 6); ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.roundRect(tx, ty, 165, 76, 6); ctx.stroke();

            ctx.font = '500 9px JetBrains Mono'; ctx.textAlign = 'left';
            ctx.fillStyle = '#888'; ctx.fillText(timeStr, tx + 8, ty + 14);
            ctx.fillStyle = '#aaa'; ctx.fillText(`O: ${fmtPrice(c.open)}  H: ${fmtPrice(c.high)}`, tx + 8, ty + 28);
            ctx.fillText(`L: ${fmtPrice(c.low)}   C: ${fmtPrice(c.close)}`, tx + 8, ty + 42);
            ctx.fillStyle = '#888'; ctx.fillText(`Vol: ${fmtVol(c.volume)}`, tx + 8, ty + 56);
            ctx.fillStyle = chgColor; ctx.fillText(`${chg >= 0 ? '+' : ''}${chgPct}%`, tx + 100, ty + 56);

            // Highlight candle
            const hx = toX(ci);
            ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1;
            ctx.strokeRect(hx - candleW / 2 - 2, toY(c.high) - 2, candleW + 4, toY(c.low) - toY(c.high) + 4);
        }
    }

    // Symbol label
    const symbolLabel = document.getElementById('chartSymbolLabel');
    if (symbolLabel) symbolLabel.textContent = getSymbol();
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
                // Re-render canvas inside if any
                const canvas = card.querySelector('canvas');
                if (canvas) {
                    requestAnimationFrame(() => {
                        if (canvas.id === 'liveChartCanvas') renderLiveChart();
                        else if (canvas.id === 'equityCanvas') renderEquityChart();
                        else if (canvas.id === 'ddCanvas') renderDrawdownChart();
                    });
                }
            };
            const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
            window.addEventListener('mousemove', onMove);
            window.addEventListener('mouseup', onUp);
        });
    });
}
