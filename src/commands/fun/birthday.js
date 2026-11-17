const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { respond, ensureModerator } = require('../../moderation/helpers');
const rules = require('../../fun/rules');
const { cleanText } = require('../../utils/text');

const PERM = PermissionFlagsBits.ManageGuild;
const ADMIN_SUBS = new Set(['channel', 'role', 'message', 'disable', 'status']);
const describe = (bd, nowMs) => { const d = rules.daysUntil(bd, nowMs); return `**${bd.day} ${rules.MONTH_NAMES[bd.month - 1]}**${d === 0 ? ' — 🎂 **today!**' : ` — in ${d} day${d === 1 ? '' : 's'}`}`; };

module.exports = {
    data: new SlashCommandBuilder().setName('birthday').setDescription('Birthdays: save yours and get a birthday message.').setDMPermission(false)
        .addSubcommand((s) => s.setName('set').setDescription('Save my birthday.')
            .addIntegerOption((o) => o.setName('month').setDescription('Month').setRequired(true).addChoices(...rules.MONTH_NAMES.map((name, i) => ({ name, value: i + 1 }))))
            .addIntegerOption((o) => o.setName('day').setDescription('Day of the month').setRequired(true).setMinValue(1).setMaxValue(31))
            .addIntegerOption((o) => o.setName('year').setDescription('Birth year (optional, only to show your age)').setMinValue(1900).setMaxValue(2100))
            .addIntegerOption((o) => o.setName('utc-offset').setDescription('Your time zone, e.g. 8 for UTC+8, so your day starts on time (default 0)').setMinValue(-12).setMaxValue(14)))
        .addSubcommand((s) => s.setName('remove').setDescription('Delete my saved birthday.'))
        .addSubcommand((s) => s.setName('view').setDescription('Show someone\'s birthday.').addUserOption((o) => o.setName('user').setDescription('Whose birthday (default: you)')))
        .addSubcommand((s) => s.setName('upcoming').setDescription('Show the next birthdays in this server.'))
        .addSubcommand((s) => s.setName('channel').setDescription('Staff: where birthday messages are sent.').addChannelOption((o) => o.setName('channel').setDescription('A text channel').setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)))
        .addSubcommand((s) => s.setName('role').setDescription('Staff: a role to give for the birthday day (optional).').addRoleOption((o) => o.setName('role').setDescription('The birthday role (leave empty to stop giving one)')))
        .addSubcommand((s) => s.setName('message').setDescription('Staff: change the birthday message.')
            .addStringOption((o) => o.setName('text').setDescription('Use {user} {username} {server} {age}. Leave empty to reset.').setMaxLength(500)))
        .addSubcommand((s) => s.setName('disable').setDescription('Staff: stop birthday messages and roles.'))
        .addSubcommand((s) => s.setName('status').setDescription('Staff: show the birthday settings.')),

    async execute(interaction) {
        const { fun } = interaction.client.services; const { guild, user } = interaction; const sub = interaction.options.getSubcommand(); const now = Date.now();
        if (ADMIN_SUBS.has(sub) && !(await ensureModerator(interaction, PERM, 'Manage Server'))) return;
        switch (sub) {
            case 'set': {
                const bd = { month: interaction.options.getInteger('month', true), day: interaction.options.getInteger('day', true), year: interaction.options.getInteger('year'), utcOffset: interaction.options.getInteger('utc-offset') ?? 0 };
                const problem = rules.validateBirthday(bd, rules.localDate(now, 14).y); if (problem) return respond(interaction, `⚠️ ${problem}`);
                const saved = fun.birthdays.set(guild.id, user.id, bd);
                return respond(interaction, `🎂 Saved! Your birthday is ${describe(saved, now)}. Remove it any time with \`/birthday remove\`.`);
            }
            case 'remove': return respond(interaction, fun.birthdays.remove(guild.id, user.id) ? '🗑️ Your birthday was removed.' : 'You have not saved a birthday.');
            case 'view': { const target = interaction.options.getUser('user') ?? user; const bd = fun.birthdays.get(guild.id, target.id);
                return respond(interaction, bd ? `🎂 <@${target.id}>'s birthday: ${describe(bd, now)}` : `<@${target.id}> has not saved a birthday${target.id === user.id ? '. Use `/birthday set`' : ''}.`); }
            case 'upcoming': {
                const list = fun.birthdays.list(guild.id).filter((b) => guild.members.cache.has(b.userId)).map((b) => ({ b, d: rules.daysUntil(b, now) })).sort((x, y) => x.d - y.d).slice(0, 10);
                return respond(interaction, list.length ? ['**🎂 Upcoming birthdays**', ...list.map(({ b }) => `<@${b.userId}> — ${describe(b, now)}`)].join('\n') : 'Nobody has saved a birthday yet. Use `/birthday set`!');
            }
            case 'channel': { const c = interaction.options.getChannel('channel', true); fun.birthdays.setConfig(guild.id, { channelId: c.id }); return respond(interaction, `✅ Birthday messages will be sent in <#${c.id}>.`); }
            case 'role': { const r = interaction.options.getRole('role'); fun.birthdays.setConfig(guild.id, { roleId: r?.id ?? null });
                return respond(interaction, r ? `✅ Members get <@&${r.id}> on their birthday and lose it when the day ends. (My role must be above it.)` : '✅ I will not give a birthday role.'); }
            case 'message': { const text = cleanText(interaction.options.getString('text') ?? '', 500); fun.birthdays.setConfig(guild.id, { message: text });
                return respond(interaction, text ? `✅ New message: ${text.replace(/[<@]/g, '')}` : '✅ Back to the default message.'); }
            case 'disable': fun.birthdays.setConfig(guild.id, { channelId: null, roleId: null }); return respond(interaction, '✅ Birthday messages and roles are off. Saved birthdays are kept.');
            default: { const c = fun.birthdays.getConfig(guild.id); return respond(interaction, ['**Birthday settings**', `Channel: ${c.channelId ? `<#${c.channelId}>` : 'not set (use `/birthday channel`)'}`, `Role: ${c.roleId ? `<@&${c.roleId}>` : 'none'}`, `Message: ${c.message ?? rules.DEFAULT_BIRTHDAY_MESSAGE}`, `Saved birthdays: ${fun.birthdays.list(guild.id).length}`].join('\n')); }
        }
    },
};
