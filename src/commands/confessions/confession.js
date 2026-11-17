const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const logger = require('../../utils/logger');
const { actionLogEmbed } = require('../../utils/embeds');
const { respond, ensureModerator } = require('../../moderation/helpers');
const { ConfessionServiceError } = require('../../services/confessionService');
const { panelPayload } = require('../../confessions/confessionFlow');
const { COOLDOWN_MIN, COOLDOWN_MAX } = require('../../confessions/confessionRules');

const MANAGE = PermissionFlagsBits.ManageGuild;
const MOD = PermissionFlagsBits.ManageMessages;
const number = (o) => o.setName('number').setDescription('The confession number, e.g. 12').setRequired(true).setMinValue(1);

module.exports = {
    data: new SlashCommandBuilder()
        .setName('confession')
        .setDescription('Manage anonymous confessions.')
        .setDefaultMemberPermissions(MOD)
        .setDMPermission(false)
        .addSubcommand((s) => s.setName('setup').setDescription('Choose the confession channel and post the panel. Needs Manage Server.')
            .addChannelOption((o) => o.setName('channel').setDescription('The one channel for confessions').setRequired(true).addChannelTypes(ChannelType.GuildText))
            .addIntegerOption((o) => o.setName('cooldown').setDescription(`Seconds between confessions per person (${COOLDOWN_MIN}-${COOLDOWN_MAX}, default 60)`).setMinValue(COOLDOWN_MIN).setMaxValue(COOLDOWN_MAX)))
        .addSubcommand((s) => s.setName('disable').setDescription('Turn confessions off. Needs Manage Server.'))
        .addSubcommand((s) => s.setName('status').setDescription('Show the confession settings.'))
        .addSubcommand((s) => s.setName('delete').setDescription('Delete a confession from the channel.').addIntegerOption(number))
        .addSubcommand((s) => s.setName('block').setDescription('Stop the person who wrote a confession from confessing again. You are NOT shown who it is.').addIntegerOption(number))
        .addSubcommand((s) => s.setName('unblock').setDescription('Undo a block, using the confession number from /confession blocked.').addIntegerOption(number))
        .addSubcommand((s) => s.setName('blocked').setDescription('List the confession numbers whose authors are blocked.')),

    async execute(interaction) {
        const sub = interaction.options.getSubcommand();
        const { confessions, modLog } = interaction.client.services;
        const { guild } = interaction;
        const needsAdmin = ['setup', 'disable'].includes(sub);
        if (!(await ensureModerator(interaction, needsAdmin ? MANAGE : MOD, needsAdmin ? 'Manage Server' : 'Manage Messages'))) return;
        const log = (title, fields) => modLog.send(guild, { embeds: [actionLogEmbed({ title, moderatorId: interaction.user.id, fields })] });

        try {
            switch (sub) {
                case 'setup': {
                    const channel = interaction.options.getChannel('channel', true);
                    const me = await guild.members.fetchMe();
                    if (!channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) return respond(interaction, `I need View Channel, Send Messages and Embed Links in <#${channel.id}>.`);
                    const cooldown = interaction.options.getInteger('cooldown');
                    confessions.setChannel(guild.id, channel.id);
                    if (cooldown) confessions.setCooldown(guild.id, cooldown);
                    await channel.send(panelPayload());
                    return respond(interaction, `✅ Confessions now work only in <#${channel.id}>. Members can press **Confess** or use \`/confess\` there. Moderators can use \`/confess\` anywhere.`);
                }
                case 'disable': confessions.setChannel(guild.id, null); return respond(interaction, '⛔ Confessions are off. Old confessions stay in the channel.');
                case 'status': {
                    const c = confessions.getConfig(guild.id);
                    return respond(interaction, ['**Confessions**', `Channel: ${c.channelId ? `<#${c.channelId}>` : 'not set (off)'}`, `Cooldown: ${c.cooldownSeconds}s per person`, `Blocked people: ${confessions.listBlockedNumbers(guild.id).length}`,
                        'Privacy: the bot posts confessions itself. Staff cannot see who wrote one.'].join('\n'));
                }
                case 'delete': {
                    const n = interaction.options.getInteger('number', true);
                    const c = confessions.get(guild.id, n);
                    if (!c) return respond(interaction, `There is no confession #${n}.`);
                    if (c.deleted) return respond(interaction, `Confession #${n} was already deleted.`);
                    if (c.channelId && c.messageId) {
                        const channel = await guild.channels.fetch(c.channelId).catch(() => null);
                        await channel?.messages?.delete?.(c.messageId).catch(() => {});
                    }
                    confessions.markDeleted(guild.id, n);
                    await log('Confession deleted', [{ name: 'Confession', value: `#${n}`, inline: true }]);
                    return respond(interaction, `🗑️ Confession #${n} was deleted.`);
                }
                case 'block': {
                    const n = interaction.options.getInteger('number', true);
                    const r = confessions.blockAuthorOf(guild.id, n);
                    if (r === 'missing') return respond(interaction, `There is no confession #${n}.`);
                    if (r === 'already') return respond(interaction, 'That person is already blocked.');
                    await log('Confession author blocked', [{ name: 'Because of', value: `#${n}`, inline: true }]);
                    return respond(interaction, `🚫 The author of confession #${n} can no longer confess. (You are not shown who it is.)`);
                }
                case 'unblock': {
                    const n = interaction.options.getInteger('number', true);
                    if (!confessions.unblockByNumber(guild.id, n)) return respond(interaction, `Nobody is blocked because of #${n}. See \`/confession blocked\`.`);
                    await log('Confession author unblocked', [{ name: 'Because of', value: `#${n}`, inline: true }]);
                    return respond(interaction, `✅ The block linked to confession #${n} was removed.`);
                }
                default: {
                    const list = confessions.listBlockedNumbers(guild.id);
                    return respond(interaction, list.length ? `**Blocked because of confession:** ${list.map((n) => `#${n}`).join(', ')}` : 'Nobody is blocked.');
                }
            }
        } catch (error) {
            if (error instanceof ConfessionServiceError) return respond(interaction, `⚠️ ${error.message}`);
            logger.error(`confession ${sub} failed in server ${guild.id}:`, error);
            return respond(interaction, 'Something went wrong. Check the bot console.');
        }
    },
};
