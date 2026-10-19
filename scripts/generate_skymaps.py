"""
Generate standard equirectangular 360 panoramic skymaps for Shader Studio.
Saves high-resolution (1024x512) JPG skymaps into public/environments/
"""
import numpy as np
from PIL import Image
import math
import os

W = 1024
H = 512
os.makedirs("public/environments", exist_ok=True)

# Generate spherical coordinate grids
u = np.linspace(0.0, 1.0, W, endpoint=False)
v = np.linspace(0.0, 1.0, H)
U, V = np.meshgrid(u, v)

# Theta in [-pi, pi], Phi in [0, pi]
theta = (U - 0.5) * 2.0 * np.pi
phi = V * np.pi

# Direction vectors
DirX = np.sin(phi) * np.sin(theta)
DirY = np.cos(phi) # +1 at top (v=0), -1 at bottom (v=1)
DirZ = np.sin(phi) * np.cos(theta) # +1 at center (u=0.5)

def save_image(rgb_array, filename):
    # Tone map and clamp to [0, 255]
    clamped = np.clip(rgb_array * 255.0, 0, 255).astype(np.uint8)
    img = Image.fromarray(clamped, mode="RGB")
    out_path = os.path.join("public/environments", filename)
    img.save(out_path, format="JPEG", quality=92)
    print(f"Saved {out_path} ({os.path.getsize(out_path)} bytes)")

# -------------------------------------------------------------
# 1. Daylight Clear Sky
# -------------------------------------------------------------
def gen_daylight():
    # Sun direction: elevation 35 deg, directly in front (+Z)
    sun_elev = np.radians(35.0)
    sun_dir = np.array([0.0, np.sin(sun_elev), np.cos(sun_elev)])
    
    # Dot product with sun
    dot_sun = np.maximum(0.0, DirX * sun_dir[0] + DirY * sun_dir[1] + DirZ * sun_dir[2])
    
    # Upper hemisphere (sky)
    y_pos = np.maximum(0.0, DirY)
    y_neg = np.maximum(0.0, -DirY)
    
    # Rayleigh sky gradient: deep royal blue at zenith, soft cyan at horizon
    sky_r = 0.18 + 0.55 * (1.0 - y_pos**0.6)
    sky_g = 0.42 + 0.45 * (1.0 - y_pos**0.6)
    sky_b = 0.88 + 0.10 * (1.0 - y_pos**0.6)
    
    # Ground plane (landscape earth)
    ground_r = 0.18 * (1.0 - y_neg**0.8) + 0.05
    ground_g = 0.22 * (1.0 - y_neg**0.8) + 0.06
    ground_b = 0.14 * (1.0 - y_neg**0.8) + 0.05
    
    # Blend sky & ground with soft horizon transition
    horizon_factor = np.exp(-np.abs(DirY) * 20.0) * 0.2
    base_r = np.where(DirY >= 0, sky_r, ground_r) + horizon_factor
    base_g = np.where(DirY >= 0, sky_g, ground_g) + horizon_factor * 1.1
    base_b = np.where(DirY >= 0, sky_b, ground_b) + horizon_factor * 1.2
    
    # Sun disc & Mie scattering corona
    sun_disc = (dot_sun > 0.9993).astype(float) * 2.5
    sun_corona = np.power(dot_sun, 16.0) * 0.85 + np.power(dot_sun, 64.0) * 1.2
    
    # Soft clouds layer in lower sky
    cloud_noise = (np.sin(DirX * 12.0 + DirZ * 8.0) * 0.5 + 0.5) * np.exp(-((DirY - 0.25) / 0.12)**2)
    clouds = np.maximum(0.0, cloud_noise - 0.3) * 0.4
    
    rgb = np.stack([
        base_r + sun_disc + sun_corona * 1.0 + clouds * 0.9,
        base_g + sun_disc + sun_corona * 0.95 + clouds * 0.92,
        base_b + sun_disc * 0.9 + sun_corona * 0.75 + clouds * 0.95
    ], axis=-1)
    
    save_image(rgb, "daylight.jpg")

# -------------------------------------------------------------
# 2. Golden Sunset
# -------------------------------------------------------------
def gen_sunset():
    # Sun at 10 degrees elevation
    sun_elev = np.radians(10.0)
    sun_dir = np.array([0.0, np.sin(sun_elev), np.cos(sun_elev)])
    dot_sun = np.maximum(0.0, DirX * sun_dir[0] + DirY * sun_dir[1] + DirZ * sun_dir[2])
    
    y_pos = np.maximum(0.0, DirY)
    y_neg = np.maximum(0.0, -DirY)
    
    # Twilight gradient: Indigo zenith -> Purple mid -> Fiery Amber horizon
    t = y_pos**0.6
    sky_r = 0.95 * (1.0 - t) + 0.12 * t
    sky_g = 0.45 * (1.0 - t) + 0.16 * t
    sky_b = 0.15 * (1.0 - t) + 0.42 * t
    
    # Ground silhouette with dusky warm horizon sheen
    ground_r = 0.14 * (1.0 - y_neg**0.7) + 0.03
    ground_g = 0.08 * (1.0 - y_neg**0.7) + 0.02
    ground_b = 0.06 * (1.0 - y_neg**0.7) + 0.03
    
    base_r = np.where(DirY >= 0, sky_r, ground_r)
    base_g = np.where(DirY >= 0, sky_g, ground_g)
    base_b = np.where(DirY >= 0, sky_b, ground_b)
    
    # Sun disk & wide golden halo
    sun_disc = (dot_sun > 0.999).astype(float) * 3.0
    sun_halo = np.power(dot_sun, 6.0) * 0.9 + np.power(dot_sun, 32.0) * 1.5
    
    # Horizontal sunset cloud strata
    cloud_layer = (np.sin(DirX * 8.0 - DirZ * 4.0) * 0.5 + 0.5) * np.exp(-((DirY - 0.15) / 0.08)**2)
    clouds = np.maximum(0.0, cloud_layer - 0.25) * 0.6
    
    rgb = np.stack([
        base_r + sun_disc * 1.0 + sun_halo * 1.0 + clouds * 1.0,
        base_g + sun_disc * 0.9 + sun_halo * 0.65 + clouds * 0.45,
        base_b + sun_disc * 0.4 + sun_halo * 0.2 + clouds * 0.2
    ], axis=-1)
    
    save_image(rgb, "sunset.jpg")

# -------------------------------------------------------------
# 3. Milky Way & Celestial Starfield
# -------------------------------------------------------------
def gen_milky_way():
    np.random.seed(42)
    
    # Deep space void
    base_r = np.full_like(DirX, 0.012)
    base_g = np.full_like(DirY, 0.014)
    base_b = np.full_like(DirZ, 0.028)
    
    # Galactic plane band (inclined plane across the sky)
    # Normal to galactic plane
    gal_normal = np.array([0.5, 0.7, 0.5])
    gal_normal = gal_normal / np.linalg.norm(gal_normal)
    dist_to_gal = np.abs(DirX * gal_normal[0] + DirY * gal_normal[1] + DirZ * gal_normal[2])
    gal_band = np.exp(-dist_to_gal * 4.5)
    
    # Galactic core glow (located around front right)
    core_dir = np.array([0.3, 0.4, 0.86])
    core_dir = core_dir / np.linalg.norm(core_dir)
    dot_core = np.maximum(0.0, DirX * core_dir[0] + DirY * core_dir[1] + DirZ * core_dir[2])
    core_glow = np.power(dot_core, 8.0) * 0.6
    
    # Cosmic nebula clouds (cyan/magenta)
    neb_noise = np.sin(DirX * 5.0 + DirY * 3.0) * np.cos(DirZ * 6.0)
    nebula = np.maximum(0.0, neb_noise) * gal_band
    
    # Procedural Starfield (10,000 stars)
    num_stars = 12000
    star_x = np.random.uniform(-1, 1, num_stars)
    star_y = np.random.uniform(-1, 1, num_stars)
    star_z = np.random.uniform(-1, 1, num_stars)
    star_len = np.sqrt(star_x**2 + star_y**2 + star_z**2) + 1e-6
    star_x, star_y, star_z = star_x / star_len, star_y / star_len, star_z / star_len
    
    # Convert stars to pixel coordinates
    star_phi = np.arccos(np.clip(star_y, -1.0, 1.0))
    star_theta = np.arctan2(star_x, star_z)
    
    star_u = (star_theta / (2.0 * np.pi) + 0.5) % 1.0
    star_v = star_phi / np.pi
    
    star_px = (star_u * (W - 1)).astype(int)
    star_py = (star_v * (H - 1)).astype(int)
    
    star_layer_r = np.zeros_like(DirX)
    star_layer_g = np.zeros_like(DirY)
    star_layer_b = np.zeros_like(DirZ)
    
    magnitudes = np.random.uniform(0.4, 1.8, num_stars)
    for i in range(num_stars):
        px, py = star_px[i], star_py[i]
        mag = magnitudes[i]
        # Star color variation (blue-white vs warm)
        tint = np.random.choice([0, 1, 2], p=[0.6, 0.25, 0.15])
        if tint == 0:
            star_layer_r[py, px] = min(2.0, star_layer_r[py, px] + mag * 0.9)
            star_layer_g[py, px] = min(2.0, star_layer_g[py, px] + mag * 0.95)
            star_layer_b[py, px] = min(2.0, star_layer_b[py, px] + mag * 1.1)
        elif tint == 1:
            star_layer_r[py, px] = min(2.0, star_layer_r[py, px] + mag * 1.1)
            star_layer_g[py, px] = min(2.0, star_layer_g[py, px] + mag * 0.9)
            star_layer_b[py, px] = min(2.0, star_layer_b[py, px] + mag * 0.7)
        else:
            star_layer_r[py, px] = min(2.0, star_layer_r[py, px] + mag * 0.7)
            star_layer_g[py, px] = min(2.0, star_layer_g[py, px] + mag * 1.0)
            star_layer_b[py, px] = min(2.0, star_layer_b[py, px] + mag * 1.2)
            
    # Airglow near horizon
    airglow = np.exp(-((DirY - 0.02) / 0.04)**2) * 0.06
    
    rgb = np.stack([
        base_r + gal_band * 0.18 + core_glow * 0.45 + nebula * 0.35 + star_layer_r + airglow * 0.4,
        base_g + gal_band * 0.16 + core_glow * 0.35 + nebula * 0.15 + star_layer_g + airglow * 0.8,
        base_b + gal_band * 0.26 + core_glow * 0.40 + nebula * 0.45 + star_layer_b + airglow * 0.5
    ], axis=-1)
    
    save_image(rgb, "night.jpg")

# -------------------------------------------------------------
# 4. Professional Photography Studio
# -------------------------------------------------------------
def gen_studio():
    # Dark modern cyclorama studio
    base_ambient = 0.05
    y_pos = np.maximum(0.0, DirY)
    y_neg = np.maximum(0.0, -DirY)
    
    floor_grad = 0.04 * (1.0 - y_neg * 0.5)
    ceiling_grad = 0.06 * (1.0 - y_pos * 0.5)
    
    # Key Softbox (Front-Right at azimuth +30 deg, elev 40 deg)
    key_dir = np.array([0.5, 0.65, 0.57])
    key_dir = key_dir / np.linalg.norm(key_dir)
    dot_key = np.maximum(0.0, DirX * key_dir[0] + DirY * key_dir[1] + DirZ * key_dir[2])
    # Rectangular softbox diffusion falloff
    key_box = np.power(dot_key, 12.0) * 1.8 + np.power(dot_key, 64.0) * 2.5
    
    # Fill Softbox (Front-Left at azimuth -40 deg, elev 25 deg)
    fill_dir = np.array([-0.64, 0.42, 0.64])
    fill_dir = fill_dir / np.linalg.norm(fill_dir)
    dot_fill = np.maximum(0.0, DirX * fill_dir[0] + DirY * fill_dir[1] + DirZ * fill_dir[2])
    fill_box = np.power(dot_fill, 16.0) * 0.9
    
    # Overhead softbox bank (ceiling)
    overhead = np.power(y_pos, 4.0) * 0.7
    
    # Rim strip light (Back-Left)
    rim_dir = np.array([-0.4, 0.2, -0.9])
    rim_dir = rim_dir / np.linalg.norm(rim_dir)
    dot_rim = np.maximum(0.0, DirX * rim_dir[0] + DirY * rim_dir[1] + DirZ * rim_dir[2])
    rim_strip = np.power(dot_rim, 32.0) * 1.6
    
    # Floor softbox specular reflection
    floor_refl = np.power(np.maximum(0.0, DirX * key_dir[0] - DirY * key_dir[1] + DirZ * key_dir[2]), 12.0) * 0.25 * (DirY < 0)
    
    cyc_grad = np.where(DirY >= 0, ceiling_grad, floor_grad)
    rgb = np.stack([
        base_ambient + key_box * 1.0 + fill_box * 0.75 + overhead * 0.9 + rim_strip * 0.4 + floor_refl * 0.9 + cyc_grad,
        base_ambient + key_box * 0.85 + fill_box * 0.80 + overhead * 0.92 + rim_strip * 0.6 + floor_refl * 0.8 + cyc_grad,
        base_ambient + key_box * 0.65 + fill_box * 0.95 + overhead * 0.98 + rim_strip * 1.0 + floor_refl * 0.6 + cyc_grad
    ], axis=-1)
    
    save_image(rgb, "studio.jpg")

# -------------------------------------------------------------
# 5. Cyberpunk Neon City
# -------------------------------------------------------------
def gen_cyberpunk():
    # Dark moody atmosphere
    base_r = 0.025
    base_g = 0.02
    base_b = 0.06
    
    # Vertical skyscraper silhouettes along horizon (|DirY| < 0.15)
    near_horizon = np.abs(DirY) < 0.16
    city_building_noise = np.sin(DirX * 35.0 + DirZ * 30.0) * 0.5 + 0.5
    buildings = (city_building_noise > 0.45) & near_horizon & (DirY > 0)
    windows = buildings & ((np.sin(DirX * 180.0) * np.sin(DirY * 240.0)) > 0.3)
    
    # Neon cyan tower at front-left
    cyan_dir = np.array([-0.6, 0.05, 0.8])
    cyan_dir = cyan_dir / np.linalg.norm(cyan_dir)
    dot_cyan = np.maximum(0.0, DirX * cyan_dir[0] + DirY * cyan_dir[1] + DirZ * cyan_dir[2])
    cyan_glow = np.power(dot_cyan, 16.0) * 2.2 + np.power(dot_cyan, 70.0) * 3.0
    
    # Neon magenta tower at front-right
    mag_dir = np.array([0.7, 0.08, 0.71])
    mag_dir = mag_dir / np.linalg.norm(mag_dir)
    dot_mag = np.maximum(0.0, DirX * mag_dir[0] + DirY * mag_dir[1] + DirZ * mag_dir[2])
    mag_glow = np.power(dot_mag, 16.0) * 2.2 + np.power(dot_mag, 70.0) * 3.0
    
    # Overhead ultraviolet wash
    overhead_uv = np.maximum(0.0, DirY)**2 * 0.3
    
    # Wet asphalt ground reflections
    wet_ground = (DirY < 0) * (np.power(np.maximum(0.0, DirX * cyan_dir[0] - DirY * cyan_dir[1] + DirZ * cyan_dir[2]), 20.0) * 0.6 +
                              np.power(np.maximum(0.0, DirX * mag_dir[0] - DirY * mag_dir[1] + DirZ * mag_dir[2]), 20.0) * 0.6)
    
    rgb = np.stack([
        base_r + mag_glow * 1.0 + cyan_glow * 0.05 + overhead_uv * 0.4 + windows * 0.8 + wet_ground * 0.7,
        base_g + mag_glow * 0.1 + cyan_glow * 0.95 + overhead_uv * 0.1 + windows * 0.7 + wet_ground * 0.5,
        base_b + mag_glow * 0.65 + cyan_glow * 1.0 + overhead_uv * 0.8 + windows * 0.9 + wet_ground * 0.9
    ], axis=-1)
    
    save_image(rgb, "cyberpunk.jpg")

# -------------------------------------------------------------
# 6. Clean Neutral Studio
# -------------------------------------------------------------
def gen_neutral():
    y_pos = np.maximum(0.0, DirY)
    y_neg = np.maximum(0.0, -DirY)
    
    sky_grad = 0.52 + 0.38 * y_pos
    floor_grad = 0.50 - 0.22 * y_neg
    cyc = np.where(DirY >= 0, sky_grad, floor_grad)
    
    # Soft overhead panel light
    ceiling = np.power(y_pos, 3.0) * 0.45
    
    light = cyc + ceiling
    rgb = np.stack([light * 0.96, light * 0.98, light * 1.0], axis=-1)
    save_image(rgb, "neutral.jpg")

if __name__ == "__main__":
    print("Generating standard equirectangular panoramic skymaps...")
    gen_daylight()
    gen_sunset()
    gen_milky_way()
    gen_studio()
    gen_cyberpunk()
    gen_neutral()
    print("All standard skymaps generated successfully!")
