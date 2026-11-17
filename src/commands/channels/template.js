const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const logger = require('../../utils/logger');
const { respond, ensureModerator, describeError } = require('../../moderation/helpers');
const { ChannelServiceError } = require('../../services/channelService');
const { buildTemplateSpec, validateTemplateSpec, slugifyChannelName, cleanDisplayName } = require('../../channels/channelRules');

const KIND = {
    [ChannelType.GuildText]: 'text', [ChannelType.GuildVoice]: 'voice', [ChannelType.GuildAnnouncement]: 'announcement',
    [ChannelType.GuildForum]: 'forum', [ChannelType.GuildStageVoice]: 'stage',
};
const TYPE = { text: ChannelType.GuildText, voice: ChannelType.GuildVoice, announcement: ChannelType.GuildAnnouncement, forum: ChannelType.GuildForum, stage: ChannelType.GuildStageVoice };
const NAME = (o) => o.setName('name').setDescription('Template name').setRequired(true).setMaxLength(40);

module.exports = {
    data: new SlashCommandBuilder()
        .setName('template')
        .setDescription('Channel templates: save a category and its channels, then recreate it anywhere.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageChannels)
        .setDMPermission(false)
        .addSubcommand((s) => s.setName('save').setDescription('Save a category (names, types, topics, no permissions) as a template.')
            .addStringOption(NAME)
            .addChannelOption((o) => o.setName('category').setDescription('The category to save').setRequired(true).addChannelTypes(ChannelType.GuildCategory)))
        .addSubcommand((s) => s.setName('apply').setDescription('Create the category and channels from a template.')
            .addStringOption(NAME)
            .addBooleanOption((o) => o.setName('private').setDescription('Hide the new category from @everyone')))
        .addSubcommand((s) => s.setName('list').setDescription('Show saved templates.'))
        .addSubcommand((s) => s.setName('delete').setDescription('Delete a template.').addStringOption(NAME)),

    async execute(interaction) {
        if (!(await ensureModerator(interaction, PermissionFlagsBits.ManageChannels, 'Manage Channels'))) return;
        const { channels } = interaction.client.services;
        const guild = interaction.guild;
        const sub = interaction.options.getSubcommand();
        try {
            if (sub === 'list') {
                const list = channels.listTemplates(guild.id);
                if (!list.length) return respond(interaction, 'No templates yet. Save one with `/template save`.');
                return respond(interaction, list.map((t) => `• **${t.name}** — category "${t.spec.category}", ${t.spec.channels.length} channel(s)`).join('\n'));
            }
            const name = interaction.options.getString('name', true).trim();
            if (sub === 'delete') return respond(interaction, channels.deleteTemplate(guild.id, name) ? `🗑️ Template **${name}** deleted.` : 'I could not find that template.');

            if (sub === 'save') {
                const category = interaction.options.getChannel('category', true);
                const children = [...guild.channels.cache.filter((c) => c.parentId === category.id && KIND[c.type]).values()]
                    .sort((a, b) => a.rawPosition - b.rawPosition)
                    .map((c) => ({ name: c.name, type: KIND[c.type], topic: c.topic, nsfw: c.nsfw, slowmode: c.rateLimitPerUser, userLimit: c.userLimit }));
                if (!children.length) return respond(interaction, 'That category has no channels to save.');
                channels.saveTemplate(guild.id, name, buildTemplateSpec(category, children), interaction.user.id);
                return respond(interaction, `✅ Saved **${name}** (${children.length} channel(s)). Permissions are not saved, so it is safe to reuse.`);
            }

            // apply
            const template = channels.getTemplate(guild.id, name);
            if (!template) return respond(interaction, 'I could not find that template.');
            const problem = validateTemplateSpec(template.spec);
            if (problem) return respond(interaction, `⚠️ ${problem}`);
            const me = guild.members.me ?? await guild.members.fetchMe();
            if (!me.permissions.has(PermissionFlagsBits.ManageChannels)) return respond(interaction, 'I need the **Manage Channels** permission.');
            if (guild.channels.cache.size + template.spec.channels.length + 1 > 500) return respond(interaction, 'That would go over Discord\'s 500 channel limit.');
            await interaction.deferReply();
            const reason = `Template "${template.name}" by ${interaction.user.tag}`;
            const overwrites = interaction.options.getBoolean('private')
                ? [{ id: guild.id, deny: [PermissionFlagsBits.ViewChannel] }, { id: me.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ManageChannels] }, { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel] }]
                : [];
            const category = await guild.channels.create({ name: cleanDisplayName(template.spec.category), type: ChannelType.GuildCategory, permissionOverwrites: overwrites, reason });
            let made = 0;
            for (const spec of template.spec.channels) {
                try {
                    const options = { parent: category.id, type: TYPE[spec.type], reason };
                    const isTextual = ['text', 'announcement', 'forum'].includes(spec.type);
                    options.name = isTextual ? (slugifyChannelName(spec.name) || 'channel') : (cleanDisplayName(spec.name) || 'Voice');
                    if (isTextual && spec.topic) options.topic = spec.topic;
                    if (isTextual) { options.nsfw = Boolean(spec.nsfw); options.rateLimitPerUser = spec.slowmode || 0; }
                    if (spec.type === 'voice') options.userLimit = spec.userLimit || 0;
                    await guild.channels.create(options);
                    made++;
                } catch (error) {
                    logger.warn(`Template channel failed in server ${guild.id}: ${error.message}`);
                }
            }
            return respond(interaction, `✅ Created **${category.name}** with ${made}/${template.spec.channels.length} channel(s).`);
        } catch (error) {
            if (error instanceof ChannelServiceError || error instanceof TypeError) return respond(interaction, `⚠️ ${error.message}`);
            return respond(interaction, `⚠️ ${describeError(error)}`);
        }
    },
};
