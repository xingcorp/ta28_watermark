module.exports = {
  /**
   * Cấu hình PM2 cho các ứng dụng
   *
   * Để chạy từng ứng dụng riêng biệt trên các server khác nhau:
   *
   * 1. Cho server chỉ chạy signals-forward:
   *    - pm2 start ecosystem.signals-forward.config.js
   *    - pm2 deploy production ecosystem.signals-forward.config.js
   *
   * 2. Cho server chỉ chạy image-server:
   *    - pm2 start ecosystem.image-server.config.js
   *    - pm2 deploy production ecosystem.image-server.config.js
   *
   * 3. Để chạy cả hai trên cùng một server:
   *    - pm2 start ecosystem.config.js
   *    - pm2 deploy production
   */
  apps: [
    // {
    //   name: "signals-forward",
    //   script: "./src/signals-forward.mjs",
    //   instances: 1,
    //   autorestart: true,
    //   watch: false,
    //   max_memory_restart: "800M",
    //   env: {
    //     NODE_ENV: "production",
    //   },
    // },
    {
      name: "image-server",
      script: "./src/server.mjs",
      instances: 1, // Giảm từ max xuống 2 instances
      exec_mode: "cluster",
      autorestart: true,
      watch: false,
      max_memory_restart: "1G", // Giảm memory limit
      node_args: "--max-old-space-size=2048 --optimize-for-size",
      env: {
        PORT: 3000,
        NODE_ENV: "production",
        UV_THREADPOOL_SIZE: 32, // Giảm thread pool
      },
    },
    {
      name: "image-worker",
      script: "./src/image-worker.mjs",
      instances: 1, // Giảm xuống 1 worker
      autorestart: true,
      watch: false,
      max_memory_restart: "1G", // Giảm memory
      node_args:
        "--max-old-space-size=3072 --optimize-for-size --gc-interval=100",
      env: {
        NODE_ENV: "production",
        UV_THREADPOOL_SIZE: 16, // Giảm thread pool
      },
    },
    {
      name: "video-worker",
      script: "./src/video-worker.mjs",
      instances: 2, // Giảm xuống 1 worker
      autorestart: true,
      watch: false,
      max_memory_restart: "2G", // Giảm memory
      node_args:
        "--max-old-space-size=4096 --optimize-for-size --gc-interval=100",
      env: {
        NODE_ENV: "production",
        UV_THREADPOOL_SIZE: 16, // Giảm thread pool
        FFMPEG_THREADS: 4, // Giảm FFmpeg threads
      },
    },
  ],
  deploy: {
    production: {
      user: "root",
      host: ["185.188.249.171"],
      ref: "origin/main",
      repo: "git@github.com:stupidrich-man/refundcash-telegram-listening.git",
      path: "/root/refundcash/refundcash-telegram-listening",
      "post-deploy":
        "source ~/.nvm/nvm.sh && npm install && pm2 startOrRestart ecosystem.config.js",
    },
  },
};
