// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Base } from "./Base.t.sol";
import { Types } from "../src/lib/Types.sol";
import { PerpExchange } from "../src/PerpExchange.sol";

/// @dev The placeOrder gates, in the order the contract documents. Each test
///      sets up a state where TWO gates would fire, and asserts the earlier one
///      wins -- that is what "fixed order" means and what a client can rely on.
contract OrderGatesTest is Base {
    function setUp() public override {
        super.setUp();
        trader(alice, 100_000e6);
        trader(bob, 100_000e6);
    }

    // 1 -------------------------------------------------------------- paused
    function test_gate1_exchange_paused_beats_account_not_found() public {
        ex.setPaused(true);
        vm.prank(carol); // no account
        vm.expectRevert(PerpExchange.ExchangePaused.selector);
        ex.placeOrder(limit(ETH, Types.Side.Buy, 1 * S, 2_400 * P));
    }

    // 2 -------------------------------------------------------------- account
    function test_gate2_account_not_found_beats_market_paused() public {
        ex.setMarketStatus(ETH, Types.MarketStatus.Paused, 0);
        vm.prank(carol);
        vm.expectRevert(PerpExchange.AccountNotFound.selector);
        ex.placeOrder(limit(ETH, Types.Side.Buy, 1 * S, 2_400 * P));
    }

    // 3 -------------------------------------------------------------- market status
    function test_gate3_unknown_market() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(PerpExchange.UnknownMarket.selector, uint16(7)));
        ex.placeOrder(limit(7, Types.Side.Buy, 1 * S, 2_400 * P));
    }

    function test_gate3_market_paused_rejects_even_reducing_orders() public {
        place(alice, market(ETH, Types.Side.Buy, 1 * S));
        ex.setMarketStatus(ETH, Types.MarketStatus.Paused, 0);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(PerpExchange.MarketPaused.selector, ETH));
        ex.placeOrder(market(ETH, Types.Side.Sell, 1 * S));
    }

    function test_gate3_market_settling_rejects_orders() public {
        ex.setMarketStatus(ETH, Types.MarketStatus.Settling, 2_500 * P);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(PerpExchange.MarketSettling.selector, ETH));
        ex.placeOrder(limit(ETH, Types.Side.Buy, 1 * S, 2_400 * P));
    }

    // 4 -------------------------------------------------------------- reduce-only
    function test_gate4_reduce_only_market_allows_only_shrinking_orders() public {
        place(alice, market(ETH, Types.Side.Buy, 2 * S));
        ex.setMarketStatus(ETH, Types.MarketStatus.ReduceOnly, 0);

        vm.startPrank(alice);
        vm.expectRevert(PerpExchange.ReduceOnlyViolation.selector);
        ex.placeOrder(market(ETH, Types.Side.Buy, 1 * S)); // grows
        vm.expectRevert(PerpExchange.ReduceOnlyViolation.selector);
        ex.placeOrder(market(ETH, Types.Side.Sell, 3 * S)); // would flip
        ex.placeOrder(market(ETH, Types.Side.Sell, 1 * S)); // shrinks: allowed
        vm.stopPrank();
        assertEq(pos(alice, ETH).size, int64(1 * S));
    }

    function test_gate4_reduce_only_flag_needs_an_opposite_position() public {
        Types.OrderParams memory p = market(ETH, Types.Side.Sell, 1 * S);
        p.reduceOnly = true;
        vm.prank(alice); // flat
        vm.expectRevert(PerpExchange.ReduceOnlyViolation.selector);
        ex.placeOrder(p);
    }

    function test_gate4_fires_before_shape_gates() public {
        // reduce-only violation AND a bad tick: reduce-only wins
        Types.OrderParams memory p = limit(ETH, Types.Side.Sell, 1 * S, 2_400 * P + 1);
        p.reduceOnly = true;
        vm.prank(alice);
        vm.expectRevert(PerpExchange.ReduceOnlyViolation.selector);
        ex.placeOrder(p);
    }

    // 5 -------------------------------------------------------------- shape
    function test_gate5_step_size() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(PerpExchange.InvalidStep.selector, uint64(1 * S + 1), uint64(1e5)));
        ex.placeOrder(limit(ETH, Types.Side.Buy, 1 * S + 1, 2_400 * P));
    }

    function test_gate5_tick_size_on_limit_price() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(PerpExchange.InvalidTick.selector, uint64(2_400 * P + 1), uint64(1e6)));
        ex.placeOrder(limit(ETH, Types.Side.Buy, 1 * S, 2_400 * P + 1));
    }

    function test_gate5_tick_size_on_trigger_price() public {
        Types.OrderParams memory p = order(ETH, Types.Side.Buy, Types.OrderType.StopMarket, Types.TimeInForce.IOC, 1 * S, 0);
        p.triggerPrice = 2_600 * P + 5;
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(PerpExchange.InvalidTick.selector, uint64(2_600 * P + 5), uint64(1e6)));
        ex.placeOrder(p);
    }

    function test_gate5_price_band_both_sides() public {
        uint64 lower = uint64((uint256(ETH_INDEX) * 9_500) / 10_000);
        uint64 upper = uint64((uint256(ETH_INDEX) * 10_500) / 10_000);
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(PerpExchange.PriceOutOfBand.selector, lower - 1e6, lower, upper));
        ex.placeOrder(limit(ETH, Types.Side.Buy, 1 * S, lower - 1e6));
        vm.expectRevert(abi.encodeWithSelector(PerpExchange.PriceOutOfBand.selector, upper + 1e6, lower, upper));
        ex.placeOrder(limit(ETH, Types.Side.Sell, 1 * S, upper + 1e6));
        // exactly on the band edge is accepted
        ex.placeOrder(limit(ETH, Types.Side.Buy, 1 * S, lower));
        vm.stopPrank();
    }

    function test_gate5_min_notional_uses_limit_price_or_index() public {
        // 0.001 ETH at $2400 = $2.40 < $10
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(PerpExchange.BelowMinNotional.selector, uint256(2_400_000), uint64(10e6)));
        ex.placeOrder(limit(ETH, Types.Side.Buy, 1e5, 2_400 * P));
        vm.expectRevert(abi.encodeWithSelector(PerpExchange.BelowMinNotional.selector, uint256(2_500_000), uint64(10e6)));
        ex.placeOrder(market(ETH, Types.Side.Buy, 1e5));
        vm.stopPrank();
    }

    // 6 -------------------------------------------------------------- expiry
    function test_gate6_max_ts_is_compared_to_the_chain_clock_in_micros() public {
        Types.OrderParams memory p = limit(ETH, Types.Side.Buy, 1 * S, 2_400 * P);
        uint64 clock = ex.clockMicros();
        p.maxTs = clock - 1;
        vm.startPrank(alice);
        vm.expectRevert(abi.encodeWithSelector(PerpExchange.OrderExpired.selector, clock - 1, clock));
        ex.placeOrder(p);
        p.maxTs = clock; // equal is not expired
        ex.placeOrder(p);
        vm.stopPrank();
    }

    // 7 -------------------------------------------------------------- user order id
    function test_gate7_user_order_id_unique_among_open_orders() public {
        Types.OrderParams memory p = limit(ETH, Types.Side.Buy, 1 * S, 2_400 * P);
        p.userOrderId = 42;
        vm.startPrank(alice);
        uint64 first = ex.placeOrder(p);
        vm.expectRevert(abi.encodeWithSelector(PerpExchange.DuplicateUserOrderId.selector, uint32(42)));
        ex.placeOrder(p);
        ex.cancelOrder(first);
        ex.placeOrder(p); // reusable once the earlier one is gone
        vm.stopPrank();
    }

    // 8 -------------------------------------------------------------- slots
    function test_gate8_open_order_slots_are_capped_per_account() public {
        vm.startPrank(alice);
        for (uint32 i = 0; i < Types.MAX_OPEN_ORDERS; i++) {
            ex.placeOrder(limit(ETH, Types.Side.Buy, 1 * S, 2_400 * P - uint64(i) * 1e6));
        }
        vm.expectRevert(PerpExchange.OrderSlotsFull.selector);
        ex.placeOrder(limit(ETH, Types.Side.Buy, 1 * S, 2_380 * P));
        ex.cancelAll(ETH);
        ex.placeOrder(limit(ETH, Types.Side.Buy, 1 * S, 2_380 * P));
        vm.stopPrank();
        assertEq(ex.getAccount(alice).openOrders, 1);
    }

    // 9 -------------------------------------------------------------- post-only
    function test_gate9_post_only_that_would_cross_is_rejected() public {
        // bob asks 2510 on the book; the backstop asks index + 10 bps = 2502.50, which is
        // the BETTER opposite price, and that is the one the error reports.
        place(bob, limit(ETH, Types.Side.Sell, 1 * S, 2_510 * P));
        Types.OrderParams memory p = limit(ETH, Types.Side.Buy, 1 * S, 2_510 * P);
        p.tif = Types.TimeInForce.PostOnly;
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(PerpExchange.PostOnlyWouldCross.selector, uint64(2_510 * P), uint64(2_502_50 * 1e6)));
        ex.placeOrder(p);
    }

    function test_gate9_post_only_crossing_the_backstop_is_also_rejected() public {
        // backstop asks at index + 10 bps = 2502.5; a post-only bid at 2503 would hit it
        Types.OrderParams memory p = limit(ETH, Types.Side.Buy, 1 * S, 2_503 * P);
        p.tif = Types.TimeInForce.PostOnly;
        vm.prank(alice);
        vm.expectRevert();
        ex.placeOrder(p);
    }

    // 10 ------------------------------------------------------------- margin
    function test_gate10_insufficient_collateral_for_new_exposure() public {
        trader(carol, 40e6); // $40; 1 ETH needs 2% of $2500 = $50
        vm.prank(carol);
        vm.expectRevert(abi.encodeWithSelector(PerpExchange.InsufficientCollateral.selector, int256(40e6), uint256(50e6)));
        ex.placeOrder(market(ETH, Types.Side.Buy, 1 * S));
    }

    function test_gate10_reducing_orders_need_no_extra_margin() public {
        trader(carol, 60e6);
        place(carol, market(ETH, Types.Side.Buy, 1 * S));
        // Mark is the last fill (2502.50, the backstop ask) clamped to index +- 1 %,
        // so a small index move leaves the mark where it is. Index 2460 pulls the
        // clamp down to 2484.60: unrealised -17.9, equity ~40.9, IM ~49.7 -> free < 0.
        oracle.setMockPrice(ETH, 2_460 * P);
        assertLt(ex.freeCollateral(carol), 0);
        assertFalse(ex.isLiquidatable(carol), "still above maintenance");
        place(carol, market(ETH, Types.Side.Sell, 1 * S)); // reduce: allowed
        assertEq(pos(carol, ETH).size, 0);
    }
}
