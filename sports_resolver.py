import time
import requests
import traceback
import logging
from datetime import datetime, timezone
import database

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(name)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

# Fallback basic credentials like in sports_routes.py
FB_HOST = 'free-api-live-football-data.p.rapidapi.com'
MLB_HOST = 'tank01-mlb-live-in-game-real-time-statistics.p.rapidapi.com'
NFL_HOST = 'nfl-api-data.p.rapidapi.com'

def get_api_key():
    try:
        import config
        return getattr(config, 'RAPIDAPI_FOOTBALL_KEY', '050089e867mshb8bc7a3333bb3cfp1e5f4djsn41c27e7522d5')
    except:
        return '050089e867mshb8bc7a3333bb3cfp1e5f4djsn41c27e7522d5'

def resolve_soccer_match(match_id, bet_id, bet_data):
    """Verifica el estado de un partido de fútbol en la nueva API y resuelve la apuesta."""
    raw_date = bet_data.get('match_date') or bet_data.get('created_at', '')
    if raw_date:
        try:
            dt = datetime.fromisoformat(raw_date.replace('Z', '+00:00'))
            date_str = dt.strftime("%Y%m%d")
        except:
            date_str = datetime.utcnow().strftime("%Y%m%d")
    else:
        date_str = datetime.utcnow().strftime("%Y%m%d")

    url = f"https://{FB_HOST}/football-get-matches-by-date?date={date_str}"
    headers = {
        "x-rapidapi-key": get_api_key(),
        "x-rapidapi-host": FB_HOST,
        "Accept": "application/json"
    }

    try:
        resp = requests.get(url, headers=headers, timeout=12)
        if resp.status_code != 200:
            return False
            
        data = resp.json()
        resp_node = data.get('response', [])
        if isinstance(resp_node, dict):
            items = resp_node.get('live') or resp_node.get('matches') or resp_node.get('events') or []
        else:
            items = resp_node
            
        match_data = None
        for m in items:
            if str(m.get('id', '')) == str(match_id):
                match_data = m
                break
                
        if not match_data:
            return False

        st = match_data.get('status', {})
        status_finished = st.get('finished', False) or str(st.get('type', '')).lower() in ['finished', 'ended', 'closed']
        if not status_finished:
            return False

        home_score = match_data.get('home', {}).get('score')
        away_score = match_data.get('away', {}).get('score')
        home_team = match_data.get('home', {}).get('name', '').lower().strip()
        away_team = match_data.get('away', {}).get('name', '').lower().strip()
        
        if home_score is None or away_score is None:
            return False

        winner_choice = ""
        if int(home_score) > int(away_score):
            winner_choice = home_team
        elif int(away_score) > int(home_score):
            winner_choice = away_team
        else:
            winner_choice = "empate"

        user_choice = str(bet_data.get('team_choice', '')).lower().strip()
        amount = int(bet_data.get('amount', 0))
        telegram_id = bet_data.get('telegram_id')
        match_name = bet_data.get('match_name', 'apuesta deportiva')
        
        # Validamos si ganó
        if user_choice == winner_choice or (user_choice in winner_choice) or (winner_choice in user_choice):
            is_draw = user_choice in ['empate', 'draw', 'x']
            actual_odd = 2.00 if is_draw else 1.75
            winnings = int(amount * actual_odd)
            is_demo = bet_data.get('is_demo', False)
            database.registrar_ganancia(telegram_id, winnings, is_demo=is_demo)
            database.patch_fb(f"sports_bets/{bet_id}", {"status": "won"})
            try:
                database.notify_user(telegram_id, "✅ Apuesta Deportiva Ganada", f"¡Apostaste con éxito a la victoria de tu equipo en Fútbol!\nGanancias: {winnings} bits en {match_name}.")
            except:
                pass
            logger.info(f"Bet {bet_id} WON for user {telegram_id}. Paid: {winnings}")
        else:
            database.patch_fb(f"sports_bets/{bet_id}", {"status": "lost"})
            try:
                database.notify_user(telegram_id, "❌ Apuesta Deportiva Perdida", f"Lo sentimos, perdiste tu apuesta de {amount} bits en {match_name}.")
            except:
                pass
            logger.info(f"Bet {bet_id} LOST for user {telegram_id}.")
            
        return True
    except Exception as e:
        logger.error(f"[Resolver] Fetch Footapi error: {e}")
        return False


def run_resolver():
    """Ejecuta un barrido rápido para el deporte principal (Fútbol). Béisbol/NFL pueden ser implementados aquí después."""
    try:
        logger.info("[Resolver] Starting sports background sweep...")
        bets = database.get_fb("sports_bets") or {}
        
        pending_count = 0
        resolved_count = 0
        
        for bet_id, bet_data in bets.items():
            if bet_data.get("status") != "pending":
                continue
                
            match_id = bet_data.get("match_id")
            sport = bet_data.get("sport_source", "soccer")
            
            if not match_id:
                continue
                
            success = False
            
            pending_count += 1
            if pending_count > 10:
                break # Para evitar Rate Limits en cuentas Free de RapidAPI por sweep
                
            try:
                # Actualmente activado de forma 100% segura para SOCCER que es la prioridad principal
                # Para evitar fallos silenciosos, si es 'soccer', intentamos resolver.
                if sport == "soccer" or sport == "futbol":
                    success = resolve_soccer_match(match_id, bet_id, bet_data)
                elif sport not in ["mlb", "nfl", "f1"]: 
                    # Apuestas muy viejas que no tienen sport y fueron de soccer pueden resolverse
                    success = resolve_soccer_match(match_id, bet_id, bet_data)
            except Exception as e:
                logger.error(f"[Resolver] Error resolving bet {bet_id} (match {match_id}): {e}")
                
            if success:
                resolved_count += 1
                
        logger.info(f"[Resolver] Sweep finished. {resolved_count} bets resolved out of checked pending ones.")
    except Exception as e:
        logger.error(f"[Resolver] Global Sweep Error: {e}")
        traceback.print_exc()

if __name__ == "__main__":
    run_resolver()
