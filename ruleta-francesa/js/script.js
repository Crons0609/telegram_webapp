// Ruleta Francesa - Física realista con casillas doradas (mejorada)
// Reemplaza tu js/script.js con este archivo
(function() {
  'use strict';

  const CONFIG = {
    SALDO_INICIAL: 1000,

    // fricción angular (rueda y bola)
    FRICCION_RULETA: 0.997,
    FRICCION_BOLA: 0.992,

    // velocidades / impulsos (tuneables)
    VEL_MIN: 0.02,               // umbral para considerar detenido
    IMPULSO_RULETA: 20,
    IMPULSO_BOLA_FACTOR: 1.6,    // factor relativo a la rueda (bola sale contrario)
    IMPULSO_BOLA_RANDOM: 6,      // ruido aleatorio inicial

    // rebotes
    REBOTE_PERDIDA: 0.55,
    REBOTE_VARIACION: 0.28,
    REBOTE_ANGULAR_UMBRAL: 0.15,

    // radial behaviour (radio de la bola)
    BALL_R_MAX_RATIO: 0.97,      // radio relativo al canvas (cuando está arriba, cerca del borde)
    BALL_R_MIN_RATIO: 0.54,      // radio cuando cae cerca de pockets
    LAUNCH_RADIUS_MULT: 1.05,     // la bolita empieza un poco fuera del anillo para lanzarse
    RADIAL_LERP_BASE: 0.02,      // velocidad base para interpolación radial (mayor = más rápido)
    RADIAL_ACCEL_FACTOR: 3.5,    // acelera la caída cuando la energía baja

    // estabilidad/umbral
    STALL_SPEED: 1.8,            // velocidad angular por debajo de la cual la bola ya no se sostiene en el carril
    LAUNCH_DELAY: 700,

    // ruido por frame
    ANGULAR_NOISE: 0.005,

    PAGOS: { pleno: 35, rojo: 1, negro: 1, par: 1, impar: 1, pasa: 1, falta: 1 }
  };

  const State = {
    saldo: CONFIG.SALDO_INICIAL,
    apuestaMonto: 10,
    apuestas: [],
    spinning: false,

    // rueda
    wheelAngle: 0,
    // bola: usamos coordenadas polares
    ballAngle: 0,               // ángulo polar absoluto en el lienzo
    ballAngularSpeed: 0,        // velocidad angular (rad/s)
    ballRadius: 0,              // radio actual (px)
    ballLanzada: false,

    numeros: [
      {num:0,color:'green'}, {num:32,color:'red'}, {num:15,color:'black'}, {num:19,color:'red'},
      {num:4,color:'black'}, {num:21,color:'red'}, {num:2,color:'black'}, {num:25,color:'red'},
      {num:17,color:'black'}, {num:34,color:'red'}, {num:6,color:'black'}, {num:27,color:'red'},
      {num:13,color:'black'}, {num:36,color:'red'}, {num:11,color:'black'}, {num:30,color:'red'},
      {num:8,color:'black'}, {num:23,color:'red'}, {num:10,color:'black'}, {num:5,color:'red'},
      {num:24,color:'black'}, {num:16,color:'red'}, {num:33,color:'black'}, {num:1,color:'red'},
      {num:20,color:'black'}, {num:14,color:'red'}, {num:31,color:'black'}, {num:9,color:'red'},
      {num:22,color:'black'}, {num:18,color:'red'}, {num:29,color:'black'}, {num:7,color:'red'},
      {num:28,color:'black'}, {num:12,color:'red'}, {num:35,color:'black'}, {num:3,color:'red'},
      {num:26,color:'black'}
    ]
  };

  const $ = s => document.querySelector(s);
  const $$ = s => document.querySelectorAll(s);
  const saldoEl = $('#saldo');
  const resultadoEl = $('#resultado');
  const montoInput = $('#montoApuesta');
  const canvas = $('#canvasRuleta');
  const bola = $('.ball');
  const dispensador = $('#ballDispenser');
  const dispenserLight = $('.dispenser-light');
  const dispenserBall = $('.dispenser-ball');

  let ctx, width, height, cx, cy, radius, slice;
  let animFrame = null;
  let launchTimer = null;
  let lastSector = null;

  const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
  const randRange = (a,b) => a + Math.random() * (b-a);
  const vibrate = ms => window.navigator?.vibrate?.(ms);

  function initCanvas() {
    if (!canvas) return;
    ctx = canvas.getContext('2d');
    const rect = canvas.getBoundingClientRect();
    width = rect.width;
    height = rect.height;
    canvas.width = width * devicePixelRatio;
    canvas.height = height * devicePixelRatio;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    cx = width / 2;
    cy = height / 2;
    radius = Math.min(cx, cy) * 0.9;
    slice = (2 * Math.PI) / State.numeros.length;
    drawWheel();
  }

  function drawWheel() {
    if (!ctx || width === 0) return;
    ctx.clearRect(0, 0, width, height);
    const r = radius;
    const labelR = r * 0.7;
    const fontSize = Math.max(12, r * 0.09);
    // barrier ring (muestra el perímetro por donde orbitan las bolas)
    const barrier = r * CONFIG.BALL_R_MAX_RATIO;
    ctx.beginPath();
    ctx.arc(cx, cy, barrier, 0, 2*Math.PI);
    ctx.strokeStyle = 'rgba(255,255,255,0.3)';
    ctx.lineWidth = 3;
    ctx.setLineDash([6,6]);
    ctx.stroke();
    ctx.setLineDash([]);

    // determine current sector under ball for highlight when spinning
    const currIndex = (State.spinning && State.ballLanzada) ? sectorBajoBola() : -1;
    State.numeros.forEach((item, i) => {
      const start = State.wheelAngle + i * slice;
      const end = start + slice;

      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r-2, start, end);
      ctx.closePath();
      ctx.fillStyle = item.color === 'red' ? '#b30000' : item.color === 'black' ? '#0b0b0b' : '#0a7d2c';
      ctx.fill();

      // Borde dorado para cada sector (más grueso)
      ctx.strokeStyle = '#d4af37';
      ctx.lineWidth = 2.5;
      ctx.stroke();

      // highlight active segment
      if (i === currIndex) {
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.lineWidth = 6;
        ctx.stroke();
      }

      const mid = start + slice/2;
      const lx = cx + Math.cos(mid) * labelR;
      const ly = cy + Math.sin(mid) * labelR;

      // Fondo circular dorado para el número
      ctx.save();
      ctx.translate(lx, ly);
      ctx.beginPath();
      ctx.arc(0, 0, fontSize * 0.7, 0, 2*Math.PI);
      ctx.fillStyle = '#d4af37';
      ctx.shadowColor = '#000';
      ctx.shadowBlur = 8;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#000';
      ctx.font = `bold ${fontSize}px 'Montserrat'`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(item.num, 0, 0);
      ctx.restore();
    });

    // Centro metálico
    const centerR = r * 0.12;
    ctx.beginPath();
    ctx.arc(cx, cy, centerR, 0, 2*Math.PI);
    const grad = ctx.createRadialGradient(cx-4, cy-4, 4, cx, cy, centerR);
    grad.addColorStop(0, '#ffd966');
    grad.addColorStop(0.7, '#b8860b');
    grad.addColorStop(1, '#8b6508');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = '#00000080';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Torreta en forma de cruz
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(State.wheelAngle);
    ctx.strokeStyle = '#d4af37';
    ctx.lineWidth = 4;
    ctx.shadowColor = '#000';
    ctx.shadowBlur = 8;
    ctx.beginPath();
    ctx.moveTo(-centerR*1.5, 0);
    ctx.lineTo(centerR*1.5, 0);
    ctx.moveTo(0, -centerR*1.5);
    ctx.lineTo(0, centerR*1.5);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, centerR*0.6, 0, 2*Math.PI);
    ctx.fillStyle = '#d4af37';
    ctx.fill();
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }

  // convierte ángulo a [0, 2π)
  function normAngle(a) {
    const TWO = Math.PI * 2;
    a %= TWO;
    if (a < 0) a += TWO;
    return a;
  }

  // actualiza la posición absoluta de la bola en DOM usando ballRadius y ballAngle
  function actualizarPosicionBola() {
    if (!bola || !canvas) return;
    const rect = canvas.getBoundingClientRect();
    const cxB = rect.width / 2;
    const cyB = rect.height / 2;
    const x = cxB + Math.cos(State.ballAngle) * State.ballRadius;
    const y = cyB + Math.sin(State.ballAngle) * State.ballRadius;
    bola.style.transform = `translate(${x - 14}px, ${y - 14}px)`; // compensar tamaño bola 28px
  }

  function actualizarLuzDispensador() {
    if (!dispenserLight) return;
    if (State.apuestas.length > 0 && !State.spinning) {
      dispenserLight.classList.add('active');
    } else {
      dispenserLight.classList.remove('active');
    }
  }

  function animateSaldo() {
    if (!saldoEl) return;
    const card = saldoEl.closest('.saldo-card');
    if (!card) return;
    card.classList.add('pulse');
    setTimeout(() => card.classList.remove('pulse'), 450);
  }

  function lanzarAnimacionDispensador() {
    if (!dispenserBall) return;
    dispenserBall.classList.add('launch');
    setTimeout(() => {
      dispenserBall.classList.remove('launch');
    }, 400);
  }

  // Apuestas (igual que antes)
  function initFichas() {
    $$('.ficha').forEach(btn => {
      btn.addEventListener('click', () => {
        const val = parseInt(btn.dataset.valor, 10);
        if (val > 0) {
          State.apuestaMonto = val;
          if (montoInput) montoInput.value = val;
          // visual selection
          $$('.ficha').forEach(f => f.classList.remove('selected'));
          btn.classList.add('selected');
        }
      });
    });
  }

  function limpiarSeleccionEspecial() {
    $$('.apuesta').forEach(btn => btn.setAttribute('aria-pressed', 'false'));
  }
  function limpiarSeleccionNumeros() {
    $$('#numerosPleno button').forEach(btn => btn.setAttribute('aria-pressed', 'false'));
  }

  function initApuestasEspeciales() {
    $$('.apuesta').forEach(btn => {
      btn.addEventListener('click', () => {
        const tipo = btn.dataset.tipo;
        if (btn.getAttribute('aria-pressed') === 'true') {
          btn.setAttribute('aria-pressed', 'false');
          State.apuestas = State.apuestas.filter(a => a.tipo !== tipo);
          State.saldo += State.apuestaMonto;
        } else {
          limpiarSeleccionEspecial();
          btn.setAttribute('aria-pressed', 'true');
          State.apuestas.push({ tipo, monto: State.apuestaMonto });
          State.saldo -= State.apuestaMonto;
        }
        saldoEl.textContent = State.saldo;
        animateSaldo();
        actualizarLuzDispensador();
        vibrate(15);
      });
    });
  }

  function initNumerosPlenos() {
    const grid = $('#numerosPleno');
    if (!grid) return;
    grid.innerHTML = '';
    State.numeros.forEach(s => {
      const btn = document.createElement('button');
      btn.textContent = s.num;
      btn.dataset.numero = s.num;
      btn.addEventListener('click', () => {
        const num = s.num;
        if (btn.getAttribute('aria-pressed') === 'true') {
          btn.setAttribute('aria-pressed', 'false');
          State.apuestas = State.apuestas.filter(a => !(a.tipo === 'pleno' && a.numero === num));
          State.saldo += State.apuestaMonto;
        } else {
          limpiarSeleccionNumeros();
          btn.setAttribute('aria-pressed', 'true');
          State.apuestas.push({ tipo: 'pleno', numero: num, monto: State.apuestaMonto });
          State.saldo -= State.apuestaMonto;
        }
        saldoEl.textContent = State.saldo;
        animateSaldo();
        actualizarLuzDispensador();
        vibrate(15);
      });
      grid.appendChild(btn);
    });
  }

  function calcularGanancias(num, color) {
    let total = 0;
    State.apuestas.forEach(ap => {
      const { tipo, monto, numero } = ap;
      if (tipo === 'pleno' && numero === num) total += monto * 35 + monto;
      else if (tipo === 'rojo' && color === 'red') total += monto * 1 + monto;
      else if (tipo === 'negro' && color === 'black') total += monto * 1 + monto;
      else if (tipo === 'par' && num !== 0 && num % 2 === 0) total += monto * 1 + monto;
      else if (tipo === 'impar' && num !== 0 && num % 2 === 1) total += monto * 1 + monto;
      else if (tipo === 'pasa' && num >= 19 && num <= 36) total += monto * 1 + monto;
      else if (tipo === 'falta' && num >= 1 && num <= 18) total += monto * 1 + monto;
    });
    return total;
  }

  function limpiarApuestas() {
    State.apuestas = [];
    limpiarSeleccionEspecial();
    limpiarSeleccionNumeros();
    actualizarLuzDispensador();
  }

  // Determina el índice de sector bajo la bola considerando la rotación de la rueda
  function sectorBajoBola() {
    // relativo = ángulo de la bola relativo a la rueda
    const relative = normAngle(State.ballAngle - State.wheelAngle);
    const idx = Math.floor(relative / slice) % State.numeros.length;
    return idx;
  }

  // Inicia giro con física mejorada (bola radial dinámica)
  function iniciarGiro() {
    if (State.spinning) return;
    if (State.apuestas.length === 0) {
      resultadoEl.textContent = '¡Haz una apuesta!';
      vibrate(30);
      return;
    }

    State.spinning = true;
    State.ballLanzada = false;
    // visual indicators
    setSpinningVisual(true);
    $('#ruletaCard').classList.add('is-spinning');
    resultadoEl.textContent = 'Girando ruleta...';
    vibrate(30);
    actualizarLuzDispensador();

    // velocidades iniciales
    let wheelSpeed = CONFIG.IMPULSO_RULETA;
    let ballAngularSpeed = 0;

    State.wheelAngle = Math.random() * 2 * Math.PI;
    // calculamos orientación del dispensador para que la bola salga dirigida al centro
    let dispenserAngle = calculateDispenserAngleToCenter();
    State.ballAngle = dispenserAngle; // la bola comienza orientada desde el dispensador hacia el centro
    // visible más tarde
    bola.style.display = 'none';

    // radios máximos y mínimos (en px)
    const rMax = Math.min(width, height) / 2 * CONFIG.BALL_R_MAX_RATIO;
    const rMin = Math.min(width, height) / 2 * CONFIG.BALL_R_MIN_RATIO;
    // para el lanzamiento inicial se coloca fuera del anillo y cae hacia rMax
    const launchR = rMax * CONFIG.LAUNCH_RADIUS_MULT;
    State.ballRadius = launchR;

    let lastTime = null;

    function finalizar() {
      if (launchTimer) clearTimeout(launchTimer);
      cancelAnimationFrame(animFrame);
      animFrame = null;

      // elegir sector usando la posición final de la bola relativa a la rueda
      const sectorIdx = sectorBajoBola();
      const ganador = State.numeros[sectorIdx];
      const ganancia = calcularGanancias(ganador.num, ganador.color);
      State.saldo += ganancia;
      saldoEl.textContent = State.saldo;
      animateSaldo();
      resultadoEl.textContent = `Resultado: ${ganador.num} (${ganador.color==='red'?'Rojo':ganador.color==='black'?'Negro':'Verde'})`;
      limpiarApuestas();

      $('#ruletaCard').classList.remove('is-spinning');
      $('#ruletaCard').classList.add('win');
      setTimeout(() => $('#ruletaCard').classList.remove('win'), 400);
      vibrate(50);

      State.spinning = false;
      State.ballLanzada = false;
      bola.style.display = 'none';
      drawWheel();
      actualizarLuzDispensador();
      // trigger celebration effects
      sparkResultado();
      showConfetti(60);
      setSpinningVisual(false);
    }

    function animate(ts) {
      if (!lastTime) lastTime = ts;
      const dt = Math.min(0.05, (ts - lastTime) / 1000);
      lastTime = ts;

      // decaimiento rueda
      wheelSpeed *= Math.pow(CONFIG.FRICCION_RULETA, dt * 60);
      if (Math.abs(wheelSpeed) < CONFIG.VEL_MIN) wheelSpeed = 0;
      State.wheelAngle += wheelSpeed * dt;
      State.wheelAngle = normAngle(State.wheelAngle);

      // lanzamiento de la bola en el tiempo configurado
      if (State.ballLanzada) {
        // fricción angular bola
        ballAngularSpeed *= Math.pow(CONFIG.FRICCION_BOLA, dt * 60);

        // pequeño ruido (perturbaciones constantes)
        ballAngularSpeed += (Math.random() - 0.5) * CONFIG.ANGULAR_NOISE;

        if (Math.abs(ballAngularSpeed) < CONFIG.VEL_MIN) ballAngularSpeed = 0;

        // actualizar ángulo
        State.ballAngle += ballAngularSpeed * dt;
        State.ballAngle = normAngle(State.ballAngle);

        // --- RADIO dinámico: depende de "energía" (velocidad angular)
        const speedAbs = Math.abs(ballAngularSpeed);
        // estabilidad s: 0 = sin energía (cae), 1 = totalmente estable en el borde
        const s = clamp((speedAbs - CONFIG.STALL_SPEED) / Math.max(0.0001, (Math.abs(CONFIG.IMPULSO_RULETA) * CONFIG.IMPULSO_BOLA_FACTOR) - CONFIG.STALL_SPEED), 0, 1);
        const targetRadius = rMin + s * (rMax - rMin);

        // la interpolación se acelera cuando s baja (caída más brusca al final)
        const radialLerp = CONFIG.RADIAL_LERP_BASE * (1 + (1 - s) * CONFIG.RADIAL_ACCEL_FACTOR);
        // aplicamos interpolación suave hacia el objetivo interno
        State.ballRadius += (targetRadius - State.ballRadius) * radialLerp * (dt * 60);
        // si la bola estaba fuera del perímetro, la empujamos hacia rMax lentamente
        if (State.ballRadius > rMax) {
          State.ballRadius -= (State.ballRadius - rMax) * 0.1 * (dt * 60);
        }
        // limitamos a un rango razonable (permite pequeños sobresaltos exteriores)
        State.ballRadius = clamp(State.ballRadius, rMin, rMax * CONFIG.LAUNCH_RADIUS_MULT);

        // rebote al cruzar separadores (sector boundaries)
        const prevSector = lastSector !== null ? lastSector : Math.floor((State.ballAngle - ballAngularSpeed * dt) / slice);
        const currSector = Math.floor(State.ballAngle / slice);
        if (currSector !== prevSector) {
          lastSector = currSector;
          if (Math.abs(ballAngularSpeed) > CONFIG.REBOTE_ANGULAR_UMBRAL) {
            // invertir con pérdida (simula impacto con los deflectores)
            ballAngularSpeed *= -CONFIG.REBOTE_PERDIDA;
            ballAngularSpeed += (Math.random() - 0.5) * CONFIG.REBOTE_VARIACION;
            // un pequeño empuje radial (la bola suele separarse un poco)
            State.ballRadius += (Math.random() - 0.6) * (rMax * 0.02);
            State.ballRadius = clamp(State.ballRadius, rMin, rMax + rMax*0.02);

            // al rebotar se pierde algo de energía de la ruleta también (pequeña interacción)
            // (desacelera la rueda levemente)
            // nota: wheelSpeed puede ser 0
            // aplicamos un pequeño efecto si la rueda está girando
            if (Math.abs(wheelSpeed) > 0.01) {
              wheelSpeed *= 0.99;
            }
            vibrate(8);
            spawnSpark();
          }
        }
      }

      // dibujado
      drawWheel();
      if (State.ballLanzada) {
        actualizarPosicionBola();
      }

      // condición de parada: rueda casi parada y bola casi parada y la bola ya muy dentro (cerca de pockets)
      const pocketRadius = rMin + (rMax - rMin) * 0.18; // criterio: cuando ya está bien dentro
      if (Math.abs(wheelSpeed) < CONFIG.VEL_MIN &&
          (!State.ballLanzada || Math.abs(ballAngularSpeed) < CONFIG.VEL_MIN) &&
          State.ballRadius <= pocketRadius + 0.5) {
        finalizar();
        return;
      }

      animFrame = requestAnimationFrame(animate);
    }

    // Lanzamiento: calculamos la velocidad angular inicial de la bola para que vaya en sentido contrario
    launchTimer = setTimeout(() => {
      if (State.spinning) {
        // la bola sale en sentido contrario a la rueda
        State.ballLanzada = true;
        bola.style.display = 'block';
        lanzarAnimacionDispensador();

        // si wheelSpeed fuese 0, damos un impulso por defecto
        if (Math.abs(wheelSpeed) < 0.1) wheelSpeed = CONFIG.IMPULSO_RULETA;

        // ballAngularSpeed: contrario a la rueda, magnitud proporcional + ruido
        const sign = wheelSpeed >= 0 ? -1 : 1;
        State.ballAngularSpeed = sign * Math.abs(wheelSpeed) * CONFIG.IMPULSO_BOLA_FACTOR + randRange(-CONFIG.IMPULSO_BOLA_RANDOM, CONFIG.IMPULSO_BOLA_RANDOM);

        resultadoEl.textContent = '¡Bola lanzada!';
        vibrate(20);

        // partirá desde fuera del perímetro y caerá hacia el anillo del borde
        const rMaxLocal = Math.min(width, height) / 2 * CONFIG.BALL_R_MAX_RATIO;
        State.ballRadius = rMaxLocal * CONFIG.LAUNCH_RADIUS_MULT;
        // actualizar posición visual inmediata
        actualizarPosicionBola();
      }
    }, CONFIG.LAUNCH_DELAY);

    animFrame = requestAnimationFrame(animate);
  }

  // calcula el ángulo desde el dispensador hacia el centro del canvas
  function calculateDispenserAngleToCenter() {
    try {
      const dRect = dispensador.getBoundingClientRect();
      const cRect = canvas.getBoundingClientRect();
      // centro del dispensador
      const dx = (cRect.left + cRect.width/2) - (dRect.left + dRect.width/2);
      const dy = (cRect.top + cRect.height/2) - (dRect.top + dRect.height/2);
      return Math.atan2(dy, dx);
    } catch (e) {
      // fallback: arriba a la derecha hacia el centro
      return Math.atan2( (cy - 0), (cx - (width * 0.9)) );
    }
  }

  // visual utility helpers
  function setSpinningVisual(active) {
    const card = $('#ruletaCard');
    if (!card) return;
    if (active) card.classList.add('spinning');
    else card.classList.remove('spinning');
  }

  function showConfetti(count) {
    const colors = ['#ff4d4d','#4d79ff','#ffff4d','#4dff88','#ff4dff'];
    for (let i = 0; i < count; i++) {
      const c = document.createElement('div');
      c.className = 'confetti';
      c.style.background = colors[Math.floor(Math.random()*colors.length)];
      c.style.left = Math.random() * window.innerWidth + 'px';
      c.style.top = '-10px';
      c.style.transform = `rotate(${Math.random()*360}deg)`;
      document.body.appendChild(c);
      // remove after animation
      c.addEventListener('animationend', () => c.remove());
    }
  }

  function sparkResultado() {
    if (!resultadoEl) return;
    resultadoEl.classList.add('sparkle');
    setTimeout(() => resultadoEl.classList.remove('sparkle'), 700);
  }

  function spawnSpark() {
    const rect = canvas.getBoundingClientRect();
    const x = rect.left + rect.width/2 + Math.cos(State.ballAngle) * State.ballRadius - 3;
    const y = rect.top + rect.height/2 + Math.sin(State.ballAngle) * State.ballRadius - 3;
    const s = document.createElement('div');
    s.className = 'spark';
    s.style.left = x + 'px';
    s.style.top = y + 'px';
    document.body.appendChild(s);
    s.addEventListener('animationend', () => s.remove());
  }

  // Eventos del dispensador
  if (dispensador) {
    dispensador.addEventListener('click', iniciarGiro);
    dispensador.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        iniciarGiro();
      }
    });
  }

  // Swipe opcional
  function initSwipe() {
    let startX = 0, startT = 0;
    canvas.addEventListener('touchstart', e => {
      startX = e.touches[0].clientX;
      startT = performance.now();
    }, { passive: true });
    canvas.addEventListener('touchend', e => {
      if (!e.changedTouches[0] || State.spinning) return;
      const dx = e.changedTouches[0].clientX - startX;
      const dt = (performance.now() - startT) / 1000;
      if (Math.abs(dx) > 30 && dt < 0.5) {
        iniciarGiro();
      }
    });
  }

  // Orientación
  function initOrientation() {
    const lock = $('#orientationLock');
    const mq = window.matchMedia('(orientation: portrait)');
    const handler = e => {
      if (e.matches) {
        lock.hidden = false;
        if (dispensador) dispensador.classList.add('disabled');
      } else {
        lock.hidden = true;
        if (dispensador) dispensador.classList.remove('disabled');
        setTimeout(() => { initCanvas(); drawWheel(); }, 100);
      }
    };
    // old browsers fallback
    if (mq.addEventListener) mq.addEventListener('change', handler);
    else mq.addListener(handler);
    handler(mq);
  }

  // Inicialización
  window.addEventListener('load', () => {
    initCanvas();
    initFichas();
    initApuestasEspeciales();
    initNumerosPlenos();
    initSwipe();
    initOrientation();
    $('#anio').textContent = new Date().getFullYear();
    drawWheel();
    actualizarLuzDispensador();

    // API de prueba desde consola
    window.ruleta = {
      spin: iniciarGiro,
      forceNumber: num => {
        const idx = State.numeros.findIndex(s => s.num === num);
        if (idx !== -1) {
          // posicionar rueda y bola para mostrar número (útil para testing)
          State.wheelAngle = Math.random() * 2 * Math.PI;
          State.ballAngle = State.wheelAngle + idx * slice + slice/2;
          State.ballRadius = Math.min(width, height) / 2 * CONFIG.BALL_R_MIN_RATIO;
          State.ballLanzada = false;
          actualizarPosicionBola();
          drawWheel();
        }
      }
    };
  });

  window.addEventListener('resize', () => {
    initCanvas();
    if (State.ballLanzada) actualizarPosicionBola();
  });
})();