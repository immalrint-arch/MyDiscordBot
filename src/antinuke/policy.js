// The DECISION rules of anti-nuke: who is the actor, how serious is it, what do we do?
// Pure functions (no Discord code), so every rule below is unit tested.
const { RULES } = require('./rules');

// What kind of actor was it?
//   owner   - the server owner (never acted against)
//   self    - Incomu itself (never acted against)
//   trusted - a user or role the owner trusts (needs far more actions to count)
//   bot     - another bot we were not told to trust
//   member  - an ordinary member or staff, including administrators
//   unknown - the audit log could not tell us who did it
function classifyActor({ actorId, ownerId, selfId, isBot = false, trustedUserIds = [], trustedRoleIds = [], memberRoleIds = [] }) {
    if (!actorId) return 'unknown';
    if (actorId === selfId) return 'self';
    if (actorId === ownerId) return 'owner';
    if (trustedUserIds.includes(actorId) || memberRoleIds.some((id) => trustedRoleIds.includes(id))) return 'trusted';
    return isBot ? 'bot' : 'member';
}

// How serious is it?
//   low    - only "single signal" rules (a bot was added, a permission was granted)
//   medium - one counting rule reached its limit
//   high   - two or more DIFFERENT rules reached their limits, or one rule went to 3x its limit
function assessSeverity(breaches) {
    const counting = breaches.filter((b) => !RULES[b.rule]?.single);
    if (counting.length === 0) return 'low';
    const strongest = Math.max(...counting.map((b) => b.count / b.threshold));
    if (breaches.length >= 2 || strongest >= 3) return 'high';
    return 'medium';
}

// What should Incomu do?  'ignore' | 'alert' | 'contain'
//   Containment is only chosen when ALL of these are true:
//     - the actor is an ordinary member or an untrusted bot (never owner/self/trusted/unknown)
//     - the severity is high (several signals, or far beyond the limit)
//     - the server chose mode "contain", or safe mode is active
//   Everything else is an alert for a human to judge.
function decideResponse({ actorClass, severity, mode, safe }) {
    if (actorClass === 'owner' || actorClass === 'self') return 'ignore';
    if (actorClass === 'unknown') return 'alert'; // cannot be sure who it was, so never act
    if (actorClass === 'trusted') return severity === 'high' ? 'alert' : 'ignore';
    if (severity === 'high' && (mode === 'contain' || safe)) return 'contain';
    return 'alert';
}

const SEVERITY_RANK = { low: 1, medium: 2, high: 3 };
const maxSeverity = (a, b) => (SEVERITY_RANK[a] >= SEVERITY_RANK[b] ? a : b);

module.exports = { classifyActor, assessSeverity, decideResponse, maxSeverity, SEVERITY_RANK };
