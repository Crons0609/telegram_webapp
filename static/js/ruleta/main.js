import { State, CONFIG, clamp, randRange, sectorBajoBola } from './physics.js';
import { initCanvas, drawWheel, getDimensions } from './wheel.js';
import { actualizarPosicionBola, launchBall, updateBall } from './ball.js';
import { calcularGanancias, limpiarApuestas, initApuestasEspeciales, initNumerosPlenos } from './bets.js';
import { animateSaldo, showConfetti, sparkResultado, spawnSpark, updateHistory } from './ui.js';

// DOM references
const saldoEl = document.querySelector('#saldo');
const resultadoEl = document.querySelector('#resultado');
const montoInput = document.querySelector('#montoApuesta');
const canvas = document.querySelector('#canvasRuleta');
const bola = document.querySelector('.ball');
const dispensador = document.querySelector('#ballDispenser');
let animFrame = null;
let launchTimer = null;

function actualizarLuzDispensador() {
  const light = document.querySelector('.dispenser-light');
  if (!light) return;
  if (State.apuestas.length > 0 && !State.spinning) light.classList.add('active');
  else light.classList.remove('active');
}

function initFichas() {
  document.querySelectorAll('.ficha').forEach(btn => {
    btn.addEventListener('click', () => {
      const val = parseInt(btn.dataset.valor, 10);
      if (val > 0) {
        State.apuestaMonto = val;
        if (montoInput) montoInput.value = val;
        document.querySelectorAll('.ficha').forEach(f => f.classList.remove('selected'));
        btn.classList.add('selected');
      }
    });
  });
}

async function iniciarGiro() {
  if (State.spinning) return;
  if (State.apuestas.length === 0) {
    resultadoEl.textContent = '¡Haz una apuesta!';
    return;
  }
  State.spinning = true;

  // Telegram WebApp API: Deduzca la apuesta del backend primero
  const apuestaTotal = State.apuestas.reduce((sum, ap) => sum + ap.monto, 0);

  try {
    const res = await fetch('/bet', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cantidad: apuestaTotal, source: 'ruleta' })
    });
    const data = await res.json();

    if (res.ok && data.status === 'ok') {
      State.saldo = data.bits;
      saldoEl.textContent = State.saldo;
    } else {
      window.Telegram.WebApp.showAlert(data.message || "Error procesando la apuesta.");
      State.spinning = false;
      return;
    }
  } catch (error) {
    console.error("Error conectando con el servidor:", error);
    window.Telegram.WebApp.showAlert("Error de red. Inténtalo de nuevo.");
    State.spinning = false;
    return;
  }

  State.ballLanzada = false;
  resultadoEl.textContent = 'Girando ruleta...';
  actualizarLuzDispensador();

  let wheelSpeed = CONFIG.IMPULSO_RULETA;
  State.wheelAngle = Math.random() * 2 * Math.PI;
  let dispenserAngle = calculateDispenserAngleToCenter();
  State.ballAngle = dispenserAngle;
  bola.style.display = 'none';

  // set radii
  const { width, height } = getDimensions();
  const rMax = Math.min(width, height) / 2 * CONFIG.BALL_R_MAX_RATIO;
  const rMin = Math.min(width, height) / 2 * CONFIG.BALL_R_MIN_RATIO;
  launchBall(wheelSpeed, canvas);

  let lastTime = null;

  async function finalizar() {
    if (launchTimer) clearTimeout(launchTimer);
    animFrame = null;

    const slice = getDimensions().slice;
    let sectorIdx = sectorBajoBola(slice);
    let ganador = State.numeros[sectorIdx];

    // ====== LÓGICA MODO DEMO ======
    // Aumentar artificialmente la probabilidad de ganar al 75%
    const isDemo = window.USER_DATA && window.USER_DATA.play_mode === 'demo';
    if (isDemo && State.apuestas.length > 0 && Math.random() < 0.75) {
      const ap = State.apuestas[Math.floor(Math.random() * State.apuestas.length)];
      const candidatos = State.numeros.filter(n => {
         if (ap.tipo === 'rojo') return n.color === 'red';
         if (ap.tipo === 'negro') return n.color === 'black';
         if (ap.tipo === 'par') return n.num !== 0 && n.num % 2 === 0;
         if (ap.tipo === 'impar') return n.num !== 0 && n.num % 2 !== 0;
         if (ap.tipo === 'pasa') return n.num >= 19 && n.num <= 36;
         if (ap.tipo === 'falta') return n.num >= 1 && n.num <= 18;
         return n.num === ap.tipo; // Número directo pleno
      });
      if (candidatos.length > 0) {
         const forzado = candidatos[Math.floor(Math.random() * candidatos.length)];
         sectorIdx = State.numeros.findIndex(n => n.num === forzado.num);
         ganador = State.numeros[sectorIdx];
         // Forzar la bola visualmente en esa posición
         State.ballAngle = Math.PI/2 - (sectorIdx * slice) - State.wheelAngle;
         actualizarPosicionBola(bola, canvas);
      }
    }
    // ===============================

    let ganancia = calcularGanancias(ganador.num, ganador.color);

    resultadoEl.textContent = `Resultado: ${ganador.num} (${ganador.color === 'red' ? 'Rojo' : ganador.color === 'black' ? 'Negro' : 'Verde'})`;
    limpiarApuestas();
    updateHistory(ganador.num);

    State.spinning = false;
    State.ballLanzada = false;
    bola.style.display = 'none';
    drawWheel();
    actualizarLuzDispensador();

    if (ganancia > 0) {
      // Reclamar premio en Telegram WebApp Database
      fetch('/win', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cantidad: Math.floor(ganancia), source: 'ruleta', multiplier: apuestaTotal > 0 ? (ganancia / apuestaTotal) : 1 })
      })
        .then(r => r.json())
        .then(data => {
          if (data.status === 'ok') {
            State.saldo = data.bits;
            saldoEl.textContent = State.saldo;
            animateSaldo(saldoEl);
          }
        })
        .catch(console.error);

      sparkResultado(resultadoEl);
      showConfetti(60);
    } else {
      saldoEl.textContent = State.saldo;
    }
  }

  function animate(ts) {
    if (!lastTime) lastTime = ts;
    const dt = Math.min(0.05, (ts - lastTime) / 1000);
    lastTime = ts;

    wheelSpeed *= Math.pow(CONFIG.FRICCION_RULETA, dt * 60);
    if (Math.abs(wheelSpeed) < CONFIG.VEL_MIN) wheelSpeed = 0;
    State.wheelAngle += wheelSpeed * dt;
    State.wheelAngle = (State.wheelAngle % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);

    if (State.ballLanzada) {
      wheelSpeed = updateBall(dt, wheelSpeed);
    }

    drawWheel();
    if (State.ballLanzada) actualizarPosicionBola(bola, canvas);

    const rMaxLocal = Math.min(getDimensions().width, getDimensions().height) / 2 * CONFIG.BALL_R_MAX_RATIO;
    const pocketRadius = rMin + (rMaxLocal - rMin) * 0.18;
    if (Math.abs(wheelSpeed) < CONFIG.VEL_MIN &&
      (!State.ballLanzada || Math.abs(State.ballAngularSpeed) < CONFIG.VEL_MIN) &&
      State.ballRadius <= pocketRadius + 0.5) {
      finalizar();
      return;
    }
    animFrame = requestAnimationFrame(animate);
  }

  // launcher
  launchTimer = setTimeout(() => {
    if (State.spinning) {
      State.ballLanzada = true;
      bola.style.display = 'block';
      // ball angular
      const sign = wheelSpeed >= 0 ? -1 : 1;
      State.ballAngularSpeed = sign * Math.abs(wheelSpeed) * CONFIG.IMPULSO_BOLA_FACTOR + randRange(-CONFIG.IMPULSO_BOLA_RANDOM, CONFIG.IMPULSO_BOLA_RANDOM);
      resultadoEl.textContent = '¡Bola lanzada!';
      actualizarPosicionBola(bola, canvas);
    }
  }, CONFIG.LAUNCH_DELAY);

  animFrame = requestAnimationFrame(animate);
}

function calculateDispenserAngleToCenter() {
  try {
    const dRect = dispensador.getBoundingClientRect();
    const cRect = canvas.getBoundingClientRect();
    const dx = (cRect.left + cRect.width / 2) - (dRect.left + dRect.width / 2);
    const dy = (cRect.top + cRect.height / 2) - (dRect.top + dRect.height / 2);
    return Math.atan2(dy, dx);
  } catch (e) {
    const dims = getDimensions();
    const cx = dims.cx, cy = dims.cy, width = dims.width;
    return Math.atan2((cy - 0), (cx - (width * 0.9)));
  }
}

function init() {
  initCanvas(canvas);
  initFichas();
  initApuestasEspeciales('.apuesta', () => { saldoEl.textContent = State.saldo; animateSaldo(saldoEl); actualizarLuzDispensador(); });
  initNumerosPlenos('#numerosPleno', () => { saldoEl.textContent = State.saldo; animateSaldo(saldoEl); actualizarLuzDispensador(); });
  document.querySelector('#repeatBet').addEventListener('click', () => {
    State.apuestas = [...State.apuestas];
  });
  document.querySelector('#doubleBet').addEventListener('click', () => {
    State.apuestas.forEach(a => a.monto *= 2);
  });
  dispensador.addEventListener('click', iniciarGiro);
  window.addEventListener('load', () => {
    updateHistory();
  });
  window.addEventListener('resize', () => {
    initCanvas(canvas);
    if (State.ballLanzada) actualizarPosicionBola(bola, canvas);
  });
}

init();
