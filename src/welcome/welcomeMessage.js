const { EmbedBuilder, AttachmentBuilder } = require('discord.js');
const { renderTemplate } = require('./template');
const { renderCard, isCardAvailable } = require('./welcomeCard');
const { fetchAvatar } = require('../quotes/quoteFlow');

// Builds the numbers/words for {placeholders} from a real member.
function varsFor(member) {
    const user = member.user;
    return {
        username: user.username,
        displayname: member.displayName ?? user.globalName ?? user.username,
        userid: user.id,
        server: member.guild.name,
        count: member.guild.memberCount,
        createdUnix: user.createdTimestamp ? Math.floor(user.createdTimestamp / 1000) : null,
        joinedUnix: Math.floor((member.joinedTimestamp ?? Date.now()) / 1000),
        rulesChannelId: member.guild.rulesChannelId ?? null,
    };
}

// kind: 'welcome' | 'goodbye'. config: from welcomeService.get(guildId, kind).
// Returns a payload ready for channel.send(). Never pings @everyone or roles.
async function buildGreeting(kind, config, member, { fetchImpl } = {}) {
    const vars = varsFor(member);
    const title = renderTemplate(config.title, vars).slice(0, 256);
    const text = renderTemplate(config.message, vars).slice(0, 4000);
    const pingId = kind === 'welcome' && config.ping ? member.user.id : null;
    const allowedMentions = pingId ? { parse: [], users: [pingId] } : { parse: [] };
    const content = pingId ? `<@${pingId}>` : undefined;

    let style = config.style;
    if (style === 'card' && !isCardAvailable()) style = 'embed'; // picture library missing

    if (style === 'text') {
        return { content: text.slice(0, 2000), allowedMentions };
    }

    if (style === 'card') {
        const avatar = await fetchAvatar(member.user.displayAvatarURL({ extension: 'png', size: 256, forceStatic: true }), { fetchImpl });
        const png = await renderCard({
            heading: kind === 'welcome' ? 'Welcome' : 'Goodbye',
            name: vars.displayname,
            subtitle: kind === 'welcome' ? `You are member #${vars.count}` : `We are now ${vars.count} members`,
            accent: config.color,
            avatarBuffer: avatar,
        });
        const embed = new EmbedBuilder().setColor(config.color).setTitle(title).setDescription(text).setImage('attachment://greeting.png');
        if (config.footer) embed.setFooter({ text: renderTemplate(config.footer, vars).slice(0, 2048) });
        return { content, embeds: [embed], files: [new AttachmentBuilder(png, { name: 'greeting.png' })], allowedMentions };
    }

    const embed = new EmbedBuilder()
        .setColor(config.color)
        .setTitle(title)
        .setDescription(text)
        .setThumbnail(member.user.displayAvatarURL({ size: 256 }));
    if (config.bannerUrl) embed.setImage(config.bannerUrl);
    if (config.footer) embed.setFooter({ text: renderTemplate(config.footer, vars).slice(0, 2048) });
    return { content, embeds: [embed], allowedMentions };
}

module.exports = { buildGreeting, varsFor };
