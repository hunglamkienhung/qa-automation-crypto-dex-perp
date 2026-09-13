// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Types } from "./Types.sol";

/// @title Pure margin arithmetic. No storage, no clock.
library MarginMath {
    /// @notice USDC (6 dp) notional of `size` base units at `price`.
    function notional(uint64 size, uint64 price) internal pure returns (uint256) {
        return (uint256(size) * uint256(price)) / Types.NOTIONAL_DIVISOR;
    }

    function absSize(int64 size) internal pure returns (uint64) {
        return size < 0 ? uint64(-size) : uint64(size);
    }

    /// @notice Unrealised PnL of a position marked at `markPrice`, USDC, signed.
    ///         long:  size * (mark - entry);  short: size * (entry - mark)
    function unrealizedPnl(Types.Position memory p, uint64 markPrice) internal pure returns (int256) {
        if (p.size == 0) return 0;
        int256 diff = int256(uint256(markPrice)) - int256(uint256(p.entryPrice));
        int256 pnl = (int256(p.size) * diff) / int256(Types.NOTIONAL_DIVISOR);
        return pnl;
    }

    /// @notice Funding owed since the snapshot: positive means the position PAYS.
    ///         Longs pay when the index rose (rate > 0); shorts receive, and vice versa.
    function fundingOwed(Types.Position memory p, int128 cumulativeIndex) internal pure returns (int256) {
        if (p.size == 0) return 0;
        int256 delta = int256(cumulativeIndex) - int256(p.fundingIndexSnapshot);
        // size * delta / 1e10 -> USDC. delta is in price units per base unit.
        return (int256(p.size) * delta) / int256(Types.NOTIONAL_DIVISOR);
    }

    function initialMargin(uint256 notional_, uint16 imBps) internal pure returns (uint256) {
        return (notional_ * imBps) / Types.BPS;
    }

    function maintenanceMargin(uint256 notional_, uint16 mmBps) internal pure returns (uint256) {
        return (notional_ * mmBps) / Types.BPS;
    }

    /// @notice Volume-weighted entry after adding `addSize` at `addPrice` to a
    ///         same-direction position. Caller guarantees same direction.
    function blendedEntry(uint64 oldSize, uint64 oldEntry, uint64 addSize, uint64 addPrice) internal pure returns (uint64) {
        uint256 total = uint256(oldSize) + uint256(addSize);
        if (total == 0) return 0;
        return uint64((uint256(oldSize) * oldEntry + uint256(addSize) * addPrice) / total);
    }

    /// @notice Price at which equity would equal maintenance, for a single
    ///         isolated position with `collateral` behind it. Reporting only.
    ///         long:  entry * (1 - (collateral/notional) + mm)  approximately
    function estimatedLiquidationPrice(Types.Position memory p, uint256 collateral, uint16 mmBps)
        internal
        pure
        returns (uint64)
    {
        if (p.size == 0) return 0;
        uint64 size = absSize(p.size);
        uint256 n = notional(size, p.entryPrice);
        if (n == 0) return 0;
        // margin ratio available above maintenance, in bps of notional
        int256 cushionBps = int256((collateral * Types.BPS) / n) - int256(uint256(mmBps));
        int256 move = (int256(uint256(p.entryPrice)) * cushionBps) / int256(uint256(Types.BPS));
        int256 liq = p.size > 0 ? int256(uint256(p.entryPrice)) - move : int256(uint256(p.entryPrice)) + move;
        if (liq < 0) return 0;
        return uint64(uint256(liq));
    }
}
