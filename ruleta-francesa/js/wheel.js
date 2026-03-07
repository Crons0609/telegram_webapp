import { State } from './physics.js';

let ctx, width, height, cx, cy, radius, slice;

export function initCanvas(canvas) {
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

export function drawWheel() {
  if (!ctx || width === 0) return;
  ctx.clearRect(0, 0, width, height);
  const r = radius;
  const labelR = r * 0.7;
  const fontSize = Math.max(12, r * 0.09);
  // barrier ring
  const barrier = r * 0.97; // match config
  ctx.beginPath();
  ctx.arc(cx, cy, barrier, 0, 2*Math.PI);
  ctx.strokeStyle = 'rgba(255,255,255,0.3)';
  ctx.lineWidth = 3;
  ctx.setLineDash([6,6]);
  ctx.stroke();
  ctx.setLineDash([]);

  // highlight sector under ball if spinning
  const currIndex = (State.spinning && State.ballLanzada) ? Math.floor(((State.ballAngle - State.wheelAngle + 2*Math.PI) % (2*Math.PI)) / slice) : -1;

  State.numeros.forEach((item, i) => {
    const start = State.wheelAngle + i * slice;
    const end = start + slice;

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r-2, start, end);
    ctx.closePath();
    ctx.fillStyle = item.color === 'red' ? '#b30000' : item.color === 'black' ? '#0b0b0b' : '#0a7d2c';
    ctx.fill();

    ctx.strokeStyle = '#d4af37';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    if (i === currIndex) {
      ctx.strokeStyle = 'rgba(255,255,255,0.6)';
      ctx.lineWidth = 6;
      ctx.stroke();
    }

    const mid = start + slice/2;
    const lx = cx + Math.cos(mid) * labelR;
    const ly = cy + Math.sin(mid) * labelR;

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
}

export function getDimensions() {
  return {cx, cy, radius, slice, width, height};
}
