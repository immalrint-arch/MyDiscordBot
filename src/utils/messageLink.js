const LINK = /^https?:\/\/(?:(?:ptb|canary)\.)?discord(?:app)?\.com\/channels\/(\d{17,20})\/(\d{17,20})\/(\d{17,20})\/?$/i;
// A whole text that is just a link to a Discord message -> where it points. Otherwise null.
function parseMessageLink(text) { const m = LINK.exec(String(text ?? '').trim()); return m ? { guildId: m[1], channelId: m[2], messageId: m[3] } : null; }
module.exports = { parseMessageLink };
