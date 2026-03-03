// Yamato Trading Platform - Client Application
const API_BASE = '/api';

// ==================== TOAST NOTIFICATION SYSTEM ====================

// Create toast container
function createToastContainer() {
    if (document.getElementById('toastContainer')) return;

    const container = document.createElement('div');
    container.id = 'toastContainer';
    document.body.appendChild(container);

    const style = document.createElement('style');
    style.id = 'toastStyles';
    style.textContent = `
        #toastContainer {
            position: fixed;
            top: 20px;
            right: 20px;
            z-index: 99999;
            display: flex;
            flex-direction: column;
            gap: 10px;
            max-width: 380px;
            pointer-events: none;
        }
        .toast {
            background: #1a1a1a;
            border: 1px solid rgba(255, 255, 255, 0.1);
            border-radius: 16px;
            padding: 16px 20px;
            display: flex;
            align-items: flex-start;
            gap: 12px;
            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
            animation: toastSlideIn 0.4s cubic-bezier(0.16, 1, 0.3, 1);
            pointer-events: all;
            backdrop-filter: blur(12px);
        }
        .toast.toast-out {
            animation: toastSlideOut 0.3s cubic-bezier(0.4, 0, 0.2, 1) forwards;
        }
        @keyframes toastSlideIn {
            from {
                opacity: 0;
                transform: translateX(100%) scale(0.9);
            }
            to {
                opacity: 1;
                transform: translateX(0) scale(1);
            }
        }
        @keyframes toastSlideOut {
            from {
                opacity: 1;
                transform: translateX(0) scale(1);
            }
            to {
                opacity: 0;
                transform: translateX(100%) scale(0.9);
            }
        }
        .toast-icon {
            width: 36px;
            height: 36px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 18px;
            flex-shrink: 0;
        }
        .toast-success .toast-icon { background: rgba(16, 185, 129, 0.2); }
        .toast-error .toast-icon { background: rgba(96, 6, 59, 0.2); }
        .toast-warning .toast-icon { background: rgba(245, 158, 11, 0.2); }
        .toast-info .toast-icon { background: rgba(59, 130, 246, 0.2); }
        .toast-login .toast-icon { background: rgba(139, 92, 246, 0.2); }
        .toast-security .toast-icon { background: rgba(16, 185, 129, 0.2); }
        .toast-transaction .toast-icon { background: rgba(245, 158, 11, 0.2); }
        .toast-bot .toast-icon { background: rgba(59, 130, 246, 0.2); }
        .toast-system .toast-icon { background: rgba(96, 6, 59, 0.2); }
        .toast-content {
            flex: 1;
            min-width: 0;
        }
        .toast-title {
            font-weight: 700;
            font-size: 14px;
            color: #fff;
            margin-bottom: 4px;
        }
        .toast-message {
            font-size: 13px;
            color: #a1a1a1;
            line-height: 1.4;
        }
        .toast-close {
            background: none;
            border: none;
            color: #666;
            cursor: pointer;
            padding: 4px;
            margin: -4px -4px -4px 8px;
            border-radius: 8px;
            transition: 0.2s;
        }
        .toast-close:hover {
            background: rgba(255, 255, 255, 0.1);
            color: #fff;
        }
        .toast-progress {
            position: absolute;
            bottom: 0;
            left: 0;
            height: 3px;
            background: var(--accent-primary, #60063B);
            border-radius: 0 0 16px 16px;
            animation: toastProgress 5s linear forwards;
        }
        @keyframes toastProgress {
            from { width: 100%; }
            to { width: 0%; }
        }
    `;
    document.head.appendChild(style);
}

// SVG Icons for notifications
const notificationIcons = {
    success: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>`,
    error: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#60063B" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`,
    warning: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"></path><line x1="12" y1="9" x2="12" y2="13"></line><line x1="12" y1="17" x2="12.01" y2="17"></line></svg>`,
    info: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>`,
    login: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8B5CF6" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>`,
    security: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path><polyline points="9 12 11 14 15 10"></polyline></svg>`,
    transaction: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="2"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>`,
    bot: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" stroke-width="2"><rect x="3" y="11" width="18" height="10" rx="2"></rect><circle cx="12" cy="5" r="2"></circle><path d="M12 7v4"></path><line x1="8" y1="16" x2="8" y2="16"></line><line x1="16" y1="16" x2="16" y2="16"></line></svg>`,
    system: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#60063B" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon></svg>`
};

// Get notification icon by type
function getNotificationIcon(type) {
    return notificationIcons[type] || notificationIcons.info;
}

// Show toast notification
function showToast(type, title, message, duration = 5000, icon = null) {
    createToastContainer();
    const container = document.getElementById('toastContainer');

    // Use SVG icons
    const iconHtml = icon ? `<span style="font-size: 18px;">${icon}</span>` : (notificationIcons[type] || notificationIcons.info);

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.style.position = 'relative';
    toast.innerHTML = `
        <div class="toast-icon">${iconHtml}</div>
        <div class="toast-content">
            <div class="toast-title">${title}</div>
            <div class="toast-message">${message}</div>
        </div>
        <button class="toast-close" onclick="this.closest('.toast').remove()">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
            </svg>
        </button>
        <div class="toast-progress"></div>
    `;

    container.appendChild(toast);

    // Auto remove after duration
    setTimeout(() => {
        if (toast.parentElement) {
            toast.classList.add('toast-out');
            setTimeout(() => toast.remove(), 300);
        }
    }, duration);

    return toast;
}

// ==================== SOCKET.IO CLIENT ====================

let socket = null;
let notificationCount = 0;

function initSocketIO() {
    // Only init on authenticated pages
    const path = window.location.pathname;
    if (path.includes('reglogin') || path === '/login' || path === '/register' || path === '/' || path.includes('index.html')) {
        return;
    }

    // Check if socket.io is available
    if (typeof io === 'undefined') {
        console.warn('Socket.io not loaded, skipping real-time notifications');
        return;
    }

    socket = io({
        withCredentials: true
    });

    socket.on('connect', () => {
        console.log('Connected to notification server');
    });

    socket.on('notification', (notification) => {
        // Show toast
        showToast(
            notification.type,
            notification.title,
            notification.message,
            5000,
            notification.icon
        );

        // Update notification count
        notificationCount++;
        updateNotificationBadge();

        // Refresh notification list if panel is open
        const panel = document.getElementById('notificationPanel');
        if (panel && panel.classList.contains('active')) {
            loadNotifications();
        }
    });

    socket.on('disconnect', () => {
        console.log('Disconnected from notification server');
    });

    // Telegram channel post broadcast — show toast on any page
    socket.on('tg_channel_post', (post) => {
        const preview = post.text
            ? post.text.substring(0, 90) + (post.text.length > 90 ? '…' : '')
            : 'Новий пост у каналі';
        showToast('info', '📢 Yamato Legends', preview, 8000, '📢');
        // Dispatch for community page real-time feed update
        document.dispatchEvent(new CustomEvent('tg_channel_post', { detail: post }));
    });
}

// ==================== NOTIFICATION PANEL ====================

function createNotificationPanel() {
    // Don't create on login/register page
    const path = window.location.pathname;
    if (path.includes('reglogin') || path === '/login' || path === '/register' || path === '/' || path.includes('index.html')) {
        return;
    }

    // Add notification icon to nav if not exists
    const navSidebar = document.querySelector('.nav-sidebar');
    if (navSidebar && !document.getElementById('notificationBtn')) {
        const notifBtn = document.createElement('div');
        notifBtn.id = 'notificationBtn';
        notifBtn.className = 'nav-item';
        notifBtn.style.position = 'relative';
        notifBtn.innerHTML = `
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
            </svg>
            <span id="notificationBadge" class="notification-badge" style="display: none;">0</span>
            <span class="nav-label">Сповіщення</span>
        `;
        notifBtn.onclick = toggleNotificationPanel;

        // Insert after profile link (settings)
        const profileLink = navSidebar.querySelector('[href="/profile"]');
        if (profileLink) {
            profileLink.after(notifBtn);
        } else {
            navSidebar.appendChild(notifBtn);
        }
    }

    // Create notification panel
    if (!document.getElementById('notificationPanel')) {
        const panel = document.createElement('div');
        panel.id = 'notificationPanel';
        panel.innerHTML = `
            <div class="notif-panel-header">
                <h3>Сповіщення</h3>
                <div class="notif-panel-actions">
                    <button onclick="markAllNotificationsRead()" title="Позначити всі як прочитані">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <polyline points="9 11 12 14 22 4"></polyline>
                            <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"></path>
                        </svg>
                    </button>
                    <button onclick="toggleNotificationPanel()">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
            </div>
            <div id="notificationList" class="notif-panel-list">
                <div class="notif-loading">Завантаження...</div>
            </div>
        `;
        document.body.appendChild(panel);

        // Add panel styles
        const style = document.createElement('style');
        style.textContent = `
            .notification-badge {
                position: absolute;
                top: -2px;
                right: -2px;
                background: #60063B;
                color: white;
                font-size: 10px;
                font-weight: 700;
                min-width: 18px;
                height: 18px;
                border-radius: 9px;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 0 4px;
            }
            #notificationPanel {
                position: fixed;
                top: 20px;
                left: 100px;
                width: 360px;
                max-height: calc(100vh - 40px);
                background: #141414;
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 24px;
                box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
                z-index: 9999;
                display: none;
                flex-direction: column;
                overflow: hidden;
            }
            #notificationPanel.active {
                display: flex;
                animation: panelSlideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1);
            }
            @keyframes panelSlideIn {
                from {
                    opacity: 0;
                    transform: translateY(-10px) scale(0.95);
                }
                to {
                    opacity: 1;
                    transform: translateY(0) scale(1);
                }
            }
            .notif-panel-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 20px 24px;
                border-bottom: 1px solid rgba(255, 255, 255, 0.05);
            }
            .notif-panel-header h3 {
                font-size: 16px;
                font-weight: 700;
                margin: 0;
            }
            .notif-panel-actions {
                display: flex;
                gap: 8px;
            }
            .notif-panel-actions button {
                background: none;
                border: none;
                color: #666;
                cursor: pointer;
                padding: 6px;
                border-radius: 8px;
                transition: 0.2s;
            }
            .notif-panel-actions button:hover {
                background: rgba(255, 255, 255, 0.1);
                color: #fff;
            }
            .notif-panel-list {
                flex: 1;
                overflow-y: auto;
                max-height: 400px;
            }
            .notif-item {
                display: flex;
                gap: 12px;
                padding: 16px 24px;
                border-bottom: 1px solid rgba(255, 255, 255, 0.03);
                cursor: pointer;
                transition: 0.2s;
            }
            .notif-item:hover {
                background: rgba(255, 255, 255, 0.03);
            }
            .notif-item.unread {
                background: rgba(96, 6, 59, 0.05);
            }
            .notif-item-icon {
                width: 36px;
                height: 36px;
                border-radius: 50%;
                background: rgba(255, 255, 255, 0.05);
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 16px;
                flex-shrink: 0;
            }
            .notif-item-content {
                flex: 1;
                min-width: 0;
            }
            .notif-item-title {
                font-size: 13px;
                font-weight: 600;
                color: #fff;
                margin-bottom: 2px;
            }
            .notif-item-message {
                font-size: 12px;
                color: #888;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .notif-item-time {
                font-size: 11px;
                color: #555;
                margin-top: 4px;
            }
            .notif-empty {
                padding: 40px 24px;
                text-align: center;
                color: #666;
            }
            .notif-empty svg {
                margin-bottom: 12px;
                opacity: 0.5;
            }
            .notif-loading {
                padding: 40px 24px;
                text-align: center;
                color: #666;
            }
        `;
        document.head.appendChild(style);

        // Make panel draggable via header
        const header = panel.querySelector('.notif-panel-header');
        if (header) {
            header.style.cursor = 'grab';
            let dragging = false, ox = 0, oy = 0;

            header.addEventListener('mousedown', e => {
                if (e.target.closest('button')) return;
                dragging = true;
                const r = panel.getBoundingClientRect();
                ox = e.clientX - r.left;
                oy = e.clientY - r.top;
                panel.style.right = 'unset';
                header.style.cursor = 'grabbing';
                e.preventDefault();
            });

            document.addEventListener('mousemove', e => {
                if (!dragging) return;
                panel.style.left = (e.clientX - ox) + 'px';
                panel.style.top  = (e.clientY - oy) + 'px';
            });

            document.addEventListener('mouseup', () => {
                if (dragging) { dragging = false; header.style.cursor = 'grab'; }
            });

            // Touch
            header.addEventListener('touchstart', e => {
                if (e.target.closest('button')) return;
                const t = e.touches[0];
                const r = panel.getBoundingClientRect();
                dragging = true;
                ox = t.clientX - r.left;
                oy = t.clientY - r.top;
                panel.style.right = 'unset';
            }, { passive: true });

            document.addEventListener('touchmove', e => {
                if (!dragging) return;
                const t = e.touches[0];
                panel.style.left = (t.clientX - ox) + 'px';
                panel.style.top  = (t.clientY - oy) + 'px';
            }, { passive: true });

            document.addEventListener('touchend', () => { dragging = false; });
        }
    }
}

function toggleNotificationPanel() {
    const panel = document.getElementById('notificationPanel');
    if (!panel) return;

    if (panel.classList.contains('active')) {
        panel.classList.remove('active');
    } else {
        panel.classList.add('active');
        loadNotifications();
    }
}

async function loadNotifications() {
    const list = document.getElementById('notificationList');
    if (!list) return;

    try {
        const response = await fetch('/api/notifications', { credentials: 'include' });
        const data = await response.json();

        if (!data.notifications || data.notifications.length === 0) {
            list.innerHTML = `
                <div class="notif-empty">
                    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"></path>
                        <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
                    </svg>
                    <div>Немає сповіщень</div>
                </div>
            `;
            return;
        }

        list.innerHTML = data.notifications.map(notif => `
            <div class="notif-item ${notif.is_read ? '' : 'unread'}" onclick="markNotificationRead(${notif.id})">
                <div class="notif-item-icon">${getNotificationIcon(notif.type)}</div>
                <div class="notif-item-content">
                    <div class="notif-item-title">${notif.title}</div>
                    <div class="notif-item-message">${notif.message}</div>
                    <div class="notif-item-time">${getTimeAgo(notif.created_at)}</div>
                </div>
            </div>
        `).join('');

        // Update badge
        notificationCount = data.unreadCount || 0;
        updateNotificationBadge();

    } catch (error) {
        console.error('Failed to load notifications:', error);
        list.innerHTML = '<div class="notif-empty">Помилка завантаження</div>';
    }
}

async function markNotificationRead(id) {
    try {
        await fetch(`/api/notifications/${id}/read`, {
            method: 'PUT',
            credentials: 'include'
        });

        // Update UI
        const item = document.querySelector(`.notif-item[onclick="markNotificationRead(${id})"]`);
        if (item) {
            item.classList.remove('unread');
        }

        // Update count
        if (notificationCount > 0) {
            notificationCount--;
            updateNotificationBadge();
        }
    } catch (error) {
        console.error('Failed to mark notification as read:', error);
    }
}

async function markAllNotificationsRead() {
    try {
        await fetch('/api/notifications/read-all', {
            method: 'PUT',
            credentials: 'include'
        });

        // Update UI
        document.querySelectorAll('.notif-item.unread').forEach(item => {
            item.classList.remove('unread');
        });

        notificationCount = 0;
        updateNotificationBadge();
    } catch (error) {
        console.error('Failed to mark all notifications as read:', error);
    }
}

function updateNotificationBadge() {
    const badge = document.getElementById('notificationBadge');
    if (badge) {
        if (notificationCount > 0) {
            badge.style.display = 'flex';
            badge.textContent = notificationCount > 99 ? '99+' : notificationCount;
        } else {
            badge.style.display = 'none';
        }
    }
}

// Close notification panel when clicking outside
document.addEventListener('click', (e) => {
    const panel = document.getElementById('notificationPanel');
    const btn = document.getElementById('notificationBtn');
    if (panel && panel.classList.contains('active')) {
        if (!panel.contains(e.target) && !btn.contains(e.target)) {
            panel.classList.remove('active');
        }
    }
});

// ==================== LOADING SCREEN ====================

function createLoadingScreen() {
    // Don't show on login/register page
    const path = window.location.pathname;
    if (path.includes('reglogin') || path === '/login' || path === '/register' || path === '/' || path.includes('index.html')) {
        return;
    }

    const loader = document.createElement('div');
    loader.id = 'yamatoLoader';
    loader.innerHTML = `
        <div class="loader-bg-texture"></div>
        <div class="loader-floater" style="top: 10%; left: 10%;">Z</div>
        <div class="loader-floater" style="top: 20%; right: 15%; animation-delay: 1s;">Y</div>
        <div class="loader-floater" style="bottom: 15%; left: 20%; animation-delay: 2s;">X</div>
        <div class="loader-floater" style="bottom: 30%; right: 5%; animation-delay: 3s;">01</div>

        <div class="loader-scene">
            <div class="loader-cube" id="loaderCube"></div>
        </div>

        <div class="loader-meta">
            <div class="loader-meta-line">SYSTEM_INTEGRITY: CHECKING...</div>
            <div class="loader-meta-line">VOXEL_DENSITY: <span id="loaderDensity">0</span>%</div>
            <div class="loader-progress" id="loaderProgress"></div>
            <div class="loader-meta-line" style="margin-top: 10px; font-size: 10px;">
                MEMORY_ADDRESS: 0x4F 0x4B 0x21
            </div>
        </div>
    `;
    document.body.appendChild(loader);

    // Add loader styles
    const style = document.createElement('style');
    style.id = 'loaderStyles';
    style.textContent = `
        #yamatoLoader {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: #080808;
            display: flex;
            flex-direction: column;
            justify-content: center;
            align-items: center;
            z-index: 99999;
            font-family: 'Courier New', Courier, monospace;
            overflow: hidden;
            opacity: 0;
            animation: loaderFadeIn 0.8s cubic-bezier(0.4, 0, 0.2, 1) forwards;
            transition: opacity 1s cubic-bezier(0.4, 0, 0.2, 1), transform 1s cubic-bezier(0.4, 0, 0.2, 1);
        }
        @keyframes loaderFadeIn {
            0% { opacity: 0; transform: scale(1.02); }
            100% { opacity: 1; transform: scale(1); }
        }
        #yamatoLoader.fade-out {
            opacity: 0;
            transform: scale(0.98);
            pointer-events: none;
        }
        body.loading-active > *:not(#yamatoLoader):not(script):not(style):not(link) {
            opacity: 0;
        }
        body:not(.loading-active) > *:not(#yamatoLoader):not(script):not(style):not(link) {
            animation: contentFadeIn 0.6s cubic-bezier(0.4, 0, 0.2, 1) forwards;
        }
        @keyframes contentFadeIn {
            0% { opacity: 0; transform: translateY(10px); }
            100% { opacity: 1; transform: translateY(0); }
        }
        .loader-bg-texture {
            position: absolute;
            top: 0; left: 0;
            width: 100%; height: 100%;
            pointer-events: none;
            opacity: 0.15;
            background-image: radial-gradient(#333 1px, transparent 1px);
            background-size: 4px 4px;
        }
        .loader-floater {
            position: absolute;
            font-size: 24px;
            font-weight: 900;
            color: #60063B;
            opacity: 0.4;
            animation: loaderFloat 10s infinite ease-in-out;
        }
        @keyframes loaderFloat {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-20px); }
        }
        .loader-scene {
            width: 200px;
            height: 200px;
            perspective: 800px;
            position: relative;
            z-index: 10;
        }
        .loader-cube {
            width: 100%;
            height: 100%;
            position: relative;
            transform-style: preserve-3d;
            animation: loaderRotate 4s infinite linear;
        }
        @keyframes loaderRotate {
            0% { transform: rotateX(-15deg) rotateY(0deg) rotateZ(5deg); }
            100% { transform: rotateX(-15deg) rotateY(360deg) rotateZ(5deg); }
        }
        .loader-face {
            position: absolute;
            width: 200px;
            height: 200px;
            display: grid;
            grid-template-columns: repeat(14, 1fr);
            grid-template-rows: repeat(14, 1fr);
            font-size: 12px;
            line-height: 1;
            font-weight: bold;
            border: 2px solid #333;
            backface-visibility: hidden;
            background: #0a0a0a;
        }
        .loader-face-front { transform: rotateY(0deg) translateZ(100px); }
        .loader-face-back { transform: rotateY(180deg) translateZ(100px); }
        .loader-face-right { transform: rotateY(90deg) translateZ(100px); }
        .loader-face-left { transform: rotateY(-90deg) translateZ(100px); }
        .loader-face-top { transform: rotateX(90deg) translateZ(100px); }
        .loader-face-bottom { transform: rotateX(-90deg) translateZ(100px); }
        .loader-char {
            display: flex;
            justify-content: center;
            align-items: center;
            user-select: none;
        }
        .loader-t-yellow { color: #60063B; background: #1a1a1a; }
        .loader-t-green { color: #10B981; background: #1a1a1a; }
        .loader-t-dark { color: #444; background: transparent; }
        .loader-meta {
            position: absolute;
            bottom: 40px;
            left: 40px;
            display: flex;
            flex-direction: column;
            gap: 10px;
            z-index: 5;
        }
        .loader-meta-line {
            font-size: 14px;
            letter-spacing: -0.5px;
            text-transform: uppercase;
            font-weight: 800;
            color: #666;
        }
        .loader-progress {
            display: flex;
            gap: 2px;
            margin-top: 5px;
        }
        .loader-p-unit {
            width: 10px;
            height: 20px;
            background: #60063B;
            transition: background 0.1s;
        }
        .loader-p-unit.inactive {
            background: transparent;
            border: 1px solid #333;
        }
        @keyframes loaderTwitch {
            0% { opacity: 1; }
            50% { opacity: 0.5; }
            51% { opacity: 0; }
            52% { opacity: 1; }
            100% { opacity: 1; }
        }
        .loader-glitch {
            animation: loaderTwitch 2s infinite steps(1);
        }
    `;
    document.head.appendChild(style);

    // Create cube faces
    const cube = document.getElementById('loaderCube');
    const faces = ['front', 'back', 'right', 'left', 'top', 'bottom'];
    const chars = ['X', 'Y', 'Z', '0', '1', '/', '\\', '#', '%'];

    faces.forEach(face => {
        const faceEl = document.createElement('div');
        faceEl.className = `loader-face loader-face-${face}`;

        for (let i = 0; i < 196; i++) {
            const span = document.createElement('span');
            span.className = 'loader-char';
            span.innerText = chars[Math.floor(Math.random() * chars.length)];

            const rand = Math.random();
            if (rand > 0.8) span.classList.add('loader-t-yellow');
            else if (rand > 0.6) span.classList.add('loader-t-green');
            else span.classList.add('loader-t-dark');

            if (Math.random() > 0.95) {
                span.classList.add('loader-glitch');
                span.style.animationDelay = Math.random() + 's';
            }

            faceEl.appendChild(span);
        }
        cube.appendChild(faceEl);
    });

    // Create progress units
    const progressContainer = document.getElementById('loaderProgress');
    for (let i = 0; i < 20; i++) {
        const div = document.createElement('div');
        div.className = 'loader-p-unit inactive';
        progressContainer.appendChild(div);
    }

    // Animate progress
    let progress = 0;
    const densityDisplay = document.getElementById('loaderDensity');
    const progressUnits = document.querySelectorAll('.loader-p-unit');

    const progressInterval = setInterval(() => {
        progress += 2;
        if (progress > 100) progress = 100;

        densityDisplay.innerText = progress;

        const unitsToFill = Math.floor((progress / 100) * 20);
        progressUnits.forEach((u, idx) => {
            if (idx < unitsToFill) u.classList.remove('inactive');
            else u.classList.add('inactive');
        });
    }, 50);

    // Store interval for cleanup
    window.loaderProgressInterval = progressInterval;

    // Random character animation
    const charInterval = setInterval(() => {
        const allChars = document.querySelectorAll('.loader-char');
        for (let i = 0; i < 20; i++) {
            const idx = Math.floor(Math.random() * allChars.length);
            if (allChars[idx]) {
                allChars[idx].innerText = chars[Math.floor(Math.random() * chars.length)];
            }
        }
    }, 50);

    window.loaderCharInterval = charInterval;

    // Hide page content until loader is ready
    document.body.classList.add('loading-active');
}

function hideLoadingScreen() {
    const loader = document.getElementById('yamatoLoader');
    if (loader) {
        // Clear intervals
        if (window.loaderProgressInterval) clearInterval(window.loaderProgressInterval);
        if (window.loaderCharInterval) clearInterval(window.loaderCharInterval);

        // Show page content
        document.body.classList.remove('loading-active');

        // Fade out
        loader.classList.add('fade-out');

        // Remove after animation
        setTimeout(() => {
            loader.remove();
            const styles = document.getElementById('loaderStyles');
            if (styles) styles.remove();
        }, 1000);
    } else {
        // If loader doesn't exist, just make sure content is visible
        document.body.classList.remove('loading-active');
    }
}

// Show loader immediately
createLoadingScreen();

// ==================== MODAL FOR DEVELOPMENT ====================

function showDevModal() {
    let modal = document.getElementById('devModal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'devModal';
        modal.innerHTML = `
            <div class="dev-modal-overlay">
                <div class="dev-modal-card">
                    <div class="dev-modal-icon">
                        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#60063B" stroke-width="2">
                            <circle cx="12" cy="12" r="10"></circle>
                            <line x1="12" y1="8" x2="12" y2="12"></line>
                            <line x1="12" y1="16" x2="12.01" y2="16"></line>
                        </svg>
                    </div>
                    <div class="dev-modal-title">В розробці</div>
                    <div class="dev-modal-text">
                        Ця функція зараз в розробці. Незабаром буде доступна!
                    </div>
                    <button class="dev-modal-btn" onclick="closeDevModal()">Зрозуміло</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        // Add styles
        const style = document.createElement('style');
        style.textContent = `
            .dev-modal-overlay {
                position: fixed;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                background: rgba(0, 0, 0, 0.8);
                backdrop-filter: blur(8px);
                display: flex;
                align-items: center;
                justify-content: center;
                z-index: 10000;
                animation: fadeIn 0.3s ease;
            }
            @keyframes fadeIn {
                from { opacity: 0; }
                to { opacity: 1; }
            }
            .dev-modal-card {
                background: #141414;
                border: 1px solid rgba(255, 255, 255, 0.1);
                border-radius: 32px;
                padding: 48px;
                max-width: 420px;
                width: 90%;
                text-align: center;
                animation: scaleIn 0.3s ease;
            }
            @keyframes scaleIn {
                from { transform: scale(0.9); opacity: 0; }
                to { transform: scale(1); opacity: 1; }
            }
            .dev-modal-icon {
                width: 80px;
                height: 80px;
                border-radius: 50%;
                background: rgba(96, 6, 59, 0.1);
                display: flex;
                align-items: center;
                justify-content: center;
                margin: 0 auto 24px;
            }
            .dev-modal-title {
                font-size: 28px;
                font-weight: 700;
                margin-bottom: 16px;
                color: white;
            }
            .dev-modal-text {
                font-size: 16px;
                color: #A1A1A1;
                line-height: 1.6;
                margin-bottom: 32px;
            }
            .dev-modal-btn {
                background: #60063B;
                color: white;
                padding: 14px 32px;
                border-radius: 9999px;
                border: none;
                font-weight: 700;
                font-size: 15px;
                cursor: pointer;
                transition: 0.2s;
            }
            .dev-modal-btn:hover {
                opacity: 0.9;
                transform: translateY(-1px);
            }
        `;
        document.head.appendChild(style);
    }
    modal.style.display = 'block';
}

function closeDevModal() {
    const modal = document.getElementById('devModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// Close modal on overlay click
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('dev-modal-overlay')) {
        closeDevModal();
    }
});

// ==================== UTILITIES ====================

function formatPrice(price, decimals = 2) {
    const num = parseFloat(price) || 0;
    if (num >= 1000) {
        return '$' + num.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    } else if (num >= 1 || num === 0) {
        return '$' + num.toFixed(decimals);
    } else if (num > 0.01) {
        return '$' + num.toFixed(decimals);
    } else {
        return '$' + num.toFixed(4);
    }
}

function formatChange(change) {
    const sign = change >= 0 ? '+' : '';
    return sign + change.toFixed(2) + '%';
}

function formatVolume(volume) {
    if (volume >= 1e9) return (volume / 1e9).toFixed(2) + 'B';
    if (volume >= 1e6) return (volume / 1e6).toFixed(2) + 'M';
    if (volume >= 1e3) return (volume / 1e3).toFixed(2) + 'K';
    return volume.toFixed(2);
}

// Get crypto coin icon - using CoinGecko/cryptocurrency-icons CDN
function getCoinIcon(symbol, size = 32) {
    const cleanSymbol = symbol.replace('USDT', '').replace('USD', '').replace('BUSD', '').toLowerCase();
    // Using cryptocurrency-icons from jsdelivr CDN (most reliable)
    return `https://cdn.jsdelivr.net/gh/spothq/cryptocurrency-icons@master/128/color/${cleanSymbol}.png`;
}

// Fallback coin icon URL
function getCoinIconFallback(symbol) {
    const cleanSymbol = symbol.replace('USDT', '').replace('USD', '').replace('BUSD', '').toLowerCase();
    // Alternative: CoinCap API
    return `https://assets.coincap.io/assets/icons/${cleanSymbol}@2x.png`;
}

// Get coin icon HTML element with fallback
function getCoinIconHtml(symbol, size = 32) {
    const cleanSymbol = symbol.replace('USDT', '').replace('USD', '').replace('BUSD', '');
    const primaryUrl = getCoinIcon(symbol, size);
    const fallbackUrl = getCoinIconFallback(symbol);

    return `<img src="${primaryUrl}" alt="${cleanSymbol}"
        style="width: ${size}px; height: ${size}px; border-radius: 50%; background: #1a1a1a;"
        onerror="this.onerror=null; this.src='${fallbackUrl}'; this.onerror=function(){this.style.display='none';this.parentElement.innerHTML='<span style=\\'display:flex;align-items:center;justify-content:center;width:${size}px;height:${size}px;background:#1a1a1a;border-radius:50%;font-weight:700;font-size:${Math.floor(size/2)}px;\\'>${cleanSymbol[0]}</span>';}">`;
}

function getTimeAgo(dateString) {
    if (!dateString) return 'Невідомо';

    // Parse the date - handle both ISO and other formats
    let date;
    if (dateString.includes('T') || dateString.includes('Z')) {
        // ISO format
        date = new Date(dateString);
    } else {
        // Try to parse as-is
        date = new Date(dateString.replace(' ', 'T'));
    }

    if (isNaN(date.getTime())) return 'Невідомо';

    const now = new Date();
    const diff = now - date;

    // Handle future dates (shouldn't happen but just in case)
    if (diff < 0) return 'Щойно';

    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(diff / 3600000);
    const days = Math.floor(diff / 86400000);
    const weeks = Math.floor(days / 7);
    const months = Math.floor(days / 30);

    if (seconds < 60) return 'Щойно';
    if (minutes < 60) return `${minutes} хв тому`;
    if (hours < 24) return `${hours} год тому`;
    if (days === 1) return 'Вчора';
    if (days < 7) return `${days} дн тому`;
    if (weeks < 4) return `${weeks} тиж тому`;
    if (months < 12) return `${months} міс тому`;

    // Format full date for older entries
    return date.toLocaleDateString('en-US', {
        day: 'numeric',
        month: 'short',
        year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined
    });
}

// Format date for display
function formatDateTime(dateString) {
    if (!dateString) return 'Невідомо';

    const date = new Date(dateString);
    if (isNaN(date.getTime())) return 'Невідомо';

    return date.toLocaleString('en-US', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

// ==================== API CALLS ====================

async function apiCall(endpoint, options = {}) {
    try {
        const response = await fetch(API_BASE + endpoint, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            },
            credentials: 'include'
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'API error');
        }

        return data;
    } catch (error) {
        console.error('API Error:', error);
        throw error;
    }
}

// ==================== AUTH ====================

async function register(email, password, fullName, phone) {
    return apiCall('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, fullName, phone })
    });
}

async function login(email, password) {
    return apiCall('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password })
    });
}

async function logout() {
    return apiCall('/auth/logout', { method: 'POST' });
}

async function getCurrentUser() {
    return apiCall('/auth/me');
}

// ==================== MARKET DATA ====================

async function getMarketPrices() {
    return apiCall('/market/prices');
}

async function getOrderBook(symbol) {
    return apiCall(`/market/orderbook/${symbol}`);
}

async function getTicker() {
    return apiCall('/market/ticker');
}

// ==================== PORTFOLIO ====================

async function getPortfolio() {
    return apiCall('/portfolio');
}

async function getWallets() {
    return apiCall('/wallets');
}

async function getTransactions() {
    return apiCall('/transactions');
}

// ==================== BOTS ====================

async function getBots() {
    return apiCall('/bots');
}

async function getBotsStats() {
    return apiCall('/bots/stats');
}

async function toggleBot(botId) {
    return apiCall(`/bots/${botId}/toggle`, { method: 'PATCH' });
}

// ==================== PROFILE ====================

async function getProfile() {
    return apiCall('/profile');
}

// ==================== 2FA ====================

async function get2FAStatus() {
    return apiCall('/2fa/status');
}

async function setup2FA() {
    return apiCall('/2fa/setup', { method: 'POST' });
}

async function verify2FA(token) {
    return apiCall('/2fa/verify', {
        method: 'POST',
        body: JSON.stringify({ token })
    });
}

async function disable2FA(token) {
    return apiCall('/2fa/disable', {
        method: 'POST',
        body: JSON.stringify({ token })
    });
}

// ==================== WALLETS ====================

async function getWalletsWithBalances() {
    return apiCall('/wallets');
}

async function addWalletAPI(name, currency, address) {
    return apiCall('/wallets', {
        method: 'POST',
        body: JSON.stringify({ name, currency, address })
    });
}

async function deleteWalletAPI(walletId) {
    return apiCall(`/wallets/${walletId}`, { method: 'DELETE' });
}

async function refreshWalletBalance(walletId) {
    return apiCall(`/wallets/${walletId}/refresh`, { method: 'POST' });
}

// ==================== PORTFOLIO CHARTS ====================

async function getPortfolioAllocation() {
    return apiCall('/portfolio/allocation');
}

async function getPortfolioPerformance() {
    return apiCall('/portfolio/performance');
}

// ==================== UI UPDATES ====================

// Update user balance in header
function updateUserBalance(balance) {
    const balanceElements = document.querySelectorAll('[data-user-balance]');
    balanceElements.forEach(el => {
        el.textContent = formatPrice(balance || 0);
    });

    // Also update the user pill if it exists
    const userPill = document.querySelector('.user-pill span');
    if (userPill) {
        userPill.textContent = formatPrice(balance || 0);
    }

    // Update the header balance element
    const headerBalance = document.getElementById('headerBalance');
    if (headerBalance) {
        headerBalance.textContent = formatPrice(balance || 0);
    }

    // Update total balance if it exists
    const totalBalance = document.querySelector('[data-total-balance]');
    if (totalBalance) {
        totalBalance.textContent = formatPrice(balance || 0);
    }
}

// Update user avatar with image or initial letter
function updateUserAvatar(fullName, avatarUrl = null) {
    const avatars = document.querySelectorAll('.user-avatar, #userAvatar');
    if (!avatars.length) return;

    // Get first letter of name (or 'U' for User if no name)
    let initial = 'U';
    if (fullName && fullName.trim()) {
        initial = fullName.trim().charAt(0).toUpperCase();
    }

    avatars.forEach(avatar => {
        if (avatarUrl) {
            // Show image avatar
            avatar.innerHTML = '';
            avatar.style.backgroundImage = `url(${avatarUrl})`;
            avatar.style.backgroundSize = 'cover';
            avatar.style.backgroundPosition = 'center';
        } else {
            // Show initial letter
            avatar.style.backgroundImage = 'none';
            avatar.textContent = initial;
        }
    });
}

// Update market list
function updateMarketList(prices) {
    const marketList = document.querySelector('.market-list');
    if (!marketList) return;

    const cryptoNames = {
        'BTC': 'Bitcoin',
        'ETH': 'Ethereum',
        'SOL': 'Solana',
        'DOGE': 'Dogecoin',
        'ADA': 'Cardano',
        'DOT': 'Polkadot',
        'BNB': 'Binance Coin',
        'XRP': 'Ripple',
        'AVAX': 'Avalanche',
        'MATIC': 'Polygon',
        'LINK': 'Chainlink',
        'UNI': 'Uniswap',
        'ATOM': 'Cosmos',
        'LTC': 'Litecoin'
    };

    marketList.innerHTML = Object.entries(prices).map(([symbol, data], index) => `
        <div class="market-item ${index === 0 ? 'active' : ''}" data-symbol="${symbol}">
            <div class="coin-info">
                <div class="coin-icon">
                    ${getCoinIconHtml(symbol, 32)}
                </div>
                <div class="coin-name">
                    <span class="coin-ticker">${symbol}</span>
                    <span class="coin-sub">${cryptoNames[symbol] || symbol}</span>
                </div>
            </div>
            <div class="coin-price">
                <span class="price-val">${formatPrice(data.price)}</span>
                <span class="price-change ${data.change24h < 0 ? 'neg' : ''}">${formatChange(data.change24h)}</span>
            </div>
        </div>
    `).join('');

    // Add click handlers
    marketList.querySelectorAll('.market-item').forEach(item => {
        item.addEventListener('click', () => {
            marketList.querySelectorAll('.market-item').forEach(i => i.classList.remove('active'));
            item.classList.add('active');
            const symbol = item.dataset.symbol;
            updateChartForSymbol(symbol, prices[symbol]);
        });
    });
}

// Update chart display
function updateChartForSymbol(symbol, data) {
    const pairPill = document.querySelector('.pair-pill span');
    if (pairPill) {
        pairPill.textContent = `${symbol}/USDT`;
    }

    if (data) {
        const highStat = document.querySelector('.chart-stat .stat-val');
        if (highStat) {
            highStat.textContent = formatPrice(data.high24h).replace('$', '');
        }

        const volStat = document.querySelectorAll('.chart-stat .stat-val')[1];
        if (volStat) {
            volStat.textContent = formatVolume(data.volume24h);
        }

        // Update order input
        const priceInput = document.querySelector('.input-pill input[type="text"]');
        if (priceInput) {
            priceInput.value = data.price.toLocaleString('en-US');
        }
    }

    // Switch the chart to this symbol
    if (window.yamatoChart && window.yamatoChart.setSymbol) {
        window.yamatoChart.setSymbol(symbol + 'USDT');
    }

    // Update global state
    window.currentTicker = symbol;
    if (data) window.currentPrice = data.price;

    // Load order book for this symbol
    loadOrderBook(symbol);
}

// Update order book
async function loadOrderBook(symbol) {
    try {
        const orderBook = await getOrderBook(symbol);
        updateOrderBookDisplay(orderBook);
    } catch (error) {
        console.error('Failed to load order book:', error);
    }
}

function updateOrderBookDisplay(orderBook) {
    const orderBookList = document.querySelector('.order-book-list');
    if (!orderBookList) return;

    const asks = orderBook.asks.slice(0, 3).reverse();
    const bids = orderBook.bids.slice(0, 3);

    orderBookList.innerHTML = `
        ${asks.map(ask => `
            <div class="ob-row sell">
                <span class="ob-price">${formatPrice(ask.price).replace('$', '')}</span>
                <span class="ob-amount">${ask.amount.toFixed(4)}</span>
            </div>
        `).join('')}
        <div style="height: 1px; background: rgba(255,255,255,0.05); margin: 4px 0;"></div>
        ${bids.map(bid => `
            <div class="ob-row buy">
                <span class="ob-price">${formatPrice(bid.price).replace('$', '')}</span>
                <span class="ob-amount">${bid.amount.toFixed(4)}</span>
            </div>
        `).join('')}
    `;
}

// Update ticker tape
function updateTickerTape(ticker) {
    const tickerTrack = document.querySelector('.ticker-track');
    if (!tickerTrack) return;

    const tickerHTML = ticker.map(item => `
        <div class="ticker-item">
            <span class="ticker-name">${item.symbol}</span>
            <span class="ticker-price">${formatPrice(item.price)}</span>
            <span class="${item.change >= 0 ? 'ticker-up' : 'ticker-down'}">${formatChange(item.change)}</span>
        </div>
    `).join('');

    tickerTrack.innerHTML = tickerHTML + tickerHTML; // Duplicate for seamless scroll
}

// Update bots page
async function updateBotsPage() {
    try {
        const [bots, stats] = await Promise.all([getBots(), getBotsStats()]);

        // Only show "Add New Bot" for admins
        const isAdmin = window.currentUser && (window.currentUser.role === 'admin' || window.currentUser.role === 'moderator');

        // Show/hide header Create button for admins
        const createBotBtn = document.getElementById('createBotBtn');
        if (createBotBtn) {
            createBotBtn.style.display = isAdmin ? 'flex' : 'none';
        }

        // Update bots grid
        const botsGrid = document.querySelector('.bots-grid');
        if (botsGrid) {
            if (bots.length > 0) {
                const botCards = bots.map(bot => createBotCard(bot, isAdmin)).join('');
                const addCard = isAdmin ? `
                    <div class="bot-card" style="border-style: dashed; background: transparent; justify-content: center; align-items: center; min-height: 240px; cursor: pointer;" onclick="openCreateModal()">
                        <div style="width: 56px; height: 56px; border-radius: 50%; background: var(--surface); display: flex; align-items: center; justify-content: center; margin-bottom: 12px;">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)"><path d="M12 5v14M5 12h14"></path></svg>
                        </div>
                        <div style="font-weight: 700; color: var(--text-secondary);">Додати Binance бота</div>
                        <div style="font-size: 12px; color: var(--text-tertiary); margin-top: 4px;">Підключіть ф'ючерсний рахунок</div>
                    </div>
                ` : '';
                botsGrid.innerHTML = botCards + addCard;
            } else {
                // No bots - show empty state
                const addCard = isAdmin ? `
                    <div class="bot-card" style="border-style: dashed; background: transparent; justify-content: center; align-items: center; min-height: 240px; cursor: pointer; grid-column: 1 / -1;" onclick="openCreateModal()">
                        <div style="width: 56px; height: 56px; border-radius: 50%; background: var(--surface); display: flex; align-items: center; justify-content: center; margin-bottom: 12px;">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)"><path d="M12 5v14M5 12h14"></path></svg>
                        </div>
                        <div style="font-weight: 700; color: var(--text-secondary);">Додати першого бота</div>
                        <div style="font-size: 12px; color: var(--text-tertiary); margin-top: 4px;">Підключіть ф'ючерсний рахунок</div>
                    </div>
                ` : `
                    <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px; color: var(--text-tertiary);">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" style="margin-bottom: 16px; opacity: 0.5;">
                            <path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4"></path>
                            <path d="M4 6v12c0 1.1.9 2 2 2h14v-4"></path>
                            <path d="M18 12a2 2 0 0 0-2 2c0 1.1.9 2 2 2h4v-4h-4z"></path>
                        </svg>
                        <div style="font-size: 16px; font-weight: 600; margin-bottom: 8px;">Немає активних ботів</div>
                        <div style="font-size: 14px;">Торгові боти з'являться тут коли будуть доступні.</div>
                    </div>
                `;
                botsGrid.innerHTML = addCard;
            }
        }

        // Update collective stats
        const totalPL = document.querySelector('[data-total-pl]');
        if (totalPL) {
            const tp = stats.totalProfit || 0;
            totalPL.textContent = (tp >= 0 ? '+' : '') + formatPrice(tp);
            totalPL.style.color = tp >= 0 ? 'var(--color-up)' : 'var(--color-down)';
        }

        const activeAllocation = document.querySelector('[data-active-allocation]');
        if (activeAllocation) {
            activeAllocation.textContent = formatPrice(stats.activeAllocation || 0);
        }
    } catch (error) {
        console.error('Failed to update bots page:', error);
    }
}

function createBotCard(bot, isAdmin) {
    const pair = bot.pair ? bot.pair.split('/')[0] : (bot.selected_symbol ? bot.selected_symbol.replace('USDT', '') : 'BTC');
    const isBinanceBot = bot.type === 'binance';
    const botSymbol = isBinanceBot ? (bot.selected_symbol || 'BTCUSDT').replace('USDT', '') : pair;

    const dashboardButton = `<a href="/bot-stats/${bot.id}" class="config-link" style="text-decoration: none; color: var(--accent-primary);">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path d="M3 3v18h18"></path>
                    <path d="M7 16l4-8 4 4 6-6"></path>
                </svg>
                Дашборд
            </a>`;

    const chartButton = isAdmin ? `<a href="/bot/${bot.id}" class="config-link" style="text-decoration: none; color: var(--text-secondary);">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                    <circle cx="12" cy="12" r="3"></circle>
                </svg>
                Відкрити графік
            </a>` : '';

    const footerButton = chartButton + dashboardButton;

    const modeLabel = isBinanceBot
        ? `<span style="margin-left: 8px; font-size: 10px; padding: 2px 6px; background: ${bot.mode === 'bot' ? 'rgba(16, 185, 129, 0.2)' : 'rgba(255, 159, 64, 0.2)'}; color: ${bot.mode === 'bot' ? '#10B981' : '#FF9F40'}; border-radius: 4px;">${bot.mode === 'bot' ? 'LIVE' : 'TEST'}</span>`
        : '';

    // For Binance bots, show different stats layout
    const statsHtml = isBinanceBot ? `
            <div class="bot-stats">
                <div class="stat-item">
                    <div class="stat-label">Тип</div>
                    <div class="stat-value">Ф'ючерси</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">Час роботи</div>
                    <div class="stat-value">${bot.runningTime}</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">Символ</div>
                    <div class="stat-value">${bot.selected_symbol || 'BTCUSDT'}</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">Статус</div>
                    <div class="stat-value ${bot.is_active ? 'up' : ''}">${bot.is_active ? 'Активний' : 'Призупинено'}</div>
                </div>
            </div>
    ` : `
            <div class="bot-stats">
                <div class="stat-item">
                    <div class="stat-label">Загальний прибуток</div>
                    <div class="stat-value ${bot.profit >= 0 ? 'up' : 'down'}">${formatPrice(bot.profit)}</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">Час роботи</div>
                    <div class="stat-value">${bot.runningTime}</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">Денний П/З</div>
                    <div class="stat-value ${bot.dailyPL >= 0 ? 'up' : 'down'}">${formatChange(bot.dailyPL)}</div>
                </div>
                <div class="stat-item">
                    <div class="stat-label">Інвестиції</div>
                    <div class="stat-value">${formatPrice(bot.investment)}</div>
                </div>
            </div>
    `;

    return `
        <div class="bot-card" data-bot-id="${bot.id}">
            <div class="bot-top-row">
                <div class="bot-info">
                    <div class="bot-icon">
                        ${getCoinIconHtml(botSymbol, 40)}
                    </div>
                    <div>
                        <div class="bot-name">${bot.name}${modeLabel}</div>
                        <div class="bot-type">${isBinanceBot ? 'Binance Futures' : bot.type + ' • ' + bot.pair}</div>
                    </div>
                </div>
                <label class="switch">
                    <input type="checkbox" ${bot.is_active ? 'checked' : ''} onchange="handleBotToggle(${bot.id})">
                    <span class="slider"></span>
                </label>
            </div>
            ${statsHtml}
            <div class="bot-footer">
                <div class="status-badge ${bot.is_active ? 'status-active' : 'status-inactive'}">
                    ${bot.is_active ? 'Запущено' : 'Призупинено'}
                </div>
                <div class="bot-footer-links">
                    ${footerButton}
                </div>
            </div>
        </div>
    `;
}

async function handleBotToggle(botId) {
    try {
        await toggleBot(botId);
        updateBotsPage();
    } catch (error) {
        console.error('Failed to toggle bot:', error);
        showDevModal();
    }
}

// Update portfolio page
async function updatePortfolioPage() {
    try {
        const portfolio = await getPortfolio();

        // Update total balance
        const totalBalance = document.querySelector('[data-total-balance]');
        if (totalBalance) {
            totalBalance.textContent = formatPrice(portfolio.totalValue);
        }

        // Update holdings
        updateUserBalance(portfolio.totalValue);

        // Update transactions
        const txList = document.querySelector('.scroll-y .history-item')?.parentElement;
        if (txList && portfolio.transactions.length > 0) {
            txList.innerHTML = portfolio.transactions.map(tx => createTransactionItem(tx)).join('');
        }

        // Update allocation chart
        updateAllocationChart(portfolio.allocation);
    } catch (error) {
        console.error('Failed to update portfolio:', error);
    }
}

function createTransactionItem(tx) {
    const isIncoming = tx.type === 'deposit' || tx.type === 'buy';
    return `
        <div class="history-item">
            <div class="tx-icon ${isIncoming ? 'incoming' : 'outgoing'}">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                    ${isIncoming
                        ? '<path d="M7 13l5 5 5-5M12 18V6"></path>'
                        : '<path d="M7 11l5-5 5 5M12 6v12"></path>'}
                </svg>
            </div>
            <div class="tx-details">
                <span class="tx-title">${({'deposit':'Поповнення','buy':'Купівля','withdraw':'Виведення','sell':'Продаж'}[tx.type] || (tx.type.charAt(0).toUpperCase() + tx.type.slice(1)))} ${tx.currency}</span>
                <span class="tx-date">${new Date(tx.created_at).toLocaleDateString()}</span>
            </div>
            <div class="tx-asset">
                <div style="font-weight: 700; font-size: 14px;">${isIncoming ? '+' : '-'}${tx.amount} ${tx.currency}</div>
                <div style="font-size: 11px; color: var(--text-tertiary);">${formatPrice(tx.usd_value || 0)}</div>
            </div>
            <div class="tx-status" style="color: ${tx.status === 'completed' ? '#10B981' : '#F59E0B'};">
                ${tx.status.charAt(0).toUpperCase() + tx.status.slice(1)}
            </div>
        </div>
    `;
}

function updateAllocationChart(allocation) {
    const legend = document.querySelector('.legend');
    if (!legend || !allocation.length) return;

    legend.innerHTML = allocation.map((item, i) => {
        const colors = ['#60063B', '#627EEA', '#10B981', '#F59E0B', '#8B5CF6'];
        return `
            <div class="legend-item">
                <div class="legend-label">
                    <span class="dot" style="background: ${colors[i % colors.length]};"></span> ${item.currency}
                </div>
                <span style="font-weight: 600;">${item.percentage}%</span>
            </div>
        `;
    }).join('');
}

// Update profile page
async function updateProfilePage() {
    try {
        const profile = await getProfile();

        // Update user info fields
        const fullNameField = document.querySelector('[data-field="fullName"]');
        if (fullNameField) fullNameField.textContent = profile.user.fullName || '---';

        const emailField = document.querySelector('[data-field="email"]');
        if (emailField) emailField.textContent = profile.user.email || '---';

        const phoneField = document.querySelector('[data-field="phone"]');
        if (phoneField) phoneField.textContent = profile.user.phone || '---';

        // Update activity log
        const activityLog = document.querySelector('.activity-log');
        if (activityLog && profile.activityLog.length > 0) {
            activityLog.innerHTML = profile.activityLog.map(log => `
                <div class="log-item">
                    <div class="log-info">
                        <span class="log-title">${log.action}</span>
                        <span class="log-meta">${log.details || ''} ${log.ip_address ? '• IP: ' + log.ip_address : ''}</span>
                    </div>
                    <span class="log-meta">${getTimeAgo(log.created_at)}</span>
                </div>
            `).join('');
        }

        // Update payment methods
        const paymentSection = document.querySelector('.payment-method')?.parentElement;
        if (paymentSection && profile.paymentMethods.length > 0) {
            const paymentHTML = profile.paymentMethods.map(pm => `
                <div class="payment-method">
                    <div style="display: flex; align-items: center; gap: 16px;">
                        <div style="width: 48px; height: 32px; background: #222; border-radius: 6px; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700;">
                            ${pm.type.toUpperCase()}
                        </div>
                        <div>
                            <div style="font-size: 14px; font-weight: 600;">•••• ${pm.card_last_four}</div>
                            <div style="font-size: 11px; color: var(--text-secondary);">Expires ${pm.expiry_date}</div>
                        </div>
                    </div>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" onclick="showDevModal()" style="cursor: pointer;">
                        <path d="M3 6h18"></path>
                        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
                    </svg>
                </div>
            `).join('');

            paymentSection.innerHTML = paymentHTML + `
                <button class="btn-primary" style="height: 48px; background: var(--surface-secondary); color: white; border: 1px dashed rgba(255,255,255,0.2);" onclick="showDevModal()">
                    + Add New Payment Method
                </button>
            `;
        }

        updateUserBalance(profile.user.balance);
        updateUserAvatar(profile.user.fullName || profile.user.full_name || profile.user.email, profile.user.avatar);
    } catch (error) {
        console.error('Failed to update profile:', error);
    }
}

// ==================== NAVIGATION ====================

function setupNavigation() {
    // Header brand click - go to landing
    document.querySelectorAll('.brand-pill').forEach(brand => {
        brand.style.cursor = 'pointer';
        brand.addEventListener('click', () => {
            window.location.href = '/';
        });
    });

    // User pill click - go to profile
    document.querySelectorAll('.user-pill').forEach(pill => {
        pill.style.cursor = 'pointer';
        pill.addEventListener('click', () => {
            window.location.href = '/profile';
        });
    });

}

// ==================== USER PILL CONTEXT MENU ====================

function initUserPillContextMenu() {
    const pill = document.querySelector('.user-pill');
    if (!pill) return;

    // Remove old menu if exists
    let menu = document.getElementById('userPillCtxMenu');
    if (menu) menu.remove();

    // Build menu
    menu = document.createElement('div');
    menu.id = 'userPillCtxMenu';

    const currentPath = window.location.pathname;
    const isAdmin = window.currentUser && (window.currentUser.role === 'admin' || window.currentUser.role === 'moderator');

    const items = [
        { href: '/dashboard',     icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>', label: 'Дашборд' },
        { href: '/portfolio',     icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></svg>', label: 'Портфоліо' },
        { href: '/bots',          icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M12 2v4"/><circle cx="8" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="16" cy="12" r="1" fill="currentColor" stroke="none"/><path d="M9 16h6"/></svg>', label: 'Боти' },
        { divider: true },
        { href: '/news',          icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/><line x1="10" y1="6" x2="18" y2="6"/><line x1="10" y1="10" x2="18" y2="10"/></svg>', label: 'Новини' },
        { href: '/subscriptions', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>', label: 'Підписки' },
        { href: '/community',     icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>', label: 'Спільнота' },
        { divider: true },
        { href: '/profile',       icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>', label: 'Профіль' },
    ];

    if (isAdmin) {
        items.push(
            { href: '/admin', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>', label: 'Адмін панель', admin: true }
        );
    }

    items.push(
        { divider: true },
        { action: 'logout', icon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>', label: 'Вийти', danger: true }
    );

    // Inject styles once
    if (!document.getElementById('ctxMenuStyles')) {
        const style = document.createElement('style');
        style.id = 'ctxMenuStyles';
        style.textContent = `
            #userPillCtxMenu {
                position: fixed;
                z-index: 10000;
                min-width: 200px;
                background: #1a1a1a;
                border: 1px solid rgba(255,255,255,0.08);
                border-radius: 16px;
                padding: 6px;
                box-shadow: 0 16px 48px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.04);
                backdrop-filter: blur(20px);
                display: none;
                opacity: 0;
                transform: scale(0.95) translateY(-4px);
                transform-origin: top right;
                transition: opacity 0.15s ease, transform 0.15s ease;
                font-family: inherit;
            }
            #userPillCtxMenu.visible {
                display: block;
            }
            #userPillCtxMenu.open {
                opacity: 1;
                transform: scale(1) translateY(0);
            }
            #userPillCtxMenu .ctx-item {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 9px 14px;
                border-radius: 10px;
                color: #e0e0e0;
                font-size: 13px;
                font-weight: 500;
                cursor: pointer;
                text-decoration: none;
                transition: background 0.15s;
                border: none;
                background: none;
                width: 100%;
                text-align: left;
            }
            #userPillCtxMenu .ctx-item:hover {
                background: rgba(255,255,255,0.06);
                color: #fff;
            }
            #userPillCtxMenu .ctx-item.active {
                background: rgba(16,185,129,0.12);
                color: #10B981;
            }
            #userPillCtxMenu .ctx-item.active svg {
                stroke: #10B981;
            }
            #userPillCtxMenu .ctx-item.admin-item {
                color: #8B5CF6;
            }
            #userPillCtxMenu .ctx-item.admin-item svg {
                stroke: #8B5CF6;
            }
            #userPillCtxMenu .ctx-item.admin-item:hover {
                background: rgba(139,92,246,0.1);
            }
            #userPillCtxMenu .ctx-item.danger {
                color: #EF4444;
            }
            #userPillCtxMenu .ctx-item.danger svg {
                stroke: #EF4444;
            }
            #userPillCtxMenu .ctx-item.danger:hover {
                background: rgba(239,68,68,0.1);
            }
            #userPillCtxMenu .ctx-item svg {
                flex-shrink: 0;
                opacity: 0.7;
            }
            #userPillCtxMenu .ctx-divider {
                height: 1px;
                background: rgba(255,255,255,0.06);
                margin: 4px 8px;
            }
        `;
        document.head.appendChild(style);
    }

    // Build items
    items.forEach(item => {
        if (item.divider) {
            const div = document.createElement('div');
            div.className = 'ctx-divider';
            menu.appendChild(div);
            return;
        }

        const el = document.createElement(item.href ? 'a' : 'button');
        let cls = 'ctx-item';
        if (item.href && item.href === currentPath) cls += ' active';
        if (item.admin) cls += ' admin-item';
        if (item.danger) cls += ' danger';
        el.className = cls;
        if (item.href) el.href = item.href;
        el.innerHTML = item.icon + '<span>' + item.label + '</span>';

        if (item.action === 'logout') {
            el.addEventListener('click', async (e) => {
                e.preventDefault();
                try {
                    await fetch('/api/auth/logout', { method: 'POST' });
                } catch (_) {}
                window.location.href = '/login';
            });
        }

        menu.appendChild(el);
    });

    document.body.appendChild(menu);

    function showMenu(x, y) {
        menu.classList.add('visible');
        // Position: align to right of pill, below it
        const mw = menu.offsetWidth;
        const mh = menu.offsetHeight;
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        // Keep in viewport
        if (x + mw > vw - 8) x = vw - mw - 8;
        if (x < 8) x = 8;
        if (y + mh > vh - 8) y = vh - mh - 8;
        if (y < 8) y = 8;
        menu.style.left = x + 'px';
        menu.style.top = y + 'px';
        requestAnimationFrame(() => menu.classList.add('open'));
    }

    function hideMenu() {
        menu.classList.remove('open');
        setTimeout(() => menu.classList.remove('visible'), 150);
    }

    // Right-click on user-pill
    pill.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        showMenu(e.clientX, e.clientY);
    });

    // Also show on three-dot icon click
    const dotsIcon = pill.querySelector('svg:last-child');
    if (dotsIcon) {
        dotsIcon.style.cursor = 'pointer';
        dotsIcon.addEventListener('click', (e) => {
            e.stopPropagation();
            const rect = pill.getBoundingClientRect();
            showMenu(rect.right - 200, rect.bottom + 8);
        });
    }

    // Close on click outside
    document.addEventListener('click', (e) => {
        if (!menu.contains(e.target)) hideMenu();
    });
    document.addEventListener('contextmenu', (e) => {
        if (!pill.contains(e.target)) hideMenu();
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') hideMenu();
    });
}

// ==================== SETUP BUTTONS ====================

function setupButtons() {
    // Dashboard has real functionality — skip dev-modal overrides
    const path = window.location.pathname;
    if (path === '/dashboard' || path.includes('datedos')) return;

    // Buy/Sell buttons
    document.querySelectorAll('.btn-primary').forEach(btn => {
        if (btn.textContent.includes('Buy') || btn.textContent.includes('Sell')) {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                showDevModal();
            });
        }
    });

    // Deposit/Withdraw buttons
    document.querySelectorAll('.btn-deposit, .btn-withdraw').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            showDevModal();
        });
    });

    // Create bot button
    document.querySelectorAll('.btn-create').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            showDevModal();
        });
    });

    // Icon buttons (add buttons)
    document.querySelectorAll('.icon-btn-sm').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            showDevModal();
        });
    });

    // Config links
    document.querySelectorAll('.config-link').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            showDevModal();
        });
    });

    // Settings nav items (exclude items with onclick attribute like Sign Out)
    document.querySelectorAll('.profile-nav-item').forEach(item => {
        if (!item.classList.contains('active') && !item.hasAttribute('onclick')) {
            item.addEventListener('click', (e) => {
                e.preventDefault();
                showDevModal();
            });
        }
    });

    // Download report button
    document.querySelectorAll('button').forEach(btn => {
        if (btn.textContent.includes('Download') || btn.textContent.includes('Add New')) {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                showDevModal();
            });
        }
    });

    // Toggle switches
    document.querySelectorAll('.toggle-option').forEach(option => {
        if (!option.classList.contains('active')) {
            option.addEventListener('click', (e) => {
                e.preventDefault();
                showDevModal();
            });
        }
    });

    // Time filter pills
    document.querySelectorAll('.pair-pill').forEach(pill => {
        if (pill.style.cursor !== 'default') {
            pill.style.cursor = 'pointer';
            pill.addEventListener('click', () => {
                showDevModal();
            });
        }
    });
}

// ==================== INITIALIZATION ====================

async function initializePage() {
    const path = window.location.pathname;

    // Setup navigation on all pages
    setupNavigation();
    setupButtons();

    // Load user data FIRST for authenticated pages (before page-specific initialization)
    const isAuthenticatedPage = path.includes('datedos') || path === '/dashboard' ||
                                 path.includes('portfolio') || path === '/portfolio' ||
                                 path.includes('bots') || path === '/bots' ||
                                 path.includes('porfile') || path === '/profile' ||
                                 path.includes('subscriptions') || path === '/subscriptions' ||
                                 path.includes('news') || path === '/news' ||
                                 path.includes('bot-detail') || path.startsWith('/bot/') ||
                                 path.includes('community') || path === '/community' ||
                                 path.includes('admin') || path === '/admin' ||
                                 path === '/docs';

    if (isAuthenticatedPage) {
        try {
            const user = await getCurrentUser();
            const displayBalance = user.balance || user.demoBalance || 0;
            updateUserBalance(displayBalance);
            updateUserAvatar(user.fullName || user.full_name || user.email, user.avatar);
            window.currentUser = user;

            // Show admin nav link for admin/moderator
            const adminNavLink = document.getElementById('adminNavLink');
            if (adminNavLink) {
                if (user.role === 'admin' || user.role === 'moderator') {
                    adminNavLink.classList.remove('admin-hidden');
                    adminNavLink.style.display = '';
                } else {
                    adminNavLink.classList.add('admin-hidden');
                }
            }

            // Init context menu after user data is loaded
            initUserPillContextMenu();
        } catch (error) {
            console.log('User not logged in');
        }
    }

    // Page-specific initialization
    if (path === '/' || path.includes('index.html')) {
        // Landing page - update ticker
        try {
            const ticker = await getTicker();
            updateTickerTape(ticker);
        } catch (error) {
            console.error('Failed to load ticker:', error);
        }
    } else if (path.includes('reglogin') || path === '/login' || path === '/register') {
        // Auth page — login/register logic is handled inline in reglogin.html
    } else if (path.includes('datedos') || path === '/dashboard') {
        // Trading dashboard — datedos.html has its own market list + chart switching logic
        // Do NOT call initDashboard() here as it overwrites the inline handlers
    } else if (path.includes('portfolio') || path === '/portfolio') {
        // Portfolio page
        await initDashboard();
        try {
            await updatePortfolioPage();
        } catch (error) {
            console.log('User not logged in');
        }
    } else if (path.includes('bots') || path === '/bots') {
        // Bots page
        await initDashboard();
        try {
            await updateBotsPage();
        } catch (error) {
            console.log('User not logged in');
        }
    } else if (path.includes('porfile') || path === '/profile') {
        // Profile page
        try {
            await updateProfilePage();
        } catch (error) {
            console.log('User not logged in');
        }
    }

    // Hide loading screen after everything is loaded
    hideLoadingScreen();
}

async function initDashboard() {
    try {
        const response = await getMarketPrices();
        // API returns { prices: [{symbol, price, change, ...}] } — convert to object format
        const pricesArray = response.prices || [];
        const prices = {};
        pricesArray.forEach(function (item) {
            prices[item.symbol] = {
                price: item.price,
                change24h: item.change,
                high24h: item.high,
                low24h: item.low,
                volume24h: item.volume
            };
        });

        updateMarketList(prices);

        // Update chart with first symbol
        const firstSymbol = Object.keys(prices)[0];
        if (firstSymbol) {
            updateChartForSymbol(firstSymbol, prices[firstSymbol]);
        }

        // Set up auto-refresh every 10 seconds
        setInterval(async () => {
            try {
                const resp = await getMarketPrices();
                const arr = resp.prices || [];
                const newPrices = {};
                arr.forEach(function (item) {
                    newPrices[item.symbol] = {
                        price: item.price,
                        change24h: item.change,
                        high24h: item.high,
                        low24h: item.low,
                        volume24h: item.volume
                    };
                });

                updateMarketList(newPrices);

                const activeItem = document.querySelector('.market-item.active');
                if (activeItem) {
                    const symbol = activeItem.dataset.symbol;
                    if (newPrices[symbol]) {
                        // Only update labels, don't reload chart on auto-refresh
                        const pairPill = document.querySelector('.pair-pill span');
                        if (pairPill) pairPill.textContent = symbol + '/USDT';
                    }
                }
            } catch (error) {
                console.error('Auto-refresh failed:', error);
            }
        }, 10000);
    } catch (error) {
        console.error('Failed to initialize dashboard:', error);
    }
}

// Run on page load
document.addEventListener('DOMContentLoaded', () => {
    initializePage();
    createNotificationPanel();
    initSocketIO();

    // Load initial notification count
    const path = window.location.pathname;
    if (!path.includes('reglogin') && path !== '/login' && path !== '/register' && path !== '/' && !path.includes('index.html')) {
        loadNotifications();
    }
});

// Export for global access
window.YamatoApp = {
    login,
    logout,
    register,
    getMarketPrices,
    getPortfolio,
    getBots,
    toggleBot: handleBotToggle,
    showDevModal,
    updateUserAvatar,
    // 2FA
    get2FAStatus,
    setup2FA,
    verify2FA,
    disable2FA,
    // Wallets
    getWalletsWithBalances,
    addWalletAPI,
    deleteWalletAPI,
    refreshWalletBalance,
    // Portfolio Charts
    getPortfolioAllocation,
    getPortfolioPerformance
};

// ==================== BINANCE YELLOW TEXT ====================
// Wrap every occurrence of "Binance" in text nodes with a yellow span

function highlightBinanceText(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            // Skip script/style/input nodes and already-highlighted spans
            const parent = node.parentElement;
            if (!parent) return NodeFilter.FILTER_REJECT;
            const tag = parent.tagName;
            if (tag === 'SCRIPT' || tag === 'STYLE' || tag === 'TEXTAREA' || tag === 'INPUT') return NodeFilter.FILTER_REJECT;
            if (parent.dataset && parent.dataset.binanceHL) return NodeFilter.FILTER_REJECT;
            return /Binance/i.test(node.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        }
    });

    const nodes = [];
    let n;
    while ((n = walker.nextNode())) nodes.push(n);

    nodes.forEach(node => {
        const frag = document.createDocumentFragment();
        node.nodeValue.split(/(Binance)/i).forEach(part => {
            if (/^Binance$/i.test(part)) {
                const span = document.createElement('span');
                span.dataset.binanceHL = '1';
                span.style.color = '#F0B90B';
                span.style.fontWeight = 'inherit';
                span.textContent = part;
                frag.appendChild(span);
            } else if (part) {
                frag.appendChild(document.createTextNode(part));
            }
        });
        node.parentNode.replaceChild(frag, node);
    });
}

document.addEventListener('DOMContentLoaded', () => {
    highlightBinanceText(document.body);

    // Also observe DOM mutations for dynamically-inserted content
    const obs = new MutationObserver(mutations => {
        mutations.forEach(m => {
            m.addedNodes.forEach(node => {
                if (node.nodeType === 1) highlightBinanceText(node);
            });
        });
    });
    obs.observe(document.body, { childList: true, subtree: true });
});

// Global function for inline onclick handlers
window.showDevModal = showDevModal;
window.closeDevModal = closeDevModal;
window.handleBotToggle = handleBotToggle;
window.showToast = showToast;
window.toggleNotificationPanel = toggleNotificationPanel;
window.markNotificationRead = markNotificationRead;
window.markAllNotificationsRead = markAllNotificationsRead;

// Placeholder functions for bots page (actual implementations in bots.html)
window.openCreateModal = window.openCreateModal || function() {
    console.log('openCreateModal not loaded');
    showDevModal();
};
window.openBotDetails = window.openBotDetails || function(botId) {
    console.log('openBotDetails not loaded', botId);
    showDevModal();
};

// ==================== COLLAPSIBLE SIDEBAR ====================

(function() {
    function initSidebar() {
        const sidebar = document.querySelector('.nav-sidebar');
        if (!sidebar || document.getElementById('sidebar-toggle')) return;

        // Назва поточної сторінки вгорі sidebar
        const pageTitles = {
            '/dashboard': 'Дашборд',
            '/portfolio': 'Портфоліо',
            '/bots': 'Торгові боти',
            '/news': 'Новини ринку',
            '/subscriptions': 'Преміум',
            '/admin': 'Адмін панель',
            '/profile': 'Налаштування'
        };
        const currentPath = window.location.pathname;
        const pageTitle = pageTitles[currentPath] || 'Меню';

        const titleEl = document.createElement('div');
        titleEl.id = 'sidebar-page-title';
        titleEl.textContent = pageTitle;
        sidebar.prepend(titleEl);

        // Кнопка-таб збоку від sidebar
        const toggleBtn = document.createElement('button');
        toggleBtn.id = 'sidebar-toggle';
        toggleBtn.setAttribute('aria-label', 'Toggle sidebar');
        toggleBtn.innerHTML = `
            <svg id="sidebar-toggle-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <polyline points="9 18 15 12 9 6"></polyline>
            </svg>
        `;
        // Вставляємо після sidebar як окремий елемент
        sidebar.parentNode.insertBefore(toggleBtn, sidebar.nextSibling);

        function updateIcon(isExpanded) {
            const icon = document.getElementById('sidebar-toggle-icon');
            if (!icon) return;
            // стрілка вліво якщо розгорнуто, вправо якщо згорнуто
            icon.innerHTML = isExpanded
                ? '<polyline points="15 18 9 12 15 6"></polyline>'
                : '<polyline points="9 18 15 12 9 6"></polyline>';
        }

        const isExpanded = localStorage.getItem('sidebar-fixed') === 'true';
        if (isExpanded) sidebar.classList.add('expanded');
        updateIcon(isExpanded);

        toggleBtn.addEventListener('click', () => {
            const expanded = sidebar.classList.toggle('expanded');
            localStorage.setItem('sidebar-fixed', expanded);
            updateIcon(expanded);
        });

        const style = document.createElement('style');
        style.textContent = `
            /* --- sidebar container --- */
            .nav-sidebar {
                width: 70px !important;
                overflow: hidden !important;
                align-items: flex-start !important;
                padding: 16px 15px !important;
                border-radius: 35px !important;
                transition: width 0.35s cubic-bezier(0.4, 0, 0.2, 1),
                            border-radius 0.35s ease,
                            padding 0.35s ease !important;
            }
            .nav-sidebar.expanded {
                width: 210px !important;
                padding: 16px 12px !important;
                border-radius: 28px !important;
            }

            /* --- hide admin nav for non-admins --- */
            .nav-item.admin-hidden {
                display: none !important;
            }

            /* --- nav items: circles in collapsed --- */
            .nav-item {
                width: 40px !important;
                height: 40px !important;
                border-radius: 50% !important;
                display: flex !important;
                align-items: center !important;
                justify-content: flex-start !important;
                gap: 0 !important;
                padding: 0 10px !important;
                white-space: nowrap !important;
                overflow: hidden !important;
                flex-shrink: 0 !important;
                text-decoration: none !important;
                transition: width 0.35s cubic-bezier(0.4, 0, 0.2, 1),
                            height 0.35s,
                            border-radius 0.35s,
                            gap 0.35s,
                            padding 0.35s,
                            background 0.2s,
                            color 0.2s !important;
            }

            /* --- nav items: pills in expanded --- */
            .nav-sidebar.expanded .nav-item {
                width: 100% !important;
                height: 44px !important;
                border-radius: 14px !important;
                gap: 12px !important;
                padding: 0 14px !important;
            }

            /* --- keep active/hover colours --- */
            .nav-item.active {
                background: var(--accent-primary) !important;
                color: #fff !important;
            }
            .nav-item:not(.active):not(.toggle-btn):hover {
                background: var(--surface-secondary) !important;
                color: var(--text-primary) !important;
            }

            /* --- icons stay 20 × 20 always --- */
            .nav-item > svg {
                min-width: 20px !important;
                min-height: 20px !important;
                width: 20px !important;
                height: 20px !important;
                flex-shrink: 0 !important;
            }
            .toggle-btn > svg {
                min-width: 20px !important;
                min-height: 20px !important;
                width: 20px !important;
                height: 20px !important;
                flex-shrink: 0 !important;
            }

            /* --- labels hidden when collapsed --- */
            .nav-label {
                opacity: 0 !important;
                max-width: 0 !important;
                overflow: hidden !important;
                font-weight: 600 !important;
                font-size: 14px !important;
                color: inherit !important;
                white-space: nowrap !important;
                pointer-events: none !important;
                transition: opacity 0.2s 0.1s, max-width 0.3s !important;
            }
            .nav-sidebar.expanded .nav-label {
                opacity: 1 !important;
                max-width: 140px !important;
            }

            /* --- page title at top of sidebar --- */
            #sidebar-page-title {
                font-size: 12px;
                font-weight: 700;
                color: var(--text-tertiary);
                text-transform: uppercase;
                letter-spacing: 0.08em;
                white-space: nowrap;
                overflow: hidden;
                max-width: 0;
                max-height: 0;
                opacity: 0;
                margin: 0;
                padding: 0 4px;
                transition: max-width 0.35s cubic-bezier(0.4, 0, 0.2, 1),
                            max-height 0.35s,
                            opacity 0.2s 0.1s,
                            margin 0.35s;
                pointer-events: none;
                align-self: flex-start;
            }
            .nav-sidebar.expanded #sidebar-page-title {
                max-width: 180px;
                max-height: 30px;
                opacity: 1;
                margin-bottom: 8px;
            }

            /* --- toggle tab button --- */
            #sidebar-toggle {
                position: absolute;
                top: 50%;
                transform: translateY(-50%);
                left: 70px;
                width: 20px;
                height: 44px;
                background: var(--surface);
                border: 1px solid rgba(255,255,255,0.08);
                border-left: none;
                border-radius: 0 10px 10px 0;
                display: flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                color: var(--text-tertiary);
                z-index: 101;
                padding: 0;
                transition: left 0.35s cubic-bezier(0.4, 0, 0.2, 1),
                            color 0.2s,
                            background 0.2s;
                box-shadow: 3px 0 8px rgba(0,0,0,0.3);
            }
            #sidebar-toggle:hover {
                background: var(--surface-secondary);
                color: var(--text-primary);
            }
            .nav-sidebar.expanded ~ #sidebar-toggle {
                left: 210px;
            }
            /* sidebar потрібен position:relative щоб parent тримав кнопку */
            .app-container {
                position: relative;
            }

            /* --- mobile: hide sidebar, use bottom tab bar instead --- */
            @media (max-width: 768px) {
                .nav-sidebar {
                    display: none !important;
                }
                #sidebar-toggle { display: none !important; }
                #sidebar-page-title { display: none !important; }
            }
        `;
        document.head.appendChild(style);

        const labelsMap = {
            '/dashboard': 'Дашборд',
            '/portfolio': 'Портфоліо',
            '/bots': 'Торгові боти',
            '/news': 'Новини ринку',
            '/subscriptions': 'Преміум',
            '/community': 'Спільнота',
            '/docs': 'Документація',
            '/admin': 'Адмін панель',
            '/profile': 'Налаштування'
        };

        const idLabelsMap = {
            'notificationBtn': 'Сповіщення'
        };

        sidebar.querySelectorAll('.nav-item').forEach(item => {
            if (item.id === 'sidebar-toggle') return;
            const href = item.getAttribute('href');
            const labelText = labelsMap[href] || idLabelsMap[item.id] || item.getAttribute('title') || '';
            if (labelText && !item.querySelector('span.nav-label')) {
                const span = document.createElement('span');
                span.className = 'nav-label';
                span.textContent = labelText;
                item.appendChild(span);
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initSidebar);
    } else {
        initSidebar();
    }
})();

// ==================== MOBILE BOTTOM TAB BAR ====================

(function() {
    function initBottomNav() {
        const sidebar = document.querySelector('.nav-sidebar');
        if (!sidebar) return;
        if (document.querySelector('.mobile-bottom-nav')) return;
        if (window.location.pathname.startsWith('/admin')) return;

        const currentPath = window.location.pathname;

        const tabs = [
            { href: '/dashboard', label: 'Головна', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>' },
            { href: '/portfolio', label: 'Портфель', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M21 12V7H5a2 2 0 0 1 0-4h14v4"></path><path d="M3 5v14a2 2 0 0 0 2 2h16v-5"></path><path d="M18 12a2 2 0 0 0 0 4h4v-4h-4z"></path></svg>' },
            { href: '/bots', label: 'Боти', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><rect x="2" y="6" width="20" height="12" rx="2"></rect><path d="M12 2v4"></path><circle cx="8" cy="12" r="1" fill="currentColor" stroke="none"></circle><circle cx="16" cy="12" r="1" fill="currentColor" stroke="none"></circle><path d="M9 16h6"></path></svg>' },
            { href: '/news', label: 'Новини', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"></path><line x1="10" y1="6" x2="18" y2="6"></line><line x1="10" y1="10" x2="18" y2="10"></line><line x1="10" y1="14" x2="14" y2="14"></line></svg>' },
            { href: '/profile', label: 'Профіль', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path><circle cx="12" cy="7" r="4"></circle></svg>' }
        ];

        const nav = document.createElement('nav');
        nav.className = 'mobile-bottom-nav';

        tabs.forEach(tab => {
            const isActive = currentPath === tab.href ||
                (tab.href === '/dashboard' && currentPath === '/') ||
                (tab.href === '/profile' && currentPath === '/profile');

            const a = document.createElement('a');
            a.href = tab.href;
            a.className = 'bottom-tab' + (isActive ? ' active' : '');
            a.innerHTML = `
                <span class="tab-icon">${tab.icon}</span>
                <span class="tab-label">${tab.label}</span>
            `;
            nav.appendChild(a);
        });

        document.body.appendChild(nav);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initBottomNav);
    } else {
        initBottomNav();
    }
})();

// ==================== ONBOARDING MODAL ====================

(function() {
    function initOnboarding() {
        const path = window.location.pathname;
        if (path !== '/dashboard') return;
        if (localStorage.getItem('yamato_onboarding_done')) return;

        const steps = [
            {
                title: 'Ласкаво просимо до Yamato!',
                text: 'Це ваша торгова платформа з цінами в реальному часі, ботами та аналітикою. Пройдіть коротке знайомство.',
                icon: '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="1.5"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path><polyline points="9 12 11 14 15 10"></polyline></svg>'
            },
            {
                title: 'Торгова панель',
                text: 'Зліва — ринки з цінами Binance в реальному часі. У центрі — графік з різними таймфреймами. Справа — панель торгівлі.',
                icon: '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#3B82F6" stroke-width="1.5"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>'
            },
            {
                title: 'Портфоліо та боти',
                text: 'Відстежуйте свої гаманці в розділі "Портфоліо". Автоматизуйте торгівлю за допомогою ботів у розділі "Торгові боти".',
                icon: '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#F59E0B" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="3" y1="9" x2="21" y2="9"></line><line x1="9" y1="21" x2="9" y2="9"></line></svg>'
            },
            {
                title: 'Демо-режим',
                text: 'Ви починаєте з $10,000 демо-балансу. Тренуйтесь торгувати без ризику. Реальний режим з\'явиться незабаром!',
                icon: '<svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#8B5CF6" stroke-width="1.5"><line x1="12" y1="1" x2="12" y2="23"></line><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path></svg>'
            }
        ];

        let currentStep = 0;

        const modal = document.createElement('div');
        modal.id = 'onboardingModal';
        modal.innerHTML = `
            <div class="onboarding-backdrop"></div>
            <div class="onboarding-card">
                <div class="onboarding-icon" id="onboardingIcon"></div>
                <h2 class="onboarding-title" id="onboardingTitle"></h2>
                <p class="onboarding-text" id="onboardingText"></p>
                <div class="onboarding-dots" id="onboardingDots"></div>
                <div class="onboarding-actions">
                    <button class="onboarding-skip" id="onboardingSkip">Пропустити</button>
                    <button class="onboarding-next" id="onboardingNext">Далі</button>
                </div>
            </div>
        `;
        document.body.appendChild(modal);

        const style = document.createElement('style');
        style.textContent = `
            #onboardingModal {
                position: fixed; inset: 0; z-index: 99999;
                display: flex; align-items: center; justify-content: center;
            }
            .onboarding-backdrop {
                position: absolute; inset: 0; background: rgba(0,0,0,0.7);
                backdrop-filter: blur(4px);
            }
            .onboarding-card {
                position: relative; background: #141414; border-radius: 32px;
                padding: 48px; max-width: 440px; width: 90%; text-align: center;
                border: 1px solid rgba(255,255,255,0.05);
                box-shadow: 0 40px 100px rgba(0,0,0,0.6);
                animation: onboardIn 0.4s cubic-bezier(0.16, 1, 0.3, 1);
            }
            @keyframes onboardIn {
                from { opacity: 0; transform: scale(0.9) translateY(20px); }
                to { opacity: 1; transform: scale(1) translateY(0); }
            }
            .onboarding-icon {
                width: 80px; height: 80px; border-radius: 50%;
                background: rgba(16,185,129,0.1); display: flex;
                align-items: center; justify-content: center;
                margin: 0 auto 24px;
            }
            .onboarding-title { font-size: 22px; font-weight: 700; margin-bottom: 12px; }
            .onboarding-text { color: #A1A1A1; font-size: 14px; line-height: 1.6; margin-bottom: 28px; }
            .onboarding-dots { display: flex; gap: 8px; justify-content: center; margin-bottom: 28px; }
            .onboarding-dot {
                width: 8px; height: 8px; border-radius: 50%; background: #333;
                transition: 0.3s;
            }
            .onboarding-dot.active { background: #10B981; width: 24px; border-radius: 4px; }
            .onboarding-actions { display: flex; gap: 12px; justify-content: center; }
            .onboarding-skip {
                padding: 14px 28px; border-radius: 16px; border: 1px solid rgba(255,255,255,0.1);
                background: transparent; color: #636363; font-weight: 600; font-size: 14px;
                cursor: pointer; transition: 0.2s;
            }
            .onboarding-skip:hover { color: #A1A1A1; border-color: rgba(255,255,255,0.2); }
            .onboarding-next {
                padding: 14px 36px; border-radius: 16px; border: none;
                background: #10B981; color: white; font-weight: 700; font-size: 14px;
                cursor: pointer; transition: 0.2s;
            }
            .onboarding-next:hover { transform: translateY(-1px); }
        `;
        document.head.appendChild(style);

        function renderStep() {
            const s = steps[currentStep];
            document.getElementById('onboardingIcon').innerHTML = s.icon;
            document.getElementById('onboardingTitle').textContent = s.title;
            document.getElementById('onboardingText').textContent = s.text;
            document.getElementById('onboardingDots').innerHTML = steps.map((_, i) =>
                `<div class="onboarding-dot ${i === currentStep ? 'active' : ''}"></div>`
            ).join('');

            const nextBtn = document.getElementById('onboardingNext');
            nextBtn.textContent = currentStep === steps.length - 1 ? 'Почати!' : 'Далі';
        }

        function closeOnboarding() {
            localStorage.setItem('yamato_onboarding_done', '1');
            modal.remove();
        }

        document.getElementById('onboardingSkip').addEventListener('click', closeOnboarding);
        document.getElementById('onboardingNext').addEventListener('click', () => {
            if (currentStep < steps.length - 1) {
                currentStep++;
                renderStep();
            } else {
                closeOnboarding();
            }
        });

        renderStep();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(initOnboarding, 500));
    } else {
        setTimeout(initOnboarding, 500);
    }
})();

// Bug Reporter — load on all pages
(function() {
    const script = document.createElement('script');
    script.src = '/js/bug-reporter.js';
    script.defer = true;
    document.head.appendChild(script);
})();
