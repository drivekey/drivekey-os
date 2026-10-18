import type {ReactNode} from 'react';

type WalletPageHeaderProps = {
  title: string;
  description?: string;
  icon?: ReactNode;
  actions?: ReactNode;
  as?: 'h1' | 'h2';
};

export function WalletPageHeader({title, description, icon, actions, as: Heading = 'h1'}: WalletPageHeaderProps) {
  return <header className="wallet-page-header">
    <div className="wallet-page-heading">
      <Heading>{icon && <span className="wallet-page-icon" aria-hidden="true">{icon}</span>}{title}</Heading>
      {description && <p>{description}</p>}
    </div>
    {actions && <div className="wallet-page-actions">{actions}</div>}
  </header>;
}
