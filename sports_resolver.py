import time
import requests
import traceback
import logging
from datetime import datetime, timezone
import database

logger = logging.getLogger(__name__)

# Fallback basic credentials like in sports_routes.py
FB_HOST = 'footapi7.p.rapidapi.com'
MLB_HOST = 'tank01-mlb-live-in-game-real-time-statistics.p.rapidapi.com'
NFL_HOST = 'nfl-api-data.p.rapidapi.com'

def get_api_key():
    try:
        import config
        return getattr(config, 'RAPIDAPI_FOOTBALL_KEY', '6baf9fc61cmsh68fc825745fb754p1d702djsn35393a209de6')
    except:
        return '6baf9fc61cmsh68fc825745fb754p1d702djsn35393a209de6'

def resolve_soccer_match(match_id, bet_id, bet_data):
    """Verifica el estado de un partido de fútbol en footapi7 y resuelve la apuesta."""
    url = f"https://{FB_HOST}/api/match/{match_id}"
    headers = {
        "x-rapidapi-key": get_api_key(),
        "x-rapidapi-host": FB_HOST,
        "Accept": "application/json"
    }

    try:
        resp = requests.get(url, headers=headers, timeout=10)
        if resp.status_code == 404:
            return False # Match not found, might be invalid
        resp.raise_for_status()
        data = resp.json()

        event = data.get('event', {})
        status_type = str(event.get('status', {}).get('type', '')).lower()
        
        # Solo resolvemos si ha terminado
        if status_type not in ['finished', 'ended', 'closed']:
            return False

        home_score = event.get('homeScore', {}).get('current')
        away_score = event.get('awayScore', {}).get('current')
        
        home_team = event.get('homeTeam', {}).get('name', '').lower().strip()
        away_team = event.get('awayTeam', {}).get('name', '').lower().strip()
        
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
            winnings = int(amount * 1.75)
            database.recargar_bits(telegram_id, winnings)
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
