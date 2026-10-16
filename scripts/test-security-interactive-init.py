#!/usr/bin/python3
"""Fault-injection tests for guest init; never starts PID 1, a GUI, or a mount.

Actual descriptor failures are confined to ordinary subprocesses. Guest-only
operations are mocked before calling the supervisor or its cleanup helpers.
"""
import errno
import importlib.util
import json
import os
from pathlib import Path
import select
import subprocess
import sys
import tempfile
import textwrap
import types
import unittest
from unittest.mock import patch


SOURCE = Path(__file__).with_name('security-interactive-image-init.py')
spec = importlib.util.spec_from_file_location('interactive_init', SOURCE)
init = importlib.util.module_from_spec(spec)
spec.loader.exec_module(init)


class ExitObserved(BaseException):
    def __init__(self, status):
        self.status = status


class HoldObserved(BaseException):
    pass


class FailedStream:
    def write(self, value):
        raise OSError(errno.EIO, 'synthetic stream I/O failure')

    def flush(self):
        raise OSError(errno.EIO, 'synthetic stream flush failure')


class InitTests(unittest.TestCase):
    def test_healthy_descriptors_are_preserved(self):
        with patch.object(init.os, 'write', side_effect=lambda fd, data: len(data)) as write, \
             patch.object(init.os, 'open') as opened, patch.object(init.os, 'dup2') as duplicate:
            self.assertEqual(init.prepare_stdio(), 'inherited')
            self.assertEqual([call.args[0] for call in write.call_args_list], [1, 2])
            self.assertTrue(all(call.args[1] for call in write.call_args_list))
            opened.assert_not_called()
            duplicate.assert_not_called()

    def test_failed_descriptor_repairs_both_inherited_child_descriptors(self):
        # An ordinary subprocess owns this PTY and its bad fd1/fd2. No host
        # console, system log, guest filesystem, or process namespace is used.
        code = textwrap.dedent('''
            import importlib.util, json, os, pty, subprocess, sys
            from unittest.mock import patch
            spec=importlib.util.spec_from_file_location('guest_init', sys.argv[1])
            module=importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            master, slave=pty.openpty()
            original_open=os.open
            if sys.argv[3]=='eio':
                broken_master, broken_slave=pty.openpty()
                os.close(broken_master)
                os.dup2(broken_slave,1)
                os.dup2(broken_slave,2)
                os.close(broken_slave)
            else:
                with open('/dev/full','wb',buffering=0) as failed:
                    os.dup2(failed.fileno(),1)
                    os.dup2(failed.fileno(),2)
            def isolated_open(path, flags, *args):
                if path=='/dev/tty0':
                    return os.dup(slave)
                if path.startswith('/dev/'):
                    raise AssertionError('Unexpected device open: '+path)
                return original_open(path,flags,*args)
            with patch.object(module.os,'open',side_effect=isolated_open):
                sink=module.prepare_stdio()
            child=subprocess.run([sys.executable,'-I','-B','-c',
                'import sys; print("synthetic policy stdout"); print("synthetic policy stderr",file=sys.stderr)'],check=False)
            sys.stdout.flush()
            sys.stderr.flush()
            with open(sys.argv[2],'w') as result:
                json.dump({'sink':sink,'childExitCode':child.returncode,'bothAreTTY':os.isatty(1) and os.isatty(2)},result)
        ''')
        with tempfile.TemporaryDirectory() as folder:
            for kind in ('eio', 'enospc'):
                with self.subTest(actualFailure=kind):
                    target = Path(folder) / (kind + '.json')
                    result = subprocess.run([sys.executable, '-I', '-B', '-c', code, str(SOURCE), str(target), kind],
                                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=10, check=False)
                    self.assertEqual(result.returncode, 0, result.stderr.decode(errors='replace'))
                    self.assertEqual(json.loads(target.read_text()),
                                     {'sink': '/dev/tty0', 'childExitCode': 0, 'bothAreTTY': True})

    def test_failed_local_console_uses_null_and_rebinds_both_descriptors(self):
        def write(fd, data):
            if fd in (1, 2):
                raise OSError(errno.EIO, 'synthetic inherited console failure')
            return len(data)
        def opened(path, flags):
            if path == '/dev/tty0':
                raise OSError(errno.EIO, 'synthetic missing VT')
            self.assertEqual(path, '/dev/null')
            return 17
        with patch.object(init.os, 'write', side_effect=write), \
             patch.object(init.os, 'open', side_effect=opened), \
             patch.object(init.os, 'dup2') as duplicate, patch.object(init.os, 'close') as close:
            self.assertEqual(init.prepare_stdio(), '/dev/null')
            self.assertEqual([call.args for call in duplicate.call_args_list], [(17, 1), (17, 2)])
            close.assert_called_once_with(17)

    def test_no_healthy_sink_stops_startup(self):
        with patch.object(init.os, 'write', side_effect=OSError(errno.EIO, 'synthetic EIO')), \
             patch.object(init.os, 'open', side_effect=OSError(errno.EIO, 'synthetic EIO')):
            with self.assertRaisesRegex(RuntimeError, 'No usable'):
                init.prepare_stdio()

    def test_emitter_survives_failed_streams_and_unavailable_console(self):
        for error in (OSError(errno.EIO, 'synthetic EIO'),
                      OSError(errno.ENOSPC, 'synthetic full sink'),
                      BrokenPipeError(errno.EPIPE, 'synthetic broken pipe')):
            with self.subTest(error=type(error).__name__, errno=error.errno):
                with patch.object(init.os, 'write', side_effect=error), \
                     patch.object(init.os, 'open', side_effect=error), \
                     patch.object(init.sys, 'stdout', FailedStream()), \
                     patch.object(init.sys, 'stderr', FailedStream()):
                    self.assertIsNone(init.emit('bounded public synthetic diagnostic'))
                    self.assertIsNone(init.emit('bounded public synthetic diagnostic', visible=True))

    def test_emitter_bounds_diagnostic_and_does_not_flush_python_streams(self):
        with patch.object(init.os, 'write', side_effect=lambda fd, data: len(data)) as write, \
             patch.object(init.sys, 'stdout', FailedStream()), patch.object(init.sys, 'stderr', FailedStream()):
            init.emit('X' * 100000)
            self.assertEqual(write.call_count, 1)
            self.assertLessEqual(len(write.call_args.args[1]), 6001)

    def test_child_uses_immediate_exit_even_if_flushes_fail(self):
        for failure, expected in ((None, 1), (RuntimeError('synthetic startup failure'), 1),
                                  (SystemExit(0), 1), (KeyboardInterrupt(), 1)):
            with self.subTest(failure=type(failure).__name__):
                with patch.object(init, 'main', side_effect=failure), \
                     patch.object(init, 'emit'), \
                     patch.object(init.sys, 'stdout', FailedStream()), \
                     patch.object(init.sys, 'stderr', FailedStream()), \
                     patch.object(init.os, '_exit', side_effect=lambda status: (_ for _ in ()).throw(ExitObserved(status))):
                    with self.assertRaises(ExitObserved) as caught:
                        init.run_child()
                    self.assertEqual(caught.exception.status, expected)

    def test_actual_bad_descriptors_do_not_turn_child_error_into_exit_120(self):
        code = textwrap.dedent('''
            import errno, importlib.util, sys
            from unittest.mock import patch
            spec=importlib.util.spec_from_file_location('guest_init', sys.argv[1])
            module=importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            def fail():
                raise RuntimeError('synthetic startup failure')
            with patch.object(module, 'main', side_effect=fail), patch.object(module.os, 'open', side_effect=OSError(errno.EIO, 'synthetic missing console')):
                module.run_child()
            raise AssertionError('run_child returned')
        ''')
        with open('/dev/full', 'wb', buffering=0) as failed:
            result = subprocess.run([sys.executable, '-I', '-B', '-c', code, str(SOURCE)],
                                    stdout=failed, stderr=failed, timeout=10, check=False)
        self.assertEqual(result.returncode, 1)

    def test_cleanup_attempts_every_stage_despite_independent_failures(self):
        with patch.object(init, 'drain_children', side_effect=OSError(errno.EIO, 'synthetic reap failure')), \
             patch.object(init, 'exchange_mounted', side_effect=[True, OSError(errno.EIO, 'synthetic mount read failure')]), \
             patch.object(init.subprocess, 'run', side_effect=[subprocess.TimeoutExpired('sync', 30), OSError(errno.EIO, 'synthetic unmount failure')]) as run:
            result = init.cleanup(1)
        self.assertEqual([call.args[0][1] for call in run.call_args_list], ['sync', 'umount'])
        self.assertTrue(all(call.kwargs.get('timeout', 0) > 0 for call in run.call_args_list))
        self.assertFalse(result['childrenReaped'])
        self.assertEqual(result['exitCode'], 1)
        self.assertEqual(result['syncExitCode'], -1)
        self.assertEqual(result['unmountExitCode'], -1)
        self.assertTrue(result['exchangeStillMounted'])
        self.assertFalse(result['shutdownPassed'])
        self.assertEqual(len(result['cleanupErrors']), 4)

    def test_successful_cleanup_cannot_reinterpret_child_failure(self):
        with patch.object(init, 'drain_children', return_value=True), \
             patch.object(init, 'exchange_mounted', side_effect=[True, False]), \
             patch.object(init.subprocess, 'run', return_value=types.SimpleNamespace(returncode=0)):
            result = init.cleanup(120)
        self.assertEqual(result['exitCode'], 120)
        self.assertFalse(result['shutdownPassed'])

    def test_successful_cleanup_requires_every_independent_condition(self):
        for clean, sync, unmount, remains in [(False, 0, 0, False), (True, 1, 0, False),
                                            (True, 0, 1, False), (True, 0, 0, True),
                                            (True, 0, 0, False)]:
            with self.subTest(clean=clean, sync=sync, unmount=unmount, remains=remains):
                with patch.object(init, 'drain_children', return_value=clean), \
                     patch.object(init, 'exchange_mounted', side_effect=[True, remains]), \
                     patch.object(init.subprocess, 'run', side_effect=[types.SimpleNamespace(returncode=sync), types.SimpleNamespace(returncode=unmount)]):
                    result = init.cleanup(0)
                self.assertEqual(result['shutdownPassed'], clean and sync == 0 and unmount == 0 and not remains)

    def test_host_rejection_precedes_descriptor_or_process_mutation(self):
        with patch.object(init, 'require_guest_pid1', side_effect=RuntimeError('not a guest')), \
             patch.object(init, 'prepare_stdio') as prepare, patch.object(init.os, 'fork') as fork, \
             patch.object(init, 'cleanup') as cleanup, patch.object(init, 'hold_failure') as hold:
            with self.assertRaisesRegex(RuntimeError, 'not a guest'):
                init.supervise()
        prepare.assert_not_called()
        fork.assert_not_called()
        cleanup.assert_not_called()
        hold.assert_not_called()

    def test_unknown_guest_identity_holds_without_cleanup_or_other_effects(self):
        with patch.object(init.sys, 'platform', 'linux'), patch.object(init.os, 'getpid', return_value=1), \
             patch.object(init.os, 'geteuid', return_value=0), \
             patch.object(init, 'Path') as path, \
             patch.object(init, 'prepare_stdio') as prepare, patch.object(init.os, 'fork') as fork, \
             patch.object(init, 'cleanup') as cleanup, patch.object(init.subprocess, 'run') as run, \
             patch.object(init, 'hold_failure', side_effect=HoldObserved()) as hold:
            path.return_value.read_text.side_effect = OSError(errno.EIO, 'synthetic identity read failure')
            with self.assertRaises(HoldObserved):
                init.supervise()
        hold.assert_called_once()
        prepare.assert_not_called()
        fork.assert_not_called()
        cleanup.assert_not_called()
        run.assert_not_called()

    def test_guest_guard_failure_cannot_start_child_or_power_off_away_error(self):
        with patch.object(init, 'require_guest_pid1'), patch.object(init, 'prepare_stdio', return_value='inherited'), \
             patch.object(init, 'guard', side_effect=RuntimeError('synthetic policy failure')), \
             patch.object(init, 'emit'), patch.object(init.os, 'fork') as fork, \
             patch.object(init, 'cleanup', return_value={'shutdownPassed': False}) as cleanup, \
             patch.object(init, 'hold_failure', side_effect=HoldObserved()) as hold, \
             patch.object(init.subprocess, 'run') as run:
            with self.assertRaises(HoldObserved):
                init.supervise()
        fork.assert_not_called()
        cleanup.assert_called_once_with(1)
        self.assertGreaterEqual(hold.call_count, 1)
        run.assert_not_called()

    def test_wait_failure_stops_closed_and_does_not_restart_session(self):
        with patch.object(init, 'require_guest_pid1'), patch.object(init, 'prepare_stdio', return_value='inherited'), \
             patch.object(init, 'guard'), patch.object(init, 'emit'), patch.object(init.os, 'fork', return_value=77) as fork, \
             patch.object(init.os, 'waitpid', side_effect=OSError(errno.ECHILD, 'synthetic wait failure')), \
             patch.object(init, 'run_child') as child, patch.object(init, 'cleanup', return_value={'shutdownPassed': False}) as cleanup, \
             patch.object(init, 'hold_failure', side_effect=HoldObserved()), patch.object(init.subprocess, 'run') as run:
            with self.assertRaises(HoldObserved):
                init.supervise()
        fork.assert_called_once()
        child.assert_not_called()
        cleanup.assert_called_once_with(1)
        run.assert_not_called()

    def test_nonzero_child_status_is_not_accepted_even_after_other_child_exit(self):
        with patch.object(init, 'require_guest_pid1'), patch.object(init, 'prepare_stdio', return_value='inherited'), \
             patch.object(init, 'guard'), patch.object(init, 'emit'), patch.object(init.os, 'fork', return_value=77), \
             patch.object(init.os, 'waitpid', side_effect=[InterruptedError(), (88, 0), (77, 120 << 8)]), \
             patch.object(init, 'cleanup', return_value={'shutdownPassed': False}) as cleanup, \
             patch.object(init, 'hold_failure', side_effect=HoldObserved()), patch.object(init.subprocess, 'run') as run:
            with self.assertRaises(HoldObserved):
                init.supervise()
        cleanup.assert_called_once_with(120)
        run.assert_not_called()

    def test_cleanup_exception_or_returned_poweroff_enters_hold(self):
        for failure in (RuntimeError('synthetic cleanup failure'), None):
            with self.subTest(cleanupFailure=failure is not None):
                with patch.object(init, 'require_guest_pid1'), patch.object(init, 'prepare_stdio', return_value='inherited'), \
                     patch.object(init, 'guard'), patch.object(init, 'emit'), patch.object(init.os, 'fork', return_value=77), \
                     patch.object(init.os, 'waitpid', return_value=(77, 0)), \
                     patch.object(init, 'cleanup', side_effect=failure, return_value={'shutdownPassed': True}), \
                     patch.object(init, 'hold_failure', side_effect=HoldObserved()), \
                     patch.object(init.subprocess, 'run', return_value=types.SimpleNamespace(returncode=0)) as run:
                    with self.assertRaises(HoldObserved):
                        init.supervise()
                if failure:
                    run.assert_not_called()
                else:
                    self.assertEqual(run.call_args.args[0], ['/usr/bin/busybox', 'poweroff', '-f'])
                    self.assertGreater(run.call_args.kwargs['timeout'], 0)

    def test_failure_hold_survives_repeated_interrupted_waits(self):
        code = textwrap.dedent('''
            import importlib.util, os, sys, time
            spec=importlib.util.spec_from_file_location('guest_init',sys.argv[1])
            module=importlib.util.module_from_spec(spec)
            spec.loader.exec_module(module)
            original_sleep=time.sleep
            attempts=0
            def interrupted_sleep(seconds):
                global attempts
                attempts+=1
                if attempts==5:
                    os.write(1,b'HOLD_RETRIED\\n')
                original_sleep(.005)
                raise InterruptedError('synthetic interrupted wait')
            module.emit=lambda *args,**kwargs: None
            module.time.sleep=interrupted_sleep
            module.hold_failure('synthetic failure')
            os._exit(88)
        ''')
        process = subprocess.Popen([sys.executable, '-I', '-B', '-c', code, str(SOURCE)],
                                   stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            ready, _, _ = select.select([process.stdout], [], [], 5)
            self.assertTrue(ready, 'Hold did not survive five injected interruptions')
            self.assertEqual(process.stdout.readline(), b'HOLD_RETRIED\n')
            with self.assertRaises(subprocess.TimeoutExpired):
                process.communicate(timeout=.1)
        finally:
            process.kill()
            process.communicate(timeout=5)


if __name__ == '__main__':
    unittest.main()
