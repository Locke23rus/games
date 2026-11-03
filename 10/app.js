/* Chervonets — plain JS, no dependencies.
 *
 * Rules: pick a tile, then aim along its row or column. If the first tile
 * in that direction carries the same number, both merge and vanish for
 * points; otherwise the tile slides as far as it can for a small cost.
 * Every 10 seconds a fresh number drops in. Clear the board to bank the
 * remaining time as bonus points.
 */
'use strict';

const N = 10;                 // grid size
const GAME_MS = 300000;       // total time: 5 minutes
const WAVE_MS = 10000;        // ms between fresh tiles
const STEP_MS = 85;           // slide duration per cell
const PAD = 10;               // must match --pad in style.css
const GAP = 6;                // must match --gap in style.css

const boardEl = document.getElementById('board');
const fxEl = document.getElementById('fx');
const scoreEl = document.getElementById('score');
const bestEl = document.getElementById('best');
const timeEl = document.getElementById('time');
const waveEl = document.getElementById('wave');
const overlayEl = document.getElementById('overlay');
const ovTitleEl = document.getElementById('ovTitle');
const ovStatsEl = document.getElementById('ovStats');
const ovBadgeEl = document.getElementById('ovBadge');
const ovBtnEl = document.getElementById('ovBtn');
const newGameBtn = document.getElementById('newGame');
const pauseBtn = document.getElementById('pauseBtn');

// state: 'play' | 'paused' | 'drain' | 'over'
let grid, selected, score, best, remaining, waveLeft, state;
let last = 0;
let drainAcc = 0;
let ovMode = 'over';

best = loadBest();

function loadBest() {
  try { return parseInt(localStorage.getItem('best_score'), 10) || 0; }
  catch { return 0; }
}

function saveBest() {
  try { localStorage.setItem('best_score', best); } catch { /* private mode */ }
}

/* ---------- board construction ---------- */

function buildSlots() {
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const slot = document.createElement('div');
      slot.className = 'slot';
      slot.dataset.i = i;
      slot.dataset.j = j;
      slot.style.setProperty('--c', i);
      slot.style.setProperty('--r', j);
      boardEl.appendChild(slot);
    }
  }
}

const randomInt = (a, z) => a + Math.floor(Math.random() * (z - a + 1));

function addTile(n, i, j, cls) {
  const el = document.createElement('div');
  el.className = `tile c${n}${cls ? ' ' + cls : ''}`;
  el.textContent = n;
  el.style.setProperty('--c', i);
  el.style.setProperty('--r', j);
  boardEl.appendChild(el);
  const tile = { n, i, j, el };
  grid[j][i] = tile;
  return tile;
}

function clearBoardDom() {
  boardEl.querySelectorAll('.tile').forEach(el => el.remove());
  fxEl.innerHTML = '';
}

function newGame() {
  clearBoardDom();
  grid = Array.from({ length: N }, () => Array(N).fill(null));
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      addTile(randomInt(1, 10), i, j, 'enter').el.style.setProperty('--d', i + j);
    }
  }
  score = 0;
  remaining = GAME_MS;
  waveLeft = WAVE_MS;
  selected = null;
  state = 'play';
  pauseBtn.disabled = false;
  pauseBtn.textContent = 'Pause';
  overlayEl.classList.remove('show');
  hideBadge();
  hud();
}

/* ---------- selection and actions ---------- */

function select(tile) {
  deselect();
  selected = tile;
  tile.el.classList.add('selected');
}

function deselect() {
  if (selected) selected.el.classList.remove('selected');
  selected = null;
}

boardEl.addEventListener('click', (e) => {
  if (state !== 'play') return;
  const slot = e.target.closest('.slot');
  if (!slot) return;
  resolveClick(+slot.dataset.i, +slot.dataset.j);
});

function resolveClick(i, j) {
  const clicked = grid[j][i];
  if (!selected) {
    if (clicked) select(clicked);
    return;
  }
  if (clicked === selected) {
    deselect();
    return;
  }
  if (i !== selected.i && j !== selected.j) {
    // not aligned: selection moves to the clicked tile (if any)
    if (clicked) select(clicked); else deselect();
    return;
  }

  const dx = Math.sign(i - selected.i);
  const dy = Math.sign(j - selected.j);
  let x = selected.i + dx;
  let y = selected.j + dy;
  let lastEmpty = null;
  while (x >= 0 && x < N && y >= 0 && y < N) {
    const cell = grid[y][x];
    if (cell) {
      if (cell.n === selected.n) {
        doHit(selected, cell);
      } else if (lastEmpty) {
        doMove(selected, lastEmpty);
      } else {
        // blocked immediately: reselect
        if (clicked) select(clicked); else deselect();
      }
      return;
    }
    lastEmpty = { i: x, j: y };
    x += dx;
    y += dy;
  }
  if (lastEmpty) doMove(selected, lastEmpty);
  else if (clicked) select(clicked);
  else deselect();
}

const distance = (a, b) => Math.abs(a.i - b.i) + Math.abs(a.j - b.j);
const sumTo = (d) => (d * (d + 1)) / 2; // 0 + 1 + ... + d

function slide(tile, i, j, d, done) {
  tile.el.style.zIndex = 3;
  tile.el.style.transitionDuration = d * STEP_MS + 'ms';
  requestAnimationFrame(() => {
    tile.el.style.setProperty('--c', i);
    tile.el.style.setProperty('--r', j);
  });
  setTimeout(() => {
    tile.el.style.transitionDuration = '';
    done();
  }, d * STEP_MS + 40);
}

function doHit(a, b) {
  const d = distance(a, b);
  const gain = sumTo(d + 1);
  grid[a.j][a.i] = null;
  grid[b.j][b.i] = null;
  deselect();
  score += gain;
  popScore(b.i, b.j, '+' + gain, 'gain');
  slide(a, b.i, b.j, d, () => {
    a.el.classList.add('vanish');
    b.el.classList.add('vanish');
    setTimeout(() => { a.el.remove(); b.el.remove(); }, 340);
  });
  if (boardEmpty()) beginDrain();
}

function doMove(a, pos) {
  const d = distance(a, pos);
  const cost = sumTo(d);
  grid[a.j][a.i] = null;
  grid[pos.j][pos.i] = a;
  a.i = pos.i;
  a.j = pos.j;
  deselect();
  score -= cost;
  popScore(pos.i, pos.j, '\u2212' + cost, 'loss');
  slide(a, pos.i, pos.j, d, () => {
    a.el.style.zIndex = '';
  });
}

function boardEmpty() {
  return grid.every(row => row.every(cell => cell === null));
}

/* ---------- floating scores ---------- */

function popScore(i, j, text, cls) {
  const cell = (boardEl.clientWidth - 2 * PAD - (N - 1) * GAP) / N;
  const pop = document.createElement('div');
  pop.className = 'pop ' + cls;
  pop.textContent = text;
  pop.style.left = PAD + i * (cell + GAP) + cell / 2 + 'px';
  pop.style.top = PAD + j * (cell + GAP) + cell / 2 + 'px';
  fxEl.appendChild(pop);
  pop.addEventListener('animationend', () => pop.remove());
}

/* ---------- wave: fresh tiles ---------- */

function spawnWaveTile() {
  const empty = [];
  const values = new Set();
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      if (grid[j][i]) values.add(grid[j][i].n);
      else empty.push({ i, j });
    }
  }
  if (!empty.length || !values.size) return;
  const pos = empty[Math.floor(Math.random() * empty.length)];
  const vals = [...values];
  addTile(vals[Math.floor(Math.random() * vals.length)], pos.i, pos.j, 'fresh');
}

/* ---------- timer loop ---------- */

function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(now - last, 100);
  last = now;
  if (state === 'play') {
    remaining -= dt;
    waveLeft -= dt;
    if (waveLeft <= 0) {
      waveLeft += WAVE_MS;
      spawnWaveTile();
    }
    if (remaining <= 0) {
      remaining = 0;
      hud();
      finish(false);
      return;
    }
    hud();
  } else if (state === 'drain') {
    // bank the remaining time: 100 points per second, time draining 100x
    drainAcc += dt;
    let changed = false;
    while (drainAcc >= 10) {
      drainAcc -= 10;
      score += 1;
      remaining -= 1000;
      changed = true;
    }
    if (remaining <= 0) {
      remaining = 0;
      hud();
      finish(true);
      return;
    }
    if (changed) hud();
  }
}

function beginDrain() {
  state = 'drain';
  drainAcc = 0;
  deselect();
}

/* ---------- finish / pause ---------- */

function showOverlay(mode) {
  ovMode = mode;
  if (mode === 'paused') {
    ovTitleEl.textContent = 'Paused';
    ovStatsEl.textContent = '';
    ovBtnEl.textContent = 'Resume';
  } else {
    ovTitleEl.textContent = 'Finish!';
    ovBtnEl.textContent = 'Play again';
  }
  overlayEl.classList.add('show');
}

function hideBadge() {
  ovBadgeEl.classList.remove('show');
}

function finish(cleared) {
  state = 'over';
  deselect();
  pauseBtn.disabled = true;
  pauseBtn.textContent = 'Pause';
  const record = score > best;
  if (record) {
    best = score;
    saveBest();
    ovBadgeEl.classList.add('show');
  } else {
    hideBadge();
  }
  ovStatsEl.textContent = cleared
    ? `Board cleared — score: ${score}`
    : `Time's up — score: ${score}`;
  showOverlay('over');
  hud();
}

function pause() {
  if (state !== 'play') return;
  state = 'paused';
  pauseBtn.textContent = 'Resume';
  showOverlay('paused');
}

function resume() {
  if (state !== 'paused') return;
  state = 'play';
  pauseBtn.textContent = 'Pause';
  overlayEl.classList.remove('show');
}

function togglePause() {
  if (state === 'play') pause();
  else if (state === 'paused') resume();
}

/* ---------- hud ---------- */

function formatTime(ms) {
  const s = Math.ceil(ms / 1000);
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

function hud() {
  scoreEl.textContent = score;
  bestEl.textContent = Math.max(best, score);
  timeEl.textContent = formatTime(remaining);
  waveEl.style.width = Math.max(0, 100 * waveLeft / WAVE_MS) + '%';
}

/* ---------- wiring ---------- */

newGameBtn.addEventListener('click', newGame);
pauseBtn.addEventListener('click', togglePause);
ovBtnEl.addEventListener('click', () => {
  if (ovMode === 'paused') resume();
  else newGame();
});

addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !e.repeat) {
    e.preventDefault();
    togglePause();
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) pause();
});

/* ---------- init ---------- */

buildSlots();
last = performance.now();
requestAnimationFrame((t) => { last = t; frame(t); });
newGame();
