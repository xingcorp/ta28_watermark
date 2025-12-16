module.exports = {
  apps: [
    {
      name: "image-worker",
      script: "./src/image-worker.mjs",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        REDIS_URL: "redis://default:wvAKmgAAdSKPzrByT9vp@161.97.132.49:6379/1"
      },
      log_file: "./logs/image-worker.log",
      error_file: "./logs/image-worker-error.log",
      out_file: "./logs/image-worker-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      restart_delay: 5000,
      max_restarts: 10,
      min_uptime: "10s",
      watch: false,
      ignore_watch: ["node_modules", "logs", "media_temp", "processed"],
      kill_timeout: 5000,
    }
  ]
};
