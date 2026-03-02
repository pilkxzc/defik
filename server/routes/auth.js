'use strict';
const express  = require('express');
const bcrypt   = require('bcryptjs');
const speakeasy = require('speakeasy');
const QRCode   = require('qrcode');
const crypto   = require('crypto');
const router   = express.Router();

const { dbGet, dbRun, dbAll } = require('../db');
const { ADMIN_EMAIL }         = require('../config');
const { getClientIP }         = require('../utils/ip');
const { getLocalTime }        = require('../utils/time');
const { requireAuth }         = require('../middleware/auth');
const { recordLoginAttempt, getFailedAttempts, isAccountLocked, getProgressiveDelay } = require('../utils/bruteForce');

// Lazy to avoid circular dep
function createNotification(...args) {
    return require('../services/notifications').createNotification(...args);
}

// ==================== AUTH ROUTES ====================

router.post('/api/auth/register', async (req, res) => {
    try {
        const { email, password, fullName, phone } = req.body;

        if (!email || !password || !fullName) {
            return res.status(400).json({ error: 'Email, password and full name are required' });
        }

        const normalizedEmail = email.toLowerCase().trim();
        const existingUser = dbGet('SELECT id FROM users WHERE LOWER(email) = LOWER(?)', [normalizedEmail]);
        if (existingUser) {
            return res.status(400).json({ error: 'Email already registered' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const role = normalizedEmail === ADMIN_EMAIL.toLowerCase() ? 'admin' : 'user';

        const result = dbRun(
            'INSERT INTO users (email, password, full_name, phone, balance, demo_balance, real_balance, active_account, role) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [normalizedEmail, hashedPassword, fullName, phone || null, 0, 10000, 0, 'demo', role]
        );

        const userId = result.lastInsertRowid;
        console.log(`[register] New user inserted, userId=${userId} (type=${typeof userId}), email=${normalizedEmail}`);

        if (!userId) {
            console.error('[register] dbRun returned null/undefined userId — INSERT failed silently');
            return res.status(500).json({ error: 'Registration failed: could not create user' });
        }

        dbRun(
            'INSERT INTO activity_log (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [userId, 'Account Created', 'New account registration', getClientIP(req)]
        );

        createNotification(userId, 'system', 'Welcome to Yamato!', 'Thank you for registering. Wishing you successful trading!');

        // Send verification email
        try {
            const verToken = crypto.randomBytes(32).toString('hex');
            const verExpires = new Date(Date.now() + 86400000).toISOString();
            dbRun('INSERT INTO email_verification_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
                [userId, verToken, verExpires]);
            const { sendVerificationEmail } = require('../services/email');
            const verifyUrl = `${req.protocol}://${req.get('host')}/verify-email?token=${verToken}`;
            sendVerificationEmail(normalizedEmail, verifyUrl);
        } catch (emailErr) {
            console.log('[Auth] Verification email not sent:', emailErr.message);
        }

        req.session.userId = userId;
        req.session.betaAccess = true;
        req.session._ip = getClientIP(req);
        req.session._ua = req.headers['user-agent'] || '';
        req.session._createdAt = new Date().toISOString();
        req.session._loginMethod = 'register';
        console.log(`[register] Session ${req.session.id?.substring(0,8)}... userId set to ${req.session.userId}, saving...`);

        req.session.save((err) => {
            if (err) {
                console.error('[register] Session save error:', err);
                return res.status(500).json({ error: 'Session error' });
            }
            console.log(`[register] Session saved OK for userId=${userId}`);
            res.json({
                success: true,
                message: 'Registration successful',
                user: { id: userId, email: normalizedEmail, fullName, balance: 10000, demoBalance: 10000, realBalance: 0, activeAccount: 'demo' }
            });
        });
    } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Registration failed' });
    }
});

router.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password, totpToken } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        const normalizedEmail = email.trim().toLowerCase();
        const clientIP = getClientIP(req);

        // Check if account is locked due to too many failed attempts
        const locked = await isAccountLocked(normalizedEmail);
        if (locked) {
            return res.status(403).json({
                error: 'Акаунт тимчасово заблоковано через надто багато невдалих спроб входу. Спробуйте через 15 хвилин.',
                locked: true
            });
        }

        const user = dbGet('SELECT * FROM users WHERE LOWER(email) = LOWER(?)', [normalizedEmail]);
        if (!user) {
            // Get failed attempts for progressive delay
            const failedCount = await getFailedAttempts(normalizedEmail);

            // Apply progressive delay
            await getProgressiveDelay(failedCount);

            // Record failed attempt
            await recordLoginAttempt(clientIP, normalizedEmail, false);

            return res.status(401).json({ error: 'Invalid credentials' });
        }

        if (user.is_banned) {
            return res.status(403).json({ error: 'Account banned', reason: user.ban_reason || 'Your account has been banned', banned: true });
        }

        // Get failed attempts before password validation
        const failedCount = await getFailedAttempts(normalizedEmail);

        const isValid = await bcrypt.compare(password, user.password);
        if (!isValid) {
            // Apply progressive delay before responding
            await getProgressiveDelay(failedCount);

            // Record failed attempt
            await recordLoginAttempt(clientIP, normalizedEmail, false);

            return res.status(401).json({ error: 'Invalid credentials' });
        }

        if (user.totp_enabled) {
            if (!totpToken) {
                return res.json({ requires2FA: true, message: 'Please enter your 2FA code' });
            }

            let verified = speakeasy.totp.verify({
                secret: user.totp_secret, encoding: 'base32', token: totpToken, window: 2
            });

            if (!verified) {
                const backupCodes = JSON.parse(user.backup_codes || '[]');
                const codeIndex = backupCodes.indexOf(totpToken.toUpperCase());
                if (codeIndex !== -1) {
                    verified = true;
                    backupCodes.splice(codeIndex, 1);
                    dbRun('UPDATE users SET backup_codes = ? WHERE id = ?', [JSON.stringify(backupCodes), user.id]);
                }
            }

            if (!verified) {
                // Apply progressive delay for failed 2FA
                await getProgressiveDelay(failedCount);

                // Record failed attempt
                await recordLoginAttempt(clientIP, normalizedEmail, false);

                return res.status(401).json({ error: 'Invalid 2FA code' });
            }
        }

        // Record successful login attempt
        await recordLoginAttempt(clientIP, normalizedEmail, true);

        dbRun('UPDATE users SET last_login = ? WHERE id = ?', [getLocalTime(), user.id]);

        dbRun(
            'INSERT INTO activity_log (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [user.id, 'Successful Login', 'User logged in' + (user.totp_enabled ? ' (2FA verified)' : ''), clientIP]
        );

        createNotification(user.id, 'login', 'New account login', `Login from IP: ${clientIP}`);

        req.session.userId = user.id;
        req.session.betaAccess = true;
        req.session._ip = clientIP;
        req.session._ua = req.headers['user-agent'] || '';
        req.session._createdAt = new Date().toISOString();
        req.session._loginMethod = 'password';

        req.session.save((err) => {
            if (err) {
                console.error('Session save error:', err);
                return res.status(500).json({ error: 'Session error' });
            }
            res.json({
                success: true,
                user: {
                    id: user.id,
                    email: user.email,
                    fullName: user.full_name,
                    balance: user.active_account === 'demo' ? (user.demo_balance || 0) : (user.real_balance || 0),
                    demoBalance: user.demo_balance || 0,
                    realBalance: user.real_balance || 0,
                    activeAccount: user.active_account || 'demo',
                    isVerified: user.is_verified,
                    verificationLevel: user.verification_level
                }
            });
        });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

router.post('/api/auth/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) console.error('Logout session destroy error:', err);
        res.clearCookie('connect.sid');
        res.json({ success: true });
    });
});

router.get('/api/auth/me', requireAuth, (req, res) => {
    const user = dbGet(
        'SELECT id, email, full_name, phone, demo_balance, real_balance, active_account, created_at, is_verified, verification_level, role, avatar FROM users WHERE id = ?',
        [req.session.userId]
    );

    if (!user) return res.status(404).json({ error: 'User not found' });

    const activeBalance = user.active_account === 'demo' ? user.demo_balance : user.real_balance;

    res.json({
        id: user.id, email: user.email, fullName: user.full_name, phone: user.phone,
        balance: activeBalance, demoBalance: user.demo_balance, realBalance: user.real_balance,
        activeAccount: user.active_account || 'demo', createdAt: user.created_at,
        isVerified: user.is_verified, verificationLevel: user.verification_level,
        role: user.role || 'user', avatar: user.avatar || null, currentIP: getClientIP(req)
    });
});

router.get('/api/auth/ip', (req, res) => {
    res.json({ ip: getClientIP(req), timestamp: new Date().toISOString() });
});

router.get('/api/auth/session', requireAuth, (req, res) => {
    const user = dbGet('SELECT last_login FROM users WHERE id = ?', [req.session.userId]);
    const recentActivity = dbAll(
        'SELECT action, details, ip_address, created_at FROM activity_log WHERE user_id = ? ORDER BY created_at DESC LIMIT 10',
        [req.session.userId]
    );
    res.json({ currentIP: getClientIP(req), lastLogin: user?.last_login, recentActivity });
});

// List all active sessions for current user
router.get('/api/auth/sessions', requireAuth, (req, res) => {
    const { sessionStore } = require('../middleware/session');
    const currentSid = req.sessionID;
    const sessions = sessionStore.getByUserId(req.session.userId);
    const requestIP = getClientIP(req);
    const requestUA = req.headers['user-agent'] || '';

    // Backfill metadata for current session if missing
    const currentSession = sessions.find(s => s.sid === currentSid);
    if (currentSession && !currentSession._ip) {
        req.session._ip = requestIP;
        req.session._ua = requestUA;
        req.session._createdAt = req.session._createdAt || new Date().toISOString();
        req.session._loginMethod = req.session._loginMethod || 'password';
        req.session.save(() => {});
    }

    const result = sessions.map(s => {
        const isCurrent = s.sid === currentSid;
        return {
            id: s.sid.substring(0, 8),
            _sid: s.sid,
            ip: s._ip || (isCurrent ? requestIP : 'Unknown'),
            userAgent: s._ua || (isCurrent ? requestUA : ''),
            createdAt: s._createdAt || null,
            loginMethod: s._loginMethod || 'unknown',
            isCurrent,
            expiresAt: s.cookie?.expires || null
        };
    });

    // Sort: current session first, then by creation date desc
    result.sort((a, b) => {
        if (a.isCurrent) return -1;
        if (b.isCurrent) return 1;
        return (b.createdAt || '').localeCompare(a.createdAt || '');
    });

    res.json(result);
});

// Kill a specific session
router.post('/api/auth/sessions/revoke', requireAuth, (req, res) => {
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).json({ error: 'Session ID required' });

    const { sessionStore } = require('../middleware/session');
    const sessions = sessionStore.getByUserId(req.session.userId);

    // Find the session matching the short id
    const target = sessions.find(s => s.sid.substring(0, 8) === sessionId);
    if (!target) return res.status(404).json({ error: 'Session not found' });

    // Don't allow killing current session (use logout instead)
    if (target.sid === req.sessionID) {
        return res.status(400).json({ error: 'Cannot revoke current session. Use logout instead.' });
    }

    sessionStore.destroyById(target.sid);
    res.json({ success: true });
});

// Kill all other sessions
router.post('/api/auth/sessions/revoke-all', requireAuth, (req, res) => {
    const { sessionStore } = require('../middleware/session');
    const sessions = sessionStore.getByUserId(req.session.userId);
    let count = 0;

    sessions.forEach(s => {
        if (s.sid !== req.sessionID) {
            sessionStore.destroyById(s.sid);
            count++;
        }
    });

    res.json({ success: true, revoked: count });
});

router.post('/api/account/switch', requireAuth, (req, res) => {
    const { accountType } = req.body;

    if (accountType !== 'demo' && accountType !== 'real') {
        return res.status(400).json({ error: 'Invalid account type' });
    }

    if (accountType === 'real') {
        return res.status(403).json({ error: 'Real account is not available yet. Coming soon!', disabled: true });
    }

    dbRun('UPDATE users SET active_account = ? WHERE id = ?', [accountType, req.session.userId]);
    const user = dbGet('SELECT demo_balance, real_balance, active_account FROM users WHERE id = ?', [req.session.userId]);
    res.json({ success: true, activeAccount: accountType, balance: accountType === 'demo' ? user.demo_balance : user.real_balance });
});

router.get('/api/account/info', requireAuth, (req, res) => {
    const user = dbGet('SELECT demo_balance, real_balance, active_account, avatar, full_name FROM users WHERE id = ?', [req.session.userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({
        activeAccount: user.active_account || 'demo',
        demoBalance: user.demo_balance || 0,
        realBalance: user.real_balance || 0,
        realAccountEnabled: false,
        avatar: user.avatar || null,
        fullName: user.full_name || ''
    });
});

// ==================== PASSWORD RESET ====================

router.post('/api/auth/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'Email is required' });

        const clientIP = getClientIP(req);
        const normalizedEmail = email.toLowerCase().trim();

        // Check if IP is locked due to too many reset requests
        const locked = await isAccountLocked(clientIP);
        if (locked) {
            return res.status(429).json({
                error: 'Забагато спроб відновлення пароля. Спробуйте через 15 хвилин.',
                locked: true
            });
        }

        // Get failed attempts for progressive delay
        const failedCount = await getFailedAttempts(clientIP);

        // Apply progressive delay to prevent enumeration
        await getProgressiveDelay(failedCount);

        const user = dbGet('SELECT id, email FROM users WHERE LOWER(email) = LOWER(?)', [normalizedEmail]);

        // Record attempt (by IP to prevent enumeration attacks)
        await recordLoginAttempt(clientIP, clientIP, !!user);

        // Always return success to prevent email enumeration
        if (!user) return res.json({ success: true, message: 'If this email exists, a reset link has been sent' });

        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 3600000).toISOString(); // 1 hour

        dbRun('INSERT INTO password_reset_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
            [user.id, token, expiresAt]);

        dbRun('INSERT INTO activity_log (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [user.id, 'Password Reset Requested', 'Password reset email requested', clientIP]);

        // Try to send email
        try {
            const { sendPasswordResetEmail } = require('../services/email');
            const resetUrl = `${req.protocol}://${req.get('host')}/reset-password?token=${token}`;
            await sendPasswordResetEmail(user.email, resetUrl);
        } catch (emailErr) {
            console.log('[Auth] Email not configured, reset token:', token);
        }

        res.json({ success: true, message: 'If this email exists, a reset link has been sent' });
    } catch (error) {
        console.error('Forgot password error:', error);
        res.status(500).json({ error: 'Failed to process request' });
    }
});

router.post('/api/auth/reset-password', async (req, res) => {
    try {
        const { token, newPassword } = req.body;
        if (!token || !newPassword) return res.status(400).json({ error: 'Token and new password are required' });
        if (newPassword.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

        const clientIP = getClientIP(req);

        // Check if IP is locked due to too many failed reset attempts
        const locked = await isAccountLocked(clientIP);
        if (locked) {
            return res.status(429).json({
                error: 'Забагато невдалих спроб. Спробуйте через 15 хвилин.',
                locked: true
            });
        }

        // Get failed attempts for progressive delay
        const failedCount = await getFailedAttempts(clientIP);

        const resetToken = dbGet(
            'SELECT * FROM password_reset_tokens WHERE token = ? AND used = 0 AND expires_at > datetime("now")',
            [token]
        );

        if (!resetToken) {
            // Apply progressive delay before responding
            await getProgressiveDelay(failedCount);

            // Record failed attempt (by IP to prevent token brute-forcing)
            await recordLoginAttempt(clientIP, clientIP, false);

            return res.status(400).json({ error: 'Invalid or expired reset token' });
        }

        // Record successful attempt (clear previous failures)
        await recordLoginAttempt(clientIP, clientIP, true);

        const hashedPassword = await bcrypt.hash(newPassword, 10);
        dbRun('UPDATE users SET password = ? WHERE id = ?', [hashedPassword, resetToken.user_id]);
        dbRun('UPDATE password_reset_tokens SET used = 1 WHERE id = ?', [resetToken.id]);

        dbRun('INSERT INTO activity_log (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [resetToken.user_id, 'Password Reset', 'Password was reset via email link', clientIP]);

        createNotification(resetToken.user_id, 'security', 'Password Changed', 'Your password was successfully reset');

        res.json({ success: true, message: 'Password has been reset successfully' });
    } catch (error) {
        console.error('Reset password error:', error);
        res.status(500).json({ error: 'Failed to reset password' });
    }
});

// ==================== EMAIL VERIFICATION ====================

router.get('/api/auth/verify-email', (req, res) => {
    try {
        const { token } = req.query;
        if (!token) return res.status(400).json({ error: 'Token is required' });

        const verifyToken = dbGet(
            'SELECT * FROM email_verification_tokens WHERE token = ? AND used = 0 AND expires_at > datetime("now")',
            [token]
        );
        if (!verifyToken) return res.status(400).json({ error: 'Invalid or expired verification token' });

        dbRun('UPDATE users SET email_verified = 1 WHERE id = ?', [verifyToken.user_id]);
        dbRun('UPDATE email_verification_tokens SET used = 1 WHERE id = ?', [verifyToken.id]);

        dbRun('INSERT INTO activity_log (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [verifyToken.user_id, 'Email Verified', 'Email address verified', getClientIP(req)]);

        createNotification(verifyToken.user_id, 'success', 'Email Verified', 'Your email address has been successfully verified');

        res.json({ success: true, message: 'Email verified successfully' });
    } catch (error) {
        console.error('Verify email error:', error);
        res.status(500).json({ error: 'Failed to verify email' });
    }
});

router.post('/api/auth/resend-verification', (req, res) => {
    try {
        if (!req.session.userId) return res.status(401).json({ error: 'Not authenticated' });

        const user = dbGet('SELECT id, email, email_verified FROM users WHERE id = ?', [req.session.userId]);
        if (!user) return res.status(404).json({ error: 'User not found' });
        if (user.email_verified) return res.status(400).json({ error: 'Email is already verified' });

        const token = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + 86400000).toISOString(); // 24 hours

        dbRun('INSERT INTO email_verification_tokens (user_id, token, expires_at) VALUES (?, ?, ?)',
            [user.id, token, expiresAt]);

        try {
            const { sendVerificationEmail } = require('../services/email');
            const verifyUrl = `${req.protocol}://${req.get('host')}/verify-email?token=${token}`;
            sendVerificationEmail(user.email, verifyUrl);
        } catch (emailErr) {
            console.log('[Auth] Email not configured, verification token:', token);
        }

        res.json({ success: true, message: 'Verification email sent' });
    } catch (error) {
        console.error('Resend verification error:', error);
        res.status(500).json({ error: 'Failed to resend verification' });
    }
});

// ==================== 2FA ROUTES ====================

function generateBackupCodes(count = 5) {
    const codes = [];
    for (let i = 0; i < count; i++) {
        codes.push(crypto.randomBytes(4).toString('hex').toUpperCase());
    }
    return codes;
}

router.get('/api/2fa/status', requireAuth, (req, res) => {
    const user = dbGet('SELECT totp_enabled FROM users WHERE id = ?', [req.session.userId]);
    res.json({ enabled: !!user?.totp_enabled });
});

router.post('/api/2fa/setup', requireAuth, async (req, res) => {
    try {
        const user = dbGet('SELECT email, totp_enabled FROM users WHERE id = ?', [req.session.userId]);

        if (user.totp_enabled) {
            return res.status(400).json({ error: '2FA is already enabled' });
        }

        const secret = speakeasy.generateSecret({ name: `Yamato:${user.email}`, issuer: 'Yamato Trading' });
        const backupCodes = generateBackupCodes(5);

        dbRun('UPDATE users SET totp_secret = ?, backup_codes = ? WHERE id = ?',
            [secret.base32, JSON.stringify(backupCodes), req.session.userId]);

        const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);

        res.json({ success: true, secret: secret.base32, qrCode: qrCodeUrl, backupCodes });
    } catch (error) {
        console.error('2FA setup error:', error);
        res.status(500).json({ error: 'Failed to setup 2FA' });
    }
});

router.post('/api/2fa/verify', requireAuth, (req, res) => {
    try {
        const { token } = req.body;
        if (!token) return res.status(400).json({ error: 'Token is required' });

        const user = dbGet('SELECT totp_secret, totp_enabled, backup_codes FROM users WHERE id = ?', [req.session.userId]);

        if (!user.totp_secret) return res.status(400).json({ error: 'Please setup 2FA first' });
        if (user.totp_enabled) return res.status(400).json({ error: '2FA is already enabled' });

        const verified = speakeasy.totp.verify({
            secret: user.totp_secret, encoding: 'base32', token, window: 2
        });

        if (!verified) return res.status(400).json({ error: 'Invalid verification code' });

        dbRun('UPDATE users SET totp_enabled = 1 WHERE id = ?', [req.session.userId]);
        dbRun('INSERT INTO activity_log (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [req.session.userId, '2FA Enabled', 'Two-factor authentication enabled', getClientIP(req)]);

        createNotification(req.session.userId, 'security', 'Two-Factor Authentication Enabled', 'Your account is now protected with 2FA');

        res.json({ success: true, message: '2FA has been enabled successfully', backupCodes: JSON.parse(user.backup_codes || '[]') });
    } catch (error) {
        console.error('2FA verify error:', error);
        res.status(500).json({ error: 'Failed to verify 2FA' });
    }
});

router.post('/api/2fa/disable', requireAuth, (req, res) => {
    try {
        const { token } = req.body;
        if (!token) return res.status(400).json({ error: 'Token is required' });

        const user = dbGet('SELECT totp_secret, totp_enabled, backup_codes FROM users WHERE id = ?', [req.session.userId]);
        if (!user.totp_enabled) return res.status(400).json({ error: '2FA is not enabled' });

        let verified = speakeasy.totp.verify({
            secret: user.totp_secret, encoding: 'base32', token, window: 2
        });

        if (!verified) {
            const backupCodes = JSON.parse(user.backup_codes || '[]');
            if (backupCodes.indexOf(token.toUpperCase()) !== -1) verified = true;
        }

        if (!verified) return res.status(400).json({ error: 'Invalid verification code' });

        dbRun('UPDATE users SET totp_enabled = 0, totp_secret = NULL, backup_codes = NULL WHERE id = ?', [req.session.userId]);
        dbRun('INSERT INTO activity_log (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [req.session.userId, '2FA Disabled', 'Two-factor authentication disabled', getClientIP(req)]);

        createNotification(req.session.userId, 'warning', 'Two-Factor Authentication Disabled', 'Warning! 2FA has been disabled for your account');

        res.json({ success: true, message: '2FA has been disabled successfully' });
    } catch (error) {
        console.error('2FA disable error:', error);
        res.status(500).json({ error: 'Failed to disable 2FA' });
    }
});

// ==================== PASSKEYS API ====================

router.get('/api/passkeys', requireAuth, (req, res) => {
    try {
        const passkeys = dbAll(
            'SELECT id, name, device_type, last_used_at, created_at FROM passkeys WHERE user_id = ? ORDER BY created_at DESC',
            [req.session.userId]
        );
        res.json(passkeys.map(p => ({ id: p.id, name: p.name, deviceType: p.device_type, lastUsedAt: p.last_used_at, createdAt: p.created_at })));
    } catch (error) {
        console.error('Get passkeys error:', error);
        res.status(500).json({ error: 'Failed to get passkeys' });
    }
});

router.post('/api/passkeys/register-options', requireAuth, (req, res) => {
    try {
        const { name } = req.body;
        const user = dbGet('SELECT id, email, full_name FROM users WHERE id = ?', [req.session.userId]);
        if (!user) return res.status(404).json({ error: 'User not found' });

        const challenge = crypto.randomBytes(32).toString('base64url');
        req.session.passkeyChallenge = challenge;
        req.session.passkeyName = name || 'My Passkey';

        res.json({
            challenge,
            rp: { name: 'Yamato Trading', id: req.hostname === 'localhost' ? 'localhost' : req.hostname },
            user: {
                id: Buffer.from(user.id.toString()).toString('base64url'),
                name: user.email,
                displayName: user.full_name || user.email
            },
            pubKeyCredParams: [{ alg: -7, type: 'public-key' }, { alg: -257, type: 'public-key' }],
            timeout: 60000,
            attestation: 'none',
            authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'preferred', residentKey: 'preferred' }
        });
    } catch (error) {
        console.error('Passkey register options error:', error);
        res.status(500).json({ error: 'Failed to generate registration options' });
    }
});

router.post('/api/passkeys/register-verify', requireAuth, (req, res) => {
    try {
        const { name, id, rawId, response, type } = req.body;

        const expectedChallenge = req.session.passkeyChallenge;
        const passkeyName = req.session.passkeyName || name || 'My Passkey';

        if (!expectedChallenge) return res.status(400).json({ error: 'No registration in progress' });

        delete req.session.passkeyChallenge;
        delete req.session.passkeyName;

        const existing = dbGet('SELECT id FROM passkeys WHERE credential_id = ?', [id]);
        if (existing) return res.status(400).json({ error: 'This passkey is already registered' });

        const ua = req.headers['user-agent'] || '';
        let deviceType = 'unknown';
        if (ua.includes('Chrome')) deviceType = 'chrome';
        else if (ua.includes('Firefox')) deviceType = 'firefox';
        else if (ua.includes('Safari')) deviceType = 'apple';
        if (ua.includes('Windows')) deviceType = 'windows';
        else if (ua.includes('Mac')) deviceType = 'apple';
        else if (ua.includes('iPhone') || ua.includes('iPad')) deviceType = 'apple';
        else if (ua.includes('Android')) deviceType = 'android';

        dbRun(
            `INSERT INTO passkeys (user_id, name, credential_id, public_key, device_type, created_at) VALUES (?, ?, ?, ?, ?, datetime('now'))`,
            [req.session.userId, passkeyName, id, rawId, deviceType]
        );

        dbRun('INSERT INTO activity_log (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [req.session.userId, 'Passkey Added', `Added passkey: ${passkeyName}`, getClientIP(req)]);

        createNotification(req.session.userId, 'security', 'Passkey Added', `New passkey "${passkeyName}" has been added to your account`);

        res.json({ success: true, message: 'Passkey registered successfully' });
    } catch (error) {
        console.error('Passkey register verify error:', error);
        res.status(500).json({ error: 'Failed to verify passkey registration' });
    }
});

router.delete('/api/passkeys/:id', requireAuth, (req, res) => {
    try {
        const passkey = dbGet('SELECT * FROM passkeys WHERE id = ? AND user_id = ?', [req.params.id, req.session.userId]);
        if (!passkey) return res.status(404).json({ error: 'Passkey not found' });

        dbRun('DELETE FROM passkeys WHERE id = ? AND user_id = ?', [req.params.id, req.session.userId]);
        dbRun('INSERT INTO activity_log (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [req.session.userId, 'Passkey Removed', `Removed passkey: ${passkey.name}`, getClientIP(req)]);

        createNotification(req.session.userId, 'warning', 'Passkey Removed', `Passkey "${passkey.name}" has been removed from your account`);

        res.json({ success: true, message: 'Passkey deleted successfully' });
    } catch (error) {
        console.error('Delete passkey error:', error);
        res.status(500).json({ error: 'Failed to delete passkey' });
    }
});

router.post('/api/passkeys/auth-options', (req, res) => {
    try {
        const { email } = req.body;
        let allowCredentials = [];
        let userId = null;

        if (email) {
            const user = dbGet('SELECT id FROM users WHERE email = ?', [email]);
            if (user) {
                userId = user.id;
                const passkeys = dbAll('SELECT credential_id FROM passkeys WHERE user_id = ?', [user.id]);
                allowCredentials = passkeys.map(p => ({
                    id: p.credential_id, type: 'public-key',
                    transports: ['internal', 'hybrid', 'usb', 'ble', 'nfc']
                }));
            }
        }

        const challenge = crypto.randomBytes(32).toString('base64url');
        req.session.passkeyAuthChallenge = challenge;
        req.session.passkeyAuthUserId = userId;

        const options = {
            challenge, timeout: 60000,
            rpId: req.hostname === 'localhost' ? 'localhost' : req.hostname,
            userVerification: 'preferred'
        };

        if (allowCredentials.length > 0) options.allowCredentials = allowCredentials;

        res.json(options);
    } catch (error) {
        console.error('Passkey auth options error:', error);
        res.status(500).json({ error: 'Failed to generate authentication options' });
    }
});

router.post('/api/passkeys/auth-verify', (req, res) => {
    try {
        const { id, rawId, response, type } = req.body;

        const expectedChallenge = req.session.passkeyAuthChallenge;
        if (!expectedChallenge) return res.status(400).json({ error: 'No authentication in progress' });

        delete req.session.passkeyAuthChallenge;
        delete req.session.passkeyAuthUserId;

        const passkey = dbGet('SELECT * FROM passkeys WHERE credential_id = ?', [id]);
        if (!passkey) return res.status(401).json({ error: 'Passkey not found. Please use email and password.' });

        const user = dbGet('SELECT * FROM users WHERE id = ?', [passkey.user_id]);
        if (!user) return res.status(401).json({ error: 'User not found' });
        if (user.is_banned) return res.status(403).json({ error: 'Your account has been suspended' });

        dbRun("UPDATE passkeys SET last_used_at = datetime('now'), counter = counter + 1 WHERE id = ?", [passkey.id]);

        req.session.userId = user.id;
        req.session.userEmail = user.email;
        req.session.userRole = user.role || 'user';
        req.session.betaAccess = true;
        req.session._ip = getClientIP(req);
        req.session._ua = req.headers['user-agent'] || '';
        req.session._createdAt = new Date().toISOString();
        req.session._loginMethod = 'passkey';

        dbRun('INSERT INTO activity_log (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [user.id, 'Passkey Login', `Logged in using passkey: ${passkey.name}`, getClientIP(req)]);

        dbRun("UPDATE users SET last_login = datetime('now'), last_ip = ? WHERE id = ?", [getClientIP(req), user.id]);

        createNotification(user.id, 'login', 'New Login', `Logged in with passkey "${passkey.name}" from ${getClientIP(req)}`);

        res.json({ success: true, user: { id: user.id, email: user.email, fullName: user.full_name, role: user.role || 'user' } });
    } catch (error) {
        console.error('Passkey auth verify error:', error);
        res.status(500).json({ error: 'Failed to verify passkey authentication' });
    }
});

router.post('/api/passkeys/check', (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.json({ hasPasskeys: false });

        const user = dbGet('SELECT id FROM users WHERE email = ?', [email]);
        if (!user) return res.json({ hasPasskeys: false });

        const passkey = dbGet('SELECT id FROM passkeys WHERE user_id = ?', [user.id]);
        res.json({ hasPasskeys: !!passkey });
    } catch (error) {
        res.json({ hasPasskeys: false });
    }
});

// ==================== HELPERS ====================

function generateLoginCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

// ==================== TELEGRAM AUTH ====================

function verifyTelegramAuth(data, botToken) {
    const { hash, ...rest } = data;
    if (!hash) return false;

    const secretKey = crypto.createHash('sha256').update(botToken).digest();
    const checkString = Object.keys(rest)
        .filter(k => rest[k] !== undefined && rest[k] !== null && rest[k] !== '')
        .sort()
        .map(k => `${k}=${rest[k]}`)
        .join('\n');
    const hmac = crypto.createHmac('sha256', secretKey).update(checkString).digest('hex');

    // Use timing-safe comparison to prevent timing attacks
    const hashBuf = Buffer.from(hash, 'hex');
    const hmacBuf = Buffer.from(hmac, 'hex');
    if (hashBuf.length !== hmacBuf.length) return false;
    return crypto.timingSafeEqual(hashBuf, hmacBuf);
}

router.post('/api/auth/telegram', (req, res) => {
    try {
        const tgData = req.body;

        if (!tgData || !tgData.id || !tgData.hash) {
            return res.status(400).json({ error: 'Invalid Telegram data' });
        }

        const { siteSettings } = require('../config');
        const botToken = siteSettings.telegramBotToken;
        if (!botToken) {
            return res.status(500).json({ error: 'Telegram bot not configured' });
        }

        if (!verifyTelegramAuth(tgData, botToken)) {
            return res.status(401).json({ error: 'Invalid Telegram authentication' });
        }

        // Check auth_date is not older than 1 hour
        const authDate = parseInt(tgData.auth_date);
        if (Math.floor(Date.now() / 1000) - authDate > 3600) {
            return res.status(401).json({ error: 'Telegram auth expired' });
        }

        // Check if user with this telegram_id exists
        const existingUser = dbGet('SELECT * FROM users WHERE telegram_id = ?', [String(tgData.id)]);

        if (existingUser) {
            if (existingUser.is_banned) {
                return res.status(403).json({ error: 'Account banned', reason: existingUser.ban_reason || 'Your account has been banned' });
            }

            // Update telegram username if changed
            if (tgData.username && tgData.username !== existingUser.telegram_username) {
                dbRun('UPDATE users SET telegram_username = ? WHERE id = ?', [tgData.username, existingUser.id]);
            }

            dbRun('UPDATE users SET last_login = ? WHERE id = ?', [getLocalTime(), existingUser.id]);
            dbRun('INSERT INTO activity_log (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
                [existingUser.id, 'Telegram Login', 'Logged in via Telegram', getClientIP(req)]);

            createNotification(existingUser.id, 'login', 'New Login', `Logged in via Telegram from ${getClientIP(req)}`);

            req.session.userId = existingUser.id;
            req.session.betaAccess = true;
            req.session._ip = getClientIP(req);
            req.session._ua = req.headers['user-agent'] || '';
            req.session._createdAt = new Date().toISOString();
            req.session._loginMethod = 'telegram';
            return req.session.save((err) => {
                if (err) return res.status(500).json({ error: 'Session error' });
                res.json({ success: true, user: {
                    id: existingUser.id, email: existingUser.email, fullName: existingUser.full_name
                }});
            });
        }

        // User not found — store pending auth in session for registration
        req.session.pendingTelegramAuth = {
            id: String(tgData.id),
            first_name: tgData.first_name || '',
            last_name: tgData.last_name || '',
            username: tgData.username || '',
            photo_url: tgData.photo_url || ''
        };

        req.session.save((err) => {
            if (err) return res.status(500).json({ error: 'Session error' });
            res.json({
                needsRegistration: true,
                telegramData: {
                    firstName: tgData.first_name || '',
                    lastName: tgData.last_name || '',
                    username: tgData.username || '',
                    photoUrl: tgData.photo_url || ''
                }
            });
        });
    } catch (error) {
        console.error('Telegram auth error:', error);
        res.status(500).json({ error: 'Telegram auth failed' });
    }
});

router.post('/api/auth/telegram-register', async (req, res) => {
    try {
        const { email, password, fullName } = req.body;
        const pendingTg = req.session.pendingTelegramAuth;

        if (!pendingTg || !pendingTg.id) {
            return res.status(400).json({ error: 'No pending Telegram auth. Please authenticate via Telegram first.' });
        }

        if (!email || !password || !fullName) {
            return res.status(400).json({ error: 'Email, password and full name are required' });
        }

        if (password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }

        const existingUser = dbGet('SELECT id FROM users WHERE email = ?', [email]);
        if (existingUser) {
            return res.status(400).json({ error: 'Email already registered' });
        }

        const existingTg = dbGet('SELECT id FROM users WHERE telegram_id = ?', [pendingTg.id]);
        if (existingTg) {
            return res.status(400).json({ error: 'This Telegram account is already linked to a user' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        const role = email === ADMIN_EMAIL ? 'admin' : 'user';

        const result = dbRun(
            'INSERT INTO users (email, password, full_name, balance, demo_balance, real_balance, active_account, role, telegram_id, telegram_username, telegram_verified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [email, hashedPassword, fullName, 0, 10000, 0, 'demo', role, pendingTg.id, pendingTg.username || null, 1]
        );

        const userId = result.lastInsertRowid;
        if (!userId) {
            return res.status(500).json({ error: 'Registration failed' });
        }

        delete req.session.pendingTelegramAuth;

        dbRun('INSERT INTO activity_log (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [userId, 'Account Created', 'Registered via Telegram', getClientIP(req)]);

        createNotification(userId, 'system', 'Welcome to Yamato!', 'Thank you for registering via Telegram. Wishing you successful trading!');

        req.session.userId = userId;
        req.session.betaAccess = true;
        req.session._ip = getClientIP(req);
        req.session._ua = req.headers['user-agent'] || '';
        req.session._createdAt = new Date().toISOString();
        req.session._loginMethod = 'telegram-register';
        req.session.save((err) => {
            if (err) return res.status(500).json({ error: 'Session error' });
            res.json({
                success: true,
                user: { id: userId, email, fullName, balance: 10000, demoBalance: 10000, realBalance: 0, activeAccount: 'demo' }
            });
        });
    } catch (error) {
        console.error('Telegram register error:', error);
        res.status(500).json({ error: 'Registration failed' });
    }
});

router.get('/api/auth/telegram-bot-username', (req, res) => {
    const { siteSettings } = require('../config');
    res.json({ username: siteSettings.telegramBotUsername || '' });
});

// ==================== TELEGRAM CODE LOGIN ====================

router.post('/api/auth/telegram-login-request', async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ error: 'Email is required' });
        }

        const normalizedEmail = email.toLowerCase().trim();
        const user = dbGet('SELECT id, telegram_id FROM users WHERE LOWER(email) = LOWER(?)', [normalizedEmail]);

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (!user.telegram_id) {
            return res.status(400).json({ error: 'Telegram account not linked' });
        }

        // Generate unique code
        let code = generateLoginCode();
        let existingCode = dbGet('SELECT id FROM login_codes WHERE code = ?', [code]);
        // Retry if code collision (extremely rare)
        let retries = 0;
        while (existingCode && retries < 5) {
            code = generateLoginCode();
            existingCode = dbGet('SELECT id FROM login_codes WHERE code = ?', [code]);
            retries++;
        }

        if (existingCode) {
            return res.status(500).json({ error: 'Failed to generate code, please try again' });
        }

        // Calculate expiry: 10 minutes from now (as Unix timestamp)
        const expiresAtUnix = Math.floor(Date.now() / 1000) + 600; // 600 seconds = 10 minutes

        // Delete any existing codes for this user
        dbRun('DELETE FROM login_codes WHERE user_id = ?', [user.id]);

        // Insert new code
        dbRun(
            'INSERT INTO login_codes (user_id, code, expires_at) VALUES (?, ?, ?)',
            [user.id, code, expiresAtUnix]
        );

        // Try to send code via Telegram
        const { sendTelegramNotification } = require('../services/telegram');
        const sent = await sendTelegramNotification(user.id, 'Login Code', `Your login code is:\n\n${code}\n\nValid for 10 minutes.`, '🔐');

        if (!sent) {
            // Code was generated and stored, but Telegram delivery failed
            return res.status(200).json({
                success: false,
                message: 'Code generated but Telegram delivery failed. Please ensure Telegram bot is linked.'
            });
        }

        // Log activity
        dbRun(
            'INSERT INTO activity_log (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [user.id, 'Telegram Code Request', 'Login code requested', getClientIP(req)]
        );

        res.json({ success: true, message: 'Code sent to Telegram' });
    } catch (error) {
        console.error('Telegram login request error:', error);
        res.status(500).json({ error: 'Failed to process request' });
    }
});

router.post('/api/auth/telegram-login-verify', async (req, res) => {
    try {
        const { code } = req.body;

        if (!code) {
            return res.status(400).json({ error: 'Code is required' });
        }

        // Find the login code
        const loginCode = dbGet(
            'SELECT lc.id, lc.user_id, lc.expires_at, lc.used_at FROM login_codes lc WHERE lc.code = ?',
            [code.toString()]
        );

        if (!loginCode) {
            return res.status(400).json({ error: 'Invalid code' });
        }

        // Check if code is already used
        if (loginCode.used_at !== null) {
            return res.status(400).json({ error: 'Code already used' });
        }

        // Check if code is expired (current Unix timestamp > expires_at)
        const nowUnix = Math.floor(Date.now() / 1000);
        if (nowUnix > loginCode.expires_at) {
            return res.status(400).json({ error: 'Code expired, please request a new one' });
        }

        // Get user information
        const user = dbGet(
            'SELECT id, email, full_name, demo_balance, real_balance, active_account, is_verified, verification_level, is_banned, ban_reason FROM users WHERE id = ?',
            [loginCode.user_id]
        );

        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        if (user.is_banned) {
            return res.status(403).json({ error: 'Account banned', reason: user.ban_reason || 'Your account has been banned', banned: true });
        }

        // Mark code as used (current Unix timestamp)
        dbRun(
            'UPDATE login_codes SET used_at = ? WHERE id = ?',
            [nowUnix, loginCode.id]
        );

        // Update last login
        dbRun('UPDATE users SET last_login = ? WHERE id = ?', [getLocalTime(), user.id]);

        // Log activity
        const clientIP = getClientIP(req);
        dbRun(
            'INSERT INTO activity_log (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [user.id, 'Telegram Code Login', 'User logged in via Telegram code', clientIP]
        );

        // Create notification
        createNotification(user.id, 'login', 'New account login', `Telegram code login from IP: ${clientIP}`);

        // Create session
        req.session.userId = user.id;
        req.session.betaAccess = true;
        req.session._ip = clientIP;
        req.session._ua = req.headers['user-agent'] || '';
        req.session._createdAt = new Date().toISOString();
        req.session._loginMethod = 'telegram-code';

        req.session.save((err) => {
            if (err) {
                console.error('Session save error:', err);
                return res.status(500).json({ error: 'Session error' });
            }
            res.json({
                success: true,
                user: {
                    id: user.id,
                    email: user.email,
                    fullName: user.full_name,
                    balance: user.active_account === 'demo' ? (user.demo_balance || 0) : (user.real_balance || 0),
                    demoBalance: user.demo_balance || 0,
                    realBalance: user.real_balance || 0,
                    activeAccount: user.active_account || 'demo',
                    isVerified: user.is_verified,
                    verificationLevel: user.verification_level
                }
            });
        });
    } catch (error) {
        console.error('Telegram login verify error:', error);
        res.status(500).json({ error: 'Verification failed' });
    }
});

// ==================== GOOGLE OAUTH ====================

const { google } = require('googleapis');
const { siteSettings } = require('../config');

function getGoogleOAuth2Client() {
    const { googleClientId, googleClientSecret } = siteSettings;
    if (!googleClientId || !googleClientSecret) return null;
    const baseUrl = process.env.BASE_URL || 'https://tradingarena.space';
    return new google.auth.OAuth2(googleClientId, googleClientSecret, `${baseUrl}/api/auth/google/callback`);
}

// Check if Google Login is enabled
router.get('/api/auth/google/enabled', (req, res) => {
    res.json({ enabled: !!(siteSettings.googleOAuthEnabled && siteSettings.googleClientId && siteSettings.googleClientSecret) });
});

// Initiate Google OAuth
router.get('/api/auth/google', (req, res) => {
    if (!siteSettings.googleOAuthEnabled) {
        return res.status(400).json({ error: 'Google login is not enabled' });
    }

    const oauth2Client = getGoogleOAuth2Client();
    if (!oauth2Client) {
        return res.status(500).json({ error: 'Google OAuth not configured' });
    }

    const url = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: ['openid', 'email', 'profile'],
        prompt: 'select_account'
    });

    res.redirect(url);
});

// Google OAuth callback
router.get('/api/auth/google/callback', async (req, res) => {
    try {
        const { code } = req.query;
        if (!code) {
            return res.redirect('/login?error=google_failed');
        }

        const oauth2Client = getGoogleOAuth2Client();
        if (!oauth2Client) {
            return res.redirect('/login?error=google_failed');
        }

        const { tokens } = await oauth2Client.getToken(code);
        oauth2Client.setCredentials(tokens);

        // Get user info
        const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
        const { data: googleUser } = await oauth2.userinfo.get();

        const googleId = googleUser.id;
        const email = (googleUser.email || '').toLowerCase().trim();
        const fullName = googleUser.name || email.split('@')[0];
        const avatar = googleUser.picture || null;

        if (!email) {
            return res.redirect('/login?error=google_no_email');
        }

        // Handle "link" mode — user is linking Google from profile page
        if (req.query.state === 'link' && req.session.userId) {
            // Check if this google_id is already used by another user
            const existing = dbGet('SELECT id FROM users WHERE google_id = ?', [googleId]);
            if (existing && existing.id !== req.session.userId) {
                return res.redirect('/profile?google=already_used');
            }
            dbRun('UPDATE users SET google_id = ?, google_avatar = ? WHERE id = ?', [googleId, avatar, req.session.userId]);
            return res.redirect('/profile?google=linked');
        }

        const clientIP = getClientIP(req);

        // 1. Check if user exists by google_id
        let user = dbGet('SELECT * FROM users WHERE google_id = ?', [googleId]);

        // 2. If not found by google_id, check by email
        if (!user) {
            user = dbGet('SELECT * FROM users WHERE LOWER(email) = LOWER(?)', [email]);
            if (user) {
                // Link google_id to existing user
                dbRun('UPDATE users SET google_id = ?, google_avatar = ? WHERE id = ?', [googleId, avatar, user.id]);
            }
        }

        // 3. If still no user — auto-register
        if (!user) {
            const randomPassword = crypto.randomBytes(32).toString('hex');
            const hashedPassword = await bcrypt.hash(randomPassword, 10);
            const role = email === ADMIN_EMAIL.toLowerCase() ? 'admin' : 'user';

            const result = dbRun(
                'INSERT INTO users (email, password, full_name, balance, demo_balance, real_balance, active_account, role, google_id, google_avatar, email_verified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [email, hashedPassword, fullName, 0, 10000, 0, 'demo', role, googleId, avatar, 1]
            );

            user = dbGet('SELECT * FROM users WHERE id = ?', [result.lastInsertRowid]);
            if (!user) {
                return res.redirect('/login?error=google_failed');
            }

            createNotification(user.id, 'welcome', 'Welcome to Yamato!', 'Your account was created via Google');
        } else {
            // Update avatar if changed
            if (avatar && avatar !== user.google_avatar) {
                dbRun('UPDATE users SET google_avatar = ? WHERE id = ?', [avatar, user.id]);
            }
        }

        if (user.is_banned) {
            return res.redirect('/login?error=banned');
        }

        // Update last login
        dbRun('UPDATE users SET last_login = ? WHERE id = ?', [getLocalTime(), user.id]);
        dbRun(
            'INSERT INTO activity_log (user_id, action, details, ip_address) VALUES (?, ?, ?, ?)',
            [user.id, 'Google Login', 'User logged in via Google OAuth', clientIP]
        );
        createNotification(user.id, 'login', 'New account login', `Login via Google from IP: ${clientIP}`);

        req.session.userId = user.id;
        req.session.betaAccess = true;
        req.session._ip = clientIP;
        req.session._ua = req.headers['user-agent'] || '';
        req.session._createdAt = new Date().toISOString();
        req.session._loginMethod = 'google';

        req.session.save((err) => {
            if (err) {
                console.error('Session save error (Google):', err);
                return res.redirect('/login?error=session');
            }
            res.redirect('/dashboard');
        });
    } catch (error) {
        console.error('Google OAuth callback error:', error);
        res.redirect('/login?error=google_failed');
    }
});

// ==================== GOOGLE LINK / UNLINK (Profile) ====================

// Initiate Google link from profile page
router.get('/api/auth/google/link', requireAuth, (req, res) => {
    const oauth2Client = getGoogleOAuth2Client();
    if (!oauth2Client) {
        return res.status(500).json({ error: 'Google OAuth not configured' });
    }

    const url = oauth2Client.generateAuthUrl({
        access_type: 'offline',
        scope: ['openid', 'email', 'profile'],
        prompt: 'select_account',
        state: 'link'
    });

    res.redirect(url);
});

// Google link status
router.get('/api/auth/google/status', requireAuth, (req, res) => {
    const user = dbGet('SELECT google_id, google_avatar FROM users WHERE id = ?', [req.session.userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json({
        linked: !!user.google_id,
        avatar: user.google_avatar || null,
        enabled: !!(siteSettings.googleOAuthEnabled && siteSettings.googleClientId && siteSettings.googleClientSecret)
    });
});

// Unlink Google
router.post('/api/auth/google/unlink', requireAuth, (req, res) => {
    try {
        dbRun('UPDATE users SET google_id = NULL, google_avatar = NULL WHERE id = ?', [req.session.userId]);
        res.json({ success: true });
    } catch (error) {
        console.error('Google unlink error:', error);
        res.status(500).json({ error: 'Failed to unlink' });
    }
});

module.exports = router;
