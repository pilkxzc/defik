// pm2 ecosystem — запуск з кореня проекту:
//   pm2 start ecosystem.config.js
//   pm2 reload ecosystem.config.js   ← zero-downtime restart
//   pm2 save && pm2 startup           ← автозапуск після reboot

module.exports = {
  apps: [
    {
      name: 'defisit',
      script: 'server/server.js',

      // Cwd — корінь проекту (де лежать /page, /js, /css)
      cwd: '/var/www/defisit',

      // Режим fork (один процес — сервер сам відкриває HTTP+HTTPS)
      instances: 1,
      exec_mode: 'fork',

      // Автоперезапуск при краші, але не більше 10 разів підряд
      autorestart: true,
      max_restarts: 10,
      restart_delay: 2000,

      // Не перезапускати якщо процес вмирає < 10s після старту (вказує на баг)
      min_uptime: '10s',

      // Env змінні
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        HTTPS_PORT: 3443,
        HOST: '0.0.0.0',
      },

      // Логи
      out_file: '/var/log/defisit/out.log',
      error_file: '/var/log/defisit/error.log',
      merge_logs: true,
      log_date_format: 'YYYY-MM-DD HH:mm:ss',

      // Не слідкувати за файлами (не потрібно в prod)
      watch: false,
    },
  ],
};
