// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Test } from "forge-std/Test.sol";
import { Types } from "../src/lib/Types.sol";
import { PerpExchange } from "../src/PerpExchange.sol";
import { CollateralVault, IERC20Minimal } from "../src/CollateralVault.sol";
import { OracleRouter } from "../src/OracleRouter.sol";
import { InsuranceFund, IExchangeForFund } from "../src/InsuranceFund.sol";
import { LiquidityBackstop } from "../src/LiquidityBackstop.sol";
import { MockUSDC } from "../src/MockUSDC.sol";

/// @dev Everything a module test needs: the whole venue deployed and wired,
///      three markets, a funded insurance fund and backstop, and helpers that
///      say what a scenario means instead of how it is encoded.
abstract contract Base is Test {
    MockUSDC usdc;
    CollateralVault vault;
    OracleRouter oracle;
    PerpExchange ex;
    InsuranceFund insurance;
    LiquidityBackstop backstop;

    address admin = address(this);
    address treasury = makeAddr("treasury");
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address carol = makeAddr("carol");
    address keeper = makeAddr("keeper");

    uint16 BTC;
    uint16 ETH;
    uint16 SOL;

    uint64 constant P = 1e8; // one dollar in price units
    uint64 constant S = 1e8; // one unit of base

    uint64 constant BTC_INDEX = 60_000 * 1e8;
    uint64 constant ETH_INDEX = 2_500 * 1e8;
    uint64 constant SOL_INDEX = 100 * 1e8;

    function setUp() public virtual {
        usdc = new MockUSDC();
        vault = new CollateralVault(IERC20Minimal(address(usdc)), admin);
        oracle = new OracleRouter(admin, 3600);
        ex = new PerpExchange(vault, oracle, admin, treasury);
        vault.setExchange(address(ex));
        insurance = new InsuranceFund(IERC20Minimal(address(usdc)), IExchangeForFund(address(ex)), address(vault), admin);
        backstop = new LiquidityBackstop(IERC20Minimal(address(usdc)), IExchangeForFund(address(ex)), address(vault), admin);
        ex.setWiring(address(insurance), address(backstop));

        // the treasury is an account so fees can land on it
        vm.prank(treasury);
        ex.initializeAccount();

        // anvil-like start: a sane timestamp, not 1
        vm.warp(1_800_000_000);

        BTC = ex.addMarket("BTC-PERP", params(1e6, 1e4, 10e6, 50, 200, 100, -2, 5, 500, 100, 50, 5000, 75, 3600, 10, 10 * S));
        ETH = ex.addMarket("ETH-PERP", params(1e6, 1e5, 10e6, 50, 200, 100, -2, 5, 500, 100, 50, 5000, 75, 3600, 10, 100 * S));
        SOL = ex.addMarket("SOL-PERP", params(1e5, 1e6, 10e6, 20, 500, 250, -1, 6, 500, 100, 50, 5000, 75, 3600, 15, 1000 * S));

        oracle.setMockPrice(BTC, BTC_INDEX);
        oracle.setMockPrice(ETH, ETH_INDEX);
        oracle.setMockPrice(SOL, SOL_INDEX);

        fundInsurance(1_000_000e6);
        fundBackstop(10_000_000e6);
    }

    // ------------------------------------------------------------ builders

    function params(
        uint64 tick,
        uint64 step,
        uint64 minNotional,
        uint16 maxLev,
        uint16 im,
        uint16 mm,
        int16 makerFee,
        uint16 takerFee,
        uint16 band,
        uint16 maxBasis,
        uint16 liqFee,
        uint16 partialLiq,
        uint16 fundingCap,
        uint64 interval,
        uint16 bsSpread,
        uint64 bsSize
    ) internal pure returns (Types.MarketParams memory p) {
        p.tickSize = tick;
        p.stepSize = step;
        p.minNotional = minNotional;
        p.maxLeverage = maxLev;
        p.initialMarginBps = im;
        p.maintenanceMarginBps = mm;
        p.makerFeeBps = makerFee;
        p.takerFeeBps = takerFee;
        p.priceBandBps = band;
        p.maxBasisBps = maxBasis;
        p.liquidationFeeBps = liqFee;
        p.partialLiquidationBps = partialLiq;
        p.fundingRateCapBps = fundingCap;
        p.fundingIntervalSec = interval;
        p.backstopSpreadBps = bsSpread;
        p.backstopMaxSize = bsSize;
    }

    function order(uint16 marketId, Types.Side side, Types.OrderType t, Types.TimeInForce tif, uint64 size, uint64 price)
        internal
        pure
        returns (Types.OrderParams memory o)
    {
        o.marketId = marketId;
        o.side = side;
        o.orderType = t;
        o.tif = tif;
        o.size = size;
        o.price = price;
    }

    function limit(uint16 marketId, Types.Side side, uint64 size, uint64 price) internal pure returns (Types.OrderParams memory) {
        return order(marketId, side, Types.OrderType.Limit, Types.TimeInForce.GTC, size, price);
    }

    function market(uint16 marketId, Types.Side side, uint64 size) internal pure returns (Types.OrderParams memory) {
        return order(marketId, side, Types.OrderType.Market, Types.TimeInForce.IOC, size, 0);
    }

    // ------------------------------------------------------------ actors

    /// @dev A trader with an account and `amount` USDC deposited.
    function trader(address who, uint256 amount) internal {
        usdc.mint(who, amount);
        vm.startPrank(who);
        if (!ex.accountExists(who)) ex.initializeAccount();
        usdc.approve(address(vault), amount);
        ex.deposit(amount);
        vm.stopPrank();
    }

    function fundInsurance(uint256 amount) internal {
        usdc.mint(admin, amount);
        usdc.approve(address(insurance), amount);
        insurance.fund(amount);
    }

    function fundBackstop(uint256 amount) internal {
        usdc.mint(admin, amount);
        usdc.approve(address(backstop), amount);
        backstop.fund(amount);
    }

    function place(address who, Types.OrderParams memory p) internal returns (uint64 id) {
        vm.prank(who);
        id = ex.placeOrder(p);
    }

    /// @dev Move the clock and re-publish every index so the oracle stays fresh.
    ///      A warp past maxAge without this makes every read revert OracleStale --
    ///      which is the oracle doing its job, not the scenario under test.
    function warpFresh(uint256 seconds_) internal {
        vm.warp(block.timestamp + seconds_);
        (uint64 b,,) = oracle.peek(BTC);
        (uint64 e,,) = oracle.peek(ETH);
        (uint64 s,,) = oracle.peek(SOL);
        oracle.setMockPrice(BTC, b);
        oracle.setMockPrice(ETH, e);
        oracle.setMockPrice(SOL, s);
    }

    function bal(address who) internal view returns (int128) {
        return vault.balanceOf(who);
    }

    function pos(address who, uint16 m) internal view returns (Types.Position memory) {
        return ex.getPosition(who, m);
    }

    /// @dev Sum of every ledger balance the venue knows about. Constant except
    ///      for deposits and withdrawals -- the solvency invariant.
    function ledgerTotal() internal view returns (int128) {
        return vault.totalBalances();
    }
}
