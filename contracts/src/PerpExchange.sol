// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Types } from "./lib/Types.sol";
import { OrderBook } from "./lib/OrderBook.sol";
import { MarginMath } from "./lib/MarginMath.sol";
import { FundingMath } from "./lib/FundingMath.sol";
import { CollateralVault } from "./CollateralVault.sol";
import { OracleRouter } from "./OracleRouter.sol";

/// @title PerpDEX clearing house: accounts, orders, matching, positions,
///        funding, liquidation, auto-deleveraging, admin.
/// @notice Cross-margin per account: one USDC balance in the vault backs every
///         position the account holds. Equity = balance + unrealised PnL -
///         funding owed. An account is liquidatable when equity < the sum of
///         maintenance requirements, with no buffer.
///
///         Matching is price-time priority against resting limit orders, with
///         the LiquidityBackstop as a maker of last resort at index +- spread.
///         Realised PnL, fees and funding are ledger transfers inside the
///         vault; the sum of every balance never changes except by deposit and
///         withdrawal, which is the solvency invariant the tests read.
///
///         Gate order in placeOrder is FIXED and documented at the function.
contract PerpExchange {
    using OrderBook for OrderBook.Book;

    // ------------------------------------------------------------ constants
    uint16 public constant MAX_MARKETS = 16;
    bytes32 private constant R_FILL = "fill";
    bytes32 private constant R_FEE = "fee";
    bytes32 private constant R_REBATE = "rebate";
    bytes32 private constant R_FUNDING = "funding";
    bytes32 private constant R_LIQ_FEE = "liqfee";
    bytes32 private constant R_BAD_DEBT = "baddebt";
    bytes32 private constant R_ADL = "adl";

    // ------------------------------------------------------------ wiring
    CollateralVault public immutable vault;
    OracleRouter public immutable oracle;
    address public insuranceFund;
    address public backstop;
    address public treasury;

    address public admin;
    address public pendingAdmin;
    bool public paused;
    uint16 public feeToInsuranceBps; // share of net protocol fee routed to the insurance fund

    // ------------------------------------------------------------ state
    uint16 public marketCount;
    mapping(uint16 => Types.Market) internal markets;
    mapping(uint16 => OrderBook.Book) internal books;

    uint64 public nextOrderId = 1;
    uint64 internal seqCounter;
    mapping(uint64 => Types.Order) internal orders;

    mapping(address => Types.Account) internal accounts;
    mapping(address => mapping(uint16 => Types.Position)) internal positions;
    mapping(address => uint64[]) internal openOrderIds;

    // trigger orders waiting for their condition, per market
    mapping(uint16 => uint64[]) internal pendingTriggers;

    // accounts with a non-zero position, per market (for ADL ranking)
    mapping(uint16 => address[]) internal holders;
    mapping(uint16 => mapping(address => uint256)) internal holderIndex; // index + 1; 0 = absent

    // ------------------------------------------------------------ events
    event AccountInitialized(address indexed account);
    event Deposited(address indexed account, uint256 amount);
    event Withdrawn(address indexed account, uint256 amount);
    event OrderPlaced(
        uint64 indexed orderId,
        address indexed owner,
        uint16 indexed marketId,
        Types.Side side,
        Types.OrderType orderType,
        Types.TimeInForce tif,
        uint64 size,
        uint64 price,
        uint64 triggerPrice,
        bool reduceOnly,
        uint32 userOrderId,
        uint64 maxTs
    );
    event OrderCancelled(uint64 indexed orderId, address indexed owner, uint16 indexed marketId, uint64 unfilled, bytes32 reason);
    event OrderTriggered(uint64 indexed orderId, uint16 indexed marketId, uint64 triggerPrice, uint64 observedPrice);
    event OrderFilled(
        uint64 indexed takerOrderId,
        address indexed taker,
        address indexed maker, // zero = liquidity backstop
        uint16 marketId,
        Types.Side takerSide,
        uint64 size,
        uint64 price,
        uint64 makerOrderId,
        uint256 takerFee,
        int256 makerFee
    );
    event PositionChanged(
        address indexed account, uint16 indexed marketId, int64 sizeBefore, int64 sizeAfter, uint64 entryPrice, int256 realizedPnlDelta, int256 fundingPaid
    );
    event FundingUpdated(uint16 indexed marketId, int64 rateBps, int128 cumulativeIndex, uint64 fundingTime, uint64 samples);
    event Liquidated(
        address indexed account,
        uint16 indexed marketId,
        address indexed liquidator,
        uint64 sizeClosed,
        uint64 price,
        uint256 liquidatorFee,
        uint256 badDebt,
        uint256 insuranceUsed
    );
    event AutoDeleveraged(address indexed account, uint16 indexed marketId, uint64 sizeClosed, uint64 price, uint256 socialised);
    event MarketAdded(uint16 indexed marketId, string symbol);
    event MarketStatusChanged(uint16 indexed marketId, Types.MarketStatus status, uint64 settlementPrice);
    event MarketParamsSet(uint16 indexed marketId);
    event FeesSet(uint16 indexed marketId, int16 makerFeeBps, uint16 takerFeeBps);
    event AdminTransferStarted(address indexed current, address indexed pending);
    event AdminTransferred(address indexed previous, address indexed current);
    event PauseSet(bool paused);
    event Settled(address indexed account, uint16 indexed marketId, uint64 price, int256 realizedPnlDelta);

    // ------------------------------------------------------------ errors
    error NotAdmin();
    error PendingAdminMismatch();
    error ExchangePaused();
    error AccountNotFound();
    error AccountExists();
    error UnknownMarket(uint16 marketId);
    error MarketPaused(uint16 marketId);
    error MarketSettling(uint16 marketId);
    error MarketNotSettling(uint16 marketId);
    error ReduceOnlyViolation();
    error PriceOutOfBand(uint64 price, uint64 lower, uint64 upper);
    error InvalidTick(uint64 price, uint64 tickSize);
    error InvalidStep(uint64 size, uint64 stepSize);
    error BelowMinNotional(uint256 notional, uint64 minNotional);
    error OrderExpired(uint64 maxTs, uint64 clock);
    error DuplicateUserOrderId(uint32 userOrderId);
    error OrderSlotsFull();
    error PostOnlyWouldCross(uint64 price, uint64 bestOpposite);
    error InsufficientCollateral(int256 freeCollateral, uint256 required);
    error SelfTradePrevented(uint64 restingOrderId);
    error FillOrKillUnfillable(uint64 available, uint64 wanted);
    error NotOrderOwner();
    error OrderNotOpen(uint64 orderId);
    error TriggerNotMet(uint64 triggerPrice, uint64 observed);
    error NotLiquidatable(address account);
    error NoPosition();
    error TooManyMarkets();
    error BadParams(string what);
    error ZeroAmount();
    error WiringAlreadySet();
    error InvalidLeverage();

    modifier onlyAdmin() {
        if (msg.sender != admin) revert NotAdmin();
        _;
    }

    constructor(CollateralVault vault_, OracleRouter oracle_, address admin_, address treasury_) {
        vault = vault_;
        oracle = oracle_;
        admin = admin_;
        treasury = treasury_;
        feeToInsuranceBps = 5_000;
    }

    // ============================================================ admin

    function setWiring(address insurance_, address backstop_) external onlyAdmin {
        if (insuranceFund != address(0) || backstop != address(0)) revert WiringAlreadySet();
        insuranceFund = insurance_;
        backstop = backstop_;
    }

    function transferAdmin(address next) external onlyAdmin {
        pendingAdmin = next;
        emit AdminTransferStarted(admin, next);
    }

    /// @notice Two-step handover. Reverts when nothing is pending or the caller is not it.
    function acceptAdmin() external {
        if (pendingAdmin == address(0) || msg.sender != pendingAdmin) revert PendingAdminMismatch();
        emit AdminTransferred(admin, pendingAdmin);
        admin = pendingAdmin;
        pendingAdmin = address(0);
    }

    function setPaused(bool paused_) external onlyAdmin {
        paused = paused_;
        emit PauseSet(paused_);
    }

    function setTreasury(address treasury_) external onlyAdmin {
        treasury = treasury_;
    }

    function setFeeToInsuranceBps(uint16 bps) external onlyAdmin {
        if (bps > Types.BPS) revert BadParams("feeToInsuranceBps");
        feeToInsuranceBps = bps;
    }

    function addMarket(string calldata symbol, Types.MarketParams calldata p) external onlyAdmin returns (uint16 id) {
        if (marketCount >= MAX_MARKETS) revert TooManyMarkets();
        _validateParams(p);
        id = marketCount;
        marketCount += 1;
        Types.Market storage m = markets[id];
        m.symbol = symbol;
        m.status = Types.MarketStatus.Active;
        m.params = p;
        m.lastFundingTime = uint64(block.timestamp - (block.timestamp % p.fundingIntervalSec));
        emit MarketAdded(id, symbol);
    }

    function setMarketParams(uint16 marketId, Types.MarketParams calldata p) external onlyAdmin {
        _requireMarket(marketId);
        _validateParams(p);
        markets[marketId].params = p;
        emit MarketParamsSet(marketId);
    }

    function setFees(uint16 marketId, int16 makerFeeBps, uint16 takerFeeBps) external onlyAdmin {
        _requireMarket(marketId);
        if (takerFeeBps > 500) revert BadParams("takerFeeBps");
        if (makerFeeBps < -int16(takerFeeBps)) revert BadParams("makerFeeBps");
        markets[marketId].params.makerFeeBps = makerFeeBps;
        markets[marketId].params.takerFeeBps = takerFeeBps;
        emit FeesSet(marketId, makerFeeBps, takerFeeBps);
    }

    /// @notice Settling requires a settlement price; every other status ignores it.
    function setMarketStatus(uint16 marketId, Types.MarketStatus status, uint64 settlementPrice) external onlyAdmin {
        _requireMarket(marketId);
        if (status == Types.MarketStatus.Settling && settlementPrice == 0) revert BadParams("settlementPrice");
        markets[marketId].status = status;
        markets[marketId].settlementPrice = status == Types.MarketStatus.Settling ? settlementPrice : 0;
        emit MarketStatusChanged(marketId, status, settlementPrice);
    }

    function _validateParams(Types.MarketParams calldata p) internal pure {
        if (p.tickSize == 0 || p.stepSize == 0) revert BadParams("tick/step");
        if (p.maxLeverage == 0 || p.maxLeverage > 200) revert BadParams("maxLeverage");
        if (p.initialMarginBps == 0 || p.initialMarginBps > Types.BPS) revert BadParams("initialMarginBps");
        if (p.maintenanceMarginBps == 0 || p.maintenanceMarginBps >= p.initialMarginBps) revert BadParams("maintenanceMarginBps");
        // at max leverage the initial margin on the whole position must not exceed the
        // equity behind it: leverage x IM <= 100 %. Anything above advertises leverage
        // the margin rule would refuse on the first order.
        if (uint256(p.initialMarginBps) * p.maxLeverage > Types.BPS) revert InvalidLeverage();
        if (p.takerFeeBps > 500) revert BadParams("takerFeeBps");
        if (p.makerFeeBps < -int16(p.takerFeeBps)) revert BadParams("makerFeeBps");
        if (p.priceBandBps == 0 || p.priceBandBps > Types.BPS) revert BadParams("priceBandBps");
        if (p.maxBasisBps > p.priceBandBps) revert BadParams("maxBasisBps");
        if (p.partialLiquidationBps == 0 || p.partialLiquidationBps > Types.BPS) revert BadParams("partialLiquidationBps");
        if (p.fundingIntervalSec == 0) revert BadParams("fundingIntervalSec");
    }

    // ============================================================ accounts

    function initializeAccount() external {
        if (accounts[msg.sender].exists) revert AccountExists();
        accounts[msg.sender] = Types.Account(true, 0, 0, 0, uint64(block.timestamp));
        emit AccountInitialized(msg.sender);
    }

    function deposit(uint256 amount) external {
        _requireAccount(msg.sender);
        if (amount == 0) revert ZeroAmount();
        vault.depositFor(msg.sender, msg.sender, amount);
        emit Deposited(msg.sender, amount);
    }

    /// @notice Withdraw only what is free: equity minus every initial-margin
    ///         requirement. A negative balance (bad debt) can withdraw nothing.
    function withdraw(uint256 amount) external {
        _requireAccount(msg.sender);
        if (amount == 0) revert ZeroAmount();
        int256 free = freeCollateral(msg.sender);
        if (free < int256(amount)) revert InsufficientCollateral(free, amount);
        vault.withdrawFor(msg.sender, msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    // ============================================================ orders

    /// @notice Gate order, fixed:
    ///   1 ExchangePaused
    ///   2 AccountNotFound
    ///   3 UnknownMarket / MarketPaused / MarketSettling
    ///   4 ReduceOnlyViolation      (market in ReduceOnly, or the reduceOnly flag)
    ///   5 InvalidStep / InvalidTick / PriceOutOfBand / BelowMinNotional
    ///   6 OrderExpired             (maxTs against clockMicros)
    ///   7 DuplicateUserOrderId
    ///   8 OrderSlotsFull
    ///   9 PostOnlyWouldCross
    ///  10 InsufficientCollateral   (initial margin on the exposure being added)
    ///  Then matching. Trigger orders stop after 8 and wait; margin is checked
    ///  when they trigger.
    function placeOrder(Types.OrderParams calldata p) external returns (uint64 orderId) {
        if (paused) revert ExchangePaused();
        _requireAccount(msg.sender);
        Types.Market storage m = _requireMarket(p.marketId);
        if (m.status == Types.MarketStatus.Paused) revert MarketPaused(p.marketId);
        if (m.status == Types.MarketStatus.Settling) revert MarketSettling(p.marketId);

        Types.Position storage pos = positions[msg.sender][p.marketId];
        bool reduces = _reduces(pos, p.side, p.size);
        if (m.status == Types.MarketStatus.ReduceOnly && !reduces) revert ReduceOnlyViolation();
        if (p.reduceOnly && !reduces) revert ReduceOnlyViolation();

        (uint64 index,) = oracle.getIndexPrice(p.marketId);
        _validateOrderShape(m, p, index);

        if (p.maxTs != 0 && p.maxTs < clockMicros()) revert OrderExpired(p.maxTs, clockMicros());
        _requireUniqueUserOrderId(msg.sender, p.userOrderId);
        if (accounts[msg.sender].openOrders >= Types.MAX_OPEN_ORDERS) revert OrderSlotsFull();

        orderId = nextOrderId++;
        seqCounter += 1;
        Types.Order storage o = orders[orderId];
        o.id = orderId;
        o.owner = msg.sender;
        o.marketId = p.marketId;
        o.side = p.side;
        o.orderType = p.orderType;
        o.tif = p.tif;
        o.size = p.size;
        o.price = p.price;
        o.triggerPrice = p.triggerPrice;
        o.triggerSource = p.triggerSource;
        o.reduceOnly = p.reduceOnly;
        o.userOrderId = p.userOrderId;
        o.maxTs = p.maxTs;
        o.placedAt = uint64(block.timestamp);
        o.seq = seqCounter;

        emit OrderPlaced(orderId, msg.sender, p.marketId, p.side, p.orderType, p.tif, p.size, p.price, p.triggerPrice, p.reduceOnly, p.userOrderId, p.maxTs);

        if (_isTrigger(p.orderType)) {
            o.status = Types.OrderStatus.Pending;
            pendingTriggers[p.marketId].push(orderId);
            _trackOpen(msg.sender, orderId);
            return orderId;
        }

        o.status = Types.OrderStatus.Open;
        _trackOpen(msg.sender, orderId);
        _execute(o, m, index, reduces);
    }

    /// @notice Anyone may trigger a pending Stop / TakeProfit order once its
    ///         condition holds against the chosen price source -- the keeper role.
    function triggerOrder(uint64 orderId) external {
        Types.Order storage o = orders[orderId];
        if (o.status != Types.OrderStatus.Pending) revert OrderNotOpen(orderId);
        if (paused) revert ExchangePaused();
        Types.Market storage m = markets[o.marketId];
        if (m.status == Types.MarketStatus.Paused) revert MarketPaused(o.marketId);
        if (m.status == Types.MarketStatus.Settling) revert MarketSettling(o.marketId);

        (uint64 index,) = oracle.getIndexPrice(o.marketId);
        uint64 observed = o.triggerSource == Types.TriggerSource.Index ? index : _markPrice(m, index);
        if (!_triggerMet(o, observed)) revert TriggerNotMet(o.triggerPrice, observed);

        _removePendingTrigger(o.marketId, orderId);
        o.status = Types.OrderStatus.Open;
        emit OrderTriggered(orderId, o.marketId, o.triggerPrice, observed);

        Types.Position storage pos = positions[o.owner][o.marketId];
        bool reduces = _reduces(pos, o.side, o.size);
        if (o.reduceOnly && !reduces) {
            _cancel(o, "reduceonly");
            return;
        }
        // a triggered stop becomes a market or limit order
        _execute(o, m, index, reduces);
    }

    function cancelOrder(uint64 orderId) external {
        Types.Order storage o = orders[orderId];
        if (o.owner != msg.sender) revert NotOrderOwner();
        if (o.status != Types.OrderStatus.Open && o.status != Types.OrderStatus.Pending) revert OrderNotOpen(orderId);
        if (o.status == Types.OrderStatus.Pending) _removePendingTrigger(o.marketId, orderId);
        else books[o.marketId].remove(orders, orderId);
        _cancel(o, "user");
    }

    /// @notice Cancel every open order of the caller (marketId = type(uint16).max for all markets).
    function cancelAll(uint16 marketId) external returns (uint256 cancelled) {
        uint64[] storage ids = openOrderIds[msg.sender];
        uint256 i = 0;
        while (i < ids.length) {
            Types.Order storage o = orders[ids[i]];
            if (marketId == type(uint16).max || o.marketId == marketId) {
                if (o.status == Types.OrderStatus.Pending) _removePendingTrigger(o.marketId, o.id);
                else books[o.marketId].remove(orders, o.id);
                _cancel(o, "cancelall"); // removes ids[i]; do not advance
                cancelled += 1;
            } else {
                i += 1;
            }
        }
    }

    // ------------------------------------------------------------ order internals

    function _validateOrderShape(Types.Market storage m, Types.OrderParams calldata p, uint64 index) internal view {
        Types.MarketParams storage mp = m.params;
        if (p.size == 0 || p.size % mp.stepSize != 0) revert InvalidStep(p.size, mp.stepSize);
        bool hasLimit = p.orderType == Types.OrderType.Limit || p.orderType == Types.OrderType.StopLimit;
        if (hasLimit) {
            if (p.price == 0 || p.price % mp.tickSize != 0) revert InvalidTick(p.price, mp.tickSize);
            uint64 lower = uint64((uint256(index) * (Types.BPS - mp.priceBandBps)) / Types.BPS);
            uint64 upper = uint64((uint256(index) * (Types.BPS + mp.priceBandBps)) / Types.BPS);
            if (p.price < lower || p.price > upper) revert PriceOutOfBand(p.price, lower, upper);
        }
        if (_isTrigger(p.orderType)) {
            if (p.triggerPrice == 0 || p.triggerPrice % mp.tickSize != 0) revert InvalidTick(p.triggerPrice, mp.tickSize);
        }
        uint64 ref = hasLimit ? p.price : index;
        uint256 n = MarginMath.notional(p.size, ref);
        if (n < mp.minNotional) revert BelowMinNotional(n, mp.minNotional);
    }

    function _isTrigger(Types.OrderType t) internal pure returns (bool) {
        return t == Types.OrderType.StopMarket || t == Types.OrderType.StopLimit || t == Types.OrderType.TakeProfit;
    }

    /// @dev Stop orders trigger when the price crosses AWAY from a position
    ///      (buy-stop above, sell-stop below); take-profit the other way.
    function _triggerMet(Types.Order storage o, uint64 observed) internal view returns (bool) {
        bool isStop = o.orderType != Types.OrderType.TakeProfit;
        if (o.side == Types.Side.Buy) return isStop ? observed >= o.triggerPrice : observed <= o.triggerPrice;
        return isStop ? observed <= o.triggerPrice : observed >= o.triggerPrice;
    }

    function _reduces(Types.Position storage pos, Types.Side side, uint64 size) internal view returns (bool) {
        if (pos.size == 0) return false;
        bool opposite = (pos.size > 0 && side == Types.Side.Sell) || (pos.size < 0 && side == Types.Side.Buy);
        return opposite && size <= MarginMath.absSize(pos.size);
    }

    function _requireUniqueUserOrderId(address owner, uint32 userOrderId) internal view {
        if (userOrderId == 0) return;
        uint64[] storage ids = openOrderIds[owner];
        for (uint256 i = 0; i < ids.length; i++) {
            if (orders[ids[i]].userOrderId == userOrderId) revert DuplicateUserOrderId(userOrderId);
        }
    }

    function _trackOpen(address owner, uint64 orderId) internal {
        openOrderIds[owner].push(orderId);
        accounts[owner].openOrders += 1;
    }

    function _untrackOpen(address owner, uint64 orderId) internal {
        uint64[] storage ids = openOrderIds[owner];
        for (uint256 i = 0; i < ids.length; i++) {
            if (ids[i] == orderId) {
                ids[i] = ids[ids.length - 1];
                ids.pop();
                break;
            }
        }
        accounts[owner].openOrders -= 1;
    }

    function _removePendingTrigger(uint16 marketId, uint64 orderId) internal {
        uint64[] storage ids = pendingTriggers[marketId];
        for (uint256 i = 0; i < ids.length; i++) {
            if (ids[i] == orderId) {
                ids[i] = ids[ids.length - 1];
                ids.pop();
                return;
            }
        }
    }

    function _cancel(Types.Order storage o, bytes32 reason) internal {
        o.status = Types.OrderStatus.Cancelled;
        _untrackOpen(o.owner, o.id);
        emit OrderCancelled(o.id, o.owner, o.marketId, o.size - o.filled, reason);
    }

    function _finishFilled(Types.Order storage o) internal {
        o.status = Types.OrderStatus.Filled;
        _untrackOpen(o.owner, o.id);
    }

    // ============================================================ matching

    /// @dev Runs an Open market/limit order: post-only check, FOK check,
    ///      margin check, then sweep the book and the backstop, then rest or cancel.
    function _execute(Types.Order storage o, Types.Market storage m, uint64 index, bool reduces) internal {
        bool isLimit = o.orderType == Types.OrderType.Limit || o.orderType == Types.OrderType.StopLimit;

        if (o.tif == Types.TimeInForce.PostOnly) {
            uint64 bestOpp = _bestOppositePrice(m, o.marketId, o.side, index);
            if (bestOpp != 0 && _crosses(o.side, o.price, bestOpp)) {
                _cancel(o, "postonly");
                revert PostOnlyWouldCross(o.price, bestOpp);
            }
        }

        if (o.tif == Types.TimeInForce.FOK) {
            uint64 available = _crossableSize(m, o, index, isLimit);
            if (available < o.size) {
                _cancel(o, "fok");
                revert FillOrKillUnfillable(available, o.size);
            }
        }

        if (!reduces) {
            uint64 ref = isLimit ? o.price : index;
            uint256 required = MarginMath.initialMargin(MarginMath.notional(o.size, ref), m.params.initialMarginBps);
            int256 free = freeCollateral(o.owner);
            if (free < int256(required)) {
                _cancel(o, "margin");
                revert InsufficientCollateral(free, required);
            }
        }

        _sweep(o, m, index, isLimit);

        if (o.filled == o.size) {
            _finishFilled(o);
            return;
        }
        if (isLimit && (o.tif == Types.TimeInForce.GTC || o.tif == Types.TimeInForce.PostOnly)) {
            books[o.marketId].insert(orders, o.id);
            return;
        }
        // Market orders and IOC remainders do not rest.
        _cancel(o, o.orderType == Types.OrderType.Market || o.orderType == Types.OrderType.StopMarket ? bytes32("unfilled") : bytes32("ioc"));
    }

    function _crosses(Types.Side side, uint64 price, uint64 opposite) internal pure returns (bool) {
        return side == Types.Side.Buy ? price >= opposite : price <= opposite;
    }

    function _bestOppositePrice(Types.Market storage m, uint16 marketId, Types.Side side, uint64 index) internal view returns (uint64) {
        Types.Side opp = side == Types.Side.Buy ? Types.Side.Sell : Types.Side.Buy;
        uint64 bookBest = books[marketId].best(opp);
        uint64 bookPrice = bookBest == 0 ? 0 : orders[bookBest].price;
        uint64 backPrice = _backstopPrice(m, side, index);
        if (backPrice == 0) return bookPrice;
        if (bookPrice == 0) return backPrice;
        // the better of the two for the taker
        if (side == Types.Side.Buy) return bookPrice < backPrice ? bookPrice : backPrice;
        return bookPrice > backPrice ? bookPrice : backPrice;
    }

    /// @dev The backstop quotes only when it is funded. A buyer pays index + spread; a seller receives index - spread.
    function _backstopPrice(Types.Market storage m, Types.Side takerSide, uint64 index) internal view returns (uint64) {
        if (backstop == address(0) || m.params.backstopMaxSize == 0) return 0;
        if (vault.balanceOf(backstop) <= 0) return 0;
        uint16 spread = m.params.backstopSpreadBps;
        if (takerSide == Types.Side.Buy) return uint64((uint256(index) * (Types.BPS + spread)) / Types.BPS);
        return uint64((uint256(index) * (Types.BPS - spread)) / Types.BPS);
    }

    function _crossableSize(Types.Market storage m, Types.Order storage o, uint64 index, bool isLimit) internal view returns (uint64 total) {
        Types.Side opp = o.side == Types.Side.Buy ? Types.Side.Sell : Types.Side.Buy;
        uint64 cur = books[o.marketId].best(opp);
        while (cur != 0 && total < o.size) {
            Types.Order storage r = orders[cur];
            if (isLimit && !_crosses(o.side, o.price, r.price)) break;
            if (r.owner != o.owner) total += r.size - r.filled;
            cur = books[o.marketId].nextOf(opp, cur);
        }
        uint64 bp = _backstopPrice(m, o.side, index);
        if (bp != 0 && (!isLimit || _crosses(o.side, o.price, bp))) total += m.params.backstopMaxSize;
    }

    /// @dev Fill against the better of (best resting order, backstop) until the
    ///      order is done, the price stops crossing, or liquidity runs out.
    function _sweep(Types.Order storage o, Types.Market storage m, uint64 index, bool isLimit) internal {
        uint64 backPrice = _backstopPrice(m, o.side, index);
        uint64 backstopLeft = m.params.backstopMaxSize;

        while (o.filled < o.size) {
            (uint64 restingId, bool useBook) = _pickLiquidity(o, isLimit, backPrice, backstopLeft);
            if (useBook) {
                _fillFromBook(o, m, restingId, index);
            } else if (_backstopCrossable(o, isLimit, backPrice, backstopLeft)) {
                backstopLeft = _fillFromBackstop(o, m, backPrice, backstopLeft, index);
            } else {
                break;
            }
        }
    }

    /// @dev Which side of liquidity is better for the taker right now.
    ///      Returns (restingId, useBook). useBook=false with restingId=0 means "backstop or nothing".
    function _pickLiquidity(Types.Order storage o, bool isLimit, uint64 backPrice, uint64 backstopLeft)
        internal
        view
        returns (uint64 restingId, bool useBook)
    {
        Types.Side opp = o.side == Types.Side.Buy ? Types.Side.Sell : Types.Side.Buy;
        restingId = books[o.marketId].best(opp);
        uint64 restingPrice = restingId == 0 ? 0 : orders[restingId].price;
        bool bookOk = restingId != 0 && (!isLimit || _crosses(o.side, o.price, restingPrice));
        bool backOk = _backstopCrossable(o, isLimit, backPrice, backstopLeft);
        if (!bookOk) return (0, false);
        if (!backOk) return (restingId, true);
        useBook = o.side == Types.Side.Buy ? restingPrice <= backPrice : restingPrice >= backPrice;
        return (restingId, useBook);
    }

    function _backstopCrossable(Types.Order storage o, bool isLimit, uint64 backPrice, uint64 backstopLeft) internal view returns (bool) {
        return backPrice != 0 && backstopLeft > 0 && (!isLimit || _crosses(o.side, o.price, backPrice));
    }

    function _fillFromBook(Types.Order storage o, Types.Market storage m, uint64 restingId, uint64 index) internal {
        Types.Order storage r = orders[restingId];
        if (r.owner == o.owner) revert SelfTradePrevented(restingId);
        uint64 remaining = o.size - o.filled;
        uint64 qty = remaining < r.size - r.filled ? remaining : r.size - r.filled;
        _fill(o, m, r.owner, r.id, qty, r.price, index);
        r.filled += qty;
        if (r.filled == r.size) {
            books[o.marketId].remove(orders, r.id);
            _finishFilled(r);
        }
    }

    function _fillFromBackstop(Types.Order storage o, Types.Market storage m, uint64 backPrice, uint64 backstopLeft, uint64 index)
        internal
        returns (uint64)
    {
        uint64 remaining = o.size - o.filled;
        uint64 qty = remaining < backstopLeft ? remaining : backstopLeft;
        _fill(o, m, backstop, 0, qty, backPrice, index);
        return backstopLeft - qty;
    }

    /// @dev One fill: both positions move, fees flow, funding settles, OI and
    ///      mark update, one OrderFilled event. `makerOrderId == 0` = backstop.
    function _fill(Types.Order storage o, Types.Market storage m, address maker, uint64 makerOrderId, uint64 qty, uint64 price, uint64 index)
        internal
    {
        o.filled += qty;
        uint256 n = MarginMath.notional(qty, price);
        uint256 takerFee = (n * m.params.takerFeeBps) / Types.BPS;
        int256 makerFee = (int256(n) * int256(m.params.makerFeeBps)) / int256(uint256(Types.BPS));
        bool backstopMaker = makerOrderId == 0;

        _applyPositionDelta(o.owner, o.marketId, m, o.side, qty, price);
        _applyPositionDelta(maker, o.marketId, m, o.side == Types.Side.Buy ? Types.Side.Sell : Types.Side.Buy, qty, price);

        // fees: taker pays; maker pays or is rebated; net goes to treasury / insurance
        if (takerFee > 0) vault.transferBetween(o.owner, address(this), int128(int256(takerFee)), R_FEE);
        if (makerFee != 0 && !backstopMaker) vault.transferBetween(maker, address(this), int128(makerFee), makerFee > 0 ? R_FEE : R_REBATE);
        int256 net = int256(takerFee) + (backstopMaker ? int256(0) : makerFee);
        if (net > 0) {
            uint256 toInsurance = (uint256(net) * feeToInsuranceBps) / Types.BPS;
            if (toInsurance > 0 && insuranceFund != address(0)) vault.transferBetween(address(this), insuranceFund, int128(int256(toInsurance)), R_FEE);
            uint256 toTreasury = uint256(net) - toInsurance;
            if (toTreasury > 0) vault.transferBetween(address(this), treasury, int128(int256(toTreasury)), R_FEE);
        }

        m.lastFillPrice = price;
        _samplePremium(m, index);

        emit OrderFilled(o.id, o.owner, backstopMaker ? address(0) : maker, o.marketId, o.side, qty, price, makerOrderId, takerFee, backstopMaker ? int256(0) : makerFee);
    }

    // ============================================================ positions

    /// @dev Settle funding, then apply `qty` at `price` on `side`: grow, shrink, or flip.
    function _applyPositionDelta(address account, uint16 marketId, Types.Market storage m, Types.Side side, uint64 qty, uint64 price) internal {
        Types.Position storage p = positions[account][marketId];
        int64 before = p.size;
        int256 fundingPaid = _settleFunding(account, marketId, m);

        int64 delta = side == Types.Side.Buy ? int64(qty) : -int64(qty);
        int256 realized = 0;

        if (before == 0 || (before > 0) == (delta > 0)) {
            // same direction: blend entry
            p.entryPrice = MarginMath.blendedEntry(MarginMath.absSize(before), p.entryPrice, qty, price);
            p.size = before + delta;
        } else {
            uint64 have = MarginMath.absSize(before);
            uint64 closing = qty < have ? qty : have;
            // long closes at (price - entry), short at (entry - price)
            int256 diff = int256(uint256(price)) - int256(uint256(p.entryPrice));
            realized = (int256(uint256(closing)) * (before > 0 ? diff : -diff)) / int256(Types.NOTIONAL_DIVISOR);
            if (qty <= have) {
                p.size = before + delta;
                if (p.size == 0) p.entryPrice = 0;
            } else {
                // flip: remainder opens a new position at this price
                p.size = before + delta;
                p.entryPrice = price;
            }
            p.realizedPnl += int128(realized);
            if (realized != 0) vault.transferBetween(address(this), account, int128(realized), R_FILL);
        }
        p.lastUpdated = uint64(block.timestamp);

        // open interest
        _adjustOI(m, before, p.size);
        _trackHolder(marketId, account, p.size);

        emit PositionChanged(account, marketId, before, p.size, p.entryPrice, realized, fundingPaid);
    }

    function _adjustOI(Types.Market storage m, int64 before, int64 after_) internal {
        if (before > 0) m.openInterestLong -= uint64(before);
        else if (before < 0) m.openInterestShort -= uint64(-before);
        if (after_ > 0) m.openInterestLong += uint64(after_);
        else if (after_ < 0) m.openInterestShort += uint64(-after_);
    }

    function _trackHolder(uint16 marketId, address account, int64 size) internal {
        uint256 idx = holderIndex[marketId][account];
        if (size != 0 && idx == 0) {
            holders[marketId].push(account);
            holderIndex[marketId][account] = holders[marketId].length;
        } else if (size == 0 && idx != 0) {
            address[] storage list = holders[marketId];
            address last = list[list.length - 1];
            list[idx - 1] = last;
            holderIndex[marketId][last] = idx;
            list.pop();
            holderIndex[marketId][account] = 0;
        }
    }

    /// @dev Pay or receive funding accrued since the snapshot, against the insurance fund.
    function _settleFunding(address account, uint16 marketId, Types.Market storage m) internal returns (int256 paid) {
        Types.Position storage p = positions[account][marketId];
        paid = MarginMath.fundingOwed(p, m.cumulativeFundingIndex);
        p.fundingIndexSnapshot = m.cumulativeFundingIndex;
        if (paid != 0 && insuranceFund != address(0)) {
            vault.transferBetween(account, insuranceFund, int128(paid), R_FUNDING);
        }
    }

    // ============================================================ funding

    function _samplePremium(Types.Market storage m, uint64 index) internal {
        m.premiumAccumulatorBps += FundingMath.premiumBps(_markPrice(m, index), index);
        m.premiumSamples += 1;
    }

    /// @notice Permissionless. Samples the premium; if an interval has elapsed
    ///         since the last funding time, turns the average into the rate,
    ///         advances the cumulative index, and moves the funding time to the
    ///         interval boundary it just crossed.
    function updateFunding(uint16 marketId) external returns (bool advanced) {
        Types.Market storage m = _requireMarket(marketId);
        (uint64 index,) = oracle.getIndexPrice(marketId);
        _samplePremium(m, index);

        uint64 interval = m.params.fundingIntervalSec;
        if (block.timestamp < m.lastFundingTime + interval) return false;

        int64 rate = FundingMath.rateBps(m.premiumAccumulatorBps, m.premiumSamples, m.params.fundingRateCapBps);
        m.cumulativeFundingIndex += FundingMath.indexDelta(rate, index);
        m.lastFundingRateBps = rate;
        m.lastFundingTime = uint64(block.timestamp - (block.timestamp % interval));
        uint64 samples = m.premiumSamples;
        m.premiumAccumulatorBps = 0;
        m.premiumSamples = 0;
        emit FundingUpdated(marketId, rate, m.cumulativeFundingIndex, m.lastFundingTime, samples);
        return true;
    }

    // ============================================================ liquidation

    /// @notice Permissionless. Closes part of the position at the mark price
    ///         against the backstop, pays the liquidator, then covers any bad
    ///         debt from the insurance fund, then by auto-deleveraging.
    ///
    ///         Partial closes exist to keep a solvent account trading. Once the
    ///         balance is below zero the remainder is underwater by definition,
    ///         so it is closed in the same call -- otherwise the counterparties
    ///         deleveraged in this round are gone when the next round needs them.
    function liquidate(address account, uint16 marketId) external {
        if (paused) revert ExchangePaused();
        _requireAccount(account);
        Types.Market storage m = _requireMarket(marketId);
        Types.Position storage p = positions[account][marketId];
        if (p.size == 0) revert NoPosition();
        if (!isLiquidatable(account)) revert NotLiquidatable(account);

        (uint64 index,) = oracle.getIndexPrice(marketId);
        uint64 mark = _markPrice(m, index);
        uint64 have = MarginMath.absSize(p.size);
        uint64 qty = uint64((uint256(have) * m.params.partialLiquidationBps) / Types.BPS);
        qty -= qty % m.params.stepSize;
        // a remainder too small to be a valid order is closed in full
        if (qty == 0 || MarginMath.notional(have - qty, mark) < m.params.minNotional) qty = have;

        Types.Side closeSide = p.size > 0 ? Types.Side.Sell : Types.Side.Buy;
        _closeAgainstBackstop(account, marketId, m, closeSide, qty, mark);

        // bad debt after the partial close: the rest cannot be healthier -- close it too
        if (vault.balanceOf(account) < 0 && p.size != 0) {
            uint64 rest = MarginMath.absSize(p.size);
            _closeAgainstBackstop(account, marketId, m, closeSide, rest, mark);
            qty += rest;
        }

        uint256 fee = (MarginMath.notional(qty, mark) * m.params.liquidationFeeBps) / Types.BPS;
        if (fee > 0) vault.transferBetween(account, msg.sender, int128(int256(fee)), R_LIQ_FEE);

        (uint256 badDebt, uint256 insuranceUsed) = _coverBadDebt(account, marketId, closeSide, mark);

        Types.Account storage a = accounts[account];
        a.liquidationCount += 1;
        a.lastLiquidatedAt = uint64(block.timestamp);
        emit Liquidated(account, marketId, msg.sender, qty, mark, fee, badDebt, insuranceUsed);
    }

    function _closeAgainstBackstop(address account, uint16 marketId, Types.Market storage m, Types.Side closeSide, uint64 qty, uint64 mark) internal {
        _applyPositionDelta(account, marketId, m, closeSide, qty, mark);
        _applyPositionDelta(backstop, marketId, m, closeSide == Types.Side.Buy ? Types.Side.Sell : Types.Side.Buy, qty, mark);
        m.lastFillPrice = mark;
    }

    function _coverBadDebt(address account, uint16 marketId, Types.Side closeSide, uint64 mark) internal returns (uint256 badDebt, uint256 insuranceUsed) {
        int128 bal = vault.balanceOf(account);
        if (bal >= 0) return (0, 0);
        badDebt = uint256(uint128(-bal));

        int128 ins = insuranceFund == address(0) ? int128(0) : vault.balanceOf(insuranceFund);
        if (ins > 0) {
            insuranceUsed = uint256(uint128(ins)) < badDebt ? uint256(uint128(ins)) : badDebt;
            vault.transferBetween(insuranceFund, account, int128(int256(insuranceUsed)), R_BAD_DEBT);
        }
        uint256 remaining = badDebt - insuranceUsed;
        if (remaining > 0) _autoDeleverage(account, marketId, closeSide, mark, remaining);
    }

    /// @dev Close the most profitable, most levered positions on the side that
    ///      PROFITED from the bankrupt one, at the mark, and take the deficit
    ///      out of what that close pays them. Basic ADL: ranked by
    ///      unrealised PnL x notional, full close per holder until covered.
    function _autoDeleverage(address bankrupt, uint16 marketId, Types.Side bankruptCloseSide, uint64 mark, uint256 needed) internal {
        Types.Market storage m = markets[marketId];
        // the bankrupt was long if it closes by selling; counterparties are shorts
        bool targetShorts = bankruptCloseSide == Types.Side.Sell;

        while (needed > 0) {
            address best = address(0);
            int256 bestScore = type(int256).min;
            address[] storage list = holders[marketId];
            for (uint256 i = 0; i < list.length; i++) {
                address h = list[i];
                if (h == bankrupt || h == backstop || h == insuranceFund) continue;
                Types.Position storage hp = positions[h][marketId];
                if ((hp.size < 0) != targetShorts || hp.size == 0) continue;
                int256 pnl = MarginMath.unrealizedPnl(hp, mark);
                if (pnl <= 0) continue;
                int256 score = pnl * int256(MarginMath.notional(MarginMath.absSize(hp.size), mark));
                if (score > bestScore) {
                    bestScore = score;
                    best = h;
                }
            }
            if (best == address(0)) break; // nobody left to deleverage; deficit stays on the books

            Types.Position storage bp = positions[best][marketId];
            uint64 qty = MarginMath.absSize(bp.size);
            int128 balBefore = vault.balanceOf(best);
            Types.Side closeSide = bp.size > 0 ? Types.Side.Sell : Types.Side.Buy;
            _applyPositionDelta(best, marketId, m, closeSide, qty, mark);
            _applyPositionDelta(backstop, marketId, m, closeSide == Types.Side.Buy ? Types.Side.Sell : Types.Side.Buy, qty, mark);
            int128 gained = vault.balanceOf(best) - balBefore;
            uint256 take = gained > 0 ? (uint256(uint128(gained)) < needed ? uint256(uint128(gained)) : needed) : 0;
            if (take > 0) {
                vault.transferBetween(best, bankrupt, int128(int256(take)), R_ADL);
                needed -= take;
            }
            emit AutoDeleveraged(best, marketId, qty, mark, take);
        }
    }

    // ============================================================ settlement

    /// @notice When a market is Settling, anyone may close an account's position at the settlement price.
    function settlePosition(address account, uint16 marketId) external {
        Types.Market storage m = _requireMarket(marketId);
        if (m.status != Types.MarketStatus.Settling) revert MarketNotSettling(marketId);
        Types.Position storage p = positions[account][marketId];
        if (p.size == 0) revert NoPosition();
        int128 before = p.realizedPnl;
        Types.Side closeSide = p.size > 0 ? Types.Side.Sell : Types.Side.Buy;
        uint64 qty = MarginMath.absSize(p.size);
        _applyPositionDelta(account, marketId, m, closeSide, qty, m.settlementPrice);
        emit Settled(account, marketId, m.settlementPrice, int256(p.realizedPnl - before));
    }

    // ============================================================ views

    function clockMicros() public view returns (uint64) {
        return uint64(block.timestamp) * 1_000_000;
    }

    function accountExists(address account) external view returns (bool) {
        return accounts[account].exists;
    }

    function getAccount(address account) external view returns (Types.Account memory) {
        return accounts[account];
    }

    function getPosition(address account, uint16 marketId) external view returns (Types.Position memory) {
        return positions[account][marketId];
    }

    function getOrder(uint64 orderId) external view returns (Types.Order memory) {
        return orders[orderId];
    }

    function getOpenOrders(address account) external view returns (Types.Order[] memory out) {
        uint64[] storage ids = openOrderIds[account];
        out = new Types.Order[](ids.length);
        for (uint256 i = 0; i < ids.length; i++) out[i] = orders[ids[i]];
    }

    function getMarket(uint16 marketId) external view returns (Types.Market memory) {
        return markets[marketId];
    }

    function getMarketParams(uint16 marketId) external view returns (Types.MarketParams memory) {
        return markets[marketId].params;
    }

    /// @notice Best `depth` levels per side. Resting orders are source 0; the
    ///         backstop's standing quote, when funded, is source 1.
    function getOrderBook(uint16 marketId, uint8 depth)
        external
        view
        returns (Types.BookLevel[] memory bids, Types.BookLevel[] memory asks)
    {
        Types.Market storage m = _requireMarket(marketId);
        bids = books[marketId].levels(orders, Types.Side.Buy, depth);
        asks = books[marketId].levels(orders, Types.Side.Sell, depth);
        (uint64 index,) = oracle.getIndexPrice(marketId);
        uint64 backAsk = _backstopPrice(m, Types.Side.Buy, index); // a buyer hits the backstop's ask
        uint64 backBid = _backstopPrice(m, Types.Side.Sell, index);
        if (backAsk != 0) {
            asks = _withBackstop(asks, backAsk, m.params.backstopMaxSize, true);
            bids = _withBackstop(bids, backBid, m.params.backstopMaxSize, false);
        }
    }

    function _withBackstop(Types.BookLevel[] memory lv, uint64 price, uint64 size, bool ascending) internal pure returns (Types.BookLevel[] memory out) {
        out = new Types.BookLevel[](lv.length + 1);
        uint256 j = 0;
        bool placed = false;
        for (uint256 i = 0; i < lv.length; i++) {
            bool before = ascending ? price < lv[i].price : price > lv[i].price;
            if (!placed && before) {
                out[j++] = Types.BookLevel(price, size, 1);
                placed = true;
            }
            out[j++] = lv[i];
        }
        if (!placed) out[j] = Types.BookLevel(price, size, 1);
    }

    function getIndexPrice(uint16 marketId) external view returns (uint64 price, uint64 publishTime) {
        _requireMarket(marketId);
        return oracle.getIndexPrice(marketId);
    }

    /// @notice Mark = last fill price clamped to index +- maxBasis; index when nothing has traded.
    function getMarkPrice(uint16 marketId) external view returns (uint64) {
        Types.Market storage m = _requireMarket(marketId);
        (uint64 index,) = oracle.getIndexPrice(marketId);
        return _markPrice(m, index);
    }

    function _markPrice(Types.Market storage m, uint64 index) internal view returns (uint64) {
        if (m.lastFillPrice == 0) return index;
        uint64 lower = uint64((uint256(index) * (Types.BPS - m.params.maxBasisBps)) / Types.BPS);
        uint64 upper = uint64((uint256(index) * (Types.BPS + m.params.maxBasisBps)) / Types.BPS);
        if (m.lastFillPrice < lower) return lower;
        if (m.lastFillPrice > upper) return upper;
        return m.lastFillPrice;
    }

    function getFundingRate(uint16 marketId) external view returns (int64 lastRateBps, int128 cumulativeIndex, uint64 lastFundingTime, uint64 nextFundingTime) {
        Types.Market storage m = _requireMarket(marketId);
        return (m.lastFundingRateBps, m.cumulativeFundingIndex, m.lastFundingTime, m.lastFundingTime + m.params.fundingIntervalSec);
    }

    function pendingTriggerIds(uint16 marketId) external view returns (uint64[] memory) {
        return pendingTriggers[marketId];
    }

    function holdersOf(uint16 marketId) external view returns (address[] memory) {
        return holders[marketId];
    }

    /// @notice balance + unrealised PnL - funding owed, across every market.
    function equity(address account) public view returns (int256 eq) {
        eq = int256(vault.balanceOf(account));
        for (uint16 i = 0; i < marketCount; i++) {
            Types.Position storage p = positions[account][i];
            if (p.size == 0) continue;
            Types.Market storage m = markets[i];
            (uint64 index,) = oracle.getIndexPrice(i);
            eq += MarginMath.unrealizedPnl(p, _markPrice(m, index));
            eq -= MarginMath.fundingOwed(p, m.cumulativeFundingIndex);
        }
    }

    function marginRequirements(address account) public view returns (uint256 initial, uint256 maintenance) {
        for (uint16 i = 0; i < marketCount; i++) {
            Types.Position storage p = positions[account][i];
            if (p.size == 0) continue;
            Types.Market storage m = markets[i];
            (uint64 index,) = oracle.getIndexPrice(i);
            uint256 n = MarginMath.notional(MarginMath.absSize(p.size), _markPrice(m, index));
            initial += MarginMath.initialMargin(n, m.params.initialMarginBps);
            maintenance += MarginMath.maintenanceMargin(n, m.params.maintenanceMarginBps);
        }
    }

    function freeCollateral(address account) public view returns (int256) {
        (uint256 initial,) = marginRequirements(account);
        return equity(account) - int256(initial);
    }

    /// @notice equity < maintenance, exactly -- no buffer on either side.
    function isLiquidatable(address account) public view returns (bool) {
        (, uint256 maintenance) = marginRequirements(account);
        if (maintenance == 0) return false;
        return equity(account) < int256(maintenance);
    }

    function estimatedLiquidationPrice(address account, uint16 marketId) external view returns (uint64) {
        Types.Position storage p = positions[account][marketId];
        int256 eq = equity(account);
        return MarginMath.estimatedLiquidationPrice(p, eq > 0 ? uint256(eq) : 0, markets[marketId].params.maintenanceMarginBps);
    }

    // ------------------------------------------------------------ guards

    function _requireAccount(address account) internal view {
        if (!accounts[account].exists) revert AccountNotFound();
    }

    function _requireMarket(uint16 marketId) internal view returns (Types.Market storage m) {
        if (marketId >= marketCount) revert UnknownMarket(marketId);
        return markets[marketId];
    }
}
