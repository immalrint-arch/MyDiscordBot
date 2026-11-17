// Draws the quote picture: the author's picture (faded, black and white) on the left,
// the quote in the middle/right, the author's name under it, and a small watermark.
//
// It needs the optional package "@napi-rs/canvas" (install with: npm install @napi-rs/canvas).
// If it is missing, isQuoteImageAvailable() is false and the bot falls back to a plain embed.
const { parseInline, wrapPieces, pickFontSize } = require('./quoteText');

let canvasLib = null;
let loadError = null;
try {
    canvasLib = require('@napi-rs/canvas');
} catch (error) {
    canvasLib = null;
    loadError = error;
}

const FAMILY = '"Segoe UI", "Helvetica Neue", Inter, Arial, "Noto Sans", "Noto Sans CJK SC", sans-serif';
const WIDTH = 1000;
const AVATAR_WIDTH = 430;
const MIN_HEIGHT = 440;
const MAX_HEIGHT = 1100;

const THEMES = {
    dark: { bg: [0, 0, 0], text: '#ececec', name: '#d8d8d8', sub: '#8a8a8a', watermark: '#6b6b6b' },
    light: { bg: [244, 244, 244], text: '#141414', name: '#2a2a2a', sub: '#6b6b6b', watermark: '#9a9a9a' },
};

const isQuoteImageAvailable = () => canvasLib !== null;
// Why the picture library could not load (null when it loaded fine). Shown in the startup log.
const quoteImageProblem = () => (loadError ? (loadError.code === 'MODULE_NOT_FOUND' ? 'not installed' : loadError.message) : null);

const fontString = (size, bold, italic) => `${italic ? 'italic ' : ''}${bold ? 'bold ' : ''}${size}px ${FAMILY}`;

// Draws the avatar as a faded picture. grayscale=true makes it black and white.
function drawAvatar(ctx, image, height, theme, grayscale) {
    const { createCanvas } = canvasLib;
    const layer = createCanvas(AVATAR_WIDTH, height);
    const lctx = layer.getContext('2d');
    // "cover": fill the whole area, cropping the extra from the sides
    const scale = Math.max(AVATAR_WIDTH / image.width, height / image.height);
    const w = image.width * scale;
    const h = image.height * scale;
    lctx.drawImage(image, (AVATAR_WIDTH - w) / 2, (height - h) / 2, w, h);

    if (grayscale) {
        const data = lctx.getImageData(0, 0, AVATAR_WIDTH, height);
        const px = data.data;
        for (let i = 0; i < px.length; i += 4) {
            const g = Math.round(px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114);
            px[i] = px[i + 1] = px[i + 2] = g;
        }
        lctx.putImageData(data, 0, 0);
    }
    ctx.drawImage(layer, 0, 0);

    // fade the right edge into the background so the picture melts into the quote area
    const [r, g, b] = theme.bg;
    const fade = ctx.createLinearGradient(AVATAR_WIDTH * 0.35, 0, AVATAR_WIDTH, 0);
    fade.addColorStop(0, `rgba(${r},${g},${b},0)`);
    fade.addColorStop(1, `rgba(${r},${g},${b},1)`);
    ctx.fillStyle = fade;
    ctx.fillRect(0, 0, AVATAR_WIDTH, height);
}

// text: already cleaned quote text. avatarBuffer: PNG/JPEG/WebP bytes (or null for no picture).
// Returns a PNG Buffer.
async function renderQuote({ text, displayName, username, avatarBuffer = null, theme = 'dark', grayscale = true, bold = false, watermark = 'Incomu' }) {
    if (!canvasLib) throw new Error('The picture library is not installed.');
    const { createCanvas, loadImage } = canvasLib;
    const colors = THEMES[theme] ?? THEMES.dark;

    const textLeft = AVATAR_WIDTH - 20;
    const textWidth = WIDTH - textLeft - 55;
    const textCenter = textLeft + textWidth / 2;

    // measuring tool
    const probe = createCanvas(10, 10).getContext('2d');
    const size = pickFontSize(text.length);
    const measure = (t, bold, italic) => {
        probe.font = fontString(size, bold, italic);
        return probe.measureText(t).width;
    };
    const pieces = parseInline(text).map((piece) => (bold ? { ...piece, bold: true } : piece));
    let lines = wrapPieces(pieces, measure, textWidth);
    const lineHeight = Math.round(size * 1.32);
    const maxLines = Math.floor((MAX_HEIGHT - 190) / lineHeight);
    if (lines.length > maxLines) {
        lines = lines.slice(0, maxLines);
        const last = lines[lines.length - 1];
        last.push({ text: ' …', bold: false, italic: false, width: measure(' …', false, false) });
    }

    const textHeight = lines.length * lineHeight;
    const height = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, textHeight + 190));
    const canvas = createCanvas(WIDTH, height);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = `rgb(${colors.bg.join(',')})`;
    ctx.fillRect(0, 0, WIDTH, height);

    if (avatarBuffer) {
        try {
            drawAvatar(ctx, await loadImage(avatarBuffer), height, colors, grayscale);
        } catch {
            // a broken picture should never stop the quote
        }
    }

    // the quote itself, centered as a block
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'left';
    const blockTop = (height - (textHeight + 100)) / 2;
    let y = blockTop + size;
    for (const line of lines) {
        const total = line.reduce((sum, run) => sum + run.width, 0);
        let x = textCenter - total / 2;
        for (const run of line) {
            ctx.font = fontString(size, run.bold, run.italic);
            ctx.fillStyle = colors.text;
            ctx.fillText(run.text, x, y);
            x += run.width;
        }
        y += lineHeight;
    }

    // "- Name" and "@username"
    ctx.textAlign = 'center';
    ctx.font = fontString(28, false, true);
    ctx.fillStyle = colors.name;
    let nameText = `- ${displayName}`;
    while (ctx.measureText(nameText).width > textWidth && nameText.length > 6) nameText = `${nameText.slice(0, -2)}…`;
    ctx.fillText(nameText, textCenter, y + 24);
    ctx.font = fontString(20, false, false);
    ctx.fillStyle = colors.sub;
    ctx.fillText(`@${username}`, textCenter, y + 56);

    // watermark
    ctx.textAlign = 'right';
    ctx.font = fontString(17, false, false);
    ctx.fillStyle = colors.watermark;
    ctx.fillText(watermark, WIDTH - 22, height - 20);

    return canvas.encode('png');
}

module.exports = { renderQuote, isQuoteImageAvailable, quoteImageProblem, THEMES, WIDTH };
