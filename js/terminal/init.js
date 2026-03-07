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
        ls.style.transition = 'opacity 0.5s ease';
        ls.style.opacity = '0';
        app.style.transition = 'opacity 0.5s ease 0.2s';
        app.style.opacity = '1';
        setTimeout(() => { ls.style.display = 'none'; }, 600);
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

        // Period pills
        document.querySelectorAll('.period-pill[data-days]').forEach(p =>
            p.addEventListener('click', () => setPeriod(parseInt(p.dataset.days)))
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
    if (activeTab === 'overview') {
        renderEquityChart();
        renderLiveChart();
    }
    if (activeTab === 'statistics') {
        renderDrawdownChart();
    }
});

init();

// ═══════════════════════════════════════════
//  URL TAB PARAM (standalone, runs even if init() fails)
// ═══════════════════════════════════════════
if (activeTab && activeTab !== 'overview') {
    const el = document.getElementById('tab-' + activeTab);
    if (el) {
        document.querySelectorAll('.tab-btn').forEach(b =>
            b.classList.toggle('active', b.dataset.tab === activeTab)
        );
        document.querySelectorAll('.tab-content').forEach(c =>
            c.classList.toggle('active', c.id === 'tab-' + activeTab)
        );
    }
}
