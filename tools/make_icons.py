#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成「抛给宇宙」PWA 图标：深色圆角底 + 彩色轮盘环 + 中心徽标。
输出 icons/icon-180.png、icon-192.png、icon-512.png、icon-maskable-512.png
做法：4 倍超采样后缩小；轮盘环与中心圆盘各画在独立图层再合成，
      避免在底图上「挖洞」把背景一起挖掉。"""
import os
import math
from PIL import Image, ImageDraw, ImageFont

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "icons")
os.makedirs(OUT, exist_ok=True)

C1 = (28, 28, 50)      # 渐变起点
C2 = (10, 10, 20)      # 渐变终点
WHEEL = [
    (139, 92, 246), (34, 225, 255), (255, 62, 165), (255, 176, 32),
    (182, 255, 59), (255, 107, 107), (79, 140, 255), (0, 214, 163),
]

FONT_CANDIDATES = [
    ("/System/Library/Fonts/PingFang.ttc", 2),
    ("/System/Library/Fonts/PingFang.ttc", 1),
    ("/System/Library/Fonts/Hiragino Sans GB.ttc", 0),
    ("/System/Library/Fonts/Supplemental/Songti.ttc", 0),
]


def load_font(px):
    for path, index in FONT_CANDIDATES:
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, px, index=index)
            except Exception:
                continue
    return None


def gradient(size, c1, c2, diagonal=True):
    """对角线性渐变"""
    grad = Image.new("RGB", (size, size))
    px = grad.load()
    for y in range(size):
        for x in range(size):
            t = (x + y) / (2 * max(1, size - 1)) if diagonal else y / max(1, size - 1)
            px[x, y] = tuple(int(c1[i] + (c2[i] - c1[i]) * t) for i in range(3))
    return grad


def base(size, radius_ratio, bleed):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    grad = gradient(size, C1, C2).convert("RGBA")
    if bleed:
        img.alpha_composite(grad)
    else:
        mask = Image.new("L", (size, size), 0)
        ImageDraw.Draw(mask).rounded_rectangle(
            [0, 0, size - 1, size - 1], radius=int(size * radius_ratio), fill=255
        )
        img.paste(grad, (0, 0), mask)
    return img


def wheel_layer(size, outer_r, inner_r, seg_count=8, gap_deg=5.0):
    """轮盘环：独立图层，中心挖空为透明"""
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    c = size / 2
    step = 360.0 / seg_count
    for i in range(seg_count):
        a0 = -90 + i * step + gap_deg / 2
        a1 = -90 + (i + 1) * step - gap_deg / 2
        d.pieslice([c - outer_r, c - outer_r, c + outer_r, c + outer_r],
                   a0, a1, fill=WHEEL[i % len(WHEEL)] + (255,))
    # 挖掉中心圆（只影响本图层，底图不受影响）
    d.ellipse([c - inner_r, c - inner_r, c + inner_r, c + inner_r], fill=(0, 0, 0, 0))
    return layer


def disc_layer(size, radius):
    """中心圆盘：紫→洋红径向渐变，圆外透明"""
    layer = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    n = int(radius * 2)
    small = 128
    disc = Image.new("RGB", (small, small))
    px = disc.load()
    c = small / 2
    for y in range(small):
        for x in range(small):
            t = min(1.0, math.hypot(x - c, y - c) / (small * 0.62))
            px[x, y] = tuple(int((139, 92, 246)[i] + ((255, 62, 165)[i] - (139, 92, 246)[i]) * t)
                             for i in range(3))
    disc = disc.resize((n, n), Image.LANCZOS).convert("RGBA")
    mask = Image.new("L", (n, n), 0)
    ImageDraw.Draw(mask).ellipse([0, 0, n - 1, n - 1], fill=255)
    off = int(size / 2 - radius)
    layer.paste(disc, (off, off), mask)
    return layer, off, n


def compose(size, bleed=False):
    SS = 4
    big = size * SS
    img = base(big, 0.22, bleed)

    if bleed:
        # maskable：所有内容收在安全区（直径 60%）内
        outer, inner, disc_r = 0.300 * big, 0.208 * big, 0.132 * big
    else:
        outer, inner, disc_r = 0.430 * big, 0.300 * big, 0.186 * big

    img.alpha_composite(wheel_layer(big, outer, inner))
    disc, off, n = disc_layer(big, disc_r)
    img.alpha_composite(disc)

    # 盘面文字
    font = load_font(int(disc_r * 1.15))
    d = ImageDraw.Draw(img)
    cx = cy = big / 2
    if font is not None:
        bbox = d.textbbox((0, 0), "抛", font=font)
        tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
        d.text((cx - tw / 2 - bbox[0], cy - th / 2 - bbox[1]), "抛", font=font,
               fill=(255, 255, 255, 255))
    else:
        r = disc_r * 0.34
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(255, 255, 255, 255))

    return img.resize((size, size), Image.LANCZOS)


def main():
    jobs = [
        ("icon-180.png", 180, False),
        ("icon-192.png", 192, False),
        ("icon-512.png", 512, False),
        ("icon-maskable-512.png", 512, True),
    ]
    for name, size, bleed in jobs:
        path = os.path.join(OUT, name)
        compose(size, bleed=bleed).save(path)
        print("wrote", path, size)


if __name__ == "__main__":
    main()
