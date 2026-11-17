const crypto = require('node:crypto');
const { SlashCommandBuilder, PermissionFlagsBits, AttachmentBuilder, MessageFlags } = require('discord.js');
const logger = require('../../utils/logger');
const { cleanReason } = require('../../utils/text');
const B = require('../../modextras/banlist');
const { respond, ensureModerator, describeError } = require('../../moderation/helpers');
const massban = require('./massban');

const PERM = PermissionFlagsBits.BanMembers;
const fetchBans = async (guild) => [...(await guild.bans.fetch()).values()].map((b) => ({ id: b.user.id, username: b.user.username, reason: b.reason }));

// Shows a preview and the same Confirm / Cancel buttons that /massban uses.
async function preview(interaction, { ids, label, reason, extra = [] }) {
    const guild = interaction.guild; const me = await guild.members.fetchMe();
    if (!me.permissions.has(PERM)) return respond(interaction, 'I need the **Ban Members** permission to do that.');
    const existing = new Set((await fetchBans(guild)).map((b) => b.id));
    const skip = new Set([interaction.user.id, me.id, guild.ownerId]);
    const fresh = ids.filter((id) => !existing.has(id) && !skip.has(id));
    if (!fresh.length) return respond(interaction, `Nothing to ban: all ${ids.length} account${ids.length === 1 ? ' is' : 's are'} already banned here (or are you, me or the owner).`);
    if (fresh.length > B.MAX_IMPORT) return respond(interaction, `That would ban ${fresh.length} accounts. The limit is ${B.MAX_IMPORT} at a time: split the file in parts.`);
    massban.sweep(Date.now()); const token = crypto.randomBytes(5).toString('hex');
    massban.pending.set(token, { guildId: guild.id, moderatorId: interaction.user.id, ids: fresh, reason, deleteSeconds: 0, expires: Date.now() + massban.EXPIRES_MS });
    return respond(interaction, [`### ⚠️ Ban ${fresh.length} account${fresh.length === 1 ? '' : 's'}?`, `📥 **Source:** ${label}`, `📋 **Reason:** ${reason}`, ...extra, `🔁 ${ids.length - fresh.length} already banned or skipped.`,
        fresh.slice(0, 5).map((id) => ` ▸ \`${id}\``).join('\n') + (fresh.length > 5 ? `\n …and ${fresh.length - 5} more` : ''), `Only <@${interaction.user.id}> can confirm. This expires in 2 minutes.`].join('\n'), { components: [massban.buttons(token)] });
}

module.exports = {
    data: new SlashCommandBuilder().setName('banlist').setDescription('Staff: export this server\'s bans to a file, or import bans from a file or another server.').setDMPermission(false).setDefaultMemberPermissions(PERM)
        .addSubcommand((s) => s.setName('export').setDescription('Get a file with everyone banned here (only you can see it).'))
        .addSubcommand((s) => s.setName('import').setDescription('Ban the accounts listed in a .txt or .csv file (you confirm first).')
            .addAttachmentOption((o) => o.setName('file').setDescription('A file with one user ID per line, or an export from /banlist').setRequired(true))
            .addStringOption((o) => o.setName('reason').setDescription('Why they are being banned').setMaxLength(300)))
        .addSubcommand((s) => s.setName('copy').setDescription('Ban the accounts banned in another server where you can ban too.')
            .addStringOption((o) => o.setName('server').setDescription('The ID of the other server (the bot must be in it)').setRequired(true).setMinLength(17).setMaxLength(20))
            .addStringOption((o) => o.setName('reason').setDescription('Why they are being banned').setMaxLength(300))),

    async execute(interaction) {
        if (!(await ensureModerator(interaction, PERM, 'Ban Members'))) return;
        const sub = interaction.options.getSubcommand(); const guild = interaction.guild;
        const priv = sub === 'export'; await interaction.deferReply(priv ? { flags: MessageFlags.Ephemeral } : undefined);
        try {
            if (sub === 'export') {
                const me = await guild.members.fetchMe(); if (!me.permissions.has(PERM)) return respond(interaction, 'I need the **Ban Members** permission to read the ban list.');
                const bans = await fetchBans(guild); const text = B.formatBanList(bans, { guildName: guild.name });
                return respond(interaction, `📤 ${bans.length} ban${bans.length === 1 ? '' : 's'} exported. This file holds private moderation data: keep it safe.`, { files: [new AttachmentBuilder(Buffer.from(text, 'utf8'), { name: `banlist-${guild.id}-${new Date().toISOString().slice(0, 10)}.csv` })] });
            }
            const reasonText = cleanReason(interaction.options.getString('reason')) ?? 'No reason provided';
            if (sub === 'import') {
                const file = interaction.options.getAttachment('file');
                if (!file) return respond(interaction, 'Attach a `.txt` or `.csv` file with the slash command `/banlist import`.');
                if (!B.fileLooksLikeText(file)) return respond(interaction, 'The file must be a `.txt` or `.csv` text file.');
                if ((file.size ?? 0) > B.MAX_FILE_BYTES) return respond(interaction, 'That file is too big (1 MB at most).');
                if (!B.isDiscordFileUrl(file.url)) return respond(interaction, 'I can only read files uploaded to Discord.');
                const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 15000);
                let text; try { const res = await fetch(file.url, { signal: controller.signal }); if (!res.ok) throw new Error(`HTTP ${res.status}`); text = await res.text(); } catch (error) { return respond(interaction, `I could not download the file (${error.name === 'AbortError' ? 'too slow' : error.message}).`); } finally { clearTimeout(timer); }
                const { ids, skipped } = B.parseBanFile(text);
                if (!ids.length) return respond(interaction, 'I found no user IDs in that file. Put one ID (17-20 digits) at the start of each line.');
                return preview(interaction, { ids, label: `file \`${String(file.name).slice(0, 60)}\``, reason: `Ban list import: ${reasonText}`.slice(0, 400), extra: skipped ? [`ℹ️ ${skipped} line${skipped === 1 ? '' : 's'} had no ID and were ignored.`] : [] });
            }
            // copy
            const sourceId = interaction.options.getString('server', true).trim(); const source = /^\d{17,20}$/.test(sourceId) ? interaction.client.guilds.cache.get(sourceId) : null;
            if (!source) return respond(interaction, 'I am not in a server with that ID. Invite me there first, then try again.');
            if (source.id === guild.id) return respond(interaction, 'That is this server. Pick a different one.');
            const theirs = await source.members.fetch(interaction.user.id).catch(() => null);
            if (!theirs?.permissions.has(PERM) && source.ownerId !== interaction.user.id) return respond(interaction, `You need the **Ban Members** permission in **${source.name}** too.`);
            const sourceMe = await source.members.fetchMe(); if (!sourceMe.permissions.has(PERM)) return respond(interaction, `I need the **Ban Members** permission in **${source.name}** to read its ban list.`);
            const ids = (await fetchBans(source)).map((b) => b.id); if (!ids.length) return respond(interaction, `**${source.name}** has no bans.`);
            return preview(interaction, { ids, label: `server **${source.name}**`, reason: `Ban list copied from ${source.name}: ${reasonText}`.slice(0, 400) });
        } catch (error) {
            logger.error(`banlist ${sub} failed in server ${guild.id}:`, error);
            return respond(interaction, `Something went wrong: ${describeError(error)}.`);
        }
    },
};
