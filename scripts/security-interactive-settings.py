#!/usr/bin/python3
"""Session-only presentation settings for the interactive candidate desktop.

This module performs no media access, screenshot capture, worker operation,
theme import/export, host configuration, or persistent preference write.
"""
import re
import tkinter as tk

import drivekey_theme as theme
from drivekey_widgets import PillButton, SlimScrollbar, Toggle


def settings_allowed(app):
    return (not app.busy and app.mode == 'section' and not app.review
            and not app.approved and not app.action and not app.passphrase.get()
            and not app.confirmation.get())


class InteractiveSettings:
    def __init__(self, app, image_id):
        if not settings_allowed(app):
            raise RuntimeError('Settings unavailable during a protected operation')
        self.app, self.root, self.image_id = app, app.root, image_id
        self.previous_focus = self.root.focus_get()
        self.scroll_position = app.canvas.yview()[0]
        self.controls = {}
        self.values = {}
        self.root_binding = None
        self.focus_after = None
        self.window = tk.Toplevel(self.root)
        self.window.withdraw()
        try:
            self.window.overrideredirect(True)
            self.window.transient(self.root)
            self.window.configure(bg=theme.BG)
            self.window.protocol('WM_DELETE_WINDOW', self.close)
            self.window.bind('<Escape>', self.close)
            self.window.bind('<Tab>', lambda event: self.cycle_focus(1))
            self.window.bind('<Shift-Tab>', lambda event: self.cycle_focus(-1))
            try:
                self.window.bind('<ISO_Left_Tab>', lambda event: self.cycle_focus(-1))
            except tk.TclError:
                pass
            self.window.bind('<FocusIn>', self.reveal_focus, add='+')
            self.panel = tk.Frame(self.window, bg=theme.PANEL,
                                  highlightthickness=1, highlightbackground=theme.EDGE)
            self.build()
            self.root_binding = self.root.bind('<Configure>', self.root_resize, add='+')
            self.layout()
        except Exception:
            self.close()
            raise

    def text(self, parent, value, size=10, muted=False, bold=False, variable=None):
        label = tk.Label(parent, text=value, textvariable=variable, bg=theme.PANEL,
                         fg=theme.MUTED if muted else theme.FG,
                         font=theme.shared_font(self.root, size, bold),
                         anchor='w', justify='left')
        label.pack(fill='x', pady=(0, 8))
        label.bind('<Configure>', lambda event: label.configure(wraplength=max(40, event.width - 4)))
        return label

    def button(self, parent, title, command):
        button = PillButton(parent, title, command, compact=True)
        self.controls[title] = button
        return button

    def build(self):
        heading = tk.Frame(self.panel, bg=theme.PANEL, padx=18, pady=14)
        heading.pack(fill='x')
        self.text(heading, 'Settings', 14, bold=True)
        self.text(heading, 'Changes last for this session', muted=True)
        tk.Frame(self.panel, bg=theme.EDGE, height=1).pack(fill='x')
        footer = tk.Frame(self.panel, bg=theme.PANEL, padx=18, pady=12)
        footer.pack(side='bottom', fill='x')
        self.done = PillButton(footer, 'Done', self.close, compact=True)
        self.done.pack(side='right')
        tk.Frame(self.panel, bg=theme.EDGE, height=1).pack(side='bottom', fill='x')
        viewport = tk.Frame(self.panel, bg=theme.PANEL)
        viewport.pack(fill='both', expand=True)
        self.canvas = tk.Canvas(viewport, bg=theme.PANEL, bd=0, highlightthickness=0,
                                width=1, takefocus=False)
        scrollbar = SlimScrollbar(viewport, command=self.canvas.yview)
        scrollbar.pack(side='right', fill='y')
        self.canvas.pack(side='left', fill='both', expand=True)
        self.canvas.configure(yscrollcommand=scrollbar.set)
        self.content = tk.Frame(self.canvas, bg=theme.PANEL, padx=18, pady=16)
        item = self.canvas.create_window(0, 0, anchor='nw', window=self.content)
        self.canvas.bind('<Configure>', lambda event: self.canvas.itemconfigure(item, width=event.width))
        self.content.bind('<Configure>', lambda event: self.canvas.configure(
            scrollregion=(0, 0, self.canvas.winfo_width(), self.content.winfo_reqheight())))
        self.text(self.content, 'Interface font', bold=True)
        fonts = tk.Frame(self.content, bg=theme.PANEL)
        fonts.pack(fill='x', pady=(0, 12))
        for family in ('Inter', 'Nunito'):
            self.button(fonts, family, lambda selected=family: self.select_font(selected)).pack(
                side='left', padx=(0, 8))
        for title, name, note in (
            ('Larger text', 'large_text', 'Scale text and controls together.'),
            ('Reduced motion', 'reduced_motion', 'Keep transitions still.'),
            ('Low effects', 'low_effects', 'Use a plain background.'),
        ):
            row = tk.Frame(self.content, bg=theme.PANEL, pady=8)
            row.pack(fill='x')
            # Local variables avoid changing application state before the guard.
            value = tk.BooleanVar(self.window, value=bool(getattr(self.app, name).get()))
            self.values[name] = value
            control = Toggle(row, text=title, variable=value,
                             command=lambda key=name: self.apply_preference(key))
            control.pack(fill='x')
            self.controls[title] = control
            self.text(row, note, 9, muted=True)
            tk.Frame(self.content, bg=theme.EDGE, height=1).pack(fill='x')
        self.text(self.content, 'UTC clock (read only)', 10, bold=True).pack_configure(pady=(16, 8))
        self.text(self.content, '', variable=self.app.clock)
        self.text(self.content, 'Image: ' + self.image_id, 9, muted=True)
        self.text(self.content, 'Unfunded test candidate. Live release gates remain closed.', 9, muted=True)
        self.controls['Done'] = self.done
        self.sync_font_buttons()

    def layout(self):
        if self.window is None:
            return
        width, height = self.root.winfo_width(), self.root.winfo_height()
        self.window.geometry(f'{width}x{height}+{self.root.winfo_rootx()}+{self.root.winfo_rooty()}')
        self.panel.place(relx=.5, rely=.5, anchor='center',
                         width=max(240, min(720, width - 32)),
                         height=max(240, min(610, height - 32)))

    def root_resize(self, event):
        if event.widget is self.root:
            self.layout()

    def show(self):
        self.window.deiconify()
        self.window.lift()
        self.window.grab_set()
        self.focus_after = self.window.after_idle(self.focus_done)

    def focus_done(self):
        self.focus_after = None
        if self.window is not None:
            self.done.focus_force()

    def sync_font_buttons(self):
        selected = self.app.font_family.get()
        for family in ('Inter', 'Nunito'):
            self.controls[family].configure(bg=theme.ACTIVE if family == selected else theme.FIELD,
                                             fg=theme.FG,
                                             indicator=theme.ACCENT if family == selected else None)

    def select_font(self, family):
        if family not in ('Inter', 'Nunito'):
            raise ValueError('Unknown bundled font')
        if self.app.settings_modal is not self or not settings_allowed(self.app):
            return
        self.app.select_font(family)
        self.sync_font_buttons()

    def apply_preference(self, name):
        if name not in self.values:
            raise ValueError('Unknown session preference')
        if self.app.settings_modal is not self or not settings_allowed(self.app):
            self.values[name].set(bool(getattr(self.app, name).get()))
            return
        getattr(self.app, name).set(bool(self.values[name].get()))
        self.app.apply_preferences()

    def cycle_focus(self, direction):
        items = [control for control in self.controls.values()
                 if control.winfo_ismapped() and str(control.cget('state')) != 'disabled']
        if items:
            current = self.window.focus_get()
            index = items.index(current) if current in items else (-1 if direction > 0 else 0)
            items[(index + direction) % len(items)].focus_set()
        return 'break'

    def reveal_focus(self, event):
        if self.window is None or not str(event.widget).startswith(str(self.content)):
            return
        self.window.update_idletasks()
        y = event.widget.winfo_rooty() - self.content.winfo_rooty()
        top, height = self.canvas.canvasy(0), self.canvas.winfo_height()
        total = max(1, self.content.winfo_height())
        if y < top:
            self.canvas.yview_moveto(max(0, y - 8) / total)
        elif y + event.widget.winfo_height() > top + height:
            self.canvas.yview_moveto(max(0, y + event.widget.winfo_height() - height + 8) / total)

    def close(self, event=None):
        if self.window is None:
            return 'break'
        window, self.window = self.window, None
        if self.focus_after is not None:
            window.after_cancel(self.focus_after)
            self.focus_after = None
        if self.root_binding is not None:
            self.root.unbind('<Configure>', self.root_binding)
            self.root_binding = None
        if window.grab_current() is window:
            window.grab_release()
        window.destroy()
        if self.app.settings_modal is self:
            self.app.settings_modal = None
            self.app.sync_background()
        self.root.update_idletasks()
        self.app.canvas.yview_moveto(self.scroll_position)
        target = self.previous_focus
        try:
            if target is None or not target.winfo_exists():
                target = self.app.settings_button
            target.focus_force()
        except tk.TclError:
            pass
        return 'break'


def install(app, image_id):
    if not isinstance(image_id, str) or not re.fullmatch(r'interactive-[0-9]{8}-r[1-9][0-9]{9,19}', image_id):
        raise ValueError('Invalid interactive image identity')

    def open_settings():
        if app.settings_modal is not None:
            app.settings_modal.window.lift()
            return
        if not settings_allowed(app):
            return
        app.root.update_idletasks()
        if not settings_allowed(app):
            return
        modal = InteractiveSettings(app, image_id)
        app.settings_modal = modal
        try:
            app.sync_background()
            modal.show()
        except Exception:
            modal.close()
            raise

    app.open_settings = open_settings
    # PillButton keeps its callable as an attribute, not a Tk command option.
    app.settings_button.command = open_settings
    app.settings_button.configure(state='normal' if settings_allowed(app) else 'disabled')
