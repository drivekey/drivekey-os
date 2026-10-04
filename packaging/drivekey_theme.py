"""Offline presentation tokens. Font files are installed locally by ISO packaging."""
import tkinter.font as tkfont
from tkinter import TclError
import weakref
from drivekey_appearance import palette, preset

FONT_FAMILY = 'Inter'
MONO_FAMILY = 'DejaVu Sans Mono'
SPACE = 8
BG, PANEL, EDGE, FG, MUTED = '#101114', '#101114', '#22242d', '#fcfcfc', '#9093a6'
ACCENT, ACTIVE = '#7892ff', '#1b1d25'
# Accent is selective: navigation remains neutral; green/amber describe state.
SECTION_COLORS = {'Home':ACCENT, 'Wallet':'#e6b36a', 'Send':ACCENT,
                  'Swap':ACCENT, 'Receive':'#26dbac', 'Files':MUTED, 'Settings':ACCENT}
TINT = {name:ACTIVE for name in SECTION_COLORS}
TINT.update(success='#12372f', warning='#30271c', danger='#341e2b',
            info='#1b2034', neutral='#18181f')
# Pixel-sized typography stays crisp and consistent at different screen resolutions.
FONT_PIXELS = {8:10, 9:11, 10:12, 11:13, 12:14, 13:15, 14:16,
               15:16, 16:17, 17:18, 22:20}
_large_text = False
_motion = False
_fonts = {}
_widgets = weakref.WeakSet()

def set_palette(value):
    globals().update(palette(value))
    SECTION_COLORS.update(Home=ACCENT,Wallet=WARNING,Send=ACCENT,Swap=ACCENT,
                          Receive=ON,Files=MUTED,Settings=ACCENT)
    TINT.update({name:ACTIVE for name in SECTION_COLORS})
    TINT.update(success=ACTIVE,warning=FIELD,danger=FIELD,info=ACTIVE,neutral=FIELD)

set_palette(preset('Default'))


def ui_font(size=11, bold=False, mono=False):
    """Tuple API for newly rendered labels, entries, and tabs."""
    family = MONO_FAMILY if mono else ('Inter Medium' if FONT_FAMILY=='Inter' and not bold else FONT_FAMILY)
    pixels = max(14, FONT_PIXELS.get(size,size)) if mono else FONT_PIXELS.get(size,size)
    return (family, -(pixels + (3 if _large_text else 0)), 'bold' if bold else 'normal')


def shared_font(master, size=11, bold=False, mono=False):
    """A named font updates existing controls when the text-size setting changes."""
    key = (id(master.tk), size, bool(bold), bool(mono))
    if key not in _fonts:
        family, points, weight = ui_font(size, bold, mono)
        _fonts[key] = tkfont.Font(root=master, family=family, size=points, weight=weight)
    return _fonts[key]


def watch_theme(widget):
    _widgets.add(widget)


def set_large_text(enabled):
    """Update all shared fonts and notify controls that need to remeasure."""
    global _large_text
    _large_text = bool(enabled)
    _update_fonts()


def get_font_family():
    return FONT_FAMILY


def set_font_family(family):
    """Select only an installed, bundled face; never fetch fonts at runtime."""
    if family not in ('Inter','Nunito'):
        raise ValueError('Choose Inter or Nunito')
    global FONT_FAMILY
    FONT_FAMILY = family
    _update_fonts()


def motion_enabled():
    return _motion


def set_motion(enabled):
    """The desktop disables decorative motion during protected or reduced-motion states."""
    global _motion
    _motion = bool(enabled)
    for widget in tuple(_widgets):
        try:
            if widget.winfo_exists() and hasattr(widget,'motion_changed'):
                widget.motion_changed()
        except TclError:
            pass


def _update_fonts():
    for (_, size, bold, mono), typeface in tuple(_fonts.items()):
        family, points, weight = ui_font(size, bold, mono)
        try:
            typeface.configure(family=family, size=points, weight=weight)
        except TclError:
            # A test or previous window may already have destroyed its interpreter.
            pass
    for widget in tuple(_widgets):
        try:
            if widget.winfo_exists():
                if hasattr(widget,'theme_changed'):widget.theme_changed()
                else:widget.event_generate('<<DriveKeyThemeChanged>>', when='tail')
        except TclError:
            pass
