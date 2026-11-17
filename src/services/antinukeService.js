const { MessageFlags } = require('discord.js');
const { RULES, DANGEROUS_PERMISSIONS, buildThresholds } = require('../antinuke/rules');
const { classifyActor, assessSeverity, decideResponse, maxSeverity } = require('../antinuke/policy');
const { serializeChannel, serializeRole } = require('../antinuke/snapshots');
const { alertPayload } = require('../antinuke/alerts');
const { recoverItems } = require('../antinuke/recovery');

const INCIDENT_WINDOW_MS = 2 * 60 * 1000; // actions by the same person within 2 minutes = one incident
const GRACE_MS = 30 * 60 * 1000; // after "Mark safe", that person is ignored for 30 minutes
const RECOVERY_LOOKBACK_MS = 2 * 60 * 1000; // also recover deletions that happened just before the alert

// The brain of anti-nuke. Discord events call handleSignal(); buttons call handleButton().
function createAntinukeService({ config, incidents, detector, resolver, logConfig, logger, now = Date.now, sleep }) {
    const graces = new Map(); // "guild:actor" -> time the grace ends

    const isEnabled = (guildId) => config.getEffective(guildId).enabled;
    const graceKey = (guildId, actorId) => `${guildId}:${actorId ?? 'unknown'}`;
    const isGraced = (guildId, actorId) => (graces.get(graceKey(guildId, actorId)) ?? 0) > now();

    async function classify(guild, actorId, cfg) {
        const member = actorId ? (guild.members.cache.get(actorId) ?? (await guild.members.fetch(actorId).catch(() => null))) : null;
        return classifyActor({
            actorId,
            ownerId: guild.ownerId,
            selfId: guild.client.user.id,
            isBot: member?.user?.bot ?? false,
            trustedUserIds: cfg.trustedUserIds,
            trustedRoleIds: cfg.trustedRoleIds,
            memberRoleIds: member ? [...member.roles.cache.keys()] : [],
        });
    }

    // Saves the structure of a deleted channel or role so it can be recreated.
    function saveSnapshot(guild, snapshot, actorId) {
        try {
            const data = snapshot.kind === 'channel' ? serializeChannel(snapshot.original) : serializeRole(snapshot.original);
            if (!data) return; // managed roles cannot be recreated
            incidents.saveDeletedItem({ guildId: guild.id, kind: snapshot.kind, originalId: snapshot.original.id, actorId, data });
        } catch (error) {
            logger.warn(`Could not save a recovery snapshot in server ${guild.id}: ${error.message}`);
        }
    }

    function mergeRules(existing, breaches) {
        const byRule = new Map(existing.map((r) => [r.rule, r]));
        for (const b of breaches) {
            const old = byRule.get(b.rule);
            byRule.set(b.rule, old && old.count > b.count ? old : b);
        }
        return [...byRule.values()];
    }

    // ---------- alerts ----------

    async function findAlertChannel(guild, cfg) {
        const channelId = cfg.alertChannelId ?? logConfig.getChannelId(guild.id, 'server');
        if (!channelId) return null;
        const channel = await guild.channels.fetch(channelId).catch(() => null);
        return channel?.isTextBased() ? channel : null;
    }

    function hasRecoverable(guild, incident) {
        if (incident.simulated) return false;
        return incidents.listDeletedItems(guild.id, incident.actorId, Date.parse(incident.createdAt) - RECOVERY_LOOKBACK_MS).length > 0;
    }

    async function sendAlert(guild, incident, cfg, containNote) {
        const payload = alertPayload(incident, { hasRecoverable: hasRecoverable(guild, incident), containNote });
        const channel = await findAlertChannel(guild, cfg);
        let message = null;
        try {
            if (channel) {
                // Optional ping: only the ONE role the owner chose, and only if it still exists.
                const pingRole = cfg.alertRoleId && guild.roles.cache.has(cfg.alertRoleId) ? cfg.alertRoleId : null;
                message = await channel.send({
                    ...payload,
                    ...(pingRole ? { content: `<@&${pingRole}> 🚨 Anti-nuke alert` } : {}),
                    allowedMentions: pingRole ? { parse: [], roles: [pingRole] } : { parse: [] },
                });
            } else {
                // Last resort: tell the server owner privately.
                const owner = await guild.fetchOwner();
                message = await owner.send(payload);
                logger.warn(`No alert channel in server ${guild.id}; the owner was notified by private message instead.`);
            }
        } catch (error) {
            logger.error(`Could not deliver an anti-nuke alert in server ${guild.id}: ${error.message}`);
        }
        if (message) {
            return incidents.saveIncident({ ...incident, alertChannelId: message.channelId ?? channel?.id ?? null, alertMessageId: message.id });
        }
        return incident;
    }

    async function refreshAlert(guild, incident, containNote) {
        if (!incident.alertChannelId || !incident.alertMessageId) return;
        try {
            const channel = await guild.channels.fetch(incident.alertChannelId);
            const message = await channel.messages.fetch(incident.alertMessageId);
            await message.edit({ ...alertPayload(incident, { hasRecoverable: hasRecoverable(guild, incident), containNote }), allowedMentions: { parse: [] } });
        } catch (error) {
            logger.warn(`Could not update the alert for incident #${incident.number}: ${error.message}`);
        }
    }

    // ---------- reversible responses ----------

    // Containment = take away the roles that give dangerous powers. It never bans or kicks,
    // and the removed roles are remembered so Restore can give them back.
    async function containIncident(guild, incident) {
        if (incident.simulated) {
            const saved = incidents.saveIncident({ ...incident, status: 'contained' });
            return { incident: saved, result: { ok: true, simulated: true, removed: [], skipped: [] } };
        }
        const fail = (reason) => ({ incident, result: { ok: false, reason } });

        if (!incident.actorId) return fail('The audit log could not say who did this, so there is nobody safe to contain.');
        if (incident.actorId === guild.ownerId || incident.actorId === guild.client.user.id) {
            return fail('The server owner and I can never be contained.');
        }
        const member = await guild.members.fetch(incident.actorId).catch(() => null);
        if (!member) return fail('That account is no longer in the server.');

        const me = guild.members.me ?? (await guild.members.fetchMe());
        if (!me.permissions.has('ManageRoles')) return fail('I need the **Manage Roles** permission to contain someone.');

        const risky = [...member.roles.cache.values()].filter(
            (role) => role.id !== guild.id && !role.managed && DANGEROUS_PERMISSIONS.some((p) => role.permissions.has(p))
        );
        const removable = risky.filter((role) => role.comparePositionTo(me.roles.highest) < 0);
        const blocked = risky.filter((role) => !removable.includes(role));

        if (removable.length === 0) {
            return fail(
                blocked.length
                    ? 'Their dangerous roles are at or above my highest role. Move my role higher in Server Settings → Roles.'
                    : 'They have no removable dangerous roles. Their power may come from a bot-managed role. Use /kick or /ban if you decide to act.'
            );
        }

        try {
            await member.roles.remove(removable.map((r) => r.id), `Incomu anti-nuke containment (incident #${incident.number})`);
        } catch (error) {
            logger.error(`Containment failed in server ${guild.id}: ${error.message}`);
            return fail('Discord refused to remove the roles. Check that my role is above theirs.');
        }

        const saved = incidents.saveIncident({
            ...incident,
            status: 'contained',
            removedRoles: [...new Set([...incident.removedRoles, ...removable.map((r) => r.id)])],
        });
        return { incident: saved, result: { ok: true, removed: removable.map((r) => r.id), skipped: blocked.map((r) => r.id) } };
    }

    async function restoreIncident(guild, incident) {
        if (incident.simulated) {
            return { incident: incidents.saveIncident({ ...incident, status: 'restored' }), restored: 0, missing: 0 };
        }
        const member = incident.actorId ? await guild.members.fetch(incident.actorId).catch(() => null) : null;
        const me = guild.members.me ?? (await guild.members.fetchMe());
        let restored = 0;
        let missing = 0;

        if (member) {
            const roles = incident.removedRoles
                .map((id) => guild.roles.cache.get(id))
                .filter((role) => role && role.comparePositionTo(me.roles.highest) < 0);
            missing = incident.removedRoles.length - roles.length;
            if (roles.length) {
                await member.roles.add(roles.map((r) => r.id), `Incomu anti-nuke restore (incident #${incident.number})`);
                restored = roles.length;
            }
        } else {
            missing = incident.removedRoles.length;
        }
        return { incident: incidents.saveIncident({ ...incident, status: 'restored' }), restored, missing };
    }

    function markSafe(guild, incident) {
        graces.set(graceKey(guild.id, incident.actorId), now() + GRACE_MS);
        if (incident.actorId) detector.clearActor(guild.id, incident.actorId);
        return incidents.saveIncident({ ...incident, status: 'safe' });
    }

    async function recoverIncident(guild, incident) {
        if (incident.simulated) return { roles: 0, channels: 0, failed: [], skipped: ['simulation: nothing to recover'] };
        const items = incidents.listDeletedItems(guild.id, incident.actorId, Date.parse(incident.createdAt) - RECOVERY_LOOKBACK_MS);
        // "Claim" each item first, so clicking twice can never create duplicates.
        const claimed = items.filter((item) => incidents.claimDeletedItem(item.id));
        if (claimed.length === 0) return { roles: 0, channels: 0, failed: [], skipped: ['nothing left to recover'] };
        return recoverItems(guild, claimed, { logger, sleep });
    }

    // ---------- the main entry point ----------

    // signal fields:
    //   rule         which rule this event counts for (see rules.js)
    //   targetId     the ID of the thing acted on (used to match the audit log entry)
    //   targetName   a readable name for the alert
    //   auditType    which audit log type to look in
    //   matchAny     true when we cannot know the target (webhooks): any recent entry, used once
    //   requireEntry true = without an audit entry there is no signal (a normal leave is not a kick)
    //   snapshot     { kind, original } to save for recovery
    async function handleSignal(guild, signal) {
        const { rule, targetId = null, targetName = null, auditType = null, matchAny = false, requireEntry = false, attempts = 3, snapshot = null } = signal;
        if (!RULES[rule]) throw new Error(`Unknown anti-nuke rule: ${rule}`);

        const cfg = config.getEffective(guild.id);
        if (!cfg.enabled) return null;

        const entry = auditType
            ? await resolver.resolve(guild, auditType, { targetId: matchAny ? null : targetId, attempts, consume: matchAny })
            : null;
        if (requireEntry && !entry) return null;
        const actorId = entry?.executorId ?? null;

        if (snapshot) saveSnapshot(guild, snapshot, actorId);

        const actorClass = await classify(guild, actorId, cfg);
        if (actorClass === 'owner' || actorClass === 'self') return { ignored: true, actorClass };
        if (isGraced(guild.id, actorId)) return { ignored: true, actorClass, graced: true };

        const bucket = actorId ?? 'unknown';
        detector.record(guild.id, bucket, rule);
        const thresholds = buildThresholds({
            overrides: cfg.overrides,
            sensitivity: cfg.sensitivity,
            safe: cfg.safe,
            trusted: actorClass === 'trusted',
        });
        const breaches = detector.evaluate(guild.id, bucket, thresholds);
        if (breaches.length === 0) return { actorClass, breaches: [] };

        const severity = assessSeverity(breaches);
        const decision = decideResponse({ actorClass, severity, mode: cfg.mode, safe: cfg.safe });
        if (decision === 'ignore') return { actorClass, breaches, severity, decision };

        const evidence = { rule, target: targetName, at: now() };
        let incident = incidents.findRecentOpen(guild.id, actorId, INCIDENT_WINDOW_MS);
        let isNew = false;
        let escalated = false;

        if (!incident) {
            incident = incidents.createIncident({ guildId: guild.id, actorId, actorClass, severity, rules: breaches, evidence: [evidence] });
            isNew = true;
        } else {
            const newSeverity = maxSeverity(incident.severity, severity);
            escalated = newSeverity !== incident.severity;
            incident = incidents.saveIncident({
                ...incident,
                severity: newSeverity,
                rules: mergeRules(incident.rules, breaches),
                evidence: [...incident.evidence, evidence],
            });
        }

        let containNote = null;
        let contained = false;
        if (decision === 'contain' && incident.status !== 'contained' && actorId) {
            const outcome = await containIncident(guild, incident);
            incident = outcome.incident;
            contained = outcome.result.ok;
            containNote = outcome.result.ok ? null : `⚠️ Automatic containment failed: ${outcome.result.reason}`;
        }

        if (isNew) incident = await sendAlert(guild, incident, cfg, containNote);
        else if (escalated || contained) await refreshAlert(guild, incident, containNote);

        return { actorClass, breaches, severity, decision, incident, contained, isNew };
    }

    // Reverts dangerous permissions that were just granted to @everyone (contain mode only).
    async function revertEveryonePermissions(guild, role, added, actorClass) {
        const cfg = config.getEffective(guild.id);
        if (!cfg.enabled || cfg.mode !== 'contain') return false;
        if (!['member', 'bot', 'unknown'].includes(actorClass)) return false;
        if (role.id !== guild.id) return false; // only the @everyone role
        try {
            await role.setPermissions(role.permissions.remove(added), 'Incomu anti-nuke: dangerous permission given to @everyone');
            return true;
        } catch (error) {
            logger.error(`Could not revert @everyone permissions in server ${guild.id}: ${error.message}`);
            return false;
        }
    }

    // A safe practice incident, to see what alerts and buttons look like. Changes nothing real.
    async function simulate(guild, userId) {
        const cfg = config.getEffective(guild.id);
        const evidence = [1, 2, 3].map((n) => ({ rule: 'channelDelete', target: `#simulated-channel-${n}`, at: now() }));
        const rules = [{ rule: 'channelDelete', count: 9, threshold: 3, windowSec: 10 }];
        const incident = incidents.createIncident({ guildId: guild.id, actorId: userId, actorClass: 'member', severity: 'high', rules, evidence, simulated: true });
        return sendAlert(guild, incident, cfg, null);
    }

    // ---------- buttons ----------

    async function handleButton(interaction) {
        const [, action, numberText] = interaction.customId.split(':');
        const deny = (content) => interaction.reply({ content });

        if (!interaction.inGuild()) return;
        const guild = interaction.guild;
        const incident = incidents.getIncident(guild.id, Number(numberText));
        if (!incident) return deny('I cannot find that incident any more.');

        // Server-side authorization: the button is visible to anyone who can see the channel,
        // so we check the person again here.
        const isOwner = interaction.user.id === guild.ownerId;
        const isAdmin = interaction.memberPermissions.has('Administrator');
        if (!isOwner && !isAdmin) return deny('Only administrators can use these buttons.');
        if (action === 'safe' && !isOwner) return deny('Only the **server owner** can mark an incident as safe.');
        if (!incident.simulated && incident.actorId === interaction.user.id) {
            return deny('You cannot use the buttons on an incident caused by your own account.');
        }

        await interaction.deferReply();
        let updated = incident;
        let text;
        let containNote = null;

        try {
            if (action === 'contain') {
                const outcome = await containIncident(guild, incident);
                updated = outcome.incident;
                text = outcome.result.ok
                    ? outcome.result.simulated ? '🧪 Simulated containment done (nothing real changed).' : `🔒 Removed ${outcome.result.removed.length} dangerous role(s). Use **Restore** to give them back.`
                    : `⚠️ ${outcome.result.reason}`;
            } else if (action === 'restore') {
                const outcome = await restoreIncident(guild, incident);
                updated = outcome.incident;
                text = `↩️ Gave back ${outcome.restored} role(s).${outcome.missing ? ` ${outcome.missing} could not be restored (deleted or above my role).` : ''}`;
            } else if (action === 'safe') {
                updated = markSafe(guild, incident);
                text = '✅ Marked safe. This account will be ignored for 30 minutes.';
            } else if (action === 'recover') {
                const summary = await recoverIncident(guild, incident);
                text = `🛠️ Recreated **${summary.channels}** channel(s) and **${summary.roles}** role(s).` +
                    (summary.failed.length ? `\nFailed: ${summary.failed.join(', ')}` : '') +
                    (summary.skipped.length ? `\nSkipped: ${summary.skipped.join(', ')}` : '') +
                    '\nNew channels and roles have new IDs. Message history cannot be recovered, and members do not get recreated roles back automatically.';
            } else {
                text = 'Unknown action.';
            }
        } catch (error) {
            logger.error(`Anti-nuke button "${action}" failed in server ${guild.id}:`, error);
            text = 'Something went wrong. Check the bot console.';
        }

        await interaction.editReply({ content: text });
        if (interaction.message?.edit && updated) {
            await interaction.message
                .edit({ ...alertPayload(updated, { hasRecoverable: hasRecoverable(guild, updated), containNote }), allowedMentions: { parse: [] } })
                .catch(() => {});
        }
    }

    return {
        isEnabled, handleSignal, revertEveryonePermissions, simulate, handleButton,
        containIncident, restoreIncident, markSafe, recoverIncident,
    };
}

module.exports = { createAntinukeService, INCIDENT_WINDOW_MS, GRACE_MS };
