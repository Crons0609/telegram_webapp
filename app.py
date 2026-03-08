from flask import Flask, render_template, request, jsonify, session
from flask_socketio import SocketIO, emit, join_room, leave_room
import database
from moche_engine import manager
from slot_engine import slot_engine
from user_profile_manager import UserProfileManager
from trophy_manager import check_and_unlock_trophies, get_trophy_definitions
from mission_manager import get_user_missions_with_progress, claim_mission_reward
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

# Inicializamos la base de datos
database.init_db()

@app.context_processor
def inject_user_profile():
    if "telegram_id" in session:
        telegram_id = session["telegram_id"]
        perfil = database.obtener_perfil_completo(telegram_id)
        if perfil:
            rank_info = UserProfileManager.get_rank_info(perfil['nivel'])
            progress = UserProfileManager.get_progress(perfil['xp'])
            perfil['rank'] = rank_info
            perfil['progress'] = progress
            # Extract basic bits if necessary, it's already in perfil.
            return dict(global_profile=perfil)
    return dict(global_profile=None)

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
        # TEST MODE: Provide a test user with bits when running locally
        test_id = "12345"
        test_nombre = "Usuario de Prueba"
        
        # Add test user to database if it doesn't exist to ensure /bet works
        database.agregar_usuario(test_id, test_nombre, "tester")
        
        # Give them 500 bits if they have less
        bits = database.obtener_bits(test_id)
        if bits < 500:
            database.recargar_bits(test_id, 500)
            bits = database.obtener_bits(test_id)
            
        session["telegram_id"] = test_id
        session["nombre"] = test_nombre
        session["username"] = "tester"
        session["photo_url"] = ""
        
        return render_template("index.html", nombre=test_nombre, username="tester", telegram_id=test_id, bits=bits, photo_url="")

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

    return jsonify({"status": "ok"})

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

@app.route('/api/moche/matchmake', methods=['POST'])
def moche_matchmake():
    telegram_id = session.get("telegram_id", "guest")
    nombre = session.get("nombre", "Invitado")
    
    user = database.obtener_usuario(telegram_id)
    avatar = user["photo_url"] if user else None
    marco = user["marco_actual"] if user else None
    
    public_rooms = manager.get_public_rooms()
    if public_rooms:
        room_id = public_rooms[0]["id"]
        success, msg = manager.join_room(room_id, telegram_id, nombre, avatar, marco)
        if success:
            session['current_room'] = room_id
            return jsonify({"status": "ok", "room_id": room_id})
            
    # Auto create if not found
    room_id = manager.create_room(telegram_id, nombre, False, 50, 4, "easy", avatar, marco)
    session['current_room'] = room_id
    return jsonify({"status": "ok", "room_id": room_id})

# --- SUPABASE MOCHE API OVERHAUL ---
@app.route('/api/moche/join', methods=['POST'])
def moche_join():
    data = request.get_json()
    room_id = data.get('room_id')
    player_id = session.get('telegram_id', 'guest')
    player_name = session.get('nombre', 'Invitado')
    
    user = database.obtener_usuario(player_id)
    avatar = user["photo_url"] if user else None
    marco = user["marco_actual"] if user else None
    
    success, msg = manager.join_room(room_id, player_id, player_name, avatar, marco)
    if not success:
        return jsonify({"status": "error", "message": msg}), 400
        
    session['current_room'] = room_id
    return jsonify({"status": "ok", "message": msg})

@app.route('/api/moche/ready', methods=['POST'])
def moche_ready():
    room_id = session.get('current_room')
    player_id = session.get('telegram_id')
    if room_id and player_id:
        if manager.toggle_ready(room_id, player_id):
            return jsonify({"status": "ok"})
    return jsonify({"status": "error", "message": "No en sala"}), 400

@app.route('/api/moche/start', methods=['POST'])
def moche_start():
    room_id = session.get('current_room')
    player_id = session.get('telegram_id')
    if not room_id or not player_id:
        return jsonify({"status": "error", "message": "Sesión inválida"}), 400
    
    room = manager.get_room(room_id)
    if not room:
        return jsonify({"status": "error", "message": "Sala no encontrada"}), 400

    if str(room['host']) != str(player_id):
        return jsonify({"status": "error", "message": "Solo el anfitrión puede iniciar"}), 400

    bet_amount = room['bet_amount']
    import database

    # 1. Verificar balance de todos los jugadores reales
    for p in room['players']:
        if not p.get('is_bot', False):
            perfil = database.obtener_perfil_completo(p['id'])
            if not perfil or perfil.get('bits', 0) < bet_amount:
                return jsonify({"status": "error", "message": f"{p['name']} no tiene suficientes bits ({bet_amount})."}), 400

    # 2. Iniciar el juego
    success, msg = manager.start_game(room_id, player_id)
    if not success:
        return jsonify({"status": "error", "message": msg}), 400
        
    # 3. Descontar bits
    for p in room['players']:
        if not p.get('is_bot', False):
            database.actualizar_bits(p['id'], -bet_amount)

    return jsonify({"status": "ok"})

@app.route('/api/moche/leave', methods=['POST'])
def moche_leave():
    room_id = session.get('current_room')
    player_id = session.get('telegram_id')
    if room_id and player_id:
        session.pop('current_room', None)
        manager.leave_room(room_id, player_id)
    return jsonify({"status": "ok"})

@app.route('/api/moche/kick', methods=['POST'])
def moche_kick():
    data = request.get_json()
    room_id = session.get('current_room')
    host_id = session.get('telegram_id')
    target_id = data.get('target_id')
    if room_id and host_id and target_id:
        success, msg = manager.kick_player(room_id, host_id, target_id)
        if success:
            return jsonify({"status": "ok"})
        return jsonify({"status": "error", "message": msg}), 400
    return jsonify({"status": "error"}), 400

@app.route('/api/moche/state', methods=['GET'])
def moche_state():
    room_id = session.get('current_room')
    player_id = session.get('telegram_id')
    if room_id and player_id:
        player_state = manager.get_public_state_for_player(room_id, player_id)
        if player_state:
            return jsonify({"status": "ok", "state": player_state})
    return jsonify({"status": "error"}), 400

@app.route('/api/moche/action', methods=['POST'])
def moche_action():
    # Will be expanded later in moche_engine for server-authoritative steps
    data = request.get_json()
    room_id = session.get('current_room')
    player_id = session.get('telegram_id')
    
    if not room_id or not player_id:
        return jsonify({"status": "error"}), 400
        
    action = data.get("action")
    payload = data.get("payload", {})
    
    # Placeholder: currently we just update game_state directly for prototyping,
    # but we will enforce server-side turn validation shortly.
    state = payload.get('STATE')
    if state and isinstance(state, dict):
        # We allow host or anyone to sync (for now until full server engine is active)
        manager.update_game_state(room_id, state)
        return jsonify({"status": "ok"})
    return jsonify({"status": "error", "message": "Estado inválido"}), 400



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
# LOTO INSTANTÁNEO
# =====================================================
@app.route('/loto')
def loto():
    telegram_id = session.get("telegram_id")
    bits = database.obtener_bits(telegram_id) if telegram_id else 0
    photo_url = session.get("photo_url", "")
    return render_template("loto.html", bits=bits, photo_url=photo_url)

@app.route('/api/loto/play', methods=["POST"])
def loto_play():
    """Validate bet, deduct bits, generate winning number, return result."""
    if "telegram_id" not in session:
        return jsonify({"status": "error", "message": "Usuario no autenticado"}), 401

    data = request.get_json()
    bet_amount = int(data.get("bet", 0))
    chosen = str(data.get("chosen", "")).zfill(2)  # e.g. "73"

    if bet_amount <= 0:
        return jsonify({"status": "error", "message": "Cantidad inválida"}), 400

    telegram_id = session["telegram_id"]
    success = database.descontar_bits(telegram_id, bet_amount)
    if not success:
        bits = database.obtener_bits(telegram_id)
        return jsonify({"status": "error", "message": "Fondos insuficientes", "bits": bits}), 400

    # Generate result with cryptographically secure RNG
    import secrets
    result = str(secrets.randbelow(100)).zfill(2)

    # XP for participation
    UserProfileManager.add_xp(telegram_id, "loto_play")
    database.incrementar_stat(telegram_id, 'juegos_jugados', 1)

    bits_actuales = database.obtener_bits(telegram_id)
    return jsonify({
        "status": "ok",
        "result": result,
        "chosen": chosen,
        "won": result == chosen,
        "bits": bits_actuales
    })

@app.route('/api/loto/result', methods=["POST"])
def loto_result():
    """Credit winnings after the animation completes."""
    if "telegram_id" not in session:
        return jsonify({"status": "error", "message": "Usuario no autenticado"}), 401

    data = request.get_json()
    win_amount = int(data.get("win_amount", 0))

    if win_amount <= 0:
        return jsonify({"status": "error", "message": "Sin ganancia"}), 400

    telegram_id = session["telegram_id"]
    database.registrar_ganancia(telegram_id, win_amount)
    database.incrementar_stat(telegram_id, 'wins_total', 1)
    database.incrementar_stat(telegram_id, 'loto_ganados', 1)

    profile_updates = UserProfileManager.add_xp(telegram_id, "loto_win")

    try:
        new_trophies = check_and_unlock_trophies(telegram_id)
        if profile_updates is None:
            profile_updates = {}
        profile_updates['new_trophies'] = new_trophies
    except Exception:
        pass

    bits_actuales = database.obtener_bits(telegram_id)
    return jsonify({"status": "ok", "bits": bits_actuales, "profile_updates": profile_updates})

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
    database.incrementar_stat(telegram_id, 'juegos_jugados', 1)

    # Experience mapping
    xp_event = "slot_spin"
    UserProfileManager.add_xp(telegram_id, xp_event)

    total_win = bet_amount * outcome["multiplier"]

    # Register win securely if any
    profile_updates = None
    if total_win > 0:
        database.registrar_ganancia(telegram_id, total_win)
        database.incrementar_stat(telegram_id, 'wins_total', 1)
        
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
            if profile_updates is None:
                profile_updates = {}
            profile_updates['new_trophies'] = new_trophies
        except Exception:
            pass

    bits_actuales = database.obtener_bits(telegram_id)

    return jsonify({
        "status": "ok",
        "bits": bits_actuales,
        "win_amount": total_win,
        "multiplier": outcome["multiplier"],
        "reels": reel_symbols,
        "profile_updates": profile_updates
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
        profile_updates = None
        # Award participation XP based on source
        if source == "moche":
            profile_updates = UserProfileManager.add_xp(telegram_id, "moche_play")
            database.incrementar_stat(telegram_id, 'juegos_jugados', 1)
        elif source == "ruleta":
            profile_updates = UserProfileManager.add_xp(telegram_id, "roulette_spin")
            database.incrementar_stat(telegram_id, 'juegos_jugados', 1)

        # Check mission progress
        try:
            check_and_unlock_trophies(telegram_id)
        except Exception:
            pass
            
        bits_actuales = database.obtener_bits(telegram_id)
        return jsonify({"status": "ok", "bits": bits_actuales, "profile_updates": profile_updates})
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
    database.registrar_ganancia(telegram_id, cantidad)
    
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
        if profile_updates is None:
            profile_updates = {}
        profile_updates['new_trophies'] = new_trophies
    except Exception:
        pass

    bits_actuales = database.obtener_bits(telegram_id)
    return jsonify({"status": "ok", "bits": bits_actuales, "profile_updates": profile_updates})

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
    
    perfil['rank'] = rank_info
    perfil['progress'] = progress
    return jsonify({"status": "ok", "profile": perfil})

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
# USER BITS BALANCE (for home screen counter)
# =====================================================
@app.route('/api/user/bits', methods=["GET"])
def get_user_bits():
    telegram_id = session.get("telegram_id")
    if not telegram_id:
        return jsonify({"status": "error", "message": "No autenticado", "bits": 0}), 401
    bits = database.obtener_bits(telegram_id)
    return jsonify({"status": "ok", "bits": bits})

# =====================================================
# PAYPAL STORE PAGE — serves store_example as static
# =====================================================
@app.route('/store')
@app.route('/store/')
def store():
    """Serve the PayPal Bits purchasing store page."""
    from flask import send_from_directory
    store_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'store_example')
    return send_from_directory(store_dir, 'index.html')

@app.route('/store/<path:filename>')
def store_static(filename):
    """Serve static assets (JS files) for the store page."""
    from flask import send_from_directory
    store_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'store_example')
    return send_from_directory(store_dir, filename)

# =====================================================
# ADMIN
# =====================================================
@app.route('/admin', methods=["GET", "POST"])
def admin():
    mensaje = ""

    if request.method == "POST":
        telegram_id = request.form["telegram_id"]
        cantidad = int(request.form["cantidad"])
        password = request.form.get("password")

        # Contraseña de administrador (Cámbiala por una más segura en producción o usa variables de entorno)
        ADMIN_PASSWORD = "admin"

        if password == ADMIN_PASSWORD:
            database.recargar_bits(telegram_id, cantidad)
            mensaje = f"✅ Éxito: Se recargaron {cantidad} Bits al usuario con ID {telegram_id}"
        else:
            mensaje = "❌ Error: Contraseña de administrador incorrecta."
            
    # Obtener la lista de usuarios y los top 10
    usuarios = database.obtener_todos_usuarios()
    top_recargas = database.obtener_top_recargas()
    top_ganadores = database.obtener_top_ganadores()

    return render_template("admin.html", 
                         mensaje=mensaje, 
                         usuarios=usuarios, 
                         top_recargas=top_recargas, 
                         top_ganadores=top_ganadores)

# =====================================================
# MAIN
# =====================================================
if __name__ == "__main__":
    database.init_db()
    port = int(os.environ.get("PORT", 10000))
    socketio.run(app, host="0.0.0.0", port=port, debug=False)