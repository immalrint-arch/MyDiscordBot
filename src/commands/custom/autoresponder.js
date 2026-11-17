const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { respond, ensureModerator } = require('../../moderation/helpers');
const R = require('../../custom/rules');
const { CustomServiceError } = require('../../services/customService');

const PERM = PermissionFlagsBits.ManageGuild;
const TYPE_TEXT = { contains: 'contains', exact: 'is exactly', starts: 'starts with', word: 'has the word' };

module.exports = {
    data: new SlashCommandBuilder().setName('autoresponder').setDescription('Staff: reply automatically when a message contains certain words.').setDMPermission(false)
        .setDefaultMemberPermissions(PERM)
        .addSubcommand((s) => s.setName('add').setDescription('Add an auto-reply.')
            .addStringOption((o) => o.setName('trigger').setDescription('The word or phrase to look for').setRequired(true).setMinLength(R.MIN_TRIGGER).setMaxLength(R.MAX_TRIGGER))
            .addStringOption((o) => o.setName('response').setDescription('What I reply (can use {user} {username} {server} {channel} {members}). Use \\n for a new line.').setRequired(true).setMaxLength(1900))
            .addStringOption((o) => o.setName('match').setDescription('How to match (default: contains)').addChoices({ name: 'Contains the trigger anywhere', value: 'contains' }, { name: 'Has the trigger as a whole word', value: 'word' }, { name: 'Starts with the trigger', value: 'starts' }, { name: 'Is exactly the trigger', value: 'exact' }))
            .addIntegerOption((o) => o.setName('cooldown').setDescription(`Seconds before it can answer again (default ${R.DEFAULT_COOLDOWN}, max ${R.MAX_COOLDOWN})`).setMinValue(0).setMaxValue(R.MAX_COOLDOWN))
            .addChannelOption((o) => o.setName('channel').setDescription('Only answer in this channel (default: every channel)').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
        .addSubcommand((s) => s.setName('remove').setDescription('Delete an auto-reply.').addIntegerOption((o) => o.setName('id').setDescription('The number from /autoresponder list').setRequired(true).setMinValue(1)))
        .addSubcommand((s) => s.setName('toggle').setDescription('Turn an auto-reply on or off.').addIntegerOption((o) => o.setName('id').setDescription('The number from /autoresponder list').setRequired(true).setMinValue(1)).addBooleanOption((o) => o.setName('enabled').setDescription('On or off').setRequired(true)))
        .addSubcommand((s) => s.setName('list').setDescription('Show all auto-replies.'))
        .addSubcommand((s) => s.setName('test').setDescription('See which auto-reply a message would trigger (nothing is sent).').addStringOption((o) => o.setName('text').setDescription('A sample message').setRequired(true).setMaxLength(300))),
    async execute(interaction) {
        if (!(await ensureModerator(interaction, PERM, 'Manage Server'))) return;
        const { custom } = interaction.client.services; const o = interaction.options; const g = interaction.guildId; const sub = o.getSubcommand();
        try {
            if (sub === 'add') {
                const id = custom.responders.add(g, { trigger: o.getString('trigger', true), response: o.getString('response', true), matchType: o.getString('match') ?? 'contains', cooldownSeconds: o.getInteger('cooldown') ?? R.DEFAULT_COOLDOWN, channelId: o.getChannel('channel')?.id ?? null, createdBy: interaction.user.id });
                return respond(interaction, `✅ Auto-reply **#${id}** added. Check it with \`/autoresponder test\`.`);
            }
            if (sub === 'remove') { const id = o.getInteger('id', true); return respond(interaction, custom.responders.remove(g, id) ? `🗑️ Auto-reply #${id} deleted.` : `There is no auto-reply #${id}.`); }
            if (sub === 'toggle') { const id = o.getInteger('id', true); const on = o.getBoolean('enabled', true); return respond(interaction, custom.responders.setEnabled(g, id, on) ? `✅ Auto-reply #${id} is **${on ? 'on' : 'off'}**.` : `There is no auto-reply #${id}.`); }
            if (sub === 'test') { const r = custom.responders.findMatch(g, o.getString('text', true), interaction.channelId); return respond(interaction, r ? `✅ Auto-reply **#${r.id}** would answer (it ${TYPE_TEXT[r.matchType]} "${r.trigger}"):\n>>> ${r.response.slice(0, 500)}` : 'No auto-reply matches that text here.'); }
            const list = custom.responders.list(g);
            return respond(interaction, list.length ? ['**Auto-replies**', ...list.map((r) => `**#${r.id}** ${r.enabled ? '✅' : '⛔'} ${TYPE_TEXT[r.matchType]} "${r.trigger}"${r.channelId ? ` in <#${r.channelId}>` : ''} · cooldown ${r.cooldownSeconds}s · used ${r.uses}×`)].join('\n').slice(0, 1950) : 'There are no auto-replies yet. Add one with `/autoresponder add`.');
        } catch (error) { if (error instanceof CustomServiceError) return respond(interaction, `⚠️ ${error.message}`); throw error; }
    },
};
