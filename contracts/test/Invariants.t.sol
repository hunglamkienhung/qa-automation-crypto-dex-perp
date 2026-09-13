// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Base } from "./Base.t.sol";
import { Types } from "../src/lib/Types.sol";

/// @dev Properties that must hold after ANY sequence of trades, checked under
///      the fuzzer with a fixed seed: the ledger is conserved, the vault holds
///      what the ledger says, long and short open interest are equal, and the
///      book is never crossed.
contract InvariantsTest is Base {
    address[] traders;

    function setUp() public override {
        super.setUp();
        for (uint160 i = 1; i <= 4; i++) {
            address t = address(0x1000 + i);
            trader(t, 200_000e6);
            traders.push(t);
        }
    }

    function _check() internal view {
        (uint256 held, int128 ledger) = vault.reserves();
        assertEq(int128(int256(held)), ledger, "vault holds the ledger");
        Types.Market memory m = ex.getMarket(ETH);
        assertEq(m.openInterestLong, m.openInterestShort, "OI is two-sided");
        (Types.BookLevel[] memory bids, Types.BookLevel[] memory asks) = ex.getOrderBook(ETH, 3);
        if (bids.length > 0 && asks.length > 0) assertLt(bids[0].price, asks[0].price, "book not crossed");
    }

    /// forge-config: default.fuzz.runs = 64
    function testFuzz_random_orders_keep_the_invariants(uint256 seed) public {
        int128 total0 = ledgerTotal();
        for (uint256 i = 0; i < 12; i++) {
            uint256 r = uint256(keccak256(abi.encode(seed, i)));
            address who = traders[r % traders.length];
            Types.Side side = (r >> 8) % 2 == 0 ? Types.Side.Buy : Types.Side.Sell;
            uint64 size = uint64(1e7 * (1 + (r >> 16) % 30)); // 0.1 .. 3.0 ETH
            bool isMarket = (r >> 24) % 3 == 0;
            // limit prices inside the band, on tick
            uint64 price = uint64(2_400 * P + 1e6 * ((r >> 32) % 200)); // 2400 .. 2599
            Types.OrderParams memory p = isMarket ? market(ETH, side, size) : limit(ETH, side, size, price);
            vm.prank(who);
            try ex.placeOrder(p) { } catch { }
            _check();
        }
        assertEq(ledgerTotal(), total0, "trading never creates or destroys balance");
    }

    /// forge-config: default.fuzz.runs = 64
    function testFuzz_liquidation_conserves_the_ledger(uint64 drop) public {
        drop = uint64(bound(drop, 50 * P, 1_000 * P));
        address v = makeAddr("v");
        trader(v, 60e6);
        place(v, market(ETH, Types.Side.Buy, 1 * S));
        int128 total0 = ledgerTotal();
        oracle.setMockPrice(ETH, ETH_INDEX - drop);
        if (ex.isLiquidatable(v)) {
            vm.prank(keeper);
            ex.liquidate(v, ETH);
        }
        assertEq(ledgerTotal(), total0);
        _check();
    }
}
