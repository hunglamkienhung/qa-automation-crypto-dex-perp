// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Base } from "./Base.t.sol";
import { Types } from "../src/lib/Types.sol";
import { PerpExchange } from "../src/PerpExchange.sol";

/// @dev Position netting, average entry, realised and unrealised PnL, open
///      interest, the mark price rule, and the ledger invariant.
contract PositionsTest is Base {
    function setUp() public override {
        super.setUp();
        trader(alice, 1_000_000e6);
        trader(bob, 1_000_000e6);
    }

    function test_open_long_then_add_blends_the_entry() public {
        place(bob, limit(ETH, Types.Side.Sell, 1 * S, 2_500 * P));
        place(alice, market(ETH, Types.Side.Buy, 1 * S)); // 1 @ 2500 from bob
        place(bob, limit(ETH, Types.Side.Sell, 1 * S, 2_501 * P));
        place(alice, market(ETH, Types.Side.Buy, 1 * S)); // 1 @ 2501 from bob
        Types.Position memory p = pos(alice, ETH);
        assertEq(p.size, int64(2 * S));
        assertEq(p.entryPrice, 2_500_50 * 1e6);
    }

    function test_reduce_realises_pnl_at_the_fill_price() public {
        place(bob, limit(ETH, Types.Side.Sell, 2 * S, 2_500 * P));
        place(alice, market(ETH, Types.Side.Buy, 2 * S));
        int128 before = bal(alice);

        // The backstop quotes 2497.50 / 2502.50 around the index. A bid ABOVE 2502.50
        // would cross the backstop's ask and fill immediately; to rest, bob bids inside.
        place(bob, limit(ETH, Types.Side.Buy, 1 * S, 2_502 * P));
        place(alice, market(ETH, Types.Side.Sell, 1 * S)); // alice sells 1 @ 2502: +$2
        Types.Position memory p = pos(alice, ETH);
        assertEq(p.size, int64(1 * S));
        assertEq(p.entryPrice, 2_500 * P, "entry unchanged on a reduce");
        assertEq(p.realizedPnl, int128(2e6));
        // balance moved by +2 minus taker fee 5 bps of 2502 = 1.251
        assertEq(bal(alice) - before, int128(2e6) - int128(1_251_000));
    }

    function test_flip_closes_and_opens_at_the_new_price() public {
        place(bob, limit(ETH, Types.Side.Sell, 1 * S, 2_500 * P));
        place(alice, market(ETH, Types.Side.Buy, 1 * S)); // long 1 @ 2500
        place(bob, limit(ETH, Types.Side.Buy, 3 * S, 2_498 * P)); // inside the backstop spread, so it rests
        place(alice, market(ETH, Types.Side.Sell, 3 * S)); // close 1 (-$2), open short 2 @ 2498
        Types.Position memory p = pos(alice, ETH);
        assertEq(p.size, -int64(2 * S));
        assertEq(p.entryPrice, 2_498 * P);
        assertEq(p.realizedPnl, -int128(2e6));
    }

    function test_close_to_flat_clears_entry_and_holder() public {
        place(bob, limit(ETH, Types.Side.Sell, 1 * S, 2_500 * P));
        place(alice, market(ETH, Types.Side.Buy, 1 * S));
        assertEq(ex.holdersOf(ETH).length, 2);
        place(bob, limit(ETH, Types.Side.Buy, 1 * S, 2_500 * P));
        place(alice, market(ETH, Types.Side.Sell, 1 * S));
        assertEq(pos(alice, ETH).size, 0);
        assertEq(pos(alice, ETH).entryPrice, 0);
        assertEq(ex.holdersOf(ETH).length, 0, "both flat");
    }

    function test_unrealised_pnl_follows_the_mark() public {
        place(bob, limit(ETH, Types.Side.Sell, 1 * S, 2_500 * P));
        place(alice, market(ETH, Types.Side.Buy, 1 * S));
        int256 eq0 = ex.equity(alice);
        // mark is last fill (2500) clamped to index +- 1 %; move the index to 2600
        // and the mark rides the clamp up to 2574: +74 unrealised
        oracle.setMockPrice(ETH, 2_600 * P);
        assertEq(ex.getMarkPrice(ETH), 2_574 * P);
        assertEq(ex.equity(alice) - eq0, int256(74e6));
    }

    function test_mark_is_index_until_the_first_fill_then_last_fill_clamped() public {
        assertEq(ex.getMarkPrice(ETH), ETH_INDEX, "no fill yet: mark == index");
        place(bob, limit(ETH, Types.Side.Sell, 1 * S, 2_520 * P)); // 0.8 % above index, inside the 1 % basis cap
        // a 101 buy takes the backstop's 100 at 2502.50 first, then bob's 1 at 2520: last fill = 2520
        place(alice, limit(ETH, Types.Side.Buy, 101 * S, 2_520 * P));
        assertEq(ex.getMarkPrice(ETH), 2_520 * P);
        oracle.setMockPrice(ETH, 2_400 * P); // now 2520 is 5 % above: clamp to 2424
        assertEq(ex.getMarkPrice(ETH), 2_424 * P);
    }

    function test_open_interest_tracks_both_sides() public {
        place(bob, limit(ETH, Types.Side.Sell, 2 * S, 2_500 * P));
        place(alice, market(ETH, Types.Side.Buy, 2 * S));
        Types.Market memory m = ex.getMarket(ETH);
        assertEq(m.openInterestLong, 2 * S);
        assertEq(m.openInterestShort, 2 * S);
        place(bob, limit(ETH, Types.Side.Buy, 1 * S, 2_500 * P));
        place(alice, market(ETH, Types.Side.Sell, 1 * S));
        m = ex.getMarket(ETH);
        assertEq(m.openInterestLong, 1 * S);
        assertEq(m.openInterestShort, 1 * S);
    }

    function test_ledger_total_is_unchanged_by_trading() public {
        int128 before = ledgerTotal();
        place(bob, limit(ETH, Types.Side.Sell, 2 * S, 2_500 * P));
        place(alice, market(ETH, Types.Side.Buy, 3 * S)); // 2 from bob, 1 from backstop
        place(bob, limit(ETH, Types.Side.Buy, 3 * S, 2_480 * P));
        place(alice, market(ETH, Types.Side.Sell, 3 * S));
        assertEq(ledgerTotal(), before, "fills, fees and pnl only move value between ledger entries");
        (uint256 held, int128 ledger) = vault.reserves();
        assertEq(int128(int256(held)), ledger, "and the vault still holds every dollar of it");
    }

    function test_fees_reach_treasury_and_insurance_by_the_configured_split() public {
        int128 t0 = bal(treasury);
        int128 i0 = bal(address(insurance));
        place(bob, limit(ETH, Types.Side.Sell, 1 * S, 2_500 * P));
        place(alice, market(ETH, Types.Side.Buy, 1 * S));
        // taker 5 bps of 2500 = 1.25; maker rebate 2 bps = 0.50; net 0.75 split 50/50
        assertEq(bal(treasury) - t0, int128(375_000));
        assertEq(bal(address(insurance)) - i0, int128(375_000));
    }

    function test_estimated_liquidation_price_is_below_entry_for_a_long() public {
        trader(address(0xCAFE), 100e6);
        place(address(0xCAFE), market(ETH, Types.Side.Buy, 1 * S));
        uint64 liq = ex.estimatedLiquidationPrice(address(0xCAFE), ETH);
        assertGt(liq, 0);
        assertLt(liq, pos(address(0xCAFE), ETH).entryPrice);
    }
}
