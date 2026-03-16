# =====================================================
# ZONA JACKPOT 777 - SPORTSBOOK BACKEND
# =====================================================

from flask import Flask, render_template, request, jsonify
from models import db, User, Match, Bet
from config import Config
from telegram_bot import notify_user_bet_result

from datetime import datetime
import logging

# =====================================================
# CONFIG
# =====================================================

app = Flask(__name__)
app.config.from_object(Config)

db.init_app(app)

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)

logger = logging.getLogger(__name__)

# Crear tablas
with app.app_context():
    db.create_all()


# =====================================================
# HELPERS
# =====================================================

def calculate_payout(amount, odd):
    """Calcula ganancia"""
    return int(amount * odd)


def get_or_create_user(username, chat_id):

    user = User.query.filter_by(username=username).first()

    if not user:
        user = User(username=username, chat_id=chat_id, bits=0)
        db.session.add(user)
        db.session.commit()
        logger.info(f"Nuevo usuario creado: {username}")

    else:
        if user.chat_id != chat_id:
            user.chat_id = chat_id
            db.session.commit()

    return user


# =====================================================
# ROUTES
# =====================================================

@app.route('/')
def index():
    return render_template("index.html")


# =====================================================
# API MATCHES
# =====================================================

@app.route('/api/matches')
def get_matches():

    matches = Match.query.filter_by(status="upcoming").order_by(Match.date).all()

    data = []

    for m in matches:

        data.append({
            "id": m.id,
            "team1": m.team1,
            "team2": m.team2,
            "date": m.date.isoformat(),
            "status": m.status,
            "odds": {
                "1": getattr(m,"odd1",2.0),
                "X": getattr(m,"oddx",3.0),
                "2": getattr(m,"odd2",2.0)
            }
        })

    return jsonify(data)


# =====================================================
# PLACE BET
# =====================================================

@app.route('/api/bet', methods=["POST"])
def place_bet():

    data = request.json

    username = data.get("username")
    chat_id = data.get("chat_id")
    match_id = data.get("match_id")
    team_choice = data.get("team_choice")
    amount = data.get("amount")

    if not all([username, chat_id, match_id, team_choice, amount]):
        return jsonify({"error": "Datos incompletos"}), 400

    try:
        amount = int(amount)
    except:
        return jsonify({"error": "Cantidad inválida"}), 400

    if amount <= 0:
        return jsonify({"error": "Cantidad inválida"}), 400

    user = get_or_create_user(username, chat_id)

    if user.bits < amount:
        return jsonify({"error": "Saldo insuficiente"}), 400

    match = Match.query.get(match_id)

    if not match or match.status != "upcoming":
        return jsonify({"error": "Partido no disponible"}), 400

    # Registrar apuesta
    bet = Bet(
        user_id=user.id,
        match_id=match_id,
        team_choice=team_choice,
        amount=amount
    )

    user.bits -= amount

    db.session.add(bet)
    db.session.commit()

    logger.info(f"Apuesta: {username} -> {amount} bits")

    return jsonify({
        "success": True,
        "new_balance": user.bits
    })


# =====================================================
# BALANCE
# =====================================================

@app.route('/api/balance/<username>')
def get_balance(username):

    user = User.query.filter_by(username=username).first()

    if not user:
        return jsonify({"balance": 0})

    return jsonify({"balance": user.bits})


# =====================================================
# BET HISTORY
# =====================================================

@app.route('/api/bets/<username>')
def get_bets(username):

    user = User.query.filter_by(username=username).first()

    if not user:
        return jsonify([])

    bets = Bet.query.filter_by(user_id=user.id).all()

    data = []

    for b in bets:

        data.append({
            "match": f"{b.match.team1} vs {b.match.team2}",
            "choice": b.team_choice,
            "amount": b.amount,
            "status": b.status,
            "date": b.created_at.isoformat()
        })

    return jsonify(data)


# =====================================================
# ADMIN CREATE MATCH
# =====================================================

@app.route("/admin/create_match", methods=["POST"])
def create_match():

    data = request.json

    team1 = data.get("team1")
    team2 = data.get("team2")
    date = data.get("date")

    if not all([team1, team2, date]):
        return jsonify({"error":"datos incompletos"}),400

    match = Match(
        team1=team1,
        team2=team2,
        date=datetime.fromisoformat(date)
    )

    db.session.add(match)
    db.session.commit()

    return jsonify({"success":True})


# =====================================================
# ADMIN RESULT
# =====================================================

@app.route("/admin/result", methods=["POST"])
def set_result():

    data = request.json

    match_id = data.get("match_id")
    result = data.get("result")

    match = Match.query.get(match_id)

    if not match:
        return jsonify({"error":"match no encontrado"}),404

    match.status = "finished"
    match.result = result

    db.session.commit()

    bets = Bet.query.filter_by(match_id=match_id, status="pending").all()

    processed = 0

    for bet in bets:

        won = bet.team_choice == result

        if won:

            payout = bet.amount * 2

            bet.user.bits += payout

            bet.status = "won"

        else:

            bet.status = "lost"

        notify_user_bet_result(bet.user, match, won)

        processed += 1

    db.session.commit()

    logger.info(f"Resultado procesado match {match_id}")

    return jsonify({
        "success":True,
        "processed":processed
    })


# =====================================================
# ADMIN ADD BALANCE
# =====================================================

@app.route("/admin/add_balance", methods=["POST"])
def add_balance():

    data = request.json

    username = data.get("username")
    amount = data.get("amount")

    user = User.query.filter_by(username=username).first()

    if not user:
        return jsonify({"error":"usuario no encontrado"}),404

    user.bits += int(amount)

    db.session.commit()

    return jsonify({
        "success":True,
        "balance":user.bits
    })


# =====================================================
# START
# =====================================================

if __name__ == "__main__":
    app.run(
        debug=True,
        host="0.0.0.0",
        port=5000
    )