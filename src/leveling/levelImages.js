// Pictures for leveling: the level-up card, the leaderboard ("XP Highlights") and the rank card.
// Needs the optional package "@napi-rs/canvas" (same one the quote pictures use).
let canvasLib = null;
try { canvasLib = require('@napi-rs/canvas'); } catch { canvasLib = null; }

const FAMILY = '"Montserrat", "Segoe UI", "Helvetica Neue", Inter, Arial, "Noto Sans", "Noto Sans CJK SC", sans-serif';
const isLevelImageAvailable = () => canvasLib !== null;
const font = (size, weight = 'bold') => `${weight} ${size}px ${FAMILY}`;

function roundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
}

// Shortens text with "…" until it fits in maxWidth.
function fit(ctx, text, maxWidth) {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(`${t}…`).width > maxWidth) t = t.slice(0, -1);
    return `${t}…`;
}

async function tryImage(buffer) {
    if (!buffer) return null;
    try { return await canvasLib.loadImage(buffer); } catch { return null; }
}

// "Level-up!" card: round picture on the left, big title, "old • new" under it.
async function renderLevelUp({ avatarBuffer, from, to }) {
    const { createCanvas } = canvasLib;
    const W = 360, H = 100;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    roundedRect(ctx, 0, 0, W, H, 18);
    ctx.fillStyle = '#1c1d20';
    ctx.fill();

    const image = await tryImage(avatarBuffer);
    const cx = 56, cy = 50, r = 38;
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
    if (image) {
        const s = Math.max((r * 2) / image.width, (r * 2) / image.height);
        ctx.drawImage(image, cx - (image.width * s) / 2, cy - (image.height * s) / 2, image.width * s, image.height * s);
    } else { ctx.fillStyle = '#2b2d31'; ctx.fillRect(cx - r, cy - r, r * 2, r * 2); }
    ctx.restore();

    ctx.textAlign = 'center';
    ctx.fillStyle = '#85878d';
    ctx.font = font(38);
    ctx.fillText('Level-up!', 215, 56);
    ctx.font = font(26);
    ctx.fillText(`${from} • ${to}`, 215, 88);
    return canvas.toBuffer('image/png');
}

const RANK_COLORS = ['#c9a227', '#8c8d92', '#b0763a'];

// rows: [{ rank, name, avatarBuffer, levelText, xpText }]
async function renderLeaderboard({ title, rows }) {
    const { createCanvas } = canvasLib;
    const ROW = 66, PAD = 24, HEAD = 70, W = 760;
    const H = HEAD + Math.max(1, rows.length) * ROW + PAD;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    roundedRect(ctx, 0, 0, W, H, 20);
    ctx.fillStyle = '#16171a';
    ctx.fill();

    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#8f9196';
    ctx.font = font(32);
    ctx.fillText(fit(ctx, title, W - PAD * 2), PAD, 50);

    if (!rows.length) {
        ctx.font = font(22, 'normal');
        ctx.fillText('Nobody has earned XP yet.', PAD, HEAD + 40);
    }
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        const y = HEAD + i * ROW;
        const size = 56;
        const image = await tryImage(row.avatarBuffer);
        ctx.save();
        roundedRect(ctx, PAD, y, size, size, 10); ctx.clip();
        if (image) {
            const s = Math.max(size / image.width, size / image.height);
            ctx.drawImage(image, PAD + (size - image.width * s) / 2, y + (size - image.height * s) / 2, image.width * s, image.height * s);
        } else { ctx.fillStyle = '#212226'; ctx.fillRect(PAD, y, size, size); }
        ctx.restore();

        let x = PAD + size + 14;
        const baseline = y + 37;
        ctx.font = font(26);
        ctx.fillStyle = RANK_COLORS[row.rank - 1] ?? '#6f7176';
        const rank = `#${row.rank}`;
        ctx.fillText(rank, x, baseline);
        x += ctx.measureText(rank).width + 12;

        ctx.font = font(23, '600');
        ctx.fillStyle = '#8f9196';
        const tail = ` • ${row.levelText} ${row.xpText}`;
        const tailWidth = ctx.measureText(tail).width;
        const name = fit(ctx, `• @${row.name}`, Math.max(60, W - PAD - x - tailWidth));
        ctx.fillText(`${name}${tail}`, x, baseline);
    }
    return canvas.toBuffer('image/png');
}

// Rank card for /rank.
async function renderRank({ name, avatarBuffer, rank, level, current, needed, percent, totalXp }) {
    const { createCanvas } = canvasLib;
    const W = 760, H = 200;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    roundedRect(ctx, 0, 0, W, H, 20); ctx.fillStyle = '#16171a'; ctx.fill();

    const image = await tryImage(avatarBuffer);
    const cx = 100, cy = 100, r = 66;
    ctx.save(); ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.closePath(); ctx.clip();
    if (image) {
        const s = Math.max((r * 2) / image.width, (r * 2) / image.height);
        ctx.drawImage(image, cx - (image.width * s) / 2, cy - (image.height * s) / 2, image.width * s, image.height * s);
    } else { ctx.fillStyle = '#212226'; ctx.fillRect(cx - r, cy - r, r * 2, r * 2); }
    ctx.restore();

    ctx.textAlign = 'left';
    ctx.fillStyle = '#9a9ca1'; ctx.font = font(30);
    ctx.fillText(fit(ctx, name, 360), 190, 70);
    ctx.textAlign = 'right';
    ctx.font = font(26); ctx.fillStyle = '#8f9196';
    ctx.fillText(`LEVEL ${level}`, W - 30, 50);
    ctx.fillStyle = RANK_COLORS[(rank ?? 0) - 1] ?? '#8f9196';
    ctx.fillText(rank ? `RANK #${rank}` : 'UNRANKED', W - 30, 86);

    const barX = 190, barY = 125, barW = W - 190 - 30, barH = 26;
    roundedRect(ctx, barX, barY, barW, barH, 13); ctx.fillStyle = '#26272b'; ctx.fill();
    if (percent > 0) { roundedRect(ctx, barX, barY, Math.max(barH, (barW * percent) / 100), barH, 13); ctx.fillStyle = '#7d7f85'; ctx.fill(); }
    ctx.textAlign = 'left'; ctx.font = font(18, '600'); ctx.fillStyle = '#8f9196';
    ctx.fillText(needed ? `${current.toLocaleString('en-US')} / ${needed.toLocaleString('en-US')} XP` : 'Max level', barX, barY + 56);
    ctx.textAlign = 'right';
    ctx.fillText(`Total ${totalXp.toLocaleString('en-US')} XP`, W - 30, barY + 56);
    return canvas.toBuffer('image/png');
}

module.exports = { renderLevelUp, renderLeaderboard, renderRank, isLevelImageAvailable };
