// Pure helpers for question of the day.
const MIN_LEN = 10, MAX_LEN = 300, MAX_QUESTIONS = 200;
const OFFSET_RANGE = [-12, 14];
const DAY_MS = 86400000;

// "9:30" or "21:05" (24-hour clock) -> { hour, minute } or null
function parseTime(text) {
    const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(String(text ?? '')); if (!m) return null;
    const hour = Number(m[1]), minute = Number(m[2]); return hour <= 23 && minute <= 59 ? { hour, minute } : null;
}
const formatTime = (h, m) => `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
const validOffset = (n) => Number.isInteger(n) && n >= OFFSET_RANGE[0] && n <= OFFSET_RANGE[1];

// Cleans a question: one paragraph, no mass pings, sensible length. Returns { ok, text, error }.
function cleanQuestion(raw) {
    const text = String(raw ?? '').replace(/\u0000/g, '').replace(/@(everyone|here)/gi, '@​$1').replace(/\s+/g, ' ').trim();
    if (text.length < MIN_LEN) return { ok: false, error: `Make the question at least ${MIN_LEN} characters.` };
    if (text.length > MAX_LEN) return { ok: false, error: `Keep the question under ${MAX_LEN} characters.` };
    return { ok: true, text };
}

// The server's own local day number and minutes since midnight, for a UTC offset in hours.
function localClock(nowMs, offsetHours) { const local = nowMs + offsetHours * 3600000; return { day: Math.floor(local / DAY_MS), minutes: Math.floor((local % DAY_MS) / 60000) }; }
// Is today's question due? (time has passed and today has not been posted)
const isDue = (cfg, lastDay, nowMs) => { const c = localClock(nowMs, cfg.utcOffset); return c.minutes >= cfg.hour * 60 + cfg.minute && (lastDay == null || lastDay < c.day); };

function threadName(n, text) { return `QOTD #${n}: ${text}`.replace(/[\r\n]+/g, ' ').slice(0, 90); }

module.exports = { MIN_LEN, MAX_LEN, MAX_QUESTIONS, OFFSET_RANGE, parseTime, formatTime, validOffset, cleanQuestion, localClock, isDue, threadName };
