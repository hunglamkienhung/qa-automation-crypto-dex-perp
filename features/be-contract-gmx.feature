@module:01-contract-gmx @be @contract @gmx
Feature: On-chain invariants of a perpetuals protocol

  Read-only `eth_call` against a live perpetuals protocol. No wallet, no private
  key, no gas, no testnet faucet — and no browser. A public RPC endpoint is
  enough, because nothing here is signed or broadcast.

  The 4-byte selectors are computed with a Keccak-256 implementation that is
  itself verified against published vectors before any of it is trusted. A
  guessed selector does not fail cleanly: if it collides with another function
  on the same contract it returns a perfectly well-formed number meaning
  something else entirely.

  On an RPC failure these scenarios report Blocked, never Failed. A node being
  unreachable is not a protocol being broken.

  Background:
    Given the RPC is pointed at the expected chain

  @case:1 @priority:high
  Scenario: Reserved collateral never exceeds the pool
    # The solvency invariant. If more is reserved against open positions than the
    # pool actually holds, the protocol has promised collateral it does not have.
    # Worth reading the numbers when this runs: on GMX v1 the WETH pool sits at
    # essentially full utilisation, so this assertion is genuinely near its edge
    # rather than passing by a wide margin.
    Given the protocol publishes the "WETH" market state
    Then the reserved amount does not exceed the pool amount

  @case:2 @priority:high
  Scenario: The oracle spread is never inverted
    Given the protocol publishes the "WETH" market state
    Then the minimum price does not exceed the maximum price
    But "the oracle price equals the median of its configured feed sources" cannot be verified because "the Vault exposes only the aggregated price; the individual feed readings and the aggregation rule live behind the PriceFeed contract and are not readable as one call"

  @case:3 @priority:high
  Scenario: Configured token weights sum to the cached total
    # totalTokenWeights is a cached aggregate, and every pool-share calculation
    # divides by it. If it drifts from the actual sum of the parts, nothing
    # reverts — every weight-dependent figure is just quietly wrong.
    Then the whitelisted token weights sum to the cached total

  @case:4 @priority:high
  Scenario: Maximum leverage implies a usable initial margin
    Then the maximum leverage is between 1 and 200 times
    And the implied initial margin is above zero

  @case:5 @priority:medium
  Scenario: The margin fee stays inside a sane bound
    # A margin fee above one percent would be an outlier for any perpetuals
    # venue; the point of the bound is to catch a misconfigured basis-point
    # value, which is a decimal-place mistake waiting to happen.
    Then the margin fee is at most 100 basis points

  @case:6 @priority:medium
  Scenario: The funding timestamp is well formed
    # Note what is NOT asserted here: that funding is RECENT.
    #
    # It is tempting, and it would be the wrong test. This protocol advances
    # funding when someone interacts with the market, so on a quiet market the
    # timestamp is simply old -- measured here at over a hundred days. That is
    # market activity, not protocol correctness, and a suite that failed on it
    # would be reporting "nobody traded" as a defect.
    #
    # What IS a correctness property: the timestamp is never in the future, and
    # it always lands exactly on a funding-interval boundary, because that is
    # how the contract computes it. Both hold whether the market is busy or
    # asleep.
    Given the protocol publishes the "WETH" funding state
    Then the last funding time is not in the future
    And the last funding time lands on a funding interval boundary

  @case:7 @priority:medium
  Scenario: The token under test is actually configured
    # Every other read in this feature is meaningless if the token was never
    # whitelisted: the getters answer with zeros rather than reverting.
    Then the "WETH" token is whitelisted
    And the "WETH" token is not marked as a stablecoin

  @case:8 @priority:high
  Scenario: Short open interest is backed by a recorded average price
    # A non-zero short position with no recorded average entry price would make
    # every unrealised-PnL figure for that side undefined.
    Given the protocol publishes the "WETH" market state
    Then a non-zero short open interest has a non-zero average price

  # ---------------------------------------------------------------- expanded config invariants

  @case:265 @priority:high
  Scenario: The whitelisted token count matches the array
    # whitelistedTokenCount() is a cached counter; the array is the source of
    # truth. A drift means a listing or de-listing that updated one and not the
    # other, and every share calculation reads the counter.
    Then the whitelisted token count matches the array's whitelisted entries

  @case:266 @priority:medium
  Scenario: Stable swaps are not dearer than ordinary swaps
    Then the swap fee is at least the stable swap fee

  @case:267 @priority:medium
  Scenario: The core fees are each within a sane bound
    # A basis-point value one decimal place out is a classic misconfiguration;
    # the bound catches it before it reaches a trade.
    Then the core basis-point fees are each at most 500 basis points

  @case:268 @priority:medium
  Scenario: Funding accrues on an hourly interval
    Then the funding interval is exactly one hour

  @case:269 @priority:low
  Scenario: The minimum-profit window is positive and bounded
    Then the minimum profit time is positive and at most one day

  @case:270 @priority:low
  Scenario: Dynamic fees are enabled
    Then dynamic fees are enabled

  @case:271 @priority:medium
  Scenario: The liquidation fee is a positive, bounded USD amount
    Then the liquidation fee is positive and at most $100

  @case:272 @priority:medium
  Scenario: The funding rate factors are positive and bounded
    Then both funding rate factors are positive and at most 10000

  # ---------------------------------------------------------------- expanded per-token invariants (every whitelisted token)

  @case:273 @priority:high
  Scenario: Every whitelisted token reserves no more than its pool
    Then every whitelisted token reserves no more than its pool

  @case:274 @priority:high
  Scenario: Every whitelisted token has an ordered, positive oracle spread
    Then every whitelisted token has a minimum price at most its maximum, both above zero

  @case:275 @priority:medium
  Scenario: Every whitelisted token has non-zero decimals
    Then every whitelisted token has positive decimals

  @case:276 @priority:high
  Scenario: Weight tracks whitelisting
    # A whitelisted token must carry weight, and a de-listed array entry must
    # carry none -- that is what keeps the cached total honest.
    Then every whitelisted token carries a positive weight and every de-listed entry carries none

  @case:277 @priority:high
  Scenario: Every non-zero short interest has an average entry price
    Then every token's non-zero short interest has a non-zero average price

  @case:278 @priority:medium
  Scenario: Every whitelisted token holds a positive pool
    Then every whitelisted token holds a positive pool amount

  @case:279 @priority:medium
  Scenario: Stablecoins are weighted, flagged and guarantee no USD
    Then every stable token is flagged, carries a positive weight, and holds zero guaranteed USD

  @case:280 @priority:medium
  Scenario: Cumulative funding never runs negative
    Then every token's cumulative funding rate is non-negative

  @case:281 @priority:low
  Scenario: The cached total weight is the basis-point scale
    Then the cached total token weight is 100000
