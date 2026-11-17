// Pure rules for roles. No Discord code in here, so they are easy to test.
const { DANGEROUS_PERMISSIONS } = require('../antinuke/rules');

// Why the BOT may not hand out / take away this role (null = fine).
// `role` needs: id, managed, position, permissions.has(name).
// forbidDangerous: for roles anyone can grab (panels, automatic roles, temp roles from panels).
function roleProblem({ role, guildId, botHighestPosition, forbidDangerous = false }) {
    if (!role) return 'That role does not exist.';
    if (role.id === guildId) return 'You cannot use @everyone.';
    if (role.managed) return 'That role is managed by an integration or bot, so it cannot be given out.';
    if (role.position >= botHighestPosition) return 'That role is at or above my highest role. Move my role higher in Server Settings → Roles.';
    if (forbidDangerous) {
        const bad = DANGEROUS_PERMISSIONS.filter((p) => role.permissions.has(p));
        if (bad.length) return `That role has powerful permissions (${bad.join(', ')}). Roles that anyone can get automatically must stay harmless.`;
    }
    return null;
}

// Why a MODERATOR may not manage this role (null = fine): they cannot touch roles at or above their own.
function moderatorRoleProblem({ role, guildOwnerId, actorId, actorHighestPosition }) {
    if (actorId === guildOwnerId) return null;
    if (role.position >= actorHighestPosition) return 'You can only manage roles that are below your own highest role.';
    return null;
}

// Decides what to add/remove when someone uses a role panel.
//   held:        role IDs on THIS panel that the member already has
//   panelRoles:  every role ID on this panel
//   action:      { type: 'toggle' | 'add' | 'remove', roleId }  or  { type: 'select', roleIds: [...] }
//   maxRoles:    0 = no limit, 1 = only one at a time ("swap"), N = at most N
//   allowRemove: may people take roles off again?
// Returns { add: [], remove: [], error: string|null }
function planRoleChange({ held, panelRoles, action, maxRoles = 0, allowRemove = true }) {
    const have = new Set(held);
    const allowed = new Set(panelRoles);
    const result = { add: [], remove: [], error: null };

    const wanted = new Set();
    if (action.type === 'select') {
        for (const id of action.roleIds) if (allowed.has(id)) wanted.add(id);
        if (maxRoles > 0 && wanted.size > maxRoles) { result.error = `You can pick at most ${maxRoles} role(s) from this panel.`; return result; }
        for (const id of wanted) if (!have.has(id)) result.add.push(id);
        for (const id of have) if (!wanted.has(id)) {
            if (allowRemove) result.remove.push(id);
        }
        // roles we refuse to remove still count toward the limit
        if (!allowRemove && maxRoles > 0 && have.size + result.add.length > maxRoles) {
            result.error = 'This panel does not let you take roles off, so you cannot pick more.';
            result.add = [];
        }
        return result;
    }

    const id = action.roleId;
    if (!allowed.has(id)) { result.error = 'That role is not on this panel any more.'; return result; }
    const has = have.has(id);
    const isRemove = action.type === 'remove' || (action.type === 'toggle' && has);
    if (isRemove) {
        if (!has) return result; // nothing to do
        if (!allowRemove) { result.error = 'This panel does not let you take roles off. Ask a moderator.'; return result; }
        result.remove.push(id);
        return result;
    }
    if (has) return result;

    if (maxRoles === 1) {
        if (!allowRemove && have.size > 0) { result.error = 'You already picked a role here and this panel does not let you change it. Ask a moderator.'; return result; }
        result.remove.push(...have); // swap
    } else if (maxRoles > 1 && have.size >= maxRoles) {
        result.error = `You already have ${maxRoles} roles from this panel. Remove one first.`;
        return result;
    }
    result.add.push(id);
    return result;
}

// An emoji typed in a command: "🎮" or "<:name:123456789012345678>" or "<a:name:123...>".
// Returns { key, display, custom } or null. `key` is what Discord reports for a reaction
// (the emoji ID for custom emoji, the character for normal ones).
function parseEmoji(input) {
    if (typeof input !== 'string') return null;
    const text = input.trim();
    const custom = text.match(/^<(a?):(\w{2,32}):(\d{17,20})>$/);
    if (custom) return { key: custom[3], display: text, custom: true };
    const plain = text.replace(/️/g, '');
    // one emoji = pictographic characters (with joiners), flags, keycaps
    if (plain.length > 0 && plain.length <= 16 && /^(?:\p{Extended_Pictographic}|\p{Regional_Indicator}|[‍⃣#*0-9\u{1F3FB}-\u{1F3FF}])+$/u.test(plain) && /\p{Extended_Pictographic}|\p{Regional_Indicator}|⃣/u.test(plain)) {
        return { key: plain, display: text, custom: false };
    }
    return null;
}

// The key of a reaction the user just added (from discord.js: emoji.id ?? emoji.name).
const reactionKey = (emoji) => (emoji.id ? emoji.id : String(emoji.name ?? '').replace(/️/g, ''));

module.exports = { roleProblem, moderatorRoleProblem, planRoleChange, parseEmoji, reactionKey };
