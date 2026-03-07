import { State, CONFIG } from './physics.js';

export function calcularGanancias(num, color) {
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

export function limpiarApuestas() {
  State.apuestas = [];
}

export function initApuestasEspeciales(containerSelector, updateSaldoCallback) {
  document.querySelectorAll(containerSelector).forEach(btn => {
    btn.addEventListener('click', () => {
      const tipo = btn.dataset.tipo;
      if (btn.getAttribute('aria-pressed') === 'true') {
        btn.setAttribute('aria-pressed', 'false');
        State.apuestas = State.apuestas.filter(a => a.tipo !== tipo);
        // Balance is not returned here locally; betting is a staging area until Spin.
      } else {
        document.querySelectorAll(containerSelector).forEach(b => b.setAttribute('aria-pressed', 'false'));
        btn.setAttribute('aria-pressed', 'true');
        State.apuestas.push({ tipo, monto: State.apuestaMonto });
        // Balance is not deducted here locally.
      }
      updateSaldoCallback?.();
    });
  });
}

export function initNumerosPlenos(gridSelector, updateSaldoCallback) {
  const grid = document.querySelector(gridSelector);
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
      } else {
        grid.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', 'false'));
        btn.setAttribute('aria-pressed', 'true');
        State.apuestas.push({ tipo: 'pleno', numero: num, monto: State.apuestaMonto });
      }
      updateSaldoCallback?.();
    });
    grid.appendChild(btn);
  });
}
