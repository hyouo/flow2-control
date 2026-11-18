"""Render the low-profile keycap materials used by the keyboard and its inspector."""

from pathlib import Path

import numpy as np
from PIL import Image


DESTINATION = Path(__file__).resolve().parents[1] / "public" / "materials"
COLORS = {"porcelain": (246, 245, 239), "clay": (184, 99, 72), "graphite": (83, 89, 87)}


def unit(vector):
    return vector / np.linalg.norm(vector, axis=-1, keepdims=True).clip(1e-8)


def cap_distance(points):
    """Distance to a tapered shell with a dished top and a rounded rim, in mm."""
    x, y, z = np.moveaxis(points, -1, 0)
    rise = (z / 5.4).clip(0, 1)
    radius, bevel = 0.95 + 0.6 * rise, 0.23
    qx = abs(x) - (9.1 - 1.8 * rise - radius)
    qy = abs(y - 0.43 * rise) - (9.1 - 1.45 * rise - radius)
    wall = np.hypot(qx.clip(0), qy.clip(0)) + np.maximum(qx, qy).clip(max=0) - radius
    dish = 4.4 + 0.73 * (x / 7.3).clip(-1, 1) ** 2 - 0.03 * y
    side, lid = wall + bevel, np.maximum(z - dish, -z) + bevel
    return np.hypot(side.clip(0), lid.clip(0)) + np.maximum(side, lid).clip(max=0) - bevel


def surface(camera, resolution):
    view = unit(np.array(camera))
    right = unit(np.cross([0, 0, 1], view))
    up = np.cross(view, right)
    axis = np.linspace(-13, 13, resolution, dtype=np.float32)
    u, v = np.meshgrid(axis, -axis)
    points = u[..., None] * right + v[..., None] * up + 24 * view + [0, 0, 2]
    for _ in range(88):
        distance = cap_distance(points)
        moving = (distance > 0.002) & (points[..., 2] > -0.2) & (points @ view > -14)
        if not moving.any():
            break
        points[moving] -= 0.83 * distance[moving, None] * view
    mask = (cap_distance(points) < 0.005) & (points[..., 2] > -0.03)
    normal = unit(np.stack([
        cap_distance(points + offset) - cap_distance(points - offset)
        for offset in np.eye(3) * 0.015
    ], axis=-1))
    key_light = unit(np.array([0.85, -0.42, 0.72] if view[2] == 0 else [-0.64, 0.46, 0.91]))
    fill = unit(np.array([0.64, -0.48, 0.44]))
    diffuse = 0.48 + 0.20 * normal[..., 2].clip(0) + 0.33 * (normal @ key_light).clip(0) + 0.11 * (normal @ fill).clip(0)
    reflection = 7 * (normal @ unit(key_light + view)).clip(0) ** 14
    return diffuse, reflection, mask


def render(view, camera, width, materials):
    diffuse, reflection, mask = surface(camera, 540)
    grain = np.random.default_rng(84).normal(0, 0.65, mask.shape)
    for material in materials:
        rgb = diffuse[..., None] * COLORS[material] + (reflection + grain)[..., None]
        rgba = np.dstack((rgb.clip(0, 255), mask * 255)).astype(np.uint8)
        image = Image.fromarray(rgba)
        image = image.crop(image.getbbox())
        image = image.resize((width, round(width * image.height / image.width)), Image.Resampling.LANCZOS)
        image.save(DESTINATION / f"{view}-{material}.webp", quality=92, method=6)


if __name__ == "__main__":
    DESTINATION.mkdir(exist_ok=True)
    render("top", (0, -0.18, 1), 128, COLORS)
    render("detail", (0.40, -0.77, 0.92), 280, ("porcelain", "clay"))
    render("side", (1, 0, 0), 256, ("porcelain",))
