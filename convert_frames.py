"""
Convert all frame PNGs: make near-white pixels (center hole area) fully transparent.
The frames are RGBA ring images with opaque white filling the center hole.
This script converts those white pixels to alpha=0, leaving only the ring.
"""
from PIL import Image
import glob
import os

frames_dir = r'c:\Users\Cronos\Desktop\telegram_webapp\static\img\frames'
frame_files = glob.glob(os.path.join(frames_dir, '*.png'))

for path in frame_files:
    img = Image.open(path).convert('RGBA')
    data = img.getdata()
    
    new_data = []
    for r, g, b, a in data:
        # If the pixel is near-white (all channels > 220) and has alpha, make transparent
        if r > 220 and g > 220 and b > 220:
            new_data.append((r, g, b, 0))  # fully transparent
        else:
            new_data.append((r, g, b, a))
    
    img.putdata(new_data)
    img.save(path)
    print(f"Converted: {os.path.basename(path)}")

print("Done!")
