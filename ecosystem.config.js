module.exports = {
  apps: [
    {
      name: "polymarket-crypto-analyzer-bot",
      script: "dist/main.js",
      cwd: __dirname,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "256M",
      env: {
        NODE_ENV: "production",
        APP_MODE: "SIMULATION_ONLY",
        ENABLE_REAL_TRADING: "false"
      },
      error_file: "logs/pm2-error.log",
      out_file: "logs/pm2-out.log",
      log_file: "logs/pm2-combined.log"
    }
  ]
};
