import time
import logging
import requests
from config import Config
import database

logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

def send_telegram_message(chat_id, text):
    token = Config.TELEGRAM_BOT_TOKEN
    if not token or token == "YOUR_BOT_TOKEN":
        logger.error("TELEGRAM_BOT_TOKEN no configurado")
        return False
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = {
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "HTML"
    }
    try:
        response = requests.post(url, json=payload, timeout=10)
        response.raise_for_status()
        logger.info(f"Mensaje enviado a {chat_id}")
        return True
    except requests.exceptions.RequestException as e:
        logger.error(f"Error enviando mensaje a {chat_id}: {e}")
        return False

def process_pending_bets():
    matches_db = database._to_dict(database.get_fb("sports_matches"))
    bets_db = database._to_dict(database.get_fb("sports_bets"))
    
    # Find finished matches
    finished_matches = {k: m for k, m in matches_db.items() if m.get('status') == 'finished' and m.get('result')}
    
    for match_id, match in finished_matches.items():
        result = match.get('result')
        team1 = match.get('team1')
        team2 = match.get('team2')
        
        # Find pending bets for this match
        pending_bets = {k: b for k, b in bets_db.items() if str(b.get('match_id')) == str(match_id) and b.get('status') == 'pending'}
        
        for bet_id, bet in pending_bets.items():
            telegram_id = bet.get('telegram_id')
            amount = bet.get('amount', 0)
            choice = bet.get('team_choice')
            
            # Fetch user
            user = database.get_fb(f"usuarios/{telegram_id}")
            if not user:
                continue
            
            if choice == result:
                # Won
                odds = bet.get('odd', 1.0)
                winnings = int(amount * odds)
                
                # Update bet
                database.patch_fb(f"sports_bets/{bet_id}", {"status": "won"})
                
                # Update User Bits
                database.recargar_bits(telegram_id, winnings)
                
                # Also Add XP
                from user_profile_manager import UserProfileManager
                UserProfileManager.add_xp(telegram_id, "first_win_day", 20) # Dummy XP addition
                
                # Notify
                text = f"""
🏆 <b>¡GANASTE TU APUESTA DEPORTIVA!</b>

⚽ Partido:
{team1} vs {team2}

🎉 Tu predicción ({choice}) fue correcta.
💸 <b>Ganancias:</b> +{winnings} bits

🔥 ¡Sigue apostando en GHOSTH PLAGUE CASINO!
"""
                send_telegram_message(telegram_id, text)
                logger.info(f"Bet {bet_id} WON by {telegram_id}. Winnings: {winnings}")
            
            else:
                # Lost
                database.patch_fb(f"sports_bets/{bet_id}", {"status": "lost"})
                
                # Notify
                text = f"""
😢 <b>Apuesta deportiva perdida</b>

⚽ Partido:
{team1} vs {team2}

Tu predicción ({choice}) no fue correcta esta vez. (Resultado: {result})

🍀 ¡El próximo partido puede ser el tuyo!
"""
                send_telegram_message(telegram_id, text)
                logger.info(f"Bet {bet_id} LOST by {telegram_id}.")

if __name__ == "__main__":
    logger.info("Iniciando Bot Worker de Deportes...")
    while True:
        try:
            process_pending_bets()
        except Exception as e:
            logger.error(f"Error procesando apuestas: {e}")
        time.sleep(10) # Poll every 10 seconds
