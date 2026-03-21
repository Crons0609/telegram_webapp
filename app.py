from flask import Flask, render_template, request, jsonify, session, redirect, url_for
from flask_socketio import SocketIO, emit, join_room, leave_room
import database
from moche_engine import manager
from slot_engine import slot_engine
from user_profile_manager import UserProfileManager
from trophy_manager import check_and_unlock_trophies, get_trophy_definitions
from mission_manager import get_user_missions_with_progress, claim_mission_reward, check_newly_completed_missions
import os

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

# Inicializamos la base de datos
database.init_db()

# Registrar Panel de Administración
from admin_routes import admin_bp
app.register_blueprint(admin_bp)

# Registrar Deportes
from sports_routes import sports_bp
app.register_blueprint(sports_bp)

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
            context['global_profile'] = perfil
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
        bits = database.obtener_bits(telegram_id)
        return render_template("index.html", nombre=nombre, username=username, telegram_id=telegram_id, bits=bits, photo_url=photo_url)
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
        bits = database.obtener_bits(telegram_id)
        return render_template("juegos.html", nombre=nombre, username=username, telegram_id=telegram_id, bits=bits, photo_url=photo_url)
    else:
        # TEST MODE
        test_id = "12345"
        test_nombre = "Usuario de Prueba"
        bits = database.obtener_bits(test_id)
        return render_template("juegos.html", nombre=test_nombre, username="tester", telegram_id=test_id, bits=bits, photo_url="")

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
# PAYPAL BITS
# =====================================================
@app.route('/paypal_bits')
def paypal_bits():
    telegram_id = session.get("telegram_id")
    if not telegram_id:
        return redirect(url_for('index'))
    return render_template("paypal.html")

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
        
    data = request.json
    order_id = data.get('order_id')
    amount_usd = float(data.get('amount_usd', 0))
    bits_amount = int(data.get('bits_amount', 0))
    
    if amount_usd <= 0 or bits_amount <= 0:
        return jsonify({"success": False, "message": "Cantidades inválidas"}), 400

    try:
        # Añadir los bits al usuario
        database.recargar_bits(telegram_id, bits_amount)
        # Registrar la transacción
        database.registrar_transaccion(telegram_id, bits_amount, amount_usd, 'deposito')
        
        # Obtener nuevo saldo para retornar
        new_balance = database.obtener_bits(telegram_id)
        return jsonify({"success": True, "new_bits": new_balance})
    except Exception as e:
        print(f"Error procesando PayPal: {e}")
        return jsonify({"success": False, "message": "Error interno"}), 500

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

    # Deduct bet securely
    success = database.descontar_bits(telegram_id, bet_amount)
    if not success:
        return jsonify({"status": "error", "message": "Fondos insuficientes", "bits": database.obtener_bits(telegram_id)}), 400

    # Draw mathematical outcome from Deck Engine
    outcome = slot_engine.draw_spin()
    # Generate the 5-reel visual symbols from the outcome
    reel_symbols = slot_engine.generate_reels(outcome)
    # Record stats
    database.registrar_partida(telegram_id, 'slot_machine', bet_amount, total_win, 'win' if total_win > 0 else 'loss')
    database.incrementar_stat(telegram_id, 'juegos_jugados', 1)
    database.incrementar_stat(telegram_id, 'bits_apostados', bet_amount)


    # Experience mapping
    xp_event = "slot_spin"
    UserProfileManager.add_xp(telegram_id, xp_event)

    total_win = bet_amount * outcome["multiplier"]

    # Register win securely if any
    profile_updates = None
    if total_win > 0:
        database.registrar_ganancia(telegram_id, total_win)
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

    bits_actuales = database.obtener_bits(telegram_id)

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
    success = database.descontar_bits(telegram_id, cantidad)
    
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
            
        bits_actuales = database.obtener_bits(telegram_id)
        return jsonify({"status": "ok", "bits": bits_actuales, "profile_updates": profile_updates, "newly_completed_missions": newly_completed_missions})
    else:
        bits_actuales = database.obtener_bits(telegram_id)
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
    database.actualizar_ultima_partida_ganada(telegram_id, source, cantidad)
    database.registrar_ganancia(telegram_id, cantidad)
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

    bits_actuales = database.obtener_bits(telegram_id)
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
    return jsonify({"status": "ok", "profile": perfil})

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
# MAIN
# =====================================================
if __name__ == "__main__":
    database.init_db()
    port = int(os.environ.get("PORT", 10000))
    socketio.run(app, host="0.0.0.0", port=port, debug=False)