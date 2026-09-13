"""A small ABI coder: enough of the Solidity ABI to talk to PerpDEX.

Mirror of ``node/be/contract/chain/abi.js``; verified against the same
``cast``-produced vectors in ``test_abi.py``. Both stacks must produce the
same bytes for the same call, and both are checked against a third
implementation, so a disagreement is never a tie.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from be.contract.chain.keccak import keccak256, selector


@dataclass
class T:
    kind: str
    bits: int = 256
    n: int = 0
    inner: "T | None" = None
    length: int | None = None
    components: list = field(default_factory=list)


def parse_type(s: str) -> T:
    s = s.strip()
    m = re.match(r"^(.*)\[(\d*)\]$", s)
    if m:
        return T("array", inner=parse_type(m.group(1)), length=int(m.group(2)) if m.group(2) else None)
    if s.startswith("("):
        if not s.endswith(")"):
            raise ValueError("unbalanced tuple: " + s)
        return T("tuple", components=[parse_type(p) for p in _split_top(s[1:-1])])
    m = re.match(r"^uint(\d*)$", s)
    if m:
        return T("uint", bits=int(m.group(1)) if m.group(1) else 256)
    m = re.match(r"^int(\d*)$", s)
    if m:
        return T("int", bits=int(m.group(1)) if m.group(1) else 256)
    if s == "address":
        return T("address")
    if s == "bool":
        return T("bool")
    m = re.match(r"^bytes(\d+)$", s)
    if m:
        return T("bytesN", n=int(m.group(1)))
    if s == "bytes":
        return T("bytes")
    if s == "string":
        return T("string")
    raise ValueError("unsupported type: " + s)


def _split_top(s: str) -> list[str]:
    out, depth, start = [], 0, 0
    for i, ch in enumerate(s):
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
        elif ch == "," and depth == 0:
            out.append(s[start:i])
            start = i + 1
    if s.strip():
        out.append(s[start:])
    return out


def is_dynamic(t: T) -> bool:
    if t.kind in ("string", "bytes"):
        return True
    if t.kind == "array":
        return t.length is None or is_dynamic(t.inner)
    if t.kind == "tuple":
        return any(is_dynamic(c) for c in t.components)
    return False


def static_size(t: T) -> int:
    if t.kind == "array":
        return t.length * static_size(t.inner)
    if t.kind == "tuple":
        return sum(static_size(c) for c in t.components)
    return 32


MASK = (1 << 256) - 1


def word(n: int) -> str:
    return format(n & MASK, "064x")


def encode_value(t: T, v) -> str:
    if t.kind == "uint":
        n = int(v)
        if n < 0 or n >= 1 << t.bits:
            raise ValueError(f"value {v} does not fit uint{t.bits}")
        return word(n)
    if t.kind == "int":
        n = int(v)
        lim = 1 << (t.bits - 1)
        if n < -lim or n >= lim:
            raise ValueError(f"value {v} does not fit int{t.bits}")
        return word(n)
    if t.kind == "address":
        return str(v).lower().replace("0x", "").rjust(64, "0")
    if t.kind == "bool":
        return word(1 if v else 0)
    if t.kind == "bytesN":
        return str(v).replace("0x", "").ljust(64, "0")
    if t.kind in ("string", "bytes"):
        hx = str(v).encode("utf-8").hex() if t.kind == "string" else str(v).replace("0x", "")
        ln = len(hx) // 2
        return word(ln) + hx.ljust(((ln + 31) // 32) * 64, "0")
    if t.kind == "array":
        items = list(v)
        if t.length is not None and len(items) != t.length:
            raise ValueError("fixed array length mismatch")
        body = encode_tuple([t.inner] * len(items), items)
        return (word(len(items)) + body) if t.length is None else body
    if t.kind == "tuple":
        vals = list(v) if isinstance(v, (list, tuple)) else [v[i] for i in range(len(t.components))]
        return encode_tuple(t.components, vals)
    raise ValueError("cannot encode " + t.kind)


def encode_tuple(types: list[T], values: list) -> str:
    if len(types) != len(values):
        raise ValueError(f"expected {len(types)} values, got {len(values)}")
    heads, tails = [], []
    head_size = sum(32 if is_dynamic(t) else static_size(t) for t in types)
    tail_off = head_size
    for t, v in zip(types, values):
        enc = encode_value(t, v)
        if is_dynamic(t):
            heads.append(word(tail_off))
            tails.append(enc)
            tail_off += len(enc) // 2
        else:
            heads.append(enc)
    return "".join(heads) + "".join(tails)


def encode_call(signature: str, args: list) -> str:
    open_ = signature.index("(")
    types = parse_type(signature[open_:]).components
    return selector(signature) + encode_tuple(types, args)  # selector() is 0x-prefixed


def _decode_value(t: T, hx: str, offset: int):
    def at(o: int) -> str:
        return hx[o * 2 : o * 2 + 64]

    if t.kind == "uint":
        return int(at(offset), 16), 32
    if t.kind == "int":
        n = int(at(offset), 16)
        if n >= 1 << 255:
            n -= 1 << 256
        return n, 32
    if t.kind == "address":
        return "0x" + at(offset)[24:], 32
    if t.kind == "bool":
        return int(at(offset), 16) != 0, 32
    if t.kind == "bytesN":
        return "0x" + at(offset)[: t.n * 2], 32
    if t.kind in ("string", "bytes"):
        ln = int(at(offset), 16)
        raw = hx[(offset + 32) * 2 : (offset + 32) * 2 + ln * 2]
        return (bytes.fromhex(raw).decode("utf-8") if t.kind == "string" else "0x" + raw), 32
    if t.kind == "array":
        base, length = offset, t.length
        if length is None:
            length = int(at(offset), 16)
            base = offset + 32
        items, _ = _decode_tuple([t.inner] * length, hx, base)
        return items, (32 if t.length is None else static_size(t))
    if t.kind == "tuple":
        vals, _ = _decode_tuple(t.components, hx, offset)
        return vals, (32 if is_dynamic(t) else static_size(t))
    raise ValueError("cannot decode " + t.kind)


def _decode_tuple(types: list[T], hx: str, base: int):
    out, cursor = [], base
    for t in types:
        if is_dynamic(t):
            rel = int(hx[cursor * 2 : cursor * 2 + 64], 16)
            v, _ = _decode_value(t, hx, base + rel)
            out.append(v)
            cursor += 32
        else:
            v, used = _decode_value(t, hx, cursor)
            out.append(v)
            cursor += used
    return out, cursor - base


def decode(type_string: str, hx: str) -> list:
    t = parse_type(type_string if type_string.startswith("(") else "(" + type_string + ")")
    body = str(hx).replace("0x", "", 1) if str(hx).startswith("0x") else str(hx)
    vals, _ = _decode_tuple(t.components, body, 0)
    return vals


def named(fields: list[str], values: list) -> dict:
    return dict(zip(fields, values))


def topic(signature: str) -> str:
    return "0x" + keccak256(signature.encode("utf-8")).hex()


def error_table(signatures: list[str]) -> dict:
    table = {}
    for sig in signatures:
        open_ = sig.index("(")
        table[selector(sig).replace("0x", "")] = {"name": sig[:open_], "types": sig[open_:]}
    return table


def decode_error(data: str | None, table: dict) -> dict:
    hx = (data or "").replace("0x", "", 1) if (data or "").startswith("0x") else (data or "")
    if len(hx) < 8:
        return {"name": "unknown", "args": [], "raw": data}
    sel = hx[:8]
    entry = table.get(sel)
    if not entry:
        return {"name": "unknown", "args": [], "raw": data, "selector": "0x" + sel}
    args = [] if entry["types"] == "()" else decode(entry["types"], "0x" + hx[8:])
    return {"name": entry["name"], "args": args, "raw": data, "selector": "0x" + sel}
