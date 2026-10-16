import { Headphones, Sparkles, Usb, PanelsTopLeft, ShieldCheck } from 'lucide-react';

const benefits = [
  { icon: Headphones, title: 'Support & access', items: [
    'Priority customer support.',
    'Personal onboarding and guided setup—without sharing your private keys.',
    'Early access to OS builds, features and integrations.',
    'Holder workshops, live demos, developer Q&As and security sessions.',
  ] },
  { icon: Sparkles, title: 'Swap fees & loyalty', items: [
    '0% DriveKey platform fees on swaps at qualifying tiers.',
    'Additional loyalty perks for maintaining eligibility over time.',
    'Input on which chains, integrations and features we prioritize.',
  ] },
  { icon: Usb, title: 'Hardware & founder editions', items: [
    'Discounts on DriveKey USBs, accessories and replacement devices.',
    'A free DriveKey USB at qualifying tiers once hardware launches.',
    'Limited founder editions, custom engraving and numbered devices.',
    'Hardware bundles with guided setup assistance.',
  ] },
  { icon: PanelsTopLeft, title: 'Portfolio & business tools', items: [
    'Advanced portfolios, watchlists and custom dashboards.',
    'Transaction exports and payment reports.',
    'Invoice requests, address books and separate personal/business profiles.',
  ] },
];

export function HolderBenefits() {
  return <section className="terminal-section holder-benefits" id="holder-benefits" aria-labelledby="holder-benefits-title">
    <div className="section-index">06 / HOLDER BENEFITS <span className="holder-proposal">PROPOSED · NOT LIVE</span></div>
    <div className="section-heading"><h2 id="holder-benefits-title">More ways to participate.<br/>More reasons to stay.</h2><p>We’re planning benefit tiers based on the percentage of token supply you hold, with additional loyalty perks for maintaining eligibility over time.</p></div>
    <div className="holder-benefit-grid">{benefits.map(({ icon: Icon, title, items }) => <article key={title}>
      <Icon size={22} aria-hidden="true"/><h3>{title}</h3><ul>{items.map(item => <li key={item}>{item}</li>)}</ul>
    </article>)}</div>
    <div className="holder-security"><ShieldCheck size={21} aria-hidden="true"/><p><strong>Core security belongs to everyone.</strong> Core wallet security and essential recovery features will remain available to everyone, regardless of token holdings.</p></div>
    <div className="holder-terms">
      <p><strong>These are proposed benefits.</strong> Tier thresholds, holding requirements, hardware availability and redemption limits will be published before launch. No tiers or redemptions are active yet.</p>
      <p>0% refers only to DriveKey platform fees. Network gas, liquidity-provider, bridge and other third-party charges may still apply.</p>
      <a href="https://x.com/DriveKeyyy" target="_blank" rel="noopener noreferrer">Follow development updates ↗</a>
    </div>
  </section>;
}
