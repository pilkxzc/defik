'use strict';
const axios = require('axios');

const walletBalanceCache = new Map();
const WALLET_CACHE_TTL   = 5 * 60 * 1000; // 5 minutes

async function getEthBalance(address) {
    const cacheKey = `eth_${address}`;
    const cached   = walletBalanceCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < WALLET_CACHE_TTL) return cached.balance;

    try {
        const response = await axios.post('https://cloudflare-eth.com', {
            jsonrpc: '2.0', method: 'eth_getBalance', params: [address, 'latest'], id: 1
        }, { timeout: 10000 });

        if (response.data && response.data.result) {
            const balance = parseInt(response.data.result, 16) / 1e18;
            walletBalanceCache.set(cacheKey, { balance, timestamp: Date.now() });
            return balance;
        }
        return 0;
    } catch (error) {
        console.error('ETH balance error:', error.message);
        return cached ? cached.balance : 0;
    }
}

async function getBtcBalance(address) {
    const cacheKey = `btc_${address}`;
    const cached   = walletBalanceCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < WALLET_CACHE_TTL) return cached.balance;

    try {
        const response = await axios.get(`https://blockchain.info/q/addressbalance/${address}`, { timeout: 10000 });
        const balance  = parseInt(response.data) / 1e8;
        walletBalanceCache.set(cacheKey, { balance, timestamp: Date.now() });
        return balance;
    } catch (error) {
        console.error('BTC balance error:', error.message);
        return cached ? cached.balance : 0;
    }
}

async function getSolBalance(address) {
    const cacheKey = `sol_${address}`;
    const cached   = walletBalanceCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp) < WALLET_CACHE_TTL) return cached.balance;

    try {
        const response = await axios.post('https://api.mainnet-beta.solana.com', {
            jsonrpc: '2.0', id: 1, method: 'getBalance', params: [address]
        }, { timeout: 10000 });

        if (response.data && response.data.result) {
            const balance = response.data.result.value / 1e9;
            walletBalanceCache.set(cacheKey, { balance, timestamp: Date.now() });
            return balance;
        }
        return 0;
    } catch (error) {
        console.error('SOL balance error:', error.message);
        return cached ? cached.balance : 0;
    }
}

async function getBlockchainBalance(address, currency) {
    const curr = currency.toUpperCase();
    switch (curr) {
        case 'ETH': return await getEthBalance(address);
        case 'BTC': return await getBtcBalance(address);
        case 'SOL': return await getSolBalance(address);
        default:    return 0;
    }
}

function validateWalletAddress(address, currency) {
    const curr = currency.toUpperCase();
    switch (curr) {
        case 'ETH':
            return /^0x[a-fA-F0-9]{40}$/.test(address);
        case 'BTC':
            return /^(1|3)[a-km-zA-HJ-NP-Z1-9]{25,34}$/.test(address) ||
                   /^bc1[a-zA-HJ-NP-Z0-9]{39,59}$/.test(address);
        case 'SOL':
            return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
        default:
            return true;
    }
}

module.exports = { getBlockchainBalance, validateWalletAddress, WALLET_CACHE_TTL };
