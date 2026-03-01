'use strict';
const { siteSettings } = require('../config');

let transporter = null;

/**
 * Initialize the email transporter.
 * Falls back to console logging if SMTP is not configured.
 */
function initEmail() {
    const { smtpHost, smtpPort, smtpUser, smtpPass } = siteSettings;

    if (!smtpHost || !smtpUser || !smtpPass) {
        console.log('[Email] SMTP not configured — emails will be logged to console');
        return;
    }

    try {
        const nodemailer = require('nodemailer');
        transporter = nodemailer.createTransport({
            host: smtpHost,
            port: smtpPort || 587,
            secure: (smtpPort || 587) === 465,
            auth: {
                user: smtpUser,
                pass: smtpPass,
            },
        });
        console.log(`[Email] SMTP configured: ${smtpHost}:${smtpPort || 587}`);
    } catch (err) {
        console.error('[Email] Failed to initialize SMTP transport:', err.message);
    }
}

/**
 * Send an email. Logs to console if SMTP is not configured.
 * @param {string} to - Recipient email address
 * @param {string} subject - Email subject
 * @param {string} html - Email body (HTML)
 * @returns {Promise<boolean>} - Whether the email was sent successfully
 */
async function sendEmail(to, subject, html) {
    const from = siteSettings.smtpFrom || siteSettings.smtpUser || 'noreply@yamato.com';

    if (!transporter) {
        console.log(`[Email] (console) To: ${to} | Subject: ${subject}`);
        console.log(`[Email] (console) Body:\n${html}\n`);
        return true;
    }

    try {
        await transporter.sendMail({ from, to, subject, html });
        console.log(`[Email] Sent to ${to}: ${subject}`);
        return true;
    } catch (err) {
        console.error(`[Email] Failed to send to ${to}:`, err.message);
        return false;
    }
}

/**
 * Send a password reset email.
 */
async function sendPasswordResetEmail(to, resetUrl) {
    const subject = 'Yamato — Скидання пароля';
    const html = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
            <h1 style="color: #10B981; margin-bottom: 20px;">Yamato</h1>
            <h2 style="margin-bottom: 16px;">Скидання пароля</h2>
            <p style="color: #666; margin-bottom: 24px;">
                Ви запросили скидання пароля для вашого акаунту Yamato.
                Натисніть кнопку нижче, щоб встановити новий пароль.
            </p>
            <a href="${resetUrl}" style="display: inline-block; padding: 14px 32px; background: #10B981; color: white; text-decoration: none; border-radius: 8px; font-weight: 600;">
                Скинути пароль
            </a>
            <p style="color: #999; margin-top: 24px; font-size: 13px;">
                Якщо ви не запитували скидання пароля, просто проігноруйте цей лист.
                Посилання діє протягом 1 години.
            </p>
        </div>
    `;
    return sendEmail(to, subject, html);
}

/**
 * Send an email verification email.
 */
async function sendVerificationEmail(to, verifyUrl) {
    const subject = 'Yamato — Підтвердження email';
    const html = `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 40px 20px;">
            <h1 style="color: #10B981; margin-bottom: 20px;">Yamato</h1>
            <h2 style="margin-bottom: 16px;">Підтвердіть вашу email адресу</h2>
            <p style="color: #666; margin-bottom: 24px;">
                Дякуємо за реєстрацію на Yamato!
                Натисніть кнопку нижче, щоб підтвердити вашу email адресу.
            </p>
            <a href="${verifyUrl}" style="display: inline-block; padding: 14px 32px; background: #10B981; color: white; text-decoration: none; border-radius: 8px; font-weight: 600;">
                Підтвердити email
            </a>
            <p style="color: #999; margin-top: 24px; font-size: 13px;">
                Якщо ви не реєструвалися на Yamato, просто проігноруйте цей лист.
                Посилання діє протягом 24 годин.
            </p>
        </div>
    `;
    return sendEmail(to, subject, html);
}

module.exports = { initEmail, sendEmail, sendPasswordResetEmail, sendVerificationEmail };
