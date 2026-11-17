// Placeholders for the level-up message. Pure, so it is easy to test.
const PLACEHOLDERS = {
    '{user}': 'Mentions the member (@Name)',
    '{username}': 'Their account name',
    '{displayname}': 'Their nickname or display name',
    '{level}': 'The new level',
    '{oldlevel}': 'The level they had before',
    '{xp}': 'Their total XP',
    '{rank}': 'Their place on the leaderboard (#3)',
    '{server}': 'The server name',
    '{role}': 'The reward role they just got, if any',
};

function renderLevelMessage(text, vars) {
    if (typeof text !== 'string') return '';
    const values = {
        user: vars.userId ? `<@${vars.userId}>` : '',
        username: vars.username ?? '',
        displayname: vars.displayname ?? vars.username ?? '',
        level: String(vars.level ?? ''),
        oldlevel: String(vars.oldLevel ?? ''),
        xp: Number(vars.xp ?? 0).toLocaleString('en-US'),
        rank: vars.rank ? `#${vars.rank}` : 'unranked',
        server: vars.server ?? '',
        role: vars.roleId ? `<@&${vars.roleId}>` : '',
    };
    return text.replace(/\\n/g, '\n').replace(/\{(user|username|displayname|level|oldlevel|xp|rank|server|role)\}/gi, (_, k) => values[k.toLowerCase()]);
}

// Which reward roles a person should hold at `level`.
//   rewards: [{ level, roleId }]   mode: 'stack' (keep all earned) | 'replace' (only the highest earned)
// Returns { keep: [roleIds they should have], drop: [roleIds of rewards they should NOT have] }.
function planLevelRoles(rewards, level, mode) {
    const earned = rewards.filter((r) => r.level <= level).sort((a, b) => a.level - b.level);
    const keep = mode === 'replace' ? earned.slice(-1) : earned;
    const keepIds = keep.map((r) => r.roleId);
    const drop = rewards.map((r) => r.roleId).filter((id) => !keepIds.includes(id));
    return { keep: keepIds, drop };
}

module.exports = { PLACEHOLDERS, renderLevelMessage, planLevelRoles };
