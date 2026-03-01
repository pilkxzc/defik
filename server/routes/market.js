'use strict';
const express = require('express');
const axios   = require('axios');
const router  = express.Router();

const { getMarketPrices, getOrderBook, BINANCE_API } = require('../services/market');

const VALID_ORDERBOOK_SYMBOLS = [
    'BTC', 'ETH', 'SOL', 'DOGE', 'ADA', 'XRP', 'DOT', 'MATIC', 'AVAX', 'LINK',
    'UNI', 'ATOM', 'LTC', 'BCH', 'NEAR', 'APT', 'ARB', 'OP', 'FIL', 'ICP',
    'SHIB', 'TRX', 'ETC', 'XLM', 'HBAR', 'BNB', 'SOL', 'PEPE', 'WIF'
];

router.get('/api/market/prices', async (req, res) => {
    try {
        const prices = await getMarketPrices();

        // Convert object { BTC: { price, change24h, ... } } to array for frontend
        const pricesArray = Object.entries(prices).map(([symbol, data]) => ({
            symbol,
            price: data.price,
            change: data.change24h || 0,
            high: data.high24h || 0,
            low: data.low24h || 0,
            volume: data.volume24h || 0
        }));

        res.json({ prices: pricesArray });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch market prices' });
    }
});

router.get('/api/market/price/:symbol', async (req, res) => {
    try {
        const { symbol } = req.params;
        const response = await axios.get(`${BINANCE_API}/ticker/24hr`, {
            params: { symbol: symbol.toUpperCase() + 'USDT' }
        });

        res.json({
            symbol: symbol.toUpperCase(),
            price: parseFloat(response.data.lastPrice),
            change24h: parseFloat(response.data.priceChangePercent),
            high24h: parseFloat(response.data.highPrice),
            low24h: parseFloat(response.data.lowPrice),
            volume24h: parseFloat(response.data.volume)
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch price' });
    }
});

router.get('/api/market/orderbook/:symbol', async (req, res) => {
    try {
        const symbol = req.params.symbol.toUpperCase().replace('USDT', '');
        const limit  = Math.min(parseInt(req.query.limit) || 10, 100);

        if (!VALID_ORDERBOOK_SYMBOLS.includes(symbol)) {
            console.warn('Invalid orderbook symbol requested:', symbol);
            return res.json({ bids: [], asks: [] });
        }

        const orderBook = await getOrderBook(symbol + 'USDT', limit);

        const bids = (orderBook.bids || []).map(item => ({
            price:  parseFloat(Array.isArray(item) ? item[0] : item.price) || 0,
            amount: parseFloat(Array.isArray(item) ? item[1] : item.amount) || 0
        }));

        const asks = (orderBook.asks || []).map(item => ({
            price:  parseFloat(Array.isArray(item) ? item[0] : item.price) || 0,
            amount: parseFloat(Array.isArray(item) ? item[1] : item.amount) || 0
        }));

        res.json({ bids, asks });
    } catch (error) {
        console.error('Order book route error:', error.message);
        res.json({ bids: [], asks: [] });
    }
});

router.get('/api/market/ticker', async (req, res) => {
    try {
        const prices = await getMarketPrices();
        const ticker = Object.entries(prices).map(([symbol, data]) => ({
            symbol: `${symbol}/USD`,
            price:  data.price,
            change: data.change24h
        }));
        res.json(ticker);
    } catch (error) {
        res.status(500).json({ error: 'Failed to fetch ticker' });
    }
});

module.exports = router;
