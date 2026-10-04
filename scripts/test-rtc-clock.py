"""Pure/mocked tests; never read or modify the host RTC or system time."""
import datetime as dt
import json
import pathlib
import sys
import tempfile
import unittest
from unittest.mock import patch
sys.path.insert(0,str(pathlib.Path(__file__).resolve().parents[1]/'packaging'))
import drivekey_rtc as rtc

class ClockTests(unittest.TestCase):
    def test_summer_photo(self):
        self.assertEqual(rtc.rtc_to_utc(dt.datetime(2026,10,4,10,19)).isoformat(),'2026-10-04T08:19:00+00:00')
    def test_winter(self):
        self.assertEqual(rtc.rtc_to_utc(dt.datetime(2026,1,4,10,19)).hour,9)
    def test_previous_date(self):
        self.assertEqual(rtc.rtc_to_utc(dt.datetime(2026,10,4,0,19)).isoformat(),'2026-10-03T22:19:00+00:00')
    def test_dst_ambiguity_and_gap_rejected(self):
        for wall in (dt.datetime(2026,10,25,2,30),dt.datetime(2026,3,29,2,30)):
            with self.assertRaisesRegex(ValueError,'ambiguous or invalid'):rtc.rtc_to_utc(wall)
    def test_dst_boundaries(self):
        for wall,hour in ((dt.datetime(2026,3,29,1,59),0),(dt.datetime(2026,3,29,3),1),
                          (dt.datetime(2026,10,25,1,59),23),(dt.datetime(2026,10,25,3),2)):
            self.assertEqual(rtc.rtc_to_utc(wall).hour,hour)
    def test_invalid_date(self):
        for wall in (dt.datetime(1999,1,1),dt.datetime(2101,1,1),dt.datetime.now(dt.timezone.utc)):
            with self.assertRaises(ValueError):rtc.rtc_to_utc(wall)
    def test_stale_or_shifted_clock(self):
        state=dict(version=1,rtcZone=rtc.ZONE,bootId='boot',epoch=1791100000,uptime=10)
        rtc.validate_state(state,'boot',1791100020,30)
        for boot,now,elapsed in [('old',1791100020,30),('boot',1791107220,30),('boot',1791092820,30),('boot',1791100000,1)]:
            with self.assertRaises(ValueError):rtc.validate_state(state,boot,now,elapsed)
    def test_repeat_boot_initialization_does_not_read_rtc_or_set_clock(self):
        # All system checks and the record are mocked. No host clock access.
        state=dict(version=1,rtcZone=rtc.ZONE,bootId='boot',epoch=1791100000,uptime=10)
        with tempfile.TemporaryDirectory() as directory:
            record=pathlib.Path(directory)/'state.json';record.write_text(json.dumps(state))
            original_read=pathlib.Path.read_text
            def read(path,*args,**kwargs):
                return {'/proc/sys/kernel/osrelease':'linux','/etc/drivekey-rtc-zone':rtc.ZONE,
                        '/proc/sys/kernel/random/boot_id':'boot','/proc/uptime':'30 0'}.get(str(path)) or original_read(path,*args,**kwargs)
            import builtins
            original_open=builtins.open
            def opened(path,*args,**kwargs):
                return original_open(pathlib.Path(directory)/'lock' if path=='/run/drivekey-clock.lock' else path,*args,**kwargs)
            info=type('Info',(),dict(st_mode=0o100644,st_uid=0))()
            with patch.object(rtc,'STATE',record),patch.object(rtc.os,'geteuid',return_value=0),patch.object(pathlib.Path,'is_file',return_value=True),patch.object(pathlib.Path,'lstat',return_value=info),patch.object(pathlib.Path,'read_text',read),patch('builtins.open',opened),patch.object(rtc.time,'time',return_value=1791100020),patch.object(rtc,'read_rtc') as readrtc,patch.object(rtc.time,'clock_settime') as setter:
                rtc.initialize();rtc.initialize()
                readrtc.assert_not_called();setter.assert_not_called()

if __name__=='__main__':unittest.main()
