// Builds docs/COMMANDS.md from the same catalog that powers /help, so the two can never disagree.
// Run:  node scripts/generate-docs.js
const fs = require('node:fs');
const path = require('node:path');
const { CATEGORIES, EXAMPLES, TIPS } = require('../src/help/catalog');

function buildCommandsDoc() {
    const total = new Set(CATEGORIES.flatMap((c) => c.commands)).size;
    const out = ['# Incomu commands', '', `Incomu has **${total} slash commands** in ${CATEGORIES.length} groups. This file is generated from the \`/help\` catalog: do not edit it by hand, run \`node scripts/generate-docs.js\` instead.`, '',
        'Inside Discord, `/help` shows the same information with more detail, and `/setup` walks you through turning things on.', ''];
    out.push('## Groups', '', ...CATEGORIES.map((c) => `- ${c.emoji} **${c.title}**: ${c.commands.map((n) => `\`/${n}\``).join(', ')}`), '');
    for (const c of CATEGORIES) {
        out.push(`## ${c.emoji} ${c.title}`, '', c.blurb, '');
        for (const name of c.commands) {
            out.push(`### /${name}`, '');
            const ex = EXAMPLES[name] ?? []; if (ex.length) out.push('```', ...ex, '```', '');
            if (TIPS[name]) out.push(`> ${TIPS[name]}`, '');
        }
    }
    return out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

if (require.main === module) {
    const file = path.join(__dirname, '..', 'docs', 'COMMANDS.md');
    fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, buildCommandsDoc(), 'utf8'); console.log(`Wrote ${file}`);
}
module.exports = { buildCommandsDoc };
