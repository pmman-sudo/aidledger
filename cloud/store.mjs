import fs from 'node:fs/promises';
import pg from 'pg';

export class PostgresStore {
  constructor(connectionString) {
    this.pool = new pg.Pool({ connectionString, max: 5, idleTimeoutMillis: 20_000,
      ssl: /sslmode=(require|verify)/.test(connectionString) ? { rejectUnauthorized: true } : undefined });
  }
  async init() {
    await this.pool.query(await fs.readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
  }
  async close() { await this.pool.end(); }
  async get(id) {
    const { rows } = await this.pool.query('SELECT * FROM wallet_requests WHERE id = $1', [id]);
    return rows[0] || null;
  }
  async list(wallet, limit = 50) {
    const { rows } = await this.pool.query(
      'SELECT * FROM wallet_requests WHERE wallet_address = $1 ORDER BY created_at DESC LIMIT $2',
      [wallet.toLowerCase(), limit],
    );
    return rows;
  }
  async document(hash) {
    if (!hash || /^0x0{64}$/.test(hash)) return null;
    const { rows } = await this.pool.query('SELECT body, canonical_bytes FROM documents WHERE hash = $1', [hash]);
    return rows[0] || null;
  }
  async create({ record, document }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      if (document) await client.query(
        `INSERT INTO documents(hash, kind, body, canonical_bytes) VALUES($1,$2,$3::jsonb,$4)
         ON CONFLICT(hash) DO NOTHING`,
        [document.hash, document.kind, document.bytes, document.bytes],
      );
      await client.query(
        `INSERT INTO wallet_requests(id,request_key,chain_id,contract_address,wallet_address,
          action,action_bytes,document_hash,status)
         VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,'prepared')`,
        [record.id, record.requestKey, record.chainId, record.contractAddress.toLowerCase(),
          record.walletAddress.toLowerCase(), record.actionBytes, record.actionBytes,
          document?.hash || null],
      );
      await client.query('COMMIT');
      return this.get(record.id);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally { client.release(); }
  }
  async attach(id, hash) {
    const { rows } = await this.pool.query(
      `UPDATE wallet_requests SET transaction_hash=$2,status='submitted',updated_at=now()
       WHERE id=$1 RETURNING *`, [id, hash.toLowerCase()],
    );
    return rows[0] || null;
  }
  async update(id, values) {
    const { rows } = await this.pool.query(
      `UPDATE wallet_requests SET status=$2,transaction_hash=COALESCE($3,transaction_hash),
       block_number=$4,error=$5,updated_at=now() WHERE id=$1 RETURNING *`,
      [id, values.status, values.transactionHash || null, values.blockNumber ?? null, values.error || null],
    );
    return rows[0] || null;
  }
}
