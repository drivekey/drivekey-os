"""Reproduce shipped static fonts with build-only fonttools==4.60.2.

Input is the unmodified Google Fonts variable font at the commit in PROVENANCE.json.
The ISO only installs the two generated static fonts, never this build dependency.
"""
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

BASE = Path(__file__).resolve().parent
for weight, style in ((400, 'Regular'), (700, 'Bold')):
    source = TTFont(BASE / 'Nunito-Variable.ttf', recalcTimestamp=False)
    instance = instantiateVariableFont(source, {'wght': weight}, inplace=False,
                                      optimize=True, updateFontNames=True)
    # Use conventional family/subfamily pairs for Linux fontconfig and Tk.
    # All copyright and license name records remain untouched.
    for platform, encoding, language in ((3, 1, 0x409), (1, 0, 0)):
        for name_id, text in ((1, 'Nunito'), (2, style), (4, 'Nunito ' + style),
                              (6, 'Nunito-' + style), (16, 'Nunito'), (17, style)):
            instance['name'].setName(text, name_id, platform, encoding, language)
    instance['OS/2'].usWeightClass = weight
    instance['OS/2'].fsSelection &= ~((1 << 5) | (1 << 6))
    instance['OS/2'].fsSelection |= (1 << 5) if weight == 700 else (1 << 6)
    instance['head'].macStyle = 1 if weight == 700 else 0
    instance.save(BASE / ('Nunito-' + style + '.ttf'))
