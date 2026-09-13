@module:03-fe-trading-screen @fe @gmx
Feature: The live trading screen, checked against the API and the chain

  The screen a trader acts on. The FE branch is the only one that needs a
  browser; everything it reads is compared with a source the BE branch also
  reads, so a disagreement points at exactly one of them.

  The page is read by LABEL -- "24H VOLUME", "OPEN INTEREST", "NET RATE" --
  never by CSS class. Readiness is a label with a number after it, never a
  fixed wait. A screen that never fills in grades Blocked: it has not shown a
  wrong number, it has shown nothing.

  Three figures on the header are checked, per market:

    price          against the ticker endpoint (0.5 %)
    open interest  against interest-in-tokens x ticker price, within what the
                   screen rounded to -- measured: the screen shows OI at the
                   CURRENT price, not the entry-price USD figure the API also
                   publishes, and the two differ by up to 15 %
    OI split       against the screen's own two figures

  Background:
    Given the trading screen is open

  Scenario Outline: The <pair> price on screen agrees with the ticker
    Given the screen shows the "<pair>" market
    And the venue publishes the "<symbol>" ticker
    Then the price on screen is within 0.5 percent of the ticker price

    @case:32
    Examples:
      | pair    | symbol |
      | ETH/USD | ETH    |

    @case:33
    Examples:
      | pair    | symbol |
      | BTC/USD | BTC    |

    @case:34
    Examples:
      | pair    | symbol |
      | SOL/USD | SOL    |

  Scenario Outline: The <pair> open interest on screen is the API's tokens at the current price
    Given the screen shows the "<pair>" market
    And the venue publishes the "<symbol>" ticker
    And the venue publishes the "<symbol>" market values
    Then the long open interest on screen equals long interest in tokens times the ticker price
    And the short open interest on screen equals short interest in tokens times the ticker price

    @case:35
    Examples:
      | pair    | symbol |
      | ETH/USD | ETH    |

    @case:36
    Examples:
      | pair    | symbol |
      | BTC/USD | BTC    |

    @case:37
    Examples:
      | pair    | symbol |
      | SOL/USD | SOL    |

  Scenario Outline: The <pair> open-interest split is consistent with its own figures
    # Two numbers and a percentage on the same line. The percentage is derived,
    # so it must agree with the two amounts it was derived from -- to within the
    # rounding of both.
    Given the screen shows the "<pair>" market
    Then the long percentage on screen matches long over long plus short

    @case:38
    Examples:
      | pair    |
      | ETH/USD |

    @case:39
    Examples:
      | pair    |
      | BTC/USD |

    @case:40
    Examples:
      | pair    |
      | SOL/USD |

  Scenario Outline: The <pair> price on screen agrees with the on-chain oracle
    # Three sources, one figure: the screen, the API, and a contract on
    # Arbitrum read over JSON-RPC. The chain read is the v1 Vault, which holds
    # the wrapped form of the two majors; it is the only source here that a
    # venue outage cannot touch.
    Given the screen shows the "<pair>" market
    And the protocol publishes the "<token>" market state
    Then the price on screen is within 0.5 percent of the on-chain maximum price

    @case:41
    Examples:
      | pair    | token |
      | ETH/USD | WETH  |

    @case:42
    Examples:
      | pair    | token |
      | BTC/USD | WBTC  |
