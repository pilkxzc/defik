// ============================================================
// Settings Modal — bot-detail page
// Extracted from page/bot-detail.html
// Functions: openSettings, closeSettings, saveApiKeys, saveSettings,
//   resetSettings, parseProxy, multi-account management, proxy testing,
//   settings load/save/apply, UI listeners
// Depends on globals: botId, isAdmin, currentSymbol, klChart, _tickChart,
//   loadChartData, syncBinanceTrades, showToast
// ============================================================

// Settings Modal Functions
let botSettings = {
    strategy: {
        type: 'grid',
        direction: 'long',
        baseCurrency: 'USDT',
        minOrderSize: 10,
        maxOrderSize: 100,
        gridCount: 5
    },
    risk: {
        takeProfit: 2.5,
        stopLoss: 1.5,
        trailingStop: false,
        trailingDistance: 0.5,
        leverage: 10,
        marginMode: 'isolated',
        riskPerTrade: 5,
        maxPositions: 3,
        dailyLossLimit: 50
    },
    indicators: {
        rsi: { enabled: true, period: 14, overbought: 70, oversold: 30 },
        macd: { enabled: false, fast: 12, slow: 26, signal: 9 },
        bb: { enabled: false, period: 20, stdDev: 2 },
        ema: { enabled: false, fast: 9, slow: 21 }
    },
    advanced: {
        autoCompound: false,
        autoRestart: true,
        telegramNotify: false,
        limitHours: false,
        tradingStart: '08:00',
        tradingEnd: '22:00',
        rateLimit: 10,
        apiTimeout: 5000
    }
};

let settingsInitialized = false;

function openSettings() {
    document.getElementById('settingsModal').style.display = 'flex';
    loadBotSettings();
    if (!settingsInitialized) {
        initSettingsListeners();
        settingsInitialized = true;
    }
    // Show API Keys tab for admins
    const apiBtn = document.getElementById('tabBtnApiKeys');
    if (apiBtn) apiBtn.style.display = isAdmin ? 'flex' : 'none';
    if (isAdmin) { loadMultiCredentials(); loadProxyPool(); }
}

function toggleSecretVisibility() {
    const input = document.getElementById('settingsApiSecret');
    input.type = input.type === 'password' ? 'text' : 'password';
}

async function saveApiKeys() {
    const apiKey = document.getElementById('settingsApiKey').value.trim();
    const apiSecret = document.getElementById('settingsApiSecret').value.trim();
    const statusEl = document.getElementById('apiKeyStatus');

    if (!apiKey || !apiSecret) {
        statusEl.style.color = '#EF4444';
        statusEl.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px;flex-shrink:0"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><circle cx="12" cy="17" r="1" fill="currentColor" stroke="none"/></svg> Both fields are required';
        return;
    }

    statusEl.style.color = 'var(--text-tertiary)';
    statusEl.textContent = 'Testing connection...';

    try {
        const res = await fetch(`/api/bots/${botId}/api-keys`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ apiKey, apiSecret })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed');

        statusEl.style.color = '#22C55E';
        statusEl.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px"><polyline points="20 6 9 17 4 12"/></svg>Підключено успішно — баланс: $' + (data.balance || '0.00');
        document.getElementById('settingsApiKey').value = '';
        document.getElementById('settingsApiSecret').value = '';
        // Reload chart data with fresh keys
        loadChartData(true);
        syncBinanceTrades();
    } catch (e) {
        statusEl.style.color = '#EF4444';
        statusEl.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' + e.message;
    }
}

// ── Proxy format parser ──────────────────────────────────
function parseProxy(raw) {
    if (!raw) return null;
    raw = raw.trim();
    if (!raw) return null;
    // login:pass@ip:port
    const atMatch = raw.match(/^(.+?):(.+?)@([\d.]+)[:\s]+(\d+)$/);
    if (atMatch) return atMatch[3] + ':' + atMatch[4] + ':' + atMatch[1] + ':' + atMatch[2];
    // Split by any whitespace or colon
    const parts = raw.split(/[\s:]+/).filter(Boolean);
    if (parts.length >= 4) return parts[0] + ':' + parts[1] + ':' + parts[2] + ':' + parts[3];
    if (parts.length >= 2) return parts[0] + ':' + parts[1];
    return null;
}

// ── Multi-account credentials ──────────────────────────
let multiAccounts = []; // [{tk, tk_secret, proxy}]

function toggleMultiAccForm(show) {
    document.getElementById('multiAccAddForm').style.display = show ? 'block' : 'none';
    document.getElementById('multiAccAddBtn').style.display = show ? 'none' : 'flex';
    if (show) {
        document.getElementById('multiAccKey').value = '';
        document.getElementById('multiAccSecret').value = '';
        document.getElementById('multiAccProxy').value = '';
        document.getElementById('multiAccAddStatus').textContent = '';
        document.getElementById('newAccProxyStatus').textContent = '';
        document.getElementById('multiAccKey').focus();
    }
}

async function testNewAccProxy() {
    const rawProxy = document.getElementById('multiAccProxy').value.trim();
    const statusEl = document.getElementById('newAccProxyStatus');
    const btn = document.getElementById('newAccProxyTestBtn');
    if (!rawProxy) {
        statusEl.style.color = '#EF4444';
        statusEl.textContent = 'Введiть проксi';
        return;
    }
    const proxy = parseProxy(rawProxy);
    if (!proxy) {
        statusEl.style.color = '#EF4444';
        statusEl.textContent = 'Невiрний формат проксi';
        return;
    }
    btn.disabled = true;
    btn.style.opacity = '0.5';
    statusEl.style.color = 'var(--text-tertiary)';
    statusEl.innerHTML = '<span style="display:inline-block;width:12px;height:12px;border:2px solid var(--text-tertiary);border-top-color:transparent;border-radius:50%;animation:spin .8s linear infinite;vertical-align:-2px;margin-right:4px;"></span>Перевiрка...';
    try {
        const apiKey = document.getElementById('multiAccKey').value.trim();
        const res = await fetch(`/api/bots/${botId}/test-proxy`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ proxy, apiKey })
        });
        const data = await res.json();
        if (data.success) {
            statusEl.style.color = '#10B981';
            statusEl.innerHTML = '<span style="color:#10B981;">OK</span> — IP: <b style="user-select:all;cursor:text;">' + (data.ip || '?') + '</b>' + (data.latency ? ' (' + data.latency + 'ms)' : '') + '<br><span style="color:#F59E0B;font-size:10px;">Додайте цей IP до вайтлiсту API ключа на Binance</span>';
        } else {
            statusEl.style.color = '#EF4444';
            statusEl.textContent = data.error || 'Помилка з\'єднання';
        }
    } catch (e) {
        statusEl.style.color = '#EF4444';
        statusEl.textContent = e.message;
    } finally {
        btn.disabled = false;
        btn.style.opacity = '1';
    }
}

function addMultiAcc() {
    const tk = document.getElementById('multiAccKey').value.trim();
    const tkSecret = document.getElementById('multiAccSecret').value.trim();
    const rawProxy = document.getElementById('multiAccProxy').value.trim();
    const proxy = parseProxy(rawProxy);
    const statusEl = document.getElementById('multiAccAddStatus');
    if (!tk || !tkSecret) {
        statusEl.style.color = '#EF4444';
        statusEl.textContent = 'API Ключ та Секрет обов\'язкові';
        return;
    }
    if (rawProxy && !proxy) {
        statusEl.style.color = '#EF4444';
        statusEl.textContent = 'Невiрний формат проксi';
        return;
    }
    if (multiAccounts.some(a => a.tk === tk)) {
        statusEl.style.color = '#EF4444';
        statusEl.textContent = 'Цей ключ вже додано';
        return;
    }
    multiAccounts.push({ tk, tk_secret: tkSecret, proxy: proxy || '' });
    renderMultiAccList();
    toggleMultiAccForm(false);
}

let editingAccIndex = -1;

function removeMultiAcc(index) {
    multiAccounts.splice(index, 1);
    if (editingAccIndex === index) editingAccIndex = -1;
    else if (editingAccIndex > index) editingAccIndex--;
    renderMultiAccList();
}

function editMultiAcc(index) {
    editingAccIndex = editingAccIndex === index ? -1 : index;
    renderMultiAccList();
}

function saveMultiAccEdit(index) {
    const proxyInput = document.getElementById('editProxy_' + index);
    if (proxyInput) {
        const parsed = parseProxy(proxyInput.value);
        multiAccounts[index].proxy = parsed || '';
    }
    editingAccIndex = -1;
    renderMultiAccList();
}

async function testProxyConn(index) {
    const proxyInput = document.getElementById('editProxy_' + index);
    const statusEl = document.getElementById('editProxyStatus_' + index);
    const btn = document.getElementById('editProxyTestBtn_' + index);
    const rawProxy = proxyInput ? proxyInput.value.trim() : '';
    if (!rawProxy) {
        statusEl.style.color = '#EF4444';
        statusEl.textContent = 'Введiть проксi';
        return;
    }
    const proxy = parseProxy(rawProxy);
    if (!proxy) {
        statusEl.style.color = '#EF4444';
        statusEl.textContent = 'Невiрний формат проксi';
        return;
    }
    btn.disabled = true;
    btn.style.opacity = '0.5';
    statusEl.style.color = 'var(--text-tertiary)';
    statusEl.innerHTML = '<span style="display:inline-block;width:12px;height:12px;border:2px solid var(--text-tertiary);border-top-color:transparent;border-radius:50%;animation:spin .8s linear infinite;vertical-align:-2px;margin-right:4px;"></span>Перевiрка...';
    try {
        const res = await fetch(`/api/bots/${botId}/test-proxy`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ proxy, apiKey: multiAccounts[index]?.tk || '' })
        });
        const data = await res.json();
        if (data.success) {
            statusEl.style.color = '#10B981';
            statusEl.innerHTML = '<span style="color:#10B981;">OK</span> — IP: <b style="user-select:all;cursor:text;">' + (data.ip || '?') + '</b>' + (data.latency ? ' (' + data.latency + 'ms)' : '') + '<br><span style="color:#F59E0B;font-size:10px;">Додайте цей IP до вайтлiсту API ключа на Binance</span>';
        } else {
            statusEl.style.color = '#EF4444';
            statusEl.textContent = data.error || 'Помилка з\'єднання';
        }
    } catch (e) {
        statusEl.style.color = '#EF4444';
        statusEl.textContent = e.message;
    } finally {
        btn.disabled = false;
        btn.style.opacity = '1';
    }
}

function renderMultiAccList() {
    const list = document.getElementById('multiAccList');
    const badge = document.getElementById('multiAccBadge');
    const saveWrap = document.getElementById('multiAccSaveWrap');

    const autoMatchWrap = document.getElementById('proxyAutoMatchWrap');
    if (multiAccounts.length === 0) {
        list.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-tertiary);font-size:13px;">Немає додаткових акаунтів</div>';
        badge.style.display = 'none';
        saveWrap.style.display = 'none';
        if (autoMatchWrap) autoMatchWrap.style.display = 'none';
        return;
    }

    badge.style.display = 'inline';
    badge.textContent = multiAccounts.length + ' акаунт' + (multiAccounts.length > 1 ? (multiAccounts.length < 5 ? 'и' : 'ів') : '');
    saveWrap.style.display = 'block';
    if (autoMatchWrap) autoMatchWrap.style.display = 'block';

    list.innerHTML = multiAccounts.map((a, i) => {
        const proxyDisplay = a.proxy ? a.proxy.split(':').slice(0, 2).join(':') + ':***' : 'без проксі';
        const proxyColor = a.proxy ? 'rgba(16,185,129,0.7)' : 'var(--text-tertiary)';
        const isEditing = editingAccIndex === i;

        let html = `<div style="background:var(--surface-secondary);border-radius:10px;padding:10px 14px;${isEditing ? 'border:1px solid rgba(16,185,129,0.25);' : ''}">`;
        html += `<div style="display:flex;align-items:center;gap:10px;">`;
        html += `<div style="width:32px;height:32px;border-radius:8px;background:rgba(16,185,129,0.12);display:flex;align-items:center;justify-content:center;flex-shrink:0;">`;
        html += `<span style="font-size:13px;font-weight:700;color:var(--accent-primary);">${i + 1}</span></div>`;
        html += `<div style="flex:1;min-width:0;">`;
        html += `<div style="font-family:monospace;font-size:11px;color:var(--text-primary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${a.tk.slice(0, 8)}...${a.tk.slice(-6)}</div>`;
        html += `<div style="display:flex;gap:8px;align-items:center;margin-top:2px;">`;
        html += `<span style="font-size:10px;color:var(--text-tertiary);">Secret: ${'*'.repeat(12)}</span>`;
        html += `<span style="font-size:10px;color:${proxyColor};">`;
        html += `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="vertical-align:-1px;margin-right:2px;"><circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/></svg>`;
        html += `${proxyDisplay}</span></div></div>`;

        // Edit button
        html += `<button onclick="editMultiAcc(${i})" style="background:none;border:none;color:${isEditing ? 'var(--accent-primary)' : 'var(--text-tertiary)'};cursor:pointer;padding:4px;border-radius:6px;transition:all .15s;" onmouseover="this.style.color='var(--accent-primary)';this.style.background='rgba(16,185,129,0.1)'" onmouseout="this.style.color='${isEditing ? 'var(--accent-primary)' : 'var(--text-tertiary)'}';this.style.background='none'" title="Редагувати">`;
        html += `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>`;

        // Delete button
        html += `<button onclick="removeMultiAcc(${i})" style="background:none;border:none;color:var(--text-tertiary);cursor:pointer;padding:4px;border-radius:6px;transition:all .15s;" onmouseover="this.style.color='#EF4444';this.style.background='rgba(239,68,68,0.1)'" onmouseout="this.style.color='var(--text-tertiary)';this.style.background='none'" title="Видалити">`;
        html += `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18"/><path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg></button>`;
        html += `</div>`;

        // Inline edit form
        if (isEditing) {
            html += `<div style="margin-top:10px;padding-top:10px;border-top:1px solid rgba(255,255,255,0.06);">`;
            html += `<div style="margin-bottom:8px;">`;
            html += `<label style="font-size:11px;color:var(--text-tertiary);display:block;margin-bottom:4px;">Проксі (IP:PORT:LOGIN:PASS)</label>`;
            html += `<div style="display:flex;gap:6px;align-items:center;">`;
            html += `<input type="text" id="editProxy_${i}" value="${a.proxy || ''}" placeholder="IP:PORT:LOGIN:PASS" style="flex:1;padding:7px 10px;background:var(--bg-app);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:var(--text-primary);font-family:monospace;font-size:11px;outline:none;box-sizing:border-box;" onfocus="this.style.borderColor='rgba(16,185,129,0.4)'" onblur="this.style.borderColor='rgba(255,255,255,0.1)'">`;
            html += `<button id="editProxyTestBtn_${i}" onclick="testProxyConn(${i})" style="padding:7px 10px;background:rgba(59,130,246,0.12);border:1px solid rgba(59,130,246,0.25);border-radius:8px;color:#60A5FA;font-weight:600;cursor:pointer;font-size:11px;white-space:nowrap;display:flex;align-items:center;gap:4px;">`;
            html += `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>Тест</button>`;
            html += `</div>`;
            html += `<div id="editProxyStatus_${i}" style="font-size:11px;margin-top:4px;min-height:16px;"></div>`;
            html += `</div>`;
            html += `<div style="display:flex;gap:6px;">`;
            html += `<button onclick="saveMultiAccEdit(${i})" style="flex:1;padding:6px;background:var(--accent-primary);border:none;border-radius:6px;color:white;font-weight:600;cursor:pointer;font-size:12px;">Застосувати</button>`;
            html += `<button onclick="editMultiAcc(${i})" style="padding:6px 12px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:var(--text-secondary);cursor:pointer;font-size:12px;">Скасувати</button>`;
            html += `</div></div>`;
        }

        html += `</div>`;
        return html;
    }).join('');
}

async function saveMultiCredentials(skipValidation) {
    const statusEl = document.getElementById('multiAccStatus');
    if (multiAccounts.length === 0) {
        statusEl.style.color = '#EF4444';
        statusEl.textContent = 'Додайте хоча б один акаунт';
        return;
    }
    statusEl.style.color = 'var(--text-tertiary)';
    statusEl.textContent = skipValidation ? 'Збереження...' : ('Перевірка ' + multiAccounts.length + ' акаунтів...');

    try {
        const res = await fetch(`/api/bots/${botId}/multi-credentials`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ credentials: multiAccounts, skipValidation: !!skipValidation })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed');

        if (skipValidation) {
            statusEl.style.color = '#22C55E';
            statusEl.textContent = 'Збережено ' + data.saved + ' акаунтів (без перевірки)';
        } else {
            const allOk = data.failed?.length === 0;
            statusEl.style.whiteSpace = 'pre-line';

            if (allOk) {
                statusEl.style.color = '#22C55E';
                statusEl.textContent = 'Збережено ' + data.saved + ' акаунтів. Binance: ' + data.valid + '/' + data.total + ' OK';
            } else {
                let html = '<div style="color:#22C55E;margin-bottom:6px;">Збережено ' + data.saved + ' акаунтів. Binance: ' + data.valid + '/' + data.total + ' OK</div>';
                data.failed.forEach(f => {
                    html += '<div style="background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);border-radius:8px;padding:8px 10px;margin-top:6px;">';
                    html += '<div style="font-family:monospace;font-size:11px;color:var(--text-primary);">' + f.key + '</div>';
                    html += '<div style="font-size:11px;color:#EF4444;margin-top:2px;">' + f.error + '</div>';
                    if (f.proxyIp) {
                        html += '<div style="margin-top:6px;background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.25);border-radius:6px;padding:6px 8px;">';
                        html += '<div style="font-size:11px;color:#F59E0B;">Додайте цей IP до вайтлiсту API ключа на Binance:</div>';
                        html += '<div style="font-family:monospace;font-size:13px;font-weight:700;color:#FBBF24;margin-top:3px;user-select:all;cursor:text;">' + f.proxyIp + '</div>';
                        html += '</div>';
                    }
                    html += '</div>';
                });
                statusEl.innerHTML = html;
            }
        }

        loadChartData(true);
    } catch (e) {
        statusEl.style.color = '#EF4444';
        statusEl.textContent = e.message;
    }
}

async function verifyMultiCredentials() {
    const btn = document.getElementById('multiAccVerifyBtn');
    const resultsEl = document.getElementById('multiAccVerifyResults');
    btn.disabled = true;
    btn.style.opacity = '0.6';
    resultsEl.style.display = 'block';
    resultsEl.innerHTML = '<div style="text-align:center;padding:16px;color:var(--text-tertiary);font-size:13px;"><div style="display:inline-block;width:18px;height:18px;border:2px solid var(--text-tertiary);border-top-color:transparent;border-radius:50%;animation:spin .8s linear infinite;"></div><div style="margin-top:8px;">Перевірка з\'єднань...</div></div>';

    try {
        const res = await fetch(`/api/bots/${botId}/multi-credentials/verify`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed');

        let html = '';

        // Summary card
        const allOk = data.ok === data.total;
        html += `<div style="background:${allOk ? 'rgba(16,185,129,0.08)' : 'rgba(239,68,68,0.08)'};border:1px solid ${allOk ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'};border-radius:12px;padding:14px;margin-bottom:12px;">`;
        html += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">`;
        html += allOk
            ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2.5"><path d="M9 12l2 2 4-4"/><circle cx="12" cy="12" r="10"/></svg>'
            : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><circle cx="12" cy="16" r="0.5" fill="#EF4444"/></svg>';
        html += `<span style="font-weight:700;font-size:14px;color:${allOk ? '#10B981' : '#EF4444'};">${data.ok}/${data.total} акаунтів активні</span>`;
        html += `</div>`;
        html += `<div style="display:flex;gap:16px;flex-wrap:wrap;">`;
        html += `<div><span style="font-size:11px;color:var(--text-tertiary);">Загальний баланс</span><div style="font-size:16px;font-weight:700;color:var(--text-primary);">$${data.totalBalance?.toFixed(2) || '0.00'}</div></div>`;
        html += `<div><span style="font-size:11px;color:var(--text-tertiary);">Нереалізований PnL</span><div style="font-size:16px;font-weight:700;color:${data.totalUnrealizedPnl >= 0 ? 'var(--color-up)' : 'var(--color-down)'};">${data.totalUnrealizedPnl >= 0 ? '+' : ''}$${data.totalUnrealizedPnl?.toFixed(2) || '0.00'}</div></div>`;
        html += `</div></div>`;

        // Per-account list
        data.accounts.forEach(a => {
            const ok = a.status === 'ok';
            html += `<div style="display:flex;align-items:center;gap:10px;background:var(--surface-secondary);border-radius:10px;padding:10px 14px;margin-bottom:6px;border-left:3px solid ${ok ? '#10B981' : '#EF4444'};">`;
            html += `<div style="width:28px;height:28px;border-radius:7px;background:${ok ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)'};display:flex;align-items:center;justify-content:center;flex-shrink:0;">`;
            html += ok
                ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>'
                : '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="3"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
            html += `</div>`;
            html += `<div style="flex:1;min-width:0;">`;
            html += `<div style="font-family:monospace;font-size:11px;color:var(--text-primary);">${a.key}</div>`;
            if (ok) {
                html += `<div style="font-size:10px;color:var(--text-tertiary);margin-top:2px;">$${a.balance.toFixed(2)} | PnL: ${a.unrealizedPnl >= 0 ? '+' : ''}$${a.unrealizedPnl.toFixed(2)} | ${a.positions} позицій</div>`;
            } else {
                html += `<div style="font-size:10px;color:#EF4444;margin-top:2px;">${a.error}</div>`;
            }
            if (a.proxy) {
                const pParts = a.proxy.split(':');
                html += `<div style="font-size:10px;color:rgba(16,185,129,0.7);margin-top:1px;">Proxy: ${pParts[0]}:${pParts[1]}:***</div>`;
            }
            html += `</div></div>`;
        });

        resultsEl.innerHTML = html;
    } catch (e) {
        resultsEl.innerHTML = `<div style="text-align:center;padding:12px;color:#EF4444;font-size:13px;">${e.message}</div>`;
    } finally {
        btn.disabled = false;
        btn.style.opacity = '1';
    }
}

async function runProxyAutoMatch() {
    const textarea = document.getElementById('proxyBulkInput');
    const statusEl = document.getElementById('proxyAutoMatchStatus');
    const resultsEl = document.getElementById('proxyAutoMatchResults');
    const btn = document.getElementById('proxyAutoMatchBtn');

    const lines = textarea.value.split('\n').map(l => l.trim()).filter(Boolean);
    const proxies = lines.map(parseProxy).filter(Boolean);

    if (proxies.length === 0) {
        statusEl.style.color = '#EF4444';
        statusEl.textContent = 'Не знайдено жодного валiдного проксi';
        return;
    }
    if (multiAccounts.length === 0) {
        statusEl.style.color = '#EF4444';
        statusEl.textContent = 'Спочатку додайте акаунти';
        return;
    }

    btn.disabled = true;
    btn.style.opacity = '0.5';
    statusEl.style.color = 'var(--text-tertiary)';
    statusEl.innerHTML = '<span style="display:inline-block;width:12px;height:12px;border:2px solid var(--text-tertiary);border-top-color:transparent;border-radius:50%;animation:spin .8s linear infinite;vertical-align:-2px;margin-right:4px;"></span>Перебираємо ' + proxies.length + ' проксi x ' + multiAccounts.length + ' акаунтiв...';
    resultsEl.innerHTML = '';

    try {
        const res = await fetch(`/api/bots/${botId}/auto-match-proxies`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ proxies, credentials: multiAccounts })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed');

        // Apply matches
        let applied = 0;
        if (data.matches && data.matches.length > 0) {
            data.matches.forEach(m => {
                if (multiAccounts[m.accIndex]) {
                    multiAccounts[m.accIndex].proxy = m.proxy;
                    applied++;
                }
            });
            renderMultiAccList();
        }

        // Build results HTML
        let html = '';
        if (applied > 0) {
            html += '<div style="background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.2);border-radius:8px;padding:10px;margin-bottom:8px;">';
            html += '<div style="font-weight:700;font-size:13px;color:#10B981;margin-bottom:6px;">' + applied + '/' + multiAccounts.length + ' акаунтiв отримали проксi</div>';
            data.matches.forEach(m => {
                html += '<div style="font-size:11px;color:var(--text-primary);margin-top:3px;font-family:monospace;">';
                html += (m.accKey || '?') + ' ← ' + m.proxyIp;
                html += '</div>';
            });
            html += '</div>';
        }

        // Unmatched accounts
        const unmatchedAccs = data.unmatchedAccounts || [];
        if (unmatchedAccs.length > 0) {
            html += '<div style="background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);border-radius:8px;padding:10px;margin-bottom:8px;">';
            html += '<div style="font-weight:700;font-size:12px;color:#EF4444;margin-bottom:4px;">Без проксi:</div>';
            unmatchedAccs.forEach(u => {
                html += '<div style="font-size:11px;color:var(--text-secondary);margin-top:2px;font-family:monospace;">' + u.key + '</div>';
            });
            html += '</div>';
        }

        // Restricted proxies
        const restricted = data.restrictedProxies || [];
        if (restricted.length > 0) {
            html += '<div style="background:rgba(239,68,68,0.06);border:1px solid rgba(239,68,68,0.15);border-radius:8px;padding:10px;margin-bottom:8px;">';
            html += '<div style="font-weight:700;font-size:12px;color:#EF4444;margin-bottom:4px;">Заблокованi регiони:</div>';
            restricted.forEach(r => {
                html += '<div style="font-size:11px;color:var(--text-secondary);margin-top:2px;font-family:monospace;">' + r.proxy + ' → ' + (r.ip || '?') + ' — ' + r.error + '</div>';
            });
            html += '</div>';
        }

        statusEl.style.color = applied > 0 ? '#10B981' : '#F59E0B';
        statusEl.textContent = applied > 0
            ? 'Готово! ' + applied + ' збiгiв знайдено. Натиснiть "Зберегти" щоб зафiксувати.'
            : 'Жодного збiгу не знайдено. Перевiрте вайтлiсти або замiнiть проксi.';

        resultsEl.innerHTML = html;
    } catch (e) {
        statusEl.style.color = '#EF4444';
        statusEl.textContent = e.message;
    } finally {
        btn.disabled = false;
        btn.style.opacity = '1';
    }
}

async function loadMultiCredentials() {
    try {
        const res = await fetch(`/api/bots/${botId}/trading-settings`);
        if (!res.ok) return;
        const data = await res.json();
        const mc = data?.settings?.multi_credentials;
        if (Array.isArray(mc) && mc.length > 0) {
            multiAccounts = mc.map(c => ({ tk: c.tk, tk_secret: c.tk_secret, proxy: c.proxy || '' }));
            renderMultiAccList();
        } else {
            renderMultiAccList();
        }
    } catch (e) {
        renderMultiAccList();
    }
}

function closeSettings() {
    document.getElementById('settingsModal').style.display = 'none';
}

function switchTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.settings-tab').forEach(tab => {
        tab.classList.remove('active');
    });
    event.target.closest('.settings-tab').classList.add('active');

    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });
    document.getElementById(`tab-${tabName}`).classList.add('active');
}

async function loadBotSettings() {
    try {
        const response = await fetch(`/api/bots/${botId}/trading-settings`);
        if (response.ok) {
            const data = await response.json();
            if (data.settings) {
                botSettings = { ...botSettings, ...data.settings };
            }
        }
    } catch (error) {
        console.error('Load settings error:', error);
    }
    applySettingsToUI();
}

function applySettingsToUI() {
    // Strategy
    document.getElementById('strategyType').value = botSettings.strategy.type;
    document.getElementById('baseCurrency').value = botSettings.strategy.baseCurrency;
    document.getElementById('minOrderSize').value = botSettings.strategy.minOrderSize;
    document.getElementById('maxOrderSize').value = botSettings.strategy.maxOrderSize;
    document.getElementById('gridCount').value = botSettings.strategy.gridCount;
    document.getElementById('gridCountValue').textContent = botSettings.strategy.gridCount;

    // Direction chips
    document.querySelectorAll('#tab-strategy .chip').forEach(chip => {
        chip.classList.toggle('active', chip.dataset.value === botSettings.strategy.direction);
    });

    // Risk
    document.getElementById('takeProfit').value = botSettings.risk.takeProfit;
    document.getElementById('stopLoss').value = botSettings.risk.stopLoss;
    document.getElementById('trailingStop').checked = botSettings.risk.trailingStop;
    document.getElementById('trailingDistance').value = botSettings.risk.trailingDistance;
    document.getElementById('trailingSettings').style.display = botSettings.risk.trailingStop ? 'block' : 'none';
    document.getElementById('leverage').value = botSettings.risk.leverage;
    document.getElementById('leverageValue').textContent = botSettings.risk.leverage + 'x';
    document.getElementById('riskPerTrade').value = botSettings.risk.riskPerTrade;
    document.getElementById('riskPerTradeValue').textContent = botSettings.risk.riskPerTrade + '%';
    document.getElementById('maxPositions').value = botSettings.risk.maxPositions;
    document.getElementById('dailyLossLimit').value = botSettings.risk.dailyLossLimit;

    // Margin mode chips
    document.querySelectorAll('#tab-risk .chip').forEach(chip => {
        chip.classList.toggle('active', chip.dataset.value === botSettings.risk.marginMode);
    });

    // Update risk meter
    updateRiskMeter(botSettings.risk.riskPerTrade);

    // Indicators
    document.getElementById('rsiEnabled').checked = botSettings.indicators.rsi.enabled;
    document.getElementById('rsiPeriod').value = botSettings.indicators.rsi.period;
    document.getElementById('rsiOverbought').value = botSettings.indicators.rsi.overbought;
    document.getElementById('rsiOversold').value = botSettings.indicators.rsi.oversold;
    document.getElementById('rsiSettings').style.display = botSettings.indicators.rsi.enabled ? 'block' : 'none';

    document.getElementById('macdEnabled').checked = botSettings.indicators.macd.enabled;
    document.getElementById('macdFast').value = botSettings.indicators.macd.fast;
    document.getElementById('macdSlow').value = botSettings.indicators.macd.slow;
    document.getElementById('macdSignal').value = botSettings.indicators.macd.signal;
    document.getElementById('macdSettings').style.display = botSettings.indicators.macd.enabled ? 'block' : 'none';

    document.getElementById('bbEnabled').checked = botSettings.indicators.bb.enabled;
    document.getElementById('bbPeriod').value = botSettings.indicators.bb.period;
    document.getElementById('bbStdDev').value = botSettings.indicators.bb.stdDev;
    document.getElementById('bbSettings').style.display = botSettings.indicators.bb.enabled ? 'block' : 'none';

    document.getElementById('emaEnabled').checked = botSettings.indicators.ema.enabled;
    document.getElementById('emaFast').value = botSettings.indicators.ema.fast;
    document.getElementById('emaSlow').value = botSettings.indicators.ema.slow;
    document.getElementById('emaSettings').style.display = botSettings.indicators.ema.enabled ? 'block' : 'none';

    // Advanced
    document.getElementById('autoCompound').checked = botSettings.advanced.autoCompound;
    document.getElementById('autoRestart').checked = botSettings.advanced.autoRestart;
    document.getElementById('telegramNotify').checked = botSettings.advanced.telegramNotify;
    document.getElementById('limitHours').checked = botSettings.advanced.limitHours;
    document.getElementById('tradingStart').value = botSettings.advanced.tradingStart;
    document.getElementById('tradingEnd').value = botSettings.advanced.tradingEnd;
    document.getElementById('tradingHours').style.display = botSettings.advanced.limitHours ? 'flex' : 'none';
    document.getElementById('rateLimit').value = botSettings.advanced.rateLimit;
    document.getElementById('apiTimeout').value = botSettings.advanced.apiTimeout;
}

function initSettingsListeners() {
    // Range sliders
    document.getElementById('gridCount').addEventListener('input', (e) => {
        document.getElementById('gridCountValue').textContent = e.target.value;
    });

    document.getElementById('leverage').addEventListener('input', (e) => {
        document.getElementById('leverageValue').textContent = e.target.value + 'x';
    });

    document.getElementById('riskPerTrade').addEventListener('input', (e) => {
        document.getElementById('riskPerTradeValue').textContent = e.target.value + '%';
        updateRiskMeter(parseInt(e.target.value));
    });

    // Trailing stop toggle
    document.getElementById('trailingStop').addEventListener('change', (e) => {
        document.getElementById('trailingSettings').style.display = e.target.checked ? 'block' : 'none';
    });

    // Trading hours toggle
    document.getElementById('limitHours').addEventListener('change', (e) => {
        document.getElementById('tradingHours').style.display = e.target.checked ? 'flex' : 'none';
    });

    // Indicator toggles
    ['rsi', 'macd', 'bb', 'ema'].forEach(ind => {
        document.getElementById(`${ind}Enabled`).addEventListener('change', (e) => {
            document.getElementById(`${ind}Settings`).style.display = e.target.checked ? 'block' : 'none';
        });
    });

    // Chips click handlers
    document.querySelectorAll('.setting-chips .chip').forEach(chip => {
        chip.addEventListener('click', () => {
            const parent = chip.closest('.setting-chips');
            parent.querySelectorAll('.chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
        });
    });
}

function updateRiskMeter(value) {
    const meter = document.getElementById('riskMeter');
    const width = (value / 25) * 100;
    meter.style.width = width + '%';

    meter.classList.remove('risk-low', 'risk-medium', 'risk-high');
    if (value <= 5) {
        meter.classList.add('risk-low');
    } else if (value <= 15) {
        meter.classList.add('risk-medium');
    } else {
        meter.classList.add('risk-high');
    }
}

function collectSettingsFromUI() {
    // Get direction chip
    let direction = 'long';
    document.querySelectorAll('#tab-strategy .chip').forEach(chip => {
        if (chip.classList.contains('active')) direction = chip.dataset.value;
    });

    // Get margin mode chip
    let marginMode = 'isolated';
    document.querySelectorAll('#tab-risk .chip').forEach(chip => {
        if (chip.classList.contains('active')) marginMode = chip.dataset.value;
    });

    return {
        strategy: {
            type: document.getElementById('strategyType').value,
            direction: direction,
            baseCurrency: document.getElementById('baseCurrency').value,
            minOrderSize: parseFloat(document.getElementById('minOrderSize').value),
            maxOrderSize: parseFloat(document.getElementById('maxOrderSize').value),
            gridCount: parseInt(document.getElementById('gridCount').value)
        },
        risk: {
            takeProfit: parseFloat(document.getElementById('takeProfit').value),
            stopLoss: parseFloat(document.getElementById('stopLoss').value),
            trailingStop: document.getElementById('trailingStop').checked,
            trailingDistance: parseFloat(document.getElementById('trailingDistance').value),
            leverage: parseInt(document.getElementById('leverage').value),
            marginMode: marginMode,
            riskPerTrade: parseInt(document.getElementById('riskPerTrade').value),
            maxPositions: parseInt(document.getElementById('maxPositions').value),
            dailyLossLimit: parseFloat(document.getElementById('dailyLossLimit').value)
        },
        indicators: {
            rsi: {
                enabled: document.getElementById('rsiEnabled').checked,
                period: parseInt(document.getElementById('rsiPeriod').value),
                overbought: parseInt(document.getElementById('rsiOverbought').value),
                oversold: parseInt(document.getElementById('rsiOversold').value)
            },
            macd: {
                enabled: document.getElementById('macdEnabled').checked,
                fast: parseInt(document.getElementById('macdFast').value),
                slow: parseInt(document.getElementById('macdSlow').value),
                signal: parseInt(document.getElementById('macdSignal').value)
            },
            bb: {
                enabled: document.getElementById('bbEnabled').checked,
                period: parseInt(document.getElementById('bbPeriod').value),
                stdDev: parseFloat(document.getElementById('bbStdDev').value)
            },
            ema: {
                enabled: document.getElementById('emaEnabled').checked,
                fast: parseInt(document.getElementById('emaFast').value),
                slow: parseInt(document.getElementById('emaSlow').value)
            }
        },
        advanced: {
            autoCompound: document.getElementById('autoCompound').checked,
            autoRestart: document.getElementById('autoRestart').checked,
            telegramNotify: document.getElementById('telegramNotify').checked,
            limitHours: document.getElementById('limitHours').checked,
            tradingStart: document.getElementById('tradingStart').value,
            tradingEnd: document.getElementById('tradingEnd').value,
            rateLimit: parseInt(document.getElementById('rateLimit').value),
            apiTimeout: parseInt(document.getElementById('apiTimeout').value)
        }
    };
}

async function saveSettings() {
    const settings = collectSettingsFromUI();

    try {
        const response = await fetch(`/api/bots/${botId}/trading-settings`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ settings })
        });

        if (response.ok) {
            botSettings = settings;
            closeSettings();
            if (typeof showToast === 'function') {
                showToast('success', 'Налаштування збережено', 'Торгові налаштування бота оновлено');
            } else {
                alert('Налаштування успішно збережено!');
            }
        } else {
            const data = await response.json();
            if (typeof showToast === 'function') {
                showToast('error', 'Помилка', data.error || 'Не вдалося зберегти налаштування');
            } else {
                alert(data.error || 'Не вдалося зберегти налаштування');
            }
        }
    } catch (error) {
        console.error('Save settings error:', error);
        if (typeof showToast === 'function') {
            showToast('error', 'Помилка', 'Не вдалося зберегти налаштування');
        } else {
            alert('Не вдалося зберегти налаштування');
        }
    }
}

function resetSettings() {
    botSettings = {
        strategy: {
            type: 'grid',
            direction: 'long',
            baseCurrency: 'USDT',
            minOrderSize: 10,
            maxOrderSize: 100,
            gridCount: 5
        },
        risk: {
            takeProfit: 2.5,
            stopLoss: 1.5,
            trailingStop: false,
            trailingDistance: 0.5,
            leverage: 10,
            marginMode: 'isolated',
            riskPerTrade: 5,
            maxPositions: 3,
            dailyLossLimit: 50
        },
        indicators: {
            rsi: { enabled: true, period: 14, overbought: 70, oversold: 30 },
            macd: { enabled: false, fast: 12, slow: 26, signal: 9 },
            bb: { enabled: false, period: 20, stdDev: 2 },
            ema: { enabled: false, fast: 9, slow: 21 }
        },
        advanced: {
            autoCompound: false,
            autoRestart: true,
            telegramNotify: false,
            limitHours: false,
            tradingStart: '08:00',
            tradingEnd: '22:00',
            rateLimit: 10,
            apiTimeout: 5000
        }
    };
    applySettingsToUI();
}

// Close modal on overlay click
document.getElementById('settingsModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'settingsModal') {
        closeSettings();
    }
});

// Close modal on Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeSettings();
    }
});

// ── Proxy Pool ───────────────────────────────────────────────────────────────
async function loadProxyPool() {
    const textarea = document.getElementById('proxyPoolInput');
    if (!textarea) return;
    try {
        const res = await fetch(`/api/bots/${botId}/proxy-pool`);
        if (!res.ok) return;
        const data = await res.json();
        if (data.pool && data.pool.length > 0) {
            textarea.value = data.pool.map(p => p.proxy).join('\n');
            renderProxyPoolStatus(data.pool);
        }
    } catch (e) {
        console.error('Load proxy pool error:', e);
    }
}

function renderProxyPoolStatus(pool) {
    const el = document.getElementById('proxyPoolResults');
    if (!el || !pool.length) { if (el) el.innerHTML = ''; return; }
    el.innerHTML = pool.map(p => {
        const parts = p.proxy.split(':');
        const ip = parts[0] + ':' + parts[1];
        const banned = p.banned;
        const color = banned ? '#EF4444' : '#10B981';
        const label = banned ? 'Заблоковано' : 'Активний';
        return `<div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:11px;">
            <span style="width:6px;height:6px;border-radius:50%;background:${color};flex-shrink:0;"></span>
            <span style="font-family:monospace;color:var(--text-secondary);">${ip}</span>
            <span style="color:${color};font-weight:600;">${label}</span>
        </div>`;
    }).join('');
}

async function saveProxyPool() {
    const textarea = document.getElementById('proxyPoolInput');
    const statusEl = document.getElementById('proxyPoolStatus');
    const lines = textarea.value.split('\n').map(l => l.trim()).filter(Boolean);
    const proxies = lines.map(parseProxy).filter(Boolean);

    if (proxies.length === 0 && lines.length > 0) {
        statusEl.style.color = '#EF4444';
        statusEl.textContent = 'Невiрний формат проксi';
        return;
    }

    try {
        const res = await fetch(`/api/bots/${botId}/proxy-pool`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ proxies })
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed');
        statusEl.style.color = '#10B981';
        statusEl.textContent = `Збережено ${data.count} проксi`;
        loadProxyPool();
    } catch (e) {
        statusEl.style.color = '#EF4444';
        statusEl.textContent = 'Помилка: ' + e.message;
    }
}

async function testProxyPool() {
    const textarea = document.getElementById('proxyPoolInput');
    const statusEl = document.getElementById('proxyPoolStatus');
    const resultsEl = document.getElementById('proxyPoolResults');
    const lines = textarea.value.split('\n').map(l => l.trim()).filter(Boolean);
    const proxies = lines.map(parseProxy).filter(Boolean);

    if (proxies.length === 0) {
        statusEl.style.color = '#EF4444';
        statusEl.textContent = 'Додайте проксi';
        return;
    }

    statusEl.style.color = 'var(--text-tertiary)';
    statusEl.textContent = `Тестую ${proxies.length} проксi...`;
    resultsEl.innerHTML = '';

    const results = await Promise.allSettled(
        proxies.map(async (proxy) => {
            const res = await fetch(`/api/bots/${botId}/test-proxy`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ proxy })
            });
            return res.json();
        })
    );

    let ok = 0, fail = 0;
    resultsEl.innerHTML = results.map((r, i) => {
        const parts = proxies[i].split(':');
        const ip = parts[0] + ':' + parts[1];
        if (r.status === 'fulfilled' && r.value.success) {
            ok++;
            return `<div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:11px;">
                <span style="width:6px;height:6px;border-radius:50%;background:#10B981;flex-shrink:0;"></span>
                <span style="font-family:monospace;color:var(--text-secondary);">${ip}</span>
                <span style="color:#10B981;">OK</span>
                <span style="color:var(--text-tertiary);">${r.value.latency}ms</span>
                <span style="color:var(--text-tertiary);">${r.value.ip || ''}</span>
            </div>`;
        } else {
            fail++;
            const err = r.status === 'fulfilled' ? r.value.error : r.reason?.message || '?';
            return `<div style="display:flex;align-items:center;gap:8px;padding:4px 0;font-size:11px;">
                <span style="width:6px;height:6px;border-radius:50%;background:#EF4444;flex-shrink:0;"></span>
                <span style="font-family:monospace;color:var(--text-secondary);">${ip}</span>
                <span style="color:#EF4444;">${err}</span>
            </div>`;
        }
    }).join('');

    statusEl.style.color = fail === 0 ? '#10B981' : '#F59E0B';
    statusEl.textContent = `${ok} працюють, ${fail} помилок`;
}
