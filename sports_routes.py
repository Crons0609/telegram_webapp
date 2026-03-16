from flask import Blueprint, render_template, request, jsonify, session
import database
from datetime import datetime
import logging

logger = logging.getLogger(__name__)

sports_bp = Blueprint('sports', __name__, url_prefix='/sports')

# =====================================================
# VIEWS
# =====================================================

@sports_bp.route('/')
def index():
    # Intermediate sports landing page (grid of sports)
    return render_template('sports/index.html')

@sports_bp.route('/futbol')
def futbol_view():
    # The actual betting futbol matches catalog
    return render_template('sports/futbol_matches.html')

# =====================================================
# API
# =====================================================

@sports_bp.route('/api/matches')
def get_matches():
    with database.get_connection() as conn:
        matches = conn.execute("SELECT * FROM sports_matches WHERE status='upcoming' ORDER BY date ASC").fetchall()
        
        data = []
        for m in matches:
            data.append({
                "id": m['id'],
                "team1": m['team1'],
                "team2": m['team2'],
                "date": m['date'],
                "status": m['status'],
                "odds": {
                    "1": m['odd1'],
                    "X": m['oddx'],
                    "2": m['odd2']
                }
            })
    return jsonify(data)

@sports_bp.route('/api/bet', methods=['POST'])
def place_bet():
    data = request.json
    telegram_id = data.get('telegram_id')
    match_id = data.get('match_id')
    team_choice = data.get('team_choice')
    amount = data.get('amount')

    if not all([telegram_id, match_id, team_choice, amount]):
        return jsonify({"success": False, "error": "Datos incompletos"}), 400

    try:
        amount = int(amount)
        if amount <= 0:
            raise ValueError
    except:
        return jsonify({"success": False, "error": "Cantidad inválida"}), 400

    with database.get_connection() as conn:
        user = conn.execute("SELECT * FROM usuarios WHERE telegram_id=?", (telegram_id,)).fetchone()
        if not user:
            return jsonify({"success": False, "error": "Usuario no encontrado"}), 404

        if user['bits'] < amount:
            return jsonify({"success": False, "error": "Saldo insuficiente"}), 400

        match = conn.execute("SELECT * FROM sports_matches WHERE id=?", (match_id,)).fetchone()
        if not match or match['status'] != 'upcoming':
            return jsonify({"success": False, "error": "Partido no disponible"}), 400

        # Determine odd
        odd = match['odd1'] if team_choice == '1' else match['oddx'] if team_choice == 'X' else match['odd2']
        potential_win = int(amount * odd)
        
        # Deduct balance
        conn.execute("UPDATE usuarios SET bits = bits - ? WHERE telegram_id=?", (amount, telegram_id))
        
        # Insert bet
        conn.execute("""
            INSERT INTO sports_bets (telegram_id, match_id, team_choice, amount, odd)
            VALUES (?, ?, ?, ?, ?)
        """, (telegram_id, match_id, team_choice, amount, odd))
        
        # Get new balance
        new_balance = user['bits'] - amount
        
    logger.info(f"Apuesta Deportiva: {telegram_id} -> {amount} bits en partido {match_id}")

    return jsonify({"success": True, "new_balance": new_balance})

@sports_bp.route('/api/bets/<telegram_id>')
def get_bets(telegram_id):
    with database.get_connection() as conn:
        bets = conn.execute("""
            SELECT b.*, m.team1, m.team2, (b.amount * b.odd) as potential_win
            FROM sports_bets b
            JOIN sports_matches m ON b.match_id = m.id
            WHERE b.telegram_id=?
            ORDER BY b.created_at DESC
        """, (telegram_id,)).fetchall()
        
        data = []
        for b in bets:
            data.append({
                "match": f"{b['team1']} vs {b['team2']}",
                "choice": b['team_choice'],
                "amount": b['amount'],
                "odd": b['odd'],
                "potential_win": int(b['potential_win']) if b['potential_win'] else 0,
                "status": b['status'],
                "date": b['created_at']
            })
    return jsonify(data)
