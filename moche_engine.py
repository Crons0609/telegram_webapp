import uuid
import random
import os
from supabase import create_client, Client

# Initialize Supabase client
SUPABASE_URL = "https://xwkfzntmdkfztaeeuxkd.supabase.co"
SUPABASE_KEY = "sb_publishable_14fF1qcKEF2Dj9bnD9U6pw_kbrZSIBe"
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

class RoomManager:
    def __init__(self):
        pass

    def create_room(self, host_id, host_name, is_private, bet_amount, total_slots, difficulty, avatar=None, frame=None):
        room_id = str(uuid.uuid4())[:8] # Short UUID for easy sharing
        
        # Determine room_code (for sharing) could just be the room_id
        room_code = room_id
        
        # 1. Create Room
        room_data = {
            "id": room_id,
            "room_code": room_code,
            "host_id": str(host_id),
            "game_type": "moche",
            "bet_amount": bet_amount,
            "max_players": total_slots,
            "bots_count": 0,
            "difficulty": difficulty,
            "status": "waiting"
        }
        res = supabase.table("rooms").insert(room_data).execute()
        
        # Try to add ready column if it doesnt exist (hacky, but safe in Postgrest via reflection update next insert)
        # We will just maintain 'ready' as a boolean inside room_players

        # 2. Add Host to room_players
        player_data = {
            "room_id": room_id,
            "player_id": str(host_id),
            "player_name": host_name,
            "avatar": avatar,
            "frame": frame,
            "is_host": True
        }
        # In case 'ready' is missing in Postgres, we just assume False for now, or update it if possible.
        # It's better to store waiting room ready state in the game_data JSON to avoid schema issues, or just not enforce "all ready" 
        # But wait, original code used p["ready"]. Let's pass it. If it fails, we ignore it.
        try:
            player_data["ready"] = False
            supabase.table("room_players").insert(player_data).execute()
        except Exception:
            # If "ready" column doesn't exist, insert without it
            del player_data["ready"]
            supabase.table("room_players").insert(player_data).execute()

        return room_id

    def get_room(self, room_id):
        # Fetch Room
        res = supabase.table("rooms").select("*").eq("id", room_id).execute()
        if not res.data: return None
        room_db = res.data[0]
        
        # Fetch Players
        p_res = supabase.table("room_players").select("*").eq("room_id", room_id).execute()
        players = []
        for p in p_res.data:
            players.append({
                "id": p["player_id"],
                "name": p["player_name"],
                "avatar": p.get("avatar"),
                "frame": p.get("frame"),
                "is_host": p.get("is_host", False),
                "ready": p.get("ready", False),
                "connected": True
            })
            
        # Fetch Game State
        gs_res = supabase.table("game_state").select("*").eq("room_id", room_id).execute()
        state = gs_res.data[0]["game_data"] if gs_res.data else None

        # Reconstruct dict compatible with old app.py
        room = {
            "id": room_db["id"],
            "host": room_db["host_id"],
            "host_name": next((p["name"] for p in players if p["is_host"]), "Unknown"),
            "is_private": False, # Doesn't matter much for our implementation now, using short codes anyway
            "bet_amount": room_db["bet_amount"],
            "total_slots": room_db["max_players"],
            "difficulty": room_db.get("difficulty", "easy"),
            "bots_count": room_db.get("bots_count", 0),
            "status": room_db["status"],
            "players": players,
            "state": state
        }
        return room

    def get_public_rooms(self):
        # Fetch waiting rooms
        res = supabase.table("rooms").select("*, room_players(*)").eq("status", "waiting").execute()
        public = []
        for r in res.data:
            current_occupancy = len(r.get("room_players", [])) + r.get("bots_count", 0)
            if current_occupancy < r.get("max_players", 4):
                public.append({
                    "id": r["id"],
                    "host_name": next((p["player_name"] for p in r.get("room_players", []) if p["is_host"]), "Unknown"),
                    "bet_amount": r["bet_amount"],
                    "players": len(r.get("room_players", [])),
                    "bots": r.get("bots_count", 0),
                    "total_slots": r.get("max_players", 4)
                })
        return public

    def join_room(self, room_id, player_id, player_name, avatar=None, frame=None):
        room = self.get_room(room_id)
        if not room: return False, "Sala no encontrada"
        if room["status"] != "waiting": return False, "La partida ya ha comenzado"

        # Check if already
        for p in room["players"]:
            if p["id"] == str(player_id): return True, "Reconectado"

        current_occupancy = len(room["players"]) + room["bots_count"]
        if current_occupancy >= room["total_slots"]: return False, "La sala está llena"

        player_data = {
            "room_id": room_id,
            "player_id": str(player_id),
            "player_name": player_name,
            "avatar": avatar,
            "frame": frame,
            "is_host": False
        }
        try:
            player_data["ready"] = False
            supabase.table("room_players").insert(player_data).execute()
        except:
            del player_data["ready"]
            supabase.table("room_players").insert(player_data).execute()

        return True, "Unido con éxito"

    def leave_room(self, room_id, player_id):
        room = self.get_room(room_id)
        if not room: return False

        if room["host"] == str(player_id) and room["status"] == "waiting":
            supabase.table("rooms").delete().eq("id", room_id).execute()
            return "host_left"

        supabase.table("room_players").delete().eq("room_id", room_id).eq("player_id", str(player_id)).execute()

        room = self.get_room(room_id) # Refresh
        if not room or len(room["players"]) == 0:
            supabase.table("rooms").delete().eq("id", room_id).execute()
            return True

        # Reassign host
        if room["host"] == str(player_id):
            new_host_id = room["players"][0]["id"]
            supabase.table("room_players").update({"is_host": True}).eq("room_id", room_id).eq("player_id", new_host_id).execute()
            supabase.table("rooms").update({"host_id": new_host_id}).eq("id", room_id).execute()

        return True

    def kick_player(self, room_id, host_id, target_id):
        room = self.get_room(room_id)
        if not room: return False, "Sala no encontrada"
        if room["host"] != str(host_id): return False, "Solo el creador puede expulsar jugadores"
        if room["status"] != "waiting": return False, "No se puede expulsar durante la partida"
        if str(target_id) == str(host_id): return False, "No puedes expulsarte a ti mismo"

        res = supabase.table("room_players").delete().eq("room_id", room_id).eq("player_id", str(target_id)).execute()
        if not res.data:
            return False, "Jugador no encontrado en la sala"
        return True, "Jugador expulsado"

    def toggle_ready(self, room_id, player_id):
        room = self.get_room(room_id)
        if not room: return False
        
        # Find player
        target = next((p for p in room["players"] if p["id"] == str(player_id)), None)
        if target:
            new_ready = not target.get("ready", False)
            try:
                supabase.table("room_players").update({"ready": new_ready}).eq("room_id", room_id).eq("player_id", str(player_id)).execute()
            except:
                pass # ignore if schema issue
            return True
        return False

    def get_bot_names(self):
        return ["Karla", "Miguel", "Sofía"]

    def start_game(self, room_id, host_id):
        room = self.get_room(room_id)
        if not room or room["host"] != str(host_id) or room["status"] != "waiting":
            return False, "No puedes iniciar la partida"

        bot_names = self.get_bot_names()
        players_dict = {}
        turn_order = []

        for p in room["players"]:
            key = p["id"]
            players_dict[key] = {
                "id": key,
                "name": p["name"],
                "avatar": p.get("avatar"),
                "frame": p.get("frame"),
                "cards": [],
                "bajadas": [],
                "is_bot": False
            }
            turn_order.append(key)

        real_players_count = len(room["players"])
        max_possible_bots = room["total_slots"] - real_players_count
        difficulty = room.get("difficulty", "easy")
        
        if difficulty == "easy": bots_count = random.randint(1, 2)
        elif difficulty == "medium": bots_count = random.randint(2, 3)
        else: bots_count = 3
            
        bots_count = min(bots_count, max_possible_bots)
        if real_players_count == 1: bots_count = max(1, bots_count)
            
        supabase.table("rooms").update({"bots_count": bots_count, "status": "playing"}).eq("id", room_id).execute()

        for i in range(bots_count):
            key = f"bot{i+1}"
            players_dict[key] = {
                "id": key,
                "name": bot_names[i],
                "avatar": None,
                "frame": None,
                "cards": [],
                "bajadas": [],
                "is_bot": True
            }
            turn_order.append(key)

        deck = self._create_deck()

        state_data = {
            "deck": deck,
            "discardPile": [],
            "players": players_dict,
            "turnOrder": turn_order,
            "currentTurnIndex": 0,
            "phase": "REPARTO",
            "hasDrawn": False,
            "drawnCardRef": None,
            "mustUseDiscard": False,
            "latestDiscardEnlarged": False
        }

        # Deal
        for _ in range(9):
            for pid in state_data["turnOrder"]:
                if len(state_data["deck"]) > 0:
                    state_data["players"][pid]["cards"].append(state_data["deck"].pop())
        state_data["phase"] = "INTERCAMBIO"

        # Insert game_state
        supabase.table("game_state").insert({
            "room_id": room_id,
            "game_data": state_data,
            "current_turn": turn_order[0]
        }).execute()

        return True, ""

    def _create_deck(self):
        suits = ['♠', '♥', '♦', '♣']
        ranks = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']
        values = { 'A': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, '10': 10, 'J': 11, 'Q': 12, 'K': 13 }
        deck = []
        for s in suits:
            for r in ranks:
                deck.append({
                    "suit": s,
                    "rank": r,
                    "value": values[r],
                    "isRed": s in ['♥', '♦']
                })
        random.shuffle(deck)
        return deck

    def update_game_state(self, room_id, new_state_data):
        supabase.table("game_state").update({
            "game_data": new_state_data,
            "current_turn": new_state_data["turnOrder"][new_state_data["currentTurnIndex"]]
        }).eq("room_id", room_id).execute()

    def get_public_state_for_player(self, room_id, requesting_player_id):
        room = self.get_room(room_id)
        if not room or not room.get("state"): return None

        import copy
        state = copy.deepcopy(room["state"])
        
        for pid, pdata in state["players"].items():
            if str(pid) != str(requesting_player_id):
                pdata["cards"] = [{"hidden": True} for c in pdata["cards"]]
        
        return {
            "room_id": room_id,
            "bet_amount": room["bet_amount"],
            "difficulty": room.get("difficulty", "easy"),
            "bots_count": room.get("bots_count", 0),
            "state": state
        }

manager = RoomManager()
