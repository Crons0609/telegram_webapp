from flask import Blueprint, render_template, request, jsonify, session
import database
from datetime import datetime
import logging
import time
import requests as http_requests
import random

logger = logging.getLogger(__name__)

sports_bp = Blueprint('sports', __name__, url_prefix='/sports')

# ── Load API credentials from config ─────────────────────────────────────────
try:
    import config as _cfg
    _FB_KEY    = getattr(_cfg, 'RAPIDAPI_FOOTBALL_KEY', '')
    _FB_HOST   = getattr(_cfg, 'RAPIDAPI_FOOTBALL_HOST', 'footapi7.p.rapidapi.com')
    _MLB_KEY   = getattr(_cfg, 'RAPIDAPI_MLB_KEY', '')
    _MLB_HOST  = getattr(_cfg, 'RAPIDAPI_MLB_HOST', 'tank01-mlb-live-in-game-real-time-statistics.p.rapidapi.com')
    _NFL_KEY   = getattr(_cfg, 'RAPIDAPI_NFL_KEY', '')
    _NFL_HOST  = getattr(_cfg, 'RAPIDAPI_NFL_HOST', 'nfl-api-data.p.rapidapi.com')
    _F1_KEY    = getattr(_cfg, 'RAPIDAPI_F1_KEY', '')
    _F1_HOST   = getattr(_cfg, 'RAPIDAPI_F1_HOST', 'hyprace-api.p.rapidapi.com')
except Exception:
    _FB_KEY    = ''
    _FB_HOST   = 'footapi7.p.rapidapi.com'
    _MLB_KEY   = '6baf9fc61cmsh68fc825745fb754p1d702djsn35393a209de6'
    _MLB_HOST  = 'tank01-mlb-live-in-game-real-time-statistics.p.rapidapi.com'
    _NFL_KEY   = '6baf9fc61cmsh68fc825745fb754p1d702djsn35393a209de6'
    _NFL_HOST  = 'nfl-api-data.p.rapidapi.com'
    _F1_KEY    = '6baf9fc61cmsh68fc825745fb754p1d702djsn35393a209de6'
    _F1_HOST   = 'hyprace-api.p.rapidapi.com'

# ── Sport definitions (whitelist + metadata) ───────────────────────────────────
SPORTS = {
    'soccer':  {'name': 'Fútbol',         'emoji': '⚽', 'color': '#10b981'},
    'nba':     {'name': 'Baloncesto NBA', 'emoji': '🏀', 'color': '#f59e0b'},
    'nfl':     {'name': 'NFL',            'emoji': '🏈', 'color': '#6366f1'},
    'mlb':     {'name': 'Béisbol MLB',    'emoji': '⚾', 'color': '#ef4444'},
    'tennis':  {'name': 'Tenis',          'emoji': '🎾', 'color': '#84cc16'},
    'nhl':     {'name': 'Hockey NHL',     'emoji': '🏒', 'color': '#06b6d4'},
    'f1':      {'name': 'Formula 1',       'emoji': '🏎️', 'color': '#e10600'},
    'rugby':   {'name': 'Rugby',          'emoji': '🏉', 'color': '#8b5cf6'},
    'golf':    {'name': 'Golf',           'emoji': '⛳', 'color': '#22c55e'},
}



# ── Cache for Football API (TTL 3 min per endpoint+query) ──────────────────────
_fb_cache = {}
_FB_TTL = 180

def _fb_cached(key):
    entry = _fb_cache.get(key)
    if entry and (time.time() - entry['ts']) < _FB_TTL:
        return entry['data']
    return None

def _fb_store(key, data):
    _fb_cache[key] = {'data': data, 'ts': time.time()}




# =====================================================
# VIEWS
# =====================================================

@sports_bp.route('/')
def index():
    return render_template('sports/index.html', sports=SPORTS)

@sports_bp.route('/<source>')
def sport_view(source):
    if source not in SPORTS:
        return "Deporte no disponible", 404
    meta = SPORTS[source]
    
    # Render custom dashboard for soccer, universal matches.html for others
    if source == 'soccer':
        template_name = 'sports/soccer.html'
    elif source == 'mlb':
        template_name = 'sports/baseball.html'
    elif source == 'nfl':
        template_name = 'sports/nfl.html'
    elif source == 'f1':
        template_name = 'sports/f1.html'
    else:
        template_name = 'sports/matches.html'
    
    return render_template(
        template_name,
        sport_source=source,
        sport_name=meta['name'],
        sport_emoji=meta['emoji'],
        sport_color=meta['color'],
    )

# Keep old futbol route as alias
@sports_bp.route('/futbol')
def sport_futbol():
    return sport_view('soccer')

# ── Duración por deporte (minutos hasta considerar partido finalizado) ─────────
SPORT_DURATION_MINUTES = {
    'soccer':  110,  # 90 min partido + 20 buffer
    'nba':     150,  # 120 min + 30
    'nfl':     210,  # 180 min + 30
    'mlb':     210,  # 180 min + 30
    'tennis':  180,  # 150 min + 30
    'nhl':     120,  # 90 min + 30
    'f1':      120,  # 90 min + 30
    'rugby':   100,  # 80 min + 20
    'golf':    420,  # 6 horas + 60 buffer
}

def _check_match_expired(sport, match_date_str, match_status):
    """
    Retorna True si el partido ya debería estar finalizado según la duración del deporte.
    match_date_str: ISO string (ej: '2026-03-28T18:00')
    """
    if match_status in ('finished', 'resolved'):
        return False  # Ya está marcado, no tocar
    try:
        duration_minutes = SPORT_DURATION_MINUTES.get(sport, 120)
        match_dt = datetime.fromisoformat(match_date_str.replace('Z', '+00:00'))
        now_utc = datetime.utcnow().replace(tzinfo=None)
        if match_dt.tzinfo is not None:
            # Convert to naive UTC
            import calendar
            epoch = calendar.timegm(match_dt.utctimetuple())
            match_dt = datetime.utcfromtimestamp(epoch)
        else:
            # Asumir que la fecha vino en hora local (UTC-6) por caché del front
            from datetime import timedelta
            match_dt = match_dt + timedelta(hours=6)
            
        elapsed_minutes = (now_utc - match_dt).total_seconds() / 60.0
        return elapsed_minutes >= duration_minutes
    except Exception as e:
        logger.warning(f"[AutoExpire] parse error for date '{match_date_str}': {e}")
        return False

# ── API CUSTOM MATCHES ───────────────────────────────────────────
@sports_bp.route('/api/custom_matches/<sport>', methods=['GET'])
def get_custom_matches(sport):
    customs = database.get_fb('custom_matches') or {}
    sport_customs = customs.get(sport, {})
    
    show_finished = request.args.get('include_finished', 'false').lower() == 'true'
    
    results = []
    for m_id, m_data in sport_customs.items():
        if not m_data:
            continue
        
        current_status = m_data.get('status', 'upcoming')
        match_date = m_data.get('date', '')
        
        # Auto-expiración: si el tiempo ha pasado, marcar como finished
        if current_status == 'upcoming' and match_date:
            if _check_match_expired(sport, match_date, current_status):
                # Actualizar en Firebase
                database.patch_fb(f"custom_matches/{sport}/{m_id}", {"status": "finished"})
                m_data['status'] = 'finished'
                current_status = 'finished'
                logger.info(f"[AutoExpire] Partido {m_id} ({sport}) marcado como finished automáticamente")
        
        m_data['id'] = m_id
        
        if show_finished:
            results.append(m_data)
        elif current_status == 'upcoming':
            results.append(m_data)
            
    results.sort(key=lambda x: str(x.get('date', '')), reverse=False)
    return jsonify(results)

@sports_bp.route('/api/custom_matches_finished/<sport>', methods=['GET'])
def get_custom_matches_finished(sport):
    """Devuelve partidos custom finalizados (para pestaña Finalizados)."""
    customs = database.get_fb('custom_matches') or {}
    sport_customs = customs.get(sport, {})
    
    finished = []
    for m_id, m_data in sport_customs.items():
        if not m_data:
            continue
        
        current_status = m_data.get('status', 'upcoming')
        match_date = m_data.get('date', '')
        
        # Auto-expiración
        if current_status == 'upcoming' and match_date:
            if _check_match_expired(sport, match_date, current_status):
                database.patch_fb(f"custom_matches/{sport}/{m_id}", {"status": "finished"})
                m_data['status'] = 'finished'
                current_status = 'finished'
        
        if current_status in ('finished', 'resolved'):
            m_data['id'] = m_id
            finished.append(m_data)
    
    finished.sort(key=lambda x: str(x.get('date', '')), reverse=True)
    return jsonify(finished)


# =====================================================
# API PROXIES (FootApi)
# =====================================================

@sports_bp.route('/api/football/<path:endpoint>')
def football_proxy(endpoint):
    """
    Secure backend proxy to Free API Live Football Data (RapidAPI).
    Maps old front-end routes to the new API endpoints.
    """
    if endpoint == "api/matches/live":
        target_path = "football-current-live"
    elif endpoint.startswith("api/matches/"):
        date_str = endpoint.split("/")[-1] # Expected YYYYMMDD
        target_path = f"football-get-matches-by-date?date={date_str}"
    else:
        target_path = endpoint

    cache_key = f"{target_path}?{request.query_string.decode('utf-8')}"
    cached = _fb_cached(cache_key)
    if cached:
        return jsonify(cached)

    # Si target_path ya tiene '?', añadimos los query_string extra con '&' en la URL
    qs = request.query_string.decode('utf-8')
    final_path = target_path
    if qs:
        final_path = target_path + "&" + qs if "?" in target_path else target_path + "?" + qs

    url = f"https://{_FB_HOST}/{final_path}"
    active_key = _FB_KEY if _FB_KEY else '050089e867mshb8bc7a3333bb3cfp1e5f4djsn41c27e7522d5'
    headers = {
        "x-rapidapi-key": active_key,
        "x-rapidapi-host": _FB_HOST,
        "Accept": "application/json"
    }
    
    try:
        # Avoid passing params because we injected them into final_path
        resp = http_requests.get(url, headers=headers, timeout=12)
        logger.info(f"[Football API] {endpoint} -> {target_path} HTTP {resp.status_code}")

        if resp.status_code == 403:
            return jsonify({
                'status': 'error',
                'error_code': 403,
                'message': 'Acceso denegado a Football API. Verifica la suscripción en RapidAPI.'
            }), 200

        if resp.status_code == 429:
            return jsonify({
                'status': 'error',
                'error_code': 429,
                'message': 'Límite de peticiones alcanzado. Espera un momento.'
            }), 200

        resp.raise_for_status()
        data = resp.json()
        _fb_store(cache_key, data)
        return jsonify(data)

    except http_requests.exceptions.Timeout:
        logger.warning(f"[Football API] {endpoint} timeout")
        return jsonify({'status': 'error', 'message': 'Tiempo de espera agotado.'}), 200
    except Exception as exc:
        logger.warning(f"[Football API] {endpoint} error: {exc}")
        return jsonify({
            'status': 'error',
            'message': 'No se pudo conectar a la base de datos de fútbol.'
        }), 200

# =====================================================
# BASEBALL API PROXY
# =====================================================

@sports_bp.route('/api/baseball/<path:endpoint>')
def baseball_proxy(endpoint):
    cache_key = f"mlb_{endpoint}?{request.query_string.decode('utf-8')}"
    cached = _fb_cached(cache_key) # Use same memory dictionary for simplicity
    if cached:
        return jsonify(cached)

    url = f"https://{_MLB_HOST}/{endpoint}"
    # The user provided key dynamically
    active_key = _MLB_KEY if _MLB_KEY else '6baf9fc61cmsh68fc825745fb754p1d702djsn35393a209de6'
    headers = {
        "x-rapidapi-key": active_key,
        "x-rapidapi-host": _MLB_HOST,
        "Accept": "application/json"
    }
    
    try:
        resp = http_requests.get(url, headers=headers, params=request.args, timeout=12)
        logger.info(f"[Baseball API] {endpoint} -> HTTP {resp.status_code}")

        if resp.status_code == 403:
            return jsonify({'status': 'error', 'message': 'Acceso denegado a Baseball API.'}), 200
        if resp.status_code == 429:
            return jsonify({'status': 'error', 'message': 'Límite alcanzado en Baseball API.'}), 200

        resp.raise_for_status()
        data = resp.json()
        _fb_store(cache_key, data)
        return jsonify(data)

    except http_requests.exceptions.Timeout:
        return jsonify({'status': 'error', 'message': 'Tiempo de espera agotado.'}), 200
    except Exception as exc:
        logger.warning(f"[Baseball API] {endpoint} error: {exc}")
        return jsonify({'status': 'error', 'message': 'Falla de red en API Baseball.'}), 200

# =====================================================
# NFL API PROXY
# =====================================================

@sports_bp.route('/api/nfl/<path:endpoint>')
def nfl_proxy(endpoint):
    cache_key = f"nfl_{endpoint}?{request.query_string.decode('utf-8')}"
    cached = _fb_cached(cache_key)
    if cached:
        return jsonify(cached)

    url = f"https://{_NFL_HOST}/{endpoint}"
    active_key = _NFL_KEY if _NFL_KEY else '6baf9fc61cmsh68fc825745fb754p1d702djsn35393a209de6'
    headers = {
        "x-rapidapi-key": active_key,
        "x-rapidapi-host": _NFL_HOST,
        "Accept": "application/json"
    }

    try:
        resp = http_requests.get(url, headers=headers, params=request.args, timeout=12)
        logger.info(f"[NFL API] {endpoint} -> HTTP {resp.status_code}")

        if resp.status_code == 403:
            return jsonify({'status': 'error', 'message': 'Acceso denegado a NFL API.'}), 200
        if resp.status_code == 429:
            return jsonify({'status': 'error', 'message': 'Límite alcanzado en NFL API.'}), 200

        resp.raise_for_status()
        data = resp.json()
        _fb_store(cache_key, data)
        return jsonify(data)

    except http_requests.exceptions.Timeout:
        return jsonify({'status': 'error', 'message': 'Tiempo de espera agotado.'}), 200
    except Exception as exc:
        logger.warning(f"[NFL API] {endpoint} error: {exc}")
        return jsonify({'status': 'error', 'message': 'Falla de red en API NFL.'}), 200


# =====================================================
# F1 / HYPRACE API PROXY  (hyprace-api.p.rapidapi.com)
# =====================================================

@sports_bp.route('/api/f1/<path:endpoint>')
def f1_proxy(endpoint):
    cache_key = "f1_{}?{}".format(endpoint, request.query_string.decode('utf-8'))
    cached = _fb_cached(cache_key)
    if cached:
        return jsonify(cached)

    url = "https://{}/{}".format(_F1_HOST, endpoint)
    active_key = _F1_KEY if _F1_KEY else '6baf9fc61cmsh68fc825745fb754p1d702djsn35393a209de6'
    headers = {
        "x-rapidapi-key": active_key,
        "x-rapidapi-host": _F1_HOST,
        "Accept": "application/json"
    }
    try:
        resp = http_requests.get(url, headers=headers, params=request.args, timeout=12)
        logger.info("[F1 API] {} -> HTTP {}".format(endpoint, resp.status_code))
        if resp.status_code == 403:
            return jsonify({'status': 'error', 'message': 'Acceso denegado a F1 API.'}), 200
        if resp.status_code == 429:
            return jsonify({'status': 'error', 'message': 'Limite alcanzado en F1 API.'}), 200
        resp.raise_for_status()
        data = resp.json()
        _fb_store(cache_key, data)
        return jsonify(data)
    except http_requests.exceptions.Timeout:
        return jsonify({'status': 'error', 'message': 'Tiempo de espera agotado.'}), 200
    except Exception as exc:
        logger.warning("[F1 API] {} error: {}".format(endpoint, exc))
        return jsonify({'status': 'error', 'message': 'Falla de red en API F1.'}), 200

# =====================================================
# CLASSIC SPORTS DB API (unchanged)
# =====================================================


@sports_bp.route('/api/matches')
def get_matches():
    matches_db = database._to_dict(database.get_fb("sports_matches"))
    matches = [dict(m, id=k) for k, m in matches_db.items() if m.get('status') == 'upcoming']
    matches.sort(key=lambda x: x.get('date', ''))
    
    data = []
    for m in matches:
        data.append({
            "id": m.get('id'),
            "team1": m.get('team1'),
            "team2": m.get('team2'),
            "date": m.get('date'),
            "status": m.get('status'),
            "odds": {
                "1": m.get('odd1'),
                "X": m.get('oddx'),
                "2": m.get('odd2')
            }
        })
    return jsonify(data)

@sports_bp.route('/api/bet', methods=['POST'])
def place_bet():
    data = request.json
    telegram_id = data.get('telegram_id')
    match_id = data.get('match_id')        # e.g., 'ARI@ATL', 'event_id'
    match_name = data.get('match_name')    # e.g., 'Arizona vs Atlanta'
    team_choice = data.get('team_choice')  # '1', '2', 'X' or specific team name
    amount = data.get('amount')
    odd = data.get('odd')
    sport_source = data.get('sport_source', 'soccer')
    match_date = data.get('match_date')    # ISO datetime string, optional

    if not all([telegram_id, match_id, match_name, team_choice, amount, odd]):
        return jsonify({"success": False, "error": "Datos de apuesta incompletos"}), 400

    try:
        amount = int(amount)
        if amount <= 0:
            raise ValueError
    except:
        return jsonify({"success": False, "error": "Cantidad inválida"}), 400

    # ── 15-minute betting window check ──────────────────────────────────────
    if match_date:
        try:
            from datetime import datetime, timezone, timedelta
            # Parse ISO date; accept both naive and tz-aware
            match_dt = datetime.fromisoformat(str(match_date).replace('Z', '+00:00'))
            now_utc  = datetime.now(timezone.utc)
            if match_dt.tzinfo is None:
                match_dt = match_dt.replace(tzinfo=timezone.utc)
            elapsed_minutes = (now_utc - match_dt).total_seconds() / 60.0
            if elapsed_minutes > 15:
                return jsonify({
                    "success": False,
                    "error": f"⏱️ El tiempo para apostar cerró. Han pasado {int(elapsed_minutes)} min desde el inicio del partido (límite: 15 min)."
                }), 400
        except Exception as e:
            logger.warning(f"[BetWindow] Date parse error: {e}")
            # If we can't parse, let it through (don't block on bad date)

    is_demo = session.get('play_mode') == 'demo'
    user = database.get_fb(f"usuarios/{telegram_id}")
    if not user:
        return jsonify({"success": False, "error": "Usuario no encontrado"}), 404

    current_bits = int(user.get('bits_demo', 0)) if is_demo else int(user.get('bits', 0))
    if current_bits < amount:
        return jsonify({"success": False, "error": "Saldo insuficiente"}), 400

    try:
        is_draw = str(team_choice).strip().lower() in ['empate', 'draw', 'x']
        odd = 2.00 if is_draw else 1.75 # Ganancia fija 75% equipos, 100% empate
    except:
        return jsonify({"success": False, "error": "Cuota (Odd) inválida"}), 400

    # Descontamos bits del balance correspondiente
    database.descontar_bits(telegram_id, amount, is_demo=is_demo)
    
    # Registramos la apuesta con los datos enviados por la API deportiva
    bet_data = {
        "telegram_id": str(telegram_id),
        "match_id": match_id,
        "match_name": match_name,
        "team_choice": team_choice,
        "amount": amount,
        "odd": odd,
        "sport_source": sport_source,
        "status": "pending",
        "created_at": datetime.utcnow().isoformat(),
        "match_date": match_date or None,
        "is_demo": is_demo
    }
    database.post_fb("sports_bets", bet_data)
    
    new_balance = database.obtener_bits(telegram_id, is_demo=is_demo)
    logger.info(f"Apuesta Deportiva (Demo: {is_demo}): {telegram_id} -> {amount} bits a {team_choice} (Cuota {odd}) en {match_name}")
    return jsonify({"success": True, "new_balance": new_balance})

@sports_bp.route('/api/bets/<telegram_id>')
def get_bets(telegram_id):
    bets_db = database._to_dict(database.get_fb("sports_bets"))
    matches_db = database._to_dict(database.get_fb("sports_matches"))
    
    user_bets = [dict(b, id=k) for k, b in bets_db.items() if str(b.get('telegram_id')) == str(telegram_id)]
    user_bets.sort(key=lambda x: x.get('created_at', ''), reverse=True)
    
    data = []
    for b in user_bets:
        match_title = b.get('match_name', 'Unknown Match')
        # Fix display of potential win to 1.75 directly to ensure consistency
        is_draw = str(b.get('team_choice', '')).strip().lower() in ['empate', 'draw', 'x']
        actual_odd = 2.00 if is_draw else 1.75
        pot_win = int(b.get('amount', 0) * actual_odd) 
        data.append({
            "match": match_title,
            "choice": b.get('team_choice'),
            "amount": b.get('amount'),
            "odd": actual_odd,
            "potential_win": pot_win,
            "status": b.get('status', 'pending'),
            "date": b.get('created_at')
        })
    return jsonify(data)
