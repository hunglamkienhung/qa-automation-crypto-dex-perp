// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Types } from "./Types.sol";

/// @title A price-time priority book per market, as two sorted linked lists.
/// @notice Bids are kept best (highest) first, asks best (lowest) first; inside
///         a price level, the earlier `seq` comes first. Insertion walks the
///         list, so cost is linear in resting orders -- fine for a chain whose
///         only traders are the tests, and simple enough to read in one pass.
///
///         The book stores only order ids and links. The orders themselves live
///         in the exchange's mapping, which is passed in so the library can
///         compare prices without copying structs.
library OrderBook {
    struct SideList {
        uint64 head;
        uint64 count;
        mapping(uint64 => uint64) next;
    }

    struct Book {
        SideList bids;
        SideList asks;
    }

    /// @dev true when `a` should rest ahead of `b` on `side`.
    function _ahead(Types.Order storage a, Types.Order storage b, Types.Side side) private view returns (bool) {
        if (a.price == b.price) return a.seq < b.seq;
        return side == Types.Side.Buy ? a.price > b.price : a.price < b.price;
    }

    function _list(Book storage book, Types.Side side) private view returns (SideList storage) {
        return side == Types.Side.Buy ? book.bids : book.asks;
    }

    function insert(Book storage book, mapping(uint64 => Types.Order) storage orders, uint64 id) internal {
        Types.Order storage o = orders[id];
        SideList storage list = _list(book, o.side);

        if (list.head == 0 || _ahead(o, orders[list.head], o.side)) {
            list.next[id] = list.head;
            list.head = id;
        } else {
            uint64 cur = list.head;
            while (list.next[cur] != 0 && !_ahead(o, orders[list.next[cur]], o.side)) {
                cur = list.next[cur];
            }
            list.next[id] = list.next[cur];
            list.next[cur] = id;
        }
        list.count += 1;
    }

    function remove(Book storage book, mapping(uint64 => Types.Order) storage orders, uint64 id) internal returns (bool) {
        SideList storage list = _list(book, orders[id].side);
        if (list.head == 0) return false;
        if (list.head == id) {
            list.head = list.next[id];
            delete list.next[id];
            list.count -= 1;
            return true;
        }
        uint64 cur = list.head;
        while (list.next[cur] != 0 && list.next[cur] != id) {
            cur = list.next[cur];
        }
        if (list.next[cur] != id) return false;
        list.next[cur] = list.next[id];
        delete list.next[id];
        list.count -= 1;
        return true;
    }

    function best(Book storage book, Types.Side side) internal view returns (uint64) {
        return _list(book, side).head;
    }

    function nextOf(Book storage book, Types.Side side, uint64 id) internal view returns (uint64) {
        return _list(book, side).next[id];
    }

    function count(Book storage book, Types.Side side) internal view returns (uint64) {
        return _list(book, side).count;
    }

    /// @notice Aggregate resting size per price level, best first, up to `depth` levels.
    function levels(Book storage book, mapping(uint64 => Types.Order) storage orders, Types.Side side, uint8 depth)
        internal
        view
        returns (Types.BookLevel[] memory out)
    {
        Types.BookLevel[] memory tmp = new Types.BookLevel[](depth);
        uint8 n = 0;
        uint64 cur = _list(book, side).head;
        while (cur != 0 && n < depth) {
            Types.Order storage o = orders[cur];
            uint64 remaining = o.size - o.filled;
            if (n > 0 && tmp[n - 1].price == o.price) {
                tmp[n - 1].size += remaining;
            } else {
                tmp[n] = Types.BookLevel(o.price, remaining, 0);
                n += 1;
            }
            cur = _list(book, side).next[cur];
        }
        out = new Types.BookLevel[](n);
        for (uint8 i = 0; i < n; i++) out[i] = tmp[i];
    }
}
