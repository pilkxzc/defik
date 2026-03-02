'use strict';
const path = require('path');
const fs   = require('fs');

// Load .env from project root (two levels up from server/config/)
require('dotenv').config({ path: path.join(__dirname, '..', '..', '.env') });

const PORT       = process.env.PORT       || 3000;
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;
const HOST       = process.env.HOST       || '0.0.0.0';
const NODE_ENV   = process.env.NODE_ENV   || 'development';

const ADMIN_EMAIL      = process.env.ADMIN_EMAIL      || 'gerbera.uh@gmail.com';
const SESSION_SECRET   = process.env.SESSION_SECRET    || 'yamato-dev-secret-change-me';
const BCRYPT_ROUNDS    = parseInt(process.env.BCRYPT_ROUNDS, 10) || 12;
const DB_PATH          = process.env.DB_PATH       || path.join(__dirname, '..', 'database.sqlite');
const SESSIONS_PATH    = process.env.SESSIONS_PATH || path.join(__dirname, '..', 'sessions.json');
const SETTINGS_PATH    = process.env.SETTINGS_PATH || path.join(__dirname, '..', 'settings.json');
const SSL_KEY_PATH     = process.env.SSL_KEY_PATH  || path.join(__dirname, '..', 'ssl', 'key.pem');
const SSL_CERT_PATH    = process.env.SSL_CERT_PATH || path.join(__dirname, '..', 'ssl', 'cert.pem');

// Mutable reference — all modules share the same object
const siteSettings = {
    maintenanceMode:       false,
    maintenanceMessage:    'Site is temporarily unavailable. Maintenance in progress.',
    maintenanceEnabledBy:  null,
    maintenanceEnabledAt:  null,
    telegramBotToken:      '',
    telegramBotEnabled:    false,
    telegramBotUsername:   '',
    smtpHost:              '',
    smtpPort:              587,
    smtpUser:              '',
    smtpPass:              '',
    smtpFrom:              'noreply@yamato.com'
};

function loadSettings() {
    try {
        if (fs.existsSync(SETTINGS_PATH)) {
            const data = fs.readFileSync(SETTINGS_PATH, 'utf8');
            Object.assign(siteSettings, JSON.parse(data));
        }
    } catch (err) {
        console.log('Creating new settings file');
    }
}

function saveSettings() {
    try {
        fs.writeFileSync(SETTINGS_PATH, JSON.stringify(siteSettings, null, 2));
    } catch (err) {
        console.error('Error saving settings:', err);
    }
}

module.exports = {
    PORT, HTTPS_PORT, HOST, NODE_ENV,
    ADMIN_EMAIL, SESSION_SECRET, BCRYPT_ROUNDS,
    DB_PATH, SESSIONS_PATH, SETTINGS_PATH, SSL_KEY_PATH, SSL_CERT_PATH,
    siteSettings,
    loadSettings,
    saveSettings,
};
