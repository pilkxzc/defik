'use strict';
const path = require('path');
const fs   = require('fs');

const PORT       = process.env.PORT       || 3000;
const HTTPS_PORT = process.env.HTTPS_PORT || 3443;
const HOST       = process.env.HOST       || '0.0.0.0';

const ADMIN_EMAIL   = 'gerbera.uh@gmail.com';
const DB_PATH       = path.join(__dirname, '..', 'database.sqlite');
const SESSIONS_PATH = path.join(__dirname, '..', 'sessions.json');
const SETTINGS_PATH = path.join(__dirname, '..', 'settings.json');
const SSL_KEY_PATH  = path.join(__dirname, '..', 'ssl', 'key.pem');
const SSL_CERT_PATH = path.join(__dirname, '..', 'ssl', 'cert.pem');

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
    PORT, HTTPS_PORT, HOST,
    ADMIN_EMAIL,
    DB_PATH, SESSIONS_PATH, SETTINGS_PATH, SSL_KEY_PATH, SSL_CERT_PATH,
    siteSettings,
    loadSettings,
    saveSettings,
};
