const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { respond, ensureModerator } = require('../../moderation/helpers');
const { GUIDES } = require('../../setup/guides');
const { overviewPayload, guidePayload, healthPayload, quickPlanPayload } = require('../../setup/setupFlow');

const PERM = PermissionFlagsBits.ManageGuild;
const CHOICES = [{ name: 'Checklist (overview)', value: 'overview' }, { name: 'Check my setup (find problems)', value: 'health' }, { name: 'Quick setup (create staff channels for me)', value: 'quick' },
    ...GUIDES.map((g) => ({ name: g.title.slice(0, 100), value: g.id }))];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('setup')
        .setDescription('Guided setup for beginners: a checklist, step-by-step guides, a problem finder and quick setup.')
        .setDefaultMemberPermissions(PERM)
        .setDMPermission(false)
        .addStringOption((o) => o.setName('topic').setDescription('Jump straight to a guide (start typing to search)').setAutocomplete(true)),

    // Autocomplete has no 25-choice limit, so new guides can always be added.
    async autocomplete(interaction) {
        const typed = String(interaction.options.getFocused() ?? '').toLowerCase().trim();
        const hits = CHOICES.filter((c) => !typed || c.name.toLowerCase().includes(typed) || c.value.includes(typed)).slice(0, 25);
        await interaction.respond(hits);
    },

    async execute(interaction) {
        if (!(await ensureModerator(interaction, PERM, 'Manage Server'))) return;
        const topic = interaction.options.getString('topic') ?? 'overview';
        if (!CHOICES.some((c) => c.value === topic)) return respond(interaction, 'I don’t know that topic. Start typing in the **topic** box and pick one from the list.', { ephemeral: true });
        const { client, guild, user } = interaction;
        if (topic === 'health') { await interaction.deferReply(); return respond(interaction, null, await healthPayload(client, guild, user.id)); }
        if (topic === 'quick') return respond(interaction, null, quickPlanPayload(client, guild, user.id));
        if (topic === 'overview') return respond(interaction, null, overviewPayload(client, guild, user.id));
        return respond(interaction, null, guidePayload(client, guild, user.id, topic));
    },
};
