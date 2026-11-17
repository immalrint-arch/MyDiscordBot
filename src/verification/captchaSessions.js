// Remembers the captcha each person is currently solving, and who is locked out.
// Kept in memory on purpose: a captcha only lives a few minutes, so a restart just means "press Verify again".
// No Discord code here, so it is easy to test.
const SESSION_MS = 5 * 60 * 1000; // a code is valid for 5 minutes
const LOCKOUT_MS = 10 * 60 * 1000; // too many wrong answers = wait 10 minutes
const MAX_REFRESHES = 5; // "New code" can be used 5 times per 10 minutes
const REFRESH_WINDOW_MS = 10 * 60 * 1000;

function createCaptchaSessions({ now = Date.now, makeCode }) {
    const sessions = new Map(); // "guild:user" -> { code, expires }
    const failures = new Map(); // "guild:user" -> { count, lockedUntil }
    const refreshes = new Map(); // "guild:user" -> [timestamps]
    const key = (g, u) => `${g}:${u}`;

    function lockRemainingMs(g, u) {
        const f = failures.get(key(g, u));
        return f && f.lockedUntil > now() ? f.lockedUntil - now() : 0;
    }

    // Starts (or replaces) a captcha. Returns { code } or { error: 'locked' | 'refresh-limit', waitMs }.
    function start(g, u, { isRefresh = false } = {}) {
        const locked = lockRemainingMs(g, u);
        if (locked) return { error: 'locked', waitMs: locked };
        if (isRefresh) {
            const recent = (refreshes.get(key(g, u)) ?? []).filter((t) => t > now() - REFRESH_WINDOW_MS);
            if (recent.length >= MAX_REFRESHES) return { error: 'refresh-limit', waitMs: recent[0] + REFRESH_WINDOW_MS - now() };
            refreshes.set(key(g, u), [...recent, now()]);
        }
        const code = makeCode();
        sessions.set(key(g, u), { code, expires: now() + SESSION_MS });
        return { code };
    }

    // Checks an answer. Every wrong answer destroys the current code (so it cannot be brute-forced).
    // Returns { ok: true } | { ok: false, reason: 'expired' | 'wrong' | 'locked', attemptsLeft?, waitMs? }
    function answer(g, u, text, maxAttempts) {
        const locked = lockRemainingMs(g, u);
        if (locked) return { ok: false, reason: 'locked', waitMs: locked };
        const session = sessions.get(key(g, u));
        sessions.delete(key(g, u));
        if (!session || session.expires < now()) return { ok: false, reason: 'expired' };

        if (String(text).trim().toUpperCase() === session.code) {
            failures.delete(key(g, u));
            refreshes.delete(key(g, u));
            return { ok: true };
        }
        const f = failures.get(key(g, u)) ?? { count: 0, lockedUntil: 0 };
        f.count += 1;
        if (f.count >= maxAttempts) {
            failures.set(key(g, u), { count: 0, lockedUntil: now() + LOCKOUT_MS });
            return { ok: false, reason: 'locked', waitMs: LOCKOUT_MS };
        }
        failures.set(key(g, u), f);
        return { ok: false, reason: 'wrong', attemptsLeft: maxAttempts - f.count };
    }

    // Forget old entries so memory cannot grow forever.
    function sweep() {
        for (const [k, s] of sessions) if (s.expires < now()) sessions.delete(k);
        for (const [k, f] of failures) if (f.lockedUntil < now() && f.count === 0) failures.delete(k);
        for (const [k, list] of refreshes) if (list.every((t) => t <= now() - REFRESH_WINDOW_MS)) refreshes.delete(k);
    }

    // Only used by tests, to read the code without looking at the picture.
    const peek = (g, u) => sessions.get(key(g, u))?.code ?? null;

    return { start, answer, lockRemainingMs, sweep, peek, SESSION_MS };
}

module.exports = { createCaptchaSessions, SESSION_MS, LOCKOUT_MS, MAX_REFRESHES };
