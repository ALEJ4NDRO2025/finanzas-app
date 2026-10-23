# Fondo del login con tema de bolsa: velas japonesas que avanzan, media móvil, volumen,
# eje de precios, etiqueta del último precio y cinta de cotizaciones. Loop exacto de 6 s:
# las velas se desplazan exactamente un ciclo de la serie y la cinta exactamente su largo.
# Los símbolos y precios son inventados (decorativos).
import math, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

OUT, W, H = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
FPS, T = 24, 6.0
N = int(FPS * T)
rng = np.random.default_rng(21)
portrait = H > W

MONO = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf'
MONO_B = '/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf'
def font(path, size):
    try: return ImageFont.truetype(path, size)
    except OSError: return ImageFont.load_default()

BG_TOP, BG_BOT = (16, 19, 30), (10, 12, 18)
UP, DOWN = (52, 211, 153), (248, 96, 96)
MA = (139, 156, 255)
GRID = (255, 255, 255, 14)
TXT = (163, 165, 184)

# ---------- serie de velas periódica ----------
CW = 28 if portrait else 30                      # ancho de cada vela (px)
M = math.ceil((W * 1.0) / CW) + 2                # velas por ciclo (un poco más que la pantalla)
CYCLE = M * CW                                   # se desplaza esto en T segundos → loop exacto
steps = rng.normal(0.35, 1.6, M)
steps -= steps.mean()                            # vuelve al mismo precio al final del ciclo
steps += np.sin(np.linspace(0, 2 * np.pi, M, endpoint=False)) * 0.9  # tendencia que sube y baja
closes = 100 + np.cumsum(steps)
opens = np.roll(closes, 1)
highs = np.maximum(opens, closes) + rng.uniform(0.3, 1.6, M)
lows = np.minimum(opens, closes) - rng.uniform(0.3, 1.6, M)
vols = rng.uniform(0.25, 1.0, M) * (1 + np.abs(closes - opens) / 3)
ma = np.array([closes[(np.arange(i - 6, i + 1)) % M].mean() for i in range(M)])  # media móvil de 7, periódica

pmin, pmax = lows.min() - 1.5, highs.max() + 1.5
# Zona del gráfico: abajo en vertical (el formulario ocupa arriba), centrado en horizontal.
if portrait:
    top, bot = int(H * 0.50), int(H * 0.86)
else:
    top, bot = int(H * 0.22), int(H * 0.80)
vol_top, vol_bot = bot + int(H * 0.015), bot + int(H * (0.06 if portrait else 0.11))
AXIS_W = 100 if portrait else 150
plot_r = W - AXIS_W
py = lambda p: bot - (p - pmin) / (pmax - pmin) * (bot - top)

f_axis = font(MONO, 15 if portrait else 15)
f_tag = font(MONO_B, 15)
f_tape = font(MONO_B, 17 if portrait else 18)
f_big = font(MONO_B, 54 if portrait else 64)
f_small = font(MONO, 17)

# ---------- cinta de cotizaciones (símbolos inventados) ----------
tick = [('AURX', 142.30, 2.4), ('VELA', 58.12, -1.1), ('NODO', 9.84, 5.7), ('CAFE', 23.40, 0.8),
        ('MNTA', 311.05, -0.6), ('ORCA', 77.90, 3.2), ('LUMA', 12.66, -2.3), ('IDX50', 1834.2, 1.5)]
def tape_items():
    items = []
    for s, p, c in tick:
        up = c >= 0
        items.append((s + ' ', (235, 236, 245)))
        items.append((f'{p:,.2f}'.replace(',', 'X').replace('.', ',').replace('X', '.') + ' ', TXT))
        items.append((('▲ ' if up else '▼ ') + f'{abs(c):.1f}%'.replace('.', ',') + '     ', UP if up else DOWN))
    return items
ITEMS = tape_items()
tmp = ImageDraw.Draw(Image.new('RGB', (10, 10)))
TAPE_LEN = int(sum(tmp.textlength(t, font=f_tape) for t, _ in ITEMS))
TAPE_H = 44 if portrait else 46

def bg_gradient():
    g = np.linspace(0, 1, H)[:, None]
    top_c, bot_c = np.array(BG_TOP, float), np.array(BG_BOT, float)
    img = (top_c * (1 - g) + bot_c * g)[:, None, :].repeat(W, 1)
    return Image.fromarray(img.astype(np.uint8))
BASE = bg_gradient()

# Precio índice grande de fondo (decorativo): sube y baja con la serie.
def fmt(v):
    return f'{v:,.2f}'.replace(',', 'X').replace('.', ',').replace('X', '.')

os.makedirs(OUT, exist_ok=True)
for i in range(N):
    t = i / FPS
    shift = (t / T) * CYCLE                         # px desplazados
    a = 2 * math.pi * t / T
    frame = BASE.copy().convert('RGBA')

    layer = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    # Cuadrícula y eje de precios.
    for k in range(6):
        y = top + k * (bot - top) / 5
        d.line([(0, y), (plot_r, y)], fill=GRID, width=1)
        price = pmax - k * (pmax - pmin) / 5
        d.text((plot_r + 10, y - 9), fmt(price * 18.3), font=f_axis, fill=TXT + (150,))
    gx0 = -(shift % (CW * 4))
    x = gx0
    while x < plot_r:
        d.line([(x, top - 20), (x, vol_bot)], fill=(255, 255, 255, 8), width=1)
        x += CW * 4
    d.line([(plot_r, top - 30), (plot_r, vol_bot)], fill=(255, 255, 255, 22), width=1)

    # Velas: se dibujan dos ciclos para cubrir la pantalla mientras se desplazan.
    first = int(shift // CW) - 1
    last_idx, last_x = None, None
    ma_pts = []
    for j in range(first, first + M + 4):
        k = j % M
        xc = j * CW - shift + CW / 2
        if xc < -CW or xc > plot_r - CW * 0.3:
            continue
        o, c, hi, lo = opens[k], closes[k], highs[k], lows[k]
        col = UP if c >= o else DOWN
        d.line([(xc, py(hi)), (xc, py(lo))], fill=col + (200,), width=2)
        y1, y2 = sorted([py(o), py(c)])
        d.rectangle([xc - CW * 0.32, y1, xc + CW * 0.32, max(y2, y1 + 2)], fill=col + (235,))
        vh = vols[k] * (vol_bot - vol_top)
        d.rectangle([xc - CW * 0.32, vol_bot - vh, xc + CW * 0.32, vol_bot], fill=col + (60,))
        ma_pts.append((xc, py(ma[k])))
        last_idx, last_x = k, xc
    if len(ma_pts) > 1:
        d.line(ma_pts, fill=MA + (210,), width=3, joint='curve')

    # Etiqueta del último precio (línea punteada + caja en el eje), y punto que late.
    lc = closes[last_idx]
    ly = py(lc)
    lcol = UP if lc >= opens[last_idx] else DOWN
    for xx in range(int(last_x), plot_r, 10):
        d.line([(xx, ly), (xx + 5, ly)], fill=lcol + (170,), width=1)
    d.rounded_rectangle([plot_r + 2, ly - 13, W - 4, ly + 13], radius=6, fill=lcol + (255,))
    d.text((plot_r + 9, ly - 10), fmt(lc * 18.3), font=f_tag, fill=(10, 12, 18, 255))
    pulse = 0.5 + 0.5 * math.sin(a * 4)
    r = 7 + 7 * pulse
    d.ellipse([last_x - r, ly - r, last_x + r, ly + r], fill=lcol + (int(70 * (1 - pulse) + 30),))

    glow = layer.filter(ImageFilter.GaussianBlur(7))
    frame = Image.alpha_composite(frame, glow)
    frame = Image.alpha_composite(frame, layer)

    # Índice grande con variación (arriba del gráfico).
    info = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    di = ImageDraw.Draw(info)
    base_c = closes[0]
    chg = (lc - base_c) / base_c * 100 + 1.2
    iy = top - (110 if portrait else 120)
    LM = 24 if portrait else 72
    di.text((LM, iy), 'IDX50  ·  1D', font=f_small, fill=TXT + (190,))
    di.text((LM - 2, iy + 22), fmt(lc * 18.3), font=f_big, fill=(240, 241, 248, 235))
    col = UP if chg >= 0 else DOWN
    di.text((LM + 2, iy + 22 + (62 if portrait else 74)), ('▲ ' if chg >= 0 else '▼ ') + f'{abs(chg):.2f}%'.replace('.', ','), font=f_tag, fill=col + (255,))
    frame = Image.alpha_composite(frame, info)

    # Cinta de cotizaciones arriba (en vertical) o abajo (en horizontal), con desplazamiento exacto.
    ty = 0 if portrait else H - TAPE_H
    tape = Image.new('RGBA', (W, H), (0, 0, 0, 0))
    dt = ImageDraw.Draw(tape)
    dt.rectangle([0, ty, W, ty + TAPE_H], fill=(8, 10, 16, 235))
    dt.line([(0, ty + (TAPE_H if portrait else 0)), (W, ty + (TAPE_H if portrait else 0))], fill=(255, 255, 255, 25))
    off = -(t / T) * TAPE_LEN
    x0 = off
    while x0 < W:
        x = x0
        for text, colr in ITEMS:
            dt.text((x, ty + (TAPE_H - 20) / 2), text, font=f_tape, fill=colr + (255,))
            x += tmp.textlength(text, font=f_tape)
        x0 += TAPE_LEN
    frame = Image.alpha_composite(frame, tape)

    frame.convert('RGB').save(f'{OUT}/f{i:04d}.png')
print('cuadros', N, 'ciclo velas', CYCLE, 'cinta', TAPE_LEN)
