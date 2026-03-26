from app import app
import database

def test():
    # Make sure user 12345 exists and has enough bits
    database.agregar_usuario("12345", "TestUser")
    database.patch_fb("usuarios/12345", {"bits": 50000})

    with app.test_client() as client:
        # Mock session if needed, but the endpoint supports passing telegram_id directly
        response = client.post('/withdraw/api/request', json={
            "telegram_id": "12345",
            "bits": 5000,
            "method": "p2p",
            "admin_id": "999999999" # Dummy admin ID
        })
        print("Status code:", response.status_code)
        print("Response JSON:", response.get_json())

if __name__ == "__main__":
    test()
