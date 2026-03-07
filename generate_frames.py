from PIL import Image, ImageDraw, ImageFilter
import os

def create_glow_ring(filename, color_main, color_glow, size=256, thickness=18):
    # Create absolute transparent image
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    # Calculate coordinate bounding box (inset by 20 to allow glow space)
    inset = 35
    bbox = [inset, inset, size - inset, size - inset]
    
    # 1. Base glow ring (Outer soft layer)
    glow_img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow_img)
    glow_draw.ellipse(bbox, outline=color_glow, width=thickness+15)
    
    # Apply generous blur
    glow_img = glow_img.filter(ImageFilter.GaussianBlur(12))
    img.paste(glow_img, (0, 0), glow_img)
    
    # 2. Main solid ring
    main_img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    main_draw = ImageDraw.Draw(main_img)
    main_draw.ellipse(bbox, outline=color_main, width=thickness)
    img.paste(main_img, (0, 0), main_img)
    
    # 3. Inner core (bright highlight)
    core_img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    core_draw = ImageDraw.Draw(core_img)
    core_draw.ellipse(bbox, outline=(255, 255, 255, 180), width=int(thickness/3))
    img.paste(core_img, (0, 0), core_img)

    # Save
    os.makedirs(os.path.dirname(filename), exist_ok=True)
    img.save(filename)
    print(f"Created: {filename}")

if __name__ == "__main__":
    base_dir = r"c:\Users\Cronos\Desktop\telegram_webapp\static\img\frames"
    
    # Base colors for main tiers
    tiers = {
        "bronze": [(184, 115, 51, 255), (205, 127, 50, 150)],
        "silver": [(192, 192, 192, 255), (230, 230, 230, 150)],
        "gold": [(212, 175, 55, 255), (255, 215, 0, 150)],
        "diamond": [(0, 255, 255, 255), (0, 191, 255, 200)],
        "legendary": [(255, 0, 255, 255), (138, 43, 226, 200)]
    }
    
    # Generate 3 sub-tiers for each main tier
    for tier_name, (color_main, color_glow) in tiers.items():
        for i in range(1, 4):
            # i=1 (base), i=2 (thicker/brighter), i=3 (max thickness/glow)
            thickness = 14 + (i * 4) # 18, 22, 26
            filename = os.path.join(base_dir, f"{tier_name}{i}.png")
            create_glow_ring(filename, color_main, color_glow, thickness=thickness)
