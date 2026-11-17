require('dotenv').config();

const { Client, GatewayIntentBits, Partials, Collection } = require('discord.js');
const logger = require('./src/utils/logger');
const { initDatabase } = require('./src/database');
const { createGuildSettingsService } = require('./src/services/guildSettingsService');
const { createCaseService } = require('./src/services/caseService');
const { createChannelLockService } = require('./src/services/channelLockService');
const { createLogConfigService } = require('./src/services/logConfigService');
const { createLogService } = require('./src/services/logService');
const { createModLogService } = require('./src/services/modLogService');
const { createAuditService } = require('./src/services/auditService');
const { createSuppressionService } = require('./src/services/suppressionService');
const { createAntinukeConfigService } = require('./src/services/antinukeConfigService');
const { createIncidentService } = require('./src/services/incidentService');
const { createDetector } = require('./src/antinuke/detector');
const { createActorResolver } = require('./src/antinuke/actorResolver');
const { createAntinukeService } = require('./src/services/antinukeService');
const { createLockdownService } = require('./src/services/lockdownService');
const { createAppealService } = require('./src/services/appealService');
const { createTempBanService } = require('./src/services/tempBanService');
const { handleAppealComponent } = require('./src/moderation/appeals');
const { createTicketService } = require('./src/services/ticketService');
const { handleTicketComponent } = require('./src/tickets/ticketFlow');
const { createVerificationService } = require('./src/services/verificationService');
const { handleVerificationComponent } = require('./src/verification/verificationFlow');
const { createAutomodService } = require('./src/services/automodService');
const { createAutomodProcessor } = require('./src/automod/processor');
const { createQuoteService } = require('./src/services/quoteService');
const { createRoleService } = require('./src/services/roleService');
const { createChannelService } = require('./src/services/channelService');
const { createWelcomeService } = require('./src/services/welcomeService');
const { createLevelService } = require('./src/services/levelService');
const { isQuoteImageAvailable, quoteImageProblem } = require('./src/quotes/quoteImage');
const { createGiveawayService } = require('./src/services/giveawayService');
const { handleGiveawayButton, handleEventButton } = require('./src/giveaways/giveawayFlow');
const { createFunService } = require('./src/services/funService');
const { handleFunComponent } = require('./src/fun/funFlow');
const { createCustomService } = require('./src/services/customService');
const { handleCustomComponent } = require('./src/custom/customFlow');
const { createPostService } = require('./src/services/postService');
const { handlePostComponent } = require('./src/posts/postFlow');
const { createGrowthService } = require('./src/services/growthService');
const { createAccessService } = require('./src/services/accessService');
const { createEscalationService } = require('./src/services/escalationService');
const { createVoiceTimeService } = require('./src/services/voiceTimeService');
const { createModmailService } = require('./src/services/modmailService');
const { createRaidService } = require('./src/services/raidService');
const { createQotdService } = require('./src/services/qotdService');
const { createBackupService } = require('./src/services/backupService');
const { handleBackupComponent } = require('./src/serverbackup/backupFlow');
const { handleRaidComponent } = require('./src/raid/raidFlow');
const { handleModmailComponent } = require('./src/modmail/modmailFlow');
const { warnUnknownCommands } = require('./src/utils/commandCheck');
const { createPollService } = require('./src/services/pollService');
const { createReminderService } = require('./src/services/reminderService');
const { createSuggestionService } = require('./src/services/suggestionService');
const { createStarboardService } = require('./src/services/starboardService');
const { handleSetupComponent } = require('./src/setup/setupFlow');
const { handleHelpComponent } = require('./src/help/helpFlow');
const { handlePollButton, handleSuggestionButton } = require('./src/utility/utilityFlow');
const { createConfessionService } = require('./src/services/confessionService');
const { handleConfessionComponent } = require('./src/confessions/confessionFlow');
const { createQuarantineService } = require('./src/services/quarantineService');
const { createReportService } = require('./src/services/reportService');
const { createTextCommandService } = require('./src/services/textCommandService');
const { handlePanelComponent } = require('./src/roles/panelFlow');
const { loadCommands } = require('./src/handlers/commandHandler');
const { loadEvents } = require('./src/handlers/eventHandler');

// Stop early with a clear message if the token is missing.
// (We only check that it exists. We never print it.)
if (!process.env.DISCORD_TOKEN) {
    logger.error('DISCORD_TOKEN is missing. Add it to your .env file.');
    process.exit(1);
}

// Open the database and apply any pending migrations BEFORE connecting to Discord.
let db;
try {
    db = initDatabase();
} catch (error) {
    logger.error('Could not start the database:', error);
    process.exit(1);
}

// Intents tell Discord which kinds of events we want to receive.
//   Guilds, GuildModeration, GuildMessages, GuildVoiceStates, GuildInvites: normal.
//   GuildMembers and MessageContent are "privileged": you must switch them on in the
//   Developer Portal (Bot page) or the bot will refuse to log in.
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers, // joins, leaves, role and nickname changes
        GatewayIntentBits.GuildModeration, // ban and unban events
        GatewayIntentBits.GuildMessages, // message edit/delete events
        GatewayIntentBits.MessageContent, // lets us show the TEXT of edited/deleted messages
        GatewayIntentBits.GuildVoiceStates, // voice logs
        GatewayIntentBits.GuildInvites, // invite logs
        GatewayIntentBits.GuildMessageReactions, // reaction roles
        GatewayIntentBits.DirectMessages, // modmail: people writing to the bot privately
    ],
    // Partials let us still hear about messages the bot did not have in memory.
    partials: [Partials.Message, Partials.Reaction, Partials.Channel], // Channel: needed to receive DMs (modmail)
});

// A Collection is a Map with extra helpers. It stores our commands by name.
client.commands = new Collection();

// Button/menu handlers, keyed by the prefix of their customId (the part before the first ":").
client.componentHandlers = new Collection();

// Services hold our "business logic". Commands and events reach them through
// the client, e.g. interaction.client.services.cases
const guildSettings = createGuildSettingsService(db);
const logConfig = createLogConfigService(db, guildSettings);
const logs = createLogService({ logConfig, logger });
const channelLocks = createChannelLockService(db);
const suppress = createSuppressionService();
const antinukeConfig = createAntinukeConfigService(db);
const incidents = createIncidentService(db);
const automod = createAutomodService(db);
const antinuke = createAntinukeService({
    config: antinukeConfig,
    incidents,
    detector: createDetector(),
    resolver: createActorResolver({ logger }),
    logConfig,
    logger,
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
});
client.db = db; // used by /owner backup
client.services = {
    guildSettings,
    cases: createCaseService(db),
    channelLocks,
    logConfig,
    logs,
    modLog: createModLogService({ logService: logs }),
    audit: createAuditService({ logger }),
    suppress,
    appeals: createAppealService(db),
    tickets: createTicketService(db),
    verification: createVerificationService(db),
    automod,
    automodProcessor: createAutomodProcessor({ automod, logs, suppress, logger }),
    tempBans: createTempBanService(db),
    quotes: createQuoteService(db),
    roles: createRoleService(db),
    channels: createChannelService(db),
    welcome: createWelcomeService(db),
    levels: createLevelService(db),
    giveaways: createGiveawayService(db),
    textCommands: createTextCommandService(db),
    quarantine: createQuarantineService(db),
    confessions: createConfessionService(db),
    polls: createPollService(db),
    custom: createCustomService(db),
    posts: createPostService(db),
    growth: createGrowthService(db),
    access: createAccessService(db),
    escalation: createEscalationService(db),
    voiceTime: createVoiceTimeService(db),
    modmail: createModmailService(db),
    raid: createRaidService(db),
    qotd: createQotdService(db),
    backups: createBackupService(db),
    fun: createFunService(db),
    reminders: createReminderService(db),
    suggestions: createSuggestionService(db),
    starboard: createStarboardService(db),
    reports: createReportService(db),
    antinukeConfig,
    incidents,
    antinuke,
    lockdown: createLockdownService({ channelLocks, suppress, logger }),
};

// Load all command files and event files automatically
loadCommands(client);
warnUnknownCommands(client); // warns about leftover command files from older versions
loadEvents(client);

// Connect buttons to their handlers.
client.componentHandlers.set('ap', handleAppealComponent);
client.componentHandlers.set('tk', handleTicketComponent);
client.componentHandlers.set('vf', handleVerificationComponent);
client.componentHandlers.set('rp', handlePanelComponent);
client.componentHandlers.set('gw', handleGiveawayButton);
client.componentHandlers.set('ev', handleEventButton);
client.componentHandlers.set('cf', handleConfessionComponent);
client.componentHandlers.set('pl', handlePollButton);
client.componentHandlers.set('hp', handleHelpComponent);
client.componentHandlers.set('st', handleSetupComponent);
client.componentHandlers.set('fn', handleFunComponent);
client.componentHandlers.set('tg', handleCustomComponent);
client.componentHandlers.set('ep', handlePostComponent);
client.componentHandlers.set('mm', handleModmailComponent);
client.componentHandlers.set('rm', handleRaidComponent);
client.componentHandlers.set('sb', handleBackupComponent);
client.componentHandlers.set('sg', handleSuggestionButton);
client.componentHandlers.set('mb', (interaction) => client.commands.get('massban').handleComponent(interaction));
client.componentHandlers.set('rt', (interaction) => client.commands.get('report').handleComponent(interaction));
if (!isQuoteImageAvailable()) {
    console.warn(`\n⚠️  Picture quotes, level-up cards and leaderboards are OFF (${quoteImageProblem()}).\n    Fix: run  npm install @napi-rs/canvas  in the bot folder, then start the bot again.\n`);
}
client.componentHandlers.set('qt', (interaction) => client.commands.get('quote').handleComponent(interaction));
client.componentHandlers.set('lb', (interaction) => client.commands.get('leaderboard').handleComponent(interaction));
client.componentHandlers.set('ch', (interaction) => client.commands.get('channel').handleComponent(interaction));
client.componentHandlers.set('an', (interaction) => antinuke.handleButton(interaction));
client.componentHandlers.set('lk', (interaction) => client.commands.get('lockdown').handleComponent(interaction));

// Log unexpected errors instead of crashing silently
process.on('unhandledRejection', (error) => {
    logger.error('Unhandled promise rejection:', error);
});

// When you press Ctrl + C, close things cleanly so the database is saved properly.
function shutdown() {
    logger.info('Shutting down...');
    client.destroy();
    db.close();
    process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Connect to Discord
client.login(process.env.DISCORD_TOKEN).catch((error) => {
    if (/disallowed intents/i.test(error.message)) {
        logger.error(
            'Discord refused the login because a privileged intent is switched off.\n' +
            'Fix: Developer Portal -> your application -> Bot -> turn ON "Server Members Intent" and ' +
            '"Message Content Intent", save, then start the bot again.'
        );
    } else {
        logger.error('Login failed:', error.message);
    }
    process.exit(1);
});
