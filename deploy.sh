#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  deploy.sh  —  збірка + деплой на сервер
#  Використання:  ./deploy.sh [server_ip_or_hostname]
#  Приклад:       ./deploy.sh 185.123.45.67
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

# ── Конфіг ──────────────────────────────────────────────────────────────────
SERVER="${1:-}"          # IP або hostname сервера (або перший аргумент)
SSH_USER="root"
DEPLOY_PATH="/var/www/defisit"
SSH_KEY="${SSH_KEY:-}"   # необов'язково: шлях до приватного ключа

if [[ -z "$SERVER" ]]; then
  echo "Використання: ./deploy.sh <server_ip>"
  echo "Або встанови SERVER= перед запуском:"
  echo "  SERVER=185.x.x.x ./deploy.sh"
  exit 1
fi

SSH_OPTS="-o StrictHostKeyChecking=no"
[[ -n "$SSH_KEY" ]] && SSH_OPTS="$SSH_OPTS -i $SSH_KEY"

REMOTE="${SSH_USER}@${SERVER}"

echo "▶ Сервер: $REMOTE:$DEPLOY_PATH"
echo ""

# ── 1. Білд React-чарту ──────────────────────────────────────────────────────
echo "▶ [1/4] Збірка React-чарту (TypeScript → IIFE bundle)..."
cd "$(dirname "$0")/chart"
npm run build
cd ..
echo "   ✓ js/chart/chart.js готовий"
echo ""

# ── 2. rsync — синхронізуємо файли на сервер ─────────────────────────────────
echo "▶ [2/4] rsync файлів на $REMOTE:$DEPLOY_PATH ..."

rsync -avz --progress \
  $SSH_OPTS \
  --exclude='.git/' \
  --exclude='.claude/' \
  --exclude='chart/node_modules/' \
  --exclude='chart/.vite/' \
  --exclude='server/node_modules/' \
  --exclude='server/database.sqlite' \
  --exclude='server/sessions.json' \
  --exclude='server/ssl/' \
  --exclude='uploads/' \
  --exclude='*.log' \
  --exclude='.DS_Store' \
  --exclude='node_modules/' \
  . "${REMOTE}:${DEPLOY_PATH}/"

echo ""

# ── 3. Сервер: npm install + логи ──────────────────────────────────────────
echo "▶ [3/4] npm install на сервері..."

ssh $SSH_OPTS "$REMOTE" bash << EOF
  set -e
  mkdir -p /var/log/defisit

  cd ${DEPLOY_PATH}/server
  npm install --omit=dev --silent

  echo "   ✓ node_modules готові"
EOF

echo ""

# ── 4. pm2: зупиняємо старе, запускаємо через ecosystem ─────────────────────
echo "▶ [4/4] Перезапуск pm2..."

ssh $SSH_OPTS "$REMOTE" bash << EOF
  set -e
  cd ${DEPLOY_PATH}

  # Зупиняємо старі процеси (якщо є) — ігноруємо помилку якщо не запущені
  pm2 delete defisit     2>/dev/null || true
  pm2 delete defis-server 2>/dev/null || true

  # Запускаємо через ecosystem.config.js
  pm2 start ecosystem.config.js

  # Зберігаємо список процесів для автозапуску
  pm2 save

  echo ""
  pm2 status
EOF

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅  Деплой завершено!"
echo "  🌐  http://${SERVER}:3000"
echo "  🔒  https://${SERVER}:3443"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
