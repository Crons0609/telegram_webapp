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

function iniciarGiro() {
  if (State.spinning) return;
  if (State.apuestas.length === 0) {
    resultadoEl.textContent = '¡Haz una apuesta!';
    return;
  }
  State.spinning = true;
  State.ballLanzada = false;
  resultadoEl.textContent = 'Girando ruleta...';
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

  function finalizar() {
    if (launchTimer) clearTimeout(launchTimer);
    cancelAnimationFrame(animFrame);
    animFrame = null;

    const slice = getDimensions().slice;
    const sectorIdx = sectorBajoBola(slice);
    const ganador = State.numeros[sectorIdx];
    const ganancia = calcularGanancias(ganador.num, ganador.color);
    State.saldo += ganancia;
    saldoEl.textContent = State.saldo;
    animateSaldo(saldoEl);
    resultadoEl.textContent = `Resultado: ${ganador.num} (${ganador.color==='red'?'Rojo':ganador.color==='black'?'Negro':'Verde'})`;
    limpiarApuestas();
    updateHistory(ganador.num);

    State.spinning = false;
    State.ballLanzada = false;
    bola.style.display = 'none';
    drawWheel();
    actualizarLuzDispensador();
    sparkResultado(resultadoEl);
    showConfetti(60);
  }

  function animate(ts) {
    if (!lastTime) lastTime = ts;
    const dt = Math.min(0.05, (ts - lastTime) / 1000);
    lastTime = ts;

    wheelSpeed *= Math.pow(CONFIG.FRICCION_RULETA, dt * 60);
    if (Math.abs(wheelSpeed) < CONFIG.VEL_MIN) wheelSpeed = 0;
    State.wheelAngle += wheelSpeed * dt;
    State.wheelAngle = (State.wheelAngle % (2*Math.PI) + 2*Math.PI) % (2*Math.PI);

    if (State.ballLanzada) {
      wheelSpeed = updateBall(dt, wheelSpeed);
    }

    drawWheel();
    if (State.ballLanzada) actualizarPosicionBola(bola, canvas);

    const rMaxLocal = Math.min(getDimensions().width,getDimensions().height)/2 * CONFIG.BALL_R_MAX_RATIO;
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
    const dx = (cRect.left + cRect.width/2) - (dRect.left + dRect.width/2);
    const dy = (cRect.top + cRect.height/2) - (dRect.top + dRect.height/2);
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
