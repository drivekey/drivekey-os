"""Local decorative field, ported from components/character-field-model.ts.

Only grid coordinates and elapsed animation time enter this renderer.
It never reads wallet state, transaction data or user input.
"""
import math
import time
from PIL import Image, ImageDraw, ImageFont, ImageTk

ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789#$%&*+-=<>/{}[]:;?.'
WORD = 'DRIVEKEY'
SHADES = ('#333333', '#3b3b3b', '#444444', '#4c4c4c')


def hash32(value):
    n = value & 0xffffffff
    n = ((n ^ (n >> 16)) * 0x45d9f3b) & 0xffffffff
    n = ((n ^ (n >> 16)) * 0x45d9f3b) & 0xffffffff
    return (n ^ (n >> 16)) & 0xffffffff


def cell(column, row, columns, seconds):
    # The website's single-row wordmark replaces noise in the same grid cells.
    left = (len(WORD) + 4 + (row // 15) * 31 + math.floor(seconds * 8)) % (columns + len(WORD)) - len(WORD)
    local = column - left
    if row % 15 == 0 and 0 <= local < len(WORD):
        return WORD[local], '#b0b0b0'
    seed = hash32(column * 18397 + row * 7907 + 41)
    period = .24 + (seed % 800) / 1000
    tick = math.floor(seconds / period + (seed % 97) / 97)
    glyph = ALPHABET[(seed + tick * (1 + seed % (len(ALPHABET) - 1))) % len(ALPHABET)]
    return glyph, SHADES[hash32(column * 313 + row * 7919) % 4]


class CharacterField:
    """One retained canvas image. Timers stop when paused or the widget is destroyed."""
    def __init__(self, canvas):
        self.canvas = canvas
        self.item = canvas.create_image(0, 0, anchor='nw', tags='character-field')
        self.image = None
        self.elapsed = 0.0
        self.frames = 0
        self.paused, self.hidden = True, False
        self.timer = None
        self.last = time.monotonic()
        canvas.bind('<Configure>', lambda event: self.paint(), add='+')
        canvas.bind('<Destroy>', lambda event: self.close() if event.widget == canvas else None, add='+')

    def paint(self):
        if self.hidden or not self.canvas.winfo_exists():
            return
        width, height = self.canvas.winfo_width(), self.canvas.winfo_height()
        if width < 2 or height < 2:
            return
        cw = max(10, math.ceil(width / 180))
        ch = round(cw * 1.6)
        columns = math.ceil(width / cw)
        image = Image.new('RGB', (width, height), '#222222')
        draw = ImageDraw.Draw(image)
        font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf', round(cw * 1.12))
        for row in range(math.ceil(height / ch) + 1):
            for col in range(columns):
                glyph, shade = cell(col, row, columns, self.elapsed)
                draw.text((col * cw, row * ch), glyph, fill=shade, font=font, anchor='lt')
        self.image = ImageTk.PhotoImage(image)
        self.canvas.itemconfigure(self.item, image=self.image, state='normal')
        self.canvas.tag_lower(self.item)
        self.position()
        self.frames += 1

    def position(self):
        self.canvas.coords(self.item, 0, self.canvas.canvasy(0))

    def configure(self, *, paused, hidden):
        changed = (paused, hidden) != (self.paused, self.hidden)
        self.paused, self.hidden = paused, hidden
        self.close()
        self.canvas.itemconfigure(self.item, state='hidden' if hidden else 'normal')
        if changed or self.image is None:
            self.paint()
        self.last = time.monotonic()
        if not paused and not hidden:
            self.timer = self.canvas.after(160, self.tick)

    def tick(self):
        self.timer = None
        if self.paused or self.hidden:
            return
        now = time.monotonic()
        self.elapsed += min(now - self.last, .2)
        self.last = now
        self.paint()
        self.timer = self.canvas.after(160, self.tick)

    def close(self):
        if self.timer is not None:
            self.canvas.after_cancel(self.timer)
            self.timer = None
