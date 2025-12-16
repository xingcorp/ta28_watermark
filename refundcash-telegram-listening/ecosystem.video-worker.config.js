module.exports = {
  apps: [
    {
      name: "video-worker",
      script: "./src/video-worker.mjs",
      instances: 1,
      exec_mode: "fork",
      env: {
        NODE_ENV: "production",
        REDIS_URL: "redis://default:wvAKmgAAdSKPzrByT9vp@161.97.132.49:6379/1"
      },
      log_file: "./logs/video-worker.log",
      error_file: "./logs/video-worker-error.log",
      out_file: "./logs/video-worker-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z",
      restart_delay: 10000,
      max_restarts: 5,
      min_uptime: "30s",
      watch: false,
      ignore_watch: ["node_modules", "logs", "media_temp", "processed", "temp_uploads"],
      kill_timeout: 30000, // Increased timeout for video processing
      max_memory_restart: "2G", // Higher memory limit for video processing
    }
  ]
};