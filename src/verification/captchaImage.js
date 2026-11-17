// Draws a captcha picture as a PNG using only Node's built-in zlib (no extra packages).
// Each letter is a tiny 5x7 pixel font, enlarged, shifted, wobbled and covered with noise,
// so a human can read it but simple text-recognition tools struggle.
const zlib = require('node:zlib');
const crypto = require('node:crypto');

// Letters that are easy to mix up (I, O, Q, 0, 1) are left out on purpose.
const CHARSET = 'ABCDEFGHJKLMNPRSTUVWXYZ23456789';

const FONT = {
    A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
    B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
    C: ['.###.', '#...#', '#....', '#....', '#....', '#...#', '.###.'],
    D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
    E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
    F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
    G: ['.###.', '#...#', '#....', '#.###', '#...#', '#...#', '.###.'],
    H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
    J: ['..###', '...#.', '...#.', '...#.', '...#.', '#..#.', '.##..'],
    K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
    L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
    M: ['#...#', '##.##', '#.#.#', '#.#.#', '#...#', '#...#', '#...#'],
    N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
    P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
    R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
    S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
    T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
    U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
    V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
    W: ['#...#', '#...#', '#...#', '#.#.#', '#.#.#', '##.##', '#...#'],
    X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
    Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
    Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
    2: ['.###.', '#...#', '....#', '...#.', '..#..', '.#...', '#####'],
    3: ['####.', '....#', '....#', '.###.', '....#', '....#', '####.'],
    4: ['...#.', '..##.', '.#.#.', '#..#.', '#####', '...#.', '...#.'],
    5: ['#####', '#....', '####.', '....#', '....#', '#...#', '.###.'],
    6: ['.###.', '#....', '#....', '####.', '#...#', '#...#', '.###.'],
    7: ['#####', '....#', '...#.', '..#..', '.#...', '.#...', '.#...'],
    8: ['.###.', '#...#', '#...#', '.###.', '#...#', '#...#', '.###.'],
    9: ['.###.', '#...#', '#...#', '.####', '....#', '....#', '.###.'],
};

// A secure random code (uses the operating system's random generator).
function randomCode(length = 5) {
    let code = '';
    for (let i = 0; i < length; i++) code += CHARSET[crypto.randomInt(CHARSET.length)];
    return code;
}

// ---- PNG writing ----
const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
});
function crc32(buffer) {
    let c = 0xffffffff;
    for (const byte of buffer) c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const out = Buffer.alloc(8 + data.length + 4);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), 8 + data.length);
    return out;
}
function encodePng(width, height, rgb) {
    const raw = Buffer.alloc((width * 3 + 1) * height); // each row starts with a "filter" byte (0 = none)
    for (let y = 0; y < height; y++) rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header[8] = 8; header[9] = 2; // 8 bits per channel, RGB
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', header), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
    ]);
}

// ---- drawing ----
function renderCaptcha(code, { random = Math.random } = {}) {
    const SCALE = 6, GLYPH_W = 5, GLYPH_H = 7, GAP = 7;
    const width = 40 + code.length * (GLYPH_W * SCALE + GAP);
    const height = 90;
    const pixels = Buffer.alloc(width * height * 3);
    const rnd = (n) => Math.floor(random() * n);
    const put = (x, y, r, g, b) => {
        if (x < 0 || y < 0 || x >= width || y >= height) return;
        const i = (y * width + x) * 3;
        pixels[i] = r; pixels[i + 1] = g; pixels[i + 2] = b;
    };

    for (let i = 0; i < width * height; i++) { // dark speckled background
        const v = 30 + rnd(22);
        pixels[i * 3] = v; pixels[i * 3 + 1] = v; pixels[i * 3 + 2] = v + 6;
    }

    let x = 20;
    for (const ch of code) {
        const glyph = FONT[ch];
        const top = 14 + rnd(18); // each letter sits at a slightly different height
        const phase = random() * 6.28;
        const hue = [[255, 214, 102], [120, 220, 255], [255, 140, 170], [150, 255, 160], [220, 180, 255]][rnd(5)];
        for (let gy = 0; gy < GLYPH_H; gy++) {
            const wobble = Math.round(Math.sin(gy * 0.9 + phase) * 3); // bends the letter sideways
            for (let gx = 0; gx < GLYPH_W; gx++) {
                if (glyph[gy][gx] !== '#') continue;
                for (let dy = 0; dy < SCALE; dy++) for (let dx = 0; dx < SCALE; dx++) {
                    put(x + gx * SCALE + dx + wobble, top + gy * SCALE + dy, ...hue);
                }
            }
        }
        x += GLYPH_W * SCALE + GAP;
    }

    // Lines through the text (thin, coloured) and random dots.
    for (let l = 0; l < 5; l++) {
        let x0 = rnd(width), y0 = rnd(height);
        const x1 = rnd(width), y1 = rnd(height);
        const color = [80 + rnd(150), 80 + rnd(150), 80 + rnd(150)];
        const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0)) || 1;
        for (let s = 0; s <= steps; s++) {
            const px = Math.round(x0 + ((x1 - x0) * s) / steps), py = Math.round(y0 + ((y1 - y0) * s) / steps);
            put(px, py, ...color); put(px + 1, py, ...color);
        }
    }
    for (let d = 0; d < 350; d++) put(rnd(width), rnd(height), 120 + rnd(120), 120 + rnd(120), 120 + rnd(120));

    return encodePng(width, height, pixels);
}

module.exports = { renderCaptcha, randomCode, CHARSET, FONT };
