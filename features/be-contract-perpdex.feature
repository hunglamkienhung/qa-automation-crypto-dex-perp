@module:04-contract-perpdex @be @contract @perpdex
Feature: PerpDEX — the exchange this repository can write to

  Every scenario runs against the venue in contracts/, deployed on a local
  anvil (chainId 31337). The harness takes an EVM snapshot before each
  scenario and reverts to it after, so every scenario starts from the same
  freshly deployed state: three markets, a funded insurance fund and
  backstop, index prices BTC 60000 / ETH 2500 / SOL 100, nobody trading.

  Traders are anvil's unlocked accounts: the node signs, the client holds no
  key, and the client refuses to send to any chain but 31337.

  Numbers are written as a trader reads them -- "1 ETH", "2501", "$1000" --
  and converted to the contract's units by the steps. The backstop quotes
  index ± 10 bps (ETH: 2497.50 / 2502.50), so a limit order priced outside
  that spread fills against it at once; orders meant to rest are priced
  inside it.

  # ================================================================ 01 accounts & collateral

  @case:43 @priority:high
  Scenario: An account can be initialised exactly once
    Given an unfunded address alice
    When alice initialises an account
    Then the call succeeds
    And an AccountInitialized event names alice
    And alice's account exists
    When alice initialises an account
    Then the call reverts with AccountExists

  @case:44 @priority:high
  Scenario: Deposit before initialisation is rejected
    Given an unfunded address alice holding $100 of USDC
    When alice deposits $100
    Then the call reverts with AccountNotFound
    And alice's vault balance is $0

  @case:45 @priority:high
  Scenario: Deposit moves tokens into the vault and credits the ledger by the same amount
    Given an unfunded address alice holding $1000 of USDC
    And alice has initialised an account
    When alice deposits $1000
    Then the call succeeds
    And a Deposited event names alice with amount $1000
    And alice's vault balance is $1000
    And the vault holds exactly its ledger

  @case:46 @priority:high
  Scenario: Withdrawal is capped at free collateral
    Given a funded trader alice with $1000
    And alice buys 1 ETH at market
    When alice withdraws one unit more than her free collateral
    Then the call reverts with InsufficientCollateral
    When alice withdraws exactly her free collateral
    Then the call succeeds
    And alice's free collateral is at most $0

  @case:47 @priority:medium
  Scenario: An account below zero can withdraw nothing
    Given the insurance fund is drained
    And a funded trader victim with $60
    And victim buys 1 ETH at market
    And the ETH index is set to 1500
    And a keeper liquidates victim on ETH
    Then victim's vault balance is below $0
    When victim withdraws $0.000001
    Then the call reverts with InsufficientCollateral

  @case:48 @priority:low
  Scenario: Zero-amount deposit and withdrawal are rejected
    Given a funded trader alice with $10
    When alice deposits $0
    Then the call reverts with ZeroAmount
    When alice withdraws $0
    Then the call reverts with ZeroAmount

  @case:49 @priority:high
  Scenario: Only the exchange may move vault balances
    Given a funded trader alice with $10
    When alice calls the vault's transferBetween directly
    Then the call reverts with NotExchange
    When alice calls the vault's withdrawFor directly
    Then the call reverts with NotExchange

  @case:50 @priority:low
  Scenario: getAccount reports existence, open orders and creation time
    Given a funded trader alice with $10000
    Then alice's account exists
    And alice has 0 open orders
    And alice's account was created in the current block or earlier
    When alice places a limit buy of 1 ETH at 2498 as "bid"
    Then alice has 1 open orders

  # ================================================================ 02 markets & status

  @case:51 @priority:high
  Scenario: Admin adds a market and it is immediately Active
    When the admin adds market "LINK-PERP" with the ETH parameters
    Then the call succeeds
    And the new market id is 3
    And market 3 is Active
    And market 3's last funding time is on an interval boundary

  @case:52 @priority:high
  Scenario: A non-admin cannot add a market
    Given a funded trader alice with $10
    When alice adds market "X" with the ETH parameters
    Then the call reverts with NotAdmin
    And the market count is 3

  @case:53 @priority:high
  Scenario: Parameters that cannot work together are refused
    When the admin adds market "BAD" with the ETH parameters except maintenanceMarginBps = 200
    Then the call reverts with BadParams "maintenanceMarginBps"
    When the admin adds market "BAD" with the ETH parameters except maxLeverage = 100
    Then the call reverts with InvalidLeverage
    When the admin adds market "BAD" with the ETH parameters except takerFeeBps = 501
    Then the call reverts with BadParams "takerFeeBps"
    When the admin adds market "BAD" with the ETH parameters except makerFeeBps = -6
    Then the call reverts with BadParams "makerFeeBps"

  @case:54 @priority:low
  Scenario: The market count is capped
    When the admin adds markets until the count reaches 16
    And the admin adds market "ONE-TOO-MANY" with the ETH parameters
    Then the call reverts with TooManyMarkets

  @case:55 @priority:high
  Scenario: A Paused market rejects every new order, including reducing ones
    Given a funded trader alice with $100000
    And alice buys 1 ETH at market
    And alice places a limit buy of 1 ETH at 2498 as "resting"
    And the admin sets market ETH to Paused
    When alice sells 1 ETH at market
    Then the call reverts with MarketPaused
    When alice cancels order "resting"
    Then the call succeeds

  @case:56 @priority:high
  Scenario: A ReduceOnly market accepts only orders that shrink a position
    Given a funded trader alice with $100000
    And alice buys 2 ETH at market
    And the admin sets market ETH to ReduceOnly
    When alice buys 1 ETH at market
    Then the call reverts with ReduceOnlyViolation
    When alice sells 3 ETH at market
    Then the call reverts with ReduceOnlyViolation
    When alice sells 1 ETH at market
    Then the call succeeds
    And alice's ETH position size is 1 ETH

  @case:57 @priority:high
  Scenario: Settling requires a settlement price and rejects orders
    Given a funded trader alice with $100000
    When the admin sets market ETH to Settling at 0
    Then the call reverts with BadParams "settlementPrice"
    When the admin sets market ETH to Settling at 2600
    Then the call succeeds
    And a MarketStatusChanged event reports ETH Settling at 2600
    When alice places a limit buy of 1 ETH at 2498 as "x"
    Then the call reverts with MarketSettling

  @case:58 @priority:high
  Scenario: Anyone can settle a position at the settlement price
    Given a funded trader alice with $100000
    And a funded trader bob with $100000
    And bob places a limit sell of 1 ETH at 2500 as "ask"
    And alice buys 1 ETH at market
    And the admin sets market ETH to Settling at 2600
    When a keeper settles alice's ETH position
    Then the call succeeds
    And alice's ETH position size is 0 ETH
    And alice's ETH realised pnl is $100
    When a keeper settles bob's ETH position
    Then bob's ETH realised pnl is $-100
    When a keeper settles alice's ETH position
    Then the call reverts with NoPosition

  @case:59 @priority:medium
  Scenario: settlePosition on an Active market reverts
    Given a funded trader alice with $100000
    And alice buys 1 ETH at market
    When a keeper settles alice's ETH position
    Then the call reverts with MarketNotSettling

  @case:60 @priority:low
  Scenario: Market getters return the configured parameters unchanged
    Then the ETH market parameters are:
      | tickSize              | 1000000     |
      | stepSize              | 100000      |
      | minNotional           | 10000000    |
      | maxLeverage           | 50          |
      | initialMarginBps      | 200         |
      | maintenanceMarginBps  | 100         |
      | makerFeeBps           | -2          |
      | takerFeeBps           | 5           |
      | priceBandBps          | 500         |
      | maxBasisBps           | 100         |
      | liquidationFeeBps     | 50          |
      | partialLiquidationBps | 5000        |
      | fundingRateCapBps     | 75          |
      | fundingIntervalSec    | 3600        |
      | backstopSpreadBps     | 10          |
      | backstopMaxSize       | 10000000000 |

  # ================================================================ 03 order types × time in force

  @case:61 @priority:high
  Scenario: A market order fills immediately at the best available price
    Given a funded trader alice with $100000
    When alice places a market buy of 1 ETH as "mkt"
    Then the call succeeds
    And order "mkt" status is Filled
    And alice's ETH entry price is 2502.5

  @case:62 @priority:high
  Scenario: A market order larger than available liquidity fills what it can and cancels the rest
    Given a funded trader alice with $1000000
    When alice places a market buy of 150 ETH as "big"
    Then the call succeeds
    And order "big" filled is 100 ETH
    And order "big" status is Cancelled
    And an OrderCancelled event has reason "unfilled"

  @case:63 @priority:high
  Scenario: A GTC limit that does not cross rests on the book
    Given a funded trader alice with $100000
    When alice places a limit buy of 1 ETH at 2400 as "bid"
    Then the call succeeds
    And order "bid" status is Open
    And the ETH order book has a bid at 2400 of 1 ETH from the book

  @case:64 @priority:high
  Scenario: A limit that crosses fills at the resting price, not its own
    Given a funded trader alice with $100000
    And a funded trader bob with $100000
    And bob places a limit sell of 1 ETH at 2501 as "ask"
    When alice places a limit buy of 1 ETH at 2501.2 as "bid"
    Then alice's ETH entry price is 2501

  @case:65 @priority:medium
  Scenario: A GTC limit partially filled rests for the remainder
    Given a funded trader alice with $100000
    And a funded trader bob with $100000
    And bob places a limit sell of 1 ETH at 2501 as "ask"
    When alice places a limit buy of 3 ETH at 2501 as "bid"
    Then order "bid" filled is 1 ETH
    And order "bid" status is Open

  @case:66 @priority:high
  Scenario: IOC fills what crosses and cancels the remainder
    Given a funded trader alice with $100000
    And a funded trader bob with $100000
    And bob places a limit sell of 1 ETH at 2501 as "ask"
    When alice places an IOC limit buy of 3 ETH at 2501 as "ioc"
    Then order "ioc" filled is 1 ETH
    And order "ioc" status is Cancelled
    And alice has 0 open orders

  @case:67 @priority:high
  Scenario: FOK reverts when the full size cannot be filled, taking nothing
    Given a funded trader alice with $100000
    And a funded trader bob with $100000
    And bob places a limit sell of 1 ETH at 2501 as "ask"
    When alice places a FOK limit buy of 2 ETH at 2501 as "fok"
    Then the call reverts with FillOrKillUnfillable
    And order "ask" filled is 0 ETH

  @case:68 @priority:medium
  Scenario: FOK fills completely when liquidity suffices
    Given a funded trader alice with $100000
    And a funded trader bob with $100000
    And bob places a limit sell of 1 ETH at 2501 as "ask"
    When alice places a FOK limit buy of 1 ETH at 2501 as "fok"
    Then order "fok" status is Filled

  @case:69 @priority:medium
  Scenario: FOK counts the backstop when the limit reaches its quote
    Given a funded trader alice with $1000000
    When alice places a FOK limit buy of 50 ETH at 2503 as "fok"
    Then order "fok" status is Filled
    And alice's ETH entry price is 2502.5

  @case:70 @priority:high
  Scenario: PostOnly rests when it does not cross
    Given a funded trader alice with $100000
    When alice places a post-only limit buy of 1 ETH at 2490 as "po"
    Then order "po" status is Open

  @case:71 @priority:high
  Scenario: PostOnly that would cross is rejected with the best opposite price
    Given a funded trader alice with $100000
    And a funded trader bob with $100000
    And bob places a limit sell of 1 ETH at 2510 as "ask"
    When alice places a post-only limit buy of 1 ETH at 2510 as "po"
    Then the call reverts with PostOnlyWouldCross
    And the revert arguments are 2510 and 2502.5

  @case:72 @priority:high
  Scenario: A stop order parks as Pending and holds a slot without executing
    Given a funded trader alice with $100000
    When alice places a stop-market buy of 1 ETH triggered at 2600 on the index as "stop"
    Then order "stop" status is Pending
    And market ETH has 1 pending triggers
    And alice's ETH position size is 0 ETH
    And alice has 1 open orders

  @case:73 @priority:high
  Scenario: A keeper triggers a stop once the source price crosses it
    Given a funded trader alice with $100000
    And alice places a stop-market buy of 1 ETH triggered at 2600 on the index as "stop"
    When a keeper triggers order "stop"
    Then the call reverts with TriggerNotMet
    Given the ETH index is set to 2600
    When a keeper triggers order "stop"
    Then the call succeeds
    And an OrderTriggered event names order "stop"
    And order "stop" status is Filled
    And alice's ETH position size is 1 ETH
    And market ETH has 0 pending triggers

  @case:74 @priority:medium
  Scenario: A stop-limit becomes a limit at its price after triggering
    Given a funded trader alice with $100000
    And alice places a stop-limit buy of 1 ETH triggered at 2600 with limit 2610 on the index as "sl"
    And the ETH index is set to 2600
    When a keeper triggers order "sl"
    Then order "sl" status is Filled
    And alice's ETH entry price is 2602.6

  @case:75 @priority:medium
  Scenario: Take-profit triggers in the opposite direction to a stop
    Given a funded trader alice with $100000
    And alice buys 1 ETH at market
    And alice places a reduce-only take-profit sell of 1 ETH triggered at 2600 on the index as "tp"
    When a keeper triggers order "tp"
    Then the call reverts with TriggerNotMet
    Given the ETH index is set to 2600
    When a keeper triggers order "tp"
    Then the call succeeds
    And alice's ETH position size is 0 ETH

  @case:76 @priority:high
  Scenario: Mark and Index trigger sources are distinct
    Given a funded trader alice with $1000000
    And a funded trader bob with $100000
    And bob places a limit sell of 1 ETH at 2520 as "ask"
    And alice places a limit buy of 101 ETH at 2520 as "sweep"
    Then the mark price of ETH is 2520
    And the index price of ETH is 2500
    Given bob places a stop-market buy of 1 ETH triggered at 2515 on the mark as "byMark"
    And bob places a stop-market buy of 1 ETH triggered at 2515 on the index as "byIndex"
    When a keeper triggers order "byMark"
    Then the call succeeds
    When a keeper triggers order "byIndex"
    Then the call reverts with TriggerNotMet

  @case:77 @priority:high
  Scenario: maxTs is compared to the chain clock in microseconds
    # The exact-equality boundary is asserted in the forge suite, where the
    # clock stands still. Over RPC every transaction mines a new block and the
    # clock moves between the simulation and the mined block, so here the two
    # sides of the boundary are one microsecond behind and sixty seconds ahead.
    Given a funded trader alice with $100000
    When alice places a limit buy of 1 ETH at 2400 expiring 1 microsecond before the chain clock as "late"
    Then the call reverts with OrderExpired
    When alice places a limit buy of 1 ETH at 2400 expiring 60 seconds after the chain clock as "live"
    Then the call succeeds

  # ================================================================ 04 book & matching

  @case:78 @priority:high
  Scenario: Price priority, then time priority
    Given a funded trader alice with $100000
    And a funded trader bob with $100000
    And a funded trader carol with $100000
    And a funded trader dave with $100000
    And alice places a limit sell of 1 ETH at 2501 as "A"
    And bob places a limit sell of 1 ETH at 2502 as "B"
    And carol places a limit sell of 1 ETH at 2501 as "C"
    When dave places a market buy of 1.5 ETH as "take"
    Then order "A" status is Filled
    And order "C" filled is 0.5 ETH
    And order "B" filled is 0 ETH

  @case:79 @priority:medium
  Scenario: getOrderBook aggregates same-price orders into one level
    Given a funded trader alice with $100000
    And a funded trader bob with $100000
    And alice places a limit sell of 1 ETH at 2501 as "a1"
    And bob places a limit sell of 1 ETH at 2501 as "a2"
    Then the ETH order book has an ask at 2501 of 2 ETH from the book

  @case:80 @priority:high
  Scenario: The backstop appears on both sides of the book with source 1
    Then the ETH order book has a bid at 2497.5 of 100 ETH from the backstop
    And the ETH order book has an ask at 2502.5 of 100 ETH from the backstop

  @case:81 @priority:high
  Scenario: A better book price is taken before the backstop, and the backstop fills the rest
    Given a funded trader alice with $100000
    And a funded trader bob with $100000
    And bob places a limit sell of 1 ETH at 2501 as "ask"
    When alice places a market buy of 2 ETH as "take"
    Then alice's ETH position size is 2 ETH
    And alice's ETH entry price is 2501.75
    And order "ask" status is Filled
    And the backstop's ETH position size is -1 ETH

  @case:82 @priority:medium
  Scenario: An unfunded backstop does not quote
    Given the backstop is drained
    And a funded trader alice with $100000
    Then the ETH order book has no backstop levels
    When alice places a market buy of 1 ETH as "mkt"
    Then order "mkt" status is Cancelled
    And order "mkt" filled is 0 ETH

  @case:83 @priority:high
  Scenario: Self-trade is prevented
    Given a funded trader alice with $100000
    And alice places a limit sell of 1 ETH at 2501 as "ask"
    When alice places a limit buy of 1 ETH at 2501 as "bid"
    Then the call reverts with SelfTradePrevented
    And the revert names order "ask"

  @case:84 @priority:high
  Scenario: Cancel removes the order from the book and frees the slot
    Given a funded trader alice with $100000
    And alice places a limit buy of 1 ETH at 2400 as "bid"
    When alice cancels order "bid"
    Then the call succeeds
    And an OrderCancelled event has reason "user"
    And order "bid" status is Cancelled
    And alice has 0 open orders
    And the ETH order book has no bid at 2400

  @case:85 @priority:high
  Scenario: Only the owner can cancel
    Given a funded trader alice with $100000
    And a funded trader bob with $100000
    And alice places a limit buy of 1 ETH at 2400 as "bid"
    When bob cancels order "bid"
    Then the call reverts with NotOrderOwner

  @case:86 @priority:medium
  Scenario: cancelAll is scoped by market, or all markets with the sentinel
    Given a funded trader alice with $100000
    And alice places a limit buy of 1 ETH at 2400 as "e1"
    And alice places a limit buy of 1 ETH at 2401 as "e2"
    And alice places a limit buy of 0.01 BTC at 59000 as "b1"
    When alice cancels all orders on ETH
    Then alice has 1 open orders
    When alice cancels all orders on every market
    Then alice has 0 open orders

  # ================================================================ 05 positions

  @case:87 @priority:high
  Scenario: Adding to a position blends the entry by volume
    Given a funded trader alice with $100000
    And a funded trader bob with $100000
    And bob places a limit sell of 1 ETH at 2500 as "a1"
    And alice buys 1 ETH at market
    And bob places a limit sell of 1 ETH at 2501 as "a2"
    And alice buys 1 ETH at market
    Then alice's ETH position size is 2 ETH
    And alice's ETH entry price is 2500.5

  @case:88 @priority:high
  Scenario: Reducing realises PnL at the fill price and leaves the entry unchanged
    Given a funded trader alice with $100000
    And a funded trader bob with $100000
    And bob places a limit sell of 2 ETH at 2500 as "ask"
    And alice buys 2 ETH at market
    And bob places a limit buy of 1 ETH at 2502 as "bid"
    And alice's vault balance is noted
    When alice sells 1 ETH at market
    Then alice's ETH position size is 1 ETH
    And alice's ETH entry price is 2500
    And alice's ETH realised pnl is $2
    And alice's vault balance changed by $0.749

  @case:89 @priority:high
  Scenario: A fill larger than the position flips it, closing at the old entry and opening at the fill
    Given a funded trader alice with $100000
    And a funded trader bob with $100000
    And bob places a limit sell of 1 ETH at 2500 as "ask"
    And alice buys 1 ETH at market
    And bob places a limit buy of 3 ETH at 2498 as "bid"
    When alice sells 3 ETH at market
    Then alice's ETH position size is -2 ETH
    And alice's ETH entry price is 2498
    And alice's ETH realised pnl is $-2

  @case:90 @priority:medium
  Scenario: Closing to flat clears the entry and removes the holder
    Given a funded trader alice with $100000
    And a funded trader bob with $100000
    And bob places a limit sell of 1 ETH at 2500 as "ask"
    And alice buys 1 ETH at market
    Then ETH has 2 position holders
    Given bob places a limit buy of 1 ETH at 2500 as "bid"
    When alice sells 1 ETH at market
    Then alice's ETH position size is 0 ETH
    And alice's ETH entry price is 0
    And ETH has 0 position holders

  @case:91 @priority:high
  Scenario: Unrealised PnL in equity follows the mark, not the index
    Given a funded trader alice with $100000
    And a funded trader bob with $100000
    And bob places a limit sell of 1 ETH at 2500 as "ask"
    And alice buys 1 ETH at market
    And alice's equity is noted
    When the ETH index is set to 2600
    Then the mark price of ETH is 2574
    And alice's equity changed by $74

  @case:92 @priority:high
  Scenario: Open interest is tracked on both sides and always equal
    Given a funded trader alice with $100000
    And a funded trader bob with $100000
    And bob places a limit sell of 2 ETH at 2500 as "ask"
    And alice buys 2 ETH at market
    Then ETH open interest is 2 ETH long and 2 ETH short
    Given bob places a limit buy of 1 ETH at 2500 as "bid"
    When alice sells 1 ETH at market
    Then ETH open interest is 1 ETH long and 1 ETH short

  @case:93 @priority:low
  Scenario: Estimated liquidation price sits below entry for a long and above for a short
    Given a funded trader alice with $100
    And a funded trader bob with $100
    And alice buys 1 ETH at market
    And bob sells 1 ETH at market
    Then alice's estimated ETH liquidation price is below her entry and above 0
    And bob's estimated ETH liquidation price is above his entry

  # ================================================================ 06 price

  @case:94 @priority:high
  Scenario: Mark equals index until the first fill
    Then the mark price of ETH equals its index price

  @case:95 @priority:high
  Scenario: Mark is the last fill clamped to index ± maxBasis
    Given a funded trader alice with $1000000
    And a funded trader bob with $100000
    And bob places a limit sell of 1 ETH at 2520 as "ask"
    And alice places a limit buy of 101 ETH at 2520 as "sweep"
    Then the mark price of ETH is 2520
    When the ETH index is set to 2400
    Then the mark price of ETH is 2424

  @case:96 @priority:high
  Scenario: Limit prices outside index ± band are refused on both sides, and the edge is accepted
    Given a funded trader alice with $100000
    When alice places a limit buy of 1 ETH at 2374.99 as "low"
    Then the call reverts with PriceOutOfBand
    And the revert arguments are 2374.99, 2375 and 2625
    When alice places a limit sell of 1 ETH at 2625.01 as "high"
    Then the call reverts with PriceOutOfBand
    When alice places a limit buy of 1 ETH at 2375 as "edge"
    Then the call succeeds

  @case:97 @priority:high
  Scenario: Anyone can set the mock index until the market is locked
    Given a funded trader alice with $10
    When alice sets the ETH mock index to 2600
    Then the call succeeds
    And the index price of ETH is 2600

  @case:98 @priority:high
  Scenario: Locking the mock is admin-only and one-way; the admin feed still works
    Given a funded trader alice with $10
    When alice locks the ETH mock
    Then the call reverts with NotAdmin
    When the admin locks the ETH mock
    Then the call succeeds
    When alice sets the ETH mock index to 2700
    Then the call reverts with MockIsLocked
    When the admin sets the ETH index through the admin feed to 2700
    Then the index price of ETH is 2700

  @case:99 @priority:high
  Scenario: A reading older than maxAge reverts OracleStale; exactly maxAge is fresh
    Given a funded trader alice with $10
    When alice publishes an ETH reading of 2500 stamped 3601 seconds ago
    Then reading the ETH index reverts with OracleStale
    And the ETH oracle peek reports stale
    When alice publishes an ETH reading of 2500 stamped 3600 seconds ago
    Then the index price of ETH is 2500

  # ================================================================ 07 funding

  @case:100 @priority:high
  Scenario: updateFunding is permissionless and a no-op inside the interval
    When a keeper updates funding for ETH
    Then the call succeeds
    And ETH funding did not advance
    And the ETH funding rate is 0 bps

  @case:101 @priority:high
  Scenario: lastFundingTime always sits on an interval boundary
    Then market ETH's last funding time is on an interval boundary
    Given the clock advances 4834 seconds
    When a keeper updates funding for ETH
    Then ETH funding advanced
    And market ETH's last funding time is on an interval boundary
    And market ETH's last funding time is the most recent boundary

  @case:102 @priority:high
  Scenario: A positive premium makes longs pay and shorts receive
    Given a funded trader alice with $1000000
    And a funded trader bob with $100000
    And bob places a limit sell of 1 ETH at 2520 as "ask"
    And alice places a limit buy of 101 ETH at 2520 as "sweep"
    And the clock advances 3600 seconds
    When a keeper updates funding for ETH
    Then ETH funding advanced
    And the ETH funding rate is positive
    And the ETH funding rate is at most 75 bps
    Given alice's and bob's vault balances are noted
    And bob places a limit buy of 1 ETH at 2502 as "bid"
    When alice sells 1 ETH at market
    Then alice's vault balance decreased
    And bob's vault balance increased

  @case:103 @priority:high
  Scenario: The rate is clamped to ± fundingRateCapBps
    # Every fill samples the premium, and the backstop's own fills sample a
    # 10 bps premium that would dilute the average. With the backstop drained,
    # bob is the only liquidity and every sample sits at the 100 bps basis cap.
    Given the backstop is drained
    And a funded trader alice with $1000000
    And a funded trader bob with $100000
    And bob places a limit sell of 3 ETH at 2525 as "ask"
    And alice places a limit buy of 1 ETH at 2525 as "f1"
    And alice places a limit buy of 1 ETH at 2525 as "f2"
    And alice places a limit buy of 1 ETH at 2525 as "f3"
    Then the mark price of ETH is 2525
    Given the clock advances 3600 seconds
    When a keeper updates funding for ETH
    Then the ETH funding rate is 75 bps

  @case:104 @priority:medium
  Scenario: The rate is the average of premium samples
    Given a funded trader alice with $1000000
    And a funded trader bob with $100000
    And bob places a limit sell of 1 ETH at 2510 as "a1"
    And alice places a limit buy of 101 ETH at 2510 as "s1"
    And bob places a limit sell of 1 ETH at 2520 as "a2"
    # a 1 ETH buy would hit the backstop at 2502.50 first; 101 sweeps it and reaches bob
    And alice places a limit buy of 101 ETH at 2520 as "s2"
    And the clock advances 3600 seconds
    When a keeper updates funding for ETH
    Then the ETH funding rate is between 40 and 75 bps

  @case:105 @priority:high
  Scenario: Funding owed reduces equity before it is settled
    Given a funded trader alice with $1000000
    And a funded trader bob with $100000
    And bob places a limit sell of 1 ETH at 2520 as "ask"
    And alice places a limit buy of 101 ETH at 2520 as "sweep"
    And alice's equity is noted
    And the clock advances 3600 seconds
    When a keeper updates funding for ETH
    Then alice's equity decreased
    And bob's equity is above $0

  # ================================================================ 08 liquidation

  @case:106 @priority:high
  Scenario: An account above maintenance cannot be liquidated
    Given a funded trader victim with $60
    And victim buys 1 ETH at market
    Then victim is not liquidatable
    When a keeper liquidates victim on ETH
    Then the call reverts with NotLiquidatable

  @case:107 @priority:high
  Scenario: The threshold is exact: no buffer on either side
    Given a funded trader victim with $60
    And victim buys 1 ETH at market
    When the ETH index walks down in 0.1 percent steps until victim is liquidatable, checking liquidate agrees at every tick
    Then the walk ended with a successful liquidation
    And the liquidation index matched the equity-equals-maintenance arithmetic within one step

  @case:108 @priority:high
  Scenario: Liquidation closes partialLiquidationBps of the position and pays the liquidator
    Given a funded trader victim with $60
    And victim buys 1 ETH at market
    And the ETH index is set to 2440
    And keeper's vault balance is noted
    When a keeper liquidates victim on ETH
    Then the call succeeds
    And victim's ETH position size is 0.5 ETH
    And keeper's vault balance increased
    And victim's liquidation count is 1
    And victim's last liquidation was in the current block

  @case:109 @priority:medium
  Scenario: A remainder below minNotional is closed in full
    Given a funded trader victim with $0.30
    And victim buys 0.005 ETH at market
    And the ETH index is set to 2300
    Then victim is liquidatable
    When a keeper liquidates victim on ETH
    Then victim's ETH position size is 0 ETH

  @case:110 @priority:high
  Scenario: Bad debt is covered by the insurance fund
    Given a funded trader victim with $60
    And victim buys 1 ETH at market
    And the ETH index is set to 2000
    And the insurance fund's vault balance is noted
    When a keeper liquidates victim on ETH
    Then the call succeeds
    And a Liquidated event reports badDebt above 0 and insuranceUsed equal to badDebt
    And victim's vault balance is at least $0
    And the insurance fund's vault balance decreased

  @case:111 @priority:high
  Scenario: Once the balance is negative the rest of the position is closed in the same call
    Given a funded trader victim with $60
    And victim buys 1 ETH at market
    And the ETH index is set to 2000
    When a keeper liquidates victim on ETH
    Then victim's ETH position size is 0 ETH
    And victim's liquidation count is 1

  @case:112 @priority:medium
  Scenario: A paused exchange blocks liquidation
    Given a funded trader victim with $60
    And victim buys 1 ETH at market
    And the ETH index is set to 2000
    And the admin pauses the exchange
    When a keeper liquidates victim on ETH
    Then the call reverts with ExchangePaused

  @case:113 @priority:high
  Scenario: The liquidation flag is visible through a getter
    Given a funded trader victim with $60
    And victim buys 1 ETH at market
    Then victim's liquidation count is 0
    Given the ETH index is set to 2440
    When a keeper liquidates victim on ETH
    Then victim's liquidation count is 1
    And victim's last liquidation was in the current block

  # ================================================================ 09 auto-deleveraging

  @case:114 @priority:high
  Scenario: ADL fires only when the insurance fund cannot cover the deficit
    Given the insurance fund is drained
    And a funded trader victim with $60
    And a funded trader alice with $1000000
    And a funded trader bob with $1000000
    And victim buys 1 ETH at market
    And bob places a limit sell of 1 ETH at 2502 as "ask"
    And alice buys 1 ETH at market
    And the ETH index is set to 1500
    When a keeper liquidates victim on ETH
    Then the call succeeds
    And an AutoDeleveraged event names bob
    And bob's ETH position size is 0 ETH
    And victim's vault balance is at least $0

  @case:115 @priority:high
  Scenario: ADL does not fire while the fund can pay
    Given a funded trader victim with $60
    And a funded trader alice with $1000000
    And a funded trader bob with $1000000
    And victim buys 1 ETH at market
    And bob places a limit sell of 1 ETH at 2502 as "ask"
    And alice buys 1 ETH at market
    And the ETH index is set to 1500
    When a keeper liquidates victim on ETH
    Then the call succeeds
    And no AutoDeleveraged event was emitted
    And bob's ETH position size is -1 ETH

  @case:116 @priority:medium
  Scenario: ADL picks the most profitable, largest opposite position first
    Given the insurance fund is drained
    And a funded trader victim with $60
    And a funded trader alice with $1000000
    And a funded trader bob with $1000000
    And a funded trader carol with $1000000
    And victim buys 1 ETH at market
    And bob places a limit sell of 3 ETH at 2502 as "big"
    And alice buys 3 ETH at market
    And carol places a limit sell of 0.1 ETH at 2502 as "small"
    And alice buys 0.1 ETH at market
    And the ETH index is set to 1500
    When a keeper liquidates victim on ETH
    Then an AutoDeleveraged event names bob
    And no AutoDeleveraged event names carol
    And carol's ETH position size is -0.1 ETH

  # ================================================================ 10 fees

  @case:117 @priority:high
  Scenario: The taker pays takerFeeBps of notional
    Given a funded trader alice with $100000
    And a funded trader bob with $100000
    And bob places a limit sell of 1 ETH at 2501 as "ask"
    And alice's vault balance is noted
    When alice places a limit buy of 1 ETH at 2520 as "take"
    Then alice's vault balance changed by $-1.2505

  @case:118 @priority:high
  Scenario: A negative maker fee is a rebate credited to the maker
    Given a funded trader alice with $100000
    And a funded trader bob with $100000
    And bob places a limit sell of 1 ETH at 2501 as "ask"
    And bob's vault balance is noted
    When alice places a limit buy of 1 ETH at 2520 as "take"
    Then bob's vault balance changed by $0.5002

  @case:119 @priority:high
  Scenario: Net fee is split between treasury and insurance by feeToInsuranceBps
    Given a funded trader alice with $100000
    And a funded trader bob with $100000
    And bob places a limit sell of 1 ETH at 2500 as "ask"
    And the treasury's and insurance fund's vault balances are noted
    When alice buys 1 ETH at market
    Then the treasury's vault balance changed by $0.375
    And the insurance fund's vault balance changed by $0.375

  @case:120 @priority:medium
  Scenario: setFees applies to the next fill
    Given a funded trader alice with $100000
    And the admin sets ETH fees to maker 0 and taker 10 bps
    And alice's vault balance is noted
    When alice buys 1 ETH at market
    Then alice's vault balance changed by $-2.5025

  # ================================================================ 11 admin

  @case:121 @priority:high
  Scenario: Every admin function rejects a non-admin
    Given a funded trader alice with $10
    When alice pauses the exchange
    Then the call reverts with NotAdmin
    When alice sets market ETH to Paused
    Then the call reverts with NotAdmin
    When alice sets ETH fees to maker 0 and taker 10 bps
    Then the call reverts with NotAdmin
    When alice transfers admin to bob
    Then the call reverts with NotAdmin
    When alice adds market "X" with the ETH parameters
    Then the call reverts with NotAdmin

  @case:122 @priority:high
  Scenario: Admin handover is two-step and only the pending admin can accept
    Given a funded trader alice with $10
    When the admin transfers admin to bob
    Then the call succeeds
    And the pending admin is bob
    And the admin is still the deployer
    When alice accepts admin
    Then the call reverts with PendingAdminMismatch
    When bob accepts admin
    Then the call succeeds
    And an AdminTransferred event names bob
    And the admin is bob
    When the deployer pauses the exchange
    Then the call reverts with NotAdmin

  @case:123 @priority:high
  Scenario: acceptAdmin with nothing pending reverts
    When bob accepts admin
    Then the call reverts with PendingAdminMismatch

  @case:124 @priority:high
  Scenario: Pause blocks orders and triggers but not cancels or withdrawals
    Given a funded trader alice with $100000
    And alice places a limit buy of 1 ETH at 2400 as "bid"
    And alice places a stop-market buy of 1 ETH triggered at 2600 on the index as "stop"
    And the ETH index is set to 2600
    And the admin pauses the exchange
    When alice places a limit buy of 1 ETH at 2401 as "x"
    Then the call reverts with ExchangePaused
    When a keeper triggers order "stop"
    Then the call reverts with ExchangePaused
    When alice cancels order "bid"
    Then the call succeeds
    When alice withdraws $100
    Then the call succeeds
    When the admin unpauses the exchange
    And alice places a limit buy of 1 ETH at 2560 as "y"
    Then the call succeeds

  @case:125 @priority:high
  Scenario: ExchangePaused is checked before AccountNotFound
    Given an unfunded address carol
    And the admin pauses the exchange
    When carol places a limit buy of 1 ETH at 2400 as "x"
    Then the call reverts with ExchangePaused

  @case:126 @priority:high
  Scenario: AccountNotFound is checked before MarketPaused
    Given an unfunded address carol
    And the admin sets market ETH to Paused
    When carol places a limit buy of 1 ETH at 2400 as "x"
    Then the call reverts with AccountNotFound

  @case:127 @priority:medium
  Scenario: setMarketParams replaces the parameter set and is validated like addMarket
    When the admin sets the ETH parameters to the ETH parameters except takerFeeBps = 7
    Then the call succeeds
    And the ETH market parameter takerFeeBps is 7
    When the admin sets the ETH parameters to the ETH parameters except takerFeeBps = 501
    Then the call reverts with BadParams "takerFeeBps"

  # ================================================================ 12 events

  @case:128 @priority:high
  Scenario: OrderPlaced carries every order parameter
    Given a funded trader alice with $100000
    When alice places a limit buy of 1 ETH at 2400 with user order id 77 as "bid"
    Then an OrderPlaced event matches the placed order exactly

  @case:129 @priority:high
  Scenario: OrderFilled names the maker, and zero for the backstop
    Given a funded trader alice with $100000
    And a funded trader bob with $100000
    And bob places a limit sell of 1 ETH at 2501 as "ask"
    When alice places a market buy of 2 ETH as "take"
    Then the OrderFilled events in order name makers bob then the zero address
    And the second OrderFilled event has makerOrderId 0

  @case:130 @priority:medium
  Scenario: OrderCancelled carries the unfilled size and a reason
    Given a funded trader alice with $100000
    And a funded trader bob with $100000
    And bob places a limit sell of 1 ETH at 2501 as "ask"
    And alice places a limit buy of 3 ETH at 2501 as "bid"
    When alice cancels order "bid"
    Then an OrderCancelled event has reason "user" and unfilled 2 ETH
    When alice places an IOC limit buy of 1 ETH at 2400 as "ioc"
    Then an OrderCancelled event has reason "ioc"
    When alice places a market buy of 150 ETH as "big"
    Then an OrderCancelled event has reason "unfilled"

  @case:131 @priority:high
  Scenario: PositionChanged reports before/after size, entry, realised delta and funding paid
    Given a funded trader alice with $100000
    And a funded trader bob with $100000
    And bob places a limit sell of 1 ETH at 2501 as "ask"
    When alice places a market buy of 1 ETH as "take"
    Then there are 2 PositionChanged events
    And the PositionChanged event for alice reports sizeBefore 0 ETH and sizeAfter 1 ETH
    And the PositionChanged event for bob reports sizeBefore 0 ETH and sizeAfter -1 ETH

  @case:132 @priority:medium
  Scenario: FundingUpdated reports rate, cumulative index, boundary time and sample count
    Given the clock advances 3600 seconds
    When a keeper updates funding for ETH
    Then a FundingUpdated event reports ETH with samples at least 1 and a boundary-aligned time

  @case:133 @priority:high
  Scenario: Liquidated reports size, price, fee, bad debt and insurance used
    Given a funded trader victim with $60
    And victim buys 1 ETH at market
    And the ETH index is set to 2440
    When a keeper liquidates victim on ETH
    Then a Liquidated event reports sizeClosed 0.5 ETH, a fee above 0, and insuranceUsed at most badDebt

  # ================================================================ 13 per market

  Scenario Outline: <sym>: size off the step is refused
    Given a funded trader alice with $100000
    When alice places a limit buy of one unit more than <step> <sym> at <inside> as "x"
    Then the call reverts with InvalidStep

    @case:134
    Examples:
      | sym | step   | inside |
      | BTC | 0.0001 | 59900  |

    @case:144
    Examples:
      | sym | step  | inside |
      | ETH | 0.001 | 2498   |

    @case:154
    Examples:
      | sym | step | inside |
      | SOL | 0.01 | 99.9   |

  Scenario Outline: <sym>: price off the tick is refused
    Given a funded trader alice with $100000
    When alice places a limit buy of <size> <sym> at one unit more than <inside> as "x"
    Then the call reverts with InvalidTick

    @case:135
    Examples:
      | sym | size | inside |
      | BTC | 0.01 | 59900  |

    @case:145
    Examples:
      | sym | size | inside |
      | ETH | 1    | 2498   |

    @case:155
    Examples:
      | sym | size | inside |
      | SOL | 1    | 99.9   |

  Scenario Outline: <sym>: the price band is index ± 5 percent
    Given a funded trader alice with $1000000
    When alice places a limit buy of <size> <sym> at one tick below the lower band as "low"
    Then the call reverts with PriceOutOfBand
    When alice places a limit buy of <size> <sym> at exactly the lower band as "edge"
    Then the call succeeds

    @case:136
    Examples:
      | sym | size |
      | BTC | 0.01 |

    @case:146
    Examples:
      | sym | size |
      | ETH | 1    |

    @case:156
    Examples:
      | sym | size |
      | SOL | 1    |

  Scenario Outline: <sym>: notional below the minimum is refused
    Given a funded trader alice with $100000
    When alice places a limit buy of <step> <sym> at <inside> as "tiny"
    Then the call reverts with BelowMinNotional

    @case:137
    Examples:
      | sym | step   | inside |
      | BTC | 0.0001 | 59900  |

    @case:147
    Examples:
      | sym | step  | inside |
      | ETH | 0.001 | 2498   |

    @case:157
    Examples:
      | sym | step | inside |
      | SOL | 0.01 | 99.9   |

  Scenario Outline: <sym>: initial margin is <im> percent of notional
    Given a funded trader alice with one unit less than the initial margin for <size> <sym>
    When alice places a market buy of <size> <sym> as "x"
    Then the call reverts with InsufficientCollateral
    And the required collateral in the revert equals the initial margin for <size> <sym>

    @case:138
    Examples:
      | sym | size | im |
      | BTC | 0.01 | 2  |

    @case:148
    Examples:
      | sym | size | im |
      | ETH | 1    | 2  |

    @case:158
    Examples:
      | sym | size | im |
      | SOL | 10   | 5  |

  Scenario Outline: <sym>: liquidation at <lev>x leverage matches the arithmetic
    Given a funded trader victim with <collateralPct> percent of the notional of <size> <sym>
    And victim buys <size> <sym> at market
    When the <sym> index walks down in 0.1 percent steps until victim is liquidatable, checking liquidate agrees at every tick
    Then the walk ended with a successful liquidation
    And the liquidation index matched the equity-equals-maintenance arithmetic within one step

    @case:139
    Examples:
      | sym | size | lev | collateralPct |
      | BTC | 0.01 | 2   | 50            |

    @case:140
    Examples:
      | sym | size | lev | collateralPct |
      | BTC | 0.01 | 10  | 10            |

    @case:141
    Examples:
      | sym | size | lev | collateralPct |
      | BTC | 0.01 | 50  | 2             |

    @case:149
    Examples:
      | sym | size | lev | collateralPct |
      | ETH | 1    | 2   | 50            |

    @case:150
    Examples:
      | sym | size | lev | collateralPct |
      | ETH | 1    | 10  | 10            |

    @case:151
    Examples:
      | sym | size | lev | collateralPct |
      | ETH | 1    | 50  | 2             |

    @case:159
    Examples:
      | sym | size | lev | collateralPct |
      | SOL | 10   | 2   | 50            |

    @case:160
    Examples:
      | sym | size | lev | collateralPct |
      | SOL | 10   | 10  | 10            |

    @case:161
    Examples:
      | sym | size | lev | collateralPct |
      | SOL | 10   | 20  | 5             |

  Scenario Outline: <sym>: a <direction> premium gives a <sign> funding rate and <payer> pay
    Given a funded trader alice with $10000000
    And a funded trader bob with $1000000
    And a fill on <sym> lands the mark <direction> the index by 0.8 percent
    And the clock advances 3600 seconds
    When a keeper updates funding for <sym>
    Then the <sym> funding rate is <sign>
    And on the next touch the <payer> on <sym> pay funding

    @case:142
    Examples:
      | sym | direction | sign     | payer  |
      | BTC | above     | positive | longs  |

    @case:143
    Examples:
      | sym | direction | sign     | payer  |
      | BTC | below     | negative | shorts |

    @case:152
    Examples:
      | sym | direction | sign     | payer  |
      | ETH | above     | positive | longs  |

    @case:153
    Examples:
      | sym | direction | sign     | payer  |
      | ETH | below     | negative | shorts |

    @case:162
    Examples:
      | sym | direction | sign     | payer  |
      | SOL | above     | positive | longs  |

    @case:163
    Examples:
      | sym | direction | sign     | payer  |
      | SOL | below     | negative | shorts |
