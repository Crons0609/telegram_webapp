"""
trophy_manager.py — Sistema de Trofeos
Define los 9 trofeos del casino y su lógica de desbloqueo.
"""
import database

# ─── Definición de los 9 Trofeos ───────────────────────────────────────────

TROPHY_DEFINITIONS = [
    {
        "id": "trophy_1",
        "name": "Primera Victoria",
        "desc": "Gana tu primera partida en cualquier juego.",
        "img": "/static/img/trophies/trophy_1.png",
        "condition": lambda s: s.get("wins_total", 0) >= 1
    },
    {
        "id": "trophy_2",
        "name": "Bronce en Combate",
        "desc": "Acumula 5 victorias en cualquier juego.",
        "img": "/static/img/trophies/trophy_2.png",
        "condition": lambda s: s.get("wins_total", 0) >= 5
    },
    {
        "id": "trophy_3",
        "name": "Plata Implacable",
        "desc": "Alcanza 10 victorias en cualquier juego.",
        "img": "/static/img/trophies/trophy_3.png",
        "condition": lambda s: s.get("wins_total", 0) >= 10
    },
    {
        "id": "trophy_4",
        "name": "Maestro del Moche",
        "desc": "Gana 10 partidas de Moche.",
        "img": "/static/img/trophies/trophy_4.png",
        "condition": lambda s: s.get("moches_ganados", 0) >= 10
    },
    {
        "id": "trophy_5",
        "name": "Jackpot Supremo",
        "desc": "Obtén un Jackpot en la Slot Machine.",
        "img": "/static/img/trophies/trophy_5.png",
        "condition": lambda s: s.get("jackpots_ganados", 0) >= 1
    },
    {
        "id": "trophy_6",
        "name": "Señor de la Ruleta",
        "desc": "Gana 10 rondas de Ruleta Francesa.",
        "img": "/static/img/trophies/trophy_6.png",
        "condition": lambda s: s.get("ruletas_ganadas", 0) >= 10
    },
    {
        "id": "trophy_7",
        "name": "Racha Dorada",
        "desc": "Acumula 25 victorias en cualquier juego.",
        "img": "/static/img/trophies/trophy_7.svg",
        "condition": lambda s: s.get("wins_total", 0) >= 25
    },
    {
        "id": "trophy_8",
        "name": "Rey del Casino",
        "desc": "Alcanza las 50 victorias acumuladas.",
        "img": "/static/img/trophies/trophy_8.svg",
        "condition": lambda s: s.get("wins_total", 0) >= 50
    },
    {
        "id": "trophy_9",
        "name": "Leyenda Inmortal",
        "desc": "Supera las 100 victorias. La cima del casino.",
        "img": "/static/img/trophies/trophy_9.svg",
        "condition": lambda s: s.get("wins_total", 0) >= 100
    }
]

# Public trophy data without lambda conditions (safe to serialize)
def get_trophy_definitions():
    """Returns serializable trophy metadata without condition functions."""
    return [
        {k: v for k, v in t.items() if k != "condition"}
        for t in TROPHY_DEFINITIONS
    ]


def check_and_unlock_trophies(telegram_id: str) -> list:
    """
    Checks all trophy conditions for a user and unlocks those not yet unlocked.
    Returns list of newly unlocked trophy dicts.
    """
    # Fetch stats
    perfil = database.obtener_perfil_completo(telegram_id)
    if not perfil:
        return []

    # Build a combined stats dict including wins_total
    wins_total = (
        perfil.get("moches_ganados", 0) +
        perfil.get("ruletas_ganadas", 0) +
        (1 if perfil.get("jackpots_ganados", 0) > 0 else 0)
    )
    # Use a more comprehensive wins_total: moches + ruletas + jackpots
    stats = {
        "wins_total": perfil.get("wins_total", 0),
        "moches_ganados": perfil.get("moches_ganados", 0),
        "ruletas_ganadas": perfil.get("ruletas_ganadas", 0),
        "jackpots_ganados": perfil.get("jackpots_ganados", 0),
        "juegos_jugados": perfil.get("juegos_jugados", 0),
    }

    # Fetch already unlocked trophy ids
    already_unlocked = {t["id"] for t in database.get_trophies(telegram_id)}

    newly_unlocked = []
    for trophy in TROPHY_DEFINITIONS:
        tid = trophy["id"]
        if tid not in already_unlocked:
            try:
                if trophy["condition"](stats):
                    database.unlock_trophy(telegram_id, tid)
                    newly_unlocked.append(
                        {k: v for k, v in trophy.items() if k != "condition"}
                    )
            except Exception:
                pass

    return newly_unlocked
