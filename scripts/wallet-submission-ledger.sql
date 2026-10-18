-- Immutable cross-route submission claims. Migration owner applies this schema.
-- Runtime role: USAGE on schema, SELECT and INSERT on claim only; no ownership.
CREATE SCHEMA IF NOT EXISTS drivekey_wallet_submission;
CREATE OR REPLACE FUNCTION drivekey_wallet_submission.valid_claim(d jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE STRICT AS $$
DECLARE allowed text[]; kind text;
BEGIN
 IF jsonb_typeof(d)<>'object' OR d->>'version'<>'1' OR (d->>'protocolVersion')::numeric NOT BETWEEN 1 AND 32 OR (d->>'protocolVersion')::numeric<>trunc((d->>'protocolVersion')::numeric) THEN RETURN false; END IF;
 IF length(d->>'expiresAt')>64 THEN RETURN false; END IF;
 IF NOT ((d->>'fingerprint') ~ '^0x[0-9a-f]{64}$' AND (d->>'signedBytesDigest') ~ '^0x[0-9a-f]{64}$' AND (d->>'expiresAt') ~ '^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$') THEN RETURN false; END IF;
 allowed:=ARRAY['version','protocolVersion','fingerprint','signedBytesDigest','expiresAt','kind','purpose','from'];kind:=d->>'kind';
 IF kind='evm' THEN
  allowed:=allowed||ARRAY['chainId','nonce','hash'];
  IF NOT (d->>'purpose'=ANY(ARRAY['transfer','approval','swap','weth-conversion']) AND (d->>'from') ~ '^0x[0-9a-f]{40}$' AND (d->>'hash') ~ '^0x[0-9a-f]{64}$' AND (d->>'chainId')::numeric BETWEEN 1 AND 9007199254740991 AND (d->>'nonce')::numeric BETWEEN 0 AND 9007199254740991 AND (d->>'chainId')::numeric=trunc((d->>'chainId')::numeric) AND (d->>'nonce')::numeric=trunc((d->>'nonce')::numeric)) THEN RETURN false; END IF;
 ELSIF kind IN ('solana-durable','solana-setup') THEN
  allowed:=allowed||ARRAY['genesis','signature','authority'];
  IF NOT ((d->>'genesis') ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' AND (d->>'signature') ~ '^[1-9A-HJ-NP-Za-km-z]{64,88}$' AND (d->>'from') ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' AND (d->>'authority') ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$') THEN RETURN false; END IF;
  IF kind='solana-durable' THEN
   allowed:=allowed||ARRAY['nonceAccount','nonceValue'];
   IF NOT (d->>'purpose'=ANY(ARRAY['transfer','swap','nonce-invalidate']) AND (d->>'nonceAccount') ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' AND (d->>'nonceValue') ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$') THEN RETURN false; END IF;
  ELSE
   allowed:=allowed||ARRAY['destination','blockhash','lastValidBlockHeight'];
   IF NOT (d->>'purpose'='nonce-setup' AND (d->>'destination') ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' AND (d->>'blockhash') ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' AND (d->>'lastValidBlockHeight')::numeric BETWEEN 0 AND 9007199254740991 AND (d->>'lastValidBlockHeight')::numeric=trunc((d->>'lastValidBlockHeight')::numeric)) THEN RETURN false; END IF;
  END IF;
 ELSE RETURN false;
 END IF;
 RETURN d ?& allowed AND d-allowed='{}'::jsonb AND NOT EXISTS(SELECT 1 FROM jsonb_each(d) value WHERE jsonb_typeof(value.value) <> CASE WHEN value.key=ANY(ARRAY['version','protocolVersion','chainId','nonce','lastValidBlockHeight']) THEN 'number' ELSE 'string' END);
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
CREATE TABLE IF NOT EXISTS drivekey_wallet_submission.claim (
 scope text NOT NULL CHECK(scope ~ '^[a-zA-Z0-9_-]{1,80}$'),
 document jsonb NOT NULL CHECK(drivekey_wallet_submission.valid_claim(document) IS TRUE),
 network text GENERATED ALWAYS AS (CASE WHEN document->>'kind'='evm' THEN 'evm:'||((document->>'chainId')::numeric::bigint)::text ELSE 'solana:'||(document->>'genesis') END) STORED,
 transaction_identity text GENERATED ALWAYS AS (CASE WHEN document->>'kind'='evm' THEN document->>'hash' ELSE document->>'signature' END) STORED,
 conflict_identity text GENERATED ALWAYS AS (CASE document->>'kind' WHEN 'evm' THEN 'evm:'||(document->>'from')||':'||((document->>'nonce')::numeric::bigint)::text WHEN 'solana-durable' THEN (CASE WHEN document->>'purpose'='nonce-invalidate' THEN 'invalidate:' ELSE 'durable:' END)||(document->>'nonceAccount')||':'||(document->>'nonceValue') ELSE 'setup:'||(document->>'destination') END) STORED,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(scope,network,transaction_identity),UNIQUE(scope,network,conflict_identity)
);
CREATE OR REPLACE FUNCTION drivekey_wallet_submission.reject_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Wallet submission claims are immutable'; END $$;
CREATE OR REPLACE TRIGGER immutable_claim_rows BEFORE UPDATE OR DELETE ON drivekey_wallet_submission.claim FOR EACH ROW EXECUTE FUNCTION drivekey_wallet_submission.reject_mutation();
CREATE OR REPLACE TRIGGER immutable_claim_table BEFORE TRUNCATE ON drivekey_wallet_submission.claim FOR EACH STATEMENT EXECUTE FUNCTION drivekey_wallet_submission.reject_mutation();
CREATE OR REPLACE FUNCTION drivekey_wallet_submission.guard_nonce_claim()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog SET lock_timeout='2s' AS $$
DECLARE net text; nonce_key text;
BEGIN
 IF NEW.document->>'kind'='solana-durable' THEN
  net:='solana:'||(NEW.document->>'genesis');
  nonce_key:=(NEW.document->>'nonceAccount')||':'||(NEW.document->>'nonceValue');
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.scope||':'||net||':'||nonce_key,0));
  -- Cancellation may race an already claimed swap; it cannot replace its
  -- receipt. Once cancellation is claimed, no new ordinary claim is allowed.
  IF NEW.document->>'purpose'<>'nonce-invalidate' AND EXISTS(
   SELECT 1 FROM drivekey_wallet_submission.claim WHERE scope=NEW.scope AND network=net AND conflict_identity='invalidate:'||nonce_key
  ) THEN RETURN NULL; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER serialize_nonce_claims BEFORE INSERT ON drivekey_wallet_submission.claim FOR EACH ROW EXECUTE FUNCTION drivekey_wallet_submission.guard_nonce_claim();

-- Migration for existing installs: rebuild only a derived index key. No claim
-- document is edited or deleted. The table lock excludes concurrent inserts.
DO $$
DECLARE expression text;
BEGIN
 LOCK TABLE drivekey_wallet_submission.claim IN ACCESS EXCLUSIVE MODE;
 SELECT pg_get_expr(d.adbin,d.adrelid) INTO expression FROM pg_attrdef d
 JOIN pg_attribute a ON a.attrelid=d.adrelid AND a.attnum=d.adnum
 WHERE d.adrelid='drivekey_wallet_submission.claim'::regclass AND a.attname='conflict_identity';
 IF expression IS NULL THEN RAISE EXCEPTION 'Unknown wallet claim schema'; END IF;
 IF position('invalidate:' in expression)=0 THEN
  ALTER TABLE drivekey_wallet_submission.claim DROP CONSTRAINT claim_scope_network_conflict_identity_key;
  ALTER TABLE drivekey_wallet_submission.claim DROP COLUMN conflict_identity;
  ALTER TABLE drivekey_wallet_submission.claim ADD COLUMN conflict_identity text GENERATED ALWAYS AS (CASE document->>'kind' WHEN 'evm' THEN 'evm:'||(document->>'from')||':'||((document->>'nonce')::numeric::bigint)::text WHEN 'solana-durable' THEN (CASE WHEN document->>'purpose'='nonce-invalidate' THEN 'invalidate:' ELSE 'durable:' END)||(document->>'nonceAccount')||':'||(document->>'nonceValue') ELSE 'setup:'||(document->>'destination') END) STORED;
  ALTER TABLE drivekey_wallet_submission.claim ADD CONSTRAINT claim_scope_network_conflict_identity_key UNIQUE(scope,network,conflict_identity);
 END IF;
END $$;
