"use client";
import { useId } from 'react';
import Image from 'next/image';
import { HUSHER_CAPABILITY, type PaymentRoute as Route } from '@/core/payment-provider';
export function PaymentRoute({value,onChange,disabled=false}:{value:Route;onChange:(value:Route)=>void;disabled?:boolean}){
  const id=useId();
  return <section className="payment-route" aria-label="Payment route">
    <fieldset disabled={disabled}><legend>Choose the payment route</legend>
      <div className="route-options">
      <label className="route-option" data-selected={value==='direct'}><input type="radio" name={id} value="direct" checked={value==='direct'} onChange={()=>onChange('direct')}/><span className="route-content"><span className="route-identity"><span className="route-symbol" aria-hidden="true">↗</span><strong>Direct transfer</strong></span><small>Send directly to your recipient on a supported network.</small><span className="route-badge">Available · offline signing</span></span></label>
      <label className="route-option" data-selected={value==='husher'}><input type="radio" name={id} value="husher" checked={value==='husher'} onChange={()=>onChange('husher')}/><span className="route-content"><span className="route-identity"><Image src="/brand/husher-mark.png" width={32} height={32} alt="" unoptimized/><strong>Husher route</strong></span><small>Separate owner-only standard exchange. Private routing stays disabled.</small><span className="route-badge route-badge-pending">Use Husher workspace</span></span></label>
      </div>
    </fieldset>
    {value==='husher'&&<div className="provider-unavailable"><div role="status"><span className="provider-eyebrow">SEPARATE EXCHANGE FLOW</span><h3>Open the Husher workspace</h3><p>Standard exchanges have a dedicated owner-authenticated workflow. This direct payment cannot be rerouted automatically. Select Direct transfer here, or open Husher from the navigation.</p></div>
      <div className="provider-planned" aria-label="Planned flow, not available"><span>01 <b>Quote online</b></span><span>02 <b>Sign offline</b></span><span>03 <b>Verify & track</b></span></div>
      <p className="provider-context">Husher would provide the exchange. Privacy enhancement does not guarantee anonymity or settlement; provider review and KYC may apply.</p>
      <details><summary>Exchange requirements</summary><p>Provider instructions must be bound to the approved transaction. A request fingerprint does not authenticate Husher or guarantee delivery. DriveKey does not collect identity documents for this disabled route.</p></details>
      <div className="provider-links"><a href="https://docs.husher.io/" target="_blank" rel="noreferrer">Provider documentation ↗</a><a href="https://www.husher.io/api-terms" target="_blank" rel="noreferrer">API terms ↗</a></div>
      <small>No partnership or sponsorship is claimed.</small>
    </div>}
  </section>;
}
