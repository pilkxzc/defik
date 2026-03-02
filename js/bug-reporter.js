/**
 * Yamato Bug Reporter
 * Alt+G — відкрити форму звіту
 * 1. Скріншот робиться ДО відкриття панелі (сторінка без модалки)
 * 2. Під час запису екрану — панель згортається в міні-бар
 * 3. Після зупинки запису — панель відновлюється
 */
(function () {
    'use strict';

    let enabled          = false;
    let logBuffer        = [];
    let errorCount       = 0;
    let mediaRecorder    = null;
    let recordingChunks  = [];
    let recordingStream  = null;
    let recordingTimer   = null;
    let recordingSeconds = 0;
    let modalOpen        = false;
    let pendingShot      = null;   // screenshot taken before modal opens
    let isMinimized      = false;

    const MAX_LOGS        = 150;
    const RECORDING_LIMIT = 120;

    // ── Console intercept ──────────────────────────────────────────────────────
    function hookConsole() {
        ['log', 'warn', 'error', 'info'].forEach(method => {
            const orig = console[method].bind(console);
            console[method] = function (...args) {
                orig(...args);
                push({ level: method, message: args.map(safeStr).join(' '), time: new Date().toISOString() });
                if (method === 'error') { errorCount++; scheduleHint(); }
            };
        });
        window.addEventListener('error', e => {
            push({ level: 'error', message: `[window] ${e.message} — ${e.filename}:${e.lineno}`, time: new Date().toISOString() });
            errorCount++; scheduleHint();
        });
        window.addEventListener('unhandledrejection', e => {
            const msg = e.reason instanceof Error ? e.reason.message : String(e.reason);
            push({ level: 'error', message: `[Promise] ${msg}`, time: new Date().toISOString() });
            errorCount++; scheduleHint();
        });
    }

    function safeStr(a) {
        try { return typeof a === 'object' ? JSON.stringify(a) : String(a); }
        catch { return String(a); }
    }

    function push(entry) {
        logBuffer.push(entry);
        if (logBuffer.length > MAX_LOGS) logBuffer.shift();
    }

    // ── Error hint toast ───────────────────────────────────────────────────────
    let hintTimeout = null;
    function scheduleHint() {
        if (modalOpen) return;
        clearTimeout(hintTimeout);
        hintTimeout = setTimeout(() => { if (!modalOpen) showHint(); }, 800);
    }

    function showHint() {
        const ex = document.getElementById('br-hint');
        if (ex) ex.remove();
        const el = document.createElement('div');
        el.id = 'br-hint';
        el.style.cssText = 'position:fixed;bottom:80px;right:20px;z-index:99990;background:#1a1a1a;border:1px solid rgba(239,68,68,0.4);border-radius:12px;padding:12px 16px;max-width:280px;display:flex;align-items:center;gap:12px;box-shadow:0 8px 32px rgba(0,0,0,0.5);animation:brSlideIn 0.3s ease;cursor:pointer;';
        el.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2" style="flex-shrink:0">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <div>
                <div style="font-size:13px;font-weight:600;color:#fff;">Виявлено помилку</div>
                <div style="font-size:11px;color:#A1A1A1;margin-top:2px;">Натисніть Alt+G, щоб надіслати звіт</div>
            </div>
            <button id="br-hint-x" style="margin-left:auto;background:none;border:none;color:#636363;cursor:pointer;padding:2px;display:flex;align-items:center;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>`;
        el.addEventListener('click', e => {
            if (e.target.closest('#br-hint-x')) { el.remove(); return; }
            el.remove(); openModal();
        });
        document.body.appendChild(el);
        setTimeout(() => el.remove(), 8000);
    }

    // ── html2canvas ────────────────────────────────────────────────────────────
    function loadHtml2Canvas() {
        return new Promise(resolve => {
            if (window.html2canvas) { resolve(); return; }
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
            s.onload = resolve;
            s.onerror = resolve;
            document.head.appendChild(s);
        });
    }

    async function takeScreenshot() {
        if (!window.html2canvas) return null;
        try {
            const canvas = await window.html2canvas(document.documentElement, {
                useCORS: true, allowTaint: true,
                scale: Math.min(window.devicePixelRatio || 1, 1.5),
                logging: false, imageTimeout: 6000
            });
            return canvas.toDataURL('image/png');
        } catch (e) {
            return null;
        }
    }

    // ── Screen recording ───────────────────────────────────────────────────────
    async function startRecording() {
        try {
            recordingStream = await navigator.mediaDevices.getDisplayMedia({
                video: { width: { max: 1920 }, height: { max: 1080 }, frameRate: { max: 15 } },
                audio: false
            });
            recordingChunks = [];
            const mime = MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
                ? 'video/webm;codecs=vp9' : 'video/webm';
            mediaRecorder = new MediaRecorder(recordingStream, { mimeType: mime });
            mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordingChunks.push(e.data); };
            mediaRecorder.start(1000);
            recordingStream.getVideoTracks()[0].addEventListener('ended', onStreamEnded);
            return true;
        } catch (e) {
            return false;
        }
    }

    function onStreamEnded() {
        // Stream stopped externally (user clicked browser's "Stop sharing")
        doStopRecording();
        restoreModal();
    }

    function doStopRecording() {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
        if (recordingStream) { recordingStream.getTracks().forEach(t => t.stop()); recordingStream = null; }
        clearInterval(recordingTimer); recordingTimer = null;
    }

    function getBlob() {
        return recordingChunks.length ? new Blob(recordingChunks, { type: 'video/webm' }) : null;
    }

    // ── Minimize / restore ─────────────────────────────────────────────────────
    function minimizeModal() {
        isMinimized = true;
        const overlay = document.getElementById('br-overlay');
        if (overlay) overlay.style.display = 'none';

        const bar = document.createElement('div');
        bar.id = 'br-mini';
        bar.innerHTML = `
            <div id="br-mini-dot"></div>
            <div id="br-mini-info">
                <span id="br-mini-lbl">Запис іде</span>
                <span id="br-mini-timer">0 сек</span>
            </div>
            <button id="br-mini-stop">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                    <rect x="3" y="3" width="18" height="18" rx="2"/>
                </svg>
                Зупинити запис
            </button>`;
        document.body.appendChild(bar);
        document.getElementById('br-mini-stop').addEventListener('click', stopAndRestore);
    }

    function stopAndRestore() {
        doStopRecording();
        const bar = document.getElementById('br-mini');
        if (bar) bar.remove();
        restoreModal();
    }

    function restoreModal() {
        isMinimized = false;
        const overlay = document.getElementById('br-overlay');
        if (overlay) overlay.style.display = 'flex';

        // Update recording section in the full modal
        const dot = document.getElementById('br-rec-dot');
        const lbl = document.getElementById('br-rec-label');
        const sub = document.getElementById('br-rec-sub');
        const btn = document.getElementById('br-rec-btn');
        if (dot) dot.className = 'br-rec-dot done';
        if (lbl) lbl.textContent = 'Запис завершено';
        if (sub) sub.textContent = `${recordingSeconds} сек. — відео готове до надсилання`;
        if (btn) btn.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/>
            </svg>
            Перезаписати`;
    }

    // ── CSS ────────────────────────────────────────────────────────────────────
    function injectStyles() {
        if (document.getElementById('br-styles')) return;
        const s = document.createElement('style');
        s.id = 'br-styles';
        s.textContent = `
            @keyframes brSlideIn { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
            @keyframes brFadeIn  { from{opacity:0} to{opacity:1} }
            @keyframes brPulse   { 0%,100%{opacity:1} 50%{opacity:0.3} }
            @keyframes brBlink   { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.5;transform:scale(0.85)} }

            /* FAB */
            #br-fab {
                position:fixed; bottom:20px; right:20px; z-index:99980;
                width:44px; height:44px; border-radius:50%;
                background:#141414; border:1px solid rgba(255,255,255,0.12);
                cursor:pointer; display:flex; align-items:center; justify-content:center;
                box-shadow:0 4px 20px rgba(0,0,0,0.5);
                transition:transform 0.2s, box-shadow 0.2s;
            }
            #br-fab:hover { transform:scale(1.1); box-shadow:0 6px 28px rgba(0,0,0,0.6); }
            #br-fab.has-errors { border-color:rgba(239,68,68,0.6); }
            #br-fab-badge {
                position:absolute; top:-4px; right:-4px;
                background:#EF4444; color:#fff; font-size:10px; font-weight:700;
                min-width:16px; height:16px; border-radius:8px;
                display:none; align-items:center; justify-content:center;
                padding:0 4px; line-height:1;
            }

            /* Overlay */
            #br-overlay {
                position:fixed; inset:0; z-index:99999;
                background:rgba(0,0,0,0.78); backdrop-filter:blur(10px);
                display:flex; align-items:center; justify-content:center;
                animation:brFadeIn 0.18s ease; padding:16px;
            }

            /* Modal */
            #br-modal {
                background:#141414; border:1px solid rgba(255,255,255,0.1);
                border-radius:24px; width:100%; max-width:640px;
                max-height:90vh; overflow-y:auto;
                box-shadow:0 28px 80px rgba(0,0,0,0.8);
                animation:brSlideIn 0.22s ease;
            }
            .br-header {
                display:flex; align-items:center; justify-content:space-between;
                padding:20px 24px 0;
            }
            .br-title {
                font-size:17px; font-weight:700; color:#fff;
                display:flex; align-items:center; gap:10px;
            }
            .br-close {
                width:32px; height:32px; border-radius:50%;
                background:rgba(255,255,255,0.07); border:none;
                color:#A1A1A1; cursor:pointer; display:flex;
                align-items:center; justify-content:center;
                transition:background 0.2s, color 0.2s;
            }
            .br-close:hover { background:rgba(255,255,255,0.15); color:#fff; }

            .br-body { padding:20px 24px 24px; display:flex; flex-direction:column; gap:16px; }

            .br-label {
                font-size:11px; font-weight:700; color:#636363;
                text-transform:uppercase; letter-spacing:0.06em;
                margin-bottom:6px; display:block;
            }

            /* Screenshot */
            .br-shot-wrap {
                border-radius:12px; overflow:hidden;
                border:1px solid rgba(255,255,255,0.08);
                background:#0a0a0a; position:relative;
            }
            .br-shot-wrap img { width:100%; display:block; }
            .br-shot-placeholder {
                padding:20px; text-align:center;
                color:#636363; font-size:12px;
                display:flex; align-items:center; justify-content:center; gap:8px;
            }

            /* Recording row */
            .br-rec-row {
                display:flex; align-items:center; gap:12px;
                padding:14px 16px; border-radius:14px;
                background:#0d0d0d; border:1px solid rgba(255,255,255,0.08);
            }
            .br-rec-dot {
                width:10px; height:10px; border-radius:50%;
                background:#333; flex-shrink:0; transition:background 0.3s;
            }
            .br-rec-dot.recording { background:#EF4444; animation:brBlink 1s ease infinite; }
            .br-rec-dot.done      { background:#10B981; }
            .br-rec-info { flex:1; }
            .br-rec-label { font-size:13px; font-weight:600; color:#fff; }
            .br-rec-sub   { font-size:11px; color:#636363; margin-top:3px; }

            /* How-to hint */
            .br-howto {
                padding:12px 14px; border-radius:12px;
                background:rgba(140,168,255,0.06); border:1px solid rgba(140,168,255,0.15);
                font-size:12px; color:#8CA8FF; line-height:1.6;
            }
            .br-howto strong { color:#fff; }

            /* Textarea */
            .br-textarea {
                width:100%; min-height:80px; max-height:180px;
                background:#0d0d0d; border:1px solid rgba(255,255,255,0.1);
                border-radius:12px; color:#fff; font-size:14px;
                padding:12px 14px; resize:vertical; outline:none;
                font-family:inherit; box-sizing:border-box;
                transition:border-color 0.2s; line-height:1.5;
            }
            .br-textarea:focus { border-color:#10B981; }
            .br-textarea::placeholder { color:#3a3a3a; }

            /* Logs */
            .br-logs-box {
                background:#090909; border:1px solid rgba(255,255,255,0.06);
                border-radius:12px; padding:10px 12px;
                max-height:130px; overflow-y:auto;
                font-family:'Courier New',monospace; font-size:11px; line-height:1.5;
            }
            .br-log-entry { margin:0 0 1px; white-space:pre-wrap; word-break:break-all; }
            .br-log-entry.error { color:#EF4444; }
            .br-log-entry.warn  { color:#F59E0B; }
            .br-log-entry.info  { color:#8CA8FF; }
            .br-log-entry.log   { color:#505050; }

            /* Buttons */
            .br-btn {
                padding:10px 18px; border-radius:10px; border:none;
                font-size:13px; font-weight:700; cursor:pointer;
                display:inline-flex; align-items:center; gap:8px;
                transition:opacity 0.2s, transform 0.1s;
            }
            .br-btn:active { transform:scale(0.97); }
            .br-btn:hover:not(:disabled) { opacity:0.82; }
            .br-btn.primary { background:#10B981; color:#fff; }
            .br-btn.ghost   { background:rgba(255,255,255,0.07); color:#A1A1A1; border:1px solid rgba(255,255,255,0.1); }
            .br-btn:disabled { opacity:0.35; cursor:not-allowed; }
            .br-footer { display:flex; gap:10px; justify-content:flex-end; flex-wrap:wrap; }

            /* Progress */
            .br-prog-wrap { margin-top:4px; }
            .br-prog-track { background:rgba(255,255,255,0.06); border-radius:2px; overflow:hidden; height:3px; }
            .br-prog-bar   { height:3px; background:#10B981; border-radius:2px; transition:width 0.4s; }
            .br-prog-lbl   { font-size:11px; color:#636363; margin-top:6px; text-align:center; }

            /* Success */
            .br-success { text-align:center; padding:28px 24px; color:#10B981; font-size:15px; font-weight:600; }

            /* ── Mini recording bar (while minimized) ── */
            #br-mini {
                position:fixed; bottom:24px; left:50%; transform:translateX(-50%);
                z-index:99999;
                background:#141414; border:1px solid rgba(239,68,68,0.45);
                border-radius:50px; padding:10px 18px 10px 16px;
                display:flex; align-items:center; gap:12px;
                box-shadow:0 8px 40px rgba(0,0,0,0.7);
                animation:brSlideIn 0.2s ease;
                white-space:nowrap;
            }
            #br-mini-dot {
                width:10px; height:10px; border-radius:50%;
                background:#EF4444; flex-shrink:0;
                animation:brBlink 1s ease infinite;
            }
            #br-mini-info {
                display:flex; align-items:center; gap:8px;
            }
            #br-mini-lbl {
                font-size:13px; font-weight:600; color:#fff;
            }
            #br-mini-timer {
                font-size:12px; color:#A1A1A1;
                font-variant-numeric:tabular-nums;
            }
            #br-mini-stop {
                padding:7px 14px; border-radius:50px;
                background:rgba(239,68,68,0.15); border:1px solid rgba(239,68,68,0.35);
                color:#EF4444; font-size:12px; font-weight:700;
                cursor:pointer; display:flex; align-items:center; gap:6px;
                transition:background 0.2s;
            }
            #br-mini-stop:hover { background:rgba(239,68,68,0.25); }
        `;
        document.head.appendChild(s);
    }

    // ── Build modal HTML ───────────────────────────────────────────────────────
    function buildModal(shotDataUrl) {
        const overlay = document.createElement('div');
        overlay.id = 'br-overlay';

        const shotHTML = shotDataUrl
            ? `<img src="${shotDataUrl}" alt="Скріншот сторінки">`
            : `<div class="br-shot-placeholder">
                   <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                       <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/>
                       <polyline points="21 15 16 10 5 21"/>
                   </svg>
                   Скріншот недоступний
               </div>`;

        overlay.innerHTML = `
            <div id="br-modal">
                <div class="br-header">
                    <span class="br-title">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2">
                            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                            <line x1="12" y1="9" x2="12" y2="13"/>
                            <line x1="12" y1="17" x2="12.01" y2="17"/>
                        </svg>
                        Повідомити про помилку
                    </span>
                    <button class="br-close" id="br-close-btn">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                    </button>
                </div>

                <div class="br-body" id="br-form-body">

                    <!-- Screenshot -->
                    <div>
                        <span class="br-label">Скріншот сторінки</span>
                        <div class="br-shot-wrap" id="br-shot-wrap">${shotHTML}</div>
                    </div>

                    <!-- Recording section -->
                    <div>
                        <span class="br-label">Запис екрану</span>
                        <div class="br-rec-row">
                            <div class="br-rec-dot" id="br-rec-dot"></div>
                            <div class="br-rec-info">
                                <div class="br-rec-label" id="br-rec-label">Не розпочато</div>
                                <div class="br-rec-sub" id="br-rec-sub">Натисніть «Почати», оберіть екран — і відтворіть проблему</div>
                            </div>
                            <button class="br-btn ghost" id="br-rec-btn">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <circle cx="12" cy="12" r="10"/>
                                    <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/>
                                </svg>
                                Почати
                            </button>
                        </div>

                        <!-- Instruction hint (shown only before recording) -->
                        <div class="br-howto" id="br-howto" style="margin-top:10px;">
                            <strong>Як записати відео:</strong><br>
                            1. Натисніть «Почати» — браузер запитає дозвіл на захоплення екрану<br>
                            2. Оберіть вкладку або весь екран і підтвердіть<br>
                            3. Панель звіту <strong>згорнеться</strong> — ви зможете вільно відтворити помилку<br>
                            4. Натисніть «Зупинити запис» у мінімізованому рядку внизу<br>
                            5. Панель розгорнеться з готовим відео — заповніть опис і надішліть
                        </div>
                    </div>

                    <!-- Description -->
                    <div>
                        <span class="br-label">Опис проблеми</span>
                        <textarea class="br-textarea" id="br-desc"
                            placeholder="Що сталося? Які кроки призвели до помилки? Що ви очікували побачити?"></textarea>
                    </div>

                    <!-- Console logs -->
                    <div>
                        <span class="br-label">Консольні логи
                            <span style="font-weight:400;text-transform:none;font-size:10px;margin-left:4px;"
                                  id="br-log-count"></span>
                        </span>
                        <div class="br-logs-box" id="br-logs-box">
                            <span style="color:#333;font-size:11px;">Немає логів</span>
                        </div>
                    </div>

                    <!-- Footer -->
                    <div class="br-footer">
                        <button class="br-btn ghost" id="br-cancel-btn">Скасувати</button>
                        <button class="br-btn primary" id="br-submit-btn">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <line x1="22" y1="2" x2="11" y2="13"/>
                                <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                            </svg>
                            Надіслати звіт
                        </button>
                    </div>

                    <!-- Progress (hidden) -->
                    <div id="br-prog-wrap" style="display:none;" class="br-prog-wrap">
                        <div class="br-prog-track"><div class="br-prog-bar" id="br-prog-bar" style="width:0%"></div></div>
                        <div class="br-prog-lbl" id="br-prog-lbl">Надсилання...</div>
                    </div>

                </div>
            </div>`;
        return overlay;
    }

    // ── Open modal ─────────────────────────────────────────────────────────────
    async function openModal() {
        if (modalOpen) return;
        modalOpen = true;

        injectStyles();

        // 1. Take screenshot BEFORE modal appears (page is still clean)
        await loadHtml2Canvas();
        pendingShot = await takeScreenshot();

        // 2. Now build and inject the modal (screenshot already ready)
        const overlay = buildModal(pendingShot);
        document.body.appendChild(overlay);

        // 3. Wire events
        document.getElementById('br-close-btn').addEventListener('click', closeModal);
        document.getElementById('br-cancel-btn').addEventListener('click', closeModal);
        overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
        document.getElementById('br-rec-btn').addEventListener('click', onRecordClick);
        document.getElementById('br-submit-btn').addEventListener('click', submitReport);

        renderLogs();
    }

    function closeModal() {
        if (isMinimized) {
            const bar = document.getElementById('br-mini');
            if (bar) bar.remove();
            isMinimized = false;
        }
        doStopRecording();
        const overlay = document.getElementById('br-overlay');
        if (overlay) overlay.remove();
        modalOpen = false;
        pendingShot = null;
    }

    function renderLogs() {
        const box  = document.getElementById('br-logs-box');
        const cnt  = document.getElementById('br-log-count');
        if (!box) return;
        if (!logBuffer.length) return;
        if (cnt) cnt.textContent = `(${logBuffer.length})`;
        box.innerHTML = logBuffer.map(e =>
            `<div class="br-log-entry ${e.level}">[${e.level.toUpperCase()}] ${e.time.substring(11,19)} ${esc(e.message)}</div>`
        ).join('');
        box.scrollTop = box.scrollHeight;
    }

    function esc(s) {
        return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    // ── Recording button handler ───────────────────────────────────────────────
    async function onRecordClick() {
        const btn = document.getElementById('br-rec-btn');
        const dot = document.getElementById('br-rec-dot');
        const lbl = document.getElementById('br-rec-label');
        const sub = document.getElementById('br-rec-sub');

        // Already recorded — offer to re-record
        if (recordingChunks.length && (!mediaRecorder || mediaRecorder.state !== 'recording')) {
            recordingChunks = [];
            recordingSeconds = 0;
            if (dot) dot.className = 'br-rec-dot';
            if (lbl) lbl.textContent = 'Не розпочато';
            if (sub) sub.textContent = 'Натисніть «Почати», оберіть екран — і відтворіть проблему';
            if (btn) btn.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/>
                </svg>
                Почати`;
            return;
        }

        // Start recording
        if (btn) { btn.disabled = true; btn.textContent = 'Підключаю...'; }
        const ok = await startRecording();

        if (!ok) {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = `
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/>
                    </svg>
                    Спробувати ще`;
            }
            if (lbl) lbl.textContent = 'Помилка доступу';
            if (sub) sub.textContent = 'Браузер не надав дозвіл на запис екрану';
            return;
        }

        // Recording started — minimize the modal
        recordingSeconds = 0;
        if (btn) btn.disabled = false;

        // Hide instruction hint
        const howto = document.getElementById('br-howto');
        if (howto) howto.style.display = 'none';

        minimizeModal();

        // Timer updates the mini bar
        recordingTimer = setInterval(() => {
            recordingSeconds++;
            const t = document.getElementById('br-mini-timer');
            if (t) t.textContent = formatTime(recordingSeconds);
            if (recordingSeconds >= RECORDING_LIMIT) stopAndRestore();
        }, 1000);
    }

    function formatTime(s) {
        const m = Math.floor(s / 60);
        const sec = s % 60;
        return m > 0 ? `${m}:${String(sec).padStart(2,'0')} хв` : `${sec} сек`;
    }

    // ── Submit ─────────────────────────────────────────────────────────────────
    async function submitReport() {
        const submitBtn = document.getElementById('br-submit-btn');
        const cancelBtn = document.getElementById('br-cancel-btn');
        const progWrap  = document.getElementById('br-prog-wrap');
        const progBar   = document.getElementById('br-prog-bar');
        const progLbl   = document.getElementById('br-prog-lbl');

        submitBtn.disabled = true;
        cancelBtn.disabled = true;
        progWrap.style.display = 'block';

        const description = (document.getElementById('br-desc').value || '').trim();
        setProgress(progBar, progLbl, 10, 'Відправляю звіт...');

        try {
            const resp = await fetch('/api/bug-report', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({
                    description,
                    logs: logBuffer.slice(),
                    screenshot: pendingShot || null,
                    page_url: window.location.href,
                    user_agent: navigator.userAgent
                })
            });

            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                throw new Error(err.error || `HTTP ${resp.status}`);
            }

            const { reportId } = await resp.json();
            setProgress(progBar, progLbl, 50, 'Звіт прийнято...');

            const blob = getBlob();
            if (blob && reportId) {
                setProgress(progBar, progLbl, 60, 'Завантажую відео...');
                try {
                    await fetch(`/api/bug-report/${reportId}/video`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'video/webm' },
                        credentials: 'same-origin',
                        body: blob
                    });
                } catch {}
            }

            setProgress(progBar, progLbl, 100, 'Готово!');

            const body = document.getElementById('br-form-body');
            if (body) {
                body.innerHTML = `
                    <div class="br-success">
                        <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="1.5"
                             style="display:block;margin:0 auto 16px;">
                            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                            <polyline points="22 4 12 14.01 9 11.01"/>
                        </svg>
                        <div>Звіт #${reportId} надіслано</div>
                        <div style="font-size:13px;color:#636363;margin-top:8px;font-weight:400;">
                            Дякуємо! Адміністратор отримає сповіщення.
                        </div>
                    </div>`;
                setTimeout(closeModal, 2400);
            }

            errorCount = 0;
            updateFab();
        } catch (err) {
            progWrap.style.display = 'none';
            submitBtn.disabled = false;
            cancelBtn.disabled = false;
            setProgress(progBar, progLbl, 0, '');
            alert(`Помилка: ${err.message}`);
        }
    }

    function setProgress(bar, lbl, pct, text) {
        if (bar) bar.style.width = pct + '%';
        if (lbl) lbl.textContent = text;
    }

    // ── FAB ────────────────────────────────────────────────────────────────────
    function createFab() {
        if (document.getElementById('br-fab')) return;
        const fab = document.createElement('button');
        fab.id    = 'br-fab';
        fab.title = 'Повідомити про помилку (Alt+G)';
        fab.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#A1A1A1" stroke-width="2">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/>
                <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            <span id="br-fab-badge"></span>`;
        fab.addEventListener('click', openModal);
        document.body.appendChild(fab);
    }

    function updateFab() {
        const fab   = document.getElementById('br-fab');
        const badge = document.getElementById('br-fab-badge');
        if (!fab || !badge) return;
        if (errorCount > 0) {
            fab.classList.add('has-errors');
            badge.textContent = errorCount > 9 ? '9+' : errorCount;
            badge.style.display = 'flex';
        } else {
            fab.classList.remove('has-errors');
            badge.style.display = 'none';
        }
    }

    // ── Init ───────────────────────────────────────────────────────────────────
    async function init() {
        try {
            const r = await fetch('/api/admin/bug-reporting-enabled', { credentials: 'same-origin' });
            if (!r.ok) return;
            enabled = !!(await r.json()).enabled;
        } catch { return; }

        if (!enabled) return;

        injectStyles();
        hookConsole();

        // Pre-load html2canvas silently so screenshot is instant when needed
        loadHtml2Canvas();

        document.addEventListener('keydown', e => {
            if (e.altKey && (e.key === 'g' || e.key === 'G' || e.key === 'і' || e.key === 'І')) {
                e.preventDefault();
                if (modalOpen && !isMinimized) closeModal();
                else if (!modalOpen) openModal();
            }
        });

        function setup() { createFab(); updateFab(); }
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup);
        else setup();

        setInterval(updateFab, 3000);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
