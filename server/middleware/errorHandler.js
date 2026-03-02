'use strict';

class AppError extends Error {
    constructor(message, statusCode = 500, code = 'INTERNAL_ERROR') {
        super(message);
        this.statusCode = statusCode;
        this.code = code;
        this.isOperational = true;
    }
}

const errorHandler = (err, req, res, _next) => {
    const statusCode = err.statusCode || 500;
    const isOperational = err.isOperational || false;

    if (!isOperational) {
        console.error(`[errorHandler] Unhandled error on ${req.method} ${req.path}:`, err.message);
        if (process.env.NODE_ENV !== 'production') {
            console.error(err.stack);
        }
    }

    const response = {
        error: isOperational ? err.message : 'Internal server error',
        code: err.code || 'INTERNAL_ERROR'
    };

    if (process.env.NODE_ENV !== 'production' && !isOperational) {
        response.stack = err.stack;
    }

    // API routes get JSON, page routes get HTML
    if (req.path.startsWith('/api/') || req.path.startsWith('/api')) {
        res.status(statusCode).json(response);
    } else {
        const path = require('path');
        const errorPage = path.join(__dirname, '..', '..', 'page', '500.html');
        res.status(statusCode).sendFile(errorPage, (sendErr) => {
            if (sendErr) {
                res.status(statusCode).send('Internal Server Error');
            }
        });
    }
};

const notFoundHandler = (req, res, _next) => {
    res.status(404).json({
        error: 'Not found',
        code: 'NOT_FOUND'
    });
};

module.exports = { errorHandler, notFoundHandler, AppError };
