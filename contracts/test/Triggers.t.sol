// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Base } from "./Base.t.sol";
import { Types } from "../src/lib/Types.sol";
import { PerpExchange } from "../src/PerpExchange.sol";

/// @dev Stop-market, stop-limit and take-profit orders: parked until a keeper
///      triggers them against the mark or the index, then executed as ordinary
///      market or limit orders.
contract TriggersTest is Base {
    function setUp() public override {
        super.setUp();
        trader(alice, 1_000_000e6);
        trader(bob, 1_000_000e6);
    }

    function stop(Types.Side side, Types.OrderType t, uint64 size, uint64 trigger, uint64 price, Types.TriggerSource src)
        internal
        pure
        returns (Types.OrderParams memory p)
    {
        p.marketId = 1; // ETH
        p.side = side;
        p.orderType = t;
        p.tif = t == Types.OrderType.StopLimit ? Types.TimeInForce.GTC : Types.TimeInForce.IOC;
        p.size = size;
        p.price = price;
        p.triggerPrice = trigger;
        p.triggerSource = src;
    }

    function test_trigger_order_parks_as_pending_and_occupies_a_slot() public {
        uint64 id = place(alice, stop(Types.Side.Buy, Types.OrderType.StopMarket, 1 * S, 2_600 * P, 0, Types.TriggerSource.Index));
        assertEq(uint8(ex.getOrder(id).status), uint8(Types.OrderStatus.Pending));
        assertEq(ex.getAccount(alice).openOrders, 1);
        assertEq(ex.pendingTriggerIds(ETH).length, 1);
        assertEq(pos(alice, ETH).size, 0, "nothing executed yet");
    }

    function test_trigger_before_condition_reverts() public {
        uint64 id = place(alice, stop(Types.Side.Buy, Types.OrderType.StopMarket, 1 * S, 2_600 * P, 0, Types.TriggerSource.Index));
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(PerpExchange.TriggerNotMet.selector, uint64(2_600 * P), ETH_INDEX));
        ex.triggerOrder(id);
    }

    function test_buy_stop_market_triggers_when_index_rises_through_it() public {
        uint64 id = place(alice, stop(Types.Side.Buy, Types.OrderType.StopMarket, 1 * S, 2_600 * P, 0, Types.TriggerSource.Index));
        oracle.setMockPrice(ETH, 2_600 * P);
        vm.prank(keeper);
        ex.triggerOrder(id);
        assertEq(uint8(ex.getOrder(id).status), uint8(Types.OrderStatus.Filled));
        assertEq(pos(alice, ETH).size, int64(1 * S));
        assertEq(ex.pendingTriggerIds(ETH).length, 0);
    }

    function test_sell_stop_triggers_when_price_falls_through_it() public {
        place(alice, market(ETH, Types.Side.Buy, 1 * S));
        Types.OrderParams memory p = stop(Types.Side.Sell, Types.OrderType.StopMarket, 1 * S, 2_400 * P, 0, Types.TriggerSource.Index);
        p.reduceOnly = true;
        uint64 id = place(alice, p);
        oracle.setMockPrice(ETH, 2_399 * P);
        vm.prank(keeper);
        ex.triggerOrder(id);
        assertEq(pos(alice, ETH).size, 0, "stop-loss closed the long");
    }

    function test_take_profit_triggers_the_other_way() public {
        place(alice, market(ETH, Types.Side.Buy, 1 * S));
        Types.OrderParams memory p = stop(Types.Side.Sell, Types.OrderType.TakeProfit, 1 * S, 2_600 * P, 0, Types.TriggerSource.Index);
        p.reduceOnly = true;
        uint64 id = place(alice, p);
        // below the trigger: not yet
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(PerpExchange.TriggerNotMet.selector, uint64(2_600 * P), ETH_INDEX));
        ex.triggerOrder(id);
        oracle.setMockPrice(ETH, 2_600 * P);
        vm.prank(keeper);
        ex.triggerOrder(id);
        assertEq(pos(alice, ETH).size, 0);
    }

    function test_stop_limit_rests_at_its_limit_after_triggering() public {
        // buy stop-limit: trigger 2600, limit 2610 -- after triggering it becomes a limit buy at 2610.
        // The backstop asks 2600 + 10 bps = 2602.60 < 2610, so it fills there.
        uint64 id = place(alice, stop(Types.Side.Buy, Types.OrderType.StopLimit, 1 * S, 2_600 * P, 2_610 * P, Types.TriggerSource.Index));
        oracle.setMockPrice(ETH, 2_600 * P);
        vm.prank(keeper);
        ex.triggerOrder(id);
        assertEq(uint8(ex.getOrder(id).status), uint8(Types.OrderStatus.Filled));
        assertEq(pos(alice, ETH).entryPrice, 2_602_60 * 1e6);
    }

    function test_mark_source_uses_the_mark_not_the_index() public {
        // last fill 2520 -> mark 2520 while index stays 2500
        place(bob, limit(ETH, Types.Side.Sell, 1 * S, 2_520 * P));
        place(alice, limit(ETH, Types.Side.Buy, 101 * S, 2_520 * P));
        assertEq(ex.getMarkPrice(ETH), 2_520 * P);

        uint64 byMark = place(bob, stop(Types.Side.Buy, Types.OrderType.StopMarket, 1 * S, 2_515 * P, 0, Types.TriggerSource.Mark));
        uint64 byIndex = place(bob, stop(Types.Side.Buy, Types.OrderType.StopMarket, 1 * S, 2_515 * P, 0, Types.TriggerSource.Index));
        vm.prank(keeper);
        ex.triggerOrder(byMark); // 2520 >= 2515: fires
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(PerpExchange.TriggerNotMet.selector, uint64(2_515 * P), ETH_INDEX));
        ex.triggerOrder(byIndex); // 2500 < 2515: does not
    }

    function test_reduce_only_trigger_with_no_position_left_is_cancelled_not_executed() public {
        place(alice, market(ETH, Types.Side.Buy, 1 * S));
        Types.OrderParams memory p = stop(Types.Side.Sell, Types.OrderType.StopMarket, 1 * S, 2_400 * P, 0, Types.TriggerSource.Index);
        p.reduceOnly = true;
        uint64 id = place(alice, p);
        place(alice, market(ETH, Types.Side.Sell, 1 * S)); // closed manually first
        oracle.setMockPrice(ETH, 2_399 * P);
        vm.prank(keeper);
        ex.triggerOrder(id);
        assertEq(uint8(ex.getOrder(id).status), uint8(Types.OrderStatus.Cancelled));
        assertEq(pos(alice, ETH).size, 0, "did not open a short");
    }

    function test_cancel_removes_a_pending_trigger() public {
        uint64 id = place(alice, stop(Types.Side.Buy, Types.OrderType.StopMarket, 1 * S, 2_600 * P, 0, Types.TriggerSource.Index));
        vm.prank(alice);
        ex.cancelOrder(id);
        assertEq(ex.pendingTriggerIds(ETH).length, 0);
        assertEq(ex.getAccount(alice).openOrders, 0);
    }

    function test_trigger_respects_pause_and_market_status() public {
        uint64 id = place(alice, stop(Types.Side.Buy, Types.OrderType.StopMarket, 1 * S, 2_600 * P, 0, Types.TriggerSource.Index));
        oracle.setMockPrice(ETH, 2_600 * P);
        ex.setPaused(true);
        vm.prank(keeper);
        vm.expectRevert(PerpExchange.ExchangePaused.selector);
        ex.triggerOrder(id);
        ex.setPaused(false);
        ex.setMarketStatus(ETH, Types.MarketStatus.Paused, 0);
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(PerpExchange.MarketPaused.selector, ETH));
        ex.triggerOrder(id);
    }
}
