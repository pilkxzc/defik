'use strict';

const BETA_CODE = process.env.BETA_CODE || '401483';

const BETA_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Yamato — Beta Access</title>
    <link rel="icon" type="image/svg+xml" href="/logo.svg">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; -webkit-font-smoothing: antialiased; }

        body {
            font-family: 'Plus Jakarta Sans', sans-serif;
            background: #080808;
            color: #fff;
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }

        .card {
            background: #141414;
            border: 1px solid rgba(255,255,255,0.06);
            border-radius: 32px;
            padding: 48px 40px;
            width: 100%;
            max-width: 420px;
            text-align: center;
            box-shadow: 0 24px 64px rgba(0,0,0,0.6);
        }

        .logo-wrap {
            width: 64px;
            height: 64px;
            background: rgba(16,185,129,0.1);
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            margin: 0 auto 24px;
        }
        .logo-wrap img { width: 36px; height: 36px; }

        .badge {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            background: rgba(139,92,246,0.12);
            color: #C4B5FD;
            border: 1px solid rgba(139,92,246,0.25);
            border-radius: 999px;
            padding: 4px 12px;
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            margin-bottom: 20px;
        }
        .badge::before {
            content: '';
            width: 6px; height: 6px;
            border-radius: 50%;
            background: #8B5CF6;
        }

        h1 {
            font-size: 26px;
            font-weight: 700;
            margin-bottom: 10px;
            line-height: 1.2;
        }

        .sub {
            color: #A1A1A1;
            font-size: 14px;
            line-height: 1.6;
            margin-bottom: 32px;
        }

        .input-wrap {
            position: relative;
            margin-bottom: 14px;
        }

        input[type="text"] {
            width: 100%;
            background: #1C1C1C;
            border: 1px solid rgba(255,255,255,0.08);
            border-radius: 16px;
            padding: 16px 20px;
            color: #fff;
            font-size: 18px;
            font-weight: 600;
            font-family: inherit;
            letter-spacing: 0.15em;
            text-align: center;
            transition: border-color 0.2s, box-shadow 0.2s;
            outline: none;
        }
        input[type="text"]:focus {
            border-color: #10B981;
            box-shadow: 0 0 0 3px rgba(16,185,129,0.15);
        }
        input[type="text"].error {
            border-color: #EF4444;
            box-shadow: 0 0 0 3px rgba(239,68,68,0.15);
        }
        input[type="text"]::placeholder { color: #636363; letter-spacing: 0.05em; font-size: 14px; font-weight: 400; }

        .err-msg {
            color: #EF4444;
            font-size: 13px;
            margin-bottom: 14px;
            display: none;
        }
        .err-msg.show { display: block; }

        button {
            width: 100%;
            background: #10B981;
            color: #fff;
            border: none;
            border-radius: 16px;
            padding: 16px;
            font-size: 15px;
            font-weight: 700;
            font-family: inherit;
            cursor: pointer;
            transition: opacity 0.2s, transform 0.1s;
        }
        button:hover  { opacity: 0.9; }
        button:active { transform: scale(0.98); }

        .footer {
            margin-top: 28px;
            color: #636363;
            font-size: 12px;
        }
    </style>
</head>
<body>
<div class="card">
    <div class="logo-wrap">
        <img src="/logo.svg" alt="Yamato">
    </div>

    <div class="badge">Beta Testing</div>

    <h1>Early Access</h1>
    <p class="sub">Yamato is currently in closed beta.<br>Enter your access code to continue.</p>

    <form method="POST" action="/beta" id="betaForm">
        <div class="input-wrap">
            <input
                type="text"
                name="code"
                id="codeInput"
                placeholder="Enter access code"
                maxlength="16"
                autocomplete="off"
                autofocus
            >
        </div>
        <div class="err-msg" id="errMsg">Invalid code. Please try again.</div>
        <button type="submit">Access Beta</button>
    </form>

    <p class="footer">Don't have a code? Contact the team.</p>
</div>

<script>
    // Show error if redirected back with ?error=1
    if (location.search.includes('error=1')) {
        document.getElementById('errMsg').classList.add('show');
        document.getElementById('codeInput').classList.add('error');
    }
    // Clear error styling on input
    document.getElementById('codeInput').addEventListener('input', function() {
        this.classList.remove('error');
        document.getElementById('errMsg').classList.remove('show');
    });
</script>
</body>
</html>`;

// Paths that are always allowed (no beta check)
const SKIP_PREFIXES = [
    '/beta',
    '/logo.svg',
    '/css/',
    '/fonts/',
    '/login',
    '/register',
    '/verify-email',
    '/reset-password',
    '/api/auth/login',
    '/api/auth/register',
    '/api/auth/logout',
    '/api/auth/me',
    '/api/auth/telegram-login-request',
    '/api/auth/telegram-login-verify',
    '/api/auth/telegram-bot-username',
    '/api/auth/telegram',
    '/api/auth/telegram-register',
    '/api/auth/google',
    '/api/auth/google/callback',
    '/api/auth/forgot-password',
    '/api/auth/reset-password',
    '/api/passkeys/',
    '/emergency',
    '/api/emergency/',
];
const SKIP_EXT_RE   = /\.(js|css|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|map)$/i;

function betaMiddleware(req, res, next) {
    // Already unlocked
    if (req.session?.betaAccess) return next();

    // Always allow static assets and the beta route itself
    if (
        SKIP_EXT_RE.test(req.path) ||
        SKIP_PREFIXES.some(p => req.path.startsWith(p))
    ) return next();

    // API calls get a JSON 403 instead of the HTML page
    if (req.path.startsWith('/api/')) {
        return res.status(403).json({ error: 'beta', message: 'Beta access required' });
    }

    // Show the beta gate page
    res.status(403).send(BETA_PAGE);
}

function betaSubmit(req, res) {
    const code = (req.body?.code || '').trim();
    if (code === BETA_CODE) {
        req.session.betaAccess = true;
        let redirectTo = req.body?.next || '/';
        // Prevent open redirect
        if (!redirectTo.startsWith('/') || redirectTo.startsWith('//')) {
            redirectTo = '/';
        }
        return res.redirect(redirectTo);
    }
    res.redirect('/beta?error=1');
}

module.exports = { betaMiddleware, betaSubmit };
