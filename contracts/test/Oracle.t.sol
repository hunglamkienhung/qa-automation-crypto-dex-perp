// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Base } from "./Base.t.sol";
import { OracleRouter } from "../src/OracleRouter.sol";

contract OracleTest is Base {
    function test_mock_is_permissionless_until_locked() public {
        vm.prank(alice); // not admin
        oracle.setMockPrice(ETH, 2_600 * P);
        (uint64 price,) = oracle.getIndexPrice(ETH);
        assertEq(price, 2_600 * P);

        oracle.lockMock(ETH);
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(OracleRouter.MockIsLocked.selector, ETH));
        oracle.setMockPrice(ETH, 2_700 * P);

        // the admin feed still works after the lock
        oracle.setPrice(ETH, 2_700 * P);
        (price,) = oracle.getIndexPrice(ETH);
        assertEq(price, 2_700 * P);
    }

    function test_lock_is_one_way_and_admin_only() public {
        vm.prank(alice);
        vm.expectRevert(OracleRouter.NotAdmin.selector);
        oracle.lockMock(ETH);
        oracle.lockMock(ETH);
        assertTrue(oracle.mockLocked(ETH));
        // no unlock function exists; the only way back is a new deployment
    }

    function test_stale_reading_reverts_and_peek_reports_it() public {
        oracle.setMockReading(ETH, 2_500 * P, uint64(block.timestamp) - 3601);
        vm.expectRevert(abi.encodeWithSelector(OracleRouter.OracleStale.selector, ETH, uint64(block.timestamp) - 3601, 3600));
        oracle.getIndexPrice(ETH);
        (, , bool stale) = oracle.peek(ETH);
        assertTrue(stale);

        // exactly at maxAge is still fresh; one second past is stale
        oracle.setMockReading(ETH, 2_500 * P, uint64(block.timestamp) - 3600);
        (uint64 price,) = oracle.getIndexPrice(ETH);
        assertEq(price, 2_500 * P);
    }

    function test_unknown_market_reverts() public {
        vm.expectRevert(abi.encodeWithSelector(OracleRouter.UnknownMarket.selector, uint16(9)));
        oracle.getIndexPrice(9);
    }

    function test_zero_price_rejected() public {
        vm.expectRevert(OracleRouter.ZeroPrice.selector);
        oracle.setMockPrice(ETH, 0);
    }

    function test_exchange_reads_index_through_router() public {
        (uint64 price,) = ex.getIndexPrice(ETH);
        assertEq(price, ETH_INDEX);
        oracle.setMockPrice(ETH, 2_000 * P);
        (price,) = ex.getIndexPrice(ETH);
        assertEq(price, 2_000 * P);
    }
}
