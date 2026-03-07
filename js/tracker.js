'use strict';
(function() {
    const _q = [];
    let _flushing = false;
    let _pageStart = Date.now();

    function track(action, details) {
        _q.push({ action, details, ts: Date.now() });
        if (_q.length >= 5) flush();
    }

    function flush() {
        if (_flushing || _q.length === 0) return;
        _flushing = true;
        const batch = _q.splice(0, 20);
        batch.forEach(function(ev) {
            fetch('/api/activity/track', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: ev.action, details: ev.details }),
                keepalive: true
            }).catch(function() {});
        });
        _flushing = false;
    }

    // Track page view with time
    track('client_page_view', {
        page: location.pathname,
        referrer: document.referrer || null,
        screenWidth: screen.width,
        screenHeight: screen.height,
        language: navigator.language,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
    });

    // Track navigation (SPA-like)
    var _lastPath = location.pathname;
    setInterval(function() {
        if (location.pathname !== _lastPath) {
            track('client_navigate', { from: _lastPath, to: location.pathname });
            _lastPath = location.pathname;
        }
    }, 1000);

    // Track clicks on key elements
    document.addEventListener('click', function(e) {
        var el = e.target.closest('a, button, [data-track]');
        if (!el) return;

        var info = {};
        if (el.tagName === 'A') {
            info.type = 'link';
            info.href = el.getAttribute('href');
            info.text = (el.textContent || '').trim().substring(0, 60);
        } else if (el.tagName === 'BUTTON') {
            info.type = 'button';
            info.text = (el.textContent || '').trim().substring(0, 60);
            info.id = el.id || null;
            info.cls = el.className ? el.className.substring(0, 80) : null;
        } else {
            info.type = 'element';
            info.tag = el.tagName.toLowerCase();
            info.trackId = el.dataset.track || null;
        }
        info.page = location.pathname;
        track('client_click', info);
    }, true);

    // Track form submissions
    document.addEventListener('submit', function(e) {
        var form = e.target;
        track('client_form_submit', {
            page: location.pathname,
            formId: form.id || null,
            formAction: form.action || null
        });
    }, true);

    // Track time on page (every 60s)
    setInterval(function() {
        var elapsed = Math.round((Date.now() - _pageStart) / 1000);
        track('client_heartbeat', {
            page: location.pathname,
            timeOnPage: elapsed,
            scrollY: window.scrollY,
            docHeight: document.documentElement.scrollHeight
        });
    }, 60000);

    // Track visibility changes (tab switch)
    document.addEventListener('visibilitychange', function() {
        track('client_visibility', {
            state: document.visibilityState,
            page: location.pathname,
            timeOnPage: Math.round((Date.now() - _pageStart) / 1000)
        });
    });

    // Flush on page unload
    window.addEventListener('beforeunload', function() {
        var elapsed = Math.round((Date.now() - _pageStart) / 1000);
        track('client_page_leave', {
            page: location.pathname,
            timeOnPage: elapsed
        });
        flush();
    });

    // Periodic flush
    setInterval(flush, 10000);

    // Expose for manual tracking
    window.yamatoTrack = track;
})();
