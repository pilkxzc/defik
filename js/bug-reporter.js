/**
 * Yamato Bug Reporter
 * Alt+G — open bug report modal on any page
 * Captures: console logs, screenshot (html2canvas), screen recording (MediaRecorder)
 * Sends report to /api/bug-report  +  video to /api/bug-report/:id/video
 */
(function () {
    'use strict';

    let enabled = false;
    let logBuffer = [];          // last N console entries
    let errorCount = 0;          // errors since page load
    let mediaRecorder = null;
    let recordingChunks = [];
    let recordingStream = null;
    let recordingTimer = null;
    let recordingSeconds = 0;
    let html2canvasReady = false;
    let modalOpen = false;

    const MAX_LOGS = 150;
    const RECORDING_LIMIT = 120; // seconds

    // ── Intercept console ──────────────────────────────────────────────────────
    function hookConsole() {
        const methods = ['log', 'warn', 'error', 'info'];
        methods.forEach(method => {
            const orig = console[method].bind(console);
            console[method] = function (...args) {
                orig(...args);
                const entry = {
                    level: method,
                    message: args.map(a => {
                        try { return typeof a === 'object' ? JSON.stringify(a) : String(a); }
                        catch { return String(a); }
                    }).join(' '),
                    time: new Date().toISOString()
                };
                logBuffer.push(entry);
                if (logBuffer.length > MAX_LOGS) logBuffer.shift();

                if (method === 'error') {
                    errorCount++;
                    scheduleErrorHint();
                }
            };
        });

        window.addEventListener('error', e => {
            logBuffer.push({ level: 'error', message: `[window] ${e.message} — ${e.filename}:${e.lineno}`, time: new Date().toISOString() });
            if (logBuffer.length > MAX_LOGS) logBuffer.shift();
            errorCount++;
            scheduleErrorHint();
        });

        window.addEventListener('unhandledrejection', e => {
            const msg = e.reason instanceof Error ? e.reason.message : String(e.reason);
            logBuffer.push({ level: 'error', message: `[Promise] ${msg}`, time: new Date().toISOString() });
            if (logBuffer.length > MAX_LOGS) logBuffer.shift();
            errorCount++;
            scheduleErrorHint();
        });
    }

    // ── Error hint toast ───────────────────────────────────────────────────────
    let hintTimeout = null;
    function scheduleErrorHint() {
        if (modalOpen) return;
        clearTimeout(hintTimeout);
        hintTimeout = setTimeout(() => {
            if (!modalOpen) showErrorHint();
        }, 800);
    }

    function showErrorHint() {
        const existing = document.getElementById('br-error-hint');
        if (existing) existing.remove();

        const hint = document.createElement('div');
        hint.id = 'br-error-hint';
        hint.style.cssText = `
            position:fixed; bottom:80px; right:20px; z-index:99990;
            background:#1a1a1a; border:1px solid rgba(239,68,68,0.4);
            border-radius:12px; padding:12px 16px; max-width:280px;
            display:flex; align-items:center; gap:12px;
            box-shadow:0 8px 32px rgba(0,0,0,0.5);
            animation:brSlideIn 0.3s ease;
            cursor:pointer;
        `;
        hint.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2" style="flex-shrink:0">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/>
                <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <div>
                <div style="font-size:13px;font-weight:600;color:#fff;">Виявлено помилку</div>
                <div style="font-size:11px;color:#A1A1A1;margin-top:2px;">Натисніть Alt+G щоб надіслати звіт</div>
            </div>
            <button id="br-hint-close" style="margin-left:auto;background:none;border:none;color:#636363;cursor:pointer;padding:2px;display:flex;align-items:center;">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
            </button>
        `;
        hint.addEventListener('click', e => {
            if (e.target.closest('#br-hint-close')) { hint.remove(); return; }
            hint.remove();
            openModal();
        });
        document.body.appendChild(hint);
        setTimeout(() => hint.remove(), 8000);
    }

    // ── Load html2canvas lazily ────────────────────────────────────────────────
    function loadHtml2Canvas() {
        return new Promise(resolve => {
            if (window.html2canvas) { html2canvasReady = true; resolve(); return; }
            const s = document.createElement('script');
            s.src = 'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js';
            s.onload = () => { html2canvasReady = true; resolve(); };
            s.onerror = () => resolve(); // fail silently
            document.head.appendChild(s);
        });
    }

    // ── Take screenshot ────────────────────────────────────────────────────────
    async function takeScreenshot() {
        if (!window.html2canvas) return null;
        try {
            const canvas = await window.html2canvas(document.documentElement, {
                useCORS: true, allowTaint: true,
                scale: Math.min(window.devicePixelRatio || 1, 1.5),
                logging: false, imageTimeout: 5000
            });
            return canvas.toDataURL('image/png');
        } catch (e) {
            console.warn('[BugReporter] Screenshot failed:', e.message);
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
            mediaRecorder = new MediaRecorder(recordingStream, {
                mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9')
                    ? 'video/webm;codecs=vp9'
                    : 'video/webm'
            });
            mediaRecorder.ondataavailable = e => { if (e.data.size > 0) recordingChunks.push(e.data); };
            mediaRecorder.start(1000);

            recordingStream.getVideoTracks()[0].addEventListener('ended', stopRecording);
            return true;
        } catch (e) {
            if (e.name !== 'NotAllowedError') console.warn('[BugReporter] Recording failed:', e.message);
            return false;
        }
    }

    function stopRecording() {
        if (mediaRecorder && mediaRecorder.state !== 'inactive') {
            mediaRecorder.stop();
        }
        if (recordingStream) {
            recordingStream.getTracks().forEach(t => t.stop());
            recordingStream = null;
        }
        clearInterval(recordingTimer);
        recordingTimer = null;
    }

    function getRecordingBlob() {
        if (!recordingChunks.length) return null;
        return new Blob(recordingChunks, { type: 'video/webm' });
    }

    // ── Inject styles ──────────────────────────────────────────────────────────
    function injectStyles() {
        if (document.getElementById('br-styles')) return;
        const style = document.createElement('style');
        style.id = 'br-styles';
        style.textContent = `
            @keyframes brSlideIn {
                from { opacity:0; transform:translateY(10px); }
                to   { opacity:1; transform:translateY(0); }
            }
            @keyframes brFadeIn {
                from { opacity:0; }
                to   { opacity:1; }
            }
            @keyframes brPulse {
                0%,100% { opacity:1; }
                50%  { opacity:0.4; }
            }

            #br-fab {
                position:fixed; bottom:20px; right:20px; z-index:99980;
                width:44px; height:44px; border-radius:50%;
                background:#1a1a1a; border:1px solid rgba(255,255,255,0.12);
                cursor:pointer; display:flex; align-items:center; justify-content:center;
                box-shadow:0 4px 20px rgba(0,0,0,0.4);
                transition:transform 0.2s, box-shadow 0.2s;
            }
            #br-fab:hover { transform:scale(1.1); box-shadow:0 6px 28px rgba(0,0,0,0.5); }
            #br-fab.has-errors { border-color:rgba(239,68,68,0.5); }
            #br-fab-badge {
                position:absolute; top:-4px; right:-4px;
                background:#EF4444; color:#fff;
                font-size:10px; font-weight:700; min-width:16px; height:16px;
                border-radius:8px; display:none; align-items:center; justify-content:center;
                padding:0 4px; line-height:1;
            }

            #br-overlay {
                position:fixed; inset:0; z-index:99999;
                background:rgba(0,0,0,0.75); backdrop-filter:blur(8px);
                display:flex; align-items:center; justify-content:center;
                animation:brFadeIn 0.2s ease;
                padding:16px;
            }
            #br-modal {
                background:#141414; border:1px solid rgba(255,255,255,0.1);
                border-radius:24px; width:100%; max-width:640px;
                max-height:90vh; overflow-y:auto;
                box-shadow:0 24px 80px rgba(0,0,0,0.7);
                animation:brSlideIn 0.25s ease;
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
                align-items:center; justify-content:center; flex-shrink:0;
                transition:background 0.2s, color 0.2s;
            }
            .br-close:hover { background:rgba(255,255,255,0.15); color:#fff; }

            .br-body { padding:20px 24px 24px; display:flex; flex-direction:column; gap:16px; }

            .br-label {
                font-size:11px; font-weight:700; color:#636363;
                text-transform:uppercase; letter-spacing:0.06em;
                margin-bottom:6px; display:block;
            }

            .br-screenshot-wrap {
                border-radius:12px; overflow:hidden;
                border:1px solid rgba(255,255,255,0.08);
                background:#0a0a0a; min-height:80px;
                display:flex; align-items:center; justify-content:center;
                position:relative;
            }
            #br-screenshot-img { width:100%; display:block; border-radius:12px; }
            .br-screenshot-loader {
                color:#636363; font-size:13px;
                display:flex; align-items:center; gap:8px; padding:24px;
            }
            .br-spinner {
                width:16px; height:16px; border:2px solid #333;
                border-top-color:#10B981; border-radius:50%;
                animation:brPulse 0.8s linear infinite;
            }

            .br-textarea {
                width:100%; min-height:90px; max-height:200px;
                background:#0d0d0d; border:1px solid rgba(255,255,255,0.1);
                border-radius:12px; color:#fff; font-size:14px;
                padding:12px 14px; resize:vertical; outline:none;
                font-family:inherit; box-sizing:border-box;
                transition:border-color 0.2s;
            }
            .br-textarea:focus { border-color:#10B981; }

            .br-logs-box {
                background:#0a0a0a; border:1px solid rgba(255,255,255,0.06);
                border-radius:12px; padding:10px 12px;
                max-height:140px; overflow-y:auto;
                font-family:'Courier New',monospace; font-size:11px;
                line-height:1.5;
            }
            .br-log-entry { margin:0 0 2px; white-space:pre-wrap; word-break:break-all; }
            .br-log-entry.error { color:#EF4444; }
            .br-log-entry.warn  { color:#F59E0B; }
            .br-log-entry.info  { color:#8CA8FF; }
            .br-log-entry.log   { color:#636363; }

            .br-rec-row {
                display:flex; align-items:center; gap:12px;
                padding:12px 14px; border-radius:12px;
                background:#0d0d0d; border:1px solid rgba(255,255,255,0.08);
            }
            .br-rec-dot {
                width:10px; height:10px; border-radius:50%; background:#636363; flex-shrink:0;
            }
            .br-rec-dot.recording { background:#EF4444; animation:brPulse 1s ease infinite; }
            .br-rec-dot.done      { background:#10B981; animation:none; }
            .br-rec-info { flex:1; }
            .br-rec-label { font-size:13px; font-weight:600; color:#fff; }
            .br-rec-sub   { font-size:11px; color:#636363; margin-top:2px; }

            .br-btn {
                padding:10px 18px; border-radius:10px; border:none;
                font-size:13px; font-weight:700; cursor:pointer;
                display:inline-flex; align-items:center; gap:8px;
                transition:opacity 0.2s, transform 0.1s;
            }
            .br-btn:active { transform:scale(0.97); }
            .br-btn:hover  { opacity:0.85; }
            .br-btn.primary { background:#10B981; color:#fff; }
            .br-btn.danger  { background:rgba(239,68,68,0.15); color:#EF4444; border:1px solid rgba(239,68,68,0.3); }
            .br-btn.ghost   { background:rgba(255,255,255,0.07); color:#A1A1A1; border:1px solid rgba(255,255,255,0.1); }
            .br-btn:disabled { opacity:0.4; cursor:not-allowed; }

            .br-footer {
                display:flex; gap:10px; justify-content:flex-end; flex-wrap:wrap;
            }

            .br-progress {
                height:3px; background:#10B981;
                border-radius:2px; transition:width 0.3s;
            }
            .br-success {
                text-align:center; padding:24px; color:#10B981;
                font-size:15px; font-weight:600;
            }
        `;
        document.head.appendChild(style);
    }

    // ── Build modal DOM ────────────────────────────────────────────────────────
    function buildModal() {
        const overlay = document.createElement('div');
        overlay.id = 'br-overlay';
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
                            <line x1="18" y1="6" x2="6" y2="18"/>
                            <line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                    </button>
                </div>

                <div class="br-body" id="br-form-body">
                    <!-- Screenshot -->
                    <div>
                        <span class="br-label">Скріншот сторінки</span>
                        <div class="br-screenshot-wrap" id="br-screenshot-wrap">
                            <div class="br-screenshot-loader" id="br-screenshot-loader">
                                <div class="br-spinner"></div>
                                Захоплення скріншоту...
                            </div>
                            <img id="br-screenshot-img" style="display:none;" alt="screenshot">
                        </div>
                    </div>

                    <!-- Recording -->
                    <div>
                        <span class="br-label">Запис екрану</span>
                        <div class="br-rec-row">
                            <div class="br-rec-dot" id="br-rec-dot"></div>
                            <div class="br-rec-info">
                                <div class="br-rec-label" id="br-rec-label">Не розпочато</div>
                                <div class="br-rec-sub"  id="br-rec-sub">Запишіть відео, щоб показати проблему</div>
                            </div>
                            <button class="br-btn ghost" id="br-rec-btn">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <circle cx="12" cy="12" r="10"/>
                                    <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/>
                                </svg>
                                Почати
                            </button>
                        </div>
                    </div>

                    <!-- Description -->
                    <div>
                        <span class="br-label">Опис проблеми</span>
                        <textarea class="br-textarea" id="br-desc"
                            placeholder="Опишіть, що сталося. Які дії призвели до помилки?"></textarea>
                    </div>

                    <!-- Console logs -->
                    <div>
                        <span class="br-label">Консольні логи (останні <span id="br-log-count">0</span>)</span>
                        <div class="br-logs-box" id="br-logs-box">
                            <div style="color:#636363;font-size:11px;">Немає логів</div>
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

                    <!-- Progress bar (hidden by default) -->
                    <div id="br-progress-wrap" style="display:none;">
                        <div style="background:rgba(255,255,255,0.06);border-radius:2px;overflow:hidden;">
                            <div class="br-progress" id="br-progress-bar" style="width:0%"></div>
                        </div>
                        <div style="font-size:11px;color:#636363;margin-top:6px;text-align:center;" id="br-progress-label">Надсилання...</div>
                    </div>
                </div>
            </div>
        `;
        return overlay;
    }

    // ── Open modal ─────────────────────────────────────────────────────────────
    async function openModal() {
        if (modalOpen) return;
        modalOpen = true;

        injectStyles();
        const overlay = buildModal();
        document.body.appendChild(overlay);

        // Wiring
        document.getElementById('br-close-btn').addEventListener('click', closeModal);
        document.getElementById('br-cancel-btn').addEventListener('click', closeModal);
        overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
        document.getElementById('br-rec-btn').addEventListener('click', toggleRecording);
        document.getElementById('br-submit-btn').addEventListener('click', submitReport);

        // Fill logs
        renderLogs();

        // Screenshot
        await loadHtml2Canvas();
        const shot = await takeScreenshot();
        if (shot) {
            document.getElementById('br-screenshot-loader').style.display = 'none';
            const img = document.getElementById('br-screenshot-img');
            img.src = shot;
            img.style.display = 'block';
        } else {
            document.getElementById('br-screenshot-loader').innerHTML =
                '<span style="color:#636363;font-size:12px;">Скріншот недоступний</span>';
        }
    }

    function closeModal() {
        stopRecording();
        const overlay = document.getElementById('br-overlay');
        if (overlay) overlay.remove();
        modalOpen = false;
    }

    function renderLogs() {
        const box = document.getElementById('br-logs-box');
        const countEl = document.getElementById('br-log-count');
        if (!box) return;
        if (!logBuffer.length) return;
        countEl.textContent = logBuffer.length;
        box.innerHTML = logBuffer.map(e =>
            `<div class="br-log-entry ${e.level}">[${e.level.toUpperCase()}] ${e.time.substring(11, 19)} ${escHtml(e.message)}</div>`
        ).join('');
        box.scrollTop = box.scrollHeight;
    }

    function escHtml(s) {
        return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    }

    // ── Recording toggle ───────────────────────────────────────────────────────
    async function toggleRecording() {
        const btn = document.getElementById('br-rec-btn');
        const dot = document.getElementById('br-rec-dot');
        const lbl = document.getElementById('br-rec-label');
        const sub = document.getElementById('br-rec-sub');

        if (mediaRecorder && mediaRecorder.state === 'recording') {
            // Stop
            stopRecording();
            btn.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/>
                </svg>
                Перезаписати`;
            dot.className = 'br-rec-dot done';
            lbl.textContent = 'Запис завершено';
            sub.textContent = `${recordingSeconds} сек. відео готове`;
            return;
        }

        // Start
        btn.disabled = true;
        btn.textContent = 'Дозволяю...';
        const ok = await startRecording();
        if (!ok) {
            btn.disabled = false;
            btn.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="3" fill="currentColor" stroke="none"/>
                </svg>
                Почати`;
            lbl.textContent = 'Не вдалося';
            sub.textContent = 'Дозвіл не надано або браузер не підтримує';
            return;
        }

        recordingSeconds = 0;
        dot.className = 'br-rec-dot recording';
        lbl.textContent = 'Запис...';
        sub.textContent = '0 сек.';
        btn.disabled = false;
        btn.innerHTML = `
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#EF4444" stroke-width="2">
                <rect x="3" y="3" width="18" height="18" rx="2" fill="rgba(239,68,68,0.2)"/>
            </svg>
            Зупинити`;

        recordingTimer = setInterval(() => {
            recordingSeconds++;
            if (document.getElementById('br-rec-sub'))
                document.getElementById('br-rec-sub').textContent = `${recordingSeconds} сек.`;
            if (recordingSeconds >= RECORDING_LIMIT) {
                stopRecording();
                const btn2 = document.getElementById('br-rec-btn');
                const dot2 = document.getElementById('br-rec-dot');
                if (btn2) btn2.textContent = 'Ліміт досягнуто';
                if (dot2) dot2.className = 'br-rec-dot done';
                if (document.getElementById('br-rec-label'))
                    document.getElementById('br-rec-label').textContent = 'Запис завершено';
            }
        }, 1000);
    }

    // ── Submit ─────────────────────────────────────────────────────────────────
    async function submitReport() {
        const submitBtn = document.getElementById('br-submit-btn');
        const cancelBtn = document.getElementById('br-cancel-btn');
        const progressWrap = document.getElementById('br-progress-wrap');
        const progressBar = document.getElementById('br-progress-bar');
        const progressLbl = document.getElementById('br-progress-label');

        submitBtn.disabled = true;
        cancelBtn.disabled = true;
        progressWrap.style.display = 'block';

        const description = document.getElementById('br-desc').value.trim();
        const screenshotEl = document.getElementById('br-screenshot-img');
        const screenshot = screenshotEl.style.display !== 'none' ? screenshotEl.src : null;

        setProgress(progressBar, progressLbl, 10, 'Відправляю звіт...');

        try {
            const resp = await fetch('/api/bug-report', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    description,
                    logs: logBuffer.slice(),
                    screenshot: screenshot && screenshot.startsWith('data:') ? screenshot : null,
                    page_url: window.location.href,
                    user_agent: navigator.userAgent
                }),
                credentials: 'same-origin'
            });

            if (!resp.ok) {
                const err = await resp.json().catch(() => ({}));
                throw new Error(err.error || `HTTP ${resp.status}`);
            }

            const data = await resp.json();
            const reportId = data.reportId;
            setProgress(progressBar, progressLbl, 50, 'Звіт надіслано...');

            // Upload video if available
            const videoBlob = getRecordingBlob();
            if (videoBlob && reportId) {
                setProgress(progressBar, progressLbl, 55, 'Завантажую відео...');
                try {
                    await fetch(`/api/bug-report/${reportId}/video`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'video/webm' },
                        body: videoBlob,
                        credentials: 'same-origin'
                    });
                } catch (ve) {
                    console.warn('[BugReporter] Video upload failed:', ve.message);
                }
            }

            setProgress(progressBar, progressLbl, 100, 'Готово!');

            // Show success state
            const body = document.getElementById('br-form-body');
            if (body) {
                body.innerHTML = `
                    <div class="br-success">
                        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#10B981" stroke-width="2" style="margin-bottom:12px;display:block;margin-inline:auto;">
                            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                            <polyline points="22 4 12 14.01 9 11.01"/>
                        </svg>
                        <div>Звіт #${reportId} успішно надіслано</div>
                        <div style="font-size:13px;color:#636363;margin-top:8px;font-weight:400;">Дякуємо! Адміністратор буде сповіщений.</div>
                    </div>
                `;
                setTimeout(closeModal, 2500);
            }

            // Reset error counter
            errorCount = 0;
            updateFab();
        } catch (err) {
            setProgress(progressBar, progressLbl, 0, '');
            progressWrap.style.display = 'none';
            submitBtn.disabled = false;
            cancelBtn.disabled = false;
            alert(`Помилка відправки: ${err.message}`);
        }
    }

    function setProgress(bar, lbl, pct, text) {
        if (bar) bar.style.width = pct + '%';
        if (lbl) lbl.textContent = text;
    }

    // ── FAB button ─────────────────────────────────────────────────────────────
    function createFab() {
        if (document.getElementById('br-fab')) return;
        const fab = document.createElement('button');
        fab.id = 'br-fab';
        fab.title = 'Повідомити про помилку (Alt+G)';
        fab.innerHTML = `
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#A1A1A1" stroke-width="2">
                <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
                <line x1="12" y1="9" x2="12" y2="13"/>
                <line x1="12" y1="17" x2="12.01" y2="17"/>
            </svg>
            <span id="br-fab-badge" style="position:absolute;top:-4px;right:-4px;background:#EF4444;color:#fff;font-size:10px;font-weight:700;min-width:16px;height:16px;border-radius:8px;display:none;align-items:center;justify-content:center;padding:0 4px;line-height:1;"></span>
        `;
        fab.addEventListener('click', openModal);
        document.body.appendChild(fab);
    }

    function updateFab() {
        const fab = document.getElementById('br-fab');
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
            const resp = await fetch('/api/admin/bug-reporting-enabled', { credentials: 'same-origin' });
            if (!resp.ok) return;
            const data = await resp.json();
            enabled = !!data.enabled;
        } catch (e) {
            return;
        }

        if (!enabled) return;

        injectStyles();
        hookConsole();

        document.addEventListener('keydown', e => {
            if (e.altKey && (e.key === 'g' || e.key === 'G' || e.key === 'і' || e.key === 'І')) {
                e.preventDefault();
                if (modalOpen) closeModal(); else openModal();
            }
        });

        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => {
                createFab();
                updateFab();
            });
        } else {
            createFab();
            updateFab();
        }

        // Refresh FAB badge periodically
        setInterval(updateFab, 3000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
