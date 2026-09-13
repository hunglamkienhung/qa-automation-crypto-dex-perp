// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Script, console } from "forge-std/Script.sol";
import { Types } from "../src/lib/Types.sol";
import { PerpExchange } from "../src/PerpExchange.sol";
import { CollateralVault, IERC20Minimal } from "../src/CollateralVault.sol";
import { OracleRouter } from "../src/OracleRouter.sol";
import { InsuranceFund, IExchangeForFund } from "../src/InsuranceFund.sol";
import { LiquidityBackstop } from "../src/LiquidityBackstop.sol";
import { MockUSDC } from "../src/MockUSDC.sol";

/// @dev Deploys the whole venue to a local anvil and writes the addresses to
///      deployments/<chainId>.json, which the test stacks and the indexer read.
///
///      Refuses any chain but 31337: the keys anvil prints are public, and
///      nothing here is meant to exist anywhere else.
///
///      Three markets, the same parameters the forge tests use, a funded
///      insurance fund and backstop, and index prices set so trading works
///      from the first block.
contract Deploy is Script {
    uint64 constant P = 1e8;
    uint64 constant S = 1e8;

    function run() external {
        require(block.chainid == 31337, "PerpDEX deploys to anvil (chainId 31337) only");

        address admin = msg.sender;
        address treasury = vm.envOr("TREASURY", admin);

        vm.startBroadcast();

        MockUSDC usdc = new MockUSDC();
        CollateralVault vault = new CollateralVault(IERC20Minimal(address(usdc)), admin);
        OracleRouter oracle = new OracleRouter(admin, 3600);
        PerpExchange ex = new PerpExchange(vault, oracle, admin, treasury);
        vault.setExchange(address(ex));
        InsuranceFund insurance = new InsuranceFund(IERC20Minimal(address(usdc)), IExchangeForFund(address(ex)), address(vault), admin);
        LiquidityBackstop backstop = new LiquidityBackstop(IERC20Minimal(address(usdc)), IExchangeForFund(address(ex)), address(vault), admin);
        ex.setWiring(address(insurance), address(backstop));

        if (!ex.accountExists(treasury)) {
            // the treasury must be an account to receive fees; when it is the
            // deployer this is the deployer's own account
            if (treasury == admin) ex.initializeAccount();
        }

        uint16 btc = ex.addMarket("BTC-PERP", params(1e6, 1e4, 10e6, 50, 200, 100, -2, 5, 500, 100, 50, 5000, 75, 3600, 10, 10 * S));
        uint16 eth = ex.addMarket("ETH-PERP", params(1e6, 1e5, 10e6, 50, 200, 100, -2, 5, 500, 100, 50, 5000, 75, 3600, 10, 100 * S));
        uint16 sol = ex.addMarket("SOL-PERP", params(1e5, 1e6, 10e6, 20, 500, 250, -1, 6, 500, 100, 50, 5000, 75, 3600, 15, 1000 * S));

        oracle.setMockPrice(btc, 60_000 * P);
        oracle.setMockPrice(eth, 2_500 * P);
        oracle.setMockPrice(sol, 100 * P);

        usdc.mint(admin, 11_000_000e6);
        usdc.approve(address(insurance), 1_000_000e6);
        insurance.fund(1_000_000e6);
        usdc.approve(address(backstop), 10_000_000e6);
        backstop.fund(10_000_000e6);

        vm.stopBroadcast();

        string memory json = string.concat(
            '{\n',
            '  "chainId": 31337,\n',
            '  "usdc": "', vm.toString(address(usdc)), '",\n',
            '  "vault": "', vm.toString(address(vault)), '",\n',
            '  "oracle": "', vm.toString(address(oracle)), '",\n',
            '  "exchange": "', vm.toString(address(ex)), '",\n',
            '  "insuranceFund": "', vm.toString(address(insurance)), '",\n',
            '  "backstop": "', vm.toString(address(backstop)), '",\n',
            '  "treasury": "', vm.toString(treasury), '",\n',
            '  "admin": "', vm.toString(admin), '",\n',
            '  "markets": { "BTC-PERP": 0, "ETH-PERP": 1, "SOL-PERP": 2 },\n',
            '  "deployedAtBlock": ', vm.toString(block.number), '\n',
            '}\n'
        );
        vm.writeFile("deployments/31337.json", json);
        console.log("exchange", address(ex));
        console.log("written deployments/31337.json");
    }

    function params(
        uint64 tick, uint64 step, uint64 minNotional, uint16 maxLev, uint16 im, uint16 mm, int16 makerFee, uint16 takerFee,
        uint16 band, uint16 maxBasis, uint16 liqFee, uint16 partialLiq, uint16 fundingCap, uint64 interval, uint16 bsSpread, uint64 bsSize
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
}
