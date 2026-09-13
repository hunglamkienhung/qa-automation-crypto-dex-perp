// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Base } from "./Base.t.sol";
import { Types } from "../src/lib/Types.sol";
import { PerpExchange } from "../src/PerpExchange.sol";

/// @dev Liquidation exactly at maintenance, partial close, liquidator fee, bad
///      debt into the insurance fund, and auto-deleveraging when the fund is dry.
contract LiquidationTest is Base {
    address victim = makeAddr("victim");

    function setUp() public override {
        super.setUp();
        trader(alice, 1_000_000e6);
        trader(bob, 1_000_000e6);
    }

    /// @dev A 1 ETH long opened against the backstop at 2502.50 with $60:
    ///      after the 1.25 fee, equity 58.75. Maintenance is 1 % of notional
    ///      at the mark. Returns the entry price.
    function openThinLong(uint256 collateral) internal returns (uint64 entry) {
        trader(victim, collateral);
        place(victim, market(ETH, Types.Side.Buy, 1 * S));
        entry = pos(victim, ETH).entryPrice;
    }

    function test_not_liquidatable_above_maintenance() public {
        openThinLong(60e6);
        assertFalse(ex.isLiquidatable(victim));
        vm.prank(keeper);
        vm.expectRevert(abi.encodeWithSelector(PerpExchange.NotLiquidatable.selector, victim));
        ex.liquidate(victim, ETH);
    }

    function test_threshold_is_exact_no_buffer() public {
        openThinLong(60e6);
        // find the index where equity == maintenance by walking the index down one tick at a time,
        // and assert isLiquidatable flips at the same tick liquidate() starts to succeed.
        uint64 index = ETH_INDEX;
        bool flipped = false;
        for (uint256 i = 0; i < 1000 && !flipped; i++) {
            index -= 1e7; // $0.10 steps
            oracle.setMockPrice(ETH, index);
            bool liq = ex.isLiquidatable(victim);
            if (!liq) {
                vm.prank(keeper);
                vm.expectRevert(abi.encodeWithSelector(PerpExchange.NotLiquidatable.selector, victim));
                ex.liquidate(victim, ETH);
            } else {
                (, uint256 maint) = ex.marginRequirements(victim);
                assertLt(ex.equity(victim), int256(maint), "flag agrees with the arithmetic");
                vm.prank(keeper);
                ex.liquidate(victim, ETH);
                flipped = true;
            }
        }
        assertTrue(flipped, "the walk reached the threshold");
    }

    function test_partial_close_pays_the_liquidator_and_flags_the_account() public {
        openThinLong(60e6);
        oracle.setMockPrice(ETH, 2_440 * P); // deep enough to be liquidatable
        assertTrue(ex.isLiquidatable(victim));
        int128 keeperBefore = bal(keeper);
        vm.prank(keeper);
        ex.liquidate(victim, ETH);

        Types.Position memory p = pos(victim, ETH);
        assertEq(p.size, int64(5 * S / 10), "half closed (partialLiquidationBps = 5000)");
        assertGt(bal(keeper), keeperBefore, "liquidator was paid");
        Types.Account memory a = ex.getAccount(victim);
        assertEq(a.liquidationCount, 1);
        assertEq(a.lastLiquidatedAt, uint64(block.timestamp));
    }

    function test_remainder_below_min_notional_is_closed_in_full() public {
        // 0.005 ETH at 2500 = $12.50; half would be $6.25 < $10 min -> full close.
        // $0.30 of collateral covers the 2 % initial margin ($0.25) with almost nothing to spare.
        trader(victim, 3e5);
        place(victim, market(ETH, Types.Side.Buy, 5 * 1e5));
        oracle.setMockPrice(ETH, 2_300 * P);
        assertTrue(ex.isLiquidatable(victim));
        vm.prank(keeper);
        ex.liquidate(victim, ETH);
        assertEq(pos(victim, ETH).size, 0);
    }

    function test_bad_debt_is_covered_by_the_insurance_fund() public {
        openThinLong(60e6);
        // crash the index far below what the collateral covers
        oracle.setMockPrice(ETH, 2_000 * P);
        int128 insBefore = bal(address(insurance));
        vm.prank(keeper);
        ex.liquidate(victim, ETH);
        // partial close leaves a position; liquidate again until flat
        while (pos(victim, ETH).size != 0 && ex.isLiquidatable(victim)) {
            vm.prank(keeper);
            ex.liquidate(victim, ETH);
        }
        assertGe(bal(victim), 0, "account was brought back to zero");
        assertLt(bal(address(insurance)), insBefore, "the fund paid for it");
    }

    function test_paused_exchange_blocks_liquidation() public {
        openThinLong(60e6);
        oracle.setMockPrice(ETH, 2_000 * P);
        ex.setPaused(true);
        vm.prank(keeper);
        vm.expectRevert(PerpExchange.ExchangePaused.selector);
        ex.liquidate(victim, ETH);
    }

    function test_no_position_reverts() public {
        vm.prank(keeper);
        vm.expectRevert(PerpExchange.NoPosition.selector);
        ex.liquidate(alice, ETH);
    }

    function test_adl_when_the_insurance_fund_is_empty() public {
        // drain the insurance fund first
        insurance.drain(admin, uint256(uint128(bal(address(insurance)))));
        assertEq(bal(address(insurance)), 0);

        // bob is short 1 ETH against the victim's long, in profit after the crash
        openThinLong(60e6);
        place(bob, limit(ETH, Types.Side.Sell, 1 * S, 2_502 * P)); // rests inside the spread
        place(alice, market(ETH, Types.Side.Buy, 1 * S)); // alice takes bob: bob short, alice long
        oracle.setMockPrice(ETH, 1_500 * P); // catastrophic: victim is deeply underwater

        int64 bobBefore = pos(bob, ETH).size;
        assertEq(bobBefore, -int64(1 * S));

        vm.prank(keeper);
        ex.liquidate(victim, ETH);
        // one call: the partial close left bad debt, so the rest was closed in the same
        // call and the profitable short was deleveraged to cover what the fund could not
        assertEq(pos(victim, ETH).size, 0, "closed in full once bad debt appeared");
        assertEq(pos(bob, ETH).size, 0, "bob's short was closed by ADL");
        assertGe(bal(victim), 0, "victim brought back to zero by the socialised amount");
        assertEq(ex.getAccount(victim).liquidationCount, 1);
    }

    function test_ledger_total_unchanged_by_liquidation_and_adl() public {
        int128 before = ledgerTotal();
        openThinLong(60e6);
        int128 afterDeposit = ledgerTotal();
        assertEq(afterDeposit - before, int128(60e6));
        oracle.setMockPrice(ETH, 2_000 * P);
        vm.prank(keeper);
        ex.liquidate(victim, ETH);
        assertEq(ledgerTotal(), afterDeposit, "liquidation only moves value between entries");
    }
}
