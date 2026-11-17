// Draws the optional welcome / goodbye picture card. Needs "@napi-rs/canvas" (same as quotes).
let canvasLib = null;
try { canvasLib = require('@napi-rs/canvas'); } catch { canvasLib = null; }

const FAMILY = '"Segoe UI", "Helvetica Neue", Inter, Arial, "Noto Sans", "Noto Sans CJK SC", sans-serif';
const isCardAvailable = () => canvasLib !== null;

function fit(ctx, text, maxWidth) {
    let out = text;
    while (ctx.measureText(out).width > maxWidth && out.length > 4) out = `${out.slice(0, -2)}…`;
    return out;
}

// heading: "Welcome" / "Goodbye"; name: the person; subtitle: e.g. "You are member #12"; accent: 0xRRGGBB
async function renderCard({ heading, name, subtitle, accent = 0x2ecc71, avatarBuffer = null }) {
    if (!canvasLib) throw new Error('The picture library is not installed.');
    const { createCanvas, loadImage } = canvasLib;
    const W = 960, H = 320;
    const canvas = createCanvas(W, H);
    const ctx = canvas.getContext('2d');
    const accentCss = `#${accent.toString(16).padStart(6, '0')}`;

    const bg = ctx.createLinearGradient(0, 0, W, H);
    bg.addColorStop(0, '#0b0b0f');
    bg.addColorStop(1, '#1a1b22');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = accentCss;
    ctx.fillRect(0, 0, 10, H); // coloured edge

    // round avatar
    const cx = 170, cy = H / 2, r = 100;
    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, r + 6, 0, Math.PI * 2);
    ctx.fillStyle = accentCss;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#2b2d31';
    ctx.fillRect(cx - r, cy - r, r * 2, r * 2);
    if (avatarBuffer) {
        try { ctx.drawImage(await loadImage(avatarBuffer), cx - r, cy - r, r * 2, r * 2); } catch { /* keep the grey circle */ }
    }
    ctx.restore();

    const left = 320, maxWidth = W - left - 40;
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    ctx.fillStyle = accentCss;
    ctx.font = `bold 34px ${FAMILY}`;
    ctx.fillText(heading.toUpperCase(), left, 120);
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold 50px ${FAMILY}`;
    ctx.fillText(fit(ctx, name, maxWidth), left, 185);
    ctx.fillStyle = '#9aa0a6';
    ctx.font = `28px ${FAMILY}`;
    ctx.fillText(fit(ctx, subtitle, maxWidth), left, 235);
    return canvas.encode('png');
}

module.exports = { renderCard, isCardAvailable };
