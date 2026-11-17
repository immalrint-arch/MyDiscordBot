const { SlashCommandBuilder } = require('discord.js');
const { handleTagCommand } = require('../../custom/customFlow');

const name = (o, what = 'The command name') => o.setName('name').setDescription(`${what} (letters, numbers, - and _)`).setRequired(true).setMaxLength(32);
const reply = (o) => o.setName('response').setDescription('The reply text. Leave empty to type it in a form. Use \\n for a new line.').setMaxLength(1900);

module.exports = {
    data: new SlashCommandBuilder().setName('tag').setDescription('Custom commands: saved replies anyone can use, like !rules or !ip.').setDMPermission(false)
        .addSubcommand((s) => s.setName('use').setDescription('Send a custom command.').addStringOption((o) => name(o)))
        .addSubcommand((s) => s.setName('list').setDescription('List all custom commands.'))
        .addSubcommand((s) => s.setName('info').setDescription('Show how a custom command is set up.').addStringOption((o) => name(o)))
        .addSubcommand((s) => s.setName('create').setDescription('Staff: make a new custom command.').addStringOption((o) => name(o, 'A new name')).addStringOption((o) => reply(o)))
        .addSubcommand((s) => s.setName('edit').setDescription('Staff: change what a custom command says.').addStringOption((o) => name(o)).addStringOption((o) => reply(o)))
        .addSubcommand((s) => s.setName('delete').setDescription('Staff: delete a custom command.').addStringOption((o) => name(o))),
    execute: handleTagCommand,
};
