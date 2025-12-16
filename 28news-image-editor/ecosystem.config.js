module.exports = {
  apps: [
    {
      name: "28news-frontend",
      script: "npm",
      args: "start",
      cwd: "/root/28news-media-editor-fe/source",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      env: {
        NODE_ENV: "production",
        PORT: 3001,
        BACKEND_BASE_URL: "http://localhost:3000",
        NEXT_PUBLIC_BACKEND_BASE_URL: "http://localhost:3000",
        BULLMQ_QUEUE_SUFFIX: "production",
      },
      env_development: {
        NODE_ENV: "development",
        PORT: 3001,
        BACKEND_BASE_URL: "http://localhost:3000",
        NEXT_PUBLIC_BACKEND_BASE_URL: "http://localhost:3000",
        BULLMQ_QUEUE_SUFFIX: "development",
      },
    },
  ],
  deploy: {
    production: {
      user: "root",
      host: ["185.188.249.171"],
      ref: "origin/main",
      repo: "git@github.com:stupidrich-man/28news-image-editor.git",
      path: "/root/28news-media-editor-fe",
      "post-deploy":
        "source ~/.nvm/nvm.sh && cd /root/28news-media-editor-fe/current && npm install && npm run build && pm2 startOrRestart ecosystem.config.js --only 28news-frontend",
    },
  },
};
