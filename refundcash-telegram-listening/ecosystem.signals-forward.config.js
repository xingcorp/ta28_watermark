module.exports = {
  apps: [
    {
      name: "signals-forward",
      script: "./src/signals-forward.mjs",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
    },
  ],
  deploy: {
    production: {
      user: "root",
      host: ["194.233.93.217"], // Thay đổi IP này nếu server khác
      ref: "origin/main",
      repo: "git@github.com:stupidrich-man/refundcash-telegram-listening.git",
      path: "/root/refundcash/refundcash-telegram-listening",
      "post-deploy":
        "source ~/.nvm/nvm.sh && npm install && pm2 startOrRestart ecosystem.signals-forward.config.js",
    },
  },
};
