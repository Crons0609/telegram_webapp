import json
from app import app

client = app.test_client()
response = client.post('/register', 
                       data=json.dumps({
                           'telegram_id': 555555,
                           'nombre': 'Real User',
                           'username': 'realuser',
                           'photo_url': ''
                       }),
                       content_type='application/json')
print(f"Status: {response.status_code}")
print(f"Data: {response.get_data(as_text=True)}")
