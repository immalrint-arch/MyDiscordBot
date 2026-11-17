const {
    SlashCommandBuilder, PermissionFlagsBits, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags,
} = require('discord.js');
const logger = require('../../utils/logger');
const { respond, ensureModerator, describeError } = require('../../moderation/helpers');
const { slugifyChannelName, cleanDisplayName } = require('../../channels/channelRules');

const TYPES = {
    text: ChannelType.GuildText, voice: ChannelType.GuildVoice, category: ChannelType.GuildCategory,
    announcement: ChannelType.GuildAnnouncement, forum: ChannelType.GuildForum, stage: ChannelType.GuildStageVoice,
};
const TYPE_NAMES = Object.entries(TYPES).map(([name, value]) => ({ name, value: name }));
const PROTECTED_TYPES = new Set([ChannelType.GuildCategory]);
const PERM = PermissionFlagsBits.ManageChannels;

const confirmRow = (id, userId, label) => new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`ch:${id}:${userId}`).setLabel(label).setStyle(ButtonStyle.Danger),
    new ButtonBuilder().setCustomId(`ch:no:${userId}`).setLabel('Cancel').setStyle(ButtonStyle.Secondary),
);

// Categories with no channels inside (never touches the rules/updates channels or other special ones).
const emptyCategories = (guild) => guild.channels.cache.filter((c) => c.type === ChannelType.GuildCategory
    && !guild.channels.cache.some((x) => x.parentId === c.id));

module.exports = {
    data: new SlashCommandBuilder()
        .setName('channel')
        .setDescription('Create, change, copy and delete channels.')
        .setDefaultMemberPermissions(PERM)
        .setDMPermission(false)
        .addSubcommand((s) => s.setName('create').setDescription('Create a channel.')
            .addStringOption((o) => o.setName('name').setDescription('Channel name').setRequired(true).setMaxLength(100))
            .addStringOption((o) => o.setName('type').setDescription('Kind of channel (default: text)').addChoices(...TYPE_NAMES))
            .addChannelOption((o) => o.setName('category').setDescription('Put it inside this category').addChannelTypes(ChannelType.GuildCategory))
            .addStringOption((o) => o.setName('topic').setDescription('Topic (text channels)').setMaxLength(1000))
            .addBooleanOption((o) => o.setName('private').setDescription('Only moderators and the bot can see it')))
        .addSubcommand((s) => s.setName('edit').setDescription('Change a channel.')
            .addChannelOption((o) => o.setName('channel').setDescription('Which channel').setRequired(true))
            .addStringOption((o) => o.setName('name').setDescription('New name').setMaxLength(100))
            .addStringOption((o) => o.setName('topic').setDescription('New topic (type - to clear)').setMaxLength(1000))
            .addIntegerOption((o) => o.setName('slowmode').setDescription('Seconds between messages (0 = off)').setMinValue(0).setMaxValue(21600))
            .addBooleanOption((o) => o.setName('nsfw').setDescription('Age-restricted?'))
            .addIntegerOption((o) => o.setName('user-limit').setDescription('Voice: most people allowed (0 = no limit)').setMinValue(0).setMaxValue(99))
            .addChannelOption((o) => o.setName('category').setDescription('Move into this category').addChannelTypes(ChannelType.GuildCategory)))
        .addSubcommand((s) => s.setName('clone').setDescription('Make a copy of a channel (with the same permissions).')
            .addChannelOption((o) => o.setName('channel').setDescription('Which channel').setRequired(true))
            .addStringOption((o) => o.setName('name').setDescription('Name of the copy').setMaxLength(100)))
        .addSubcommand((s) => s.setName('delete').setDescription('Delete a channel (asks you to confirm).')
            .addChannelOption((o) => o.setName('channel').setDescription('Which channel').setRequired(true)))
        .addSubcommand((s) => s.setName('hide').setDescription('Hide a channel from @everyone.')
            .addChannelOption((o) => o.setName('channel').setDescription('Which channel').setRequired(true)))
        .addSubcommand((s) => s.setName('show').setDescription('Make a hidden channel visible to @everyone again.')
            .addChannelOption((o) => o.setName('channel').setDescription('Which channel').setRequired(true)))
        .addSubcommand((s) => s.setName('sync').setDescription('Make a channel use its category\'s permissions.')
            .addChannelOption((o) => o.setName('channel').setDescription('Which channel').setRequired(true)))
        .addSubcommand((s) => s.setName('cleanup').setDescription('Find (and, after you confirm, delete) empty categories.')),

    async execute(interaction) {
        if (!(await ensureModerator(interaction, PERM, 'Manage Channels'))) return;
        const guild = interaction.guild;
        const sub = interaction.options.getSubcommand();
        const me = guild.members.me ?? await guild.members.fetchMe();
        if (!me.permissions.has(PERM)) return respond(interaction, 'I need the **Manage Channels** permission.');
        const reason = `By ${interaction.user.tag} (/channel ${sub})`;

        // The person must be able to manage the channel THEMSELVES (stops using the bot to get around channel permissions).
        const picked = interaction.options.getChannel('channel');
        if (picked && !picked.permissionsFor(interaction.member)?.has(PERM)) {
            return respond(interaction, 'You do not have **Manage Channels** in that channel.');
        }

        try {
            if (sub === 'create') {
                const typeName = interaction.options.getString('type') ?? 'text';
                const type = TYPES[typeName];
                const raw = interaction.options.getString('name', true);
                const name = [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum].includes(type) ? slugifyChannelName(raw) : cleanDisplayName(raw);
                if (!name) return respond(interaction, 'That name has no usable letters. Try again.');
                const options = { name, type, reason };
                const parent = interaction.options.getChannel('category');
                if (parent && type !== ChannelType.GuildCategory) options.parent = parent.id;
                const topic = interaction.options.getString('topic');
                if (topic && [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum].includes(type)) options.topic = topic;
                if (interaction.options.getBoolean('private')) {
                    options.permissionOverwrites = [
                        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
                        { id: me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageChannels] },
                        { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel] },
                    ];
                }
                const created = await guild.channels.create(options);
                return respond(interaction, `✅ Created <#${created.id}>.`);
            }

            if (sub === 'edit') {
                const changes = {};
                const name = interaction.options.getString('name');
                const topic = interaction.options.getString('topic');
                const slowmode = interaction.options.getInteger('slowmode');
                const nsfw = interaction.options.getBoolean('nsfw');
                const limit = interaction.options.getInteger('user-limit');
                const parent = interaction.options.getChannel('category');
                const textLike = picked.isTextBased?.() && !picked.isVoiceBased?.();
                if (name) changes.name = textLike ? slugifyChannelName(name) : cleanDisplayName(name);
                if (name && !changes.name) return respond(interaction, 'That name has no usable letters.');
                if (topic !== null && 'topic' in picked) changes.topic = topic === '-' ? '' : topic;
                if (slowmode !== null && 'rateLimitPerUser' in picked) changes.rateLimitPerUser = slowmode;
                if (nsfw !== null && 'nsfw' in picked) changes.nsfw = nsfw;
                if (limit !== null && picked.isVoiceBased?.()) changes.userLimit = limit;
                if (parent && !PROTECTED_TYPES.has(picked.type)) changes.parent = parent.id;
                if (!Object.keys(changes).length) return respond(interaction, 'Nothing to change. Pick at least one option that fits that channel.');
                await picked.edit({ ...changes, reason });
                return respond(interaction, `✅ Updated <#${picked.id}>.`);
            }

            if (sub === 'clone') {
                const copy = await picked.clone({ name: interaction.options.getString('name') ? (picked.isTextBased?.() && !picked.isVoiceBased?.() ? slugifyChannelName(interaction.options.getString('name')) : cleanDisplayName(interaction.options.getString('name'))) : undefined, reason });
                return respond(interaction, `✅ Copied to <#${copy.id}>.`);
            }

            if (sub === 'hide' || sub === 'show') {
                if (PROTECTED_TYPES.has(picked.type) === false && !picked.permissionOverwrites) return respond(interaction, 'That channel cannot be changed like this.');
                await picked.permissionOverwrites.edit(guild.id, { ViewChannel: sub === 'hide' ? false : null }, { reason });
                return respond(interaction, sub === 'hide' ? `🙈 <#${picked.id}> is hidden from @everyone.` : `👁️ <#${picked.id}> is visible to @everyone again (unless the category hides it).`);
            }

            if (sub === 'sync') {
                if (!picked.parent) return respond(interaction, 'That channel is not inside a category.');
                await picked.lockPermissions();
                return respond(interaction, `🔄 <#${picked.id}> now uses the permissions of **${picked.parent.name}**.`);
            }

            if (sub === 'delete') {
                if (picked.id === guild.rulesChannelId || picked.id === guild.publicUpdatesChannelId || picked.id === guild.systemChannelId) {
                    return respond(interaction, '⚠️ That channel is used by Discord for rules, updates or system messages. Change that in Server Settings first.');
                }
                return respond(interaction, `⚠️ Delete **#${picked.name}**${PROTECTED_TYPES.has(picked.type) ? ' (the channels inside will stay, but lose their category)' : ''}? This cannot be undone.`, {
                    components: [confirmRow(`del:${picked.id}`, interaction.user.id, 'Delete channel')],
                });
            }

            if (sub === 'cleanup') {
                const empty = emptyCategories(guild);
                if (!empty.size) return respond(interaction, '✨ There are no empty categories.');
                const list = [...empty.values()].slice(0, 25).map((c) => `• **${c.name}**`).join('\n');
                return respond(interaction, `Empty categories (${empty.size}):\n${list}\n\nDelete them?`, {
                    components: [confirmRow('clean', interaction.user.id, `Delete ${empty.size} categor${empty.size === 1 ? 'y' : 'ies'}`)],
                });
            }
        } catch (error) {
            logger.warn(`/channel ${sub} failed in server ${guild.id}: ${error.message}`);
            return respond(interaction, `⚠️ ${describeError(error)}`);
        }
    },

    // Buttons: ch:del:<channelId>:<userId>  ch:clean:<userId>  ch:no:<userId>
    async handleComponent(interaction) {
        const parts = interaction.customId.split(':');
        const userId = parts[parts.length - 1];
        if (interaction.user.id !== userId) return interaction.reply({ content: 'Only the person who ran the command can press this.', flags: MessageFlags.Ephemeral });
        if (parts[1] === 'no') return interaction.update({ content: 'Cancelled. Nothing was deleted.', components: [] });
        if (!interaction.memberPermissions?.has(PERM)) return interaction.update({ content: 'You no longer have Manage Channels.', components: [] });
        const guild = interaction.guild;
        const reason = `By ${interaction.user.tag} (/channel)`;
        try {
            if (parts[1] === 'del') {
                const channel = guild.channels.cache.get(parts[2]);
                if (!channel) return interaction.update({ content: 'That channel is already gone.', components: [] });
                if (!channel.permissionsFor(interaction.member)?.has(PERM)) return interaction.update({ content: 'You do not have Manage Channels in that channel.', components: [] });
                const name = channel.name;
                await channel.delete(reason);
                return interaction.update({ content: `🗑️ Deleted **#${name}**.`, components: [] });
            }
            if (parts[1] === 'clean') {
                const empty = emptyCategories(guild); // checked again: things may have changed since the question
                for (const c of empty.values()) await c.delete(reason);
                return interaction.update({ content: `🗑️ Deleted ${empty.size} empty categor${empty.size === 1 ? 'y' : 'ies'}.`, components: [] });
            }
        } catch (error) {
            return interaction.update({ content: `⚠️ ${describeError(error)}`, components: [] });
        }
    },
};
