# =====================================================
# ZONA JACKPOT 777 - TELEGRAM BOT
# =====================================================

import requests
import logging
from config import Config

logger = logging.getLogger(__name__)

# =====================================================
# SEND MESSAGE
# =====================================================

def send_telegram_message(chat_id, text):
    """
    Envía un mensaje a Telegram
    """

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


# =====================================================
# BET PLACED
# =====================================================

def notify_bet_placed(user, match, amount, choice):
    """
    Notifica cuando un usuario realiza una apuesta
    """

    text = f"""
🎯 <b>Apuesta registrada</b>

⚽ Partido:
{match.team1} vs {match.team2}

📌 Tu elección: {choice}

💰 Apuesta: {amount} bits

🍀 ¡Mucha suerte!
"""

    send_telegram_message(user.chat_id, text)


# =====================================================
# RESULT NOTIFICATION
# =====================================================

def notify_user_bet_result(user, match, won):
    """
    Notifica el resultado de una apuesta
    """

    if won:

        text = f"""
🏆 <b>¡GANASTE!</b>

⚽ Partido:
{match.team1} vs {match.team2}

🎉 Tu predicción fue correcta.

💰 Saldo actual: {user.bits} bits

🔥 ¡Sigue apostando en Zona Jackpot 777!
"""

    else:

        text = f"""
😢 <b>Apuesta perdida</b>

⚽ Partido:
{match.team1} vs {match.team2}

Tu predicción no fue correcta esta vez.

💰 Saldo actual: {user.bits} bits

🍀 ¡El próximo partido puede ser el tuyo!
"""

    send_telegram_message(user.chat_id, text)


# =====================================================
# BALANCE UPDATE
# =====================================================

def notify_balance_update(user, amount):
    """
    Notifica cuando se agrega saldo
    """

    text = f"""
💰 <b>Saldo actualizado</b>

Se agregaron <b>{amount} bits</b> a tu cuenta.

Saldo actual: <b>{user.bits} bits</b>

🎮 Entra y apuesta en Zona Jackpot 777.
"""

    send_telegram_message(user.chat_id, text)


# =====================================================
# SYSTEM MESSAGE
# =====================================================

def notify_system_message(user, message):
    """
    Mensajes generales del sistema
    """

    text = f"""
📢 <b>Zona Jackpot 777</b>

{message}
"""

    send_telegram_message(user.chat_id, text)