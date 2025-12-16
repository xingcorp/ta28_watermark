module.exports = {
  apps: [
    {
      name: "image-server",
      script: "./src/server.mjs",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      env: {
        PORT: 3000,
      },
    },
  ],
  deploy: {
    production: {
      user: "root",
      host: ["103.118.29.146"],
      ref: "origin/main",
      repo: "git@github.com:stupidrich-man/refundcash-telegram-listening.git",
      path: "/root/refundcash/refundcash-telegram-listening",
      "post-deploy":
        "source ~/.nvm/nvm.sh && npm install && pm2 startOrRestart ecosystem.image-server.config.js",
    },
  },
};
