"""
Generate icon files for the KDP Samples Exporter Chrome extension.
Requires Pillow: pip install Pillow
"""
import os
import sys

try:
    from PIL import Image
except ImportError:
    print("Installing Pillow...")
    os.system(f"{sys.executable} -m pip install Pillow")
    from PIL import Image

SOURCE = r"C:\Users\erzik\.gemini\antigravity-ide\brain\fd52f20c-7e62-4239-a0d7-32d0fda747ea\kdp_exporter_icon_1781973841802.png"
OUT_DIR = r"G:\VStudio\KDP_samplesExporter\icons"
SIZES = [16, 32, 48, 128]

os.makedirs(OUT_DIR, exist_ok=True)

with Image.open(SOURCE) as img:
    img = img.convert("RGBA")
    for size in SIZES:
        resized = img.resize((size, size), Image.LANCZOS)
        out_path = os.path.join(OUT_DIR, f"icon{size}.png")
        resized.save(out_path, "PNG")
        print(f"  Saved {out_path}")

print("All icons generated!")
