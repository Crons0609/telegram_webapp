import sqlite3
from contextlib import contextmanager
from typing import Optional

DB_NAME = "casino.db"


@contextmanager
def get_connection():
    """
    Context manager para conexiones SQLite seguras.
    Garantiza commit / rollback y cierre correcto.
    """
    conn = sqlite3.connect(DB_NAME)
    conn.row_factory = sqlite3.Row
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    """
    Inicializa la base de datos y crea las tablas necesarias.
    """
    with get_connection() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS usuarios (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                telegram_id TEXT NOT NULL UNIQUE,
                nombre TEXT NOT NULL,
                bits INTEGER NOT NULL DEFAULT 0 CHECK (bits >= 0)
            )
        """)
        try:
            conn.execute("ALTER TABLE usuarios ADD COLUMN username TEXT")
        except sqlite3.OperationalError:
            pass  # La columna ya existe
        try:
            conn.execute("ALTER TABLE usuarios ADD COLUMN total_recargas INTEGER DEFAULT 0")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE usuarios ADD COLUMN total_ganados INTEGER DEFAULT 0")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE usuarios ADD COLUMN photo_url TEXT")
        except sqlite3.OperationalError:
            pass
            
        # Nivel y XP
        try:
            conn.execute("ALTER TABLE usuarios ADD COLUMN xp INTEGER DEFAULT 0")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE usuarios ADD COLUMN nivel INTEGER DEFAULT 1")
        except sqlite3.OperationalError:
            pass
            
        # Opciones de personalización activas
        try:
            conn.execute("ALTER TABLE usuarios ADD COLUMN marco_actual TEXT DEFAULT 'none'")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE usuarios ADD COLUMN avatar_frame TEXT DEFAULT 'none'")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE usuarios ADD COLUMN tema_actual TEXT DEFAULT 'default'")
        except sqlite3.OperationalError:
            pass

        # Recompensas diarias
        try:
            conn.execute("ALTER TABLE usuarios ADD COLUMN last_daily_reward TEXT DEFAULT NULL")
        except sqlite3.OperationalError:
            pass
        try:
            conn.execute("ALTER TABLE usuarios ADD COLUMN daily_streak INTEGER DEFAULT 0")
        except sqlite3.OperationalError:
            pass

        # Tabla de Estadísticas Extendidas
        conn.execute("""
            CREATE TABLE IF NOT EXISTS user_stats (
                telegram_id TEXT PRIMARY KEY,
                juegos_jugados INTEGER DEFAULT 0,
                jackpots_ganados INTEGER DEFAULT 0,
                moches_ganados INTEGER DEFAULT 0,
                ruletas_ganadas INTEGER DEFAULT 0,
                wins_total INTEGER DEFAULT 0,
                tiempo_jugado INTEGER DEFAULT 0,
                bits_apostados INTEGER DEFAULT 0,
                bits_ganados INTEGER DEFAULT 0,
                win_streak INTEGER DEFAULT 0,
                tournaments_played INTEGER DEFAULT 0,
                tournaments_won INTEGER DEFAULT 0,
                juegos_diferentes INTEGER DEFAULT 0,
                FOREIGN KEY(telegram_id) REFERENCES usuarios(telegram_id)
            )
        """)
        # Migraciones (Asegurar que existan en BDs antiguas)
        nuevas_columnas = [
            ("wins_total", "INTEGER DEFAULT 0"),
            ("tiempo_jugado", "INTEGER DEFAULT 0"),
            ("bits_apostados", "INTEGER DEFAULT 0"),
            ("bits_ganados", "INTEGER DEFAULT 0"),
            ("win_streak", "INTEGER DEFAULT 0"),
            ("tournaments_played", "INTEGER DEFAULT 0"),
            ("tournaments_won", "INTEGER DEFAULT 0"),
            ("juegos_diferentes", "INTEGER DEFAULT 0")
        ]
        
        for col, tipo in nuevas_columnas:
            try:
                conn.execute(f"ALTER TABLE user_stats ADD COLUMN {col} {tipo}")
            except sqlite3.OperationalError:
                pass
                
        # Tabla de Inventario/Desbloqueables
        conn.execute("""
            CREATE TABLE IF NOT EXISTS unlocked_items (
                telegram_id TEXT,
                item_type TEXT, -- 'frame', 'theme', 'table', 'emoji'
                item_id TEXT,
                PRIMARY KEY (telegram_id, item_type, item_id),
                FOREIGN KEY(telegram_id) REFERENCES usuarios(telegram_id)
            )
        """)

        # Tabla de Trofeos
        conn.execute("""
            CREATE TABLE IF NOT EXISTS trophies (
                telegram_id TEXT,
                trophy_id TEXT,
                unlocked_at TEXT NOT NULL DEFAULT (datetime('now')),
                PRIMARY KEY (telegram_id, trophy_id),
                FOREIGN KEY(telegram_id) REFERENCES usuarios(telegram_id)
            )
        """)

        # Tabla de Misiones (Definiciones editables por el admin)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS missions (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                desc TEXT NOT NULL,
                icon TEXT NOT NULL,
                type TEXT NOT NULL,
                is_active INTEGER DEFAULT 1
            )
        """)
        
        conn.execute("""
            CREATE TABLE IF NOT EXISTS mission_levels (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                mission_id TEXT,
                level INTEGER,
                target INTEGER,
                xp_reward INTEGER,
                bits_reward INTEGER,
                FOREIGN KEY(mission_id) REFERENCES missions(id)
            )
        """)
        
        # Seed Misiones if empty
        m_count = conn.execute("SELECT COUNT(*) FROM missions").fetchone()[0]
        if m_count == 0:
            try:
                from mission_data import MISSIONS
                for m in MISSIONS:
                    conn.execute("INSERT INTO missions (id, name, desc, icon, type) VALUES (?, ?, ?, ?, ?)", 
                                 (m['id'], m['name'], m['desc'], m['icon'], m['type']))
                    for lvl in m['levels']:
                        conn.execute("INSERT INTO mission_levels (mission_id, level, target, xp_reward, bits_reward) VALUES (?, ?, ?, ?, ?)",
                                     (m['id'], lvl['level'], lvl['target'], lvl['xp_reward'], lvl['bits_reward']))
            except Exception as e:
                print(f"Error seeding missions: {e}")

        # Tabla de Misiones Reclamadas
        conn.execute("""
            CREATE TABLE IF NOT EXISTS user_missions (
                telegram_id TEXT,
                mission_id TEXT,
                claimed INTEGER DEFAULT 0,
                claimed_at TEXT,
                PRIMARY KEY (telegram_id, mission_id),
                FOREIGN KEY(telegram_id) REFERENCES usuarios(telegram_id)
            )
        """)

        # Tabla de Administradores
        conn.execute("""
            CREATE TABLE IF NOT EXISTS admins (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)
        
        # Crear usuario admin por defecto si no existe ninguno
        admin_count = conn.execute("SELECT COUNT(*) FROM admins").fetchone()[0]
        if admin_count == 0:
            from werkzeug.security import generate_password_hash
            default_hash = generate_password_hash("admin123")
            conn.execute("INSERT INTO admins (username, password_hash) VALUES (?, ?)", ("admin", default_hash))

def _asegurar_stats(telegram_id: str, conn):
    """Crea una fila de stats en 0 si no existe."""
    conn.execute("INSERT OR IGNORE INTO user_stats (telegram_id) VALUES (?)", (telegram_id,))

def agregar_usuario(telegram_id: str, nombre: str, username: Optional[str] = None, photo_url: Optional[str] = None) -> bool:
    """
    Agrega un usuario si no existe, o actualiza su nombre y username si ya existe.
    Retorna True si fue modificado.
    """
    if not telegram_id or not nombre:
        raise ValueError("telegram_id y nombre son obligatorios")

    with get_connection() as conn:
        cursor = conn.execute("""
            INSERT INTO usuarios (telegram_id, nombre, username, photo_url)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(telegram_id) DO UPDATE SET 
                nombre = excluded.nombre,
                username = excluded.username,
                photo_url = excluded.photo_url
        """, (telegram_id, nombre, username, photo_url))
        
        _asegurar_stats(telegram_id, conn)

        return cursor.rowcount > 0

def obtener_perfil_completo(telegram_id: str) -> dict:
    """Obtiene perfil, XP, rango actual y stats de un usuario."""
    with get_connection() as conn:
        row = conn.execute("""
            SELECT u.telegram_id, u.nombre, u.username, u.photo_url, u.bits,
                   u.xp, u.nivel, u.marco_actual, u.avatar_frame, u.tema_actual,
                   u.total_ganados, u.total_recargas, u.last_daily_reward, u.daily_streak,
                   s.juegos_jugados, s.jackpots_ganados, s.moches_ganados, s.ruletas_ganadas,
                   COALESCE(s.wins_total, 0) as wins_total,
                   COALESCE(s.tiempo_jugado, 0) as tiempo_jugado,
                   COALESCE(s.bits_apostados, 0) as bits_apostados,
                   COALESCE(s.bits_ganados, 0) as bits_ganados,
                   COALESCE(s.win_streak, 0) as win_streak,
                   COALESCE(s.tournaments_played, 0) as tournaments_played,
                   COALESCE(s.tournaments_won, 0) as tournaments_won,
                   COALESCE(s.juegos_diferentes, 0) as juegos_diferentes
            FROM usuarios u
            LEFT JOIN user_stats s ON u.telegram_id = s.telegram_id
            WHERE u.telegram_id = ?
        """, (telegram_id,)).fetchone()
        
        if not row:
            return None
            
        perfil = dict(row)
        
        # Obtener desbloqueables
        unlocked = conn.execute("SELECT item_type, item_id FROM unlocked_items WHERE telegram_id = ?", (telegram_id,)).fetchall()
        perfil['unlocked_items'] = [{'type': u['item_type'], 'id': u['item_id']} for u in unlocked]
        return perfil

def obtener_bits(telegram_id: str) -> int:
    """
    Obtiene la cantidad de bits de un usuario.
    """
    if not telegram_id:
        raise ValueError("telegram_id es obligatorio")

    with get_connection() as conn:
        row = conn.execute("""
            SELECT bits
            FROM usuarios
            WHERE telegram_id = ?
        """, (telegram_id,)).fetchone()

        return row["bits"] if row else 0


def obtener_todos_usuarios() -> list:
    """
    Obtiene la lista completa de usuarios registrados.
    Retorna una lista de diccionarios con la información de cada usuario.
    """
    with get_connection() as conn:
        rows = conn.execute("""
            SELECT id, telegram_id, nombre, username, photo_url, bits, total_recargas, total_ganados, xp, nivel, marco_actual, avatar_frame
            FROM usuarios
            ORDER BY bits DESC, id ASC
        """).fetchall()
        
        # Convert Row objects to dicts for easier templating
        return [dict(row) for row in rows]


def obtener_top_recargas() -> list:
    """
    Obtiene los 10 usuarios que más bits han recargado (vía admin).
    """
    with get_connection() as conn:
        rows = conn.execute("""
            SELECT telegram_id, nombre, username, photo_url, total_recargas
            FROM usuarios
            WHERE total_recargas > 0
            ORDER BY total_recargas DESC
            LIMIT 10
        """).fetchall()
        return [dict(row) for row in rows]


def obtener_top_ganadores() -> list:
    """
    Obtiene los 10 usuarios que más bits han ganado en juegos.
    """
    with get_connection() as conn:
        rows = conn.execute("""
            SELECT telegram_id, nombre, username, photo_url, total_ganados
            FROM usuarios
            WHERE total_ganados > 0
            ORDER BY total_ganados DESC
            LIMIT 10
        """).fetchall()
        return [dict(row) for row in rows]


def recargar_bits(telegram_id: str, cantidad: int) -> bool:
    """
    Recarga bits a un usuario existente.
    Retorna True si se realizó la recarga.
    """
    if not telegram_id or cantidad <= 0:
        return False

    with get_connection() as conn:
        cursor = conn.execute("""
            UPDATE usuarios
            SET bits = bits + ?,
                total_recargas = total_recargas + ?
            WHERE telegram_id = ?
        """, (cantidad, cantidad, telegram_id))

        return cursor.rowcount > 0


def registrar_ganancia(telegram_id: str, cantidad: int) -> bool:
    """
    Registra bits ganados en un juego.
    Incrementa bits actuales y el histórico de ganancias.
    """
    if not telegram_id or cantidad <= 0:
        return False

    with get_connection() as conn:
        cursor = conn.execute("""
            UPDATE usuarios
            SET bits = bits + ?,
                total_ganados = total_ganados + ?
            WHERE telegram_id = ?
        """, (cantidad, cantidad, telegram_id))

        return cursor.rowcount > 0

# --- XP & STATS UPDATES ---
def agregar_xp(telegram_id: str, cantidad: int) -> int:
    """Suma XP al usuario y retorna el nuevo total."""
    with get_connection() as conn:
        conn.execute("UPDATE usuarios SET xp = xp + ? WHERE telegram_id = ?", (cantidad, telegram_id))
        row = conn.execute("SELECT xp FROM usuarios WHERE telegram_id = ?", (telegram_id,)).fetchone()
        return row["xp"] if row else 0

def actualizar_nivel(telegram_id: str, nuevo_nivel: int) -> bool:
    with get_connection() as conn:
        cursor = conn.execute("UPDATE usuarios SET nivel = ? WHERE telegram_id = ?", (nuevo_nivel, telegram_id))
        return cursor.rowcount > 0

def incrementar_stat(telegram_id: str, columna: str, cantidad: int = 1) -> bool:
    """Incrementa una estadistica especifica (juegos_jugados, jackpots_ganados, etc)"""
    columnas_validas = [
        'juegos_jugados', 'jackpots_ganados', 'moches_ganados', 'ruletas_ganadas', 
        'wins_total', 'bits_apostados', 'bits_ganados', 'tournaments_played', 
        'tournaments_won', 'juegos_diferentes'
    ]
    if columna not in columnas_validas:
        return False
        
    with get_connection() as conn:
        _asegurar_stats(telegram_id, conn)
        # Using string formatting for column name is safe here because validated against whitelist
        cursor = conn.execute(f"UPDATE user_stats SET {columna} = {columna} + ? WHERE telegram_id = ?", (cantidad, telegram_id))
        return cursor.rowcount > 0

def actualizar_racha_victorias(telegram_id: str, is_win: bool) -> int:
    """Actualiza la racha actual. Si supera la máxima, la guarda. Retorna la racha actual (no DB persistida momentanea sino calculada) o ajustada en otra tabla si fuera necesario.
    Para simplificar, usaremos 'win_streak' como la racha MÁXIMA histórica, y al llamar esta función se asume que controlamos la lógica si tenemos una racha viva."""
    # Para cumplir misiones de rachas a largo plazo, trackearemos una racha de victorias seguidas "actual".
    # Lo más robusto sería tener "current_win_streak" y "max_win_streak". Agreguemos eso rápido:
    try:
        with get_connection() as conn:
            try: conn.execute("ALTER TABLE user_stats ADD COLUMN current_win_streak INTEGER DEFAULT 0")
            except: pass
            
            if is_win:
                conn.execute("UPDATE user_stats SET current_win_streak = current_win_streak + 1 WHERE telegram_id = ?", (telegram_id,))
                # Actualizar el MAX win_streak
                conn.execute("UPDATE user_stats SET win_streak = MAX(win_streak, current_win_streak) WHERE telegram_id = ?", (telegram_id,))
            else:
                conn.execute("UPDATE user_stats SET current_win_streak = 0 WHERE telegram_id = ?", (telegram_id,))
                
            row = conn.execute("SELECT win_streak FROM user_stats WHERE telegram_id = ?", (telegram_id,)).fetchone()
            return row["win_streak"] if row else 0
    except Exception as e:
        print(f"Error rachas: {e}")
        return 0

# --- TROPHIES ---
def unlock_trophy(telegram_id: str, trophy_id: str) -> bool:
    """Desbloquea un trofeo para un usuario. Ignora si ya existe."""
    with get_connection() as conn:
        cursor = conn.execute(
            "INSERT OR IGNORE INTO trophies (telegram_id, trophy_id) VALUES (?, ?)",
            (telegram_id, trophy_id)
        )
        return cursor.rowcount > 0


def get_trophies(telegram_id: str) -> list:
    """Retorna todos los trofeos desbloqueados de un usuario."""
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT trophy_id, unlocked_at FROM trophies WHERE telegram_id = ? ORDER BY unlocked_at ASC",
            (telegram_id,)
        ).fetchall()
        return [dict(r) for r in rows]


# --- MISSIONS ---
def get_user_missions(telegram_id: str) -> list:
    """Retorna todas las misiones reclamadas por un usuario."""
    with get_connection() as conn:
        rows = conn.execute(
            "SELECT mission_id, claimed, claimed_at FROM user_missions WHERE telegram_id = ?",
            (telegram_id,)
        ).fetchall()
        return [dict(r) for r in rows]


def is_mission_claimed(telegram_id: str, mission_id: str) -> bool:
    """Verifica si una misión ya fue reclamada."""
    with get_connection() as conn:
        row = conn.execute(
            "SELECT claimed FROM user_missions WHERE telegram_id = ? AND mission_id = ?",
            (telegram_id, mission_id)
        ).fetchone()
        return bool(row and row["claimed"])


def claim_mission(telegram_id: str, mission_id: str) -> bool:
    """Marca una misión como reclamada."""
    from datetime import datetime
    with get_connection() as conn:
        cursor = conn.execute("""
            INSERT INTO user_missions (telegram_id, mission_id, claimed, claimed_at)
            VALUES (?, ?, 1, ?)
            ON CONFLICT(telegram_id, mission_id) DO UPDATE SET claimed=1, claimed_at=excluded.claimed_at
        """, (telegram_id, mission_id, datetime.utcnow().isoformat()))
        return cursor.rowcount > 0

def desbloquear_item(telegram_id: str, item_type: str, item_id: str) -> bool:
    with get_connection() as conn:
        cursor = conn.execute("INSERT OR IGNORE INTO unlocked_items (telegram_id, item_type, item_id) VALUES (?, ?, ?)", 
                              (telegram_id, item_type, item_id))
        return cursor.rowcount > 0

def equipar_item(telegram_id: str, tipo_campo: str, item_id: str) -> bool:
    campos_validos = {'frame': 'avatar_frame', 'theme': 'tema_actual'}
    if tipo_campo not in campos_validos:
        return False
        
    campo_db = campos_validos[tipo_campo]
    with get_connection() as conn:
        # Check if they own it first
        owns = conn.execute("SELECT 1 FROM unlocked_items WHERE telegram_id = ? AND item_type = ? AND item_id = ?", 
                            (telegram_id, tipo_campo, item_id)).fetchone()
                            
        # Permitimos defaults ('none', 'default', 'bronze', etc) sin desbloqueo siempre
        if not owns and item_id not in ['none', 'default', 'bronze']:
            return False
            
        cursor = conn.execute(f"UPDATE usuarios SET {campo_db} = ? WHERE telegram_id = ?", (item_id, telegram_id))
        return cursor.rowcount > 0

def descontar_bits(telegram_id: str, cantidad: int) -> bool:
    """
    Descuenta bits a un usuario existente.
    Retorna True si tiene suficientes fondos y se realiza el descuento.
    """
    if not telegram_id:
        return False

    if cantidad <= 0:
        return False

    with get_connection() as conn:
        # Check first and deduct atomically if possible (SQLite check constraint usually handles >= 0, but checking explicitly is safe)
        cursor = conn.execute("""
            UPDATE usuarios
            SET bits = bits - ?
            WHERE telegram_id = ? AND bits >= ?
        """, (cantidad, telegram_id, cantidad))

        return cursor.rowcount > 0

# --- DAILY REWARDS AND PROFILE UPDATES ---
def reclamar_recompensa_diaria(telegram_id: str, hoy_str: str, recompensa: int, racha: int) -> bool:
    """Actualiza la racha y los bits obtenidos diarios."""
    with get_connection() as conn:
        cursor = conn.execute("""
            UPDATE usuarios 
            SET bits = bits + ?, 
                last_daily_reward = ?, 
                daily_streak = ? 
            WHERE telegram_id = ?
        """, (recompensa, hoy_str, racha, telegram_id))
        return cursor.rowcount > 0

def actualizar_nombre_usuario(telegram_id: str, nuevo_nombre: str) -> bool:
    with get_connection() as conn:
        try:
            cursor = conn.execute("UPDATE usuarios SET nombre = ? WHERE telegram_id = ?", (nuevo_nombre, telegram_id))
            return cursor.rowcount > 0
        except sqlite3.IntegrityError:
            # En caso que haya constraints (unicidad futura)
            return False

def incrementar_tiempo_jugado(telegram_id: str, minutos: int) -> bool:
    """Suma 'minutos' al tiempo total jugado del usuario."""
    with get_connection() as conn:
        _asegurar_stats(telegram_id, conn)
        cursor = conn.execute("""
            UPDATE user_stats
            SET tiempo_jugado = tiempo_jugado + ?
            WHERE telegram_id = ?
        """, (minutos, telegram_id))
        return cursor.rowcount > 0