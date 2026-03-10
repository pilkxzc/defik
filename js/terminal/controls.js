// ═══════════════════════════════════════════
//  UI CONTROLS
// ═══════════════════════════════════════════

let activeTab = new URLSearchParams(window.location.search).get('tab') || 'overview';
let symbolDropdownOpen = false;

// ═══════════════════════════════════════════
//  SYMBOL SELECTOR
// ═══════════════════════════════════════════
function renderSymbolSelector() {
    const symbols = getAllSymbols();
    const active = getSymbol();
    const badge = document.getElementById('symbolBadge');
    const wrap = document.getElementById('symbolSelectWrap');
    const dropdown = document.getElementById('symbolDropdown');
    if (!badge) return;

    badge.textContent = active;

    // Hide dropdown arrow if only 1 symbol
    if (symbols.length <= 1) {
        wrap.classList.add('single');
    } else {
        wrap.classList.remove('single');
    }

    // Build dropdown items
    if (dropdown && symbols.length > 1) {
        // "All" option + each symbol
        dropdown.innerHTML = symbols.map(sym => {
            const isActive = sym === active;
            const symTrades = allTrades.filter(t => t.symbol === sym);
            const pnl = symTrades.reduce((s, t) => s + pnlOf(t), 0);
            const posCount = (liveData?.positions || []).filter(p => p.symbol === sym && parseFloat(p.positionAmt || 0) !== 0).length;
            return `<div class="symbol-dropdown-item ${isActive ? 'active' : ''}" data-symbol="${sym}">
                <span class="sdi-name">${sym.replace('USDT','')}<span class="sdi-pair">USDT</span></span>
                ${posCount > 0 ? '<span class="sdi-live"></span>' : ''}
                <span class="sdi-pnl" style="color:${pnl >= 0 ? 'var(--accent-green)' : 'var(--accent-red)'}">${fmt(pnl)}</span>
            </div>`;
        }).join('');

        // Bind click events
        dropdown.querySelectorAll('.symbol-dropdown-item').forEach(item => {
            item.addEventListener('click', () => selectSymbol(item.dataset.symbol));
        });
    }
}

function toggleSymbolDropdown() {
    const symbols = getAllSymbols();
    if (symbols.length <= 1) return;
    const dropdown = document.getElementById('symbolDropdown');
    symbolDropdownOpen = !symbolDropdownOpen;
    dropdown.classList.toggle('open', symbolDropdownOpen);
    if (symbolDropdownOpen) {
        // Close on click outside
        setTimeout(() => {
            document.addEventListener('click', closeSymbolDropdown, { once: true });
        }, 0);
    }
}

function closeSymbolDropdown(e) {
    const wrap = document.getElementById('symbolSelectWrap');
    if (wrap && !wrap.contains(e?.target)) {
        symbolDropdownOpen = false;
        document.getElementById('symbolDropdown').classList.remove('open');
    }
}

async function selectSymbol(sym) {
    symbolDropdownOpen = false;
    document.getElementById('symbolDropdown').classList.remove('open');

    currentSymbol = sym;
    renderSymbolSelector();

    // If tick chart is active, restart it with new symbol
    if (TICK_TFS.has(currentTF) && window._tickChart) {
        window._tickChart.destroy();
        const el = document.getElementById('liveChartCanvas');
        if (el && window.TickChart) {
            window._tickChart = new TickChart(el, { maxTicks: 2000 });
            window._tickChart.start(sym);
        }
        await fetchTradeMarkers();
        applyPeriod();
        return;
    }

    // Reset so applyNewData is used for fresh data
    if (window._klineChart) window._klineChart._dataLoaded = false;

    // Reload symbol-dependent data
    await Promise.all([
        fetchKlines(sym, currentTF),
        fetchTradeMarkers(),
    ]);
    applyPeriod(); // re-filters trades by symbol + re-renders all
}

function switchTab(tabName) {
    activeTab = tabName;
    document.querySelectorAll('.tab-btn').forEach(b =>
        b.classList.toggle('active', b.dataset.tab === tabName)
    );
    document.querySelectorAll('.tab-content').forEach(c =>
        c.classList.toggle('active', c.id === 'tab-' + tabName)
    );
    // Re-render charts when switching to their tab (canvas needs visible container)
    requestAnimationFrame(() => {
        if (tabName === 'overview') {
            renderLiveChart();
            renderEquityChart();
        }
        if (tabName === 'statistics') {
            renderDrawdownChart();
        }
    });
}

const TICK_TFS = new Set(['1s','2s','3s','5s']);

function setChartTF(tf) {
    currentTF = tf;
    document.querySelectorAll('.chart-tf-btn[data-tf]').forEach(b =>
        b.classList.toggle('active', b.dataset.tf === tf)
    );

    if (TICK_TFS.has(tf)) {
        // Switch to tick chart mode
        disposeKlineChart();
        const el = document.getElementById('liveChartCanvas');
        if (window._tickChart) { window._tickChart.destroy(); window._tickChart = null; }
        if (el && window.TickChart) {
            window._tickChart = new TickChart(el, { maxTicks: 2000 });
            window._tickChart.start(getSymbol()).then(() => {});
        }
        return;
    }

    // Normal klinecharts mode — destroy tick chart if active
    if (window._tickChart) { window._tickChart.destroy(); window._tickChart = null; }

    // Reset so applyNewData is used for fresh data
    if (window._klineChart) window._klineChart._dataLoaded = false;
    Promise.all([
        fetchKlines(getSymbol(), tf),
        fetchTradeMarkers(),
    ]).then(() => renderLiveChart());
}

function exportCSV() {
    if (filteredTrades.length === 0) return alert('Немає угод для експорту');
    const header = 'Symbol,Side,Price,Quantity,PnL,OpenedAt,ClosedAt\n';
    const rows = filteredTrades.map(t =>
        `${t.symbol},${t.side},${t.price},${t.quantity},${t.pnl},${t.openedAt||''},${t.closedAt||''}`
    ).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `bot-${botId}-trades.csv`;
    a.click();
}

// ═══════════════════════════════════════════
//  SUBSCRIBE / COPY TRADING UI
// ═══════════════════════════════════════════
async function toggleSubscribe() {
    const btn = document.getElementById('subscribeBtn');
    btn.disabled = true;

    if (isSubscribed) {
        const ok = await unsubscribeFromBotAPI();
        if (ok) isSubscribed = false;
    } else {
        const ok = await subscribeToBotAPI();
        if (ok) isSubscribed = true;
    }

    btn.disabled = false;
    renderSubscribeSection();
}

// ═══════════════════════════════════════════
//  TELEGRAM CONTROLS
// ═══════════════════════════════════════════
async function startTelegramLink() {
    const btn = document.getElementById('tgLinkBtn');
    if (btn) { btn.disabled = true; btn.textContent = 'Генерація коду...'; }

    const data = await linkTelegram();
    if (data && data.code) {
        const codeDiv = document.getElementById('tgLinkCode');
        if (codeDiv) {
            codeDiv.style.display = 'block';
            codeDiv.innerHTML = `
                <div class="tg-link-code">${data.code}</div>
                <p class="tg-link-hint">Відправте <strong>/start ${data.code}</strong> нашому боту <a href="https://t.me/${data.botUsername || 'YamatoBot'}" target="_blank" style="color:var(--accent-primary);">@${data.botUsername || 'YamatoBot'}</a> в Telegram</p>
                <button class="btn-tg btn-tg-save" id="tgCheckLinkedBtn" style="margin-top:8px;">Я відправив — перевірити</button>`;
            document.getElementById('tgCheckLinkedBtn')?.addEventListener('click', checkTgLinked);
        }
    } else {
        if (btn) { btn.disabled = false; btn.textContent = "Під'єднати Telegram"; }
        alert('Не вдалося згенерувати код. Спробуйте пізніше.');
    }
}

async function checkTgLinked() {
    await fetchTelegramStatus();
    if (telegramStatus?.linked || telegramStatus?.isLinked) {
        await fetchNotificationSettings();
        renderTelegramSection();
    } else {
        alert('Telegram ще не підʼєднано. Переконайтесь, що ви відправили код боту.');
    }
}

async function saveTgSettings() {
    const el = id => document.getElementById(id);
    const settings = {
        notify_new_trade: el('tgNewTrade')?.checked || false,
        notify_close_trade: el('tgCloseTrade')?.checked || false,
        notify_stop_loss: el('tgStopLoss')?.checked || false,
        notify_take_profit: el('tgTakeProfit')?.checked || false,
        notify_position_change: el('tgPositionChange')?.checked || false,
        notify_daily_summary: el('tgDailySummary')?.checked || false,
        notify_weekly_summary: el('tgWeeklySummary')?.checked || false,
        notify_drawdown_alert: el('tgDrawdownAlert')?.checked || false,
        notify_pnl_threshold: parseFloat(el('tgPnlThreshold')?.value) || 0,
        notify_drawdown_threshold: parseFloat(el('tgDrawdownThreshold')?.value) || 10,
        notify_method: el('tgMethod')?.value || 'both',
        quiet_hour_from: el('tgQuietFrom')?.value !== '' ? parseInt(el('tgQuietFrom').value) : null,
        quiet_hour_to: el('tgQuietTo')?.value !== '' ? parseInt(el('tgQuietTo').value) : null,
    };

    const ok = await saveNotificationSettings(settings);
    if (ok) {
        const btn = document.querySelector('.btn-tg-save');
        if (btn) { const orig = btn.textContent; btn.textContent = 'Збережено!'; setTimeout(() => btn.textContent = orig, 2000); }
    } else {
        alert('Помилка збереження налаштувань');
    }
}

async function testTgNotification() {
    const btn = document.querySelector('.btn-tg-test');
    if (btn) btn.disabled = true;
    const ok = await testTelegramNotification();
    if (ok) {
        if (btn) { btn.textContent = 'Надіслано!'; setTimeout(() => { btn.textContent = 'Тест'; btn.disabled = false; }, 2000); }
    } else {
        alert('Не вдалося надіслати тестове сповіщення');
        if (btn) btn.disabled = false;
    }
}

async function unlinkTg() {
    if (!confirm('Від\'єднати Telegram? Ви перестанете отримувати сповіщення.')) return;
    const ok = await unlinkTelegram();
    if (ok) {
        telegramStatus = { linked: false };
        renderTelegramSection();
    } else {
        alert('Помилка при від\'єднанні');
    }
}

async function saveCopyTrading() {
    const apiKey = document.getElementById('copyApiKey').value.trim();
    const apiSecret = document.getElementById('copyApiSecret').value.trim();
    const percentage = parseFloat(document.getElementById('copyPercentage').value) || 100;
    const maxPosition = parseFloat(document.getElementById('copyMaxPosition').value) || 0;

    if (!apiKey || !apiSecret) {
        alert('Введіть API Key та Secret');
        return;
    }

    const btn = document.getElementById('saveCopyBtn');
    btn.disabled = true;
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/></svg> Перевірка ключів...';

    try {
        await enableCopyTrading(apiKey, apiSecret, percentage, maxPosition);
        alert('Копі-трейдинг активовано! Угоди бота будуть дублюватися на ваш акаунт.');
        renderSubscribeSection();
    } catch (e) {
        alert('Помилка: ' + (e.message || 'Не вдалося підключити'));
    }

    btn.disabled = false;
    btn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg> Зберегти та активувати';
}
