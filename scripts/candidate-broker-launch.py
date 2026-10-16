#!/usr/bin/python3
"""Mandatory candidate broker entrypoint; never accepts a selected executable."""
import os
import resource
import sys
if sys.platform!='linux' or sys.argv[1:] not in ([],['--diagnose']):raise SystemExit(1)
resource.setrlimit(resource.RLIMIT_CORE,(0,0))
os.execve('/opt/drivekey/node/bin/node',
 ['/opt/drivekey/node/bin/node','/opt/drivekey/drivekey-gui-worker.cjs',*sys.argv[1:]],
 {'LANG':'C','NODE_ENV':'production','HOME':'/nonexistent'})
