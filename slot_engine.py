import random

class SlotEngine:
    def __init__(self):
        # Symbols configuration (sync with JS)
        self.symbols = ["diamond", "red7", "bar", "crown", "chip", "bell"]
        
        # RTP 94.0% in a 10,000 spins deck
        self.deck_size = 10000
        self.deck = []
        self._initialize_deck()

    def _initialize_deck(self):
        """Creates the absolute mathematical deck of 10,000 possibilities."""
        self.deck = []
        
        # --- WINNING COMBINATIONS (23.07% Hit Frequency) ---
        # 1x Mega Jackpot (1000x): 5 Diamonds
        self.deck.extend([{"type": "win", "multiplier": 1000, "pattern": "5_diamond"} for _ in range(1)])
        # 2x Epic (250x): 5 Bars
        self.deck.extend([{"type": "win", "multiplier": 250, "pattern": "5_bar"} for _ in range(2)])
        # 4x Super (150x): 5 Crowns
        self.deck.extend([{"type": "win", "multiplier": 150, "pattern": "5_crown"} for _ in range(4)])
        # 10x Big Win (50x): 4 Red7s
        self.deck.extend([{"type": "win", "multiplier": 50, "pattern": "4_red7"} for _ in range(10)])
        # 30x Win (25x): 3 Bars
        self.deck.extend([{"type": "win", "multiplier": 25, "pattern": "3_bar"} for _ in range(30)])
        # 60x Small (15x): 4 Chips
        self.deck.extend([{"type": "win", "multiplier": 15, "pattern": "4_chip"} for _ in range(60)])
        # 250x Mini (5x): 3 Chips
        self.deck.extend([{"type": "win", "multiplier": 5, "pattern": "3_chip"} for _ in range(250)])
        # 1950x Micro (2x): 3 Bells
        self.deck.extend([{"type": "win", "multiplier": 2, "pattern": "3_bell"}  for _ in range(1950)])

        # --- LOSING COMBINATIONS (76.93%) ---
        losses_count = self.deck_size - len(self.deck)
        self.deck.extend([{"type": "lose", "multiplier": 0, "pattern": "random_loss"} for _ in range(losses_count)])
        
        # Shuffle perfectly
        random.shuffle(self.deck)

    def draw_spin(self):
        """Pulls a single outcome from the deck. Re-shuffles if empty."""
        if not self.deck:
            self._initialize_deck()
            
        return self.deck.pop()

    def generate_reels(self, outcome):
        """Transforms a deck outcome into a 5-symbol array for the frontend."""
        pattern = outcome["pattern"]
        reels = []
        
        if outcome["type"] == "win":
            count = int(pattern[0])
            symbol = pattern[2:]
            
            # Left to right consecutive winning symbols
            for i in range(5):
                if i < count:
                    reels.append({"id": symbol})
                else:
                    # Filler that breaks the streak
                    filler = random.choice(self.symbols)
                    while filler == symbol:
                        filler = random.choice(self.symbols)
                    reels.append({"id": filler})
            return reels
            
        else:
            # Type: Lose
            # We want to mathematically ensure the first 3 symbols DO NOT match
            # But we ALSO want to create "near misses" (e.g. 2 matches then break)
            is_near_miss = random.random() < 0.15 # 15% chance of a teasing loss
            
            if is_near_miss:
                tease_symbol = random.choice(["diamond", "red7", "crown"])
                reels.append({"id": tease_symbol})
                reels.append({"id": tease_symbol})
                # Break the 3rd to prevent a win
                breaker = random.choice(self.symbols)
                while breaker == tease_symbol:
                    breaker = random.choice(self.symbols)
                reels.append({"id": breaker})
                
                # Random remaining
                for _ in range(2):
                    reels.append({"id": random.choice(self.symbols)})
            else:
                # Completely scattered loss (no 3 matches from left)
                for i in range(5):
                    reels.append({"id": random.choice(self.symbols)})
                    
                # Force brute fix if first 3 ended up matching by pure RNG
                if reels[0]["id"] == reels[1]["id"] and reels[1]["id"] == reels[2]["id"]:
                    breaker = random.choice(self.symbols)
                    while breaker == reels[1]["id"]:
                        breaker = random.choice(self.symbols)
                    reels[2]["id"] = breaker

            return reels

# Singleton instance
slot_engine = SlotEngine()
