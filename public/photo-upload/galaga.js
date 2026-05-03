// Galaga-clone easter egg for the wedding upload page.
// Lazy-loaded by upload.js after 5 quick clicks on the logo.
// Self-contained: no asset deps, all sprites drawn from polygons.
// Exposes a single global: window.startGalaga().
(function () {
  if (window.__galagaLoaded) return;
  window.__galagaLoaded = true;

  // ---------- Constants ----------
  const W = 480;
  const H = 720;
  const HISCORE_KEY = "carfagno.galaga.hiscore";
  const PLAYER_SPEED = 260;
  const PLAYER_BULLET_SPEED = 720;
  const ENEMY_BULLET_SPEED = 280;
  const PLAYER_FIRE_COOLDOWN = 0.18;
  const RESPAWN_DELAY = 1.4;
  const BULLET_LIMIT_SINGLE = 1;
  const BULLET_LIMIT_DUAL = 2;

  const COLS = 8;
  const ROWS = 5;
  const SLOT_DX = 38;
  const SLOT_DY = 36;
  const SLOT_TOP = 110;

  const POINTS = {
    bee: 50,
    beeDive: 100,
    butterfly: 80,
    butterflyDive: 160,
    boss: 150,
    bossDive: 400,
    bossDiveEscort: 800
  };

  const POINTS_PER_LIFE = 30000;

  // ---------- Math helpers ----------
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  function bezier(p0, p1, p2, p3, t) {
    const u = 1 - t;
    const tt = t * t;
    const uu = u * u;
    return {
      x: uu * u * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + tt * t * p3.x,
      y: uu * u * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + tt * t * p3.y
    };
  }
  function bezierTangent(p0, p1, p2, p3, t) {
    const u = 1 - t;
    return {
      x: 3 * u * u * (p1.x - p0.x) + 6 * u * t * (p2.x - p1.x) + 3 * t * t * (p3.x - p2.x),
      y: 3 * u * u * (p1.y - p0.y) + 6 * u * t * (p2.y - p1.y) + 3 * t * t * (p3.y - p2.y)
    };
  }
  const rand = (a, b) => a + Math.random() * (b - a);

  // ---------- Audio (Web Audio synth) ----------
  let audioCtx = null;
  let muted = false;
  function ensureAudio() {
    if (audioCtx) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      audioCtx = new Ctx();
    } catch (_) {
      audioCtx = null;
    }
  }
  function bleep(freq, dur, type, vol, sweepTo) {
    if (muted || !audioCtx) return;
    const t0 = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type || "square";
    osc.frequency.setValueAtTime(freq, t0);
    if (typeof sweepTo === "number") {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t0 + dur);
    }
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(vol || 0.06, t0 + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }
  const sfx = {
    shoot:       () => bleep(1100, 0.07, "square",   0.05, 600),
    enemyShoot:  () => bleep(380,  0.10, "square",   0.04, 240),
    hit:         () => bleep(220,  0.10, "triangle", 0.07, 110),
    explode:     () => { bleep(140, 0.30, "square", 0.08, 40); bleep(80, 0.32, "sawtooth", 0.05, 30); },
    dive:        () => bleep(660,  0.18, "square",   0.04, 220),
    capture:     () => { bleep(440, 0.5, "sine", 0.05, 880); bleep(660, 0.5, "sine", 0.04, 1100); },
    rescue:      () => { bleep(660, 0.2, "square", 0.06, 990); bleep(990, 0.25, "square", 0.06, 1320); },
    stage:       () => { bleep(523, 0.12, "square", 0.07); setTimeout(() => bleep(659, 0.12, "square", 0.07), 130); setTimeout(() => bleep(784, 0.16, "square", 0.07), 270); },
    extraLife:   () => { bleep(523, 0.1, "square", 0.06); setTimeout(() => bleep(784, 0.1, "square", 0.06), 110); setTimeout(() => bleep(1046, 0.14, "square", 0.06), 220); },
    gameOver:    () => { bleep(330, 0.4, "sawtooth", 0.07, 110); }
  };

  // ---------- Game state ----------
  let canvas, ctx;
  let overlay, closeBtn, muteBtn, fireBtn;
  let rafId = null;
  let prevTs = 0;
  let running = false;
  let paused = false;

  let state = "title"; // title | intro | playing | wave-clear | captured | game-over
  let stateTimer = 0;
  let stage = 1;
  let score = 0;
  let hiscore = 0;
  let lives = 3;
  let nextExtraAt = POINTS_PER_LIFE;

  let player = null;
  let bullets = [];
  let enemyBullets = [];
  let enemies = [];
  let particles = [];
  let stars = [];
  let formationT = 0;
  let attackerTimer = 0;
  let pendingAttackers = 0;
  let capturedShip = null; // { bossId } reference to boss carrying our ship

  const keys = { left: false, right: false, fire: false };
  const touch = { active: false, x: W / 2, fire: false };
  let fireDownEdge = false;
  let lastFireAt = -10;

  // ---------- Init starfield ----------
  function initStars() {
    stars = [];
    for (let i = 0; i < 80; i++) {
      stars.push({
        x: Math.random() * W,
        y: Math.random() * H,
        v: 18 + Math.random() * 80,
        b: 0.3 + Math.random() * 0.7
      });
    }
  }

  // ---------- Player ----------
  function newPlayer() {
    return {
      x: W / 2,
      y: H - 70,
      alive: true,
      respawnAt: 0,
      dual: false,
      capturing: false,
      lostToCapture: false
    };
  }

  // ---------- Enemies ----------
  let enemyIdSeq = 0;
  function makeEnemy(kind, slotCol, slotRow) {
    enemyIdSeq++;
    return {
      id: enemyIdSeq,
      kind,                       // "bee" | "butterfly" | "boss"
      hp: kind === "boss" ? 2 : 1,
      slotCol,
      slotRow,
      x: 0,
      y: 0,
      angle: 0,
      mode: "intro",             // intro | formation | attack | tractor | returning | dying
      modeT: 0,
      path: null,                 // current bezier path
      pathDur: 0,
      attackBeam: 0,              // tractor beam open progress 0..1
      carriesPlayer: false,
      escortOf: null,             // boss id this is escorting
      fireCooldown: rand(0.6, 1.6)
    };
  }

  function slotPos(col, row, t) {
    const sway = Math.sin(t * 0.6) * 12 + Math.cos(t * 0.31) * 6;
    const x = (col - (COLS - 1) / 2) * SLOT_DX + W / 2 + sway;
    const y = SLOT_TOP + row * SLOT_DY;
    return { x, y };
  }

  function spawnFormation() {
    enemies = [];
    enemyIdSeq = 0;
    formationT = 0;
    pendingAttackers = 0;

    // Row layout: 0 = bosses (4 centered), 1-2 = butterflies, 3-4 = bees.
    const groups = [];
    // Row 0: bosses cols 2..5
    for (let c = 2; c <= 5; c++) groups.push({ kind: "boss", c, r: 0 });
    // Rows 1-2: butterflies all 8 cols
    for (let r = 1; r <= 2; r++) for (let c = 0; c < COLS; c++) groups.push({ kind: "butterfly", c, r });
    // Rows 3-4: bees all 8 cols
    for (let r = 3; r <= 4; r++) for (let c = 0; c < COLS; c++) groups.push({ kind: "bee", c, r });

    // Stagger entries in alternating side waves of ~6 enemies.
    let i = 0;
    let side = -1;
    for (const g of groups) {
      const e = makeEnemy(g.kind, g.c, g.r);
      const start = { x: side < 0 ? -40 : W + 40, y: 60 + Math.random() * 40 };
      const slotEnd = slotPos(g.c, g.r, 0);
      // Curve through middle so it feels swooshy.
      const c1 = { x: side < 0 ? 80 : W - 80, y: 280 + Math.random() * 80 };
      const c2 = { x: slotEnd.x + side * 80, y: slotEnd.y + 200 };
      e.path = { p0: start, p1: c1, p2: c2, p3: slotEnd };
      e.pathDur = 1.8;
      e.modeT = -i * 0.18; // negative time = wait before entry
      e.x = start.x;
      e.y = start.y;
      enemies.push(e);
      i++;
      if (i % 6 === 0) side *= -1;
    }
  }

  function aliveFormationEnemies() {
    return enemies.filter((e) => e.mode !== "dying" && e.mode !== "intro");
  }
  function totalAlive() {
    return enemies.filter((e) => e.mode !== "dying").length;
  }

  function pickAttackers() {
    if (state !== "playing") return;
    const ready = enemies.filter((e) => e.mode === "formation");
    if (ready.length === 0) return;
    // Pick a leader; bosses preferred.
    const bosses = ready.filter((e) => e.kind === "boss");
    let leader = bosses.length && Math.random() < 0.45 ? bosses[Math.floor(Math.random() * bosses.length)]
                                                       : ready[Math.floor(Math.random() * ready.length)];
    const group = [leader];
    if (Math.random() < 0.6) {
      const escorts = ready.filter((e) => e !== leader && Math.abs(e.slotCol - leader.slotCol) <= 1).slice(0, 2);
      for (const e of escorts) group.push(e);
    }
    group.forEach((e, idx) => beginAttack(e, idx, leader));
  }

  function beginAttack(e, idx, leader) {
    e.mode = "attack";
    e.modeT = -idx * 0.18;
    e.escortOf = e === leader ? null : leader.id;
    const slot = slotPos(e.slotCol, e.slotRow, formationT);
    const side = e.slotCol < COLS / 2 ? -1 : 1;
    // Dive path: curve out, swoop down past player area, exit bottom-ish.
    const p0 = { x: e.x, y: e.y };
    const p1 = { x: slot.x + side * 90, y: slot.y + 40 };
    const p2 = { x: W / 2 - side * 140, y: H * 0.55 };
    const exitX = W / 2 + (Math.random() - 0.5) * 200;
    const p3 = { x: exitX, y: H + 40 };
    e.path = { p0, p1, p2, p3 };
    e.pathDur = 2.4 + Math.random() * 0.6;
    // Boss occasionally goes for tractor beam at top.
    if (e.kind === "boss" && !capturedShip && !player.dual && Math.random() < 0.35) {
      e.tractorPlanned = true;
    }
    sfx.dive();
  }

  function fireEnemyBullet(e) {
    if (!player || !player.alive) return;
    const dx = player.x - e.x;
    const dy = player.y - e.y;
    const len = Math.hypot(dx, dy) || 1;
    const speed = ENEMY_BULLET_SPEED;
    enemyBullets.push({
      x: e.x,
      y: e.y + 8,
      vx: (dx / len) * speed * 0.5, // less steep than direct line
      vy: Math.max(120, (dy / len) * speed)
    });
    sfx.enemyShoot();
  }

  // ---------- Bullets / particles ----------
  function tryFire() {
    if (!player || !player.alive) return;
    const limit = player.dual ? BULLET_LIMIT_DUAL : BULLET_LIMIT_SINGLE;
    if (bullets.length >= limit) return;
    const now = performance.now() / 1000;
    if (now - lastFireAt < PLAYER_FIRE_COOLDOWN) return;
    lastFireAt = now;
    bullets.push({ x: player.x, y: player.y - 12, vy: -PLAYER_BULLET_SPEED });
    if (player.dual) bullets.push({ x: player.x - 28, y: player.y - 12, vy: -PLAYER_BULLET_SPEED });
    sfx.shoot();
  }

  function explode(x, y, color, count) {
    const n = count || 18;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 60 + Math.random() * 180;
      particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.5 + Math.random() * 0.4, t: 0, color });
    }
    sfx.explode();
  }

  function addScore(n) {
    score += n;
    if (score > hiscore) hiscore = score;
    if (score >= nextExtraAt) {
      lives++;
      nextExtraAt += POINTS_PER_LIFE;
      sfx.extraLife();
    }
  }

  // ---------- Update ----------
  function update(dt) {
    formationT += dt;

    // Stars
    for (const s of stars) {
      s.y += s.v * dt;
      if (s.y > H) { s.y = -2; s.x = Math.random() * W; }
    }

    if (state === "title" || state === "game-over") return;

    if (state === "wave-clear") {
      stateTimer -= dt;
      if (stateTimer <= 0) startStage(stage + 1);
      return;
    }

    // Player
    updatePlayer(dt);

    // Enemies
    for (const e of enemies) updateEnemy(e, dt);

    // Cull dead
    enemies = enemies.filter((e) => !(e.mode === "dying" && e.modeT >= 0.4));

    // Bullets
    for (const b of bullets) b.y += b.vy * dt;
    bullets = bullets.filter((b) => b.y > -10);
    for (const b of enemyBullets) { b.x += b.vx * dt; b.y += b.vy * dt; }
    enemyBullets = enemyBullets.filter((b) => b.y < H + 10 && b.x > -10 && b.x < W + 10);

    // Collisions
    collide();

    // Particles
    for (const p of particles) { p.t += dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.96; p.vy *= 0.96; }
    particles = particles.filter((p) => p.t < p.life);

    // Attacker timer
    if (state === "playing") {
      attackerTimer -= dt;
      if (attackerTimer <= 0 && allInFormation()) {
        attackerTimer = Math.max(1.0, 3.0 - stage * 0.18) + Math.random() * 0.6;
        pickAttackers();
      }
    }

    // Wave clear?
    if (state === "playing" && enemies.length === 0) {
      state = "wave-clear";
      stateTimer = 1.8;
      sfx.stage();
    }

    // Capture flow
    if (state === "captured") {
      stateTimer -= dt;
      if (stateTimer <= 0) {
        // Finish the lost life and continue.
        loseLifeFinal();
        state = "playing";
      }
    }
  }

  function allInFormation() {
    return enemies.every((e) => e.mode === "formation" || e.mode === "attack" || e.mode === "tractor" || e.mode === "returning");
  }

  function updatePlayer(dt) {
    if (!player) return;
    if (!player.alive) {
      player.respawnAt -= dt;
      if (player.respawnAt <= 0) {
        if (lives <= 0) {
          state = "game-over";
          stateTimer = 0;
          sfx.gameOver();
          if (hiscore > 0) try { localStorage.setItem(HISCORE_KEY, String(hiscore)); } catch (_) {}
          return;
        }
        // Respawn
        player = newPlayer();
        if (capturedShip) player.lostToCapture = true; // visual only
      }
      return;
    }
    // Touch overrides keyboard for movement
    if (touch.active) {
      const target = clamp(touch.x, 24, W - 24);
      const dir = Math.sign(target - player.x);
      const move = PLAYER_SPEED * dt;
      if (Math.abs(target - player.x) <= move) player.x = target;
      else player.x += dir * move;
    } else {
      let vx = 0;
      if (keys.left) vx -= PLAYER_SPEED;
      if (keys.right) vx += PLAYER_SPEED;
      player.x = clamp(player.x + vx * dt, 24, W - 24);
    }
    // Fire
    if (keys.fire || touch.fire || fireDownEdge) {
      tryFire();
      fireDownEdge = false;
    }
  }

  function updateEnemy(e, dt) {
    e.modeT += dt;
    if (e.mode === "intro") {
      if (e.modeT < 0) {
        // Waiting offscreen.
        return;
      }
      const t = clamp(e.modeT / e.pathDur, 0, 1);
      const p = bezier(e.path.p0, e.path.p1, e.path.p2, e.path.p3, t);
      const tg = bezierTangent(e.path.p0, e.path.p1, e.path.p2, e.path.p3, t);
      e.x = p.x; e.y = p.y;
      e.angle = Math.atan2(tg.y, tg.x) - Math.PI / 2;
      if (t >= 1) {
        e.mode = "formation";
        e.modeT = 0;
        e.angle = 0;
      }
    } else if (e.mode === "formation") {
      const slot = slotPos(e.slotCol, e.slotRow, formationT);
      e.x = slot.x; e.y = slot.y;
      // Idle fire (rare)
      e.fireCooldown -= dt;
      if (e.fireCooldown <= 0 && Math.random() < 0.0015) {
        // formation enemies almost never fire
        e.fireCooldown = rand(2, 5);
      }
    } else if (e.mode === "attack") {
      if (e.modeT < 0) return;
      const t = clamp(e.modeT / e.pathDur, 0, 1);
      const p = bezier(e.path.p0, e.path.p1, e.path.p2, e.path.p3, t);
      const tg = bezierTangent(e.path.p0, e.path.p1, e.path.p2, e.path.p3, t);
      e.x = p.x; e.y = p.y;
      e.angle = Math.atan2(tg.y, tg.x) - Math.PI / 2;
      // Random fire while attacking
      e.fireCooldown -= dt;
      if (e.fireCooldown <= 0) {
        if (Math.random() < 0.55) fireEnemyBullet(e);
        e.fireCooldown = rand(0.4, 0.9);
      }
      // Boss tractor checkpoint
      if (e.tractorPlanned && t > 0.4 && t < 0.5) {
        e.mode = "tractor";
        e.modeT = 0;
        e.attackBeam = 0;
        e.tractorPlanned = false;
        e.x = clamp(e.x, 80, W - 80);
        e.angle = Math.PI; // upside down
        sfx.capture();
      }
      if (t >= 1) {
        // Re-enter formation: spawn a return path from top.
        const slot = slotPos(e.slotCol, e.slotRow, formationT);
        const p0 = { x: e.x < W / 2 ? -30 : W + 30, y: -30 };
        const p1 = { x: slot.x, y: 60 };
        const p2 = { x: slot.x, y: slot.y - 40 };
        const p3 = { x: slot.x, y: slot.y };
        e.path = { p0, p1, p2, p3 };
        e.pathDur = 1.5;
        e.mode = "returning";
        e.modeT = 0;
      }
    } else if (e.mode === "tractor") {
      // Sit at top with beam open for a few seconds.
      e.attackBeam = clamp(e.modeT / 0.6, 0, 1);
      // Beam check: triangle from boss down to the player line.
      if (player && player.alive && !player.capturing && e.modeT > 0.6 && e.modeT < 2.4) {
        const beamLen = H - 80 - e.y; // reach the player area
        const beamHalf = lerp(18, 130, clamp((player.y - e.y) / beamLen, 0, 1));
        if (Math.abs(player.x - e.x) < beamHalf && player.y > e.y && player.y < e.y + beamLen) {
          // Start capturing
          player.capturing = true;
          player.captureBoss = e;
          e.carriesPlayer = true;
          capturedShip = { bossId: e.id };
        }
      }
      // Animate captured ship rising into boss.
      if (player && player.capturing) {
        player.y = lerp(player.y, e.y + 24, 4 * dt);
        player.x = lerp(player.x, e.x, 4 * dt);
        if (Math.abs(player.y - (e.y + 24)) < 2) {
          // Capture complete; player ship is "consumed" — lose a life as if hit.
          player.alive = false;
          player.respawnAt = RESPAWN_DELAY;
          state = "captured";
          stateTimer = 0.6;
          lives -= 1;
          // Boss returns to formation carrying ship marker.
        }
      }
      if (e.modeT > 3.5) {
        // Beam closes; boss returns to formation.
        const slot = slotPos(e.slotCol, e.slotRow, formationT);
        const p0 = { x: e.x, y: e.y };
        const p1 = { x: slot.x, y: 60 };
        const p2 = { x: slot.x, y: slot.y - 40 };
        const p3 = { x: slot.x, y: slot.y };
        e.path = { p0, p1, p2, p3 };
        e.pathDur = 1.4;
        e.mode = "returning";
        e.modeT = 0;
        e.angle = 0;
      }
    } else if (e.mode === "returning") {
      const t = clamp(e.modeT / e.pathDur, 0, 1);
      const p = bezier(e.path.p0, e.path.p1, e.path.p2, e.path.p3, t);
      e.x = p.x; e.y = p.y;
      if (t >= 1) {
        e.mode = "formation";
        e.modeT = 0;
        e.angle = 0;
      }
    } else if (e.mode === "dying") {
      // Already exploding visually; particles handle the FX.
    }
  }

  function loseLifeFinal() {
    // After capture, respawn ship if lives remain.
    if (lives <= 0) {
      state = "game-over";
      sfx.gameOver();
      if (hiscore > 0) try { localStorage.setItem(HISCORE_KEY, String(hiscore)); } catch (_) {}
      return;
    }
    player = newPlayer();
  }

  // ---------- Collisions ----------
  function collide() {
    // Player bullets vs enemies
    for (const b of bullets) {
      for (const e of enemies) {
        if (e.mode === "dying" || e.mode === "intro") continue;
        const dx = b.x - e.x;
        const dy = b.y - e.y;
        const r = e.kind === "boss" ? 16 : 12;
        if (dx * dx + dy * dy < r * r) {
          b.y = -999;
          e.hp -= 1;
          if (e.hp <= 0) {
            killEnemy(e);
          } else {
            sfx.hit();
          }
          break;
        }
      }
    }
    // Enemy bullets vs player
    if (player && player.alive && !player.capturing) {
      for (const b of enemyBullets) {
        const dx = b.x - player.x;
        const dy = b.y - player.y;
        if (dx * dx + dy * dy < 11 * 11) {
          b.y = H + 999;
          killPlayer();
          break;
        }
      }
      // Enemy body vs player
      for (const e of enemies) {
        if (e.mode !== "attack" && e.mode !== "returning") continue;
        const dx = e.x - player.x;
        const dy = e.y - player.y;
        if (dx * dx + dy * dy < 18 * 18) {
          killEnemy(e);
          killPlayer();
          break;
        }
      }
    }
  }

  function killEnemy(e) {
    const wasAttacking = e.mode === "attack" || e.mode === "tractor" || e.mode === "returning";
    let pts;
    if (e.kind === "bee") pts = wasAttacking ? POINTS.beeDive : POINTS.bee;
    else if (e.kind === "butterfly") pts = wasAttacking ? POINTS.butterflyDive : POINTS.butterfly;
    else pts = wasAttacking ? POINTS.bossDive : POINTS.boss;
    addScore(pts);
    const color = e.kind === "bee" ? "#c89968" : e.kind === "butterfly" ? "#e64545" : "#33cc66";
    explode(e.x, e.y, color, e.kind === "boss" ? 28 : 18);
    // Was this the boss carrying our captured ship? Rescue!
    if (e.carriesPlayer && capturedShip && capturedShip.bossId === e.id) {
      addScore(1000); // bonus
      capturedShip = null;
      sfx.rescue();
      // If a player ship is currently on the field, dual-up.
      if (player && player.alive) {
        player.dual = true;
      } else {
        // Keep dual flag for next respawn? Simplest: grant on next spawn via sentinel.
        pendingDualOnRespawn = true;
      }
    }
    e.mode = "dying";
    e.modeT = 0;
  }
  let pendingDualOnRespawn = false;

  function killPlayer() {
    if (!player || !player.alive) return;
    explode(player.x, player.y, "#fff", 26);
    player.alive = false;
    player.respawnAt = RESPAWN_DELAY;
    player.dual = false;
    lives -= 1;
    if (lives <= 0) {
      // Defer state change; player.respawnAt countdown handles it.
    }
  }

  // ---------- Drawing ----------
  function draw() {
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, W, H);
    // Stars
    for (const s of stars) {
      ctx.fillStyle = `rgba(255,255,255,${s.b})`;
      ctx.fillRect(s.x | 0, s.y | 0, 1, 2);
    }
    // Tractor beams (behind enemies)
    for (const e of enemies) if (e.mode === "tractor") drawBeam(e);
    // Enemies
    for (const e of enemies) drawEnemy(e);
    // Bullets
    ctx.fillStyle = "#fff";
    for (const b of bullets) ctx.fillRect((b.x | 0) - 1, (b.y | 0) - 6, 2, 8);
    ctx.fillStyle = "#ffe14d";
    for (const b of enemyBullets) ctx.fillRect((b.x | 0) - 2, (b.y | 0) - 4, 4, 8);
    // Particles
    for (const p of particles) {
      const a = 1 - p.t / p.life;
      ctx.fillStyle = p.color;
      ctx.globalAlpha = Math.max(0, a);
      ctx.fillRect((p.x | 0) - 1, (p.y | 0) - 1, 3, 3);
    }
    ctx.globalAlpha = 1;
    // Player
    if (player && player.alive) drawShip(player.x, player.y, player.dual, player.capturing);
    // HUD
    drawHud();
    // Overlays
    if (state === "title") drawTitle();
    if (state === "game-over") drawGameOver();
    if (state === "wave-clear") drawStageBanner();
  }

  function drawHud() {
    ctx.fillStyle = "#fff";
    ctx.font = "bold 14px monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("1UP", 20, 8);
    ctx.fillStyle = "#e64545";
    ctx.fillText(String(score).padStart(6, "0"), 20, 24);
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.fillText("HIGH SCORE", W / 2, 8);
    ctx.fillStyle = "#e64545";
    ctx.fillText(String(hiscore).padStart(6, "0"), W / 2, 24);
    ctx.textAlign = "right";
    ctx.fillStyle = "#fff";
    ctx.fillText(`STAGE ${stage}`, W - 20, 8);
    // Lives icons (bottom-left)
    for (let i = 0; i < lives; i++) {
      drawShipIcon(20 + i * 22, H - 20);
    }
  }

  function drawTitle() {
    ctx.fillStyle = "rgba(0,0,0,0.4)";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#e64545";
    ctx.font = "bold 56px monospace";
    ctx.textAlign = "center";
    ctx.fillText("GALAGA", W / 2, H / 2 - 40);
    ctx.fillStyle = "#fff";
    ctx.font = "bold 14px monospace";
    ctx.fillText("S & N WEDDING EDITION", W / 2, H / 2);
    ctx.fillStyle = "#ffe14d";
    ctx.font = "14px monospace";
    const blink = (Math.sin(performance.now() / 300) > 0);
    if (blink) ctx.fillText("PRESS SPACE / TAP TO START", W / 2, H / 2 + 60);
    ctx.fillStyle = "#888";
    ctx.font = "11px monospace";
    ctx.fillText("← → MOVE      SPACE FIRE      ESC CLOSE", W / 2, H - 40);
  }

  function drawGameOver() {
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = "#e64545";
    ctx.font = "bold 36px monospace";
    ctx.textAlign = "center";
    ctx.fillText("GAME OVER", W / 2, H / 2 - 30);
    ctx.fillStyle = "#fff";
    ctx.font = "14px monospace";
    ctx.fillText(`SCORE  ${String(score).padStart(6, "0")}`, W / 2, H / 2 + 10);
    ctx.fillText(`HI     ${String(hiscore).padStart(6, "0")}`, W / 2, H / 2 + 28);
    ctx.fillStyle = "#ffe14d";
    const blink = (Math.sin(performance.now() / 300) > 0);
    if (blink) ctx.fillText("PRESS R / TAP TO RESTART", W / 2, H / 2 + 70);
  }

  function drawStageBanner() {
    ctx.fillStyle = "#fff";
    ctx.font = "bold 22px monospace";
    ctx.textAlign = "center";
    ctx.fillText(`STAGE ${stage + 1}`, W / 2, H / 2);
  }

  function drawShip(x, y, dual, capturing) {
    if (capturing) {
      // Slight tilt + tint while being lifted.
      ctx.save();
      ctx.globalAlpha = 0.75;
    }
    drawShipBody(x, y);
    if (dual) drawShipBody(x - 28, y);
    if (capturing) ctx.restore();
  }
  function drawShipBody(x, y) {
    ctx.fillStyle = "#fff";
    // Wings
    ctx.fillRect(x - 14, y + 4, 28, 6);
    // Body triangle
    ctx.beginPath();
    ctx.moveTo(x, y - 12);
    ctx.lineTo(x - 10, y + 6);
    ctx.lineTo(x + 10, y + 6);
    ctx.closePath();
    ctx.fill();
    // Cockpit
    ctx.fillStyle = "#67d4ff";
    ctx.fillRect(x - 2, y - 4, 4, 6);
  }
  function drawShipIcon(x, y) {
    ctx.fillStyle = "#fff";
    ctx.fillRect(x - 8, y + 1, 16, 3);
    ctx.beginPath();
    ctx.moveTo(x, y - 6);
    ctx.lineTo(x - 6, y + 3);
    ctx.lineTo(x + 6, y + 3);
    ctx.closePath();
    ctx.fill();
  }

  function drawEnemy(e) {
    if (e.mode === "intro" && e.modeT < 0) return;
    if (e.mode === "dying") {
      // Particle ring already rendered by particle pass.
      return;
    }
    ctx.save();
    ctx.translate(e.x, e.y);
    // Ellies stay upright while diving — they're not insects, and a
    // cartwheeling dog looks chaotic on swoop paths.
    if (e.kind !== "bee" && e.angle) ctx.rotate(e.angle);
    if (e.kind === "bee") drawEllie(e.modeT);
    else if (e.kind === "butterfly") drawButterfly(e.modeT);
    else drawBoss(e);
    ctx.restore();
  }

  // Pixel-art Ellie (the Carfagno dog). Tan body, dark face mask,
  // perky ears, white muzzle, wagging tail.
  function drawEllie(t) {
    const wag = Math.sin(t * 9) * 2;
    const TAN = "#c89968";
    const TAN_SHADOW = "#a87a4a";
    const DARK = "#3d2818";
    const DARKER = "#241410";
    const WHITE = "#f5e8d0";
    // Tail (wagging)
    ctx.fillStyle = TAN;
    ctx.fillRect(9, 1, 3 + wag, 3);
    // Body
    ctx.fillStyle = TAN;
    ctx.fillRect(-9, -1, 18, 8);
    // Body shadow under
    ctx.fillStyle = TAN_SHADOW;
    ctx.fillRect(-9, 6, 18, 2);
    // Stubby legs
    ctx.fillStyle = TAN_SHADOW;
    ctx.fillRect(-7, 7, 3, 3);
    ctx.fillRect(-1, 7, 3, 3);
    ctx.fillRect(5, 7, 3, 3);
    // Head: tan base
    ctx.fillStyle = TAN;
    ctx.fillRect(-7, -9, 14, 8);
    // Dark mask across forehead/eyes
    ctx.fillStyle = DARK;
    ctx.fillRect(-7, -9, 14, 4);
    // Ears (dark, perky)
    ctx.fillStyle = DARKER;
    ctx.beginPath();
    ctx.moveTo(-8, -10); ctx.lineTo(-6, -14); ctx.lineTo(-4, -9); ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(4, -9); ctx.lineTo(6, -14); ctx.lineTo(8, -10); ctx.closePath();
    ctx.fill();
    // White muzzle stripe
    ctx.fillStyle = WHITE;
    ctx.fillRect(-3, -4, 6, 3);
    // Eyes
    ctx.fillStyle = "#000";
    ctx.fillRect(-5, -6, 2, 2);
    ctx.fillRect(3, -6, 2, 2);
    // Eye glints
    ctx.fillStyle = "#fff";
    ctx.fillRect(-4, -6, 1, 1);
    ctx.fillRect(4, -6, 1, 1);
    // Nose
    ctx.fillStyle = "#000";
    ctx.fillRect(-1, -2, 2, 2);
  }

  function drawButterfly(t) {
    const flap = Math.sin(t * 18) * 2 + 6;
    ctx.fillStyle = "#e64545";
    // left wing
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(-flap - 6, -8);
    ctx.lineTo(-flap - 6, 8);
    ctx.closePath();
    ctx.fill();
    // right wing
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(flap + 6, -8);
    ctx.lineTo(flap + 6, 8);
    ctx.closePath();
    ctx.fill();
    // body
    ctx.fillStyle = "#4a8aff";
    ctx.fillRect(-3, -8, 6, 14);
    ctx.fillStyle = "#67d4ff";
    ctx.fillRect(-2, -6, 4, 3);
  }

  function drawBoss(e) {
    const damaged = e.hp === 1;
    ctx.fillStyle = damaged ? "#7da6c9" : "#33cc66";
    ctx.fillRect(-14, -10, 28, 20);
    ctx.fillStyle = "#ffe14d";
    ctx.fillRect(-14, -10, 28, 4);
    ctx.fillRect(-14, 6,  28, 4);
    ctx.fillStyle = "#000";
    ctx.fillRect(-10, -3, 4, 4);
    ctx.fillRect(6, -3, 4, 4);
    ctx.fillStyle = "#67d4ff";
    ctx.fillRect(-9, -2, 2, 2);
    ctx.fillRect(7, -2, 2, 2);
    if (e.carriesPlayer) {
      // Captured ship hanging below the boss
      ctx.save();
      ctx.translate(0, 24);
      ctx.scale(1, -1); // mirror so it looks captured (upside down)
      drawShipBody(0, 0);
      ctx.restore();
    }
  }

  function drawBeam(e) {
    const a = e.attackBeam;
    if (a <= 0) return;
    const beamLen = H - 80 - e.y;
    const baseY = e.y + beamLen;
    const baseHalf = 130 * a;
    const grad = ctx.createLinearGradient(e.x, e.y, e.x, baseY);
    grad.addColorStop(0, "rgba(255,225,77,0.9)");
    grad.addColorStop(1, "rgba(255,225,77,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.moveTo(e.x - 12, e.y + 4);
    ctx.lineTo(e.x + 12, e.y + 4);
    ctx.lineTo(e.x + baseHalf, baseY);
    ctx.lineTo(e.x - baseHalf, baseY);
    ctx.closePath();
    ctx.fill();
    // Animated stripes
    const phase = (performance.now() / 80) % 24;
    ctx.strokeStyle = "rgba(255,255,255,0.35)";
    ctx.lineWidth = 1;
    for (let yy = phase; yy < beamLen; yy += 24) {
      const f = yy / beamLen;
      const half = lerp(12, baseHalf, f);
      ctx.beginPath();
      ctx.moveTo(e.x - half, e.y + 4 + yy);
      ctx.lineTo(e.x + half, e.y + 4 + yy);
      ctx.stroke();
    }
  }

  // ---------- Main loop ----------
  function loop(ts) {
    if (!running) return;
    const dt = Math.min(0.05, (ts - prevTs) / 1000 || 0);
    prevTs = ts;
    if (!paused) update(dt);
    draw();
    rafId = requestAnimationFrame(loop);
  }

  // ---------- State transitions ----------
  function startNewGame() {
    score = 0;
    lives = 3;
    stage = 0;
    nextExtraAt = POINTS_PER_LIFE;
    capturedShip = null;
    pendingDualOnRespawn = false;
    bullets = []; enemyBullets = []; particles = [];
    player = newPlayer();
    startStage(1);
  }
  function startStage(n) {
    stage = n;
    state = "playing";
    stateTimer = 0;
    attackerTimer = 1.6;
    spawnFormation();
    if (player && !player.alive) player = newPlayer();
    if (pendingDualOnRespawn && player) { player.dual = true; pendingDualOnRespawn = false; }
  }

  // ---------- Input ----------
  function onKeyDown(e) {
    if (!running) return;
    switch (e.key) {
      case "ArrowLeft": case "a": case "A": keys.left = true; e.preventDefault(); break;
      case "ArrowRight": case "d": case "D": keys.right = true; e.preventDefault(); break;
      case " ": case "Spacebar":
        e.preventDefault();
        if (state === "title") startNewGame();
        else { keys.fire = true; fireDownEdge = true; }
        break;
      case "r": case "R":
        if (state === "game-over") startNewGame();
        break;
      case "p": case "P":
        if (state === "playing") paused = !paused;
        break;
      case "m": case "M":
        toggleMute();
        break;
      case "Escape":
        close();
        break;
    }
  }
  function onKeyUp(e) {
    if (e.key === "ArrowLeft" || e.key === "a" || e.key === "A") keys.left = false;
    if (e.key === "ArrowRight" || e.key === "d" || e.key === "D") keys.right = false;
    if (e.key === " " || e.key === "Spacebar") keys.fire = false;
  }

  function canvasPosFromTouch(t) {
    const r = canvas.getBoundingClientRect();
    const x = ((t.clientX - r.left) / r.width) * W;
    const y = ((t.clientY - r.top) / r.height) * H;
    return { x, y };
  }

  function onTouchStart(e) {
    ensureAudio();
    if (state === "title") { startNewGame(); e.preventDefault(); return; }
    if (state === "game-over") { startNewGame(); e.preventDefault(); return; }
    const t = e.changedTouches[0];
    const p = canvasPosFromTouch(t);
    touch.active = true;
    touch.x = p.x;
    e.preventDefault();
  }
  function onTouchMove(e) {
    if (!touch.active) return;
    const t = e.changedTouches[0];
    const p = canvasPosFromTouch(t);
    touch.x = p.x;
    e.preventDefault();
  }
  function onTouchEnd(e) {
    touch.active = false;
    e.preventDefault();
  }

  function onFireDown(e) {
    ensureAudio();
    if (state === "title") { startNewGame(); e.preventDefault(); return; }
    if (state === "game-over") { startNewGame(); e.preventDefault(); return; }
    touch.fire = true;
    fireDownEdge = true;
    e.preventDefault();
  }
  function onFireUp(e) { touch.fire = false; e.preventDefault(); }

  function onClickFirstGesture() { ensureAudio(); }

  function toggleMute() {
    muted = !muted;
    if (muteBtn) muteBtn.textContent = muted ? "🔇" : "🔊";
  }

  // ---------- Boot / teardown ----------
  function bootCanvas() {
    canvas = document.getElementById("galagaCanvas");
    ctx = canvas.getContext("2d");
    overlay = document.getElementById("galagaOverlay");
    closeBtn = document.getElementById("galagaClose");
    muteBtn = document.getElementById("galagaMute");
    fireBtn = document.getElementById("galagaFire");
    // Show touch fire button on coarse pointers (phones/tablets).
    const isTouch = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
    if (isTouch) overlay.classList.add("is-touch");
  }

  function attachInput() {
    window.addEventListener("keydown", onKeyDown, { passive: false });
    window.addEventListener("keyup", onKeyUp, { passive: false });
    canvas.addEventListener("touchstart", onTouchStart, { passive: false });
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });
    canvas.addEventListener("touchend", onTouchEnd, { passive: false });
    canvas.addEventListener("touchcancel", onTouchEnd, { passive: false });
    canvas.addEventListener("mousedown", onClickFirstGesture);
    closeBtn.addEventListener("click", close);
    muteBtn.addEventListener("click", () => { ensureAudio(); toggleMute(); });
    fireBtn.addEventListener("touchstart", onFireDown, { passive: false });
    fireBtn.addEventListener("touchend", onFireUp, { passive: false });
    fireBtn.addEventListener("mousedown", onFireDown);
    fireBtn.addEventListener("mouseup", onFireUp);
  }
  function detachInput() {
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    canvas.removeEventListener("touchstart", onTouchStart);
    canvas.removeEventListener("touchmove", onTouchMove);
    canvas.removeEventListener("touchend", onTouchEnd);
    canvas.removeEventListener("touchcancel", onTouchEnd);
    canvas.removeEventListener("mousedown", onClickFirstGesture);
    closeBtn.removeEventListener("click", close);
    fireBtn.removeEventListener("touchstart", onFireDown);
    fireBtn.removeEventListener("touchend", onFireUp);
    fireBtn.removeEventListener("mousedown", onFireDown);
    fireBtn.removeEventListener("mouseup", onFireUp);
  }

  function close() {
    if (!running) return;
    running = false;
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    detachInput();
    overlay.hidden = true;
    overlay.classList.remove("is-touch");
    if (audioCtx) {
      try { audioCtx.close(); } catch (_) {}
      audioCtx = null;
    }
    keys.left = keys.right = keys.fire = false;
    touch.active = false; touch.fire = false;
  }

  // Public entry.
  window.startGalaga = function startGalaga() {
    if (running) return;
    bootCanvas();
    overlay.hidden = false;
    try { hiscore = Number(localStorage.getItem(HISCORE_KEY) || "0") || 0; } catch (_) { hiscore = 0; }
    initStars();
    score = 0;
    state = "title";
    bullets = []; enemyBullets = []; particles = []; enemies = [];
    player = newPlayer();
    paused = false;
    attachInput();
    running = true;
    prevTs = performance.now();
    rafId = requestAnimationFrame(loop);
  };
})();
