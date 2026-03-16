'use strict';

/**
 * AES-256-GCM encryption/decryption for sensitive fields (Binance API keys).
 *
 * Encrypted values are stored as: enc:<iv>:<authTag>:<ciphertext>
 * This prefix allows distinguishing encrypted from legacy plaintext values.
 *
 * IMPORTANT: migrateEncryptKeys() should be called AFTER database initialization
 * (after initDatabase() in server/db/index.js completes) to encrypt any existing
 * plaintext API keys in the bots and bot_subscribers tables.
 */

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;       // 128-bit IV for GCM
const AUTH_TAG_LENGTH = 16;  // 128-bit auth tag
const ENC_PREFIX = 'enc:';

// Derive a 32-byte key from the ENCRYPTION_KEY env var using SHA-256
let _derivedKey = null;

function getEncryptionKey() {
    if (_derivedKey) return _derivedKey;

    let rawKey = process.env.ENCRYPTION_KEY;

    if (!rawKey) {
        // Try to load from .env file
        const envPath = path.join(__dirname, '..', '..', '.env');
        if (fs.existsSync(envPath)) {
            const envContent = fs.readFileSync(envPath, 'utf8');
            const match = envContent.match(/^ENCRYPTION_KEY=(.+)$/m);
            if (match) rawKey = match[1].trim();
        }
    }

    if (!rawKey) {
        // Generate a random key, save to .env, and warn
        rawKey = crypto.randomBytes(32).toString('hex');
        const envPath = path.join(__dirname, '..', '..', '.env');
        console.warn('========================================================');
        console.warn('WARNING: ENCRYPTION_KEY not set in environment variables.');
        console.warn('A random key has been generated and saved to .env');
        console.warn('BACK UP THIS KEY! Without it, encrypted data is unrecoverable.');
        console.warn('========================================================');

        try {
            let envContent = '';
            if (fs.existsSync(envPath)) {
                envContent = fs.readFileSync(envPath, 'utf8');
            }
            // Append the key
            const separator = envContent && !envContent.endsWith('\n') ? '\n' : '';
            fs.writeFileSync(envPath, envContent + separator + `ENCRYPTION_KEY=${rawKey}\n`);
            // Also set in current process so subsequent reads work
            process.env.ENCRYPTION_KEY = rawKey;
        } catch (err) {
            console.error('Failed to save ENCRYPTION_KEY to .env:', err.message);
            console.error('Set ENCRYPTION_KEY manually in your .env file.');
            // Still use the generated key for this session
            process.env.ENCRYPTION_KEY = rawKey;
        }
    }

    // Derive a fixed 32-byte key using SHA-256
    _derivedKey = crypto.createHash('sha256').update(rawKey).digest();
    return _derivedKey;
}

/**
 * Encrypt a plaintext string using AES-256-GCM.
 * Returns format: enc:<iv>:<authTag>:<ciphertext> (all hex-encoded)
 * Returns null/undefined/empty as-is.
 */
function encryptField(plaintext) {
    if (!plaintext || typeof plaintext !== 'string' || plaintext.trim() === '') {
        return plaintext;
    }

    // Already encrypted -- do not double-encrypt
    if (plaintext.startsWith(ENC_PREFIX)) {
        return plaintext;
    }

    const key = getEncryptionKey();
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });

    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');

    return `${ENC_PREFIX}${iv.toString('hex')}:${authTag}:${encrypted}`;
}

/**
 * Decrypt a field encrypted with encryptField().
 * If the value does not start with 'enc:', it is treated as legacy plaintext and returned as-is.
 * Returns null/undefined/empty as-is.
 */
function decryptField(encrypted) {
    if (!encrypted || typeof encrypted !== 'string' || encrypted.trim() === '') {
        return encrypted;
    }

    // Not encrypted (legacy plaintext) -- return as-is
    if (!encrypted.startsWith(ENC_PREFIX)) {
        return encrypted;
    }

    try {
        const key = getEncryptionKey();
        // Format: enc:<iv>:<authTag>:<ciphertext>
        const withoutPrefix = encrypted.slice(ENC_PREFIX.length);
        const parts = withoutPrefix.split(':');
        if (parts.length !== 3) {
            console.error('Invalid encrypted field format (expected 3 parts after prefix)');
            return encrypted; // Return raw to avoid data loss
        }

        const [ivHex, authTagHex, ciphertext] = parts;
        const iv = Buffer.from(ivHex, 'hex');
        const authTag = Buffer.from(authTagHex, 'hex');

        const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
        decipher.setAuthTag(authTag);

        let decrypted = decipher.update(ciphertext, 'hex', 'utf8');
        decrypted += decipher.final('utf8');

        return decrypted;
    } catch (err) {
        console.error('Decryption failed:', err.message);
        // Return the raw value to avoid breaking the application
        // This can happen if the ENCRYPTION_KEY changed
        return encrypted;
    }
}

/**
 * Mask an API key for safe display to clients.
 * Shows first 8 chars + '...' + last 6 chars, or '***' if too short.
 */
function maskApiKey(key) {
    if (!key || typeof key !== 'string') return '***';
    // Decrypt first if encrypted, so we mask the actual key
    const plain = decryptField(key);
    if (!plain || plain.length < 16) return '***';
    return plain.slice(0, 8) + '...' + plain.slice(-6);
}

/**
 * Migrate existing plaintext API keys in the database to encrypted form.
 * Should be called once on server startup after initDatabase().
 *
 * This function:
 * 1. Selects all bots with non-null binance_api_key
 * 2. For each: if value doesn't start with 'enc:', encrypts and UPDATEs
 * 3. Does the same for bot_subscribers.user_binance_api_key/user_binance_api_secret
 * 4. Also encrypts multi_credentials (tk/tk_secret) stored in trading_settings JSON
 * 5. Logs how many keys were migrated
 */
async function migrateEncryptKeys() {
    // Lazy-require to avoid circular dependency issues at module load time
    const { dbAll, dbRun } = require('../db');

    console.log('[crypto] Starting API key encryption migration check...');
    let migratedBots = 0;
    let migratedSubs = 0;
    let migratedMulti = 0;

    // 1. Migrate bots table: binance_api_key and binance_api_secret
    const bots = dbAll(
        "SELECT id, binance_api_key, binance_api_secret FROM bots WHERE binance_api_key IS NOT NULL AND binance_api_key != ''"
    );

    for (const bot of bots) {
        let needsUpdate = false;
        let encKey = bot.binance_api_key;
        let encSecret = bot.binance_api_secret;

        if (encKey && !encKey.startsWith(ENC_PREFIX)) {
            encKey = encryptField(encKey);
            needsUpdate = true;
        }
        if (encSecret && !encSecret.startsWith(ENC_PREFIX)) {
            encSecret = encryptField(encSecret);
            needsUpdate = true;
        }

        if (needsUpdate) {
            dbRun('UPDATE bots SET binance_api_key = ?, binance_api_secret = ? WHERE id = ?',
                [encKey, encSecret, bot.id]);
            migratedBots++;
        }
    }

    // 2. Migrate bot_subscribers table: user_binance_api_key and user_binance_api_secret
    const subs = dbAll(
        "SELECT id, user_binance_api_key, user_binance_api_secret FROM bot_subscribers WHERE user_binance_api_key IS NOT NULL AND user_binance_api_key != ''"
    );

    for (const sub of subs) {
        let needsUpdate = false;
        let encKey = sub.user_binance_api_key;
        let encSecret = sub.user_binance_api_secret;

        if (encKey && !encKey.startsWith(ENC_PREFIX)) {
            encKey = encryptField(encKey);
            needsUpdate = true;
        }
        if (encSecret && !encSecret.startsWith(ENC_PREFIX)) {
            encSecret = encryptField(encSecret);
            needsUpdate = true;
        }

        if (needsUpdate) {
            dbRun('UPDATE bot_subscribers SET user_binance_api_key = ?, user_binance_api_secret = ? WHERE id = ?',
                [encKey, encSecret, sub.id]);
            migratedSubs++;
        }
    }

    // 3. Migrate multi_credentials in trading_settings JSON
    const botsWithMulti = dbAll(
        "SELECT id, trading_settings FROM bots WHERE trading_settings LIKE '%multi_credentials%'"
    );

    for (const bot of botsWithMulti) {
        try {
            const settings = JSON.parse(bot.trading_settings || '{}');
            if (!settings.multi_credentials || !Array.isArray(settings.multi_credentials)) continue;

            let changed = false;
            settings.multi_credentials = settings.multi_credentials.map(c => {
                let tk = c.tk;
                let tkSecret = c.tk_secret;

                if (tk && !tk.startsWith(ENC_PREFIX)) {
                    tk = encryptField(tk);
                    changed = true;
                }
                if (tkSecret && !tkSecret.startsWith(ENC_PREFIX)) {
                    tkSecret = encryptField(tkSecret);
                    changed = true;
                }

                return { ...c, tk, tk_secret: tkSecret };
            });

            if (changed) {
                dbRun('UPDATE bots SET trading_settings = ? WHERE id = ?',
                    [JSON.stringify(settings), bot.id]);
                migratedMulti++;
            }
        } catch (e) {
            console.error(`[crypto] Failed to migrate multi_credentials for bot ${bot.id}:`, e.message);
        }
    }

    const total = migratedBots + migratedSubs + migratedMulti;
    if (total > 0) {
        console.log(`[crypto] Migration complete: ${migratedBots} bots, ${migratedSubs} subscribers, ${migratedMulti} multi-account configs encrypted.`);
    } else {
        console.log('[crypto] No plaintext API keys found -- all keys are already encrypted or empty.');
    }
}

module.exports = {
    encryptField,
    decryptField,
    maskApiKey,
    migrateEncryptKeys,
};
