const { Events } = require('discord.js');
const logger = require('../../utils/logger');
const { parseTriggerOptions, quoteProblem, buildQuotePayload, botCanQuoteIn } = require('../../quotes/quoteFlow');

// Reply to someone's message and ping the bot ("@Incomu") -> the bot answers with a quote picture.
module.exports = {
    name: Events.MessageCreate,
    async execute(message) {
        if (!message.inGuild() || message.author.bot || message.webhookId || message.system) return;
        if (!message.reference?.messageId) return; // must be a reply
        const client = message.client;
        const botId = client.user.id;
        // A real ping in the text (not just "reply with ping on", which also mentions the bot's own messages)
        if (!new RegExp(`<@!?${botId}>`).test(message.content)) return;

        const options = parseTriggerOptions(message.content, botId);
        if (!options) return; // they wrote something else: they are talking to the bot, not asking for a quote

        const { quotes } = client.services;
        const config = quotes.getConfig(message.guild.id);
        if (!config.enabled || !config.replyTrigger) return;

        const me = message.guild.members.me;
        if (!me || !botCanQuoteIn(message.channel, me)) return; // cannot reply here, stay silent

        const wait = quotes.checkCooldown(message.guild.id, message.author.id);
        if (wait > 0) return; // quietly ignore spam

        let target;
        try {
            target = await message.fetchReference();
        } catch {
            return; // the original message was deleted
        }
        const problem = quoteProblem(target);
        if (problem) {
            await message.reply({ content: problem, allowedMentions: { parse: [], repliedUser: false } }).catch(() => {});
            return;
        }

        try {
            const payload = await buildQuotePayload(target, { ...options, context: { requesterId: message.author.id } });
            await message.reply({ ...payload, allowedMentions: { parse: [], repliedUser: false } });
        } catch (error) {
            logger.error(`Could not make a quote in server ${message.guild.id}: ${error.message}`);
            await message.reply({ content: 'I could not make that quote. Please try again in a moment.', allowedMentions: { parse: [], repliedUser: false } }).catch(() => {});
        }
    },
};
