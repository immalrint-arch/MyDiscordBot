const {
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
    PermissionFlagsBits,
} = require('discord.js');
const logger = require('../utils/logger');
const { caseEmbed } = require('../utils/embeds');
const { MAX_MESSAGE } = require('../services/appealService');

const STATUS_TEXT = {
    approved: '✅ **Approved**: the user was unbanned.',
    denied: '❌ **Denied**.',
    blacklisted: '⛔ **Denied and blacklisted**: this user can no longer appeal.',
    dismissed: '🗑️ **Dismissed**: no message was sent to the user.',
};
const ACTION_TO_STATUS = { approve: 'approved', deny: 'denied', blacklist: 'blacklisted', dismiss: 'dismissed' };

// The appeal card moderators see (reference image 4).
function appealEmbed(appeal, user, resolution = null) {
    const created = Math.floor(user.createdTimestamp / 1000);
    const quoted = appeal.message.split('\n').map((l) => `❯ ${l}`).join('\n');
    const embed = new EmbedBuilder()
        .setColor(0x4e5058)
        .setAuthor({ name: `${user.username} has appealed their ban!`, iconURL: user.displayAvatarURL({ size: 64 }) })
        .setThumbnail(user.displayAvatarURL({ size: 256 }))
        .setDescription(
            `👤 **Member:** ${user.username} [\`${user.id}\`]\n` +
            `🎂 **Creation:** <t:${created}:f>\n\n**Appeal Message**\n${quoted}`.slice(0, 3900)
        )
        .setTimestamp(new Date(appeal.createdAt));
    if (resolution) embed.addFields({ name: 'Result', value: `${STATUS_TEXT[resolution.status]}\nBy <@${resolution.moderatorId}>` });
    return embed;
}

function appealButtons(appealId) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`ap:approve:${appealId}`).setLabel('Approve').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId(`ap:deny:${appealId}`).setLabel('Deny').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`ap:blacklist:${appealId}`).setLabel('Deny + Blacklist').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(`ap:dismiss:${appealId}`).setLabel('Dismiss').setStyle(ButtonStyle.Secondary)
    );
}

const dmEmbedFor = (text, color) => ({ embeds: [new EmbedBuilder().setColor(color).setDescription(text)] });

// Handles every "ap:" button and form. Registered in index.js.
async function handleAppealComponent(interaction) {
    const [, action, arg] = interaction.customId.split(':');
    if (action === 'open') return openForm(interaction, arg);
    if (action === 'submit') return submitAppeal(interaction, arg);
    if (ACTION_TO_STATUS[action]) return resolveAppeal(interaction, action, Number(arg));
}

// Step 1: the banned person pressed "Appeal ban" in their private message.
async function openForm(interaction, guildId) {
    const { appeals } = interaction.client.services;
    if (appeals.isBlacklisted(guildId, interaction.user.id)) {
        return interaction.reply({ content: '⛔ You are not allowed to appeal in this server.' });
    }
    if (appeals.findPending(guildId, interaction.user.id)) {
        return interaction.reply({ content: '⏳ You already have an appeal waiting for review. Please be patient.' });
    }
    const modal = new ModalBuilder().setCustomId(`ap:submit:${guildId}`).setTitle('Appeal your ban').addComponents(
        new ActionRowBuilder().addComponents(
            new TextInputBuilder()
                .setCustomId('message')
                .setLabel('Why should the ban be lifted?')
                .setStyle(TextInputStyle.Paragraph)
                .setMinLength(10)
                .setMaxLength(MAX_MESSAGE)
                .setRequired(true)
        )
    );
    return interaction.showModal(modal);
}

// Step 2: the banned person sent the form.
async function submitAppeal(interaction, guildId) {
    const { client, user } = interaction;
    const { appeals, guildSettings, logConfig, cases } = client.services;
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return interaction.reply({ content: 'I am no longer in that server, so I cannot send your appeal.' });

    // Only people who are really banned right now may appeal.
    try {
        await guild.bans.fetch(user.id);
    } catch (error) {
        if (error.code === 10026) return interaction.reply({ content: `You are not banned from **${guild.name}**.` });
        logger.error(`Could not check the ban for an appeal in server ${guildId}:`, error);
        return interaction.reply({ content: 'I could not check your ban right now. Please try again later.' });
    }
    if (appeals.isBlacklisted(guildId, user.id)) return interaction.reply({ content: '⛔ You are not allowed to appeal in this server.' });
    if (appeals.findPending(guildId, user.id)) return interaction.reply({ content: '⏳ You already have an appeal waiting for review.' });

    const channelId = guildSettings.getSettings(guildId).appealChannelId ?? logConfig.getChannelId(guildId, 'moderation');
    const channel = channelId ? await guild.channels.fetch(channelId).catch(() => null) : null;
    if (!channel?.isTextBased()) return interaction.reply({ content: 'This server has not set up ban appeals yet. Please contact a moderator another way.' });

    const banCase = cases.listCases(guildId, { targetId: user.id, limit: 25 }).find((c) => c.type === 'ban');
    const appeal = appeals.create({
        guildId, userId: user.id, banCaseNumber: banCase?.caseNumber ?? null,
        message: interaction.fields.getTextInputValue('message'),
    });

    try {
        const sent = await channel.send({
            embeds: [appealEmbed(appeal, user)],
            components: [appealButtons(appeal.id)],
            allowedMentions: { parse: [] },
        });
        appeals.attachMessage(appeal.id, channel.id, sent.id);
    } catch (error) {
        logger.error(`Could not post an appeal in server ${guildId}:`, error);
        appeals.discard(appeal.id);
        return interaction.reply({ content: 'I could not deliver your appeal to the moderators. Please try again later.' });
    }
    return interaction.reply({ content: '✅ Your appeal was sent to the moderators. You will get a message here when it is reviewed.' });
}

// Step 3: a moderator pressed one of the four buttons.
async function resolveAppeal(interaction, action, appealId) {
    const { client, guild } = interaction;
    const { appeals, cases, modLog, suppress } = client.services;
    if (!interaction.inGuild()) return;

    const appeal = Number.isInteger(appealId) ? appeals.get(appealId) : null;
    if (!appeal || appeal.guildId !== interaction.guildId) return interaction.reply({ content: 'I cannot find that appeal any more.' });
    // Check the permission again at the moment of the click. Never trust who can see the message.
    if (!interaction.memberPermissions.has(PermissionFlagsBits.BanMembers)) {
        return interaction.reply({ content: 'You need the **Ban Members** permission to review appeals.' });
    }
    if (appeal.status !== 'pending') return interaction.reply({ content: 'Someone already reviewed this appeal.' });

    const user = await client.users.fetch(appeal.userId).catch(() => null);
    if (!user) return interaction.reply({ content: 'That account no longer exists.' });
    const status = ACTION_TO_STATUS[action];

    if (action === 'approve') {
        try {
            suppress.mark(guild.id, 'unban', user.id);
            await guild.members.unban(user.id, `Ban appeal approved by ${interaction.user.username}`.slice(0, 512));
        } catch (error) {
            if (error.code !== 10026) { // 10026 = already unbanned, which is fine
                logger.error(`Could not unban after an approved appeal in server ${guild.id}:`, error);
                return interaction.reply({ content: `I could not unban them: ${error.message ?? 'unknown error'}. Check my **Ban Members** permission.` });
            }
        }
        client.services.tempBans.clear(guild.id, user.id);
        const record = cases.createCase({ guildId: guild.id, type: 'unban', targetId: user.id, moderatorId: interaction.user.id, reason: 'Ban appeal approved' });
        await modLog.send(guild, { embeds: [caseEmbed(record, { target: user, moderator: interaction.user })] });
    }

    // Only the first moderator to click can resolve it (the database checks this atomically).
    if (!appeals.resolve(appeal.id, status, interaction.user.id)) {
        return interaction.reply({ content: 'Someone already reviewed this appeal.' });
    }
    if (action === 'blacklist') appeals.blacklist(guild.id, user.id);

    // Tell the user (not for "Dismiss").
    if (action !== 'dismiss') {
        const text = {
            approve: `### Your ban appeal in ${guild.name} was approved!\nYou have been unbanned and can rejoin the server.`,
            deny: `### Your ban appeal in ${guild.name} was denied.`,
            blacklist: `### Your ban appeal in ${guild.name} was denied.\nYou can no longer appeal this ban.`,
        }[action];
        await user.send(dmEmbedFor(text, action === 'approve' ? 0x2ecc71 : 0x4e5058)).catch(() => {});
    }

    return interaction.update({
        embeds: [appealEmbed(appeal, user, { status, moderatorId: interaction.user.id })],
        components: [],
        allowedMentions: { parse: [] },
    });
}

module.exports = { handleAppealComponent, appealEmbed };
