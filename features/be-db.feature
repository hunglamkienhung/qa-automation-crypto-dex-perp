@module:05-db @be @db @perpdex
Feature: The indexer's store, read directly

  Both stacks open the SQLite file mini-api writes and assert on its rows.
  Every scenario compares the store with the chain: a divergence here is the
  indexer's, not the API's. The API is never called except to pull the two
  admin levers (pause, rewind) that only it exposes.

  Scenarios snapshot and revert the chain like the contract tier does; the
  indexer notices the revert and rebuilds, and every scenario waits for the
  store to catch up with the chain head before reading.

  Background:
    Given the store is open and the indexer has caught up

  # ---------------------------------------------------------------- schema and state

  @case:164 @priority:high
  Scenario: The store has the documented tables, and every event table is keyed by (tx_hash, log_index)
    Then the store has tables indexer_state, markets, orders, trades, positions, position_events, funding, liquidations, accounts, index_prices, applied_logs, api_keys
    And the tables trades, funding, liquidations, position_events, applied_logs are uniquely keyed by (tx_hash, log_index)

  @case:165 @priority:high
  Scenario: Schema constraints refuse a zero-size trade, an unknown market, and a bad status
    Given a throwaway database with the schema applied
    Then inserting a trade of size "0" fails a CHECK
    And inserting an order on market 99 fails a FOREIGN KEY
    And inserting a market with status "Weird" fails a CHECK
    And inserting the same trade key twice fails on the second insert

  @case:166 @priority:high
  Scenario: The store follows exactly the deployed exchange on chain 31337
    Then indexer_state.exchange equals the deployed exchange address
    And indexer_state.chain_id is 31337
    And indexer_state.genesis_hash equals the chain's block 0 hash

  @case:167 @priority:high
  Scenario: The indexer keeps up: last_block reaches the chain head within the poll interval
    When a block is mined
    And the store has caught up
    Then indexer_state.last_block equals the chain head
    And indexer_state.last_block_hash equals the hash of that block

  @case:168 @priority:high
  Scenario: Market rows equal the contract getters
    Then the markets table has as many rows as marketCount
    And every markets row equals getMarket and getMarketParams

  @case:169 @priority:high
  Scenario: The stored index price follows the oracle
    Given the ETH index is set to 2600
    And the store has caught up
    Then index_prices for ETH equals getIndexPrice

  # ---------------------------------------------------------------- trades and orders

  @case:170 @priority:high
  Scenario: One OrderFilled becomes exactly one trades row, keyed by its tx and log index
    Given a funded trader alice with $100000
    And a funded trader bob with $100000
    And bob places a limit sell of 1 ETH at 2501 as "ask"
    When alice places a market buy of 1 ETH as "take"
    And the store has caught up
    Then the OrderFilled event of the last call has exactly one trades row
    And that trades row equals the event

  @case:171 @priority:high
  Scenario: A backstop fill is stored with the zero address as maker and maker_order_id 0
    Given a funded trader alice with $100000
    When alice places a market buy of 1 ETH as "take"
    And the store has caught up
    Then the trades row of the last call has maker the zero address and maker_order_id 0

  @case:172 @priority:high
  Scenario: Every trade references an order the store knows
    Given a funded trader alice with $100000
    And a funded trader bob with $100000
    And bob places a limit sell of 1 ETH at 2501 as "ask"
    And alice places a market buy of 2 ETH as "take"
    And the store has caught up
    Then no trades row references a taker order missing from orders
    And no trades row references a maker order missing from orders

  @case:173 @priority:high
  Scenario: An OrderPlaced becomes an orders row equal to getOrder
    Given a funded trader alice with $100000
    When alice places a limit buy of 1 ETH at 2498 with user order id 77 as "bid"
    And the store has caught up
    Then the orders row for "bid" equals getOrder

  @case:174 @priority:high
  Scenario: After a full fill the row shows filled == size and status Filled, like the chain
    Given a funded trader alice with $100000
    And a funded trader bob with $100000
    And bob places a limit sell of 1 ETH at 2501 as "ask"
    When alice places a market buy of 1 ETH as "take"
    And the store has caught up
    Then the orders row for "ask" has filled equal to size and status Filled
    And order "ask" status is Filled

  @case:175 @priority:medium
  Scenario: A cancel is reflected as status Cancelled
    Given a funded trader alice with $100000
    And alice places a limit buy of 1 ETH at 2498 as "bid"
    When alice cancels order "bid"
    And the store has caught up
    Then the orders row for "bid" has status Cancelled

  # ---------------------------------------------------------------- positions

  @case:176 @priority:high
  Scenario: The positions row equals getPosition for size and entry price
    Given a funded trader alice with $100000
    And a funded trader bob with $100000
    And bob places a limit sell of 2 ETH at 2501 as "ask"
    And alice places a market buy of 2 ETH as "take"
    And bob places a limit buy of 0.5 ETH at 2499 as "bid"
    When alice places a market sell of 0.5 ETH as "reduce"
    And the store has caught up
    Then the positions row for alice on ETH equals getPosition

  @case:177 @priority:medium
  Scenario: Lifetime realised PnL in the store equals the contract's
    Given a funded trader alice with $100000
    And a funded trader bob with $100000
    And bob places a limit sell of 1 ETH at 2500 as "ask"
    And alice places a market buy of 1 ETH as "take"
    And bob places a limit buy of 1 ETH at 2502 as "bid"
    When alice places a market sell of 1 ETH as "close"
    And the store has caught up
    Then the positions row for alice on ETH has realized_pnl equal to getPosition

  @case:178 @priority:high
  Scenario: Per market, long sizes equal short sizes, and both equal the contract's open interest
    Given a funded trader alice with $1000000
    And alice places a market buy of 0.01 BTC as "b"
    And alice places a market buy of 1 ETH as "e"
    And alice places a market buy of 10 SOL as "s"
    And the store has caught up
    Then for every market the positions table is balanced and equals getMarket open interest

  @case:179 @priority:medium
  Scenario: One fill writes two position_events rows: taker and maker (backstop included)
    Given a funded trader alice with $100000
    When alice places a market buy of 1 ETH as "take"
    And the store has caught up
    Then the position_events rows of the last call are two, for alice and the backstop, with opposite signs

  # ---------------------------------------------------------------- funding, liquidation, accounts

  @case:180 @priority:medium
  Scenario: A FundingUpdated across a boundary becomes a funding row equal to getFundingRate
    Given a funded trader alice with $1000000
    And a funded trader bob with $100000
    And bob places a limit sell of 1 ETH at 2520 as "ask"
    And alice places a limit buy of 101 ETH at 2520 as "sweep"
    And the clock advances 3600 seconds
    When a keeper updates funding for ETH
    And the store has caught up
    Then the newest funding row for ETH equals getFundingRate

  @case:181 @priority:high
  Scenario: A liquidation becomes a liquidations row equal to the Liquidated event
    Given a funded trader victim with $60
    And victim buys 1 ETH at market
    And the ETH index is set to 2440
    When a keeper liquidates victim on ETH
    And the store has caught up
    Then the liquidations row of the last call equals the Liquidated event

  @case:182 @priority:low
  Scenario: Deposits and withdrawals accumulate on the accounts row
    Given a funded trader alice with $1000
    When alice withdraws $250
    And the store has caught up
    Then the accounts row for alice has deposits $1000 and withdrawals $250

  # ---------------------------------------------------------------- indexer behaviour

  @case:183 @priority:high
  Scenario: Replaying an already-indexed range changes nothing
    Given a funded trader alice with $100000
    And a funded trader bob with $100000
    And bob places a limit sell of 1 ETH at 2501 as "ask"
    And alice places a market buy of 2 ETH as "take"
    And the store has caught up
    And the store row counts are noted
    When the indexer is rewound by 10 blocks
    And the store has caught up
    Then the store row counts are unchanged
    And the positions row for alice on ETH equals getPosition

  @case:184 @priority:high
  Scenario: A paused indexer freezes the store while the chain moves on
    Given a funded trader alice with $100000
    And the trades count is noted
    And the indexer is paused
    When alice places a market buy of 1 ETH as "take"
    And 2 seconds pass
    Then indexer_state.last_block is below the chain head
    And the trades count is unchanged
    When the indexer is unpaused
    And the store has caught up
    Then indexer_state.last_block equals the chain head
    And the trades count grew by 1

  @case:185 @priority:high
  Scenario: After the chain reverts, the store rebuilds and matches the chain again
    Given a funded trader alice with $100000
    And the trades count is noted
    And the rebuild count is noted
    And a chain snapshot is taken
    And alice places a market buy of 1 ETH as "take"
    And the store has caught up
    Then the trades count grew by 1
    When the chain is reverted to the snapshot
    And the store has caught up
    Then the rebuild count grew by 1
    And indexer_state.last_block equals the chain head
    And the trades count is unchanged
    And the positions row for alice on ETH equals getPosition

  @case:186 @priority:high
  Scenario: Events from a second PerpDEX at another address are invisible to the store
    Given a second PerpDEX is deployed from the build artifact
    When grace initialises an account on the second PerpDEX
    And a block is mined
    And the store has caught up
    Then the accounts table has no row for grace
    And indexer_state.exchange equals the deployed exchange address

  # ---------------------------------------------------------------- mark derivation, per market

  Scenario Outline: <sym>: mark derived from store rows equals getMarkPrice
    Given a funded trader alice with $10000000
    And a funded trader bob with $1000000
    And a fill on <sym> lands the mark above the index by 0.8 percent
    And the store has caught up
    Then the mark derived from the store for <sym> equals getMarkPrice

    @case:187
    Examples:
      | sym |
      | ETH |

    @case:188
    Examples:
      | sym |
      | BTC |

    @case:189
    Examples:
      | sym |
      | SOL |
