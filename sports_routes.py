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
    matches_db = database._to_dict(database.get_fb("sports_matches"))
    matches = [dict(m, id=k) for k, m in matches_db.items() if m.get('status') == 'upcoming']
    matches.sort(key=lambda x: x.get('date', ''))
    
    data = []
    for m in matches:
        data.append({
            "id": m.get('id'),
            "team1": m.get('team1'),
            "team2": m.get('team2'),
            "date": m.get('date'),
            "status": m.get('status'),
            "odds": {
                "1": m.get('odd1'),
                "X": m.get('oddx'),
                "2": m.get('odd2')
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

    user = database.get_fb(f"usuarios/{telegram_id}")
    if not user:
        return jsonify({"success": False, "error": "Usuario no encontrado"}), 404

    if user.get('bits', 0) < amount:
        return jsonify({"success": False, "error": "Saldo insuficiente"}), 400

    match = database.get_fb(f"sports_matches/{match_id}")
    if not match or match.get('status') != 'upcoming':
        return jsonify({"success": False, "error": "Partido no disponible"}), 400

    # Determine odd
    odd = match.get('odd1') if team_choice == '1' else match.get('oddx') if team_choice == 'X' else match.get('odd2')
    potential_win = int(amount * odd)
    
    # Deduct balance
    database.descontar_bits(telegram_id, amount)
    
    # Insert bet
    database.post_fb("sports_bets", {
        "telegram_id": str(telegram_id),
        "match_id": match_id,
        "team_choice": team_choice,
        "amount": amount,
        "odd": odd,
        "status": "pending",
        "created_at": datetime.utcnow().isoformat()
    })
    
    # Get new balance
    new_balance = database.obtener_bits(telegram_id)
    
    logger.info(f"Apuesta Deportiva: {telegram_id} -> {amount} bits en partido {match_id}")

    return jsonify({"success": True, "new_balance": new_balance})

@sports_bp.route('/api/bets/<telegram_id>')
def get_bets(telegram_id):
    bets_db = database._to_dict(database.get_fb("sports_bets"))
    matches_db = database._to_dict(database.get_fb("sports_matches"))
    
    user_bets = [dict(b, id=k) for k, b in bets_db.items() if str(b.get('telegram_id')) == str(telegram_id)]
    user_bets.sort(key=lambda x: x.get('created_at', ''), reverse=True)
    
    data = []
    for b in user_bets:
        m = matches_db.get(b.get('match_id', ''), {})
        t1, t2 = m.get('team1', 'Unknown'), m.get('team2', 'Unknown')
        
        pot_win = int(b.get('amount', 0) * b.get('odd', 1))
        data.append({
            "match": f"{t1} vs {t2}",
            "choice": b.get('team_choice'),
            "amount": b.get('amount'),
            "odd": b.get('odd'),
            "potential_win": pot_win,
            "status": b.get('status', 'pending'),
            "date": b.get('created_at')
        })
    return jsonify(data)
