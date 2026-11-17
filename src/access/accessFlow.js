// Command rules (/commandrules) and the checks that run before every command.
const { PermissionFlagsBits } = require('discord.js');
const R = require('./rules');
const { respond, ensureModerator } = require('../moderation/helpers');
const { AccessServiceError } = require('../services/accessService');

const channelIdsOf = (channel) => [channel?.id, channel?.parentId, channel?.parent?.parentId].filter(Boolean);
const roleIdsOf = (member) => (!member?.roles ? [] : Array.isArray(member.roles) ? member.roles : [...(member.roles.cache?.keys?.() ?? [])]);

// Returns null if the command may run, otherwise the sentence to show.
function checkCommandAccess(client, { guild, member, channel, commandName, userId, isAdmin }) {
    const access = client.services?.access; if (!access || !guild) return null;
    const rules = access.rules.forCommand(guild.id, commandName); if (!rules.length) return null;
    return R.evaluate(rules, { command: commandName, roleIds: roleIdsOf(member), channelIds: channelIdsOf(channel), isAdmin: Boolean(isAdmin) || guild.ownerId === userId });
}
const isBlocked = (client, userId) => Boolean(client.services?.access?.blacklist.has(userId));

const PERM = PermissionFlagsBits.ManageGuild;
async function handleCommandRulesCommand(interaction) {
    if (!(await ensureModerator(interaction, PERM, 'Manage Server'))) return;
    const { access } = interaction.client.services; const o = interaction.options; const g = interaction.guildId; const sub = o.getSubcommand();
    try {
        if (sub === 'list') {
            const all = access.rules.list(g); if (!all.length) return respond(interaction, 'There are no command rules. Every command works the way it comes.');
            return respond(interaction, ['**Command rules**', ...all.map((c) => `\`${c.command}\`: ${c.rules.map(R.describe).join(' · ')}`)].join('\n').slice(0, 1950));
        }
        const command = String(o.getString('command', true)).trim().toLowerCase().replace(/^[/!]+/, '');
        if (!interaction.client.commands.has(command)) return respond(interaction, `⚠️ I do not have a command called \`${command}\`. Check \`/help\`.`);
        if (R.PROTECTED.includes(command)) return respond(interaction, `⚠️ \`${command}\` can never be restricted, so nobody can lock themselves out.`);
        if (sub === 'disable') { access.rules.add(g, command, 'disabled'); return respond(interaction, `✅ \`${command}\` is now **switched off** in this server (slash and text). Turn it back on with \`/commandrules enable\`.`); }
        if (sub === 'enable') return respond(interaction, access.rules.remove(g, command, ['disabled']) ? `✅ \`${command}\` is switched **on** again.` : `\`${command}\` was not switched off.`);
        if (sub === 'clear') { const n = access.rules.clear(g, command); return respond(interaction, n ? `🗑️ Removed ${n} rule${n === 1 ? '' : 's'} from \`${command}\`.` : `\`${command}\` has no rules.`); }
        const mode = o.getString('mode', true);
        const [kind, target] = sub === 'role' ? ['role', o.getRole('role', true)] : ['channel', o.getChannel('channel', true)];
        if (mode === 'remove') return respond(interaction, access.rules.remove(g, command, [`${kind}_allow`, `${kind}_deny`], target.id) ? `✅ Removed the ${kind} rule for ${kind === 'role' ? `<@&${target.id}>` : `<#${target.id}>`} on \`${command}\`.` : 'There was no such rule.');
        access.rules.add(g, command, `${kind}_${mode}`, target.id);
        return respond(interaction, `✅ \`${command}\`: ${R.describe({ kind: `${kind}_${mode}`, targetId: target.id })}.${mode === 'allow' ? ` (Once any "allow" rule exists, everyone else is blocked.)` : ''} Administrators are never limited by role or channel rules.`);
    } catch (error) { if (error instanceof AccessServiceError) return respond(interaction, `⚠️ ${error.message}`); throw error; }
}
async function autocompleteCommandName(interaction) {
    const typed = String(interaction.options.getFocused() ?? '').toLowerCase().replace(/^[/!]+/, '');
    const names = [...interaction.client.commands.keys()].filter((n) => !R.PROTECTED.includes(n) && n.includes(typed)).sort().slice(0, 25);
    await interaction.respond(names.map((n) => ({ name: n, value: n })));
}

module.exports = { checkCommandAccess, isBlocked, handleCommandRulesCommand, autocompleteCommandName, channelIdsOf, roleIdsOf };
