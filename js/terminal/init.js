// ═══════════════════════════════════════════
//  INIT & BOOTSTRAP
// ═══════════════════════════════════════════
const initStartTime = Date.now();

function fadeIn() {
    const elapsed = Date.now() - initStartTime;
    const remaining = Math.max(0, 3000 - elapsed);
    setTimeout(() => {
        const ls = document.getElementById('loadingScreen');
        const app = document.getElementById('appContainer');

        // ── Cube fly-in animation ──
        // Tell the cube iframe to start its fly-in, then fade to app
        const iframe = ls.querySelector('iframe');
        if (iframe && iframe.contentWindow) {
            // Signal the cube inside the iframe to fly
            iframe.contentWindow.postMessage('cube-fly', '*');

            // Wait for the cube animation (1s) then transition to app
            setTimeout(() => {
                ls.style.transition = 'opacity 0.3s ease';
                ls.style.opacity = '0';
                app.style.transition = 'opacity 0.5s ease 0.1s';
                app.style.opacity = '1';
                setTimeout(() => {
                    ls.style.display = 'none';
                    if (window._klineChart && typeof window._klineChart.resize === 'function') {
                        window._klineChart.resize();
                    }
                    renderLiveChart();
                    renderEquityChart();
                }, 500);
            }, 900);
        } else {
            // Fallback if no iframe
            ls.style.transition = 'opacity 0.5s ease';
            ls.style.opacity = '0';
            app.style.transition = 'opacity 0.5s ease 0.2s';
            app.style.opacity = '1';
            setTimeout(() => {
                ls.style.display = 'none';
                if (window._klineChart && typeof window._klineChart.resize === 'function') {
                    window._klineChart.resize();
                }
                renderLiveChart();
                renderEquityChart();
            }, 700);
        }
    }, remaining);
}

async function init() {
    try {
        await syncTrades();

        await Promise.all([
            fetchBotDetails(),
            fetchTrades(),
            fetchCurrentUser(),
            fetchLiveData(),
        ]);

        // Now getSymbol() can detect from positions/trades
        await Promise.all([
            fetchKlines(getSymbol(), currentTF),
            fetchBotStats('all'),
            fetchTradeMarkers(),
            fetchTelegramStatus(),
            fetchNotificationSettings(),
        ]);

        applyPeriod();
        fadeIn();

        // Init interactive chart (scroll/zoom/crosshair)
        initChartInteraction();
        initResizablePanels();

        // Bind UI controls (no inline onclick — SES/MetaMask compatibility)
        const symBtn = document.getElementById('symbolSelectBtn');
        if (symBtn) symBtn.addEventListener('click', toggleSymbolDropdown);

        // Trade grouping toggle (bot-detail page)
        document.getElementById('indGroupTrades')?.addEventListener('click', toggleTradeGrouping);

        // Period pills
        document.querySelectorAll('.period-pill[data-days]').forEach(p =>
            p.addEventListener('click', () => setPeriod(parseFloat(p.dataset.days)))
        );

        // Export CSV
        document.getElementById('exportBtn')?.addEventListener('click', exportCSV);

        // Tabs
        document.querySelectorAll('.tab-btn[data-tab]').forEach(b =>
            b.addEventListener('click', () => switchTab(b.dataset.tab))
        );

        // Open tab from URL param (?tab=connect)
        const urlTab = new URLSearchParams(window.location.search).get('tab');
        if (urlTab && document.getElementById('tab-' + urlTab)) {
            switchTab(urlTab);
        }

        // Trades/Orders/Positions sub-tabs
        document.querySelectorAll('.trades-tab[data-trades-tab]').forEach(b =>
            b.addEventListener('click', () => {
                const tab = b.dataset.tradesTab;
                document.querySelectorAll('.trades-tab').forEach(t => t.classList.toggle('active', t === b));
                document.getElementById('tradesTabContent').style.display = tab === 'trades' ? '' : 'none';
                document.getElementById('ordersTabContent').style.display = tab === 'orders' ? '' : 'none';
                document.getElementById('positionsTabContent').style.display = tab === 'positions' ? '' : 'none';
                if (tab === 'orders' && !_orderHistoryLoaded) {
                    renderOrderHistory();
                    fetchOrderHistory().then(() => renderOrderHistory());
                }
                if (tab === 'positions' && !_positionHistoryLoaded) {
                    renderPositionHistory();
                    fetchPositionHistory().then(() => renderPositionHistory());
                }
                if (tab === 'trades') renderRecentTrades();
                if (tab === 'orders' && _orderHistoryLoaded) renderOrderHistory();
                if (tab === 'positions' && _positionHistoryLoaded) renderPositionHistory();
            })
        );

        // Side filter (Long/Short/All)
        document.querySelectorAll('.side-filter-btn[data-side]').forEach(b =>
            b.addEventListener('click', () => {
                _tradesSideFilter = b.dataset.side;
                document.querySelectorAll('.side-filter-btn').forEach(x => x.classList.toggle('active', x === b));
                _rerenderActiveTradesTab();
            })
        );

        // Time filter
        document.querySelectorAll('.time-filter-btn[data-time]').forEach(b =>
            b.addEventListener('click', () => {
                _tradesTimeFilter = parseInt(b.dataset.time);
                document.querySelectorAll('.time-filter-btn').forEach(x => x.classList.toggle('active', x === b));
                _rerenderActiveTradesTab();
            })
        );

        // Sortable table headers
        document.querySelectorAll('.trades-tbl th.sortable[data-sort]').forEach(th => {
            th.addEventListener('click', () => {
                const tableEl = th.closest('table');
                let table = 'trades';
                if (tableEl?.id === 'orderHistoryTable') table = 'orders';
                else if (tableEl?.id === 'positionHistoryTable') table = 'positions';
                _toggleSort(table, th.dataset.sort);
            });
        });

        // Chart timeframe buttons
        document.querySelectorAll('.chart-tf-btn[data-tf]').forEach(b =>
            b.addEventListener('click', () => setChartTF(b.dataset.tf))
        );

        // Calendar navigation
        document.getElementById('calPrev')?.addEventListener('click', () => calNav(-1));
        document.getElementById('calNext')?.addEventListener('click', () => calNav(1));

        // Subscribe / Copy Trading
        document.getElementById('subscribeBtn')?.addEventListener('click', toggleSubscribe);
        document.getElementById('saveCopyBtn')?.addEventListener('click', saveCopyTrading);

        // Real-time klines — refresh every 10 sec
        setInterval(async () => {
            await fetchKlines(getSymbol(), currentTF);
            if (activeTab === 'overview') renderLiveChart();
        }, 10000);

        // Live data (positions, PnL) every 30 sec
        setInterval(async () => {
            await fetchLiveData();
            renderLivePosition();
            renderRiskAssessment();
            renderSymbolSelector(); // update live dots
        }, 30000);

        // Trade markers every 60 sec
        setInterval(async () => {
            await fetchTradeMarkers();
            if (activeTab === 'overview') renderLiveChart();
        }, 60000);

        // Re-sync trades every 2 min to catch any trades closed on Binance
        setInterval(async () => {
            await syncTrades();
            await fetchTrades();
            applyPeriod();
        }, 120000);

    } catch (err) {
        console.error('Init error:', err);
        document.getElementById('loadingScreen').innerHTML = `
            <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:var(--bg-app);color:var(--accent-red);font-size:14px;">
                Помилка завантаження: ${err.message}
            </div>`;
    }
}

// ═══════════════════════════════════════════
//  MOBILE NAV
// ═══════════════════════════════════════════
(function() {
    const mq = window.matchMedia('(max-width: 768px)');
    function toggleMobileNav(e) {
        const nav = document.getElementById('mobileNav');
        if (nav) nav.style.display = e.matches ? 'flex' : 'none';
    }
    mq.addEventListener('change', toggleMobileNav);
    toggleMobileNav(mq);
})();

// ═══════════════════════════════════════════
//  RESIZE
// ═══════════════════════════════════════════
window.addEventListener('resize', () => {
    // Reset resize flag so klinecharts re-measures on next render
    if (window._klineChart) window._klineChart._resizedOnce = false;
    if (activeTab === 'overview') {
        renderEquityChart();
        renderLiveChart();
    }
    if (activeTab === 'statistics') {
        renderDrawdownChart();
    }
});

init();

