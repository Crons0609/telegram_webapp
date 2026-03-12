"""
mission_manager.py — Sistema de Misiones
Define las misiones del casino y gestiona su progreso y recompensas.
"""
import sys
import os
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

import database
from user_profile_manager import UserProfileManager
from mission_data import MISSIONS as MISSION_DEFINITIONS

def get_mission_definitions():
    """Returns the full list of mission definitions."""
    return MISSION_DEFINITIONS


def get_user_missions_with_progress(telegram_id: str) -> list:
    """Returns missions with their current progress for a user."""
    perfil = database.obtener_perfil_completo(telegram_id)
    if not perfil:
        return []

    # Get claimed missions from DB. Format could be 'mission_id_lvl_1'
    user_missions = database.get_user_missions(telegram_id)
    claimed_set = {um["mission_id"] for um in user_missions if um["claimed"] == 1}

    # Gather all stats necessary based on the mission_data columns
    stats = {
        "juegos_jugados": perfil.get("juegos_jugados", 0),
        "moches_ganados": perfil.get("moches_ganados", 0),
        "ruletas_ganadas": perfil.get("ruletas_ganadas", 0),
        "jackpots_ganados": perfil.get("jackpots_ganados", 0),
        "wins_total": perfil.get("wins_total", 0),
        "tiempo_jugado": perfil.get("tiempo_jugado", 0),
        "bits_apostados": perfil.get("bits_apostados", 0),
        "bits_ganados": perfil.get("bits_ganados", 0),
        "win_streak": perfil.get("win_streak", 0),
        "tournaments_played": perfil.get("tournaments_played", 0),
        "tournaments_won": perfil.get("tournaments_won", 0),
        "juegos_diferentes": perfil.get("juegos_diferentes", 0),
    }

    result = []
    
    for m in MISSION_DEFINITIONS:
        base_id = m["id"]
        current_stat = stats.get(m["type"], 0)
        
        # Determine which level is currently active (the first one not claimed)
        active_level_idx = 0
        fully_completed = False
        
        for i in range(3):
            lvl_string = f"{base_id}_lvl_{i+1}"
            if lvl_string in claimed_set:
                active_level_idx = i + 1
            else:
                break
                
        if active_level_idx >= 3:
            # All levels claimed
            fully_completed = True
            active_level_idx = 2 # Show the final tier as completed
            
        lvl_data = m["levels"][active_level_idx]
        
        # Calculate progress
        target = lvl_data["target"]
        progress_pct = min(int((current_stat / target) * 100), 100) if target > 0 else 0
        
        # Determine claimability
        can_claim = (current_stat >= target) and not fully_completed
        
        # Format the description
        desc = m["desc"].format(target=target)
        
        result.append({
            "id": f"{base_id}_lvl_{lvl_data['level']}" if not fully_completed else f"{base_id}_lvl_3",
            "base_id": base_id,
            "name": m["name"],
            "desc": desc,
            "icon": m["icon"],
            "type": m["type"],
            "level": lvl_data['level'],
            "target": target,
            "xp_reward": lvl_data["xp_reward"],
            "bits_reward": lvl_data["bits_reward"],
            "current_progress": current_stat,
            "progress_percent": progress_pct,
            "completed": can_claim, # indicates ready to claim button
            "claimed": fully_completed  # indicates fully done, no more interactions
        })

    return result


def claim_mission_reward(telegram_id: str, formatted_mission_id: str) -> dict:
    """
    Claims the reward for a completed mission level.
    formatted_mission_id example: 'gen_plays_1_lvl_1'
    Returns dict with status, xp_gained, bits_gained.
    """
    try:
        # Extraer base_id y level
        parts = formatted_mission_id.rsplit("_lvl_", 1)
        if len(parts) != 2:
            return {"status": "error", "message": "ID de misión inválido"}
            
        base_id = parts[0]
        level_idx = int(parts[1]) - 1 # 0-indexed para list acceso
        
        mission = next((m for m in MISSION_DEFINITIONS if m["id"] == base_id), None)
        if not mission or level_idx < 0 or level_idx > 2:
            return {"status": "error", "message": "Misión o nivel no encontrado"}
            
        lvl_data = mission["levels"][level_idx]
        
    except ValueError:
        return {"status": "error", "message": "Formato de misión inválido"}

    perfil = database.obtener_perfil_completo(telegram_id)
    if not perfil:
        return {"status": "error", "message": "Usuario no encontrado"}

    stats = {
        "juegos_jugados": perfil.get("juegos_jugados", 0),
        "moches_ganados": perfil.get("moches_ganados", 0),
        "ruletas_ganadas": perfil.get("ruletas_ganadas", 0),
        "jackpots_ganados": perfil.get("jackpots_ganados", 0),
        "wins_total": perfil.get("wins_total", 0),
        "tiempo_jugado": perfil.get("tiempo_jugado", 0),
        "bits_apostados": perfil.get("bits_apostados", 0),
        "bits_ganados": perfil.get("bits_ganados", 0),
        "win_streak": perfil.get("win_streak", 0),
        "tournaments_played": perfil.get("tournaments_played", 0),
        "tournaments_won": perfil.get("tournaments_won", 0),
        "juegos_diferentes": perfil.get("juegos_diferentes", 0),
    }
    current = stats.get(mission["type"], 0)

    if current < lvl_data["target"]:
        return {"status": "error", "message": "Misión no completada todavía"}

    # Check already claimed for THIS specific level
    already = database.is_mission_claimed(telegram_id, formatted_mission_id)
    if already:
        return {"status": "error", "message": "Recompensa de nivel ya reclamada"}

    # Award rewards
    from user_profile_manager import UserProfileManager
    profile_updates = None

    if lvl_data["xp_reward"] > 0:
        profile_updates = UserProfileManager.add_xp(telegram_id, "custom", lvl_data["xp_reward"])

    if lvl_data["bits_reward"] > 0:
        database.recargar_bits(telegram_id, lvl_data["bits_reward"])

    # Mark as claimed using the specific level identifier
    database.claim_mission(telegram_id, formatted_mission_id)

    return {
        "status": "ok",
        "xp_gained": lvl_data["xp_reward"],
        "bits_gained": lvl_data["bits_reward"],
        "profile_updates": profile_updates
    }


def check_newly_completed_missions(telegram_id: str) -> list:
    """
    Returns a list of missions that just became claimable (ready to show a toast).
    Used by game endpoints (/bet, /win, /api/spin) to notify the frontend.
    """
    try:
        missions = get_user_missions_with_progress(telegram_id)
        # Return compact info for each mission that is completed but not yet claimed
        newly_completed = [
            {
                "name": m["name"],
                "icon": m["icon"],
                "level": m["level"],
                "bits_reward": m["bits_reward"],
                "xp_reward": m["xp_reward"]
            }
            for m in missions if m["completed"] and not m["claimed"]
        ]
        return newly_completed
    except Exception:
        return []
