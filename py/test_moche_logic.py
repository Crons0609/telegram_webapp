import sys
from moche_engine import RoomManager

def test_room_logic():
    manager = RoomManager()
    
    # Test 1: Create room and join
    room = manager.create_room('host_123', 'HostPlayer', bet_amount=50, is_private=True)
    room_id = room['id']
    print(f"Room created: {room_id}")
    
    # Test 2: Join room
    res, msg = manager.join_room(room_id, 'guest_456', 'GuestPlayer')
    print(f"Guest joined: {res}, Message: {msg}")
    assert res == True
    assert len(manager.rooms[room_id]['players']) == 2
    
    # Test 3: Kick player
    kick_res, kick_msg = manager.kick_player(room_id, 'host_123', 'guest_456')
    print(f"Kick result: {kick_res}, Message: {kick_msg}")
    assert kick_res == True
    assert len(manager.rooms[room_id]['players']) == 1
    
    # Test 4: Host leaves waiting room -> room closed
    manager.join_room(room_id, 'guest_789', 'AnotherGuest')
    leave_res = manager.leave_room(room_id, 'host_123')
    print(f"Host leave result: {leave_res}")
    assert leave_res == "host_left"
    assert room_id not in manager.rooms # Room should be deleted
    
    print("All tests passed!")

if __name__ == "__main__":
    test_room_logic()
