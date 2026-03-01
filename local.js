#!/usr/bin/env node
'use strict';

const { execSync, spawn } = require('child_process');
const os   = require('os');
const path = require('path');

// ── 1. Install dependencies ──────────────────────────────────────────────────

function install(dir) {
    const pkgJson = path.join(dir, 'package.json');
    try { require('fs').accessSync(pkgJson); } catch { return; }
    console.log(`\n📦  npm install in ${dir}`);
    execSync('npm install', { cwd: dir, stdio: 'inherit' });
}

install(__dirname);
install(path.join(__dirname, 'server'));
install(path.join(__dirname, '_src'));

// ── 2. Build front-end ───────────────────────────────────────────────────────

console.log('\n🔨  Building front-end…');
execSync('npm run build', { cwd: path.join(__dirname, '_src'), stdio: 'inherit' });

// ── 3. Get local network IP ──────────────────────────────────────────────────

function getLocalIP() {
    const ifaces = os.networkInterfaces();
    for (const name of Object.keys(ifaces)) {
        for (const iface of ifaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return '127.0.0.1';
}

// ── 4. Print QR code ─────────────────────────────────────────────────────────

function printQR(text) {
    // Pure JS QR renderer — no extra deps
    // Uses qrcode package if available, otherwise falls back to qrcode-terminal
    try {
        const qrTerminal = require('qrcode-terminal');
        console.log('\n');
        qrTerminal.generate(text, { small: true });
    } catch {
        try {
            const QRCode = require('qrcode');
            QRCode.toString(text, { type: 'terminal', small: true }, (err, str) => {
                if (!err) console.log('\n' + str);
            });
        } catch {
            // Minimal built-in QR fallback using unicode blocks
            console.log(`\n  (встанови qrcode-terminal: npm i -g qrcode-terminal)\n`);
        }
    }
}

// ── 5. Ensure qrcode-terminal is available ───────────────────────────────────

try { require('qrcode-terminal'); } catch {
    console.log('\n📲  Installing qrcode-terminal…');
    execSync('npm install qrcode-terminal --no-save', { cwd: __dirname, stdio: 'inherit' });
}

// ── 6. Show banner ───────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
const ip   = getLocalIP();
const url  = `http://${ip}:${PORT}`;

console.log('\n' + '─'.repeat(50));
console.log(`  🌐  Local:    http://localhost:${PORT}`);
console.log(`  📡  Network:  ${url}`);
console.log('─'.repeat(50));
console.log('\n  Скануй QR з телефона:\n');

printQR(url);

// ── 7. Start server ──────────────────────────────────────────────────────────

console.log('\n🚀  Starting server…\n');

const server = spawn('node', ['server/server.js'], {
    cwd: __dirname,
    stdio: 'inherit',
    env: { ...process.env, PORT: String(PORT), HOST: '0.0.0.0' },
});

server.on('close', code => process.exit(code ?? 0));

process.on('SIGINT',  () => server.kill('SIGINT'));
process.on('SIGTERM', () => server.kill('SIGTERM'));
