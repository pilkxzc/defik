// Admin Panel JavaScript

let currentUser = null;
let usersPage = 1;
let transactionsPage = 1;
let auditPage = 1;
let newsPage = 1;
let subscriptionsPage = 1;

// Initialize admin panel
async function initAdminPanel() {
    try {
        // Check if user is authenticated and has admin rights
        const response = await fetch('/api/auth/me');
        if (!response.ok) {
            window.location.href = '/login';
            return;
        }

        currentUser = await response.json();

        // Check if user has admin or moderator role
        if (currentUser.role !== 'admin' && currentUser.role !== 'moderator') {
            document.getElementById('loadingState').style.display = 'none';
            document.getElementById('accessDenied').style.display = 'flex';
            return;
        }

        // Show admin panel
        document.getElementById('loadingState').style.display = 'none';
        document.getElementById('adminPanel').style.display = 'flex';

        // Update header
        document.getElementById('headerBalance').textContent = formatCurrency(currentUser.balance);

        // Update avatar with image or initial
        const avatarEl = document.getElementById('userAvatar');
        if (currentUser.avatar) {
            avatarEl.innerHTML = '';
            avatarEl.style.backgroundImage = `url(${currentUser.avatar})`;
            avatarEl.style.backgroundSize = 'cover';
            avatarEl.style.backgroundPosition = 'center';
        } else {
            avatarEl.style.backgroundImage = 'none';
            avatarEl.textContent = currentUser.fullName ? currentUser.fullName[0].toUpperCase() : 'U';
        }

        // Setup event listeners
        setupEventListeners();

        // Load initial data
        await loadDashboardStats();

    } catch (error) {
        console.error('Admin init error:', error);
        document.getElementById('loadingState').style.display = 'none';
        document.getElementById('accessDenied').style.display = 'flex';
    }
}

function setupEventListeners() {
    // Tab switching
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // User search
    const userSearch = document.getElementById('userSearch');
    let searchTimeout;
    userSearch.addEventListener('input', () => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            usersPage = 1;
            loadUsers();
        }, 300);
    });

    // Subscription search
    const subscriptionSearch = document.getElementById('subscriptionSearch');
    let subscriptionSearchTimeout;
    if (subscriptionSearch) {
        subscriptionSearch.addEventListener('input', () => {
            clearTimeout(subscriptionSearchTimeout);
            subscriptionSearchTimeout = setTimeout(() => {
                subscriptionsPage = 1;
                loadSubscriptions();
            }, 300);
        });
    }

    // User edit form
    document.getElementById('userEditForm').addEventListener('submit', handleUserEdit);

    // Ban form
    document.getElementById('banForm').addEventListener('submit', handleBanUser);

    // Change password button & form
    document.getElementById('changePasswordBtn').addEventListener('click', openPasswordModal);
    document.getElementById('changePasswordForm').addEventListener('submit', handleChangePassword);

    // Subscription form
    const subscriptionForm = document.getElementById('subscriptionForm');
    if (subscriptionForm) {
        subscriptionForm.addEventListener('submit', handleGrantSubscription);
    }

    // Subscription plan change - show/hide days select
    const subscriptionPlan = document.getElementById('subscriptionPlan');
    if (subscriptionPlan) {
        subscriptionPlan.addEventListener('change', (e) => {
            const daysGroup = document.getElementById('subscriptionDaysGroup');
            daysGroup.style.display = e.target.value === 'free' ? 'none' : 'block';
        });
    }
}

function switchTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tabName);
    });

    // Update tab content
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.toggle('active', content.id === `tab-${tabName}`);
    });

    // Load data for the tab
    switch (tabName) {
        case 'dashboard':
            loadDashboardStats();
            break;
        case 'users':
            loadUsers();
            break;
        case 'subscriptions':
            loadSubscriptions();
            break;
        case 'transactions':
            loadTransactions();
            break;
        case 'bots':
            loadBots();
            loadCategories();
            break;
        case 'news':
            loadNews();
            break;
        case 'audit':
            loadAuditLogs();
            break;
        case 'database':
            loadDatabaseTables();
            break;
    }
}

// Dashboard Stats
async function loadDashboardStats() {
    try {
        const response = await fetch('/api/admin/stats');
        if (!response.ok) throw new Error('Failed to fetch stats');

        const stats = await response.json();

        document.getElementById('statTotalUsers').textContent = stats.totalUsers;
        document.getElementById('statActiveUsers').textContent = stats.activeUsers;
        document.getElementById('statBannedUsers').textContent = stats.bannedUsers;
        document.getElementById('statNewUsers').textContent = stats.recentRegistrations;
        document.getElementById('statTotalTransactions').textContent = stats.totalTransactions;
        document.getElementById('statTotalVolume').textContent = formatCurrency(stats.totalVolume);
        document.getElementById('statTotalBots').textContent = stats.totalBots;
        document.getElementById('statActiveBots').textContent = stats.activeBots;

        // Load maintenance status
        await loadMaintenanceStatus();

        // Load Telegram status and users
        await loadTelegramStatus();
        await loadTelegramUsers();

    } catch (error) {
        console.error('Load stats error:', error);
    }
}

// Maintenance Mode
async function loadMaintenanceStatus() {
    try {
        const response = await fetch('/api/admin/maintenance');
        if (!response.ok) throw new Error('Failed to fetch maintenance status');

        const data = await response.json();
        const toggle = document.getElementById('maintenanceToggle');
        const status = document.getElementById('maintenanceStatus');

        if (toggle) {
            toggle.checked = data.enabled;
        }

        if (status) {
            if (data.enabled) {
                status.innerHTML = `<span style="color: var(--color-down);">Site is in maintenance mode</span><br><small style="color: var(--text-tertiary);">Enabled by: ${data.enabledBy} (${data.enabledAt})</small>`;
            } else {
                status.textContent = 'Site is operating normally';
            }
        }
    } catch (error) {
        console.error('Load maintenance status error:', error);
    }
}

async function toggleMaintenance() {
    const toggle = document.getElementById('maintenanceToggle');
    const enabled = toggle.checked;

    try {
        const response = await fetch('/api/admin/maintenance', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                enabled: enabled,
                message: 'Site is temporarily unavailable. Maintenance in progress. Please try again later.'
            })
        });

        if (!response.ok) throw new Error('Failed to toggle maintenance');

        const result = await response.json();
        showNotification(
            enabled ? 'Maintenance mode enabled' : 'Maintenance mode disabled',
            enabled ? 'warning' : 'success'
        );

        await loadMaintenanceStatus();

    } catch (error) {
        console.error('Toggle maintenance error:', error);
        toggle.checked = !enabled; // Revert toggle
        showNotification('Failed to change mode', 'error');
    }
}

// Telegram Bot Management
async function loadTelegramStatus() {
    try {
        const response = await fetch('/api/admin/telegram-settings');
        if (!response.ok) throw new Error('Failed to fetch Telegram status');

        const data = await response.json();
        const toggle = document.getElementById('telegramToggle');
        const status = document.getElementById('telegramStatus');
        const tokenInput = document.getElementById('telegramToken');
        const botInfo = document.getElementById('telegramBotInfo');
        const botUsername = document.getElementById('telegramBotUsername');

        if (toggle) {
            toggle.checked = data.enabled;
        }

        if (status) {
            if (data.isConnected) {
                status.innerHTML = `<span style="color: var(--color-up);">Bot is running</span>`;
            } else if (data.enabled && data.hasToken) {
                status.innerHTML = `<span style="color: var(--color-warning);">Bot is not connected</span>`;
            } else if (!data.hasToken) {
                status.textContent = 'Bot token not configured';
            } else {
                status.textContent = 'Bot is disabled';
            }
        }

        if (tokenInput && data.hasToken) {
            tokenInput.value = data.token;
        }

        if (botInfo && botUsername && data.username) {
            botInfo.style.display = 'block';
            botUsername.textContent = '@' + data.username;
        } else if (botInfo) {
            botInfo.style.display = 'none';
        }
    } catch (error) {
        console.error('Load Telegram status error:', error);
    }
}

async function toggleTelegram() {
    const toggle = document.getElementById('telegramToggle');
    const enabled = toggle.checked;

    try {
        const response = await fetch('/api/admin/telegram-settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled: enabled })
        });

        if (!response.ok) throw new Error('Failed to toggle Telegram bot');

        const result = await response.json();
        showNotification(
            enabled ? 'Telegram bot enabled' : 'Telegram bot disabled',
            enabled ? 'success' : 'info'
        );

        await loadTelegramStatus();

    } catch (error) {
        console.error('Toggle Telegram error:', error);
        toggle.checked = !enabled;
        showNotification('Failed to change Telegram status', 'error');
    }
}

async function saveTelegramSettings() {
    const token = document.getElementById('telegramToken').value;
    const enabled = document.getElementById('telegramToggle').checked;

    try {
        const response = await fetch('/api/admin/telegram-settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token, enabled })
        });

        if (!response.ok) throw new Error('Failed to save Telegram settings');

        const result = await response.json();
        showNotification('Telegram settings saved', 'success');
        await loadTelegramStatus();

    } catch (error) {
        console.error('Save Telegram settings error:', error);
        showNotification('Failed to save Telegram settings', 'error');
    }
}

async function testTelegramBot() {
    const btn = document.getElementById('testTelegramBtn');
    btn.disabled = true;
    btn.textContent = 'Testing...';

    try {
        // First check if bot is connected
        const statusResp = await fetch('/api/admin/telegram-settings');
        const status = await statusResp.json();

        if (!status.isConnected) {
            showNotification('Bot is not connected. Save settings first.', 'warning');
            return;
        }

        showNotification('Telegram bot is working!', 'success');

    } catch (error) {
        console.error('Test Telegram error:', error);
        showNotification('Failed to test Telegram bot', 'error');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Test';
    }
}

// Load Telegram linked users
async function loadTelegramUsers() {
    try {
        const response = await fetch('/api/admin/telegram-users');
        if (!response.ok) throw new Error('Failed to fetch Telegram users');

        const data = await response.json();

        // Update stats
        const linkedCount = document.getElementById('telegramLinkedCount');
        const statusIcon = document.getElementById('telegramBotStatusIcon');
        const percentage = document.getElementById('telegramPercentage');

        if (linkedCount) linkedCount.textContent = data.stats.totalLinked;
        if (statusIcon) {
            if (data.stats.botConnected) {
                statusIcon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#22C55E" stroke="none"/></svg>';
                statusIcon.title = 'Bot is running';
            } else if (data.stats.botEnabled) {
                statusIcon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#EAB308" stroke="none"/></svg>';
                statusIcon.title = 'Bot enabled but not connected';
            } else {
                statusIcon.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#EF4444" stroke="none"/></svg>';
                statusIcon.title = 'Bot is disabled';
            }
        }
        if (percentage && data.stats.totalUsers > 0) {
            const pct = ((data.stats.totalLinked / data.stats.totalUsers) * 100).toFixed(1);
            percentage.textContent = pct + '%';
        }

        // Render users list
        const usersList = document.getElementById('telegramUsersList');
        if (usersList) {
            if (data.users.length === 0) {
                usersList.innerHTML = `
                    <div style="color: var(--text-tertiary); font-size: 13px; text-align: center; padding: 20px;">
                        No users have linked their Telegram yet
                    </div>
                `;
            } else {
                usersList.innerHTML = data.users.map(user => `
                    <div style="display: flex; align-items: center; justify-content: space-between; padding: 12px; background: var(--surface-secondary); border-radius: 8px; margin-bottom: 8px;">
                        <div style="display: flex; align-items: center; gap: 12px;">
                            <div style="width: 36px; height: 36px; background: #0088cc; border-radius: 50%; display: flex; align-items: center; justify-content: center;">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
                                    <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.562 8.161c-.18 1.897-.962 6.502-1.359 8.627-.168.9-.5 1.201-.82 1.23-.697.064-1.226-.461-1.901-.903-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.248-.024c-.106.024-1.793 1.139-5.062 3.345-.479.329-.913.489-1.302.481-.428-.008-1.252-.241-1.865-.44-.751-.244-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.831-2.529 6.998-3.014 3.333-1.386 4.025-1.627 4.477-1.635.099-.002.321.023.465.141.12.1.153.232.168.326.015.094.034.31.019.476z"/>
                                </svg>
                            </div>
                            <div>
                                <div style="font-weight: 600; font-size: 14px;">${user.fullName}</div>
                                <div style="font-size: 12px; color: var(--text-tertiary);">${user.email}</div>
                            </div>
                        </div>
                        <div style="text-align: right;">
                            <div style="font-size: 13px; color: #0088cc; font-weight: 600;">
                                ${user.telegramUsername ? '@' + user.telegramUsername : 'No username'}
                            </div>
                            <div style="font-size: 11px; color: var(--text-tertiary);">
                                ID: ${user.telegramId}
                            </div>
                        </div>
                    </div>
                `).join('');
            }
        }
    } catch (error) {
        console.error('Load Telegram users error:', error);
    }
}

// Users Management
async function loadUsers() {
    const search = document.getElementById('userSearch').value;
    const tableBody = document.getElementById('usersTableBody');

    try {
        const response = await fetch(`/api/admin/users?page=${usersPage}&limit=20&search=${encodeURIComponent(search)}`);
        if (!response.ok) throw new Error('Failed to fetch users');

        const data = await response.json();

        // Clear existing rows (keep header)
        const header = tableBody.querySelector('.table-row.header');
        tableBody.innerHTML = '';
        tableBody.appendChild(header);

        if (data.users.length === 0) {
            tableBody.innerHTML += `
                <div class="empty-state">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
                        <circle cx="9" cy="7" r="4"></circle>
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
                        <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
                    </svg>
                    <div class="empty-state-text">No users found</div>
                </div>
            `;
            return;
        }

        data.users.forEach(user => {
            const row = document.createElement('div');
            row.className = 'table-row';
            row.innerHTML = `
                <div>${user.id}</div>
                <div class="user-cell">
                    <span class="user-name">${escapeHtml(user.fullName || 'N/A')}</span>
                    <span class="user-email">${escapeHtml(user.email)}</span>
                </div>
                <div>
                    <div style="font-size: 13px;">Demo: ${formatCurrency(user.demoBalance)}</div>
                    <div style="font-size: 11px; color: var(--text-tertiary);">Real: ${formatCurrency(user.realBalance)}</div>
                </div>
                <div><span class="role-badge ${user.role}">${user.role}</span></div>
                <div><span class="status-badge ${user.isBanned ? 'banned' : 'active'}">${user.isBanned ? 'Banned' : 'Active'}</span></div>
                <div class="actions-cell">
                    <button class="action-btn secondary" onclick="openEditModal(${user.id})">Edit</button>
                    ${user.isBanned
                        ? `<button class="action-btn success" onclick="unbanUser(${user.id})">Unban</button>`
                        : `<button class="action-btn danger" onclick="openBanModal(${user.id})">Ban</button>`
                    }
                </div>
            `;
            tableBody.appendChild(row);
        });

        // Render pagination
        renderPagination('usersPagination', data.page, data.totalPages, (page) => {
            usersPage = page;
            loadUsers();
        });

    } catch (error) {
        console.error('Load users error:', error);
        tableBody.innerHTML += `<div class="empty-state"><div class="empty-state-text">Error loading users</div></div>`;
    }
}

async function openEditModal(userId) {
    try {
        const response = await fetch(`/api/admin/users/${userId}`);
        if (!response.ok) throw new Error('Failed to fetch user');

        const data = await response.json();
        const user = data.user;

        document.getElementById('editUserId').value = user.id;
        document.getElementById('editFullName').value = user.fullName || '';
        document.getElementById('editEmail').value = user.email;
        document.getElementById('editPhone').value = user.phone || '';
        document.getElementById('editDemoBalance').value = user.demoBalance || 0;
        document.getElementById('editRole').value = user.role || 'user';

        openModal('userModal');

    } catch (error) {
        console.error('Open edit modal error:', error);
        showNotification('Failed to load user details', 'error');
    }
}

async function handleUserEdit(e) {
    e.preventDefault();

    const userId = document.getElementById('editUserId').value;
    const data = {
        fullName: document.getElementById('editFullName').value,
        phone: document.getElementById('editPhone').value,
        demoBalance: parseFloat(document.getElementById('editDemoBalance').value) || 0
    };

    const newRole = document.getElementById('editRole').value;

    try {
        // Update user details
        const response = await fetch(`/api/admin/users/${userId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        if (!response.ok) throw new Error('Failed to update user');

        // Update role if changed
        const roleResponse = await fetch(`/api/admin/users/${userId}/role`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ role: newRole })
        });

        if (!roleResponse.ok) {
            const roleError = await roleResponse.json();
            throw new Error(roleError.error || 'Failed to update role');
        }

        closeModal('userModal');
        showNotification('User updated successfully', 'success');
        loadUsers();

    } catch (error) {
        console.error('Update user error:', error);
        showNotification(error.message || 'Failed to update user', 'error');
    }
}

function openPasswordModal() {
    const userId = document.getElementById('editUserId').value;
    if (!userId) return;
    document.getElementById('changePasswordUserId').value = userId;
    document.getElementById('newPassword').value = '';
    document.getElementById('confirmPassword').value = '';
    openModal('changePasswordModal');
}

async function handleChangePassword(e) {
    e.preventDefault();

    const userId = document.getElementById('changePasswordUserId').value;
    const password = document.getElementById('newPassword').value.trim();
    const confirm = document.getElementById('confirmPassword').value.trim();

    if (password.length < 6) {
        showNotification('Password must be at least 6 characters', 'error');
        return;
    }
    if (password !== confirm) {
        showNotification('Passwords do not match', 'error');
        return;
    }

    try {
        const response = await fetch(`/api/admin/users/${userId}/password`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password })
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.error || 'Failed to change password');
        }

        closeModal('changePasswordModal');
        showNotification('Password changed successfully', 'success');

    } catch (error) {
        console.error('Change password error:', error);
        showNotification(error.message || 'Failed to change password', 'error');
    }
}

function openBanModal(userId) {
    document.getElementById('banUserId').value = userId;
    document.getElementById('banReason').value = '';
    openModal('banModal');
}

async function handleBanUser(e) {
    e.preventDefault();

    const userId = document.getElementById('banUserId').value;
    const reason = document.getElementById('banReason').value;

    try {
        const response = await fetch(`/api/admin/users/${userId}/ban`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to ban user');
        }

        closeModal('banModal');
        showNotification('User banned successfully', 'success');
        loadUsers();
        loadDashboardStats();

    } catch (error) {
        console.error('Ban user error:', error);
        showNotification(error.message || 'Failed to ban user', 'error');
    }
}

let pendingUnbanUserId = null;
let pendingDeleteBotId = null;

async function unbanUser(userId) {
    pendingUnbanUserId = userId;
    showConfirmModal('Unban User', 'Are you sure you want to unban this user?', confirmUnbanUser);
}

async function confirmUnbanUser() {
    if (!pendingUnbanUserId) return;
    const userId = pendingUnbanUserId;
    pendingUnbanUserId = null;
    closeConfirmModal();

    try {
        const response = await fetch(`/api/admin/users/${userId}/unban`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' }
        });

        if (!response.ok) throw new Error('Failed to unban user');

        showNotification('User unbanned successfully', 'success');
        loadUsers();
        loadDashboardStats();

    } catch (error) {
        console.error('Unban user error:', error);
        showNotification('Failed to unban user', 'error');
    }
}

// Transactions
async function loadTransactions() {
    const tableBody = document.getElementById('transactionsTableBody');

    try {
        const response = await fetch(`/api/admin/transactions?page=${transactionsPage}&limit=50`);
        if (!response.ok) throw new Error('Failed to fetch transactions');

        const data = await response.json();

        // Clear existing rows (keep header)
        const header = tableBody.querySelector('.table-row.header');
        tableBody.innerHTML = '';
        tableBody.appendChild(header);

        if (data.transactions.length === 0) {
            tableBody.innerHTML += `
                <div class="empty-state">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <line x1="12" y1="1" x2="12" y2="23"></line>
                        <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
                    </svg>
                    <div class="empty-state-text">No transactions found</div>
                </div>
            `;
            return;
        }

        data.transactions.forEach(tx => {
            const row = document.createElement('div');
            row.className = 'table-row';
            row.innerHTML = `
                <div>${tx.id}</div>
                <div class="user-cell">
                    <span class="user-name">${escapeHtml(tx.userName || 'N/A')}</span>
                    <span class="user-email">${escapeHtml(tx.userEmail)}</span>
                </div>
                <div><span class="status-badge ${tx.type === 'buy' ? 'active' : 'inactive'}">${tx.type}</span></div>
                <div>${tx.currency}</div>
                <div>${tx.amount?.toFixed(6) || '0'}</div>
                <div><span class="status-badge ${tx.status === 'completed' ? 'active' : 'inactive'}">${tx.status}</span></div>
                <div style="font-size: 12px; color: var(--text-tertiary);">${formatDate(tx.createdAt)}</div>
            `;
            tableBody.appendChild(row);
        });

        // Render pagination
        renderPagination('transactionsPagination', data.page, data.totalPages, (page) => {
            transactionsPage = page;
            loadTransactions();
        });

    } catch (error) {
        console.error('Load transactions error:', error);
        tableBody.innerHTML += `<div class="empty-state"><div class="empty-state-text">Error loading transactions</div></div>`;
    }
}

// Bots
async function loadBots() {
    const tableBody = document.getElementById('botsTableBody');

    try {
        const [response, catRes] = await Promise.all([
            fetch('/api/admin/bots'),
            fetch('/api/admin/bot-categories', { credentials: 'include' })
        ]);
        if (!response.ok) throw new Error('Failed to fetch bots');
        const categories = catRes.ok ? (await catRes.json()).categories : [];

        const data = await response.json();

        // Clear existing rows (keep header)
        const header = tableBody.querySelector('.table-row.header');
        tableBody.innerHTML = '';
        tableBody.appendChild(header);

        if (data.bots.length === 0) {
            tableBody.innerHTML += `
                <div class="empty-state">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4"></path>
                        <path d="M4 6v12c0 1.1.9 2 2 2h14v-4"></path>
                        <path d="M18 12a2 2 0 0 0-2 2c0 1.1.9 2 2 2h4v-4h-4z"></path>
                    </svg>
                    <div class="empty-state-text">No bots found</div>
                </div>
            `;
            return;
        }

        data.bots.forEach(bot => {
            const catOptions = `<option value="" ${!bot.categoryId ? 'selected' : ''}>— Без категорії —</option>` +
                categories.map(c => `<option value="${c.id}" ${bot.categoryId === c.id ? 'selected' : ''}>${escapeHtml(c.name)}</option>`).join('');
            const row = document.createElement('div');
            row.className = 'table-row';
            row.innerHTML = `
                <div>${escapeHtml(bot.name)}</div>
                <div class="user-cell">
                    <span class="user-name">${escapeHtml(bot.userName || 'N/A')}</span>
                    <span class="user-email">${escapeHtml(bot.userEmail)}</span>
                </div>
                <div>${bot.type}</div>
                <div>${bot.pair}</div>
                <div class="${bot.profit >= 0 ? 'up' : 'down'}">${bot.profit >= 0 ? '+' : ''}${bot.profit?.toFixed(2) || 0}%</div>
                <div><span class="status-badge ${bot.isActive ? 'active' : 'inactive'}">${bot.isActive ? 'Active' : 'Stopped'}</span></div>
                <div class="actions-cell">
                    <select style="font-size:11px;padding:4px 6px;background:var(--surface-secondary);border:1px solid rgba(255,255,255,0.1);border-radius:6px;color:var(--text-secondary);"
                        onchange="setBotCategory(${bot.id}, this.value)" data-bot-cat="${bot.id}">
                        ${catOptions}
                    </select>
                    <button class="action-btn ${bot.isActive ? 'danger' : 'success'}" onclick="toggleBot(${bot.id}, ${!bot.isActive})">
                        ${bot.isActive ? 'Stop' : 'Start'}
                    </button>
                    <button class="action-btn danger" onclick="deleteBot(${bot.id})">Delete</button>
                </div>
            `;
            tableBody.appendChild(row);
        });

    } catch (error) {
        console.error('Load bots error:', error);
        tableBody.innerHTML += `<div class="empty-state"><div class="empty-state-text">Error loading bots</div></div>`;
    }
}

async function setBotCategory(botId, categoryId) {
    try {
        await fetch(`/api/admin/bots/${botId}/category`, {
            method: 'PATCH', credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ category_id: categoryId || null })
        });
        showNotification('Категорію змінено', 'success');
    } catch (e) {
        showNotification('Помилка зміни категорії', 'error');
    }
}

async function toggleBot(botId, isActive) {
    try {
        const response = await fetch(`/api/admin/bots/${botId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isActive })
        });

        if (!response.ok) throw new Error('Failed to toggle bot');

        showNotification(`Bot ${isActive ? 'started' : 'stopped'} successfully`, 'success');
        loadBots();
        loadDashboardStats();

    } catch (error) {
        console.error('Toggle bot error:', error);
        showNotification('Failed to toggle bot', 'error');
    }
}

async function deleteBot(botId) {
    pendingDeleteBotId = botId;
    showConfirmModal('Delete Bot', 'Are you sure you want to delete this bot?', confirmDeleteBot);
}

async function confirmDeleteBot() {
    if (!pendingDeleteBotId) return;
    const botId = pendingDeleteBotId;
    pendingDeleteBotId = null;
    closeConfirmModal();

    try {
        const response = await fetch(`/api/admin/bots/${botId}`, {
            method: 'DELETE'
        });

        if (!response.ok) throw new Error('Failed to delete bot');

        showNotification('Bot deleted successfully', 'success');
        loadBots();
        loadDashboardStats();

    } catch (error) {
        console.error('Delete bot error:', error);
        showNotification('Failed to delete bot', 'error');
    }
}

// ==================== BOT CATEGORIES ====================
let editCatId = null;

const ADMIN_CAT_ICONS = {
    cpu:    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="4" width="16" height="16" rx="2"/><rect x="9" y="9" width="6" height="6"/><line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/><line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/><line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/><line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/></svg>',
    grid:   '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>',
    scale:  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="3" x2="12" y2="21"/><path d="M3 6l4 8H3l4-8zm14 0l4 8h-8l4-8z"/></svg>',
    folder: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
    trend:  '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>',
    bot:    '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="10" rx="2"/><path d="M7 11V8a5 5 0 0 1 10 0v3"/><line x1="12" y1="4" x2="12" y2="6"/></svg>',
};

async function loadCategories() {
    try {
        const res = await fetch('/api/admin/bot-categories', { credentials: 'include' });
        if (!res.ok) throw new Error('Failed');
        const { categories } = await res.json();
        const list = document.getElementById('catList');
        if (!list) return;
        if (categories.length === 0) {
            list.innerHTML = '<div style="color:var(--text-tertiary);font-size:13px;padding:8px 0;">Немає категорій. Натисніть "+ Нова категорія" щоб створити.</div>';
            return;
        }
        list.innerHTML = categories.map(c => {
            const iconSvg = ADMIN_CAT_ICONS[c.icon] || ADMIN_CAT_ICONS['folder'];
            return `
            <div style="display:flex;align-items:center;gap:12px;padding:10px 14px;
                background:var(--surface-secondary);border-radius:10px;
                border-left:3px solid ${c.color};">
                <span style="color:${c.color};display:flex;align-items:center;">${iconSvg}</span>
                <span style="font-weight:700;color:#fff;flex:1;">${escapeHtml(c.name)}</span>
                <span style="font-size:10px;font-weight:700;color:var(--text-tertiary);
                    background:rgba(255,255,255,0.06);padding:2px 7px;border-radius:10px;">#${c.sort_order}</span>
                <span style="font-size:11px;font-weight:600;color:${c.is_visible ? '#10B981' : '#6B7280'};">
                    ${c.is_visible ? 'Видима' : 'Прихована'}</span>
                <span style="width:10px;height:10px;border-radius:50%;background:${c.color};flex-shrink:0;"></span>
                <button class="action-btn secondary" style="padding:6px 10px;" onclick="editCat(${c.id})">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </button>
                <button class="action-btn danger" style="padding:6px 10px;" onclick="deleteCat(${c.id})">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                </button>
            </div>`;
        }).join('');
    } catch (e) {
        const list = document.getElementById('catList');
        if (list) list.innerHTML = '<div style="color:var(--text-tertiary);font-size:13px;">Помилка завантаження</div>';
    }
}

function openCatModal(cat = null) {
    editCatId = cat ? cat.id : null;
    const modal = document.getElementById('catModal');
    if (!modal) return;
    document.getElementById('catModalTitle').textContent = cat ? 'Редагувати категорію' : 'Нова категорія';
    document.getElementById('catName').value   = cat?.name  || '';
    document.getElementById('catColor').value  = cat?.color || '#10B981';
    document.getElementById('catIcon').value   = cat?.icon  || 'cpu';
    document.getElementById('catOrder').value  = cat?.sort_order ?? 0;
    document.getElementById('catVisible').checked = cat ? !!cat.is_visible : true;
    modal.classList.add('active');
}

function closeCatModal() {
    const modal = document.getElementById('catModal');
    if (modal) modal.classList.remove('active');
}

async function saveCat() {
    const body = {
        name: document.getElementById('catName').value,
        color: document.getElementById('catColor').value,
        icon: document.getElementById('catIcon').value,
        sort_order: +document.getElementById('catOrder').value,
        is_visible: document.getElementById('catVisible').checked ? 1 : 0,
    };
    if (!body.name) { showNotification('Введіть назву категорії', 'error'); return; }
    try {
        const url    = editCatId ? `/api/admin/bot-categories/${editCatId}` : '/api/admin/bot-categories';
        const method = editCatId ? 'PUT' : 'POST';
        const res    = await fetch(url, { method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        if (!res.ok) throw new Error('Failed');
        closeCatModal();
        loadCategories();
        showNotification(editCatId ? 'Категорію оновлено' : 'Категорію створено', 'success');
    } catch (e) {
        showNotification('Помилка збереження', 'error');
    }
}

async function deleteCat(id) {
    if (!confirm('Видалити категорію? Боти залишаться без категорії.')) return;
    try {
        await fetch(`/api/admin/bot-categories/${id}`, { method: 'DELETE', credentials: 'include' });
        loadCategories();
        showNotification('Категорію видалено', 'success');
    } catch (e) {
        showNotification('Помилка видалення', 'error');
    }
}

async function editCat(id) {
    try {
        const res = await fetch('/api/admin/bot-categories', { credentials: 'include' });
        const { categories } = await res.json();
        openCatModal(categories.find(c => c.id === id));
    } catch (e) {
        showNotification('Помилка завантаження', 'error');
    }
}

// Generic confirm modal functions
let confirmCallback = null;

function showConfirmModal(title, message, callback) {
    confirmCallback = callback;

    // Create or get confirm modal
    let modal = document.getElementById('confirmModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'confirmModal';
        modal.className = 'modal-overlay';
        modal.innerHTML = `
            <div class="modal-card" style="max-width: 400px; text-align: center;">
                <div class="modal-header" style="justify-content: center; margin-bottom: 16px;">
                    <span class="modal-title" id="confirmModalTitle"></span>
                </div>
                <p id="confirmModalMessage" style="color: var(--text-secondary); margin-bottom: 24px;"></p>
                <div class="modal-actions" style="justify-content: center;">
                    <button type="button" class="action-btn secondary" onclick="closeConfirmModal()">Cancel</button>
                    <button type="button" class="action-btn primary" onclick="executeConfirmCallback()">Confirm</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);
    }

    document.getElementById('confirmModalTitle').textContent = title;
    document.getElementById('confirmModalMessage').textContent = message;
    modal.classList.add('active');
}

function closeConfirmModal() {
    const modal = document.getElementById('confirmModal');
    if (modal) modal.classList.remove('active');
    confirmCallback = null;
}

function executeConfirmCallback() {
    if (confirmCallback) confirmCallback();
}

// Audit Logs
async function loadAuditLogs() {
    const tableBody = document.getElementById('auditTableBody');

    try {
        const response = await fetch(`/api/admin/audit-logs?page=${auditPage}&limit=50`);
        if (!response.ok) throw new Error('Failed to fetch audit logs');

        const data = await response.json();

        // Clear existing rows (keep header)
        const header = tableBody.querySelector('.table-row.header');
        tableBody.innerHTML = '';
        tableBody.appendChild(header);

        if (data.logs.length === 0) {
            tableBody.innerHTML += `
                <div class="empty-state">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                        <polyline points="14 2 14 8 20 8"></polyline>
                        <line x1="16" y1="13" x2="8" y2="13"></line>
                        <line x1="16" y1="17" x2="8" y2="17"></line>
                        <polyline points="10 9 9 9 8 9"></polyline>
                    </svg>
                    <div class="empty-state-text">No audit logs found</div>
                </div>
            `;
            return;
        }

        data.logs.forEach(log => {
            const row = document.createElement('div');
            row.className = 'table-row';
            row.innerHTML = `
                <div style="font-size: 12px;">${formatDate(log.createdAt)}</div>
                <div class="user-cell">
                    <span class="user-name">${escapeHtml(log.adminName || 'N/A')}</span>
                    <span class="user-email">${escapeHtml(log.adminEmail)}</span>
                </div>
                <div><span class="status-badge ${getActionClass(log.action)}">${formatAction(log.action)}</span></div>
                <div style="font-size: 12px; color: var(--text-secondary);">${escapeHtml(log.details || '-')}</div>
                <div style="font-size: 12px; color: var(--text-tertiary);">${log.ipAddress || '-'}</div>
            `;
            tableBody.appendChild(row);
        });

        // Render pagination
        renderPagination('auditPagination', data.page, data.totalPages, (page) => {
            auditPage = page;
            loadAuditLogs();
        });

    } catch (error) {
        console.error('Load audit logs error:', error);
        tableBody.innerHTML += `<div class="empty-state"><div class="empty-state-text">Error loading audit logs</div></div>`;
    }
}

function getActionClass(action) {
    if (action.includes('ban')) return 'banned';
    if (action.includes('unban') || action.includes('grant')) return 'active';
    return 'inactive';
}

function formatAction(action) {
    return action.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
}

// Utility Functions
function renderPagination(containerId, currentPage, totalPages, onPageChange) {
    const container = document.getElementById(containerId);
    if (!container) return;

    container.innerHTML = '';

    if (totalPages <= 1) return;

    // Previous button
    const prevBtn = document.createElement('button');
    prevBtn.className = 'page-btn';
    prevBtn.innerHTML = '&lt;';
    prevBtn.disabled = currentPage === 1;
    prevBtn.onclick = () => onPageChange(currentPage - 1);
    container.appendChild(prevBtn);

    // Page info
    const info = document.createElement('span');
    info.className = 'page-info';
    info.textContent = `Page ${currentPage} of ${totalPages}`;
    container.appendChild(info);

    // Next button
    const nextBtn = document.createElement('button');
    nextBtn.className = 'page-btn';
    nextBtn.innerHTML = '&gt;';
    nextBtn.disabled = currentPage === totalPages;
    nextBtn.onclick = () => onPageChange(currentPage + 1);
    container.appendChild(nextBtn);
}

function openModal(modalId) {
    document.getElementById(modalId).classList.add('active');
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
}

function formatCurrency(value) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    }).format(value || 0);
}

function formatDate(dateString) {
    if (!dateString) return '-';
    const date = new Date(dateString);
    return date.toLocaleString('uk-UA', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Capture app.js version before this file redefines it on window
const _appShowNotification = typeof window.showNotification === 'function'
    ? window.showNotification.bind(window)
    : null;

function showNotification(message, type = 'info') {
    if (_appShowNotification) {
        _appShowNotification(message, type);
        return;
    }

    // Simple fallback notification
    const notification = document.createElement('div');
    notification.style.cssText = `
        position: fixed;
        bottom: 20px;
        right: 20px;
        padding: 16px 24px;
        background: ${type === 'error' ? '#60063B' : type === 'success' ? '#10B981' : '#3B82F6'};
        color: white;
        border-radius: 12px;
        font-weight: 600;
        z-index: 9999;
        animation: slideIn 0.3s ease;
    `;
    notification.textContent = message;
    document.body.appendChild(notification);

    setTimeout(() => {
        notification.style.animation = 'slideOut 0.3s ease';
        setTimeout(() => notification.remove(), 300);
    }, 3000);
}

// ==================== NEWS MANAGEMENT ====================

async function loadNews() {
    const tableBody = document.getElementById('newsTableBody');

    try {
        const response = await fetch(`/api/admin/news?page=${newsPage}&limit=20`);
        if (!response.ok) throw new Error('Failed to fetch news');

        const data = await response.json();

        // Clear existing rows (keep header)
        const header = tableBody.querySelector('.table-row.header');
        tableBody.innerHTML = '';
        tableBody.appendChild(header);

        if (data.news.length === 0) {
            tableBody.innerHTML += `
                <div class="empty-state">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"></path>
                    </svg>
                    <div class="empty-state-text">No news found. Click "Add News" to create one.</div>
                </div>
            `;
            return;
        }

        data.news.forEach(news => {
            const row = document.createElement('div');
            row.className = 'table-row';

            // Create inner elements
            row.innerHTML = `
                <div>${news.id}</div>
                <div style="font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(news.title)}</div>
                <div><span class="category-badge ${news.category}">${news.category}</span></div>
                <div><span class="status-badge ${news.isPublished ? 'active' : 'inactive'}">${news.isPublished ? 'Published' : 'Draft'}</span></div>
                <div style="font-size: 12px; color: var(--text-secondary);">${escapeHtml(news.authorName || 'Unknown')}</div>
                <div style="font-size: 12px; color: var(--text-tertiary);">${formatDate(news.createdAt)}</div>
                <div class="actions-cell">
                    <button class="action-btn secondary" data-edit-id="${news.id}">Edit</button>
                    <button class="action-btn danger" data-delete-id="${news.id}" data-delete-title="${escapeHtml(news.title)}">Delete</button>
                </div>
            `;

            // Add event listeners
            row.querySelector('[data-edit-id]').addEventListener('click', () => editNews(news.id));
            row.querySelector('[data-delete-id]').addEventListener('click', () => openDeleteNewsModal(news.id, news.title));

            tableBody.appendChild(row);
        });

        // Render pagination
        renderPagination('newsPagination', data.page, data.totalPages, (page) => {
            newsPage = page;
            loadNews();
        });

    } catch (error) {
        console.error('Load news error:', error);
        tableBody.innerHTML += `<div class="empty-state"><div class="empty-state-text">Error loading news</div></div>`;
    }
}

function openNewsModal(newsData = null) {
    const modal = document.getElementById('newsModal');
    const form = document.getElementById('newsForm');
    const title = document.getElementById('newsModalTitle');
    const submitBtn = document.getElementById('newsSubmitBtn');

    // Reset form
    form.reset();
    document.getElementById('editNewsId').value = '';

    if (newsData) {
        // Edit mode
        title.textContent = 'Edit News';
        submitBtn.textContent = 'Save Changes';
        document.getElementById('editNewsId').value = newsData.id;
        document.getElementById('newsTitle').value = newsData.title || '';
        document.getElementById('newsCategory').value = newsData.category || 'update';
        document.getElementById('newsExcerpt').value = newsData.excerpt || '';
        document.getElementById('newsContent').value = newsData.content || '';
        document.getElementById('newsImageUrl').value = newsData.imageUrl || '';
        document.getElementById('newsPublished').checked = newsData.isPublished !== false;
    } else {
        // Create mode
        title.textContent = 'Add News';
        submitBtn.textContent = 'Create News';
        document.getElementById('newsPublished').checked = true;
    }

    openModal('newsModal');
}

async function editNews(newsId) {
    try {
        const response = await fetch(`/api/admin/news?page=1&limit=100`);
        if (!response.ok) throw new Error('Failed to fetch news');

        const data = await response.json();
        const news = data.news.find(n => n.id === newsId);

        if (!news) {
            showNotification('News not found', 'error');
            return;
        }

        // Get full news data
        const fullResponse = await fetch(`/api/news/${newsId}`);
        let fullNews = news;
        if (fullResponse.ok) {
            fullNews = await fullResponse.json();
            fullNews.isPublished = news.isPublished;
        }

        openNewsModal(fullNews);

    } catch (error) {
        console.error('Edit news error:', error);
        showNotification('Failed to load news details', 'error');
    }
}

function openDeleteNewsModal(newsId, newsTitle) {
    document.getElementById('deleteNewsId').value = newsId;
    document.getElementById('deleteNewsTitle').textContent = newsTitle;
    openModal('deleteNewsModal');
}

async function confirmDeleteNews() {
    const newsId = document.getElementById('deleteNewsId').value;

    try {
        const response = await fetch(`/api/admin/news/${newsId}`, {
            method: 'DELETE'
        });

        if (!response.ok) throw new Error('Failed to delete news');

        closeModal('deleteNewsModal');
        showNotification('News deleted successfully', 'success');
        loadNews();

    } catch (error) {
        console.error('Delete news error:', error);
        showNotification('Failed to delete news', 'error');
    }
}

// Handle news form submission
document.addEventListener('DOMContentLoaded', () => {
    const newsForm = document.getElementById('newsForm');
    if (newsForm) {
        newsForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const newsId = document.getElementById('editNewsId').value;
            const data = {
                title: document.getElementById('newsTitle').value,
                category: document.getElementById('newsCategory').value,
                excerpt: document.getElementById('newsExcerpt').value,
                content: document.getElementById('newsContent').value,
                imageUrl: document.getElementById('newsImageUrl').value,
                isPublished: document.getElementById('newsPublished').checked
            };

            try {
                let response;
                if (newsId) {
                    // Update existing news
                    response = await fetch(`/api/admin/news/${newsId}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(data)
                    });
                } else {
                    // Create new news
                    response = await fetch('/api/admin/news', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(data)
                    });
                }

                if (!response.ok) {
                    const error = await response.json();
                    throw new Error(error.error || 'Failed to save news');
                }

                closeModal('newsModal');
                showNotification(newsId ? 'News updated successfully' : 'News created successfully', 'success');
                loadNews();

            } catch (error) {
                console.error('Save news error:', error);
                showNotification(error.message || 'Failed to save news', 'error');
            }
        });
    }
});

// Close modal on overlay click
document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
            overlay.classList.remove('active');
        }
    });
});

// ==================== SUBSCRIPTIONS MANAGEMENT ====================

async function loadSubscriptions() {
    const search = document.getElementById('subscriptionSearch')?.value || '';
    const tableBody = document.getElementById('subscriptionsTableBody');

    try {
        const response = await fetch(`/api/admin/subscriptions?page=${subscriptionsPage}&limit=20&search=${encodeURIComponent(search)}`);
        if (!response.ok) throw new Error('Failed to fetch subscriptions');

        const data = await response.json();

        // Clear existing rows (keep header)
        const header = tableBody.querySelector('.table-row.header');
        tableBody.innerHTML = '';
        tableBody.appendChild(header);

        if (data.users.length === 0) {
            tableBody.innerHTML += `
                <div class="empty-state">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
                    </svg>
                    <div class="empty-state-text">No users found</div>
                </div>
            `;
            return;
        }

        data.users.forEach(user => {
            const row = document.createElement('div');
            row.className = 'table-row';

            const isExpired = user.subscriptionExpiresAt && new Date(user.subscriptionExpiresAt) < new Date();
            const planClass = user.subscriptionPlan === 'free' || isExpired ? 'free' : user.subscriptionPlan;
            const displayPlan = isExpired ? 'Expired' : user.subscriptionPlan.charAt(0).toUpperCase() + user.subscriptionPlan.slice(1);

            const expiresText = user.subscriptionExpiresAt
                ? formatDate(user.subscriptionExpiresAt)
                : '-';

            const statusText = user.subscriptionPlan === 'free'
                ? 'No subscription'
                : (isExpired ? 'Expired' : 'Active');
            const statusClass = user.subscriptionPlan === 'free' || isExpired ? 'inactive' : 'active';

            row.innerHTML = `
                <div>${user.id}</div>
                <div class="user-cell">
                    <span class="user-name">${escapeHtml(user.fullName || 'N/A')}</span>
                    <span class="user-email">${escapeHtml(user.email)}</span>
                </div>
                <div><span class="plan-badge ${planClass}">${displayPlan}</span></div>
                <div style="font-size: 12px; color: var(--text-secondary);">${expiresText}</div>
                <div><span class="status-badge ${statusClass}">${statusText}</span></div>
                <div class="actions-cell">
                    <button class="action-btn primary" onclick="openSubscriptionModal(${user.id}, '${escapeHtml(user.fullName || user.email)}', '${user.subscriptionPlan}')">
                        ${user.subscriptionPlan === 'free' ? 'Grant' : 'Edit'}
                    </button>
                    ${user.subscriptionPlan !== 'free' ? `
                        <button class="action-btn danger" onclick="openRevokeSubscriptionModal(${user.id}, '${escapeHtml(user.fullName || user.email)}', '${user.subscriptionPlan}')">Revoke</button>
                    ` : ''}
                </div>
            `;
            tableBody.appendChild(row);
        });

        // Render pagination
        renderPagination('subscriptionsPagination', data.page, data.totalPages, (page) => {
            subscriptionsPage = page;
            loadSubscriptions();
        });

    } catch (error) {
        console.error('Load subscriptions error:', error);
        tableBody.innerHTML += `<div class="empty-state"><div class="empty-state-text">Error loading subscriptions</div></div>`;
    }
}

function openSubscriptionModal(userId, userName, currentPlan) {
    document.getElementById('subscriptionUserId').value = userId;
    document.getElementById('subscriptionUserName').value = userName;
    document.getElementById('subscriptionPlan').value = currentPlan || 'free';

    // Show/hide days group based on current plan
    const daysGroup = document.getElementById('subscriptionDaysGroup');
    daysGroup.style.display = currentPlan === 'free' ? 'none' : 'block';

    openModal('subscriptionModal');
}

async function handleGrantSubscription(e) {
    e.preventDefault();

    const userId = document.getElementById('subscriptionUserId').value;
    const plan = document.getElementById('subscriptionPlan').value;
    const days = document.getElementById('subscriptionDays').value;

    try {
        const response = await fetch(`/api/admin/users/${userId}/subscription`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ plan, days: parseInt(days) })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to grant subscription');
        }

        closeModal('subscriptionModal');
        showNotification(
            plan === 'free' ? 'Subscription removed successfully' : `${plan.toUpperCase()} subscription granted for ${days} days`,
            'success'
        );
        loadSubscriptions();

    } catch (error) {
        console.error('Grant subscription error:', error);
        showNotification(error.message || 'Failed to grant subscription', 'error');
    }
}

function openRevokeSubscriptionModal(userId, userName, plan) {
    document.getElementById('revokeSubscriptionUserId').value = userId;
    document.getElementById('revokeSubscriptionUserName').textContent = userName;
    document.getElementById('revokeSubscriptionPlan').textContent = `Current plan: ${plan.toUpperCase()}`;
    openModal('revokeSubscriptionModal');
}

async function confirmRevokeSubscription() {
    const userId = document.getElementById('revokeSubscriptionUserId').value;

    try {
        const response = await fetch(`/api/admin/users/${userId}/subscription`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to revoke subscription');
        }

        closeModal('revokeSubscriptionModal');
        showNotification('Subscription revoked successfully', 'success');
        loadSubscriptions();

    } catch (error) {
        console.error('Revoke subscription error:', error);
        showNotification(error.message || 'Failed to revoke subscription', 'error');
    }
}

// ============================================
// DATABASE BROWSER
// ============================================

let dbPage = 1;
let dbPageSize = 50;
let dbCurrentTable = '';
let dbSortBy = 'id';
let dbSortOrder = 'DESC';
let dbColumns = [];
let dbEditingCell = null;

// Load list of tables
async function loadDatabaseTables() {
    try {
        const response = await fetch('/api/admin/tables');
        if (!response.ok) throw new Error('Failed to fetch tables');

        const data = await response.json();
        const selector = document.getElementById('tableSelector');

        selector.innerHTML = '<option value="">Select a table...</option>' +
            data.tables.map(t => `<option value="${t.name}">${t.name} (${t.rowCount} rows)</option>`).join('');

    } catch (error) {
        console.error('Load tables error:', error);
        showNotification('Failed to load tables', 'error');
    }
}

// Load table data
async function loadTableData(tableName, page = 1) {
    if (!tableName) return;

    dbCurrentTable = tableName;
    dbPage = page;

    const search = document.getElementById('dbSearch').value;

    try {
        // Show loading
        document.getElementById('dbTableBody').innerHTML = `
            <tr><td colspan="100" style="text-align: center; padding: 40px; color: var(--text-tertiary);">
                <div class="loader" style="width: 32px; height: 32px; border: 3px solid rgba(255,255,255,0.1); border-top-color: var(--accent-primary); border-radius: 50%; animation: spin 1s linear infinite; margin: 0 auto 12px;"></div>
                Loading data...
            </td></tr>
        `;

        const response = await fetch(`/api/admin/tables/${tableName}?page=${page}&limit=${dbPageSize}&search=${encodeURIComponent(search)}&sortBy=${dbSortBy}&sortOrder=${dbSortOrder}`);
        if (!response.ok) throw new Error('Failed to fetch table data');

        const data = await response.json();
        dbColumns = data.columns;

        // Update info bar
        document.getElementById('tableInfoBar').style.display = 'block';
        document.getElementById('currentTableName').textContent = tableName;
        document.getElementById('totalRows').textContent = data.total;
        document.getElementById('totalColumns').textContent = data.columns.length;

        // Show add button
        document.getElementById('addRecordBtn').style.display = 'flex';

        // Show table, hide placeholder
        document.getElementById('dbTablePlaceholder').style.display = 'none';
        document.getElementById('dbTable').style.display = 'table';

        // Render table header
        const thead = document.getElementById('dbTableHead');
        thead.innerHTML = `
            <tr>
                ${data.columns.map(col => `
                    <th style="padding: 12px 16px; text-align: left; font-weight: 600; color: var(--text-secondary); font-size: 12px; text-transform: uppercase; cursor: pointer; white-space: nowrap; border-bottom: 1px solid rgba(255,255,255,0.05);"
                        onclick="sortTable('${col.name}')" data-column="${col.name}">
                        ${col.name}
                        ${dbSortBy === col.name ? (dbSortOrder === 'ASC' ? ' ↑' : ' ↓') : ''}
                    </th>
                `).join('')}
                <th style="padding: 12px 16px; text-align: center; font-weight: 600; color: var(--text-secondary); font-size: 12px; text-transform: uppercase; border-bottom: 1px solid rgba(255,255,255,0.05); width: 100px;">Actions</th>
            </tr>
        `;

        // Render table body
        const tbody = document.getElementById('dbTableBody');
        if (data.rows.length === 0) {
            tbody.innerHTML = `<tr><td colspan="${data.columns.length + 1}" style="text-align: center; padding: 40px; color: var(--text-tertiary);">No records found</td></tr>`;
        } else {
            tbody.innerHTML = data.rows.map(row => `
                <tr data-id="${row.id}" style="border-bottom: 1px solid rgba(255,255,255,0.03);">
                    ${data.columns.map(col => `
                        <td class="editable-cell" data-column="${col.name}" data-original="${escapeHtml(String(row[col.name] ?? ''))}"
                            style="padding: 10px 16px; font-size: 13px; color: ${col.name === 'id' ? 'var(--text-tertiary)' : 'white'}; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;"
                            ${col.name !== 'id' && col.name !== 'created_at' ? 'ondblclick="startEditCell(this)"' : ''}
                            title="${escapeHtml(String(row[col.name] ?? ''))}"
                        >${formatCellValue(row[col.name], col.type)}</td>
                    `).join('')}
                    <td style="padding: 10px 16px; text-align: center;">
                        <button onclick="deleteRecord('${tableName}', ${row.id})" style="padding: 6px 10px; background: rgba(96, 6, 59, 0.1); border: none; border-radius: 6px; color: #60063B; font-size: 12px; cursor: pointer;" title="Delete">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>
                        </button>
                    </td>
                </tr>
            `).join('');
        }

        // Render pagination
        renderPagination('dbPagination', data.page, data.totalPages, (newPage) => loadTableData(tableName, newPage));

    } catch (error) {
        console.error('Load table data error:', error);
        showNotification('Failed to load table data', 'error');
    }
}

function formatCellValue(value, type) {
    if (value === null || value === undefined) return '<span style="color: var(--text-tertiary);">NULL</span>';
    if (typeof value === 'boolean') return value ? '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#22C55E" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>' : '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';
    if (type && type.toUpperCase().includes('TEXT') && String(value).length > 50) {
        return escapeHtml(String(value).substring(0, 50)) + '...';
    }
    return escapeHtml(String(value));
}

function sortTable(column) {
    if (dbSortBy === column) {
        dbSortOrder = dbSortOrder === 'ASC' ? 'DESC' : 'ASC';
    } else {
        dbSortBy = column;
        dbSortOrder = 'DESC';
    }
    loadTableData(dbCurrentTable, 1);
}

// Inline cell editing
function startEditCell(cell) {
    if (dbEditingCell) {
        cancelEditCell();
    }

    const column = cell.dataset.column;
    const original = cell.dataset.original;
    const rowId = cell.parentElement.dataset.id;

    dbEditingCell = cell;
    cell.classList.add('editing');

    const input = document.createElement('input');
    input.type = 'text';
    input.value = original;
    input.style.cssText = 'width: 100%; padding: 6px 8px; background: var(--surface); border: 1px solid var(--accent-primary); border-radius: 4px; color: white; font-size: 13px; outline: none;';

    input.onkeydown = async (e) => {
        if (e.key === 'Enter') {
            await saveEditCell(rowId, column, input.value);
        } else if (e.key === 'Escape') {
            cancelEditCell();
        }
    };

    input.onblur = () => {
        setTimeout(() => {
            if (dbEditingCell === cell) {
                cancelEditCell();
            }
        }, 100);
    };

    cell.innerHTML = '';
    cell.appendChild(input);
    input.focus();
    input.select();
}

function cancelEditCell() {
    if (!dbEditingCell) return;

    dbEditingCell.classList.remove('editing');
    dbEditingCell.textContent = dbEditingCell.dataset.original;
    dbEditingCell = null;
}

async function saveEditCell(rowId, column, newValue) {
    if (!dbEditingCell) return;

    try {
        const response = await fetch(`/api/admin/tables/${dbCurrentTable}/${rowId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ [column]: newValue })
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to update');
        }

        dbEditingCell.dataset.original = newValue;
        dbEditingCell.classList.remove('editing');
        dbEditingCell.textContent = newValue || '';
        dbEditingCell.style.background = 'rgba(16, 185, 129, 0.1)';
        setTimeout(() => { dbEditingCell.style.background = ''; }, 1000);

        dbEditingCell = null;
        showNotification('Record updated', 'success');

    } catch (error) {
        console.error('Save cell error:', error);
        showNotification(error.message || 'Failed to update', 'error');
        cancelEditCell();
    }
}

async function deleteRecord(tableName, recordId) {
    if (!confirm(`Are you sure you want to delete record #${recordId} from ${tableName}?`)) {
        return;
    }

    try {
        const response = await fetch(`/api/admin/tables/${tableName}/${recordId}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to delete');
        }

        showNotification('Record deleted', 'success');
        loadTableData(tableName, dbPage);

    } catch (error) {
        console.error('Delete record error:', error);
        showNotification(error.message || 'Failed to delete', 'error');
    }
}

function showAddRecordModal() {
    // Create dynamic form based on columns
    const formHtml = dbColumns
        .filter(col => col.name !== 'id' && col.name !== 'created_at')
        .map(col => `
            <div style="margin-bottom: 12px;">
                <label style="display: block; color: var(--text-secondary); font-size: 12px; margin-bottom: 4px;">${col.name}</label>
                <input type="text" name="${col.name}" placeholder="${col.type}"
                    style="width: 100%; padding: 10px 12px; background: var(--surface-secondary); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; color: white; font-size: 14px;">
            </div>
        `).join('');

    const modal = document.createElement('div');
    modal.id = 'addRecordModal';
    modal.className = 'modal active';
    modal.style.cssText = 'position: fixed; top: 0; left: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.8); display: flex; align-items: center; justify-content: center; z-index: 10000;';
    modal.innerHTML = `
        <div style="background: var(--surface); border-radius: 16px; width: 90%; max-width: 500px; max-height: 80vh; overflow: hidden; display: flex; flex-direction: column;">
            <div style="padding: 20px; border-bottom: 1px solid rgba(255,255,255,0.05); display: flex; justify-content: space-between; align-items: center;">
                <h3 style="margin: 0; color: white;">Add Record to ${dbCurrentTable}</h3>
                <button onclick="document.getElementById('addRecordModal').remove()" style="background: none; border: none; color: var(--text-secondary); cursor: pointer; font-size: 24px;">&times;</button>
            </div>
            <form id="addRecordForm" style="padding: 20px; overflow-y: auto;">
                ${formHtml}
            </form>
            <div style="padding: 16px 20px; border-top: 1px solid rgba(255,255,255,0.05); display: flex; gap: 12px; justify-content: flex-end;">
                <button type="button" onclick="document.getElementById('addRecordModal').remove()" style="padding: 10px 20px; background: var(--surface-secondary); border: none; border-radius: 8px; color: white; cursor: pointer;">Cancel</button>
                <button type="button" onclick="submitAddRecord()" style="padding: 10px 20px; background: #10B981; border: none; border-radius: 8px; color: white; cursor: pointer;">Add Record</button>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.remove(); });
}

async function submitAddRecord() {
    const form = document.getElementById('addRecordForm');
    const formData = new FormData(form);
    const data = {};

    for (const [key, value] of formData.entries()) {
        if (value.trim()) {
            data[key] = value;
        }
    }

    if (Object.keys(data).length === 0) {
        showNotification('Please fill at least one field', 'error');
        return;
    }

    try {
        const response = await fetch(`/api/admin/tables/${dbCurrentTable}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.error || 'Failed to create record');
        }

        document.getElementById('addRecordModal').remove();
        showNotification('Record created', 'success');
        loadTableData(dbCurrentTable, 1);

    } catch (error) {
        console.error('Add record error:', error);
        showNotification(error.message || 'Failed to create record', 'error');
    }
}

// Initialize database browser event listeners
function initDatabaseBrowser() {
    const tableSelector = document.getElementById('tableSelector');
    if (tableSelector) {
        tableSelector.addEventListener('change', (e) => {
            if (e.target.value) {
                dbPage = 1;
                dbSortBy = 'id';
                dbSortOrder = 'DESC';
                loadTableData(e.target.value);
            }
        });
    }

    const refreshBtn = document.getElementById('refreshTableBtn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            if (dbCurrentTable) {
                loadTableData(dbCurrentTable, dbPage);
            } else {
                loadDatabaseTables();
            }
        });
    }

    const dbSearch = document.getElementById('dbSearch');
    let searchTimeout;
    if (dbSearch) {
        dbSearch.addEventListener('input', () => {
            clearTimeout(searchTimeout);
            searchTimeout = setTimeout(() => {
                if (dbCurrentTable) {
                    loadTableData(dbCurrentTable, 1);
                }
            }, 300);
        });
    }

    const pageSizeSelect = document.getElementById('pageSizeSelect');
    if (pageSizeSelect) {
        pageSizeSelect.addEventListener('change', (e) => {
            dbPageSize = parseInt(e.target.value);
            if (dbCurrentTable) {
                loadTableData(dbCurrentTable, 1);
            }
        });
    }

    const addRecordBtn = document.getElementById('addRecordBtn');
    if (addRecordBtn) {
        addRecordBtn.addEventListener('click', showAddRecordModal);
    }
}

// Add initDatabaseBrowser to setupEventListeners
const originalSetupEventListeners = setupEventListeners;
setupEventListeners = function() {
    originalSetupEventListeners();
    initDatabaseBrowser();
};

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', initAdminPanel);
