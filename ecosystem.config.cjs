// pm2 process file for the server (scripts/server-setup.sh). ONE instance on purpose:
// the WeChat debounce timers, the sync_msg cursor and the SQLite connection live in this process (blueprint §3).
module.exports = {
  apps: [
    {
      name: "memini",
      script: "node_modules/next/dist/bin/next",
      args: "start -p 3000 -H 127.0.0.1",
      cwd: __dirname,
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "1G",
      env: { NODE_ENV: "production" },
      time: true,
    },
  ],
};
