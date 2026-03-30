import eventlet
eventlet.monkey_patch()

from flask import Flask, render_template, request, jsonify, session, redirect, url_for
from flask_socketio import SocketIO, emit, join_room, leave_room
import database
from moche_engine import manager
from slot_engine import slot_engine
from user_profile_manager import UserProfileManager
from trophy_manager import check_and_unlock_trophies, get_trophy_definitions
from mission_manager import get_user_missions_with_progress, claim_mission_reward, check_newly_completed_missions
import os
import time
import requests

app = Flask(__name__)
# Inicializar SocketIO (se usará eventlet como servidor asíncrono)
socketio = SocketIO(app, cors_allowed_origins='*')
# Try to get secret key from config if available, fallback to default
try:
    import config
    app.secret_key = getattr(config, 'SECRET_KEY', "clave-secreta-super-segura")
except ImportError:
    app.secret_key = "clave-secreta-super-segura"

from datetime import timedelta
# Hacer que las sesiones sean permanentes y duren 1 año
app.config['PERMANENT_SESSION_LIFETIME'] = timedelta(days=365)

# Configuración de Cookies para Telegram WebApp (compatibilidad con HTTPS y Cross-Site)
# Solo activamos Secure si detectamos que estamos en producción o HTTPS para evitar problemas locales
app.config.update(
    SESSION_COOKIE_SAMESITE='Lax',
    SESSION_COOKIE_SECURE=False,
    SESSION_COOKIE_HTTPONLY=True
)

# Inicializamos la base de datos
database.init_db()

# Registrar Panel de Administración
from admin_routes import admin_bp
app.register_blueprint(admin_bp)

# Registrar Deportes
from sports_routes import sports_bp
app.register_blueprint(sports_bp)

# Registrar Sistema de Retiros
from withdrawal_routes import withdrawal_bp
app.register_blueprint(withdrawal_bp)

# Importar servicio de marketing automatizado
import marketing_service
try:
    CRON_SECRET = config.CRON_SECRET
except Exception:
    CRON_SECRET = "zonajackpot777_cron_2026"

import sports_resolver


@app.before_request
def make_session_permanent():
    session.permanent = True
    # Check scheduled themes (lightweight — cached by DB logic)
    try:
        database.check_and_apply_scheduled_theme()
    except Exception:
        pass

@app.context_processor
def inject_user_profile():
    active_theme = database.get_active_theme()
    context = {'global_theme': active_theme}
    if "telegram_id" in session:
        telegram_id = session["telegram_id"]
        perfil = database.obtener_perfil_completo(telegram_id)
        if perfil:
            rank_info = UserProfileManager.get_rank_info(perfil['nivel'])
            progress = UserProfileManager.get_progress(perfil['xp'])
            perfil['rank'] = rank_info
            perfil['progress'] = progress
            perfil['play_mode'] = session.get('play_mode', 'real')
            context['global_profile'] = perfil
            context['play_mode'] = session.get('play_mode', 'real')
            return context
    context['global_profile'] = None
    return context

# =====================================================
# HOME
# =====================================================
@app.route('/')
def home():
    telegram_id = session.get("telegram_id")
    nombre = session.get("nombre")
    username = session.get("username", "")
    photo_url = session.get("photo_url", "")

    if telegram_id and nombre:
        is_demo = session.get('play_mode') == 'demo'
        bits = database.obtener_bits(telegram_id, is_demo)
        return render_template("index.html", nombre=nombre, username=username, telegram_id=telegram_id, bits=bits, photo_url=photo_url, play_mode=session.get('play_mode', 'real'))
    else:
        # Si no hay sesión, aún renderizamos la página. 
        # El frontend (script.js) extraerá los datos nativos de Telegram y llamará a /register.
        # Quitamos la lógica del usuario de prueba "12345" para no sobreescribir sesiones perdidas en Telegram.
        return render_template("index.html", nombre="", username="", telegram_id="", bits=0, photo_url="")


# =====================================================
# LOBBY DE JUEGOS
# =====================================================
@app.route('/juegos')
def juegos():
    telegram_id = session.get("telegram_id")
    nombre = session.get("nombre")
    username = session.get("username", "")
    photo_url = session.get("photo_url", "")

    if telegram_id and nombre:
        is_demo = session.get('play_mode') == 'demo'
        bits = database.obtener_bits(telegram_id, is_demo)
        return render_template("juegos.html", nombre=nombre, username=username, telegram_id=telegram_id, bits=bits, photo_url=photo_url, play_mode=session.get('play_mode', 'real'))
    else:
        return redirect(url_for('home'))

# =====================================================
# REGISTRO DESDE TELEGRAM WEBAPP
# =====================================================
@app.route('/register', methods=["POST"])
def register():
    data = request.get_json()

    telegram_id = str(data.get("telegram_id"))
    nombre = data.get("nombre")
    username = data.get("username", "")
    photo_url = data.get("photo_url", "")

    if not telegram_id or not nombre:
        return jsonify({"status": "error", "message": "Datos incompletos"}), 400

    database.agregar_usuario(telegram_id, nombre, username, photo_url)

    # Guardamos el usuario en la sesión
    session["telegram_id"] = telegram_id
    session["nombre"] = nombre
    session["username"] = username
    session["photo_url"] = photo_url

    # Recuperar datos actuales para devolver al cliente
    perfil = database.obtener_perfil_completo(telegram_id)
    bits_actuales = perfil.get('bits', 0) if perfil else 0
    nivel_actual = perfil.get('nivel', 1) if perfil else 1
    xp_actual = perfil.get('xp', 0) if perfil else 0

    return jsonify({
        "status": "ok", 
        "bits": bits_actuales,
        "nivel": nivel_actual,
        "xp": xp_actual,
        "profile": perfil
    })

# =====================================================
# LOADING SCREEN CONFIG (public — no auth needed)
# =====================================================
@app.route('/api/loading-screen/config')
def loading_screen_config():
    """Returns the active loading screen configuration for the client-side JS."""
    cfg = database.get_fb('loading_screen_config') or {}
    # Defaults if not configured yet
    defaults = {
        'is_active': False,
        'icon_id': 1,
        'text': 'Cargando...',
        'bg_color': '#0a0a1a',
        'icon_color': '#f59e0b',
        'text_color': 'rgba(255,255,255,0.7)',
        'logo_url': '',
    }
    merged = {**defaults, **cfg}
    return jsonify({'config': merged})

# =====================================================
# PAYPAL BITS
# =====================================================
@app.route('/paypal_bits')
def paypal_bits():
    telegram_id = session.get("telegram_id")
    if not telegram_id:
        return redirect(url_for('home'))
    import config as _cfg
    return render_template(
        "paypal.html",
        paypal_client_id=_cfg.PAYPAL_CLIENT_ID,
        paypal_mode=getattr(_cfg, 'PAYPAL_MODE', 'sandbox'),
    )


# =====================================================
# P2P BITS
# =====================================================
@app.route('/p2p_bits')
def p2p_bits():
    telegram_id = session.get("telegram_id")
    if not telegram_id:
        return redirect(url_for('home'))
    return render_template(
        "p2p.html",
        user_id=telegram_id,
        username=session.get("username", "")
    )


@app.route('/api/p2p/request', methods=['POST'])
def p2p_request():
    """Registra una solicitud de recarga P2P antes de abrir Telegram."""
    telegram_id = session.get("telegram_id")
    if not telegram_id:
        return jsonify({"success": False, "message": "No autenticado"}), 401

    data = request.json or {}
    price_usd = float(data.get("price_usd", 0))
    bits_amount = int(data.get("bits_amount", 0))

    if price_usd <= 0 or bits_amount <= 0:
        return jsonify({"success": False, "message": "Datos inválidos"}), 400

    try:
        username = session.get("username", "")
        nombre   = session.get("nombre", "")
        request_id = database.registrar_solicitud_p2p(telegram_id, username, nombre, price_usd, bits_amount)
        return jsonify({"success": True, "request_id": request_id})
    except Exception as e:
        return jsonify({"success": False, "message": str(e)}), 500


@app.route('/api/paypal/capture', methods=['POST'])
def paypal_capture():
    telegram_id = session.get("telegram_id")
    if not telegram_id:
        return jsonify({"success": False, "message": "No autenticado"}), 401

    data = request.json or {}
    order_id = (data.get('order_id') or '').strip()
    expected_usd = float(data.get('amount_usd', 0))
    bits_amount = int(data.get('bits_amount', 0))

    if not order_id or expected_usd <= 0 or bits_amount <= 0:
        return jsonify({"success": False, "message": "Datos de pago inválidos"}), 400

    # ── 1. Deduplicación: evitar procesar el mismo order_id dos veces ──────────
    already = database.get_fb(f"paypal_orders/{order_id}")
    if already:
        return jsonify({"success": False, "message": "Este pago ya fue procesado."}), 409

    # ── 2. Verificar el pago con PayPal (server-side) ─────────────────────────
    import paypal_service
    capture = paypal_service.capture_order(order_id)

    if not capture["success"]:
        print(f"[PayPal Capture] Fallo en verificación: {capture['error_msg']}")
        return jsonify({"success": False, "message": f"PayPal rechazó el pago: {capture['error_msg']}"}), 402

    confirmed_usd = capture["amount_usd"]

    # ── 3. Validación cruzada de monto (tolerancia de $0.02 por redondeo) ─────
    if abs(confirmed_usd - expected_usd) > 0.02:
        print(f"[PayPal Capture] Monto no coincide: esperado ${expected_usd}, recibido ${confirmed_usd}")
        return jsonify({"success": False, "message": "Monto del pago no coincide. Contacta soporte."}), 400

    # ── 4. Marcar la orden como procesada (deduplicación) ─────────────────────
    from datetime import datetime
    database.patch_fb(f"paypal_orders/{order_id}", {
        "telegram_id": str(telegram_id),
        "bits": bits_amount,
        "usd": confirmed_usd,
        "payer_email": capture.get("payer_email", ""),
        "processed_at": datetime.utcnow().isoformat(),
    })

    # ── 5. Acreditar bits y registrar transacción ─────────────────────────────
    try:
        new_balance = database.recargar_bits(telegram_id, bits_amount)
        database.registrar_transaccion(telegram_id, bits_amount, confirmed_usd, 'deposito_paypal')

        if new_balance is not None:
            database.notify_bits_added_paypal(telegram_id, confirmed_usd, bits_amount, new_balance)

        return jsonify({"success": True, "new_bits": new_balance or 0, "payer_email": capture.get("payer_email", "")})
    except Exception as e:
        print(f"[PayPal Capture] Error acreditando bits: {e}")
        return jsonify({"success": False, "message": "Error interno al acreditar bits"}), 500

# =====================================================
# SLOT MACHINE
# =====================================================
@app.route('/slotmachine')
def slotmachine():
    telegram_id = session.get("telegram_id")
    bits = database.obtener_bits(telegram_id) if telegram_id else 0
    photo_url = session.get("photo_url", "")
    return render_template("slotmachine.html", bits=bits, photo_url=photo_url)

# =====================================================
# BLACKJACK
# =====================================================
@app.route('/blackjack')
def blackjack():
    telegram_id = session.get("telegram_id")
    bits = database.obtener_bits(telegram_id) if telegram_id else 0
    photo_url = session.get("photo_url", "")
    return render_template("blackjack.html", bits=bits, telegram_id=telegram_id or "guest", photo_url=photo_url)


# =====================================================
# MOCHE & MULTIPLAYER ROOMS
# =====================================================
@app.route('/moche')
def moche():
    telegram_id = session.get("telegram_id")
    bits = database.obtener_bits(telegram_id) if telegram_id else 0
    photo_url = session.get("photo_url", "")
    # Pasar el room_id si viene en la URL (?room=XYZ)
    room_id = request.args.get('room', '')
    return render_template("moche.html", bits=bits, room_id=room_id, photo_url=photo_url)

@app.route('/api/rooms', methods=['GET', 'POST'])
def handle_rooms():
    if request.method == 'GET':
        return jsonify({"status": "ok", "rooms": manager.get_public_rooms()})
    
    # POST = Create Room
    data = request.get_json()
    telegram_id = session.get("telegram_id", "guest")
    nombre = session.get("nombre", "Invitado")
    
    is_private = data.get("is_private", False)
    difficulty = data.get("difficulty", "easy")
    
    # Establish bet based on difficulty
    bet_amounts = {
        "easy": 50,
        "medium": 150,
        "hard": 350,
        "pro": 700
    }
    bet_amount = bet_amounts.get(difficulty, 50)
    
    total_slots = int(data.get("total_slots", 4))
    
    user = database.obtener_usuario(telegram_id)
    avatar = user["photo_url"] if user else None
    marco = user["marco_actual"] if user else None
    
    room_id = manager.create_room(telegram_id, nombre, is_private, bet_amount, total_slots, difficulty, avatar, marco)
    return jsonify({"status": "ok", "room_id": room_id})

# --- SOCKET.IO LOBBY EVENTS ---

@socketio.on('join_moche_room')
def on_join_moche_room(data):
    room_id = data.get('room_id')
    player_id = session.get('telegram_id', 'guest')
    player_name = session.get('nombre', 'Invitado')
    
    user = database.obtener_usuario(player_id)
    avatar = user["photo_url"] if user else None
    marco = user["marco_actual"] if user else None
    
    success, msg = manager.join_room(room_id, player_id, player_name, avatar, marco)
    if not success:
        emit('room_error', {'message': msg})
        return
        
    join_room(room_id)
    # Save room_id to session side explicitly for disconnects
    session['current_room'] = room_id
    
    emit('room_update', manager.get_room(room_id), to=room_id)

@socketio.on('toggle_ready')
def on_toggle_ready(data):
    room_id = session.get('current_room')
    player_id = session.get('telegram_id')
    if room_id and player_id:
        if manager.toggle_ready(room_id, player_id):
            emit('room_update', manager.get_room(room_id), to=room_id)

@socketio.on('start_moche_game')
def on_start_moche_game():
    room_id = session.get('current_room')
    player_id = session.get('telegram_id')
    
    if not room_id or not player_id:
        return
        
    success, msg = manager.start_game(room_id, player_id)
    if not success:
        emit('room_error', {'message': msg})
        return
        
    # Send personalized state to each player in the room
    room = manager.get_room(room_id)
    for p in room["players"]:
        player_state = manager.get_public_state_for_player(room_id, p["id"])
        # Flask-SocketIO allows targeting a user directly if we track their SID or if they join a room named as their ID.
        # Alternatively we can broadcast the internal states, which is what we'll do: emit to the whole room, 
        # but the client-side will know its own ID and we can just broadcast the full initial structure (hiding cards).
        # To make it truly secure, we should send to `request.sid`. For simplicity in this demo, since players
        # authenticate with telegram_id, we will broadcast a generic "game_started" event, and each client
        # will immediately request their specific state via a callback or follow-up event.
        
    emit('game_started', {'room_id': room_id}, to=room_id)

@socketio.on('request_game_state')
def on_request_game_state():
    room_id = session.get('current_room')
    player_id = session.get('telegram_id')
    if room_id and player_id:
        player_state = manager.get_public_state_for_player(room_id, player_id)
        if player_state:
            emit('game_state_sync', player_state)

@socketio.on('sync_state')
def on_sync_state(data):
    room_id = data.get('room_id')
    state = data.get('STATE')
    # Validamos que se envió un estado
    if not isinstance(state, dict):
        return
        
    s_current_room = session.get('current_room')
    if room_id == s_current_room:
        # Enviar game_state a todos los demás en la sala
        emit('game_state_sync', {'STATE': state, 'phase': state.get('phase', 'JUEGO'), 'hasDrawn': state.get('hasDrawn', False)}, to=room_id, include_self=False)

@socketio.on('leave_moche_room')
def on_leave_moche_room(data):
    room_id = session.get('current_room')
    player_id = session.get('telegram_id')
    if room_id and player_id:
        # First leave socket io room
        leave_room(room_id)
        session.pop('current_room', None)
        
        # Then update engine
        result = manager.leave_room(room_id, player_id)
        if result == "host_left":
            # Emit closure event to all remaining players
            emit('room_closed', {'message': 'El creador ha cerrado la sala de espera.'}, to=room_id)
            # SocketIO will eventually clean up the room, or clients will disconnect and leave
        elif manager.get_room(room_id):
            emit('room_update', manager.get_room(room_id), to=room_id)

@socketio.on('disconnect')
def on_disconnect():
    room_id = session.get('current_room')
    player_id = session.get('telegram_id')
    if room_id and player_id:
        result = manager.leave_room(room_id, player_id)
        if result == "host_left":
            emit('room_closed', {'message': 'El creador se ha desconectado. Sala cerrada.'}, to=room_id)
        elif manager.get_room(room_id):
            emit('room_update', manager.get_room(room_id), to=room_id)

@socketio.on('kick_moche_player')
def on_kick_moche_player(data):
    room_id = session.get('current_room')
    host_id = session.get('telegram_id')
    target_id = data.get('target_id')
    
    if room_id and host_id and target_id:
        success, msg = manager.kick_player(room_id, host_id, target_id)
        if success:
            # Emit custom event to the room so that the target's client can react
            # (they will receive it, identify they are the target, and leave)
            emit('kicked_from_room', {'target_id': target_id, 'message': 'Has sido expulsado de la sala'}, to=room_id)
            emit('room_update', manager.get_room(room_id), to=room_id)


@socketio.on('quick_message')
def on_quick_message(data):
    """Broadcast a quick chat message to all players in the room except the sender."""
    room_id = data.get('room_id') or session.get('current_room')
    sender = data.get('sender', session.get('nombre', 'Jugador'))
    msg = data.get('msg', '')
    if room_id and msg:
        emit('quick_message', {'sender': sender, 'msg': msg}, to=room_id, include_self=False)

@socketio.on('player_bet_increase')
def on_player_bet_increase(data):
    room_id = data.get('room_id') or session.get('current_room')
    if room_id:
        emit('player_bet_increase', data, to=room_id, include_self=False)

@socketio.on('propose_raise')
def on_propose_raise(data):
    room_id = data.get('room_id') or session.get('current_room')
    if room_id:
        emit('propose_raise', data, to=room_id, include_self=False)

@socketio.on('raise_response')
def on_raise_response(data):
    room_id = data.get('room_id') or session.get('current_room')
    if room_id:
        # El Host (cliente 1) debe escuchar esto y decidir cuándo resolver
        emit('raise_response', data, to=room_id, include_self=False)

@socketio.on('raise_resolved')
def on_raise_resolved(data):
    room_id = data.get('room_id') or session.get('current_room')
    if room_id:
        emit('raise_resolved', data, to=room_id, include_self=False)


# =====================================================
# RULETA FRANCESA
# =====================================================
@app.route('/ruleta')
def ruleta():
    telegram_id = session.get("telegram_id")
    bits = database.obtener_bits(telegram_id) if telegram_id else 0
    photo_url = session.get("photo_url", "")
    return render_template("ruleta.html", bits=bits, photo_url=photo_url)

# =====================================================
# SLOT MACHINE API (SECURE ENGINE)
# =====================================================
@app.route('/api/spin', methods=["POST"])
def api_spin():
    if "telegram_id" not in session:
        return jsonify({"status": "error", "message": "Usuario no autenticado"}), 401

    data = request.get_json()
    bet_amount = int(data.get("cantidad", 0))

    if bet_amount <= 0:
        return jsonify({"status": "error", "message": "Cantidad inválida"}), 400

    telegram_id = session["telegram_id"]
    is_demo = session.get('play_mode') == 'demo'

    # Deduct bet securely
    success = database.descontar_bits(telegram_id, bet_amount, is_demo)
    if not success:
        return jsonify({"status": "error", "message": "Fondos insuficientes", "bits": database.obtener_bits(telegram_id, is_demo)}), 400

    # Draw mathematical outcome from Deck Engine
    outcome = slot_engine.draw_spin(is_demo=is_demo)
    # Generate the 5-reel visual symbols from the outcome
    reel_symbols = slot_engine.generate_reels(outcome)
    
    total_win = bet_amount * outcome["multiplier"]
    
    # Record stats
    database.registrar_partida(telegram_id, 'slot_machine', bet_amount, total_win, 'win' if total_win > 0 else 'loss')
    database.incrementar_stat(telegram_id, 'juegos_jugados', 1)
    database.incrementar_stat(telegram_id, 'bits_apostados', bet_amount)

    # Experience mapping
    xp_event = "slot_spin"
    UserProfileManager.add_xp(telegram_id, xp_event)

    # Register win securely if any
    profile_updates = None
    if total_win > 0:
        database.registrar_ganancia(telegram_id, total_win, is_demo)
        if not is_demo:
            database.incrementar_stat(telegram_id, 'bits_ganados', total_win)
            database.incrementar_stat(telegram_id, 'wins_total', 1)
            database.actualizar_racha_victorias(telegram_id, True)
    else:
        database.actualizar_racha_victorias(telegram_id, False)
        
        # Determine win tier for XP
        if outcome["multiplier"] >= 50:
            database.incrementar_stat(telegram_id, 'jackpots_ganados', 1)
            profile_updates = UserProfileManager.add_xp(telegram_id, "slot_jackpot")
        elif outcome["multiplier"] >= 10:
            profile_updates = UserProfileManager.add_xp(telegram_id, "slot_win_large")
        elif outcome["multiplier"] >= 3:
            profile_updates = UserProfileManager.add_xp(telegram_id, "slot_win_medium")
        else:
            profile_updates = UserProfileManager.add_xp(telegram_id, "slot_win_small")

        # Check trophy and mission unlocks after slot win
        try:
            new_trophies = check_and_unlock_trophies(telegram_id)
            if not isinstance(profile_updates, dict):
                profile_updates = {}
            profile_updates['new_trophies'] = new_trophies
        except Exception:
            pass

    bits_actuales = database.obtener_bits(telegram_id, is_demo)

    # Check for newly completable missions
    newly_completed_missions = []
    try:
        newly_completed_missions = check_newly_completed_missions(telegram_id)
    except Exception:
        pass

    return jsonify({
        "status": "ok",
        "bits": bits_actuales,
        "win_amount": total_win,
        "multiplier": outcome["multiplier"],
        "reels": reel_symbols,
        "profile_updates": profile_updates,
        "newly_completed_missions": newly_completed_missions
    })

# =====================================================
# BET (DESCUENTA BITS ANTES DE JUGAR — Usado por Moche / Ruleta)
# =====================================================
@app.route('/bet', methods=["POST"])
def bet():
    if "telegram_id" not in session:
        return jsonify({"status": "error", "message": "Usuario no autenticado"}), 401

    data = request.get_json()
    cantidad = int(data.get("cantidad", 0))
    source = data.get("source", "unknown")

    if cantidad <= 0:
        return jsonify({"status": "error", "message": "Cantidad inválida"}), 400

    telegram_id = session["telegram_id"]
    is_demo = session.get('play_mode') == 'demo'
    success = database.descontar_bits(telegram_id, cantidad, is_demo)
    
    if success:
        profile_updates = {}
        # Award participation XP based on source
        # For multi-game tracking, record a generic "play" action
        database.registrar_partida(telegram_id, source, cantidad, 0, 'loss')
        database.incrementar_stat(telegram_id, 'juegos_jugados', 1)
        database.incrementar_stat(telegram_id, 'bits_apostados', cantidad)

        if source == "moche":
            profile_updates = UserProfileManager.add_xp(telegram_id, "moche_play")
        elif source == "ruleta":
            profile_updates = UserProfileManager.add_xp(telegram_id, "roulette_spin")

        # Check mission progress
        try:
            check_and_unlock_trophies(telegram_id)
        except Exception:
            pass

        # Check for newly completable missions
        newly_completed_missions = []
        try:
            newly_completed_missions = check_newly_completed_missions(telegram_id)
        except Exception:
            pass
            
        bits_actuales = database.obtener_bits(telegram_id, is_demo)
        return jsonify({"status": "ok", "bits": bits_actuales, "profile_updates": profile_updates, "newly_completed_missions": newly_completed_missions})
    else:
        bits_actuales = database.obtener_bits(telegram_id, is_demo)
        return jsonify({"status": "error", "message": "Fondos insuficientes", "bits": bits_actuales}), 400

# =====================================================
# WIN (REGISTRA GANANCIAS DESDE JUEGOS — Usado por Moche / Ruleta)
# =====================================================
@app.route('/win', methods=["POST"])
def win():
    if "telegram_id" not in session:
        return jsonify({"status": "error", "message": "Usuario no autenticado"}), 401

    data = request.get_json()
    cantidad = int(data.get("cantidad", 0))
    source = data.get("source", "unknown")
    multiplier = data.get("multiplier", 1)

    if cantidad <= 0:
        return jsonify({"status": "error", "message": "Cantidad inválida"}), 400

    telegram_id = session["telegram_id"]
    is_demo = session.get('play_mode') == 'demo'
    database.actualizar_ultima_partida_ganada(telegram_id, source, cantidad)
    database.registrar_ganancia(telegram_id, cantidad, is_demo)
    
    if not is_demo:
        database.incrementar_stat(telegram_id, 'bits_ganados', cantidad)
        database.actualizar_racha_victorias(telegram_id, True)
    
    profile_updates = None
    if source == "moche":
        database.incrementar_stat(telegram_id, 'moches_ganados', 1)
        database.incrementar_stat(telegram_id, 'wins_total', 1)
        if multiplier >= 6:
            profile_updates = UserProfileManager.add_xp(telegram_id, "moche_win_double")
        else:
            profile_updates = UserProfileManager.add_xp(telegram_id, "moche_win")
            
    elif source == "ruleta":
        database.incrementar_stat(telegram_id, 'ruletas_ganadas', 1)
        database.incrementar_stat(telegram_id, 'wins_total', 1)
        if multiplier >= 10:
            profile_updates = UserProfileManager.add_xp(telegram_id, "roulette_win_large")
        else:
            profile_updates = UserProfileManager.add_xp(telegram_id, "roulette_win")

    # Check trophy and mission unlocks after a win
    try:
        new_trophies = check_and_unlock_trophies(telegram_id)
        if not isinstance(profile_updates, dict):
            profile_updates = {}
        profile_updates['new_trophies'] = new_trophies
    except Exception:
        pass

    # Check for newly completable missions
    newly_completed_missions = []
    try:
        newly_completed_missions = check_newly_completed_missions(telegram_id)
    except Exception:
        pass

    bits_actuales = database.obtener_bits(telegram_id, is_demo)
    return jsonify({"status": "ok", "bits": bits_actuales, "profile_updates": profile_updates, "newly_completed_missions": newly_completed_missions})

# =====================================================
# USER PROFILE API
# =====================================================
@app.route('/api/profile', methods=["GET"])
def get_profile():
    if "telegram_id" not in session:
        return jsonify({"status": "error", "message": "No autenticado"}), 401
    
    perfil = database.obtener_perfil_completo(session["telegram_id"])
    if not perfil:
        return jsonify({"status": "error", "message": "Perfil no encontrado"}), 404
        
    rank_info = UserProfileManager.get_rank_info(perfil['nivel'])
    progress = UserProfileManager.get_progress(perfil['xp'])
    
    # Ensure all level rewards are properly unlocked (backfills any missed unlocks)
    try:
        UserProfileManager.sync_rewards_for_level(session["telegram_id"], perfil['nivel'])
        # Refresh profile after sync so unlocked_items is up to date
        perfil = database.obtener_perfil_completo(session["telegram_id"])
    except Exception:
        pass
    
    # Calculate Win Ratio
    total_played = perfil.get('juegos_jugados', 0)
    total_wins = perfil.get('wins_total', 0)
    win_ratio = 0
    if total_played > 0:
        win_ratio = round((total_wins / total_played) * 100, 1)

    # Attach calculated stats
    perfil['win_ratio'] = win_ratio
    perfil['tiempo_jugado'] = perfil.get('tiempo_jugado', 0)
    
    # Trophies
    trophies_raw = database.get_trophies(session["telegram_id"])
    trophy_defs = {t['id']: t for t in get_trophy_definitions()}
    trophies = [
        {**trophy_defs[t['trophy_id']], 'unlocked_at': t['unlocked_at']}
        for t in trophies_raw
        if t['trophy_id'] in trophy_defs
    ]
    perfil['trophies'] = trophies

    perfil['rank'] = rank_info
    perfil['progress'] = progress
    perfil['play_mode'] = session.get('play_mode', 'real')
    return jsonify({"status": "ok", "profile": perfil})

@app.route('/api/user/set_mode', methods=["POST"])
def set_play_mode():
    if "telegram_id" not in session:
        return jsonify({"status": "error", "message": "No autenticado"}), 401
    data = request.get_json() or {}
    mode = data.get("mode", "real")
    if mode not in ["real", "demo"]:
        mode = "real"
    session['play_mode'] = mode
    uid = session["telegram_id"]
    return jsonify({"status": "ok", "mode": mode, "bits": database.obtener_bits(uid, mode == 'demo')})

@app.route('/api/profile/ping', methods=["POST"])
def ping_playtime():
    """Endpoint for tracking playtime. Called periodically by the client."""
    if "telegram_id" not in session:
        return jsonify({"status": "error", "message": "No autenticado"}), 401
    
    data = request.get_json() or {}
    minutes = int(data.get("minutes", 1)) # Default 1 min
    
    success = database.incrementar_tiempo_jugado(session["telegram_id"], minutes)
    if success:
        return jsonify({"status": "ok"})
    return jsonify({"status": "error"}), 500

@app.route('/api/profile/equip', methods=["POST"])
def equip_item():
    if "telegram_id" not in session:
        return jsonify({"status": "error", "message": "No autenticado"}), 401
        
    data = request.get_json()
    item_type = data.get("type")
    item_id = data.get("id")
    
    if database.equipar_item(session["telegram_id"], item_type, item_id):
        return jsonify({"status": "ok"})
    return jsonify({"status": "error", "message": "No posees este elemento o tipo inválido."}), 400

@app.route('/api/profile/update_name', methods=["POST"])
def update_profile_name():
    if "telegram_id" not in session:
        return jsonify({"status": "error", "message": "No autenticado"}), 401
        
    data = request.get_json()
    new_name = data.get("name", "").strip()
    
    if len(new_name) < 3 or len(new_name) > 20:
        return jsonify({"status": "error", "message": "El nombre debe tener entre 3 y 20 caracteres."}), 400
        
    if database.actualizar_nombre_usuario(session["telegram_id"], new_name):
        session["nombre"] = new_name
        return jsonify({"status": "ok", "name": new_name})
    return jsonify({"status": "error", "message": "Error al actualizar el nombre (quizá ya exista o sea inválido)."}), 400

@app.route('/api/profile/daily_reward', methods=["POST"])
def claim_daily_reward():
    from datetime import datetime
    if "telegram_id" not in session:
        return jsonify({"status": "error", "message": "No autenticado"}), 401
        
    telegram_id = session["telegram_id"]
    perfil = database.obtener_perfil_completo(telegram_id)
    
    hoy = datetime.utcnow().date()
    hoy_str = hoy.isoformat()
    
    last_reward_str = perfil.get("last_daily_reward")
    racha = perfil.get("daily_streak", 0)
    
    if last_reward_str == hoy_str:
        return jsonify({"status": "error", "message": "Ya reclamaste tu recompensa hoy. ¡Vuelve mañana!"}), 400
        
    if last_reward_str:
        from datetime import timedelta
        last_date = datetime.strptime(last_reward_str, "%Y-%m-%d").date()
        if hoy - last_date == timedelta(days=1):
            racha += 1
        else:
            racha = 1 # Se rompió la racha
    else:
        racha = 1
        
    # Reward calculation: 100 base + 50 for every streak day (max 500 bits per day)
    reward_bits = min(100 + (racha - 1) * 50, 500)
    
    if database.reclamar_recompensa_diaria(telegram_id, hoy_str, reward_bits, racha):
        return jsonify({
            "status": "ok",
            "reward": reward_bits,
            "streak": racha,
            "bits_actuales": database.obtener_bits(telegram_id)
        })
    return jsonify({"status": "error", "message": "Error procesando la recompensa."}), 500

@app.route('/api/ranking/top3', methods=["GET"])
def get_top_3_ranking():
    # Obtener todos, ordenar por experiencia, tomar 3. 
    # Idealmente en producción esto es un SELECT directo (ORDER BY xp DESC LIMIT 3)
    # Por ahora en SQLite filtramos de obtener_todos_usuarios para agilidad
    usuarios = database.obtener_todos_usuarios()
    # Sort by XP descending, and if tied, bits ascending as tie breaker
    sorted_users = sorted(usuarios, key=lambda u: u.get("xp", 0), reverse=True)
    top3 = sorted_users[:3]
    return jsonify({"status": "ok", "top3": top3})

@app.route('/api/profile/<user_id>', methods=["GET"])
def get_public_profile(user_id):
    perfil = database.obtener_perfil_completo(user_id)
    if not perfil:
        return jsonify({"status": "error", "message": "Usuario no encontrado"}), 404
        
    rank_info = UserProfileManager.get_rank_info(perfil['nivel'])
    progress = UserProfileManager.get_progress(perfil['xp'])

    # Fetch trophies
    trophies_raw = database.get_trophies(user_id)
    trophy_defs = {t['id']: t for t in get_trophy_definitions()}
    trophies = [
        {**trophy_defs[t['trophy_id']], 'unlocked_at': t['unlocked_at']}
        for t in trophies_raw
        if t['trophy_id'] in trophy_defs
    ]

    # Only expose public data
    public_data = {
        "id": perfil["telegram_id"],
        "nombre": perfil["nombre"],
        "nivel": perfil["nivel"],
        "xp": perfil["xp"],
        "rango": rank_info["full_name"] if "full_name" in rank_info else rank_info["nombre"],
        "rank_icon": rank_info["icon"],
        "marco": perfil["avatar_frame"],
        "photo_url": perfil["photo_url"],
        "jackpots_ganados": perfil.get("jackpots_ganados", 0),
        "moches_ganados": perfil.get("moches_ganados", 0),
        "ruletas_ganadas": perfil.get("ruletas_ganadas", 0),
        "wins_total": perfil.get("wins_total", 0),
        "trophies": trophies,
        "progress": progress
    }
    return jsonify({"status": "ok", "profile": public_data})

# =====================================================
# USER INBOX (MESSAGES FROM ADMIN)
# =====================================================
@app.route('/api/user/messages', methods=['GET'])
def get_user_messages():
    if "telegram_id" not in session:
        return jsonify({"status": "error", "message": "No autenticado"}), 401
    uid = session["telegram_id"]
    msgs = database.get_fb(f"mensajes/{uid}") or {}
    
    result = []
    for k, m in msgs.items():
        result.append({**m, 'id': k})
    
    # Sort newest first
    result.sort(key=lambda x: x.get('sent_at', ''), reverse=True)
    
    unread_count = sum(1 for m in result if not m.get('read'))
    return jsonify({"status": "ok", "messages": result, "unread": unread_count})

@app.route('/api/user/messages/read', methods=['POST'])
def mark_message_read():
    if "telegram_id" not in session:
        return jsonify({"status": "error", "message": "No autenticado"}), 401
    
    data = request.get_json() or {}
    msg_id = data.get('msg_id')
    if not msg_id:
        return jsonify({"status": "error", "message": "msg_id requerido"}), 400
        
    uid = session["telegram_id"]
    database.patch_fb(f"mensajes/{uid}/{msg_id}", {"read": True})
    return jsonify({"status": "ok"})


# =====================================================
# TROPHIES & MISSIONS API
# =====================================================
@app.route('/api/trophies', methods=["GET"])
def get_trophies():
    if "telegram_id" not in session:
        return jsonify({"status": "error", "message": "No autenticado"}), 401

    telegram_id = session["telegram_id"]
    trophies_raw = database.get_trophies(telegram_id)
    unlocked_ids = {t['trophy_id'] for t in trophies_raw}
    unlocked_map = {t['trophy_id']: t['unlocked_at'] for t in trophies_raw}

    all_defs = get_trophy_definitions()
    trophies = [
        {
            **t,
            "unlocked": t['id'] in unlocked_ids,
            "unlocked_at": unlocked_map.get(t['id'])
        }
        for t in all_defs
    ]
    return jsonify({"status": "ok", "trophies": trophies})


@app.route('/api/missions', methods=["GET"])
def get_missions():
    if "telegram_id" not in session:
        return jsonify({"status": "error", "message": "No autenticado"}), 401

    telegram_id = session["telegram_id"]
    missions = get_user_missions_with_progress(telegram_id)
    return jsonify({"status": "ok", "missions": missions})


@app.route('/api/missions/claim', methods=["POST"])
def claim_mission():
    if "telegram_id" not in session:
        return jsonify({"status": "error", "message": "No autenticado"}), 401

    data = request.get_json()
    mission_id = data.get("mission_id")
    if not mission_id:
        return jsonify({"status": "error", "message": "mission_id requerido"}), 400

    result = claim_mission_reward(session["telegram_id"], mission_id)
    if result["status"] == "ok":
        result["bits"] = database.obtener_bits(session["telegram_id"])
    return jsonify(result)

# =====================================================
# THEMES (PUBLIC API)
# =====================================================
@app.route('/api/themes/active')
def api_active_theme():
    """Returns the currently active global theme (public, no auth required)."""
    theme = database.get_active_theme()
    return jsonify(theme)

# =====================================================
# ADMIN (Manejado por admin_routes.py Blueprint)
# =====================================================

# =====================================================
# TELEGRAM POLLING THREAD + BOT COMMANDS
# =====================================================
import threading
import time
import requests

try:
    from config import BOT_TOKEN, WEBAPP_URL
except ImportError:
    BOT_TOKEN = None
    WEBAPP_URL = ""

def _send_bot(chat_id, text, reply_markup=None, parse_mode="HTML"):
    """Send a message via Telegram Bot API."""
    if not BOT_TOKEN:
        return
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/sendMessage"
    payload = {"chat_id": chat_id, "text": text, "parse_mode": parse_mode}
    if reply_markup:
        payload["reply_markup"] = reply_markup
    try:
        requests.post(url, json=payload, timeout=8)
    except Exception as e:
        print(f"[TG Send Error] {e}")

def _handle_start(chat_id, first_name, username, photo_url, start_param):
    """Handle /start — register user and optionally process referral."""
    referrer_id = None
    if start_param and start_param.startswith("ref_"):
        referrer_id = start_param[4:]

    is_new = database.register_new_user_from_bot(
        str(chat_id), first_name, username, photo_url or "", referrer_id
    )

    gamble_link = WEBAPP_URL or "https://t.me/"
    if "t.me" in gamble_link:
        btn = {"inline_keyboard": [[
            {"text": "🎰 Abrir Casino", "url": gamble_link}
        ]]}
    else:
        btn = {"inline_keyboard": [[
            {"text": "🎰 Abrir Casino", "web_app": {"url": gamble_link}}
        ]]}

    if is_new:
        texto = (
            f"👋 ¡Bienvenido, <b>{first_name}</b>! 🎉\n\n"
            f"Tu perfil ha sido creado exitosamente.\n"
            f"💎 Has recibido <b>5,500 Bits Demo</b> de regalo para empezar a jugar.\n\n"
            f"🎮 Pulsa el botón para abrir el casino:"
        )
    else:
        perfil = database.obtener_perfil_completo(str(chat_id)) or {}
        bits = database.obtener_bits(str(chat_id))
        texto = (
            f"👋 ¡Hola de nuevo, <b>{first_name}</b>!\n\n"
            f"💰 Tus bits reales: <b>{bits:,}</b>\n"
            f"⭐ Nivel: {perfil.get('nivel', 1)}\n\n"
            f"🎮 Pulsa el botón para continuar jugando:"
        )
    _send_bot(chat_id, texto, reply_markup=btn)

def _handle_info(chat_id, first_name):
    """Handle /info — show player stats."""
    chat_id_str = str(chat_id)
    perfil = database.obtener_perfil_completo(chat_id_str)
    if not perfil:
        _send_bot(chat_id, "❌ No tienes un perfil registrado. Usa /start para comenzar.")
        return

    invite_stats = database.get_invite_stats(chat_id_str)
    bits = database.obtener_bits(chat_id_str)
    bits_demo = database.obtener_bits(chat_id_str, is_demo=True)
    username = perfil.get("username", "")
    username_str = f"@{username}" if username else "—"

    texto = (
        f"📊 <b>Tu Perfil — {first_name}</b>\n"
        f"━━━━━━━━━━━━━━━━━━━━\n"
        f"🆔 ID Telegram: <code>{chat_id}</code>\n"
        f"👤 Usuario: {username_str}\n"
        f"💰 Bits Reales: <b>{bits:,}</b>\n"
        f"🎭 Bits Demo: <b>{bits_demo:,}</b>\n"
        f"⭐ XP: <b>{perfil.get('xp', 0):,}</b>\n"
        f"🏆 Nivel: <b>{perfil.get('nivel', 1)}</b>\n"
        f"📨 Invitaciones realizadas: <b>{invite_stats['total_invitaciones']}</b>\n"
        f"━━━━━━━━━━━━━━━━━━━━"
    )
    _send_bot(chat_id, texto)

def _handle_invite(chat_id, first_name):
    """Handle /invite — generate personal referral link."""
    link = f"https://t.me/Zona_Jackpot_777bot?start=ref_{chat_id}"
    texto = (
        f"🎁 <b>Tu link de invitación personal:</b>\n\n"
        f"<code>{link}</code>\n\n"
        f"📌 Comparte este link con tus amigos.\n"
        f"✅ Cuando un amigo <b>nuevo</b> abra el casino por primera vez usando tu link, "
        f"recibirás <b>+1,000 Bits Demo</b> de regalo automáticamente.\n\n"
        f"⚠️ La recompensa solo se otorga si el jugador no tenía cuenta previa."
    )
    share_url = f"https://t.me/share/url?url={link}&text=%F0%9F%8E%B0+%C3%9Anete+al+casino+conmigo%21"
    btn = {"inline_keyboard": [[
        {"text": "📤 Compartir link", "url": share_url}
    ]]}
    _send_bot(chat_id, texto, reply_markup=btn)

# Admin Telegram usernames that receive recharge notifications
ADMIN_TELEGRAM_USERS = ["@Cortezalex17", "@antraxx_g59", "@Young_plague_FTP"]

# Recharge packages: USD -> (bits label, bonus bits)
RECHARGE_PACKAGES = {
    "1":  {"usd": 1,  "bits": 1000,  "bonus": 0,     "label": "💵 1 USD → 1,000 Bits"},
    "5":  {"usd": 5,  "bits": 5000,  "bonus": 500,   "label": "💵 5 USD → 5,500 Bits (+500)"},
    "10": {"usd": 10, "bits": 10000, "bonus": 2000,  "label": "💵 10 USD → 12,000 Bits (+2,000)"},
    "20": {"usd": 20, "bits": 20000, "bonus": 6000,  "label": "💵 20 USD → 26,000 Bits (+6,000)"},
    "50": {"usd": 50, "bits": 50000, "bonus": 20000, "label": "💵 50 USD → 70,000 Bits (+20,000)"},
}

def _answer_callback(callback_query_id, text=""):
    """Dismiss the loading spinner on the user's Telegram button."""
    if not BOT_TOKEN:
        return
    try:
        requests.post(
            f"https://api.telegram.org/bot{BOT_TOKEN}/answerCallbackQuery",
            json={"callback_query_id": callback_query_id, "text": text},
            timeout=5
        )
    except Exception:
        pass

def _handle_recharge(chat_id):
    """Step 1 — Player picks which admin to contact."""
    texto = (
        f"💳 <b>Recarga de Bits Reales</b>\n"
        f"━━━━━━━━━━━━━━━━━━━━\n"
        f"👤 <b>Elige el administrador</b> al que deseas enviar tu solicitud de recarga:\n\n"
        f"💵 1 USD  →  <b>1,000 Bits</b>\n"
        f"💵 5 USD  →  <b>5,000 Bits</b>  (+500)\n"
        f"💵 10 USD →  <b>10,000 Bits</b> (+2,000)\n"
        f"💵 20 USD →  <b>20,000 Bits</b> (+6,000)\n"
        f"💵 50 USD →  <b>50,000 Bits</b> (+20,000)\n"
        f"━━━━━━━━━━━━━━━━━━━━\n"
        f"⤵️ Selecciona un administrador para continuar:"
    )
    btn = {"inline_keyboard": [
        [{"text": "👨‍💻 Young plague FTP",  "callback_data": "adm_0"}],
        [{"text": "👨‍💻 antraxx g59",       "callback_data": "adm_1"}],
        [{"text": "👨‍💻 Cortezalex17",     "callback_data": "adm_2"}],
    ]}
    _send_bot(chat_id, texto, reply_markup=btn)

def _handle_admin_pick(callback_query_id, chat_id, adm_idx):
    """Step 2 — Player picked an admin, now choose the amount."""
    admin_names = ["Young plague", "Antraxx", "Alex Cortez"]
    adm_display = ["@Young_plague_FTP", "@antraxx_g59", "@Cortezalex17"]
    if adm_idx < 0 or adm_idx >= len(admin_names):
        _answer_callback(callback_query_id, "Administrador no válido.")
        return
    _answer_callback(callback_query_id)
    texto = (
        f"📄 <b>Solicitud para {adm_display[adm_idx]}</b>\n"
        f"━━━━━━━━━━━━━━━━━━━━\n"
        f"Ahora elige el <b>monto de recarga</b> que deseas:\n"
    )
    btn = {"inline_keyboard": [
        [{"text": "💵 1 USD — 1,000 Bits",   "callback_data": f"rc_1_{adm_idx}"}],
        [{"text": "💵 5 USD — 5,500 Bits",   "callback_data": f"rc_5_{adm_idx}"}],
        [{"text": "💵 10 USD — 12,000 Bits", "callback_data": f"rc_10_{adm_idx}"}],
        [{"text": "💵 20 USD — 26,000 Bits", "callback_data": f"rc_20_{adm_idx}"}],
        [{"text": "💵 50 USD — 70,000 Bits", "callback_data": f"rc_50_{adm_idx}"}],
        [{"text": "⬅️ Volver",                  "callback_data": "back_recharge"}],
    ]}
    _send_bot(chat_id, texto, reply_markup=btn)

# Known admin usernames (without @) for auto-registration
ADMIN_USERNAMES_LOWER = {"young_plague_ftp", "antraxx_g59", "cortezalex17"}

def _get_admin_chat_id(username_key: str):
    """Look up stored numeric chat_id for an admin by their username (no @)."""
    return database.get_fb(f"admin_telegram_chat_ids/{username_key.lower()}")

def _save_admin_chat_id(username: str, chat_id):
    """Persist admin username → numeric chat_id mapping in Firebase."""
    if username:
        database.patch_fb("admin_telegram_chat_ids", {username.lower(): str(chat_id)})

def _handle_recharge_callback(callback_query_id, chat_id, first_name, username, pkg_key, adm_idx):
    """Step 3 — Player confirmed amount. Notify the chosen admin ONLY."""
    pkg = RECHARGE_PACKAGES.get(pkg_key)
    if not pkg:
        _answer_callback(callback_query_id, "Opción no válida.")
        return

    admin_display     = ["@Young_plague_FTP", "@antraxx_g59", "@Cortezalex17"]
    admin_usernames_k = ["young_plague_ftp",  "antraxx_g59",  "cortezalex17"]
    if adm_idx < 0 or adm_idx >= len(admin_display):
        _answer_callback(callback_query_id, "Administrador no válido.")
        return
    target_display  = admin_display[adm_idx]
    target_uname_k  = admin_usernames_k[adm_idx]

    # Look up the admin's real numeric chat_id from Firebase
    admin_numeric_id = _get_admin_chat_id(target_uname_k)

    username_str = f"@{username}" if username else "(sin usuario)"
    usd      = pkg["usd"]
    bits     = pkg["bits"]
    bonus    = pkg["bonus"]
    bits_fmt = f"{bits:,}"

    # 1. Dismiss spinner and confirm to the player
    _answer_callback(callback_query_id, "✅ ¡Solicitud enviada!")
    _send_bot(chat_id,
        f"✅ <b>¡Solicitud de recarga enviada!</b>\n\n"
        f"💵 Monto: <b>{usd} USD</b>\n"
        f"💎 Recibirás: <b>{bits_fmt} Bits</b>"
        + (f" (+{bonus:,} bonus)" if bonus else "") +
        f"\n👤 Administrador: <b>{target_display}</b>\n\n"
        f"📩 El administrador revisará tu solicitud y acreditará los bits pronto. "
        f"Si tienes dudas, escríbenos directamente aquí."
    )

    # 2. Notify the CHOSEN admin via their numeric chat_id
    admin_msg = (
        f"🔔 <b>SOLICITUD DE RECARGA — {usd} USD</b>\n"
        f"━━━━━━━━━━━━━━━━━━━━\n"
        f"👤 Jugador: <b>{first_name}</b>\n"
        f"🆔 Telegram ID: <code>{chat_id}</code>\n"
        f"📛 Usuario: {username_str}\n"
        f"━━━━━━━━━━━━━━━━━━━━\n"
        f"💵 Monto: <b>{usd} USD</b>\n"
        f"💎 Bits a acreditar: <b>{bits_fmt} Bits</b>"
        + (f" (+{bonus:,} bonus)" if bonus else "") +
        f"\n━━━━━━━━━━━━━━━━━━━━\n"
        f"⚡ Busca al jugador en el panel admin por ID: <code>{chat_id}</code>"
    )
    if admin_numeric_id:
        _send_bot(int(admin_numeric_id), admin_msg)
        print(f"[Recharge] Notification sent to {target_display} (id={admin_numeric_id})")
    else:
        # Admin hasn't started the bot yet — notify player and log
        _send_bot(chat_id,
            f"⚠️ El administrador {target_display} aún no ha iniciado el bot.\n"
            f"Por favor inténtalo de nuevo o contacta directamente a {target_display} en Telegram."
        )
        print(f"[Recharge] No chat_id stored for admin {target_display}. Ask them to /start the bot.")

def _handle_unknown(chat_id):
    _send_bot(chat_id, (
        "🤖 <b>Comandos disponibles:</b>\n\n"
        "/start — Iniciar o reanudar el juego\n"
        "/info — Ver tu perfil e información\n"
        "/invite — Obtener tu link de referidos\n"
        "/recharge — Ver opciones de recarga\n\n"
        "💡 O simplemente escríbeme para chatear con soporte."
    ))

# =====================================================
# TELEGRAM WEBHOOK ROUTE
# =====================================================
@app.route(f"/webhook/{BOT_TOKEN}", methods=["POST"])
def telegram_webhook():
    if not BOT_TOKEN:
        return jsonify({"status": "error", "message": "BOT_TOKEN no configurado"}), 500

    update = request.get_json()
    if not update:
        return "OK", 200

    try:
        # ── Handle inline button presses (callback queries) ──────
        cq = update.get("callback_query")
        if cq:
            cq_id        = cq["id"]
            cq_data      = cq.get("data", "")
            cq_from      = cq.get("from", {})
            cq_chat_id   = cq_from.get("id") or cq.get("message", {}).get("chat", {}).get("id")
            cq_first_name = cq_from.get("first_name", f"Usuario{cq_chat_id}")
            cq_username   = cq_from.get("username", "")

            if cq_data.startswith("adm_"):
                # Step 1 → 2: admin selected
                try:
                    adm_idx = int(cq_data.split("_", 1)[1])
                except (ValueError, IndexError):
                    adm_idx = -1
                _handle_admin_pick(cq_id, cq_chat_id, adm_idx)

            elif cq_data.startswith("rc_"):
                # Step 2 → 3: amount selected (format: rc_AMOUNT_ADMIDX)
                parts_cq = cq_data.split("_")
                try:
                    pkg_key = parts_cq[1]
                    adm_idx = int(parts_cq[2])
                except (ValueError, IndexError):
                    _answer_callback(cq_id, "Error en la selección.")
                    return "OK", 200
                _handle_recharge_callback(cq_id, cq_chat_id, cq_first_name, cq_username, pkg_key, adm_idx)

            elif cq_data == "back_recharge":
                _answer_callback(cq_id)
                _handle_recharge(cq_chat_id)

            else:
                _answer_callback(cq_id)
            return "OK", 200
        # ── End callback handling ────────────────────────────────

        msg = update.get("message")
        if not msg or not msg.get("text"):
            return "OK", 200

        text = msg["text"].strip()
        chat_id = msg["chat"]["id"]
        from_info = msg.get("from") or msg.get("chat") or {}
        first_name = from_info.get("first_name", f"Usuario{chat_id}")
        username = from_info.get("username", "")
        photo_url = ""

        # ── Auto-register admin chat_ids when they interact with the bot ──
        if username and username.lower() in ADMIN_USERNAMES_LOWER:
            _save_admin_chat_id(username, chat_id)
            print(f"[Admin] Registered chat_id {chat_id} for @{username}")
        # ──────────────────────────────────────────────────────

        # Extract base command (strip @botname suffix if present)
        parts = text.split()
        cmd_raw = parts[0].split("@")[0].lower() if text.startswith("/") else ""
        start_param = parts[1] if (cmd_raw == "/start" and len(parts) > 1) else None

        if cmd_raw == "/start":
            _handle_start(chat_id, first_name, username, photo_url, start_param)
        elif cmd_raw == "/info":
            _handle_info(chat_id, first_name)
        elif cmd_raw == "/invite":
            _handle_invite(chat_id, first_name)
        elif cmd_raw == "/recharge":
            _handle_recharge(chat_id)
        elif text.startswith("/"):
            _handle_unknown(chat_id)
        else:
            # Regular support message — save to Firebase
            database.save_user_telegram_msg(chat_id, first_name, username, text, "user")
            
    except Exception as e:
        print(f"[webhook] error: {e}")

    return "OK", 200

@app.route("/set_webhook", methods=["GET"])
def set_webhook():
    """Ruta manual para registrar el Webhook en Telegram."""
    if not BOT_TOKEN:
        return "El BOT_TOKEN no está configurado en config.py", 400
        
    # Usar la URL base de donde venga la petición. Si es ngrok o render, request.url_root devolverá el dominio
    host_url = request.url_root.replace("http://", "https://") 
    webhook_url = f"{host_url}webhook/{BOT_TOKEN}"
    
    # Llamar a Telegram API
    url = f"https://api.telegram.org/bot{BOT_TOKEN}/setWebhook"
    try:
        res = requests.post(url, json={"url": webhook_url}, timeout=10)
        data = res.json()
        if data.get("ok"):
            return f"Webhook configurado exitosamente a: {webhook_url}", 200
        else:
            return f"Error de Telegram: {data.get('description')}", 400
    except Exception as e:
        return f"Error interno configurando webhook: {e}", 500

# =====================================================
# MARKETING AUTOMATIZADO - CRON ENDPOINT
# =====================================================

@app.route("/api/cron/marketing", methods=["GET", "POST"])
def cron_marketing():
    """
    Endpoint llamado periódicamente por cron-job.org para disparar el
    envío masivo de mensajes si corresponde a la hora objetivo de hoy.

    URL ejemplo: https://tu-casino.onrender.com/api/cron/marketing?key=zonajackpot777_cron_2026
    """
    provided_key = request.args.get("key", "")
    result = marketing_service.check_and_trigger(CRON_SECRET, provided_key)
    
    # También aprovechamos el hook del cron para revisar las apuestas automáticas en background
    if provided_key == CRON_SECRET:
        import threading
        # Lanzar la revisión automática de apuestas en un hilo secundario
        resolver_thread = threading.Thread(target=sports_resolver.run_resolver, daemon=True)
        resolver_thread.start()
        
    return jsonify(result)


@app.route("/admin/api/marketing/status", methods=["GET"])
def admin_marketing_status():
    """Devuelve el estado de la campaña de marketing de hoy para el panel admin."""
    admin_logged_in = session.get("admin_logged_in")
    if not admin_logged_in:
        return jsonify({"success": False, "message": "No autorizado"}), 403
    status = marketing_service.get_status()
    return jsonify({"success": True, "status": status})


@app.route("/admin/api/marketing/send-now", methods=["POST"])
def admin_marketing_send_now():
    """Permite al admin disparar la campaña de marketing manualmente desde el panel."""
    admin_logged_in = session.get("admin_logged_in")
    if not admin_logged_in:
        return jsonify({"success": False, "message": "No autorizado"}), 403
    # Forzar el envío inmediato pasando la clave internamente
    result = marketing_service.check_and_trigger(CRON_SECRET, CRON_SECRET)
    return jsonify({"success": True, "result": result})


# =====================================================
# MAIN
# =====================================================
if __name__ == "__main__":
    database.init_db()
    port = int(os.environ.get("PORT", 10000))
    socketio.run(app, host="0.0.0.0", port=port, debug=False)