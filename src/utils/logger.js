// A tiny logger. It adds a timestamp and a level to every message,
// and hides the bot token if it ever appears in text by accident.

// Secrets that must never reach the console or a log file.
const SECRET_NAMES = ['DISCORD_TOKEN', 'GOOGLE_TRANSLATE_API_KEY'];

function redact(value) {
    let text = value instanceof Error ? (value.stack || value.message) : value;
    if (typeof text === 'string') {
        for (const name of SECRET_NAMES) {
            const secret = process.env[name];
            if (secret && secret.length >= 8) text = text.split(secret).join('[REDACTED]');
        }
    }
    return text;
}

function write(method, level, args) {
    const time = new Date().toISOString();
    console[method](`[${time}] [${level}]`, ...args.map(redact));
}

// Something (the owner's error alerts) can listen to errors. It gets the already cleaned text.
let errorSink = null;

module.exports = {
    info: (...args) => write('log', 'INFO', args),
    warn: (...args) => write('warn', 'WARN', args),
    error: (...args) => {
        write('error', 'ERROR', args);
        if (errorSink) { try { errorSink(args.map((a) => String(redact(a))).join(' ')); } catch { /* the alert must never break logging */ } }
    },
    setErrorSink: (fn) => { errorSink = typeof fn === 'function' ? fn : null; },
};
