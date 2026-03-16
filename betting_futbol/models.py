# =====================================================
# ZONA JACKPOT 777 - DATABASE MODELS
# =====================================================

from flask_sqlalchemy import SQLAlchemy
from datetime import datetime

db = SQLAlchemy()

# =====================================================
# USER
# =====================================================

class User(db.Model):
    __tablename__ = "users"

    id = db.Column(db.Integer, primary_key=True)

    username = db.Column(db.String(80), unique=True, nullable=False, index=True)

    chat_id = db.Column(db.String(50), unique=True, nullable=False)

    bits = db.Column(db.Integer, default=0)

    total_bets = db.Column(db.Integer, default=0)

    total_wins = db.Column(db.Integer, default=0)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    # relaciones
    bets = db.relationship("Bet", back_populates="user", cascade="all, delete")

    def __repr__(self):
        return f"<User {self.username}>"

# =====================================================
# LEAGUE
# =====================================================

class League(db.Model):
    __tablename__ = "leagues"

    id = db.Column(db.Integer, primary_key=True)

    name = db.Column(db.String(100), nullable=False)

    country = db.Column(db.String(100))

    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    matches = db.relationship("Match", back_populates="league")

# =====================================================
# MATCH
# =====================================================

class Match(db.Model):
    __tablename__ = "matches"

    id = db.Column(db.Integer, primary_key=True)

    team1 = db.Column(db.String(100), nullable=False)

    team2 = db.Column(db.String(100), nullable=False)

    date = db.Column(db.DateTime, nullable=False, index=True)

    league_id = db.Column(db.Integer, db.ForeignKey("leagues.id"))

    status = db.Column(
        db.String(20),
        default="upcoming"
    )
    # upcoming
    # live
    # finished
    # cancelled

    result = db.Column(db.String(10))

    # ODDS
    odd1 = db.Column(db.Float, default=2.0)
    oddx = db.Column(db.Float, default=3.0)
    odd2 = db.Column(db.Float, default=2.0)

    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    # relaciones
    bets = db.relationship("Bet", back_populates="match")

    league = db.relationship("League", back_populates="matches")

    def __repr__(self):
        return f"<Match {self.team1} vs {self.team2}>"

# =====================================================
# BET
# =====================================================

class Bet(db.Model):
    __tablename__ = "bets"

    id = db.Column(db.Integer, primary_key=True)

    user_id = db.Column(db.Integer, db.ForeignKey("users.id"), nullable=False)

    match_id = db.Column(db.Integer, db.ForeignKey("matches.id"), nullable=False)

    team_choice = db.Column(
        db.String(10),
        nullable=False
    )
    # "1"
    # "X"
    # "2"

    amount = db.Column(db.Integer, nullable=False)

    odd = db.Column(db.Float)

    potential_win = db.Column(db.Integer)

    status = db.Column(
        db.String(20),
        default="pending"
    )
    # pending
    # won
    # lost
    # cancelled

    created_at = db.Column(db.DateTime, default=datetime.utcnow, index=True)

    # relaciones
    user = db.relationship("User", back_populates="bets")

    match = db.relationship("Match", back_populates="bets")

    def __repr__(self):
        return f"<Bet {self.id} user={self.user_id}>"