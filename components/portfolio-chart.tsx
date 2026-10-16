"use client";
import { useId, useRef, useState } from "react";
import { formatUnits } from "ethers";
import { allocation, usd, type Holding } from "@/core/portfolio";
import { TerminalBar } from "./terminal-chrome";

export function PortfolioChart({ holdings, now, onSend, onReceive }: { holdings: Holding[]; now: number; onSend: (holding: Holding) => void; onReceive: (holding: Holding) => void }) {
  const [expanded, setExpanded] = useState(true), [selected, setSelected] = useState<string | null>(null);
  const toggle = useRef<HTMLButtonElement>(null), id = useId().replace(/:/g, "");
  const model = allocation(holdings, now), selectedAsset = model.items.find(h => h.id === selected);
  let start = -Math.PI / 2;
  const slices = model.items.filter(h => h.share !== null && h.share > 0).map(h => {
    const span = h.share! * 2 * Math.PI, end = start + span, mid = start + span / 2;
    const path = span >= Math.PI * 2 - .00001 ? "M 150 30 A 120 120 0 1 1 150 270 A 120 120 0 1 1 150 30" : `M150 150 L${150 + 120 * Math.cos(start)} ${150 + 120 * Math.sin(start)} A120 120 0 ${span > Math.PI ? 1 : 0} 1 ${150 + 120 * Math.cos(end)} ${150 + 120 * Math.sin(end)} Z`;
    start = end; return { h, path, mid };
  });
  function choose(asset: Holding) { setExpanded(true); setSelected(asset.id); }
  const glyphRows = Array.from({length: 33}, (_, y) => Array.from({length: 65}, (_, x) => {
    const dx=(x-32)/31,dy=(y-16)/15,d=dx*dx+dy*dy;
    if(d>1)return " ";
    const angle=(Math.atan2(dy,dx)+Math.PI/2+Math.PI*2)%(Math.PI*2);
    let sum=0,index=0;
    for(let i=0;i<slices.length;i++){sum+=slices[i].h.share!*Math.PI*2;if(angle<=sum){index=i;break;}}
    const light=Math.max(.12,Math.min(1,.35+.65*Math.sqrt(1-d)-.28*dx-.28*dy));
    const shade=slices.length?[1,.55,.78,.4][index%4]:.65;
    return <span key={x} style={{opacity:light*shade}}>·</span>;
  })).map((row,y)=><span key={y}>{row}{"\n"}</span>);
  return <section className={`portfolio-panel ${expanded ? "expanded" : ""}`} aria-label="Portfolio allocation" onKeyDown={e => { if (e.key === "Escape") { setExpanded(false); toggle.current?.focus(); } }}>
    <TerminalBar name="vault / multichain"/>
    <div className="portfolio-title"><div><span>ASSETS / ALLOCATION</span><h2>{model.total > 0n ? usd(model.total) : model.partial ? "Value unavailable" : "No priced holdings"}</h2><p>{model.partial ? "Partial value · shares of priced holdings only" : "USD value · priced holdings"}</p></div><button ref={toggle} type="button" aria-expanded={expanded} aria-controls={`${id}-details`} onClick={() => setExpanded(!expanded)}>{expanded ? "Collapse −" : "Explore allocation +"}</button></div>
    <div className="portfolio-grid"><div className="pizza-stage"><pre className="multi-character-chart" aria-hidden="true">{glyphRows}</pre><svg viewBox="0 0 300 320" role="group" aria-label="Select an asset slice">
      <defs><radialGradient id={`${id}-empty`} cx="30%" cy="20%"><stop stopColor="#363636"/><stop offset="1" stopColor="#101010"/></radialGradient><pattern id={`${id}-dots`} width="4" height="4" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".6" fill="#fff" opacity=".13"/></pattern>
      {slices.map(({h}, i) => <linearGradient key={h.id} id={`${id}-slice-${i}`} x1="0" y1="0" x2="1" y2="1"><stop stopColor={`hsl(150 4% ${88 - i % 5 * 12}%)`}/><stop offset="1" stopColor={`hsl(150 3% ${42 - i % 5 * 6}%)`}/></linearGradient>)}</defs>
      <ellipse cx="150" cy="176" rx="124" ry="126" fill="#000" opacity=".6"/>
      {!slices.length && <circle cx="150" cy="150" r="120" fill={`url(#${id}-empty)`} stroke="#555"/>}
      {slices.map(({h, path, mid}, i) => <g key={h.id} className="pizza-slice" style={{ transform: expanded ? `translate(${Math.cos(mid) * (selected === h.id ? 12 : 5)}px, ${Math.sin(mid) * (selected === h.id ? 12 : 5)}px)` : undefined }}>
        <path d={path} fill={`url(#${id}-slice-${i})`} stroke={selected === h.id ? "#fff" : "#171717"} strokeWidth={selected === h.id ? 2 : 1} role="button" tabIndex={0} aria-label={`${h.symbol}, ${h.network}, ${(h.share! * 100).toFixed(2)} percent of priced holdings`} aria-pressed={selected === h.id} onClick={() => choose(h)} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); choose(h); } }}/><path d={path} fill={`url(#${id}-dots)`} pointerEvents="none"/>
      </g>)}
      {!slices.length && <text x="150" y="154" textAnchor="middle" fill="#aaa" fontSize="11">{holdings.length ? "NO PRICE COVERAGE" : "NO ASSETS LOADED"}</text>}
    </svg>{!expanded&&<button type="button" className="chart-open-target" aria-label="Expand character allocation" onClick={()=>setExpanded(true)}/>}<span className="pizza-caption">{expanded ? "SELECT A SLICE / ESC TO COLLAPSE" : "CLICK TO EXPAND ←"}</span></div>
    <div className="holdings-column"><div className="holdings-label"><span>HOLDINGS</span><span>{model.items.length} ASSETS</span></div>{!model.items.length&&<p className="holdings-empty">No holdings loaded. Load your public wallet, then inspect and add SOL, ETH or a token below.</p>}<ul className="portfolio-list" aria-label="Asset list">{model.items.map(h => <li key={h.id}><button type="button" aria-pressed={selected === h.id} onClick={() => choose(h)}><span><strong>{h.symbol}</strong><small>{h.name} · {h.network}</small><code>{h.address === "native" ? "Native asset" : h.address.slice(0, 8) + "…" + h.address.slice(-6)}</code></span><span>{h.error?"Unavailable":formatUnits(h.quantity, h.decimals)}<small>{h.value === null ? "Value unavailable" : usd(h.value)}{h.stale ? " · stale" : ""}{h.error ? " · RPC error" : ""}</small></span></button></li>)}</ul>
    <div id={`${id}-details`} hidden={!expanded} className="asset-detail" aria-live="polite">{selectedAsset ? <><p>SELECTED / {selectedAsset.network.toUpperCase()}</p><h3>{selectedAsset.name}</h3><dl><dt>Quantity</dt><dd>{formatUnits(selectedAsset.quantity, selectedAsset.decimals)} {selectedAsset.symbol}</dd><dt>Estimated value</dt><dd>{selectedAsset.value === null ? "Unavailable" : usd(selectedAsset.value)}</dd><dt>Share of priced holdings</dt><dd>{selectedAsset.share === null ? "Unavailable" : (selectedAsset.share * 100).toFixed(2) + "%"}</dd><dt>Full identity</dt><dd><code>{selectedAsset.address}</code></dd><dt>Updated UTC</dt><dd>{selectedAsset.updatedAt}</dd></dl>{selectedAsset.warning && <p>{selectedAsset.warning}</p>}<div className="asset-actions"><button type="button" onClick={() => onReceive(selectedAsset)}>Receive ↙</button><button type="button" disabled={!selectedAsset.supported || !!selectedAsset.error} onClick={() => onSend(selectedAsset)}>Prepare transfer ↗</button></div></> : <p>Select an asset from the circle or list.</p>}</div></div></div>
  </section>;
}
