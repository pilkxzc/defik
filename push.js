#!/usr/bin/env node
'use strict';

/**
 * push.js — один запуск робить все:
 *  1. Бекап бази з VPS → локально в .backups/
 *  2. git add + commit + push → GitHub
 *  3. SSH на VPS: git pull + npm install (server + _src) + npm build + pm2 reload
 *
 *  Запуск: npm run push
 *          або: node push.js
 *          або: node push.js "опис змін"
 */

const { execSync, spawnSync } = require('child_process');
const fs             = require('fs');
const path           = require('path');
const readline       = require('readline');

// ── Конфіг ───────────────────────────────────────────────────────────────────
const VPS_HOST    = '188.137.178.124';
const VPS_USER    = 'root';
const VPS_KEY     = path.join(__dirname, '.ssh', 'deploy_key');
const BACKUP_DIR  = path.join(__dirname, '.backups');
const DB_FILES    = [
    'server/database.sqlite',
    'server/candles.sqlite',
];

// ── Кольори ──────────────────────────────────────────────────────────────────
const c = {
    reset:  '\x1b[0m',
    green:  '\x1b[32m',
    yellow: '\x1b[33m',
    blue:   '\x1b[34m',
    red:    '\x1b[31m',
    bold:   '\x1b[1m',
};
const ok   = msg => console.log(`${c.green}✅ ${msg}${c.reset}`);
const info = msg => console.log(`${c.blue}▶  ${msg}${c.reset}`);
const warn = msg => console.log(`${c.yellow}⚠  ${msg}${c.reset}`);
const fail = msg => { console.error(`${c.red}❌ ${msg}${c.reset}`); process.exit(1); };

function run(cmd, opts = {}) {
    try {
        return execSync(cmd, { encoding: 'utf8', stdio: opts.silent ? 'pipe' : 'inherit', ...opts });
    } catch (e) {
        if (opts.optional) { warn(`Пропущено: ${cmd}`); return ''; }
        fail(`Команда не вдалась:\n  ${cmd}\n  ${e.message}`);
    }
}

// ── 0. Перевірка конфігурації ─────────────────────────────────────────────────
function checkLocalDeps() {
    const pkgPath = path.join(__dirname, '_src', 'package.json');
    if (!fs.existsSync(pkgPath)) {
        fail('_src/package.json не знайдено!');
    }
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    info(`Ключові залежності _src/:`);
    for (const [name, ver] of Object.entries(deps)) {
        console.log(`   ${c.blue}•${c.reset} ${name}@${ver}`);
    }
    ok('npm install + build відбудеться на VPS автоматично');
}

// ── 1. Бекап бази з VPS ──────────────────────────────────────────────────────
function backupDB() {
    if (!fs.existsSync(VPS_KEY)) {
        warn('SSH ключ не знайдено (.ssh/deploy_key) — бекап пропущено');
        return;
    }

    fs.mkdirSync(BACKUP_DIR, { recursive: true });

    const date = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const sshOpts = `-i ${VPS_KEY} -o StrictHostKeyChecking=no -o BatchMode=yes`;

    for (const dbPath of DB_FILES) {
        const name   = path.basename(dbPath, '.sqlite');
        const remote = `/var/www/defisit/${dbPath}`;
        const local  = path.join(BACKUP_DIR, `${name}-${date}.sqlite`);

        info(`Бекап ${dbPath} з VPS...`);
        const result = spawnSync(
            'scp',
            ['-i', VPS_KEY, '-o', 'StrictHostKeyChecking=no', '-o', 'BatchMode=yes',
             `${VPS_USER}@${VPS_HOST}:${remote}`, local],
            { stdio: 'inherit' }
        );

        if (result.status === 0) {
            ok(`${name}.sqlite → .backups/${path.basename(local)}`);
        } else {
            warn(`Не вдалось скопіювати ${dbPath} (VPS недоступний?)`);
        }
    }

    // Видаляємо бекапи старіші 7 днів
    pruneBackups();
}

function pruneBackups() {
    if (!fs.existsSync(BACKUP_DIR)) return;
    const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
    for (const f of fs.readdirSync(BACKUP_DIR)) {
        const fp = path.join(BACKUP_DIR, f);
        if (fs.statSync(fp).mtimeMs < cutoff) {
            fs.unlinkSync(fp);
            warn(`Видалено старий бекап: ${f}`);
        }
    }
}

// ── 2. Git commit + push ──────────────────────────────────────────────────────
function gitPush(message) {
    const status = run('git status --porcelain', { silent: true }).trim();

    if (!status) {
        warn('Немає змін для коміту');
    } else {
        info('git add ...');
        run('git add .');

        const msg = message || `update: ${new Date().toLocaleString('uk-UA')}`;
        info(`git commit: "${msg}"`);
        run(`git commit -m "${msg.replace(/"/g, '\\"')}"`);
        ok('Коміт створено');
    }

    info('git push → GitHub...');
    run('git push origin main');
    ok('Запушено на GitHub');
}

// ── 3. Deploy на VPS через SSH ───────────────────────────────────────────────
function deployVPS() {
    if (!fs.existsSync(VPS_KEY)) {
        warn('SSH ключ не знайдено — деплой на VPS пропущено');
        return;
    }

    const sshArgs = [
        '-i', VPS_KEY,
        '-o', 'StrictHostKeyChecking=no',
        '-o', 'BatchMode=yes',
        `${VPS_USER}@${VPS_HOST}`,
    ];

    const script = `
set -e
cd /var/www/defisit

echo ">>> git pull..."
git pull origin main

echo ">>> npm install (server)..."
cd server && npm install --omit=dev --silent && cd ..

echo ">>> npm install (_src)..."
cd _src && npm install --silent && cd ..

echo ">>> build front-end..."
cd _src && npm run build && cd ..

echo ">>> pm2 reload..."
pm2 reload ecosystem.config.js --update-env

echo "DONE"
`;

    info('Підключаємось до VPS...');
    const result = spawnSync('ssh', [...sshArgs, script], { stdio: 'inherit' });

    if (result.status === 0) {
        ok('VPS оновлено, сервер перезапущено');
    } else {
        warn('Деплой на VPS завершився з помилкою — перевір вивід вище');
    }
}

// ── Prompt helper ─────────────────────────────────────────────────────────────
function ask(question) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans.trim().toLowerCase()); }));
}

// ── Main ─────────────────────────────────────────────────────────────────────
(async () => {
    console.log(`\n${c.bold}${'─'.repeat(50)}${c.reset}`);
    console.log(`${c.bold}  PUSH + DEPLOY${c.reset}`);
    console.log(`${c.bold}${'─'.repeat(50)}${c.reset}\n`);

    const commitMsg = process.argv[2] || '';

    info('[1/4] Перевірка залежностей...');
    checkLocalDeps();
    console.log('');

    info('[2/4] Бекап бази даних...');
    const backupAns = await ask(`${c.yellow}  Зробити бекап бази з VPS? [Y/n]: ${c.reset}`);
    if (backupAns === '' || backupAns === 'y' || backupAns === 'yes' || backupAns === 'т' || backupAns === 'так') {
        backupDB();
    } else {
        warn('Бекап пропущено');
    }
    console.log('');

    info('[3/4] Git commit + push...');
    gitPush(commitMsg);
    console.log('');

    info('[4/4] Деплой на VPS...');
    deployVPS();

    console.log('');
    console.log(`${c.bold}${'─'.repeat(50)}${c.reset}`);
    console.log(`${c.bold}  Готово!${c.reset}`);
    console.log(`${c.bold}${'─'.repeat(50)}${c.reset}\n`);
})();
