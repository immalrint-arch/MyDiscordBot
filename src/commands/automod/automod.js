const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const logger = require('../../utils/logger');
const { respond } = require('../../moderation/helpers');
const { RULES, RULE_NAMES, ACTION_LABEL } = require('../../automod/rules');

const ruleChoices = RULE_NAMES.map((r) => ({ name: RULES[r].label, value: r }));
const kindChoices = [{ name: 'banned word', value: 'word' }, { name: 'allowed link domain', value: 'domain' }, { name: 'allowed invite code', value: 'invite' }];
const DAY = 24 * 60 * 60 * 1000;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('automod')
        .setDescription('Automatic moderation (separate from the manual moderation commands).')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .setDMPermission(false)
        .addSubcommand((s) => s.setName('status').setDescription('Show every rule and the setup checks.'))
        .addSubcommand((s) => s.setName('enable').setDescription('Turn auto-moderation ON.'))
        .addSubcommand((s) => s.setName('disable').setDescription('Turn auto-moderation OFF.'))
        .addSubcommand((s) => s.setName('rule').setDescription('Change one rule.')
            .addStringOption((o) => o.setName('rule').setDescription('Which rule').setRequired(true).addChoices(...ruleChoices))
            .addBooleanOption((o) => o.setName('enabled').setDescription('Turn this rule on or off'))
            .addStringOption((o) => o.setName('action').setDescription('What happens when it is broken')
                .addChoices({ name: 'delete the message and add a strike', value: 'delete' }, { name: 'delete + timeout immediately', value: 'timeout' }, { name: 'delete + kick immediately', value: 'kick' }))
            .addIntegerOption((o) => o.setName('limit').setDescription('The main number (see /automod status for what it means)').setMinValue(1).setMaxValue(100))
            .addIntegerOption((o) => o.setName('window').setDescription('Time window in seconds (spam and repeat rules)').setMinValue(2).setMaxValue(120)))
        .addSubcommand((s) => s.setName('rule-reset').setDescription('Put one rule back to its defaults.')
            .addStringOption((o) => o.setName('rule').setDescription('Which rule').setRequired(true).addChoices(...ruleChoices)))
        .addSubcommand((s) => s.setName('list-add').setDescription('Add a banned word, an allowed domain or an allowed invite code.')
            .addStringOption((o) => o.setName('kind').setDescription('Which list').setRequired(true).addChoices(...kindChoices))
            .addStringOption((o) => o.setName('value').setDescription('The word, domain (example.com) or invite code').setRequired(true).setMaxLength(100)))
        .addSubcommand((s) => s.setName('list-remove').setDescription('Remove an item from a list.')
            .addStringOption((o) => o.setName('kind').setDescription('Which list').setRequired(true).addChoices(...kindChoices))
            .addStringOption((o) => o.setName('value').setDescription('The item').setRequired(true).setMaxLength(100)))
        .addSubcommand((s) => s.setName('list-show').setDescription('Show a list.')
            .addStringOption((o) => o.setName('kind').setDescription('Which list').setRequired(true).addChoices(...kindChoices)))
        .addSubcommand((s) => s.setName('exempt-add').setDescription('Make a role, channel or member immune to auto-moderation.')
            .addRoleOption((o) => o.setName('role').setDescription('A role'))
            .addChannelOption((o) => o.setName('channel').setDescription('A channel or category'))
            .addUserOption((o) => o.setName('user').setDescription('A member')))
        .addSubcommand((s) => s.setName('exempt-remove').setDescription('Stop ignoring a role, channel or member.')
            .addRoleOption((o) => o.setName('role').setDescription('A role'))
            .addChannelOption((o) => o.setName('channel').setDescription('A channel or category'))
            .addUserOption((o) => o.setName('user').setDescription('A member')))
        .addSubcommand((s) => s.setName('exempt-list').setDescription('Show who and what is ignored.'))
        .addSubcommand((s) => s.setName('punishment').setDescription('How strikes turn into a timeout.')
            .addIntegerOption((o) => o.setName('strikes').setDescription('Strikes before a timeout (1-20)').setMinValue(1).setMaxValue(20))
            .addIntegerOption((o) => o.setName('within_minutes').setDescription('...collected within this many minutes (1-1440)').setMinValue(1).setMaxValue(1440))
            .addIntegerOption((o) => o.setName('timeout_minutes').setDescription('Length of the timeout in minutes (1-40320)').setMinValue(1).setMaxValue(40320)))
        .addSubcommand((s) => s.setName('strikes').setDescription('See how many strikes a member has right now.')
            .addUserOption((o) => o.setName('user').setDescription('The member').setRequired(true)))
        .addSubcommand((s) => s.setName('clear-strikes').setDescription('Remove all strikes from a member.')
            .addUserOption((o) => o.setName('user').setDescription('The member').setRequired(true)))
        .addSubcommand((s) => s.setName('stats').setDescription('What auto-moderation did in the last 7 days.')),

    async execute(interaction) {
        if (!interaction.inGuild() || !interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
            return respond(interaction, 'You need the **Manage Server** permission to use this command.');
        }
        const sub = interaction.options.getSubcommand();
        const { automod } = interaction.client.services;
        const guild = interaction.guild;

        try {
            switch (sub) {
                case 'enable': {
                    const me = await guild.members.fetchMe();
                    const missing = [];
                    if (!me.permissions.has(PermissionFlagsBits.ManageMessages)) missing.push('Manage Messages');
                    if (!me.permissions.has(PermissionFlagsBits.ModerateMembers)) missing.push('Timeout Members');
                    automod.setEnabled(guild.id, true);
                    return respond(interaction, `✅ Auto-moderation is **ON**.${missing.length ? `\n⚠️ I am missing: **${missing.join(', ')}**. Some actions will fail until you give me those.` : ''}\nSee \`/automod status\`. Choose where its logs go with \`/logs set category:automod\`.`);
                }
                case 'disable':
                    automod.setEnabled(guild.id, false);
                    return respond(interaction, '🛑 Auto-moderation is **OFF**. Nothing is being checked.');
                case 'status': return await status(interaction, automod);
                case 'rule': {
                    const rule = interaction.options.getString('rule', true);
                    const change = {
                        enabled: interaction.options.getBoolean('enabled'), action: interaction.options.getString('action'),
                        limit: interaction.options.getInteger('limit'), window: interaction.options.getInteger('window'),
                    };
                    if (Object.values(change).every((v) => v == null)) return respond(interaction, 'Choose something to change: `enabled`, `action`, `limit` or `window`.');
                    automod.setRule(guild.id, rule, change);
                    return respond(interaction, `✅ Updated **${RULES[rule].label}**. ${describeRule(rule, automod.getConfig(guild.id).rules[rule])}`);
                }
                case 'rule-reset': {
                    const rule = interaction.options.getString('rule', true);
                    automod.resetRule(guild.id, rule);
                    return respond(interaction, `✅ **${RULES[rule].label}** is back to its defaults.`);
                }
                case 'list-add': {
                    const kind = interaction.options.getString('kind', true);
                    const { added, value } = automod.addListItem(guild.id, kind, interaction.options.getString('value', true));
                    return respond(interaction, added ? `✅ Added to the ${kindLabel(kind)} list.${kind === 'word' ? '' : ''}` : `\`${value}\` was already on the ${kindLabel(kind)} list.`);
                }
                case 'list-remove': {
                    const kind = interaction.options.getString('kind', true);
                    return respond(interaction, automod.removeListItem(guild.id, kind, interaction.options.getString('value', true)) ? `✅ Removed from the ${kindLabel(kind)} list.` : 'That item was not on the list.');
                }
                case 'list-show': {
                    const kind = interaction.options.getString('kind', true);
                    const items = automod.getConfig(guild.id).lists[kind];
                    return respond(interaction, items.length ? `**${kindLabel(kind)} list (${items.length}):**\n${items.map((i) => `\`${i}\``).join(', ').slice(0, 1800)}` : `The ${kindLabel(kind)} list is empty.`);
                }
                case 'exempt-add':
                case 'exempt-remove': {
                    const picks = [['role', interaction.options.getRole('role')], ['channel', interaction.options.getChannel('channel')], ['user', interaction.options.getUser('user')]].filter(([, v]) => v);
                    if (picks.length !== 1) return respond(interaction, 'Choose exactly one: a `role`, a `channel` or a `user`.');
                    const [kind, target] = picks[0];
                    if (kind === 'role' && target.id === guild.id) return respond(interaction, 'Exempting @everyone would turn auto-moderation off. Use `/automod disable` instead.');
                    const ok = sub === 'exempt-add' ? automod.addExempt(guild.id, kind, target.id) : automod.removeExempt(guild.id, kind, target.id);
                    const mention = kind === 'role' ? `<@&${target.id}>` : kind === 'channel' ? `<#${target.id}>` : `<@${target.id}>`;
                    return respond(interaction, sub === 'exempt-add' ? (ok ? `✅ ${mention} is now ignored by auto-moderation.` : `${mention} was already ignored.`) : (ok ? `✅ ${mention} is no longer ignored.` : `${mention} was not on the list.`));
                }
                case 'exempt-list': {
                    const e = automod.getConfig(guild.id).exempt;
                    const lines = [...e.role.map((i) => `Role <@&${i}>`), ...e.channel.map((i) => `Channel <#${i}>`), ...e.user.map((i) => `Member <@${i}>`)];
                    return respond(interaction, `Always ignored: the server owner, bots, and anyone with Administrator, Manage Server, Manage Messages or Timeout Members.\n${lines.length ? `\n**Also ignored:**\n${lines.join('\n')}` : '\nNo extra exemptions.'}`);
                }
                case 'punishment': {
                    const change = { strikeLimit: interaction.options.getInteger('strikes'), strikeWindowMinutes: interaction.options.getInteger('within_minutes'), timeoutMinutes: interaction.options.getInteger('timeout_minutes') };
                    if (Object.values(change).every((v) => v == null)) return respond(interaction, 'Choose at least one of `strikes`, `within_minutes`, `timeout_minutes`.');
                    automod.setPunishment(guild.id, change);
                    const c = automod.getConfig(guild.id);
                    return respond(interaction, `✅ ${c.strikeLimit} strike(s) within ${c.strikeWindowMinutes} minute(s) = a ${c.timeoutMinutes} minute timeout.`);
                }
                case 'strikes': {
                    const user = interaction.options.getUser('user', true);
                    const c = automod.getConfig(guild.id);
                    const n = automod.countStrikes(guild.id, user.id, Date.now() - c.strikeWindowMinutes * 60000);
                    return respond(interaction, `<@${user.id}> has **${n}/${c.strikeLimit}** active strike(s) (strikes expire after ${c.strikeWindowMinutes} minutes).`);
                }
                case 'clear-strikes': {
                    const user = interaction.options.getUser('user', true);
                    automod.clearStrikes(guild.id, user.id);
                    return respond(interaction, `✅ Cleared the strikes of <@${user.id}>.`);
                }
                case 'stats': {
                    const rows = automod.stats(guild.id, Date.now() - 7 * DAY);
                    if (!rows.length) return respond(interaction, 'Auto-moderation has not done anything in the last 7 days.');
                    return respond(interaction, `**Last 7 days**\n${rows.map((r) => `${RULES[r.rule]?.label ?? r.rule}: **${r.n}**`).join('\n')}`);
                }
            }
        } catch (error) {
            if (error instanceof TypeError) return respond(interaction, `⚠️ ${error.message}`);
            logger.error(`/automod ${sub} failed in server ${guild.id}:`, error);
            return respond(interaction, 'Something went wrong. Check the bot console.');
        }
    },
};

const kindLabel = (kind) => ({ word: 'banned word', domain: 'allowed domain', invite: 'allowed invite' }[kind]);

function describeRule(rule, r) {
    const def = RULES[rule];
    const parts = [r.enabled ? 'ON' : 'OFF', ACTION_LABEL[r.action]];
    if (def.limitRange) parts.push(`${r.limit} ${def.limitMeaning}`);
    if (def.windowRange) parts.push(`within ${r.window} ${def.windowMeaning}`);
    return parts.join(' · ');
}

async function status(interaction, automod) {
    const guild = interaction.guild;
    const c = automod.getConfig(guild.id);
    const me = await guild.members.fetchMe();
    const ok = (v, t) => `${v ? '✅' : '❌'} ${t}`;
    const logId = interaction.client.services.logConfig.getChannelId(guild.id, 'automod');
    const embed = new EmbedBuilder()
        .setColor(c.enabled ? 0x2ecc71 : 0x95a5a6)
        .setTitle(`🤖 Auto-moderation: ${c.enabled ? 'ON' : 'OFF'}`)
        .setDescription(RULE_NAMES.map((r) => `**${RULES[r].label}** — ${describeRule(r, c.rules[r])}`).join('\n'))
        .addFields(
            { name: 'Strikes', value: `${c.strikeLimit} within ${c.strikeWindowMinutes} min = ${c.timeoutMinutes} min timeout`, inline: true },
            { name: 'Lists', value: `${c.lists.word.length} words · ${c.lists.domain.length} domains · ${c.lists.invite.length} invites`, inline: true },
            { name: 'Log channel', value: logId ? `<#${logId}>` : 'Not set (`/logs set category:automod`)', inline: true },
            { name: 'Setup checks', value: [
                ok(me.permissions.has(PermissionFlagsBits.ManageMessages), 'Manage Messages (delete messages)'),
                ok(me.permissions.has(PermissionFlagsBits.ModerateMembers), 'Timeout Members'),
                ok(me.permissions.has(PermissionFlagsBits.KickMembers), 'Kick Members (only for kick actions)'),
            ].join('\n') }
        );
    return respond(interaction, null, { embeds: [embed] });
}
