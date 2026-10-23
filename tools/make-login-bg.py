# Fondo del login: aurora cobalto/menta, una gráfica que sube y partículas, en loop exacto de 6 s.
# Todo movimiento es periódico (seno/coseno de 2πt/T o desplazamientos que dan vueltas completas),
# así el cuadro final empalma con el primero sin corte.
import math, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

OUT = sys.argv[1]
W, H = 720, 1280          # vertical; en escritorio se recorta con object-fit: cover
FPS, T = 24, 6.0
N = int(FPS * T)          # 144 cuadros
rng = np.random.default_rng(7)

BG = np.array([21, 22, 29], float)           # --bg
COBALT = np.array([59, 79, 224], float)      # --card
MINT = np.array([95, 211, 168], float)       # --income
VIOLET = np.array([139, 156, 255], float)

# Aurora a baja resolución (es borrosa de todas formas) y luego se escala.
w, h = W // 4, H // 4
yy, xx = np.mgrid[0:h, 0:w].astype(float)
blobs = [  # (color, cx, cy, radio, amplitud x, amplitud y, fase, fuerza)
    (COBALT, .30, .28, .55, .10, .06, 0.0, 1.00),
    (MINT,   .78, .62, .45, .08, .09, 1.7, 0.55),
    (VIOLET, .55, .92, .50, .12, .05, 3.4, 0.60),
    (COBALT, .85, .10, .35, .06, .07, 4.6, 0.45),
]

def aurora(t):
    a = 2 * math.pi * t / T
    img = np.tile(BG, (h, w, 1))
    for col, cx, cy, r, ax, ay, ph, k in blobs:
        x = (cx + ax * math.sin(a + ph)) * w
        y = (cy + ay * math.cos(a + ph * 0.7)) * h
        rr = r * w * (1 + 0.08 * math.sin(a * 2 + ph))
        g = np.exp(-(((xx - x) ** 2 + (yy - y) ** 2) / (2 * rr * rr))) * k
        img = img + (col - BG) * g[..., None] * 0.55
    return Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).resize((W, H), Image.BICUBIC)

# Gráfica periódica: suma de senos con frecuencias enteras sobre el ancho, se desplaza un ancho completo en T.
freqs = [(1, 38, 0.3), (2, 22, 1.1), (3, 14, 2.0), (5, 8, 0.7), (8, 4, 2.6)]
def wave(u):  # u en [0,1)
    return sum(amp * math.sin(2 * math.pi * f * u + ph) for f, amp, ph in freqs)

def chart_points(t, base_y, scale):
    shift = t / T
    return [(x, base_y - scale * wave((x / W + shift) % 1.0)) for x in range(-8, W + 9, 6)]

# Partículas que suben y dan la vuelta exacta en T (cada una recorre 1 o 2 alturas).
P = 46
px = rng.uniform(0, W, P)
py = rng.uniform(0, H, P)
pspeed = rng.choice([1, 2], P)               # alturas por ciclo
psize = rng.uniform(1.2, 3.2, P)
palpha = rng.uniform(60, 170, P)
pcol = [tuple(int(c) for c in (MINT if i % 3 else VIOLET)) for i in range(P)]

os.makedirs(OUT, exist_ok=True)
for i in range(N):
    t = i / FPS
    a = 2 * math.pi * t / T
    frame = aurora(t).convert('RGBA')

    # Cuadrícula muy tenue, como papel de gráfica.
    grid = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(grid)
    for gx in range(0, W, 60):
        gd.line([(gx, 0), (gx, H)], fill=(255, 255, 255, 10), width=1)
    for gy in range(0, H, 60):
        gd.line([(0, gy), (W, gy)], fill=(255, 255, 255, 10), width=1)
    frame = Image.alpha_composite(frame, grid)

    # Dos líneas de gráfica con brillo: menta (principal) y cobalto claro (secundaria).
    lines = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ld = ImageDraw.Draw(lines)
    main = chart_points(t, H * 0.70, 3.2)
    second = chart_points((t + T / 3) % T, H * 0.80, 2.0)
    ld.line(second, fill=(139, 156, 255, 120), width=3, joint='curve')
    ld.line(main, fill=(95, 211, 168, 230), width=4, joint='curve')
    # Relleno suave bajo la línea principal.
    fill = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(fill).polygon(main + [(W + 8, H), (-8, H)], fill=(95, 211, 168, 26))
    glow = lines.filter(ImageFilter.GaussianBlur(10))
    frame = Image.alpha_composite(frame, fill)
    frame = Image.alpha_composite(frame, glow)
    frame = Image.alpha_composite(frame, lines)

    # Punto brillante que late sobre la línea, en el centro.
    cx = W * 0.62
    cy = H * 0.70 - 3.2 * wave((cx / W + t / T) % 1.0)
    pulse = 0.5 + 0.5 * math.sin(a * 3)
    dot = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    dd = ImageDraw.Draw(dot)
    r = 16 + 10 * pulse
    dd.ellipse([cx - r, cy - r, cx + r, cy + r], fill=(95, 211, 168, int(50 + 40 * pulse)))
    dd.ellipse([cx - 6, cy - 6, cx + 6, cy + 6], fill=(240, 255, 248, 255))
    frame = Image.alpha_composite(frame, dot.filter(ImageFilter.GaussianBlur(2)))

    # Partículas.
    parts = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    pd = ImageDraw.Draw(parts)
    for k in range(P):
        y = (py[k] - (t / T) * H * pspeed[k]) % H
        x = px[k] + 10 * math.sin(a + k)
        s = psize[k]
        al = int(palpha[k] * (0.6 + 0.4 * math.sin(a * 2 + k)))
        pd.ellipse([x - s, y - s, x + s, y + s], fill=pcol[k] + (al,))
    frame = Image.alpha_composite(frame, parts.filter(ImageFilter.GaussianBlur(0.6)))

    frame.convert('RGB').save(f'{OUT}/f{i:04d}.png')
print('cuadros', N)
