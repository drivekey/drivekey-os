"""Presentation of guarded, real inventory. No wallet reads or fabricated balances."""
def amount(value):
    return str(round(value/1048576,1))+' MiB'

def render(t, status, y, x, width, height):
    t.card(y,x,width,height,'DEVICE / VAULT STATE')
    if not status:
        t.paragraph(y+3,x+2,'Status unavailable. Open diagnostics before proceeding.',width-4,4)
        return
    row=y+3
    for key,label in [('eth','ETH / Robinhood'),('multi','Multi-chain')]:
        vault=status.get(key,{})
        states={'missing':'Not created','locked':'Present / locked','invalid':'Invalid file - inspect','unreadable':'Cannot read'}
        t.put(row,x+2,label,t.strong)
        t.put(row+1,x+2,states.get(vault.get('state'),'Unavailable'),t.dim)
        row+=3
    req=status.get('requests',{})
    t.put(row,x+2,'REQUEST FILES',t.strong)
    t.put(row+1,x+2,'ETH: '+req.get('eth','unknown')+' / Multi: '+req.get('multi','unknown'),t.dim)
    t.put(row+2,x+2,'Presence only; review validates.',t.dim)
    row+=4
    storage=status.get('storage')
    t.put(row,x+2,'EXCHANGE PARTITION',t.strong)
    if storage:
        t.put(row+1,x+2,storage['source']+' / '+storage['filesystem'],t.dim)
        t.put(row+2,x+2,amount(storage['availableBytes'])+' free / '+amount(storage['totalBytes']),t.dim)
    else:t.put(row+1,x+2,'Storage details unavailable',t.dim)
    if height>=23:
        t.put(y+height-4,x+2,'Balance unavailable offline.',t.strong)
        t.put(y+height-3,x+2,'No online balance lookup.',t.dim)

