/**
 * Notifications Modal — bot notification settings (Telegram integration)
 * Extracted from bot-detail.html
 * Depends on: botId, showToast (global)
 */

var notificationSettings = {
    newTrade: true,
    closeTrade: true,
    stopLoss: true,
    takeProfit: true,
    positionChange: false,
    pnlThreshold: false,
    pnlProfitThreshold: 100,
    pnlLossThreshold: 50,
    dailySummary: false,
    weeklySummary: false
};

async function openNotificationsModal() {
    document.getElementById('notificationsModal').style.display = 'flex';
    await checkTelegramConnection();
    await loadNotificationSettings();
    setupPnlThresholdToggle();
}

function closeNotificationsModal() {
    document.getElementById('notificationsModal').style.display = 'none';
}

async function checkTelegramConnection() {
    try {
        const response = await fetch('/api/telegram/status', {
            credentials: 'include'
        });
        if (response.ok) {
            const data = await response.json();
            const connectCard = document.getElementById('telegramConnectCard');
            const connectedCard = document.getElementById('telegramConnectedCard');

            if (data.linked) {
                connectCard.style.display = 'none';
                connectedCard.style.display = 'block';
                const userResponse = await fetch('/api/auth/me', { credentials: 'include' });
                if (userResponse.ok) {
                    const userData = await userResponse.json();
                    if (userData.telegramUsername) {
                        document.getElementById('telegramUsername').textContent = '@' + userData.telegramUsername;
                    }
                }
            } else {
                connectCard.style.display = 'block';
                connectedCard.style.display = 'none';
            }
        }
    } catch (error) {
        console.error('Error checking Telegram status:', error);
    }
}

async function loadNotificationSettings() {
    try {
        const response = await fetch(`/api/bots/${botId}/notifications`, {
            credentials: 'include'
        });
        if (response.ok) {
            const data = await response.json();
            notificationSettings = { ...notificationSettings, ...data };

            document.getElementById('notifyNewTrade').checked = notificationSettings.newTrade;
            document.getElementById('notifyCloseTrade').checked = notificationSettings.closeTrade;
            document.getElementById('notifyStopLoss').checked = notificationSettings.stopLoss;
            document.getElementById('notifyTakeProfit').checked = notificationSettings.takeProfit;
            document.getElementById('notifyPositionChange').checked = notificationSettings.positionChange;
            document.getElementById('notifyPnlThreshold').checked = notificationSettings.pnlThreshold;
            document.getElementById('pnlProfitThreshold').value = notificationSettings.pnlProfitThreshold || 100;
            document.getElementById('pnlLossThreshold').value = notificationSettings.pnlLossThreshold || 50;
            document.getElementById('notifyDailySummary').checked = notificationSettings.dailySummary;
            document.getElementById('notifyWeeklySummary').checked = notificationSettings.weeklySummary;

            document.getElementById('pnlThresholdSettings').style.display =
                notificationSettings.pnlThreshold ? 'block' : 'none';
        }
    } catch (error) {
        console.error('Error loading notification settings:', error);
    }
}

function setupPnlThresholdToggle() {
    const pnlToggle = document.getElementById('notifyPnlThreshold');
    const pnlSettings = document.getElementById('pnlThresholdSettings');

    pnlToggle?.addEventListener('change', () => {
        pnlSettings.style.display = pnlToggle.checked ? 'block' : 'none';
    });
}

async function saveNotificationSettings() {
    const settings = {
        newTrade: document.getElementById('notifyNewTrade').checked,
        closeTrade: document.getElementById('notifyCloseTrade').checked,
        stopLoss: document.getElementById('notifyStopLoss').checked,
        takeProfit: document.getElementById('notifyTakeProfit').checked,
        positionChange: document.getElementById('notifyPositionChange').checked,
        pnlThreshold: document.getElementById('notifyPnlThreshold').checked,
        pnlProfitThreshold: parseFloat(document.getElementById('pnlProfitThreshold').value) || 100,
        pnlLossThreshold: parseFloat(document.getElementById('pnlLossThreshold').value) || 50,
        dailySummary: document.getElementById('notifyDailySummary').checked,
        weeklySummary: document.getElementById('notifyWeeklySummary').checked
    };

    try {
        const response = await fetch(`/api/bots/${botId}/notifications`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(settings)
        });

        if (response.ok) {
            notificationSettings = settings;
            closeNotificationsModal();
            if (typeof showToast === 'function') {
                showToast('success', 'Налаштування збережено', 'Налаштування сповіщень оновлено');
            }
        } else {
            const error = await response.json();
            if (typeof showToast === 'function') {
                showToast('error', 'Помилка', error.error || 'Не вдалося зберегти налаштування');
            }
        }
    } catch (error) {
        console.error('Error saving notification settings:', error);
        if (typeof showToast === 'function') {
            showToast('error', 'Помилка', 'Не вдалося зберегти налаштування сповіщень');
        }
    }
}

// Close notifications modal on background click
document.getElementById('notificationsModal')?.addEventListener('click', (e) => {
    if (e.target.id === 'notificationsModal') closeNotificationsModal();
});
