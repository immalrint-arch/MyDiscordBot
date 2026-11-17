const { SlashCommandBuilder } = require('discord.js');
const { handleBotInfo } = require('../../owner/ownerFlow');

module.exports = { data: new SlashCommandBuilder().setName('botinfo').setDescription('Show how the bot is doing: servers, uptime, ping and memory.').setDMPermission(false), execute: handleBotInfo };
