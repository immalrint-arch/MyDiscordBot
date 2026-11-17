const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { handleWarnEscalationCommand } = require('../../moderation/escalationFlow');
const R = require('../../moderation/escalation');

const warnings = (o, what = 'How many active warnings') => o.setName('warnings').setDescription(what).setRequired(true).setMinValue(1).setMaxValue(R.MAX_THRESHOLD);
module.exports = {
    data: new SlashCommandBuilder().setName('warnescalation').setDescription('Staff: automatic timeout, kick or ban when a member collects warnings.').setDMPermission(false).setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .addSubcommand((s) => s.setName('add').setDescription('Add or change a rule, like "3 warnings = 1 hour timeout".').addIntegerOption((o) => warnings(o))
            .addStringOption((o) => o.setName('action').setDescription('What happens').setRequired(true).addChoices({ name: 'Timeout', value: 'timeout' }, { name: 'Kick', value: 'kick' }, { name: 'Ban', value: 'ban' }))
            .addIntegerOption((o) => o.setName('minutes').setDescription('Timeout length in minutes (needed for timeout)').setMinValue(1).setMaxValue(R.MAX_TIMEOUT_MINUTES)))
        .addSubcommand((s) => s.setName('remove').setDescription('Delete a rule.').addIntegerOption((o) => warnings(o, 'The rule for this many warnings')))
        .addSubcommand((s) => s.setName('toggle').setDescription('Turn warn escalation on or off.').addBooleanOption((o) => o.setName('enabled').setDescription('On or off').setRequired(true)))
        .addSubcommand((s) => s.setName('window').setDescription('Only count warnings from the last N days (0 = all).').addIntegerOption((o) => o.setName('days').setDescription('Days (0 to 365)').setRequired(true).setMinValue(0).setMaxValue(R.MAX_WINDOW_DAYS)))
        .addSubcommand((s) => s.setName('list').setDescription('Show the rules.')),
    execute: handleWarnEscalationCommand,
};
