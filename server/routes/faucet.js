'use strict';
const express = require('express');
const router  = express.Router();
const { requireAuth } = require('../middleware/auth');

// Faucet disabled — demo accounts removed
router.get('/api/faucet/status', requireAuth, (req, res) => {
    res.json({ claimedLast24h: 0, remaining: 0, maxPerDay: 0, canClaim: false, disabled: true });
});

router.post('/api/faucet/claim', requireAuth, (req, res) => {
    res.status(403).json({ error: 'Faucet is disabled' });
});

module.exports = router;
