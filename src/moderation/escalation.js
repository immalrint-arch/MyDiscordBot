// Pure rules for warn escalation ("3 warnings = 1 hour timeout").
const ACTIONS = ['timeout', 'kick', 'ban'];
const MAX_RULES = 10, MAX_THRESHOLD = 50, MAX_TIMEOUT_MINUTES = 40320, MAX_WINDOW_DAYS = 365;

// Returns { rule } or { problem }.
function validateRule({ threshold, action, durationMinutes = null }) {
    if (!Number.isInteger(threshold) || threshold < 1 || threshold > MAX_THRESHOLD) return { problem: `The number of warnings must be 1 to ${MAX_THRESHOLD}.` };
    if (!ACTIONS.includes(action)) return { problem: 'The action must be timeout, kick or ban.' };
    if (action === 'timeout') {
        if (!Number.isInteger(durationMinutes) || durationMinutes < 1 || durationMinutes > MAX_TIMEOUT_MINUTES) return { problem: `A timeout needs a length from 1 minute to ${MAX_TIMEOUT_MINUTES} minutes (28 days).` };
        return { rule: { threshold, action, durationMinutes } };
    }
    return { rule: { threshold, action, durationMinutes: null } };
}
const pickRule = (rules, count) => rules.find((r) => r.threshold === count) ?? null;
const sinceIso = (windowDays, now) => (windowDays > 0 ? new Date(now - windowDays * 86400000).toISOString() : null);
const minutesText = (m) => (m % 1440 === 0 ? `${m / 1440} day${m === 1440 ? '' : 's'}` : m % 60 === 0 ? `${m / 60} hour${m === 60 ? '' : 's'}` : `${m} minute${m === 1 ? '' : 's'}`);
const describeRule = (r) => `${r.threshold} warning${r.threshold === 1 ? '' : 's'} → ${r.action === 'timeout' ? `timeout for ${minutesText(r.durationMinutes)}` : r.action}`;

module.exports = { ACTIONS, MAX_RULES, MAX_THRESHOLD, MAX_TIMEOUT_MINUTES, MAX_WINDOW_DAYS, validateRule, pickRule, sinceIso, minutesText, describeRule };
