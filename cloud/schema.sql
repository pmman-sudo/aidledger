CREATE TABLE IF NOT EXISTS documents (
  hash CHAR(66) PRIMARY KEY CHECK (hash ~ '^0x[0-9a-f]{64}$'),
  kind VARCHAR(16) NOT NULL CHECK (kind IN ('metadata', 'evidence', 'review')),
  body JSONB NOT NULL,
  canonical_bytes TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS wallet_requests (
  id UUID PRIMARY KEY,
  request_key CHAR(66) NOT NULL UNIQUE CHECK (request_key ~ '^0x[0-9a-f]{64}$'),
  chain_id INTEGER NOT NULL,
  contract_address CHAR(42) NOT NULL,
  wallet_address CHAR(42) NOT NULL,
  action JSONB NOT NULL,
  action_bytes TEXT NOT NULL,
  document_hash CHAR(66),
  status VARCHAR(20) NOT NULL,
  transaction_hash CHAR(66),
  block_number BIGINT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (document_hash) REFERENCES documents(hash)
);

CREATE INDEX IF NOT EXISTS wallet_requests_wallet_created
  ON wallet_requests (wallet_address, created_at DESC);
