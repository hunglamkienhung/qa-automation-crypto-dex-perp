// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Base } from "./Base.t.sol";
import { Types } from "../src/lib/Types.sol";
import { PerpExchange } from "../src/PerpExchange.sol";
import { Vm } from "forge-std/Vm.sol";

/// @dev The book and the matching engine: price-time priority, partial fills,
///      self-trade prevention, the backstop as maker of last resort, and every
///      time-in-force. Fees are the ETH market's: taker 5 bps, maker -2 bps.
contract MatchingTest is Base {
    function setUp() public override {
        super.setUp();
        trader(alice, 1_000_000e6);
        trader(bob, 1_000_000e6);
        trader(carol, 1_000_000e6);
    }

    function test_limit_rests_and_shows_on_the_book() public {
        uint64 id = place(alice, limit(ETH, Types.Side.Buy, 2 * S, 2_400 * P));
        Types.Order memory o = ex.getOrder(id);
        assertEq(uint8(o.status), uint8(Types.OrderStatus.Open));
        (Types.BookLevel[] memory bids,) = ex.getOrderBook(ETH, 5);
        // the backstop bid (index - 10 bps = 2497.50) sits above alice's 2400
        assertEq(bids[0].source, 1);
        assertEq(bids[0].price, 2_497_50 * 1e6);
        assertEq(bids[1].price, 2_400 * P);
        assertEq(bids[1].size, 2 * S);
        assertEq(bids[1].source, 0);
    }

    function test_price_priority_then_time_priority() public {
        uint64 late = place(alice, limit(ETH, Types.Side.Sell, 1 * S, 2_501 * P)); // best price, placed first
        uint64 worse = place(bob, limit(ETH, Types.Side.Sell, 1 * S, 2_502 * P));
        uint64 sameLater = place(carol, limit(ETH, Types.Side.Sell, 1 * S, 2_501 * P)); // same price, later
        (, Types.BookLevel[] memory asks) = ex.getOrderBook(ETH, 5);
        assertEq(asks[0].price, 2_501 * P);
        assertEq(asks[0].size, 2 * S); // both 2501 orders aggregate into one level

        // a 1.5 ETH market buy from a fourth account takes alice's 1 first, then 0.5 of carol's
        address dave = makeAddr("dave");
        trader(dave, 100_000e6);
        place(dave, market(ETH, Types.Side.Buy, 15 * S / 10));
        assertEq(uint8(ex.getOrder(late).status), uint8(Types.OrderStatus.Filled));
        assertEq(ex.getOrder(sameLater).filled, 5 * S / 10);
        assertEq(ex.getOrder(worse).filled, 0);
    }

    function test_fill_price_is_the_makers_price() public {
        place(alice, limit(ETH, Types.Side.Sell, 1 * S, 2_501 * P));
        int128 aliceBefore = bal(alice);
        int128 bobBefore = bal(bob);
        place(bob, limit(ETH, Types.Side.Buy, 1 * S, 2_520 * P)); // willing to pay more
        assertEq(pos(bob, ETH).entryPrice, 2_501 * P, "taker got the resting price");
        // taker fee 5 bps of 2501 = 1.2505; maker rebate 2 bps = 0.5002
        assertEq(bobBefore - bal(bob), int128(1_250_500));
        assertEq(bal(alice) - aliceBefore, int128(500_200));
    }

    function test_partial_fill_leaves_remainder_resting() public {
        uint64 id = place(alice, limit(ETH, Types.Side.Sell, 3 * S, 2_501 * P));
        place(bob, market(ETH, Types.Side.Buy, 1 * S));
        Types.Order memory o = ex.getOrder(id);
        assertEq(o.filled, 1 * S);
        assertEq(uint8(o.status), uint8(Types.OrderStatus.Open));
        assertEq(ex.getAccount(alice).openOrders, 1);
    }

    function test_self_trade_is_prevented() public {
        uint64 resting = place(alice, limit(ETH, Types.Side.Sell, 1 * S, 2_501 * P));
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(PerpExchange.SelfTradePrevented.selector, resting));
        ex.placeOrder(limit(ETH, Types.Side.Buy, 1 * S, 2_501 * P));
    }

    function test_market_order_on_empty_book_fills_against_the_backstop() public {
        uint64 id = place(alice, market(ETH, Types.Side.Buy, 2 * S));
        Types.Order memory o = ex.getOrder(id);
        assertEq(uint8(o.status), uint8(Types.OrderStatus.Filled));
        assertEq(pos(alice, ETH).entryPrice, 2_502_50 * 1e6, "index + 10 bps");
        assertEq(pos(address(backstop), ETH).size, -int64(2 * S), "backstop took the other side");
    }

    function test_better_book_price_beats_the_backstop() public {
        place(bob, limit(ETH, Types.Side.Sell, 1 * S, 2_501 * P)); // better than backstop's 2502.50
        place(alice, market(ETH, Types.Side.Buy, 2 * S));
        Types.Position memory p = pos(alice, ETH);
        // 1 at 2501 from bob, 1 at 2502.50 from the backstop -> blended 2501.75
        assertEq(p.size, int64(2 * S));
        assertEq(p.entryPrice, 2_501_75 * 1e6);
        assertEq(pos(bob, ETH).size, -int64(1 * S));
        assertEq(pos(address(backstop), ETH).size, -int64(1 * S));
    }

    function test_backstop_size_per_order_is_capped_and_remainder_cancelled() public {
        // ETH backstop absorbs 100 per fill; a 150 market buy gets 100 and the rest is cancelled
        uint64 id = place(alice, market(ETH, Types.Side.Buy, 150 * S));
        Types.Order memory o = ex.getOrder(id);
        assertEq(o.filled, 100 * S);
        assertEq(uint8(o.status), uint8(Types.OrderStatus.Cancelled));
    }

    function test_ioc_limit_fills_what_crosses_and_cancels_the_rest() public {
        place(bob, limit(ETH, Types.Side.Sell, 1 * S, 2_501 * P));
        Types.OrderParams memory p = limit(ETH, Types.Side.Buy, 3 * S, 2_501 * P);
        p.tif = Types.TimeInForce.IOC;
        uint64 id = place(alice, p);
        Types.Order memory o = ex.getOrder(id);
        assertEq(o.filled, 1 * S, "only bob's ask crossed; backstop asks 2502.50 > 2501");
        assertEq(uint8(o.status), uint8(Types.OrderStatus.Cancelled));
        assertEq(ex.getAccount(alice).openOrders, 0);
    }

    function test_fok_all_or_nothing() public {
        place(bob, limit(ETH, Types.Side.Sell, 1 * S, 2_501 * P));
        Types.OrderParams memory p = limit(ETH, Types.Side.Buy, 2 * S, 2_501 * P);
        p.tif = Types.TimeInForce.FOK;
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(PerpExchange.FillOrKillUnfillable.selector, uint64(1 * S), uint64(2 * S)));
        ex.placeOrder(p);
        assertEq(ex.getOrder(1).filled, 0, "nothing was taken from bob");

        p.size = 1 * S;
        uint64 id = place(alice, p);
        assertEq(uint8(ex.getOrder(id).status), uint8(Types.OrderStatus.Filled));
    }

    function test_fok_counts_the_backstop_when_the_limit_reaches_it() public {
        Types.OrderParams memory p = limit(ETH, Types.Side.Buy, 50 * S, 2_503 * P);
        p.tif = Types.TimeInForce.FOK;
        uint64 id = place(alice, p);
        assertEq(uint8(ex.getOrder(id).status), uint8(Types.OrderStatus.Filled));
        assertEq(pos(alice, ETH).entryPrice, 2_502_50 * 1e6);
    }

    function test_post_only_rests_when_it_does_not_cross() public {
        Types.OrderParams memory p = limit(ETH, Types.Side.Buy, 1 * S, 2_490 * P);
        p.tif = Types.TimeInForce.PostOnly;
        uint64 id = place(alice, p);
        assertEq(uint8(ex.getOrder(id).status), uint8(Types.OrderStatus.Open));
    }

    function test_cancel_removes_from_book_and_frees_the_slot() public {
        uint64 id = place(alice, limit(ETH, Types.Side.Buy, 1 * S, 2_400 * P));
        vm.prank(alice);
        ex.cancelOrder(id);
        assertEq(uint8(ex.getOrder(id).status), uint8(Types.OrderStatus.Cancelled));
        assertEq(ex.getAccount(alice).openOrders, 0);
        (Types.BookLevel[] memory bids,) = ex.getOrderBook(ETH, 5);
        assertEq(bids.length, 1, "only the backstop remains");
        assertEq(bids[0].source, 1);
    }

    function test_cancel_all_scoped_by_market() public {
        place(alice, limit(ETH, Types.Side.Buy, 1 * S, 2_400 * P));
        place(alice, limit(ETH, Types.Side.Buy, 1 * S, 2_401 * P));
        place(alice, limit(BTC, Types.Side.Buy, 1 * S / 100, 59_000 * P));
        vm.prank(alice);
        uint256 n = ex.cancelAll(ETH);
        assertEq(n, 2);
        assertEq(ex.getAccount(alice).openOrders, 1);
        vm.prank(alice);
        n = ex.cancelAll(type(uint16).max);
        assertEq(n, 1);
        assertEq(ex.getAccount(alice).openOrders, 0);
    }

    function test_only_the_owner_can_cancel() public {
        uint64 id = place(alice, limit(ETH, Types.Side.Buy, 1 * S, 2_400 * P));
        vm.prank(bob);
        vm.expectRevert(PerpExchange.NotOrderOwner.selector);
        ex.cancelOrder(id);
    }

    function test_filled_events_name_the_maker_and_zero_for_backstop() public {
        place(bob, limit(ETH, Types.Side.Sell, 1 * S, 2_501 * P));
        vm.recordLogs();
        place(alice, market(ETH, Types.Side.Buy, 2 * S));
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 topic = keccak256("OrderFilled(uint64,address,address,uint16,uint8,uint64,uint64,uint64,uint256,int256)");
        address[] memory makers = new address[](2);
        uint256 seen = 0;
        for (uint256 i = 0; i < logs.length; i++) {
            if (logs[i].topics[0] != topic) continue;
            makers[seen++] = address(uint160(uint256(logs[i].topics[3])));
        }
        assertEq(seen, 2, "two fills: bob's ask, then the backstop");
        assertEq(makers[0], bob);
        assertEq(makers[1], address(0), "backstop fills carry a zero maker");
    }
}
