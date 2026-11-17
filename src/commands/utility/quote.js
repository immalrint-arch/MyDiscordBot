const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const logger = require('../../utils/logger');
const { respond } = require('../../moderation/helpers');
const { optionsOf, parseMessageReference, quoteProblem, buildQuotePayload, botCanQuoteIn } = require('../../quotes/quoteFlow');
const { isQuoteImageAvailable, quoteImageProblem } = require('../../quotes/quoteImage');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('quote')
        .setDescription('Turn a message into a quote picture.')
        .setDMPermission(false)
        .addSubcommand((s) => s.setName('create').setDescription('Make a quote picture from a message.')
            .addStringOption((o) => o.setName('message').setDescription('Message link (right click > Copy Message Link) or message ID in this channel').setRequired(true))
            .addStringOption((o) => o.setName('style').setDescription('Dark (default) or light background')
                .addChoices({ name: 'Dark', value: 'dark' }, { name: 'Light', value: 'light' }))
            .addBooleanOption((o) => o.setName('color').setDescription('Keep the profile picture in colour (default: black and white)')))
        .addSubcommand((s) => s.setName('status').setDescription('Show the quote settings.'))
        .addSubcommand((s) => s.setName('enable').setDescription('Turn quotes ON in this server. (Manage Server)'))
        .addSubcommand((s) => s.setName('disable').setDescription('Turn quotes OFF in this server. (Manage Server)'))
        .addSubcommand((s) => s.setName('reply-trigger').setDescription('Turn "reply + ping the bot" quotes on or off. (Manage Server)')
            .addBooleanOption((o) => o.setName('enabled').setDescription('On or off').setRequired(true))),

    async execute(interaction) {
        if (!interaction.inGuild()) return respond(interaction, 'This command only works in a server.');
        const sub = interaction.options.getSubcommand();
        const { quotes } = interaction.client.services;
        const guild = interaction.guild;

        if (['enable', 'disable', 'reply-trigger'].includes(sub) && !interaction.memberPermissions.has(PermissionFlagsBits.ManageGuild)) {
            return respond(interaction, 'You need the **Manage Server** permission to change quote settings.');
        }

        if (sub === 'enable' || sub === 'disable') {
            quotes.setEnabled(guild.id, sub === 'enable');
            return respond(interaction, sub === 'enable' ? '✅ Quotes are **on**.' : '⛔ Quotes are **off** (the command and the reply trigger).');
        }
        if (sub === 'reply-trigger') {
            const enabled = interaction.options.getBoolean('enabled', true);
            quotes.setReplyTrigger(guild.id, enabled);
            return respond(interaction, enabled
                ? '✅ Reply to a message and ping me (`@Incomu`) to make a quote.'
                : '⛔ The reply trigger is **off**. `/quote create` still works.');
        }
        if (sub === 'status') {
            const c = quotes.getConfig(guild.id);
            return respond(interaction, [
                '**Quote settings**',
                `Quotes: ${c.enabled ? '✅ on' : '⛔ off'}`,
                `Reply + ping trigger: ${c.replyTrigger ? '✅ on' : '⛔ off'}`,
                `Pictures: ${isQuoteImageAvailable() ? '✅ available' : `⚠️ picture library problem (${quoteImageProblem()}). Run \`npm install @napi-rs/canvas\` in the bot folder and restart. Until then plain embed quotes are used.`}`,
                '',
                'Tip: reply to a message and write `@Incomu`. Add `light` or `color` after it for other looks.',
            ].join('\n'));
        }

        // /quote create
        if (!quotes.getConfig(guild.id).enabled) return respond(interaction, 'Quotes are turned off in this server.');
        const wait = quotes.checkCooldown(guild.id, interaction.user.id);
        if (wait > 0) return respond(interaction, `Slow down, try again in ${Math.ceil(wait / 1000)}s.`);

        const ref = parseMessageReference(interaction.options.getString('message', true), { guildId: guild.id, channelId: interaction.channelId });
        if (!ref) return respond(interaction, 'I could not understand that. Use a message link from **this** server, or a message ID from this channel.');

        await interaction.deferReply();
        try {
            const channel = await guild.channels.fetch(ref.channelId).catch(() => null);
            if (!channel?.isTextBased()) return respond(interaction, 'I could not find that channel.');
            // The person must be able to read that message themselves.
            const theirPerms = channel.permissionsFor(interaction.member);
            if (!theirPerms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory])) {
                return respond(interaction, 'You cannot read that channel, so you cannot quote from it.');
            }
            const me = await guild.members.fetchMe();
            if (!botCanQuoteIn(interaction.channel, me)) return respond(interaction, 'I need **Attach Files** permission in this channel.');
            const target = await channel.messages.fetch(ref.messageId).catch(() => null);
            if (!target) return respond(interaction, 'I could not find that message. Was it deleted?');
            const problem = quoteProblem(target);
            if (problem) return respond(interaction, problem);

            const payload = await buildQuotePayload(target, {
                theme: interaction.options.getString('style') ?? 'dark',
                grayscale: !interaction.options.getBoolean('color'),
                context: { requesterId: interaction.user.id },
            });
            return interaction.editReply({ content: '', ...payload });
        } catch (error) {
            logger.error(`/quote failed in server ${guild.id}: ${error.message}`);
            return respond(interaction, 'I could not make that quote. Please try again in a moment.');
        }
    },
    // Buttons under a quote picture: qt:<action>:<requesterId>:<flags>:<channelId>:<messageId>
    async handleComponent(interaction) {
        const [, action, requesterId, flags, channelId, messageId] = interaction.customId.split(':');
        const private_ = (content) => interaction.reply({ content, flags: MessageFlags.Ephemeral });
        if (action === 'remove') {
            // The person who asked, the person who was quoted, or a moderator may remove it.
            const allowed = interaction.user.id === requesterId || interaction.memberPermissions?.has(PermissionFlagsBits.ManageMessages);
            if (!allowed) {
                const target = await interaction.channel?.messages.fetch(messageId).catch(() => null);
                if (!target || target.author.id !== interaction.user.id) return private_('Only the person who made this quote, the person quoted, or a moderator can remove it.');
            }
            return interaction.message.delete().catch(() => private_('I could not delete that message.'));
        }
        if (interaction.user.id !== requesterId) return private_('Only the person who made this quote can change it. Reply to the message and ping me to make your own.');
        const options = optionsOf(flags ?? 'dg0');
        if (action === 'theme') options.theme = options.theme === 'light' ? 'dark' : 'light';
        else if (action === 'color') options.grayscale = !options.grayscale;
        else if (action === 'bold') options.bold = !options.bold;
        else return;
        const target = await interaction.client.channels.fetch(channelId).then((c) => c?.messages.fetch(messageId)).catch(() => null);
        if (!target) return private_('The original message is gone, so I cannot redraw this quote.');
        try {
            await interaction.deferUpdate();
            const payload = await buildQuotePayload(target, { ...options, context: { requesterId } });
            return interaction.editReply({ ...payload, attachments: [] });
        } catch (error) {
            logger.error(`Quote button failed: ${error.message}`);
        }
    },
};
