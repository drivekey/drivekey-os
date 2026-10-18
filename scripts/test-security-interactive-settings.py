#!/usr/bin/python3
"""Real Tk behavior tests against bounded, worker-free application state.

Run with xvfb-run -a python3 -B this-file.py --runtime-dir PATH. PATH is an
existing candidate rootfs/opt/drivekey directory, read only. No guest, wallet,
disk mount, subprocess worker, or persistent preference store is created.
"""
import argparse
import importlib.util
from pathlib import Path
import sys
import tkinter as tk
import unittest
from unittest.mock import patch


parser = argparse.ArgumentParser()
parser.add_argument('--runtime-dir', required=True, type=Path)
options, unittest_arguments = parser.parse_known_args()
sys.path.insert(0, str(options.runtime_dir.resolve()))


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


desktop = load('bounded_desktop_definitions', options.runtime_dir / 'drivekey-desktop.py')
settings = load('interactive_settings_tested', Path(__file__).with_name('security-interactive-settings.py'))
theme = desktop.theme
IMAGE_ID = 'interactive-20261016-r1792152477984'


class BoundedApp:
    # Exercise the real presentation methods without constructing the worker UI.
    select_font = desktop.DriveKeyDesktop.select_font
    apply_preferences = desktop.DriveKeyDesktop.apply_preferences
    sync_background = desktop.DriveKeyDesktop.sync_background

    def __init__(self, root):
        self.root = root
        self.busy, self.mode, self.section = False, 'section', 'Home'
        self.review, self.approved, self.action, self.settings_modal = None, False, None, None
        self.passphrase = tk.StringVar(root)
        self.confirmation = tk.StringVar(root)
        self.clock = tk.StringVar(root, value='2030-01-02 03:04:05 UTC')
        self.font_family = tk.StringVar(root, value='Inter')
        self.large_text = tk.BooleanVar(root, value=False)
        self.reduced_motion = tk.BooleanVar(root, value=False)
        self.low_effects = tk.BooleanVar(root, value=False)
        self.fields, self.reveal_timer = [], None
        self.appearance = {'base': 'Default'}
        self.canvas = tk.Canvas(root, height=180, scrollregion=(0, 0, 300, 1800))
        self.canvas.pack(fill='both', expand=True)
        self.settings_button = desktop.PillButton(root, 'Settings', self.forbidden)
        self.settings_button.pack()
        self.apply_preferences()

    def forbidden(self, *args, **kwargs):
        raise AssertionError('A non-presentation operation was attempted')

    worker = refresh = recovery = shutdown = clock_form = apply_appearance = forbidden


class SettingsBehavior(unittest.TestCase):
    def setUp(self):
        self.root = tk.Tk()
        self.root.geometry('1024x768+0+0')
        self.root_errors = []
        self.root.report_callback_exception = lambda *args: self.root_errors.append(args)
        self.app = BoundedApp(self.root)
        self.root.update()
        self.app.settings_button.focus_force()
        self.root.update()
        settings.install(self.app, IMAGE_ID)
        # A future accidental use of worker/process execution fails visibly.
        self.process_guard = patch.object(desktop.subprocess, 'Popen', side_effect=self.app.forbidden)
        self.process_guard.start()

    def tearDown(self):
        self.process_guard.stop()
        if self.app.settings_modal is not None:
            self.app.settings_modal.close()
        self.root.update_idletasks()
        errors = list(self.root_errors)
        self.root.destroy()
        self.assertEqual(errors, [], 'Tk callback raised an exception')

    def event(self, widget, sequence):
        widget.event_generate(sequence)
        self.root.update()

    def open_by_click(self):
        button = self.app.settings_button
        button.event_generate('<ButtonPress-1>', x=button.winfo_width() // 2,
                              y=button.winfo_height() // 2)
        button.event_generate('<ButtonRelease-1>')
        self.root.update()
        modal = self.app.settings_modal
        self.assertIsNotNone(modal)
        self.assertTrue(modal.window.winfo_ismapped())
        self.assertIs(modal.window.grab_current(), modal.window)
        return modal

    def activate(self, widget):
        widget.focus_force()
        self.root.update()
        self.event(widget, '<Return>')

    def preferences(self):
        return (self.app.font_family.get(), self.app.large_text.get(),
                self.app.reduced_motion.get(), self.app.low_effects.get())

    def test_actual_button_opens_and_escape_restores_focus_and_scroll(self):
        self.app.canvas.yview_moveto(.4)
        self.root.update()
        position = self.app.canvas.yview()[0]
        modal = self.open_by_click()
        self.assertIs(self.root.focus_get(), modal.done)
        self.event(modal.done, '<Escape>')
        self.assertIsNone(self.app.settings_modal)
        self.assertIsNone(self.root.grab_current())
        self.assertIs(self.root.focus_get(), self.app.settings_button)
        self.assertAlmostEqual(self.app.canvas.yview()[0], position, places=3)
        self.event(self.app.settings_button, '<Return>')
        self.assertIsNotNone(self.app.settings_modal)
        self.activate(self.app.settings_modal.done)
        self.assertIsNone(self.app.settings_modal)
        self.assertIs(self.root.focus_get(), self.app.settings_button)

    def test_real_font_and_size_change_existing_named_fonts_then_restore(self):
        modal = self.open_by_click()
        font = theme.shared_font(self.root, 11, True)
        original_size = int(font.cget('size'))
        self.activate(modal.controls['Nunito'])
        self.assertEqual(font.cget('family'), 'Nunito')
        self.assertEqual(self.app.font_family.get(), 'Nunito')
        self.activate(modal.controls['Larger text'])
        self.assertTrue(self.app.large_text.get())
        self.assertGreater(abs(int(font.cget('size'))), abs(original_size))
        self.activate(modal.controls['Reduced motion'])
        self.assertTrue(self.app.reduced_motion.get())
        self.assertFalse(theme.motion_enabled())
        self.activate(modal.controls['Low effects'])
        self.assertTrue(self.app.low_effects.get())
        for label in ('Larger text', 'Reduced motion', 'Low effects'):
            self.activate(modal.controls[label])
        self.activate(modal.controls['Inter'])
        self.assertEqual(self.preferences(), ('Inter', False, False, False))
        self.assertEqual(int(font.cget('size')), original_size)

    def test_protected_states_reject_click_even_after_legacy_background_reenables(self):
        cases = [('busy', True), ('mode', 'review'), ('review', {'public': 'review'}),
                 ('approved', True), ('action', 'sign'), ('passphrase', 'synthetic'),
                 ('confirmation', 'synthetic')]
        for key, value in cases:
            with self.subTest(state=key):
                target = getattr(self.app, key)
                original = target.get() if isinstance(target, tk.Variable) else target
                if isinstance(target, tk.Variable):
                    target.set(value)
                else:
                    setattr(self.app, key, value)
                self.app.sync_background()
                self.event(self.app.settings_button, '<ButtonPress-1>')
                self.assertIsNone(self.app.settings_modal)
                if isinstance(target, tk.Variable):
                    target.set(original)
                else:
                    setattr(self.app, key, original)
        self.app.sync_background()
        self.open_by_click()

    def test_becoming_protected_while_open_rejects_font_and_toggle_without_mutation(self):
        modal = self.open_by_click()
        original = self.preferences()
        for key, value in [('busy', True), ('review', {'public': 'review'}), ('approved', True)]:
            with self.subTest(state=key):
                previous = getattr(self.app, key)
                setattr(self.app, key, value)
                self.activate(modal.controls['Nunito'])
                for label in ('Larger text', 'Reduced motion', 'Low effects'):
                    self.activate(modal.controls[label])
                self.assertEqual(self.preferences(), original)
                self.assertEqual([variable.get() for variable in modal.values.values()], [False] * 3)
                setattr(self.app, key, previous)

    def test_keyboard_order_scrolls_small_screen_and_traps_focus(self):
        self.root.geometry('640x480+0+0')
        self.root.update()
        modal = self.open_by_click()
        self.assertIs(self.root.focus_get(), modal.done)
        for label in ('Inter', 'Nunito', 'Larger text', 'Reduced motion', 'Low effects', 'Done'):
            self.event(self.root.focus_get(), '<Tab>')
            self.assertIs(self.root.focus_get(), modal.controls[label])
        self.assertGreater(modal.canvas.yview()[0], 0)
        self.event(modal.done, '<Shift-Tab>')
        self.assertIs(self.root.focus_get(), modal.controls['Low effects'])
        self.event(self.root.focus_get(), '<Escape>')
        self.assertIsNone(self.app.settings_modal)

    def test_repeated_open_and_close_has_one_modal_and_no_binding_leak(self):
        before = self.root.bind('<Configure>')
        for _ in range(3):
            modal = self.open_by_click()
            self.app.open_settings()
            self.root.update()
            self.assertIs(self.app.settings_modal, modal)
            self.assertEqual(sum(isinstance(child, tk.Toplevel) for child in self.root.winfo_children()), 1)
            self.activate(modal.done)
            self.assertEqual(self.root.bind('<Configure>').strip(), before.strip())
            self.assertFalse(any(isinstance(child, tk.Toplevel) for child in self.root.winfo_children()))

    def test_panel_has_only_session_controls_and_live_read_only_info(self):
        modal = self.open_by_click()
        def descendants(widget):
            for child in widget.winfo_children():
                yield child
                yield from descendants(child)
        all_widgets = list(descendants(modal.window))
        self.assertFalse(any(isinstance(widget, (tk.Entry, tk.Text, tk.Spinbox)) for widget in all_widgets))
        actionable = [widget for widget in all_widgets
                      if isinstance(widget, (desktop.PillButton, desktop.Toggle, tk.Button))]
        self.assertEqual({str(widget.cget('text')) for widget in actionable},
                         {'Done', 'Inter', 'Nunito', 'Larger text', 'Reduced motion', 'Low effects'})
        labels = [widget for widget in all_widgets if isinstance(widget, tk.Label)]
        self.assertTrue(any(IMAGE_ID in str(widget.cget('text')) for widget in labels))
        clock_labels = [widget for widget in labels if str(widget.cget('textvariable')) == str(self.app.clock)]
        self.assertEqual(len(clock_labels), 1)
        self.app.clock.set('2030-01-02 03:04:06 UTC')
        self.root.update()
        self.assertEqual(clock_labels[0].cget('text'), self.app.clock.get())


if __name__ == '__main__':
    unittest.main(argv=[sys.argv[0], *unittest_arguments])
