import requests
import json

payload = {
    "telegram_id": "TEST_HTTP_NEW",
    "nombre": "Test HTTP",
    "username": "testhttp",
    "photo_url": ""
}

try:
    r = requests.post("http://127.0.0.1:5000/api/init", json=payload)
    print("Status:", r.status_code)
    print("Response:", r.text)
except Exception as e:
    print("Error:", e)
