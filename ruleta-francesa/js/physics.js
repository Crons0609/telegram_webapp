// física y estado compartido
export const CONFIG = {
  SALDO_INICIAL: 1000,
  FRICCION_RULETA: 0.997,
  FRICCION_BOLA: 0.992,
  VEL_MIN: 0.02,
  IMPULSO_RULETA: 20,
  IMPULSO_BOLA_FACTOR: 1.6,
  IMPULSO_BOLA_RANDOM: 6,
  REBOTE_PERDIDA: 0.55,
  REBOTE_VARIACION: 0.28,
  REBOTE_ANGULAR_UMBRAL: 0.15,
  BALL_R_MAX_RATIO: 0.97,
  BALL_R_MIN_RATIO: 0.54,
  LAUNCH_RADIUS_MULT: 1.05,
  RADIAL_LERP_BASE: 0.02,
  RADIAL_ACCEL_FACTOR: 3.5,
  STALL_SPEED: 1.8,
  LAUNCH_DELAY: 700,
  ANGULAR_NOISE: 0.005,
  PAGOS: { pleno: 35, rojo: 1, negro: 1, par: 1, impar: 1, pasa: 1, falta: 1 }
};

export const State = {
  saldo: CONFIG.SALDO_INICIAL,
  apuestaMonto: 10,
  apuestas: [],
  spinning: false,
  wheelAngle: 0,
  ballAngle: 0,
  ballAngularSpeed: 0,
  ballRadius: 0,
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
  ],
  history: [] // últimos números
};

export const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
export const randRange = (a,b) => a + Math.random() * (b-a);
export const normAngle = a => {
  const TWO = Math.PI*2;
  a %= TWO;
  if (a < 0) a += TWO;
  return a;
};

// calcula sector bajo la bola según angulos
export function sectorBajoBola(slice) {
  const relative = normAngle(State.ballAngle - State.wheelAngle);
  const idx = Math.floor(relative / slice) % State.numeros.length;
  return idx;
}
