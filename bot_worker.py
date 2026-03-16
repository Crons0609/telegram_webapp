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
    with database.get_connection() as conn:
        # Find matches that are finished
        matches = conn.execute("SELECT * FROM sports_matches WHERE status = 'finished'").fetchall()
        
        for match in matches:
            match_id = match['id']
            result = match['result']
            team1 = match['team1']
            team2 = match['team2']
            if not result: continue # Finished but no result? skip
            
            # Find pending bets for this match
            bets = conn.execute("SELECT * FROM sports_bets WHERE match_id = ? AND status = 'pending'", (match_id,)).fetchall()
            
            for bet in bets:
                bet_id = bet['id']
                telegram_id = bet['telegram_id']
                amount = bet['amount']
                choice = bet['team_choice']
                
                # Fetch user
                user = database.obtener_perfil_completo(telegram_id)
                if not user:
                    continue
                
                if choice == result:
                    # Won
                    odds = bet['odds_at_placement']
                    winnings = int(amount * odds)
                    
                    # Update bet
                    conn.execute("UPDATE sports_bets SET status = 'won' WHERE id = ?", (bet_id,))
                    
                    # Update User Bits
                    conn.execute("UPDATE usuarios SET bits = bits + ? WHERE telegram_id = ?", (winnings, telegram_id))
                    
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

🔥 ¡Sigue apostando en Zona Jackpot 777!
"""
                    send_telegram_message(telegram_id, text)
                    logger.info(f"Bet {bet_id} WON by {telegram_id}. Winnings: {winnings}")
                
                else:
                    # Lost
                    conn.execute("UPDATE sports_bets SET status = 'lost' WHERE id = ?", (bet_id,))
                    
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
