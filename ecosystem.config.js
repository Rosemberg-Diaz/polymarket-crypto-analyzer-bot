module.exports = {
  apps: [
    {
      name: "polymarket-crypto-analyzer-bot",
      script: "dist/main.js",
      cwd: __dirname,
      interpreter: "node",
      instances: 1,
      autorestart: true,
      watch: false,
      exec_mode: "fork",
      max_memory_restart: "512M",
      restart_delay: 5000,
      exp_backoff_restart_delay: 1000,
      kill_timeout: 10000,
      listen_timeout: 10000,
      max_restarts: 20,
      min_uptime: "30s",
      merge_logs: true,
      time: true,
      env: {
        NODE_ENV: "production",
        APP_MODE: "LIVE_TRADING",
        ENABLE_REAL_TRADING: "true",
        REAL_STAKE_USD: "5",
        MARKET_CATEGORY: "CRYPTO",
        PRIORITY_ASSETS: "BTC,ETH,SOL,XRP,DOGE,BNB",
        PRIORITIZE_SHORT_TERM_UP_DOWN: "true"
      },
      error_file: "logs/pm2-error.log",
      out_file: "logs/pm2-out.log",
      log_file: "logs/pm2-combined.log",
      pid_file: "logs/polymarket-crypto-analyzer-bot.pid"
    }
  ]
};
