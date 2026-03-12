from flask import Blueprint, render_template, request, session, redirect, url_for, flash
import database
from werkzeug.security import check_password_hash
from functools import wraps

admin_bp = Blueprint('admin', __name__, url_prefix='/admin')

def admin_required(f):
    @wraps(f)
    def decorated_function(*args, **kwargs):
        if 'admin_logged_in' not in session:
            return redirect(url_for('admin.login'))
        return f(*args, **kwargs)
    return decorated_function

@admin_bp.route('/login', methods=['GET', 'POST'])
def login():
    if 'admin_logged_in' in session:
        return redirect(url_for('admin.dashboard'))
        
    if request.method == 'POST':
        username = request.form.get('username')
        password = request.form.get('password')
        
        with database.get_connection() as conn:
            admin_user = conn.execute("SELECT * FROM admins WHERE username = ?", (username,)).fetchone()
            
            if admin_user and check_password_hash(admin_user['password_hash'], password):
                session['admin_logged_in'] = True
                session['admin_username'] = username
                return redirect(url_for('admin.dashboard'))
            else:
                flash('Credenciales incorrectas.', 'error')
                
    return render_template('admin/login.html')

@admin_bp.route('/logout')
def logout():
    session.pop('admin_logged_in', None)
    session.pop('admin_username', None)
    return redirect(url_for('admin.login'))

@admin_bp.route('/')
@admin_required
def dashboard():
    # Obtener KPIs básicos
    with database.get_connection() as conn:
        total_players = conn.execute("SELECT COUNT(*) FROM usuarios").fetchone()[0]
        total_bits = conn.execute("SELECT SUM(bits) FROM usuarios").fetchone()[0] or 0
        total_games = conn.execute("SELECT SUM(juegos_jugados) FROM user_stats").fetchone()[0] or 0
        total_jackpots = conn.execute("SELECT SUM(jackpots_ganados) FROM user_stats").fetchone()[0] or 0
        
    stats = {
        'total_players': total_players,
        'total_bits': total_bits,
        'total_games': total_games,
        'total_jackpots': total_jackpots
    }
    return render_template('admin/dashboard.html', stats=stats)


@admin_bp.route('/players')
@admin_required
def players():
    # Obtener todos los jugadores
    with database.get_connection() as conn:
        players_data = conn.execute("""
            SELECT id, telegram_id, nombre, username, bits, xp, nivel, total_ganados, total_recargas 
            FROM usuarios 
            ORDER BY id DESC
        """).fetchall()
    return render_template('admin/players.html', players=[dict(p) for p in players_data])

@admin_bp.route('/players/edit/<int:player_id>', methods=['POST'])
@admin_required
def edit_player(player_id):
    username = request.form.get('username')
    bits = request.form.get('bits', type=int)
    xp = request.form.get('xp', type=int)
    nivel = request.form.get('nivel', type=int)
    
    with database.get_connection() as conn:
        conn.execute("""
            UPDATE usuarios 
            SET username = ?, bits = ?, xp = ?, nivel = ? 
            WHERE id = ?
        """, (username, bits, xp, nivel, player_id))
        
    flash(f"Jugador #{player_id} actualizado exitosamente.", "success")
    return redirect(url_for('admin.players'))

@admin_bp.route('/players/delete/<int:player_id>', methods=['POST'])
@admin_required
def delete_player(player_id):
    with database.get_connection() as conn:
        # Get telegram_id first to delete cascading records if desired, 
        # or just delete from main tables. For safety we only delete from 'usuarios'.
        # SQLite with proper foreign keys would handle cascade.
        user = conn.execute("SELECT telegram_id FROM usuarios WHERE id = ?", (player_id,)).fetchone()
        if user:
            tid = user['telegram_id']
            conn.execute("DELETE FROM user_stats WHERE telegram_id = ?", (tid,))
            conn.execute("DELETE FROM trophies WHERE telegram_id = ?", (tid,))
            conn.execute("DELETE FROM user_missions WHERE telegram_id = ?", (tid,))
            conn.execute("DELETE FROM usuarios WHERE id = ?", (player_id,))
            
    flash("Jugador eliminado de la base de datos.", "success")
    return redirect(url_for('admin.players'))

@admin_bp.route('/missions')
@admin_required
def missions():
    with database.get_connection() as conn:
        missions_db = conn.execute("SELECT * FROM missions ORDER BY id").fetchall()
        missions = []
        for m in missions_db:
            levels = conn.execute("SELECT * FROM mission_levels WHERE mission_id = ? ORDER BY level", (m['id'],)).fetchall()
            m_dict = dict(m)
            m_dict['levels'] = [dict(l) for l in levels]
            missions.append(m_dict)
            
    return render_template('admin/missions.html', missions=missions)

@admin_bp.route('/missions/edit_level/<int:level_id>', methods=['POST'])
@admin_required
def edit_mission_level(level_id):
    target = request.form.get('target', type=int)
    xp_reward = request.form.get('xp_reward', type=int)
    bits_reward = request.form.get('bits_reward', type=int)
    
    with database.get_connection() as conn:
        conn.execute("""
            UPDATE mission_levels 
            SET target = ?, xp_reward = ?, bits_reward = ? 
            WHERE id = ?
        """, (target, xp_reward, bits_reward, level_id))
        
    flash("Nivel de misión actualizado exitosamente.", "success")
    return redirect(url_for('admin.missions'))

@admin_bp.route('/missions/toggle/<mission_id>', methods=['POST'])
@admin_required
def toggle_mission(mission_id):
    with database.get_connection() as conn:
        current_state = conn.execute("SELECT is_active FROM missions WHERE id = ?", (mission_id,)).fetchone()
        if current_state:
            new_state = 0 if current_state['is_active'] == 1 else 1
            conn.execute("UPDATE missions SET is_active = ? WHERE id = ?", (new_state, mission_id))
            status_text = "activada" if new_state == 1 else "desactivada"
            flash(f"Misión {status_text} exitosamente.", "success")
            
    return redirect(url_for('admin.missions'))
