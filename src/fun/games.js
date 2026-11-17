// Pure game engines (no Discord). Boards are plain arrays.
// ---- rock paper scissors ----
const RPS = { rock: { emoji: '🪨', beats: 'scissors' }, paper: { emoji: '📄', beats: 'rock' }, scissors: { emoji: '✂️', beats: 'paper' } };
// 0 = tie, 1 = a wins, 2 = b wins
function rpsResult(a, b) { if (a === b) return 0; return RPS[a].beats === b ? 1 : 2; }

// ---- tic-tac-toe (board = 9 cells: null | 'X' | 'O') ----
const TTT_LINES = [[0, 1, 2], [3, 4, 5], [6, 7, 8], [0, 3, 6], [1, 4, 7], [2, 5, 8], [0, 4, 8], [2, 4, 6]];
function tttWinner(board) {
    for (const [a, b, c] of TTT_LINES) if (board[a] && board[a] === board[b] && board[a] === board[c]) return { winner: board[a], line: [a, b, c] };
    return board.every(Boolean) ? { winner: 'draw', line: [] } : null;
}

// ---- connect four (grid[row][col], row 0 is the top) ----
const C4_ROWS = 6, C4_COLS = 7;
const c4New = () => Array.from({ length: C4_ROWS }, () => Array(C4_COLS).fill(null));
// Drops a piece; returns the row it landed in, or -1 if the column is full.
function c4Drop(grid, col, piece) { for (let r = C4_ROWS - 1; r >= 0; r--) if (!grid[r][col]) { grid[r][col] = piece; return r; } return -1; }
function c4Winner(grid) {
    for (let r = 0; r < C4_ROWS; r++) for (let c = 0; c < C4_COLS; c++) {
        const p = grid[r][c]; if (!p) continue;
        for (const [dr, dc] of [[0, 1], [1, 0], [1, 1], [1, -1]]) {
            let n = 1; while (n < 4) { const rr = r + dr * n, cc = c + dc * n; if (rr < 0 || rr >= C4_ROWS || cc < 0 || cc >= C4_COLS || grid[rr][cc] !== p) break; n++; }
            if (n === 4) return p;
        }
    }
    return grid[0].every(Boolean) ? 'draw' : null;
}
const c4Full = (grid, col) => Boolean(grid[0][col]);

// ---- hangman ----
const HANG_MAX_WRONG = 6;
const HANG_STAGES = ['😀', '😐', '😟', '😨', '😰', '😵', '💀'];
function hangMask(word, guessed) { return [...word].map((ch) => (guessed.has(ch) ? ch : '_')).join(' '); }
const hangWon = (word, guessed) => [...word].every((ch) => guessed.has(ch));

// ---- number guessing ----
const guessHint = (guess, target) => (guess === target ? 'correct' : guess < target ? 'higher' : 'lower');

module.exports = { RPS, rpsResult, TTT_LINES, tttWinner, C4_ROWS, C4_COLS, c4New, c4Drop, c4Winner, c4Full, HANG_MAX_WRONG, HANG_STAGES, hangMask, hangWon, guessHint };
