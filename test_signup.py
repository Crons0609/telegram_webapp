import database

try:
    print("Agregando usuario test...")
    database.agregar_usuario("TEST_12356", "Test User")
    print("Usuario agregado.")
    
    # Check if user exists
    perfil = database.obtener_perfil_completo("TEST_12356")
    print("Perfil completo encontrado:", perfil)
except Exception as e:
    import traceback
    traceback.print_exc()
