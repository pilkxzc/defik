// Yamato Dashboard — real-time holdings, orders, trades, quick amounts
(function () {
    'use strict';

    // ==================== STATE ====================
    let dashboardHoldings = [];
    let dashboardSocket = null;

    // ==================== SOCKET.IO PRICE STREAMING ====================
    function initDashboardSocket() {
        if (typeof io === 'undefined') return;

        dashboardSocket = io({ transports: ['websocket', 'polling'] });

        dashboardSocket.on('priceUpdate', function (data) {
            if (!data.prices) return;

            // Update market list prices
            const items = document.querySelectorAll('.market-item');
            items.forEach(function (item) {
                const sym = item.dataset.symbol;
                const info = data.prices[sym];
                if (!info) return;

                const priceEl = item.querySelector('.price-val');
                const changeEl = item.querySelector('.price-change');

                if (priceEl) {
                    const formatted = '$' + formatPriceDash(info.price);
                    if (priceEl.textContent !== formatted) {
                        priceEl.textContent = formatted;
                        priceEl.style.color = (info.change24h >= 0) ? '#10B981' : '#EF4444';
                        setTimeout(function () { priceEl.style.color = ''; }, 300);
                    }
                }
                if (changeEl && info.change24h !== undefined) {
                    var sign = info.change24h >= 0 ? '+' : '';
                    changeEl.textContent = sign + info.change24h.toFixed(2) + '%';
                    changeEl.className = 'price-change ' + (info.change24h >= 0 ? '' : 'neg');
                }

                item.dataset.price = info.price;
            });

            // Update current price if selected coin is in the data
            if (data.prices[window.currentTicker]) {
                window.currentPrice = data.prices[window.currentTicker].price;
                if (window.orderType === 'market') {
                    updateOrderTotal();
                }
                // Update live price display
                var liveEl = document.getElementById('livePrice');
                if (liveEl) liveEl.textContent = '$' + formatPriceDash(window.currentPrice);
            }

            // Update holdings panel prices
            updateHoldingsPrices(data.prices);
        });

        dashboardSocket.on('orderFilled', function (data) {
            showToast('success', 'Ордер виконано',
                data.side.toUpperCase() + ' ' + data.amount + ' ' + data.symbol + ' @ $' + data.price.toFixed(2));
            loadRecentTrades();
        });

        dashboardSocket.on('holdingsUpdate', function (data) {
            if (data.holdings) {
                renderHoldingsFromRaw(data.holdings);
            } else {
                loadHoldings();
            }
        });

        dashboardSocket.on('balanceUpdate', function (data) {
            if (data.balance !== undefined) {
                var formatted = '$' + data.balance.toFixed(2);
                var hb = document.getElementById('headerBalance');
                var wb = document.getElementById('walletBalance');
                if (hb) hb.textContent = formatted;
                if (wb) wb.textContent = formatted;
                window.userBalance = data.balance;
                updateAvailableBalance();
            }
        });
    }

    // ==================== HOLDINGS PANEL ====================
    function loadHoldings() {
        fetch('/api/holdings', { credentials: 'include' })
            .then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            })
            .then(function (data) {
                dashboardHoldings = data.holdings || [];
                renderHoldings(dashboardHoldings, data.totalValue || 0);
            })
            .catch(function (e) { console.error('Failed to load holdings:', e); });
    }

    function renderHoldingsFromRaw(rawHoldings) {
        // rawHoldings come from DB with snake_case
        dashboardHoldings = rawHoldings.map(function (h) {
            return {
                currency: h.currency,
                amount: h.amount,
                avgBuyPrice: h.avg_buy_price || h.avgBuyPrice || 0,
                currentPrice: 0,
                usdValue: 0,
                pnl: 0,
                pnlPercent: 0
            };
        });
        // We'll let the next priceUpdate fill in prices; for now just render amounts
        renderHoldings(dashboardHoldings, 0);
    }

    function renderHoldings(holdings, totalValue) {
        var container = document.getElementById('holdingsList');
        if (!container) return;

        if (!holdings || holdings.length === 0) {
            container.innerHTML = '<div style="padding: 16px; text-align: center; color: var(--text-tertiary); font-size: 13px;">Немає активів. Купіть криптовалюту для початку.</div>';
            return;
        }

        var esc = window.escapeHtml || function(s) { return s == null ? '' : String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); };

        container.innerHTML = holdings.map(function (h) {
            var pnlColor = h.pnl >= 0 ? '#10B981' : '#EF4444';
            var pnlSign = h.pnl >= 0 ? '+' : '';
            var safeCurrency = esc(h.currency);
            var logoHtml = (window.getCoinLogoHtml) ? window.getCoinLogoHtml(h.currency, 28) : esc(h.currency.charAt(0));

            return '<div class="holding-row" data-currency="' + safeCurrency + '">' +
                '<div style="display:flex;align-items:center;gap:10px;">' +
                    '<div style="width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;overflow:hidden;">' + logoHtml + '</div>' +
                    '<div>' +
                        '<div style="font-weight:600;font-size:13px;">' + safeCurrency + '</div>' +
                        '<div style="font-size:11px;color:var(--text-tertiary);">' + formatAmountDash(h.amount) + '</div>' +
                    '</div>' +
                '</div>' +
                '<div style="text-align:right;">' +
                    '<div style="font-weight:600;font-size:13px;">$' + formatPriceDash(h.usdValue || 0) + '</div>' +
                    '<div style="font-size:11px;color:' + pnlColor + ';">' + pnlSign + '$' + Math.abs(h.pnl || 0).toFixed(2) + ' (' + pnlSign + (h.pnlPercent || 0).toFixed(1) + '%)</div>' +
                '</div>' +
            '</div>';
        }).join('');
    }

    function updateHoldingsPrices(prices) {
        if (!dashboardHoldings.length) return;

        var totalValue = 0;
        dashboardHoldings.forEach(function (h) {
            var p = prices[h.currency];
            if (p) {
                h.currentPrice = p.price;
                h.usdValue = h.amount * p.price;
                var costBasis = h.amount * h.avgBuyPrice;
                h.pnl = h.usdValue - costBasis;
                h.pnlPercent = costBasis > 0 ? (h.pnl / costBasis) * 100 : 0;
            }
            totalValue += h.usdValue || 0;
        });

        renderHoldings(dashboardHoldings, totalValue);
        updateAvailableBalance();
    }

    // ==================== OPEN ORDERS PANEL ====================
    function loadOpenOrders() {
        fetch('/api/orders?status=open', { credentials: 'include' })
            .then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            })
            .then(function (data) {
                renderOpenOrders(data.orders || []);
            })
            .catch(function (e) { console.error('Failed to load open orders:', e); });
    }

    function renderOpenOrders(orders) {
        var container = document.getElementById('openOrdersList');
        if (!container) return;

        if (!orders || orders.length === 0) {
            container.innerHTML = '<div style="padding: 16px; text-align: center; color: var(--text-tertiary); font-size: 13px;">Немає відкритих ордерів</div>';
            return;
        }

        var esc = window.escapeHtml || function(s) { return s == null ? '' : String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); };

        container.innerHTML = orders.map(function (o) {
            var sideColor = o.side === 'buy' ? '#10B981' : '#EF4444';
            var sideText = o.side === 'buy' ? 'Купити' : 'Продати';
            var date = new Date(o.created_at).toLocaleString('uk-UA', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

            return '<div class="open-order-row">' +
                '<div style="display:flex;align-items:center;gap:8px;">' +
                    '<span style="color:' + sideColor + ';font-weight:700;font-size:11px;text-transform:uppercase;">' + sideText + '</span>' +
                    '<span style="font-weight:600;font-size:13px;">' + esc(o.symbol) + '</span>' +
                '</div>' +
                '<div style="display:flex;align-items:center;gap:12px;">' +
                    '<div style="text-align:right;">' +
                        '<div style="font-size:12px;">$' + formatPriceDash(o.price) + ' &times; ' + formatAmountDash(o.amount) + '</div>' +
                        '<div style="font-size:10px;color:var(--text-tertiary);">' + date + '</div>' +
                    '</div>' +
                    '<button onclick="cancelOrder(' + parseInt(o.id) + ')" style="background:rgba(239,68,68,0.15);border:none;color:#EF4444;padding:4px 8px;border-radius:6px;font-size:11px;cursor:pointer;font-weight:600;">&times;</button>' +
                '</div>' +
            '</div>';
        }).join('');
    }

    window.cancelOrder = function (orderId) {
        fetch('/api/orders/' + orderId, { method: 'DELETE', credentials: 'include' })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (data.success) {
                    showToast('success', 'Ордер скасовано', 'Лімітний ордер було скасовано');
                    loadOpenOrders();
                } else {
                    showToast('error', 'Помилка', data.error || 'Не вдалося скасувати ордер');
                }
            })
            .catch(function () {
                showToast('error', 'Помилка', 'Не вдалося скасувати ордер');
            });
    };

    // ==================== RECENT TRADES PANEL ====================
    function loadRecentTrades() {
        fetch('/api/orders/history?limit=10', { credentials: 'include' })
            .then(function (r) {
                if (!r.ok) throw new Error('HTTP ' + r.status);
                return r.json();
            })
            .then(function (data) {
                renderRecentTrades(data.orders || []);
            })
            .catch(function (e) { console.error('Failed to load recent trades:', e); });
    }

    function renderRecentTrades(orders) {
        var container = document.getElementById('recentTradesList');
        if (!container) return;

        if (!orders || orders.length === 0) {
            container.innerHTML = '<div style="padding: 16px; text-align: center; color: var(--text-tertiary); font-size: 13px;">Немає історії торгів</div>';
            return;
        }

        var esc = window.escapeHtml || function(s) { return s == null ? '' : String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); };

        container.innerHTML = orders.map(function (o) {
            var sideColor = o.side === 'buy' ? '#10B981' : '#EF4444';
            var sideText = o.side === 'buy' ? 'Купити' : 'Продати';
            var total = (o.price * o.amount).toFixed(2);
            var date = new Date(o.created_at).toLocaleString('uk-UA', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

            return '<div class="trade-row">' +
                '<div style="display:flex;align-items:center;gap:8px;">' +
                    '<div style="width:6px;height:6px;border-radius:50%;background:' + sideColor + ';"></div>' +
                    '<div>' +
                        '<span style="font-weight:600;font-size:12px;">' + sideText + ' ' + esc(o.symbol) + '</span>' +
                        '<div style="font-size:10px;color:var(--text-tertiary);">' + date + '</div>' +
                    '</div>' +
                '</div>' +
                '<div style="text-align:right;">' +
                    '<div style="font-size:12px;font-weight:600;">$' + total + '</div>' +
                    '<div style="font-size:10px;color:var(--text-tertiary);">' + formatAmountDash(o.amount) + ' @ $' + formatPriceDash(o.price) + '</div>' +
                '</div>' +
            '</div>';
        }).join('');
    }

    // ==================== QUICK AMOUNT BUTTONS ====================
    function initQuickAmountButtons() {
        var container = document.getElementById('quickAmountBtns');
        if (!container) return;

        container.addEventListener('click', function (e) {
            var btn = e.target.closest('[data-pct]');
            if (!btn) return;

            var pct = parseInt(btn.dataset.pct) / 100;
            var amountInput = document.getElementById('orderAmount');
            if (!amountInput) return;

            if (window.orderSide === 'buy') {
                // Based on USD balance
                var balance = window.userBalance || 0;
                var price = window.orderType === 'market'
                    ? window.currentPrice
                    : (parseFloat(document.getElementById('orderPrice').value) || window.currentPrice);
                if (price > 0) {
                    amountInput.value = ((balance * pct) / price).toFixed(6);
                }
            } else {
                // Based on crypto holdings
                var holding = dashboardHoldings.find(function (h) { return h.currency === window.currentTicker; });
                var available = holding ? holding.amount : 0;
                amountInput.value = (available * pct).toFixed(6);
            }

            updateOrderTotal();
        });
    }

    // ==================== AVAILABLE BALANCE DISPLAY ====================
    function updateAvailableBalance() {
        var el = document.getElementById('availableBalanceText');
        if (!el) return;

        if (window.orderSide === 'buy') {
            el.textContent = 'Доступно: $' + (window.userBalance || 0).toFixed(2);
        } else {
            var holding = dashboardHoldings.find(function (h) { return h.currency === window.currentTicker; });
            var available = holding ? holding.amount : 0;
            el.textContent = 'Доступно: ' + formatAmountDash(available) + ' ' + window.currentTicker;
        }
    }

    // Hook into side toggle to update available balance display
    function hookSideToggle() {
        var toggleOptions = document.querySelectorAll('#sideToggle .toggle-option');
        toggleOptions.forEach(function (opt) {
            opt.addEventListener('click', function () {
                setTimeout(updateAvailableBalance, 50);
            });
        });
    }

    // ==================== HELPERS ====================
    function formatPriceDash(price) {
        if (price >= 1000) return price.toLocaleString('en-US', { maximumFractionDigits: 2 });
        if (price >= 1) return price.toFixed(2);
        if (price >= 0.01) return price.toFixed(4);
        return price.toFixed(6);
    }

    function formatAmountDash(amount) {
        if (amount >= 1) return amount.toFixed(4);
        if (amount >= 0.001) return amount.toFixed(6);
        return amount.toFixed(8);
    }

    // ==================== TAB SWITCHING ====================
    function initInfoTabs() {
        var tabBtns = document.querySelectorAll('.info-tab-btn');
        if (!tabBtns.length) return;

        tabBtns.forEach(function (btn) {
            btn.addEventListener('click', function () {
                tabBtns.forEach(function (b) {
                    b.classList.remove('active');
                    b.style.background = 'transparent';
                    b.style.color = 'var(--text-tertiary)';
                });
                this.classList.add('active');
                this.style.background = 'var(--accent-primary)';
                this.style.color = 'white';

                var tab = this.dataset.tab;
                document.querySelectorAll('.info-tab-content').forEach(function (c) {
                    c.style.display = c.dataset.tab === tab ? 'block' : 'none';
                });
            });
        });
    }

    // ==================== INIT ====================
    document.addEventListener('DOMContentLoaded', function () {
        initDashboardSocket();
        initQuickAmountButtons();
        initInfoTabs();
        hookSideToggle();

        loadHoldings();
        loadOpenOrders();
        loadRecentTrades();

        // Periodically refresh panels
        setInterval(loadOpenOrders, 15000);
        setInterval(loadRecentTrades, 15000);
        setInterval(loadHoldings, 30000);

        // Initial available balance
        setTimeout(updateAvailableBalance, 500);
    });
})();
