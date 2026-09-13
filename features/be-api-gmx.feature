@module:02-api-gmx @be @api @gmx
Feature: Public price and market endpoints of a live perpetuals protocol

  Read-only HTTPS against the protocol's public API. No key, no wallet, no
  browser. Two hosts: one serves prices (tickers, 24h summary, candles), the
  other serves per-market state (open interest, pool value, configuration).

  Each invariant runs once per market under test. The markets are the three
  the FE branch reads off the screen, so a figure can be followed from the
  screen to the API to the chain.

  A transport failure or a 5xx grades Blocked, never Failed: a venue that did
  not answer has not said anything wrong.

  Scenario Outline: Ticker prices for <symbol> are ordered and positive
    # min and max are the two sides of the oracle spread. An inverted pair
    # would misprice every position on that market at once.
    Given the venue publishes the "<symbol>" ticker
    Then the ticker minimum price does not exceed its maximum price
    And both ticker prices are above zero

    @case:9
    Examples:
      | symbol |
      | ETH    |

    @case:10
    Examples:
      | symbol |
      | BTC    |

    @case:11
    Examples:
      | symbol |
      | SOL    |

  Scenario Outline: The 24 hour summary for <symbol> is internally consistent
    Given the venue publishes the "<symbol>" 24 hour summary
    Then the 24 hour open lies between the low and the high
    And the 24 hour close lies between the low and the high

    @case:12
    Examples:
      | symbol |
      | ETH    |

    @case:13
    Examples:
      | symbol |
      | BTC    |

    @case:14
    Examples:
      | symbol |
      | SOL    |

  Scenario Outline: Candles for <symbol> are ordered and well formed
    Given the venue publishes the last 10 "1m" candles for "<symbol>"
    Then the candles are newest first with strictly decreasing timestamps
    And consecutive candles are exactly one period apart
    And every candle keeps its open and close between its low and high

    @case:15
    Examples:
      | symbol |
      | ETH    |

    @case:16
    Examples:
      | symbol |
      | BTC    |

    @case:17
    Examples:
      | symbol |
      | SOL    |

  Scenario Outline: The ticker for <symbol> agrees with its latest candle
    # Two endpoints, one venue. The ticker is scaled from a 30-decimal integer
    # using the token's decimals; the candle is a plain float. A wrong decimals
    # entry would show up here as a 10x disagreement, not a rounding one.
    Given the venue publishes the "<symbol>" ticker
    And the venue publishes the last 3 "1m" candles for "<symbol>"
    Then the ticker price is within 0.5 percent of the latest candle close

    @case:18
    Examples:
      | symbol |
      | ETH    |

    @case:19
    Examples:
      | symbol |
      | BTC    |

    @case:20
    Examples:
      | symbol |
      | SOL    |

  Scenario Outline: The ticker for <symbol> is fresh
    Given the venue publishes the "<symbol>" ticker
    Then the ticker was updated within the last 300 seconds
    And the ticker is not stamped in the future

    @case:21
    Examples:
      | symbol |
      | ETH    |

    @case:22
    Examples:
      | symbol |
      | BTC    |

    @case:23
    Examples:
      | symbol |
      | SOL    |

  Scenario Outline: The market configuration for <symbol> points at the ticker's token
    # The price feed and the market are two records that must name the same
    # token. If they drift apart the market is being priced off something else.
    Given the venue publishes the "<symbol>" ticker
    And the venue publishes the "<symbol>" market configuration
    Then the market's index token is the ticker's token address
    And the market is not disabled

    @case:24
    Examples:
      | symbol |
      | ETH    |

    @case:25
    Examples:
      | symbol |
      | BTC    |

    @case:26
    Examples:
      | symbol |
      | SOL    |

  Scenario Outline: Open interest for <symbol> is non-negative and fresh
    Given the venue publishes the "<symbol>" market values
    Then long and short open interest are both non-negative
    And the market values were updated within the last 600 seconds

    @case:27
    Examples:
      | symbol |
      | ETH    |

    @case:28
    Examples:
      | symbol |
      | BTC    |

    @case:29
    Examples:
      | symbol |
      | SOL    |

  @case:30
  Scenario: An unsupported candle period is rejected with a client error
    When candles are requested with period "7m" for "ETH"
    Then the venue answers 400
    And the error body names the supported periods

  @case:31
  Scenario: An unknown token is rejected with a client error
    When candles are requested with period "1m" for "NOSUCHTOKEN"
    Then the venue answers 400
    And the error body says the token is unsupported

  # ---------------------------------------------------------------- expanded v2 market invariants

  Scenario Outline: The <symbol> market is live and cross-margined
    Given the venue publishes the "<symbol>" market configuration
    Then the market is not disabled
    And the market is not spot-only

    @case:282
    Examples:
      | symbol |
      | ETH |
    @case:283
    Examples:
      | symbol |
      | BTC |
    @case:284
    Examples:
      | symbol |
      | SOL |

  Scenario Outline: The <symbol> pool value is ordered and its risk factors are set
    Given the venue publishes the "<symbol>" market configuration
    And the venue publishes the "<symbol>" market values
    Then the pool value minimum does not exceed its maximum
    And the reserve factors and the minimum collateral factor are positive

    @case:285
    Examples:
      | symbol |
      | ETH |
    @case:286
    Examples:
      | symbol |
      | BTC |
    @case:287
    Examples:
      | symbol |
      | SOL |

  Scenario Outline: Open interest for <symbol> agrees in tokens and in USD
    Given the venue publishes the "<symbol>" market values
    Then the long open interest in tokens is set exactly when the long interest in USD is
    And the short open interest in tokens is set exactly when the short interest in USD is

    @case:288
    Examples:
      | symbol |
      | ETH |
    @case:289
    Examples:
      | symbol |
      | BTC |
    @case:290
    Examples:
      | symbol |
      | SOL |

  Scenario Outline: The borrowing and funding factors for <symbol> are well formed
    Given the venue publishes the "<symbol>" market values
    Then the borrowing factors for both sides are non-negative
    And the per-second funding factor is present

    @case:291
    Examples:
      | symbol |
      | ETH |
    @case:292
    Examples:
      | symbol |
      | BTC |
    @case:293
    Examples:
      | symbol |
      | SOL |

  Scenario Outline: The <symbol> market values reference the configured market token
    Given the venue publishes the "<symbol>" market configuration
    And the venue publishes the "<symbol>" market values
    Then the values entry is keyed by the configured market token address

    @case:294
    Examples:
      | symbol |
      | ETH |
    @case:295
    Examples:
      | symbol |
      | BTC |
    @case:296
    Examples:
      | symbol |
      | SOL |

  @case:297 @priority:high
  Scenario: Every ticker entry has an ordered, positive price
    Given the venue publishes the full ticker set
    Then every ticker entry has a minimum price at most its maximum, both above zero

  @case:298 @priority:medium
  Scenario: No token symbol appears twice in the ticker set
    Given the venue publishes the full ticker set
    Then no token symbol appears more than once

  @case:299 @priority:medium
  Scenario: The tested markets all appear in the ticker set
    Given the venue publishes the full ticker set
    Then the ticker set contains ETH, BTC and SOL

  @case:300 @priority:medium
  Scenario: An hourly candle series is spaced by exactly one hour
    Given the venue publishes the last 6 "1h" candles for "ETH"
    Then the candles are newest first with strictly decreasing timestamps
    And consecutive candles are exactly one period apart

  @case:301 @priority:low
  Scenario: A candle request with no token is rejected with a client error
    When candles are requested with no token symbol
    Then the response is a client error
