"""生成掼蛋军师 PWA 图标：深绿牌桌底 + 金色「掼」字 + 四花色"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).parent.parent / 'public' / 'icons'
OUT.mkdir(parents=True, exist_ok=True)

# 找一个 CJK 字体
font_candidates = [
    '/System/Library/Fonts/PingFang.ttc',
    '/System/Library/Fonts/STHeiti Medium.ttc',
    '/System/Library/Fonts/Hiragino Sans GB.ttc',
]

def load_font(size):
    for p in font_candidates:
        if Path(p).exists():
            try:
                return ImageFont.truetype(p, size)
            except Exception:
                continue
    return ImageFont.load_default()

def make(size):
    img = Image.new('RGB', (size, size), '#064e3b')
    d = ImageDraw.Draw(img)
    # 纵向渐变：深绿 -> 墨黑
    top, bottom = (6, 78, 59), (17, 24, 39)
    for y in range(size):
        t = y / size
        d.line([(0, y), (size, y)], fill=tuple(int(a + (b - a) * t) for a, b in zip(top, bottom)))
    # 金色圆角边框
    m = int(size * 0.045)
    d.rounded_rectangle([m, m, size - m, size - m], radius=int(size * 0.18), outline='#f59e0b', width=max(2, size // 96))
    # 中央「掼」字
    f = load_font(int(size * 0.52))
    bbox = d.textbbox((0, 0), '掼', font=f)
    w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    d.text(((size - w) / 2 - bbox[0], size * 0.44 - h / 2 - bbox[1]), '掼', font=f, fill='#fbbf24')
    # 底部四花色
    fs = load_font(int(size * 0.13))
    suits = '♠ ♥ ♣ ♦'
    bbox = d.textbbox((0, 0), suits, font=fs)
    w = bbox[2] - bbox[0]
    d.text(((size - w) / 2 - bbox[0], size * 0.78 - bbox[1]), suits, font=fs, fill='#e7e5e4')
    return img

for s in (180, 192, 512):
    make(s).save(OUT / f'icon-{s}.png')
# maskable 版本（图标内缩，安全区）
img = Image.new('RGB', (512, 512), '#111827')
inner = make(400)
img.paste(inner, (56, 56))
img.save(OUT / 'icon-maskable-512.png')
print('icons ->', OUT)
