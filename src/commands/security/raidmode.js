const { SlashCommandBuilder, ChannelType } = require('discord.js');
const { handleRaidCommand } = require('../../raid/raidFlow');

module.exports = {
    data: new SlashCommandBuilder().setName('raidmode').setDescription('Protect the server when many accounts join at once.').setDMPermission(false)
        .addSubcommand((s) => s.setName('setup').setDescription('Staff: turn on raid detection and choose the limits.')
            .addIntegerOption((o) => o.setName('joins').setDescription('Joins that count as a raid (3-100, default 10)').setMinValue(3).setMaxValue(100))
            .addIntegerOption((o) => o.setName('seconds').setDescription('...within this many seconds (5-300, default 30)').setMinValue(5).setMaxValue(300))
            .addStringOption((o) => o.setName('action').setDescription('What to do to new joiners during a raid').addChoices({ name: 'Only warn staff', value: 'alert' }, { name: 'Time them out for 1 hour', value: 'timeout' }, { name: 'Kick them', value: 'kick' }))
            .addIntegerOption((o) => o.setName('duration').setDescription('Minutes after the last raider before it ends (1-240, default 15)').setMinValue(1).setMaxValue(240))
            .addChannelOption((o) => o.setName('alert_channel').setDescription('Staff channel for alerts').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
            .addRoleOption((o) => o.setName('alert_role').setDescription('Role to ping when a raid starts'))
            .addBooleanOption((o) => o.setName('raise_verification').setDescription('Raise the verification level to High during a raid (default yes)'))
            .addBooleanOption((o) => o.setName('pause_invites').setDescription('Pause invites during a raid (default yes)')))
        .addSubcommand((s) => s.setName('enable').setDescription('Staff: turn raid detection back on.'))
        .addSubcommand((s) => s.setName('disable').setDescription('Staff: turn raid detection off.'))
        .addSubcommand((s) => s.setName('start').setDescription('Staff: switch raid mode on right now.'))
        .addSubcommand((s) => s.setName('end').setDescription('Staff: switch raid mode off and restore settings.'))
        .addSubcommand((s) => s.setName('status').setDescription('Show the raid settings and recent raids.')),
    execute: handleRaidCommand,
};
