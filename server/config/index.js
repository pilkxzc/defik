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
const EMERGENCY_KEY    = process.env.EMERGENCY_KEY     || 'yamato-emergency-2026';
const BCRYPT_ROUNDS    = parseInt(process.env.BCRYPT_ROUNDS, 10) || 12;
const ENCRYPTION_KEY   = process.env.ENCRYPTION_KEY || '';
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
    smtpFrom:              'noreply@yamato.com',
    googleClientId:        '',
    googleClientSecret:    '',
    googleOAuthEnabled:    false,
    googleDriveTokens:     null,
    googleDriveBackupEnabled: false,
    googleDriveBackupTime: '03:00',
    googleDriveBackupFolderId: '',
    bugReportingEnabled: false,
    bugReportingAdminChatId: '',
    dbAccessKey: ''
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

function validateProductionConfig() {
    const warnings = [];
    const errors = [];

    if (SESSION_SECRET === 'yamato-dev-secret-change-me') {
        if (process.env.NODE_ENV === 'production') {
            errors.push('SESSION_SECRET must be set in production!');
        } else {
            warnings.push('SESSION_SECRET using default dev value');
        }
    }

    if (!process.env.ENCRYPTION_KEY) {
        warnings.push('ENCRYPTION_KEY not set -- API keys will not be encrypted');
    }

    warnings.forEach(w => console.warn(`[CONFIG WARNING] ${w}`));
    if (errors.length > 0) {
        errors.forEach(e => console.error(`[CONFIG ERROR] ${e}`));
        console.error('Fix the above errors before running in production.');
        process.exit(1);
    }
}

module.exports = {
    PORT, HTTPS_PORT, HOST, NODE_ENV,
    ADMIN_EMAIL, SESSION_SECRET, EMERGENCY_KEY, BCRYPT_ROUNDS, ENCRYPTION_KEY,
    DB_PATH, SESSIONS_PATH, SETTINGS_PATH, SSL_KEY_PATH, SSL_CERT_PATH,
    siteSettings,
    loadSettings,
    saveSettings,
    validateProductionConfig,
};
