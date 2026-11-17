// Makes a chat message look like a slash-command interaction, so the SAME command code runs for both.
// Everything a command can call on `interaction` is covered here. Things that only slash commands can do
// (pop-up forms, private "only you can see" replies) are handled safely.
const { T } = require('./parser');

class TextCommandUnsupported extends Error {}

const noMentions = { parse: [], repliedUser: false };

// payload may be a string or an object. "Only you can see this" does not exist for chat messages, so it is dropped.
function toMessagePayload(payload) {
    const p = typeof payload === 'string' ? { content: payload } : { ...payload };
    delete p.flags; delete p.ephemeral; delete p.fetchReply; delete p.withResponse;
    p.allowedMentions = { ...noMentions, ...(p.allowedMentions ?? {}) };
    if (p.allowedMentions.repliedUser === undefined) p.allowedMentions.repliedUser = false;
    if (!p.content && !p.embeds?.length && !p.files?.length && !p.components?.length) p.content = '​';
    return p;
}

// values: { optionName: { type, value } } (ids for users/roles/channels)
// resolved: { users: Map(id -> User), members: Map(id -> GuildMember) } fetched by the handler before running.
function createTextInteraction({ message, commandName, subcommandName = null, values = {}, resolved = { users: new Map(), members: new Map() } }) {
    const client = message.client;
    const guild = message.guild;
    let replyMessage = null;
    const channelPerms = message.channel?.permissionsFor?.(message.member) ?? message.member?.permissions;

    const valueOf = (name, type) => { const v = values[name]; return v && (type === undefined || v.type === type) ? v.value : null; };
    const interaction = {
        client, guild, guildId: guild.id, channel: message.channel, channelId: message.channelId, user: message.author, member: message.member,
        memberPermissions: channelPerms, appPermissions: guild.members?.me?.permissions ?? null, locale: guild.preferredLocale ?? 'en-US',
        commandName, createdTimestamp: message.createdTimestamp, id: message.id, deferred: false, replied: false, ephemeral: false,
        isTextCommand: true, sourceMessage: message,
        inGuild: () => true, inCachedGuild: () => true,
        isChatInputCommand: () => true, isButton: () => false, isModalSubmit: () => false, isStringSelectMenu: () => false, isAutocomplete: () => false,
        options: {
            getSubcommand: () => subcommandName,
            getSubcommandGroup: () => null,
            get: (name) => (values[name] ? { name, value: values[name].value } : null),
            getString: (name) => valueOf(name, T.STRING),
            getInteger: (name) => valueOf(name, T.INTEGER),
            getNumber: (name) => valueOf(name, T.NUMBER) ?? valueOf(name, T.INTEGER),
            getBoolean: (name) => valueOf(name, T.BOOLEAN),
            getUser: (name) => { const id = valueOf(name); return id ? resolved.users.get(id) ?? null : null; },
            getMember: (name) => { const id = valueOf(name); return id ? resolved.members.get(id) ?? null : null; },
            getRole: (name) => { const id = valueOf(name, T.ROLE) ?? valueOf(name, T.MENTIONABLE); return id ? guild.roles.cache.get(id) ?? null : null; },
            getChannel: (name) => { const id = valueOf(name, T.CHANNEL); return id ? guild.channels.cache.get(id) ?? null : null; },
            getMentionable: (name) => { const id = valueOf(name); return id ? resolved.members.get(id) ?? resolved.users.get(id) ?? guild.roles.cache.get(id) ?? null : null; },
            getAttachment: () => null,
        },
        async reply(payload) {
            interaction.replied = true;
            replyMessage = await message.reply(toMessagePayload(payload));
            return replyMessage;
        },
        async deferReply() {
            interaction.deferred = true;
            await message.channel.sendTyping?.().catch(() => {});
        },
        async editReply(payload) {
            interaction.replied = true;
            if (replyMessage) return replyMessage.edit(toMessagePayload(payload));
            replyMessage = await message.reply(toMessagePayload(payload));
            return replyMessage;
        },
        async followUp(payload) {
            const sent = await message.channel.send(toMessagePayload(payload));
            replyMessage ??= sent;
            return sent;
        },
        async fetchReply() { return replyMessage; },
        async deleteReply() { await replyMessage?.delete().catch(() => {}); },
        async showModal() { throw new TextCommandUnsupported('This command opens a form, so it only works as a slash command.'); },
        async update() { throw new TextCommandUnsupported('Not available in text commands.'); },
        async deferUpdate() { throw new TextCommandUnsupported('Not available in text commands.'); },
    };
    return interaction;
}

module.exports = { createTextInteraction, TextCommandUnsupported, toMessagePayload };
