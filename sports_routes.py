from flask import Blueprint, render_template, request, jsonify, session
import database
from datetime import datetime
import logging
import time
import requests as http_requests

logger = logging.getLogger(__name__)

sports_bp = Blueprint('sports', __name__, url_prefix='/sports')

# ── Load ESPN credentials from config ─────────────────────────────────────────
try:
    import config as _cfg
    _ESPN_KEY  = getattr(_cfg, 'RAPIDAPI_ESPN_KEY',  '')
    _ESPN_HOST = getattr(_cfg, 'RAPIDAPI_ESPN_HOST', 'espn13.p.rapidapi.com')
    _FB_KEY    = getattr(_cfg, 'RAPIDAPI_FOOTBALL_KEY', '')
    _FB_HOST   = getattr(_cfg, 'RAPIDAPI_FOOTBALL_HOST', 'free-api-live-football-data.p.rapidapi.com')
except Exception:
    _ESPN_KEY  = ''
    _ESPN_HOST = 'espn13.p.rapidapi.com'
    _FB_KEY    = ''
    _FB_HOST   = 'free-api-live-football-data.p.rapidapi.com'

# ── Sport definitions (whitelist + metadata) ───────────────────────────────────
SPORTS = {
    'soccer':  {'name': 'Fútbol',         'emoji': '⚽', 'color': '#10b981'},
    'nba':     {'name': 'Baloncesto NBA', 'emoji': '🏀', 'color': '#f59e0b'},
    'nfl':     {'name': 'NFL',            'emoji': '🏈', 'color': '#6366f1'},
    'mlb':     {'name': 'Béisbol MLB',    'emoji': '⚾', 'color': '#ef4444'},
    'tennis':  {'name': 'Tenis',          'emoji': '🎾', 'color': '#84cc16'},
    'nhl':     {'name': 'Hockey NHL',     'emoji': '🏒', 'color': '#06b6d4'},
    'nascar':  {'name': 'NASCAR',         'emoji': '🏎️', 'color': '#f97316'},
    'rugby':   {'name': 'Rugby',          'emoji': '🏉', 'color': '#8b5cf6'},
    'golf':    {'name': 'Golf',           'emoji': '⛳', 'color': '#22c55e'},
}

# ── In-memory cache (TTL 3 min per source) ────────────────────────────────────
_espn_cache = {}   # { source: { 'data': ..., 'ts': float } }
_ESPN_TTL   = 180  # seconds

def _espn_cached(source):
    entry = _espn_cache.get(source)
    if entry and (time.time() - entry['ts']) < _ESPN_TTL:
        return entry['data']
    return None

def _espn_store(source, data):
    _espn_cache[source] = {'data': data, 'ts': time.time()}

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

def _fetch_espn(source, offset=0, limit=15):
    """
    Call RapidAPI ESPN endpoint.
    Returns raw JSON on success, or a dict with {'_error': True, 'status': int, 'message': str} on failure.
    """
    url = f"https://{_ESPN_HOST}/v1/feed"
    headers = {
        "x-rapidapi-key":  _ESPN_KEY,
        "x-rapidapi-host": _ESPN_HOST,
        "Content-Type": "application/json",
    }
    params = {"source": source, "offset": str(offset), "limit": str(limit)}
    logger.info(f"[ESPN] Fetching {url} source={source}")
    try:
        resp = http_requests.get(url, headers=headers, params=params, timeout=12)
        logger.info(f"[ESPN] {source} -> HTTP {resp.status_code}")

        if resp.status_code == 403:
            msg = resp.json().get('message', 'No tienes acceso a esta API')
            logger.warning(f"[ESPN] 403 Forbidden: {msg}")
            return {'_error': True, 'status': 403, 'message': f'Suscripción requerida en RapidAPI: {msg}'}

        if resp.status_code == 429:
            logger.warning(f"[ESPN] 429 Rate limit hit for {source}")
            return {'_error': True, 'status': 429, 'message': 'Límite de peticiones alcanzado (429). Intenta en un momento.'}

        resp.raise_for_status()
        return resp.json()

    except http_requests.exceptions.Timeout:
        logger.error(f"[ESPN] Timeout for source={source}")
        return {'_error': True, 'status': 504, 'message': 'La solicitud tardó demasiado (timeout). Intenta de nuevo.'}
    except Exception as exc:
        logger.error(f"[ESPN] {source} exception: {exc}")
        return {'_error': True, 'status': 500, 'message': str(exc)}


def _normalize_espn(raw, source):
    """
    Normalize ESPN Feed API response into a consistent structure.
    The ESPN API returns a list of article/story objects; we extract
    game-related entries and build a clean event list.
    """
    meta = SPORTS.get(source, {'name': source, 'emoji': '🏅', 'color': '#6b7280'})
    events = []

    # The response structure varies: sometimes it's a list at root,
    # sometimes wrapped in a key. Handle both.
    items = raw if isinstance(raw, list) else raw.get('feed', raw.get('results', raw.get('articles', [])))

    for item in items:
        if not isinstance(item, dict):
            continue

        headline    = item.get('headline') or item.get('title') or ''
        description = item.get('description') or item.get('summary') or ''
        published   = item.get('published') or item.get('lastModified') or ''
        link        = item.get('links', {}).get('web', {}).get('href', '') if isinstance(item.get('links'), dict) else ''
        img         = None
        images      = item.get('images', [])
        if images and isinstance(images, list):
            img = images[0].get('url') if isinstance(images[0], dict) else None

        # Try to extract teams from headline (common format: "Team A vs Team B")
        team1, team2 = '', ''
        if ' vs ' in headline.lower():
            parts  = headline.split(' vs ')
            team1  = parts[0].strip().split('·')[-1].strip()
            team2  = parts[1].strip().split('·')[0].strip()
        elif ' at ' in headline.lower():
            parts  = headline.split(' at ')
            team1  = parts[0].strip()
            team2  = parts[1].strip().split('·')[0].strip()

        # Category / league info
        categories   = item.get('categories', [])
        league       = ''
        for cat in categories:
            if isinstance(cat, dict) and cat.get('type') == 'league':
                league = cat.get('description', '')
                break

        events.append({
            'id':          item.get('id') or item.get('dataSourceIdentifier', ''),
            'headline':    headline,
            'description': description,
            'team1':       team1  or meta['emoji'] + ' Equipo 1',
            'team2':       team2  or 'Equipo 2',
            'league':      league or meta['name'],
            'published':   published,
            'image':       img,
            'link':        link,
            'status':      'upcoming',
            'odds':        {'1': 2.10, 'X': 3.20, '2': 3.40},
        })

    return {
        'source':     source,
        'sport_name': meta['name'],
        'sport_emoji': meta['emoji'],
        'color':      meta['color'],
        'events':     events,
        'cached_at':  int(time.time()),
    }

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
    template_name = 'sports/soccer.html' if source == 'soccer' else 'sports/matches.html'
    
    return render_template(
        template_name,
        sport_source=source,
        sport_name=meta['name'],
        sport_emoji=meta['emoji'],
        sport_color=meta['color'],
    )

# Keep old futbol route as alias
@sports_bp.route('/futbol')
def futbol_view():
    return sport_view('soccer')

# =====================================================
# ESPN PROXY API
# =====================================================

@sports_bp.route('/api/espn/<source>')
def espn_proxy(source):
    """
    Secure backend proxy to ESPN (RapidAPI).
    Frontend never sees the API key.
    """
    if source not in SPORTS:
        return jsonify({'error': 'Deporte no válido'}), 400

    cached = _espn_cached(source)
    if cached:
        return jsonify(cached)

    raw = _fetch_espn(source)

    # Handle structured error returned by _fetch_espn
    if isinstance(raw, dict) and raw.get('_error'):
        http_status = raw.get('status', 500)
        err_msg = raw.get('message', 'Error desconocido con la API deportiva.')
        logger.error(f"[ESPN Proxy] {source} -> {http_status}: {err_msg}")
        return jsonify({
            'source':      source,
            'sport_name':  SPORTS[source]['name'],
            'sport_emoji': SPORTS[source]['emoji'],
            'color':       SPORTS[source]['color'],
            'events':      [],
            'error':       err_msg,
            'error_code':  http_status,
        }), 200  # Always 200 to frontend so error state renders in UI

    if raw is None:
        return jsonify({
            'source':     source,
            'sport_name': SPORTS[source]['name'],
            'sport_emoji': SPORTS[source]['emoji'],
            'color':      SPORTS[source]['color'],
            'events':     [],
            'error':      'No se pudo conectar al feed deportivo. Intenta más tarde.',
        }), 200

    normalized = _normalize_espn(raw, source)
    _espn_store(source, normalized)
    return jsonify(normalized)


# =====================================================
# FOOTBALL API PROXY
# =====================================================

@sports_bp.route('/api/football/<path:endpoint>')
def football_proxy(endpoint):
    """
    Secure backend proxy to Free API Live Football Data (RapidAPI).
    Accepts full endpoint path and passes along all GET query arguments.
    """
    # Build a unique cache key from the endpoint and the query string
    cache_key = f"{endpoint}?{request.query_string.decode('utf-8')}"
    cached = _fb_cached(cache_key)
    if cached:
        return jsonify(cached)

    url = f"https://{_FB_HOST}/{endpoint}"
    headers = {
        "x-rapidapi-key": _FB_KEY,
        "x-rapidapi-host": _FB_HOST,
        "Accept": "application/json"
    }
    
    try:
        resp = http_requests.get(url, headers=headers, params=request.args, timeout=12)
        resp.raise_for_status()
        data = resp.json()
        _fb_store(cache_key, data)
        return jsonify(data)
    except Exception as exc:
        logger.warning(f"[Football API] {endpoint} error: {exc}")
        return jsonify({
            'status': 'error',
            'message': 'No se pudo conectar a la base de datos de fútbol.'
        }), 502

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
    match_id = data.get('match_id')
    team_choice = data.get('team_choice')
    amount = data.get('amount')

    if not all([telegram_id, match_id, team_choice, amount]):
        return jsonify({"success": False, "error": "Datos incompletos"}), 400

    try:
        amount = int(amount)
        if amount <= 0:
            raise ValueError
    except:
        return jsonify({"success": False, "error": "Cantidad inválida"}), 400

    user = database.get_fb(f"usuarios/{telegram_id}")
    if not user:
        return jsonify({"success": False, "error": "Usuario no encontrado"}), 404

    if user.get('bits', 0) < amount:
        return jsonify({"success": False, "error": "Saldo insuficiente"}), 400

    match = database.get_fb(f"sports_matches/{match_id}")
    if not match or match.get('status') != 'upcoming':
        return jsonify({"success": False, "error": "Partido no disponible"}), 400

    odd = match.get('odd1') if team_choice == '1' else match.get('oddx') if team_choice == 'X' else match.get('odd2')
    potential_win = int(amount * odd)
    
    database.descontar_bits(telegram_id, amount)
    
    database.post_fb("sports_bets", {
        "telegram_id": str(telegram_id),
        "match_id": match_id,
        "team_choice": team_choice,
        "amount": amount,
        "odd": odd,
        "status": "pending",
        "created_at": datetime.utcnow().isoformat()
    })
    
    new_balance = database.obtener_bits(telegram_id)
    logger.info(f"Apuesta Deportiva: {telegram_id} -> {amount} bits en partido {match_id}")
    return jsonify({"success": True, "new_balance": new_balance})

@sports_bp.route('/api/bets/<telegram_id>')
def get_bets(telegram_id):
    bets_db = database._to_dict(database.get_fb("sports_bets"))
    matches_db = database._to_dict(database.get_fb("sports_matches"))
    
    user_bets = [dict(b, id=k) for k, b in bets_db.items() if str(b.get('telegram_id')) == str(telegram_id)]
    user_bets.sort(key=lambda x: x.get('created_at', ''), reverse=True)
    
    data = []
    for b in user_bets:
        m = matches_db.get(b.get('match_id', ''), {})
        t1, t2 = m.get('team1', 'Unknown'), m.get('team2', 'Unknown')
        pot_win = int(b.get('amount', 0) * b.get('odd', 1))
        data.append({
            "match": f"{t1} vs {t2}",
            "choice": b.get('team_choice'),
            "amount": b.get('amount'),
            "odd": b.get('odd'),
            "potential_win": pot_win,
            "status": b.get('status', 'pending'),
            "date": b.get('created_at')
        })
    return jsonify(data)
