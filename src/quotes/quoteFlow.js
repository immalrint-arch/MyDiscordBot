const { AttachmentBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const logger = require('../utils/logger');
const { cleanQuoteText } = require('./quoteText');
const { renderQuote, isQuoteImageAvailable } = require('./quoteImage');

const MAX_AVATAR_BYTES = 4 * 1024 * 1024;
let warnedMissingLibrary = false;

// Understands a message link or a plain message ID.
// Returns { channelId, messageId } or null. Links to OTHER servers are refused.
function parseMessageReference(input, { guildId, channelId }) {
    if (typeof input !== 'string') return null;
    const text = input.trim();
    if (/^\d{17,20}$/.test(text)) return { channelId, messageId: text };
    const match = text.match(/^https?:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/channels\/(\d{17,20})\/(\d{17,20})\/(\d{17,20})\/?$/i);
    if (!match || match[1] !== guildId) return null;
    return { channelId: match[2], messageId: match[3] };
}

// The words allowed next to the bot ping in "reply + @Incomu". Anything else means the
// person is talking to the bot, not asking for a quote, so we stay quiet.
// Returns { theme, grayscale, bold } or null.
function parseTriggerOptions(content, botId) {
    const rest = String(content ?? '')
        .replace(new RegExp(`<@!?${botId}>`, 'g'), ' ')
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean);
    const options = { theme: 'dark', grayscale: true, bold: false };
    for (const word of rest) {
        if (word === 'light' || word === 'white') options.theme = 'light';
        else if (word === 'dark' || word === 'bw') options.theme = 'dark';
        else if (word === 'color' || word === 'colour' || word === 'colored') options.grayscale = false;
        else if (word === 'bold' || word === 'b') options.bold = true;
        else return null;
    }
    return options;
}

// Downloads the avatar picture. Returns a Buffer, or null if it cannot be downloaded.
async function fetchAvatar(url, { fetchImpl = globalThis.fetch, timeoutMs = 5000 } = {}) {
    try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
            const response = await fetchImpl(url, { signal: controller.signal });
            if (!response.ok) return null;
            const length = Number(response.headers?.get?.('content-length') ?? 0);
            if (length > MAX_AVATAR_BYTES) return null;
            const bytes = Buffer.from(await response.arrayBuffer());
            return bytes.length > MAX_AVATAR_BYTES ? null : bytes;
        } finally {
            clearTimeout(timer);
        }
    } catch {
        return null;
    }
}

// Why we cannot quote this message (null = fine).
function quoteProblem(target) {
    const text = cleanQuoteText(target.cleanContent ?? target.content ?? '');
    if (!text) return 'That message has no text to quote (pictures, embeds and stickers cannot be quoted).';
    return null;
}

// Buttons under the picture, like the "Make it a Quote" bot: light/dark, colour, bold, remove.
// customId: qt:<action>:<requesterId>:<flags>:<channelId>:<messageId>   flags = theme(d|l) + picture(g|c) + bold(0|1)
const flagsOf = ({ theme, grayscale, bold }) => `${theme === 'light' ? 'l' : 'd'}${grayscale ? 'g' : 'c'}${bold ? '1' : '0'}`;
const optionsOf = (flags) => ({ theme: flags[0] === 'l' ? 'light' : 'dark', grayscale: flags[1] !== 'c', bold: flags[2] === '1' });

function quoteButtons(options, ctx) {
    const id = (action) => `qt:${action}:${ctx.requesterId}:${flagsOf(options)}:${ctx.channelId}:${ctx.messageId}`;
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(id('theme')).setEmoji(options.theme === 'light' ? '🌙' : '☀️').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(id('color')).setEmoji(options.grayscale ? '🎨' : '⬛').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(id('bold')).setLabel('B').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId(id('remove')).setEmoji('🗑️').setLabel('Remove my Quote').setStyle(ButtonStyle.Secondary),
    );
}

// Builds the reply payload (picture, or an embed if the picture library is missing).
// context = { requesterId } adds the buttons under the picture.
async function buildQuotePayload(target, { theme = 'dark', grayscale = true, bold = false, fetchImpl, context = null } = {}) {
    const text = cleanQuoteText(target.cleanContent ?? target.content ?? '');
    const author = target.author;
    const displayName = target.member?.displayName ?? author.globalName ?? author.username;
    const avatarUrl = (target.member ?? author).displayAvatarURL({ extension: 'png', size: 512, forceStatic: true });

    if (!isQuoteImageAvailable()) {
        if (!warnedMissingLibrary) {
            warnedMissingLibrary = true;
            logger.warn('Quote pictures are off because "@napi-rs/canvas" is not installed. Run: npm install @napi-rs/canvas');
        }
        const embed = new EmbedBuilder()
            .setColor(0x2b2d31)
            .setDescription(`>>> ${text}`)
            .setAuthor({ name: displayName, iconURL: avatarUrl })
            .setFooter({ text: `@${author.username}` })
            .setTimestamp(target.createdTimestamp);
        return { embeds: [embed], allowedMentions: { parse: [] } };
    }

    const avatarBuffer = await fetchAvatar(avatarUrl, { fetchImpl });
    const png = await renderQuote({ text, displayName, username: author.username, avatarBuffer, theme, grayscale, bold });
    return {
        files: [new AttachmentBuilder(png, { name: 'quote.png', description: `Quote by ${displayName}` })],
        ...(context ? { components: [quoteButtons({ theme, grayscale, bold }, { requesterId: context.requesterId, channelId: target.channelId, messageId: target.id })] } : {}),
        allowedMentions: { parse: [] },
    };
}

// Can the bot post pictures here?
function botCanQuoteIn(channel, me) {
    const perms = channel.permissionsFor(me);
    return Boolean(perms?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.AttachFiles]));
}

module.exports = { optionsOf, parseMessageReference, parseTriggerOptions, fetchAvatar, quoteProblem, buildQuotePayload, botCanQuoteIn };
