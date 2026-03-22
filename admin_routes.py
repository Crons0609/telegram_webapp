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
        email = request.form.get('email')
        password = request.form.get('password')
        
        admins = database.get_fb("Administradores") or {}
        admin_user = None
        for k, a in admins.items():
            if a.get('Email') == email or a.get('email') == email:
                admin_user = a
                break
                
        if admin_user and check_password_hash(admin_user.get('password_hash', ''), password):
            session['admin_logged_in'] = True
            session['admin_email'] = email
            return jsonify({'success': True, 'redirect': url_for('admin.index')})
        else:
            return jsonify({'success': False, 'message': 'Credenciales incorrectas'})
                
    return render_template('admin/panel.html', view='login')

@admin_bp.route('/logout')
def logout():
    session.pop('admin_logged_in', None)
    session.pop('admin_email', None)
    return redirect(url_for('admin.login'))

@admin_bp.route('/')
@admin_required
def index():
    return render_template('admin/panel.html', view='dashboard')

# --- HELPERS ---
def _to_dict(data):
    if data is None: return {}
    if isinstance(data, list):
        return {str(i): v for i, v in enumerate(data) if v is not None}
    return dict(data)

# --- API ENDPOINTS FOR SPA ---

@admin_bp.route('/api/dashboard')
@admin_required_api
def api_dashboard():
    usuarios = _to_dict(database.get_fb("usuarios"))
    stats = _to_dict(database.get_fb("user_stats"))
    
    total_players = len(usuarios)
    active_players = sum(1 for s in stats.values() if int(s.get('juegos_jugados', 0)) > 0)
    
    total_bits = sum(int(u.get('bits', 0)) for u in usuarios.values())
    games_played = sum(int(s.get('juegos_jugados', 0)) for s in stats.values())
    total_won = sum(int(s.get('bits_ganados', 0)) for s in stats.values())
    total_lost = sum(int(s.get('bits_apostados', 0)) for s in stats.values()) - total_won
    if total_lost < 0: total_lost = 0
    
    # New Financial Metrics
    finanzas = database.obtener_metricas_financieras()

    res_stats = {
        'total_players': total_players,
        'active_players': active_players,
        'total_bits': total_bits,
        'games_played': games_played,
        'total_won': total_won,
        'total_lost': total_lost,
        'financials': finanzas
    }
    return jsonify({'success': True, 'stats': res_stats})

@admin_bp.route('/api/players')
@admin_required_api
def api_players():
    players_data = database.obtener_todos_usuarios()
    stats = _to_dict(database.get_fb("user_stats"))
    for p in players_data:
        tid = str(p.get('telegram_id', ''))
        p['juegos_jugados'] = stats.get(tid, {}).get('juegos_jugados', 0)
    return jsonify({'success': True, 'players': players_data})

@admin_bp.route('/api/players/<int:player_id>', methods=['POST', 'DELETE'])
@admin_required_api
def api_player_action(player_id):
    user = database.obtener_usuario(player_id)
    if not user:
        return jsonify({'success': False, 'message': 'Jugador no encontrado'})
        
    tid = str(user.get('telegram_id'))

    if request.method == 'DELETE':
        database.delete_fb(f"user_stats/{tid}")
        database.delete_fb(f"trophies/{tid}")
        database.delete_fb(f"user_missions/{tid}")
        database.delete_fb(f"unlocked_items/{tid}")
        database.delete_fb(f"usuarios/{tid}")
        return jsonify({'success': True, 'message': 'Jugador eliminado'})

    if request.method == 'POST':
        data = request.json
        username = data.get('username')
        bits = data.get('bits', 0)
        xp = data.get('xp', 0)
        nivel = data.get('nivel', 1)
        
        database.patch_fb(f"usuarios/{tid}", {
            "username": username,
            "bits": int(bits),
            "xp": int(xp),
            "nivel": int(nivel)
        })
            
        return jsonify({'success': True, 'message': 'Jugador actualizado'})

@admin_bp.route('/api/players/add_bits', methods=['POST'])
@admin_required_api
def api_player_add_bits():
    data = request.json
    player_id = data.get('id')
    amount = data.get('amount', 0)
    
    if not player_id or amount <= 0:
        return jsonify({'success': False, 'message': 'Datos inválidos'})
        
    user = database.obtener_usuario(player_id)
    if not user:
        return jsonify({'success': False, 'message': 'Jugador no encontrado'})
        
    tid = str(user.get('telegram_id'))
    database.recargar_bits(tid, amount)
    usd_amount = amount / 1000.0
    database.registrar_transaccion(tid, amount, usd_amount, 'recarga_admin')
        
    return jsonify({'success': True, 'message': f'Se añadieron {amount} bits'})

@admin_bp.route('/api/admins', methods=['GET', 'POST'])
@admin_required_api
def api_admins():
    admins = database.get_fb("Administradores") or {}
    
    if request.method == 'GET':
        admin_list = []
        for k, a in admins.items():
            admin_list.append({
                "id": k, 
                "email": a.get('Email') or a.get('email'), 
                "created_at": a.get('created_at')
            })
        return jsonify({'success': True, 'admins': admin_list})

    if request.method == 'POST':
        from werkzeug.security import generate_password_hash
        data = request.json
        email = (data.get('email') or '').strip()
        password = data.get('password', '')

        if not email or len(password) < 6:
            return jsonify({'success': False, 'message': 'Datos inválidos'})

        for k, a in admins.items():
            if a.get('Email') == email or a.get('email') == email:
                return jsonify({'success': False, 'message': 'Ese correo electrónico ya existe'})
                
        from datetime import datetime
        # As per the requirements from the user {"rules": {"Administradores": {".indexOn": ["Email"]}}}
        # We save "Email" capitalized if requested, but "email" is also safe. I'll save "Email" since their rule explicitly shows "Email".
        database.post_fb("Administradores", {
            "Email": email,
            "password_hash": generate_password_hash(password),
            "created_at": datetime.utcnow().isoformat()
        })
        return jsonify({'success': True, 'message': f'Admin "{email}" creado correctamente'})

@admin_bp.route('/api/admins/<admin_id>', methods=['DELETE'])
@admin_required_api
def api_admin_delete(admin_id):
    current = session.get('admin_email')
    admins = database.get_fb("Administradores") or {}
    target = admins.get(admin_id)
    
    if not target:
        return jsonify({'success': False, 'message': 'Admin no encontrado'})
    if target.get('Email') == current or target.get('email') == current:
        return jsonify({'success': False, 'message': 'No puedes eliminarte a ti mismo'})
    if len(admins) <= 1:
        return jsonify({'success': False, 'message': 'Debes tener al menos un administrador'})
        
    database.delete_fb(f"Administradores/{admin_id}")
    return jsonify({'success': True})

@admin_bp.route('/api/missions')
@admin_required_api
def api_missions():
    missions_db = _to_dict(database.get_fb("missions"))
    levels_db   = _to_dict(database.get_fb("mission_levels"))

    missions = []
    for k, m in missions_db.items():
        if not m or not isinstance(m, dict):
            continue
        try:
            m_dict = dict(m)
            m_dict['levels'] = []
            for lk, l in levels_db.items():
                if not l or not isinstance(l, dict):
                    continue
                if str(l.get('mission_id')) == str(m.get('id')):
                    ld = dict(l)
                    ld['id'] = lk
                    m_dict['levels'].append(ld)
            m_dict['levels'] = sorted(m_dict['levels'], key=lambda x: int(x.get('level', 0)))
            missions.append(m_dict)
        except Exception as e:
            print(f"Error processing mission {k}: {e}")
            continue

    return jsonify({'success': True, 'missions': sorted(missions, key=lambda x: str(x.get('id', '')))})


@admin_bp.route('/api/missions/<mission_id>/toggle', methods=['POST'])
@admin_required_api
def api_toggle_mission(mission_id):
    m = database.get_fb(f"missions/{mission_id}")
    if m:
        new_state = 0 if m.get('is_active') == 1 else 1
        database.patch_fb(f"missions/{mission_id}", {"is_active": new_state})
        return jsonify({'success': True, 'is_active': new_state})
    return jsonify({'success': False})

@admin_bp.route('/api/missions/level/<level_id>', methods=['POST'])
@admin_required_api
def api_edit_mission_level(level_id):
    data = request.json
    database.patch_fb(f"mission_levels/{level_id}", {
        "target": int(data.get('target', 0)),
        "xp_reward": int(data.get('xp_reward', 0)),
        "bits_reward": int(data.get('bits_reward', 0))
    })
    return jsonify({'success': True})

@admin_bp.route('/api/history')
@admin_required_api
def api_history():
    hist = _to_dict(database.get_fb("juegos_historial"))
    usuarios = _to_dict(database.get_fb("usuarios"))
    
    results = []
    for k, h in hist.items():
        d = dict(h)
        tid = str(h.get('telegram_id'))
        u = usuarios.get(tid, {})
        d['nombre'] = u.get('nombre')
        d['id'] = k
        results.append(d)
        
    results = sorted(results, key=lambda x: x.get('fecha', ''), reverse=True)[:500]
    return jsonify({'success': True, 'history': results})

@admin_bp.route('/api/trophies')
@admin_required_api
def api_trophies():
    trophies_db = _to_dict(database.get_fb("trophies_config"))
    return jsonify({'success': True, 'trophies': list(trophies_db.values())})

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

@admin_bp.route('/api/themes/<theme_slug>/activate', methods=['POST'])
@admin_required_api
def api_theme_activate(theme_slug):
    database.activate_theme(str(theme_slug))
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

@admin_bp.route('/api/themes/<theme_slug>', methods=['PUT'])
@admin_required_api
def api_theme_update(theme_slug):
    data = request.get_json()
    database.update_theme(str(theme_slug), data)
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
        theme_slug=str(data['theme_id']),
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