"use client";
import { Download } from 'lucide-react';
import { Button } from './ui';

export function ReleaseDownload({kind}:{kind:'image'|'companion'|'source'}) {
  const label=kind==='image'?'Offline release':kind==='companion'?'Companion release':'Source bundle';
  return <div className="dk-spaced"><Button variant="secondary" disabled><Download size={16}/>{label} pending</Button><p className="dk-small">Release verification is in progress. Research builds are not approved for real funds.</p><a href="/app/setup">View release status</a></div>;
}
