#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
#  server-setup.sh — одноразовий скрипт для підготовки сервера
#  Запустити ОДИН РАЗ на сервері:  bash server-setup.sh
#
#  Що робить:
#   1. Знаходить де зараз живуть процеси pm2
#   2. Зберігає database.sqlite / sessions.json / settings.json / ssl/
#   3. Створює /var/www/defisit зі структурою
#   4. Переносить дані зі старого місця
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

DEPLOY_PATH="/var/www/defisit"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Yamato Server — підготовка /var/www/defisit"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

# ── Знаходимо поточний шлях старого сервера ──────────────────────────────────
OLD_SERVER_PATH=$(pm2 jlist 2>/dev/null | \
  python3 -c "
import sys,json
procs = json.load(sys.stdin)
for p in procs:
    pm2_env = p.get('pm2_env', {})
    name = pm2_env.get('name','')
    if name in ('defisit','defis-server'):
        cwd = pm2_env.get('pm_cwd','')
        print(cwd)
        break
" 2>/dev/null || true)

echo "Поточний шлях процесу pm2: ${OLD_SERVER_PATH:-'не знайдено'}"
echo ""

# ── Структура папок ───────────────────────────────────────────────────────────
echo "▶ Створюємо /var/www/defisit/server/ ..."
mkdir -p "${DEPLOY_PATH}/server/ssl"
mkdir -p "${DEPLOY_PATH}/page"
mkdir -p "${DEPLOY_PATH}/js/chart"
mkdir -p "${DEPLOY_PATH}/css"
mkdir -p "${DEPLOY_PATH}/uploads"
mkdir -p /var/log/defisit
echo "  ✓"

# ── Переносимо критичні файли зі старого місця ───────────────────────────────
if [[ -n "$OLD_SERVER_PATH" && "$OLD_SERVER_PATH" != "$DEPLOY_PATH/server" ]]; then
  echo ""
  echo "▶ Переносимо дані зі старого місця: $OLD_SERVER_PATH ..."

  for f in database.sqlite sessions.json settings.json; do
    SRC="${OLD_SERVER_PATH}/${f}"
    DST="${DEPLOY_PATH}/server/${f}"
    if [[ -f "$SRC" && ! -f "$DST" ]]; then
      cp "$SRC" "$DST"
      echo "  ✓ $f"
    elif [[ -f "$DST" ]]; then
      echo "  ⊘ $f — вже є в $DEPLOY_PATH/server/, не перезаписуємо"
    fi
  done

  # SSL сертифікати
  if [[ -d "${OLD_SERVER_PATH}/ssl" ]]; then
    for cert in key.pem cert.pem; do
      SRC="${OLD_SERVER_PATH}/ssl/${cert}"
      DST="${DEPLOY_PATH}/server/ssl/${cert}"
      if [[ -f "$SRC" && ! -f "$DST" ]]; then
        cp "$SRC" "$DST"
        echo "  ✓ ssl/$cert"
      fi
    done
  fi

  # Uploads
  if [[ -d "${OLD_SERVER_PATH}/../uploads" ]]; then
    cp -rn "${OLD_SERVER_PATH}/../uploads/." "${DEPLOY_PATH}/uploads/" 2>/dev/null || true
    echo "  ✓ uploads/"
  fi

  echo "  ✓ Дані перенесено"
else
  echo "  ⊘ Старе місце не знайдено або збігається — пропускаємо перенос"
fi

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  ✅  Підготовка завершена!"
echo ""
echo "  Далі — запустити deploy.sh з локальної машини:"
echo "  ./deploy.sh <SERVER_IP>"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
