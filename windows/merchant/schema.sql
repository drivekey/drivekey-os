CREATE TABLE IF NOT EXISTS address_pool (
 chain text NOT NULL CHECK(chain IN ('ethereum','sepolia','solana','devnet')),
 address text NOT NULL, provisioned_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(chain,address)
);
CREATE TABLE IF NOT EXISTS invoices (
 id uuid PRIMARY KEY, public_token text NOT NULL UNIQUE, idempotency_key text NOT NULL UNIQUE,
 request_digest text NOT NULL, chain text NOT NULL, asset text NOT NULL CHECK(asset IN ('ETH','SOL','USDC')),
 amount numeric(39,0) NOT NULL CHECK(amount>0), address text NOT NULL,
 created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
 status text NOT NULL DEFAULT 'open', paid numeric(39,0) NOT NULL DEFAULT 0, late numeric(39,0) NOT NULL DEFAULT 0,
 revision integer NOT NULL DEFAULT 0, last_scanned_at timestamptz, UNIQUE(chain,address),
 FOREIGN KEY(chain,address) REFERENCES address_pool(chain,address), CHECK(expires_at>created_at)
);
CREATE TABLE IF NOT EXISTS payment_claims (
 chain text NOT NULL, tx_hash text NOT NULL, event_index integer NOT NULL,
 invoice_id uuid NOT NULL REFERENCES invoices(id), amount numeric(39,0) NOT NULL CHECK(amount>0),
 chain_time timestamptz NOT NULL, canonical boolean NOT NULL, evidence jsonb NOT NULL,
 PRIMARY KEY(chain,tx_hash,event_index)
);
CREATE TABLE IF NOT EXISTS webhook_outbox (
 id uuid PRIMARY KEY, invoice_id uuid NOT NULL REFERENCES invoices(id), revision integer NOT NULL,
 body text NOT NULL, attempts integer NOT NULL DEFAULT 0, available_at timestamptz NOT NULL DEFAULT now(),
 delivered_at timestamptz, lease_until timestamptz, UNIQUE(invoice_id,revision)
);
CREATE INDEX IF NOT EXISTS webhook_due ON webhook_outbox(available_at) WHERE delivered_at IS NULL;
CREATE TABLE IF NOT EXISTS invoice_scan (
 invoice_id uuid PRIMARY KEY REFERENCES invoices(id), next_block bigint NOT NULL CHECK(next_block>=0)
);
CREATE TABLE IF NOT EXISTS payment_hints (
 invoice_id uuid NOT NULL REFERENCES invoices(id), tx_hash text NOT NULL,
 PRIMARY KEY(invoice_id,tx_hash)
);
