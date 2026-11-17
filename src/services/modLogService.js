// Moderation logs are just the "moderation" category of the general log service.
// (Kept as its own small service so the moderation commands read nicely.)
function createModLogService({ logService }) {
    return {
        send: (guild, payload) => logService.send(guild, 'moderation', payload),
    };
}

module.exports = { createModLogService };
