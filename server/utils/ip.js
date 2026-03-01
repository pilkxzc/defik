'use strict';

function getClientIP(req) {
    const headers = [
        'x-forwarded-for',
        'x-real-ip',
        'cf-connecting-ip',
        'x-client-ip',
        'x-cluster-client-ip',
        'forwarded-for',
        'forwarded'
    ];

    for (const header of headers) {
        const value = req.headers[header];
        if (value) {
            const ip      = value.split(',')[0].trim();
            const cleanIp = ip.replace(/^::ffff:/, '');
            if (cleanIp && cleanIp !== '127.0.0.1' && cleanIp !== '::1') {
                return cleanIp;
            }
        }
    }

    let ip = req.ip || req.connection?.remoteAddress || req.socket?.remoteAddress || 'unknown';
    ip = ip.replace(/^::ffff:/, '');

    if (ip === '127.0.0.1' || ip === '::1') {
        return 'localhost';
    }

    return ip;
}

module.exports = { getClientIP };
