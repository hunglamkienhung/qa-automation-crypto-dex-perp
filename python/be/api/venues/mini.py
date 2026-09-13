"""HTTP client for mini-api (services/mini-api). Mirror of node/be/api/venues/mini.js.

A response is returned whole -- status, lower-cased headers, parsed body -- so
a step can assert on any of them. Only a transport failure is ApiUnreachable
(grades Blocked); a 4xx/5xx is an answer, and often the answer under test.

The service rate-limits per client address. One scenario measures that on
purpose; every other scenario must not trip it by accident, so the client
watches X-RateLimit-Remaining and, when the budget is nearly spent, waits for
the window to pass before the next request. A measurement control, not a
retry: no response is ever discarded.
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request

BASE = os.environ.get("MINI_API_URL", "http://127.0.0.1:8787").rstrip("/")
ADMIN_TOKEN = os.environ.get("MINI_API_ADMIN_TOKEN", "local-admin-token")
WINDOW_MS = int(os.environ.get("MINI_API_RATE_WINDOW_MS", "10000"))


class ApiUnreachable(Exception):
    pass


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):  # noqa: D401 - never follow
        return None


_opener = urllib.request.build_opener(_NoRedirect)


class MiniApi:
    def __init__(self, base: str = BASE) -> None:
        self.base = base
        self.remaining: int | None = None

    def request(self, method: str, path: str, token: str | None = None, origin: str | None = None, body=None, headers: dict | None = None, throttle: bool = True) -> dict:
        if throttle and self.remaining is not None and self.remaining <= 3:
            time.sleep(WINDOW_MS / 1000 + 0.2)
            self.remaining = None
        h = dict(headers or {})
        if token:
            h["Authorization"] = "Bearer " + token
        if origin is not None:
            h["Origin"] = origin
        data = None
        if body is not None:
            h["Content-Type"] = "application/json"
            data = json.dumps(body).encode()
        req = urllib.request.Request(self.base + path, data=data, headers=h, method=method)
        try:
            with _opener.open(req, timeout=15) as res:
                status, hdrs, text = res.status, res.headers, res.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as err:
            status, hdrs, text = err.code, err.headers, err.read().decode("utf-8", "replace")
        except (urllib.error.URLError, TimeoutError, OSError) as err:
            raise ApiUnreachable(f"mini-api at {self.base} did not answer {method} {path}: {err}") from err
        try:
            parsed = json.loads(text) if text else None
        except json.JSONDecodeError:
            parsed = None
        out = {"status": status, "headers": {k.lower(): v for k, v in hdrs.items()}, "body": parsed, "text": text}
        rem = out["headers"].get("x-ratelimit-remaining")
        if rem is not None:
            self.remaining = int(rem)
        return out

    def get(self, path: str, **kw) -> dict:
        return self.request("GET", path, **kw)

    def post(self, path: str, body, **kw) -> dict:
        return self.request("POST", path, body=body, **kw)

    def set_indexer_paused(self, paused: bool) -> dict:
        r = self.post("/admin/indexer", {"paused": paused}, token=ADMIN_TOKEN)
        if r["status"] != 200:
            raise RuntimeError(f"could not set indexer paused={paused}: HTTP {r['status']} {r['text']}")
        return r

    def rewind_indexer(self, block: int) -> dict:
        r = self.post("/admin/indexer", {"rewind": block}, token=ADMIN_TOKEN)
        if r["status"] != 200:
            raise RuntimeError(f"could not rewind indexer to {block}: HTTP {r['status']} {r['text']}")
        return r

    def mint_token(self, scope: str, subject: str | None = None, ttl: int | None = None) -> str:
        body = {"scope": scope}
        if subject:
            body["subject"] = subject
        if ttl:
            body["ttl"] = ttl
        r = self.post("/auth/token", body, token=ADMIN_TOKEN)
        if r["status"] != 201:
            raise RuntimeError(f"could not mint a {scope} token: HTTP {r['status']} {r['text']}")
        return r["body"]["token"]
