// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Base } from "./Base.t.sol";
import { Types } from "../src/lib/Types.sol";
import { PerpExchange } from "../src/PerpExchange.sol";
import { CollateralVault } from "../src/CollateralVault.sol";

contract AccountsTest is Base {
    function test_initialize_once() public {
        vm.startPrank(alice);
        ex.initializeAccount();
        assertTrue(ex.accountExists(alice));
        vm.expectRevert(PerpExchange.AccountExists.selector);
        ex.initializeAccount();
        vm.stopPrank();
    }

    function test_deposit_requires_account() public {
        usdc.mint(alice, 100e6);
        vm.startPrank(alice);
        usdc.approve(address(vault), 100e6);
        vm.expectRevert(PerpExchange.AccountNotFound.selector);
        ex.deposit(100e6);
        vm.stopPrank();
    }

    function test_deposit_and_withdraw_move_tokens_and_ledger() public {
        trader(alice, 1_000e6);
        assertEq(bal(alice), 1_000e6);
        (uint256 held, int128 ledger) = vault.reserves();
        assertEq(int128(int256(held)), ledger, "vault tokens == ledger");

        vm.prank(alice);
        ex.withdraw(400e6);
        assertEq(bal(alice), 600e6);
        assertEq(usdc.balanceOf(alice), 400e6);
        (held, ledger) = vault.reserves();
        assertEq(int128(int256(held)), ledger, "vault tokens == ledger after withdraw");
    }

    function test_withdraw_is_capped_by_free_collateral() public {
        trader(alice, 1_000e6);
        // open 1 ETH at index: notional $2500, IM 2% = $50 locked
        place(alice, market(ETH, Types.Side.Buy, 1 * S));
        int256 free = ex.freeCollateral(alice);
        assertLt(free, 1_000e6, "something is locked");

        vm.startPrank(alice);
        vm.expectRevert(); // InsufficientCollateral(free, 1000e6)
        ex.withdraw(1_000e6);
        ex.withdraw(uint256(free)); // exactly the free amount is allowed
        vm.stopPrank();
        assertLe(ex.freeCollateral(alice), 0);
    }

    function test_zero_deposit_and_withdraw_revert() public {
        trader(alice, 10e6);
        vm.startPrank(alice);
        vm.expectRevert(PerpExchange.ZeroAmount.selector);
        ex.deposit(0);
        vm.expectRevert(PerpExchange.ZeroAmount.selector);
        ex.withdraw(0);
        vm.stopPrank();
    }

    function test_vault_refuses_callers_other_than_exchange() public {
        vm.expectRevert(CollateralVault.NotExchange.selector);
        vault.transferBetween(alice, bob, 1, "x");
        vm.expectRevert(CollateralVault.NotExchange.selector);
        vault.withdrawFor(alice, alice, 1);
    }

    function test_account_getter_reports_creation_and_open_orders() public {
        trader(alice, 10_000e6);
        Types.Account memory a = ex.getAccount(alice);
        assertTrue(a.exists);
        assertEq(a.openOrders, 0);
        assertEq(a.createdAt, uint64(block.timestamp));
        place(alice, limit(ETH, Types.Side.Buy, 1 * S, 2_400 * P));
        assertEq(ex.getAccount(alice).openOrders, 1);
    }
}
