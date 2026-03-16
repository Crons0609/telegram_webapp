import sqlite3
import json
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
                ajedrez_elo INTEGER DEFAULT 1200,
                ajedrez_partidas INTEGER DEFAULT 0,
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
            ("juegos_diferentes", "INTEGER DEFAULT 0"),
            ("ajedrez_elo", "INTEGER DEFAULT 1200"),
            ("ajedrez_partidas", "INTEGER DEFAULT 0")
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

        # Tabla de Trofeos Ganados por el Usuario
        conn.execute("""
            CREATE TABLE IF NOT EXISTS trophies (
                telegram_id TEXT,
                trophy_id TEXT,
                unlocked_at TEXT NOT NULL DEFAULT (datetime('now')),
                PRIMARY KEY (telegram_id, trophy_id),
                FOREIGN KEY(telegram_id) REFERENCES usuarios(telegram_id)
            )
        """)

        # Tabla de Configuración de Trofeos (editables por admin)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS trophies_config (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                desc TEXT NOT NULL,
                img TEXT NOT NULL,
                stat_name TEXT NOT NULL,
                stat_target INTEGER NOT NULL,
                is_active INTEGER DEFAULT 1
            )
        """)
        
        # Seed Trofeos if empty
        t_count = conn.execute("SELECT COUNT(*) FROM trophies_config").fetchone()[0]
        if t_count == 0:
            initial_trophies = [
                ("trophy_1", "Primera Victoria", "Gana tu primera partida en cualquier juego.", "/static/img/trophies/trophy_1.png", "wins_total", 1),
                ("trophy_2", "Bronce en Combate", "Acumula 5 victorias en cualquier juego.", "/static/img/trophies/trophy_2.png", "wins_total", 5),
                ("trophy_3", "Plata Implacable", "Alcanza 10 victorias en cualquier juego.", "/static/img/trophies/trophy_3.png", "wins_total", 10),
                ("trophy_4", "Maestro del Moche", "Gana 10 partidas de Moche.", "/static/img/trophies/trophy_4.png", "moches_ganados", 10),
                ("trophy_5", "Jackpot Supremo", "Obtén un Jackpot en la Slot Machine.", "/static/img/trophies/trophy_5.png", "jackpots_ganados", 1),
                ("trophy_6", "Señor de la Ruleta", "Gana 10 rondas de Ruleta Francesa.", "/static/img/trophies/trophy_6.png", "ruletas_ganadas", 10),
                ("trophy_7", "Racha Dorada", "Acumula 25 victorias en cualquier juego.", "/static/img/trophies/trophy_7.svg", "wins_total", 25),
                ("trophy_8", "Rey del Casino", "Alcanza las 50 victorias acumuladas.", "/static/img/trophies/trophy_8.svg", "wins_total", 50),
                ("trophy_9", "Leyenda Inmortal", "Supera las 100 victorias. La cima del casino.", "/static/img/trophies/trophy_9.svg", "wins_total", 100)
            ]
            for t in initial_trophies:
                conn.execute("INSERT INTO trophies_config (id, name, desc, img, stat_name, stat_target) VALUES (?, ?, ?, ?, ?, ?)", t)

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

        # Tabla de Historial de Partidas
        conn.execute("""
            CREATE TABLE IF NOT EXISTS juegos_historial (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                telegram_id TEXT NOT NULL,
                juego TEXT NOT NULL,
                apuesta INTEGER NOT NULL DEFAULT 0,
                ganancia INTEGER NOT NULL DEFAULT 0,
                resultado TEXT NOT NULL,
                fecha TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
                FOREIGN KEY(telegram_id) REFERENCES usuarios(telegram_id)
            )
        """)

        # Tabla de Transacciones Financieras (USD y Bits)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS transacciones (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                telegram_id TEXT NOT NULL,
                bits INTEGER NOT NULL,
                usd_amount REAL NOT NULL,
                tipo TEXT NOT NULL,
                fecha TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
                FOREIGN KEY(telegram_id) REFERENCES usuarios(telegram_id)
            )
        """)

        # Tabla de Solicitudes P2P
        conn.execute("""
            CREATE TABLE IF NOT EXISTS p2p_requests (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                telegram_id TEXT NOT NULL,
                username TEXT,
                nombre TEXT,
                price_usd REAL NOT NULL,
                bits_amount INTEGER NOT NULL,
                leida INTEGER NOT NULL DEFAULT 0,
                fecha TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
            )
        """)

        # =====================================================
        # TEMAS GLOBALES
        # =====================================================
        conn.execute("""
            CREATE TABLE IF NOT EXISTS themes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                slug TEXT NOT NULL UNIQUE,
                description TEXT DEFAULT '',
                primary_color TEXT NOT NULL DEFAULT '#c9a227',
                secondary_color TEXT NOT NULL DEFAULT '#f0cc55',
                bg_color TEXT NOT NULL DEFAULT '#0a0a0f',
                accent_glow TEXT NOT NULL DEFAULT 'rgba(201,162,39,0.25)',
                particles_color TEXT NOT NULL DEFAULT 'rgba(212,175,55,0.55)',
                background_image TEXT DEFAULT '',
                background_overlay TEXT DEFAULT '',
                typography TEXT DEFAULT '{}',
                ui_sounds TEXT DEFAULT '{}',
                animations TEXT DEFAULT '{}',
                is_active INTEGER NOT NULL DEFAULT 0,
                created_at TEXT NOT NULL DEFAULT (datetime('now')),
                updated_at TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS theme_schedules (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                theme_id INTEGER NOT NULL,
                event_name TEXT NOT NULL,
                start_date TEXT NOT NULL,
                end_date TEXT NOT NULL,
                priority INTEGER NOT NULL DEFAULT 1,
                FOREIGN KEY(theme_id) REFERENCES themes(id)
            )
        """)

        # Seed 5 default themes if table is empty
        theme_count = conn.execute("SELECT COUNT(*) FROM themes").fetchone()[0]
        if theme_count == 0:
            default_themes = [
                ("Default (Casino)",     "default",      "Tema base dorado elegante",               "#c9a227", "#f0cc55", "#0a0a0f", "rgba(201,162,39,0.25)", "rgba(212,175,55,0.55)", "", "", "{}", "{}", "{}", 1),
                ("Dark Premium",         "dark_premium",  "Púrpura profundo y misterioso",           "#a855f7", "#c084fc", "#07050f", "rgba(168,85,247,0.3)",  "rgba(168,85,247,0.4)",  "", "", "{}", "{}", "{}", 0),
                ("Gold Imperial",        "gold_imperial", "Ámbar riquísimo, el tema de los reyes",   "#f5a623", "#ffd060", "#0a0700", "rgba(245,166,35,0.35)", "rgba(245,166,35,0.55)", "", "", "{}", "{}", "{}", 0),
                ("Las Vegas",            "las_vegas",     "Rojo neón eléctrico, la vibra Vegas",     "#ff2244", "#ff6680", "#050508", "rgba(255,34,68,0.35)",  "rgba(255,34,68,0.55)",  "", "", "{}", "{}", "{}", 0),
                ("Noir Élite",           "noir",          "Monocromático plata sobre negro absoluto","#c8c8c8", "#f0f0f0", "#000000", "rgba(220,220,220,0.2)", "rgba(200,200,200,0.4)", "", "", "{}", "{}", "{}", 0),
            ]
            conn.executemany("""
                INSERT INTO themes (name, slug, description, primary_color, secondary_color, bg_color, accent_glow, particles_color, background_image, background_overlay, typography, ui_sounds, animations, is_active)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, default_themes)

        # =====================================================
        # APUESTAS DEPORTIVAS (SPORTS BETTING)
        # =====================================================
        conn.execute("""
            CREATE TABLE IF NOT EXISTS sports_leagues (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                country TEXT,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
            )
        """)

        conn.execute("""
            CREATE TABLE IF NOT EXISTS sports_matches (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                team1 TEXT NOT NULL,
                team2 TEXT NOT NULL,
                date TEXT NOT NULL,
                league_id INTEGER,
                status TEXT DEFAULT 'upcoming',
                result TEXT,
                odd1 REAL DEFAULT 2.0,
                oddx REAL DEFAULT 3.0,
                odd2 REAL DEFAULT 2.0,
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
                FOREIGN KEY(league_id) REFERENCES sports_leagues(id)
            )
        """)

        conn.execute("""
            CREATE TABLE IF NOT EXISTS sports_bets (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                telegram_id TEXT NOT NULL,
                match_id INTEGER NOT NULL,
                team_choice TEXT NOT NULL,
                amount INTEGER NOT NULL,
                odd REAL,
                potential_win INTEGER,
                status TEXT DEFAULT 'pending',
                created_at TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
                FOREIGN KEY(telegram_id) REFERENCES usuarios(telegram_id),
                FOREIGN KEY(match_id) REFERENCES sports_matches(id)
            )
        """)


# =====================================================
# THEME HELPERS
# =====================================================

def get_active_theme() -> dict:
    """Returns the currently active theme as a dict, or the default slug if none active."""
    with get_connection() as conn:
        row = conn.execute("SELECT * FROM themes WHERE is_active = 1 LIMIT 1").fetchone()
        if row:
            d = dict(row)
            d['typography'] = json.loads(d.get('typography') or '{}')
            d['ui_sounds'] = json.loads(d.get('ui_sounds') or '{}')
            d['animations'] = json.loads(d.get('animations') or '{}')
            return d
        return {"slug": "default", "name": "Default (Casino)", "primary_color": "#c9a227",
                "secondary_color": "#f0cc55", "bg_color": "#0a0a0f",
                "accent_glow": "rgba(201,162,39,0.25)", "particles_color": "rgba(212,175,55,0.55)",
                "background_image": "", "background_overlay": "",
                "typography": {}, "ui_sounds": {}, "animations": {}}

def get_all_themes() -> list:
    with get_connection() as conn:
        rows = conn.execute("SELECT * FROM themes ORDER BY id ASC").fetchall()
        res = []
        for r in rows:
            d = dict(r)
            d['typography'] = json.loads(d.get('typography') or '{}')
            d['ui_sounds'] = json.loads(d.get('ui_sounds') or '{}')
            d['animations'] = json.loads(d.get('animations') or '{}')
            res.append(d)
        return res

def activate_theme(theme_id: int) -> bool:
    with get_connection() as conn:
        conn.execute("UPDATE themes SET is_active = 0, updated_at = datetime('now')")
        conn.execute("UPDATE themes SET is_active = 1, updated_at = datetime('now') WHERE id = ?", (theme_id,))
        return True

def create_theme(name: str, slug: str, description: str, primary_color: str,
                 secondary_color: str, bg_color: str, accent_glow: str, particles_color: str,
                 background_image: str = '', background_overlay: str = '', 
                 typography: dict = None, ui_sounds: dict = None, animations: dict = None) -> int:
    typography_json = json.dumps(typography or {})
    ui_sounds_json = json.dumps(ui_sounds or {})
    animations_json = json.dumps(animations or {})
    with get_connection() as conn:
        cursor = conn.execute("""
            INSERT INTO themes (name, slug, description, primary_color, secondary_color, bg_color, accent_glow, particles_color, background_image, background_overlay, typography, ui_sounds, animations)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (name, slug, description, primary_color, secondary_color, bg_color, accent_glow, particles_color, background_image, background_overlay, typography_json, ui_sounds_json, animations_json))
        return cursor.lastrowid

def update_theme(theme_id: int, data: dict) -> bool:
    allowed = ['name', 'description', 'primary_color', 'secondary_color', 'bg_color', 'accent_glow', 'particles_color', 'background_image', 'background_overlay']
    json_fields = ['typography', 'ui_sounds', 'animations']
    
    sets = []
    vals = []
    
    for k in allowed:
        if k in data:
            sets.append(f"{k} = ?")
            vals.append(data[k])
            
    for k in json_fields:
        if k in data:
            sets.append(f"{k} = ?")
            vals.append(json.dumps(data[k] or {}))
            
    if not sets:
        return False
    sets.append("updated_at = datetime('now')")
    vals.append(theme_id)
    with get_connection() as conn:
        conn.execute(f"UPDATE themes SET {', '.join(sets)} WHERE id = ?", vals)
        return True

def get_theme_schedules() -> list:
    with get_connection() as conn:
        rows = conn.execute("""
            SELECT ts.*, t.name as theme_name, t.slug as theme_slug
            FROM theme_schedules ts
            JOIN themes t ON ts.theme_id = t.id
            ORDER BY ts.start_date ASC
        """).fetchall()
        return [dict(r) for r in rows]

def create_schedule(theme_id: int, event_name: str, start_date: str, end_date: str, priority: int = 1) -> int:
    with get_connection() as conn:
        cursor = conn.execute("""
            INSERT INTO theme_schedules (theme_id, event_name, start_date, end_date, priority)
            VALUES (?, ?, ?, ?, ?)
        """, (theme_id, event_name, start_date, end_date, priority))
        return cursor.lastrowid

def delete_schedule(schedule_id: int) -> bool:
    with get_connection() as conn:
        conn.execute("DELETE FROM theme_schedules WHERE id = ?", (schedule_id,))
        return True

def check_and_apply_scheduled_theme() -> bool:
    """Check if any scheduled theme should be active right now. Activates it if so. Returns True if switched."""
    with get_connection() as conn:
        scheduled = conn.execute("""
            SELECT ts.theme_id
            FROM theme_schedules ts
            WHERE ts.start_date <= datetime('now') AND ts.end_date >= datetime('now')
            ORDER BY ts.priority DESC
            LIMIT 1
        """).fetchone()
        if scheduled:
            theme_id = scheduled['theme_id']
            active = conn.execute("SELECT id FROM themes WHERE is_active = 1").fetchone()
            if not active or active['id'] != theme_id:
                conn.execute("UPDATE themes SET is_active = 0")
                conn.execute("UPDATE themes SET is_active = 1, updated_at = datetime('now') WHERE id = ?", (theme_id,))
                return True
    return False


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
                   COALESCE(s.juegos_diferentes, 0) as juegos_diferentes,
                   COALESCE(s.ajedrez_elo, 1200) as ajedrez_elo,
                   COALESCE(s.ajedrez_partidas, 0) as ajedrez_partidas
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
        'tournaments_won', 'juegos_diferentes', 'ajedrez_partidas'
    ]
    if columna not in columnas_validas:
        return False
        
    with get_connection() as conn:
        _asegurar_stats(telegram_id, conn)
        # Using string formatting for column name is safe here because validated against whitelist
        cursor = conn.execute(f"UPDATE user_stats SET {columna} = {columna} + ? WHERE telegram_id = ?", (cantidad, telegram_id))
        return cursor.rowcount > 0

def actualizar_ajedrez_elo(telegram_id: str, new_elo: int) -> bool:
    """Actualiza el ELO de ajedrez tras una partida."""
    with get_connection() as conn:
        _asegurar_stats(telegram_id, conn)
        cursor = conn.execute("UPDATE user_stats SET ajedrez_elo = ?, ajedrez_partidas = ajedrez_partidas + 1 WHERE telegram_id = ?", (new_elo, telegram_id))
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

def registrar_transaccion(telegram_id: str, bits: int, usd_amount: float, tipo: str) -> bool:
    """Registra un movimiento de dinero real y bits."""
    with get_connection() as conn:
        cursor = conn.execute("""
            INSERT INTO transacciones (telegram_id, bits, usd_amount, tipo)
            VALUES (?, ?, ?, ?)
        """, (telegram_id, bits, usd_amount, tipo))
        return cursor.rowcount > 0

def registrar_partida(telegram_id: str, juego: str, apuesta: int, ganancia: int, resultado: str) -> bool:
    """Registra cada partida jugada para cálculos de ganancias del casino."""
    with get_connection() as conn:
        cursor = conn.execute("""
            INSERT INTO juegos_historial (telegram_id, juego, apuesta, ganancia, resultado)
            VALUES (?, ?, ?, ?, ?)
        """, (telegram_id, juego, apuesta, ganancia, resultado))
        return cursor.rowcount > 0

def actualizar_ultima_partida_ganada(telegram_id: str, juego: str, ganancia: int) -> bool:
    """Actualiza la última partida de un juego a 'win' y añade la ganancia (útil para endpoints separados de bet y win)."""
    with get_connection() as conn:
        cursor = conn.execute("""
            UPDATE juegos_historial 
            SET ganancia = ?, resultado = 'win'
            WHERE id = (
                SELECT id FROM juegos_historial 
                WHERE telegram_id = ? AND juego = ?
                ORDER BY fecha DESC LIMIT 1
            )
        """, (ganancia, telegram_id, juego))
        return cursor.rowcount > 0

def obtener_metricas_financieras() -> dict:
    """Obtiene el reporte financiero completo del dashboard administrativo."""
    with get_connection() as conn:
        # Sums and counts for transactions (Deposits and Withdrawals)
        # Reemplazado usd_amount con bits según el requerimiento del usuario
        tx_stats = conn.execute("""
            SELECT 
                COUNT(id) as total_tx,
                SUM(CASE WHEN fecha >= datetime('now', '-1 days', 'localtime') THEN 1 ELSE 0 END) as tx_day,
                SUM(CASE WHEN fecha >= datetime('now', '-7 days', 'localtime') THEN 1 ELSE 0 END) as tx_week,
                SUM(CASE WHEN fecha >= datetime('now', '-30 days', 'localtime') THEN 1 ELSE 0 END) as tx_month,

                COALESCE(SUM(CASE WHEN tipo IN ('deposito', 'recarga_admin') THEN bits ELSE 0 END), 0) as total_usd_invested,
                COALESCE(SUM(CASE WHEN tipo = 'retiro' THEN bits ELSE 0 END), 0) as total_usd_paid,

                COALESCE(SUM(CASE WHEN tipo IN ('deposito', 'recarga_admin') AND fecha >= datetime('now', '-1 days', 'localtime') THEN bits ELSE 0 END), 0) as usd_dep_day,
                COALESCE(SUM(CASE WHEN tipo IN ('deposito', 'recarga_admin') AND fecha >= datetime('now', '-7 days', 'localtime') THEN bits ELSE 0 END), 0) as usd_dep_week,
                COALESCE(SUM(CASE WHEN tipo IN ('deposito', 'recarga_admin') AND fecha >= datetime('now', '-30 days', 'localtime') THEN bits ELSE 0 END), 0) as usd_dep_month,

                COALESCE(SUM(CASE WHEN tipo = 'retiro' AND fecha >= datetime('now', '-1 days', 'localtime') THEN bits ELSE 0 END), 0) as usd_withdraw_day,
                COALESCE(SUM(CASE WHEN tipo = 'retiro' AND fecha >= datetime('now', '-7 days', 'localtime') THEN bits ELSE 0 END), 0) as usd_withdraw_week,
                COALESCE(SUM(CASE WHEN tipo = 'retiro' AND fecha >= datetime('now', '-30 days', 'localtime') THEN bits ELSE 0 END), 0) as usd_withdraw_month
            FROM transacciones
        """).fetchone()

        # Sums of Casino Profit in Bits (Bits played - Bits won by player) = Casino Bits Won
        profit_stats = conn.execute("""
            SELECT 
                COALESCE(SUM(CASE WHEN fecha >= datetime('now', '-1 days', 'localtime') THEN apuesta - ganancia ELSE 0 END), 0) as profit_day,
                COALESCE(SUM(CASE WHEN fecha >= datetime('now', '-7 days', 'localtime') THEN apuesta - ganancia ELSE 0 END), 0) as profit_week,
                COALESCE(SUM(CASE WHEN fecha >= datetime('now', '-30 days', 'localtime') THEN apuesta - ganancia ELSE 0 END), 0) as profit_month
            FROM juegos_historial
        """).fetchone()

        # Calculate Net USD earnings
        usd_net_day = tx_stats['usd_dep_day'] - tx_stats['usd_withdraw_day']
        usd_net_week = tx_stats['usd_dep_week'] - tx_stats['usd_withdraw_week']
        usd_net_month = tx_stats['usd_dep_month'] - tx_stats['usd_withdraw_month']

        return {
            'total_transactions': tx_stats['total_tx'],
            'tx_day': tx_stats['tx_day'] or 0,
            'tx_week': tx_stats['tx_week'] or 0,
            'tx_month': tx_stats['tx_month'] or 0,

            'total_usd_invested': tx_stats['total_usd_invested'],
            'total_usd_paid': tx_stats['total_usd_paid'],

            'usd_net_day': usd_net_day,
            'usd_net_week': usd_net_week,
            'usd_net_month': usd_net_month,

            'bits_profit_day': profit_stats['profit_day'],
            'bits_profit_week': profit_stats['profit_week'],
            'bits_profit_month': profit_stats['profit_month']
        }


def registrar_solicitud_p2p(telegram_id: str, username: str, nombre: str, price_usd: float, bits_amount: int) -> int:
    """Guarda una solicitud de recarga P2P y retorna su ID."""
    with get_connection() as conn:
        cursor = conn.execute(
            """INSERT INTO p2p_requests (telegram_id, username, nombre, price_usd, bits_amount)
               VALUES (?, ?, ?, ?, ?)""",
            (telegram_id, username, nombre, price_usd, bits_amount)
        )
        return cursor.lastrowid


def obtener_notificaciones(limit: int = 30) -> list:
    """
    Retorna las últimas notificaciones combinadas de PayPal y P2P.
    Ordena por fecha desc.
    """
    with get_connection() as conn:
        # PayPal transactions
        paypal_rows = conn.execute("""
            SELECT t.id, t.telegram_id, COALESCE(u.username, '') as username,
                   COALESCE(u.nombre, '') as nombre,
                   t.bits, t.usd_amount, t.fecha, 'paypal' as tipo, 0 as leida
            FROM transacciones t
            LEFT JOIN usuarios u ON t.telegram_id = u.telegram_id
            WHERE t.tipo = 'deposito_paypal'
            ORDER BY t.fecha DESC
            LIMIT ?
        """, (limit,)).fetchall()

        # P2P requests
        p2p_rows = conn.execute("""
            SELECT id, telegram_id, COALESCE(username, '') as username,
                   COALESCE(nombre, '') as nombre,
                   bits_amount as bits, price_usd as usd_amount,
                   fecha, 'p2p' as tipo, leida
            FROM p2p_requests
            ORDER BY fecha DESC
            LIMIT ?
        """, (limit,)).fetchall()

        # Merge and sort by fecha desc
        combined = []
        for row in paypal_rows:
            combined.append(dict(row))
        for row in p2p_rows:
            combined.append(dict(row))

        combined.sort(key=lambda x: x['fecha'], reverse=True)
        return combined[:limit]


def marcar_notificaciones_leidas() -> None:
    """Marca todas las solicitudes P2P como leídas."""
    with get_connection() as conn:
        conn.execute("UPDATE p2p_requests SET leida = 1 WHERE leida = 0")


def contar_notificaciones_no_leidas() -> int:
    """Cuenta las notificaciones no leídas (P2P pendientes)."""
    with get_connection() as conn:
        p2p = conn.execute("SELECT COUNT(*) FROM p2p_requests WHERE leida = 0").fetchone()[0]
        return p2p