"""Clock tests never change the host clock, access wallets, or submit transactions."""
import datetime as dt
import importlib.util
import pathlib
import sys
import unittest
from unittest.mock import patch

root = pathlib.Path(__file__).resolve().parents[1] / 'packaging'
sys.path.insert(0, str(root))
import drivekey_clock as clock
spec = importlib.util.spec_from_file_location('terminal', root/'drivekey-terminal.py')
terminal = importlib.util.module_from_spec(spec)
spec.loader.exec_module(terminal)


class ClockTests(unittest.TestCase):
    def test_utc_identity(self):
        self.assertEqual(clock.parse_clock('2026-09-12 12:33:00').isoformat(), '2026-09-12T12:33:00+00:00')

    def test_iso_milliseconds(self):
        self.assertEqual(clock.parse_clock('2026-09-12T15:28:44.108Z').isoformat(), '2026-09-12T15:28:44.108000+00:00')

    def test_iso_seconds(self):
        self.assertEqual(clock.parse_clock('2026-09-12T15:28:44Z').hour, 15)

    def test_optional_seconds(self):
        self.assertEqual(clock.parse_clock('2026-09-12 00:30').isoformat(), '2026-09-12T00:30:00+00:00')

    def test_utc_has_no_local_dst_conversion(self):
        for value in ('2026-10-25 02:30:00','2026-03-29 02:30:00'):
            self.assertEqual(clock.parse_clock(value).hour,2)

    def test_utc_suffix_and_whitespace(self):
        self.assertEqual(clock.parse_clock(' 2026-09-12 15:28:44 UTC ').hour,15)

    def test_strict_input(self):
        for value in ('2 hours ago','2026-09-12 25:00:00','2026-02-30 00:00:00',
                      '2026-09-12T00:00:00+02:00','2026-09-12T00:00:00',
                      '2026-09-12 12:00:00; reboot','1999-01-01 00:00:00'):
            with self.assertRaises(ValueError): clock.parse_clock(value)

    def test_unknown_zone(self):
        for zone in ('local','Europe/Warsaw','Europe/Zurich'):
            with self.assertRaises(ValueError): clock.parse_clock('2026-09-12 12:00:00',zone)

    def test_setter_refuses_all_calls_without_system_commands(self):
        with patch.object(clock.subprocess,'run') as run:
            for target in (None, clock.parse_clock('2026-09-12 12:00:00')):
                for elapsed in (-1, 0, 3, 301):
                    with self.assertRaisesRegex(RuntimeError, 'disabled'):
                        clock.apply_clock(target, elapsed)
            run.assert_not_called()

    def test_terminal_clock_is_read_only_even_under_local_timezone(self):
        class UI:
            def pages(self, title, lines):
                self.title, self.lines = title, lines
        ui = UI()
        with patch.dict(clock.os.environ, {'TZ': 'Europe/Warsaw'}):
            terminal.Terminal.clock(ui)
        self.assertEqual(ui.title, 'UTC CLOCK / READ ONLY')
        expected = dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%d %H:%M')
        self.assertTrue(ui.lines[0].startswith(expected))
        self.assertTrue(ui.lines[0].endswith(' UTC'))
        self.assertIn('Clock editing is disabled', '\n'.join(ui.lines))

    def test_existing_menu_numbers_preserved(self):
        self.assertEqual(terminal.MENU[6],'Safely shut down')
        self.assertEqual(terminal.MENU[7],'Multi-chain experimental tools')
        self.assertEqual(terminal.MENU[8],'UTC clock (read only)')

if __name__=='__main__': unittest.main()
