import sqlite3
import httpx
import json

FIREBASE_URL = "https://ghost-plague-casino-default-rtdb.firebaseio.com"
DB_PATH = "casino.db"

def dict_factory(cursor, row):
    d = {}
    for idx, col in enumerate(cursor.description):
        d[col[0]] = row[idx]
    return d

def migrate():
    print("Starting migration to Firebase...")
    
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = dict_factory
    cur = conn.cursor()
    
    # 1. Usuarios
    print("Migrating usuarios...")
    usuarios = {}
    for row in cur.execute("SELECT * FROM usuarios").fetchall():
        tid = str(row['telegram_id'])
        usuarios[tid] = row
    if usuarios:
        httpx.put(f"{FIREBASE_URL}/usuarios.json", json=usuarios)
        
    # 2. User Stats
    print("Migrating user_stats...")
    stats = {}
    for row in cur.execute("SELECT * FROM user_stats").fetchall():
        tid = str(row['telegram_id'])
        stats[tid] = row
    if stats:
        httpx.put(f"{FIREBASE_URL}/user_stats.json", json=stats)
        
    # 3. Historial (Using ++1 IDs)
    print("Migrating juegos_historial...")
    hist_dict = {}
    counter_hist = 1
    # Limiting to 5000 records to prevent massive payload if the db is huge
    for row in cur.execute("SELECT * FROM juegos_historial ORDER BY id ASC LIMIT 5000").fetchall():
        hist_dict[str(counter_hist)] = row
        counter_hist += 1
    if hist_dict:
        httpx.put(f"{FIREBASE_URL}/juegos_historial.json", json=hist_dict)

    # 4. Transacciones (Using ++1 IDs)
    print("Migrating transacciones...")
    tx_dict = {}
    counter_tx = 1
    for row in cur.execute("SELECT * FROM transacciones ORDER BY id ASC").fetchall():
        tx_dict[str(counter_tx)] = row
        counter_tx += 1
    if tx_dict:
        httpx.put(f"{FIREBASE_URL}/transacciones.json", json=tx_dict)
        
    # 5. Admins
    print("Migrating admins...")
    admins_dict = {}
    counter_admin = 1
    # Check if admins table exists
    try:
        for row in cur.execute("SELECT * FROM admins ORDER BY id ASC").fetchall():
            admins_dict[str(counter_admin)] = row
            counter_admin += 1
        if admins_dict:
            httpx.put(f"{FIREBASE_URL}/admins.json", json=admins_dict)
    except:
        print("No admins table found or error.")

    # 6. Trophies
    print("Migrating trophies...")
    trophies_dict = {}
    for row in cur.execute("SELECT * FROM trophies").fetchall():
        tid = str(row['telegram_id'])
        tid_dict = trophies_dict.setdefault(tid, {})
        tid_dict[str(row['trophy_id'])] = row
    if trophies_dict:
        httpx.put(f"{FIREBASE_URL}/trophies.json", json=trophies_dict)
        
    # 7. Unlocked items
    print("Migrating unlocked_items...")
    items_dict = {}
    try:
        for row in cur.execute("SELECT * FROM unlocked_items").fetchall():
            tid = str(row['telegram_id'])
            tid_dict = items_dict.setdefault(tid, {})
            key = f"{row['item_type']}_{row['item_id']}"
            tid_dict[key] = row
        if items_dict:
            httpx.put(f"{FIREBASE_URL}/unlocked_items.json", json=items_dict)
    except:
        pass

    # 8. User missions
    print("Migrating user_missions...")
    um_dict = {}
    try:
        for row in cur.execute("SELECT * FROM user_missions").fetchall():
            tid = str(row['telegram_id'])
            tid_dict = um_dict.setdefault(tid, {})
            tid_dict[str(row['mission_id'])] = row
        if um_dict:
            httpx.put(f"{FIREBASE_URL}/user_missions.json", json=um_dict)
    except:
        pass
        
    conn.close()
    print("Migration finished!")

if __name__ == '__main__':
    migrate()
