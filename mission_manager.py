"""
mission_manager.py — Sistema de Misiones
Define las misiones del casino y gestiona su progreso y recompensas.
"""
import database

# ─── Definición de Misiones ─────────────────────────────────────────────────

MISSION_DEFINITIONS = [
    {
        "id": "mission_1",
        "name": "Debut en el Casino",
        "desc": "Juega tu primera partida en cualquier juego.",
        "icon": "🎰",
        "type": "juegos_jugados",
        "target": 1,
        "xp_reward": 50,
        "bits_reward": 0
    },
    {
        "id": "mission_2",
        "name": "Jugador Dedicado",
        "desc": "Juega 10 partidas en total.",
        "icon": "🎮",
        "type": "juegos_jugados",
        "target": 10,
        "xp_reward": 150,
        "bits_reward": 100
    },
    {
        "id": "mission_3",
        "name": "Primera Sangre",
        "desc": "Consigue tu primera victoria en cualquier juego.",
        "icon": "⚔️",
        "type": "wins_total",
        "target": 1,
        "xp_reward": 100,
        "bits_reward": 50
    },
    {
        "id": "mission_4",
        "name": "Rey del Moche",
        "desc": "Gana 5 partidas de Moche.",
        "icon": "🃏",
        "type": "moches_ganados",
        "target": 5,
        "xp_reward": 200,
        "bits_reward": 200
    },
    {
        "id": "mission_5",
        "name": "La Ruleta de la Fortuna",
        "desc": "Gana 5 rondas de Ruleta Francesa.",
        "icon": "🎡",
        "type": "ruletas_ganadas",
        "target": 5,
        "xp_reward": 200,
        "bits_reward": 200
    },
    {
        "id": "mission_6",
        "name": "Cazador de Jackpots",
        "desc": "Obtén 3 Jackpots en la Slot Machine.",
        "icon": "🎰",
        "type": "jackpots_ganados",
        "target": 3,
        "xp_reward": 300,
        "bits_reward": 500
    },
    {
        "id": "mission_7",
        "name": "El Camino del Maestro",
        "desc": "Acumula 20 victorias en cualquier juego.",
        "icon": "🏆",
        "type": "wins_total",
        "target": 20,
        "xp_reward": 500,
        "bits_reward": 300
    },
    {
        "id": "mission_8",
        "name": "Explorador Total",
        "desc": "Juega los 3 juegos del casino (Moche, Ruleta y Slot).",
        "icon": "🌐",
        "type": "multi_game",
        "target": 3,
        "xp_reward": 250,
        "bits_reward": 150
    }
]


def get_mission_definitions():
    """Returns the full list of mission definitions (no lambdas)."""
    return MISSION_DEFINITIONS


def get_user_missions_with_progress(telegram_id: str) -> list:
    """Returns missions with their current progress for a user."""
    perfil = database.obtener_perfil_completo(telegram_id)
    if not perfil:
        return []

    # Get claimed missions from DB
    user_missions = database.get_user_missions(telegram_id)
    claimed_map = {um["mission_id"]: um for um in user_missions}

    # Get current stats
    stats = {
        "juegos_jugados": perfil.get("juegos_jugados", 0),
        "moches_ganados": perfil.get("moches_ganados", 0),
        "ruletas_ganadas": perfil.get("ruletas_ganadas", 0),
        "jackpots_ganados": perfil.get("jackpots_ganados", 0),
        "wins_total": perfil.get("wins_total", 0),
    }

    # Compute multi_game progress
    played_games = 0
    if perfil.get("moches_ganados", 0) > 0 or perfil.get("juegos_jugados", 0) > 0:
        if perfil.get("juegos_jugados", 0) > 0:
            played_games += 1  # played something
    if perfil.get("moches_ganados", 0) > 0:
        played_games = max(played_games, 1)
    if perfil.get("ruletas_ganadas", 0) > 0:
        played_games = min(played_games + 1, 3)
    if perfil.get("jackpots_ganados", 0) > 0:
        played_games = min(played_games + 1, 3)
    stats["multi_game"] = played_games

    result = []
    for m in MISSION_DEFINITIONS:
        claimed_data = claimed_map.get(m["id"], {})
        current = stats.get(m["type"], 0)
        progress_pct = min(int((current / m["target"]) * 100), 100) if m["target"] > 0 else 0
        completed = current >= m["target"]

        result.append({
            **m,
            "current_progress": current,
            "progress_percent": progress_pct,
            "completed": completed,
            "claimed": claimed_data.get("claimed", 0) == 1
        })

    return result


def claim_mission_reward(telegram_id: str, mission_id: str) -> dict:
    """
    Claims the reward for a completed mission.
    Returns dict with status, xp_gained, bits_gained.
    """
    mission = next((m for m in MISSION_DEFINITIONS if m["id"] == mission_id), None)
    if not mission:
        return {"status": "error", "message": "Misión no encontrada"}

    # Verify completion
    perfil = database.obtener_perfil_completo(telegram_id)
    if not perfil:
        return {"status": "error", "message": "Usuario no encontrado"}

    stats = {
        "juegos_jugados": perfil.get("juegos_jugados", 0),
        "moches_ganados": perfil.get("moches_ganados", 0),
        "ruletas_ganadas": perfil.get("ruletas_ganadas", 0),
        "jackpots_ganados": perfil.get("jackpots_ganados", 0),
        "wins_total": perfil.get("wins_total", 0),
    }
    current = stats.get(mission["type"], 0)

    if current < mission["target"]:
        return {"status": "error", "message": "Misión no completada todavía"}

    # Check already claimed
    already = database.is_mission_claimed(telegram_id, mission_id)
    if already:
        return {"status": "error", "message": "Recompensa ya reclamada"}

    # Award rewards
    from user_profile_manager import UserProfileManager
    profile_updates = None

    if mission["xp_reward"] > 0:
        profile_updates = UserProfileManager.add_xp(telegram_id, "custom", mission["xp_reward"])

    if mission["bits_reward"] > 0:
        database.recargar_bits(telegram_id, mission["bits_reward"])

    # Mark as claimed
    database.claim_mission(telegram_id, mission_id)

    return {
        "status": "ok",
        "xp_gained": mission["xp_reward"],
        "bits_gained": mission["bits_reward"],
        "profile_updates": profile_updates
    }
