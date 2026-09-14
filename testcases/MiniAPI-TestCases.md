# mini-api — DB and API test cases

68 cases over the indexer store and the REST layer in `../services/mini-api`. Generated from `miniapi.cases.js`; do not edit by hand.

IDs are immutable and shared with `../fixtures/testcases.json`, which the automation binds to.

## 05. DB — indexer store

### C164 · The store has the documented tables, and every event table is keyed by (tx_hash, log_index)

**Function** `schema.sql` · **Tier** BE/DB · **Priority** High · **Run** Auto

**Purpose.** The schema is the contract between indexer, API and tests; a missing unique key is what lets duplicates in

**Precondition.** anvil with a fresh PerpDEX; mini-api running and its indexer caught up

**Steps.**
1. open the store read-only; read sqlite_master → expect tables indexer_state, markets, orders, trades, positions, position_events, funding, liquidations, accounts, index_prices, applied_logs, api_keys
2. read PRAGMA index_list for trades, funding, liquidations, position_events, applied_logs → expect a unique index over (tx_hash, log_index)

**Expected.** All tables present; event tables uniquely keyed

### C165 · Schema constraints refuse a zero-size trade, an unknown market, and a bad status

**Function** `schema.sql` · **Tier** BE/DB · **Priority** High · **Run** Auto

**Purpose.** Constraints are the last line; they must actually be enforced, not just written

**Precondition.** A throwaway in-memory database with schema.sql applied and foreign keys on

**Steps.**
1. insert a trades row with size "0" → expect a CHECK failure
2. insert an orders row with market_id 99 → expect a FOREIGN KEY failure
3. insert a markets row with status "Weird" → expect a CHECK failure
4. insert the same trades (tx_hash, log_index) twice → expect the second to fail

**Expected.** Every bad row is refused

### C166 · The store follows exactly the deployed exchange on chain 31337

**Function** `indexer_state` · **Tier** BE/DB · **Priority** High · **Run** Auto

**Purpose.** A store pointed at the wrong deployment would compare against the wrong contract

**Precondition.** anvil with a fresh PerpDEX; mini-api running and its indexer caught up

**Steps.**
1. read indexer_state → expect exchange == deployments/31337.json exchange (case-insensitive), chain_id 31337, genesis_hash == eth_getBlockByNumber(0).hash

**Expected.** Exchange, chain and genesis all match

### C167 · The indexer keeps up: last_block reaches the chain head within the poll interval

**Function** `indexer_state.last_block` · **Tier** BE/DB · **Priority** High · **Run** Auto

**Purpose.** Lag is the first symptom of a dead indexer

**Precondition.** anvil with a fresh PerpDEX; mini-api running and its indexer caught up

**Steps.**
1. mine a block; wait up to 5 s → read indexer_state.last_block → expect == eth_blockNumber
2. read last_block_hash → expect == the hash of that block

**Expected.** last_block == head and its hash matches

### C168 · Market rows equal the contract getters

**Function** `markets` · **Tier** BE/DB · **Priority** High · **Run** Auto

**Purpose.** Markets are seeded from getters, not events; a drift here would mislabel every other row

**Precondition.** anvil with a fresh PerpDEX; mini-api running and its indexer caught up

**Steps.**
1. read markets → expect COUNT == marketCount()
2. for each row: symbol, status, tick_size, step_size, min_notional, max_leverage, maker/taker fee, max_basis_bps == getMarket / getMarketParams

**Expected.** Row for row equal

### C169 · The stored index price follows the oracle

**Function** `index_prices` · **Tier** BE/DB · **Priority** High · **Run** Auto

**Purpose.** The API derives the mark from this row; a stale index mis-marks every position

**Precondition.** anvil with a fresh PerpDEX; mini-api running and its indexer caught up

**Steps.**
1. setMockPrice(ETH, 2600); wait for the block to be indexed → read index_prices where market_id = 1 → expect price 2600e8 and publish_time == the reading's

**Expected.** Row equals getIndexPrice

### C170 · One OrderFilled becomes exactly one trades row, keyed by its tx and log index

**Function** `trades` · **Tier** BE/DB · **Priority** High · **Run** Auto

**Purpose.** A fill missed or doubled is the indexer failing at its one job

**Precondition.** anvil with a fresh PerpDEX; mini-api running and its indexer caught up

**Steps.**
1. bob rests an ask; alice buys at market; read the receipt's OrderFilled (tx_hash, logIndex, size, price)
2. wait indexed → read trades where tx_hash and log_index match → expect exactly one row with size, price, taker, maker, taker_order_id, taker_fee equal to the event

**Expected.** Exactly one row, field for field

### C171 · A backstop fill is stored with the zero address as maker and maker_order_id 0

**Function** `trades` · **Tier** BE/DB · **Priority** High · **Run** Auto

**Purpose.** Readers tell venue liquidity from trader liquidity by this column

**Precondition.** anvil with a fresh PerpDEX; mini-api running and its indexer caught up

**Steps.**
1. alice buys at market on an empty book → wait indexed → read the trade → expect maker == 0x000…000 and maker_order_id == 0

**Expected.** Zero maker, zero maker order

### C172 · Every trade references an order the store knows

**Function** `trades → orders` · **Tier** BE/DB · **Priority** High · **Run** Auto

**Purpose.** No orphan rows: a trade whose order is missing means an OrderPlaced was dropped

**Precondition.** anvil with a fresh PerpDEX; mini-api running and its indexer caught up

**Steps.**
1. after several fills → SELECT trades t LEFT JOIN orders o ON o.order_id = t.taker_order_id WHERE o.order_id IS NULL → expect 0 rows
2. same for maker_order_id <> 0

**Expected.** Zero orphans on both sides

### C173 · An OrderPlaced becomes an orders row equal to getOrder

**Function** `orders` · **Tier** BE/DB · **Priority** High · **Run** Auto

**Purpose.** The orders table is rebuilt from the event alone; every field must survive the trip

**Precondition.** anvil with a fresh PerpDEX; mini-api running and its indexer caught up

**Steps.**
1. alice rests a limit with userOrderId 77 → wait indexed → read orders where order_id → expect owner, market_id, side, order_type, tif, size, price, reduce_only, user_order_id, max_ts, status Open equal to getOrder

**Expected.** Row equals the getter

### C174 · After a full fill the row shows filled == size and status Filled, like the chain

**Function** `orders.filled / status` · **Tier** BE/DB · **Priority** High · **Run** Auto

**Purpose.** filled is accumulated from trades; the derived status must flip at exactly the full size

**Precondition.** anvil with a fresh PerpDEX; mini-api running and its indexer caught up

**Steps.**
1. bob rests 1 ETH; alice buys 1 ETH at market → wait indexed → read bob's order row → expect filled == size and status Filled; getOrder(bob).status == Filled

**Expected.** Row and getter agree

### C175 · A cancel is reflected as status Cancelled

**Function** `orders.status` · **Tier** BE/DB · **Priority** Medium · **Run** Auto

**Purpose.** Open-order views must not show cancelled orders

**Precondition.** anvil with a fresh PerpDEX; mini-api running and its indexer caught up

**Steps.**
1. alice rests then cancels → wait indexed → read the row → expect status Cancelled

**Expected.** Cancelled

### C176 · The positions row equals getPosition for size and entry price

**Function** `positions` · **Tier** BE/DB · **Priority** High · **Run** Auto

**Purpose.** Positions are the most-read table and the easiest to drift: they are rebuilt from PositionChanged

**Precondition.** anvil with a fresh PerpDEX; mini-api running and its indexer caught up

**Steps.**
1. alice buys 2 ETH then sells 0.5 → wait indexed → read positions (alice, 1) → expect size 1.5e8 and entry_price == getPosition.entryPrice

**Expected.** Row equals the getter

### C177 · Lifetime realised PnL in the store equals the contract's

**Function** `positions.realized_pnl` · **Tier** BE/DB · **Priority** Medium · **Run** Auto

**Purpose.** Summed from event deltas; a double-applied event shows up here first

**Precondition.** anvil with a fresh PerpDEX; mini-api running and its indexer caught up

**Steps.**
1. open, then partially close at a profit → wait indexed → read positions.realized_pnl → expect == getPosition.realizedPnl

**Expected.** Sums agree

### C178 · Per market, long sizes equal short sizes, and both equal the contract's open interest

**Function** `positions` · **Tier** BE/DB · **Priority** High · **Run** Auto

**Purpose.** Every long has a short; the backstop counts. A mismatch is a lost or duplicated PositionChanged

**Precondition.** anvil with a fresh PerpDEX; mini-api running and its indexer caught up

**Steps.**
1. after fills on each market → SELECT SUM(size>0), SUM(-size where size<0) per market → expect equal, and each == getMarket().openInterestLong/Short

**Expected.** Balanced and equal to chain OI

### C179 · One fill writes two position_events rows: taker and maker (backstop included)

**Function** `position_events` · **Tier** BE/DB · **Priority** Medium · **Run** Auto

**Purpose.** The event pair is what the positions table is derived from

**Precondition.** anvil with a fresh PerpDEX; mini-api running and its indexer caught up

**Steps.**
1. alice buys at market against the backstop → wait indexed → read position_events for that tx → expect 2 rows: alice and the backstop address, with sizeAfter of opposite sign

**Expected.** Two rows, opposite signs

### C180 · A FundingUpdated across a boundary becomes a funding row equal to getFundingRate

**Function** `funding` · **Tier** BE/DB · **Priority** Medium · **Run** Auto

**Purpose.** Funding history is served from here

**Precondition.** anvil with a fresh PerpDEX; mini-api running and its indexer caught up

**Steps.**
1. advance the clock one interval; updateFunding → wait indexed → read funding newest for market 1 → expect rate_bps == lastRateBps, cumulative_index == cumulativeIndex, funding_time == lastFundingTime

**Expected.** Row equals the getter

### C181 · A liquidation becomes a liquidations row equal to the Liquidated event

**Function** `liquidations` · **Tier** BE/DB · **Priority** High · **Run** Auto

**Purpose.** Liquidations are the rows people dispute; every field must be exact

**Precondition.** anvil with a fresh PerpDEX; mini-api running and its indexer caught up

**Steps.**
1. thin long; crash the index; keeper liquidates → wait indexed → read the row by tx → expect account, liquidator, size_closed, price, liquidator_fee, bad_debt, insurance_used == the event

**Expected.** Field for field

### C182 · Deposits and withdrawals accumulate on the accounts row

**Function** `accounts` · **Tier** BE/DB · **Priority** Low · **Run** Auto

**Purpose.** The portfolio summary reads these sums

**Precondition.** anvil with a fresh PerpDEX; mini-api running and its indexer caught up

**Steps.**
1. fund alice $1000; withdraw $250 → wait indexed → read accounts(alice) → expect deposits 1000e6, withdrawals 250e6

**Expected.** Sums equal the events

### C183 · Replaying an already-indexed range changes nothing

**Function** `applied_logs` · **Tier** BE/DB · **Priority** High · **Run** Auto

**Purpose.** Idempotence is what makes the indexer safe to restart and to rewind

**Precondition.** anvil with a fresh PerpDEX; mini-api running and its indexer caught up

**Steps.**
1. note COUNT(*) of trades, orders, position_events, positions.size for alice
2. POST /admin/indexer {rewind: last_block - 10} → wait for last_block to return to head
3. read the same counts and values → expect identical

**Expected.** No row added, no value changed

### C184 · A paused indexer freezes the store while the chain moves on

**Function** `indexer_state.paused` · **Tier** BE/DB · **Priority** High · **Run** Auto

**Purpose.** The dangerous failure: rows that look fine and are old

**Precondition.** anvil with a fresh PerpDEX; mini-api running and its indexer caught up

**Steps.**
1. POST /admin/indexer {paused:true}; alice buys at market; wait 2 s → read indexer_state.last_block → expect unchanged and < eth_blockNumber; trades count unchanged
2. unpause; wait → expect last_block == head and the trade present

**Expected.** Frozen while paused, caught up after

### C185 · After the chain reverts, the store rebuilds and matches the chain again

**Function** `sync()` · **Tier** BE/DB · **Priority** High · **Run** Auto

**Purpose.** Rows from blocks that no longer exist must not survive

**Precondition.** anvil with a fresh PerpDEX; mini-api running and its indexer caught up

**Steps.**
1. snapshot; alice buys at market; wait indexed → trades count n+1
2. evm_revert to the snapshot; wait → expect indexer_state.rebuilds +1, last_block == head, trades count back to n, positions(alice) == getPosition (flat)

**Expected.** Store equals chain after the revert

### C186 · Events from a second PerpDEX at another address are invisible to the store

**Function** `indexer address filter` · **Tier** BE/DB · **Priority** High · **Run** Auto

**Purpose.** The store follows one deployment; look-alike events from another must not leak in

**Precondition.** contracts built (forge build) so the PerpExchange bytecode is available

**Steps.**
1. deploy a second PerpExchange with the same vault/oracle; grace initialises an account on it → wait indexed → read accounts(grace) → expect no row; indexer_state.exchange unchanged

**Expected.** Nothing from the second deployment

### C187 · ETH: mark derived from store rows equals getMarkPrice

**Function** `mark derivation` · **Tier** BE/DB · **Priority** High · **Run** Auto

**Purpose.** The API's mark is clamp(last trade, index ± maxBasis) from rows; it must equal the contract's

**Precondition.** anvil with a fresh PerpDEX; mini-api running and its indexer caught up

**Steps.**
1. fill above index so the mark is off the index → wait indexed → compute clamp(trades.last.price, index_prices ± markets.max_basis_bps) → expect == getMarkPrice(1)

**Expected.** Derived == chain

### C188 · BTC: mark derived from store rows equals getMarkPrice

**Function** `mark derivation` · **Tier** BE/DB · **Priority** Medium · **Run** Auto

**Purpose.** Same rule, another market

**Precondition.** anvil with a fresh PerpDEX; mini-api running and its indexer caught up

**Steps.**
1. as ETH, on market 0

**Expected.** Derived == chain

### C189 · SOL: mark derived from store rows equals getMarkPrice

**Function** `mark derivation` · **Tier** BE/DB · **Priority** Medium · **Run** Auto

**Purpose.** Same rule, another market

**Precondition.** anvil with a fresh PerpDEX; mini-api running and its indexer caught up

**Steps.**
1. as ETH, on market 2

**Expected.** Derived == chain

## 06. API — mini-api over the store

### C190 · /health reports the store's indexer state

**Function** `GET /health` · **Tier** BE/API · **Priority** High · **Run** Auto

**Purpose.** The one endpoint a monitor needs

**Precondition.** anvil with a fresh PerpDEX; mini-api running and its indexer caught up

**Steps.**
1. GET /health → expect 200, ok true, exchange == indexer_state.exchange, last_block == indexer_state.last_block, indexer_paused false, age_seconds small

**Expected.** Equal to the row

### C191 · /markets returns one entry per markets row with the row's fields

**Function** `GET /markets` · **Tier** BE/API · **Priority** High · **Run** Auto

**Purpose.** DB ↔ API on the most basic table

**Precondition.** anvil with a fresh PerpDEX; mini-api running and its indexer caught up

**Steps.**
1. GET /markets → expect markets.length == COUNT(markets); for each: symbol, status, tick_size, step_size, min_notional, max_leverage, fees, max_basis_bps == row; index_price == index_prices row

**Expected.** Row for row

### C192 · /markets/1 returns the ETH row

**Function** `GET /markets/:id` · **Tier** BE/API · **Priority** Medium · **Run** Auto

**Purpose.** Single-resource route

**Precondition.** anvil with a fresh PerpDEX; mini-api running and its indexer caught up

**Steps.**
1. GET /markets/1 → expect 200 and the same object as the list entry

**Expected.** Equal

### C193 · mark_price in /markets equals the mark derived from the rows

**Function** `GET /markets/:id` · **Tier** BE/API · **Priority** High · **Run** Auto

**Purpose.** The API derives; the test derives independently; they must agree

**Precondition.** anvil with a fresh PerpDEX; mini-api running and its indexer caught up

**Steps.**
1. after a fill → GET /markets/1 mark_price → expect == clamp(last trade, index ± max_basis) computed from the rows

**Expected.** Equal

### C194 · open_interest_long/short in /markets equal the positions sums

**Function** `GET /markets/:id` · **Tier** BE/API · **Priority** Medium · **Run** Auto

**Purpose.** Aggregates must come from the rows

**Precondition.** anvil with a fresh PerpDEX; mini-api running and its indexer caught up

**Steps.**
1. GET /markets/1 → expect open_interest_long == SUM(positive sizes), short == SUM(negative)

**Expected.** Equal

### C195 · An unknown market is 404 with the standard error shape

**Function** `GET /markets/:id` · **Tier** BE/API · **Priority** Medium · **Run** Auto

**Purpose.** Errors are data too

**Precondition.** anvil with a fresh PerpDEX; mini-api running and its indexer caught up

**Steps.**
1. GET /markets/99 → expect 404, body {error, code: "not_found"}
2. GET /markets/abc → expect 404, same shape

**Expected.** 404 with {error, code}

### C196 · /markets/:id/status follows a status change

**Function** `GET /markets/:id/status` · **Tier** BE/API · **Priority** Medium · **Run** Auto

**Purpose.** Admin status changes reach the API through the store

**Precondition.** anvil with a fresh PerpDEX; mini-api running and its indexer caught up

**Steps.**
1. admin sets ETH Paused → wait indexed → GET /markets/1/status → expect status Paused == markets row
2. set Active back → expect Active

**Expected.** Follows the row

### C197 · /orderbook aggregates the store's open orders per price

**Function** `GET /orderbook/:id` · **Tier** BE/API · **Priority** High · **Run** Auto

**Purpose.** Depth = SUM(size − filled) grouped by price, best first

**Precondition.** anvil with a fresh PerpDEX; mini-api running and its indexer caught up

**Steps.**
1. rest three bids at two prices → wait indexed → GET /orderbook/1 → expect bids sorted descending, each size == SUM over open orders at that price, orders count right

**Expected.** Equal to the aggregation

### C198 · depth is validated

**Function** `GET /orderbook/:id` · **Tier** BE/API · **Priority** Low · **Run** Auto

**Purpose.** Bad input is 400, not a 500 or an empty list

**Precondition.** anvil with a fresh PerpDEX; mini-api running and its indexer caught up

**Steps.**
1. ?depth=0 → 400; ?depth=51 → 400; ?depth=x → 400

**Expected.** 400 with {error, code: "bad_request"}

### C199 · /orders/:account returns the account's Open rows by default

**Function** `GET /orders/:account` · **Tier** BE/API · **Priority** High · **Run** Auto

**Purpose.** DB ↔ API on orders

**Precondition.** anvil with a fresh PerpDEX; mini-api running and its indexer caught up

**Steps.**
1. alice rests two limits, one cancelled → wait indexed → GET /orders/alice → expect exactly the rows with status Open

**Expected.** Equal

### C200 · ?status=Cancelled and ?status=all select the right rows

**Function** `GET /orders/:account` · **Tier** BE/API · **Priority** Medium · **Run** Auto

**Purpose.** Filters map to the column

**Precondition.** anvil with a fresh PerpDEX; mini-api running and its indexer caught up

**Steps.**
1. GET /orders/alice?status=Cancelled → expect the cancelled rows only; ?status=all → expect COUNT(orders where owner)

**Expected.** Equal

### C201 · A malformed account is 400

**Function** `GET /orders/:account` · **Tier** BE/API · **Priority** Low · **Run** Auto

**Purpose.** Input validation

**Precondition.** anvil with a fresh PerpDEX; mini-api running and its indexer caught up

**Steps.**
1. GET /orders/not-an-address → 400 bad_request
2. GET /orders/0x1234?status=Weird → 400 bad_request

**Expected.** 400

### C202 · /positions/:account returns the account's rows

**Function** `GET /positions/:account` · **Tier** BE/API · **Priority** High · **Run** Auto

**Purpose.** DB ↔ API on positions

**Precondition.** anvil with a fresh PerpDEX; mini-api running and its indexer caught up

**Steps.**
1. GET /positions/alice → expect rows equal to SELECT * FROM positions WHERE account

**Expected.** Equal

### C203 · /trades total equals COUNT(trades)

**Function** `GET /trades` · **Tier** BE/API · **Priority** High · **Run** Auto

**Purpose.** total is the whole set, not the page

**Precondition.** anvil with a fresh PerpDEX; mini-api running and its indexer caught up

**Steps.**
1. GET /trades?limit=2 → expect total == COUNT(*) and trades.length == 2

**Expected.** Equal

### C204 · /trades is newest first by (block, log)

**Function** `GET /trades` · **Tier** BE/API · **Priority** Medium · **Run** Auto

**Purpose.** Ordering contract

**Precondition.** anvil with a fresh PerpDEX; mini-api running and its indexer caught up

**Steps.**
1. GET /trades → expect each row ≥ the next by (block_number, log_index)

**Expected.** Descending

### C205 · Paging with the cursor yields every row exactly once

**Function** `GET /trades` · **Tier** BE/API · **Priority** High · **Run** Auto

**Purpose.** Keyset pagination correctness

**Precondition.** anvil with a fresh PerpDEX; mini-api running and its indexer caught up

**Steps.**
1. walk /trades?limit=2 following next_cursor until null → expect the union == all rows, no (tx, log) twice, next_cursor null at the end

**Expected.** Complete, no duplicates

### C206 · limit is capped at 100 and reported

**Function** `GET /trades` · **Tier** BE/API · **Priority** Low · **Run** Auto

**Purpose.** A client cannot ask for the whole table

**Precondition.** anvil with a fresh PerpDEX; mini-api running and its indexer caught up

**Steps.**
1. GET /trades?limit=1000 → expect limit 100 in the body

**Expected.** Capped

### C207 · Bad limit or cursor is 400

**Function** `GET /trades` · **Tier** BE/API · **Priority** Low · **Run** Auto

**Purpose.** Input validation

**Precondition.** anvil with a fresh PerpDEX; mini-api running and its indexer caught up

**Steps.**
1. ?limit=0 → 400; ?limit=abc → 400; ?cursor=%%% → 400

**Expected.** 400

### C208 · ?market filters and total follows the filter

**Function** `GET /trades` · **Tier** BE/API · **Priority** Medium · **Run** Auto

**Purpose.** Filter correctness

**Precondition.** anvil with a fresh PerpDEX; mini-api running and its indexer caught up

**Steps.**
1. GET /trades?market=1 → expect every row market_id 1 and total == COUNT(trades where market_id = 1)
2. ?market=99 → 404

**Expected.** Filtered and counted

### C209 · /funding/history returns the funding rows for the market

**Function** `GET /funding/history` · **Tier** BE/API · **Priority** Medium · **Run** Auto

**Purpose.** DB ↔ API on funding

**Precondition.** anvil with a fresh PerpDEX; mini-api running and its indexer caught up

**Steps.**
1. advance one interval; updateFunding → wait indexed → GET /funding/history?market=1&period=1d → expect rows equal to the funding table for market 1

**Expected.** Equal

### C210 · An unsupported period is 400 and the response lists the supported ones

**Function** `GET /funding/history` · **Tier** BE/API · **Priority** High · **Run** Auto

**Purpose.** A lenient endpoint that returns 200 for a period it does not understand is the worse bug

**Precondition.** anvil with a fresh PerpDEX; mini-api running and its indexer caught up

**Steps.**
1. ?market=1&period=1h → 200; ?period=8h → 200; ?period=2h → 400 with supported ["1h","8h","1d"]; ?period=x → 400

**Expected.** 400 for anything but the three

### C211 · market is required

**Function** `GET /funding/history` · **Tier** BE/API · **Priority** Low · **Run** Auto

**Purpose.** Input validation

**Precondition.** anvil with a fresh PerpDEX; mini-api running and its indexer caught up

**Steps.**
1. GET /funding/history → 400 bad_request

**Expected.** 400

### C212 · /liquidations returns the liquidations rows

**Function** `GET /liquidations` · **Tier** BE/API · **Priority** High · **Run** Auto

**Purpose.** DB ↔ API on liquidations

**Precondition.** anvil with a fresh PerpDEX; mini-api running and its indexer caught up

**Steps.**
1. after a liquidation → GET /liquidations → expect total == COUNT and the newest row == the DB row

**Expected.** Equal

### C213 · No token is 401

**Function** `GET /portfolio/summary` · **Tier** BE/API · **Priority** High · **Run** Auto

**Purpose.** Private data

**Precondition.** anvil with a fresh PerpDEX; mini-api running and its indexer caught up

**Steps.**
1. GET /portfolio/summary → 401 unauthenticated

**Expected.** 401

### C214 · An unknown token is 401

**Function** `GET /portfolio/summary` · **Tier** BE/API · **Priority** High · **Run** Auto

**Purpose.** A made-up token must not be treated as read-scope

**Precondition.** anvil with a fresh PerpDEX; mini-api running and its indexer caught up

**Steps.**
1. Authorization: Bearer nope → 401 unauthenticated

**Expected.** 401

### C215 · A read-scope token is 403

**Function** `GET /portfolio/summary` · **Tier** BE/API · **Priority** High · **Run** Auto

**Purpose.** Scope is enforced, not just presence

**Precondition.** anvil with a fresh PerpDEX; mini-api running and its indexer caught up

**Steps.**
1. mint a read token via /auth/token → GET /portfolio/summary → 403 forbidden

**Expected.** 403

### C216 · A portfolio token bound to alice cannot read bob

**Function** `GET /portfolio/summary` · **Tier** BE/API · **Priority** High · **Run** Auto

**Purpose.** Subject binding

**Precondition.** anvil with a fresh PerpDEX; mini-api running and its indexer caught up

**Steps.**
1. mint a portfolio token with subject alice → GET /portfolio/summary?account=bob → 403 forbidden

**Expected.** 403

### C217 · A portfolio token returns exactly the documented fields, equal to the rows

**Function** `GET /portfolio/summary` · **Tier** BE/API · **Priority** High · **Run** Auto

**Purpose.** DB ↔ API on the private view, and the field set is closed: nothing beyond account, exists, deposits, withdrawals, open_orders, positions

**Precondition.** anvil with a fresh PerpDEX; mini-api running and its indexer caught up

**Steps.**
1. mint a portfolio token for alice → GET /portfolio/summary → 200; keys == {account, exists, deposits, withdrawals, open_orders, positions}; values == accounts row, COUNT(open+pending orders), positions rows

**Expected.** Closed field set, equal to rows

### C218 · An expired token is 401 token_expired

**Function** `GET /portfolio/summary` · **Tier** BE/API · **Priority** Medium · **Run** Auto

**Purpose.** TTL enforcement

**Precondition.** anvil with a fresh PerpDEX; mini-api running and its indexer caught up

**Steps.**
1. mint a portfolio token with ttl 1 → wait 2 s → GET → 401 code token_expired

**Expected.** 401 token_expired

### C219 · Only an admin token can mint tokens

**Function** `POST /auth/token` · **Tier** BE/API · **Priority** High · **Run** Auto

**Purpose.** Privilege escalation guard

**Precondition.** anvil with a fresh PerpDEX; mini-api running and its indexer caught up

**Steps.**
1. POST /auth/token with a read token → 403; with no token → 401; with admin → 201 and a token row appears in api_keys

**Expected.** 403 / 401 / 201

### C220 · An unknown scope or a malformed subject is 400

**Function** `POST /auth/token` · **Tier** BE/API · **Priority** Low · **Run** Auto

**Purpose.** Input validation

**Precondition.** anvil with a fresh PerpDEX; mini-api running and its indexer caught up

**Steps.**
1. {scope: "root"} → 400; {scope: "read", subject: "x"} → 400

**Expected.** 400

### C221 · An allowlisted origin is echoed back exactly, with credentials

**Function** `CORS` · **Tier** BE/API · **Priority** High · **Run** Auto

**Purpose.** The positive control for the six negatives below

**Precondition.** anvil with a fresh PerpDEX; mini-api running and its indexer caught up

**Steps.**
1. GET /markets with Origin: https://app.example.test → expect Access-Control-Allow-Origin == that exact string and Allow-Credentials true

**Expected.** Exact echo

### C222 · A suffix attack origin gets no CORS header

**Function** `CORS` · **Tier** BE/API · **Priority** High · **Run** Auto

**Purpose.** https://app.example.test.evil.com must not match

**Precondition.** anvil with a fresh PerpDEX; mini-api running and its indexer caught up

**Steps.**
1. Origin: https://app.example.test.evil.com → expect no Access-Control-Allow-Origin

**Expected.** No header

### C223 · The parent domain gets no CORS header

**Function** `CORS` · **Tier** BE/API · **Priority** High · **Run** Auto

**Purpose.** https://example.test is not https://app.example.test

**Precondition.** anvil with a fresh PerpDEX; mini-api running and its indexer caught up

**Steps.**
1. Origin: https://example.test → expect no Access-Control-Allow-Origin

**Expected.** No header

### C224 · The same host over http gets no CORS header

**Function** `CORS` · **Tier** BE/API · **Priority** High · **Run** Auto

**Purpose.** Scheme is part of the origin

**Precondition.** anvil with a fresh PerpDEX; mini-api running and its indexer caught up

**Steps.**
1. Origin: http://app.example.test → expect no Access-Control-Allow-Origin

**Expected.** No header

### C225 · An explicit :443 gets no CORS header

**Function** `CORS` · **Tier** BE/API · **Priority** Medium · **Run** Auto

**Purpose.** Exact string match, no normalisation

**Precondition.** anvil with a fresh PerpDEX; mini-api running and its indexer caught up

**Steps.**
1. Origin: https://app.example.test:443 → expect no Access-Control-Allow-Origin

**Expected.** No header

### C226 · "null" and a missing Origin get no CORS header

**Function** `CORS` · **Tier** BE/API · **Priority** Medium · **Run** Auto

**Purpose.** null must not be allowlisted; a request with no Origin is not cross-origin and gets nothing -- which is correct, not a misconfiguration

**Precondition.** anvil with a fresh PerpDEX; mini-api running and its indexer caught up

**Steps.**
1. Origin: null → expect no ACAO
2. no Origin header → expect no ACAO and a normal 200

**Expected.** No header in both

### C227 · Preflight from an allowed origin is 204 with methods and headers

**Function** `CORS` · **Tier** BE/API · **Priority** Medium · **Run** Auto

**Purpose.** Browsers need the preflight to succeed

**Precondition.** anvil with a fresh PerpDEX; mini-api running and its indexer caught up

**Steps.**
1. OPTIONS /portfolio/summary with Origin allowed and Access-Control-Request-Method GET → expect 204, Allow-Methods contains GET, Allow-Headers contains Authorization

**Expected.** 204 with the headers

### C228 · Over the limit the API answers 429 with Retry-After

**Function** `rate limit` · **Tier** BE/API · **Priority** High · **Run** Auto

**Purpose.** A limiter that silently drops or returns 200 is worse than none

**Precondition.** anvil with a fresh PerpDEX; mini-api running and its indexer caught up

**Steps.**
1. send limit+5 requests inside the window → expect the last ones 429, body code rate_limited, Retry-After header a positive integer, and X-RateLimit-Remaining 0 before the first 429

**Expected.** 429 + Retry-After

### C229 · With the indexer paused the API keeps answering 200 with stale rows, and says so in /health

**Function** `indexer paused` · **Tier** BE/API · **Priority** High · **Run** Auto

**Purpose.** The failure that looks like health: the store is frozen, the API is fine, only the block number and the age give it away

**Precondition.** anvil with a fresh PerpDEX; mini-api running and its indexer caught up

**Steps.**
1. pause indexer; alice buys at market; wait 2 s → GET /trades total unchanged, status 200, X-Indexed-Block unchanged; GET /health indexer_paused true and age_seconds growing
2. unpause → total +1

**Expected.** 200 with stale data while paused; /health reveals it

## 08. API — authentication edges

### C302 · A malformed Authorization header (no Bearer scheme) is 401

**Function** `Authorization header` · **Tier** BE/API · **Priority** High · **Run** Auto

**Purpose.** The token check must key on the Bearer scheme, not merely on some header being present

**Precondition.** anvil with a fresh PerpDEX; mini-api running and its indexer caught up

**Steps.**
1. GET /portfolio/summary?account=<any> with header "Authorization: Token k_whatever" (no Bearer scheme) → 401 unauthenticated

**Expected.** 401 unauthenticated

### C303 · Public responses never carry a bearer token

**Function** `secret hygiene` · **Tier** BE/API · **Priority** Medium · **Run** Auto

**Purpose.** A minted token is returned once at /auth/token and must never echo back in ordinary reads

**Precondition.** anvil with a fresh PerpDEX; mini-api running and its indexer caught up

**Steps.**
1. GET /markets → the JSON body contains no "k_" bearer token
2. GET /health → the JSON body contains no "k_" bearer token

**Expected.** No credential in the response bodies

