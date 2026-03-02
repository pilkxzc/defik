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

    res.status(statusCode).json(response);
};

const notFoundHandler = (req, res, _next) => {
    res.status(404).json({
        error: 'Not found',
        code: 'NOT_FOUND'
    });
};

module.exports = { errorHandler, notFoundHandler, AppError };
