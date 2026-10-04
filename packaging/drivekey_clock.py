"""UTC parsing compatibility. Clock mutation is disabled."""
import datetime as dt
import os
import pathlib
import re
import subprocess
import time

UTC = dt.timezone.utc


def parse_clock(value, zone='UTC'):
    if zone != 'UTC':
        raise ValueError('UTC only. Local timezones are not accepted.')
    value = value.strip()
    if re.fullmatch(r'\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?( UTC)?', value):
        plain = value.removesuffix(' UTC')
        target = dt.datetime.strptime(plain, '%Y-%m-%d %H:%M:%S' if len(plain) == 19 else '%Y-%m-%d %H:%M').replace(tzinfo=UTC)
    elif re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z', value):
        target = dt.datetime.fromisoformat(value.replace('Z', '+00:00'))
    else:
        raise ValueError('Use UTC: YYYY-MM-DD HH:MM:SS, or YYYY-MM-DDTHH:MM:SS.sssZ. Seconds are optional in the space-separated form.')
    if not 2000 <= target.year <= 2100:
        raise ValueError('Year must be between 2000 and 2100.')
    return target


def apply_clock(target, elapsed=0):
    # Compatibility entry point deliberately refuses every caller, including root.
    raise RuntimeError('Clock editing is disabled in this UTC-only release. Stop signing if the hardware clock is incorrect.')
