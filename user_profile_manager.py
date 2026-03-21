import database
import math

# --- XP CURVE & RANKS ---
XP_REQUIREMENTS = [
    0,       # Lv 1
    100,     # Lv 2
    250,     # Lv 3
    500,     # Lv 4
    800,     # Lv 5
    1200,    # Lv 6
    1800,    # Lv 7
    2500,    # Lv 8
    3500,    # Lv 9
    5000,    # Lv 10
    7000,    # Lv 11
    10000,   # Lv 12
    14000,   # Lv 13
    19000,   # Lv 14
    25000,   # Lv 15
    35000,   # Lv 16
    50000,   # Lv 17
    70000,   # Lv 18
    100000,  # Lv 19
    140000,  # Lv 20
    190000,  # Lv 21
    250000,  # Lv 22
    350000,  # Lv 23
    500000,  # Lv 24
    1000000  # Lv 25 (Emperador)
]

RANK_NAMES = [
    "Explorador del Casino",     # 1-3
    "Estratega",                 # 4-6
    "Apostador Experto",         # 7-9
    "Magnate del Casino",        # 10-12
    "Alto Jugador",              # 13-15
    "Maestro del Azar",          # 16-18
    "Gran Maestro del Casino",   # 19-21
    "Leyenda Viva",              # 22-24
    "Emperador del Casino"       # 25
]

REWARDS = {
    4:  [('frame', 'silver1')],
    7:  [('theme', 'dark_premium')],
    10: [('frame', 'gold1'), ('table', 'gold')],
    13: [('theme', 'gold_imperial')],
    16: [('frame', 'diamond1'), ('table', 'diamond')],
    19: [('theme', 'las_vegas')],
    22: [('frame', 'legendary1')],
    25: [('theme', 'noir'), ('table', 'imperial')]
}

# Maps level ranges to the frame that should automatically be equipped
LEVEL_FRAME_MAP = [
    (1,  'bronze1'),
    (2,  'bronze2'),
    (3,  'bronze3'),
    (4,  'silver1'),
    (6,  'silver2'),
    (8,  'silver3'),
    (10, 'gold1'),
    (12, 'gold2'),
    (14, 'gold3'),
    (16, 'diamond1'),
    (18, 'diamond2'),
    (20, 'diamond3'),
    (22, 'legendary1'),
    (25, 'legendary1'),
]

def get_frame_for_level(level: int) -> str:
    """Returns the frame id that corresponds to a given player level."""
    frame = 'bronze1'
    for min_level, frame_id in LEVEL_FRAME_MAP:
        if level >= min_level:
            frame = frame_id
    return frame

class UserProfileManager:
    @staticmethod
    def calculate_level(xp: int) -> int:
        """Determines user level based on total XP (Max 25)"""
        for i, req in enumerate(XP_REQUIREMENTS):
            if xp < req:
                return i
        return 25
        
    @staticmethod
    def get_rank_info(level: int) -> dict:
        """Translates numerical level into categorical Rank names and badges"""
        if level <= 0: return {"name": "Desconocido", "sub": "", "icon": "❓"}
        if level >= 25: return {"name": RANK_NAMES[8], "sub": "", "icon": "👑"}
        
        # Every 3 levels corresponds to a new major category
        category_idx = (level - 1) // 3
        sub_idx = (level - 1) % 3
        sub_numerals = ["I", "II", "III"]
        
        icons = ["🪨", "🔧", "⚔️", "💰", "🔥", "💎", "🐉", "🌌", "👑"]
        
        return {
            "name": RANK_NAMES[category_idx],
            "sub": sub_numerals[sub_idx],
            "full_name": f"{RANK_NAMES[category_idx]} {sub_numerals[sub_idx]}",
            "icon": icons[category_idx]
        }
        
    @staticmethod
    def get_progress(xp: int) -> dict:
        """Returns XP progress towards the next level"""
        lvl = UserProfileManager.calculate_level(xp)
        if lvl >= 25:
            return {"current_xp": xp, "next_xp": xp, "percent": 100, "level": 25}
        
        base_xp = XP_REQUIREMENTS[lvl - 1] if lvl > 1 else 0
        target_xp = XP_REQUIREMENTS[lvl]
        
        progress = xp - base_xp
        required = target_xp - base_xp
        pct = (progress / required) * 100
        
        return {
            "current_xp": xp,
            "next_xp": target_xp,
            "percent": min(int(pct), 100),
            "level": lvl
        }

    @staticmethod
    def process_level_up(telegram_id: str, old_level: int, new_level: int) -> list:
        """Unlocks rewards for the newly achieved levels and returns notifications"""
        notifications = []
        for l in range(old_level + 1, new_level + 1):
            if l in REWARDS:
                for r_type, r_id in REWARDS[l]:
                    database.desbloquear_item(telegram_id, r_type, r_id)
                    notifications.append(f"¡Desbloqueaste {r_type.upper()}: {r_id}!")

        # Auto-equip the frame matching the new level
        new_frame = get_frame_for_level(new_level)
        # Always unlock the auto-frame in inventory
        database.desbloquear_item(telegram_id, 'frame', new_frame)
        # Equip it directly (bypass ownership check via direct DB update)
        database.actualizar_perfil(telegram_id, {'avatar_frame': new_frame, 'marco_actual': new_frame})
        notifications.append(f"¡Nuevo marco desbloqueado: {new_frame}!")

        return notifications

    @staticmethod
    def sync_rewards_for_level(telegram_id: str, current_level: int):
        """
        Idempotently ensures all level rewards up to current_level are unlocked.
        Safe to call on every profile load — INSERT OR IGNORE prevents duplicates.
        """
        for lvl in range(1, current_level + 1):
            if lvl in REWARDS:
                for r_type, r_id in REWARDS[lvl]:
                    database.desbloquear_item(telegram_id, r_type, r_id)
        # Also ensure the correct frame for the level is unlocked
        correct_frame = get_frame_for_level(current_level)
        database.desbloquear_item(telegram_id, 'frame', correct_frame)

    @staticmethod
    def add_xp(telegram_id: str, event_type: str, custom_amount: int = 0) -> dict:
        """Awards XP and handles level ups/unlocks. Returns context for the client."""
        xp_map = {
            "slot_spin": 2,
            "slot_win_small": 10,
            "slot_win_medium": 25,
            "slot_win_large": 80,
            "slot_jackpot": 250,
            
            "moche_play": 10,
            "moche_win": 60,
            "moche_win_double": 120,
            "moche_high_bet": 25,
            
            "roulette_spin": 5,
            "roulette_win": 20,
            "roulette_win_large": 70,
            
            "first_win_day": 50,
            "custom": custom_amount
        }
        
        gained = xp_map.get(event_type, 0)
        if gained <= 0: return None
        
        # Obtener perfil para ver estado anterior
        perfil = database.obtener_perfil_completo(telegram_id)
        if not perfil:
            return None
            
        old_level = perfil.get('nivel', 1)
        
        # Add XP to Database
        new_xp = database.agregar_xp(telegram_id, gained)
        new_level = UserProfileManager.calculate_level(new_xp)
        
        leveled_up = False
        unlocks = []
        
        if new_level > old_level:
            database.actualizar_nivel(telegram_id, new_level)
            leveled_up = True
            unlocks = UserProfileManager.process_level_up(telegram_id, old_level, new_level)
            
        return {
            "gained_xp": gained,
            "total_xp": new_xp,
            "leveled_up": leveled_up,
            "new_level": new_level,
            "unlocks": unlocks,
            "rank_info": UserProfileManager.get_rank_info(new_level)
        }
