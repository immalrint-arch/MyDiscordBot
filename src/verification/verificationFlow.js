const {
    EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ModalBuilder, TextInputBuilder, TextInputStyle,
    AttachmentBuilder, MessageFlags,
} = require('discord.js');
const logger = require('../utils/logger');
const { renderCaptcha, randomCode } = require('./captchaImage');
const { createCaptchaSessions } = require('./captchaSessions');

const COLOR = 0x4e5058;
const CODE_LENGTH = 5;
const sessions = createCaptchaSessions({ now: Date.now, makeCode: () => randomCode(CODE_LENGTH) });
setInterval(() => sessions.sweep(), 5 * 60 * 1000).unref(); // tidy memory now and then

// Verification replies are private to the person verifying. The panel is in a public channel,
// so public replies would fill it with everyone's captcha pictures.
const reply = (content) => ({ content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
const minutes = (ms) => Math.max(1, Math.ceil(ms / 60000));

// The public panel (reference image 5).
function verificationPanel(guildName, title) {
    return {
        embeds: [new EmbedBuilder().setColor(COLOR).setDescription(
            `🛡️ \`${title}\`\n\n🔔 **To access \`${guildName.slice(0, 80)}\`, you need to pass verification first.**\n ▸ Click on the **Verify** button below to start.`
        )],
        components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('vf:start').setLabel('Verify').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('vf:help').setLabel('Help').setStyle(ButtonStyle.Secondary)
        )],
    };
}

function captchaMessage(code, note = '') {
    const file = new AttachmentBuilder(renderCaptcha(code), { name: 'captcha.png' });
    return {
        content: note || undefined,
        embeds: [new EmbedBuilder().setColor(COLOR)
            .setDescription('### Solve the captcha\nType the letters and numbers you see in the picture. It does not matter if they are upper or lower case.')
            .setImage('attachment://captcha.png')],
        files: [file],
        components: [new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId('vf:enter').setLabel('Enter code').setEmoji('⌨️').setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId('vf:refresh').setLabel('New code').setEmoji('🔄').setStyle(ButtonStyle.Secondary)
        )],
        flags: MessageFlags.Ephemeral,
        allowedMentions: { parse: [] },
    };
}

async function start(interaction, isRefresh) {
    const { verification } = interaction.client.services;
    const config = verification.getConfig(interaction.guildId);
    if (!config.enabled || !config.verifiedRoleId) return interaction.reply(reply('Verification is not active right now.'));
    if (interaction.member.roles.cache.has(config.verifiedRoleId)) return interaction.reply(reply('✅ You are already verified.'));

    const result = sessions.start(interaction.guildId, interaction.user.id, { isRefresh });
    if (result.error === 'locked') return interaction.reply(reply(`⛔ Too many wrong answers. Please try again in about ${minutes(result.waitMs)} minute(s).`));
    if (result.error === 'refresh-limit') return interaction.reply(reply(`You asked for too many new codes. Try again in about ${minutes(result.waitMs)} minute(s).`));

    const payload = captchaMessage(result.code);
    // A "New code" press replaces the old picture instead of adding another message.
    return isRefresh && interaction.message ? interaction.update({ ...payload, flags: undefined, attachments: [] }) : interaction.reply(payload);
}

async function enter(interaction) {
    return interaction.showModal(
        new ModalBuilder().setCustomId('vf:answer').setTitle('Verification').addComponents(
            new ActionRowBuilder().addComponents(
                new TextInputBuilder().setCustomId('code').setLabel('Code from the picture').setStyle(TextInputStyle.Short)
                    .setMinLength(CODE_LENGTH).setMaxLength(CODE_LENGTH + 3).setRequired(true)
            )
        )
    );
}

async function answer(interaction) {
    const { client, guild, member, user } = interaction;
    const { verification, logs } = client.services;
    const config = verification.getConfig(guild.id);
    if (!config.enabled || !config.verifiedRoleId) return interaction.reply(reply('Verification is not active right now.'));

    const result = sessions.answer(guild.id, user.id, interaction.fields.getTextInputValue('code'), config.maxAttempts);
    if (!result.ok) {
        if (result.reason === 'locked') return interaction.reply(reply(`⛔ Too many wrong answers. Please try again in about ${minutes(result.waitMs)} minute(s).`));
        if (result.reason === 'expired') return interaction.reply(reply('That code expired. Press **Verify** on the panel to get a new one.'));
        return interaction.reply(reply(`❌ Wrong code. ${result.attemptsLeft} attempt(s) left. Press **Verify** on the panel to get a new code.`));
    }

    const role = guild.roles.cache.get(config.verifiedRoleId);
    if (!role) return interaction.reply(reply('The verified role no longer exists. Please tell a moderator.'));
    try {
        await member.roles.add(role.id, 'Passed captcha verification');
        if (config.unverifiedRoleId && member.roles.cache.has(config.unverifiedRoleId)) {
            await member.roles.remove(config.unverifiedRoleId, 'Passed captcha verification');
        }
    } catch (error) {
        logger.error(`Could not give the verified role in server ${guild.id}: ${error.message}`);
        return interaction.reply(reply('You passed, but I could not give you the role. Please tell a moderator (my role must be above the verified role).'));
    }

    await logs.send(guild, 'members', {
        embeds: [new EmbedBuilder().setColor(0x2ecc71).setDescription(`### ✅ Member verified\n**Member:** <@${user.id}> (\`${user.id}\`)\n**Role given:** <@&${role.id}>`)],
        allowedMentions: { parse: [] },
    }, { userId: user.id });
    // Tell the other systems (welcome message, automatic roles) that this member just passed.
    try { interaction.client.emit('incomuMemberVerified', member); } catch (error) { logger.warn(`Verified hook failed: ${error.message}`); }
    return interaction.reply(reply(`✅ **You are verified!** Welcome to **${guild.name}**.`));
}

function help(interaction) {
    return interaction.reply(reply(
        '**How verification works**\n1. Press **Verify**.\n2. I show you a picture with letters and numbers.\n3. Press **Enter code** and type them.\n\n' +
        'Wrong answer? Press **Verify** again for a fresh picture. After too many wrong answers you must wait a few minutes. ' +
        'Still stuck? Ask a moderator.'
    ));
}

// Routes every "vf:" button and form. Registered in index.js.
async function handleVerificationComponent(interaction) {
    if (!interaction.inGuild()) return;
    const [, action] = interaction.customId.split(':');
    switch (action) {
        case 'start': return start(interaction, false);
        case 'refresh': return start(interaction, true);
        case 'enter': return enter(interaction);
        case 'answer': return answer(interaction);
        case 'help': return help(interaction);
    }
}

module.exports = { handleVerificationComponent, verificationPanel, _sessionsForTests: sessions };
