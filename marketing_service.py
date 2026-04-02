"""
marketing_service.py
Sistema de Marketing Automatizado Anti-Robot para Ghost Plague Casino
----------------------------------------------------------------------
- Mensajes personalizados y no genéricos con variables dinámicas.
- Horario de envío ALEATORIO diario (no siempre a la misma hora).
- Pausa aleatoria (jitter) entre cada mensaje para no parecer bot.
- Registro en Firebase para evitar repetir el mismo mensaje al mismo usuario.
"""

import time
import random
import threading
from datetime import datetime, date
import database
from config import BOT_TOKEN
import requests

# ─── CONFIGURACIÓN ───────────────────────────────────────────────────────────

# Franja horaria en que se puede enviar el mensaje masivo diario (hora UTC, 24h)
# El servidor Render corre en UTC. Guatemala = UTC-6. Ajusta según tu zona.
HORA_MIN_UTC = 18   # 12:00 Guatemala
HORA_MAX_UTC = 23   # 17:00 Guatemala

# Pausa en segundos entre cada mensaje (min, max) – simula escritura humana
JITTER_MIN = 3
JITTER_MAX = 9

# ─── BANCO DE PLANTILLAS ─────────────────────────────────────────────────────
# Variables disponibles: {nombre}, {casino}
# Se usa SPINTAX básico: cada lista de variantes se elige al azar.
# Hay 30+ plantillas para que no se repitan fácilmente.

PLANTILLAS_GENERAL = [
    # --- Tipo: humor informal ---
    "Oye {nombre}, ¿ya viste los nuevos juegos que activamos hoy en {casino}? 🎰 Parece que la suerte anda suelta por ahí...",
    "Hey {nombre} 👋 se nos olvidó avisarte que tu silla favorita en {casino} sigue libre. ¿La reclamamos?",
    "{nombre}, alguien me dijo que tú eres el que más sabe jugar en {casino}... ¿será cierto? 😏",
    "Psst, {nombre}. Los dados de {casino} tuvieron un martes raro... una racha de suerte brutal. ¿A qué hora entras?",
    "{nombre} 🃏 hay trucos que solo aprenden los que entran seguido. ¿Ya los conoces todos?",
    "No te voy a mentir, {nombre}... el casino estuvo rarísimamente generoso esta tarde 👀. Y tú sin aparecer.",
    "Oye {nombre}, en {casino} acaban de liberar algo nuevo. No te digo más para no spoilearte. 🤫",

    # --- Tipo: urgencia blanda ---
    "{nombre}, ¿sabías que hay bits de bienvenida esperando? En {casino} no caducan solos... pero tampoco duran para siempre 😅",
    "Mira {nombre}, hoy en {casino} está tranquilo. Pocos jugando = más chance para ti 🎯",
    "{nombre} aparece cuando puedas hoy, ¿sí? El ambiente en {casino} está bueno esta noche 🌙",
    "Antes de que se acabe el día, {nombre}. {casino} tiene algo preparado para los jugadores que entran hoy 🎁",
    "{nombre} 💬 dale aunque sea un par de rondas en {casino}. Entras, juegas un rato, y ya. Nada complejo.",

    # --- Tipo: curiosidad ---
    "¿Sabes qué combinación cayó tres veces seguidas en {casino} hace un rato, {nombre}? 😳 Si entras te cuento.",
    "{nombre}, un jugador cerró con x5 en {casino} hace nada. Solo digo eso y ya 👀",
    "Dato curioso, {nombre}: los que entran a {casino} pasadas las 7pm tienen racha distinta 🌃 ¿Superstición? Tú decides.",
    "Ehh {nombre} 🤔 una pregunta: ¿sigues viendo el saldo de {casino} o ya te olvidaste que tienes bits ahí?",
    "{nombre}, en {casino} hay un juego que nadie casi usa y que tiene una mecánica interesante. ¿Ya lo encontraste?",

    # --- Tipo: motivacional corto ---
    "La racha mala siempre termina, {nombre}. {casino} te espera con los brazos abiertos 💪",
    "Hoy puede ser tu día, {nombre}. No lo sabrás si no entras a {casino} 🎲",
    "{nombre} 🔥 los que ganaron fuerte en {casino} esta semana empezaron con una apuesta pequeña. Tú también puedes.",
    "No necesitas mucho para empezar, {nombre}. {casino} acepta desde muy poquito y puede devolverte mucho 💸",

    # --- Tipo: recordatorio suave ---
    "Hace rato que no te vemos por {casino}, {nombre}. ¿Todo bien? El casino te extraña 👾",
    "Ey {nombre}, sin presión... solo queríamos recordarte que en {casino} tienes bits listos para usar cuando quieras 🎮",
    "{nombre}, a veces uno necesita un break. Pero cuando estés listo, {casino} está aquí 🕹️",
    "Cuando tengas 10 minutos libres, {nombre}. {casino} funciona desde el celular y va rápido 📱",

    # --- Tipo: casual / chit-chat ---
    "Nada de emocionante pasó hoy, {nombre}... mentira, {casino} estuvo full movida 😂 ¿Cuándo entras?",
    "{nombre} cuídate. Ah, y si tienes un momento, {casino} tiene mesa libre con tu nombre 😄",
    "Corto y directo, {nombre}: {casino} + tu suerte de hoy = potencial interesante. Tú lo decides 🎰",
    "{nombre}, ojalá te estén yendo bien las cosas. Si quieres relajarte un rato, {casino} siempre es buena opción 🙌",
    "Oye {nombre}, te escribo rápido porque sé que andas ocupado. Hay novedades en {casino}. Cuando puedas dale un vistazo 👀",
]

PLANTILLAS_MANANA = [
    "¡Buenos días {nombre}! ☀️ Levántate con suerte, {casino} ya está abierto para tu primer intento del día.",
    "Buen día {nombre} ☕. Un café y una tirada en {casino} suenan como la combinación perfecta para empezar."
]

PLANTILLAS_TARDE = [
    "¡Buenas tardes {nombre}! 🌤️ Ideal para relajarse un rato en {casino} después de las labores.",
    "El sol empieza a bajar, {nombre}... la mesa en {casino} ya se está calentando. ¿Te animas? 🎲"
]

PLANTILLAS_FIN_SEMANA = [
    "¡Al fin fin de semana {nombre}! 🎉 La mejor vibra está en {casino} esta noche. No te la pierdas.",
    "{nombre}, es finde y el cuerpo lo sabe 🍾. Relájate y ven a probar suerte a {casino}.",
    "Sábado o Domingo, da igual {nombre}. En {casino} no descansamos y las rachas andan fuertes 🔥."
]

PLANTILLAS_INICIO_SEMANA = [
    "¡Feliz inicio de semana {nombre}! 🚀 Que este lunes empiece con el pie derecho y una buena ganancia en {casino}.",
    "{nombre}, sabemos que los inicios de semana son pesados... ¿por qué no aflojas un rato entrando a {casino}? 😉"
]

PLANTILLAS_JUEVES = [
    "¡Feliz Jueves {nombre}! Ya huele a viernes en {casino}. Ven y calienta motores 🏎️💨",
    "{nombre}, pásate por {casino} como buen 'ombligo de la semana' para romper la rutina 🐪."
]

CASINO_NAME = "Zona Jackpot 777"
TELEGRAM_API = f"https://api.telegram.org/bot{BOT_TOKEN}"

# ─── FUNCIONES INTERNAS ───────────────────────────────────────────────────────

def _send_message(telegram_id: str, text: str) -> bool:
    """Envía un mensaje de Telegram a un usuario. Retorna True si fue exitoso."""
    try:
        r = requests.post(
            f"{TELEGRAM_API}/sendMessage",
            json={"chat_id": telegram_id, "text": text, "parse_mode": "HTML"},
            timeout=10
        )
        return r.status_code == 200 and r.json().get("ok", False)
    except Exception:
        return False


def _get_today_key() -> str:
    """Retorna la fecha de hoy en formato 'YYYY-MM-DD' para usar como clave en Firebase."""
    return date.today().isoformat()


def _get_marketing_state() -> dict:
    """Lee el estado de marketing de hoy desde Firebase."""
    state = database.get_fb(f"marketing_estado/{_get_today_key()}")
    return state if isinstance(state, dict) else {}


def _set_marketing_state(data: dict):
    """Guarda el estado de marketing de hoy en Firebase."""
    database.patch_fb(f"marketing_estado/{_get_today_key()}", data)


def _get_contextual_templates() -> list:
    from datetime import datetime, timedelta
    agora = datetime.utcnow() - timedelta(hours=6)
    dia_semana = agora.weekday() # 0 = Lunes, 3 = Jueves, 4 = Viernes, ... 6 = Domingo
    hora = agora.hour

    activas = list(PLANTILLAS_GENERAL)

    if dia_semana in (0, 1): # Lunes, Martes
        activas.extend(PLANTILLAS_INICIO_SEMANA)
    elif dia_semana == 3: # Jueves
        activas.extend(PLANTILLAS_JUEVES)
    elif dia_semana in (4, 5, 6): # Viernes, Sábado, Domingo
        activas.extend(PLANTILLAS_FIN_SEMANA)

    if 5 <= hora < 12:
        activas.extend(PLANTILLAS_MANANA)
    elif 12 <= hora < 18:
        activas.extend(PLANTILLAS_TARDE)
        
    return activas


def _pick_template_for_user(telegram_id: str, nombre: str) -> str:
    """
    Selecciona una plantilla que NO haya sido enviada al usuario recientemente.
    Guarda el historial en Firebase bajo 'marketing_historial/{telegram_id}'.
    """
    historial_data = database.get_fb(f"marketing_historial/{telegram_id}") or {}
    ya_enviados = set(historial_data.keys()) if isinstance(historial_data, dict) else set()

    activas = _get_contextual_templates()
    disponibles = [t for t in activas if t not in ya_enviados]

    # Si ya se agotaron todas las plantillas, reiniciar el historial
    if not disponibles:
        database.patch_fb(f"marketing_historial/{telegram_id}", {"__reset__": True})
        database.get_fb(f"marketing_historial/{telegram_id}")  # forzar lectura limpia
        disponibles = activas[:]

    plantilla = random.choice(disponibles)

    # Registrar como enviada
    safe_key = str(abs(hash(plantilla)))[:12]
    database.patch_fb(f"marketing_historial/{telegram_id}", {safe_key: plantilla[:30]})

    return plantilla.replace("{nombre}", nombre or "amigo").replace("{casino}", CASINO_NAME)


def _run_campaign():
    """
    Tarea real de envío masivo. Corre en un hilo separado para no bloquear Flask.
    """
    try:
        _set_marketing_state({"enviando": True, "inicio": datetime.utcnow().isoformat()})

        # Obtener todos los usuarios de Firebase
        usuarios_raw = database.get_fb("usuarios") or {}
        if not isinstance(usuarios_raw, dict):
            return

        usuarios = list(usuarios_raw.items())
        random.shuffle(usuarios)  # orden aleatorio, nunca el mismo

        enviados = 0
        errores = 0

        for tid, info in usuarios:
            if not isinstance(info, dict):
                continue

            # Saltar usuarios baneados o sin nombre
            estado = info.get("Estado", "activo")
            if estado == "baneado":
                continue

            nombre = info.get("nombre") or info.get("username") or "amigo"
            telegram_id = str(tid)

            mensaje = _pick_template_for_user(telegram_id, nombre)
            ok = _send_message(telegram_id, mensaje)

            if ok:
                enviados += 1
            else:
                errores += 1

            # Pausa aleatoria para no parecer bot
            time.sleep(random.uniform(JITTER_MIN, JITTER_MAX))

        _set_marketing_state({
            "enviando": False,
            "completado": True,
            "fin": datetime.utcnow().isoformat(),
            "enviados": enviados,
            "errores": errores,
        })

    except Exception as e:
        _set_marketing_state({"enviando": False, "error": str(e)})


# ─── INTERFAZ PÚBLICA ─────────────────────────────────────────────────────────

def check_and_trigger(cron_secret: str, provided_secret: str) -> dict:
    """
    Función principal llamada por el endpoint cron.
    Verifica si es hora de enviar los mensajes del día y los dispara si corresponde.

    Returns:
        dict con {"triggered": bool, "message": str, "state": dict}
    """
    # Validar clave secreta
    if provided_secret != cron_secret:
        return {"triggered": False, "message": "Clave inválida"}

    state = _get_marketing_state()

    # Si ya se completó el envío de hoy, no hacer nada
    if state.get("completado"):
        return {"triggered": False, "message": "Campaña del día ya completada", "state": state}

    # Si hay un envío en curso, no iniciar uno nuevo
    if state.get("enviando"):
        return {"triggered": False, "message": "Campaña en progreso", "state": state}

    # Verificar si ya se fijó la hora objetivo de hoy
    hora_objetivo = state.get("hora_objetivo")
    if hora_objetivo is None:
        # Generar hora aleatoria para hoy
        hora_objetivo = random.randint(HORA_MIN_UTC, HORA_MAX_UTC - 1) + round(random.random(), 2)
        _set_marketing_state({"hora_objetivo": hora_objetivo, "completado": False, "enviando": False})
        return {
            "triggered": False,
            "message": f"Hora objetivo generada: {hora_objetivo:.2f} UTC. Aún no es momento.",
            "state": {"hora_objetivo": hora_objetivo}
        }

    # Verificar si ya llegó la hora
    hora_actual = datetime.utcnow().hour + datetime.utcnow().minute / 60.0
    if hora_actual < hora_objetivo:
        return {
            "triggered": False,
            "message": f"Aún no es hora. Hora actual UTC: {hora_actual:.2f}, objetivo: {hora_objetivo:.2f}",
            "state": state
        }

    # ¡Es hora! Disparar campaña en hilo secundario para no bloquear respuesta HTTP
    hilo = threading.Thread(target=_run_campaign, daemon=True)
    hilo.start()

    return {"triggered": True, "message": "Campaña de marketing iniciada 🚀", "state": state}


def get_status() -> dict:
    """Devuelve el estado actual del envío de hoy (para el panel admin)."""
    state = _get_marketing_state()
    return {
        "fecha": _get_today_key(),
        "hora_objetivo_utc": state.get("hora_objetivo"),
        "completado": state.get("completado", False),
        "enviando": state.get("enviando", False),
        "enviados": state.get("enviados", 0),
        "errores": state.get("errores", 0),
        "inicio": state.get("inicio"),
        "fin": state.get("fin"),
    }
