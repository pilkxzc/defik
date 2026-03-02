'use strict';

const axios = require('axios');

jest.mock('axios');

const { getBinanceServerTime, testBinanceCredentials, fetchBinanceFuturesData } = require('../services/binance');

beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
    console.error.mockRestore();
});

describe('withRetry (via getBinanceServerTime)', () => {
    it('returns server time on first success', async () => {
        axios.get.mockResolvedValueOnce({ data: { serverTime: 1700000000000 } });
        const result = await getBinanceServerTime('futures');
        expect(result).toBe(1700000000000);
        expect(axios.get).toHaveBeenCalledTimes(1);
    });

    it('retries on 500 and succeeds', async () => {
        axios.get
            .mockRejectedValueOnce({ response: { status: 500 } })
            .mockResolvedValueOnce({ data: { serverTime: 1700000000000 } });
        const result = await getBinanceServerTime('futures');
        expect(result).toBe(1700000000000);
        expect(axios.get).toHaveBeenCalledTimes(2);
    });

    it('retries on 429 rate limit', async () => {
        axios.get
            .mockRejectedValueOnce({ response: { status: 429 } })
            .mockResolvedValueOnce({ data: { serverTime: 1700000000000 } });
        const result = await getBinanceServerTime('futures');
        expect(result).toBe(1700000000000);
    });

    it('retries on 502, 503, 504', async () => {
        axios.get
            .mockRejectedValueOnce({ response: { status: 502 } })
            .mockRejectedValueOnce({ response: { status: 503 } })
            .mockResolvedValueOnce({ data: { serverTime: 1700000000000 } });
        const result = await getBinanceServerTime('futures');
        expect(result).toBe(1700000000000);
        expect(axios.get).toHaveBeenCalledTimes(3);
    });

    it('retries on network error (no response)', async () => {
        axios.get
            .mockRejectedValueOnce(new Error('ECONNRESET'))
            .mockResolvedValueOnce({ data: { serverTime: 1700000000000 } });
        const result = await getBinanceServerTime('futures');
        expect(result).toBe(1700000000000);
    });

    it('does NOT retry on 401 auth error', async () => {
        axios.get.mockRejectedValueOnce({ response: { status: 401, data: { msg: 'Invalid API key' } } });
        // getBinanceServerTime catches all errors and falls back to Date.now()
        const result = await getBinanceServerTime('futures');
        expect(typeof result).toBe('number');
        expect(axios.get).toHaveBeenCalledTimes(1);
    });

    it('does NOT retry on 403', async () => {
        axios.get.mockRejectedValueOnce({ response: { status: 403 } });
        const result = await getBinanceServerTime('futures');
        expect(typeof result).toBe('number');
        expect(axios.get).toHaveBeenCalledTimes(1);
    });

    it('falls back to Date.now() after all retries exhausted', async () => {
        axios.get
            .mockRejectedValueOnce({ response: { status: 500 } })
            .mockRejectedValueOnce({ response: { status: 500 } })
            .mockRejectedValueOnce({ response: { status: 500 } });
        const before = Date.now();
        const result = await getBinanceServerTime('futures');
        expect(result).toBeGreaterThanOrEqual(before);
        expect(result).toBeLessThanOrEqual(Date.now());
        expect(axios.get).toHaveBeenCalledTimes(3);
    });

    it('retries on 408 timeout status', async () => {
        axios.get
            .mockRejectedValueOnce({ response: { status: 408 } })
            .mockResolvedValueOnce({ data: { serverTime: 1700000000000 } });
        const result = await getBinanceServerTime('futures');
        expect(result).toBe(1700000000000);
    });
});

describe('getBinanceServerTime', () => {
    it('uses futures endpoint for futures accountType', async () => {
        axios.get.mockResolvedValueOnce({ data: { serverTime: 1700000000000 } });
        await getBinanceServerTime('futures');
        expect(axios.get).toHaveBeenCalledWith(
            'https://fapi.binance.com/fapi/v1/time',
            expect.objectContaining({ timeout: 5000 })
        );
    });

    it('uses spot endpoint for spot accountType', async () => {
        axios.get.mockResolvedValueOnce({ data: { serverTime: 1700000000000 } });
        await getBinanceServerTime('spot');
        expect(axios.get).toHaveBeenCalledWith(
            'https://api.binance.com/api/v3/time',
            expect.objectContaining({ timeout: 5000 })
        );
    });
});

describe('testBinanceCredentials', () => {
    it('returns success on valid credentials', async () => {
        axios.get.mockResolvedValue({ data: { serverTime: 1700000000000, totalWalletBalance: '100' } });
        const result = await testBinanceCredentials('key', 'secret', 'futures');
        expect(result.success).toBe(true);
        expect(result.data).toBeDefined();
    });

    it('returns failure on invalid credentials', async () => {
        // First call for server time succeeds
        axios.get.mockResolvedValueOnce({ data: { serverTime: 1700000000000 } });
        // Second call for account fails with 401
        axios.get.mockRejectedValueOnce({ response: { status: 401, data: { msg: 'Invalid API-key' } } });
        const result = await testBinanceCredentials('badkey', 'badsecret', 'futures');
        expect(result.success).toBe(false);
        expect(result.error).toBe('Invalid API-key');
    });

    it('returns failure on network error', async () => {
        // Server time falls back to Date.now() on error
        axios.get
            .mockRejectedValueOnce(new Error('Network Error'))
            .mockRejectedValueOnce(new Error('Network Error'))
            .mockRejectedValueOnce(new Error('Network Error'))
            .mockRejectedValueOnce(new Error('Network Error'))
            .mockRejectedValueOnce(new Error('Network Error'))
            .mockRejectedValueOnce(new Error('Network Error'));
        const result = await testBinanceCredentials('key', 'secret', 'futures');
        expect(result.success).toBe(false);
        expect(result.error).toBe('Network Error');
    });

    it('uses spot endpoints for spot accountType', async () => {
        axios.get.mockResolvedValue({ data: { serverTime: 1700000000000, balances: [] } });
        await testBinanceCredentials('key', 'secret', 'spot');
        const calls = axios.get.mock.calls;
        expect(calls[0][0]).toContain('api.binance.com');
    });

    it('includes API key header', async () => {
        axios.get.mockResolvedValue({ data: { serverTime: 1700000000000 } });
        await testBinanceCredentials('myApiKey', 'secret', 'futures');
        const accountCall = axios.get.mock.calls.find(c => c[0].includes('/account'));
        if (accountCall) {
            expect(accountCall[1].headers['X-MBX-APIKEY']).toBe('myApiKey');
        }
    });
});

describe('fetchBinanceFuturesData', () => {
    const mockAccount = {
        totalWalletBalance: '1000.50',
        totalUnrealizedProfit: '50.25',
        totalMarginBalance: '1050.75',
        availableBalance: '800.00',
        positions: [
            {
                symbol: 'BTCUSDT',
                positionAmt: '0.01',
                entryPrice: '50000',
                markPrice: '51000',
                unrealizedProfit: '10',
                leverage: '10',
                marginType: 'cross'
            },
            {
                symbol: 'ETHUSDT',
                positionAmt: '0',
                entryPrice: '0',
                markPrice: '0',
                unrealizedProfit: '0',
                leverage: '10',
                marginType: 'cross'
            }
        ]
    };

    it('fetches and formats account data correctly', async () => {
        axios.get
            .mockResolvedValueOnce({ data: { serverTime: 1700000000000 } }) // server time
            .mockResolvedValueOnce({ data: mockAccount }) // account
            .mockResolvedValueOnce({ data: [] }) // openOrders
            .mockResolvedValueOnce({ data: [] }) // userTrades
            .mockResolvedValueOnce({ data: [] }); // income

        const result = await fetchBinanceFuturesData('key', 'secret');
        expect(result.account.totalWalletBalance).toBe(1000.50);
        expect(result.account.totalUnrealizedProfit).toBe(50.25);
        expect(result.account.availableBalance).toBe(800);
        expect(result.positions).toHaveLength(1); // filters out zero positions
        expect(result.positions[0].symbol).toBe('BTCUSDT');
        expect(result.positions[0].side).toBe('LONG');
    });

    it('throws on complete failure', async () => {
        axios.get
            .mockRejectedValueOnce(new Error('timeout')) // server time - falls back
            .mockRejectedValueOnce(new Error('timeout'))
            .mockRejectedValueOnce(new Error('timeout'))
            .mockRejectedValueOnce({ response: { status: 401, data: { msg: 'Unauthorized' } } }); // account fails

        await expect(fetchBinanceFuturesData('key', 'secret'))
            .rejects.toThrow();
    });

    it('handles API error message in thrown error', async () => {
        axios.get
            .mockResolvedValueOnce({ data: { serverTime: 1700000000000 } })
            .mockRejectedValueOnce({ response: { status: 401, data: { msg: 'API key invalid' } } });

        await expect(fetchBinanceFuturesData('key', 'secret'))
            .rejects.toThrow('API key invalid');
    });

    it('gracefully handles userTrades and income failures', async () => {
        // userTrades and income use makeRequest which has withRetry (3 attempts each)
        // Use 403 to avoid retries (non-retryable status)
        axios.get
            .mockResolvedValueOnce({ data: { serverTime: 1700000000000 } }) // server time
            .mockResolvedValueOnce({ data: { ...mockAccount, positions: [] } }) // account
            .mockResolvedValueOnce({ data: [] }) // openOrders
            .mockRejectedValueOnce({ response: { status: 403 } }) // userTrades - no retry
            .mockRejectedValueOnce({ response: { status: 403 } }); // income - no retry

        const result = await fetchBinanceFuturesData('key', 'secret');
        expect(result.recentTrades).toEqual([]);
        expect(result.incomeHistory).toEqual([]);
    });

    it('categorizes orders correctly', async () => {
        const orders = [
            { symbol: 'BTCUSDT', side: 'BUY', type: 'LIMIT', price: '50000', origQty: '0.01', status: 'NEW', time: 1700000000000 },
            { symbol: 'BTCUSDT', side: 'SELL', type: 'STOP_MARKET', stopPrice: '48000', price: '0', origQty: '0.01', status: 'NEW', time: 1700000000000 },
            { symbol: 'BTCUSDT', side: 'SELL', type: 'TAKE_PROFIT_MARKET', stopPrice: '55000', price: '0', origQty: '0.01', status: 'NEW', time: 1700000000000 }
        ];

        axios.get
            .mockResolvedValueOnce({ data: { serverTime: 1700000000000 } })
            .mockResolvedValueOnce({ data: { ...mockAccount, positions: [] } })
            .mockResolvedValueOnce({ data: orders })
            .mockResolvedValueOnce({ data: [] })
            .mockResolvedValueOnce({ data: [] });

        const result = await fetchBinanceFuturesData('key', 'secret');
        expect(result.openOrders).toHaveLength(3);
        expect(result.limitOrders).toHaveLength(1);
        expect(result.stopOrders).toHaveLength(1);
        expect(result.takeProfitOrders).toHaveLength(1);
    });
});
