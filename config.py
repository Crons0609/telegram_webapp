import os
from dotenv import load_dotenv

# Cargamos las variables de entorno desde el archivo .env si existe (entorno local).
# En Render, estas se cargarán automáticamente de las "Environment Variables".
load_dotenv()

BOT_TOKEN = os.getenv("BOT_TOKEN", "MISSING_TOKEN")
WEBAPP_URL = os.getenv("WEBAPP_URL", "https://t.me/TuBot/AppWindow")

# PayPal API credentials
PAYPAL_MODE = os.getenv("PAYPAL_MODE", "sandbox")

if PAYPAL_MODE == "sandbox":
    PAYPAL_CLIENT_ID = os.getenv("PAYPAL_CLIENT_ID_SANDBOX", "")
    PAYPAL_CLIENT_SECRET = os.getenv("PAYPAL_CLIENT_SECRET_SANDBOX", "")
else:
    PAYPAL_CLIENT_ID = os.getenv("PAYPAL_CLIENT_ID_LIVE", "")
    PAYPAL_CLIENT_SECRET = os.getenv("PAYPAL_CLIENT_SECRET_LIVE", "")

# Configuración del sistema de retiros (Pueden quedar fijas o ser variables
# pero dejarlas fijas es seguro ya que no compromete ninguna cuenta externa)
BITS_TO_USD_RATE = 1000
WITHDRAWAL_MIN_BITS = 10000
WITHDRAWAL_MAX_USD_DAY = 50.0
WITHDRAWAL_MAX_PER_DAY = 5

# Marketing / Seguridad interna
CRON_SECRET = os.getenv("CRON_SECRET", "zonajackpot777_cron_2026")

# RapidAPI (Deportes)
RAPIDAPI_FOOTBALL_KEY  = os.getenv("RAPIDAPI_FOOTBALL_KEY", "")
RAPIDAPI_FOOTBALL_HOST = os.getenv("RAPIDAPI_FOOTBALL_HOST", "footapi7.p.rapidapi.com")