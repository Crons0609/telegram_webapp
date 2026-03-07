import uuid
import random

class RoomManager:
    def __init__(self):
        # dict mapping room_id to room data
        self.rooms = {}
    
    def create_room(self, host_id, host_name, is_private, bet_amount, total_slots, difficulty, avatar=None, frame=None):
        room_id = str(uuid.uuid4())[:8] # Short UUID for easy sharing
        
        room = {
            "id": room_id,
            "host": host_id,
            "host_name": host_name,
            "is_private": is_private,
            "bet_amount": bet_amount,
            "total_slots": total_slots, # Typical 4
            "difficulty": difficulty,
            "bots_count": 0, # Will be set on start_game based on remaining slots
            "status": "waiting", # waiting, playing, finished
            "players": [
                {"id": host_id, "name": host_name, "avatar": avatar, "frame": frame, "is_host": True, "ready": False, "connected": True}
            ],
            "state": None # Will hold the actual moche game state once started
        }
        self.rooms[room_id] = room
        return room_id

    def get_room(self, room_id):
        return self.rooms.get(room_id)

    def get_public_rooms(self):
        public = []
        for r_id, r in self.rooms.items():
            if not r["is_private"] and r["status"] == "waiting":
                # Only return rooms that aren't full (real players + bots < total_slots)
                current_occupancy = len(r["players"]) + r["bots_count"]
                if current_occupancy < r["total_slots"]:
                    public.append({
                        "id": r["id"],
                        "host_name": r["host_name"],
                        "bet_amount": r["bet_amount"],
                        "players": len(r["players"]),
                        "bots": r["bots_count"],
                        "total_slots": r["total_slots"]
                    })
        return public

    def join_room(self, room_id, player_id, player_name, avatar=None, frame=None):
        room = self.get_room(room_id)
        if not room:
            return False, "Sala no encontrada"
            
        if room["status"] != "waiting":
            return False, "La partida ya ha comenzado"

        # Check if player is already in room
        for p in room["players"]:
            if p["id"] == player_id:
                p["connected"] = True
                p["avatar"] = avatar
                p["frame"] = frame
                return True, "Reconectado"

        current_occupancy = len(room["players"]) + room["bots_count"]
        if current_occupancy >= room["total_slots"]:
            return False, "La sala está llena"

        room["players"].append({
            "id": player_id,
            "name": player_name,
            "avatar": avatar,
            "frame": frame,
            "is_host": False,
            "ready": False,
            "connected": True
        })
        return True, "Unido con éxito"

    def leave_room(self, room_id, player_id):
        room = self.get_room(room_id)
        if not room: return False

        # If host leaves and game hasn't started, close room completely
        if room["host"] == player_id and room["status"] == "waiting":
            del self.rooms[room_id]
            return "host_left" # Special return value to signal room closure

        # Remove player
        room["players"] = [p for p in room["players"] if p["id"] != player_id]

        if len(room["players"]) == 0:
            # Delete room if empty
            del self.rooms[room_id]
            return True

        # If host left (e.g. during play), reassign host to first remaining human
        if room["host"] == player_id:
            new_host = room["players"][0]
            room["host"] = new_host["id"]
            room["host_name"] = new_host["name"]
            new_host["is_host"] = True

        return True

    def kick_player(self, room_id, host_id, target_id):
        room = self.get_room(room_id)
        if not room:
            return False, "Sala no encontrada"
        if room["host"] != host_id:
            return False, "Solo el creador puede expulsar jugadores"
        if room["status"] != "waiting":
            return False, "No se puede expulsar durante la partida"
        if target_id == host_id:
            return False, "No puedes expulsarte a ti mismo"

        initial_count = len(room["players"])
        room["players"] = [p for p in room["players"] if p["id"] != target_id]
        
        if len(room["players"]) == initial_count:
            return False, "Jugador no encontrado en la sala"
            
        return True, "Jugador expulsado"

    def toggle_ready(self, room_id, player_id):
        room = self.get_room(room_id)
        if not room: return False
        for p in room["players"]:
            if p["id"] == player_id:
                p["ready"] = not p["ready"]
                return True
        return False

    def get_bot_names(self):
        return ["Karla", "Miguel", "Sofía"]

    def start_game(self, room_id, host_id):
        room = self.get_room(room_id)
        if not room or room["host"] != host_id or room["status"] != "waiting":
            return False, "No puedes iniciar la partida"

        # Initialize the game STATE structure
        bot_names = self.get_bot_names()
        players_dict = {}
        turn_order = []

        # 1. Add real players
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

        # 2. Determine random bots count based on remaining slots
        real_players_count = len(room["players"])
        max_possible_bots = room["total_slots"] - real_players_count
        
        # Randomize bots (between 1 and max_possible_bots, limit to 3)
        # However, difficulty should play a role: higher difficulty = more bots
        # But user rule: minimum total players 2, max 4. Random bots 1 to 3.
        # So we ensure there is at least 1 bot if alone, and at most the empty seats.
        # The frontend logic for random bots has rules per difficulty. We apply it here.
        difficulty = room.get("difficulty", "easy")
        
        if difficulty == "easy":
            bots_count = random.randint(1, 2)
        elif difficulty == "medium":
            bots_count = random.randint(2, 3)
        else: # hard, pro
            bots_count = 3
            
        # Ensure we don't exceed empty seats
        bots_count = min(bots_count, max_possible_bots)
        # Ensure we have at least 1 bot if there's only 1 real player
        if real_players_count == 1:
            bots_count = max(1, bots_count)
            
        # Update room info
        room["bots_count"] = bots_count

        # 3. Add bots
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

        # 3. Create and shuffle deck
        deck = self._create_deck()

        room["status"] = "playing"
        room["state"] = {
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

        self._deal_initial_cards(room)
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

    def _deal_initial_cards(self, room):
        # Deal up to 9 cards per player
        state = room["state"]
        for _ in range(9):
            for pid in state["turnOrder"]:
                if len(state["deck"]) > 0:
                    state["players"][pid]["cards"].append(state["deck"].pop())
        
        # In a real sync engine, we would jump to REPARTO internally and send state arrays.
        # But this is instantaneous on the server. The next phase is INTERCAMBIO.
        state["phase"] = "INTERCAMBIO"

    def get_public_state_for_player(self, room_id, requesting_player_id):
        room = self.get_room(room_id)
        if not room or not room["state"]: return None

        import copy
        state = copy.deepcopy(room["state"])
        
        # Hide opponent card values
        for pid, pdata in state["players"].items():
            if pid != requesting_player_id:
                # Replace card objects with placeholders that only indicate length
                pdata["cards"] = [{"hidden": True} for c in pdata["cards"]]
        
        return {
            "room_id": room_id,
            "bet_amount": room["bet_amount"],
            "difficulty": room.get("difficulty", "easy"),
            "bots_count": room.get("bots_count", 0),
            "state": state
        }

# Global instance
manager = RoomManager()
