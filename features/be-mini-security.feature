@module:08-mini-security @be @api @mini @perpdex @security
Feature: mini-api — authentication edges

  The mini-api feature (module 06) already proves the token gate: no token, an
  unknown or expired token, a scope too low, one subject reading another. This
  tier adds the edges around it -- an Authorization header that is present but
  is not a Bearer scheme, and the secret-hygiene invariant that a minted token,
  returned once by /auth/token, never echoes back in an ordinary read.

  Background:
    Given the store is open and the indexer has caught up
    And the API is reachable

  @case:302 @priority:high
  Scenario: A malformed Authorization header is refused
    When GET /portfolio/summary with a non-Bearer authorization header
    Then the response status is 401
    And the response is an error with code "unauthenticated"

  @case:303 @priority:medium
  Scenario: Public responses never carry a bearer token
    When GET /markets
    Then the response body carries no bearer token
    When GET /health
    Then the response body carries no bearer token
