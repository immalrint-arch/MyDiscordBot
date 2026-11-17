const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { buildDescription, memberFooter } = require('./textFormat');

// One colour per kind of event, matching your reference images.
const COLORS = {
    green: 0x2ecc71, // joins, creations, unbans, rules accepted
    blue: 0x5865f2, // updates, invites
    red: 0xe74c3c, // leaves, bans, deletions
    yellow: 0xf1c40f, // timeouts, kicks, warnings, suspicious things
    grey: 0x95a5a6,
};

// Builds the standard Incomu log embed.
//   avatarUrl is shown as the round picture at the top right.
function logEmbed({ color, title, headline, lines = [], footer = [], thumbnailUrl = null }) {
    const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle(title)
        .setDescription(buildDescription({ headline, lines, footer }));
    if (thumbnailUrl) embed.setThumbnail(thumbnailUrl);
    return embed;
}

// Footer for something done to/about a member.
function footerForUser(user, when) {
    return memberFooter({
        displayName: user.displayName ?? user.globalName ?? user.username,
        username: user.username,
        id: user.id,
        when,
    });
}

function linkRow(label, url) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(label).setURL(url)
    );
}

const profileButton = (userId) => linkRow('View Profile', `https://discord.com/users/${userId}`);
const channelButton = (guildId, channelId) =>
    linkRow('Open Channel', `https://discord.com/channels/${guildId}/${channelId}`);
const messageButton = (url) => linkRow('Jump to Message', url);

// "Updated by: @someone" text, or an honest "Unknown" when the audit log could not tell us.
function actorText(entry) {
    return entry?.executorId ? `<@${entry.executorId}>` : 'Unknown (audit log unavailable)';
}

module.exports = { COLORS, logEmbed, footerForUser, profileButton, channelButton, messageButton, actorText };
