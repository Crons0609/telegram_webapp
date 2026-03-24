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
    results = []
    for chat_id, data in chats.items():
        info = data.get("info", {}) if isinstance(data, dict) else {}
        info["chat_id"] = chat_id
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
    k, _ = database._find_retiro_key(tx_id)
    if not k:
        return jsonify({'success': False, 'message': 'Retiro no encontrado'}), 404
        
    if database.completar_retiro(k):
        return jsonify({'success': True, 'message': 'Retiro marcado como completado.'})
    else:
        return jsonify({'success': False, 'message': 'No se pudo completar. Puede que ya estuviera procesado.'}), 400

@admin_bp.route('/api/withdrawals/<tx_id>/reject', methods=['POST'])
@admin_required_api
def api_withdrawals_reject(tx_id):
    """Rejects a withdrawal and refunds bits."""
    data = request.json or {}
    reason = data.get('reason', '')
    k, _ = database._find_retiro_key(tx_id)
    if not k:
        return jsonify({'success': False, 'message': 'Retiro no encontrado'}), 404
        
    if database.rechazar_retiro(k, reason):
        return jsonify({'success': True, 'message': 'Retiro rechazado. Se han reembolsado los bits al jugador.'})
    else:
        return jsonify({'success': False, 'message': 'No se pudo rechazar el retiro.'}), 400
