from flask import Blueprint, render_template, request, session, redirect, url_for, flash, jsonify
import database
from werkzeug.security import check_password_hash
from functools import wraps

admin_bp = Blueprint('admin', __name__, url_prefix='/admin')

def admin_required_api(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'admin_logged_in' not in session:
            return jsonify({'error': 'Unauthorized'}), 401
        return f(*args, **kwargs)
    return decorated_function

def admin_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'admin_logged_in' not in session:
            return redirect(url_for('admin.login'))
        return f(*args, **kwargs)
    return decorated_function

@admin_bp.route('/login', methods=['GET', 'POST'])
def login():
    if 'admin_logged_in' in session:
        return redirect(url_for('admin.index'))
        
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        
        with database.get_connection() as conn:
            admin_user = conn.execute("SELECT * FROM admins WHERE username = ?", (username,)).fetchone()
            
            if admin_user and check_password_hash(admin_user['password_hash'], password):
                session['admin_logged_in'] = True
                session['admin_username'] = username
                return jsonify({'success': True, 'redirect': url_for('admin.index')})
            else:
                return jsonify({'success': False, 'message': 'Credenciales incorrectas'})
                
    return render_template('admin/panel.html', view='login')

@admin_bp.route('/logout')
def logout():
    session.pop('admin_logged_in', None)
    session.pop('admin_username', None)
    return redirect(url_for('admin.login'))

@admin_bp.route('/')
@admin_required
def index():
    return render_template('admin/panel.html', view='dashboard')

# --- API ENDPOINTS FOR SPA ---

@admin_bp.route('/api/dashboard')
@admin_required_api
def api_dashboard():
    with database.get_connection() as conn:
        total_players = conn.execute("SELECT COUNT(*) FROM usuarios").fetchone()[0]
        
        # Calcular usuarios activos (que jugaron al menos 1 juego o tienen recargas)
        active_players = conn.execute("SELECT COUNT(DISTINCT telegram_id) FROM user_stats WHERE juegos_jugados > 0").fetchone()[0]
        
        total_bits = conn.execute("SELECT SUM(bits) FROM usuarios").fetchone()[0] or 0
        games_played = conn.execute("SELECT SUM(juegos_jugados) FROM user_stats").fetchone()[0] or 0
        total_won = conn.execute("SELECT SUM(bits_ganados) FROM user_stats").fetchone()[0] or 0
        total_lost = conn.execute("SELECT SUM(bits_apostados) - SUM(bits_ganados) FROM user_stats").fetchone()[0] or 0
        if total_lost < 0: total_lost = 0
        
        # New Financial Metrics
        finanzas = database.obtener_metricas_financieras()

        stats = {
            'total_players': total_players,
            'active_players': active_players,
            'total_bits': total_bits,
            'games_played': games_played,
            'total_won': total_won,
            'total_lost': total_lost,
            'financials': finanzas
        }
    return jsonify({'success': True, 'stats': stats})


@admin_bp.route('/api/players')
@admin_required_api
def api_players():
    with database.get_connection() as conn:
        players_data = conn.execute("""
            SELECT u.id, u.telegram_id, u.nombre, u.username, u.bits, u.xp, u.nivel,
                   COALESCE(s.juegos_jugados, 0) as juegos_jugados
            FROM usuarios u
            LEFT JOIN user_stats s ON u.telegram_id = s.telegram_id
            ORDER BY u.id DESC
        """).fetchall()
    return jsonify({'success': True, 'players': [dict(p) for p in players_data]})

@admin_bp.route('/api/players/<int:player_id>', methods=['POST', 'DELETE'])
@admin_required_api
def api_player_action(player_id):
    if request.method == 'DELETE':
        with database.get_connection() as conn:
            user = conn.execute("SELECT telegram_id FROM usuarios WHERE id = ?", (player_id,)).fetchone()
            if user:
                tid = user['telegram_id']
                conn.execute("DELETE FROM user_stats WHERE telegram_id = ?", (tid,))
                conn.execute("DELETE FROM trophies WHERE telegram_id = ?", (tid,))
                conn.execute("DELETE FROM user_missions WHERE telegram_id = ?", (tid,))
                conn.execute("DELETE FROM unlocked_items WHERE telegram_id = ?", (tid,))
                conn.execute("DELETE FROM juegos_historial WHERE telegram_id = ?", (tid,))
                conn.execute("DELETE FROM usuarios WHERE id = ?", (player_id,))
                return jsonify({'success': True, 'message': 'Jugador eliminado'})
        return jsonify({'success': False, 'message': 'Jugador no encontrado'})

    if request.method == 'POST':
        data = request.json
        username = data.get('username')
        bits = data.get('bits', 0)
        xp = data.get('xp', 0)
        nivel = data.get('nivel', 1)
        
        with database.get_connection() as conn:
            conn.execute("""
                UPDATE usuarios 
                SET username = ?, bits = ?, xp = ?, nivel = ? 
                WHERE id = ?
            """, (username, bits, xp, nivel, player_id))
            
        return jsonify({'success': True, 'message': 'Jugador actualizado'})

@admin_bp.route('/api/players/add_bits', methods=['POST'])
@admin_required_api
def api_player_add_bits():
    data = request.json
    player_id = data.get('id')
    amount = data.get('amount', 0)
    
    if not player_id or amount <= 0:
        return jsonify({'success': False, 'message': 'Datos inválidos'})
        
    with database.get_connection() as conn:
        user = conn.execute("SELECT telegram_id FROM usuarios WHERE id = ?", (player_id,)).fetchone()
        if not user:
            return jsonify({'success': False, 'message': 'Jugador no encontrado'})
            
        tid = user['telegram_id']
        # Add bits using the database helper
        database.recargar_bits(tid, amount)
        # Log the transaction as a manual admin recharge (Assume mapping 1000 bits = 1 USD for display if needed, but let's record 0 or proportionate USD)
        usd_amount = amount / 1000.0
        database.registrar_transaccion(tid, amount, usd_amount, 'recarga_admin')
        
    return jsonify({'success': True, 'message': f'Se añadieron {amount} bits'})

@admin_bp.route('/api/admins', methods=['GET', 'POST'])
@admin_required_api
def api_admins():
    if request.method == 'GET':
        with database.get_connection() as conn:
            rows = conn.execute("SELECT id, username, created_at FROM admins ORDER BY id").fetchall()
        return jsonify({'success': True, 'admins': [dict(r) for r in rows]})

    if request.method == 'POST':
        from werkzeug.security import generate_password_hash
        data = request.json
        username = (data.get('username') or '').strip()
        password = data.get('password', '')

        if not username or len(password) < 6:
            return jsonify({'success': False, 'message': 'Datos inválidos'})

        with database.get_connection() as conn:
            existing = conn.execute("SELECT id FROM admins WHERE username = ?", (username,)).fetchone()
            if existing:
                return jsonify({'success': False, 'message': 'Ese nombre de usuario ya existe'})
            conn.execute(
                "INSERT INTO admins (username, password_hash, created_at) VALUES (?, ?, datetime('now'))",
                (username, generate_password_hash(password))
            )
        return jsonify({'success': True, 'message': f'Admin "{username}" creado correctamente'})

@admin_bp.route('/api/admins/<int:admin_id>', methods=['DELETE'])
@admin_required_api
def api_admin_delete(admin_id):
    # Prevent self-deletion
    current = session.get('admin_username')
    with database.get_connection() as conn:
        target = conn.execute("SELECT username FROM admins WHERE id = ?", (admin_id,)).fetchone()
        if not target:
            return jsonify({'success': False, 'message': 'Admin no encontrado'})
        if target['username'] == current:
            return jsonify({'success': False, 'message': 'No puedes eliminarte a ti mismo'})
        # Ensure at least one admin remains
        count = conn.execute("SELECT COUNT(*) as c FROM admins").fetchone()['c']
        if count <= 1:
            return jsonify({'success': False, 'message': 'Debes tener al menos un administrador'})
        conn.execute("DELETE FROM admins WHERE id = ?", (admin_id,))
    return jsonify({'success': True})

@admin_bp.route('/api/missions')
@admin_required_api
def api_missions():
    with database.get_connection() as conn:
        missions_db = conn.execute("SELECT * FROM missions ORDER BY id").fetchall()
        missions = []
        for m in missions_db:
            levels = conn.execute("SELECT * FROM mission_levels WHERE mission_id = ? ORDER BY level", (m['id'],)).fetchall()
            m_dict = dict(m)
            m_dict['levels'] = [dict(l) for l in levels]
            missions.append(m_dict)
            
    return jsonify({'success': True, 'missions': missions})

@admin_bp.route('/api/missions/<mission_id>/toggle', methods=['POST'])
@admin_required_api
def api_toggle_mission(mission_id):
    with database.get_connection() as conn:
        current_state = conn.execute("SELECT is_active FROM missions WHERE id = ?", (mission_id,)).fetchone()
        if current_state:
            new_state = 0 if current_state['is_active'] == 1 else 1
            conn.execute("UPDATE missions SET is_active = ? WHERE id = ?", (new_state, mission_id))
            return jsonify({'success': True, 'is_active': new_state})
    return jsonify({'success': False})

@admin_bp.route('/api/missions/level/<int:level_id>', methods=['POST'])
@admin_required_api
def api_edit_mission_level(level_id):
    data = request.json
    target = data.get('target', 0)
    xp_reward = data.get('xp_reward', 0)
    bits_reward = data.get('bits_reward', 0)
    
    with database.get_connection() as conn:
        conn.execute("""
            UPDATE mission_levels 
            SET target = ?, xp_reward = ?, bits_reward = ? 
            WHERE id = ?
        """, (target, xp_reward, bits_reward, level_id))
        
    return jsonify({'success': True})

@admin_bp.route('/api/history')
@admin_required_api
def api_history():
    # Only load the last 500 records to prevent payload bloat
    with database.get_connection() as conn:
        history_db = conn.execute("""
            SELECT h.id, h.telegram_id, u.nombre, h.juego, h.apuesta, h.ganancia, h.resultado, h.fecha 
            FROM juegos_historial h
            LEFT JOIN usuarios u ON h.telegram_id = u.telegram_id
            ORDER BY h.id DESC 
            LIMIT 500
        """).fetchall()
    return jsonify({'success': True, 'history': [dict(h) for h in history_db]})

@admin_bp.route('/api/trophies')
@admin_required_api
def api_trophies():
    with database.get_connection() as conn:
        trophies_db = conn.execute("SELECT * FROM trophies_config ORDER BY id").fetchall()
    return jsonify({'success': True, 'trophies': [dict(t) for t in trophies_db]})


# ─── NOTIFICATIONS ──────────────────────────────────────────────────────────
@admin_bp.route('/api/notifications')
@admin_required_api
def api_notifications():
    """Returns combined P2P and PayPal notifications, plus unread count."""
    notifs = database.obtener_notificaciones(limit=30)
    unread = database.contar_notificaciones_no_leidas()
    return jsonify({'success': True, 'notifications': notifs, 'unread': unread})


@admin_bp.route('/api/notifications/read', methods=['POST'])
@admin_required_api
def api_notifications_read():
    """Marks all P2P notifications as read."""
    database.marcar_notificaciones_leidas()
    return jsonify({'success': True})


# ─── TEMAS GLOBALES ─────────────────────────────────────────────────────────

@admin_bp.route('/api/themes', methods=['GET'])
@admin_required_api
def api_themes_list():
    themes = database.get_all_themes()
    return jsonify({'success': True, 'themes': themes})

@admin_bp.route('/api/themes/<int:theme_id>/activate', methods=['POST'])
@admin_required_api
def api_theme_activate(theme_id):
    database.activate_theme(theme_id)
    active = database.get_active_theme()
    return jsonify({'success': True, 'active_theme': active})

@admin_bp.route('/api/themes', methods=['POST'])
@admin_required_api
def api_theme_create():
    data = request.get_json()
    required = ['name', 'slug', 'primary_color', 'secondary_color', 'bg_color']
    if not all(k in data for k in required):
        return jsonify({'success': False, 'message': 'Faltan campos requeridos'}), 400
    new_id = database.create_theme(
        name=data['name'], slug=data['slug'],
        description=data.get('description', ''),
        primary_color=data['primary_color'],
        secondary_color=data['secondary_color'],
        bg_color=data['bg_color'],
        accent_glow=data.get('accent_glow', 'rgba(255,255,255,0.2)'),
        particles_color=data.get('particles_color', 'rgba(255,255,255,0.4)'),
        background_image=data.get('background_image', ''),
        background_overlay=data.get('background_overlay', ''),
        typography=data.get('typography', {}),
        ui_sounds=data.get('ui_sounds', {}),
        animations=data.get('animations', {})
    )
    return jsonify({'success': True, 'id': new_id}), 201

@admin_bp.route('/api/themes/<int:theme_id>', methods=['PUT'])
@admin_required_api
def api_theme_update(theme_id):
    data = request.get_json()
    database.update_theme(theme_id, data)
    return jsonify({'success': True})

@admin_bp.route('/api/themes/schedules', methods=['GET'])
@admin_required_api
def api_schedules_list():
    schedules = database.get_theme_schedules()
    return jsonify({'success': True, 'schedules': schedules})

@admin_bp.route('/api/themes/schedules', methods=['POST'])
@admin_required_api
def api_schedule_create():
    data = request.get_json()
    required = ['theme_id', 'event_name', 'start_date', 'end_date']
    if not all(k in data for k in required):
        return jsonify({'success': False, 'message': 'Faltan campos requeridos'}), 400
    new_id = database.create_schedule(
        theme_id=int(data['theme_id']),
        event_name=data['event_name'],
        start_date=data['start_date'],
        end_date=data['end_date'],
        priority=int(data.get('priority', 1))
    )
    return jsonify({'success': True, 'id': new_id}), 201

@admin_bp.route('/api/themes/schedules/<int:schedule_id>', methods=['DELETE'])
@admin_required_api
def api_schedule_delete(schedule_id):
    database.delete_schedule(schedule_id)
    return jsonify({'success': True})