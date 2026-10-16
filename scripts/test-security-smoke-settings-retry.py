#!/usr/bin/python3
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('smoke', Path(__file__).with_name('run-security-interactive-smoke.py'))
smoke = importlib.util.module_from_spec(spec)
spec.loader.exec_module(smoke)
audit_spec = importlib.util.spec_from_file_location('audit', Path(__file__).with_name('audit-security-interactive-smoke.py'))
audit = importlib.util.module_from_spec(audit_spec)
audit_spec.loader.exec_module(audit)


class RetryTests(unittest.TestCase):
    def test_busy_race_requires_later_observed_open(self):
        views = iter([{'idle': True, 'settingsOpen': False, 'sequence': 1},
                      {'idle': False, 'settingsOpen': False, 'sequence': 2},
                      {'idle': True, 'settingsOpen': False, 'sequence': 3},
                      {'idle': True, 'settingsOpen': True, 'sequence': 4}])
        clicks = []
        with patch.object(smoke.time, 'sleep'):
            opened = smoke.open_settings_when_idle(lambda: next(views), lambda v: clicks.append(v['sequence']), lambda: True)
        self.assertEqual(clicks, [1, 3])
        self.assertEqual(opened['sequence'], 4)

    def test_open_panel_never_clicked(self):
        clicks = []
        smoke.open_settings_when_idle(lambda: {'settingsOpen': True}, clicks.append, lambda: True)
        self.assertEqual(clicks, [])

    def test_busy_until_deadline_is_failure(self):
        clicks = []
        with patch.object(smoke.time, 'sleep'), patch.object(smoke.time, 'monotonic', side_effect=[0, 0, 2]):
            with self.assertRaises(TimeoutError):
                smoke.open_settings_when_idle(lambda: {'idle': False, 'settingsOpen': False}, clicks.append, lambda: True, timeout=1)
        self.assertEqual(clicks, [])

    def test_guest_exit_is_failure(self):
        with self.assertRaises(RuntimeError):
            smoke.open_settings_when_idle(lambda: {'idle': True, 'settingsOpen': False}, lambda v: self.fail('clicked exited guest'), lambda: False)


class RetryAuditTests(unittest.TestCase):
    def setUp(self):
        self.click = {'bounds': [10, 10, 20, 20], 'center': [20, 20]}
        self.baseline = {'sequence': 1, 'idle': True, 'settingsOpen': False, 'messageboxMapped': False,
                         'section': 'Files', 'settingsButtonBounds': self.click['bounds'], 'displayPreferences': {'font': 'Inter'}}
        self.states = [self.baseline, {**self.baseline, 'sequence': 2, 'idle': False},
                       {**self.baseline, 'sequence': 3}, {**self.baseline, 'sequence': 4, 'settingsOpen': True}]
        self.pointer = {'kind': 'pointer-click', 'target': 'Settings', **self.click}
        self.inputs = [{**self.pointer, 'observedSequence': seq} for seq in [1, 3]] + [{'kind': 'keys', 'qcodes': ['ret']}]

    def check(self):
        audit.audit_settings_input_trace(self.inputs, self.click, self.states, self.baseline, self.states[-1], [['ret']])

    def test_valid_retry_binds_to_serial(self):
        self.check()

    def test_busy_state_tamper_rejected(self):
        self.inputs[1]['observedSequence'] = 2
        with self.assertRaises(ValueError): self.check()

    def test_retry_after_open_rejected(self):
        self.inputs[1]['observedSequence'] = 4
        with self.assertRaises(ValueError): self.check()

    def test_repeated_sequence_rejected(self):
        self.inputs[1]['observedSequence'] = 1
        with self.assertRaises(ValueError): self.check()

    def test_changed_key_suffix_rejected(self):
        self.inputs[-1]['qcodes'] = ['esc']
        with self.assertRaises(ValueError): self.check()

    def test_legacy_one_click_supported(self):
        self.inputs = [self.pointer, self.inputs[-1]]
        self.check()


if __name__ == '__main__':
    unittest.main()
