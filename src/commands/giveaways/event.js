const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { respond, ensureModerator, describeError } = require('../../moderation/helpers');
const { GiveawayServiceError } = require('../../services/giveawayService');
const { cleanText } = require('../../utils/text');
const { parseWhen, unix } = require('../../giveaways/giveawayRules');
const { publishEvent, refreshEvent } = require('../../giveaways/giveawayFlow');

const PERM = PermissionFlagsBits.ManageEvents;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('event')
        .setDescription('Announce events with Going / Maybe buttons and automatic reminders.')
        .setDefaultMemberPermissions(PERM)
        .setDMPermission(false)
        .addSubcommand((s) => s.setName('create').setDescription('Announce a new event.')
            .addStringOption((o) => o.setName('title').setDescription('Event name').setRequired(true).setMaxLength(100))
            .addStringOption((o) => o.setName('when').setDescription('In 2h / 3d, or a date: 2026-12-24 18:00').setRequired(true))
            .addStringOption((o) => o.setName('description').setDescription('What is happening').setMaxLength(1000))
            .addStringOption((o) => o.setName('location').setDescription('Where (a voice channel, a link, a place)').setMaxLength(200))
            .addChannelOption((o) => o.setName('channel').setDescription('Where to announce (default: here)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
            .addRoleOption((o) => o.setName('ping-role').setDescription('Mention this role in the announcement'))
            .addIntegerOption((o) => o.setName('utc-offset').setDescription('Your time zone as hours from UTC (Malaysia = 8). Only for dates.').setMinValue(-12).setMaxValue(14)))
        .addSubcommand((s) => s.setName('list').setDescription('Show upcoming events.'))
        .addSubcommand((s) => s.setName('cancel').setDescription('Cancel an upcoming event.')
            .addIntegerOption((o) => o.setName('id').setDescription('The event ID').setRequired(true).setMinValue(1))),

    async execute(interaction) {
        if (!(await ensureModerator(interaction, PERM, 'Manage Events'))) return;
        const { events } = interaction.client.services.giveaways;
        const guild = interaction.guild;
        const sub = interaction.options.getSubcommand();
        try {
            if (sub === 'list') {
                const list = events.listUpcoming(guild.id);
                return respond(interaction, list.length ? list.map((e) => `• **#${e.id}** ${e.title} — <t:${unix(e.startsAt)}:F> (<t:${unix(e.startsAt)}:R>), ${events.counts(e.id).going} going`).join('\n') : 'No upcoming events. Make one with `/event create`.');
            }
            if (sub === 'cancel') {
                const id = interaction.options.getInteger('id', true);
                const e = events.getForGuild(guild.id, id);
                if (!e) return respond(interaction, `I could not find event **#${id}**.`);
                if (!events.markCancelled(id)) return respond(interaction, 'That event is not upcoming.');
                await refreshEvent(interaction.client, events.get(id));
                return respond(interaction, `🚫 Event **#${id}** cancelled.`);
            }
            const startsAt = parseWhen(interaction.options.getString('when', true), { offsetHours: interaction.options.getInteger('utc-offset') ?? 0 });
            if (!startsAt) return respond(interaction, 'I could not read that time. Use `2h`, `3d`, or a date like `2026-12-24 18:00` (add `utc-offset:8` for Malaysia time).');
            if (startsAt <= Date.now() + 30000) return respond(interaction, 'The event must start in the future.');
            if (startsAt > Date.now() + 366 * 86400000) return respond(interaction, 'Events can be at most one year away.');
            const channel = interaction.options.getChannel('channel') ?? interaction.channel;
            const me = guild.members.me ?? await guild.members.fetchMe();
            if (!channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) return respond(interaction, `I need View Channel, Send Messages and Embed Links in <#${channel.id}>.`);
            const role = interaction.options.getRole('ping-role');
            if (role?.id === guild.id) return respond(interaction, 'Choose a real role, not @everyone.');
            const e = events.create(guild.id, { channelId: channel.id, hostId: interaction.user.id, title: cleanText(interaction.options.getString('title', true)), description: interaction.options.getString('description'), location: interaction.options.getString('location'), startsAt, pingRoleId: role?.id ?? null });
            const message = await publishEvent(interaction.client, e, channel);
            return respond(interaction, `✅ Event **#${e.id}** announced: ${message.url}\nPeople who press Going or Maybe get a reminder 15 minutes before it starts.`);
        } catch (error) {
            if (error instanceof GiveawayServiceError || error instanceof TypeError) return respond(interaction, `⚠️ ${error.message}`);
            return respond(interaction, `⚠️ ${describeError(error)}`);
        }
    },
};
