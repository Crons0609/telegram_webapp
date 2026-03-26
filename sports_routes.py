from flask import Blueprint, render_template, request, jsonify, session
import database
from datetime import datetime
import logging
import time
import requests as http_requests
import random

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

# ── ESPN Sport → Scoreboard path ───────────────────────────────────────────────
# Maps our sport key to the ESPN scoreboard path used for real game data
ESPN_SCOREBOARD_PATH = {
    'soccer':  'soccer/esp.1',     # La Liga
    'nba':     'basketball/nba',
    'nfl':     'football/nfl',
    'mlb':     'baseball/mlb',
    'nhl':     'hockey/nhl',
    'tennis':  'tennis/wta',
    'nascar':  'racing/nascar',
    'rugby':   'rugby/nrl',
    'golf':    'golf/pga',
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


# ── Generate realistic odds ────────────────────────────────────────────────────
def _generate_odds():
    """Generate random but realistic betting odds."""
    home = round(random.uniform(1.50, 3.80), 2)
    draw = round(random.uniform(2.90, 4.50), 2)
    away = round(random.uniform(1.50, 3.80), 2)
    return {'1': home, 'X': draw, '2': away}


# ── Fetch ESPN Scoreboard API ──────────────────────────────────────────────────
def _fetch_espn_scoreboard(source):
    """
    Call the ESPN Scoreboard API via RapidAPI.
    Returns raw JSON on success or a structured error dict.
    """
    sport_path = ESPN_SCOREBOARD_PATH.get(source, 'soccer/esp.1')
    url = f"https://{_ESPN_HOST}/v1/scores"
    headers = {
        "x-rapidapi-key":  _ESPN_KEY,
        "x-rapidapi-host": _ESPN_HOST,
        "Content-Type": "application/json",
    }
    params = {"sport": sport_path}
    logger.info(f"[ESPN Scoreboard] Fetching {url} sport={sport_path}")
    try:
        resp = http_requests.get(url, headers=headers, params=params, timeout=12)
        logger.info(f"[ESPN Scoreboard] {source} -> HTTP {resp.status_code}")

        if resp.status_code == 403:
            msg = ''
            try: msg = resp.json().get('message', '')
            except Exception: pass
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


def _fetch_espn_feed(source):
    """
    Fallback: Call the ESPN News Feed API.
    Returns raw JSON or a structured error dict.
    """
    url = f"https://{_ESPN_HOST}/v1/feed"
    headers = {
        "x-rapidapi-key":  _ESPN_KEY,
        "x-rapidapi-host": _ESPN_HOST,
        "Content-Type": "application/json",
    }
    params = {"source": source, "offset": "0", "limit": "15"}
    logger.info(f"[ESPN Feed] Fetching {url} source={source}")
    try:
        resp = http_requests.get(url, headers=headers, params=params, timeout=12)
        logger.info(f"[ESPN Feed] {source} -> HTTP {resp.status_code}")

        if resp.status_code in (403, 429):
            code = resp.status_code
            return {'_error': True, 'status': code, 'message': f'ESPN Feed error {code}'}

        resp.raise_for_status()
        return resp.json()
    except Exception as exc:
        logger.error(f"[ESPN Feed] {source} exception: {exc}")
        return {'_error': True, 'status': 500, 'message': str(exc)}


# ── Normalize ESPN Scoreboard response ────────────────────────────────────────
def _normalize_espn_scoreboard(raw, source):
    """
    Parse ESPN Scoreboard API response.
    Structure: { events: [ { id, name, status: { type: { state, displayClock } },
                              competitions: [ { competitors: [ {homeAway, team: {name}} ],
                                               league: { name } } ] } ] }
    """
    meta = SPORTS.get(source, {'name': source, 'emoji': '🏅', 'color': '#6b7280'})
    events = []

    # The scoreboard API typically wraps events in 'events' key
    raw_events = raw.get('events', [])
    if not raw_events:
        # Also try 'sports' -> 'leagues' -> 'events' deep structure
        try:
            sports_arr = raw.get('sports', [])
            if sports_arr:
                for sport in sports_arr:
                    for league in sport.get('leagues', []):
                        raw_events.extend(league.get('events', []))
        except Exception:
            pass

    logger.info(f"[ESPN Scoreboard] {source}: found {len(raw_events)} events")

    for item in raw_events:
        if not isinstance(item, dict):
            continue

        try:
            # ── Status ──────────────────────────────────────────────────────
            status_obj = item.get('status', {})
            status_type = status_obj.get('type', {})
            state = status_type.get('state', 'pre')   # 'pre', 'in', 'post'
            display_clock = status_obj.get('displayClock', '')
            display_short = status_type.get('shortDetail', '')

            if state == 'in':
                status = 'live'
            elif state == 'post':
                status = 'finished'
            else:
                status = 'upcoming'

            # ── Teams from competitions ──────────────────────────────────────
            team1, team2 = '', ''
            score_home, score_away = None, None
            league_name = ''

            competitions = item.get('competitions', [{}])
            comp = competitions[0] if competitions else {}

            competitors = comp.get('competitors', [])
            for comp_team in competitors:
                team_data = comp_team.get('team', {})
                team_name = team_data.get('displayName') or team_data.get('name') or ''
                is_home = comp_team.get('homeAway', '') == 'home'
                score = comp_team.get('score', None)

                if is_home:
                    team1 = team_name
                    try: score_home = int(score)
                    except (TypeError, ValueError): pass
                else:
                    team2 = team_name
                    try: score_away = int(score)
                    except (TypeError, ValueError): pass

            # ── League name ──────────────────────────────────────────────────
            league_obj = comp.get('league', {}) or {}
            league_name = league_obj.get('name', '') or item.get('league', {}).get('name', '') or meta['name']

            # ── Date / time ──────────────────────────────────────────────────
            date_str = item.get('date') or comp.get('date') or ''

            # ── Headline ─────────────────────────────────────────────────────
            headline = item.get('name', '') or item.get('shortName', '')

            # ── Fallback when no teams found  ────────────────────────────────
            if not team1:
                # Try splitting event name e.g. "Real Madrid vs Barcelona"
                name = item.get('name', '')
                if ' vs ' in name.lower():
                    parts = name.split(' vs ')
                    team1, team2 = parts[0].strip(), parts[1].strip()
                elif ' at ' in name.lower():
                    parts = name.split(' at ')
                    team1, team2 = parts[0].strip(), parts[1].strip()

            if not team1:
                team1 = meta['emoji'] + ' Local'
            if not team2:
                team2 = 'Visitante'

            score_info = None
            if score_home is not None and score_away is not None:
                score_info = {'home': score_home, 'away': score_away}

            events.append({
                'id':          item.get('id', str(len(events))),
                'headline':    headline,
                'team1':       team1,
                'team2':       team2,
                'league':      league_name,
                'published':   date_str,
                'image':       None,
                'status':      status,
                'live_clock':  display_clock if status == 'live' else '',
                'live_detail': display_short,
                'score':       score_info,
                'odds':        _generate_odds(),
            })

        except Exception as e:
            logger.warning(f"[ESPN Scoreboard] Error parsing event: {e}")
            continue

    return {
        'source':      source,
        'sport_name':  meta['name'],
        'sport_emoji': meta['emoji'],
        'color':       meta['color'],
        'events':      events,
        'cached_at':   int(time.time()),
    }


# ── Normalize ESPN Feed response (fallback for non-scoreboard sports) ──────────
def _normalize_espn_feed(raw, source):
    """
    Parse ESPN Feed (news/articles). Extracts team names from headlines.
    Used as a fallback when Scoreboard returns nothing.
    """
    meta = SPORTS.get(source, {'name': source, 'emoji': '🏅', 'color': '#6b7280'})
    events = []

    items = raw if isinstance(raw, list) else raw.get('feed', raw.get('results', raw.get('articles', [])))

    for item in items:
        if not isinstance(item, dict):
            continue

        headline    = item.get('headline') or item.get('title') or ''
        description = item.get('description') or item.get('summary') or ''
        published   = item.get('published') or item.get('lastModified') or ''

        # Extract teams from headline
        team1, team2 = '', ''
        if ' vs ' in headline.lower():
            parts = headline.split(' vs ')
            team1 = parts[0].strip().split('·')[-1].strip()
            team2 = parts[1].strip().split('·')[0].strip()
        elif ' at ' in headline.lower():
            parts = headline.split(' at ')
            team1 = parts[0].strip()
            team2 = parts[1].strip().split('·')[0].strip()

        # Only include items that actually have team info (skip pure news)
        if not team1 or not team2:
            continue

        categories = item.get('categories', [])
        league = ''
        for cat in categories:
            if isinstance(cat, dict) and cat.get('type') == 'league':
                league = cat.get('description', '')
                break

        events.append({
            'id':          item.get('id') or item.get('dataSourceIdentifier', str(len(events))),
            'headline':    headline,
            'description': description,
            'team1':       team1,
            'team2':       team2,
            'league':      league or meta['name'],
            'published':   published,
            'image':       None,
            'status':      'upcoming',
            'live_clock':  '',
            'live_detail': '',
            'score':       None,
            'odds':        _generate_odds(),
        })

    return {
        'source':      source,
        'sport_name':  meta['name'],
        'sport_emoji': meta['emoji'],
        'color':       meta['color'],
        'events':      events,
        'cached_at':   int(time.time()),
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
    Tries Scoreboard API first (real game data with team names).
    Falls back to Feed API (news articles) if scoreboard fails.
    """
    if source not in SPORTS:
        return jsonify({'error': 'Deporte no válido'}), 400

    cached = _espn_cached(source)
    if cached:
        logger.info(f"[ESPN Proxy] {source}: serving from cache ({len(cached.get('events',[]))} events)")
        return jsonify(cached)

    # ── Try Scoreboard first ───────────────────────────────────────
    raw_scoreboard = _fetch_espn_scoreboard(source)

    if not isinstance(raw_scoreboard, dict) or raw_scoreboard.get('_error'):
        # Scoreboard failed — try news feed
        err_status = raw_scoreboard.get('status', 500) if isinstance(raw_scoreboard, dict) else 500
        err_msg    = raw_scoreboard.get('message', 'Error desconocido') if isinstance(raw_scoreboard, dict) else 'Sin respuesta'
        logger.warning(f"[ESPN Proxy] Scoreboard failed ({err_status}): {err_msg}. Trying feed...")

        raw_feed = _fetch_espn_feed(source)

        if not isinstance(raw_feed, dict) or raw_feed.get('_error'):
            # Both failed — return structured error to frontend
            feed_msg = raw_feed.get('message', err_msg) if isinstance(raw_feed, dict) else err_msg
            http_code = raw_feed.get('status', err_status) if isinstance(raw_feed, dict) else err_status
            return jsonify({
                'source':      source,
                'sport_name':  SPORTS[source]['name'],
                'sport_emoji': SPORTS[source]['emoji'],
                'color':       SPORTS[source]['color'],
                'events':      [],
                'error':       feed_msg,
                'error_code':  http_code,
            }), 200

        normalized = _normalize_espn_feed(raw_feed, source)
    else:
        normalized = _normalize_espn_scoreboard(raw_scoreboard, source)

        # If scoreboard gave 0 events, fall back to feed
        if len(normalized.get('events', [])) == 0:
            logger.info(f"[ESPN Proxy] Scoreboard returned 0 events for {source}, trying feed fallback...")
            raw_feed = _fetch_espn_feed(source)
            if isinstance(raw_feed, dict) and not raw_feed.get('_error'):
                feed_normalized = _normalize_espn_feed(raw_feed, source)
                if len(feed_normalized.get('events', [])) > 0:
                    normalized = feed_normalized

    # Cache and return
    if normalized.get('events'):
        _espn_store(source, normalized)

    logger.info(f"[ESPN Proxy] {source}: returning {len(normalized.get('events', []))} events")
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
        logger.info(f"[Football API] {endpoint} -> HTTP {resp.status_code}")

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
