// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title Types shared by every PerpDEX contract.
/// @notice Units, once, here:
///   - collateral and fees: USDC, 6 decimals            (1e6 = $1)
///   - prices:              8 decimals                  (1e8 = $1)
///   - base size:           8 decimals of the base asset (1e8 = 1 ETH)
///   - notional (USDC)    = size * price / 1e10
///   - ratios and fees:     basis points                (10_000 = 100 %)
///   - funding index:       price units per base unit, 8 decimals, signed
///   - time:                block.timestamp seconds; clockMicros() = seconds * 1e6
library Types {
    uint64 internal constant PRICE_SCALE = 1e8;
    uint64 internal constant SIZE_SCALE = 1e8;
    uint256 internal constant NOTIONAL_DIVISOR = 1e10; // size(1e8) * price(1e8) / 1e10 = USDC(1e6)
    uint16 internal constant BPS = 10_000;
    uint8 internal constant MAX_OPEN_ORDERS = 32;

    enum Side {
        Buy,
        Sell
    }

    enum OrderType {
        Market,
        Limit,
        StopMarket,
        StopLimit,
        TakeProfit
    }

    enum TimeInForce {
        GTC,
        IOC,
        FOK,
        PostOnly
    }

    enum TriggerSource {
        Mark,
        Index
    }

    enum OrderStatus {
        Pending, // trigger order waiting for its condition
        Open, // resting on the book
        Filled,
        Cancelled
    }

    enum MarketStatus {
        Active,
        Paused, // no new orders; cancels allowed
        ReduceOnly, // only orders that shrink a position
        Settling // positions close at the settlement price; no orders
    }

    struct OrderParams {
        uint16 marketId;
        Side side;
        OrderType orderType;
        TimeInForce tif;
        uint64 size;
        uint64 price; // limit price; ignored for Market / StopMarket
        uint64 triggerPrice; // Stop* / TakeProfit only
        TriggerSource triggerSource;
        bool reduceOnly;
        uint32 userOrderId; // client-side correlation id, must be unique among the account's open orders
        uint64 maxTs; // 0 = never; else compared to clockMicros()
    }

    struct Order {
        uint64 id;
        address owner;
        uint16 marketId;
        Side side;
        OrderType orderType;
        TimeInForce tif;
        uint64 size;
        uint64 filled;
        uint64 price;
        uint64 triggerPrice;
        TriggerSource triggerSource;
        bool reduceOnly;
        uint32 userOrderId;
        uint64 maxTs;
        uint64 placedAt; // block.timestamp
        uint64 seq; // global placement sequence: time priority inside a price level
        OrderStatus status;
    }

    struct Position {
        int64 size; // + long, - short, base units
        uint64 entryPrice; // volume-weighted average entry
        int128 realizedPnl; // USDC, lifetime
        int128 fundingIndexSnapshot; // market cumulative funding index at last touch
        uint64 lastUpdated;
    }

    struct MarketParams {
        uint64 tickSize;
        uint64 stepSize;
        uint64 minNotional; // USDC
        uint16 maxLeverage; // whole multiples, e.g. 50
        uint16 initialMarginBps;
        uint16 maintenanceMarginBps;
        int16 makerFeeBps; // negative = rebate
        uint16 takerFeeBps;
        uint16 priceBandBps; // limit price must be within index +- band
        uint16 maxBasisBps; // mark = clamp(last fill, index +- maxBasis)
        uint16 liquidationFeeBps; // of closed notional, to the liquidator
        uint16 partialLiquidationBps; // fraction of the position closed per liquidation
        uint16 fundingRateCapBps; // |rate| per interval
        uint64 fundingIntervalSec;
        uint16 backstopSpreadBps;
        uint64 backstopMaxSize; // base units the backstop will absorb in one fill
    }

    struct Market {
        string symbol;
        MarketStatus status;
        MarketParams params;
        uint64 settlementPrice;
        // funding state
        int128 cumulativeFundingIndex;
        uint64 lastFundingTime;
        int64 lastFundingRateBps;
        int128 premiumAccumulatorBps; // sum of premium samples since last funding
        uint64 premiumSamples;
        // price state
        uint64 lastFillPrice;
        // open interest, base units
        uint64 openInterestLong;
        uint64 openInterestShort;
    }

    struct Account {
        bool exists;
        uint8 openOrders;
        uint32 liquidationCount;
        uint64 lastLiquidatedAt;
        uint64 createdAt;
    }

    struct BookLevel {
        uint64 price;
        uint64 size;
        uint8 source; // 0 = resting orders, 1 = liquidity backstop
    }
}
