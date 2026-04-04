"""
sports_routes.py — Proxy seguro de APIs deportivas con caché avanzado
======================================================================
Arquitectura:
  Frontend → Flask Backend → AdvancedSportsCache → API Externa (RapidAPI)

El frontend NUNCA llama directamente a la API externa.
Las claves de API viven únicamente en el backend.
"""

from flask import Blueprint, render_template, request, jsonify, session
import database
from datetime import datetime
import logging
import time
import requests as http_requests
import random

from cache_system import (
    sports_cache,
    cached_api_call,
    build_rapidapi_fetcher,
    TTL_LIVE,
    TTL_MATCHES,
    TTL_LEAGUES,
    TTL_DEFAULT,
)

logger = logging.getLogger(__name__)

sports_bp = Blueprint('sports', __name__, url_prefix='/sports')

# ── Cargar credenciales de API desde config ───────────────────────────────────
try:
    import config as _cfg
    _FB_KEY    = getattr(_cfg, 'RAPIDAPI_FOOTBALL_KEY', '')
    _FB_HOST   = getattr(_cfg, 'RAPIDAPI_FOOTBALL_HOST', 'free-api-live-football-data.p.rapidapi.com')
    _MLB_KEY   = getattr(_cfg, 'RAPIDAPI_MLB_KEY', '')
    _MLB_HOST  = getattr(_cfg, 'RAPIDAPI_MLB_HOST', 'tank01-mlb-live-in-game-real-time-statistics.p.rapidapi.com')
    _NFL_KEY   = getattr(_cfg, 'RAPIDAPI_NFL_KEY', '')
    _NFL_HOST  = getattr(_cfg, 'RAPIDAPI_NFL_HOST', 'nfl-api-data.p.rapidapi.com')
    _F1_KEY    = getattr(_cfg, 'RAPIDAPI_F1_KEY', '')
    _F1_HOST   = getattr(_cfg, 'RAPIDAPI_F1_HOST', 'hyprace-api.p.rapidapi.com')
    _CRON_SECRET = getattr(_cfg, 'CRON_SECRET', 'zonajackpot777_cron_2026')
except Exception:
    _FB_KEY    = '050089e867mshb8bc7a3333bb3cfp1e5f4djsn41c27e7522d5'
    _FB_HOST   = 'free-api-live-football-data.p.rapidapi.com'
    _MLB_KEY   = '6baf9fc61cmsh68fc825745fb754p1d702djsn35393a209de6'
    _MLB_HOST  = 'tank01-mlb-live-in-game-real-time-statistics.p.rapidapi.com'
    _NFL_KEY   = '6baf9fc61cmsh68fc825745fb754p1d702djsn35393a209de6'
    _NFL_HOST  = 'nfl-api-data.p.rapidapi.com'
    _F1_KEY    = '6baf9fc61cmsh68fc825745fb754p1d702djsn35393a209de6'
    _F1_HOST   = 'hyprace-api.p.rapidapi.com'
    _CRON_SECRET = 'zonajackpot777_cron_2026'

# ── Definición de deportes ────────────────────────────────────────────────────
SPORTS = {
    'soccer':  {'name': 'Fútbol',         'emoji': '⚽', 'color': '#10b981'},
    'nba':     {'name': 'Baloncesto NBA', 'emoji': '🏀', 'color': '#f59e0b'},
    'nfl':     {'name': 'NFL',            'emoji': '🏈', 'color': '#6366f1'},
    'mlb':     {'name': 'Béisbol MLB',    'emoji': '⚾', 'color': '#ef4444'},
    'tennis':  {'name': 'Tenis',          'emoji': '🎾', 'color': '#84cc16'},
    'nhl':     {'name': 'Hockey NHL',     'emoji': '🏒', 'color': '#06b6d4'},
    'f1':      {'name': 'Formula 1',      'emoji': '🏎️', 'color': '#e10600'},
    'rugby':   {'name': 'Rugby',          'emoji': '🏉', 'color': '#8b5cf6'},
    'golf':    {'name': 'Golf',           'emoji': '⛳', 'color': '#22c55e'},
}

# ── Duración estimada por deporte (minutos) ───────────────────────────────────
SPORT_DURATION_MINUTES = {
    'soccer': 110, 'nba': 150, 'nfl': 210, 'mlb': 210,
    'tennis': 180, 'nhl': 120, 'f1': 120,  'rugby': 100, 'golf': 420,
}


# ─────────────────────────────────────────────────────────────────────────────
# VISTAS (HTML)
# ─────────────────────────────────────────────────────────────────────────────

@sports_bp.route('/')
def index():
    return render_template('sports/index.html', sports=SPORTS)


@sports_bp.route('/<source>')
def sport_view(source):
    if source not in SPORTS:
        return "Deporte no disponible", 404
    meta = SPORTS[source]
    templates = {
        'soccer': 'sports/soccer.html',
        'mlb':    'sports/baseball.html',
        'nfl':    'sports/nfl.html',
        'f1':     'sports/f1.html',
    }
    template_name = templates.get(source, 'sports/matches.html')
    return render_template(
        template_name,
        sport_source=source,
        sport_name=meta['name'],
        sport_emoji=meta['emoji'],
        sport_color=meta['color'],
    )


@sports_bp.route('/futbol')
def sport_futbol():
    return sport_view('soccer')


# ─────────────────────────────────────────────────────────────────────────────
# HELPERS INTERNOS
# ─────────────────────────────────────────────────────────────────────────────

def _check_match_expired(sport, match_date_str, match_status):
    if match_status in ('finished', 'resolved'):
        return False
    try:
        duration_minutes = SPORT_DURATION_MINUTES.get(sport, 120)
        match_dt = datetime.fromisoformat(match_date_str.replace('Z', '+00:00'))
        now_utc = datetime.utcnow().replace(tzinfo=None)
        if match_dt.tzinfo is not None:
            import calendar
            epoch = calendar.timegm(match_dt.utctimetuple())
            match_dt = datetime.utcfromtimestamp(epoch)
        else:
            from datetime import timedelta
            match_dt = match_dt + timedelta(hours=6)
        elapsed_minutes = (now_utc - match_dt).total_seconds() / 60.0
        return elapsed_minutes >= duration_minutes
    except Exception as e:
        logger.warning(f"[AutoExpire] parse error for date '{match_date_str}': {e}")
        return False


def _rapidapi_get(url, api_key, api_host, params=None, cache_key=None, category='default', ttl=None):
    """
    Hace un GET a RapidAPI usando el caché inteligente.
    Devuelve (data_dict, was_stale, error_response_or_None).
    """
    fetcher = build_rapidapi_fetcher(url, api_key, api_host, params)

    try:
        if cache_key:
            data, was_stale = cached_api_call(cache_key, fetcher, category, ttl)
        else:
            data = fetcher()
            was_stale = False
        return data, was_stale, None

    except RuntimeError as exc:
        # 429 / 403 — intentar devolver stale si existe
        stale = sports_cache.get_stale(cache_key) if cache_key else None
        if stale:
            logger.warning(f"[API] API error ({exc}), serving stale for {cache_key}")
            return stale, True, None
        err_msg = str(exc)
        if '429' in err_msg:
            return None, False, jsonify({'status': 'error', 'error_code': 429, 'message': 'Límite de peticiones alcanzado. Espera un momento.'})
        if '403' in err_msg:
            return None, False, jsonify({'status': 'error', 'error_code': 403, 'message': 'Acceso denegado a la API. Verifica la suscripción en RapidAPI.'})
        return None, False, jsonify({'status': 'error', 'message': err_msg})

    except http_requests.exceptions.Timeout:
        stale = sports_cache.get_stale(cache_key) if cache_key else None
        if stale:
            return stale, True, None
        return None, False, jsonify({'status': 'error', 'message': 'Tiempo de espera agotado.'})

    except Exception as exc:
        stale = sports_cache.get_stale(cache_key) if cache_key else None
        if stale:
            return stale, True, None
        logger.warning(f"[API] Unexpected error for {cache_key}: {exc}")
        return None, False, jsonify({'status': 'error', 'message': f'Error de red: {exc}'})


# ─────────────────────────────────────────────────────────────────────────────
# API — PARTIDOS CUSTOM (Firebase)
# ─────────────────────────────────────────────────────────────────────────────

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

        if current_status == 'upcoming' and match_date:
            if _check_match_expired(sport, match_date, current_status):
                database.patch_fb(f"custom_matches/{sport}/{m_id}", {"status": "finished"})
                m_data['status'] = 'finished'
                current_status = 'finished'
                logger.info(f"[AutoExpire] {m_id} ({sport}) → finished")

        m_data['id'] = m_id
        if show_finished:
            results.append(m_data)
        elif current_status == 'upcoming':
            results.append(m_data)

    results.sort(key=lambda x: str(x.get('date', '')))
    return jsonify(results)


@sports_bp.route('/api/custom_matches_finished/<sport>', methods=['GET'])
def get_custom_matches_finished(sport):
    customs = database.get_fb('custom_matches') or {}
    sport_customs = customs.get(sport, {})
    finished = []

    for m_id, m_data in sport_customs.items():
        if not m_data:
            continue
        current_status = m_data.get('status', 'upcoming')
        match_date = m_data.get('date', '')

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


# ─────────────────────────────────────────────────────────────────────────────
# PROXY: FOOTBALL (Free API Live Football Data)
# ─────────────────────────────────────────────────────────────────────────────

@sports_bp.route('/api/football/<path:endpoint>')
def football_proxy(endpoint):
    """
    Proxy seguro hacia Free API Live Football Data.
    Usa el sistema de caché inteligente.
    """
    # Mapeo de rutas antiguas del frontend al nuevo API
    if endpoint == "api/matches/live":
        target_path = "football-current-live"
        category = 'live'
    elif endpoint.startswith("api/matches/"):
        date_str = endpoint.split("/")[-1]
        target_path = f"football-get-matches-by-date?date={date_str}"
        category = 'matches'
    else:
        target_path = endpoint
        category = 'matches'

    qs = request.query_string.decode('utf-8')
    if qs:
        sep = "&" if "?" in target_path else "?"
        final_path = f"{target_path}{sep}{qs}"
    else:
        final_path = target_path

    cache_key = f"football:{final_path}"
    url = f"https://{_FB_HOST}/{final_path}"
    active_key = _FB_KEY or '050089e867mshb8bc7a3333bb3cfp1e5f4djsn41c27e7522d5'

    logger.info(f"[Football] Proxy → {url} (cache_key={cache_key})")
    data, was_stale, err = _rapidapi_get(url, active_key, _FB_HOST, cache_key=cache_key, category=category)

    if err:
        return err
    if was_stale:
        logger.debug(f"[Football] Sirviendo stale: {cache_key}")
    return jsonify(data)


# ─────────────────────────────────────────────────────────────────────────────
# PROXY: BASEBALL (MLB)
# ─────────────────────────────────────────────────────────────────────────────

@sports_bp.route('/api/baseball/<path:endpoint>')
def baseball_proxy(endpoint):
    qs = request.query_string.decode('utf-8')
    cache_key = f"mlb:{endpoint}?{qs}"
    url = f"https://{_MLB_HOST}/{endpoint}"
    active_key = _MLB_KEY or '6baf9fc61cmsh68fc825745fb754p1d702djsn35393a209de6'
    params = dict(request.args)

    logger.info(f"[Baseball] Proxy → {url} (cache_key={cache_key})")
    data, was_stale, err = _rapidapi_get(url, active_key, _MLB_HOST, params=params, cache_key=cache_key, category='matches')

    if err:
        return err
    return jsonify(data)


# ─────────────────────────────────────────────────────────────────────────────
# PROXY: NFL
# ─────────────────────────────────────────────────────────────────────────────

@sports_bp.route('/api/nfl/<path:endpoint>')
def nfl_proxy(endpoint):
    qs = request.query_string.decode('utf-8')
    cache_key = f"nfl:{endpoint}?{qs}"
    url = f"https://{_NFL_HOST}/{endpoint}"
    active_key = _NFL_KEY or '6baf9fc61cmsh68fc825745fb754p1d702djsn35393a209de6'
    params = dict(request.args)

    logger.info(f"[NFL] Proxy → {url} (cache_key={cache_key})")
    data, was_stale, err = _rapidapi_get(url, active_key, _NFL_HOST, params=params, cache_key=cache_key, category='matches')

    if err:
        return err
    return jsonify(data)


# ─────────────────────────────────────────────────────────────────────────────
# PROXY: F1 (Hyprace)
# ─────────────────────────────────────────────────────────────────────────────

@sports_bp.route('/api/f1/<path:endpoint>')
def f1_proxy(endpoint):
    qs = request.query_string.decode('utf-8')
    cache_key = f"f1:{endpoint}?{qs}"
    url = f"https://{_F1_HOST}/{endpoint}"
    active_key = _F1_KEY or '6baf9fc61cmsh68fc825745fb754p1d702djsn35393a209de6'
    params = dict(request.args)

    logger.info(f"[F1] Proxy → {url} (cache_key={cache_key})")
    data, was_stale, err = _rapidapi_get(url, active_key, _F1_HOST, params=params, cache_key=cache_key, category='matches')

    if err:
        return err
    return jsonify(data)


# ─────────────────────────────────────────────────────────────────────────────
# ENDPOINT INTERNO: REFRESCO DE CACHÉ
# Compatible con UptimeRobot / cron-job.org para mantener Render activo
# ─────────────────────────────────────────────────────────────────────────────

@sports_bp.route('/api/cache/refresh', methods=['GET', 'POST'])
def internal_cache_refresh():
    """
    Refresca los endpoints más importantes del caché en segundo plano.
    Puede ser llamado por:
      · UptimeRobot cada 5 min (GET con ?secret=...)
      · cron-job.org
      · Panel administrativo

    Protegido por CRON_SECRET opcional.
    """
    secret = request.args.get('secret') or (request.json or {}).get('secret', '')
    if secret and secret != _CRON_SECRET:
        return jsonify({'error': 'Unauthorized'}), 401

    refreshed = []
    errors = []

    # ── Football live ──────────────────────────────────────────────────────
    def _refresh_football_live():
        url = f"https://{_FB_HOST}/football-current-live"
        active_key = _FB_KEY or '050089e867mshb8bc7a3333bb3cfp1e5f4djsn41c27e7522d5'
        fetcher = build_rapidapi_fetcher(url, active_key, _FB_HOST)
        try:
            data = fetcher()
            sports_cache.set('football:football-current-live', data, 'live')
            logger.info("[CronRefresh] football:live OK")
            return True
        except Exception as exc:
            logger.warning(f"[CronRefresh] football:live FAIL → {exc}")
            return False

    # ── Football matches del día ───────────────────────────────────────────
    def _refresh_football_today():
        from datetime import date
        today = date.today().strftime('%Y%m%d')
        cache_key = f"football:football-get-matches-by-date?date={today}"
        url = f"https://{_FB_HOST}/football-get-matches-by-date?date={today}"
        active_key = _FB_KEY or '050089e867mshb8bc7a3333bb3cfp1e5f4djsn41c27e7522d5'
        fetcher = build_rapidapi_fetcher(url, active_key, _FB_HOST)
        try:
            data = fetcher()
            sports_cache.set(cache_key, data, 'matches')
            logger.info("[CronRefresh] football:today OK")
            return True
        except Exception as exc:
            logger.warning(f"[CronRefresh] football:today FAIL → {exc}")
            return False

    import threading
    tasks = [
        ('football_live',  _refresh_football_live),
        ('football_today', _refresh_football_today),
    ]

    results = {}
    threads = []
    for name, fn in tasks:
        def _run(n=name, f=fn):
            results[n] = f()
        t = threading.Thread(target=_run, daemon=True)
        threads.append(t)
        t.start()

    for t in threads:
        t.join(timeout=15)

    for name, ok in results.items():
        if ok:
            refreshed.append(name)
        else:
            errors.append(name)

    return jsonify({
        'status': 'ok',
        'refreshed': refreshed,
        'errors': errors,
        'cache_entries': sports_cache.status()['total_entries'],
        'timestamp': datetime.utcnow().isoformat() + 'Z',
    })


# ─────────────────────────────────────────────────────────────────────────────
# API INTERNA — PARTIDOS CUSTOM CLASSIC (legacy, usada desde el panel admin)
# ─────────────────────────────────────────────────────────────────────────────

@sports_bp.route('/api/matches')
def get_matches():
    matches_db = database._to_dict(database.get_fb("sports_matches"))
    matches = [dict(m, id=k) for k, m in matches_db.items() if m.get('status') == 'upcoming']
    matches.sort(key=lambda x: x.get('date', ''))

    data = []
    for m in matches:
        data.append({
            "id":     m.get('id'),
            "team1":  m.get('team1'),
            "team2":  m.get('team2'),
            "date":   m.get('date'),
            "status": m.get('status'),
            "odds":   {"1": m.get('odd1'), "X": m.get('oddx'), "2": m.get('odd2')},
        })
    return jsonify(data)


# ─────────────────────────────────────────────────────────────────────────────
# API — APUESTAS
# ─────────────────────────────────────────────────────────────────────────────

@sports_bp.route('/api/bet', methods=['POST'])
def place_bet():
    data = request.json
    telegram_id  = data.get('telegram_id')
    match_id     = data.get('match_id')
    match_name   = data.get('match_name')
    team_choice  = data.get('team_choice')
    amount       = data.get('amount')
    odd          = data.get('odd')
    sport_source = data.get('sport_source', 'soccer')
    match_date   = data.get('match_date')

    if not all([telegram_id, match_id, match_name, team_choice, amount, odd]):
        return jsonify({"success": False, "error": "Datos de apuesta incompletos"}), 400

    try:
        amount = int(amount)
        if amount <= 0:
            raise ValueError
    except Exception:
        return jsonify({"success": False, "error": "Cantidad inválida"}), 400

    # ── Ventana de 15 min post-inicio ─────────────────────────────────────────
    if match_date:
        try:
            from datetime import timezone, timedelta
            match_dt = datetime.fromisoformat(str(match_date).replace('Z', '+00:00'))
            now_utc  = datetime.now(timezone.utc)
            if match_dt.tzinfo is None:
                match_dt = match_dt.replace(tzinfo=timezone.utc)
            elapsed_minutes = (now_utc - match_dt).total_seconds() / 60.0
            if elapsed_minutes > 15:
                return jsonify({
                    "success": False,
                    "error": f"⏱️ El tiempo para apostar cerró. Han pasado {int(elapsed_minutes)} min desde el inicio (límite: 15 min)."
                }), 400
        except Exception as e:
            logger.warning(f"[BetWindow] Date parse error: {e}")

    is_demo = session.get('play_mode') == 'demo'
    user = database.get_fb(f"usuarios/{telegram_id}")
    if not user:
        return jsonify({"success": False, "error": "Usuario no encontrado"}), 404

    current_bits = int(user.get('bits_demo', 0)) if is_demo else int(user.get('bits', 0))
    if current_bits < amount:
        return jsonify({"success": False, "error": "Saldo insuficiente"}), 400

    try:
        is_draw = str(team_choice).strip().lower() in ['empate', 'draw', 'x']
        odd = 2.00 if is_draw else 1.75
    except Exception:
        return jsonify({"success": False, "error": "Cuota (Odd) inválida"}), 400

    database.descontar_bits(telegram_id, amount, is_demo=is_demo)

    bet_data = {
        "telegram_id":  str(telegram_id),
        "match_id":     match_id,
        "match_name":   match_name,
        "team_choice":  team_choice,
        "amount":       amount,
        "odd":          odd,
        "sport_source": sport_source,
        "status":       "pending",
        "created_at":   datetime.utcnow().isoformat(),
        "match_date":   match_date or None,
        "is_demo":      is_demo,
    }
    database.post_fb("sports_bets", bet_data)

    new_balance = database.obtener_bits(telegram_id, is_demo=is_demo)
    logger.info(f"Apuesta Deportiva (Demo={is_demo}): {telegram_id} → {amount} bits en {match_name}")
    return jsonify({"success": True, "new_balance": new_balance})


@sports_bp.route('/api/bets/<telegram_id>')
def get_bets(telegram_id):
    bets_db = database._to_dict(database.get_fb("sports_bets"))
    user_bets = [dict(b, id=k) for k, b in bets_db.items() if str(b.get('telegram_id')) == str(telegram_id)]
    user_bets.sort(key=lambda x: x.get('created_at', ''), reverse=True)

    data = []
    for b in user_bets:
        is_draw = str(b.get('team_choice', '')).strip().lower() in ['empate', 'draw', 'x']
        actual_odd = 2.00 if is_draw else 1.75
        pot_win = int(b.get('amount', 0) * actual_odd)
        data.append({
            "match":         b.get('match_name', 'Unknown Match'),
            "choice":        b.get('team_choice'),
            "amount":        b.get('amount'),
            "odd":           actual_odd,
            "potential_win": pot_win,
            "status":        b.get('status', 'pending'),
            "date":          b.get('created_at'),
        })
    return jsonify(data)
