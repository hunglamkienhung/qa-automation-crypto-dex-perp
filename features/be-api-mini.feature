@module:06-api-mini @be @api @mini @perpdex
Feature: mini-api — the REST layer over the indexer's store

  Every scenario compares an HTTP response with rows read straight from the
  store the API serves. A divergence here is the API's: the indexer was
  already checked against the chain in the DB feature. Chain activity is only
  the way to get interesting rows into the store.

  Background:
    Given the store is open and the indexer has caught up
    And the API is reachable

  # ---------------------------------------------------------------- health and markets

  @case:190 @priority:high
  Scenario: /health reports the store's indexer state
    When GET /health
    Then the response status is 200
    And the response field "ok" is true
    And the response field "exchange" equals indexer_state.exchange
    And the response field "last_block" equals indexer_state.last_block
    And the response field "indexer_paused" is false

  @case:191 @priority:high
  Scenario: /markets returns one entry per markets row with the row's fields
    When GET /markets
    Then the response status is 200
    And the markets in the response equal the markets rows

  @case:192 @priority:medium
  Scenario: /markets/1 returns the ETH row
    When GET /markets/1
    Then the response status is 200
    And the market in the response equals the markets row 1

  @case:193 @priority:high
  Scenario: mark_price in /markets equals the mark derived from the rows
    Given a funded trader alice with $10000000
    And a funded trader bob with $1000000
    And a fill on ETH lands the mark above the index by 0.8 percent
    And the store has caught up
    When GET /markets/1
    Then the response field "mark_price" equals the mark derived from the store for ETH

  @case:194 @priority:medium
  Scenario: open_interest_long/short in /markets equal the positions sums
    Given a funded trader alice with $100000
    And alice places a market buy of 1 ETH as "take"
    And the store has caught up
    When GET /markets/1
    Then the response open interest equals the positions sums for ETH

  @case:195 @priority:medium
  Scenario: An unknown market is 404 with the standard error shape
    When GET /markets/99
    Then the response status is 404
    And the response is an error with code "not_found"
    When GET /markets/abc
    Then the response status is 404
    And the response is an error with code "not_found"

  @case:196 @priority:medium
  Scenario: /markets/:id/status follows a status change
    Given the admin sets market ETH to Paused
    And the store has caught up
    When GET /markets/1/status
    Then the response field "status" is "Paused"
    And the response field "status" equals the markets row 1 status
    Given the admin sets market ETH to Active
    And the store has caught up
    When GET /markets/1/status
    Then the response field "status" is "Active"

  # ---------------------------------------------------------------- order book, orders, positions

  @case:197 @priority:high
  Scenario: /orderbook aggregates the store's open orders per price
    Given a funded trader alice with $100000
    And a funded trader bob with $100000
    And alice places a limit buy of 1 ETH at 2498 as "b1"
    And bob places a limit buy of 2 ETH at 2498 as "b2"
    And alice places a limit buy of 1 ETH at 2499 as "b3"
    And the store has caught up
    When GET /orderbook/1
    Then the response status is 200
    And the bids in the response equal the store's open bids aggregated per price for ETH

  @case:198 @priority:low
  Scenario: depth is validated
    When GET /orderbook/1?depth=0
    Then the response status is 400
    And the response is an error with code "bad_request"
    When GET /orderbook/1?depth=51
    Then the response status is 400
    When GET /orderbook/1?depth=x
    Then the response status is 400

  @case:199 @priority:high
  Scenario: /orders/:account returns the account's Open rows by default
    Given a funded trader alice with $100000
    And alice places a limit buy of 1 ETH at 2498 as "b1"
    And alice places a limit buy of 1 ETH at 2497 as "b2"
    And alice places a limit buy of 1 ETH at 2496 as "b3"
    And alice cancels order "b3"
    And the store has caught up
    When GET /orders/alice
    Then the response status is 200
    And the orders in the response equal the store's orders for alice with status Open

  @case:200 @priority:medium
  Scenario: ?status=Cancelled and ?status=all select the right rows
    Given a funded trader alice with $100000
    And alice places a limit buy of 1 ETH at 2498 as "b1"
    And alice places a limit buy of 1 ETH at 2497 as "b2"
    And alice cancels order "b2"
    And the store has caught up
    When GET /orders/alice?status=Cancelled
    Then the orders in the response equal the store's orders for alice with status Cancelled
    When GET /orders/alice?status=all
    Then the orders in the response equal the store's orders for alice with status all

  @case:201 @priority:low
  Scenario: A malformed account is 400
    When GET /orders/not-an-address
    Then the response status is 400
    And the response is an error with code "bad_request"
    When GET /orders/alice?status=Weird
    Then the response status is 400

  @case:202 @priority:high
  Scenario: /positions/:account returns the account's rows
    Given a funded trader alice with $100000
    And alice places a market buy of 1 ETH as "e"
    And alice places a market buy of 0.01 BTC as "b"
    And the store has caught up
    When GET /positions/alice
    Then the response status is 200
    And the positions in the response equal the store's positions for alice

  # ---------------------------------------------------------------- trades

  @case:203 @priority:high
  Scenario: /trades total equals COUNT(trades)
    Given a funded trader alice with $100000
    And alice places a market buy of 1 ETH as "t1"
    And alice places a market buy of 1 ETH as "t2"
    And alice places a market buy of 1 ETH as "t3"
    And the store has caught up
    When GET /trades?limit=2
    Then the response field "total" equals the count of trades rows
    And the response list "trades" has 2 entries

  @case:204 @priority:medium
  Scenario: /trades is newest first by (block, log)
    Given a funded trader alice with $100000
    And alice places a market buy of 1 ETH as "t1"
    And alice places a market buy of 1 ETH as "t2"
    And the store has caught up
    When GET /trades
    Then the trades in the response are ordered newest first by block and log index

  @case:205 @priority:high
  Scenario: Paging with the cursor yields every row exactly once
    Given a funded trader alice with $100000
    And alice places a market buy of 1 ETH as "t1"
    And alice places a market buy of 1 ETH as "t2"
    And alice places a market buy of 1 ETH as "t3"
    And alice places a market buy of 1 ETH as "t4"
    And alice places a market buy of 1 ETH as "t5"
    And the store has caught up
    When the trades are paged 2 at a time until the cursor is exhausted
    Then the paged trades are exactly the trades rows, each once

  @case:206 @priority:low
  Scenario: limit is capped at 100 and reported
    When GET /trades?limit=1000
    Then the response status is 200
    And the response field "limit" is 100

  @case:207 @priority:low
  Scenario: Bad limit or cursor is 400
    When GET /trades?limit=0
    Then the response status is 400
    When GET /trades?limit=abc
    Then the response status is 400
    When GET /trades?cursor=%25%25%25
    Then the response status is 400

  @case:208 @priority:medium
  Scenario: ?market filters and total follows the filter
    Given a funded trader alice with $1000000
    And alice places a market buy of 1 ETH as "e"
    And alice places a market buy of 0.01 BTC as "b"
    And the store has caught up
    When GET /trades?market=1
    Then every trade in the response has market_id 1
    And the response field "total" equals the count of trades rows for market 1
    When GET /trades?market=99
    Then the response status is 404

  # ---------------------------------------------------------------- funding, liquidations

  @case:209 @priority:medium
  Scenario: /funding/history returns the funding rows for the market
    Given a funded trader alice with $1000000
    And a funded trader bob with $100000
    And bob places a limit sell of 1 ETH at 2520 as "ask"
    And alice places a limit buy of 101 ETH at 2520 as "sweep"
    And the clock advances 3600 seconds
    And a keeper updates funding for ETH
    And the store has caught up
    When GET /funding/history?market=1&period=1d
    Then the response status is 200
    And the funding in the response equals the funding rows for ETH

  @case:210 @priority:high
  Scenario: An unsupported period is 400 and the response lists the supported ones
    When GET /funding/history?market=1&period=1h
    Then the response status is 200
    When GET /funding/history?market=1&period=8h
    Then the response status is 200
    When GET /funding/history?market=1&period=2h
    Then the response status is 400
    And the response is an error with code "bad_request"
    And the response field "supported" is the list 1h, 8h, 1d
    When GET /funding/history?market=1&period=x
    Then the response status is 400

  @case:211 @priority:low
  Scenario: market is required
    When GET /funding/history
    Then the response status is 400
    And the response is an error with code "bad_request"

  @case:212 @priority:high
  Scenario: /liquidations returns the liquidations rows
    Given a funded trader victim with $60
    And victim buys 1 ETH at market
    And the ETH index is set to 2440
    And a keeper liquidates victim on ETH
    And the store has caught up
    When GET /liquidations
    Then the response status is 200
    And the response field "total" equals the count of liquidations rows
    And the newest liquidation in the response equals the newest liquidations row

  # ---------------------------------------------------------------- auth

  @case:213 @priority:high
  Scenario: No token is 401
    When GET /portfolio/summary
    Then the response status is 401
    And the response is an error with code "unauthenticated"

  @case:214 @priority:high
  Scenario: An unknown token is 401
    When GET /portfolio/summary with token "nope"
    Then the response status is 401
    And the response is an error with code "unauthenticated"

  @case:215 @priority:high
  Scenario: A read-scope token is 403
    Given a token with scope read as "reader"
    When GET /portfolio/summary with token "reader"
    Then the response status is 403
    And the response is an error with code "forbidden"

  @case:216 @priority:high
  Scenario: A portfolio token bound to alice cannot read bob
    Given a token with scope portfolio for alice as "alice-token"
    When GET /portfolio/summary?account=bob with token "alice-token"
    Then the response status is 403
    And the response is an error with code "forbidden"

  @case:217 @priority:high
  Scenario: A portfolio token returns exactly the documented fields, equal to the rows
    Given a funded trader alice with $1000
    And alice places a market buy of 0.1 ETH as "e"
    And alice places a limit buy of 0.1 ETH at 2498 as "resting"
    And the store has caught up
    And a token with scope portfolio for alice as "alice-token"
    When GET /portfolio/summary with token "alice-token"
    Then the response status is 200
    And the response keys are exactly account, exists, deposits, withdrawals, open_orders, positions
    And the response field "deposits" equals the accounts row for alice deposits
    And the response field "open_orders" equals the count of alice's open and pending orders
    And the positions in the response equal the store's positions for alice

  @case:218 @priority:medium
  Scenario: An expired token is 401 token_expired
    Given a token with scope portfolio for alice expiring in 1 second as "short"
    And 2 seconds pass
    When GET /portfolio/summary with token "short"
    Then the response status is 401
    And the response is an error with code "token_expired"

  @case:219 @priority:high
  Scenario: Only an admin token can mint tokens
    Given a token with scope read as "reader"
    When POST /auth/token with token "reader" and body {"scope":"read"}
    Then the response status is 403
    When POST /auth/token with no token and body {"scope":"read"}
    Then the response status is 401
    When POST /auth/token with the admin token and body {"scope":"read"}
    Then the response status is 201
    And the minted token exists in api_keys with scope read

  @case:220 @priority:low
  Scenario: An unknown scope or a malformed subject is 400
    When POST /auth/token with the admin token and body {"scope":"root"}
    Then the response status is 400
    When POST /auth/token with the admin token and body {"scope":"read","subject":"x"}
    Then the response status is 400

  # ---------------------------------------------------------------- CORS

  @case:221 @priority:high
  Scenario: An allowlisted origin is echoed back exactly, with credentials
    When GET /markets with origin "https://app.example.test"
    Then the response header Access-Control-Allow-Origin is "https://app.example.test"
    And the response header Access-Control-Allow-Credentials is "true"

  @case:222 @priority:high
  Scenario: A suffix attack origin gets no CORS header
    When GET /markets with origin "https://app.example.test.evil.com"
    Then the response has no Access-Control-Allow-Origin header

  @case:223 @priority:high
  Scenario: The parent domain gets no CORS header
    When GET /markets with origin "https://example.test"
    Then the response has no Access-Control-Allow-Origin header

  @case:224 @priority:high
  Scenario: The same host over http gets no CORS header
    When GET /markets with origin "http://app.example.test"
    Then the response has no Access-Control-Allow-Origin header

  @case:225 @priority:medium
  Scenario: An explicit :443 gets no CORS header
    When GET /markets with origin "https://app.example.test:443"
    Then the response has no Access-Control-Allow-Origin header

  @case:226 @priority:medium
  Scenario: "null" and a missing Origin get no CORS header
    When GET /markets with origin "null"
    Then the response has no Access-Control-Allow-Origin header
    When GET /markets
    Then the response status is 200
    And the response has no Access-Control-Allow-Origin header

  @case:227 @priority:medium
  Scenario: Preflight from an allowed origin is 204 with methods and headers
    When OPTIONS /portfolio/summary with origin "https://app.example.test" and request method GET
    Then the response status is 204
    And the response header Access-Control-Allow-Methods contains "GET"
    And the response header Access-Control-Allow-Headers contains "Authorization"

  # ---------------------------------------------------------------- rate limit, staleness

  @case:228 @priority:high
  Scenario: Over the limit the API answers 429 with Retry-After
    When GET /health is sent 5 times more than the rate limit within the window
    Then the last response status is 429
    And the last response is an error with code "rate_limited"
    And the last response header Retry-After is a positive integer
    And X-RateLimit-Remaining reached 0 before the first 429

  @case:229 @priority:high
  Scenario: With the indexer paused the API keeps answering 200 with stale rows, and says so in /health
    Given a funded trader alice with $100000
    And the trades count is noted
    And the indexer is paused
    When alice places a market buy of 1 ETH as "take"
    And 2 seconds pass
    And GET /trades
    Then the response status is 200
    And the response field "total" equals the noted trades count
    And the response header X-Indexed-Block is below the chain head
    When GET /health
    Then the response field "indexer_paused" is true
    When the indexer is unpaused
    And the store has caught up
    And GET /trades
    Then the response field "total" equals the noted trades count plus 1
