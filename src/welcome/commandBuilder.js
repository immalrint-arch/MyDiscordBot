const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const { respond, ensureModerator } = require('../moderation/helpers');
const { PLACEHOLDERS, parseColor } = require('./template');
const { sendWelcome, sendGoodbye, sendWelcomeDm } = require('./greetingFlow');

const TEXT_CHANNELS = [ChannelType.GuildText, ChannelType.GuildAnnouncement];
const onOff = (v) => (v ? '✅ on' : '⛔ off');
const shorten = (t, n = 120) => (t && t.length > n ? `${t.slice(0, n)}…` : t ?? '—');

// Builds /welcome or /goodbye. They share almost everything, so one builder makes both.
function buildGreetingCommand(kind) {
    const isWelcome = kind === 'welcome';
    const noun = isWelcome ? 'welcome' : 'goodbye';

    const data = new SlashCommandBuilder()
        .setName(noun)
        .setDescription(isWelcome ? 'Customise the message sent when someone joins.' : 'Customise the message sent when someone leaves.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
        .setDMPermission(false)
        .addSubcommand((s) => s.setName('enable').setDescription(`Turn the ${noun} message on.`))
        .addSubcommand((s) => s.setName('disable').setDescription(`Turn the ${noun} message off.`))
        .addSubcommand((s) => s.setName('channel').setDescription(`Choose where the ${noun} message is sent.`)
            .addChannelOption((o) => o.setName('channel').setDescription('A text channel').setRequired(true).addChannelTypes(...TEXT_CHANNELS)))
        .addSubcommand((s) => s.setName('message').setDescription('Set the message text. Use /' + noun + ' placeholders to see the words you can use.')
            .addStringOption((o) => o.setName('text').setDescription('Message text. Type \\n for a new line.').setRequired(true).setMaxLength(1800)))
        .addSubcommand((s) => s.setName('title').setDescription('Set the title (embed and card styles).')
            .addStringOption((o) => o.setName('text').setDescription('Title text').setRequired(true).setMaxLength(150)))
        .addSubcommand((s) => s.setName('style').setDescription('Choose how it looks.')
            .addStringOption((o) => o.setName('style').setDescription('Look').setRequired(true)
                .addChoices({ name: 'Embed (box with picture)', value: 'embed' }, { name: 'Plain text', value: 'text' }, { name: 'Card (picture)', value: 'card' })))
        .addSubcommand((s) => s.setName('color').setDescription('Set the colour of the embed.')
            .addStringOption((o) => o.setName('color').setDescription('For example #2ecc71 or green').setRequired(true)))
        .addSubcommand((s) => s.setName('footer').setDescription('Set small text at the bottom. Type - to remove it.')
            .addStringOption((o) => o.setName('text').setDescription('Footer text').setRequired(true).setMaxLength(150)))
        .addSubcommand((s) => s.setName('banner').setDescription('Set a big picture (link starting with https://). Type - to remove it.')
            .addStringOption((o) => o.setName('url').setDescription('Picture link').setRequired(true).setMaxLength(300)))
        .addSubcommand((s) => s.setName('delete-after').setDescription('Delete the message after some seconds (0 = keep it).')
            .addIntegerOption((o) => o.setName('seconds').setDescription('0 to 86400').setRequired(true).setMinValue(0).setMaxValue(86400)))
        .addSubcommand((s) => s.setName('bots').setDescription(`Also send it for bots? (default: no)`)
            .addBooleanOption((o) => o.setName('enabled').setDescription('On or off').setRequired(true)));

    if (isWelcome) {
        data.addSubcommand((s) => s.setName('ping').setDescription('Mention the new member above the message?')
            .addBooleanOption((o) => o.setName('enabled').setDescription('On or off').setRequired(true)))
            .addSubcommand((s) => s.setName('timing').setDescription('Send it when they join, or after they pass verification.')
                .addStringOption((o) => o.setName('when').setDescription('When').setRequired(true)
                    .addChoices({ name: 'When they join', value: 'join' }, { name: 'After verification', value: 'verified' })))
            .addSubcommand((s) => s.setName('dm').setDescription('Also send a private welcome message.')
                .addBooleanOption((o) => o.setName('enabled').setDescription('On or off').setRequired(true))
                .addStringOption((o) => o.setName('text').setDescription('Private message text').setMaxLength(1800)));
    }

    data.addSubcommand((s) => s.setName('test').setDescription(`Show a test ${noun} message here, using you as the member.`))
        .addSubcommand((s) => s.setName('placeholders').setDescription('List the {words} you can use in messages.'))
        .addSubcommand((s) => s.setName('status').setDescription('Show the current settings.'))
        .addSubcommand((s) => s.setName('reset').setDescription(`Put all ${noun} settings back to the defaults.`));

    async function execute(interaction) {
        if (!(await ensureModerator(interaction, PermissionFlagsBits.ManageGuild, 'Manage Server'))) return;
        const { welcome } = interaction.client.services;
        const guild = interaction.guild;
        const sub = interaction.options.getSubcommand();
        const set = (changes) => welcome.set(guild.id, kind, changes);

        try {
            switch (sub) {
                case 'enable': {
                    const c = welcome.get(guild.id, kind);
                    if (!c.channelId) return respond(interaction, `Choose a channel first: \`/${noun} channel\`.`);
                    set({ enabled: true });
                    return respond(interaction, `✅ The ${noun} message is **on** in <#${c.channelId}>. Try \`/${noun} test\`.`);
                }
                case 'disable': set({ enabled: false }); return respond(interaction, `⛔ The ${noun} message is **off**.`);
                case 'channel': {
                    const channel = interaction.options.getChannel('channel', true);
                    set({ channelId: channel.id });
                    const me = guild.members.me ?? await guild.members.fetchMe();
                    const ok = channel.permissionsFor(me)?.has(['ViewChannel', 'SendMessages', 'EmbedLinks']);
                    return respond(interaction, `✅ ${noun[0].toUpperCase() + noun.slice(1)} messages go to <#${channel.id}>.${ok ? '' : '\n⚠️ I cannot send messages there yet. I need View Channel, Send Messages and Embed Links.'}${welcome.get(guild.id, kind).enabled ? '' : ` Turn it on with \`/${noun} enable\`.`}`);
                }
                case 'message': set({ message: interaction.options.getString('text', true) }); return respond(interaction, `✅ ${noun} message updated. Check it with \`/${noun} test\`.`);
                case 'title': set({ title: interaction.options.getString('text', true) }); return respond(interaction, '✅ Title updated.');
                case 'style': set({ style: interaction.options.getString('style', true) }); return respond(interaction, '✅ Style updated.');
                case 'color': {
                    const color = parseColor(interaction.options.getString('color', true));
                    if (color === null) return respond(interaction, 'That is not a colour. Try `#2ecc71` or a name like `green`.');
                    set({ color });
                    return respond(interaction, '✅ Colour updated.');
                }
                case 'footer': { const t = interaction.options.getString('text', true); set({ footer: t === '-' ? null : t }); return respond(interaction, t === '-' ? '✅ Footer removed.' : '✅ Footer updated.'); }
                case 'banner': { const u = interaction.options.getString('url', true); set({ bannerUrl: u === '-' ? null : u }); return respond(interaction, u === '-' ? '✅ Banner removed.' : '✅ Banner updated (used by the embed style).'); }
                case 'delete-after': { const s = interaction.options.getInteger('seconds', true); set({ deleteAfter: s }); return respond(interaction, s ? `✅ The message deletes itself after ${s}s.` : '✅ The message stays.'); }
                case 'bots': { const v = interaction.options.getBoolean('enabled', true); set({ bots: v }); return respond(interaction, `✅ Messages for bots: ${onOff(v)}.`); }
                case 'ping': { const v = interaction.options.getBoolean('enabled', true); set({ ping: v }); return respond(interaction, `✅ Mentioning the new member: ${onOff(v)}.`); }
                case 'timing': { set({ timing: interaction.options.getString('when', true) }); return respond(interaction, '✅ Timing updated. "After verification" only works when `/verification` is on.'); }
                case 'dm': {
                    const changes = { dmEnabled: interaction.options.getBoolean('enabled', true) };
                    const text = interaction.options.getString('text');
                    if (text) changes.dmMessage = text;
                    set(changes);
                    return respond(interaction, `✅ Private welcome message: ${onOff(changes.dmEnabled)}.`);
                }
                case 'placeholders':
                    return respond(interaction, `**Words you can use**\n${Object.entries(PLACEHOLDERS).map(([k, v]) => `\`${k}\` — ${v}`).join('\n')}\n\nExample: \`/${noun} message text:Welcome {user} to {server}! You are member {ordinal}.\``);
                case 'status': {
                    const c = welcome.get(guild.id, kind);
                    const lines = [
                        `**${noun[0].toUpperCase() + noun.slice(1)} settings**`,
                        `Status: ${onOff(c.enabled)}`,
                        `Channel: ${c.channelId ? `<#${c.channelId}>` : 'not set'}`,
                        `Style: ${c.style}`,
                        `Title: ${shorten(c.title)}`,
                        `Message: ${shorten(c.message, 300)}`,
                        `Colour: #${c.color.toString(16).padStart(6, '0')}`,
                        `Footer: ${shorten(c.footer)}`,
                        `Banner: ${c.bannerUrl ? 'set' : 'none'}`,
                        `Deletes after: ${c.deleteAfter ? `${c.deleteAfter}s` : 'never'}`,
                        `For bots: ${onOff(c.bots)}`,
                    ];
                    if (isWelcome) lines.push(`Mentions member: ${onOff(c.ping)}`, `Sent: ${c.timing === 'verified' ? 'after verification' : 'when they join'}`, `Private message: ${onOff(c.dmEnabled)}`);
                    return respond(interaction, lines.join('\n'));
                }
                case 'reset': welcome.reset(guild.id, kind); return respond(interaction, `♻️ ${noun} settings are back to the defaults (and turned off).`);
                case 'test': {
                    await interaction.deferReply();
                    const member = interaction.member;
                    const sender = isWelcome ? sendWelcome : sendGoodbye;
                    const sent = await sender(member, { force: true, channelOverride: interaction.channel });
                    if (!sent) return respond(interaction, 'I could not post the test here. I need View Channel, Send Messages and Embed Links (and Attach Files for the card style).');
                    if (isWelcome && welcome.get(guild.id, 'welcome').dmEnabled) await sendWelcomeDm(member);
                    return respond(interaction, `☝️ That is what a ${noun} message looks like right now.${isWelcome && welcome.get(guild.id, 'welcome').dmEnabled ? ' I also sent you the private version.' : ''}`);
                }
                default: return respond(interaction, 'Unknown option.');
            }
        } catch (error) {
            if (error instanceof TypeError) return respond(interaction, `⚠️ ${error.message}`);
            throw error;
        }
    }

    return { data, execute };
}

module.exports = { buildGreetingCommand };
