// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Base } from "./Base.t.sol";
import { Types } from "../src/lib/Types.sol";
import { PerpExchange } from "../src/PerpExchange.sol";

/// @dev Admin surface: two-step handover, pause, market lifecycle including
///      settlement, parameter validation, and the fact that none of it is
///      reachable without the key.
contract AdminTest is Base {
    address newAdmin = makeAddr("newAdmin");

    function setUp() public override {
        super.setUp();
        trader(alice, 1_000_000e6);
        trader(bob, 1_000_000e6);
    }

    function test_every_admin_function_rejects_a_stranger() public {
        vm.startPrank(alice);
        vm.expectRevert(PerpExchange.NotAdmin.selector);
        ex.setPaused(true);
        vm.expectRevert(PerpExchange.NotAdmin.selector);
        ex.setMarketStatus(ETH, Types.MarketStatus.Paused, 0);
        vm.expectRevert(PerpExchange.NotAdmin.selector);
        ex.setFees(ETH, 0, 10);
        vm.expectRevert(PerpExchange.NotAdmin.selector);
        ex.transferAdmin(alice);
        Types.MarketParams memory p = ex.getMarketParams(ETH); // fetched BEFORE expectRevert: it is a call too
        vm.expectRevert(PerpExchange.NotAdmin.selector);
        ex.addMarket("X", p);
        vm.stopPrank();
    }

    function test_two_step_admin_transfer() public {
        ex.transferAdmin(newAdmin);
        assertEq(ex.pendingAdmin(), newAdmin);
        assertEq(ex.admin(), admin, "not transferred until accepted");

        vm.prank(alice);
        vm.expectRevert(PerpExchange.PendingAdminMismatch.selector);
        ex.acceptAdmin();

        vm.prank(newAdmin);
        ex.acceptAdmin();
        assertEq(ex.admin(), newAdmin);
        assertEq(ex.pendingAdmin(), address(0));

        // the old key is now a stranger
        vm.expectRevert(PerpExchange.NotAdmin.selector);
        ex.setPaused(true);
    }

    function test_accept_with_nothing_pending_reverts() public {
        vm.prank(newAdmin);
        vm.expectRevert(PerpExchange.PendingAdminMismatch.selector);
        ex.acceptAdmin();
    }

    function test_pause_blocks_orders_but_not_cancels_or_withdrawals() public {
        uint64 id = place(alice, limit(ETH, Types.Side.Buy, 1 * S, 2_400 * P));
        ex.setPaused(true);
        vm.startPrank(alice);
        vm.expectRevert(PerpExchange.ExchangePaused.selector);
        ex.placeOrder(limit(ETH, Types.Side.Buy, 1 * S, 2_401 * P));
        ex.cancelOrder(id); // allowed
        ex.withdraw(100e6); // allowed
        vm.stopPrank();
        ex.setPaused(false);
        place(alice, limit(ETH, Types.Side.Buy, 1 * S, 2_401 * P));
    }

    function test_market_paused_still_allows_cancel() public {
        uint64 id = place(alice, limit(ETH, Types.Side.Buy, 1 * S, 2_400 * P));
        ex.setMarketStatus(ETH, Types.MarketStatus.Paused, 0);
        vm.prank(alice);
        ex.cancelOrder(id);
        assertEq(ex.getAccount(alice).openOrders, 0);
    }

    function test_settling_closes_positions_at_the_settlement_price() public {
        place(bob, limit(ETH, Types.Side.Sell, 1 * S, 2_500 * P));
        place(alice, market(ETH, Types.Side.Buy, 1 * S));
        ex.setMarketStatus(ETH, Types.MarketStatus.Settling, 2_600 * P);

        vm.prank(keeper);
        ex.settlePosition(alice, ETH);
        assertEq(pos(alice, ETH).size, 0);
        assertEq(pos(alice, ETH).realizedPnl, int128(100e6), "long closed +100 at 2600");
        vm.prank(keeper);
        ex.settlePosition(bob, ETH);
        assertEq(pos(bob, ETH).realizedPnl, -int128(100e6));

        vm.prank(keeper);
        vm.expectRevert(PerpExchange.NoPosition.selector);
        ex.settlePosition(alice, ETH);
    }

    function test_settle_requires_settling_status_and_a_price() public {
        place(alice, market(ETH, Types.Side.Buy, 1 * S));
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(PerpExchange.MarketNotSettling.selector, ETH));
        ex.settlePosition(alice, ETH);
        vm.expectRevert(abi.encodeWithSelector(PerpExchange.BadParams.selector, "settlementPrice"));
        ex.setMarketStatus(ETH, Types.MarketStatus.Settling, 0);
    }

    function test_add_market_validates_parameters() public {
        Types.MarketParams memory p = ex.getMarketParams(ETH);
        p.maintenanceMarginBps = p.initialMarginBps; // must be strictly below
        vm.expectRevert(abi.encodeWithSelector(PerpExchange.BadParams.selector, "maintenanceMarginBps"));
        ex.addMarket("BAD", p);

        p = ex.getMarketParams(ETH);
        p.maxLeverage = 100; // 2 % IM only supports 50x
        vm.expectRevert(PerpExchange.InvalidLeverage.selector);
        ex.addMarket("BAD", p);

        p = ex.getMarketParams(ETH);
        p.takerFeeBps = 501;
        vm.expectRevert(abi.encodeWithSelector(PerpExchange.BadParams.selector, "takerFeeBps"));
        ex.addMarket("BAD", p);

        p = ex.getMarketParams(ETH);
        uint16 id = ex.addMarket("LINK-PERP", p);
        assertEq(id, 3);
        assertEq(ex.marketCount(), 4);
    }

    function test_set_fees_applies_to_the_next_fill() public {
        ex.setFees(ETH, 0, 10);
        int128 before = bal(alice);
        place(alice, market(ETH, Types.Side.Buy, 1 * S)); // 2502.50 notional at 10 bps = 2.5025
        assertEq(before - bal(alice), int128(2_502_500));
    }

    function test_market_cap() public {
        Types.MarketParams memory p = ex.getMarketParams(ETH);
        for (uint16 i = ex.marketCount(); i < ex.MAX_MARKETS(); i++) ex.addMarket("M", p);
        vm.expectRevert(PerpExchange.TooManyMarkets.selector);
        ex.addMarket("ONE-TOO-MANY", p);
    }
}
