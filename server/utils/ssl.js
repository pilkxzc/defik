'use strict';
const fs   = require('fs');
const os   = require('os');
const path = require('path');
const { SSL_KEY_PATH, SSL_CERT_PATH } = require('../config');

function getLocalIP() {
    const interfaces = os.networkInterfaces();
    for (const name of Object.keys(interfaces)) {
        for (const iface of interfaces[name]) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    return 'localhost';
}

function getSSLCredentials() {
    const sslDir = path.dirname(SSL_KEY_PATH);

    if (!fs.existsSync(sslDir)) {
        fs.mkdirSync(sslDir, { recursive: true });
    }

    if (fs.existsSync(SSL_KEY_PATH) && fs.existsSync(SSL_CERT_PATH)) {
        return {
            key:  fs.readFileSync(SSL_KEY_PATH),
            cert: fs.readFileSync(SSL_CERT_PATH)
        };
    }

    console.log('🔐 Generating SSL certificates...');
    const localIP    = getLocalIP();
    const selfsigned = require('selfsigned');

    const attrs = [{ name: 'commonName', value: 'localhost' }];
    const pems  = selfsigned.generate(attrs, {
        keySize:   2048,
        days:      365,
        algorithm: 'sha256',
        extensions: [
            { name: 'basicConstraints', cA: true },
            {
                name: 'subjectAltName',
                altNames: [
                    { type: 2, value: 'localhost' },
                    { type: 7, ip: '127.0.0.1' },
                    { type: 7, ip: localIP }
                ]
            }
        ]
    });

    fs.writeFileSync(SSL_KEY_PATH, pems.private);
    fs.writeFileSync(SSL_CERT_PATH, pems.cert);
    console.log('✅ SSL certificates generated and saved');

    return { key: pems.private, cert: pems.cert };
}

module.exports = { getLocalIP, getSSLCredentials };
