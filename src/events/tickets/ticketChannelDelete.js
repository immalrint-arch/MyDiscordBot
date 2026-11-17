const { Events } = require('discord.js');

// If someone deletes a ticket channel by hand, the ticket must not stay "open" forever
// (it would count against the member's limit).
module.exports = {
    name: Events.ChannelDelete,
    async execute(channel) {
        if (!channel.guild) return;
        const { tickets } = channel.client.services;
        const ticket = tickets.getByChannel(channel.id);
        if (ticket && ticket.status === 'open') tickets.close(ticket.id, null, 'Channel was deleted');
    },
};
