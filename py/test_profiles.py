import sys
import database
from app import app
from datetime import datetime

def test_profile_endpoints():
    print("Beginning Profile DB and Logic Verification...")
    
    with app.test_request_context():
        # Using a dummy user
        test_id = 'test_user_profile'
        test_name = 'TestProfile'
        
        with database.get_connection() as conn:
            # Cleanup if exists
            conn.execute("DELETE FROM usuarios WHERE telegram_id = ?", (test_id,))
            conn.execute("INSERT INTO usuarios (telegram_id, nombre, username, bits, nivel, xp) VALUES (?, ?, ?, 5000, 10, 1000)", 
                        (test_id, test_name, 'test_user'))
            
        print("1. User created.")
        
        # Test obtaining complete profile
        perfil = database.obtener_perfil_completo(test_id)
        assert perfil['nombre'] == test_name
        assert perfil['avatar_frame'] == 'none'
        print("2. Profile fetch working.")
        
        # Test changing name
        success = database.actualizar_nombre_usuario(test_id, 'NewNameTest')
        assert success
        perfil = database.obtener_perfil_completo(test_id)
        assert perfil['nombre'] == 'NewNameTest'
        print("3. Name update functional.")
        
        # Test equipping frame
        # They don't own "diamond" by default, so it should fail
        success = database.equipar_item(test_id, 'frame', 'diamond')
        assert not success
        
        # They can equip 'basic' or 'bronze' since they are defaults
        success = database.equipar_item(test_id, 'frame', 'bronze')
        assert success
        
        perfil = database.obtener_perfil_completo(test_id)
        assert perfil['avatar_frame'] == 'bronze'
        print("4. Frame equip logic functional (permission check acting).")
        
        # Test daily reward
        hoy_str = datetime.utcnow().date().isoformat()
        db_bits_initial = database.obtener_bits(test_id)
        
        # Claim reward (streak 1)
        success = database.reclamar_recompensa_diaria(test_id, hoy_str, 100, 1)
        assert success
        
        perfil = database.obtener_perfil_completo(test_id)
        assert perfil['bits'] == db_bits_initial + 100
        assert perfil['last_daily_reward'] == hoy_str
        assert perfil['daily_streak'] == 1
        print("5. Daily reward claimed and recorded.")
        
        # Cleanup
        with database.get_connection() as conn:
            conn.execute("DELETE FROM usuarios WHERE telegram_id = ?", (test_id,))
        
        print("✅ ALL TESTS PASSED.")

if __name__ == '__main__':
    test_profile_endpoints()
