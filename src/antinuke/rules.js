// The things anti-nuke watches for, and their default limits.
//   threshold + windowSec  = "this many actions within this many seconds is suspicious"
//   single: true           = one event is already a signal (a bot added, a dangerous permission given).
//                            These alone are NEVER enough to trigger automatic containment.
const RULES = {
    channelDelete: { label: 'Channels deleted', threshold: 3, windowSec: 10 },
    channelCreate: { label: 'Channels created', threshold: 5, windowSec: 10 },
    roleDelete: { label: 'Roles deleted', threshold: 3, windowSec: 10 },
    roleCreate: { label: 'Roles created', threshold: 5, windowSec: 10 },
    memberBan: { label: 'Members banned', threshold: 5, windowSec: 10 },
    memberKick: { label: 'Members kicked', threshold: 5, windowSec: 10 },
    webhookCreate: { label: 'Webhooks created', threshold: 3, windowSec: 30 },
    dangerousPermission: { label: 'Dangerous permission granted', threshold: 1, windowSec: 60, single: true },
    botAdd: { label: 'Bot added', threshold: 1, windowSec: 60, single: true },
};

const RULE_NAMES = Object.keys(RULES);

// Permissions that let someone do serious damage. Granting these to a role is itself a signal.
const DANGEROUS_PERMISSIONS = [
    'Administrator',
    'ManageGuild',
    'ManageRoles',
    'ManageChannels',
    'ManageWebhooks',
    'BanMembers',
    'KickMembers',
];

// Sensitivity changes how quickly we react. Lower number = reacts sooner.
const SENSITIVITY = { relaxed: 1.5, balanced: 1, strict: 0.6 };
const SAFE_MODE_MULTIPLIER = 0.5; // safe mode is stricter than "strict"
const TRUSTED_MULTIPLIER = 3; // trusted actors need 3x as many actions to count as suspicious

// Works out the real limits for one situation.
//   overrides: custom limits the owner set, e.g. { channelDelete: { threshold: 5, windowSec: 20 } }
//   Custom limits are used exactly as typed (sensitivity does not change them),
//   but safe mode and "trusted" still apply on top.
function buildThresholds({ overrides = {}, sensitivity = 'balanced', safe = false, trusted = false } = {}) {
    const result = {};
    for (const [rule, def] of Object.entries(RULES)) {
        const custom = overrides[rule];
        const windowSec = custom ? custom.windowSec : def.windowSec;
        let threshold = custom ? custom.threshold : def.threshold;

        if (!def.single) {
            let multiplier = custom ? 1 : (SENSITIVITY[sensitivity] ?? 1);
            if (safe) multiplier = SAFE_MODE_MULTIPLIER; // safe mode replaces the sensitivity setting
            threshold = Math.max(2, Math.ceil(threshold * multiplier)); // never below 2
            if (trusted) threshold *= TRUSTED_MULTIPLIER;
        }
        result[rule] = { threshold, windowSec };
    }
    return result;
}

module.exports = {
    RULES,
    RULE_NAMES,
    DANGEROUS_PERMISSIONS,
    SENSITIVITY,
    SAFE_MODE_MULTIPLIER,
    TRUSTED_MULTIPLIER,
    buildThresholds,
};
