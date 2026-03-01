'use strict';

function getLocalTime() {
    return new Date().toISOString();
}

function getLocalTimeAgo(hours) {
    return new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
}

function getLocalTimeDaysAgo(days) {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function formatTimeForDisplay(isoString) {
    return new Date(isoString).toLocaleString('uk-UA', {
        timeZone: 'Europe/Kyiv',
        year:     'numeric',
        month:    '2-digit',
        day:      '2-digit',
        hour:     '2-digit',
        minute:   '2-digit'
    });
}

module.exports = { getLocalTime, getLocalTimeAgo, getLocalTimeDaysAgo, formatTimeForDisplay };
