const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { respond, ensureModerator } = require('../../moderation/helpers');
const { PLACEHOLDERS } = require('../../leveling/levelTemplate');
const { announceLevelUp } = require('../../leveling/levelFlow');
const { isLevelImageAvailable } = require('../../leveling/levelImages');

const PERM = PermissionFlagsBits.ManageGuild;
const onOff = (v) => (v ? '✅ on' : '⛔ off');
const TEXT = [ChannelType.GuildText, ChannelType.GuildAnnouncement];

module.exports = {
    data: new SlashCommandBuilder()
        .setName('level')
        .setDescription('Leveling settings: XP, level-up message, weekly highlights.')
        .setDefaultMemberPermissions(PERM)
        .setDMPermission(false)
        .addSubcommand((s) => s.setName('enable').setDescription('Turn leveling on.'))
        .addSubcommand((s) => s.setName('disable').setDescription('Turn leveling off (XP is kept).'))
        .addSubcommand((s) => s.setName('status').setDescription('Show all leveling settings.'))
        .addSubcommand((s) => s.setName('xp').setDescription('How much XP one message gives.')
            .addIntegerOption((o) => o.setName('min').setDescription('Lowest XP per message (1-500)').setRequired(true).setMinValue(1).setMaxValue(500))
            .addIntegerOption((o) => o.setName('max').setDescription('Highest XP per message (1-500)').setRequired(true).setMinValue(1).setMaxValue(500))
            .addIntegerOption((o) => o.setName('cooldown').setDescription('Seconds between XP-earning messages (0-3600)').setMinValue(0).setMaxValue(3600)))
        .addSubcommand((s) => s.setName('min-length').setDescription('Messages shorter than this give no XP.')
            .addIntegerOption((o) => o.setName('characters').setDescription('0 to 100').setRequired(true).setMinValue(0).setMaxValue(100)))
        .addSubcommand((s) => s.setName('voice').setDescription('XP per minute in voice channels (0 = off).')
            .addIntegerOption((o) => o.setName('xp').setDescription('0 to 100').setRequired(true).setMinValue(0).setMaxValue(100)))
        .addSubcommand((s) => s.setName('multiplier').setDescription('Server-wide XP speed in percent (100 = normal, 200 = double).')
            .addIntegerOption((o) => o.setName('percent').setDescription('10 to 1000').setRequired(true).setMinValue(10).setMaxValue(1000)))
        .addSubcommand((s) => s.setName('announce').setDescription('Where level-up messages go.')
            .addStringOption((o) => o.setName('where').setDescription('Where').setRequired(true)
                .addChoices({ name: 'Where the person was chatting', value: 'current' }, { name: 'One fixed channel', value: 'channel' }, { name: 'Private message', value: 'dm' }, { name: 'Nowhere (silent)', value: 'off' }))
            .addChannelOption((o) => o.setName('channel').setDescription('The channel (for "One fixed channel")').addChannelTypes(...TEXT)))
        .addSubcommand((s) => s.setName('style').setDescription('How the level-up message looks.')
            .addStringOption((o) => o.setName('style').setDescription('Look').setRequired(true)
                .addChoices({ name: 'Card (picture)', value: 'card' }, { name: 'Embed', value: 'embed' }, { name: 'Plain text', value: 'text' })))
        .addSubcommand((s) => s.setName('message').setDescription('Change the level-up message text.')
            .addStringOption((o) => o.setName('text').setDescription('Use /level placeholders for the {words}. Type \\n for a new line.').setRequired(true).setMaxLength(1000)))
        .addSubcommand((s) => s.setName('ping').setDescription('Mention the person in the level-up message?')
            .addBooleanOption((o) => o.setName('enabled').setDescription('On or off').setRequired(true)))
        .addSubcommand((s) => s.setName('placeholders').setDescription('List the {words} for the level-up message.'))
        .addSubcommand((s) => s.setName('test').setDescription('Show a test level-up message here, using you.'))
        .addSubcommand((s) => s.setName('highlights').setDescription('Auto-post the top members of the last day/week/month.')
            .addStringOption((o) => o.setName('period').setDescription('How often').setRequired(true)
                .addChoices({ name: 'Every day', value: 'daily' }, { name: 'Every week (Monday)', value: 'weekly' }, { name: 'Every month', value: 'monthly' }, { name: 'Off', value: 'off' }))
            .addChannelOption((o) => o.setName('channel').setDescription('Where to post (needed the first time)').addChannelTypes(...TEXT)))
        .addSubcommand((s) => s.setName('reset-settings').setDescription('Put all leveling settings back to the defaults (XP and roles are kept).')),

    async execute(interaction) {
        if (!(await ensureModerator(interaction, PERM, 'Manage Server'))) return;
        const { levels } = interaction.client.services;
        const guild = interaction.guild;
        const sub = interaction.options.getSubcommand();
        const set = (c) => levels.setConfig(guild.id, c);
        try {
            switch (sub) {
                case 'enable': {
                    set({ enabled: true });
                    const c = levels.getConfig(guild.id);
                    return respond(interaction, `✅ Leveling is **on**. ${c.xpMin}-${c.xpMax} XP per message, once every ${c.cooldownSeconds}s. Level-ups go ${c.announceMode === 'off' ? 'nowhere' : c.announceMode === 'dm' ? 'to private messages' : c.announceMode === 'channel' && c.announceChannelId ? `to <#${c.announceChannelId}>` : 'where people are chatting'}.`);
                }
                case 'disable': set({ enabled: false }); return respond(interaction, '⛔ Leveling is **off**. Nobody earns XP, and nothing is deleted.');
                case 'xp': {
                    const min = interaction.options.getInteger('min', true); const max = interaction.options.getInteger('max', true);
                    const cooldown = interaction.options.getInteger('cooldown');
                    set({ xpMin: min, xpMax: max, ...(cooldown !== null ? { cooldownSeconds: cooldown } : {}) });
                    return respond(interaction, `✅ Each message gives **${min}-${max} XP**${cooldown !== null ? `, once every ${cooldown}s` : ''}.`);
                }
                case 'min-length': { const n = interaction.options.getInteger('characters', true); set({ minLength: n }); return respond(interaction, `✅ Messages under **${n}** characters give no XP.`); }
                case 'voice': { const n = interaction.options.getInteger('xp', true); set({ voiceXp: n }); return respond(interaction, n ? `✅ Voice gives **${n} XP per minute** (only with at least 2 people, not deafened).` : '✅ Voice XP is off.'); }
                case 'multiplier': { const n = interaction.options.getInteger('percent', true); set({ multiplierPercent: n }); return respond(interaction, `✅ XP speed is **${n}%**.`); }
                case 'announce': {
                    const where = interaction.options.getString('where', true); const channel = interaction.options.getChannel('channel');
                    if (where === 'channel' && !channel && !levels.getConfig(guild.id).announceChannelId) return respond(interaction, 'Pick the channel too: `channel:#levels`.');
                    set({ announceMode: where, ...(channel ? { announceChannelId: channel.id } : {}) });
                    return respond(interaction, `✅ Level-ups go ${{ current: 'where people are chatting', channel: `to <#${channel?.id ?? levels.getConfig(guild.id).announceChannelId}>`, dm: 'to private messages', off: 'nowhere' }[where]}.`);
                }
                case 'style': {
                    const style = interaction.options.getString('style', true); set({ announceStyle: style });
                    return respond(interaction, `✅ Level-up style: **${style}**.${style === 'card' && !isLevelImageAvailable() ? '\n⚠️ Pictures need `npm install @napi-rs/canvas`. Until then I use the embed style.' : ''}`);
                }
                case 'message': set({ levelupMessage: interaction.options.getString('text', true) }); return respond(interaction, '✅ Level-up message updated. Check it with `/level test`.');
                case 'ping': { const v = interaction.options.getBoolean('enabled', true); set({ levelupPing: v }); return respond(interaction, `✅ Mentioning people in level-up messages: ${onOff(v)}.`); }
                case 'placeholders':
                    return respond(interaction, `**Words you can use**\n${Object.entries(PLACEHOLDERS).map(([k, v]) => `\`${k}\` — ${v}`).join('\n')}\n\nExample: \`/level message text:{user} reached level **{level}** in {server}!\``);
                case 'highlights': {
                    const period = interaction.options.getString('period', true); const channel = interaction.options.getChannel('channel');
                    if (period === 'off') { set({ highlightsPeriod: 'off' }); return respond(interaction, '✅ Automatic highlights are off.'); }
                    if (!channel && !levels.getConfig(guild.id).highlightsChannelId) return respond(interaction, 'Pick the channel too: `channel:#highlights`.');
                    set({ highlightsPeriod: period, highlightsLast: 0, ...(channel ? { highlightsChannelId: channel.id } : {}) });
                    return respond(interaction, `✅ The ${period} highlights will be posted in <#${channel?.id ?? levels.getConfig(guild.id).highlightsChannelId}> when each ${{ daily: 'day', weekly: 'week', monthly: 'month' }[period]} ends (UTC). Anyone can also use \`/leaderboard\`.`);
                }
                case 'reset-settings': levels.resetConfig(guild.id); return respond(interaction, '♻️ Leveling settings are back to the defaults (and turned off). XP and level roles were kept.');
                case 'test': {
                    await interaction.deferReply();
                    const member = interaction.member; const data = levels.getUser(guild.id, member.id);
                    const level = Math.max(1, data.level);
                    const sent = await announceLevelUp(member, { level, oldLevel: level - 1, xp: data.xp }, { channel: interaction.channel, force: true });
                    return respond(interaction, sent ? '☝️ That is what a level-up message looks like right now.' : 'I could not post here. I need View Channel, Send Messages (and Attach Files / Embed Links).');
                }
                case 'status': {
                    const c = levels.getConfig(guild.id);
                    const roles = levels.listLevelRoles(guild.id);
                    return respond(interaction, [
                        `**Leveling settings**`, `Status: ${onOff(c.enabled)}`,
                        `XP per message: ${c.xpMin}-${c.xpMax} (every ${c.cooldownSeconds}s, min ${c.minLength} characters)`,
                        `Voice XP: ${c.voiceXp ? `${c.voiceXp}/min` : 'off'} • Speed: ${c.multiplierPercent}%`,
                        `Level-ups: ${c.announceMode}${c.announceMode === 'channel' && c.announceChannelId ? ` (<#${c.announceChannelId}>)` : ''} • style ${c.announceStyle} • mention ${onOff(c.levelupPing)}`,
                        `Message: ${c.levelupMessage.length > 200 ? `${c.levelupMessage.slice(0, 200)}…` : c.levelupMessage}`,
                        `Level roles: ${roles.length ? roles.map((r) => `${r.level}→<@&${r.roleId}>`).join(', ') : 'none (optional)'} • mode ${c.rewardMode}`,
                        `Highlights: ${c.highlightsPeriod === 'off' ? 'off' : `${c.highlightsPeriod} in <#${c.highlightsChannelId}>`}`,
                        `Ignored: ${levels.listIgnores(guild.id).length} • Boosts: ${levels.listBoosts(guild.id).length}`,
                    ].join('\n'));
                }
                default: return respond(interaction, 'Unknown option.');
            }
        } catch (error) {
            if (error instanceof TypeError) return respond(interaction, `⚠️ ${error.message}`);
            throw error;
        }
    },
};
