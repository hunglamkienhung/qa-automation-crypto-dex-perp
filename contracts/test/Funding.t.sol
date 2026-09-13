// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Base } from "./Base.t.sol";
import { Types } from "../src/lib/Types.sol";
import { FundingMath } from "../src/lib/FundingMath.sol";

contract FundingTest is Base {
    function setUp() public override {
        super.setUp();
        trader(alice, 1_000_000e6);
        trader(bob, 1_000_000e6);
    }

    function test_update_is_permissionless_and_does_nothing_inside_the_interval() public {
        vm.prank(keeper);
        bool advanced = ex.updateFunding(ETH);
        assertFalse(advanced, "interval has not elapsed");
        (int64 rate, int128 idx,,) = ex.getFundingRate(ETH);
        assertEq(rate, 0);
        assertEq(idx, 0);
    }

    function test_last_funding_time_always_sits_on_an_interval_boundary() public {
        (,, uint64 last0, uint64 next0) = ex.getFundingRate(ETH);
        assertEq(last0 % 3600, 0);
        assertEq(next0, last0 + 3600);
        warpFresh(3600 + 1234); // somewhere inside the next-next interval
        vm.prank(keeper);
        assertTrue(ex.updateFunding(ETH));
        (,, uint64 last1,) = ex.getFundingRate(ETH);
        assertEq(last1 % 3600, 0, "boundary, not the call time");
        assertEq(last1, uint64(block.timestamp - (block.timestamp % 3600)));
    }

    function test_positive_premium_makes_longs_pay_shorts() public {
        // trade above the index so the mark carries a premium: bob asks 2520 (0.8 %)
        place(bob, limit(ETH, Types.Side.Sell, 1 * S, 2_520 * P));
        place(alice, limit(ETH, Types.Side.Buy, 101 * S, 2_520 * P)); // 100 from backstop @2502.50, 1 from bob @2520
        assertEq(ex.getMarkPrice(ETH), 2_520 * P);

        warpFresh(3600);
        ex.updateFunding(ETH);
        (int64 rate, int128 idx,,) = ex.getFundingRate(ETH);
        assertGt(rate, 0, "premium > 0 -> positive rate");
        assertLe(rate, 75, "clamped to the cap");
        assertGt(idx, 0);

        // funding settles on the next touch: alice (long) pays, bob (short) receives
        int256 aliceOwes = ex.equity(alice);
        int128 bobBefore = bal(bob);
        int128 aliceBefore = bal(alice);
        place(bob, limit(ETH, Types.Side.Buy, 1 * S, 2_502 * P));
        place(alice, market(ETH, Types.Side.Sell, 1 * S));
        assertLt(bal(alice) - aliceBefore, int128(0), "alice paid funding (and a fee)");
        assertGt(bal(bob) - bobBefore, int128(0), "bob received funding (and a rebate)");
        aliceOwes; // equity already reflected the owed funding before the touch
    }

    function test_rate_is_clamped_to_the_cap() public {
        // a 5 % premium with a 75 bps cap
        assertEq(FundingMath.rateBps(500, 1, 75), 75);
        assertEq(FundingMath.rateBps(-500, 1, 75), -75);
        assertEq(FundingMath.rateBps(30, 1, 75), 30);
        assertEq(FundingMath.rateBps(0, 0, 75), 0);
    }

    function test_premium_is_the_average_of_samples() public {
        // three samples: +10, +20, +30 bps -> 20 bps
        int128 acc = 10 + 20 + 30;
        assertEq(FundingMath.rateBps(acc, 3, 75), 20);
        assertEq(FundingMath.premiumBps(2_525 * P, 2_500 * P), 100, "1 % premium = 100 bps");
        assertEq(FundingMath.premiumBps(2_475 * P, 2_500 * P), -100);
    }

    function test_cumulative_index_accumulates_across_intervals() public {
        place(bob, limit(ETH, Types.Side.Sell, 1 * S, 2_520 * P));
        place(alice, limit(ETH, Types.Side.Buy, 101 * S, 2_520 * P));
        warpFresh(3600);
        ex.updateFunding(ETH);
        (, int128 idx1,,) = ex.getFundingRate(ETH);
        warpFresh(3600);
        ex.updateFunding(ETH); // the sample taken by this call is the only one in the new interval
        (, int128 idx2,,) = ex.getFundingRate(ETH);
        assertGt(idx2, idx1, "index keeps growing while the premium persists");
    }

    function test_funding_owed_is_part_of_equity_before_it_is_settled() public {
        place(bob, limit(ETH, Types.Side.Sell, 1 * S, 2_520 * P));
        place(alice, limit(ETH, Types.Side.Buy, 101 * S, 2_520 * P));
        int256 eqBefore = ex.equity(alice);
        warpFresh(3600);
        ex.updateFunding(ETH);
        assertLt(ex.equity(alice), eqBefore, "owed funding lowers equity immediately");
        assertGt(ex.equity(bob), 0);
    }
}
