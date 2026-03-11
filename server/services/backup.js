'use strict';
const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const { google } = require('googleapis');
const cron = require('node-cron');

const { DB_PATH, SESSIONS_PATH, SETTINGS_PATH, siteSettings, saveSettings } = require('../config');
const { dbRun, dbGet } = require('../db');
const { getLocalTime } = require('../utils/time');

let cronJob = null;

function getOAuth2Client() {
    const { googleClientId, googleClientSecret } = siteSettings;
    if (!googleClientId || !googleClientSecret) return null;

    const oauth2Client = new google.auth.OAuth2(
        googleClientId,
        googleClientSecret,
        `${getBaseUrl()}/api/admin/backup/google/callback`
    );

    if (siteSettings.googleDriveTokens) {
        oauth2Client.setCredentials(siteSettings.googleDriveTokens);

        // Save refreshed tokens automatically when Google refreshes the access_token
        oauth2Client.on('tokens', (tokens) => {
            console.log('[Backup] Google OAuth tokens refreshed');
            // Merge new tokens (Google may or may not return a new refresh_token)
            siteSettings.googleDriveTokens = {
                ...siteSettings.googleDriveTokens,
                ...tokens
            };
            saveSettings();
        });
    }

    return oauth2Client;
}

function getBaseUrl() {
    // In production use the actual domain
    return process.env.BASE_URL || 'https://tradingarena.space';
}

async function createBackupArchive() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `yamato-backup-${timestamp}.tar.gz`;
    const tmpDir = path.join(__dirname, '..', 'tmp');

    if (!fs.existsSync(tmpDir)) {
        fs.mkdirSync(tmpDir, { recursive: true });
    }

    const outputPath = path.join(tmpDir, filename);
    const output = fs.createWriteStream(outputPath);
    const archive = archiver('tar', { gzip: true });

    return new Promise((resolve, reject) => {
        output.on('close', () => {
            resolve({ path: outputPath, filename, size: archive.pointer() });
        });

        archive.on('error', reject);
        archive.pipe(output);

        if (fs.existsSync(DB_PATH)) {
            archive.file(DB_PATH, { name: 'database.sqlite' });
        }
        if (fs.existsSync(SESSIONS_PATH)) {
            archive.file(SESSIONS_PATH, { name: 'sessions.json' });
        }
        if (fs.existsSync(SETTINGS_PATH)) {
            archive.file(SETTINGS_PATH, { name: 'settings.json' });
        }
        // Candles DB (market data)
        const candlesPath = path.join(path.dirname(DB_PATH), 'candles.sqlite');
        if (fs.existsSync(candlesPath)) {
            archive.file(candlesPath, { name: 'candles.sqlite' });
        }
        // SSL certificates
        const sslDir = path.join(path.dirname(DB_PATH), 'ssl');
        if (fs.existsSync(sslDir)) {
            archive.directory(sslDir, 'ssl');
        }
        // Uploads (avatars, bug reports, etc.)
        const uploadsDir = path.join(path.dirname(DB_PATH), '..', 'uploads');
        if (fs.existsSync(uploadsDir)) {
            archive.directory(uploadsDir, 'uploads');
        }

        archive.finalize();
    });
}

async function uploadToDrive(filePath, filename) {
    const auth = getOAuth2Client();
    if (!auth || !siteSettings.googleDriveTokens) {
        throw new Error('Google Drive not connected');
    }

    const drive = google.drive({ version: 'v3', auth });

    const fileMetadata = { name: filename };
    if (siteSettings.googleDriveBackupFolderId) {
        fileMetadata.parents = [siteSettings.googleDriveBackupFolderId];
    }

    const media = {
        mimeType: 'application/gzip',
        body: fs.createReadStream(filePath)
    };

    const res = await drive.files.create({
        requestBody: fileMetadata,
        media,
        fields: 'id, name, size'
    });

    return res.data;
}

async function performBackup(triggeredBy = 'manual') {
    const record = dbRun(
        'INSERT INTO backup_history (filename, status, triggered_by, created_at) VALUES (?, ?, ?, ?)',
        ['pending...', 'in_progress', triggeredBy, getLocalTime()]
    );
    const backupId = record.lastInsertRowid;

    try {
        const { path: archivePath, filename, size } = await createBackupArchive();

        const driveFile = await uploadToDrive(archivePath, filename);

        dbRun(
            'UPDATE backup_history SET filename = ?, size_bytes = ?, drive_file_id = ?, status = ?, completed_at = ? WHERE id = ?',
            [filename, size, driveFile.id, 'success', getLocalTime(), backupId]
        );

        // Cleanup temp file
        try { fs.unlinkSync(archivePath); } catch(e) {}

        return { success: true, filename, size, driveFileId: driveFile.id };
    } catch (error) {
        const errMsg = error.message || String(error);
        dbRun(
            'UPDATE backup_history SET status = ?, error_message = ?, completed_at = ? WHERE id = ?',
            ['failed', errMsg, getLocalTime(), backupId]
        );

        // If refresh token is invalid, clear stored tokens so admin knows to re-authorize
        if (errMsg.includes('invalid_grant') || errMsg.includes('Token has been expired or revoked')) {
            console.error('[Backup] Google OAuth refresh token is invalid — clearing stored tokens. Re-authorize in Admin > Backup.');
            siteSettings.googleDriveTokens = null;
            siteSettings.googleDriveBackupEnabled = false;
            saveSettings();
            stopBackupSchedule();
        }

        throw error;
    }
}

function startBackupSchedule() {
    stopBackupSchedule();

    if (!siteSettings.googleDriveBackupEnabled || !siteSettings.googleDriveTokens) {
        return;
    }

    const time = siteSettings.googleDriveBackupTime || '03:00';
    const [hours, minutes] = time.split(':').map(Number);

    // Validate
    if (isNaN(hours) || isNaN(minutes)) return;

    const cronExpr = `${minutes} ${hours} * * *`;

    cronJob = cron.schedule(cronExpr, async () => {
        console.log('[Backup] Starting scheduled backup...');
        try {
            const result = await performBackup('scheduled');
            console.log(`[Backup] Scheduled backup completed: ${result.filename}`);
            const { notifyAdmins } = require('./telegram');
            notifyAdmins('Бекап завершено', `Файл: \`${result.filename}\`\nРозмір: ${Math.round(result.size / 1024)} KB`, '✅');
        } catch (error) {
            console.error('[Backup] Scheduled backup failed:', error.message);
            const { notifyAdmins } = require('./telegram');
            notifyAdmins('Бекап провалився!', `Автоматичний бекап не вдалося створити.\n\nПомилка: ${error.message}`, '🚨');
        }
    });

    console.log(`[Backup] Schedule set for ${time} daily`);
}

function stopBackupSchedule() {
    if (cronJob) {
        cronJob.stop();
        cronJob = null;
    }
}

module.exports = {
    getOAuth2Client,
    getBaseUrl,
    createBackupArchive,
    uploadToDrive,
    performBackup,
    startBackupSchedule,
    stopBackupSchedule
};
