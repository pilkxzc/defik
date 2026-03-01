'use strict';
const express = require('express');
const router  = express.Router();

const { dbGet, dbAll, dbRun } = require('../db');
const { requireAuth }         = require('../middleware/auth');

router.get('/api/notifications', requireAuth, (req, res) => {
    try {
        const notifications = dbAll(
            'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
            [req.session.userId]
        );
        const unreadCount = dbGet(
            'SELECT COUNT(*) as count FROM notifications WHERE user_id = ? AND is_read = 0',
            [req.session.userId]
        );
        res.json({ notifications, unreadCount: unreadCount?.count || 0 });
    } catch (error) {
        console.error('Get notifications error:', error);
        res.status(500).json({ error: 'Failed to get notifications' });
    }
});

router.put('/api/notifications/:id/read', requireAuth, (req, res) => {
    try {
        const notification = dbGet(
            'SELECT id FROM notifications WHERE id = ? AND user_id = ?',
            [req.params.id, req.session.userId]
        );
        if (!notification) return res.status(404).json({ error: 'Notification not found' });

        dbRun('UPDATE notifications SET is_read = 1 WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (error) {
        console.error('Mark notification read error:', error);
        res.status(500).json({ error: 'Failed to mark notification as read' });
    }
});

router.put('/api/notifications/read-all', requireAuth, (req, res) => {
    try {
        dbRun('UPDATE notifications SET is_read = 1 WHERE user_id = ?', [req.session.userId]);
        res.json({ success: true });
    } catch (error) {
        console.error('Mark all notifications read error:', error);
        res.status(500).json({ error: 'Failed to mark all notifications as read' });
    }
});

router.delete('/api/notifications/:id', requireAuth, (req, res) => {
    try {
        const notification = dbGet(
            'SELECT id FROM notifications WHERE id = ? AND user_id = ?',
            [req.params.id, req.session.userId]
        );
        if (!notification) return res.status(404).json({ error: 'Notification not found' });

        dbRun('DELETE FROM notifications WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (error) {
        console.error('Delete notification error:', error);
        res.status(500).json({ error: 'Failed to delete notification' });
    }
});

router.delete('/api/notifications', requireAuth, (req, res) => {
    try {
        dbRun('DELETE FROM notifications WHERE user_id = ?', [req.session.userId]);
        res.json({ success: true });
    } catch (error) {
        console.error('Clear notifications error:', error);
        res.status(500).json({ error: 'Failed to clear notifications' });
    }
});

module.exports = router;
