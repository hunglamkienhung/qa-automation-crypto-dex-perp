"""Read-only access to the indexer's SQLite store -- the same file mini-api writes.
Mirror of node/be/db/store.js: the two stacks open the same file and assert on
the same rows.

Every read is its own implicit transaction, so each call sees the latest
committed state. A missing file is DbUnreachable and grades Blocked: the
service is not running, which says nothing about whether its rows would be
right.

WAL readers need the -shm index next to the file, so the store must live on a
filesystem the reader can memory-map. In WSL that means a Linux path
(MINI_API_DB=/tmp/...), not /mnt/<drive>; the service takes the same variable.
"""

from __future__ import annotations

import os
import sqlite3
import time
from pathlib import Path

DB_FILE = Path(os.environ.get("MINI_API_DB") or Path(__file__).resolve().parents[3] / "services" / "mini-api" / "data" / "mini-api.db")
SCHEMA = Path(__file__).resolve().parents[3] / "services" / "mini-api" / "db" / "schema.sql"
DERIVED = ["orders", "trades", "positions", "position_events", "funding", "liquidations", "accounts", "applied_logs", "index_prices"]


class DbUnreachable(Exception):
    pass


def _rows(cur) -> list[dict]:
    cols = [c[0] for c in cur.description] if cur.description else []
    return [dict(zip(cols, r)) for r in cur.fetchall()]


class Store:
    def __init__(self, file: Path = DB_FILE) -> None:
        self.file = Path(file)
        if not self.file.exists():
            raise DbUnreachable(f"no store at {self.file} -- start mini-api (services/mini-api/serve.sh up)")
        try:
            self.db = sqlite3.connect(f"file:{self.file.as_posix()}?mode=ro", uri=True, timeout=5, isolation_level=None)
            self.db.execute("SELECT 1 FROM indexer_state").fetchall()
        except sqlite3.Error as err:
            raise DbUnreachable(f"cannot open {self.file}: {err}") from err

    def close(self) -> None:
        try:
            self.db.close()
        except sqlite3.Error:
            pass

    def all(self, sql: str, *params) -> list[dict]:
        return _rows(self.db.execute(sql, params))

    def get(self, sql: str, *params) -> dict | None:
        rows = self.all(sql, *params)
        return rows[0] if rows else None

    def count(self, table: str, where: str = "", *params) -> int:
        return int(self.get(f"SELECT COUNT(*) AS n FROM {table} {where}", *params)["n"])

    def state(self) -> dict | None:
        return self.get("SELECT * FROM indexer_state WHERE id = 1")

    def tables(self) -> list[str]:
        return [r["name"] for r in self.all("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")]

    def primary_key(self, table: str) -> list[str]:
        cols = [r for r in self.all(f"PRAGMA table_info({table})") if r["pk"] > 0]
        return [c["name"] for c in sorted(cols, key=lambda c: c["pk"])]

    def counts(self) -> dict:
        return {t: self.count(t) for t in DERIVED}

    def mark_of(self, market_id: int) -> int | None:
        """mark = clamp(last trade, index +/- maxBasis); index when there is no trade -- the contract's rule, from rows."""
        m = self.get("SELECT max_basis_bps FROM markets WHERE market_id = ?", market_id)
        idx = self.get("SELECT price FROM index_prices WHERE market_id = ?", market_id)
        if not m or not idx:
            return None
        index = int(idx["price"])
        last = self.get("SELECT price FROM trades WHERE market_id = ? ORDER BY block_number DESC, log_index DESC LIMIT 1", market_id)
        if not last:
            return index
        lo = index * (10_000 - int(m["max_basis_bps"])) // 10_000
        hi = index * (10_000 + int(m["max_basis_bps"])) // 10_000
        p = int(last["price"])
        return lo if p < lo else hi if p > hi else p


def throwaway() -> sqlite3.Connection:
    """A throwaway store with the schema applied, for constraint checks that must not touch the live file."""
    db = sqlite3.connect(":memory:", isolation_level=None)
    db.executescript(SCHEMA.read_text(encoding="utf-8").replace("PRAGMA journal_mode = WAL;", ""))
    db.execute("PRAGMA foreign_keys = ON")
    return db


def wait_caught_up(store: Store, dex, timeout_s: float = 60.0, poll_s: float = 0.15) -> dict:
    """Wait until last_block equals the chain head AND last_block_hash equals that block's hash.
    The hash condition is what makes this correct across an EVM revert."""
    started = time.monotonic()
    while True:
        head = dex.block_number()
        st = store.state()
        last = {"head": head, "last_block": st["last_block"] if st else None, "paused": st["paused"] if st else None}
        if st and st["last_block"] == head:
            blk = dex.block(head)
            if blk and blk["hash"] == st["last_block_hash"]:
                return {"caughtUp": True, **last, "waitedMs": int((time.monotonic() - started) * 1000)}
        if time.monotonic() - started > timeout_s:
            return {"caughtUp": False, **last, "waitedMs": int((time.monotonic() - started) * 1000)}
        time.sleep(poll_s)
