const { PermissionsBitField } = require('discord.js');
const logger = require('../utils/logger');
const { tokenize, parseArguments, chooseSubcommand, usageLine, T } = require('./parser');
const { SLASH_ONLY } = require('./slashOnly');
const { BUILTIN_ALIASES } = require('./builtinAliases');
const { runTextTag } = require('../custom/customFlow');
const { checkCommandAccess, isBlocked } = require('../access/accessFlow');
const { createTextInteraction, TextCommandUnsupported, toMessagePayload } = require('./adapter');

const THROTTLE_MS = 1200; // one text command per person per 1.2 seconds
const lastUse = new Map();

// Finds the command word. Returns { commandWord, rest } or null when the message is not a text command.
//   "!ban @x spam"            -> { commandWord: 'ban', rest: '@x spam' }
//   "<@bot> ban @x spam"      -> same (when "mention prefix" is on)
function splitInvocation(content, { prefix, botId, mentionPrefix }) {
    let text = String(content ?? '');
    if (mentionPrefix) {
        const m = text.match(new RegExp(`^<@!?${botId}>\\s+`));
        if (m) text = text.slice(m[0].length);
        else if (!text.startsWith(prefix)) return null;
        else text = text.slice(prefix.length);
    } else {
        if (!text.startsWith(prefix)) return null;
        text = text.slice(prefix.length);
    }
    const m = text.match(/^(\S+)(?:\s+([\s\S]*))?$/);
    if (!m) return null;
    return { commandWord: m[1].toLowerCase(), rest: (m[2] ?? '').trim() };
}

// Does the member have the permissions Discord would demand for the slash command?
function missingPermissions(commandJson, permissions) {
    const raw = commandJson.default_member_permissions;
    if (raw === null || raw === undefined || raw === '0') return [];
    const mask = BigInt(raw);
    if (permissions?.has?.(mask)) return [];
    try {
        return new PermissionsBitField(mask).toArray().filter((name) => !permissions?.has?.(PermissionsBitField.Flags[name])).map((n) => n.replace(/([a-z])([A-Z])/g, '$1 $2'));
    } catch {
        return ['the required permission'];
    }
}

const say = (message, content) => message.reply(toMessagePayload(content)).catch(() => {});

async function handleTextMessage(message, { now = Date.now } = {}) {
    if (!message.inGuild?.() || message.author.bot || message.webhookId || message.system) return false;
    const client = message.client;
    const { textCommands } = client.services;
    const config = textCommands.getConfig(message.guild.id);
    if (!config.enabled) return false;
    const invocation = splitInvocation(message.content, { prefix: config.prefix, botId: client.user.id, mentionPrefix: config.mentionPrefix });
    if (!invocation) return false;
    if (isBlocked(client, message.author.id)) return true; // blocked by the bot owner: stay silent

    // aliases:  b -> "ban add"
    let { commandWord, rest } = invocation;
    const alias = textCommands.getAlias(message.guild.id, commandWord);
    if (alias) {
        const [first, ...more] = alias.split(/\s+/);
        commandWord = first;
        if (more.length) rest = `${more.join(' ')} ${rest}`.trim();
    }
    if (!client.commands.has(commandWord) && BUILTIN_ALIASES[commandWord]) {
        const [first, ...more] = BUILTIN_ALIASES[commandWord].split(' ');
        commandWord = first;
        rest = `${more.join(' ')} ${rest}`.trim();
    }
    const command = client.commands.get(commandWord);
    if (!command) return runTextTag(message, commandWord, rest); // a custom command like !rules? Otherwise stay quiet, it may be normal chat
    if (textCommands.isDisabled(message.guild.id, commandWord)) return false;
    const denied = checkCommandAccess(client, { guild: message.guild, member: message.member, channel: message.channel, commandName: commandWord, userId: message.author.id, isAdmin: message.member?.permissions?.has?.(PermissionsBitField.Flags.Administrator) });
    if (denied) { await say(message, denied); return true; }

    if (SLASH_ONLY.has(commandWord)) {
        // "!confess my secret" is public: remove it right away (if I am allowed) and point to the private way.
        if (commandWord === 'confess') await message.delete?.().catch(() => {});
        await message.channel?.send?.({ content: `<@${message.author.id}> \`${commandWord}\` only works as a slash command${commandWord === 'confess' ? ' (so it stays anonymous). Type `/confess` instead.' : '.'}`, allowedMentions: { users: [message.author.id] } }).catch(() => {});
        return true;
    }

    const time = now();
    if (time - (lastUse.get(message.author.id) ?? 0) < THROTTLE_MS) return true;
    lastUse.set(message.author.id, time);
    if (lastUse.size > 5000) for (const [k, v] of lastUse) if (time - v > 60000) lastUse.delete(k);

    const json = command.data.toJSON();
    const missing = missingPermissions(json, message.channel?.permissionsFor?.(message.member) ?? message.member?.permissions);
    if (missing.length) { await say(message, `You need the **${missing.join(', ')}** permission to use \`${commandWord}\`.`); return true; }

    // which subcommand, which options
    const firstWord = tokenize(rest)[0]?.text;
    const chosen = chooseSubcommand(json, firstWord);
    if (chosen.error) { await say(message, `⚠️ ${chosen.error}`); return true; }
    const argsText = chosen.consumedSub ? rest.slice(rest.toLowerCase().indexOf(firstWord.toLowerCase()) + firstWord.length).trim() : rest;
    const parsed = parseArguments(chosen.defs, argsText);
    if (parsed.error) { await say(message, `⚠️ ${parsed.error}\nUsage: \`${usageLine(config.prefix, chosen.path, chosen.defs)}\``); return true; }

    // look up the people, roles and channels that were mentioned
    const resolved = { users: new Map(), members: new Map() };
    for (const [name, entry] of Object.entries(parsed.values)) {
        const def = chosen.defs.find((d) => d.name === name);
        if (entry.type === T.USER || entry.type === T.MENTIONABLE) {
            const isRole = entry.type === T.MENTIONABLE && message.guild.roles.cache.has(entry.value);
            if (isRole) continue;
            const user = await client.users.fetch(entry.value).catch(() => null);
            if (!user) { if (def.required) { await say(message, `⚠️ I could not find that user for **${name}**.`); return true; } delete parsed.values[name]; continue; }
            resolved.users.set(user.id, user);
            const member = await message.guild.members.fetch(user.id).catch(() => null);
            if (member) resolved.members.set(user.id, member);
        } else if (entry.type === T.ROLE && !message.guild.roles.cache.has(entry.value)) {
            await say(message, `⚠️ I could not find that role for **${name}**.`); return true;
        } else if (entry.type === T.CHANNEL && !message.guild.channels.cache.has(entry.value)) {
            await say(message, `⚠️ I could not find that channel for **${name}**.`); return true;
        }
    }

    const interaction = createTextInteraction({ message, commandName: commandWord, subcommandName: chosen.subName ?? null, values: parsed.values, resolved });
    try {
        await command.execute(interaction);
    } catch (error) {
        if (error instanceof TextCommandUnsupported) await say(message, `⚠️ ${error.message}`);
        else {
            logger.error(`Text command "${commandWord}" failed in server ${message.guild.id}: ${error.stack ?? error.message}`);
            await say(message, '⚠️ Something went wrong running that command.');
        }
    }
    return true;
}

module.exports = { handleTextMessage, splitInvocation, missingPermissions, THROTTLE_MS };
