"""
trophy_manager.py — Sistema de Trofeos
Define los 9 trofeos del casino y su lógica de desbloqueo.
"""
import database

def get_trophy_definitions():
    """Returns serializable trophy metadata without condition functions."""
    with database.get_connection() as conn:
        trophies_db = conn.execute("SELECT * FROM trophies_config WHERE is_active = 1").fetchall()
        return [dict(t) for t in trophies_db]

def check_and_unlock_trophies(telegram_id: str) -> list:
    """
    Checks all trophy conditions for a user and unlocks those not yet unlocked.
    Returns list of newly unlocked trophy dicts.
    """
    # Fetch stats
    perfil = database.obtener_perfil_completo(telegram_id)
    if not perfil:
        return []

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
    
    with database.get_connection() as conn:
        trophies_db = conn.execute("SELECT * FROM trophies_config WHERE is_active = 1").fetchall()
        
        for trophy in trophies_db:
            tid = trophy["id"]
            if tid not in already_unlocked:
                stat_name = trophy["stat_name"]
                target = trophy["stat_target"]
                
                # Check condition dynamically based on stat_name and target
                user_stat_value = stats.get(stat_name, 0)
                if user_stat_value >= target:
                    database.unlock_trophy(telegram_id, tid)
                    newly_unlocked.append(dict(trophy))

    return newly_unlocked
