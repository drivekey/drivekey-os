'use client';
import {useEffect,useState} from 'react';
import ManualWorkflow from './manual-workflow';
import PaymentsWorkspace from './payments-workspace';
import {usePublicWallet} from './wallet-context';
import {parsePaymentLink} from '@/core/payment-request';
export default function SendWorkspace(){const w=usePublicWallet(),[restore,setRestore]=useState(false);useEffect(()=>{const q=new URLSearchParams(location.search);setRestore(!!q.get('restore'));let network=q.get('network');if(location.hash.startsWith('#request=')){try{network=parsePaymentLink(location.href).network;}catch{/* The flow reports malformed links. */}}if(network==='robinhood'||network==='ethereum'||network==='solana')w.setNetwork(network);},[]);return restore||w.network!=='robinhood'?<PaymentsWorkspace mode="send"/>:<ManualWorkflow/>;}
