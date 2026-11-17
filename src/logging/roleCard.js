const { COLORS, logEmbed, actorText } = require('./style');
const { line, colorText, permissionList, stamp } = require('./textFormat');

// Shared by roleCreate and roleDelete (reference image 18, with the role's permissions added).
function roleCard({ role, created, entry }) {
    return logEmbed({
        color: created ? COLORS.green : COLORS.red,
        title: created ? 'Role Created' : 'Role Deleted',
        headline: created ? `The role <@&${role.id}> was created.` : `The role **@${role.name}** was deleted.`,
        lines: [
            line('Colour', colorText(role.color)),
            line('Permissions', permissionList(role.permissions.toArray())),
            line(created ? 'Created by' : 'Deleted by', actorText(entry)),
        ],
        footer: [`Time: ${stamp(new Date(), 'f')}`, `Role \`${role.id}\``],
    });
}

module.exports = { roleCard };
