const { Events, AuditLogEvent } = require('discord.js');

// Discord tells us "webhooks changed in this channel" but not which one, so we match the
// newest unused "webhook created" audit entry. Without an entry we do not count anything.
module.exports = {
    name: Events.WebhooksUpdate,
    async execute(channel) {
        if (!channel.guild) return;
        const { antinuke } = channel.client.services;
        if (!antinuke.isEnabled(channel.guild.id)) return;
        await antinuke.handleSignal(channel.guild, {
            rule: 'webhookCreate',
            targetName: `webhook in #${channel.name}`,
            auditType: AuditLogEvent.WebhookCreate,
            matchAny: true,
            requireEntry: true,
        });
    },
};
