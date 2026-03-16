# =====================================================
# ZONA JACKPOT 777 - CONFIGURATION
# =====================================================

import os
from dotenv import load_dotenv

load_dotenv()

class Config:

    # =====================================================
    # GENERAL
    # =====================================================

    APP_NAME = "Zona Jackpot 777"

    ENV = os.getenv("ENV", "development")

    DEBUG = os.getenv("DEBUG", "True") == "True"

    SECRET_KEY = os.getenv("SECRET_KEY", "super-secret-key-change-this")

    DEFAULT_THEME = os.getenv("DEFAULT_THEME", "worldcup")


    # =====================================================
    # DATABASE
    # =====================================================

    SQLALCHEMY_DATABASE_URI = os.getenv(
        "DATABASE_URL",
        "sqlite:///bets.db"
    )

    SQLALCHEMY_TRACK_MODIFICATIONS = False

    DB_POOL_SIZE = 10


    # =====================================================
    # SECURITY
    # =====================================================

    SESSION_COOKIE_HTTPONLY = True

    SESSION_COOKIE_SECURE = False

    PERMANENT_SESSION_LIFETIME = 86400  # 24h

    MAX_CONTENT_LENGTH = 16 * 1024 * 1024


    # =====================================================
    # SPORTSBOOK SETTINGS
    # =====================================================

    MIN_BET = int(os.getenv("MIN_BET", 1))

    MAX_BET = int(os.getenv("MAX_BET", 10000))

    DEFAULT_ODD = float(os.getenv("DEFAULT_ODD", 2.0))

    HOUSE_EDGE = float(os.getenv("HOUSE_EDGE", 0.05))

    MAX_MATCHES_PER_PAGE = 50


    # =====================================================
    # USER SETTINGS
    # =====================================================

    STARTING_BALANCE = int(os.getenv("STARTING_BALANCE", 100))


    # =====================================================
    # TELEGRAM
    # =====================================================

    TELEGRAM_BOT_TOKEN = os.getenv("TELEGRAM_BOT_TOKEN")

    TELEGRAM_ENABLED = os.getenv("TELEGRAM_ENABLED", "True") == "True"


    # =====================================================
    # SERVER
    # =====================================================

    HOST = os.getenv("HOST", "0.0.0.0")

    PORT = int(os.getenv("PORT", 5000))


    # =====================================================
    # SYSTEM FLAGS
    # =====================================================

    MAINTENANCE_MODE = os.getenv("MAINTENANCE_MODE", "False") == "True"

    ENABLE_BETTING = os.getenv("ENABLE_BETTING", "True") == "True"

    ENABLE_NOTIFICATIONS = os.getenv("ENABLE_NOTIFICATIONS", "True") == "True"


    # =====================================================
    # ADMIN SETTINGS
    # =====================================================

    ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "admin")

    ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "admin123")


    # =====================================================
    # LOGGING
    # =====================================================

    LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")