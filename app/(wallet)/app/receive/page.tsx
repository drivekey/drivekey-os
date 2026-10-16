'use client';
import {WalletHeader,WalletFooter,ReceivePanel} from '@/components/wallet-chrome';
import {WalletPageHeader} from '@/components/wallet-page-header';
export default function ReceivePage(){return <div className="wallet-app"><WalletHeader/><main id="main" className="wallet-page"><WalletPageHeader title="Receive"/><section className="wallet-card receive-card"><ReceivePanel/></section></main><WalletFooter/></div>;}
