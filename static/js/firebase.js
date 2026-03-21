/* ──────────────────────────────────────────────────────────
   CONFIGURACIÓN
────────────────────────────────────────────────────────── */
const firebaseConfig = {
  apiKey: "AIzaSyAeHuqHdO57ffrsQhFYxCUtQQ_LM4aCKa4",
  authDomain: "ghost-plague-casino.firebaseapp.com",
  databaseURL: "https://ghost-plague-casino-default-rtdb.firebaseio.com",
  projectId: "ghost-plague-casino",
  storageBucket: "ghost-plague-casino.firebasestorage.app",
  messagingSenderId: "964545969514",
  appId: "1:964545969514:web:bfcf819a519c7da8e1b913",
  measurementId: "G-GLVNLZY4BT"
};

if (!firebase.apps.length) {
  firebase.initializeApp(firebaseConfig);
}

var Database = firebase.database();

/* ──────────────────────────────────────────────────────────
   CRUD — CLIENTES (Auto-Incremental ID)
────────────────────────────────────────────────────────── */

window._obtenerSiguienteID = async function () {
  try {
    const snap = await Database.ref('usuarios').orderByChild('cliente_id').limitToLast(1).get();

    if (!snap.exists()) return 1;

    const val = snap.val();
    const keys = Object.keys(val);
    const ultimoCliente = val[keys[0]];

    return (ultimoCliente.cliente_id || 0) + 1;
  } catch (err) {
    console.error('Firebase: Error obteniendo último ID:', err);
    throw err;
  }
};

window.guardarCliente = async function (cliente) {
  const nextId = await window._obtenerSiguienteID();
  await Database.ref(`usuarios/${nextId}`).set({
    cliente_id: nextId,
    ...cliente,
    Estado: 'activo',
    timestamp: new Date().toISOString(),
  });
  return String(nextId);
};

window.obtenerClientes = async function () {
  const snap = await Database.ref('usuarios').get();
  if (!snap.exists()) return [];
  const val = snap.val();
  return Object.keys(val).reduce((acc, key) => {
    if (val[key]) acc.push({ id: key, ...val[key] });
    return acc;
  }, []);
};

window.escucharClientes = function (cb) {
  return Database.ref('usuarios').on('value', snap => {
    if (!snap.exists()) { cb([]); return; }
    const val = snap.val();
    const list = Object.keys(val).reduce((acc, key) => {
      if (val[key]) acc.push({ id: key, ...val[key] });
      return acc;
    }, []);
    cb(list);
  });
};

window.actualizarCliente = async function (id, cambios) {
  await Database.ref(`usuarios/${id}`).update({
    ...cambios,
    ultimaActualizacion: new Date().toISOString(),
  });
};

window.eliminarCliente = async function (id) {
  await Database.ref(`usuarios/${id}`).remove();
};

window.registrarActividad = async function (evento) {
  try {
    const newRef = Database.ref('ActividadServicios').push();
    await newRef.set({
      ...evento,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.warn('Firebase: Error registrando actividad:', err);
  }
};

window.tokenExiste = async function (token) {
  const snap = await Database.ref('usuarios').get();
  if (!snap.exists()) return false;
  const val = snap.val();
  return Object.keys(val).some(k => val[k] && val[k].Token === token);
};

/* ──────────────────────────────────────────────────────────
   LOG DE ACTIVIDAD
────────────────────────────────────────────────────────── */

window.registrarActividadDash = async function (tipo, desc, color = 'blue') {
  try {
    const newRef = Database.ref('actividad').push();
    await newRef.set({
      tipo,
      desc,
      color,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.warn('Firebase: Error registrando actividad dashboard:', err);
  }
};

window.escucharActividadDash = function (cb) {
  return Database.ref('actividad').orderByChild('timestamp').limitToLast(10).on('value', snap => {
    if (!snap.exists()) { cb([]); return; }
    const val = snap.val();
    const list = Object.entries(val)
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    cb(list);
  });
};

window.obtenerActividadDash = async function (limit = 10) {
  const snap = await Database.ref('actividad').orderByChild('timestamp').limitToLast(limit).get();
  if (!snap.exists()) return [];
  const val = snap.val();
  return Object.entries(val)
    .map(([key, v]) => ({ key, ...v }))
    .sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
};

/* ──────────────────────────────────────────────────────────
   PRESENCIA ADMINS
────────────────────────────────────────────────────────── */

window.registrarAdminOnline = async function (email, nombre = '') {
  if (!email) return;
  const key = email.replace(/[.#$[\]]/g, '_');
  try {
    await Database.ref(`Administradores_Online/${key}`).set({
      email,
      nombre: nombre || email.split('@')[0],
      desde: new Date().toISOString(),
      online: true,
    });
  } catch (err) {
    console.warn('Firebase: Error marcando admin online:', err);
  }
};

window.marcarAdminOffline = async function (email) {
  if (!email) return;
  const key = email.replace(/[.#$[\]]/g, '_');
  try {
    await Database.ref(`Administradores_Online/${key}`).remove();
  } catch (err) {
    console.warn('Firebase: Error marcando admin offline:', err);
  }
};

window.escucharAdminsOnline = function (cb) {
  return Database.ref('Administradores_Online').on('value', snap => {
    if (!snap.exists()) { cb([]); return; }
    const val = snap.val();
    const list = Object.values(val).filter(Boolean);
    cb(list);
  });
};