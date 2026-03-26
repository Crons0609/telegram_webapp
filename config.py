BOT_TOKEN = "8511146591:AAGZP46Bs0NaqzQvXeduDdwzvA3Tyd02JsU"
WEBAPP_URL = "https://t.me/Zona_Jackpot_777bot/Zona_jackpot_777"  # luego lo cambias cuando lo subas a Render

# PayPal API credentials
PAYPAL_MODE = "live"  # "sandbox" para pruebas, "live" para producción

if PAYPAL_MODE == "sandbox":
    PAYPAL_CLIENT_ID = "ARIbqolPZ_S8yK_AIsRvL1MjdvXk0i1t_QEig7OpXNiZIGNV6a0R6ixssDFdXP4VYPOl1NCNqz6STUHt"
    PAYPAL_CLIENT_SECRET = "EOTApF7IxTuzc1Ht_hveKVsGtqpNkx25Zz0zRJmR5FlGt7FgiiqfDoFq2YagujcAlxHpaUjbwZ2OiZ79"
else:
    PAYPAL_CLIENT_ID = "AUp_WermC5CsF_EkBK6Wk5_4bov44u62qrMLgGWy7CklZ6WIWMQQJvlhy5fIwO1u0G968F3jmINv62LF"
    PAYPAL_CLIENT_SECRET = "EAOhMDZzjgsGc7XJ1REFo3tef1lTe0DqSkHN5VAwMmQ5tr1ruD3DKuNOsOiBwwBntwXLWLwZZLYS3DZr"

# Configuración del sistema de retiros
BITS_TO_USD_RATE = 1000       # 1000 bits = 1 USD
WITHDRAWAL_MIN_BITS = 5000    # Mínimo 5,000 bits ($5 USD)
WITHDRAWAL_MAX_USD_DAY = 50.0 # Máximo $50 USD por día
WITHDRAWAL_MAX_PER_DAY = 5    # Máximo 3 retiros por día por usuario

# ─── MARKETING AUTOMATIZADO ───────────────────────────────────────────────────
# Clave secreta para el endpoint /api/cron/marketing
# Cámbiala por algo que solo tú conozcas. Úsala en la URL: ?key=TU_CLAVE
CRON_SECRET = "zonajackpot777_cron_2026"

# ─── ESPN SPORTS API (RapidAPI) ───────────────────────────────────────────────
RAPIDAPI_ESPN_KEY  = "6baf9fc61cmsh68fc825745fb754p1d702djsn35393a209de6"
RAPIDAPI_ESPN_HOST = "espn13.p.rapidapi.com"

# ─── FREE API LIVE FOOTBALL DATA (RapidAPI) ───────────────────────────────────
RAPIDAPI_FOOTBALL_KEY  = "6baf9fc61cmsh68fc825745fb754p1d702djsn35393a209de6"
RAPIDAPI_FOOTBALL_HOST = "free-api-live-football-data.p.rapidapi.com"