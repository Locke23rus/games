/* Fifteen Puzzle — plain JS, no dependencies */
(() => {
  'use strict';

  const $ = (sel) => document.querySelector(sel);

  const boardEl = $('#board');
  const movesEl = $('#moves');
  const timeEl = $('#time');
  const bestEl = $('#best');
  const winEl = $('#win');
  const winStatsEl = $('#winStats');
  const winBestEl = $('#winBest');
  const fxCanvas = $('#fx');
  const soundBtn = $('#sound');
  const soundOnIcon = $('#soundOn');
  const soundOffIcon = $('#soundOff');

  /* ---------- persistent storage (fails silently on file:// restrictions) ---------- */

  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch { /* ignore */ }
    },
  };

  /* ---------- sound (WebAudio, generated on the fly) ---------- */

  const sound = {
    enabled: store.get('fifteen.sound', true),
    ctx: null,
    ensure() {
      if (!this.enabled) return null;
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) this.ctx = new AC();
      }
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    },
    tone(freq, dur, type = 'triangle', gain = 0.05, delay = 0) {
      const ctx = this.ensure();
      if (!ctx) return;
      const t0 = ctx.currentTime + delay;
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      g.gain.setValueAtTime(gain, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + dur + 0.05);
    },
    move(value) {
      this.tone(360 + (value % 12) * 18, 0.06, 'triangle', 0.04);
    },
    win() {
      [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(f, 0.22, 'sine', 0.06, i * 0.12));
    },
  };

  function renderSoundIcon() {
    soundOnIcon.classList.toggle('hidden', !sound.enabled);
    soundOffIcon.classList.toggle('hidden', sound.enabled);
    soundBtn.setAttribute('aria-pressed', String(!sound.enabled));
  }

  soundBtn.addEventListener('click', () => {
    sound.enabled = !sound.enabled;
    store.set('fifteen.sound', sound.enabled);
    if (sound.enabled) sound.tone(660, 0.08, 'sine', 0.05);
    renderSoundIcon();
  });

  /* ---------- state ---------- */

  let n = Math.min(Math.max(store.get('fifteen.n', 4), 3), 5);
  let board = []; // board[r][c] = tile value, 0 = empty
  let blank = { r: 0, c: 0 };
  let moves = 0;
  let started = false;
  let won = false;
  const tiles = new Map(); // value -> element

  /* ---------- timer ---------- */

  let timerId = null;
  let startedAt = 0;
  let elapsedMs = 0;

  const fmtTime = (ms) => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  function tick() {
    timeEl.textContent = fmtTime(startedAt ? performance.now() - startedAt : elapsedMs);
  }

  function startTimer() {
    startedAt = performance.now() - elapsedMs;
    timerId = setInterval(tick, 250);
  }

  function stopTimer() {
    if (timerId) {
      clearInterval(timerId);
      timerId = null;
    }
    if (startedAt) {
      elapsedMs = performance.now() - startedAt;
      startedAt = 0;
    }
  }

  /* ---------- board building & rendering ---------- */

  function build() {
    boardEl.style.setProperty('--n', n);
    boardEl.innerHTML = '';
    tiles.clear();

    for (let i = 0; i < n * n; i++) {
      const slot = document.createElement('div');
      slot.className = 'slot';
      slot.style.setProperty('--r', (i / n) | 0);
      slot.style.setProperty('--c', i % n);
      boardEl.appendChild(slot);
    }

    const count = n * n - 1;
    for (let v = 1; v <= count; v++) {
      const tile = document.createElement('button');
      tile.type = 'button';
      tile.className = 'tile';
      tile.tabIndex = -1;
      tile.dataset.v = v;
      tile.setAttribute('aria-label', `Tile ${v}`);
      tile.style.setProperty('--v', v);
      // warm gradient sweep across the tiles: gold -> coral
      const h = 48 - 40 * ((v - 1) / Math.max(count - 1, 1));
      tile.style.background = `linear-gradient(155deg, hsl(${h} 86% 63%), hsl(${h - 14} 78% 46%))`;
      const span = document.createElement('span');
      span.textContent = v;
      tile.appendChild(span);
      boardEl.appendChild(tile);
      tiles.set(v, tile);
    }
  }

  function render() {
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const v = board[r][c];
        if (!v) continue;
        const el = tiles.get(v);
        el.style.setProperty('--r', r);
        el.style.setProperty('--c', c);
      }
    }
  }

  function findTile(v) {
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        if (board[r][c] === v) return { r, c };
      }
    }
    return null;
  }

  function isSolved() {
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        const expected = r === n - 1 && c === n - 1 ? 0 : r * n + c + 1;
        if (board[r][c] !== expected) return false;
      }
    }
    return true;
  }

  /* ---------- moves ---------- */

  // Slide the tile at (r, c) into the blank; whole row/column segment moves at once.
  // Returns the moved tile values (empty array if the move is illegal).
  function slide(r, c) {
    if (won) return [];
    if ((r !== blank.r && c !== blank.c) || (r === blank.r && c === blank.c)) return [];
    const moved = [];
    if (r === blank.r) {
      const d = c > blank.c ? 1 : -1;
      let cc = blank.c;
      while (cc !== c) {
        board[r][cc] = board[r][cc + d];
        moved.push(board[r][cc]);
        cc += d;
      }
    } else {
      const d = r > blank.r ? 1 : -1;
      let rr = blank.r;
      while (rr !== r) {
        board[rr][c] = board[rr + d][c];
        moved.push(board[rr][c]);
        rr += d;
      }
    }
    board[r][c] = 0;
    blank = { r, c };
    return moved;
  }

  function handleMove(r, c) {
    const moved = slide(r, c);
    if (!moved.length) return;
    if (!started) {
      started = true;
      startTimer();
    }
    moves += moved.length;
    movesEl.textContent = moves;
    moved.forEach((v) => sound.move(v));
    render();
    if (isSolved()) onWin();
  }

  boardEl.addEventListener('click', (e) => {
    const tile = e.target.closest('.tile');
    if (!tile) return;
    const pos = findTile(+tile.dataset.v);
    if (pos) handleMove(pos.r, pos.c);
  });

  // Arrow keys / WASD: the tile opposite the pressed direction slides into the gap.
  const keyDirs = {
    ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1],
    w: [-1, 0], s: [1, 0], a: [0, -1], d: [0, 1],
  };

  window.addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (winEl.classList.contains('show') && (e.key === 'Enter' || e.key === ' ')) {
      e.preventDefault();
      newGame();
      return;
    }
    const d = keyDirs[e.key];
    if (!d) return;
    e.preventDefault();
    const r = blank.r - d[0];
    const c = blank.c - d[1];
    if (r >= 0 && r < n && c >= 0 && c < n) handleMove(r, c);
  });

  /* ---------- new game (random walk guarantees a solvable board) ---------- */

  function newGame() {
    board = Array.from({ length: n }, (_, r) =>
      Array.from({ length: n }, (_, c) => (r * n + c + 1) % (n * n))
    );
    blank = { r: n - 1, c: n - 1 };

    const dirs = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    let lastDir = -1;
    const steps = n * n * 40;
    for (let i = 0; i < steps; i++) {
      const options = [];
      for (let idx = 0; idx < 4; idx++) {
        // never undo the previous move, so the shuffle stays meaningful
        if (idx === (lastDir ^ 1)) continue; // dirs paired: 0<->1, 2<->3
        const r = blank.r + dirs[idx][0];
        const c = blank.c + dirs[idx][1];
        if (r >= 0 && r < n && c >= 0 && c < n) options.push(idx);
      }
      const idx = options[(Math.random() * options.length) | 0];
      lastDir = idx;
      const r = blank.r + dirs[idx][0];
      const c = blank.c + dirs[idx][1];
      board[blank.r][blank.c] = board[r][c];
      board[r][c] = 0;
      blank = { r, c };
    }
    if (isSolved()) {
      newGame();
      return;
    }

    moves = 0;
    started = false;
    won = false;
    stopTimer();
    elapsedMs = 0;
    timeEl.textContent = '0:00';
    movesEl.textContent = '0';
    winEl.classList.remove('show');
    boardEl.classList.remove('won');
    render();
  }

  /* ---------- winning ---------- */

  function updateBest() {
    const best = store.get(`fifteen.best.${n}`, null);
    bestEl.textContent = best ? fmtTime(best.ms) : '—';
  }

  function onWin() {
    won = true;
    stopTimer();
    boardEl.classList.add('won');
    sound.win();
    setTimeout(fireConfetti, 250);

    const best = store.get(`fifteen.best.${n}`, null);
    const isBest = !best || elapsedMs < best.ms || (elapsedMs === best.ms && moves < best.moves);
    if (isBest) store.set(`fifteen.best.${n}`, { ms: elapsedMs, moves });

    winStatsEl.textContent = `${fmtTime(elapsedMs)} · ${moves} moves`;
    winBestEl.classList.toggle('show', isBest);
    updateBest();
    // let the victory wave play out before the card appears
    setTimeout(() => winEl.classList.add('show'), 950);
  }

  $('#again').addEventListener('click', newGame);
  $('#shuffle').addEventListener('click', () => {
    sound.tone(500, 0.05, 'triangle', 0.04);
    newGame();
  });

  /* ---------- confetti (canvas, no libraries) ---------- */

  function fireConfetti() {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const ctx = fxCanvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const rect = boardEl.getBoundingClientRect();
    fxCanvas.width = Math.round(rect.width * dpr);
    fxCanvas.height = Math.round(rect.height * dpr);
    const W = fxCanvas.width;
    const H = fxCanvas.height;

    const colors = ['#f6c453', '#ef7d54', '#e75480', '#9b5de5', '#4cc9f0', '#fdfdff'];
    const parts = Array.from({ length: 160 }, () => {
      const angle = Math.random() * Math.PI * 2;
      const speed = (0.25 + Math.random() * 0.75) * 11 * dpr;
      return {
        x: W / 2,
        y: H / 2,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 3 * dpr,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.3,
        s: (4 + Math.random() * 5) * dpr,
        color: colors[(Math.random() * colors.length) | 0],
        life: 1,
      };
    });

    let frames = 0;
    (function step() {
      ctx.clearRect(0, 0, W, H);
      let alive = false;
      for (const p of parts) {
        p.vy += 0.28 * dpr;
        p.vx *= 0.985;
        p.vy *= 0.985;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        p.life -= 0.008;
        if (p.y < H + 40 * dpr && p.life > 0) {
          alive = true;
        } else {
          continue;
        }
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = Math.max(p.life, 0);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.62);
        ctx.restore();
      }
      if (alive && ++frames < 400) {
        requestAnimationFrame(step);
      } else {
        ctx.clearRect(0, 0, W, H);
      }
    })();
  }

  /* ---------- board size selector ---------- */

  const sizeButtons = document.querySelectorAll('.seg button');
  sizeButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      if (+btn.dataset.n === n) return;
      sizeButtons.forEach((b) => b.classList.toggle('active', b === btn));
      n = +btn.dataset.n;
      store.set('fifteen.n', n);
      build();
      updateBest();
      newGame();
    });
  });

  /* ---------- init ---------- */

  sizeButtons.forEach((b) => b.classList.toggle('active', +b.dataset.n === n));
  renderSoundIcon();
  build();
  updateBest();
  newGame();
})();
