@module:07-bot @be @bot
Feature: The trading bot over PerpDEX

  The bot is both a tool and an object of test. Its risk gate is a pure
  function -- it decides without a network, so it is tested without one. Its
  operational discipline over the live chain -- surfacing a revert instead of
  looping on it, sequential nonces, returning to flat -- is tested against a
  fresh anvil.

  Risk-gate scenarios carry no @perpdex tag and never touch the chain. The rest
  snapshot and revert the chain like every other PerpDEX scenario, and each
  leaves the venue flat behind it.

  # ---------------------------------------------------------------- risk gate (no chain)

  @case:230
  Scenario: The risk gate rounds size to the step and price to the tick
    Given a risk-only bot with max order size 100 and max position 100
    When it plans a buy of 1.2345 ETH at 2500.567
    Then the order is cleared to send
    And the planned size is 1.234 ETH
    And the planned price is 2500.56

  @case:231
  Scenario: The kill switch refuses every order
    Given a risk-only bot with max order size 100 and max position 100
    And the kill switch is engaged
    When it plans a buy of 1 ETH at 2500
    Then the order is refused with reason "kill-switch"

  @case:232
  Scenario: An order above the max order size is refused
    Given a risk-only bot with max order size 5 and max position 100
    When it plans a buy of 6 ETH at 2500
    Then the order is refused with reason "max-order-size"

  @case:233
  Scenario: An order that would breach the max position is refused, but a reduce-only order is not
    Given a risk-only bot with max order size 100 and max position 10
    When it plans a buy of 4 ETH at 2500 against an existing position of 7 ETH
    Then the order is refused with reason "max-position"
    When it plans a reduce-only sell of 4 ETH at 2500 against an existing position of 7 ETH
    Then the order is cleared to send

  @case:234
  Scenario: A size that rounds to zero at the step is refused
    Given a risk-only bot with max order size 100 and max position 100
    When it plans a buy of 0.0005 ETH at 2500
    Then the order is refused with reason "zero-size"

  @case:235
  Scenario: An order below the minimum notional is refused
    Given a risk-only bot with max order size 100 and max position 100
    When it plans a buy of 0.001 ETH at 2500
    Then the order is refused with reason "below-min-notional"

  @case:236
  Scenario: A repeated userOrderId is a no-op, not a second order
    Given a risk-only bot with max order size 100 and max position 100
    When it plans a buy of 1 ETH at 2500 with user order id 1
    Then the order is cleared to send
    When it plans a buy of 1 ETH at 2500 with user order id 1
    Then the order is a duplicate

  @case:237
  Scenario: Dry run clears an order but does not send it
    Given a risk-only bot with max order size 100 and max position 100
    And dry run is engaged
    When it plans a buy of 1 ETH at 2500
    Then the order is cleared as a dry run

  # ---------------------------------------------------------------- gates the contract enforces

  @case:238 @perpdex
  Scenario: A post-only order that would cross is surfaced, not retried
    Given a funded trader bob with $100000
    And bob places a limit sell of 1 ETH at 2500 as "ask"
    And a bot funded with $100000
    When the bot places a post-only buy of 1 ETH at 2500
    Then the bot's order reverts with PostOnlyWouldCross
    And the bot tried the place once

  @case:239 @perpdex
  Scenario: A reduce-only order with no position is surfaced
    Given a bot funded with $100000
    When the bot places a reduce-only sell of 1 ETH at 2400
    Then the bot's order reverts with ReduceOnlyViolation

  @case:240 @perpdex
  Scenario: A limit outside the band is surfaced
    Given a bot funded with $100000
    When the bot places a buy of 1 ETH at 3000
    Then the bot's order reverts with PriceOutOfBand

  @case:241 @perpdex
  Scenario: An order on a paused market is surfaced
    Given the admin sets market ETH to Paused
    And a bot funded with $100000
    When the bot places a buy of 1 ETH at 2490
    Then the bot's order reverts with MarketPaused

  @case:242 @perpdex
  Scenario: An order on a settling market is surfaced
    Given the admin sets market ETH to Settling at 2500
    And a bot funded with $100000
    When the bot places a buy of 1 ETH at 2490
    Then the bot's order reverts with MarketSettling

  @case:243 @perpdex
  Scenario: The bot cannot cross its own resting order
    Given a bot funded with $100000
    And the bot places a limit buy of 1 ETH at 2499
    When the bot places a sell of 1 ETH at 2499
    Then the bot's order reverts with SelfTradePrevented

  # ---------------------------------------------------------------- lifecycle

  @case:244 @perpdex
  Scenario: The bot funds and initialises an account
    Given a bot funded with $50000
    Then the bot's account exists
    And the bot's vault balance is $50000

  @case:245 @perpdex
  Scenario: The bot places a limit and reads it back as planned
    Given a bot funded with $100000
    When the bot places a limit buy of 1.2345 ETH at 2498.567
    Then the bot's order is Open
    And the bot's order size is 1.234 ETH
    And the bot's order price is 2498.56

  @case:246 @perpdex
  Scenario: The bot cancels its order
    Given a bot funded with $100000
    And the bot places a limit buy of 1 ETH at 2498
    When the bot cancels its order
    Then the bot's order is Cancelled
    And the bot has 0 open orders

  @case:247 @perpdex
  Scenario: Cancel-all clears every resting order
    Given a bot funded with $100000
    And the bot places a limit buy of 1 ETH at 2498
    And the bot places a limit buy of 1 ETH at 2497
    And the bot places a limit buy of 1 ETH at 2496
    Then the bot has 3 open orders
    When the bot cancels all its orders
    Then the bot has 0 open orders

  @case:248 @perpdex
  Scenario: Flatten returns the bot to a clean slate after a fill
    Given a bot funded with $100000
    And the bot places a limit buy of 1 ETH at 2498
    And the bot buys 1 ETH at market
    When the bot flattens ETH
    Then the bot is flat on ETH

  @case:249 @perpdex
  Scenario: A dry-run bot plans an order but places nothing on chain
    Given a dry-run bot funded with $100000
    When the bot places a limit buy of 1 ETH at 2498
    Then the order is cleared as a dry run
    And the bot has 0 open orders

  # ---------------------------------------------------------------- fills

  @case:250 @perpdex
  Scenario: A market buy fills against the backstop
    Given a bot funded with $100000
    When the bot buys 1 ETH at market
    Then the bot's ETH position size is 1 ETH
    And the backstop's ETH position size is -1 ETH

  @case:251 @perpdex
  Scenario: An IOC limit fills what it can and cancels the rest
    Given a funded trader bob with $100000
    And bob places a limit sell of 1 ETH at 2500 as "ask"
    And a bot funded with $100000
    When the bot places an IOC buy of 3 ETH at 2500
    Then the bot's ETH position size is 1 ETH

  @case:252 @perpdex
  Scenario: A fill sets the position size and a positive entry price
    Given a bot funded with $100000
    When the bot buys 2 ETH at market
    Then the bot's ETH position size is 2 ETH
    And the bot's ETH entry price is above 0

  @case:253 @perpdex
  Scenario: A fill debits free collateral for the margin
    Given a bot funded with $100000
    When the bot buys 1 ETH at market
    Then the bot's free collateral fell

  @case:254 @perpdex
  Scenario: A taker fill pays a fee to the treasury
    Given the treasury's and insurance fund's vault balances are noted
    And a bot funded with $100000
    When the bot buys 1 ETH at market
    Then the treasury's vault balance increased

  @case:255 @perpdex
  Scenario: A fill is mined and observable in the block it landed in
    Given a bot funded with $100000
    When the bot buys 1 ETH at market
    Then the bot's fill was mined
    And the bot's ETH position size is 1 ETH

  # ---------------------------------------------------------------- operations

  @case:256
  Scenario: The retry policy retries a transient failure but never a revert
    Given a risk-only bot with max order size 100 and max position 100
    Then a transient failure is retried up to the limit
    And a revert is surfaced on the first attempt

  @case:257 @perpdex
  Scenario: Three orders advance the account nonce by exactly three
    Given a bot funded with $100000
    When the bot places a limit buy of 1 ETH at 2498
    And the bot places a limit buy of 1 ETH at 2497
    And the bot places a limit buy of 1 ETH at 2496
    Then the account nonce advanced by 3

  @case:258 @perpdex
  Scenario: The bot halts when the exchange is paused
    Given a bot funded with $100000
    And the admin pauses the exchange
    When the bot places a buy of 1 ETH at 2490
    Then the bot's order reverts with ExchangePaused

  @case:259 @perpdex
  Scenario: Cleanup leaves the venue flat, confirmed by re-reading
    Given a bot funded with $100000
    And the bot places a limit buy of 1 ETH at 2498
    And the bot buys 1 ETH at market
    When the bot flattens ETH
    Then the bot is flat on ETH
    And the bot has 0 open orders

  @case:260
  Scenario: The bot holds and logs no secret
    Given a risk-only bot with max order size 100 and max position 100
    Then the bot's record contains no secret

  @case:261 @perpdex
  Scenario: Once the kill switch is thrown the bot sends nothing more
    Given a bot funded with $100000
    And the bot's kill switch is engaged
    When the bot places a limit buy of 1 ETH at 2498
    Then the order is refused with reason "kill-switch"
    And the bot has 0 open orders

  # ---------------------------------------------------------------- parameterised over the three markets

  @perpdex
  Scenario Outline: <sym>: the bot places a valid limit sized to clear the minimum notional
    Given a bot funded with $2000000
    When the bot places a limit buy of <size> <sym> at <price>
    Then the bot's order is Open
    And the bot's <sym> order clears the minimum notional

    @case:262
    Examples:
      | sym | size | price |
      | BTC | 0.01 | 59000 |

    @case:263
    Examples:
      | sym | size | price |
      | ETH | 0.1  | 2490  |

    @case:264
    Examples:
      | sym | size | price |
      | SOL | 1    | 99    |
