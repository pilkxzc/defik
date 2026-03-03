'use strict';
const express = require('express');
const router  = express.Router();
const { dbAll } = require('../db');
const { getTelegramBot } = require('../services/telegram');

// GET /api/community/tg-posts — latest channel posts
router.get('/api/community/tg-posts', (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const posts = dbAll(
        'SELECT * FROM tg_posts ORDER BY created_at DESC LIMIT ?',
        [limit]
    );
    res.json({ posts: posts || [] });
});

// GET /api/community/tg-photo/:fileId — proxy Telegram photo (hides bot token)
router.get('/api/community/tg-photo/:fileId', async (req, res) => {
    const bot = getTelegramBot();
    if (!bot) return res.status(404).end();
    try {
        const fileLink = await bot.getFileLink(req.params.fileId);
        const response = await fetch(fileLink);
        if (!response.ok) return res.status(404).end();
        res.setHeader('Content-Type', response.headers.get('content-type') || 'image/jpeg');
        res.setHeader('Cache-Control', 'public, max-age=86400');
        res.send(Buffer.from(await response.arrayBuffer()));
    } catch {
        res.status(404).end();
    }
});

module.exports = router;
