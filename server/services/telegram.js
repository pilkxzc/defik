'use strict';
const { dbGet, dbRun, saveDatabase } = require('../db');
const { siteSettings, saveSettings } = require('../config');

let telegramBot = null;

async function initTelegramBot() {
    if (!siteSettings.telegramBotToken || !siteSettings.telegramBotEnabled) {
        console.log('Telegram bot disabled or no token configured');
        telegramBot = null;
        return;
    }

    try {
        const TelegramBot = require('node-telegram-bot-api');
        telegramBot = new TelegramBot(siteSettings.telegramBotToken, { polling: true });

        telegramBot.onText(/\/start(.*)/, async (msg, match) => {
            const chatId         = msg.chat.id;
            const telegramUserId = msg.from.id;
            const telegramUsername = msg.from.username || null;
            const code = match[1] ? match[1].trim() : '';

            if (code) {
                try {
                    const user = await dbGet('SELECT * FROM users WHERE telegram_code = ?', [code]);
                    if (user) {
                        await dbRun('UPDATE users SET telegram_id = ?, telegram_username = ?, telegram_code = NULL, telegram_verified = 1 WHERE id = ?',
                            [telegramUserId.toString(), telegramUsername, user.id]);
                        saveDatabase();

                        telegramBot.sendMessage(chatId,
                            `✅ Account linked successfully!\n\nHello, ${user.full_name}! You will now receive notifications from Yamato in this chat.`
                        );

                        // Lazy require to avoid circular dependency
                        const { getIo } = require('../socket');
                        getIo()?.to(`user_${user.id}`).emit('telegram_linked', { success: true });

                        const { createNotification } = require('./notifications');
                        await createNotification(user.id, 'system', 'Telegram Linked',
                            'Your Telegram account has been successfully linked to Yamato', '📱');
                    } else {
                        telegramBot.sendMessage(chatId, '❌ Invalid or expired code. Please generate a new code on the website.');
                    }
                } catch (err) {
                    console.error('Telegram link error:', err);
                    telegramBot.sendMessage(chatId, '❌ Link failed. Please try again later.');
                }
            } else {
                telegramBot.sendMessage(chatId,
                    `👋 Welcome to Yamato Bot!\n\n` +
                    `This bot sends notifications from your Yamato account.\n\n` +
                    `To link your account:\n` +
                    `1. Go to Profile on the website\n` +
                    `2. Click "Link Telegram"\n` +
                    `3. Use the generated code\n\n` +
                    `📊 Yamato Trading Platform`
                );
            }
        });

        telegramBot.onText(/\/status/, async (msg) => {
            const chatId         = msg.chat.id;
            const telegramUserId = msg.from.id;

            const user = await dbGet('SELECT * FROM users WHERE telegram_id = ?', [telegramUserId.toString()]);
            if (user) {
                const balance = user.active_account === 'demo' ? user.demo_balance : user.real_balance;
                telegramBot.sendMessage(chatId,
                    `📊 Account Status\n\n` +
                    `👤 ${user.full_name}\n` +
                    `📧 ${user.email}\n` +
                    `💰 Balance: $${balance.toFixed(2)} (${user.active_account})\n` +
                    `📅 Subscription: ${user.subscription_plan || 'free'}`
                );
            } else {
                telegramBot.sendMessage(chatId, '❌ Your Telegram is not linked to any account.');
            }
        });

        telegramBot.onText(/\/unlink/, async (msg) => {
            const chatId         = msg.chat.id;
            const telegramUserId = msg.from.id;

            const user = await dbGet('SELECT * FROM users WHERE telegram_id = ?', [telegramUserId.toString()]);
            if (user) {
                await dbRun('UPDATE users SET telegram_id = NULL, telegram_verified = 0 WHERE id = ?', [user.id]);
                saveDatabase();
                telegramBot.sendMessage(chatId, '✅ Telegram has been unlinked from your account.');

                const { getIo } = require('../socket');
                getIo()?.to(`user_${user.id}`).emit('telegram_unlinked', { success: true });
            } else {
                telegramBot.sendMessage(chatId, '❌ Your Telegram is not linked to any account.');
            }
        });

        telegramBot.onText(/\/help/, async (msg) => {
            const chatId = msg.chat.id;
            telegramBot.sendMessage(chatId,
                `📚 *Available Commands*\n\n` +
                `/start - Link your Yamato account\n` +
                `/status - View account status & balance\n` +
                `/verify - Verify your phone number\n` +
                `/unlink - Unlink Telegram from account\n` +
                `/help - Show this help message\n\n` +
                `📊 Yamato Trading Platform`,
                { parse_mode: 'Markdown' }
            );
        });

        telegramBot.onText(/\/verify/, async (msg) => {
            const chatId         = msg.chat.id;
            const telegramUserId = msg.from.id;

            const user = await dbGet('SELECT * FROM users WHERE telegram_id = ?', [telegramUserId.toString()]);
            if (user) {
                telegramBot.sendMessage(chatId,
                    '📱 Phone Verification\n\n' +
                    'To verify your phone number, please share your contact using the button below.',
                    {
                        reply_markup: {
                            keyboard: [[{ text: '📞 Share my phone number', request_contact: true }]],
                            resize_keyboard: true,
                            one_time_keyboard: true
                        }
                    }
                );
            } else {
                telegramBot.sendMessage(chatId, '❌ Your Telegram is not linked to any account. Link it first using /start');
            }
        });

        telegramBot.on('contact', async (msg) => {
            const chatId         = msg.chat.id;
            const telegramUserId = msg.from.id;
            const contact        = msg.contact;

            if (contact.user_id !== telegramUserId) {
                telegramBot.sendMessage(chatId, '❌ Please share your own contact, not someone else\'s.', {
                    reply_markup: { remove_keyboard: true }
                });
                return;
            }

            const user = await dbGet('SELECT * FROM users WHERE telegram_id = ?', [telegramUserId.toString()]);
            if (user) {
                let phone = contact.phone_number;
                if (!phone.startsWith('+')) phone = '+' + phone;

                await dbRun('UPDATE users SET phone = ?, is_verified = 1 WHERE id = ?', [phone, user.id]);
                saveDatabase();

                telegramBot.sendMessage(chatId,
                    `✅ Phone verified successfully!\n\n` +
                    `📞 Your number: ${phone}\n\n` +
                    `Your account is now verified.`,
                    { reply_markup: { remove_keyboard: true } }
                );

                const { getIo } = require('../socket');
                getIo()?.to(`user_${user.id}`).emit('phone_verified', { phone });

                const { createNotification } = require('./notifications');
                await createNotification(user.id, 'system', 'Phone Verified',
                    'Your phone number has been verified via Telegram', '✅');
            } else {
                telegramBot.sendMessage(chatId, '❌ Your Telegram is not linked to any account.', {
                    reply_markup: { remove_keyboard: true }
                });
            }
        });

        // Suppress Telegram 409 spam: happens briefly on server restart when two
        // instances race. The old one dies within ~30s and polling resumes normally.
        let lastPollingError = 0;
        telegramBot.on('polling_error', (err) => {
            const msg = err.message || String(err);
            if (msg.includes('409')) return; // old instance still active — will resolve itself
            const now = Date.now();
            if (now - lastPollingError > 30_000) { // log at most once per 30 s
                lastPollingError = now;
                console.error('[Telegram] Polling error:', msg);
            }
        });

        console.log('✅ Telegram bot initialized successfully');

        const botInfo = await telegramBot.getMe();
        siteSettings.telegramBotUsername = botInfo.username;
        saveSettings();
        console.log(`   Bot username: @${botInfo.username}`);

    } catch (err) {
        console.error('Failed to initialize Telegram bot:', err.message);
        telegramBot = null;
    }
}

async function sendTelegramNotification(userId, title, message, icon = '') {
    if (!telegramBot) return false;

    try {
        const user = await dbGet('SELECT telegram_id, telegram_verified FROM users WHERE id = ?', [userId]);
        if (!user || !user.telegram_id || !user.telegram_verified) return false;

        const text = `${icon} *${title}*\n\n${message}`;
        await telegramBot.sendMessage(user.telegram_id, text, { parse_mode: 'Markdown' });
        return true;
    } catch (err) {
        console.error('Telegram notification error:', err.message);
        return false;
    }
}

function getTelegramBot() { return telegramBot; }

module.exports = { initTelegramBot, sendTelegramNotification, getTelegramBot };
