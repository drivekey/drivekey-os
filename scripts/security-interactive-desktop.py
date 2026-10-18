#!/usr/bin/python3
"""Visible session and display preferences around the confined-worker desktop."""
import importlib.util
import json
import os
from pathlib import Path
import sys


def main():
    if sys.argv[1:] or sys.platform != 'linux' or os.getuid() != 1000:
        raise ValueError('Unprivileged interactive guest session required')
    if 'drivekey.interactive=1' not in Path('/proc/cmdline').read_text().split():
        raise ValueError('Interactive guest boot marker missing')
    entry = Path('/opt/drivekey/security-candidate-original-gui.py')
    spec = importlib.util.spec_from_file_location('candidate_desktop', entry)
    candidate = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(candidate)
    # create() validates the full immutable baseline and mandatory broker first.
    desktop, root, app = candidate.create()
    image_id = Path('/etc/drivekey-interactive-image').read_text().strip()
    settings_spec = importlib.util.spec_from_file_location(
        'interactive_settings', '/opt/drivekey/security-interactive-settings.py')
    settings = importlib.util.module_from_spec(settings_spec)
    settings_spec.loader.exec_module(settings)
    settings.install(app, image_id)
    root.title('DriveKey — Interactive candidate · Funded release unavailable')
    # This minimal session has no window manager; size the real Tk window directly.
    root.overrideredirect(True)
    root.geometry(f'{root.winfo_screenwidth()}x{root.winfo_screenheight()}+0+0')
    def shutdown(event=None):
        if not app.busy:
            print('DRIVEKEY_INTERACTIVE_SHUTDOWN_CONFIRMATION', flush=True)
            app.shutdown()
    root.bind('<Control-Alt-q>', shutdown)
    root.bind('<Control-Alt-Q>', shutdown)
    app.shortcuts.configure(text='Alt+1–7 sections  ·  Tab focus  ·  Esc cancel  ·  Ctrl+Alt+Q shut down')
    def ready():
        root.update_idletasks()
        print('DRIVEKEY_INTERACTIVE_DESKTOP_READY ' + json.dumps({
            'uid': os.getuid(), 'imageId': image_id,
            'width': root.winfo_width(), 'height': root.winfo_height(),
            'fundingReady': False, 'productionReady': False,
        }), flush=True)
    root.after(300, ready)
    previous = None
    sequence = 0
    def view_state():
        nonlocal previous, sequence
        dialog = bool(int(root.tk.call('winfo', 'exists', '.__tk__messagebox'))) and bool(int(root.tk.call('winfo', 'ismapped', '.__tk__messagebox')))
        preferences = (app.font_family.get(), bool(app.large_text.get()),
                       bool(app.reduced_motion.get()), bool(app.low_effects.get()))
        state = (app.section, not app.busy and app.mode == 'section' and not app.settings_modal,
                 dialog, bool(app.settings_modal), *preferences)
        if state != previous:
            root.update_idletasks()
            sequence += 1
            print('DRIVEKEY_INTERACTIVE_VIEW_STATE ' + json.dumps({
                'sequence': sequence, 'section': state[0], 'idle': state[1], 'messageboxMapped': state[2],
                'settingsOpen': state[3],
                'displayPreferences': dict(zip(('font', 'largeText', 'reducedMotion', 'lowEffects'), preferences)),
                'settingsButtonBounds': [app.settings_button.winfo_rootx() - root.winfo_rootx(),
                                         app.settings_button.winfo_rooty() - root.winfo_rooty(),
                                         app.settings_button.winfo_width(), app.settings_button.winfo_height()],
            }), flush=True)
            previous = state
        root.after(100, view_state)
    root.after(400, view_state)
    root.after(500, root.focus_force)
    root.mainloop()
    return app.exit_code


if __name__ == '__main__':
    raise SystemExit(main())
