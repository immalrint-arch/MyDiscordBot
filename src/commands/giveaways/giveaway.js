const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { respond, ensureModerator, describeError } = require('../../moderation/helpers');
const { GiveawayServiceError } = require('../../services/giveawayService');
const { parseDuration, formatDuration } = require('../../utils/duration');
const { cleanText } = require('../../utils/text');
const { MIN_DURATION_MS, MAX_DURATION_MS, unix } = require('../../giveaways/giveawayRules');
const { publishGiveaway, endGiveaway, rerollGiveaway, cancelGiveaway } = require('../../giveaways/giveawayFlow');

const PERM = PermissionFlagsBits.ManageGuild;
const ID = (o) => o.setName('id').setDescription('The giveaway ID (shown on the giveaway and in /giveaway list)').setRequired(true).setMinValue(1);

module.exports = {
    data: new SlashCommandBuilder()
        .setName('giveaway')
        .setDescription('Run giveaways people enter with a button.')
        .setDefaultMemberPermissions(PERM)
        .setDMPermission(false)
        .addSubcommand((s) => s.setName('start').setDescription('Start a giveaway.')
            .addStringOption((o) => o.setName('prize').setDescription('What is being given away').setRequired(true).setMaxLength(200))
            .addStringOption((o) => o.setName('duration').setDescription('How long, e.g. 30m, 2h, 7d (10s to 60d)').setRequired(true))
            .addIntegerOption((o) => o.setName('winners').setDescription('How many winners (default 1)').setMinValue(1).setMaxValue(20))
            .addChannelOption((o) => o.setName('channel').setDescription('Where to post it (default: here)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
            .addStringOption((o) => o.setName('description').setDescription('Extra text on the giveaway').setMaxLength(500))
            .addRoleOption((o) => o.setName('required-role').setDescription('Only people with this role can enter'))
            .addIntegerOption((o) => o.setName('min-level').setDescription('Needs this leveling level (leveling must be on)').setMinValue(1).setMaxValue(500))
            .addIntegerOption((o) => o.setName('min-days').setDescription('Needs to have been in the server this many days').setMinValue(1).setMaxValue(3650))
            .addRoleOption((o) => o.setName('bypass-role').setDescription('People with this role skip the requirements'))
            .addRoleOption((o) => o.setName('ping-role').setDescription('Mention this role when it starts')))
        .addSubcommand((s) => s.setName('end').setDescription('End a giveaway now and pick winners.').addIntegerOption(ID))
        .addSubcommand((s) => s.setName('reroll').setDescription('Pick new winner(s) from the same entries.').addIntegerOption(ID)
            .addIntegerOption((o) => o.setName('count').setDescription('How many new winners (default 1)').setMinValue(1).setMaxValue(20)))
        .addSubcommand((s) => s.setName('cancel').setDescription('Cancel a giveaway. Nobody wins.').addIntegerOption(ID))
        .addSubcommand((s) => s.setName('list').setDescription('Show running and recent giveaways.')),

    async execute(interaction) {
        if (!(await ensureModerator(interaction, PERM, 'Manage Server'))) return;
        const services = interaction.client.services;
        const { giveaways } = services.giveaways;
        const guild = interaction.guild;
        const sub = interaction.options.getSubcommand();
        try {
            if (sub === 'list') {
                const active = giveaways.listActive(guild.id); const recent = giveaways.listRecent(guild.id, 5);
                if (!active.length && !recent.length) return respond(interaction, 'No giveaways yet. Start one with `/giveaway start`.');
                const line = (g) => `• **#${g.id}** ${g.prize} — ${g.status === 'active' ? `ends <t:${unix(g.endsAt)}:R>, ${giveaways.countEntries(g.id)} entries` : g.status}`;
                return respond(interaction, [active.length ? `**Running**\n${active.map(line).join('\n')}` : null, recent.length ? `**Recent**\n${recent.map(line).join('\n')}` : null].filter(Boolean).join('\n\n'));
            }
            if (sub === 'start') {
                const ms = parseDuration(interaction.options.getString('duration', true));
                if (!ms || ms < MIN_DURATION_MS || ms > MAX_DURATION_MS) return respond(interaction, 'Use a duration between `10s` and `60d`, like `30m`, `2h` or `7d`.');
                const channel = interaction.options.getChannel('channel') ?? interaction.channel;
                const me = guild.members.me ?? await guild.members.fetchMe();
                if (!channel.permissionsFor(me)?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks])) return respond(interaction, `I need View Channel, Send Messages and Embed Links in <#${channel.id}>.`);
                const roles = ['required-role', 'bypass-role', 'ping-role'].map((n) => interaction.options.getRole(n));
                if (roles.some((r) => r && r.id === guild.id)) return respond(interaction, 'Choose real roles, not @everyone.');
                const minLevel = interaction.options.getInteger('min-level') ?? 0;
                if (minLevel && !services.levels.getConfig(guild.id).enabled) return respond(interaction, 'Turn leveling on first (`/level enable`) to use a level requirement.');
                const g = giveaways.create(guild.id, {
                    channelId: channel.id, hostId: interaction.user.id, prize: cleanText(interaction.options.getString('prize', true)),
                    description: interaction.options.getString('description'), winners: interaction.options.getInteger('winners') ?? 1, endsAt: Date.now() + ms,
                    requiredRoleId: roles[0]?.id ?? null, bypassRoleId: roles[1]?.id ?? null, pingRoleId: roles[2]?.id ?? null,
                    minLevel, minDays: interaction.options.getInteger('min-days') ?? 0,
                });
                try { const message = await publishGiveaway(interaction.client, g, channel); return respond(interaction, `✅ Giveaway **#${g.id}** started in <#${channel.id}> — ends in ${formatDuration(ms)}. ${message.url}`); }
                catch (error) { giveaways.delete(g.id); throw error; }
            }
            const id = interaction.options.getInteger('id', true);
            const g = giveaways.getForGuild(guild.id, id);
            if (!g) return respond(interaction, `I could not find giveaway **#${id}** in this server.`);
            if (sub === 'end') {
                if (g.status !== 'active') return respond(interaction, 'That giveaway is not running.');
                await interaction.deferReply();
                const result = await endGiveaway(interaction.client, id);
                return respond(interaction, result ? `✅ Giveaway **#${id}** ended. ${result.winnerIds.length ? `Winner${result.winnerIds.length > 1 ? 's' : ''}: ${result.winnerIds.map((w) => `<@${w}>`).join(' ')}` : 'Nobody had a valid entry.'}` : 'It had already ended.');
            }
            if (sub === 'cancel') {
                if (g.status !== 'active') return respond(interaction, 'That giveaway is not running.');
                return respond(interaction, (await cancelGiveaway(interaction.client, id)) ? `🚫 Giveaway **#${id}** cancelled.` : 'It had already ended.');
            }
            if (sub === 'reroll') {
                await interaction.deferReply();
                const result = await rerollGiveaway(interaction.client, id, interaction.options.getInteger('count') ?? 1);
                return respond(interaction, result.error ? `⚠️ ${result.error}` : `🔄 New winner${result.winnerIds.length > 1 ? 's' : ''}: ${result.winnerIds.map((w) => `<@${w}>`).join(' ')}`);
            }
        } catch (error) {
            if (error instanceof GiveawayServiceError || error instanceof TypeError) return respond(interaction, `⚠️ ${error.message}`);
            return respond(interaction, `⚠️ ${describeError(error)}`);
        }
    },
};
