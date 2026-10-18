#!/usr/bin/python3
"""Exercise generated shell failure handling without mounts, modules or PID 1.

Only the generated function definitions and individual mocked commands run.
Console paths are replaced with nonexistent temporary paths. Test process
groups are terminated after observing the hold, including their sleep child.
"""
import importlib.util
import os
from pathlib import Path
import pty
import signal
import subprocess
import tempfile
import unittest


BUILDER = Path(__file__).with_name('build-security-interactive-image.py')
SPEC = importlib.util.spec_from_file_location('interactive_image_builder', BUILDER)
BUILD = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUILD)
BUSYBOX = BUILD.BASE / 'usr/bin/busybox'
SCRIPT = BUILD.init_script(['modules/injected.ko'], 'DKI_1792150569207',
                           'interactive-20261016-r1792150569207')
PREFIX = SCRIPT.split('mark mount-runtime\n', 1)[0]


class GeneratedFailureHoldTests(unittest.TestCase):
    def exercise(self, body, expected=None, broken_output=False):
        with tempfile.TemporaryDirectory(prefix='drivekey-init-hold-') as directory:
            safe_prefix = PREFIX.replace('/newroot/dev/tty0', directory + '/missing-moved-tty')
            safe_prefix = safe_prefix.replace('/dev/tty0', directory + '/missing-tty')
            code = safe_prefix + body
            output = tempfile.TemporaryFile()
            slave = None
            if broken_output:
                master, slave = pty.openpty()
                os.close(master)
            process = subprocess.Popen([str(BUSYBOX), 'sh', '-c', code],
                                       stdout=slave if slave is not None else output,
                                       stderr=slave if slave is not None else output,
                                       start_new_session=True)
            if slave is not None:
                os.close(slave)
            try:
                with self.assertRaises(subprocess.TimeoutExpired):
                    process.wait(timeout=.2)
                output.seek(0)
                text = output.read().decode(errors='replace')
                if expected:
                    self.assertIn(expected, text)
                self.assertNotIn('UNREACHABLE', text)
            finally:
                if process.poll() is None:
                    os.killpg(process.pid, signal.SIGKILL)
                process.wait(timeout=2)
                output.close()

    def test_complete_generated_script_has_valid_busybox_syntax(self):
        subprocess.run([str(BUSYBOX), 'sh', '-n'], input=SCRIPT, text=True, check=True)

    def test_unhandled_command_failure_holds_with_stage_and_status(self):
        self.exercise('mark injected-command\n(exit 23)\nprintf UNREACHABLE\n',
                      'stage=injected-command status=23 reason=unhandled-init-exit')

    def test_module_failure_is_not_ignored(self):
        module_block = SCRIPT.split('mark load-injected.ko\n', 1)[1].splitlines()[0]
        self.exercise('insmod() { return 17; }\nmark load-injected.ko\n' + module_block
                      + '\nprintf UNREACHABLE\n',
                      'stage=load-injected.ko status=17 reason=module-load')

    def test_mount_failure_is_not_ignored(self):
        mount_line = next(line for line in SCRIPT.splitlines() if line.startswith('mount -t iso9660'))
        self.exercise('mount() { return 19; }\nboot_loop=/dev/not-used\nmark mount-boot-iso\n'
                      + mount_line + '\nprintf UNREACHABLE\n',
                      'stage=mount-boot-iso status=19 reason=iso-mount')

    def test_failed_exec_cannot_exit_shell(self):
        self.exercise('mark root-transition\nexec /not/a/drivekey/executable\n',
                      'stage=root-transition status=127 reason=unhandled-init-exit')

    def test_unexpected_clean_return_also_holds(self):
        self.exercise('mark premature-return\nexit 0\n',
                      'stage=premature-return status=0 reason=unhandled-init-exit')

    def test_failed_console_output_cannot_abort_hold(self):
        self.exercise('mark disconnected-console\nfalse\n', broken_output=True)

    def test_successful_exec_replaces_shell_without_triggering_hold(self):
        subprocess.run([str(BUSYBOX), 'sh', '-c', PREFIX + 'exec /usr/bin/true\n'],
                       check=True, timeout=2, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def test_normal_subshell_and_substitution_do_not_trigger_hold(self):
        body = '(umask 077; printf identity >/dev/null)\nvalue="$(printf stable)"\n'
        body += 'test "$value" = stable\nexec /usr/bin/true\n'
        subprocess.run([str(BUSYBOX), 'sh', '-c', PREFIX + body], check=True, timeout=2,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def test_unbound_variable_holds(self):
        self.exercise('mark unbound-value\nprintf "%s" "$DRIVEKEY_DELIBERATELY_MISSING"\n',
                      'stage=unbound-value status=2 reason=unhandled-init-exit')

    def test_module_path_cannot_inject_commands_or_diagnostics(self):
        with self.assertRaises(ValueError):
            BUILD.init_script(['modules/bad;false.ko'], 'DKI_1792150569207',
                              'interactive-20261016-r1792150569207')


if __name__ == '__main__':
    unittest.main()
