// pm2 settings for Incomu: `pm2 start ecosystem.config.js`
module.exports = {
    apps: [{
        name: 'incomu',
        script: 'index.js',
        autorestart: true,
        max_restarts: 20,          // gives up after 20 quick crashes in a row, so a broken update does not loop forever
        min_uptime: '30s',         // a run shorter than this counts as a crash
        restart_delay: 5000,       // wait 5 seconds before restarting
        max_memory_restart: '400M', // restart if memory grows past this
        time: true,                // add a time to every log line
    }],
};
