// Turns "!ban @user 7d being rude" into option values, using the command's own option list.
// Pure code (no Discord), so it is easy to test. Option "types" are Discord's numbers:
//   3 string, 4 integer, 5 boolean, 6 user, 7 channel, 8 role, 9 mentionable, 10 number, 11 attachment.
const { parseDuration } = require('../utils/duration');

const T = { STRING: 3, INTEGER: 4, BOOLEAN: 5, USER: 6, CHANNEL: 7, ROLE: 8, MENTIONABLE: 9, NUMBER: 10, ATTACHMENT: 11 };
const REST_NAMES = ['ids', 'reason', 'note', 'nickname', 'text', 'message', 'description', 'title']; // these take "the rest of the line"
const DURATION_NAMES = ['duration', 'time', 'length'];
const BOOL_WORDS = { true: true, yes: true, on: true, y: true, false: false, no: false, off: false, n: false };

// Splits on spaces, but "quoted words" stay together. Each token remembers where it started.
function tokenize(text) {
    const tokens = [];
    const re = /"([^"]*)"|(\S+)/g;
    let m;
    while ((m = re.exec(text)) !== null) tokens.push({ text: m[1] !== undefined ? m[1] : m[2], start: m.index, quoted: m[1] !== undefined });
    return tokens;
}

const idFrom = (text, re) => { const m = text.match(re); return m ? m[1] : null; };
const asUserId = (t) => idFrom(t, /^<@!?(\d{17,20})>$/) ?? idFrom(t, /^(\d{17,20})$/);
const asRoleId = (t) => idFrom(t, /^<@&(\d{17,20})>$/) ?? idFrom(t, /^(\d{17,20})$/);
const asChannelId = (t) => idFrom(t, /^<#(\d{17,20})>$/) ?? idFrom(t, /^(\d{17,20})$/);

// Tries to read ONE token as the option. Returns { value } or { problem }.
function readToken(def, token) {
    const t = token.text;
    switch (def.type) {
        case T.USER: { const id = asUserId(t); return id ? { value: id } : { problem: 'a member (mention them or paste their ID)' }; }
        case T.MENTIONABLE: { const id = asUserId(t) ?? idFrom(t, /^<@&(\d{17,20})>$/); return id ? { value: id } : { problem: 'a member or role' }; }
        case T.ROLE: { const id = asRoleId(t); return id ? { value: id } : { problem: 'a role (mention it or paste its ID)' }; }
        case T.CHANNEL: { const id = asChannelId(t); return id ? { value: id } : { problem: 'a channel (mention it with #)' }; }
        case T.INTEGER: case T.NUMBER: {
            const ok = def.type === T.INTEGER ? /^-?\d+$/.test(t) : /^-?\d+(\.\d+)?$/.test(t);
            if (!ok) return { problem: def.type === T.INTEGER ? 'a whole number' : 'a number' };
            const n = Number(t);
            if (def.min_value !== undefined && n < def.min_value) return { problem: `a number of at least ${def.min_value}`, hard: true };
            if (def.max_value !== undefined && n > def.max_value) return { problem: `a number of at most ${def.max_value}`, hard: true };
            return { value: n };
        }
        case T.BOOLEAN: { const v = BOOL_WORDS[t.toLowerCase()]; return v === undefined ? { problem: 'yes or no' } : { value: v }; }
        case T.STRING: {
            if (def.choices?.length) {
                const hit = def.choices.find((c) => String(c.value).toLowerCase() === t.toLowerCase() || String(c.name).toLowerCase() === t.toLowerCase());
                return hit ? { value: hit.value } : { problem: `one of: ${def.choices.map((c) => c.value).join(', ')}` };
            }
            if (DURATION_NAMES.includes(def.name) && !parseDuration(t)) return { problem: 'a duration like 10m, 2h or 7d' };
            if (def.max_length && t.length > def.max_length) return { problem: `text of at most ${def.max_length} characters`, hard: true };
            return { value: t };
        }
        default: return { problem: 'something I cannot read here' };
    }
}

const typeWord = (def) => ({ [T.USER]: 'member', [T.CHANNEL]: 'channel', [T.ROLE]: 'role', [T.INTEGER]: 'number', [T.NUMBER]: 'number', [T.BOOLEAN]: 'yes/no', [T.STRING]: 'text', [T.MENTIONABLE]: 'member/role', [T.ATTACHMENT]: 'file' }[def.type] ?? 'value');

// How to type the command, for error messages:  !ban add <user> [reason]
function usageLine(prefix, path, defs) {
    const parts = defs.filter((d) => d.type !== T.ATTACHMENT).map((d) => (d.required ? `<${d.name}>` : `[${d.name}]`));
    return `${prefix}${path.join(' ')}${parts.length ? ` ${parts.join(' ')}` : ''}`;
}

// defs: the option list of the command (or subcommand). argsText: everything after the command name.
// Returns { values: { optionName: { type, value } }, error: null } or { error: 'text' }.
function parseArguments(defs, argsText) {
    const tokens = tokenize(argsText);
    const values = {};
    const textDefs = defs.filter((d) => d.type === T.STRING && !d.choices?.length); // a pick-from-a-list option is never "the rest of the line"
    const restDef = textDefs.find((d) => REST_NAMES.includes(d.name)) ?? textDefs[textDefs.length - 1] ?? null;

    let i = 0;
    for (const def of defs) {
        if (def === restDef) { if (def.required) break; continue; } // a required rest-of-line option takes everything that is left
        // (an optional one is handled at the end)
        if (def.type === T.ATTACHMENT) {
            if (def.required) return { error: `This command needs a file (\`${def.name}\`). Use the slash command for that one.` };
            continue;
        }
        // an optional plain-text option that is not the "rest of the line" (e.g. reason when nickname is the rest) is never guessed
        if (def.type === T.STRING && !def.required && !def.choices?.length && !DURATION_NAMES.includes(def.name)) continue;
        if (def.type === T.BOOLEAN && !def.required) continue; // yes/no switches are never guessed from plain words
        const token = tokens[i];
        if (!token) {
            if (def.required) return { error: `I need the **${def.name}** (${typeWord(def)}).` };
            continue;
        }
        const read = readToken(def, token);
        if (read.value !== undefined) { values[def.name] = { type: def.type, value: read.value }; i++; continue; }
        if (def.required || read.hard) return { error: `I expected **${def.name}** to be ${read.problem}, but got \`${token.text.slice(0, 40)}\`.` };
        // optional and it does not fit: leave the word for the next option
    }

    if (i < tokens.length) {
        if (!restDef) return { error: `I did not understand \`${tokens.slice(i).map((t) => t.text).join(' ').slice(0, 60)}\`.` };
        let rest = argsText.slice(tokens[i].start).trim();
        if (tokens.length - i === 1 && tokens[i].quoted) rest = tokens[i].text;
        if (restDef.max_length && rest.length > restDef.max_length) return { error: `**${restDef.name}** can be at most ${restDef.max_length} characters.` };
        values[restDef.name] = { type: T.STRING, value: rest };
    } else if (restDef?.required) {
        return { error: `I need the **${restDef.name}** (${typeWord(restDef)}).` };
    }
    return { values, error: null };
}

// Picks the command, the subcommand and the text that remains.
//   commandJson: the command's toJSON(). subName: the word after the command (may be undefined).
// Returns { defs, path: [names], consumedSub: boolean } or { error }.
function chooseSubcommand(commandJson, subWord) {
    const options = commandJson.options ?? [];
    const subs = options.filter((o) => o.type === 1);
    if (!subs.length) return { defs: options, path: [commandJson.name], consumedSub: false };
    const hit = subWord ? subs.find((s) => s.name === subWord.toLowerCase()) : null;
    if (hit) return { defs: hit.options ?? [], path: [commandJson.name, hit.name], consumedSub: true, subName: hit.name };
    if (subs.length === 1) return { defs: subs[0].options ?? [], path: [commandJson.name, subs[0].name], consumedSub: false, subName: subs[0].name }; // like /ban add
    return { error: `Which one? Use: ${subs.map((s) => `\`${commandJson.name} ${s.name}\``).join(', ')}` };
}

module.exports = { tokenize, parseArguments, chooseSubcommand, usageLine, readToken, T, REST_NAMES };
