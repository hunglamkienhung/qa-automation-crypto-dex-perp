-- The indexer's store. One row per on-chain fact; the REST layer only reads.
--
-- Every table that mirrors an event carries (tx_hash, log_index) as a UNIQUE
-- key. That is what makes replaying a block range idempotent: the same log
-- inserted twice is a no-op, not a duplicate row. Numbers are stored as TEXT
-- because the chain's integers do not fit SQLite's 64-bit INTEGER (USD is
-- 30-decimal on some venues; here prices are 8-decimal but the discipline
-- is the same) -- comparisons are done after parsing, never in SQL.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS indexer_state (
  id            INTEGER PRIMARY KEY CHECK (id = 1),
  exchange      TEXT    NOT NULL,          -- the ONE contract address this store follows
  chain_id      INTEGER NOT NULL,
  genesis_hash  TEXT    NOT NULL,          -- block 0 of the chain instance; a redeployed anvil has a new one
  last_block    INTEGER NOT NULL,          -- last block fully indexed
  last_block_hash TEXT,                    -- its hash; a mismatch on the next sync means a reorg -> rebuild
  updated_at    INTEGER NOT NULL,          -- unix seconds, indexer clock
  paused        INTEGER NOT NULL DEFAULT 0, -- 1 = indexer told to stop advancing (a test lever)
  rebuilds      INTEGER NOT NULL DEFAULT 0  -- how many times the store was rebuilt after a reorg
);

CREATE TABLE IF NOT EXISTS markets (
  market_id     INTEGER PRIMARY KEY,
  symbol        TEXT    NOT NULL UNIQUE,
  status        TEXT    NOT NULL CHECK (status IN ('Active','Paused','ReduceOnly','Settling')),
  tick_size     TEXT    NOT NULL,
  step_size     TEXT    NOT NULL,
  min_notional  TEXT    NOT NULL,
  max_leverage  INTEGER NOT NULL,
  maker_fee_bps INTEGER NOT NULL,
  taker_fee_bps INTEGER NOT NULL,
  max_basis_bps INTEGER NOT NULL,
  updated_block INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  order_id      INTEGER PRIMARY KEY,
  owner         TEXT    NOT NULL,
  market_id     INTEGER NOT NULL REFERENCES markets(market_id),
  side          TEXT    NOT NULL CHECK (side IN ('Buy','Sell')),
  order_type    TEXT    NOT NULL,
  tif           TEXT    NOT NULL,
  size          TEXT    NOT NULL,
  filled        TEXT    NOT NULL DEFAULT '0',
  price         TEXT    NOT NULL,
  trigger_price TEXT    NOT NULL,
  reduce_only   INTEGER NOT NULL,
  user_order_id INTEGER NOT NULL,
  max_ts        TEXT    NOT NULL,
  status        TEXT    NOT NULL CHECK (status IN ('Pending','Open','Filled','Cancelled')),
  placed_block  INTEGER NOT NULL,
  placed_tx     TEXT    NOT NULL,
  placed_log    INTEGER NOT NULL,
  updated_block INTEGER NOT NULL,
  UNIQUE (placed_tx, placed_log)
);
CREATE INDEX IF NOT EXISTS orders_owner ON orders(owner, status);

CREATE TABLE IF NOT EXISTS trades (
  tx_hash        TEXT    NOT NULL,
  log_index      INTEGER NOT NULL,
  block_number   INTEGER NOT NULL,
  market_id      INTEGER NOT NULL REFERENCES markets(market_id),
  taker          TEXT    NOT NULL,
  maker          TEXT    NOT NULL,           -- zero address = liquidity backstop
  taker_order_id INTEGER NOT NULL REFERENCES orders(order_id),
  maker_order_id INTEGER NOT NULL,           -- 0 = backstop (no order)
  taker_side     TEXT    NOT NULL CHECK (taker_side IN ('Buy','Sell')),
  size           TEXT    NOT NULL CHECK (size <> '0'),
  price          TEXT    NOT NULL,
  taker_fee      TEXT    NOT NULL,
  maker_fee      TEXT    NOT NULL,
  PRIMARY KEY (tx_hash, log_index)
);
CREATE INDEX IF NOT EXISTS trades_market_block ON trades(market_id, block_number);

CREATE TABLE IF NOT EXISTS positions (
  account        TEXT    NOT NULL,
  market_id      INTEGER NOT NULL REFERENCES markets(market_id),
  size           TEXT    NOT NULL,           -- signed; '0' rows are kept to show history closed
  entry_price    TEXT    NOT NULL,
  realized_pnl   TEXT    NOT NULL,           -- lifetime, as the contract keeps it (sum of deltas)
  funding_paid   TEXT    NOT NULL,           -- lifetime, sum of fundingPaid
  updated_block  INTEGER NOT NULL,
  updated_tx     TEXT    NOT NULL,
  PRIMARY KEY (account, market_id)
);

CREATE TABLE IF NOT EXISTS position_events (
  tx_hash        TEXT    NOT NULL,
  log_index      INTEGER NOT NULL,
  block_number   INTEGER NOT NULL,
  account        TEXT    NOT NULL,
  market_id      INTEGER NOT NULL,
  size_before    TEXT    NOT NULL,
  size_after     TEXT    NOT NULL,
  entry_price    TEXT    NOT NULL,
  realized_delta TEXT    NOT NULL,
  funding_paid   TEXT    NOT NULL,
  PRIMARY KEY (tx_hash, log_index)
);

CREATE TABLE IF NOT EXISTS funding (
  tx_hash          TEXT    NOT NULL,
  log_index        INTEGER NOT NULL,
  block_number     INTEGER NOT NULL,
  market_id        INTEGER NOT NULL REFERENCES markets(market_id),
  rate_bps         INTEGER NOT NULL,
  cumulative_index TEXT    NOT NULL,
  funding_time     INTEGER NOT NULL,
  samples          INTEGER NOT NULL,
  PRIMARY KEY (tx_hash, log_index)
);

CREATE TABLE IF NOT EXISTS liquidations (
  tx_hash        TEXT    NOT NULL,
  log_index      INTEGER NOT NULL,
  block_number   INTEGER NOT NULL,
  account        TEXT    NOT NULL,
  market_id      INTEGER NOT NULL REFERENCES markets(market_id),
  liquidator     TEXT    NOT NULL,
  size_closed    TEXT    NOT NULL,
  price          TEXT    NOT NULL,
  liquidator_fee TEXT    NOT NULL,
  bad_debt       TEXT    NOT NULL,
  insurance_used TEXT    NOT NULL,
  PRIMARY KEY (tx_hash, log_index)
);

CREATE TABLE IF NOT EXISTS accounts (
  account        TEXT    PRIMARY KEY,
  created_block  INTEGER NOT NULL,
  deposits       TEXT    NOT NULL DEFAULT '0',
  withdrawals    TEXT    NOT NULL DEFAULT '0'
);

-- API keys are the mini-api's own concern, not the chain's. Seeded by the
-- service on first start; the test asks for a token with a known scope.
CREATE TABLE IF NOT EXISTS api_keys (
  token          TEXT    PRIMARY KEY,
  scope          TEXT    NOT NULL CHECK (scope IN ('read','portfolio','admin')),
  subject        TEXT,                       -- the account the token speaks for, if any
  expires_at     INTEGER                     -- unix seconds; NULL = never
);

-- Latest index price per market, from the oracle's PriceSet events (seeded
-- from the getter at start). The API derives mark = clamp(last trade, index ±
-- maxBasis) from this and trades -- the same rule the contract applies.
CREATE TABLE IF NOT EXISTS index_prices (
  market_id      INTEGER PRIMARY KEY REFERENCES markets(market_id),
  price          TEXT    NOT NULL,
  publish_time   INTEGER NOT NULL,
  block_number   INTEGER NOT NULL
);

-- Every log the indexer has applied, by its unique key. Checked first, so a
-- replayed range is a no-op for every table above by construction -- not by
-- each handler remembering to be careful.
CREATE TABLE IF NOT EXISTS applied_logs (
  tx_hash        TEXT    NOT NULL,
  log_index      INTEGER NOT NULL,
  block_number   INTEGER NOT NULL,
  PRIMARY KEY (tx_hash, log_index)
);
