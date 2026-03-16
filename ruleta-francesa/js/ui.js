import { State } from './physics.js';
import { actualizarPosicionBola } from './ball.js';

export function animateSaldo(saldoEl) {
  if (!saldoEl) return;
  const card = saldoEl.closest('.saldo-card');
  if (!card) return;
  card.classList.add('pulse');
  setTimeout(() => card.classList.remove('pulse'), 450);
}

export function showConfetti(count) {
  const colors = ['#ff4d4d','#4d79ff','#ffff4d','#4dff88','#ff4dff'];
  for (let i = 0; i < count; i++) {
    const c = document.createElement('div');
    c.className = 'confetti';
    c.style.background = colors[Math.floor(Math.random()*colors.length)];
    c.style.left = Math.random() * window.innerWidth + 'px';
    c.style.top = '-10px';
    c.style.transform = `rotate(${Math.random()*360}deg)`;
    document.body.appendChild(c);
    c.addEventListener('animationend', () => c.remove());
  }
}

export function sparkResultado(resultadoEl) {
  if (!resultadoEl) return;
  resultadoEl.classList.add('sparkle');
  setTimeout(() => resultadoEl.classList.remove('sparkle'), 700);
}

export function spawnSpark() {
  const canvas = document.querySelector('#canvasRuleta');
  if (!canvas) return;
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

export function updateHistory(number) {
  if (typeof number !== 'undefined') {
    State.history.unshift(number);
    if (State.history.length > 10) State.history.pop();
  }
  const list = document.querySelector('#historyList');
  if (!list) return;
  list.innerHTML = '';
  State.history.forEach(n => {
    const span = document.createElement('span');
    span.textContent = n;
    list.appendChild(span);
  });
}

export function initUI() {
  // placeholder for future UI interactions
}
