// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title Index price per market, with a permissionless mock feed.
/// @notice This is the test-chain oracle: anyone may set a market's index
///         price, on purpose, so a scenario can drive a liquidation or a
///         funding premium without holding an admin key. The admin can lock a
///         market's mock one way, after which only the admin feed moves it --
///         that is the switch a real deployment flips.
///
///         Every read carries a publish time, and `getIndexPrice` reverts
///         `OracleStale` past `maxAge`. `setMockReading` lets a test publish
///         an OLD timestamp so that path can be exercised; `setMockPrice`
///         always stamps `block.timestamp`.
contract OracleRouter {
    struct Reading {
        uint64 price; // 8 decimals
        uint64 publishTime;
    }

    address public admin;
    uint64 public maxAge; // seconds

    mapping(uint16 => Reading) public readings;
    mapping(uint16 => bool) public mockLocked;
    mapping(uint16 => bool) public known;

    event PriceSet(uint16 indexed marketId, uint64 price, uint64 publishTime, address indexed by);
    event MockLocked(uint16 indexed marketId);
    event MaxAgeSet(uint64 maxAge);

    error NotAdmin();
    error MockIsLocked(uint16 marketId);
    error UnknownMarket(uint16 marketId);
    error OracleStale(uint16 marketId, uint64 publishTime, uint64 maxAge);
    error ZeroPrice();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    constructor(address admin_, uint64 maxAge_) {
        admin = admin_;
        maxAge = maxAge_;
    }

    function setMaxAge(uint64 maxAge_) external onlyAdmin {
        maxAge = maxAge_;
        emit MaxAgeSet(maxAge_);
    }

    /// @notice Permissionless while the market's mock is unlocked.
    function setMockPrice(uint16 marketId, uint64 price) external {
        if (mockLocked[marketId]) revert MockIsLocked(marketId);
        if (price == 0) revert ZeroPrice();
        readings[marketId] = Reading(price, uint64(block.timestamp));
        known[marketId] = true;
        emit PriceSet(marketId, price, uint64(block.timestamp), msg.sender);
    }

    /// @notice Permissionless while unlocked; publishes an explicit timestamp
    ///         so staleness can be exercised without warping the chain.
    function setMockReading(uint16 marketId, uint64 price, uint64 publishTime) external {
        if (mockLocked[marketId]) revert MockIsLocked(marketId);
        if (price == 0) revert ZeroPrice();
        readings[marketId] = Reading(price, publishTime);
        known[marketId] = true;
        emit PriceSet(marketId, price, publishTime, msg.sender);
    }

    /// @notice Admin feed: works whether or not the mock is locked.
    function setPrice(uint16 marketId, uint64 price) external onlyAdmin {
        if (price == 0) revert ZeroPrice();
        readings[marketId] = Reading(price, uint64(block.timestamp));
        known[marketId] = true;
        emit PriceSet(marketId, price, uint64(block.timestamp), msg.sender);
    }

    /// @notice One way. There is deliberately no unlock.
    function lockMock(uint16 marketId) external onlyAdmin {
        mockLocked[marketId] = true;
        emit MockLocked(marketId);
    }

    /// @notice The price the exchange uses. Reverts when unknown or stale.
    function getIndexPrice(uint16 marketId) external view returns (uint64 price, uint64 publishTime) {
        if (!known[marketId]) revert UnknownMarket(marketId);
        Reading memory r = readings[marketId];
        if (block.timestamp > r.publishTime && block.timestamp - r.publishTime > maxAge) {
            revert OracleStale(marketId, r.publishTime, maxAge);
        }
        return (r.price, r.publishTime);
    }

    /// @notice Raw reading, no staleness check -- for diagnostics.
    function peek(uint16 marketId) external view returns (uint64 price, uint64 publishTime, bool isStale) {
        Reading memory r = readings[marketId];
        isStale = block.timestamp > r.publishTime && block.timestamp - r.publishTime > maxAge;
        return (r.price, r.publishTime, isStale);
    }
}
