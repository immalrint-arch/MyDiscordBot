const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { respond, ensureModerator } = require('../../moderation/helpers');
const { TextCommandServiceError } = require('../../services/textCommandService');
const { chooseSubcommand } = require('../../textcommands/parser');

const PERM = PermissionFlagsBits.ManageGuild;
const onOff = (v) => (v ? '✅ on' : '⛔ off');
const { SLASH_ONLY: NEVER_TEXT } = require('../../textcommands/slashOnly'); // these only work as slash commands

module.exports = {
    data: new SlashCommandBuilder()
        .setName('textcommands')
        .setDescription('Use commands by typing, like !ban. Change the prefix, aliases and allowed commands.')
        .setDefaultMemberPermissions(PERM)
        .setDMPermission(false)
        .addSubcommand((s) => s.setName('enable').setDescription('Turn text commands on.'))
        .addSubcommand((s) => s.setName('disable').setDescription('Turn text commands off.'))
        .addSubcommand((s) => s.setName('prefix').setDescription('Change the prefix (default !).')
            .addStringOption((o) => o.setName('prefix').setDescription('1 to 5 characters, e.g. ! or ? or . or $ or inc!').setRequired(true).setMaxLength(5)))
        .addSubcommand((s) => s.setName('mention').setDescription('Also allow "@Incomu ban @user" (default on).')
            .addBooleanOption((o) => o.setName('enabled').setDescription('On or off').setRequired(true)))
        .addSubcommand((s) => s.setName('block').setDescription('Stop one command from working as text (the slash version still works).')
            .addStringOption((o) => o.setName('command').setDescription('Command name, e.g. purge').setRequired(true).setMaxLength(32)))
        .addSubcommand((s) => s.setName('allow').setDescription('Allow a blocked command as text again.')
            .addStringOption((o) => o.setName('command').setDescription('Command name').setRequired(true).setMaxLength(32)))
        .addSubcommand((s) => s.setName('alias-add').setDescription('Make a short name, e.g. alias b for "ban".')
            .addStringOption((o) => o.setName('alias').setDescription('The short name, e.g. b').setRequired(true).setMaxLength(20))
            .addStringOption((o) => o.setName('command').setDescription('What it runs, e.g. ban or "automod status"').setRequired(true).setMaxLength(60)))
        .addSubcommand((s) => s.setName('alias-remove').setDescription('Delete an alias.')
            .addStringOption((o) => o.setName('alias').setDescription('The short name').setRequired(true).setMaxLength(20)))
        .addSubcommand((s) => s.setName('status').setDescription('Show the settings, aliases and blocked commands.')),

    async execute(interaction) {
        if (!(await ensureModerator(interaction, PERM, 'Manage Server'))) return;
        const { textCommands } = interaction.client.services;
        const commands = interaction.client.commands;
        const guild = interaction.guild;
        const sub = interaction.options.getSubcommand();
        const knownCommand = (name) => commands.get(String(name).toLowerCase());
        try {
            switch (sub) {
                case 'enable': {
                    textCommands.setEnabled(guild.id, true);
                    const c = textCommands.getConfig(guild.id);
                    return respond(interaction, `✅ Text commands are **on**. Try \`${c.prefix}case 1\` or \`${c.prefix}warn @someone reason\`.\nPermissions are exactly the same as the slash commands.`);
                }
                case 'disable': textCommands.setEnabled(guild.id, false); return respond(interaction, '⛔ Text commands are **off**. Slash commands are not affected.');
                case 'prefix': {
                    const prefix = interaction.options.getString('prefix', true);
                    textCommands.setPrefix(guild.id, prefix);
                    return respond(interaction, `✅ The prefix is now \`${prefix}\`. Example: \`${prefix}warn @someone reason\`.${textCommands.getConfig(guild.id).enabled ? '' : ' Text commands are still off: turn them on with `/textcommands enable`.'}`);
                }
                case 'mention': { const v = interaction.options.getBoolean('enabled', true); textCommands.setMentionPrefix(guild.id, v); return respond(interaction, `✅ Using @${interaction.client.user.username} as a prefix: ${onOff(v)}.`); }
                case 'block': case 'allow': {
                    const name = interaction.options.getString('command', true).toLowerCase().replace(/^\//, '');
                    if (!knownCommand(name)) return respond(interaction, `I do not know a command called \`${name}\`.`);
                    if (sub === 'block') {
                        if (NEVER_TEXT.has(name)) return respond(interaction, 'That one is already slash-only.');
                        return respond(interaction, textCommands.disableCommand(guild.id, name) ? `⛔ \`${name}\` no longer works as a text command.` : `\`${name}\` was already blocked.`);
                    }
                    return respond(interaction, textCommands.enableCommand(guild.id, name) ? `✅ \`${name}\` works as a text command again.` : `\`${name}\` was not blocked.`);
                }
                case 'alias-add': {
                    const alias = interaction.options.getString('alias', true).toLowerCase();
                    const target = interaction.options.getString('command', true).trim().toLowerCase().replace(/^\//, '');
                    if (knownCommand(alias)) return respond(interaction, `\`${alias}\` is already a real command, choose another short name.`);
                    const [name, subWord, ...extra] = target.split(/\s+/);
                    const command = knownCommand(name);
                    if (!command || NEVER_TEXT.has(name) || extra.length) return respond(interaction, `\`${target}\` is not a command I can run. Use a command name, optionally with one subcommand.`);
                    if (subWord && chooseSubcommand(command.data.toJSON(), subWord).consumedSub !== true) return respond(interaction, `\`${name}\` has no subcommand \`${subWord}\`.`);
                    textCommands.setAlias(guild.id, alias, target);
                    const prefix = textCommands.getConfig(guild.id).prefix;
                    return respond(interaction, `✅ \`${prefix}${alias}\` now runs \`${target}\`.`);
                }
                case 'alias-remove': return respond(interaction, textCommands.removeAlias(guild.id, interaction.options.getString('alias', true).toLowerCase()) ? '✅ Alias removed.' : 'There is no such alias.');
                case 'status': {
                    const c = textCommands.getConfig(guild.id);
                    const aliases = textCommands.listAliases(guild.id); const blocked = textCommands.listDisabled(guild.id);
                    return respond(interaction, [
                        '**Text command settings**', `Status: ${onOff(c.enabled)}`, `Prefix: \`${c.prefix}\``, `@mention prefix: ${onOff(c.mentionPrefix)}`,
                        `Aliases: ${aliases.length ? aliases.map((a) => `\`${a.alias}\`→${a.target}`).join(', ') : 'none'}`,
                        `Blocked as text: ${blocked.length ? blocked.map((b) => `\`${b}\``).join(', ') : 'none'}`,
                        '', 'Commands with pop-up forms or file uploads only work as slash commands. Wrong arguments get a usage hint.',
                    ].join('\n'));
                }
                default: return respond(interaction, 'Unknown option.');
            }
        } catch (error) {
            if (error instanceof TextCommandServiceError || error instanceof TypeError) return respond(interaction, `⚠️ ${error.message}`);
            throw error;
        }
    },
};
