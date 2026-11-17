// Pure rules: may this person use this command here?
const PROTECTED = ['commandrules', 'help', 'setup', 'owner']; // can never be restricted (so nobody locks themselves out)
const MAX_RULES = 200;
const KINDS = ['role_allow', 'role_deny', 'channel_allow', 'channel_deny', 'disabled'];

// rules: array of { kind, targetId } for ONE command. ctx: { command, roleIds, channelIds, isAdmin }.
// Returns null when allowed, or a sentence (with the command name) saying why not.
function evaluate(rules, { command, roleIds = [], channelIds = [], isAdmin = false }) {
    if (!rules?.length || PROTECTED.includes(command)) return null;
    const of = (k) => rules.filter((r) => r.kind === k).map((r) => r.targetId);
    if (rules.some((r) => r.kind === 'disabled')) return `🚫 \`${command}\` is switched off in this server.`;
    if (isAdmin) return null; // administrators ignore role and channel limits
    const chDeny = of('channel_deny'), chAllow = of('channel_allow'), roleDeny = of('role_deny'), roleAllow = of('role_allow');
    if (channelIds.some((c) => chDeny.includes(c))) return `🚫 \`${command}\` cannot be used in this channel.`;
    if (chAllow.length && !channelIds.some((c) => chAllow.includes(c))) return `🚫 \`${command}\` can only be used in ${chAllow.map((c) => `<#${c}>`).join(', ')}.`;
    if (roleDeny.length && roleIds.some((r) => roleDeny.includes(r))) return `🚫 You are not allowed to use \`${command}\` in this server.`;
    if (roleAllow.length && !roleIds.some((r) => roleAllow.includes(r))) return `🚫 \`${command}\` is only for members with ${roleAllow.map((r) => `<@&${r}>`).join(' or ')}.`;
    return null;
}
const describe = (r) => ({ role_allow: `only <@&${r.targetId}>`, role_deny: `not <@&${r.targetId}>`, channel_allow: `only in <#${r.targetId}>`, channel_deny: `not in <#${r.targetId}>`, disabled: 'switched off' }[r.kind]);

module.exports = { PROTECTED, MAX_RULES, KINDS, evaluate, describe };
