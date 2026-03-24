import json
import httpx
import requests
import config
from contextlib import contextmanager
from typing import Optional
from datetime import datetime

FIREBASE_URL = "https://ghost-plague-casino-default-rtdb.firebaseio.com"

def _to_dict(data):
    if data is None: return {}
    if isinstance(data, list):
        return {str(i): v for i, v in enumerate(data) if v is not None}
    return dict(data)

def get_fb(path: str):
    try:
        r = httpx.get(f"{FIREBASE_URL}/{path}.json", timeout=10.0)
        return r.json()
    except Exception as e:
        print(f"Firebase GET error at {path}: {e}")
        return None

def put_fb(path: str, data: dict):
    try:
        r = httpx.put(f"{FIREBASE_URL}/{path}.json", json=data, timeout=10.0)
        return r.json()
    except Exception as e:
        print(f"Firebase PUT error at {path}: {e}")
        return None

def patch_fb(path: str, data: dict):
    try:
        r = httpx.patch(f"{FIREBASE_URL}/{path}.json", json=data, timeout=10.0)
        return r.json()
    except Exception as e:
        print(f"Firebase PATCH error at {path}: {e}")
        return None

def post_fb(path: str, data: dict):
    try:
        r = httpx.post(f"{FIREBASE_URL}/{path}.json", json=data, timeout=10.0)
        return r.json()
    except Exception as e:
        print(f"Firebase POST error at {path}: {e}")
        return None

def delete_fb(path: str):
    try:
        r = httpx.delete(f"{FIREBASE_URL}/{path}.json", timeout=10.0)
        return r.status_code == 200
    except Exception as e:
        print(f"Firebase DELETE error at {path}: {e}")
        return False

@contextmanager
def get_connection():
    # Firebase is schema-less API based, no real 'connection' needed
    # We yield a dummy to not break existing context managers
    class DummyConn:
        def execute(self, *args, **kwargs):
            return DummyCursor()
        def close(self): pass
        def commit(self): pass
        def rollback(self): pass
    
    class DummyCursor:
        def fetchall(self): return []
        def fetchone(self): return None
        @property
        def lastrowid(self): return 1
        @property
        def rowcount(self): return 1
        
    yield DummyConn()

def init_db() -> None:
    # Initialize initial configs in Firebase if they don't exist
    
    # Check default admin
    admins = get_fb("Administradores")
    if not admins:
        from werkzeug.security import generate_password_hash
        default_hash = generate_password_hash("admin123")
        post_fb("Administradores", {"Email": "admin@admin.com", "password_hash": default_hash, "created_at": datetime.utcnow().isoformat()})
    
    themes = get_fb("themes")
    if not themes:
        default_themes = {
            "default": {"name": "Default (Casino)", "slug": "default", "description": "Tema base dorado elegante", "primary_color": "#c9a227", "secondary_color": "#f0cc55", "bg_color": "#0a0a0f", "accent_glow": "rgba(201,162,39,0.25)", "particles_color": "rgba(212,175,55,0.55)", "background_image": "", "background_overlay": "", "typography": "{}", "ui_sounds": "{}", "animations": "{}", "is_active": 1, "created_at": datetime.utcnow().isoformat(), "updated_at": datetime.utcnow().isoformat()}
        }
        put_fb("themes", default_themes)
        
    trophies_config = get_fb("trophies_config")
    if not trophies_config:
        tconf = {
            "trophy_1": {"id": "trophy_1", "name": "Primera Victoria", "desc": "Gana tu primera partida en cualquier juego.", "img": "/static/img/trophies/trophy_1.png", "stat_name": "wins_total", "stat_target": 1, "is_active": 1},
            "trophy_2": {"id": "trophy_2", "name": "Bronce en Combate", "desc": "Acumula 5 victorias en cualquier juego.", "img": "/static/img/trophies/trophy_2.png", "stat_name": "wins_total", "stat_target": 5, "is_active": 1},
            "trophy_3": {"id": "trophy_3", "name": "Plata Implacable", "desc": "Alcanza 10 victorias en cualquier juego.", "img": "/static/img/trophies/trophy_3.png", "stat_name": "wins_total", "stat_target": 10, "is_active": 1},
            "trophy_4": {"id": "trophy_4", "name": "Maestro del Moche", "desc": "Gana 10 partidas de Moche.", "img": "/static/img/trophies/trophy_4.png", "stat_name": "moches_ganados", "stat_target": 10, "is_active": 1},
            "trophy_5": {"id": "trophy_5", "name": "Jackpot Supremo", "desc": "Obtén un Jackpot en la Slot Machine.", "img": "/static/img/trophies/trophy_5.png", "stat_name": "jackpots_ganados", "stat_target": 1, "is_active": 1},
            "trophy_6": {"id": "trophy_6", "name": "Señor de la Ruleta", "desc": "Gana 10 rondas de Ruleta Francesa.", "img": "/static/img/trophies/trophy_6.png", "stat_name": "ruletas_ganadas", "stat_target": 10, "is_active": 1},
            "trophy_7": {"id": "trophy_7", "name": "Racha Dorada", "desc": "Acumula 25 victorias en cualquier juego.", "img": "/static/img/trophies/trophy_7.svg", "stat_name": "wins_total", "stat_target": 25, "is_active": 1},
            "trophy_8": {"id": "trophy_8", "name": "Rey del Casino", "desc": "Alcanza las 50 victorias acumuladas.", "img": "/static/img/trophies/trophy_8.svg", "stat_name": "wins_total", "stat_target": 50, "is_active": 1},
            "trophy_9": {"id": "trophy_9", "name": "Leyenda Inmortal", "desc": "Supera las 100 victorias. La cima del casino.", "img": "/static/img/trophies/trophy_9.svg", "stat_name": "wins_total", "stat_target": 100, "is_active": 1}
        }
        put_fb("trophies_config", tconf)

    missions = get_fb("missions")
    if not missions:
        try:
            from mission_data import MISSIONS
            m_dict = {}
            l_dict = {}
            lvl_id = 1
            for m in MISSIONS:
                m_dict[m['id']] = {
                    "id": m['id'], "name": m['name'], "desc": m['desc'], "icon": m['icon'], "type": m['type'], "is_active": 1
                }
                for lvl in m['levels']:
                    l_dict[str(lvl_id)] = {
                        "id": lvl_id, "mission_id": m['id'], "level": lvl['level'], "target": lvl['target'], "xp_reward": lvl['xp_reward'], "bits_reward": lvl['bits_reward']
                    }
                    lvl_id += 1
            put_fb("missions", m_dict)
            put_fb("mission_levels", l_dict)
        except Exception as e:
            print(f"Error seeding missions: {e}")

# =====================================================
# THEME HELPERS
# =====================================================
def get_active_theme() -> dict:
    themes = _to_dict(get_fb("themes"))
    for key, t in themes.items():
        if t.get("is_active") == 1:
            d = dict(t)
            d['typography'] = json.loads(d.get('typography') or '{}')
            d['ui_sounds'] = json.loads(d.get('ui_sounds') or '{}')
            d['animations'] = json.loads(d.get('animations') or '{}')
            return d
    return {"slug": "default", "name": "Default (Casino)", "primary_color": "#c9a227", "secondary_color": "#f0cc55", "bg_color": "#0a0a0f", "accent_glow": "rgba(201,162,39,0.25)", "particles_color": "rgba(212,175,55,0.55)", "background_image": "", "background_overlay": "", "typography": {}, "ui_sounds": {}, "animations": {}}

def get_all_themes() -> list:
    themes = _to_dict(get_fb("themes"))
    res = []
    for k, r in themes.items():
        d = dict(r)
        d['id'] = k
        d['typography'] = json.loads(d.get('typography') or '{}')
        d['ui_sounds'] = json.loads(d.get('ui_sounds') or '{}')
        d['animations'] = json.loads(d.get('animations') or '{}')
        res.append(d)
    return res

def activate_theme(theme_slug: str) -> bool:
    themes = _to_dict(get_fb("themes"))
    updates = {}
    for k in themes:
        updates[f"{k}/is_active"] = 0
    patch_fb("themes", updates)
    patch_fb(f"themes/{theme_slug}", {"is_active": 1, "updated_at": datetime.utcnow().isoformat()})
    return True

def create_theme(name: str, slug: str, description: str, primary_color: str, secondary_color: str, bg_color: str, accent_glow: str, particles_color: str, background_image: str = '', background_overlay: str = '', typography: dict = None, ui_sounds: dict = None, animations: dict = None):
    t = {
        "name": name, "slug": slug, "description": description, "primary_color": primary_color, "secondary_color": secondary_color, "bg_color": bg_color, "accent_glow": accent_glow, "particles_color": particles_color, "background_image": background_image, "background_overlay": background_overlay, "typography": json.dumps(typography or {}), "ui_sounds": json.dumps(ui_sounds or {}), "animations": json.dumps(animations or {}), "is_active": 0, "created_at": datetime.utcnow().isoformat(), "updated_at": datetime.utcnow().isoformat()
    }
    put_fb(f"themes/{slug}", t)
    return slug

def update_theme(theme_slug: str, data: dict) -> bool:
    if 'typography' in data: data['typography'] = json.dumps(data['typography'] or {})
    if 'ui_sounds' in data: data['ui_sounds'] = json.dumps(data['ui_sounds'] or {})
    if 'animations' in data: data['animations'] = json.dumps(data['animations'] or {})
    data["updated_at"] = datetime.utcnow().isoformat()
    patch_fb(f"themes/{theme_slug}", data)
    return True

def get_theme_schedules() -> list:
    schedules = _to_dict(get_fb("theme_schedules"))
    themes = _to_dict(get_fb("themes"))
    res = []
    for k, s in schedules.items():
        theme = themes.get(s['theme_slug'], {})
        d = dict(s)
        d['id'] = k
        d['theme_name'] = theme.get('name', 'Unknown')
        res.append(d)
    return sorted(res, key=lambda x: x.get('start_date', ''))

def create_schedule(theme_slug: str, event_name: str, start_date: str, end_date: str, priority: int = 1) -> str:
    res = post_fb("theme_schedules", {"theme_slug": theme_slug, "event_name": event_name, "start_date": start_date, "end_date": end_date, "priority": priority})
    return res.get("name") if res else None

def delete_schedule(schedule_id: str) -> bool:
    return delete_fb(f"theme_schedules/{schedule_id}")

def check_and_apply_scheduled_theme() -> bool:
    now = datetime.utcnow().isoformat()
    schedules = _to_dict(get_fb("theme_schedules"))
    active_sched = None
    for k, s in schedules.items():
        if s['start_date'] <= now and s['end_date'] >= now:
            if not active_sched or s.get('priority', 1) > active_sched.get('priority', 1):
                active_sched = s
    if active_sched:
        active_theme = get_active_theme()
        if active_theme.get("slug") != active_sched['theme_slug']:
            activate_theme(active_sched['theme_slug'])
            return True
    return False

def _asegurar_stats(telegram_id: str):
    stats = get_fb(f"user_stats/{telegram_id}")
    if not stats:
        put_fb(f"user_stats/{telegram_id}", {
            "juegos_jugados": 0, "jackpots_ganados": 0, "moches_ganados": 0, "ruletas_ganadas": 0,
            "wins_total": 0, "tiempo_jugado": 0, "bits_apostados": 0, "bits_ganados": 0, "win_streak": 0,
            "tournaments_played": 0, "tournaments_won": 0, "juegos_diferentes": 0, "ajedrez_elo": 1200, "ajedrez_partidas": 0
        })

def _get_next_cliente_id() -> int:
    clientes = _to_dict(get_fb("usuarios"))
    max_id = 0
    for u in clientes.values():
        cid = u.get("cliente_id", 0)
        if cid > max_id:
            max_id = cid
    return max_id + 1

def agregar_usuario(telegram_id: str, nombre: str, username: Optional[str] = None, photo_url: Optional[str] = None) -> bool:
    telegram_id = str(telegram_id)
    user = get_fb(f"usuarios/{telegram_id}")
    if not user:
        next_id = _get_next_cliente_id()
        base_user = {
            "telegram_id": telegram_id,
            "cliente_id": next_id, # for admin panel compatibility
            "nombre": nombre,
            "username": username or "",
            "photo_url": photo_url or "",
            "bits": 0,
            "bits_demo": 5500,
            "xp": 0,
            "nivel": 1,
            "marco_actual": "none",
            "avatar_frame": "none",
            "tema_actual": "default",
            "total_recargas": 0,
            "total_ganados": 0,
            "last_daily_reward": None,
            "daily_streak": 0,
            "Estado": "activo",
            "timestamp": datetime.utcnow().isoformat()
        }
        put_fb(f"usuarios/{telegram_id}", base_user)
        _asegurar_stats(telegram_id)
        return True
    else:
        patch_fb(f"usuarios/{telegram_id}", {
            "nombre": nombre,
            "username": username or user.get("username", ""),
            "photo_url": photo_url or user.get("photo_url", "")
        })
        return False  # User already existed — NOT new

def resetear_bits_demo(telegram_id: str) -> bool:
    try:
        user = get_fb(f"usuarios/{telegram_id}")
        if user:
            patch_fb(f"usuarios/{telegram_id}", {"bits_demo": 5500})
            return True
        return False
    except Exception as e:
        print(f"Error reseteando bits clave: {e}")
        return False



# ---------------------------------------------------------------------------
# BOT INVITE / REFERRAL HELPERS
# ---------------------------------------------------------------------------

def register_new_user_from_bot(telegram_id: str, nombre: str, username: str, photo_url: str, referrer_id: str = None) -> bool:
    """Register a completely new user from a bot /start interaction.
    Returns True if the user was NEWLY created (so we can reward the referrer),
    False if the user already existed.
    """
    telegram_id = str(telegram_id)
    is_new = agregar_usuario(telegram_id, nombre, username or "", photo_url or "")
    if is_new and referrer_id:
        referrer_id = str(referrer_id)
        # Only reward if invitee is genuinely new and the referrer is not themselves
        if referrer_id != telegram_id and get_fb(f"usuarios/{referrer_id}"):
            # Credit 1000 demo bits to referrer
            current = obtener_bits(referrer_id, is_demo=True)
            patch_fb(f"usuarios/{referrer_id}", {"bits_demo": current + 1000})
            # Log the invite
            patch_fb(f"usuarios/{referrer_id}", {"total_invitaciones": (get_fb(f"usuarios/{referrer_id}/total_invitaciones") or 0) + 1})
            post_fb(f"invite_log/{referrer_id}", {
                "invitee_id": telegram_id,
                "invitee_name": nombre,
                "timestamp": datetime.utcnow().isoformat(),
                "reward_demo_bits": 1000
            })
    return is_new

def get_invite_stats(telegram_id: str) -> dict:
    """Return invite count and demo-bits earned for a user."""
    count = get_fb(f"usuarios/{str(telegram_id)}/total_invitaciones") or 0
    return {"total_invitaciones": int(count)}

def obtener_perfil_completo(telegram_id: str) -> dict:
    telegram_id = str(telegram_id)
    u = get_fb(f"usuarios/{telegram_id}")
    if not u: return None
    
    s = get_fb(f"user_stats/{telegram_id}") or {}
    
    perfil = dict(u)
    perfil.update(s)
    
    unlocked = get_fb(f"unlocked_items/{telegram_id}") or {}
    perfil['unlocked_items'] = [{'type': v['item_type'], 'id': v['item_id']} for v in unlocked.values()]
    return perfil

def obtener_bits(telegram_id: str, is_demo: bool = False) -> int:
    campo = "bits_demo" if is_demo else "bits"
    b = get_fb(f"usuarios/{str(telegram_id)}/{campo}")
    return int(b) if b is not None else 0

def obtener_todos_usuarios() -> list:
    users = get_fb("usuarios") or {}
    res = []
    for k, u in users.items():
        d = dict(u)
        d['id'] = u.get('cliente_id', k)
        res.append(d)
    return sorted(res, key=lambda x: x.get('bits', 0), reverse=True)

def obtener_top_recargas() -> list:
    users = obtener_todos_usuarios()
    top = [u for u in users if u.get('total_recargas', 0) > 0]
    return sorted(top, key=lambda x: x['total_recargas'], reverse=True)[:10]

def obtener_top_ganadores() -> list:
    users = obtener_todos_usuarios()
    top = [u for u in users if u.get('total_ganados', 0) > 0]
    return sorted(top, key=lambda x: x['total_ganados'], reverse=True)[:10]

def recargar_bits(telegram_id: str, cantidad: int) -> bool:
    telegram_id = str(telegram_id)
    u = get_fb(f"usuarios/{telegram_id}")
    if u and cantidad > 0:
        new_bits = int(u.get('bits', 0)) + cantidad
        new_rec = int(u.get('total_recargas', 0)) + cantidad
        patch_fb(f"usuarios/{telegram_id}", {"bits": new_bits, "total_recargas": new_rec})
        return True
    return False

def descontar_bits(telegram_id: str, cantidad: int, is_demo: bool = False) -> bool:
    telegram_id = str(telegram_id)
    u = get_fb(f"usuarios/{telegram_id}")
    if u and cantidad > 0:
        campo = "bits_demo" if is_demo else "bits"
        b = int(u.get(campo, 0))
        if b >= cantidad:
            patch_fb(f"usuarios/{telegram_id}", {campo: b - cantidad})
            return True
    return False

def registrar_ganancia(telegram_id: str, cantidad: int, is_demo: bool = False) -> bool:
    telegram_id = str(telegram_id)
    u = get_fb(f"usuarios/{telegram_id}")
    if u and cantidad > 0:
        campo = "bits_demo" if is_demo else "bits"
        new_bits = int(u.get(campo, 0)) + cantidad
        updates = {campo: new_bits}
        if not is_demo:
            updates["total_ganados"] = int(u.get('total_ganados', 0)) + cantidad
        patch_fb(f"usuarios/{telegram_id}", updates)
        return True
    return False

def agregar_xp(telegram_id: str, cantidad: int) -> int:
    telegram_id = str(telegram_id)
    u = get_fb(f"usuarios/{telegram_id}")
    if u:
        new_xp = int(u.get('xp', 0)) + cantidad
        patch_fb(f"usuarios/{telegram_id}", {"xp": new_xp})
        return new_xp
    return 0

def actualizar_nivel(telegram_id: str, nuevo_nivel: int) -> bool:
    patch_fb(f"usuarios/{str(telegram_id)}", {"nivel": nuevo_nivel})
    return True

def incrementar_stat(telegram_id: str, columna: str, cantidad: int = 1) -> bool:
    telegram_id = str(telegram_id)
    _asegurar_stats(telegram_id)
    val = get_fb(f"user_stats/{telegram_id}/{columna}")
    new_val = (int(val) if val is not None else 0) + cantidad
    patch_fb(f"user_stats/{telegram_id}", {columna: new_val})
    return True

def actualizar_ajedrez_elo(telegram_id: str, new_elo: int) -> bool:
    telegram_id = str(telegram_id)
    _asegurar_stats(telegram_id)
    val = get_fb(f"user_stats/{telegram_id}/ajedrez_partidas")
    new_part = (int(val) if val is not None else 0) + 1
    patch_fb(f"user_stats/{telegram_id}", {"ajedrez_elo": new_elo, "ajedrez_partidas": new_part})
    return True

def actualizar_racha_victorias(telegram_id: str, is_win: bool) -> int:
    telegram_id = str(telegram_id)
    _asegurar_stats(telegram_id)
    st = get_fb(f"user_stats/{telegram_id}") or {}
    curr = int(st.get('current_win_streak', 0))
    mx = int(st.get('win_streak', 0))
    
    if is_win:
        curr += 1
        if curr > mx: mx = curr
    else:
        curr = 0
        
    patch_fb(f"user_stats/{telegram_id}", {"current_win_streak": curr, "win_streak": mx})
    return mx

def unlock_trophy(telegram_id: str, trophy_id: str) -> bool:
    telegram_id = str(telegram_id)
    existing = get_fb(f"trophies/{telegram_id}/{trophy_id}")
    if not existing:
        put_fb(f"trophies/{telegram_id}/{trophy_id}", {
            "trophy_id": trophy_id, "unlocked_at": datetime.utcnow().isoformat()
        })
        return True
    return False

def get_trophies(telegram_id: str) -> list:
    ts = get_fb(f"trophies/{str(telegram_id)}") or {}
    return sorted(list(ts.values()), key=lambda x: x.get('unlocked_at', ''))

def get_user_missions(telegram_id: str) -> list:
    ms = get_fb(f"user_missions/{str(telegram_id)}") or {}
    return list(ms.values())

def is_mission_claimed(telegram_id: str, mission_id: str) -> bool:
    ms = get_fb(f"user_missions/{str(telegram_id)}/{mission_id}")
    return bool(ms and ms.get('claimed') == 1)

def claim_mission(telegram_id: str, mission_id: str) -> bool:
    telegram_id = str(telegram_id)
    put_fb(f"user_missions/{telegram_id}/{mission_id}", {
        "mission_id": mission_id, "claimed": 1, "claimed_at": datetime.utcnow().isoformat()
    })
    return True

def desbloquear_item(telegram_id: str, item_type: str, item_id: str) -> bool:
    telegram_id = str(telegram_id)
    put_fb(f"unlocked_items/{telegram_id}/{item_type}_{item_id}", {
        "item_type": item_type, "item_id": item_id
    })
    return True

def equipar_item(telegram_id: str, tipo_campo: str, item_id: str) -> bool:
    campos = {'frame': 'avatar_frame', 'theme': 'tema_actual'}
    if tipo_campo not in campos: return False
    
    telegram_id = str(telegram_id)
    items = get_fb(f"unlocked_items/{telegram_id}") or {}
    owns = any(i.get('item_type') == tipo_campo and i.get('item_id') == item_id for i in items.values())
    
    if not owns and item_id not in ['none', 'default', 'bronze']:
        return False
        
    patch_fb(f"usuarios/{telegram_id}", {campos[tipo_campo]: item_id})
    return True

def reclamar_recompensa_diaria(telegram_id: str, hoy_str: str, recompensa: int, racha: int) -> bool:
    telegram_id = str(telegram_id)
    u = get_fb(f"usuarios/{telegram_id}")
    if u:
        new_bits = int(u.get('bits', 0)) + recompensa
        patch_fb(f"usuarios/{telegram_id}", {
            "bits": new_bits, "last_daily_reward": hoy_str, "daily_streak": racha
        })
        return True
    return False

def actualizar_nombre_usuario(telegram_id: str, nuevo_nombre: str) -> bool:
    patch_fb(f"usuarios/{str(telegram_id)}", {"nombre": nuevo_nombre})
    return True

def incrementar_tiempo_jugado(telegram_id: str, minutos: int) -> bool:
    return incrementar_stat(telegram_id, 'tiempo_jugado', minutos)

def registrar_transaccion(telegram_id: str, bits: int, usd: float, tipo: str) -> bool:
    """Registra una transacción en el historial global usando push IDs de Firebase"""
    tx = {
        "telegram_id": str(telegram_id),
        "bits": bits,
        "usd": usd,
        "usd_amount": usd,  # Legacy field
        "tipo": tipo,
        "fecha": datetime.utcnow().isoformat()
    }
    post_fb("transacciones", tx)
    return True

def recargar_bits(telegram_id: str, amount: int) -> Optional[int]:
    """Asigna bits reales a un usuario (usado por recarga_admin o pagos)"""
    try:
        telegram_id = str(telegram_id)
        u = get_fb(f"usuarios/{telegram_id}")
        if u:
            current = int(u.get("bits", 0))
            new_bits = current + int(amount)
            patch_fb(f"usuarios/{telegram_id}", {"bits": new_bits})
            return new_bits
        return None
    except Exception as e:
        print(f"Error recargando bits para {telegram_id}: {e}")
        return None

def registrar_partida(telegram_id: str, juego: str, apuesta: int, ganancia: int, resultado: str) -> bool:
    post_fb("juegos_historial", {
        "telegram_id": str(telegram_id), "juego": juego, "apuesta": apuesta, "ganancia": ganancia, "resultado": resultado, "fecha": datetime.utcnow().isoformat()
    })
    return True

def actualizar_ultima_partida_ganada(telegram_id: str, juego: str, ganancia: int) -> bool:
    # Too complex to query last element without firebase-admin sorting
    # We just fetch last 10, find the latest matching, and update
    telegram_id = str(telegram_id)
    try:
        r = httpx.get(f"{FIREBASE_URL}/juegos_historial.json?orderBy=\"telegram_id\"&equalTo=\"{telegram_id}\"&limitToLast=10", timeout=10.0)
        hists = r.json() or {}
        latest_key = None
        latest_date = ""
        for k, v in hists.items():
            if v.get('juego') == juego and v.get('fecha', "") > latest_date:
                latest_date = v.get('fecha', "")
                latest_key = k
        if latest_key:
            patch_fb(f"juegos_historial/{latest_key}", {"ganancia": ganancia, "resultado": "win"})
            return True
    except:
        pass
    return False

def obtener_metricas_financieras() -> dict:
    txs = _to_dict(get_fb("transacciones"))
    hists = _to_dict(get_fb("juegos_historial"))
    
    # We will simulate the financials. To avoid huge memory loads in production,
    # Firebase Cloud Functions or structured querying is better.
    # For now, memory calculation for migration:
    
    total_tx = len(txs)
    total_usd_invested = sum(t.get('bits', 0) for t in txs.values() if t.get('tipo') in ('deposito', 'recarga_admin'))
    total_usd_paid = sum(t.get('bits', 0) for t in txs.values() if t.get('tipo') == 'retiro')
    
    bits_profit = sum((int(h.get('apuesta', 0)) - int(h.get('ganancia', 0))) for h in hists.values())

    return {
        'total_transactions': total_tx,
        'tx_day': 0, 'tx_week': 0, 'tx_month': 0,
        'total_usd_invested': total_usd_invested,
        'total_usd_paid': total_usd_paid,
        'usd_net_day': 0, 'usd_net_week': 0, 'usd_net_month': 0,
        'bits_profit_day': 0, 'bits_profit_week': 0, 'bits_profit_month': bits_profit
    }

def registrar_solicitud_p2p(telegram_id: str, username: str, nombre: str, price_usd: float, bits_amount: int) -> str:
    res = post_fb("p2p_requests", {
        "telegram_id": str(telegram_id), "username": username, "nombre": nombre, "price_usd": price_usd, "bits_amount": bits_amount, "leida": 0, "fecha": datetime.utcnow().isoformat()
    })
    return res.get("name") if res else ""

def obtener_notificaciones(limit: int = 30) -> list:
    txs = get_fb("transacciones") or {}
    p2p = get_fb("p2p_requests") or {}
    combined = []
    
    for k, v in txs.items():
        if v.get('tipo') == 'deposito_paypal':
            v['id'] = k
            combined.append(v)
            
    for k, v in p2p.items():
        v['id'] = k
        v['tipo'] = 'p2p'
        combined.append(v)
        
    return sorted(combined, key=lambda x: x.get('fecha', ''), reverse=True)[:limit]

def marcar_notificaciones_leidas() -> None:
    p2p = get_fb("p2p_requests") or {}
    for k, v in p2p.items():
        if v.get('leida') == 0:
            patch_fb(f"p2p_requests/{k}", {"leida": 1})

def contar_notificaciones_no_leidas() -> int:
    p2p = get_fb("p2p_requests") or {}
    return sum(1 for v in p2p.values() if v.get('leida') == 0)

def actualizar_perfil(telegram_id: str, campos: dict) -> bool:
    """
    Generic profile field updater via PATCH.
    Accepts any dict of top-level field:value pairs under usuarios/{telegram_id}.
    Used by user_profile_manager to auto-equip frames and marco on level-up.
    """
    if not campos:
        return False
    patch_fb(f"usuarios/{str(telegram_id)}", campos)
    return True

# Helper para Admin - Obtener usuario por ID incremental (cliente_id)
# o por telegram_id si se pasa string.
def obtener_usuario(identifier) -> dict:
    if isinstance(identifier, int) or str(identifier).isdigit() and len(str(identifier)) < 8:
        users = get_fb("usuarios") or {}
        for k, u in users.items():
            if str(u.get("cliente_id")) == str(identifier):
                return u
    # Assume telegram_id
    return get_fb(f"usuarios/{str(identifier)}")

# =====================================================
# TELEGRAM SUPPORT CHAT HELPERS
# =====================================================

def save_user_telegram_msg(chat_id, first_name: str, username: str, text: str, sender: str = "user") -> None:
    """
    Save a message (from user or admin) into Firebase under user_telegrams/{chat_id}.
    Structure:
      user_telegrams/{chat_id}/info  — conversation metadata
      user_telegrams/{chat_id}/messages/{push_id} — individual messages
    """
    chat_id_str = str(chat_id)
    now = datetime.utcnow().isoformat()

    # Upsert conversation metadata
    info_path = f"user_telegrams/{chat_id_str}/info"
    info = get_fb(info_path) or {}
    unread = int(info.get("unread", 0))
    if sender == "user":
        unread += 1

    meta = {
        "chat_id": chat_id_str,
        "last_message": text[:80],
        "last_time": now,
        "unread": unread
    }
    
    # Solo actualizamos el nombre si el mensaje viene del usuario
    # para evitar que el nombre del admin sobrescriba el del usuario en la lista
    if sender == "user":
        meta["first_name"] = first_name
        meta["username"] = username or ""
    elif not info.get("first_name"):
        # Si es el admin el que inicia o no hay nombre, intentamos poner algo
        meta["first_name"] = info.get("first_name") or "Usuario"
        meta["username"] = info.get("username") or ""

    patch_fb(info_path, meta)

    # Push individual message
    post_fb(f"user_telegrams/{chat_id_str}/messages", {
        "sender": sender,
        "text": text,
        "timestamp": now
    })

# =====================================================
# TELEGRAM NOTIFICATIONS FOR PLAYERS
# =====================================================

def _send_tg(chat_id, text, parse_mode="HTML") -> None:
    """Internal helper to send a message via Telegram Bot API."""
    token = getattr(config, 'BOT_TOKEN', None)
    if not token:
        return
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = {
        "chat_id": str(chat_id),
        "text": text,
        "parse_mode": parse_mode
    }
    try:
        requests.post(url, json=payload, timeout=10)
    except Exception as e:
        print(f"[TG Notification Error] {e}")

def notify_bits_added_admin(telegram_id, amount_received, new_balance) -> None:
    """Sends a notification to the player when an admin adds bits manually."""
    msg = (
        "🎁 <b>¡Has recibido bits!</b>\n\n"
        "Un administrador ha agregado bits a tu cuenta.\n\n"
        f"💰 Bits recibidos: <b>{int(amount_received):,}</b>\n"
        f"💼 Balance actual: <b>{int(new_balance):,} Bits</b>\n\n"
        "¡Disfruta jugando en <b>Ghost Plague Casino</b>!"
    )
    _send_tg(telegram_id, msg)

def notify_bits_added_paypal(telegram_id, usd_paid, bits_received, new_balance) -> None:
    """Sends a notification to the player when a PayPal purchase is confirmed."""
    msg = (
        "✅ <b>Recarga exitosa</b>\n\n"
        "Tu compra de bits ha sido confirmada.\n\n"
        f"💳 Pago realizado: <b>${float(usd_paid):.2f}</b>\n"
        f"💰 Bits recibidos: <b>{int(bits_received):,}</b>\n"
        f"💼 Balance actual: <b>{int(new_balance):,} Bits</b>\n\n"
        "¡Gracias por apoyar <b>Ghost Plague Casino</b>!"
    )
    _send_tg(telegram_id, msg)

# ─────────────────────────────────────────────────────────
# SISTEMA DE RETIROS
# ─────────────────────────────────────────────────────────

def crear_solicitud_retiro(telegram_id: str, username: str, nombre: str, bits: int, usd: float, method: str,
                           paypal_email: str = '', status: str = 'pending', paypal_batch_id: str = None) -> str:
    """Creates a withdrawal request in Firebase and returns the transaction ID."""
    import uuid
    tx_id = str(uuid.uuid4())[:12].upper()
    data = {
        'telegram_id': str(telegram_id),
        'username': username or '',
        'nombre': nombre or '',
        'bits': int(bits),
        'usd': float(usd),
        'method': method,  # 'p2p' or 'paypal'
        'paypal_email': paypal_email or '',
        'status': status,
        'created_at': datetime.utcnow().isoformat(),
        'processed_at': datetime.utcnow().isoformat() if status == 'completed' else None,
        'paypal_tx_id': paypal_batch_id,
        'tx_id': tx_id,
    }
    res = post_fb('retiros', data)
    if res and 'name' in res:
        # Also patch the withdrawal tx_id with the Firebase key for easy lookup
        put_fb(f"retiros/{res['name']}/firebase_key", res['name'])
    return tx_id

def verificar_limite_retiro(telegram_id: str) -> dict:
    """
    Checks daily withdrawal limits for a user.
    Returns {'ok': bool, 'retiros_hoy': int, 'usd_hoy': float, 'blocked': str|None}
    """
    import config
    today = datetime.utcnow().strftime('%Y-%m-%d')
    todos = _to_dict(get_fb('retiros') or {})
    retiros_hoy = 0
    usd_hoy = 0.0
    for r in todos.values():
        if str(r.get('telegram_id')) == str(telegram_id) and r.get('status') not in ('rejected',):
            if (r.get('created_at') or '')[:10] == today:
                retiros_hoy += 1
                usd_hoy += float(r.get('usd', 0))
    blocked = None
    if retiros_hoy >= config.WITHDRAWAL_MAX_PER_DAY:
        blocked = f'Has alcanzado el máximo de {config.WITHDRAWAL_MAX_PER_DAY} retiros por día.'
    elif usd_hoy >= config.WITHDRAWAL_MAX_USD_DAY:
        blocked = f'Has alcanzado el límite diario de ${config.WITHDRAWAL_MAX_USD_DAY:.2f} USD.'
    return {'ok': blocked is None, 'retiros_hoy': retiros_hoy, 'usd_hoy': usd_hoy, 'blocked': blocked}

def obtener_retiros_usuario(telegram_id: str) -> list:
    """Gets all withdrawal requests for a specific user, sorted by date desc."""
    todos = _to_dict(get_fb('retiros') or {})
    user_retiros = []
    for k, r in todos.items():
        if str(r.get('telegram_id')) == str(telegram_id):
            r['_key'] = k
            user_retiros.append(r)
    return sorted(user_retiros, key=lambda x: x.get('created_at', ''), reverse=True)

def obtener_todos_retiros() -> list:
    """Gets all withdrawal requests, sorted by date desc."""
    todos = _to_dict(get_fb('retiros') or {})
    result = []
    for k, r in todos.items():
        r['_key'] = k
        result.append(r)
    return sorted(result, key=lambda x: x.get('created_at', ''), reverse=True)

def _find_retiro_key(tx_id_or_key: str) -> tuple:
    """Returns (firebase_key, retiro_data) for a transaction by tx_id or firebase key."""
    todos = _to_dict(get_fb('retiros') or {})
    for k, r in todos.items():
        if k == tx_id_or_key or r.get('tx_id') == tx_id_or_key:
            return k, r
    return None, None

def aprobar_retiro(firebase_key: str) -> bool:
    """Approves a P2P withdrawal: deducts bits and marks as approved."""
    retiro = get_fb(f'retiros/{firebase_key}')
    if not retiro or retiro.get('status') != 'pending':
        return False
    telegram_id = str(retiro.get('telegram_id'))
    bits = int(retiro.get('bits', 0))
    usuario = obtener_usuario(int(telegram_id))
    if not usuario:
        return False
    new_bits = max(0, int(usuario.get('bits', 0)) - bits)
    patch_fb(f'usuarios/{telegram_id}', {'bits': new_bits})
    patch_fb(f'retiros/{firebase_key}', {
        'status': 'approved',
        'processed_at': datetime.utcnow().isoformat()
    })
    registrar_transaccion(int(telegram_id), retiro.get('username',''), 'retiro', bits, 0,
                          f'Retiro aprobado (P2P) - {retiro.get("tx_id","")}')
    return True

def completar_retiro(firebase_key: str) -> bool:
    """Marks a withdrawal as paid/completed by admin. (Bits were already deducted at request)"""
    retiro = get_fb(f'retiros/{firebase_key}')
    if not retiro or retiro.get('status') == 'completed':
        return False
    patch_fb(f'retiros/{firebase_key}', {
        'status': 'completed',
        'processed_at': datetime.utcnow().isoformat()
    })
    
    # Notify user it was paid
    telegram_id = str(retiro.get('telegram_id'))
    bits = int(retiro.get('bits', 0))
    usd = float(retiro.get('usd', 0))
    method = str(retiro.get('method', 'p2p'))
    tx_id = str(retiro.get('tx_id', ''))
    try:
        notify_withdrawal_approved(telegram_id, bits, usd, method, tx_id)
    except Exception:
        pass
        
    return True

def rechazar_retiro(firebase_key: str, reason: str = '') -> bool:
    """Rejects a withdrawal and REFUNDS the bits to the user."""
    retiro = get_fb(f'retiros/{firebase_key}')
    if not retiro or retiro.get('status') in ['rejected', 'completed']:
        return False
        
    telegram_id = str(retiro.get('telegram_id'))
    bits = int(retiro.get('bits', 0))
    
    # Refund bits
    usuario = obtener_usuario(int(telegram_id))
    if usuario:
        new_bits = int(usuario.get('bits', 0)) + bits
        patch_fb(f'usuarios/{telegram_id}', {'bits': new_bits})
        
        registrar_transaccion(int(telegram_id), retiro.get('username',''), 'reintegro_retiro', bits, 0,
                              f'Reintegro por retiro rechazado - {retiro.get("tx_id","")}')
                              
    patch_fb(f'retiros/{firebase_key}', {
        'status': 'rejected',
        'processed_at': datetime.utcnow().isoformat(),
        'rejection_reason': reason
    })
    
    # Notify user
    try:
        method_label = 'PayPal' if retiro.get('method') == 'paypal' else 'P2P (Admin)'
        usd = float(retiro.get('usd', 0))
        msg = (
            "❌ <b>Solicitud de Retiro Rechazada</b>\n\n"
            f"Tu retiro por <b>{bits:,} bits</b> (${usd:.2f} USD) vía {method_label} ha sido cancelado.\n\n"
        )
        if reason:
            msg += f"📝 Motivo: <i>{reason}</i>\n\n"
        msg += "💰 <b>Tus bits han sido reembolsados a tu cuenta.</b>"
        send_telegram_notification(telegram_id, "Retiro Rechazado", msg)
    except Exception:
        pass

    return True

def notify_withdrawal_received(telegram_id: str, bits: int, usd: float, method: str, tx_id: str) -> None:
    """Notifies user that withdrawal request was received."""
    method_label = 'PayPal' if method == 'paypal' else 'P2P (Admin)'
    msg = (
        "💸 <b>Solicitud de Retiro Recibida</b>\n\n"
        f"Tu solicitud de retiro está siendo procesada.\n\n"
        f"🪙 Bits a retirar: <b>{int(bits):,}</b>\n"
        f"💵 Equivalente: <b>${float(usd):.2f} USD</b>\n"
        f"📤 Método: <b>{method_label}</b>\n"
        f"🔖 ID: <code>{tx_id}</code>\n\n"
        "Te notificaremos cuando sea procesado."
    )
    _send_tg(telegram_id, msg)

def notify_withdrawal_approved(telegram_id: str, bits: int, usd: float, tx_id: str) -> None:
    """Notifies user that withdrawal was approved and paid."""
    msg = (
        "✅ <b>Retiro Aprobado</b>\n\n"
        f"Tu retiro ha sido procesado exitosamente.\n\n"
        f"🪙 Bits retirados: <b>{int(bits):,}</b>\n"
        f"💵 Importe pagado: <b>${float(usd):.2f} USD</b>\n"
        f"🔖 ID: <code>{tx_id}</code>\n\n"
        "¡Gracias por jugar en <b>Ghost Plague Casino</b>!"
    )
    _send_tg(telegram_id, msg)

def notify_withdrawal_rejected(telegram_id: str, bits: int, tx_id: str, reason: str = '') -> None:
    """Notifies user that withdrawal was rejected. Bits are NOT deducted."""
    reason_line = f"\n📋 Motivo: {reason}" if reason else ""
    msg = (
        "❌ <b>Retiro Rechazado</b>\n\n"
        f"Tu solicitud de retiro fue rechazada.{reason_line}\n\n"
        f"🪙 Bits: <b>{int(bits):,}</b> (devueltos a tu cuenta)\n"
        f"🔖 ID: <code>{tx_id}</code>\n\n"
        "Contacta al soporte si tienes preguntas."
    )
    _send_tg(telegram_id, msg)
