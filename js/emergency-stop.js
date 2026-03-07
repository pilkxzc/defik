/**
 * Emergency Stop Button (admin only)
 * Hold for 5 seconds to confirm — stops ALL bots and disconnects ALL subscribers.
 * Positioned bottom-right, above the bug reporter FAB.
 */
(function () {
    'use strict';

    let holdTimer = null;
    let holdStart = 0;
    let progressInterval = null;
    let isExecuting = false;

    const HOLD_DURATION = 5000;

    function injectStyles() {
        if (document.getElementById('es-styles')) return;
        const s = document.createElement('style');
        s.id = 'es-styles';
        s.textContent = `
            @keyframes esPulse { 0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,0.4)} 50%{box-shadow:0 0 0 8px rgba(239,68,68,0)} }

            #es-fab {
                position:fixed; bottom:72px; right:20px; z-index:99979;
                width:44px; height:44px; border-radius:50%;
                background:#141414; border:1px solid rgba(239,68,68,0.3);
                cursor:pointer; display:flex; align-items:center; justify-content:center;
                box-shadow:0 4px 20px rgba(0,0,0,0.5);
                transition:transform 0.2s, border-color 0.2s;
                -webkit-user-select:none; user-select:none;
                -webkit-touch-callout:none;
            }
            #es-fab:hover { transform:scale(1.1); border-color:rgba(239,68,68,0.6); }
            #es-fab.holding {
                animation:esPulse 1s ease infinite;
                border-color:rgba(239,68,68,0.8);
            }
            #es-fab.executing {
                opacity:0.5; pointer-events:none;
            }

            /* Circular progress ring */
            #es-progress {
                position:absolute; inset:-3px;
                width:50px; height:50px;
            }
            #es-progress-circle {
                fill:none; stroke:#EF4444; stroke-width:3;
                stroke-dasharray:141.37; stroke-dashoffset:141.37;
                stroke-linecap:round;
                transform:rotate(-90deg); transform-origin:center;
                transition:stroke-dashoffset 0.1s linear;
            }

            /* Tooltip on hover */
            #es-tooltip {
                position:absolute; right:56px; top:50%; transform:translateY(-50%);
                background:#1a1a1a; border:1px solid rgba(255,255,255,0.1);
                border-radius:10px; padding:8px 12px;
                white-space:nowrap; pointer-events:none;
                opacity:0; transition:opacity 0.2s;
                font-size:11px; font-weight:600; color:#EF4444;
                box-shadow:0 4px 16px rgba(0,0,0,0.5);
            }
            #es-fab:hover #es-tooltip { opacity:1; }
            #es-fab.holding #es-tooltip { opacity:1; }

            /* Confirmation overlay */
            #es-overlay {
                position:fixed; inset:0; z-index:99998;
                background:rgba(0,0,0,0.85); backdrop-filter:blur(8px);
                display:flex; align-items:center; justify-content:center;
                animation:brFadeIn 0.2s ease;
                padding:16px;
            }
            #es-result {
                background:#141414; border:1px solid rgba(239,68,68,0.3);
                border-radius:24px; padding:32px;
                max-width:420px; width:100%; text-align:center;
                box-shadow:0 28px 80px rgba(0,0,0,0.8);
            }
            #es-result h3 {
                font-size:18px; font-weight:700; color:#EF4444;
                margin:16px 0 8px;
            }
            #es-result p {
                font-size:13px; color:#A1A1A1; margin:0 0 20px;
                line-height:1.5;
            }
            #es-result button {
                padding:10px 24px; border-radius:10px; border:none;
                background:rgba(255,255,255,0.08); color:#fff;
                font-size:13px; font-weight:700; cursor:pointer;
                transition:background 0.2s;
            }
            #es-result button:hover { background:rgba(255,255,255,0.15); }
        `;
        document.head.appendChild(s);
    }

    function createButton() {
        if (document.getElementById('es-fab')) return;

        const fab = document.createElement('div');
        fab.id = 'es-fab';
        fab.innerHTML = `
            <svg id="es-progress" viewBox="0 0 50 50">
                <circle id="es-progress-circle" cx="25" cy="25" r="22.5"/>
            </svg>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2" style="position:relative;z-index:1;">
                <circle cx="12" cy="12" r="10"/>
                <rect x="9" y="9" width="6" height="6" rx="0.5" fill="#EF4444" stroke="none"/>
            </svg>
            <div id="es-tooltip">Аварійна зупинка (утримуйте 5 сек)</div>`;

        // Mouse events
        fab.addEventListener('mousedown', startHold);
        fab.addEventListener('mouseup', cancelHold);
        fab.addEventListener('mouseleave', cancelHold);

        // Touch events
        fab.addEventListener('touchstart', e => { e.preventDefault(); startHold(); }, { passive: false });
        fab.addEventListener('touchend', cancelHold);
        fab.addEventListener('touchcancel', cancelHold);

        document.body.appendChild(fab);
    }

    function startHold() {
        if (isExecuting) return;
        const fab = document.getElementById('es-fab');
        if (!fab) return;

        fab.classList.add('holding');
        holdStart = Date.now();

        const tooltip = document.getElementById('es-tooltip');

        // Update progress ring every 50ms
        progressInterval = setInterval(() => {
            const elapsed = Date.now() - holdStart;
            const progress = Math.min(elapsed / HOLD_DURATION, 1);
            const circle = document.getElementById('es-progress-circle');
            if (circle) {
                circle.style.strokeDashoffset = 141.37 * (1 - progress);
            }
            if (tooltip) {
                const remaining = Math.ceil((HOLD_DURATION - elapsed) / 1000);
                tooltip.textContent = remaining > 0
                    ? `Тримайте ще ${remaining} сек...`
                    : 'Виконую...';
            }
        }, 50);

        holdTimer = setTimeout(() => {
            clearInterval(progressInterval);
            executeEmergencyStop();
        }, HOLD_DURATION);
    }

    function cancelHold() {
        clearTimeout(holdTimer);
        clearInterval(progressInterval);
        holdTimer = null;
        holdStart = 0;

        const fab = document.getElementById('es-fab');
        if (fab) fab.classList.remove('holding');

        const circle = document.getElementById('es-progress-circle');
        if (circle) circle.style.strokeDashoffset = 141.37;

        const tooltip = document.getElementById('es-tooltip');
        if (tooltip) tooltip.textContent = 'Аварійна зупинка (утримуйте 5 сек)';
    }

    async function executeEmergencyStop() {
        isExecuting = true;
        const fab = document.getElementById('es-fab');
        if (fab) {
            fab.classList.remove('holding');
            fab.classList.add('executing');
        }

        const tooltip = document.getElementById('es-tooltip');
        if (tooltip) tooltip.textContent = 'Виконую...';

        try {
            const res = await fetch('/api/bots/emergency-stop', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include'
            });

            const data = await res.json();

            if (res.ok) {
                showResult(true, data.subscriptionsStopped || 0);
            } else {
                showResult(false, 0, data.error || 'Невідома помилка');
            }
        } catch (err) {
            showResult(false, 0, err.message);
        }

        isExecuting = false;
        if (fab) fab.classList.remove('executing');

        const circle = document.getElementById('es-progress-circle');
        if (circle) circle.style.strokeDashoffset = 141.37;
    }

    function showResult(success, subsStopped, errorMsg) {
        const overlay = document.createElement('div');
        overlay.id = 'es-overlay';
        overlay.innerHTML = `
            <div id="es-result">
                <svg width="52" height="52" viewBox="0 0 24 24" fill="none"
                     stroke="${success ? '#EF4444' : '#F59E0B'}" stroke-width="1.5"
                     style="display:block;margin:0 auto;">
                    ${success
                        ? '<circle cx="12" cy="12" r="10"/><rect x="9" y="9" width="6" height="6" rx="0.5" fill="#EF4444" stroke="none"/>'
                        : '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>'}
                </svg>
                <h3>${success ? 'Аварійну зупинку виконано' : 'Помилка'}</h3>
                <p>${success
                    ? `Всі боти зупинені. Відключено підписок: <strong style="color:#fff;">${subsStopped}</strong>`
                    : `Не вдалося виконати: ${errorMsg}`
                }</p>
                <button id="es-close-btn">Закрити</button>
            </div>`;

        document.body.appendChild(overlay);

        document.getElementById('es-close-btn').addEventListener('click', () => {
            overlay.remove();
            if (success) location.reload();
        });

        overlay.addEventListener('click', e => {
            if (e.target === overlay) {
                overlay.remove();
                if (success) location.reload();
            }
        });
    }

    // ── Init ──
    function init() {
        // Wait for currentUser to be available
        const check = setInterval(() => {
            if (window.currentUser) {
                clearInterval(check);
                if (window.currentUser.role === 'admin' || window.currentUser.role === 'moderator') {
                    injectStyles();
                    createButton();
                }
            }
        }, 500);

        // Stop checking after 15 seconds
        setTimeout(() => clearInterval(check), 15000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
