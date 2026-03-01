'use strict';
const axios = require('axios');

const BINANCE_API = 'https://api.binance.com/api/v3';

let marketCache = { data: null, timestamp: 0 };

const orderBookCache    = {};
const ORDER_BOOK_CACHE_TTL = 2000; // 2 seconds

async function getMarketPrices() {
    const now = Date.now();
    if (marketCache.data && (now - marketCache.timestamp) < 10000) {
        return marketCache.data;
    }

    try {
        const symbols = [
            'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'ADAUSDT', 'DOGEUSDT', 'DOTUSDT',
            'XRPUSDT', 'MATICUSDT', 'AVAXUSDT', 'LINKUSDT', 'UNIUSDT', 'ATOMUSDT',
            'LTCUSDT', 'BCHUSDT', 'NEARUSDT', 'APTUSDT', 'ARBUSDT', 'OPUSDT',
            'FILUSDT', 'ICPUSDT', 'SHIBUSDT', 'TRXUSDT', 'ETCUSDT', 'XLMUSDT', 'HBARUSDT'
        ];
        const [tickerResponse, change24hResponse] = await Promise.all([
            axios.get(`${BINANCE_API}/ticker/price`, { params: { symbols: JSON.stringify(symbols) } }),
            axios.get(`${BINANCE_API}/ticker/24hr`,  { params: { symbols: JSON.stringify(symbols) } })
        ]);

        const prices = {};
        tickerResponse.data.forEach(item => {
            const symbol   = item.symbol.replace('USDT', '');
            prices[symbol] = { price: parseFloat(item.price), symbol };
        });

        change24hResponse.data.forEach(item => {
            const symbol = item.symbol.replace('USDT', '');
            if (prices[symbol]) {
                prices[symbol].change24h = parseFloat(item.priceChangePercent);
                prices[symbol].high24h   = parseFloat(item.highPrice);
                prices[symbol].low24h    = parseFloat(item.lowPrice);
                prices[symbol].volume24h = parseFloat(item.volume);
            }
        });

        marketCache = { data: prices, timestamp: now };
        return prices;
    } catch (error) {
        console.error('Binance API error:', error.message);
        return marketCache.data || {};
    }
}

async function getOrderBook(symbol = 'BTCUSDT', limit = 10) {
    try {
        const cached = orderBookCache[symbol];
        if (cached && Date.now() - cached.timestamp < ORDER_BOOK_CACHE_TTL) {
            return cached.data;
        }

        const response = await axios.get(`${BINANCE_API}/depth`, {
            params:  { symbol, limit },
            timeout: 5000
        });

        orderBookCache[symbol] = { data: response.data, timestamp: Date.now() };
        return response.data;
    } catch (error) {
        console.error('Order book error for', symbol, ':', error.message);
        if (orderBookCache[symbol]) return orderBookCache[symbol].data;
        return { bids: [], asks: [] };
    }
}

module.exports = { getMarketPrices, getOrderBook, BINANCE_API };
