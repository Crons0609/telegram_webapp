from flask import Blueprint, render_template, request, session, redirect, url_for, flash, jsonify
import database
from werkzeug.security import check_password_hash
from functools import wraps

admin_bp = Blueprint('admin', __name__, url_prefix='/admin')

# ────────────────────────────────────────────────────────────
# ROLE HIERARCHY
# superadmin > admin > recargador > espectador
# ────────────────────────────────────────────────────────────
ROLE_HIERARCHY = ['espectador', 'recargador', 'admin', 'superadmin']

def _role_rank(role: str) -> int:
    try:
        return ROLE_HIERARCHY.index(role)
    except ValueError:
        return -1

def _current_role() -> str:
    return session.get('admin_role', 'espectador')

def admin_required_api(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'admin_logged_in' not in session:
            return jsonify({'error': 'Unauthorized'}), 401
        return f(*args, **kwargs)
    return decorated_function

def role_required_api(*allowed_roles):
    """Restrict an API endpoint to admins whose role is in allowed_roles."""
    def decorator(f):
        @wraps(f)
        def decorated(*args, **kwargs):
            if 'admin_logged_in' not in session:
                return jsonify({'error': 'Unauthorized'}), 401
            if _current_role() not in allowed_roles:
                return jsonify({'error': 'Forbidden', 'message': 'No tienes permisos para esta acción'}), 403
            return f(*args, **kwargs)
        return decorated
    return decorator

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
            admin_nombre = admin_user.get('nombre') or admin_user.get('name') or admin_user.get('username') or email.split('@')[0].capitalize()
            session['admin_name'] = admin_nombre
            # Role: default to 'admin' for backward-compat with existing records
            session['admin_role'] = admin_user.get('role', 'admin')
            return jsonify({'success': True, 'redirect': url_for('admin.index')})
        else:
            return jsonify({'success': False, 'message': 'Credenciales incorrectas'})
                
    return render_template('admin/panel.html', view='login')

@admin_bp.route('/logout')
def logout():
    session.pop('admin_logged_in', None)
    session.pop('admin_email', None)
    session.pop('admin_name', None)
    session.pop('admin_role', None)
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

@admin_bp.route('/api/dashboard/reset', methods=['POST'])
@role_required_api('superadmin')
def api_dashboard_reset():
    try:
        database.delete_fb("user_stats")
        database.delete_fb("transacciones")
        database.delete_fb("juegos_historial")
        return jsonify({'success': True, 'message': 'Métricas reiniciadas.'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

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
        old_bits = int(user.get('bits', 0))
        
        # Only extract the fields we want to allow editing
        update_data = {}
        target_fields = ['username', 'nombre', 'bits', 'bits_demo', 'xp', 'nivel', 'Estado', 'marco_actual', 'avatar_frame', 'tema_actual']
        for field in target_fields:
            if field in data:
                val = data.get(field)
                if field in ['bits', 'bits_demo', 'xp', 'nivel']:
                    try:
                        val = int(val)
                    except (ValueError, TypeError):
                        val = 0
                update_data[field] = val
        
        if update_data:
            database.patch_fb(f"usuarios/{tid}", update_data)
            
            # Check if bits changed to log transaction and notify
            new_bits = update_data.get('bits')
            if new_bits is not None and new_bits != old_bits:
                diff = new_bits - old_bits
                usd_equiv = abs(diff) / 1000.0
                database.registrar_transaccion(tid, diff, usd_equiv, 'admin_edit')
                if diff > 0:
                    database.notify_bits_added_admin(tid, diff, new_bits)
            
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
    new_balance = database.recargar_bits(tid, amount)
    usd_amount = amount / 1000.0
    database.registrar_transaccion(tid, amount, usd_amount, 'recarga_admin')
    
    if new_balance is not None:
        database.notify_bits_added_admin(tid, amount, new_balance)
        
    return jsonify({'success': True, 'message': f'Se añadieron {amount} bits'})

@admin_bp.route('/api/transactions', methods=['GET'])
@admin_required_api
def api_transactions():
    txs = database.get_fb("transacciones") or {}
    tx_list = []
    # Merge basic user info if possible (optional, but JS can also handle it or we just show IDs)
    users = database.get_fb("usuarios") or {}
    
    for k, v in txs.items():
        v['id'] = k
        tid = str(v.get('telegram_id', ''))
        if tid in users:
            v['user_name'] = users[tid].get('nombre', 'Desconocido')
            v['username'] = users[tid].get('username', '')
        tx_list.append(v)
        
    tx_list.sort(key=lambda x: x.get('fecha', ''), reverse=True)
    return jsonify({'success': True, 'transactions': tx_list})

@admin_bp.route('/api/admins', methods=['GET', 'POST'])
@role_required_api('superadmin')
def api_admins():
    admins = database.get_fb("Administradores") or {}
    
    if request.method == 'GET':
        admin_list = []
        for k, a in admins.items():
            admin_list.append({
                "id": k, 
                "nombre": a.get('nombre') or a.get('name'),
                "email": a.get('Email') or a.get('email'),
                "role": a.get('role', 'admin'),
                "created_at": a.get('created_at')
            })
        return jsonify({'success': True, 'admins': admin_list})

    if request.method == 'POST':
        from werkzeug.security import generate_password_hash
        data = request.json
        nombre = (data.get('nombre') or '').strip()
        email = (data.get('email') or '').strip()
        password = data.get('password', '')
        role = data.get('role', 'admin')
        if role not in ROLE_HIERARCHY:
            role = 'admin'

        if not email or len(password) < 6:
            return jsonify({'success': False, 'message': 'Datos inválidos'})
        if not nombre:
            return jsonify({'success': False, 'message': 'El nombre es requerido'})

        for k, a in admins.items():
            if a.get('Email') == email or a.get('email') == email:
                return jsonify({'success': False, 'message': 'Ese correo electrónico ya existe'})
                
        from datetime import datetime
        database.post_fb("Administradores", {
            "nombre": nombre,
            "Email": email,
            "role": role,
            "password_hash": generate_password_hash(password),
            "created_at": datetime.utcnow().isoformat()
        })
        return jsonify({'success': True, 'message': f'Admin "{nombre}" creado correctamente'})

@admin_bp.route('/api/admins/<admin_id>', methods=['DELETE'])
@role_required_api('superadmin')
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

@admin_bp.route('/api/admins/<admin_id>/role', methods=['PATCH'])
@role_required_api('superadmin')
def api_admin_change_role(admin_id):
    data = request.get_json()
    new_role = data.get('role', 'admin')
    if new_role not in ROLE_HIERARCHY:
        return jsonify({'success': False, 'message': 'Rol inválido'}), 400
    admins = database.get_fb("Administradores") or {}
    if admin_id not in admins:
        return jsonify({'success': False, 'message': 'Admin no encontrado'}), 404
    database.patch_fb(f"Administradores/{admin_id}", {"role": new_role})
    return jsonify({'success': True, 'message': f'Rol actualizado a {new_role}'})

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

# ─── MENSAJES ADMIN → JUGADORES ─────────────────────────────────────────────

@admin_bp.route('/api/messages', methods=['GET'])
@admin_required_api
def api_messages_list():
    """Return the last 100 admin-sent messages."""
    msgs = database.get_fb("admin_messages") or {}
    result = []
    for k, m in msgs.items():
        result.append({**m, 'id': k})
    result.sort(key=lambda x: x.get('sent_at', ''), reverse=True)
    return jsonify({'success': True, 'messages': result[:100]})

@admin_bp.route('/api/messages/clear', methods=['DELETE'])
@role_required_api('superadmin', 'admin')
def api_messages_clear():
    """Clears the admin_messages history."""
    database.delete_fb("admin_messages")
    return jsonify({'success': True, 'message': 'Historial de mensajes limpiado correctamente'})

@admin_bp.route('/api/messages/send', methods=['POST'])
@role_required_api('superadmin', 'admin')
def api_messages_send():
    """
    Send a message to one player (recipient=uid) or all (recipient='all').
    Stored in Firebase:
      - admin_messages/{auto_id} : metadata + preview (for admin history)
      - mensajes/{uid}/{auto_id}  : actual notification (for each player)
    """
    data = request.get_json()
    recipient = (data.get('recipient') or 'all').strip()
    msg_type  = data.get('type', 'info')
    title     = (data.get('title') or '').strip()
    body      = (data.get('body') or '').strip()
    sender    = session.get('admin_name', 'Admin')

    if not title or not body:
        return jsonify({'success': False, 'message': 'Título y mensaje son requeridos'}), 400

    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()

    payload = {
        'type':      msg_type,
        'title':     title,
        'body':      body,
        'sent_at':   now,
        'sender':    sender,
        'recipient': recipient,
        'read':      False
    }

    # Store in admin history
    database.post_fb("admin_messages", payload)

    try:
        import config
        bot_token = getattr(config, 'BOT_TOKEN', None)
    except ImportError:
        bot_token = None

    import httpx

    def send_telegram_msg(tid, msg_title, msg_body, m_type):
        if not bot_token: return
        icons = {'promo': '🎁', 'alerta': '⚠️', 'update': '🔄', 'vip': '⭐', 'info': 'ℹ️'}
        icon = icons.get(m_type, 'ℹ️')
        text = f"{icon} *{msg_title}*\n\n{msg_body}"
        url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
        try:
            # Send message asynchronously to avoid blocking if many users
            import threading
            def _send():
                try:
                    httpx.post(url, json={"chat_id": tid, "text": text, "parse_mode": "Markdown"}, timeout=5.0)
                except:
                    pass
            threading.Thread(target=_send).start()
        except:
            pass

    # Deliver to players
    players = database.get_fb("usuarios") or {}
    sent_count = 0
    for uid, p in players.items():
        if recipient == 'all' or uid == recipient:
            database.post_fb(f"mensajes/{uid}", {
                'type':    msg_type,
                'title':   title,
                'body':    body,
                'sent_at': now,
                'sender':  sender,
                'read':    False
            })
            send_telegram_msg(uid, title, body, msg_type)
            sent_count += 1

    label = "todos los jugadores" if recipient == 'all' else f"1 jugador"
    return jsonify({'success': True, 'message': f'Mensaje enviado a {label} ({sent_count} destinatarios)'})

# ─── TEMAS GLOBALES ─────────────────────────────────────────────────────────

@admin_bp.route('/api/themes', methods=['GET'])
@admin_required_api
def api_themes_list():
    themes = database.get_all_themes()
    return jsonify({'success': True, 'themes': themes})

@admin_bp.route('/api/themes/<theme_slug>/activate', methods=['POST'])
@role_required_api('superadmin')
def api_theme_activate(theme_slug):
    database.activate_theme(str(theme_slug))
    active = database.get_active_theme()
    return jsonify({'success': True, 'active_theme': active})

@admin_bp.route('/api/themes', methods=['POST'])
@role_required_api('superadmin')
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
@role_required_api('superadmin')
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
@role_required_api('superadmin')
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
@role_required_api('superadmin')
def api_schedule_delete(schedule_id):
    database.delete_schedule(schedule_id)
    return jsonify({'success': True})

# ─── SUPPORT CHATS (TELEGRAM 2-WAY) ─────────────────────────────────────────

@admin_bp.route('/api/support_chats', methods=['GET'])
@admin_required_api
def api_support_chats():
    chats = database.get_fb("user_telegrams") or {}
    users = database.get_fb("usuarios") or {}
    results = []
    for chat_id, data in chats.items():
        info = data.get("info", {}) if isinstance(data, dict) else {}
        info["chat_id"] = chat_id
        
        real_user = users.get(chat_id)
        if real_user:
            # Overwrite any cached names with the real name from the users table.
            info["first_name"] = real_user.get("nombre", "")
            info["username"] = real_user.get("username", "")
            info["nombre"] = real_user.get("nombre", "") # some parts of js might look for this
            
        results.append(info)
    # Sort by last_time descending
    results.sort(key=lambda x: x.get("last_time", ""), reverse=True)
    return jsonify({"success": True, "chats": results})

@admin_bp.route('/api/support_chats/<chat_id>', methods=['GET'])
@admin_required_api
def api_support_chat_history(chat_id):
    chat_data = database.get_fb(f"user_telegrams/{chat_id}")
    if not chat_data or not isinstance(chat_data, dict):
        return jsonify({"success": False, "message": "Chat not found"}), 404
        
    # Mark as read
    info = chat_data.get("info", {})
    if isinstance(info, dict) and int(info.get("unread", 0)) > 0:
        database.patch_fb(f"user_telegrams/{chat_id}/info", {"unread": 0})
        info["unread"] = 0
        
    # Overwrite any cached names with the real name from the users table.
    users = database.get_fb("usuarios") or {}
    real_user = users.get(chat_id)
    if real_user and isinstance(info, dict):
        info["first_name"] = real_user.get("nombre", "")
        info["username"] = real_user.get("username", "")
        info["nombre"] = real_user.get("nombre", "")

    msgs_raw = chat_data.get("messages", {})
    messages = []
    if isinstance(msgs_raw, dict):
        for msg_id, msg in msgs_raw.items():
            if isinstance(msg, dict):
                msg["id"] = msg_id
                messages.append(msg)
    
    # Sort chronologically
    messages.sort(key=lambda x: x.get("timestamp", ""))
    return jsonify({"success": True, "messages": messages, "info": info})

@admin_bp.route('/api/support_chats/<chat_id>/reply', methods=['POST'])
@role_required_api('superadmin', 'admin')
def api_support_chat_reply(chat_id):
    data = request.json or {}
    text = data.get("text", "").strip()
    if not text:
        return jsonify({"success": False, "message": "El mensaje no puede estar vacío"}), 400
        
    # Guardar en BD localmente
    admin_name = session.get('admin_name', 'Admin')
    database.save_user_telegram_msg(chat_id, admin_name, "", text, sender="admin")
    
    # Enviar a Telegram
    try:
        import config
        bot_token = getattr(config, 'BOT_TOKEN', None)
    except Exception:
        bot_token = None
        
    if bot_token:
        import requests
        url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
        try:
            import threading
            def _send():
                try:
                    requests.post(url, json={"chat_id": chat_id, "text": f"👨‍💻 *Soporte ({admin_name}):*\n{text}", "parse_mode": "Markdown"}, timeout=5)
                except Exception as e:
                    print("Error enviando Telegram reply", e)
            threading.Thread(target=_send).start()
        except Exception: 
            pass
        
    return jsonify({"success": True})

@admin_bp.route('/api/support_chats/<chat_id>', methods=['DELETE'])
@role_required_api('superadmin', 'admin')
def api_support_chat_delete(chat_id):
    database.delete_fb(f"user_telegrams/{chat_id}")
    return jsonify({"success": True, "message": "Conversación eliminada"})

# RETIROS - Admin Management
@admin_bp.route('/api/withdrawals')
@admin_required_api
def api_list_withdrawals():
    status_filter = request.args.get('status')
    todos = database.obtener_todos_retiros()
    if status_filter and status_filter != 'all':
        todos = [r for r in todos if r.get('status') == status_filter]
    return jsonify({'success': True, 'withdrawals': todos, 'total': len(todos)})

@admin_bp.route('/api/withdrawals/<tx_id>/complete', methods=['POST'])
@admin_required_api
def api_withdrawals_complete(tx_id):
    """Marks a withdrawal as completed in Firebase."""
    try:
        k, _ = database._find_retiro_key(tx_id)
        if not k:
            return jsonify({'success': False, 'message': 'Retiro no encontrado'}), 404
            
        if database.completar_retiro(k):
            return jsonify({'success': True, 'message': 'Retiro marcado como completado.'})
        else:
            return jsonify({'success': False, 'message': 'No se pudo completar. Puede que ya estuviera procesado.'}), 400
    except Exception as e:
        print(f"[Admin] Error completing withdrawal: {e}")
        return jsonify({'success': False, 'message': f'Error interno: {str(e)}'}), 500

@admin_bp.route('/api/withdrawals/<tx_id>/approve', methods=['POST'])
@admin_required_api
def api_withdrawals_approve(tx_id):
    """
    Approves a withdrawal.
    - PayPal: triggers instant payout via PayPal API and marks as 'completed'.
    - P2P: marks as 'approved' for manual processing by admin.
    Bits were already deducted when the player made the request.
    """
    import paypal_service
    from datetime import datetime as _dt

    try:
        k, retiro = database._find_retiro_key(tx_id)
        if not k or not retiro:
            return jsonify({'success': False, 'message': 'Retiro no encontrado'}), 404

        method = retiro.get('method', 'p2p')

        # ── PayPal: fire automatic payout ──────────────────────────────────
        if method == 'paypal':
            paypal_email = retiro.get('paypal_email', '')
            usd          = float(retiro.get('usd', 0))
            bits         = int(retiro.get('bits', 0))
            telegram_id  = str(retiro.get('telegram_id', ''))
            username     = str(retiro.get('username', ''))
            tx_ref       = str(retiro.get('tx_id', tx_id))

            if not paypal_email:
                return jsonify({'success': False, 'message': 'Este retiro no tiene email de PayPal registrado.'}), 400

            if usd <= 0:
                return jsonify({'success': False, 'message': 'El monto es 0 USD — no se puede procesar.'}), 400

            # Call PayPal Payouts API
            result = paypal_service.execute_payout(
                email        = paypal_email,
                amount_usd   = usd,
                reference_id = tx_ref,
                note         = f'Retiro de {bits:,} bits — GHOSTH PLAGUE CASINO'
            )

            if result['success']:
                # Mark as completed (not just approved) since money was sent
                database.patch_fb(f'retiros/{k}', {
                    'status': 'completed',
                    'processed_at': _dt.utcnow().isoformat(),
                    'paypal_batch_id': result.get('batch_id', ''),
                    'paypal_status': result.get('status', ''),
                })
                # Notify player via Telegram
                try:
                    database.notify_withdrawal_approved(telegram_id, bits, usd, tx_ref)
                except Exception:
                    pass
                return jsonify({
                    'success': True,
                    'message': f'✅ Pago enviado a {paypal_email} por ${usd:.2f} USD vía PayPal. (Batch: {result.get("batch_id")})'
                })
            else:
                # Mark the withdrawal with an error state so admin knows it failed
                database.patch_fb(f'retiros/{k}', {
                    'status': 'error_paypal',
                    'paypal_error': result.get('error_msg', 'Error desconocido'),
                    'processed_at': _dt.utcnow().isoformat(),
                })
                return jsonify({
                    'success': False,
                    'message': f'❌ PayPal rechazó el pago: {result.get("error_msg", "Error desconocido")}. El retiro quedó como "error_paypal". Puedes intentar de nuevo o rechazarlo para reembolsar los bits al jugador.'
                }), 400

        # ── P2P: mark as approved, admin pays manually ──────────────────────
        if database.aprobar_retiro(k):
            return jsonify({'success': True, 'message': 'Retiro P2P aprobado. Realiza el pago manualmente al jugador.'})
        else:
            return jsonify({'success': False, 'message': 'No se pudo aprobar el retiro.'}), 400

    except Exception as e:
        print(f"[Admin] Error approving withdrawal: {e}")
        return jsonify({'success': False, 'message': f'Error interno: {str(e)}'}), 500


@admin_bp.route('/api/withdrawals/<tx_id>/reject', methods=['POST'])

@admin_required_api
def api_withdrawals_reject(tx_id):
    """Rejects a withdrawal and refunds bits."""
    try:
        data = request.json or {}
        reason = data.get('reason', '')
        k, _ = database._find_retiro_key(tx_id)
        if not k:
            return jsonify({'success': False, 'message': 'Retiro no encontrado'}), 404
            
        if database.rechazar_retiro(k, reason):
            return jsonify({'success': True, 'message': 'Retiro rechazado. Se han reembolsado los bits al jugador.'})
        else:
            return jsonify({'success': False, 'message': 'No se pudo rechazar el retiro.'}), 400
    except Exception as e:
        print(f"[Admin] Error rejecting withdrawal: {e}")
        return jsonify({'success': False, 'message': f'Error interno: {str(e)}'}), 500


# ─── LOADING SCREEN CONFIG ─────────────────────────────────────────────────────

@admin_bp.route('/api/loading-screen', methods=['GET'])
@admin_required_api
def api_get_loading_screen():
    """Returns the current loading screen configuration."""
    cfg = database.get_fb('loading_screen_config') or {}
    defaults = {
        'is_active': False,
        'icon_id': 1,
        'text': 'Cargando...',
        'bg_color': '#0a0a1a',
        'icon_color': '#f59e0b',
        'text_color': 'rgba(255,255,255,0.7)',
        'logo_url': '',
    }
    return jsonify({'success': True, 'config': {**defaults, **cfg}})


@admin_bp.route('/api/loading-screen', methods=['POST'])
@admin_required_api
def api_save_loading_screen():
    """Saves the loading screen configuration to Firebase."""
    data = request.get_json() or {}
    allowed_keys = {'is_active', 'icon_id', 'text', 'bg_color', 'icon_color', 'text_color', 'logo_url'}
    cfg = {k: v for k, v in data.items() if k in allowed_keys}

    # Type coercions
    if 'is_active' in cfg:
        cfg['is_active'] = bool(cfg['is_active'])
    if 'icon_id' in cfg:
        cfg['icon_id'] = max(1, min(10, int(cfg['icon_id'])))

    try:
        database.patch_fb('loading_screen_config', cfg)
        return jsonify({'success': True, 'config': cfg})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500

# ─── SPORTS BETTING RESOLUTION ──────────────────────────────────────────────────

@admin_bp.route('/api/bets', methods=['GET'])
@admin_required_api
@role_required_api('superadmin', 'admin')
def api_get_admin_bets():
    try:
        status_filter = request.args.get('status', 'all')
        bets_db = database._to_dict(database.get_fb("sports_bets"))
        
        bets = []
        for k, b in bets_db.items():
            if status_filter != 'all' and b.get('status', 'pending') != status_filter:
                continue
                
            telegram_id = b.get('telegram_id', 'Desconocido')
            user_info = database.get_fb(f"usuarios/{telegram_id}") or {}
            
            bets.append({
                'id': k,
                'telegram_id': telegram_id,
                'username': user_info.get('username', 'N/A'),
                'match_name': b.get('match_name', 'Unknown Match'),
                'team_choice': b.get('team_choice', ''),
                'amount': b.get('amount', 0),
                'odd': b.get('odd', 1.0),
                'status': b.get('status', 'pending'),
                'created_at': b.get('created_at', '')
            })
            
        bets.sort(key=lambda x: x.get('created_at', ''), reverse=True)
        return jsonify({'success': True, 'bets': bets})
        
    except Exception as e:
        print(f"[Admin] Error fetching bets: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500

@admin_bp.route('/api/bets/<bet_id>/resolve', methods=['POST'])
@admin_required_api
@role_required_api('superadmin', 'admin')
def api_resolve_bet(bet_id):
    try:
        data = request.get_json() or {}
        winner_choice = data.get('winner_choice') # The choice the user bet on, e.g. "Real Madrid", "1", "Empate"
        action = data.get('action') # 'settle', 'cancel'
        
        bet = database.get_fb(f"sports_bets/{bet_id}")
        if not bet:
            return jsonify({'success': False, 'message': 'Apuesta no encontrada.'}), 404
            
        if bet.get('status') != 'pending':
            return jsonify({'success': False, 'message': 'Esta apuesta ya fue resuelta.'}), 400
            
        telegram_id = bet.get('telegram_id')
        amount = float(bet.get('amount', 0))
        odd = float(bet.get('odd', 1.0))
        user_choice = bet.get('team_choice')
        
        if action == 'cancel':
            database.recargar_bits(telegram_id, int(amount)) # Refund
            database.patch_fb(f"sports_bets/{bet_id}", {"status": "cancelled"})
            msg = f"Apuesta CANCELADA. Se han devuelto {amount} bits al jugador."
            
        elif action == 'settle':
            if not winner_choice:
                return jsonify({'success': False, 'message': 'Falta el equipo ganador real.'}), 400
            
            if str(user_choice).lower().strip() == str(winner_choice).lower().strip():
                # User Won
                is_draw = str(user_choice).lower().strip() in ['empate', 'draw', 'x']
                actual_odd = 2.00 if is_draw else 1.75
                winnings = int(amount * actual_odd)
                database.recargar_bits(telegram_id, winnings)
                database.patch_fb(f"sports_bets/{bet_id}", {"status": "won"})
                msg = f"Apuesta marcada como GANADA. Pagados {winnings} bits."
            else:
                # User Lost
                database.patch_fb(f"sports_bets/{bet_id}", {"status": "lost"})
                msg = "Apuesta marcada como PERDIDA."
        else:
            return jsonify({'success': False, 'message': 'Acción inválida.'}), 400
            
        return jsonify({'success': True, 'message': msg})
        
    except Exception as e:
        print(f"[Admin] Error resolving bet: {e}")
        return jsonify({'success': False, 'message': str(e)}), 500

# =====================================================================
# GESTIÓN DE PARTIDOS PERSONALIZADOS
# =====================================================================
@admin_bp.route('/api/custom_matches', methods=['GET', 'POST'])
@admin_required_api
def handle_custom_matches():
    if request.method == 'GET':
        matches = database.get_fb('custom_matches') or {}
        matches_list = []
        for sport, sport_matches in matches.items():
            if not isinstance(sport_matches, dict):
                continue
            for m_id, m_data in sport_matches.items():
                if not m_data:
                    continue
                entry = dict(m_data)
                entry['id'] = m_id
                entry['sport'] = sport
                matches_list.append(entry)
        matches_list.sort(key=lambda x: str(x.get('date', '')), reverse=True)

        # ── Aggregate bet counts per match ────────────────────────────────
        try:
            bets_db = database._to_dict(database.get_fb('sports_bets')) or {}
        except Exception:
            bets_db = {}

        # Build a lookup: { match_id -> { team_choice -> count } }
        bet_counts = {}
        for b in bets_db.values():
            if not b or not isinstance(b, dict):
                continue
            b_match_id = b.get('match_id', '')
            b_choice   = str(b.get('team_choice', '')).lower().strip()
            if not b_match_id:
                continue
            if b_match_id not in bet_counts:
                bet_counts[b_match_id] = {}
            bet_counts[b_match_id][b_choice] = bet_counts[b_match_id].get(b_choice, 0) + 1

        # Also match by home+away string for bets placed using match_name
        for m in matches_list:
            m_id   = m.get('id', '')
            home   = (m.get('home_team') or '').lower().strip()
            away   = (m.get('away_team') or '').lower().strip()
            stats  = dict(bet_counts.get(m_id, {}))

            # Fallback: scan bets matching by home+away team name in match_name
            for b in bets_db.values():
                if not b or not isinstance(b, dict):
                    continue
                if b.get('match_id', '') == m_id:
                    continue  # already counted
                b_name   = (b.get('match_name') or '').lower()
                b_choice = str(b.get('team_choice', '')).lower().strip()
                if home and away and home in b_name and away in b_name and b_choice:
                    stats[b_choice] = stats.get(b_choice, 0) + 1

            m['bet_stats'] = stats
            m['bet_total'] = sum(stats.values())

        return jsonify({'success': True, 'matches': matches_list})

    elif request.method == 'POST':
        data = request.json or {}
        sport     = data.get('sport', 'soccer')
        home      = (data.get('home_team') or '').strip()
        away      = (data.get('away_team') or '').strip()
        match_date = (data.get('date') or '').strip()
        league    = (data.get('league') or 'Evento Especial').strip()
        description = (data.get('description') or '').strip()
        
        if not home or not away or not match_date:
            return jsonify({'success': False, 'message': 'Faltan campos obligatorios (equipos y fecha)'}), 400
            
        import time
        custom_id = f"custom_{int(time.time()*1000)}"
        match_data = {
            "home_team":   home,
            "away_team":   away,
            "date":        match_date,
            "league":      league,
            "description": description,
            "sport":       sport,
            "status":      "upcoming",
            "score_home":  None,
            "score_away":  None,
            "created_at":  time.time(),
            "name":        f"{home} vs {away}"
        }
        database.patch_fb(f"custom_matches/{sport}/{custom_id}", match_data)
        return jsonify({'success': True, 'message': f'Partido "{home} vs {away}" creado en {sport}', 'id': custom_id})


@admin_bp.route('/api/custom_matches/<sport>/<match_id>', methods=['DELETE'])
@admin_required_api
def delete_custom_match(sport, match_id):
    try:
        database.delete_fb(f"custom_matches/{sport}/{match_id}")
        return jsonify({'success': True, 'message': 'Partido eliminado'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@admin_bp.route('/api/custom_matches/<sport>/<match_id>', methods=['PATCH'])
@admin_required_api
def edit_custom_match(sport, match_id):
    """Edit an existing custom match's metadata (date, teams, league, description)."""
    try:
        existing = database.get_fb(f"custom_matches/{sport}/{match_id}")
        if not existing:
            return jsonify({'success': False, 'message': 'Partido no encontrado'}), 404

        data = request.json or {}
        update = {}

        if 'home_team' in data and data['home_team'].strip():
            update['home_team'] = data['home_team'].strip()
        if 'away_team' in data and data['away_team'].strip():
            update['away_team'] = data['away_team'].strip()
        if 'date' in data and data['date'].strip():
            update['date'] = data['date'].strip()
        if 'league' in data:
            update['league'] = (data['league'] or 'Evento Especial').strip()
        if 'description' in data:
            update['description'] = (data['description'] or '').strip()
            
        if 'score_home' in data:
            update['score_home'] = data['score_home']
        if 'score_away' in data:
            update['score_away'] = data['score_away']

        # Rebuild name if teams changed
        home = update.get('home_team', existing.get('home_team', ''))
        away = update.get('away_team', existing.get('away_team', ''))
        update['name'] = f"{home} vs {away}"

        database.patch_fb(f"custom_matches/{sport}/{match_id}", update)
        return jsonify({'success': True, 'message': 'Partido actualizado correctamente'})
    except Exception as e:
        return jsonify({'success': False, 'message': str(e)}), 500


@admin_bp.route('/api/custom_matches/resolve', methods=['POST'])
@admin_required_api
def resolve_custom_match():
    data = request.json or {}
    sport        = data.get('sport')
    match_id     = data.get('match_id')
    winner_choice = data.get('winner')   # 'home', 'away', or 'empate'
    score_home   = data.get('score_home')  # Optional: numeric score
    score_away   = data.get('score_away')  # Optional: numeric score
    
    if not sport or not match_id or not winner_choice:
        return jsonify({'success': False, 'message': 'Faltan datos: sport, match_id y winner son requeridos'}), 400
        
    match_data = database.get_fb(f"custom_matches/{sport}/{match_id}")
    if not match_data:
        return jsonify({'success': False, 'message': 'Partido no encontrado'}), 404
        
    if match_data.get('status') in ('finished', 'resolved'):
        return jsonify({'success': False, 'message': 'El partido ya fue resuelto anteriormente'}), 400
    
    home_team = match_data.get('home_team', '')
    away_team = match_data.get('away_team', '')
        
    winner_str_compare = ""
    if winner_choice == 'home':
        winner_str_compare = home_team.lower().strip()
    elif winner_choice == 'away':
        winner_str_compare = away_team.lower().strip()
    else:
        winner_str_compare = "empate"
    
    import time as _time
    # Build score display string
    score_display = f"{score_home}-{score_away}" if score_home is not None and score_away is not None else None
    
    update_payload = {
        "status":      "finished",
        "winner":      winner_choice,
        "resolved_at": _time.time()
    }
    if score_home is not None:
        update_payload['score_home'] = score_home
    if score_away is not None:
        update_payload['score_away'] = score_away
    if score_display:
        update_payload['score_display'] = score_display
        
    database.patch_fb(f"custom_matches/{sport}/{match_id}", update_payload)
    
    bets = database.get_fb('sports_bets') or {}
    resolved_count = 0
    won_count = 0
    lost_count = 0
    
    for bet_id, b in bets.items():
        if not b:
            continue
        # Match by match_id OR by match_name containing both team names
        bet_match_id = b.get('match_id', '')
        bet_match_name = b.get('match_name', '').lower()
        is_this_match = (bet_match_id == match_id) or (
            home_team.lower() in bet_match_name and away_team.lower() in bet_match_name
        )
        
        if is_this_match and b.get('status') == 'pending':
            telegram_id = b.get('telegram_id')
            amount      = float(b.get('amount', 0))
            user_choice = str(b.get('team_choice', '')).lower().strip()
            
            user_won = (
                user_choice == winner_str_compare or
                (winner_str_compare and user_choice in winner_str_compare) or
                (user_choice and winner_str_compare in user_choice)
            )
            
            if user_won:
                is_draw = user_choice in ['empate', 'draw', 'x']
                actual_odd = 2.00 if is_draw else 1.75
                winnings = int(amount * actual_odd)
                
                database.recargar_bits(telegram_id, winnings)
                database.patch_fb(f"sports_bets/{bet_id}", {"status": "won"})
                score_info = f" (Resultado: {score_display})" if score_display else ""
                try:
                    database.notify_user(
                        telegram_id,
                        "✅ ¡Apuesta Ganada!",
                        f"Tu apuesta en {home_team} vs {away_team} ganó{score_info}.\nCobraste {winnings:,} bits."
                    )
                except: pass
                won_count += 1
            else:
                database.patch_fb(f"sports_bets/{bet_id}", {"status": "lost"})
                try:
                    database.notify_user(
                        telegram_id,
                        "❌ Apuesta Perdida",
                        f"Perdiste tu apuesta de {int(amount):,} bits en {home_team} vs {away_team}."
                    )
                except: pass
                lost_count += 1
            resolved_count += 1
    
    score_msg = f" Marcador: {score_display}" if score_display else ""
    return jsonify({
        'success': True,
        'message': f'Partido resuelto.{score_msg} Apuestas procesadas: {resolved_count} ({won_count} ganadas, {lost_count} perdidas).'
    })
