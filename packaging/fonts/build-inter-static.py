"""Reproduce local Inter static assets with build-only fonttools==4.60.2."""
from pathlib import Path
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

BASE=Path(__file__).resolve().parent
for weight,style in ((400,'Regular'),(500,'Medium'),(600,'SemiBold'),(700,'Bold')):
    source=TTFont(BASE/'Inter-Variable.ttf',recalcTimestamp=False)
    instance=instantiateVariableFont(source,{'opsz':14,'wght':weight},inplace=False,optimize=True,updateFontNames=True)
    # Tk's normal/bold API uses a genuine medium family alias for body copy.
    legacy_family='Inter' if weight in (400,700) else 'Inter '+style
    legacy_style=style if weight in (400,700) else 'Regular'
    for platform,encoding,language in ((3,1,0x409),(1,0,0)):
        for name_id,text in ((1,legacy_family),(2,legacy_style),(4,'Inter '+style),(6,'Inter-'+style),(16,'Inter'),(17,style)):
            instance['name'].setName(text,name_id,platform,encoding,language)
    instance['OS/2'].usWeightClass=weight
    instance['OS/2'].fsSelection &= ~((1<<5)|(1<<6))
    instance['OS/2'].fsSelection |= (1<<5) if weight==700 else (1<<6)
    instance['head'].macStyle=1 if weight==700 else 0
    instance.save(BASE/('Inter-'+style+'.ttf'))
