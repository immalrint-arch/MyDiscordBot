const { Events } = require('discord.js');

// Editing a message into something forbidden must not be a way around the rules.
module.exports = {
    name: Events.MessageUpdate,
    async execute(oldMessage, newMessage) {
        if (newMessage.partial || !newMessage.guild || newMessage.content == null) return;
        if (oldMessage.content === newMessage.content) return; // e.g. only an embed appeared
        await newMessage.client.services.automodProcessor.handleMessage(newMessage);
    },
};
