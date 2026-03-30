import database
import requests
import json
from config import RAPIDAPI_FOOTBALL_KEY

FB_HOST = 'footapi7.p.rapidapi.com'

bets = database.get_fb("sports_bets") or {}
pending = {k:v for k,v in bets.items() if v.get("status") == "pending"}

print(f"Found {len(pending)} pending bets.")

for bid, bdata in pending.items():
    match_id = bdata.get("match_id")
    sport = bdata.get("sport_source", "soccer")
    print(f"Checking bet {bid}: match {match_id} (sport: {sport})")
    
    if sport not in ["soccer", "futbol"]:
        continue
        
    url = f"https://{FB_HOST}/api/match/{match_id}"
    headers = {
        "x-rapidapi-key": RAPIDAPI_FOOTBALL_KEY,
        "x-rapidapi-host": FB_HOST,
        "Accept": "application/json"
    }
    
    try:
        resp = requests.get(url, headers=headers)
        if resp.status_code != 200:
            print(f"  [ERROR] status code: {resp.status_code}")
            continue
        data = resp.json()
        event = data.get('event', {})
        status = event.get('status', {})
        status_type = str(status.get('type', '')).lower()
        score = f"{event.get('homeScore', {}).get('current')} - {event.get('awayScore', {}).get('current')}"
        print(f"  [STATUS] {status_type} | [SCORE] {score}")
    except Exception as e:
        print(f"  [EXCEPTION] {e}")
