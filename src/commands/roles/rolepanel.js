const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { respond, ensureModerator, describeError } = require('../../moderation/helpers');
const { RoleServiceError } = require('../../services/roleService');
const { roleProblem, moderatorRoleProblem, parseEmoji } = require('../../roles/roleRules');
const { publishPanel, refreshPanel } = require('../../roles/panelFlow');
const { parseColor } = require('../../welcome/template');
const { cleanText } = require('../../utils/text');

const PANEL = (o) => o.setName('panel').setDescription('Panel name').setRequired(true);

module.exports = {
    data: new SlashCommandBuilder()
        .setName('rolepanel')
        .setDescription('Role panels: people pick their own roles with buttons, a dropdown or reactions.')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
        .setDMPermission(false)
        .addSubcommand((s) => s.setName('create').setDescription('Make a new role panel.')
            .addStringOption((o) => o.setName('name').setDescription('A short name to find it again').setRequired(true).setMaxLength(40))
            .addStringOption((o) => o.setName('type').setDescription('How people pick').setRequired(true)
                .addChoices({ name: 'Buttons', value: 'button' }, { name: 'Dropdown menu', value: 'dropdown' }, { name: 'Reactions', value: 'reaction' }))
            .addStringOption((o) => o.setName('title').setDescription('Title shown on the panel').setMaxLength(100))
            .addStringOption((o) => o.setName('description').setDescription('Text under the title').setMaxLength(500))
            .addIntegerOption((o) => o.setName('max').setDescription('Most roles a person can hold from this panel (1 = pick only one, 0 = no limit)').setMinValue(0).setMaxValue(25))
            .addRoleOption((o) => o.setName('required-role').setDescription('People need this role to use the panel'))
            .addBooleanOption((o) => o.setName('allow-remove').setDescription('Can people take the role off again? (default yes)'))
            .addStringOption((o) => o.setName('color').setDescription('Colour, e.g. #5865f2 or blue')))
        .addSubcommand((s) => s.setName('add-role').setDescription('Add a role to a panel.')
            .addStringOption(PANEL)
            .addRoleOption((o) => o.setName('role').setDescription('The role').setRequired(true))
            .addStringOption((o) => o.setName('label').setDescription('Button/menu text (default: the role name)').setMaxLength(80))
            .addStringOption((o) => o.setName('emoji').setDescription('An emoji (needed for reaction panels)'))
            .addStringOption((o) => o.setName('description').setDescription('Small text for dropdown entries').setMaxLength(100)))
        .addSubcommand((s) => s.setName('remove-role').setDescription('Take a role off a panel.')
            .addStringOption(PANEL)
            .addRoleOption((o) => o.setName('role').setDescription('The role').setRequired(true)))
        .addSubcommand((s) => s.setName('edit').setDescription('Change a panel.')
            .addStringOption(PANEL)
            .addStringOption((o) => o.setName('title').setDescription('New title').setMaxLength(100))
            .addStringOption((o) => o.setName('description').setDescription('New text (type - to clear it)').setMaxLength(500))
            .addStringOption((o) => o.setName('color').setDescription('New colour'))
            .addIntegerOption((o) => o.setName('max').setDescription('New limit (0 = none, 1 = pick one)').setMinValue(0).setMaxValue(25))
            .addRoleOption((o) => o.setName('required-role').setDescription('New required role'))
            .addBooleanOption((o) => o.setName('clear-required-role').setDescription('Remove the required role'))
            .addBooleanOption((o) => o.setName('allow-remove').setDescription('Can people take roles off?')))
        .addSubcommand((s) => s.setName('publish').setDescription('Post the panel in a channel (or update it if already posted).')
            .addStringOption(PANEL)
            .addChannelOption((o) => o.setName('channel').setDescription('Where to post it (default: here)')))
        .addSubcommand((s) => s.setName('delete').setDescription('Delete a panel and its message.')
            .addStringOption(PANEL))
        .addSubcommand((s) => s.setName('list').setDescription('Show all panels.')),

    async execute(interaction) {
        if (!(await ensureModerator(interaction, PermissionFlagsBits.ManageRoles, 'Manage Roles'))) return;
        const { roles } = interaction.client.services;
        const guild = interaction.guild;
        const sub = interaction.options.getSubcommand();
        const me = guild.members.me ?? await guild.members.fetchMe();
        const name = interaction.options.getString('panel');

        try {
            if (sub === 'list') {
                const panels = roles.listPanels(guild.id);
                if (!panels.length) return respond(interaction, 'No role panels yet. Make one with `/rolepanel create`.');
                return respond(interaction, panels.map((p) => {
                    const n = roles.options(p.id).length;
                    const where = p.messageId ? `[posted](https://discord.com/channels/${guild.id}/${p.channelId}/${p.messageId})` : 'not posted';
                    return `• **${p.name}** — ${p.mode}, ${n} role(s), ${where}`;
                }).join('\n'));
            }

            if (sub === 'create') {
                const colorText = interaction.options.getString('color');
                const color = colorText ? parseColor(colorText) : 5793266;
                if (color === null) return respond(interaction, 'That is not a colour. Try `#5865f2` or a name like `blue`.');
                const required = interaction.options.getRole('required-role');
                const panel = roles.createPanel(guild.id, {
                    name: cleanText(interaction.options.getString('name', true)),
                    mode: interaction.options.getString('type', true),
                    title: cleanText(interaction.options.getString('title') ?? 'Pick your roles'),
                    description: interaction.options.getString('description'),
                    color,
                    maxRoles: interaction.options.getInteger('max') ?? 0,
                    requiredRoleId: required?.id ?? null,
                    allowRemove: interaction.options.getBoolean('allow-remove') ?? true,
                });
                return respond(interaction, `✅ Panel **${panel.name}** created. Add roles with \`/rolepanel add-role\`, then post it with \`/rolepanel publish\`.`);
            }

            const panel = roles.getPanel(guild.id, name);
            if (!panel) return respond(interaction, `I could not find a panel named **${name}**. Use \`/rolepanel list\`.`);

            if (sub === 'add-role') {
                const role = interaction.options.getRole('role', true);
                const problem = roleProblem({ role, guildId: guild.id, botHighestPosition: me.roles.highest.position, forbidDangerous: true })
                    ?? moderatorRoleProblem({ role, guildOwnerId: guild.ownerId, actorId: interaction.user.id, actorHighestPosition: interaction.member.roles.highest.position });
                if (problem) return respond(interaction, `⚠️ ${problem}`);
                const emojiText = interaction.options.getString('emoji');
                const emoji = emojiText ? parseEmoji(emojiText) : null;
                if (emojiText && !emoji) return respond(interaction, 'I could not read that emoji. Use a normal emoji or a custom one from this server.');
                roles.addOption(panel, {
                    roleId: role.id,
                    label: cleanText(interaction.options.getString('label') ?? role.name).slice(0, 80),
                    emoji: emoji?.display ?? null,
                    description: interaction.options.getString('description'),
                });
                await refreshPanel(guild, panel, interaction.client.services);
                return respond(interaction, `✅ Added <@&${role.id}> to **${panel.name}**.${panel.messageId ? ' The posted panel was updated.' : ' Post it with `/rolepanel publish`.'}`);
            }

            if (sub === 'remove-role') {
                const role = interaction.options.getRole('role', true);
                if (!roles.removeOption(panel.id, role.id)) return respond(interaction, 'That role is not on this panel.');
                await refreshPanel(guild, panel, interaction.client.services);
                return respond(interaction, `✅ Removed <@&${role.id}> from **${panel.name}**.`);
            }

            if (sub === 'edit') {
                const changes = {};
                const title = interaction.options.getString('title');
                const description = interaction.options.getString('description');
                const colorText = interaction.options.getString('color');
                const max = interaction.options.getInteger('max');
                const required = interaction.options.getRole('required-role');
                const allowRemove = interaction.options.getBoolean('allow-remove');
                if (title) changes.title = cleanText(title);
                if (description) changes.description = description === '-' ? null : description;
                if (colorText) {
                    const color = parseColor(colorText);
                    if (color === null) return respond(interaction, 'That is not a colour.');
                    changes.color = color;
                }
                if (max !== null) changes.maxRoles = max;
                if (required) changes.requiredRoleId = required.id;
                if (interaction.options.getBoolean('clear-required-role')) changes.requiredRoleId = null;
                if (allowRemove !== null) changes.allowRemove = allowRemove;
                if (!Object.keys(changes).length) return respond(interaction, 'Nothing to change. Pick at least one option.');
                roles.updatePanel(panel.id, changes);
                await refreshPanel(guild, panel, interaction.client.services);
                return respond(interaction, `✅ Panel **${panel.name}** updated.`);
            }

            if (sub === 'publish') {
                const channel = interaction.options.getChannel('channel') ?? interaction.channel;
                if (!channel?.isTextBased() || channel.isThread?.()) return respond(interaction, 'Choose a normal text channel.');
                await interaction.deferReply();
                const message = await publishPanel(guild, roles.getPanelById(panel.id), channel, interaction.client.services);
                return respond(interaction, `✅ Panel **${panel.name}** is live: ${message.url}`);
            }

            if (sub === 'delete') {
                if (panel.messageId && panel.channelId) {
                    await guild.channels.cache.get(panel.channelId)?.messages?.delete?.(panel.messageId).catch(() => {});
                }
                roles.deletePanel(panel.id);
                return respond(interaction, `🗑️ Panel **${panel.name}** deleted.`);
            }
        } catch (error) {
            if (error instanceof RoleServiceError || error instanceof TypeError) return respond(interaction, `⚠️ ${error.message}`);
            return respond(interaction, `⚠️ ${error.message?.startsWith('I need') || error.message?.startsWith('Add at least') ? error.message : describeError(error)}`);
        }
    },
};
