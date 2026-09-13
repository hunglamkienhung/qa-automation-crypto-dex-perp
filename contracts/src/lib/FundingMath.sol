// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Types } from "./Types.sol";

/// @title Funding arithmetic: premium -> rate -> cumulative index.
/// @notice The exchange samples the premium (mark vs index, in bps) on every
///         fill and on every explicit `updateFunding`. At the end of an
///         interval the average premium becomes the rate, clamped to the cap,
///         and the cumulative index advances by rate * index. A position pays
///         or receives size * (index_now - index_at_snapshot).
library FundingMath {
    /// @notice (mark - index) / index in basis points, signed.
    function premiumBps(uint64 markPrice, uint64 indexPrice) internal pure returns (int128) {
        if (indexPrice == 0) return 0;
        int256 diff = int256(uint256(markPrice)) - int256(uint256(indexPrice));
        return int128((diff * int256(uint256(Types.BPS))) / int256(uint256(indexPrice)));
    }

    /// @notice Average of the accumulated samples, clamped to +-cap.
    function rateBps(int128 accumulatorBps, uint64 samples, uint16 capBps) internal pure returns (int64) {
        if (samples == 0) return 0;
        int256 avg = int256(accumulatorBps) / int256(uint256(samples));
        int256 cap = int256(uint256(capBps));
        if (avg > cap) avg = cap;
        if (avg < -cap) avg = -cap;
        return int64(avg);
    }

    /// @notice Index increment for one interval: rate applied to the index price,
    ///         in price units per base unit (8 decimals), signed.
    function indexDelta(int64 rate, uint64 indexPrice) internal pure returns (int128) {
        return int128((int256(rate) * int256(uint256(indexPrice))) / int256(uint256(Types.BPS)));
    }
}
