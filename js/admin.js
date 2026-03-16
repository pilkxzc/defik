// Admin Panel JavaScript

let currentUser = null;
let usersPage = 1;
let transactionsPage = 1;
let auditPage = 1;
let newsPage = 1;
let subscriptionsPage = 1;
let analyticsData = null; // Store current analytics data for export

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

function _getTabFromUrl() {
    // Support /admin/users, /admin/database, etc. Also fallback to hash for old links
    const pathParts = window.location.pathname.split('/');
    // pathParts: ['', 'admin', 'users'] or ['', 'admin']
    if (pathParts.length >= 3 && pathParts[1] === 'admin' && pathParts[2]) {
        return pathParts[2];
    }
    if (window.location.hash) {
        return window.location.hash.replace('#', '');
    }
    return 'dashboard';
}

function setupEventListeners() {
    // Handle browser back/forward
    window.addEventListener('popstate', (e) => {
        const tab = (e.state && e.state.tab) ? e.state.tab : _getTabFromUrl();
        switchTab(tab);
    });

    // Initial tab from URL
    const initialTab = _getTabFromUrl();
    const validTabs = ['dashboard','users','database','subscriptions','transactions','bots','news','audit','analytics','backup','bug-reports','access','full-stats'];
    if (validTabs.includes(initialTab) && initialTab !== 'dashboard') {
        setTimeout(() => switchTab(initialTab), 100);
    }

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

    // Analytics date range filter
    const analyticsApplyFilter = document.getElementById('analyticsApplyFilter');
    const analyticsResetFilter = document.getElementById('analyticsResetFilter');
    const analyticsExportCSV = document.getElementById('analyticsExportCSV');

    if (analyticsApplyFilter) {
        analyticsApplyFilter.addEventListener('click', () => {
            loadAnalytics();
        });
    }

    if (analyticsResetFilter) {
        analyticsResetFilter.addEventListener('click', () => {
            document.getElementById('analyticsDateFrom').value = '';
            document.getElementById('analyticsDateTo').value = '';
            loadAnalytics();
        });
    }

    if (analyticsExportCSV) {
        analyticsExportCSV.addEventListener('click', exportAnalyticsCSV);
    }

    // Initialize default date range (last 30 days)
    const today = new Date();
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(today.getDate() - 30);

    const dateFrom = document.getElementById('analyticsDateFrom');
    const dateTo = document.getElementById('analyticsDateTo');
    if (dateFrom && dateTo) {
        dateFrom.value = thirtyDaysAgo.toISOString().split('T')[0];
        dateTo.value = today.toISOString().split('T')[0];
    }
}

const _tabTitles = {
    'dashboard': 'Дашборд',
    'users': 'Користувачі',
    'database': 'База даних',
    'subscriptions': 'Підписки',
    'transactions': 'Транзакції',
    'bots': 'Боти',
    'news': 'Новини',
    'audit': 'Аудит',
    'analytics': 'Аналітика',
    'backup': 'Бекапи',
    'bug-reports': 'Баг-репорти',
    'access': 'Доступи',
    'full-stats': 'Повна статистика'
};

let _previousTab = null;

function switchTab(tabName) {
    // Lock secure session when leaving database or backup
    if (_previousTab === 'database' && tabName !== 'database') {
        _onSecureTabLeave('database');
    }
    if (_previousTab === 'backup' && tabName !== 'backup') {
        _onSecureTabLeave('backup');
    }
    _previousTab = tabName;

    // Update header page title
    const titleEl = document.getElementById('adminPageTitle');
    if (titleEl) {
        titleEl.textContent = '— ' + (_tabTitles[tabName] || tabName);
    }

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
            checkDbAccessAndLoad();
            break;
        case 'analytics':
            loadAnalytics();
            break;
        case 'backup':
            checkBackupAccessAndLoad();
            break;
        case 'bug-reports':
            loadBugReports();
            break;
        case 'access':
            loadAccessTab();
            break;
        case 'full-stats':
            loadFullStats();
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

        // Load bug reporting status
        await loadBugReportingStatus();

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
                status.innerHTML = `<span style="color: var(--color-down);">Site is in maintenance mode</span><br><small style="color: var(--text-tertiary);">Enabled by: ${escapeHtml(data.enabledBy)} (${escapeHtml(data.enabledAt)})</small>`;
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

// ==================== SECURE ACCESS CONTROL (DB & Backup) ====================
let _secureAccessState = {}; // { database: { granted, isMainAdmin }, backup: { ... } }
let _secureHeartbeatTimers = {}; // { database: intervalId, backup: intervalId }
let _secureCurrentTab = null;

// Generic: check access for a protected tab
async function _checkSecureAccess(tabKey, containerId) {
    const container = document.getElementById(containerId);
    try {
        const res = await fetch('/api/admin/db-access/status');
        const data = await res.json();
        _secureAccessState[tabKey] = { isMainAdmin: data.isMainAdmin, hasAccess: data.hasAccess };

        if (data.isMainAdmin) {
            if (data.dbVerified) {
                _showSecureContent(tabKey, container);
                _startSecureHeartbeat(tabKey, container);
                return true;
            } else if (!data.has2FA && !data.hasAccessKey && !data.hasPasskeys) {
                _showSecureNoAuth(tabKey, container);
            } else {
                _showSecureVerify(tabKey, container, data.has2FA, data.hasAccessKey, data.hasPasskeys);
            }
            return false;
        }

        if (!data.hasAccess) {
            _showSecureAccessDenied(tabKey, container);
            return false;
        }

        _showSecureContent(tabKey, container);
        return true;
    } catch (err) {
        console.error(`${tabKey} access check failed:`, err);
        _showSecureAccessDenied(tabKey, container);
        return false;
    }
}

async function checkDbAccessAndLoad() {
    _secureCurrentTab = 'database';
    const ok = await _checkSecureAccess('database', 'tab-database');
    if (ok) loadDatabaseTables();
}

async function checkBackupAccessAndLoad() {
    _secureCurrentTab = 'backup';
    const ok = await _checkSecureAccess('backup', 'tab-backup');
    if (ok) loadBackupTab();
}

// Heartbeat — keeps session alive while on protected tab, auto-locks on leave
function _startSecureHeartbeat(tabKey, container) {
    _stopSecureHeartbeat(tabKey);
    // Send heartbeat every 60s
    _secureHeartbeatTimers[tabKey] = setInterval(async () => {
        // Check if user is still on this tab
        const currentTab = _getTabFromUrl();
        if (currentTab !== (tabKey === 'database' ? 'database' : 'backup')) {
            _stopSecureHeartbeat(tabKey);
            // Lock session on server
            fetch('/api/admin/db-access/lock', { method: 'POST' }).catch(() => {});
            return;
        }
        try {
            const res = await fetch('/api/admin/db-access/heartbeat', { method: 'POST' });
            if (!res.ok) {
                // Session expired
                _stopSecureHeartbeat(tabKey);
                _showSecureVerify(tabKey, container, true, true, true);
                showNotification('Сесія доступу закінчилась', 'warning');
            }
        } catch (e) { /* ignore */ }
    }, 60000);
}

function _stopSecureHeartbeat(tabKey) {
    if (_secureHeartbeatTimers[tabKey]) {
        clearInterval(_secureHeartbeatTimers[tabKey]);
        _secureHeartbeatTimers[tabKey] = null;
    }
}

// Lock session when leaving protected tab
function _onSecureTabLeave(tabKey) {
    _stopSecureHeartbeat(tabKey);
    if (_secureAccessState[tabKey]?.isMainAdmin) {
        fetch('/api/admin/db-access/lock', { method: 'POST' }).catch(() => {});
    }
}

function _showSecureAccessDenied(tabKey, container) {
    const existingOverlay = container.querySelector('.db-access-overlay');
    if (existingOverlay) existingOverlay.remove();

    const label = tabKey === 'database' ? 'бази даних' : 'бекапів';
    const overlay = document.createElement('div');
    overlay.className = 'db-access-overlay';
    overlay.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:400px;text-align:center;padding:40px;">
            <div style="width:80px;height:80px;border-radius:20px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.25);display:flex;align-items:center;justify-content:center;margin-bottom:24px;">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2">
                    <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>
                </svg>
            </div>
            <h2 style="font-size:22px;font-weight:800;margin-bottom:12px;">Доступ заборонено</h2>
            <p style="color:var(--text-secondary);font-size:14px;max-width:400px;line-height:1.6;margin-bottom:8px;">
                Доступ до ${label} обмежений. Для отримання доступу зверніться до головного адміністратора.
            </p>
            <p style="color:var(--text-tertiary);font-size:12px;">
                Тільки головний адмін може надати доступ через 2FA або ключ доступу.
            </p>
        </div>
    `;
    Array.from(container.children).forEach(ch => ch.style.display = 'none');
    container.appendChild(overlay);
    overlay.style.display = 'flex';
}

function _showSecureNoAuth(tabKey, container) {
    const existingOverlay = container.querySelector('.db-access-overlay');
    if (existingOverlay) existingOverlay.remove();

    const overlay = document.createElement('div');
    overlay.className = 'db-access-overlay';
    overlay.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:400px;text-align:center;padding:40px;">
            <div style="width:80px;height:80px;border-radius:20px;background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.25);display:flex;align-items:center;justify-content:center;margin-bottom:24px;">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
            </div>
            <h2 style="font-size:22px;font-weight:800;margin-bottom:12px;">Потрібна автентифікація</h2>
            <p style="color:var(--text-secondary);font-size:14px;max-width:400px;line-height:1.6;margin-bottom:24px;">
                Увімкніть 2FA в профілі або згенеруйте ключ доступу для захисту цієї секції.
            </p>
            <a href="/profile" style="padding:12px 28px;background:var(--accent-primary);border:none;border-radius:12px;color:white;font-weight:700;font-size:14px;text-decoration:none;display:inline-block;">
                Перейти в профіль
            </a>
        </div>
    `;
    Array.from(container.children).forEach(ch => ch.style.display = 'none');
    container.appendChild(overlay);
    overlay.style.display = 'flex';
}

function _showSecureVerify(tabKey, container, has2FA, hasAccessKey, hasPasskeys) {
    const existingOverlay = container.querySelector('.db-access-overlay');
    if (existingOverlay) existingOverlay.remove();

    const label = tabKey === 'database' ? 'бази даних' : 'бекапів';
    // Determine default active tab
    const defaultMode = has2FA ? '2fa' : hasPasskeys ? 'passkey' : 'key';

    const overlay = document.createElement('div');
    overlay.className = 'db-access-overlay';
    overlay.innerHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:400px;text-align:center;padding:40px;">
            <div style="width:80px;height:80px;border-radius:20px;background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.25);display:flex;align-items:center;justify-content:center;margin-bottom:24px;">
                <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2">
                    <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
                </svg>
            </div>
            <h2 style="font-size:22px;font-weight:800;margin-bottom:8px;">Підтвердження доступу</h2>
            <p style="color:var(--text-secondary);font-size:14px;max-width:400px;line-height:1.6;margin-bottom:4px;">
                Підтвердіть свою особу для доступу до ${label}.
            </p>
            <p style="color:var(--text-tertiary);font-size:12px;margin-bottom:24px;">Сесія активна 5 хвилин</p>

            <!-- Tab switcher -->
            <div style="display:flex;gap:4px;background:var(--surface-secondary);border-radius:10px;padding:4px;margin-bottom:20px;" id="secVerifyTabs_${tabKey}">
                ${has2FA ? `<button class="sv-tab${defaultMode === '2fa' ? ' active' : ''}" data-mode="2fa" style="padding:8px 16px;border-radius:8px;border:none;font-size:13px;font-weight:600;cursor:pointer;transition:0.2s;${defaultMode === '2fa' ? 'background:var(--accent-primary);color:white;' : 'background:transparent;color:var(--text-secondary);'}">2FA</button>` : ''}
                ${hasPasskeys ? `<button class="sv-tab${defaultMode === 'passkey' ? ' active' : ''}" data-mode="passkey" style="padding:8px 16px;border-radius:8px;border:none;font-size:13px;font-weight:600;cursor:pointer;transition:0.2s;${defaultMode === 'passkey' ? 'background:var(--accent-primary);color:white;' : 'background:transparent;color:var(--text-secondary);'}">Passkey</button>` : ''}
                ${hasAccessKey ? `<button class="sv-tab${defaultMode === 'key' ? ' active' : ''}" data-mode="key" style="padding:8px 16px;border-radius:8px;border:none;font-size:13px;font-weight:600;cursor:pointer;transition:0.2s;${defaultMode === 'key' ? 'background:var(--accent-primary);color:white;' : 'background:transparent;color:var(--text-secondary);'}">Ключ</button>` : ''}
            </div>

            <!-- 2FA input -->
            <div id="secVerify2fa_${tabKey}" style="${defaultMode === '2fa' ? '' : 'display:none;'}">
                <div style="display:flex;gap:12px;align-items:center;">
                    <input type="text" id="secCode2fa_${tabKey}" maxlength="6" placeholder="000000"
                        style="width:160px;padding:14px 20px;background:var(--surface-secondary);border:1px solid rgba(255,255,255,0.1);border-radius:12px;color:white;font-size:20px;text-align:center;letter-spacing:8px;font-weight:700;outline:none;"
                        autocomplete="one-time-code" inputmode="numeric">
                    <button onclick="_submitSecureVerify('${tabKey}','2fa')"
                        style="padding:14px 28px;background:var(--accent-primary);border:none;border-radius:12px;color:white;font-weight:700;font-size:14px;cursor:pointer;">
                        Підтвердити
                    </button>
                </div>
            </div>

            <!-- Passkey -->
            <div id="secVerifyPasskey_${tabKey}" style="${defaultMode === 'passkey' ? '' : 'display:none;'}">
                <button onclick="_submitSecureVerify('${tabKey}','passkey')" id="secPasskeyBtn_${tabKey}"
                    style="padding:16px 36px;background:linear-gradient(135deg, #6366F1 0%, #8B5CF6 100%);border:none;border-radius:14px;color:white;font-weight:700;font-size:15px;cursor:pointer;display:flex;align-items:center;gap:10px;transition:0.2s;">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <path d="M2 12C2 6.5 6.5 2 12 2a10 10 0 0 1 8 4"/><path d="M5 19.5C5.5 18 6 15 6 12"/><circle cx="12" cy="12" r="2"/>
                        <path d="M21 12c0 3-2 6-4 8"/><path d="M15 6.2c1.5.7 2.8 2 3.5 3.5"/>
                    </svg>
                    Підтвердити Passkey
                </button>
            </div>

            <!-- Access Key input -->
            <div id="secVerifyKey_${tabKey}" style="${defaultMode === 'key' ? '' : 'display:none;'}">
                <div style="display:flex;gap:12px;align-items:center;">
                    <input type="password" id="secCodeKey_${tabKey}" placeholder="Ключ доступу"
                        style="width:240px;padding:14px 20px;background:var(--surface-secondary);border:1px solid rgba(255,255,255,0.1);border-radius:12px;color:white;font-size:14px;font-weight:600;outline:none;">
                    <button onclick="_submitSecureVerify('${tabKey}','key')"
                        style="padding:14px 28px;background:var(--accent-primary);border:none;border-radius:12px;color:white;font-weight:700;font-size:14px;cursor:pointer;">
                        Підтвердити
                    </button>
                </div>
            </div>

            <p id="secVerifyError_${tabKey}" style="color:#EF4444;font-size:13px;margin-top:12px;display:none;"></p>
        </div>
    `;
    Array.from(container.children).forEach(ch => ch.style.display = 'none');
    container.appendChild(overlay);
    overlay.style.display = 'flex';

    // Tab switching
    overlay.querySelectorAll('.sv-tab').forEach(btn => {
        btn.addEventListener('click', () => {
            overlay.querySelectorAll('.sv-tab').forEach(b => {
                b.style.background = 'transparent';
                b.style.color = 'var(--text-secondary)';
                b.classList.remove('active');
            });
            btn.style.background = 'var(--accent-primary)';
            btn.style.color = 'white';
            btn.classList.add('active');
            const mode = btn.dataset.mode;
            ['2fa', 'Passkey', 'Key'].forEach(s => {
                const el = document.getElementById(`secVerify${s === '2fa' ? '2fa' : s}_${tabKey}`);
                if (el) el.style.display = (mode === s.toLowerCase() || (s === '2fa' && mode === '2fa')) ? '' : 'none';
            });
            const fa = document.getElementById(`secVerify2fa_${tabKey}`);
            const pk = document.getElementById(`secVerifyPasskey_${tabKey}`);
            const key = document.getElementById(`secVerifyKey_${tabKey}`);
            if (fa) fa.style.display = mode === '2fa' ? '' : 'none';
            if (pk) pk.style.display = mode === 'passkey' ? '' : 'none';
            if (key) key.style.display = mode === 'key' ? '' : 'none';
        });
    });

    // Auto-submit on 6 digits for 2FA
    const input2fa = document.getElementById(`secCode2fa_${tabKey}`);
    if (input2fa) {
        input2fa.addEventListener('input', () => {
            if (input2fa.value.length === 6) _submitSecureVerify(tabKey, '2fa');
        });
        input2fa.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') _submitSecureVerify(tabKey, '2fa');
        });
        if (defaultMode === '2fa') setTimeout(() => input2fa.focus(), 100);
    }
    const inputKey = document.getElementById(`secCodeKey_${tabKey}`);
    if (inputKey) {
        inputKey.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') _submitSecureVerify(tabKey, 'key');
        });
        if (defaultMode === 'key') setTimeout(() => inputKey.focus(), 100);
    }
}

async function _submitSecureVerify(tabKey, mode) {
    const errEl = document.getElementById(`secVerifyError_${tabKey}`);
    errEl.style.display = 'none';

    // Passkey flow — uses WebAuthn API
    if (mode === 'passkey') {
        try {
            const btn = document.getElementById(`secPasskeyBtn_${tabKey}`);
            if (btn) { btn.disabled = true; btn.style.opacity = '0.6'; }

            // Get challenge from server
            const optRes = await fetch('/api/admin/db-access/passkey-options', { method: 'POST' });
            const options = await optRes.json();
            if (!optRes.ok) {
                errEl.textContent = options.error || 'Помилка passkey';
                errEl.style.display = 'block';
                if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
                return;
            }

            // Convert base64url to ArrayBuffer
            options.challenge = _b64urlToBuffer(options.challenge);
            if (options.allowCredentials) {
                options.allowCredentials = options.allowCredentials.map(c => ({
                    ...c, id: _b64urlToBuffer(c.id)
                }));
            }

            // Trigger WebAuthn
            const credential = await navigator.credentials.get({ publicKey: options });

            // Send response to server
            const verifyRes = await fetch('/api/admin/db-access/passkey-verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: credential.id,
                    rawId: _bufferToB64url(credential.rawId),
                    response: {
                        authenticatorData: _bufferToB64url(credential.response.authenticatorData),
                        clientDataJSON: _bufferToB64url(credential.response.clientDataJSON),
                        signature: _bufferToB64url(credential.response.signature)
                    },
                    type: credential.type
                })
            });
            const verifyData = await verifyRes.json();
            if (!verifyRes.ok) {
                errEl.textContent = verifyData.error || 'Passkey верифікація не вдалась';
                errEl.style.display = 'block';
                if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
                return;
            }

            // Success
            const containerId = tabKey === 'database' ? 'tab-database' : 'tab-backup';
            const cont = document.getElementById(containerId);
            _showSecureContent(tabKey, cont);
            _startSecureHeartbeat(tabKey, cont);
            if (tabKey === 'database') loadDatabaseTables();
            else loadBackupTab();
            return;
        } catch (err) {
            if (err.name === 'NotAllowedError') {
                errEl.textContent = 'Passkey скасовано';
            } else {
                errEl.textContent = 'Помилка Passkey: ' + (err.message || err);
            }
            errEl.style.display = 'block';
            const btn = document.getElementById(`secPasskeyBtn_${tabKey}`);
            if (btn) { btn.disabled = false; btn.style.opacity = '1'; }
            return;
        }
    }

    let body = {};

    if (mode === '2fa') {
        const code = document.getElementById(`secCode2fa_${tabKey}`).value.trim();
        if (!code || code.length < 6) {
            errEl.textContent = 'Введіть 6-значний код';
            errEl.style.display = 'block';
            return;
        }
        body.totpCode = code;
    } else {
        const key = document.getElementById(`secCodeKey_${tabKey}`).value.trim();
        if (!key) {
            errEl.textContent = 'Введіть ключ доступу';
            errEl.style.display = 'block';
            return;
        }
        body.accessKey = key;
    }

    try {
        const res = await fetch('/api/admin/db-access/verify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        const data = await res.json();
        if (!res.ok) {
            errEl.textContent = data.error || 'Помилка верифікації';
            errEl.style.display = 'block';
            if (mode === '2fa') {
                const inp = document.getElementById(`secCode2fa_${tabKey}`);
                inp.value = '';
                inp.focus();
            }
            return;
        }
        // Success
        const containerId = tabKey === 'database' ? 'tab-database' : 'tab-backup';
        const container = document.getElementById(containerId);
        _showSecureContent(tabKey, container);
        _startSecureHeartbeat(tabKey, container);
        if (tabKey === 'database') loadDatabaseTables();
        else loadBackupTab();
    } catch (err) {
        errEl.textContent = 'Помилка з\'єднання';
        errEl.style.display = 'block';
    }
}

function _showSecureContent(tabKey, container) {
    const overlay = container.querySelector('.db-access-overlay');
    if (overlay) overlay.remove();
    Array.from(container.children).forEach(ch => ch.style.display = '');
}

let _accVerified = false;
let _accExpandedUser = null;

async function loadAccessTab() {
    const container = document.getElementById('accessTabContent');
    container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-tertiary);">Завантаження...</div>';
    _accVerified = false;

    try {
        const statusRes = await fetch('/api/admin/db-access/status');
        const status = await statusRes.json();

        if (!status.isMainAdmin) {
            container.innerHTML = `
                <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:300px;text-align:center;padding:40px;">
                    <div style="width:72px;height:72px;border-radius:18px;background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.2);display:flex;align-items:center;justify-content:center;margin-bottom:20px;">
                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                    </div>
                    <h3 style="font-size:18px;font-weight:800;margin-bottom:8px;">Доступ обмежений</h3>
                    <p style="color:var(--text-secondary);font-size:14px;">Тільки головний адміністратор може керувати доступами.</p>
                </div>
            `;
            return;
        }

        if (status.dbVerified) _accVerified = true;

        const usersRes = await fetch('/api/admin/db-access/users');
        if (!usersRes.ok) throw new Error('Failed to load users');
        const usersData = await usersRes.json();

        _renderAccessTab(usersData.admins, usersData.availablePermissions, status);
    } catch (err) {
        console.error('loadAccessTab error:', err);
        container.innerHTML = '<div style="text-align:center;padding:40px;color:#EF4444;">Помилка завантаження</div>';
    }
}

function _renderAccessTab(admins, availablePerms, status) {
    const container = document.getElementById('accessTabContent');
    const permKeys = Object.keys(availablePerms);

    const getInitials = (name) => {
        if (!name) return '?';
        const parts = name.trim().split(/\s+/);
        return parts.length >= 2 ? (parts[0][0] + parts[1][0]).toUpperCase() : name.substring(0,2).toUpperCase();
    };
    const avatarColors = ['#6366F1','#10B981','#F59E0B','#EF4444','#8B5CF6','#EC4899','#06B6D4','#F97316'];

    container.innerHTML = `
    <div class="acc-page">
        <!-- Verification bar -->
        <div class="acc-section" id="accVerifyBar" style="border:1px solid ${_accVerified ? 'rgba(16,185,129,0.25)' : 'rgba(245,158,11,0.25)'};">
            <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;">
                <div style="display:flex;align-items:center;gap:12px;">
                    <div style="width:40px;height:40px;border-radius:12px;background:${_accVerified ? 'rgba(16,185,129,0.12)' : 'rgba(245,158,11,0.12)'};display:flex;align-items:center;justify-content:center;flex-shrink:0;">
                        ${_accVerified
                            ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'
                            : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>'
                        }
                    </div>
                    <div>
                        <div style="font-weight:700;font-size:14px;">${_accVerified ? 'Сесія верифікована' : 'Підтвердіть особу'}</div>
                        <div style="color:var(--text-tertiary);font-size:12px;">${_accVerified ? 'Ви можете перемикати дозволи (5 хв сесія)' : 'Для зміни дозволів потрібна верифікація'}</div>
                    </div>
                </div>
                <div id="accVerifyButtons" style="display:flex;gap:8px;flex-wrap:wrap;">
                    ${_accVerified ? '<span style="font-size:12px;color:#10B981;font-weight:700;padding:8px 0;">Активна</span>' : `
                        ${status.has2FA ? '<button class="acc-btn primary" id="accVerify2faBtn" style="font-size:12px;padding:8px 14px;">2FA</button>' : ''}
                        ${status.hasPasskeys ? '<button class="acc-btn" id="accVerifyPasskeyBtn" style="font-size:12px;padding:8px 14px;background:rgba(99,102,241,0.15);border:1px solid rgba(99,102,241,0.3);color:#818CF8;"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="vertical-align:-2px;margin-right:4px;"><path d="M2 12C2 6.5 6.5 2 12 2a10 10 0 0 1 8 4"/><circle cx="12" cy="12" r="2"/><path d="M21 12c0 3-2 6-4 8"/></svg>Passkey</button>' : ''}
                        ${status.hasAccessKey ? '<button class="acc-btn" id="accVerifyKeyBtn" style="font-size:12px;padding:8px 14px;background:rgba(245,158,11,0.15);border:1px solid rgba(245,158,11,0.3);color:#F59E0B;">Ключ</button>' : ''}
                    `}
                </div>
            </div>
            <div class="acc-confirm-row" id="accVerifyInput">
                <div class="acc-input-row" style="margin-top:4px;">
                    <input type="text" class="acc-code-input" id="accVerifyCode" maxlength="64" placeholder="" autocomplete="off">
                    <button class="acc-btn primary" id="accVerifySubmit">Підтвердити</button>
                </div>
                <p class="acc-error" id="accVerifyError"></p>
            </div>
        </div>

        <!-- Access key management -->
        <div class="acc-section">
            <div class="acc-section-head">
                <div class="acc-section-icon" style="background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.15);">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
                </div>
                <div><div class="acc-section-title">Ключ доступу</div></div>
                <div style="margin-left:auto;">
                    <span class="acc-key-status ${status.hasAccessKey ? 'active' : 'inactive'}">
                        <svg width="8" height="8" viewBox="0 0 8 8"><circle cx="4" cy="4" r="4" fill="currentColor"/></svg>
                        ${status.hasAccessKey ? 'Активний' : 'Не встановлено'}
                    </span>
                </div>
            </div>
            <p class="acc-section-desc">Альтернатива 2FA для доступу до захищених розділів.</p>
            <div style="display:flex;gap:10px;flex-wrap:wrap;">
                <button class="acc-btn green" id="accGenKeyBtn">Згенерувати</button>
                ${status.hasAccessKey ? '<button class="acc-btn red" id="accDelKeyBtn">Видалити</button>' : ''}
            </div>
            <div id="accKeyResult" style="display:none;margin-top:16px;"></div>
            <div class="acc-confirm-row" id="accKeyTotpArea">
                <div class="acc-confirm-label">Введіть 2FA-код:</div>
                <div class="acc-input-row">
                    <input type="text" class="acc-code-input" id="accKeyTotpCode" maxlength="6" placeholder="000000" inputmode="numeric" autocomplete="off">
                    <button class="acc-btn primary" id="accKeyTotpSubmit">OK</button>
                </div>
                <p class="acc-error" id="accKeyError"></p>
            </div>
        </div>

        <!-- Discord-style permissions -->
        <div class="acc-section">
            <div class="acc-section-head">
                <div class="acc-section-icon" style="background:rgba(139,92,246,0.1);border:1px solid rgba(139,92,246,0.15);">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#A78BFA" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                </div>
                <div><div class="acc-section-title">Дозволи адміністраторів</div></div>
                <div style="margin-left:auto;font-size:12px;color:var(--text-tertiary);font-weight:600;">${admins.length} адмін(ів)</div>
            </div>
            <p class="acc-section-desc">Натисніть на адміністратора щоб розкрити та налаштувати його дозволи.</p>

            <div id="accAdminList" style="display:flex;flex-direction:column;gap:6px;">
                ${admins.map(a => {
                    const isMain = a.isMainAdmin;
                    const enabledCount = isMain ? permKeys.length : permKeys.filter(k => a.permissions[k]).length;
                    const color = avatarColors[a.id % avatarColors.length];
                    return `
                    <div class="acc-admin-card" data-uid="${a.id}" style="background:var(--surface-secondary,#1a1a1a);border-radius:14px;overflow:hidden;border:1px solid rgba(255,255,255,0.06);transition:border-color 0.2s;">
                        <!-- Header -->
                        <div class="acc-admin-header" data-uid="${a.id}" style="display:flex;align-items:center;padding:14px 16px;cursor:${isMain ? 'default' : 'pointer'};user-select:none;gap:12px;">
                            <div style="width:38px;height:38px;border-radius:50%;background:${color};display:flex;align-items:center;justify-content:center;font-weight:800;font-size:15px;color:white;flex-shrink:0;">${getInitials(a.full_name)}</div>
                            <div style="flex:1;min-width:0;">
                                <div style="font-weight:600;font-size:14px;display:flex;align-items:center;gap:6px;flex-wrap:wrap;">
                                    ${_escHtml(a.full_name)}
                                    ${isMain ? '<span style="font-size:10px;padding:2px 7px;background:rgba(245,158,11,0.15);color:#F59E0B;border-radius:4px;font-weight:700;">ВЛАСНИК</span>' : ''}
                                    ${a.role === 'moderator' ? '<span style="font-size:10px;padding:2px 7px;background:rgba(99,102,241,0.15);color:#818CF8;border-radius:4px;font-weight:700;">MOD</span>' : ''}
                                </div>
                                <div style="color:var(--text-tertiary);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${_escHtml(a.email)}</div>
                            </div>
                            <div style="display:flex;align-items:center;gap:8px;">
                                <span style="font-size:12px;font-weight:700;color:${isMain || enabledCount > 0 ? '#10B981' : 'var(--text-tertiary)'};">${isMain ? 'Всі дозволи' : enabledCount + '/' + permKeys.length}</span>
                                ${!isMain ? '<svg class="acc-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" stroke-width="2" style="transition:transform 0.2s;flex-shrink:0;"><polyline points="6 9 12 15 18 9"/></svg>' : ''}
                            </div>
                        </div>
                        ${!isMain ? `
                        <!-- Permissions panel -->
                        <div class="acc-admin-perms" data-uid="${a.id}" style="display:none;padding:0 16px 16px;border-top:1px solid rgba(255,255,255,0.06);">
                            <div style="padding-top:14px;display:flex;flex-direction:column;gap:0;">
                                ${permKeys.map(k => {
                                    const p = availablePerms[k];
                                    const on = !!a.permissions[k];
                                    return `
                                    <div class="acc-perm-row" style="display:flex;align-items:center;justify-content:space-between;padding:11px 4px;border-bottom:1px solid rgba(255,255,255,0.04);">
                                        <div style="flex:1;min-width:0;">
                                            <div style="font-size:13px;font-weight:600;">${_escHtml(p.label)}</div>
                                            <div style="font-size:11px;color:var(--text-tertiary);margin-top:1px;">${_escHtml(p.description)}</div>
                                        </div>
                                        <label class="acc-switch">
                                            <input type="checkbox" class="acc-perm-toggle" data-uid="${a.id}" data-perm="${k}" ${on ? 'checked' : ''}>
                                            <span class="acc-switch-track"></span>
                                            <span class="acc-switch-thumb"></span>
                                        </label>
                                    </div>`;
                                }).join('')}
                            </div>
                        </div>` : ''}
                    </div>`;
                }).join('')}
            </div>
        </div>
    </div>
    `;

    _wireAccessTabEvents(admins, availablePerms, status);
}

function _wireAccessTabEvents(admins, availablePerms, status) {
    const container = document.getElementById('accessTabContent');
    let _accVerifyMode = null;

    // ── Expand/collapse admin cards ──
    container.querySelectorAll('.acc-admin-header').forEach(hdr => {
        const uid = hdr.dataset.uid;
        const permsEl = container.querySelector(`.acc-admin-perms[data-uid="${uid}"]`);
        if (!permsEl) return;
        hdr.addEventListener('click', () => {
            const isOpen = permsEl.style.display !== 'none';
            container.querySelectorAll('.acc-admin-perms').forEach(p => p.style.display = 'none');
            container.querySelectorAll('.acc-chevron').forEach(c => c.style.transform = '');
            container.querySelectorAll('.acc-admin-card').forEach(c => c.style.borderColor = 'rgba(255,255,255,0.06)');
            if (!isOpen) {
                permsEl.style.display = 'block';
                hdr.querySelector('.acc-chevron')?.style && (hdr.querySelector('.acc-chevron').style.transform = 'rotate(180deg)');
                hdr.closest('.acc-admin-card').style.borderColor = 'rgba(99,102,241,0.3)';
                _accExpandedUser = parseInt(uid);
            } else {
                _accExpandedUser = null;
            }
        });
    });

    // ── Permission toggles ──
    container.querySelectorAll('.acc-perm-toggle').forEach(cb => {
        cb.addEventListener('change', async () => {
            const userId = parseInt(cb.dataset.uid);
            const perm = cb.dataset.perm;
            const grant = cb.checked;

            if (!_accVerified) {
                cb.checked = !grant;
                showNotification('Спочатку підтвердіть свою особу', 'warning');
                return;
            }

            try {
                const res = await fetch('/api/admin/db-access/toggle', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ userId, permission: perm, grant, useSession: true })
                });
                const data = await res.json();
                if (!res.ok) {
                    cb.checked = !grant;
                    if (data.error === 'Невірний код або ключ доступу') {
                        _accVerified = false;
                        showNotification('Сесія закінчилась — підтвердіть знову', 'warning');
                        _refreshVerifyBar(status);
                    } else {
                        showNotification(data.error || 'Помилка', 'error');
                    }
                    return;
                }

                // Update counter
                const card = container.querySelector(`.acc-admin-card[data-uid="${userId}"]`);
                if (card) {
                    const toggles = card.querySelectorAll('.acc-perm-toggle');
                    const enabled = Array.from(toggles).filter(t => t.checked).length;
                    const countSpan = card.querySelector('.acc-admin-header span[style*="font-weight:700"]');
                    if (countSpan && !countSpan.textContent.includes('Всі')) {
                        countSpan.textContent = enabled + '/' + toggles.length;
                        countSpan.style.color = enabled > 0 ? '#10B981' : 'var(--text-tertiary)';
                    }
                }

                showNotification(grant ? `${availablePerms[perm]?.label} — надано` : `${availablePerms[perm]?.label} — забрано`, 'success');
            } catch (err) {
                cb.checked = !grant;
                showNotification('Помилка з\'єднання', 'error');
            }
        });
    });

    // ── Verify: 2FA button ──
    document.getElementById('accVerify2faBtn')?.addEventListener('click', () => {
        _accVerifyMode = '2fa';
        const inp = document.getElementById('accVerifyCode');
        inp.placeholder = '000000';
        inp.maxLength = 6;
        inp.inputMode = 'numeric';
        document.getElementById('accVerifyInput').classList.add('show');
        inp.value = '';
        inp.focus();
        document.getElementById('accVerifyError').style.display = 'none';
    });

    // ── Verify: Access Key button ──
    document.getElementById('accVerifyKeyBtn')?.addEventListener('click', () => {
        _accVerifyMode = 'key';
        const inp = document.getElementById('accVerifyCode');
        inp.placeholder = 'Ключ доступу';
        inp.maxLength = 64;
        inp.inputMode = 'text';
        document.getElementById('accVerifyInput').classList.add('show');
        inp.value = '';
        inp.focus();
        document.getElementById('accVerifyError').style.display = 'none';
    });

    // ── Verify: Passkey button ──
    document.getElementById('accVerifyPasskeyBtn')?.addEventListener('click', async () => {
        const btn = document.getElementById('accVerifyPasskeyBtn');
        btn.disabled = true; btn.style.opacity = '0.6';
        try {
            const optRes = await fetch('/api/admin/db-access/passkey-options', { method: 'POST' });
            const options = await optRes.json();
            if (!optRes.ok) { showNotification(options.error || 'Помилка', 'error'); return; }

            options.challenge = _b64urlToBuffer(options.challenge);
            if (options.allowCredentials) {
                options.allowCredentials = options.allowCredentials.map(c => ({ ...c, id: _b64urlToBuffer(c.id) }));
            }

            const credential = await navigator.credentials.get({ publicKey: options });

            const verifyRes = await fetch('/api/admin/db-access/passkey-verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    id: credential.id,
                    rawId: _bufferToB64url(credential.rawId),
                    response: {
                        authenticatorData: _bufferToB64url(credential.response.authenticatorData),
                        clientDataJSON: _bufferToB64url(credential.response.clientDataJSON),
                        signature: _bufferToB64url(credential.response.signature)
                    },
                    type: credential.type
                })
            });
            if (!verifyRes.ok) {
                const d = await verifyRes.json();
                showNotification(d.error || 'Passkey не вдалось', 'error');
                return;
            }

            _accVerified = true;
            showNotification('Верифіковано через Passkey', 'success');
            _refreshVerifyBar(status);
        } catch (err) {
            if (err.name !== 'NotAllowedError') showNotification('Помилка Passkey', 'error');
        } finally {
            btn.disabled = false; btn.style.opacity = '1';
        }
    });

    // ── Verify: 2FA/Key submit ──
    document.getElementById('accVerifySubmit')?.addEventListener('click', async () => {
        const code = document.getElementById('accVerifyCode').value.trim();
        const errEl = document.getElementById('accVerifyError');
        if (!code) { errEl.textContent = 'Введіть код'; errEl.style.display = 'block'; return; }

        const body = _accVerifyMode === '2fa' ? { totpCode: code } : { accessKey: code };
        try {
            const res = await fetch('/api/admin/db-access/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body)
            });
            const data = await res.json();
            if (!res.ok) { errEl.textContent = data.error || 'Невірний код'; errEl.style.display = 'block'; return; }

            _accVerified = true;
            showNotification('Верифіковано', 'success');
            _refreshVerifyBar(status);
        } catch (e) { errEl.textContent = 'Помилка з\'єднання'; errEl.style.display = 'block'; }
    });

    // ── Access key gen/del ──
    let _accKeyAction = null;
    const keyTotpArea = document.getElementById('accKeyTotpArea');

    document.getElementById('accGenKeyBtn').addEventListener('click', () => {
        _accKeyAction = 'generate';
        keyTotpArea.classList.add('show');
        document.getElementById('accKeyTotpCode').value = '';
        document.getElementById('accKeyTotpCode').focus();
        document.getElementById('accKeyError').style.display = 'none';
        document.getElementById('accKeyResult').style.display = 'none';
    });

    document.getElementById('accDelKeyBtn')?.addEventListener('click', () => {
        _accKeyAction = 'delete';
        keyTotpArea.classList.add('show');
        document.getElementById('accKeyTotpCode').value = '';
        document.getElementById('accKeyTotpCode').focus();
        document.getElementById('accKeyError').style.display = 'none';
    });

    document.getElementById('accKeyTotpSubmit').addEventListener('click', async () => {
        const code = document.getElementById('accKeyTotpCode').value.trim();
        const errEl = document.getElementById('accKeyError');
        if (!code || code.length < 6) { errEl.textContent = 'Введіть 2FA код'; errEl.style.display = 'block'; return; }

        const url = _accKeyAction === 'generate' ? '/api/admin/db-access/generate-key' : '/api/admin/db-access/delete-key';
        try {
            const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ totpCode: code }) });
            const data = await res.json();
            if (!res.ok) { errEl.textContent = data.error || 'Помилка'; errEl.style.display = 'block'; return; }

            keyTotpArea.classList.remove('show');
            const resultEl = document.getElementById('accKeyResult');
            if (_accKeyAction === 'generate') {
                resultEl.innerHTML = `
                    <div style="background:rgba(16,185,129,0.06);border:1px solid rgba(16,185,129,0.15);border-radius:12px;padding:16px;">
                        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                            <span style="color:#10B981;font-size:13px;font-weight:700;">Ключ згенеровано!</span>
                        </div>
                        <code style="display:block;background:var(--bg-app,#080808);padding:12px 16px;border-radius:10px;font-size:15px;font-weight:700;color:white;word-break:break-all;user-select:all;letter-spacing:1px;">${_escHtml(data.key)}</code>
                        <p style="color:var(--text-tertiary);font-size:11px;margin-top:10px;">Збережіть — більше не буде показаний.</p>
                    </div>`;
                resultEl.style.display = 'block';
                showNotification('Ключ згенеровано', 'success');
            } else {
                showNotification('Ключ видалено', 'success');
                loadAccessTab();
            }
        } catch (e) { errEl.textContent = 'Помилка з\'єднання'; errEl.style.display = 'block'; }
    });
}

function _refreshVerifyBar(status) {
    const bar = document.getElementById('accVerifyBar');
    if (!bar) return;
    bar.style.borderColor = _accVerified ? 'rgba(16,185,129,0.25)' : 'rgba(245,158,11,0.25)';
    const icon = bar.querySelector('div[style*="width:40px"]');
    if (icon) {
        icon.style.background = _accVerified ? 'rgba(16,185,129,0.12)' : 'rgba(245,158,11,0.12)';
        icon.innerHTML = _accVerified
            ? '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>'
            : '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>';
    }
    const titleEl = bar.querySelector('div[style*="font-weight:700;font-size:14px"]');
    if (titleEl) titleEl.textContent = _accVerified ? 'Сесія верифікована' : 'Підтвердіть особу';
    const descEl = bar.querySelector('div[style*="color:var(--text-tertiary);font-size:12px"]');
    if (descEl) descEl.textContent = _accVerified ? 'Ви можете перемикати дозволи (5 хв сесія)' : 'Для зміни дозволів потрібна верифікація';
    const btns = document.getElementById('accVerifyButtons');
    if (btns) btns.innerHTML = _accVerified ? '<span style="font-size:12px;color:#10B981;font-weight:700;padding:8px 0;">Активна</span>' : '';
    const inp = document.getElementById('accVerifyInput');
    if (inp) inp.classList.remove('show');
}

// ==================== FULL STATS ====================

let _fstPage = 1;
let _fstFilters = {};

async function loadFullStats() {
    const container = document.getElementById('fullStatsContent');
    container.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-tertiary);">Завантаження...</div>';

    try {
        const [statsRes, logsRes] = await Promise.all([
            fetch('/api/admin/activity/stats'),
            fetch('/api/admin/activity?limit=50&page=1')
        ]);
        const stats = await statsRes.json();
        const logs = await logsRes.json();

        _fstPage = 1;
        _fstFilters = {};
        _renderFullStats(stats, logs);
    } catch (err) {
        console.error('loadFullStats error:', err);
        container.innerHTML = '<div style="text-align:center;padding:40px;color:#EF4444;">Помилка завантаження</div>';
    }
}

function _fstCatColor(cat) {
    const m = { auth:'#F59E0B', admin:'#EF4444', navigation:'#6366F1', client:'#06B6D4', bots:'#8B5CF6', orders:'#10B981', portfolio:'#EC4899', profile:'#F97316', market:'#3B82F6', api:'#A1A1A1' };
    return m[cat] || '#636363';
}

function _fstFormatDate(d) {
    if (!d) return '—';
    const dt = new Date(d.replace(' ', 'T') + (d.includes('T') ? '' : 'Z'));
    if (isNaN(dt)) return d;
    const pad = n => String(n).padStart(2, '0');
    return `${pad(dt.getDate())}.${pad(dt.getMonth()+1)} ${pad(dt.getHours())}:${pad(dt.getMinutes())}:${pad(dt.getSeconds())}`;
}

function _renderFullStats(stats, logs) {
    const container = document.getElementById('fullStatsContent');
    const maxHourly = Math.max(1, ...stats.hourlyData.map(h => h.count));
    const maxAction = Math.max(1, ...(stats.topActions || []).map(a => a.count));
    const maxPage = Math.max(1, ...(stats.topPages || []).map(p => p.hits));

    container.innerHTML = `
        <!-- Overview cards -->
        <div class="fst-grid">
            <div class="fst-card">
                <div class="fst-card-value" style="color:#10B981;">${(stats.todayEvents || 0).toLocaleString()}</div>
                <div class="fst-card-label">Подій сьогодні</div>
            </div>
            <div class="fst-card">
                <div class="fst-card-value" style="color:#6366F1;">${stats.uniqueUsersToday || 0}</div>
                <div class="fst-card-label">Юзерів сьогодні</div>
            </div>
            <div class="fst-card">
                <div class="fst-card-value" style="color:#F59E0B;">${stats.uniqueIpsToday || 0}</div>
                <div class="fst-card-label">Унік. IP</div>
            </div>
            <div class="fst-card">
                <div class="fst-card-value" style="color:#06B6D4;">${stats.hourEvents || 0}</div>
                <div class="fst-card-label">За останню годину</div>
            </div>
            <div class="fst-card">
                <div class="fst-card-value" style="color:#10B981;">${stats.loginsToday || 0}</div>
                <div class="fst-card-label">Логінів</div>
            </div>
            <div class="fst-card">
                <div class="fst-card-value" style="color:#EF4444;">${stats.failedLogins || 0}</div>
                <div class="fst-card-label">Невдалих логінів</div>
            </div>
            <div class="fst-card">
                <div class="fst-card-value" style="color:#8B5CF6;">${stats.registrations || 0}</div>
                <div class="fst-card-label">Реєстрацій</div>
            </div>
            <div class="fst-card">
                <div class="fst-card-value" style="color:${(stats.avgResponseTime || 0) > 500 ? '#EF4444' : '#10B981'};">${stats.avgResponseTime || 0}ms</div>
                <div class="fst-card-label">Серед. відповідь</div>
            </div>
            <div class="fst-card">
                <div class="fst-card-value" style="color:#EF4444;">${stats.slowRequests || 0}</div>
                <div class="fst-card-label">Повільних (>1с)</div>
            </div>
            <div class="fst-card">
                <div class="fst-card-value" style="color:#EF4444;">${stats.errors || 0}</div>
                <div class="fst-card-label">Помилок (4xx/5xx)</div>
            </div>
            <div class="fst-card">
                <div class="fst-card-value">${(stats.totalEvents || 0).toLocaleString()}</div>
                <div class="fst-card-label">Всього в базі</div>
            </div>
        </div>

        <!-- Hourly chart -->
        <div class="fst-section">
            <div class="fst-section-title">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2"><path d="M12 2v20M2 12h20"/></svg>
                Активність за 24 години
            </div>
            <div class="fst-hourly">
                ${Array.from({length:24}, (_, i) => {
                    const h = stats.hourlyData.find(d => parseInt(d.hour) === i);
                    const count = h ? h.count : 0;
                    const pct = Math.max(2, (count / maxHourly) * 100);
                    const intensity = count / maxHourly;
                    const bg = count === 0 ? 'rgba(255,255,255,0.04)' : `rgba(16,185,129,${0.15 + intensity * 0.45})`;
                    return `<div class="fst-hourly-bar" style="height:${pct}%;background:${bg};" title="${String(i).padStart(2,'0')}:00 — ${count} подій"></div>`;
                }).join('')}
            </div>
            <div style="display:flex;justify-content:space-between;font-size:10px;color:var(--text-tertiary);margin-top:4px;">
                <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:00</span>
            </div>
        </div>

        <div class="fst-two-col">
            <!-- Top actions -->
            <div class="fst-section">
                <div class="fst-section-title">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
                    Топ дій
                </div>
                <div style="display:flex;flex-direction:column;gap:8px;">
                    ${(stats.topActions || []).slice(0, 10).map(a => `
                        <div style="display:flex;align-items:center;gap:8px;">
                            <span class="fst-badge" style="background:${_fstCatColor(a.category)}22;color:${_fstCatColor(a.category)};min-width:50px;text-align:center;">${a.category}</span>
                            <span style="flex:1;font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${_escHtml(a.action)}</span>
                            <div style="width:60px;"><div class="fst-bar"><div class="fst-bar-fill" style="width:${(a.count/maxAction)*100}%;background:${_fstCatColor(a.category)};"></div></div></div>
                            <span style="font-size:11px;color:var(--text-tertiary);font-weight:700;min-width:30px;text-align:right;">${a.count}</span>
                        </div>
                    `).join('')}
                </div>
            </div>

            <!-- Top pages -->
            <div class="fst-section">
                <div class="fst-section-title">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#6366F1" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    Топ сторінок
                </div>
                <div style="display:flex;flex-direction:column;gap:8px;">
                    ${(stats.topPages || []).map(p => `
                        <div style="display:flex;align-items:center;gap:8px;">
                            <span style="flex:1;font-size:12px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#6366F1;">${_escHtml(p.path)}</span>
                            <div style="width:60px;"><div class="fst-bar"><div class="fst-bar-fill" style="width:${(p.hits/maxPage)*100}%;background:#6366F1;"></div></div></div>
                            <span style="font-size:11px;color:var(--text-tertiary);font-weight:700;min-width:30px;text-align:right;">${p.hits}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>

        <div class="fst-two-col">
            <!-- Active users -->
            <div class="fst-section">
                <div class="fst-section-title">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#EC4899" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
                    Найактивніші юзери
                </div>
                <table class="fst-table">
                    <thead><tr><th>Юзер</th><th style="text-align:right;">Дій</th></tr></thead>
                    <tbody>
                        ${(stats.activeUsers || []).map(u => `
                            <tr>
                                <td>
                                    <div style="font-weight:600;font-size:13px;">${_escHtml(u.full_name || 'Unknown')}</div>
                                    <div style="font-size:11px;color:var(--text-tertiary);">${_escHtml(u.email || '')}</div>
                                </td>
                                <td style="text-align:right;font-weight:700;color:#EC4899;">${u.actions}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>

            <!-- Categories + IPs -->
            <div class="fst-section">
                <div class="fst-section-title">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#06B6D4" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>
                    Категорії та IP
                </div>
                <div style="margin-bottom:14px;">
                    ${(stats.categories || []).map(c => `
                        <div style="display:flex;align-items:center;gap:8px;padding:4px 0;">
                            <span style="width:8px;height:8px;border-radius:50%;background:${_fstCatColor(c.category)};flex-shrink:0;"></span>
                            <span style="flex:1;font-size:12px;font-weight:600;">${_escHtml(c.category)}</span>
                            <span style="font-size:11px;color:var(--text-tertiary);font-weight:700;">${c.count}</span>
                        </div>
                    `).join('')}
                </div>
                <div style="font-size:12px;font-weight:700;color:var(--text-secondary);margin-bottom:8px;">Топ IP</div>
                ${(stats.topIps || []).slice(0, 5).map(ip => `
                    <div style="display:flex;align-items:center;gap:8px;padding:3px 0;font-size:12px;">
                        <code style="flex:1;color:var(--text-secondary);font-weight:600;">${_escHtml(ip.ip_address)}</code>
                        <span style="color:var(--text-tertiary);font-weight:700;">${ip.hits}</span>
                    </div>
                `).join('')}
            </div>
        </div>

        <!-- Activity log -->
        <div class="fst-section">
            <div class="fst-section-title">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--text-secondary)" stroke-width="2"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>
                Журнал активності
            </div>
            <div class="fst-filters">
                <select class="fst-filter" id="fstCatFilter" style="min-width:110px;">
                    <option value="">Всі категорії</option>
                    <option value="auth">Auth</option>
                    <option value="navigation">Навігація</option>
                    <option value="client">Клієнт</option>
                    <option value="admin">Адмін</option>
                    <option value="bots">Боти</option>
                    <option value="orders">Ордери</option>
                    <option value="portfolio">Портфоліо</option>
                    <option value="profile">Профіль</option>
                    <option value="market">Маркет</option>
                    <option value="api">API</option>
                </select>
                <input type="text" class="fst-filter" id="fstSearch" placeholder="Пошук..." style="min-width:150px;">
                <input type="text" class="fst-filter" id="fstIpFilter" placeholder="IP..." style="max-width:130px;">
                <input type="date" class="fst-filter" id="fstDateFrom" style="max-width:140px;">
                <input type="date" class="fst-filter" id="fstDateTo" style="max-width:140px;">
                <button class="fst-page-btn" id="fstApplyFilter" style="background:var(--accent-primary);color:white;border-color:var(--accent-primary);">Фільтр</button>
            </div>
            <div id="fstLogList" class="fst-scroll-log">
                ${_renderActivityRows(logs.activities)}
            </div>
            <div id="fstPagination">
                ${_renderFstPagination(logs.page, logs.pages, logs.total)}
            </div>
        </div>

        <!-- Cleanup -->
        <div style="display:flex;justify-content:flex-end;gap:8px;padding:8px 0;">
            <button class="fst-page-btn" id="fstCleanup30" style="color:#EF4444;">Очистити старіше 30 днів</button>
            <button class="fst-page-btn" id="fstCleanup7" style="color:#EF4444;">Очистити старіше 7 днів</button>
        </div>
    `;

    _wireFstEvents();
}

function _renderActivityRows(activities) {
    if (!activities || activities.length === 0) {
        return '<div style="text-align:center;padding:20px;color:var(--text-tertiary);font-size:13px;">Немає записів</div>';
    }
    return activities.map(a => {
        const catColor = _fstCatColor(a.category);
        const statusColor = !a.status_code ? 'var(--text-tertiary)' : a.status_code < 300 ? '#10B981' : a.status_code < 400 ? '#F59E0B' : '#EF4444';
        return `
        <div class="fst-log-row">
            <span class="fst-log-time">${_fstFormatDate(a.created_at)}</span>
            <span class="fst-log-action">
                <span class="fst-badge" style="background:${catColor}22;color:${catColor};">${a.category || '?'}</span>
                <span class="fst-log-action-text">${_escHtml(a.action)}</span>
                ${a.full_name ? `<span class="fst-log-user">· ${_escHtml(a.full_name)}</span>` : ''}
            </span>
            <span class="fst-log-path" title="${_escHtml(a.path || '')}">${_escHtml(a.path || '—')}</span>
            <span class="fst-log-ip">${_escHtml(a.ip_address || '—')}</span>
            <span class="fst-log-status">
                ${a.status_code ? `<span style="font-weight:700;color:${statusColor};">${a.status_code}</span>` : ''}
                ${a.duration_ms != null ? `<span style="font-size:10px;color:${a.duration_ms > 1000 ? '#EF4444' : 'var(--text-tertiary)'};">${a.duration_ms}ms</span>` : ''}
            </span>
        </div>`;
    }).join('');
}

function _renderFstPagination(currentPage, totalPages, total) {
    if (totalPages <= 1) return `<div style="text-align:center;font-size:12px;color:var(--text-tertiary);margin-top:8px;">${total} записів</div>`;
    let html = '<div class="fst-pagination">';
    html += `<span style="font-size:12px;color:var(--text-tertiary);margin-right:8px;">${total.toLocaleString()} записів</span>`;

    if (currentPage > 1) html += `<button class="fst-page-btn" data-page="${currentPage - 1}">&laquo;</button>`;

    const start = Math.max(1, currentPage - 2);
    const end = Math.min(totalPages, currentPage + 2);
    for (let i = start; i <= end; i++) {
        html += `<button class="fst-page-btn${i === currentPage ? ' active' : ''}" data-page="${i}">${i}</button>`;
    }

    if (currentPage < totalPages) html += `<button class="fst-page-btn" data-page="${currentPage + 1}">&raquo;</button>`;
    html += '</div>';
    return html;
}

async function _loadFstLogs(page) {
    _fstPage = page || 1;
    const params = new URLSearchParams({ page: _fstPage, limit: 50 });
    if (_fstFilters.category) params.set('category', _fstFilters.category);
    if (_fstFilters.search) params.set('search', _fstFilters.search);
    if (_fstFilters.ip) params.set('ip', _fstFilters.ip);
    if (_fstFilters.dateFrom) params.set('dateFrom', _fstFilters.dateFrom);
    if (_fstFilters.dateTo) params.set('dateTo', _fstFilters.dateTo);

    try {
        const res = await fetch('/api/admin/activity?' + params.toString());
        const data = await res.json();
        document.getElementById('fstLogList').innerHTML = _renderActivityRows(data.activities);
        document.getElementById('fstPagination').innerHTML = _renderFstPagination(data.page, data.pages, data.total);
        _wireFstPagination();
    } catch (err) {
        showNotification('Помилка завантаження логів', 'error');
    }
}

function _wireFstPagination() {
    document.querySelectorAll('#fstPagination .fst-page-btn[data-page]').forEach(btn => {
        btn.addEventListener('click', () => _loadFstLogs(parseInt(btn.dataset.page)));
    });
}

function _wireFstEvents() {
    // Filter
    document.getElementById('fstApplyFilter')?.addEventListener('click', () => {
        _fstFilters = {
            category: document.getElementById('fstCatFilter').value,
            search: document.getElementById('fstSearch').value.trim(),
            ip: document.getElementById('fstIpFilter').value.trim(),
            dateFrom: document.getElementById('fstDateFrom').value,
            dateTo: document.getElementById('fstDateTo').value
        };
        _loadFstLogs(1);
    });

    // Enter key on search
    ['fstSearch', 'fstIpFilter'].forEach(id => {
        document.getElementById(id)?.addEventListener('keydown', e => {
            if (e.key === 'Enter') document.getElementById('fstApplyFilter')?.click();
        });
    });

    // Pagination
    _wireFstPagination();

    // Cleanup buttons
    document.getElementById('fstCleanup30')?.addEventListener('click', async () => {
        if (!confirm('Видалити записи старіше 30 днів?')) return;
        await fetch('/api/admin/activity/cleanup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ days: 30 }) });
        showNotification('Логи очищено', 'success');
        loadFullStats();
    });
    document.getElementById('fstCleanup7')?.addEventListener('click', async () => {
        if (!confirm('Видалити записи старіше 7 днів?')) return;
        await fetch('/api/admin/activity/cleanup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ days: 7 }) });
        showNotification('Логи очищено', 'success');
        loadFullStats();
    });
}

function _escHtml(str) {
    const d = document.createElement('div');
    d.textContent = str || '';
    return d.innerHTML;
}

function _b64urlToBuffer(b64url) {
    const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
    const bin = atob(b64 + pad);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr.buffer;
}

function _bufferToB64url(buffer) {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

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

// ==================== ANALYTICS ====================

let userRegistrationsChartInstance = null;
let userActivityChartInstance = null;
let botFunnelChartInstance = null;
let subscriptionFunnelChartInstance = null;
let tradingVolumeChartInstance = null;

async function loadAnalytics() {
    try {
        // Get date range from inputs
        const dateFrom = document.getElementById('analyticsDateFrom').value;
        const dateTo = document.getElementById('analyticsDateTo').value;

        // Calculate days or use date range
        let queryParams = 'days=30';
        if (dateFrom && dateTo) {
            queryParams = `from=${dateFrom}&to=${dateTo}`;
        } else if (dateFrom) {
            queryParams = `from=${dateFrom}`;
        } else if (dateTo) {
            queryParams = `to=${dateTo}`;
        }

        const response = await fetch(`/api/admin/analytics/users?${queryParams}`);
        if (!response.ok) throw new Error('Failed to fetch analytics');

        const data = await response.json();

        // Store data for export
        analyticsData = { users: data };

        document.getElementById('analyticsNewUsers7d').textContent = data.summary.newUsers;
        document.getElementById('analyticsActiveUsers7d').textContent = data.summary.dau;

        renderUserRegistrationsChart(data.registrationTrends);
        renderUserActivityChart(data.summary);

        const botFunnelResponse = await fetch('/api/admin/analytics/bots/funnel');
        if (botFunnelResponse.ok) {
            const botFunnelData = await botFunnelResponse.json();
            document.getElementById('analyticsBotActivity7d').textContent = botFunnelData.summary.liveActiveBots;
            renderBotFunnelChart(botFunnelData);
            analyticsData.bots = botFunnelData;
        }

        const subscriptionFunnelResponse = await fetch('/api/admin/analytics/subscriptions/funnel');
        if (subscriptionFunnelResponse.ok) {
            const subscriptionFunnelData = await subscriptionFunnelResponse.json();
            renderSubscriptionFunnelChart(subscriptionFunnelData);
            analyticsData.subscriptions = subscriptionFunnelData;
        }

        const volumeResponse = await fetch(`/api/admin/analytics/trading/volume?${queryParams}`);
        if (volumeResponse.ok) {
            const volumeData = await volumeResponse.json();
            document.getElementById('analyticsVolume7d').textContent = formatCurrency(volumeData.summary.totalVolume);
            renderTradingVolumeChart(volumeData.volumeTrends);
            analyticsData.volume = volumeData;
        }

        const retentionResponse = await fetch('/api/admin/analytics/retention?weeks=8');
        if (retentionResponse.ok) {
            const retentionData = await retentionResponse.json();
            renderRetentionCohortTable(retentionData);
            analyticsData.retention = retentionData;
        }

        const healthResponse = await fetch('/api/admin/analytics/system/health');
        if (healthResponse.ok) {
            const healthData = await healthResponse.json();
            renderSystemHealth(healthData);
            analyticsData.health = healthData;
        }

    } catch (error) {
        console.error('Load analytics error:', error);
    }
}

function exportAnalyticsCSV() {
    if (!analyticsData) {
        alert('Немає даних для експорту. Будь ласка, завантажте аналітику спочатку.');
        return;
    }

    const dateFrom = document.getElementById('analyticsDateFrom').value || 'all';
    const dateTo = document.getElementById('analyticsDateTo').value || 'today';

    // Create CSV content
    let csv = 'Yamato Analytics Export\n';
    csv += `Період: ${dateFrom} - ${dateTo}\n`;
    csv += `Експортовано: ${new Date().toLocaleString('uk-UA')}\n\n`;

    // User Analytics
    if (analyticsData.users) {
        csv += 'АНАЛІТИКА КОРИСТУВАЧІВ\n';
        csv += 'Показник,Значення\n';
        csv += `Нові користувачі,${analyticsData.users.summary.newUsers}\n`;
        csv += `Активні користувачі (DAU),${analyticsData.users.summary.dau}\n`;
        csv += `Активні користувачі (WAU),${analyticsData.users.summary.wau}\n`;
        csv += `Активні користувачі (MAU),${analyticsData.users.summary.mau}\n\n`;

        if (analyticsData.users.registrationTrends && analyticsData.users.registrationTrends.length > 0) {
            csv += 'Реєстрації користувачів по днях\n';
            csv += 'Дата,Кількість\n';
            analyticsData.users.registrationTrends.forEach(trend => {
                csv += `${trend.date},${trend.count}\n`;
            });
            csv += '\n';
        }
    }

    // Bot Analytics
    if (analyticsData.bots) {
        csv += 'АНАЛІТИКА БОТІВ\n';
        csv += 'Показник,Значення\n';
        if (analyticsData.bots.summary) {
            csv += `Всього ботів,${analyticsData.bots.summary.totalBots || 0}\n`;
            csv += `Демо ботів,${analyticsData.bots.summary.demoBots || 0}\n`;
            csv += `Реальних ботів,${analyticsData.bots.summary.liveBots || 0}\n`;
            csv += `Активних реальних ботів,${analyticsData.bots.summary.liveActiveBots || 0}\n`;
        }
        csv += '\n';
    }

    // Subscription Analytics
    if (analyticsData.subscriptions) {
        csv += 'АНАЛІТИКА ПІДПИСОК\n';
        csv += 'Показник,Значення\n';
        if (analyticsData.subscriptions.summary) {
            csv += `Безкоштовні користувачі,${analyticsData.subscriptions.summary.freeUsers || 0}\n`;
            csv += `Starter підписок,${analyticsData.subscriptions.summary.starterUsers || 0}\n`;
            csv += `Pro підписок,${analyticsData.subscriptions.summary.proUsers || 0}\n`;
            csv += `Premium підписок,${analyticsData.subscriptions.summary.premiumUsers || 0}\n`;
        }
        csv += '\n';
    }

    // Volume Analytics
    if (analyticsData.volume) {
        csv += 'ОБСЯГ ТРАНЗАКЦІЙ\n';
        csv += 'Показник,Значення\n';
        if (analyticsData.volume.summary) {
            csv += `Загальний обсяг,${analyticsData.volume.summary.totalVolume || 0}\n`;
            csv += `Кількість транзакцій,${analyticsData.volume.summary.totalTransactions || 0}\n`;
        }

        if (analyticsData.volume.volumeTrends && analyticsData.volume.volumeTrends.length > 0) {
            csv += '\nОбсяг транзакцій по днях\n';
            csv += 'Дата,Обсяг,Кількість\n';
            analyticsData.volume.volumeTrends.forEach(trend => {
                csv += `${trend.date},${trend.volume},${trend.count}\n`;
            });
        }
        csv += '\n';
    }

    // System Health
    if (analyticsData.health) {
        csv += 'СТАН СИСТЕМИ\n';
        csv += 'Показник,Значення\n';
        csv += `Час роботи,${analyticsData.health.uptime || 'N/A'}\n`;
        csv += `Статус,${analyticsData.health.status || 'N/A'}\n`;
        csv += `Активні боти,${analyticsData.health.activeBots || 0}\n`;
        csv += `Демо боти,${analyticsData.health.demoBots || 0}\n`;
        csv += `Реальні боти,${analyticsData.health.liveBots || 0}\n`;
        csv += '\n';
    }

    // Download CSV
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);

    link.setAttribute('href', url);
    link.setAttribute('download', `yamato-analytics-${dateFrom}-${dateTo}.csv`);
    link.style.visibility = 'hidden';

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function renderUserRegistrationsChart(trends) {
    const canvas = document.getElementById('userRegistrationsChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');

    if (userRegistrationsChartInstance) {
        userRegistrationsChartInstance.destroy();
    }

    const labels = trends.map(t => {
        const date = new Date(t.date);
        return date.toLocaleDateString('uk-UA', { month: 'short', day: 'numeric' });
    });
    const counts = trends.map(t => t.count);

    userRegistrationsChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Реєстрації',
                data: counts,
                borderColor: 'rgb(16, 185, 129)',
                backgroundColor: 'rgba(16, 185, 129, 0.1)',
                borderWidth: 2,
                fill: true,
                tension: 0.4,
                pointRadius: 3,
                pointHoverRadius: 5,
                pointBackgroundColor: 'rgb(16, 185, 129)',
                pointBorderColor: '#fff',
                pointBorderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    backgroundColor: 'rgba(17, 17, 17, 0.95)',
                    titleColor: '#fff',
                    bodyColor: '#fff',
                    borderColor: 'rgba(255, 255, 255, 0.1)',
                    borderWidth: 1,
                    padding: 12,
                    displayColors: false,
                    callbacks: {
                        label: function(context) {
                            return 'Користувачів: ' + context.parsed.y;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        color: '#A1A1A1',
                        stepSize: 1
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.05)',
                        drawBorder: false
                    }
                },
                x: {
                    ticks: {
                        color: '#A1A1A1',
                        maxRotation: 45,
                        minRotation: 45
                    },
                    grid: {
                        display: false
                    }
                }
            }
        }
    });
}

function renderUserActivityChart(summary) {
    const canvas = document.getElementById('userActivityChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');

    if (userActivityChartInstance) {
        userActivityChartInstance.destroy();
    }

    userActivityChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: ['DAU', 'WAU', 'MAU'],
            datasets: [{
                label: 'Активні користувачі',
                data: [summary.dau, summary.wau, summary.mau],
                backgroundColor: [
                    'rgba(16, 185, 129, 0.8)',
                    'rgba(140, 168, 255, 0.8)',
                    'rgba(245, 158, 11, 0.8)'
                ],
                borderColor: [
                    'rgb(16, 185, 129)',
                    'rgb(140, 168, 255)',
                    'rgb(245, 158, 11)'
                ],
                borderWidth: 2,
                borderRadius: 8
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    backgroundColor: 'rgba(17, 17, 17, 0.95)',
                    titleColor: '#fff',
                    bodyColor: '#fff',
                    borderColor: 'rgba(255, 255, 255, 0.1)',
                    borderWidth: 1,
                    padding: 12,
                    displayColors: false,
                    callbacks: {
                        label: function(context) {
                            return 'Користувачів: ' + context.parsed.y;
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: {
                        color: '#A1A1A1',
                        stepSize: 1
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.05)',
                        drawBorder: false
                    }
                },
                x: {
                    ticks: {
                        color: '#A1A1A1'
                    },
                    grid: {
                        display: false
                    }
                }
            }
        }
    });
}

function renderBotFunnelChart(funnelData) {
    const canvas = document.getElementById('botActivityChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');

    if (botFunnelChartInstance) {
        botFunnelChartInstance.destroy();
    }

    const labels = funnelData.stages.map(s => s.name);
    const counts = funnelData.stages.map(s => s.count);
    const percentages = funnelData.stages.map(s => s.percentage);

    botFunnelChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Користувачів',
                data: counts,
                backgroundColor: [
                    'rgba(16, 185, 129, 0.8)',
                    'rgba(140, 168, 255, 0.8)',
                    'rgba(245, 158, 11, 0.8)',
                    'rgba(239, 68, 68, 0.8)'
                ],
                borderColor: [
                    'rgb(16, 185, 129)',
                    'rgb(140, 168, 255)',
                    'rgb(245, 158, 11)',
                    'rgb(239, 68, 68)'
                ],
                borderWidth: 2,
                borderRadius: 8
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    backgroundColor: 'rgba(17, 17, 17, 0.95)',
                    titleColor: '#fff',
                    bodyColor: '#fff',
                    borderColor: 'rgba(255, 255, 255, 0.1)',
                    borderWidth: 1,
                    padding: 12,
                    displayColors: false,
                    callbacks: {
                        label: function(context) {
                            const index = context.dataIndex;
                            const count = counts[index];
                            const percentage = percentages[index];
                            return [
                                'Користувачів: ' + count,
                                'Конверсія: ' + percentage + '%'
                            ];
                        }
                    }
                }
            },
            scales: {
                x: {
                    beginAtZero: true,
                    ticks: {
                        color: '#A1A1A1',
                        stepSize: 1
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.05)',
                        drawBorder: false
                    }
                },
                y: {
                    ticks: {
                        color: '#A1A1A1'
                    },
                    grid: {
                        display: false
                    }
                }
            }
        }
    });
}

function renderSubscriptionFunnelChart(funnelData) {
    const canvas = document.getElementById('subscriptionFunnelChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');

    if (subscriptionFunnelChartInstance) {
        subscriptionFunnelChartInstance.destroy();
    }

    const labels = funnelData.stages.map(s => s.name);
    const counts = funnelData.stages.map(s => s.count);
    const percentages = funnelData.stages.map(s => s.percentage);

    subscriptionFunnelChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Користувачів',
                data: counts,
                backgroundColor: [
                    'rgba(161, 161, 161, 0.8)',
                    'rgba(140, 168, 255, 0.8)',
                    'rgba(16, 185, 129, 0.8)',
                    'rgba(245, 158, 11, 0.8)'
                ],
                borderColor: [
                    'rgb(161, 161, 161)',
                    'rgb(140, 168, 255)',
                    'rgb(16, 185, 129)',
                    'rgb(245, 158, 11)'
                ],
                borderWidth: 2,
                borderRadius: 8
            }]
        },
        options: {
            indexAxis: 'y',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: false
                },
                tooltip: {
                    backgroundColor: 'rgba(17, 17, 17, 0.95)',
                    titleColor: '#fff',
                    bodyColor: '#fff',
                    borderColor: 'rgba(255, 255, 255, 0.1)',
                    borderWidth: 1,
                    padding: 12,
                    displayColors: false,
                    callbacks: {
                        label: function(context) {
                            const index = context.dataIndex;
                            const count = counts[index];
                            const percentage = percentages[index];
                            return [
                                'Користувачів: ' + count,
                                'Конверсія: ' + percentage + '%'
                            ];
                        }
                    }
                }
            },
            scales: {
                x: {
                    beginAtZero: true,
                    ticks: {
                        color: '#A1A1A1',
                        stepSize: 1
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.05)',
                        drawBorder: false
                    }
                },
                y: {
                    ticks: {
                        color: '#A1A1A1'
                    },
                    grid: {
                        display: false
                    }
                }
            }
        }
    });
}

function renderTradingVolumeChart(trends) {
    const canvas = document.getElementById('transactionVolumeChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');

    if (tradingVolumeChartInstance) {
        tradingVolumeChartInstance.destroy();
    }

    const labels = trends.map(t => {
        const date = new Date(t.date);
        return date.toLocaleDateString('uk-UA', { month: 'short', day: 'numeric' });
    });
    const demoVolumes = trends.map(t => t.demoVolume);
    const liveVolumes = trends.map(t => t.liveVolume);

    tradingVolumeChartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Демо',
                    data: demoVolumes,
                    borderColor: 'rgba(140, 168, 255, 0.8)',
                    backgroundColor: 'rgba(140, 168, 255, 0.2)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 3,
                    pointHoverRadius: 5,
                    pointBackgroundColor: 'rgb(140, 168, 255)',
                    pointBorderColor: '#fff',
                    pointBorderWidth: 2
                },
                {
                    label: 'Лайв',
                    data: liveVolumes,
                    borderColor: 'rgb(16, 185, 129)',
                    backgroundColor: 'rgba(16, 185, 129, 0.2)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4,
                    pointRadius: 3,
                    pointHoverRadius: 5,
                    pointBackgroundColor: 'rgb(16, 185, 129)',
                    pointBorderColor: '#fff',
                    pointBorderWidth: 2
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        color: '#A1A1A1',
                        usePointStyle: true,
                        padding: 15
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(17, 17, 17, 0.95)',
                    titleColor: '#fff',
                    bodyColor: '#fff',
                    borderColor: 'rgba(255, 255, 255, 0.1)',
                    borderWidth: 1,
                    padding: 12,
                    displayColors: true,
                    callbacks: {
                        label: function(context) {
                            return context.dataset.label + ': $' + context.parsed.y.toFixed(2);
                        }
                    }
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    stacked: true,
                    ticks: {
                        color: '#A1A1A1',
                        callback: function(value) {
                            return '$' + value.toLocaleString();
                        }
                    },
                    grid: {
                        color: 'rgba(255, 255, 255, 0.05)',
                        drawBorder: false
                    }
                },
                x: {
                    ticks: {
                        color: '#A1A1A1',
                        maxRotation: 45,
                        minRotation: 45
                    },
                    grid: {
                        display: false
                    }
                }
            }
        }
    });
}

function renderRetentionCohortTable(data) {
    const container = document.getElementById('retentionCohortTable');
    if (!container) return;

    const cohorts = data.cohorts || [];
    if (cohorts.length === 0) {
        container.innerHTML = '<div style="text-align: center; padding: 20px; color: #A1A1A1;">Недостатньо даних для відображення когорт</div>';
        return;
    }

    // Helper function to get color based on retention rate
    function getRetentionColor(rate) {
        if (rate >= 40) {
            // Good retention - green
            return `rgba(16, 185, 129, ${0.2 + (rate / 100) * 0.6})`;
        } else if (rate >= 20) {
            // Moderate retention - orange
            return `rgba(245, 158, 11, ${0.2 + (rate / 100) * 0.6})`;
        } else if (rate > 0) {
            // Poor retention - red
            return `rgba(239, 68, 68, ${0.2 + (rate / 100) * 0.6})`;
        } else {
            // No retention
            return 'transparent';
        }
    }

    // Get max weeks to display (up to 8)
    const maxWeeks = Math.min(8, data.weeksAnalyzed || 8);

    // Build table HTML
    let tableHTML = `
        <table style="width: 100%; border-collapse: collapse; font-size: 12px; color: var(--text-primary);">
            <thead>
                <tr style="border-bottom: 1px solid rgba(255, 255, 255, 0.1);">
                    <th style="padding: 12px 8px; text-align: left; color: var(--text-secondary); font-weight: 500;">Когорта</th>
                    <th style="padding: 12px 8px; text-align: center; color: var(--text-secondary); font-weight: 500;">Розмір</th>
                    <th style="padding: 12px 8px; text-align: center; color: var(--text-secondary); font-weight: 500;">Тиждень 0</th>
    `;

    for (let i = 1; i <= maxWeeks; i++) {
        tableHTML += `<th style="padding: 12px 8px; text-align: center; color: var(--text-secondary); font-weight: 500;">Тиждень ${i}</th>`;
    }

    tableHTML += `
                </tr>
            </thead>
            <tbody>
    `;

    // Add rows for each cohort
    cohorts.forEach((cohort, index) => {
        const cohortDate = new Date(cohort.retention[0]?.week === 0 ? cohort.cohortWeek : cohort.cohortWeek);
        const cohortLabel = cohortDate instanceof Date && !isNaN(cohortDate)
            ? `Тиждень ${cohort.cohortWeek}`
            : cohort.cohortWeek;

        tableHTML += `
            <tr style="border-bottom: 1px solid rgba(255, 255, 255, 0.05);">
                <td style="padding: 12px 8px; color: var(--text-primary); font-weight: 500;">${cohortLabel}</td>
                <td style="padding: 12px 8px; text-align: center; color: var(--text-secondary);">${cohort.cohortSize}</td>
        `;

        // Week 0 (always 100%)
        tableHTML += `
            <td style="padding: 12px 8px; text-align: center; background: ${getRetentionColor(100)};">
                <span style="color: var(--text-primary); font-weight: 500;">100%</span>
            </td>
        `;

        // Retention for weeks 1-8
        for (let week = 1; week <= maxWeeks; week++) {
            const retentionWeek = cohort.retention.find(r => r.week === week);
            if (retentionWeek) {
                const rate = retentionWeek.retentionRate;
                const activeUsers = retentionWeek.activeUsers;
                tableHTML += `
                    <td style="padding: 12px 8px; text-align: center; background: ${getRetentionColor(rate)};" title="${activeUsers} активних користувачів">
                        <span style="color: var(--text-primary); font-weight: ${rate >= 40 ? '600' : '400'};">${rate}%</span>
                    </td>
                `;
            } else {
                tableHTML += `
                    <td style="padding: 12px 8px; text-align: center; background: transparent;">
                        <span style="color: var(--text-tertiary);">—</span>
                    </td>
                `;
            }
        }

        tableHTML += '</tr>';
    });

    tableHTML += `
            </tbody>
        </table>
    `;

    // Add legend
    tableHTML += `
        <div style="display: flex; gap: 16px; margin-top: 16px; padding: 12px; background: rgba(255, 255, 255, 0.02); border-radius: 8px; font-size: 11px;">
            <div style="display: flex; align-items: center; gap: 6px;">
                <div style="width: 16px; height: 16px; background: rgba(16, 185, 129, 0.6); border-radius: 3px;"></div>
                <span style="color: var(--text-secondary);">Добре (≥40%)</span>
            </div>
            <div style="display: flex; align-items: center; gap: 6px;">
                <div style="width: 16px; height: 16px; background: rgba(245, 158, 11, 0.6); border-radius: 3px;"></div>
                <span style="color: var(--text-secondary);">Середнє (20-39%)</span>
            </div>
            <div style="display: flex; align-items: center; gap: 6px;">
                <div style="width: 16px; height: 16px; background: rgba(239, 68, 68, 0.6); border-radius: 3px;"></div>
                <span style="color: var(--text-secondary);">Низьке (<20%)</span>
            </div>
        </div>
    `;

    // Add summary stats for 7-day and 30-day retention
    if (cohorts.length > 0) {
        // Calculate average 7-day retention (week 1)
        const week1Retentions = cohorts
            .map(c => c.retention.find(r => r.week === 1))
            .filter(r => r !== undefined)
            .map(r => r.retentionRate);
        const avg7day = week1Retentions.length > 0
            ? Math.round(week1Retentions.reduce((a, b) => a + b, 0) / week1Retentions.length)
            : 0;

        // Calculate average 30-day retention (week 4)
        const week4Retentions = cohorts
            .map(c => c.retention.find(r => r.week === 4))
            .filter(r => r !== undefined)
            .map(r => r.retentionRate);
        const avg30day = week4Retentions.length > 0
            ? Math.round(week4Retentions.reduce((a, b) => a + b, 0) / week4Retentions.length)
            : 0;

        tableHTML += `
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-top: 16px;">
                <div style="padding: 12px; background: rgba(255, 255, 255, 0.02); border-radius: 8px;">
                    <div style="color: var(--text-secondary); font-size: 11px; margin-bottom: 4px;">Середнє утримання (7 днів)</div>
                    <div style="color: ${avg7day >= 40 ? 'rgb(16, 185, 129)' : avg7day >= 20 ? 'rgb(245, 158, 11)' : 'rgb(239, 68, 68)'}; font-size: 20px; font-weight: 600;">${avg7day}%</div>
                </div>
                <div style="padding: 12px; background: rgba(255, 255, 255, 0.02); border-radius: 8px;">
                    <div style="color: var(--text-secondary); font-size: 11px; margin-bottom: 4px;">Середнє утримання (30 днів)</div>
                    <div style="color: ${avg30day >= 40 ? 'rgb(16, 185, 129)' : avg30day >= 20 ? 'rgb(245, 158, 11)' : 'rgb(239, 68, 68)'}; font-size: 20px; font-weight: 600;">${avg30day}%</div>
                </div>
            </div>
        `;
    }

    container.innerHTML = tableHTML;
}

function renderSystemHealth(data) {
    // System uptime and status
    const uptimeEl = document.getElementById('healthSystemUptime');
    const statusEl = document.getElementById('healthSystemStatus');
    if (uptimeEl && data.system) {
        uptimeEl.textContent = `${data.system.uptime}h`;

        // Update status with color coding
        if (statusEl) {
            const status = data.system.status;
            let statusText = '';
            let statusColor = '';

            if (status === 'healthy') {
                statusText = 'Система працює нормально';
                statusColor = 'var(--accent-primary)';
            } else if (status === 'degraded') {
                statusText = 'Система працює з помилками';
                statusColor = 'var(--color-warning)';
            } else {
                statusText = 'Система має критичні помилки';
                statusColor = 'var(--color-down)';
            }

            statusEl.textContent = statusText;
            statusEl.style.color = statusColor;
        }
    }

    // Bot health metrics
    const activeBotsEl = document.getElementById('healthActiveBots');
    const demoBotsEl = document.getElementById('healthDemoBots');
    const liveBotsEl = document.getElementById('healthLiveBots');
    if (activeBotsEl && data.bots) {
        activeBotsEl.textContent = data.bots.total || 0;

        // Color code based on bot health status
        if (data.bots.healthStatus === 'active') {
            activeBotsEl.style.color = 'var(--accent-primary)';
        } else {
            activeBotsEl.style.color = 'var(--text-tertiary)';
        }

        if (demoBotsEl) demoBotsEl.textContent = data.bots.demo || 0;
        if (liveBotsEl) liveBotsEl.textContent = data.bots.live || 0;
    }

    // Error rate metrics
    const errorRateEl = document.getElementById('healthErrorRate');
    const errorCountEl = document.getElementById('healthErrorCount');
    if (errorRateEl && data.activity) {
        const errorRate = data.activity.errorRate || 0;
        errorRateEl.textContent = `${errorRate}%`;

        // Color code based on error rate
        if (errorRate < 5) {
            errorRateEl.style.color = 'var(--accent-primary)';
        } else if (errorRate < 15) {
            errorRateEl.style.color = 'var(--color-warning)';
        } else {
            errorRateEl.style.color = 'var(--color-down)';
        }

        if (errorCountEl) {
            errorCountEl.textContent = data.activity.errorCount || 0;
        }
    }

    // Recent activity metrics
    const recentTradesEl = document.getElementById('healthRecentTrades');
    const recentLoginsEl = document.getElementById('healthRecentLogins');
    if (recentTradesEl && data.activity) {
        recentTradesEl.textContent = data.activity.recentTrades || 0;

        if (recentLoginsEl) {
            recentLoginsEl.textContent = data.activity.recentLogins || 0;
        }
    }
}

// ==================== BACKUP TAB ====================

async function loadBackupTab() {
    await Promise.all([loadGoogleSettings(), loadBackupSettings(), loadServerInfo()]);
    await loadBackupHistory();
}

async function loadGoogleSettings() {
    try {
        const res = await fetch('/api/admin/google-settings');
        const data = await res.json();
        document.getElementById('googleClientId').value = data.googleClientId || '';
        document.getElementById('googleClientSecret').value = data.googleClientSecret || '';
        document.getElementById('googleOAuthEnabled').checked = data.googleOAuthEnabled || false;

        // Update Drive status
        const dot = document.getElementById('driveStatusDot');
        const text = document.getElementById('driveStatusText');
        const connectBtn = document.getElementById('driveConnectBtn');
        const disconnectBtn = document.getElementById('driveDisconnectBtn');

        if (data.googleDriveConnected) {
            dot.style.background = '#10B981';
            text.textContent = 'Підключено';
            text.style.color = '#10B981';
            connectBtn.style.display = 'none';
            disconnectBtn.style.display = 'block';
        } else {
            dot.style.background = '#636363';
            text.textContent = 'Не підключено';
            text.style.color = '';
            connectBtn.style.display = 'block';
            disconnectBtn.style.display = 'none';
        }
    } catch (e) {
        console.error('Failed to load Google settings:', e);
    }
}

async function saveGoogleSettings() {
    try {
        const res = await fetch('/api/admin/google-settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                googleClientId: document.getElementById('googleClientId').value,
                googleClientSecret: document.getElementById('googleClientSecret').value,
                googleOAuthEnabled: document.getElementById('googleOAuthEnabled').checked
            })
        });
        const data = await res.json();
        if (data.success) {
            showToast('success', 'Збережено', 'Google налаштування збережено');
        } else {
            showToast('error', 'Помилка', 'Не вдалося зберегти налаштування');
        }
    } catch (e) {
        showToast('error', 'Помилка', 'Не вдалося зберегти налаштування');
    }
}

function connectGoogleDrive() {
    window.location.href = '/api/admin/backup/google/auth';
}

async function disconnectDrive() {
    if (!confirm('Відключити Google Drive? Автоматичні бекапи будуть зупинені.')) return;
    try {
        const res = await fetch('/api/admin/backup/disconnect', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            showToast('success', 'Відключено', 'Google Drive відключено');
            loadGoogleSettings();
        }
    } catch (e) {
        showToast('error', 'Помилка', 'Щось пішло не так');
    }
}

async function loadBackupSettings() {
    try {
        const res = await fetch('/api/admin/backup/settings');
        const data = await res.json();
        document.getElementById('backupEnabled').checked = data.enabled || false;
        document.getElementById('backupTime').value = data.time || '03:00';
        document.getElementById('backupFolderId').value = data.folderId || '';
    } catch (e) {
        console.error('Failed to load backup settings:', e);
    }
}

async function saveBackupSettings() {
    try {
        const res = await fetch('/api/admin/backup/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                enabled: document.getElementById('backupEnabled').checked,
                time: document.getElementById('backupTime').value,
                folderId: document.getElementById('backupFolderId').value
            })
        });
        const data = await res.json();
        if (data.success) {
            showToast('success', 'Збережено', 'Налаштування бекапів збережено');
        } else {
            showToast('error', 'Помилка', 'Не вдалося зберегти налаштування');
        }
    } catch (e) {
        showToast('error', 'Помилка', 'Не вдалося зберегти налаштування');
    }
}

async function triggerBackup() {
    const btn = document.getElementById('triggerBackupBtn');
    btn.disabled = true;
    btn.textContent = 'Створення бекапу...';
    try {
        const res = await fetch('/api/admin/backup/trigger', { method: 'POST' });
        const data = await res.json();
        if (data.success) {
            showToast('success', 'Бекап створено', data.filename);
            loadBackupHistory();
        } else {
            showToast('error', 'Помилка бекапу', data.error || 'Не вдалося створити бекап');
        }
    } catch (e) {
        showToast('error', 'Помилка', 'Не вдалося створити бекап');
    } finally {
        btn.disabled = false;
        btn.textContent = 'Зробити бекап зараз';
    }
}

let _backupCountdownInterval = null;

async function loadBackupHistory() {
    try {
        const res = await fetch('/api/admin/backup/history');
        const data = await res.json();
        // Support both old (array) and new ({ history, nextBackupAt }) formats
        const history = Array.isArray(data) ? data : (data.history || []);
        const container = document.getElementById('backupHistoryList');

        // Update countdown timer — fallback: calc from backup settings if API didn't return it
        let nextAt = data.nextBackupAt;
        let enabled = data.backupEnabled;
        if (nextAt === undefined) {
            // Fallback: read from backup settings inputs
            const chk = document.getElementById('backupEnabled');
            const timeInput = document.getElementById('backupTime');
            enabled = chk?.checked || false;
            if (enabled && timeInput?.value) {
                const [h, m] = timeInput.value.split(':').map(Number);
                const now = new Date();
                const next = new Date(now);
                next.setHours(h, m, 0, 0);
                if (next <= now) next.setDate(next.getDate() + 1);
                nextAt = next.toISOString();
            }
        }
        updateBackupCountdown(nextAt, enabled);

        // Update last backup status
        const lastInfo = document.getElementById('lastBackupInfo');
        if (lastInfo && history.length > 0) {
            const last = history[0];
            const statusIcon = last.status === 'success' ? '&#10003;' : last.status === 'failed' ? '&#10007;' : '&#8987;';
            const statusColor = last.status === 'success' ? '#10B981' : last.status === 'failed' ? '#EF4444' : '#F59E0B';
            const size = last.size_bytes ? Math.round(last.size_bytes / 1024 / 1024 * 10) / 10 + ' MB' : '—';
            const date = last.created_at ? new Date(last.created_at).toLocaleString('uk-UA', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—';
            const errMsg = last.status === 'failed' && last.error_message ? `<div style="color:#EF4444;font-size:11px;margin-top:4px;">${last.error_message}</div>` : '';
            lastInfo.innerHTML = `<span style="color:${statusColor};font-weight:700;">${statusIcon}</span> ${date} &middot; ${size} &middot; ${last.triggered_by || 'manual'}${errMsg}`;
        } else if (lastInfo) {
            lastInfo.textContent = 'Бекапів ще не було';
        }

        if (!Array.isArray(history) || !history.length) {
            container.innerHTML = '<div style="text-align: center; color: var(--text-tertiary); padding: 12px; font-size: 12px;">Немає бекапів</div>';
            return;
        }

        container.innerHTML = history.slice(0, 20).map(b => {
            const status = b.status === 'success'
                ? '<span style="color: #10B981; font-weight: 600;">&#10003;</span>'
                : b.status === 'failed'
                    ? '<span style="color: #EF4444; font-weight: 600;">&#10007;</span>'
                    : '<span style="color: #F59E0B; font-weight: 600;">&#8987;</span>';

            const size = b.size_bytes ? (b.size_bytes / 1024 / 1024).toFixed(1) + ' MB' : '—';
            const date = b.created_at ? new Date(b.created_at).toLocaleString('uk-UA', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '—';

            return `<div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 10px; border-bottom: 1px solid rgba(255,255,255,0.04); font-size: 12px;">
                <div style="display:flex;align-items:center;gap:8px;">
                    ${status}
                    <div>
                        <div style="font-weight: 600; color: var(--text-primary);">${date}</div>
                        <div style="color: var(--text-tertiary); font-size: 10px;">${b.triggered_by || 'manual'} &middot; ${size}</div>
                    </div>
                </div>
                ${b.status === 'failed' ? `<span style="color:#EF4444;font-size:10px;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${(b.error_message||'').replace(/"/g,'&quot;')}">${b.error_message || ''}</span>` : ''}
            </div>`;
        }).join('');
    } catch (e) {
        console.error('Failed to load backup history:', e);
    }
}

function updateBackupCountdown(nextBackupAt, enabled) {
    const el = document.getElementById('backupCountdownValue');
    const container = document.getElementById('backupCountdown');
    if (!el || !container) return;

    if (_backupCountdownInterval) clearInterval(_backupCountdownInterval);

    if (!enabled || !nextBackupAt) {
        el.textContent = 'Вимкнено';
        el.style.color = 'var(--text-tertiary)';
        container.style.borderColor = 'rgba(255,255,255,0.06)';
        container.style.background = 'var(--surface-secondary)';
        return;
    }

    const nextTime = new Date(nextBackupAt).getTime();

    function tick() {
        const diff = nextTime - Date.now();
        if (diff <= 0) {
            el.textContent = 'Зараз...';
            el.style.color = '#F59E0B';
            return;
        }
        const h = Math.floor(diff / 3600000);
        const m = Math.floor((diff % 3600000) / 60000);
        const s = Math.floor((diff % 60000) / 1000);
        el.textContent = `${h}год ${String(m).padStart(2,'0')}хв ${String(s).padStart(2,'0')}с`;
        el.style.color = '#10B981';
    }

    tick();
    _backupCountdownInterval = setInterval(tick, 1000);
}

// ==================== SERVER MANAGEMENT ====================

async function loadServerInfo() {
    try {
        const res = await fetch('/api/admin/server/info');
        const data = await res.json();
        const el = document.getElementById('serverInfo');
        if (el) {
            el.innerHTML = `
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                    <div><span style="color: var(--text-tertiary);">Uptime:</span> <strong>${data.uptime}</strong></div>
                    <div><span style="color: var(--text-tertiary);">PID:</span> <strong>${data.pid}</strong></div>
                    <div><span style="color: var(--text-tertiary);">RAM:</span> <strong>${data.memory.rss}</strong></div>
                    <div><span style="color: var(--text-tertiary);">Heap:</span> <strong>${data.memory.heapUsed} / ${data.memory.heapTotal}</strong></div>
                    <div><span style="color: var(--text-tertiary);">Node:</span> <strong>${data.nodeVersion}</strong></div>
                    <div><span style="color: var(--text-tertiary);">Platform:</span> <strong>${data.platform}</strong></div>
                </div>`;
        }
    } catch (e) {
        console.error('Failed to load server info:', e);
    }
}

async function restartServer() {
    if (!confirm('Перезавантажити сервер? Сайт буде недоступний кілька секунд.')) return;
    const btn = document.getElementById('restartServerBtn');
    btn.disabled = true;
    btn.textContent = 'Перезавантаження...';
    try {
        await fetch('/api/admin/server/restart', { method: 'POST' });
        showToast('success', 'Сервер', 'Перезавантаження ініційовано');
        setTimeout(() => { window.location.reload(); }, 5000);
    } catch (e) {
        showToast('error', 'Помилка', 'Не вдалося перезавантажити');
        btn.disabled = false;
        btn.textContent = 'Перезавантажити сервер';
    }
}

// ==================== LIVE LOGS ====================

let logsEventSource = null;

function toggleLogs() {
    const btn = document.getElementById('logsToggleBtn');
    if (logsEventSource) {
        logsEventSource.close();
        logsEventSource = null;
        btn.textContent = 'Підключити';
        btn.style.background = '';
        return;
    }

    const container = document.getElementById('logsContainer');
    container.innerHTML = '<div style="color: #10B981;">Підключення...</div>';

    logsEventSource = new EventSource('/api/admin/server/logs?lines=50');

    logsEventSource.onmessage = function(event) {
        const line = event.data;
        const div = document.createElement('div');
        div.style.borderBottom = '1px solid rgba(255,255,255,0.03)';
        div.style.padding = '2px 0';

        // Color code log lines
        if (line.includes('error') || line.includes('Error') || line.includes('ERR')) {
            div.style.color = '#EF4444';
        } else if (line.includes('warn') || line.includes('WARN')) {
            div.style.color = '#F59E0B';
        } else if (line.includes('[Connected')) {
            div.style.color = '#10B981';
        }

        div.textContent = line;
        container.appendChild(div);

        // Auto-scroll
        container.scrollTop = container.scrollHeight;

        // Limit lines in DOM
        while (container.children.length > 500) {
            container.removeChild(container.firstChild);
        }
    };

    logsEventSource.onerror = function() {
        const div = document.createElement('div');
        div.style.color = '#EF4444';
        div.textContent = '[Disconnected]';
        container.appendChild(div);
        logsEventSource.close();
        logsEventSource = null;
        btn.textContent = 'Підключити';
        btn.style.background = '';
    };

    btn.textContent = 'Відключити';
    btn.style.background = '#EF4444';
}

function clearLogsDisplay() {
    const container = document.getElementById('logsContainer');
    container.innerHTML = '<div style="color: var(--text-tertiary);">Очищено</div>';
}

// ==================== RESTORE FROM DRIVE ====================

async function loadDriveFiles() {
    const container = document.getElementById('driveFilesList');
    container.innerHTML = '<div style="text-align: center; color: var(--text-tertiary); padding: 16px; font-size: 13px;">Завантаження...</div>';
    try {
        const res = await fetch('/api/admin/backup/drive-files');
        if (!res.ok) {
            const err = await res.json();
            container.innerHTML = `<div style="text-align: center; color: #EF4444; padding: 16px; font-size: 13px;">${err.error || 'Помилка'}</div>`;
            return;
        }
        const files = await res.json();

        if (!files.length) {
            container.innerHTML = '<div style="text-align: center; color: var(--text-tertiary); padding: 16px; font-size: 13px;">Бекапів не знайдено</div>';
            return;
        }

        container.innerHTML = files.map(f => {
            const size = f.size ? (parseInt(f.size) / 1024).toFixed(1) + ' KB' : '—';
            const date = f.createdTime ? new Date(f.createdTime).toLocaleString('uk-UA') : '—';
            return `<div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 12px; border-bottom: 1px solid rgba(255,255,255,0.05); font-size: 13px;">
                <div>
                    <div style="font-weight: 600; margin-bottom: 2px;">${f.name}</div>
                    <div style="color: var(--text-tertiary); font-size: 11px;">${date} · ${size}</div>
                </div>
                <button onclick="restoreFromDrive('${f.id}', '${f.name}')" style="padding: 6px 14px; border-radius: 8px; border: 1px solid rgba(245,158,11,0.3); background: rgba(245,158,11,0.1); color: #F59E0B; font-size: 11px; font-weight: 600; cursor: pointer; white-space: nowrap;">Відновити</button>
            </div>`;
        }).join('');
    } catch (e) {
        container.innerHTML = '<div style="text-align: center; color: #EF4444; padding: 16px; font-size: 13px;">Помилка завантаження</div>';
    }
}

async function restoreFromDrive(fileId, fileName) {
    if (!confirm(`Відновити базу даних з бекапу "${fileName}"?\n\nПоточна база буде збережена як .pre-restore.\nПісля відновлення потрібен перезапуск сервера.`)) return;

    showToast('info', 'Відновлення', 'Завантаження бекапу з Google Drive...');

    try {
        const res = await fetch('/api/admin/backup/restore', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ fileId, fileName })
        });
        const data = await res.json();
        if (data.success) {
            showToast('success', 'Відновлено', data.message);
            if (confirm('Базу даних відновлено. Перезавантажити сервер зараз?')) {
                restartServer();
            }
        } else {
            showToast('error', 'Помилка', data.error || 'Не вдалося відновити');
        }
    } catch (e) {
        showToast('error', 'Помилка', 'Не вдалося відновити бекап');
    }
}

// Restore from Google Drive URL (public link)
async function restoreFromUrl() {
    const input = document.getElementById('restoreUrlInput');
    const btn = document.getElementById('restoreUrlBtn');
    const url = (input?.value || '').trim();
    if (!url) { showToast('error', 'Помилка', 'Вставте посилання на файл'); return; }
    if (!confirm('Відновити базу даних з цього посилання?\n\nПоточна база буде збережена як .pre-restore.\nПісля відновлення потрібен перезапуск сервера.')) return;

    btn.disabled = true;
    btn.textContent = 'Завантаження...';
    showToast('info', 'Відновлення', 'Завантаження файлу з Google Drive...');

    try {
        const res = await fetch('/api/admin/backup/restore-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url })
        });
        const data = await res.json();
        if (data.success) {
            const sizeKb = data.fileSize ? Math.round(data.fileSize / 1024) : '?';
            const filesInfo = data.restored ? data.restored.join(', ') : '';
            showToast('success', 'Відновлено', `${data.message} (${sizeKb} KB)`);
            input.value = '';
            if (confirm(`${data.message}\n\nФайли: ${filesInfo}\nРозмір: ${sizeKb} KB\n\nПерезавантажити сервер зараз?`)) {
                restartServer();
            }
        } else {
            showToast('error', 'Помилка', data.error || 'Не вдалося відновити');
        }
    } catch (e) {
        showToast('error', 'Помилка', 'Не вдалося відновити бекап: ' + e.message);
    } finally {
        btn.disabled = false;
        btn.textContent = 'Відновити';
    }
}

// Scan Google Drive for backups by name pattern
async function scanDriveBackups() {
    const btn = document.getElementById('scanDriveBtn');
    const list = document.getElementById('driveBackupsList');
    btn.disabled = true;
    btn.textContent = 'Сканування...';
    list.innerHTML = '<div style="text-align:center;padding:12px;color:var(--text-tertiary);font-size:12px;">Пошук бекапів...</div>';

    try {
        const res = await fetch('/api/admin/backup/scan-drive');
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed');

        const files = data.files || [];
        if (files.length === 0) {
            list.innerHTML = '<div style="text-align:center;padding:12px;color:var(--text-tertiary);font-size:12px;">Бекапів не знайдено</div>';
            return;
        }

        list.innerHTML = files.map(f => {
            const sizeKb = f.size ? Math.round(f.size / 1024) : '?';
            const date = f.createdTime ? new Date(f.createdTime).toLocaleString('uk-UA', { day:'2-digit', month:'2-digit', year:'2-digit', hour:'2-digit', minute:'2-digit' }) : '';
            return `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border-bottom:1px solid rgba(255,255,255,0.04);font-size:12px;">
                <div style="flex:1;min-width:0;">
                    <div style="font-weight:600;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${f.name}">${f.name}</div>
                    <div style="color:var(--text-tertiary);font-size:10px;">${date} &middot; ${sizeKb} KB</div>
                </div>
                <button onclick="restoreFromDriveUrl('${f.downloadUrl}', '${f.name.replace(/'/g, "\\'")}')" class="action-btn primary" style="padding:5px 12px;border-radius:8px;font-size:11px;font-weight:600;margin-left:8px;white-space:nowrap;">
                    Відновити
                </button>
            </div>`;
        }).join('');
    } catch (e) {
        list.innerHTML = `<div style="text-align:center;padding:12px;color:#EF4444;font-size:12px;">${e.message}</div>`;
    } finally {
        btn.disabled = false;
        btn.textContent = 'Сканувати';
    }
}

async function restoreFromDriveUrl(downloadUrl, fileName) {
    if (!confirm(`Відновити базу даних з "${fileName}"?\n\nПоточна база буде збережена.\nПісля відновлення потрібен перезапуск сервера.`)) return;

    showToast('info', 'Відновлення', 'Завантаження ' + fileName + '...');
    try {
        const res = await fetch('/api/admin/backup/restore-url', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: downloadUrl })
        });
        const data = await res.json();
        if (data.success) {
            const filesInfo = data.restored ? data.restored.join(', ') : '';
            showToast('success', 'Відновлено', data.message);
            if (confirm(`${data.message}\n\nФайли: ${filesInfo}\n\nПерезавантажити сервер зараз?`)) {
                restartServer();
            }
        } else {
            showToast('error', 'Помилка', data.error || 'Не вдалося відновити');
        }
    } catch (e) {
        showToast('error', 'Помилка', e.message);
    }
}

// ==================== BUG REPORTS ====================

async function loadBugReportingStatus() {
    try {
        const resp = await fetch('/api/admin/bug-reporting-enabled');
        if (!resp.ok) return;
        const data = await resp.json();
        const toggle = document.getElementById('bugReportingToggle');
        const status = document.getElementById('bugReportingStatus');
        if (toggle) toggle.checked = !!data.enabled;
        if (status) {
            status.textContent = data.enabled
                ? 'Увімкнено — кнопка репорту (Alt+G) активна для всіх користувачів'
                : 'Вимкнено — користувачі не бачать кнопку репорту';
        }
    } catch (e) {
        console.error('loadBugReportingStatus error:', e);
    }
}

async function toggleBugReporting() {
    const toggle = document.getElementById('bugReportingToggle');
    const enabled = toggle.checked;
    try {
        const resp = await fetch('/api/admin/bug-reporting-toggle', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ enabled })
        });
        if (!resp.ok) throw new Error('Failed');
        const status = document.getElementById('bugReportingStatus');
        if (status) {
            status.textContent = enabled
                ? 'Увімкнено — кнопка репорту (Alt+G) активна для всіх користувачів'
                : 'Вимкнено — користувачі не бачать кнопку репорту';
        }
        showToast(enabled ? 'success' : 'info', 'Bug Reporter', enabled ? 'Систему звітів увімкнено' : 'Систему звітів вимкнено');
    } catch (e) {
        toggle.checked = !enabled;
        showToast('error', 'Помилка', 'Не вдалося змінити налаштування');
    }
}

const BR_STATUS_LABELS = {
    new:         { label: 'Новий',      color: '#8CA8FF' },
    in_progress: { label: 'В роботі',   color: '#F59E0B' },
    resolved:    { label: 'Вирішено',   color: '#10B981' },
    closed:      { label: 'Закрито',    color: '#636363' }
};

async function loadBugReports() {
    const container = document.getElementById('bugReportsList');
    if (!container) return;

    const filterVal = document.getElementById('brStatusFilter')?.value || '';

    container.innerHTML = '<div class="loading"><div class="spinner"></div><span>Завантаження...</span></div>';
    try {
        const resp = await fetch('/api/admin/bug-reports');
        if (!resp.ok) throw new Error('Failed');
        let reports = await resp.json();

        if (filterVal) reports = reports.filter(r => r.status === filterVal);

        // Update badge on tab
        const badge = document.getElementById('bugReportsBadge');
        const newCount = reports.filter(r => r.status === 'new').length;
        if (badge) {
            if (newCount > 0) {
                badge.textContent = newCount > 9 ? '9+' : newCount;
                badge.style.display = 'inline';
            } else {
                badge.style.display = 'none';
            }
        }

        if (!reports.length) {
            container.innerHTML = `
                <div class="empty-state">
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="opacity:0.3">
                        <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                        <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
                    </svg>
                    <div class="empty-state-text">Звітів немає</div>
                </div>`;
            return;
        }

        const headerRow = `
            <div class="table-row header" style="grid-template-columns:60px 1fr 1fr 120px 100px 80px 80px 100px;">
                <div>ID</div><div>Користувач</div><div>Сторінка</div>
                <div>Статус</div><div>Дата</div>
                <div style="text-align:center;">Фото</div>
                <div style="text-align:center;">Відео</div>
                <div>Дії</div>
            </div>`;

        const rows = reports.map(r => {
            const st = BR_STATUS_LABELS[r.status] || { label: r.status, color: '#A1A1A1' };
            const dateStr = r.created_at ? r.created_at.substring(0, 16) : '—';
            const pageShort = r.page_url ? r.page_url.replace(/^https?:\/\/[^/]+/, '').substring(0, 40) : '—';
            return `
                <div class="table-row" style="grid-template-columns:60px 1fr 1fr 120px 100px 80px 80px 100px;cursor:pointer;" onclick="viewBugReport(${r.id})">
                    <div style="color:var(--text-tertiary);">#${r.id}</div>
                    <div>
                        <div style="font-weight:600;font-size:13px;">${escAdminHtml(r.user_name || 'Невідомо')}</div>
                        <div style="font-size:11px;color:var(--text-tertiary);">${escAdminHtml(r.user_email || '')}</div>
                    </div>
                    <div style="font-size:12px;color:var(--text-secondary);word-break:break-all;">${escAdminHtml(pageShort)}</div>
                    <div>
                        <span style="padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;background:${st.color}22;color:${st.color};">
                            ${st.label}
                        </span>
                    </div>
                    <div style="font-size:12px;color:var(--text-secondary);">${dateStr}</div>
                    <div style="text-align:center;">
                        ${r.has_screenshot ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>' : '—'}
                    </div>
                    <div style="text-align:center;">
                        ${r.has_video ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#8CA8FF" stroke-width="2"><polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/></svg>' : '—'}
                    </div>
                    <div class="actions-cell" onclick="event.stopPropagation()">
                        <button class="action-btn secondary" style="padding:4px 10px;font-size:11px;" onclick="viewBugReport(${r.id})">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                        </button>
                        <button class="action-btn danger" style="padding:4px 10px;font-size:11px;" onclick="deleteBugReport(${r.id})">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
                        </button>
                    </div>
                </div>`;
        }).join('');

        container.innerHTML = `<div class="table-body">${headerRow}${rows}</div>`;
    } catch (e) {
        container.innerHTML = '<div class="empty-state"><div class="empty-state-text">Помилка завантаження</div></div>';
    }
}

async function viewBugReport(id) {
    const modal = document.getElementById('bugReportModal');
    const body  = document.getElementById('bugReportModalBody');
    const title = document.getElementById('bugReportModalTitle');
    if (!modal || !body) return;

    body.innerHTML = '<div class="loading"><div class="spinner"></div><span>Завантаження...</span></div>';
    modal.classList.add('active');
    title.textContent = `Звіт #${id}`;

    try {
        const resp = await fetch(`/api/admin/bug-reports/${id}`);
        if (!resp.ok) throw new Error('Not found');
        const r = await resp.json();
        let logs = [];
        try { logs = JSON.parse(r.logs || '[]'); } catch(e) {}

        const st = BR_STATUS_LABELS[r.status] || { label: r.status, color: '#A1A1A1' };

        body.innerHTML = `
            <!-- Meta row -->
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:13px;">
                <div style="background:var(--surface-secondary);border-radius:12px;padding:14px 16px;">
                    <div style="color:var(--text-tertiary);font-size:11px;margin-bottom:4px;">КОРИСТУВАЧ</div>
                    <div style="font-weight:600;">${escAdminHtml(r.user_name || 'Невідомо')}</div>
                    <div style="color:var(--text-secondary);font-size:12px;">${escAdminHtml(r.user_email || '')}</div>
                </div>
                <div style="background:var(--surface-secondary);border-radius:12px;padding:14px 16px;">
                    <div style="color:var(--text-tertiary);font-size:11px;margin-bottom:4px;">СТОРІНКА</div>
                    <div style="font-size:12px;word-break:break-all;color:var(--text-secondary);">${escAdminHtml(r.page_url || '—')}</div>
                    <div style="color:var(--text-tertiary);font-size:11px;margin-top:6px;">${r.created_at || ''}</div>
                </div>
            </div>

            <!-- Status -->
            <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
                <span style="font-size:12px;font-weight:700;color:var(--text-tertiary);text-transform:uppercase;">Статус:</span>
                <span style="padding:4px 12px;border-radius:20px;font-size:12px;font-weight:700;background:${st.color}22;color:${st.color};">${st.label}</span>
                <select id="brStatusSelect_${id}" onchange="updateBugReportStatus(${id})"
                    style="padding:6px 12px;background:var(--surface-secondary);border:1px solid rgba(255,255,255,0.1);border-radius:8px;color:var(--text-primary);font-size:12px;margin-left:auto;">
                    <option value="new"         ${r.status==='new'?'selected':''}>Новий</option>
                    <option value="in_progress" ${r.status==='in_progress'?'selected':''}>В роботі</option>
                    <option value="resolved"    ${r.status==='resolved'?'selected':''}>Вирішено</option>
                    <option value="closed"      ${r.status==='closed'?'selected':''}>Закрито</option>
                </select>
            </div>

            <!-- Description -->
            ${r.description ? `
            <div>
                <div style="font-size:11px;font-weight:700;color:var(--text-tertiary);text-transform:uppercase;margin-bottom:6px;">ОПИС ПРОБЛЕМИ</div>
                <div style="background:var(--surface-secondary);border-radius:12px;padding:14px 16px;font-size:13px;line-height:1.6;white-space:pre-wrap;">${escAdminHtml(r.description)}</div>
            </div>` : ''}

            <!-- Screenshot -->
            ${r.screenshot_path ? `
            <div>
                <div style="font-size:11px;font-weight:700;color:var(--text-tertiary);text-transform:uppercase;margin-bottom:6px;">СКРІНШОТ</div>
                <div style="border-radius:12px;overflow:hidden;border:1px solid rgba(255,255,255,0.08);">
                    <img src="/${r.screenshot_path}" style="width:100%;display:block;" loading="lazy" alt="screenshot">
                </div>
            </div>` : ''}

            <!-- Video -->
            ${r.video_path ? `
            <div>
                <div style="font-size:11px;font-weight:700;color:var(--text-tertiary);text-transform:uppercase;margin-bottom:6px;">ЗАПИС ЕКРАНУ</div>
                <video src="/${r.video_path}" controls style="width:100%;border-radius:12px;background:#000;border:1px solid rgba(255,255,255,0.08);" preload="metadata"></video>
            </div>` : ''}

            <!-- Logs -->
            ${logs.length ? `
            <div>
                <div style="font-size:11px;font-weight:700;color:var(--text-tertiary);text-transform:uppercase;margin-bottom:6px;">КОНСОЛЬНІ ЛОГИ (${logs.length})</div>
                <div style="background:#0a0a0a;border:1px solid rgba(255,255,255,0.06);border-radius:12px;padding:12px;max-height:200px;overflow-y:auto;font-family:'Courier New',monospace;font-size:11px;line-height:1.6;">
                    ${logs.map(l => {
                        const c = l.level==='error'?'#EF4444':l.level==='warn'?'#F59E0B':l.level==='info'?'#8CA8FF':'#636363';
                        return `<div style="color:${c};margin:0 0 2px;white-space:pre-wrap;word-break:break-all;">[${(l.level||'log').toUpperCase()}] ${l.time?l.time.substring(11,19):''} ${escAdminHtml(l.message||'')}</div>`;
                    }).join('')}
                </div>
            </div>` : ''}

            <!-- User Agent -->
            ${r.user_agent ? `
            <div style="font-size:11px;color:var(--text-tertiary);padding:8px 12px;background:var(--surface-secondary);border-radius:8px;word-break:break-all;">
                ${escAdminHtml(r.user_agent)}
            </div>` : ''}

            <!-- Actions -->
            <div style="display:flex;gap:10px;justify-content:flex-end;padding-top:4px;">
                <button class="action-btn danger" onclick="deleteBugReport(${id},true)">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/></svg>
                    Видалити
                </button>
            </div>
        `;
    } catch (e) {
        body.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-tertiary);">Не вдалося завантажити звіт</div>';
    }
}

async function updateBugReportStatus(id) {
    const sel = document.getElementById(`brStatusSelect_${id}`);
    if (!sel) return;
    try {
        await fetch(`/api/admin/bug-reports/${id}/status`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: sel.value })
        });
        showToast('success', 'Статус оновлено', '');
    } catch (e) {
        showToast('error', 'Помилка', 'Не вдалося оновити статус');
    }
}

async function deleteBugReport(id, fromModal = false) {
    if (!confirm(`Видалити звіт #${id}?`)) return;
    try {
        const resp = await fetch(`/api/admin/bug-reports/${id}`, { method: 'DELETE' });
        if (!resp.ok) throw new Error('Failed');
        if (fromModal) closeModal('bugReportModal');
        showToast('success', 'Видалено', `Звіт #${id} видалено`);
        loadBugReports();
    } catch (e) {
        showToast('error', 'Помилка', 'Не вдалося видалити звіт');
    }
}

function escAdminHtml(s) {
    return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// Initialize on DOM load
document.addEventListener('DOMContentLoaded', async function() {
    await initAdminPanel();

    // Handle URL params for drive connection callback
    const params = new URLSearchParams(window.location.search);
    if (params.get('drive') === 'connected') {
        switchTab('backup');
        showToast('success', 'Підключено', 'Google Drive підключено успішно!');
        window.history.replaceState({}, '', '/admin/backup');
    } else if (params.get('drive') === 'error') {
        switchTab('backup');
        showToast('error', 'Помилка', 'Не вдалося підключити Google Drive');
        window.history.replaceState({}, '', '/admin/backup');
    }
});
