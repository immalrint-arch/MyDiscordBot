const { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, MessageFlags } = require('discord.js');
const { EXAMPLES, TIPS, OPTION_TYPES, buildIndex, search, usageLine } = require('./catalog');
const { SLASH_ONLY } = require('../textcommands/slashOnly');

const COLOR = 0x5865f2;
const NOBODY = { parse: [] };
const PAGE_CHARS = 3300;

// ---------- helpers ----------
const indexFor = (client) => buildIndex([...client.commands.values()].map((c) => c.data.toJSON()));
const clip = (text, max) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

// Cuts a long text into pages at line breaks.
function paginate(lines, max = PAGE_CHARS) {
    const pages = []; let current = '';
    for (const line of lines) {
        if (current && current.length + line.length + 1 > max) { pages.push(current); current = ''; }
        current += (current ? '\n' : '') + line;
    }
    if (current) pages.push(current);
    return pages.length ? pages : [''];
}

// Discord allows at most 25 entries in one menu, so a long list is split into several menus.
function menuRows(uid, index, selected = 'home') {
    const options = [{ label: 'Start here', value: 'home', emoji: '🏠', description: 'How to use this help', default: selected === 'home' },
        ...index.categories.map((c) => ({ label: c.title, value: c.id, emoji: c.emoji, description: clip(c.blurb, 95), default: selected === c.id }))];
    const rows = [];
    for (let i = 0; i < options.length && rows.length < 3; i += 25) {
        const n = rows.length;
        rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`hp:${uid}:menu${n ? n + 1 : ''}`).setPlaceholder(n ? 'More topics…' : 'Pick a topic…').addOptions(options.slice(i, i + 25))));
    }
    return rows;
}
function pageRow(uid, categoryId, page, pages) {
    return new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`hp:${uid}:go:${categoryId}:${page - 1}`).setLabel('Previous').setStyle(ButtonStyle.Secondary).setDisabled(page <= 0),
        new ButtonBuilder().setCustomId(`hp:${uid}:go:home:0`).setLabel('Home').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(`hp:${uid}:go:${categoryId}:${page + 1}`).setLabel('Next').setStyle(ButtonStyle.Secondary).setDisabled(page >= pages - 1));
}

// ---------- the pages ----------
function homePayload(client, uid, { prefix = null } = {}) {
    const index = indexFor(client);
    const total = [...index.byName.values()].reduce((n, c) => n + Math.max(1, c.subs.length), 0);
    const embed = new EmbedBuilder().setColor(COLOR).setTitle('📖 Incomu help')
        .setDescription([
            `Hi! I have **${index.byName.size} commands** (${total} actions in total). Everything is a **slash command**: type \`/\` in the message box and pick one.`,
            '',
            '**🆕 Brand new? Start here**',
            '1️⃣ Run `/setup` — a guided checklist that shows what is done and what to do next.',
            '2️⃣ In `/setup`, press **Check my setup** to find missing permissions.',
            '3️⃣ Come back here and pick a topic below to see every command.',
            '',
            '**How to read command help**',
            '• `/ban add user reason` means: type `/ban`, choose **add**, then fill the boxes.',
            '• `<user>` is **required**, `[reason]` is optional.',
            '• Moderators only see the commands they have permission for.',
            '',
            '**Handy**',
            '• `/help command:ban` — full help for one command, with examples.',
            '• `/help command:punish` — search by any word.',
            prefix ? `• Text commands are **on**: you can also type \`${prefix}ban @user reason\`.` : '• Want to type `!ban @user` instead of `/ban`? See `/help command:textcommands`.',
        ].join('\n'))
        .addFields({ name: 'Topics', value: index.categories.map((c) => `${c.emoji} **${c.title}** — ${c.commands.length} command${c.commands.length === 1 ? '' : 's'}`).join('\n').slice(0, 1024) })
        .setFooter({ text: 'Pick a topic in the menu below.' });
    return { embeds: [embed], components: menuRows(uid, index, 'home'), allowedMentions: NOBODY };
}

function categoryPayload(client, uid, categoryId, page = 0) {
    const index = indexFor(client);
    const category = index.categories.find((c) => c.id === categoryId);
    if (!category) return homePayload(client, uid);
    const lines = [];
    for (const name of category.commands) {
        const c = index.byName.get(name);
        lines.push(`### /${name}`, c.description);
        if (c.subs.length) lines.push(`**Actions:** ${c.subs.map((s) => `\`${s.name}\``).join(' · ')}`);
        else if (c.options.length) lines.push(`**Usage:** \`${usageLine(name, '', c.options)}\``);
        if (c.permissions.length) lines.push(`🔒 Needs: ${c.permissions.join(', ')}`);
        lines.push('');
    }
    const pages = paginate(lines);
    const p = Math.min(Math.max(0, page), pages.length - 1);
    const embed = new EmbedBuilder().setColor(COLOR).setTitle(`${category.emoji} ${category.title}`).setDescription(`${category.blurb}\n\n${pages[p]}`)
        .setFooter({ text: `${pages.length > 1 ? `Page ${p + 1}/${pages.length} · ` : ''}Details: /help command:<name>` });
    const components = menuRows(uid, index, category.id);
    if (pages.length > 1) components.push(pageRow(uid, category.id, p, pages.length));
    return { embeds: [embed], components, allowedMentions: NOBODY };
}

const describeOption = (o) => {
    const type = OPTION_TYPES[o.type] ?? 'value';
    const extra = o.choices?.length ? ` Choices: ${o.choices.map((c) => `\`${c.value}\``).join(', ')}.` : '';
    const range = o.min_value !== undefined || o.max_value !== undefined ? ` (${o.min_value ?? '…'} to ${o.max_value ?? '…'})` : '';
    return `• \`${o.name}\` — ${o.required ? '**required**' : 'optional'}, ${type}${range}. ${o.description}${extra}`;
};

function commandPayload(client, uid, found) {
    const { command: c, sub } = found;
    const embed = new EmbedBuilder().setColor(COLOR).setTitle(sub ? `/${c.name} ${sub.name}` : `/${c.name}`).setDescription(sub ? sub.description : c.description);
    embed.addFields({ name: 'Who can use it', value: c.permissions.length ? `🔒 ${c.permissions.join(', ')}` : '✅ Everyone', inline: true });
    if (SLASH_ONLY.has(c.name)) embed.addFields({ name: 'Typing it', value: 'Slash command only.', inline: true });
    const usageLines = sub ? [usageLine(c.name, sub.name, sub.options)] : c.subs.length ? c.subs.map((s) => `${usageLine(c.name, s.name, s.options)}`) : [usageLine(c.name, '', c.options)];
    const joined = usageLines.map((l) => `\`${l}\``);
    embed.addFields({ name: sub || !c.subs.length ? 'Usage' : 'All actions', value: clip(joined.join('\n'), 1024) });
    if (!sub && c.subs.length) {
        const descriptions = c.subs.map((s) => `• **${s.name}** — ${s.description}`).join('\n');
        embed.addFields({ name: 'What each action does', value: clip(descriptions, 1024) });
        embed.addFields({ name: 'Want details?', value: `\`/help command:${c.name} ${c.subs[0].name}\` shows every box of one action.` });
    }
    const options = sub ? sub.options : c.subs.length ? [] : c.options;
    if (options.length) embed.addFields({ name: 'The boxes', value: clip(options.map(describeOption).join('\n'), 1024) });
    const examples = (EXAMPLES[c.name] ?? []).filter((e) => !sub || e.startsWith(`/${c.name} ${sub.name}`));
    if (examples.length) embed.addFields({ name: 'Examples', value: clip(examples.map((e) => `\`${e}\``).join('\n'), 1024) });
    if (TIPS[c.name] && !sub) embed.addFields({ name: '💡 Tip', value: TIPS[c.name] });
    embed.setFooter({ text: '<required> · [optional] — type / and pick the command to use it' });
    return { embeds: [embed], components: menuRows(uid, indexFor(client), 'home'), allowedMentions: NOBODY };
}

function searchPayload(client, uid, query, result) {
    const embed = new EmbedBuilder().setColor(COLOR);
    const index = indexFor(client);
    if (result.matches.length) {
        embed.setTitle(`🔎 Results for “${clip(query, 40)}”`).setDescription(result.matches.map((n) => { const c = index.byName.get(n); return `**/${n}** — ${c.description}`; }).join('\n') + '\n\nOpen one with `/help command:<name>`.');
    } else if (result.close.length) {
        embed.setTitle('🤔 No command with that name').setDescription(`Did you mean ${result.close.map((n) => `\`/${n}\``).join(', ')}?`);
    } else {
        embed.setTitle('🤔 Nothing found').setDescription(`I found nothing for “${clip(query, 40)}”. Try a simpler word like **ban**, **welcome**, **ticket**, or pick a topic in the menu.`);
    }
    return { embeds: [embed], components: menuRows(uid, index, 'home'), allowedMentions: NOBODY };
}

// ---------- menus and buttons ----------
async function handleHelpComponent(interaction) {
    const [, uid, action, arg, page] = interaction.customId.split(':');
    if (interaction.user.id !== uid) return interaction.reply({ content: 'This help belongs to someone else. Type `/help` to open your own.', flags: MessageFlags.Ephemeral, allowedMentions: NOBODY });
    const client = interaction.client;
    let target = 'home'; let pageNo = 0;
    if (action.startsWith('menu')) target = interaction.values?.[0] ?? 'home';
    else if (action === 'go') { target = arg; pageNo = Number(page) || 0; }
    return interaction.update(target === 'home' ? homePayload(client, uid, { prefix: textPrefix(client, interaction.guildId) }) : categoryPayload(client, uid, target, pageNo));
}
function textPrefix(client, guildId) {
    try { const c = client.services.textCommands.getConfig(guildId); return c.enabled ? c.prefix : null; } catch { return null; }
}

module.exports = { homePayload, categoryPayload, commandPayload, searchPayload, handleHelpComponent, indexFor, paginate, textPrefix, describeOption };
