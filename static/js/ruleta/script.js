/**
 * RULETA FRANCESA — Motor Premium v2
 * Física realista, dispensador de bola, sonido Web Audio, iluminación, micro-impact.
 */
(function () {
  'use strict';

  // ─── NÚMEROS OFICIALES (orden real de la rueda francesa) ──────────────────
  const WHEEL_NUMBERS = [
    { n: 0, color: 'green' },
    { n: 32, color: 'red' }, { n: 15, color: 'black' },
    { n: 19, color: 'red' }, { n: 4, color: 'black' },
    { n: 21, color: 'red' }, { n: 2, color: 'black' },
    { n: 25, color: 'red' }, { n: 17, color: 'black' },
    { n: 34, color: 'red' }, { n: 6, color: 'black' },
    { n: 27, color: 'red' }, { n: 13, color: 'black' },
    { n: 36, color: 'red' }, { n: 11, color: 'black' },
    { n: 30, color: 'red' }, { n: 8, color: 'black' },
    { n: 23, color: 'red' }, { n: 10, color: 'black' },
    { n: 5, color: 'red' }, { n: 24, color: 'black' },
    { n: 16, color: 'red' }, { n: 33, color: 'black' },
    { n: 1, color: 'red' }, { n: 20, color: 'black' },
    { n: 14, color: 'red' }, { n: 31, color: 'black' },
    { n: 9, color: 'red' }, { n: 22, color: 'black' },
    { n: 18, color: 'red' }, { n: 29, color: 'black' },
    { n: 7, color: 'red' }, { n: 28, color: 'black' },
    { n: 12, color: 'red' }, { n: 35, color: 'black' },
    { n: 3, color: 'red' }, { n: 26, color: 'black' },
  ];

  const N = WHEEL_NUMBERS.length;
  const TWO_PI = Math.PI * 2;
  const SLICE = TWO_PI / N;

  // ─── ESTADO ───────────────────────────────────────────────────────────────
  const S = {
    saldo: window.USER_BITS > 0 ? window.USER_BITS : 1000,
    apuestaMonto: 10,
    apuestas: [],
    spinning: false,
    wheelAngle: 0,
    wheelSpeed: 0,
    ballAngle: 0,
    ballRadius: 0,
    ballSpeed: 0,
    ballActive: false,
    ballSettled: false,
    ballTrail: [],
    resultIndex: -1,
    history: [],
    // Dispensador
    dispenserAngle: -Math.PI / 2, // posición fija en la parte superior (12 en punto)
    dispenserFire: false,        // true durante la animación de lanzamiento
    dispenserT: 0,            // progreso de la animación 0→1
    // Vibración de impacto
    shakeX: 0, shakeY: 0,
  };

  // ─── DOM / Canvas ─────────────────────────────────────────────────────────
  let canvas, ctx, saldoEl, resultadoEl, historyEl, spinBtn;
  let W = 0, H = 0, CX = 0, CY = 0, ROUT = 0;
  let animId = null;
  let lastTime = 0;
  // Performance: reduce trail on low-power devices
  const LOW_POWER = (navigator.hardwareConcurrency || 4) <= 2;

  // ─── WEB AUDIO ────────────────────────────────────────────────────────────
  let audioCtx = null;
  function getAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
  }

  function playTone(freq, type = 'sine', duration = 0.12, gain = 0.15, delay = 0) {
    try {
      const ac = getAudio();
      const osc = ac.createOscillator();
      const g = ac.createGain();
      osc.connect(g);
      g.connect(ac.destination);
      osc.type = type;
      osc.frequency.setValueAtTime(freq, ac.currentTime + delay);
      g.gain.setValueAtTime(0, ac.currentTime + delay);
      g.gain.linearRampToValueAtTime(gain, ac.currentTime + delay + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + delay + duration);
      osc.start(ac.currentTime + delay);
      osc.stop(ac.currentTime + delay + duration + 0.01);
    } catch (e) { /* silencioso si el usuario no interactuó */ }
  }

  // Sonido de giro continuo (ruido filtrado)
  let spinNoiseNode = null, spinGainNode = null;
  function startSpinSound() {
    try {
      if (window.CasinoAudio) {
        window.CasinoAudio.playBGM('roulette_spin');
      }
    } catch (e) { }
  }

  function stopSpinSound() {
    try {
      if (window.CasinoAudio) window.CasinoAudio.playBGM(null); // Stop bgm
    } catch (e) { }
  }

  function playBounce() {
    if (window.CasinoAudio) window.CasinoAudio.playSfx('chip_drop', { volume: 0.3 });
  }

  function playLand() {
    if (window.CasinoAudio) window.CasinoAudio.playSfx('roulette_stop');
  }

  // ─── INIT ─────────────────────────────────────────────────────────────────
  window.addEventListener('DOMContentLoaded', () => {
    canvas = document.getElementById('ruletaCanvas');
    saldoEl = document.getElementById('saldo');
    resultadoEl = document.getElementById('resultado');
    historyEl = document.getElementById('historyList');
    spinBtn = document.getElementById('spinBtn');
    if (!canvas) return;
    ctx = canvas.getContext('2d');

    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('orientationchange', () => setTimeout(resize, 300));

    buildBettingUI();
    updateBitsDisplay(S.saldo); // ← Initialize the panel HUD on load
    drawAll();

    spinBtn.addEventListener('click', handleSpin);
    document.getElementById('repeatBet').addEventListener('click', repeatBet);
    document.getElementById('doubleBet').addEventListener('click', doubleBet);

    const anioEl = document.getElementById('anio');
    if (anioEl) anioEl.textContent = new Date().getFullYear();
  });

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const wrap = canvas.parentElement;

    // El tamaño base lo dicta el contenedor CSS (rlt-canvas-wrap)
    let size = wrap.clientWidth;

    size = Math.max(size, 180); // absolute minimum

    // Removemos el sobre-dimensionamiento inline manual
    canvas.style.width = '';
    canvas.style.height = '';

    canvas.width = size * dpr;
    canvas.height = size * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    W = H = size; CX = CY = size / 2;
    ROUT = CX * 0.96;
    if (!S.spinning) drawAll();
  }

  // ─── DIBUJO PRINCIPAL ─────────────────────────────────────────────────────
  function drawAll() {
    ctx.save();
    // Micro-shake al impacto
    if (S.shakeX || S.shakeY) ctx.translate(S.shakeX, S.shakeY);
    ctx.clearRect(-8, -8, W + 16, H + 16);
    drawWheelOuter();
    drawWheelSectors();
    drawFrets();
    drawCenter();
    drawLighting();
    drawDispenser();
    if (S.ballActive) drawBall();
    ctx.restore();
  }

  // ─── BORDE EXTERIOR Y MADERA ──────────────────────────────────────────────
  function drawWheelOuter() {
    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 35;
    ctx.beginPath(); ctx.arc(CX, CY, ROUT, 0, TWO_PI);
    ctx.fillStyle = '#1a0a00'; ctx.fill();
    ctx.restore();

    // Aro de madera con vetas (Premium Dark Wood)
    const wr = ctx.createRadialGradient(CX, CY, ROUT * 0.88, CX, CY, ROUT);
    wr.addColorStop(0, '#3a1f0b');
    wr.addColorStop(0.4, '#241205');
    wr.addColorStop(0.8, '#140802');
    wr.addColorStop(1, '#050200');
    ctx.beginPath(); ctx.arc(CX, CY, ROUT, 0, TWO_PI);
    ctx.fillStyle = wr; ctx.fill();

    // Anillo dorado externo
    ctx.beginPath(); ctx.arc(CX, CY, ROUT, 0, TWO_PI);
    ctx.strokeStyle = '#a68233'; ctx.lineWidth = 3; ctx.stroke();

    // Anillo dorado interno (borde de pista)
    ctx.beginPath(); ctx.arc(CX, CY, ROUT * 0.905, 0, TWO_PI);
    ctx.strokeStyle = '#d4af37'; ctx.lineWidth = 1.5; ctx.stroke();
  }

  // ─── SECTORES Y NÚMEROS ───────────────────────────────────────────────────
  function drawWheelSectors() {
    const rInner = ROUT * 0.40;
    const rOuter = ROUT * 0.89;

    WHEEL_NUMBERS.forEach((item, i) => {
      const start = S.wheelAngle + i * SLICE;
      const end = start + SLICE;

      ctx.beginPath();
      ctx.moveTo(CX + Math.cos(start) * rInner, CY + Math.sin(start) * rInner);
      ctx.arc(CX, CY, rOuter, start, end);
      ctx.arc(CX, CY, rInner, end, start, true);
      ctx.closePath();

      const fill = item.color === 'green' ? '#0a6e1e'
        : item.color === 'red' ? '#c0001c'
          : '#0d0d0d';
      ctx.fillStyle = fill;
      ctx.fill();

      // Separador metálico
      ctx.beginPath();
      ctx.moveTo(CX + Math.cos(start) * rInner, CY + Math.sin(start) * rInner);
      ctx.lineTo(CX + Math.cos(start) * rOuter, CY + Math.sin(start) * rOuter);
      ctx.strokeStyle = '#c8a400'; ctx.lineWidth = 1.4; ctx.stroke();

      // Highlight de sector ganador (Soft Golden Focal Light)
      if (S.ballSettled && S.resultIndex === i) {
        // En lugar de sobreposición plana, un gradiente radial dorado intenso
        const highlightGrad = ctx.createRadialGradient(CX, CY, rInner, CX, CY, rOuter);
        highlightGrad.addColorStop(0, 'rgba(212, 175, 55, 0.4)');
        highlightGrad.addColorStop(1, 'rgba(212, 175, 55, 0)');
        ctx.beginPath();
        ctx.moveTo(CX + Math.cos(start) * rInner, CY + Math.sin(start) * rInner);
        ctx.arc(CX, CY, rOuter, start, end);
        ctx.arc(CX, CY, rInner, end, start, true);
        ctx.closePath();
        ctx.fillStyle = highlightGrad;
        ctx.fill();
      }

      // Número
      const mid = start + SLICE / 2;
      const labelR = (rInner + rOuter) / 2;
      ctx.save();
      ctx.translate(CX + Math.cos(mid) * labelR, CY + Math.sin(mid) * labelR);
      ctx.rotate(mid + Math.PI / 2);
      const fs = Math.max(8, ROUT * 0.044);
      ctx.font = `bold ${fs}px 'Montserrat', sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 5;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(item.n, 0, 0);
      ctx.restore();
    });
  }

  // ─── PISTA DE LA BOLA (FRETS) ─────────────────────────────────────────────
  function drawFrets() {
    // Pista exterior (bola corre aquí)
    ctx.beginPath(); ctx.arc(CX, CY, ROUT * 0.90, 0, TWO_PI);
    ctx.strokeStyle = 'rgba(212,175,55,0.35)'; ctx.lineWidth = 2; ctx.stroke();

    // Diamantes (bumpers) distribuidos — cilindros metálicos que causan rebote
    const bumperR = ROUT * 0.905;
    const bumperN = 8;
    for (let i = 0; i < bumperN; i++) {
      const a = S.wheelAngle + (i / bumperN) * TWO_PI;
      const bx = CX + Math.cos(a) * bumperR;
      const by = CY + Math.sin(a) * bumperR;
      const br = Math.max(3, ROUT * 0.022);
      const bg = ctx.createRadialGradient(bx - br * 0.3, by - br * 0.3, 1, bx, by, br);
      bg.addColorStop(0, '#f0e080');
      bg.addColorStop(1, '#7a5c00');
      ctx.beginPath(); ctx.arc(bx, by, br, 0, TWO_PI);
      ctx.fillStyle = bg; ctx.fill();
      ctx.strokeStyle = '#d4af37'; ctx.lineWidth = 1; ctx.stroke();
    }
  }

  // ─── COPA CENTRAL ─────────────────────────────────────────────────────────
  function drawCenter() {
    const rc = ROUT * 0.37;
    // Fondo cónico
    const cg = ctx.createRadialGradient(CX - rc * 0.3, CY - rc * 0.3, rc * 0.05, CX, CY, rc);
    cg.addColorStop(0, '#8a5500');
    cg.addColorStop(0.5, '#4a2e00');
    cg.addColorStop(1, '#1a0a00');
    ctx.beginPath(); ctx.arc(CX, CY, rc, 0, TWO_PI);
    ctx.fillStyle = cg; ctx.fill();
    ctx.strokeStyle = '#d4af37'; ctx.lineWidth = 3; ctx.stroke();

    // 8 perlas giratorias en la copa
    for (let i = 0; i < 8; i++) {
      const a = S.wheelAngle + (i / 8) * TWO_PI;
      const dr = rc * 0.72;
      const px = CX + Math.cos(a) * dr;
      const py = CY + Math.sin(a) * dr;
      const pr = rc * 0.07;
      const pg = ctx.createRadialGradient(px - pr * 0.3, py - pr * 0.3, 1, px, py, pr);
      pg.addColorStop(0, '#ffe070');
      pg.addColorStop(1, '#7a5000');
      ctx.beginPath(); ctx.arc(px, py, pr, 0, TWO_PI);
      ctx.fillStyle = pg; ctx.fill();
    }

    // Cono central (botón)
    const btnR = rc * 0.22;
    const bg = ctx.createRadialGradient(CX - btnR * 0.4, CY - btnR * 0.4, 1, CX, CY, btnR);
    bg.addColorStop(0, '#f0d060'); bg.addColorStop(1, '#6a4800');
    ctx.beginPath(); ctx.arc(CX, CY, btnR, 0, TWO_PI);
    ctx.fillStyle = bg; ctx.fill();
    ctx.strokeStyle = '#c8a400'; ctx.lineWidth = 2; ctx.stroke();
  }

  // ─── ILUMINACIÓN AMBIENTAL ────────────────────────────────────────────────
  function drawLighting() {
    // Cinematic Rotating Spotlight effect
    const lightAngle = S.spinning ? (performance.now() / 2000) % TWO_PI : 0;
    const lx = CX + Math.cos(lightAngle) * (ROUT * 0.3);
    const ly = CY + Math.sin(lightAngle) * (ROUT * 0.3);

    const lgr = ctx.createRadialGradient(lx, ly, 0, CX, CY, ROUT);
    lgr.addColorStop(0, 'rgba(255, 255, 255, 0.1)');
    lgr.addColorStop(0.5, 'rgba(212, 175, 55, 0.03)');
    lgr.addColorStop(1, 'rgba(0, 0, 0, 0.45)');
    ctx.beginPath(); ctx.arc(CX, CY, ROUT, 0, TWO_PI);
    ctx.fillStyle = lgr; ctx.fill();

    // Sombra interior profunda de la pared de madera (Depth)
    ctx.beginPath(); ctx.arc(CX, CY, ROUT, 0, TWO_PI);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
    ctx.lineWidth = ROUT * 0.08;
    ctx.stroke();
  }

  // ─── DISPENSADOR DE BOLA ──────────────────────────────────────────────────
  function drawDispenser() {
    // El dispensador está fijo en la parte superior del borde exterior (12 en punto)
    const da = S.dispenserAngle; // -PI/2 = arriba
    const dispenserCenterR = ROUT * 1.0;
    const dx = CX + Math.cos(da) * dispenserCenterR;
    const dy = CY + Math.sin(da) * dispenserCenterR;

    ctx.save();
    ctx.translate(dx, dy);
    ctx.rotate(da + Math.PI / 2);

    const armW = ROUT * 0.06;
    const armH = ROUT * 0.14;
    const baseW = ROUT * 0.09;
    const baseH = ROUT * 0.05;

    // Base del dispensador (se mantiene en el reborde)
    const baseGrad = ctx.createLinearGradient(-baseW / 2, 0, baseW / 2, 0);
    baseGrad.addColorStop(0, '#4a4a4a');
    baseGrad.addColorStop(0.5, '#a0a0a0');
    baseGrad.addColorStop(1, '#4a4a4a');
    ctx.beginPath();
    ctx.roundRect(-baseW / 2, -baseH, baseW, baseH, 3);
    ctx.fillStyle = baseGrad;
    ctx.fill();
    ctx.strokeStyle = '#c8a400'; ctx.lineWidth = 1; ctx.stroke();

    // Brazo del dispensador — se eleva ligeramente durante el disparo
    const armLift = S.dispenserFire ? -armH * 0.3 * Math.sin(S.dispenserT * Math.PI) : 0;
    const armGrad = ctx.createLinearGradient(-armW / 2, 0, armW / 2, 0);
    armGrad.addColorStop(0, '#5a5a5a');
    armGrad.addColorStop(0.5, '#cccccc');
    armGrad.addColorStop(1, '#5a5a5a');
    ctx.beginPath();
    ctx.roundRect(-armW / 2, armLift - armH, armW, armH, 4);
    ctx.fillStyle = armGrad;
    ctx.fill();
    ctx.strokeStyle = '#d4af37'; ctx.lineWidth = 1; ctx.stroke();

    // Cabezal del dispensador (porta-bola)
    const headR = armW * 0.65;
    const headY = armLift - armH;
    const headGrad = ctx.createRadialGradient(-headR * 0.3, headY - headR * 0.3, 1, 0, headY, headR);
    headGrad.addColorStop(0, '#e0e0e0');
    headGrad.addColorStop(1, '#606060');
    ctx.beginPath(); ctx.arc(0, headY, headR, 0, TWO_PI);
    ctx.fillStyle = headGrad; ctx.fill();
    ctx.strokeStyle = '#d4af37'; ctx.lineWidth = 1; ctx.stroke();

    // Bola en el dispensador (antes de lanzar)
    if (S.dispenserFire && S.dispenserT < 0.5) {
      const br = Math.max(4, ROUT * 0.032);
      const ballT = S.dispenserT / 0.5;
      const ballY = headY - (armH * 0.5 * ballT);
      const bGrad = ctx.createRadialGradient(-br * 0.35, ballY - br * 0.35, 1, 0, ballY, br);
      bGrad.addColorStop(0, '#ffffff');
      bGrad.addColorStop(0.5, '#e0e0e0');
      bGrad.addColorStop(1, '#999999');
      ctx.beginPath(); ctx.arc(0, ballY, br, 0, TWO_PI);
      ctx.fillStyle = bGrad; ctx.fill();
    }

    ctx.restore();
  }

  // ─── BOLA ─────────────────────────────────────────────────────────────────
  function drawBall() {
    const bx = CX + Math.cos(S.ballAngle) * S.ballRadius;
    const by = CY + Math.sin(S.ballAngle) * S.ballRadius;
    const br = Math.max(5, ROUT * 0.036);

    ctx.save();

    // Trail de velocidad (motion blur)
    if (S.ballTrail && S.ballTrail.length > 0 && Math.abs(S.ballSpeed) > 0.5) {
      ctx.beginPath();
      ctx.moveTo(S.ballTrail[0].x, S.ballTrail[0].y);
      for (let i = 1; i < S.ballTrail.length; i++) {
        ctx.lineTo(S.ballTrail[i].x, S.ballTrail[i].y);
      }
      ctx.lineTo(bx, by);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
      ctx.lineWidth = br * 1.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      if (!LOW_POWER) ctx.filter = 'blur(3px)'; // skip expensive blur on low-power
      ctx.stroke();
      ctx.filter = 'none';
    }

    // Dibujar Sombra Abajo de la Bola
    ctx.beginPath(); ctx.arc(bx - br * 0.2, by + br * 0.4, br, 0, TWO_PI);
    ctx.fillStyle = 'rgba(0, 0, 0, 0.6)'; ctx.fill();

    // Dibujar Bola Principal Blanca Intensa
    ctx.shadowColor = 'rgba(255,255,255,0.4)'; ctx.shadowBlur = 8;
    const bGrad = ctx.createRadialGradient(bx - br * 0.3, by - br * 0.3, br * 0.1, bx, by, br);
    bGrad.addColorStop(0, '#ffffff');
    bGrad.addColorStop(0.4, '#f0f0f0');
    bGrad.addColorStop(0.8, '#cccccc');
    bGrad.addColorStop(1, '#888888');
    ctx.beginPath(); ctx.arc(bx, by, br, 0, TWO_PI);
    ctx.fillStyle = bGrad; ctx.fill();

    // Brillo especular agudo
    ctx.beginPath(); ctx.arc(bx - br * 0.35, by - br * 0.35, br * 0.15, 0, TWO_PI);
    ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.fill();
    ctx.restore();
  }

  // ─── FÍSICA MEJORADA ──────────────────────────────────────────────────────
  const PHY = {
    // Rueda
    WHEEL_IMPULSE: 14 + Math.random() * 6,   // rad/s
    WHEEL_FRICTION: 0.9965,                    // por frame @ 60fps
    // Bola
    BALL_START_FACTOR: 1.6,     // bola gira 1.6× más rápido que la rueda, sentido opuesto
    BALL_FRICTION_HI: 0.9920,  // fricción cuando está en la pista exterior
    BALL_FRICTION_LO: 0.9960,  // fricción más suave cuando está bajando
    BALL_RADIAL_BASE: 0.008,   // caída radial base (px/frame)
    BALL_RADIAL_ACCEL: 0.0025,  // aceleración de caída según velocidad perdida
    BOUNCE_ENERGY: 0.25,    // energía recuperada en cada rebote (0–1)
    N_BOUNCES: 3,       // máximo 3 rebotes naturales
    VEL_SETTLE: 0.12,    // vel angular mínima para asentarse
  };

  let bounceCount = 0;
  let pendingResult = -1; // resultado calculado antes de que la bola se asiente

  function startPhysics() {
    if (animId) { cancelAnimationFrame(animId); animId = null; }

    const wheelDir = Math.random() > 0.5 ? 1 : -1;
    S.wheelSpeed = PHY.WHEEL_IMPULSE * wheelDir;
    S.wheelAngle = Math.random() * TWO_PI;

    S.ballRadius = ROUT * 0.905;
    S.ballAngle = S.dispenserAngle; // la bola sale desde el dispensador
    S.ballSpeed = -wheelDir * Math.abs(S.wheelSpeed) * PHY.BALL_START_FACTOR;
    S.ballActive = true;
    S.ballSettled = false;
    S.resultIndex = -1;
    bounceCount = 0;
    lastTime = performance.now();

    // Animar dispensador
    S.dispenserFire = true;
    S.dispenserT = 0;

    startSpinSound();

    // Pre-calcular resultado para sincronizar con la animación
    pendingResult = Math.floor(Math.random() * N);

    // UI State Triggers
    const wrap = canvas.parentElement;
    if (wrap) wrap.classList.add('is-spinning');
    const main = document.querySelector('.rlt-main');
    if (main) main.classList.remove('is-result');

    function tick(now) {
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;

      // ── Dispensador ───────────────────────────────────────────────────────
      if (S.dispenserFire) {
        S.dispenserT += dt * 2.5;
        if (S.dispenserT >= 1) { S.dispenserFire = false; S.dispenserT = 0; }
      }

      // Track last positions for Trail
      const tbx = CX + Math.cos(S.ballAngle) * S.ballRadius;
      const tby = CY + Math.sin(S.ballAngle) * S.ballRadius;
      S.ballTrail.push({ x: tbx, y: tby });
      const maxTrail = LOW_POWER ? 3 : 7;
      if (S.ballTrail.length > maxTrail) S.ballTrail.shift();

      // ── Rueda ─────────────────────────────────────────────────────────────
      S.wheelSpeed *= Math.pow(PHY.WHEEL_FRICTION, dt * 60);
      S.wheelAngle = (S.wheelAngle + S.wheelSpeed * dt + TWO_PI) % TWO_PI;

      // ── Bola — fricción variable según zona ───────────────────────────────
      const inOuterTrack = S.ballRadius > ROUT * 0.86;
      const friction = inOuterTrack ? PHY.BALL_FRICTION_HI : PHY.BALL_FRICTION_LO;
      S.ballSpeed *= Math.pow(friction, dt * 60);
      S.ballAngle = (S.ballAngle + S.ballSpeed * dt + TWO_PI) % TWO_PI;

      // ── Caída radial ──────────────────────────────────────────────────────
      const absVel = Math.abs(S.ballSpeed);
      const impulso = PHY.BALL_RADIAL_BASE + PHY.BALL_RADIAL_ACCEL * (7 - Math.min(absVel, 7));
      S.ballRadius -= impulso * dt * 60;

      const rPocket = ROUT * 0.50;
      const rBumperIn = ROUT * 0.905;

      // ── Rebotes contra bumpers ────────────────────────────────────────────
      if (S.ballRadius > rBumperIn - ROUT * 0.01) {
        S.ballRadius = rBumperIn - ROUT * 0.01;
      }

      // Rebote natural en el anillo de casillas
      if (S.ballRadius < rPocket + ROUT * 0.06 && bounceCount < PHY.N_BOUNCES && !S.ballSettled) {
        if (Math.random() < 0.4) {
          bounceCount++;
          S.ballRadius += ROUT * 0.06 * PHY.BOUNCE_ENERGY * (1 - bounceCount / PHY.N_BOUNCES);
          S.ballSpeed *= -(0.6 - bounceCount * 0.12);
          playBounce();
        }
      }

      // ── Asentamiento ─────────────────────────────────────────────────────
      const shouldSettle = S.ballRadius <= rPocket || absVel < PHY.VEL_SETTLE;
      if (shouldSettle && !S.ballSettled) {
        S.ballRadius = rPocket;
        S.ballSettled = true;
        S.ballSpeed = 0;

        // Sincronizar resultado con la posición real
        const relative = ((S.ballAngle - S.wheelAngle) % TWO_PI + TWO_PI) % TWO_PI;
        S.resultIndex = Math.floor(relative / SLICE) % N;

        // Centrar en la casilla
        const targetAngle = S.wheelAngle + (S.resultIndex + 0.5) * SLICE;
        S.ballAngle = targetAngle;

        stopSpinSound();
        playLand();
        triggerShake();
        drawAll();
        finalize();
        return;
      }

      drawAll();
      animId = requestAnimationFrame(tick);
    }

    animId = requestAnimationFrame(tick);
  }

  // ─── VIBRACIÓN EN IMPACTO ─────────────────────────────────────────────────
  function triggerShake() {
    let t = 0;
    const duration = 400; // ms
    const strength = 4;
    const start = performance.now();

    function shakeFrame(now) {
      t = (now - start) / duration;
      if (t >= 1) { S.shakeX = 0; S.shakeY = 0; drawAll(); return; }
      const decay = 1 - t;
      S.shakeX = (Math.random() - 0.5) * strength * decay * 2;
      S.shakeY = (Math.random() - 0.5) * strength * decay * 2;
      drawAll();
      requestAnimationFrame(shakeFrame);
    }
    requestAnimationFrame(shakeFrame);
  }

  // ─── RESULTADO ────────────────────────────────────────────────────────────
  async function finalize() {
    const winner = WHEEL_NUMBERS[S.resultIndex];
    const colorLabel = winner.color === 'red' ? 'Rojo' : winner.color === 'black' ? 'Negro' : 'Verde';
    resultadoEl.textContent = `${winner.n} — ${colorLabel}`;
    resultadoEl.dataset.color = winner.color;

    S.history.unshift(winner.n);
    if (S.history.length > 12) S.history.pop();
    renderHistory();

    let ganancia = 0;
    S.apuestas.forEach(ap => {
      if (ap.tipo === 'pleno' && ap.numero === winner.n) ganancia += ap.monto * 35 + ap.monto;
      else if (ap.tipo === 'rojo' && winner.color === 'red') ganancia += ap.monto * 2;
      else if (ap.tipo === 'negro' && winner.color === 'black') ganancia += ap.monto * 2;
      else if (ap.tipo === 'par' && winner.n % 2 === 0 && winner.n !== 0) ganancia += ap.monto * 2;
      else if (ap.tipo === 'impar' && winner.n % 2 === 1) ganancia += ap.monto * 2;
      else if (ap.tipo === 'pasa' && winner.n >= 19) ganancia += ap.monto * 2;
      else if (ap.tipo === 'falta' && winner.n >= 1 && winner.n <= 18) ganancia += ap.monto * 2;
    });

    clearBets();

    if (ganancia > 0) {
      try {
        const multiplier = total > 0 ? (ganancia / total) : 1;
        const res = await fetch('/win', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cantidad: Math.floor(ganancia), source: 'ruleta', multiplier: multiplier }) });
        const data = await res.json();
        if (data.status === 'ok') { S.saldo = data.bits; updateSaldoUI(); if (window.USER_DATA) window.USER_DATA.bits = data.bits; }
      } catch (e) { console.error(e); }
      resultadoEl.textContent += ` ✨ +${ganancia}`;
      resultadoEl.classList.add('win-flash');
      setTimeout(() => resultadoEl.classList.remove('win-flash'), 1400);

      if (window.CasinoAudio) {
        if (ganancia >= total * 30) window.CasinoAudio.playSfx('win_big');
        else window.CasinoAudio.playSfx('win_normal');
      }

      showConfetti();
    } else {
      if (window.CasinoAudio) window.CasinoAudio.playSfx('lose');
    }

    S.spinning = false;
    spinBtn.disabled = false;
    spinBtn.textContent = '🎡 Girar';

    // UI State Triggers
    const wrap = canvas.parentElement;
    if (wrap) wrap.classList.remove('is-spinning');
    const main = document.querySelector('.rlt-main');
    if (main) main.classList.add('is-result');
  }

  // ─── APUESTAS ─────────────────────────────────────────────────────────────
  function getTotalApuesta() {
    return S.apuestas.reduce((s, a) => s + a.monto, 0);
  }

  function clearBets() {
    S.apuestas = [];
    document.querySelectorAll('.apuesta-btn.active, .num-btn.active').forEach(b => b.classList.remove('active'));
    renderBetPot();
  }

  function addBet(tipo, monto, numero) {
    // Toggle logic: remove if already exists, otherwise add
    if (tipo === 'pleno') {
      const idx = S.apuestas.findIndex(a => a.tipo === 'pleno' && a.numero === numero);
      if (idx >= 0) { S.apuestas.splice(idx, 1); return false; }
    } else {
      const idx = S.apuestas.findIndex(a => a.tipo === tipo);
      if (idx >= 0) { S.apuestas.splice(idx, 1); return false; }
    }
    S.apuestas.push({ tipo, monto, numero });
    return true;
  }

  // Helper: attach both click AND touchend (prevents 300ms delay on mobile)
  function onTap(el, fn) {
    el.addEventListener('click', fn);
    el.addEventListener('touchend', (e) => { e.preventDefault(); fn(e); }, { passive: false });
  }

  // ─── CHIP / POT VISUAL ────────────────────────────────────────────────────
  const CHIP_COLORS = { 5: '#a0522d', 10: '#1a5ca8', 25: '#1a7a2f', 50: '#8b0000', 100: '#4b0082' };

  function renderBetPot() {
    const potEl = document.getElementById('rlt-pot');
    const potTotalEl = document.getElementById('rlt-pot-total');
    const potChipsEl = document.getElementById('rlt-pot-chips');
    if (!potEl) return;

    const total = getTotalApuesta();

    potTotalEl.textContent = total > 0 ? `${total} Bits` : '—';

    if (total === 0) {
      potEl.classList.remove('active');
      potChipsEl.innerHTML = '';
      return;
    }

    potEl.classList.add('active');

    // Rebuild chips display
    potChipsEl.innerHTML = '';
    S.apuestas.forEach((ap, idx) => {
      const chip = document.createElement('div');
      chip.className = 'rlt-pot-chip';
      // Use actual image asset instead of CSS circle
      chip.style.cssText = `
        background: transparent;
        border: none;
        box-shadow: 0 4px 8px rgba(0,0,0,0.6);
        left: ${8 + idx * 5}px;
        top: ${-idx * 2}px;
        animation: rlt-chip-fall 0.3s cubic-bezier(0.34,1.56,0.64,1) both;
        animation-delay: ${idx * 40}ms;
        display: flex;
        align-items: center;
        justify-content: center;
        width: 30px;
        height: 30px;
      `;
      chip.innerHTML = `<img src="/static/img/chip_${ap.monto}.png" style="width:100%; height:100%; object-fit:contain; pointer-events:none;">`;
      potChipsEl.appendChild(chip);
    });
  }

  function animateChipToPot(btn) {
    const potChipsEl = document.getElementById('rlt-pot-chips');
    if (!potChipsEl) return;

    const from = btn.getBoundingClientRect();
    const to = potChipsEl.getBoundingClientRect();

    const chip = document.createElement('div');
    chip.className = 'rlt-flying-chip';
    const monto = S.apuestaMonto;
    chip.style.cssText = `
      position: fixed;
      width: 32px; height: 32px;
      background: transparent;
      border: none;
      filter: drop-shadow(0 4px 8px rgba(0,0,0,0.6));
      display: flex; align-items: center; justify-content: center;
      pointer-events: none;
      z-index: 9999;
      left: ${from.left + from.width / 2 - 16}px;
      top: ${from.top + from.height / 2 - 16}px;
      transition: left 0.45s cubic-bezier(0.4,0,0.2,1), top 0.45s cubic-bezier(0.4,0,0.2,1), opacity 0.2s 0.35s;
    `;
    chip.innerHTML = `<img src="/static/img/chip_${monto}.png" style="width:100%; height:100%; object-fit:contain;">`;
    document.body.appendChild(chip);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        chip.style.left = `${to.left + to.width / 2 - 16}px`;
        chip.style.top = `${to.top + to.height / 2 - 16}px`;
        chip.style.opacity = '0';
        setTimeout(() => chip.remove(), 600);
      });
    });
  }

  function buildBettingUI() {
    document.querySelectorAll('.ficha-btn').forEach(btn => {
      onTap(btn, () => {
        S.apuestaMonto = parseInt(btn.dataset.valor);
        document.querySelectorAll('.ficha-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
      });
    });

    document.querySelectorAll('.apuesta-btn').forEach(btn => {
      onTap(btn, () => {
        if (S.spinning) return;
        const added = addBet(btn.dataset.tipo, S.apuestaMonto);
        btn.classList.toggle('active', S.apuestas.some(a => a.tipo === btn.dataset.tipo));
        if (added) animateChipToPot(btn);
        renderBetPot();
        updateSpinBtnLabel();
      });
    });

    const grid = document.getElementById('numerosGrid');
    if (!grid) return;
    grid.innerHTML = '';

    // Build 0–36 in order for a clean grid
    const orderedNums = [{ n: 0, color: 'green' }];
    for (let n = 1; n <= 36; n++) {
      const found = WHEEL_NUMBERS.find(w => w.n === n);
      orderedNums.push(found || { n, color: 'black' });
    }

    orderedNums.forEach(item => {
      const btn = document.createElement('button');
      btn.className = `num-btn num-${item.color}`;
      btn.textContent = item.n;
      btn.dataset.num = item.n;
      onTap(btn, () => {
        if (S.spinning) return;
        const added = addBet('pleno', S.apuestaMonto, item.n);
        btn.classList.toggle('active', S.apuestas.some(a => a.tipo === 'pleno' && a.numero === item.n));
        if (added) animateChipToPot(btn);
        renderBetPot();
        updateSpinBtnLabel();
      });
      grid.appendChild(btn);
    });

    // Passive scroll listeners on scrollable containers
    document.querySelectorAll('.rlt-numeros-grid, .rlt-bets-panel, .rlt-history-list').forEach(el => {
      el.addEventListener('touchmove', () => { }, { passive: true });
    });

    renderBetPot();
  }

  function updateSpinBtnLabel() {
    const total = getTotalApuesta();
    spinBtn.textContent = total > 0 ? `🎡 Girar (${total} Bits)` : '🎡 Girar';
    const insufficient = total > S.saldo;
    spinBtn.disabled = insufficient;
    spinBtn.style.opacity = insufficient ? '0.5' : '1';
  }

  // ─── GIRAR ────────────────────────────────────────────────────────────────
  async function handleSpin() {
    if (S.spinning) return;
    if (S.apuestas.length === 0) { flashResult('⚠️ Haz una apuesta primero'); return; }
    const total = getTotalApuesta();

    if (total > S.saldo) { flashResult('❌ Saldo insuficiente'); return; }

    try {
      spinBtn.disabled = true; spinBtn.textContent = '⏳ Apostando...';
      const res = await fetch('/bet', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cantidad: total, source: 'ruleta' }) });
      const data = await res.json();
      if (res.ok && data.status === 'ok') {
        S.saldo = data.bits; updateBitsDisplay(S.saldo); if (window.USER_DATA) window.USER_DATA.bits = data.bits;
      } else {
        flashResult(data.message || '❌ Fondos insuficientes');
        spinBtn.disabled = false; spinBtn.textContent = '🎡 Girar'; return;
      }
    } catch (e) {
      flashResult('❌ Error de red'); spinBtn.disabled = false; spinBtn.textContent = '🎡 Girar'; return;
    }

    S.spinning = true;
    resultadoEl.textContent = '🎡 Girando...'; resultadoEl.removeAttribute('data-color');
    spinBtn.textContent = '⏳ En curso...';

    S.dispenserFire = true; S.dispenserT = 0;
    setTimeout(() => startPhysics(), 600);
  }

  function repeatBet() { if (!S.spinning && S.apuestas.length === 0) flashResult('Selecciona una apuesta'); }
  function doubleBet() {
    if (!S.spinning && S.apuestas.length > 0) {
      S.apuestas.forEach(a => a.monto = Math.min(a.monto * 2, S.saldo));
      renderBetPot();
      updateSpinBtnLabel();
      flashResult('Apuesta doblada ×2');
    }
  }

  // ─── RESULTADO ────────────────────────────────────────────────────────────
  async function finalize() {
    const winner = WHEEL_NUMBERS[S.resultIndex];
    const colorLabel = winner.color === 'red' ? 'Rojo' : winner.color === 'black' ? 'Negro' : 'Verde (0)';

    S.history.unshift(winner.n);
    if (S.history.length > 12) S.history.pop();
    renderHistory();

    // ── Calculate winnings using official roulette payouts (European) ──────
    const totalApostado = getTotalApuesta(); // total wagered this spin
    let ganancia = 0;

    S.apuestas.forEach(ap => {
      const m = ap.monto;
      if (ap.tipo === 'pleno' && ap.numero === winner.n) {
        ganancia += m * 35 + m;           // 35:1 → get back 36×
      } else if (ap.tipo === 'rojo' && winner.color === 'red') {
        ganancia += m * 2;                 // 1:1 → get back 2×
      } else if (ap.tipo === 'negro' && winner.color === 'black') {
        ganancia += m * 2;
      } else if (ap.tipo === 'par' && winner.n !== 0 && winner.n % 2 === 0) {
        ganancia += m * 2;
      } else if (ap.tipo === 'impar' && winner.n % 2 === 1) {
        ganancia += m * 2;
      } else if (ap.tipo === 'pasa' && winner.n >= 19 && winner.n <= 36) {
        ganancia += m * 2;
      } else if (ap.tipo === 'falta' && winner.n >= 1 && winner.n <= 18) {
        ganancia += m * 2;
      } else if (ap.tipo === 'docena1' && winner.n >= 1 && winner.n <= 12) {
        ganancia += m * 3;                 // 2:1 → get back 3×
      } else if (ap.tipo === 'docena2' && winner.n >= 13 && winner.n <= 24) {
        ganancia += m * 3;
      } else if (ap.tipo === 'docena3' && winner.n >= 25 && winner.n <= 36) {
        ganancia += m * 3;
      } else if (ap.tipo === 'col1' && winner.n > 0 && winner.n % 3 === 1) {
        ganancia += m * 3;
      } else if (ap.tipo === 'col2' && winner.n > 0 && winner.n % 3 === 2) {
        ganancia += m * 3;
      } else if (ap.tipo === 'col3' && winner.n > 0 && winner.n % 3 === 0) {
        ganancia += m * 3;
      }
    });

    // Display result
    resultadoEl.textContent = `${winner.n} — ${colorLabel}`;
    resultadoEl.dataset.color = winner.color;

    clearBets();

    if (ganancia > 0) {
      // ── Fly chips to counter, then call backend to record win ──────────────
      flyChipsToCounter(ganancia);

      try {
        const multiplier = totalApostado > 0 ? (ganancia / totalApostado) : 1;
        const res = await fetch('/win', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cantidad: Math.floor(ganancia), source: 'ruleta', multiplier })
        });
        const data = await res.json();
        if (data.status === 'ok') {
          S.saldo = data.bits;
          if (window.USER_DATA) window.USER_DATA.bits = data.bits;
          // The count-up animation already runs; just ensure final value is accurate
          setTimeout(() => updateBitsDisplay(S.saldo), 1450);
        }
      } catch (e) { console.error(e); }

      resultadoEl.textContent += ` ✨ +${ganancia} Bits`;
      resultadoEl.classList.add('win-flash');
      setTimeout(() => resultadoEl.classList.remove('win-flash'), 1400);

      if (window.CasinoAudio) {
        if (ganancia >= totalApostado * 30) window.CasinoAudio.playSfx('win_big');
        else window.CasinoAudio.playSfx('win_normal');
      }
      showConfetti();
    } else {
      resultadoEl.textContent += ' — Sin premio';
      if (window.CasinoAudio) window.CasinoAudio.playSfx('lose');
    }

    S.spinning = false;
    spinBtn.disabled = false;
    spinBtn.textContent = '🎡 Girar';
    updateSpinBtnLabel();
  }

  // ─── UI ───────────────────────────────────────────────────────────────────
  function updateSaldoUI() {
    updateBitsDisplay(S.saldo);
  }

  /**
   * updateBitsDisplay — central sync for ALL bits displays:
   *   • #rlt-bits-display   (panel HUD, always visible)
   *   • #global-bits-display (user menu dropdown)
   *   • #saldo              (legacy fallback)
   */
  function updateBitsDisplay(amount) {
    const fmt = Math.floor(amount).toLocaleString();

    // Panel HUD
    const hudVal = document.getElementById('rlt-bits-display');
    if (hudVal) hudVal.textContent = fmt;

    // Global user-menu bits counter
    const globalEl = document.getElementById('global-bits-display');
    if (globalEl) globalEl.textContent = fmt;

    // Legacy element
    const sEl = document.getElementById('saldo');
    if (sEl) {
      sEl.textContent = fmt;
      sEl.parentElement?.classList.add('pulse');
      setTimeout(() => sEl.parentElement?.classList.remove('pulse'), 400);
    }

    updateSpinBtnLabel();
  }

  /**
   * countUpRuleta — animated number count-up on the panel HUD.
   * @param {number} startVal  value to animate from
   * @param {number} endVal    target value
   * @param {number} duration  ms duration (default 1400)
   */
  function countUpRuleta(startVal, endVal, duration = 1400) {
    const hudVal = document.getElementById('rlt-bits-display');
    const globalEl = document.getElementById('global-bits-display');
    const startTime = performance.now();

    function tick(now) {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      const current = Math.round(startVal + (endVal - startVal) * eased);
      const fmt = current.toLocaleString();

      if (hudVal) {
        hudVal.textContent = fmt;
        // Micro-pop on every 50ms
        if (Math.floor(elapsed / 50) !== Math.floor((elapsed - 16) / 50)) {
          hudVal.classList.remove('count-up');
          void hudVal.offsetWidth; // reflow
          hudVal.classList.add('count-up');
        }
      }
      if (globalEl) globalEl.textContent = fmt;

      if (progress < 1) {
        requestAnimationFrame(tick);
      } else {
        // Final accurate value
        updateBitsDisplay(endVal);
      }
    }
    requestAnimationFrame(tick);
  }

  /**
   * flyChipsToCounter — clones chips from the pot, flies them to the HUD,
   * spawns energy bursts on arrival, then runs countUpRuleta.
   * @param {number} ganancia  bits won this round
   */
  function flyChipsToCounter(ganancia) {
    const potChipsEl = document.getElementById('rlt-pot-chips');
    const hudEl = document.getElementById('rlt-bits-hud');
    const hudValEl = document.getElementById('rlt-bits-display');
    if (!hudEl || !hudValEl) {
      // No HUD? Just count up directly
      countUpRuleta(S.saldo - ganancia, S.saldo);
      return;
    }

    const hudRect = hudEl.getBoundingClientRect();
    const targetX = hudRect.left + hudRect.width / 2;
    const targetY = hudRect.top + hudRect.height / 2;

    // Gather source chip positions (from pot) or use a fallback center
    const chips = potChipsEl ? [...potChipsEl.querySelectorAll('.rlt-pot-chip')] : [];
    const CHIP_COLORS = { 5: '#a0522d', 10: '#1a5ca8', 25: '#1a7a2f', 50: '#8b0000', 100: '#4b0082' };

    const sources = chips.length > 0 ? chips : [null];
    const maxChips = Math.min(sources.length, 8);

    sources.slice(0, maxChips).forEach((chip, idx) => {
      let fromX, fromY, chipImgName;
      if (chip) {
        const r = chip.getBoundingClientRect();
        fromX = r.left + r.width / 2;
        fromY = r.top + r.height / 2;
        // Parse the image src from the html we injected earlier
        const imgEl = chip.querySelector('img');
        if (imgEl && imgEl.src.includes('chip_')) {
          const match = imgEl.src.match(/chip_(\d+)\.png/);
          chipImgName = match ? match[1] : '10';
        } else {
          chipImgName = '10';
        }
      } else {
        // Fallback: fly from pot center
        const potEl = document.getElementById('rlt-pot');
        const potRect = potEl ? potEl.getBoundingClientRect() : { left: targetX, top: targetY + 50, width: 0, height: 0 };
        fromX = potRect.left + potRect.width / 2;
        fromY = potRect.top + potRect.height / 2;
        chipImgName = '10'; // default random chip
      }

      const flyEl = document.createElement('div');
      flyEl.className = 'rlt-flying-chip-win';
      flyEl.innerHTML = `<img src="/static/img/chip_${chipImgName}.png" style="width:100%; height:100%; object-fit:contain; pointer-events:none;">`;
      flyEl.style.cssText = `
        left: ${fromX - 15}px;
        top: ${fromY - 15}px;
        background: transparent;
        border: none;
        box-shadow: none;
        filter: drop-shadow(0 4px 8px rgba(0,0,0,0.6));
      `;
      document.body.appendChild(flyEl);

      // Stagger each chip's flight
      const delay = idx * 65;
      setTimeout(() => {
        flyEl.style.left = `${targetX - 15}px`;
        flyEl.style.top = `${targetY - 15}px`;
        flyEl.style.transform = 'scale(0.4)';
        flyEl.style.opacity = '0';

        // Trigger energy burst + count-up when first chip arrives
        setTimeout(() => {
          flyEl.remove();

          // Spawn burst particles from the HUD
          for (let b = 0; b < 6; b++) {
            const burst = document.createElement('div');
            burst.className = 'rlt-energy-burst';
            const angle = (b / 6) * Math.PI * 2;
            const dist = 18 + Math.random() * 14;
            burst.style.left = `${targetX - 4}px`;
            burst.style.top = `${targetY - 4}px`;
            burst.style.setProperty('--bx', `${Math.cos(angle) * dist}px`);
            burst.style.setProperty('--by', `${Math.sin(angle) * dist}px`);
            document.body.appendChild(burst);
            burst.addEventListener('animationend', () => burst.remove());
          }

          // Kick off count-up only once (on first chip arrival)
          if (idx === 0) {
            hudEl.classList.add('pulse-glow');
            hudEl.addEventListener('animationend', () => hudEl.classList.remove('pulse-glow'), { once: true });
            countUpRuleta(S.saldo - ganancia, S.saldo, 1400);
            if (window.CasinoAudio) window.CasinoAudio.playSfx('absorb');
          }
        }, 550);
      }, delay);
    });
  }

  function flashResult(msg) {
    resultadoEl.textContent = msg;
    resultadoEl.classList.add('flash');
    setTimeout(() => resultadoEl.classList.remove('flash'), 800);
  }

  function renderHistory() {
    if (!historyEl) return;
    historyEl.innerHTML = '';
    S.history.forEach(n => {
      const item = WHEEL_NUMBERS.find(w => w.n === n);
      const span = document.createElement('span');
      span.textContent = n;
      span.className = `hist-item hist-${item ? item.color : 'green'}`;
      historyEl.appendChild(span);
    });
  }

  function showConfetti() {
    const colors = ['#ff4d4d', '#4d79ff', '#ffff4d', '#4dff88', '#ff4dff', '#d4af37'];
    for (let i = 0; i < 50; i++) {
      const el = document.createElement('div');
      el.className = 'confetti-piece';
      el.style.cssText = `background:${colors[i % colors.length]};left:${Math.random() * 100}%;top:${Math.random() * 30}%;animation-duration:${0.7 + Math.random() * 0.8}s;transform:rotate(${Math.random() * 360}deg);`;
      document.body.appendChild(el);
      el.addEventListener('animationend', () => el.remove());
    }
  }

})();