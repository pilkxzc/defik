#!/usr/bin/env bash
# Запускається ОДИН РАЗ на VPS щоб підключити git
# ssh root@YOUR_VPS "bash -s" < vps-setup.sh
set -euo pipefail

DEPLOY_PATH="/var/www/defisit"
REPO_URL="${1:-}"   # передай як аргумент: bash vps-setup.sh https://github.com/you/repo.git

if [[ -z "$REPO_URL" ]]; then
  echo "Використання: bash vps-setup.sh https://github.com/USER/REPO.git"
  exit 1
fi

echo "▶ Перевіряємо що pm2 та git встановлені..."
command -v git  >/dev/null || { apt-get install -y git;  }
command -v pm2  >/dev/null || { npm install -g pm2;      }

if [[ -d "$DEPLOY_PATH/.git" ]]; then
  echo "▶ Репо вже є, оновлюємо remote..."
  git -C "$DEPLOY_PATH" remote set-url origin "$REPO_URL"
else
  echo "▶ Клонуємо репо в $DEPLOY_PATH..."

  # Зберігаємо важливі файли якщо папка вже існує
  BACKUP="/root/defisit-backup-$(date +%s)"
  if [[ -d "$DEPLOY_PATH" ]]; then
    echo "   Бекап існуючих даних → $BACKUP"
    mkdir -p "$BACKUP"
    [[ -f "$DEPLOY_PATH/server/database.sqlite" ]]  && cp "$DEPLOY_PATH/server/database.sqlite"  "$BACKUP/"
    [[ -f "$DEPLOY_PATH/server/candles.sqlite"  ]]  && cp "$DEPLOY_PATH/server/candles.sqlite"   "$BACKUP/"
    [[ -f "$DEPLOY_PATH/server/sessions.json"   ]]  && cp "$DEPLOY_PATH/server/sessions.json"    "$BACKUP/"
    [[ -f "$DEPLOY_PATH/server/settings.json"   ]]  && cp "$DEPLOY_PATH/server/settings.json"    "$BACKUP/"
    [[ -d "$DEPLOY_PATH/server/ssl"             ]]  && cp -r "$DEPLOY_PATH/server/ssl"           "$BACKUP/"
    [[ -d "$DEPLOY_PATH/uploads"                ]]  && cp -r "$DEPLOY_PATH/uploads"              "$BACKUP/"
    echo "   Бекап збережено."
    rm -rf "$DEPLOY_PATH"
  fi

  git clone "$REPO_URL" "$DEPLOY_PATH"

  # Відновлюємо дані з бекапу
  if [[ -d "$BACKUP" ]]; then
    echo "▶ Відновлюємо дані з бекапу..."
    mkdir -p "$DEPLOY_PATH/server/ssl" "$DEPLOY_PATH/uploads"
    [[ -f "$BACKUP/database.sqlite"  ]] && cp "$BACKUP/database.sqlite"  "$DEPLOY_PATH/server/"
    [[ -f "$BACKUP/candles.sqlite"   ]] && cp "$BACKUP/candles.sqlite"   "$DEPLOY_PATH/server/"
    [[ -f "$BACKUP/sessions.json"    ]] && cp "$BACKUP/sessions.json"    "$DEPLOY_PATH/server/"
    [[ -f "$BACKUP/settings.json"    ]] && cp "$BACKUP/settings.json"    "$DEPLOY_PATH/server/"
    [[ -d "$BACKUP/ssl"              ]] && cp -r "$BACKUP/ssl/."         "$DEPLOY_PATH/server/ssl/"
    [[ -d "$BACKUP/uploads"          ]] && cp -r "$BACKUP/uploads/."     "$DEPLOY_PATH/uploads/"
    echo "   Дані відновлено."
  fi
fi

echo "▶ npm install..."
cd "$DEPLOY_PATH/server" && npm install --omit=dev --silent
cd "$DEPLOY_PATH/_src"   && npm install --silent && npm run build

echo "▶ Запускаємо через pm2..."
cd "$DEPLOY_PATH"
pm2 delete defisit 2>/dev/null || true
pm2 start ecosystem.config.js
pm2 save
pm2 startup | tail -1 | bash || true

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅ VPS налаштовано!"
echo "  Тепер додай GitHub Secrets:"
echo "    VPS_HOST    = IP твого VPS"
echo "    VPS_USER    = root"
echo "    VPS_SSH_KEY = вміст ~/.ssh/id_rsa (приватний ключ)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
