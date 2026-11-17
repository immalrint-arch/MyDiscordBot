const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, MessageFlags, PermissionFlagsBits } = require('discord.js');
const logger = require('../utils/logger');
const { snapshot, evaluate, progressBar, SYSTEMS } = require('./status');
const { GUIDES, BY_ID } = require('./guides');
const { runHealth } = require('./health');
const { planQuick, runQuick } = require('./quick');
const { paginate } = require('../help/helpFlow');
const { quoteImageProblem } = require('../quotes/quoteImage');

const COLOR = 0x5865f2;
const NOBODY = { parse: [] };
const running = new Set(); // servers where quick setup is running right now

const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const canvasProblem = () => { try { return quoteImageProblem(); } catch { return null; } };

// ---------- shared parts ----------
// Discord allows at most 25 entries in one menu, so a long list is split into several menus (one per row).
function menuOptions(selected = 'overview') {
    return [
        { label: 'Checklist (overview)', value: 'overview', emoji: '🏠', description: 'What is done and what to do next' },
        { label: 'Check my setup', value: 'health', emoji: '🩺', description: 'Find missing permissions and broken channels' },
        { label: 'Quick setup', value: 'quick', emoji: '⚡', description: 'Create the staff channels and quarantine role for me' },
        ...GUIDES.map((g) => ({ label: clip(g.title, 100), value: g.id, emoji: g.emoji })),
    ].map((o) => ({ ...o, default: o.value === selected }));
}
function menuRows(uid, selected = 'overview') {
    const options = menuOptions(selected);
    const rows = [];
    for (let i = 0; i < options.length && rows.length < 3; i += 25) {
        const n = rows.length;
        rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`st:${uid}:menu${n ? n + 1 : ''}`).setPlaceholder(n ? 'More guides…' : 'Open a guide…').addOptions(options.slice(i, i + 25))));
    }
    return rows;
}
const button = (uid, action, arg, label, style = ButtonStyle.Secondary, extra = {}) =>
    new ButtonBuilder().setCustomId(`st:${uid}:${action}:${arg}:${extra.page ?? 0}`).setLabel(label).setStyle(style).setDisabled(Boolean(extra.disabled));

// ---------- the checklist ----------
function overviewPayload(client, guild, uid) {
    const snap = snapshot(client, guild);
    const { items, essentials } = evaluate(snap);
    const next = items.find((i) => i.essential && i.state !== 'done') ?? items.find((i) => i.state === 'partial');
    const intro = [
        `Welcome! This checklist shows what is set up in **${guild.name}** and what to do next. It updates as you go (press **Refresh**).`,
        '',
        `**Essentials:** ${progressBar(essentials.done, essentials.total)} **${essentials.done}/${essentials.total}**`,
        next ? `\n👉 **Next step:** ${next.title}: ${next.summary}${next.next ? `\n   Type: \`${next.next}\`` : ''}` : '\n🎉 **All essentials are done!** Everything else below is optional.',
        '',
        '⚡ Short on time? Press **Quick setup**: I create the staff channels and the quarantine role for you.',
        '🩺 Something not working? Press **Check my setup**.',
    ].join('\n');
    const embed = new EmbedBuilder().setColor(COLOR).setTitle('🧰 Incomu setup').setDescription(intro);
    const groups = [...new Set(items.map((i) => i.group))];
    for (const group of groups) {
        const lines = items.filter((i) => i.group === group).map((i) => `${i.icon} **${i.title}** — ${i.summary}${i.state !== 'done' && i.next ? `\n ↳ \`${i.next}\`` : ''}`);
        const chunks = paginate(lines, 1000);
        chunks.forEach((chunk, n) => embed.addFields({ name: n === 0 ? group : `${group} (continued)`, value: chunk }));
    }
    embed.setFooter({ text: '✅ done · 🟡 half done · ⬜ recommended · ➖ optional, not used' });
    return { embeds: [embed], components: [...menuRows(uid, 'overview'), new ActionRowBuilder().addComponents(
        button(uid, 'health', 'x', '🩺 Check my setup', ButtonStyle.Primary), button(uid, 'quick', 'plan', '⚡ Quick setup', ButtonStyle.Success),
        button(uid, 'go', 'basics', '🧭 Beginner basics'), button(uid, 'go', 'overview', '🔄 Refresh'))], allowedMentions: NOBODY };
}

// ---------- a guide ----------
function guidePayload(client, guild, uid, topic, page = 0) {
    const guide = BY_ID.get(topic);
    if (!guide) return overviewPayload(client, guild, uid);
    const pages = paginate(guide.text.split('\n'), 3300);
    const p = Math.min(Math.max(0, page), pages.length - 1);
    const embed = new EmbedBuilder().setColor(COLOR).setTitle(`${guide.emoji} ${guide.title}`).setDescription(pages[p]);
    if (guide.systems.length) {
        const { items } = evaluate(snapshot(client, guild));
        const mine = items.filter((i) => guide.systems.includes(i.id));
        if (mine.length) embed.addFields({ name: 'Your server right now', value: clip(mine.map((i) => `${i.icon} **${i.title}** — ${i.summary}`).join('\n'), 1000) });
    }
    embed.setFooter({ text: `${pages.length > 1 ? `Page ${p + 1}/${pages.length} · ` : ''}Type the commands in the chat box, using / first.` });
    const row = new ActionRowBuilder().addComponents(
        button(uid, 'go', topic, 'Previous', ButtonStyle.Secondary, { page: p - 1, disabled: p <= 0 }), button(uid, 'go', 'overview', '🏠 Checklist', ButtonStyle.Primary),
        button(uid, 'go', topic, 'Next', ButtonStyle.Secondary, { page: p + 1, disabled: p >= pages.length - 1 }));
    return { embeds: [embed], components: [...menuRows(uid, topic), row], allowedMentions: NOBODY };
}

// ---------- health ----------
async function healthPayload(client, guild, uid) {
    const report = await runHealth(client, guild, { canvasProblem: canvasProblem() });
    const embed = new EmbedBuilder().setColor(report.problemCount ? 0xe67e22 : 0x2ecc71).setTitle('🩺 Setup check')
        .setDescription(report.problemCount ? `I found **${report.problemCount}** thing${report.problemCount === 1 ? '' : 's'} to fix. Each one says how.` : '✅ **Everything looks good!** I have the permissions I need and my channels work.');
    for (const section of report.sections) {
        embed.addFields({ name: `${section.ok ? '✅' : '⚠️'} ${section.title}`.replace(/^(✅|⚠️) ([^ ]+) /, '$1 $2 '), value: clip([...section.lines, section.fix ? `\n💡 ${section.fix}` : ''].join('\n').trim(), 1024) });
    }
    return { embeds: [embed], components: [...menuRows(uid, 'health'), new ActionRowBuilder().addComponents(button(uid, 'health', 'x', '🔄 Check again', ButtonStyle.Primary), button(uid, 'go', 'overview', '🏠 Checklist'))], allowedMentions: NOBODY };
}

// ---------- quick setup ----------
function quickPlanPayload(client, guild, uid) {
    const steps = planQuick(snapshot(client, guild));
    const embed = new EmbedBuilder().setColor(COLOR).setTitle('⚡ Quick setup');
    if (!steps.length) {
        embed.setDescription('✅ The essentials are already connected: logs, appeals, reports, quarantine and anti-nuke alerts. Nothing to create!\n\nNext: switch on protection with `/antinuke enable` (server owner) and `/automod enable`.');
        return { embeds: [embed], components: [...menuRows(uid, 'quick'), new ActionRowBuilder().addComponents(button(uid, 'go', 'overview', '🏠 Checklist', ButtonStyle.Primary))], allowedMentions: NOBODY };
    }
    embed.setDescription(['I will do these things (only what is missing):', '', ...steps.map((s, n) => `**${n + 1}.** ${s.label}`), '',
        '🔒 Staff channels are visible only to roles that have **Administrator, Manage Server, Timeout Members or Manage Messages**, and to me.',
        '🛑 I do **not** turn on anti-nuke or auto-mod. You do that when you are ready (see the Security guide).', '', 'Needs me to have **Manage Channels** and **Manage Roles**. Only someone with **Manage Server** can confirm.'].join('\n'));
    return { embeds: [embed], components: [...menuRows(uid, 'quick'), new ActionRowBuilder().addComponents(
        button(uid, 'quick', 'confirm', '✅ Create it', ButtonStyle.Success), button(uid, 'quick', 'cancel', 'Cancel', ButtonStyle.Secondary))], allowedMentions: NOBODY };
}
async function quickRun(client, guild, uid, actorTag) {
    if (running.has(guild.id)) return { embeds: [new EmbedBuilder().setColor(COLOR).setDescription('⏳ Quick setup is already running. Please wait a moment.')], components: [], allowedMentions: NOBODY };
    running.add(guild.id);
    try {
        const me = await guild.members.fetchMe();
        if (!me.permissions.has(PermissionFlagsBits.ManageChannels) || !me.permissions.has(PermissionFlagsBits.ManageRoles)) {
            return { embeds: [new EmbedBuilder().setColor(0xe67e22).setTitle('⚡ Quick setup').setDescription('I need the **Manage Channels** and **Manage Roles** permissions first. Give them to my role in **Server Settings → Roles**, then try again.')],
                components: [new ActionRowBuilder().addComponents(button(uid, 'quick', 'plan', '🔄 Try again', ButtonStyle.Primary), button(uid, 'go', 'overview', '🏠 Checklist'))], allowedMentions: NOBODY };
        }
        const steps = planQuick(snapshot(client, guild));
        const result = await runQuick(client, guild, steps, { actorTag });
        const embed = new EmbedBuilder().setColor(result.lines.some((l) => l.startsWith('❌')) ? 0xe67e22 : 0x2ecc71).setTitle('⚡ Quick setup finished')
            .setDescription([...result.lines, '', '**What now?**', '• Turn on protection: `/antinuke enable` (owner) and `/automod enable`.', '• Add your other admins to the trust list: `/antinuke trust-add`.', '• Press **Check my setup** to double-check.'].join('\n').slice(0, 4000));
        return { embeds: [embed], components: [new ActionRowBuilder().addComponents(button(uid, 'health', 'x', '🩺 Check my setup', ButtonStyle.Primary), button(uid, 'go', 'overview', '🏠 Checklist'))], allowedMentions: NOBODY };
    } finally { running.delete(guild.id); }
}

// ---------- buttons and menus ----------
async function handleSetupComponent(interaction) {
    const [, uid, action, arg, page] = interaction.customId.split(':');
    const tell = (content) => interaction.reply({ content, flags: MessageFlags.Ephemeral, allowedMentions: NOBODY });
    if (interaction.user.id !== uid) return tell('This setup belongs to someone else. Type `/setup` to open your own.');
    if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) return tell('You need the **Manage Server** permission to use setup.');
    const { client, guild } = interaction;
    try {
        let target = action; let value = arg;
        if (action.startsWith('menu')) { value = interaction.values?.[0] ?? 'overview'; target = ['overview', 'health', 'quick'].includes(value) ? value : 'go'; }
        switch (target) {
            case 'overview': return interaction.update(overviewPayload(client, guild, uid));
            case 'health': await interaction.deferUpdate(); return interaction.editReply(await healthPayload(client, guild, uid));
            case 'quick':
                if (action.startsWith('menu') || value === 'plan') return interaction.update(quickPlanPayload(client, guild, uid));
                if (value === 'cancel') return interaction.update(overviewPayload(client, guild, uid));
                await interaction.update({ embeds: [new EmbedBuilder().setColor(COLOR).setTitle('⚡ Quick setup').setDescription('⏳ Working… this can take up to a minute while I lock channels for quarantine.')], components: [] });
                return interaction.editReply(await quickRun(client, guild, uid, interaction.user.username));
            default: return interaction.update(value === 'overview' ? overviewPayload(client, guild, uid) : guidePayload(client, guild, uid, value, Number(page) || 0));
        }
    } catch (error) {
        logger.error(`Setup component failed in server ${guild?.id}:`, error);
        return interaction.followUp?.({ content: 'Something went wrong. Please try `/setup` again.', flags: MessageFlags.Ephemeral }).catch(() => {});
    }
}

module.exports = { overviewPayload, guidePayload, healthPayload, quickPlanPayload, quickRun, handleSetupComponent, menuRows, menuOptions, running };
