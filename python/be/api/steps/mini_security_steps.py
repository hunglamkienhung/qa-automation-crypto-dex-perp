"""Steps for be-mini-security.feature. Mirror of
node/be/api/steps/mini-security.steps.js -- a plugin module. The authentication
edges the main mini-api feature does not cover: a non-Bearer Authorization
header, and the secret-hygiene invariant that no bearer token echoes back in a
public read. The store, the client (qa.mini) and the Background are shared from
the @mini steps.
"""

from __future__ import annotations

import json
import re

from pytest_bdd import then, when

from be.api.venues.mini import ApiUnreachable
from be.db.store import DbUnreachable

UNREACHABLE = (ApiUnreachable, DbUnreachable)


def send(qa, method, path, **opts):
    if qa.source_error:
        return
    try:
        qa.api = qa.mini.request(method, path, **opts)
    except ApiUnreachable as err:
        qa.source_error = str(err)


def check(qa, description, fn):
    if qa.source_error:
        qa.unobservable(description, "the source could not be reached -- " + qa.source_error)
        return
    try:
        passed, detail = fn()
    except UNREACHABLE as err:
        qa.unobservable(description, str(err))
        return
    qa.check(description, passed, detail)


@when("GET /portfolio/summary with a non-Bearer authorization header")
def malformed_header(qa):
    send(qa, "GET", "/portfolio/summary", headers={"Authorization": "Token k_whatever"})


@then("the response body carries no bearer token")
def no_bearer_token(qa):
    def ev():
        # A minted token is a JSON string value "k_<...>"; match the quoted value
        # (not the bare substring "k_") to avoid false positives on field names
        # like "last_block_hash".
        text = json.dumps((qa.api or {}).get("body") or {})
        leaked = re.search(r'"k_[A-Za-z0-9_-]{8,}"', text) is not None
        return (not leaked, "TOKEN LEAKED" if leaked else "clean")
    check(qa, "no bearer token in body", ev)
