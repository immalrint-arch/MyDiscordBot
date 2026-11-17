const { Events } = require('discord.js');
const logger = require('../utils/logger');
const { startTempBanScheduler } = require('../moderation/tempBanScheduler');
const { startTempRoleScheduler } = require('../roles/tempRoleScheduler');
const { startGiveawayScheduler } = require('../giveaways/giveawayFlow');
const { startUtilityScheduler } = require('../utility/utilityFlow');
const { startFunScheduler } = require('../fun/funFlow');
const { startVoiceTimeScheduler } = require('../voicetime/voiceTimeFlow');
const { startRaidScheduler } = require('../raid/raidFlow');
const { startQotdScheduler } = require('../qotd/qotdFlow');
const { startBackupScheduler } = require('../serverbackup/backupFlow');
const { startOwnerSchedulers } = require('../owner/ownerFlow');
const { startGrowthSchedulers } = require('../growth/growthFlow');
const { startPostScheduler } = require('../posts/postFlow');
const { startLevelSchedulers } = require('../leveling/levelFlow');
const { cleanupRooms } = require('../channels/tempVoiceFlow');

// For servers up to this size we load the whole member list at startup, so that role and
// nickname changes can be compared with the "before" version. Bigger servers skip this
// (loading a huge member list is slow) and only members seen after startup are compared.
const PRELOAD_LIMIT = 1000;

module.exports = {
    name: Events.ClientReady,
    once: true, // run one time only, like your old client.once(...)
    async execute(bot) {
        console.log('================================');
        console.log(`Bot Name: ${bot.user.tag}`);
        console.log('Status: ONLINE');
        console.log('================================');

        // Make sure every server the bot is already in has a database row.
        for (const guild of bot.guilds.cache.values()) {
            bot.services.guildSettings.ensureGuild(guild.id);
        }
        try {
            bot.services.incidents.purgeOld(); // forget anti-nuke data older than 14 days
            bot.services.automod.purgeOld(Date.now() - 30 * 24 * 60 * 60 * 1000); // and auto-mod history older than 30 days
        } catch (error) {
            logger.warn(`Could not clean old anti-nuke data: ${error.message}`);
        }
        logger.info(`Database ready for ${bot.guilds.cache.size} server(s).`);

        startTempBanScheduler(bot); // lifts expired timed bans
        startTempRoleScheduler(bot); // removes expired temporary roles
        startGiveawayScheduler(bot); // ends giveaways, event reminders
        startUtilityScheduler(bot); // reminders and poll endings
        startFunScheduler(bot); // bump reminders and birthdays
        startPostScheduler(bot); // scheduled posts
        startVoiceTimeScheduler(bot); // minutes spent in voice
        startBackupScheduler(bot); // automatic server backups
        startQotdScheduler(bot); // daily question of the day
        startRaidScheduler(bot); // ends raid mode when it has been quiet long enough
        startGrowthSchedulers(bot); // invite cache, member counters
        startOwnerSchedulers(bot, bot.db); // owner lookup, error alerts, daily database backup
        startLevelSchedulers(bot); // voice XP and automatic highlights
        cleanupRooms(bot).catch((error) => logger.warn(`Temporary voice cleanup failed: ${error.message}`));

        for (const guild of bot.guilds.cache.values()) {
            if (guild.memberCount > PRELOAD_LIMIT) continue;
            try {
                await guild.members.fetch();
            } catch (error) {
                logger.warn(`Could not preload members of server ${guild.id}: ${error.message}`);
            }
        }
    },
};
