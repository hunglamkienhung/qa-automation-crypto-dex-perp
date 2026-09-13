# PerpDEX

A perpetual-futures exchange written for this repository so that the test
tiers have something they can **write to**: place, match, liquidate, fund,
pause, hand over admin. The live protocol this domain also reads (GMX) is
read-only from the outside; nothing on a mainnet lets a test set the oracle
or empty an insurance fund. This does.

It is not a product. It is the object under test, deliberately shaped like
the venues QA engineers meet in practice: an order book with a maker of last
resort (the role a vAMM plays elsewhere), cross-margin accounts, funding from
a premium average, liquidation at maintenance with no buffer, an insurance
fund, and auto-deleveraging when that fund is empty.

```
src/
  PerpExchange.sol      accounts · orders · matching · positions · funding · liquidation · ADL · settlement · admin
  CollateralVault.sol   USDC ledger, signed balances, exchange-only movement
  OracleRouter.sol      index per market; permissionless mock until locked; staleness
  InsuranceFund.sol     the account that absorbs bad debt
  LiquidityBackstop.sol the account that quotes index ± spread when the book is empty
  MockUSDC.sol          6-decimal token, permissionless mint (local chain only)
  lib/Types.sol         units, enums, structs -- read this first
  lib/OrderBook.sol     price-time priority as two sorted linked lists
  lib/MarginMath.sol    notional, PnL, funding owed, margins, est. liquidation price
  lib/FundingMath.sol   premium -> clamped rate -> cumulative index
test/                   one suite per module, 97 tests, fuzz with a fixed seed
script/Deploy.s.sol     deploys and writes deployments/31337.json
```

## Units

| | |
|---|---|
| collateral, fees | USDC, 6 decimals |
| prices | 8 decimals (`1e8` = $1) |
| base size | 8 decimals (`1e8` = 1 ETH) |
| notional | `size × price / 1e10` → USDC |
| ratios, fees | basis points |
| funding index | price units per base unit, signed |
| time | `block.timestamp`; `clockMicros()` = seconds × 1e6, what `maxTs` is compared to |

## Gate order in `placeOrder` — fixed, and tested pairwise

```
1 ExchangePaused
2 AccountNotFound
3 UnknownMarket / MarketPaused / MarketSettling
4 ReduceOnlyViolation          market in ReduceOnly, or the reduceOnly flag
5 InvalidStep / InvalidTick / PriceOutOfBand / BelowMinNotional
6 OrderExpired                 maxTs vs clockMicros()
7 DuplicateUserOrderId
8 OrderSlotsFull               32 open orders per account
9 PostOnlyWouldCross           against the best of book and backstop
10 InsufficientCollateral      initial margin on exposure being added
```

Every test in `test/OrderGates.t.sol` sets up a state where two gates would
fire and asserts the earlier one wins. A client can rely on the order.

## Behaviours worth knowing before writing a scenario

- **The backstop is always there.** It quotes `index ± backstopSpreadBps` up
  to `backstopMaxSize` per order, as long as its account has collateral. A
  limit order priced outside that spread fills against it immediately; to rest
  on the book, price inside the spread. Fills against it carry `maker =
  address(0)` in `OrderFilled` and `source = 1` in `getOrderBook`.
- **Mark = last fill, clamped to `index ± maxBasisBps`; index until the first
  fill.** A small index move leaves the mark where it is; a large one drags it
  along the clamp.
- **Liquidation is exact.** `isLiquidatable` is `equity < maintenance`, no
  buffer, and `liquidate` succeeds at the same tick the flag flips
  (`test_threshold_is_exact_no_buffer` walks the index down $0.10 at a time to
  prove it). A partial close that leaves the balance below zero closes the
  rest in the same call, then the insurance fund covers, then ADL closes the
  most profitable opposite positions at the mark.
- **Funding is permissionless.** `updateFunding` samples the premium every
  call and advances the index once per interval; `lastFundingTime` always
  lands on an interval boundary. Positions pay or receive on their next touch.
- **The oracle mock is permissionless until `lockMock`.** `setMockPrice`
  stamps now; `setMockReading` takes an explicit timestamp so staleness can be
  exercised. `getIndexPrice` reverts `OracleStale` past `maxAge`.
- **The ledger is conserved.** Fills, fees, funding, liquidation and ADL only
  move value between vault entries; `totalBalances` changes only on deposit
  and withdrawal, and the vault's token balance always equals it. Both are
  fuzzed in `test/Invariants.t.sol`.

## Running

```bash
forge test                                   # 97 tests, seconds
anvil --code-size-limit 262144               # PerpExchange is ~34 KB; see below
forge script script/Deploy.s.sol:Deploy \
  --rpc-url http://127.0.0.1:8545 --broadcast --disable-code-size-limit \
  --private-key <anvil key #0>
cast call $(jq -r .exchange deployments/31337.json) "getMarkPrice(uint16)(uint64)" 1 --rpc-url http://127.0.0.1:8545
```

The deploy script refuses any chain but 31337. The anvil keys are public and
are the only keys this exchange will ever see.

## On the size

`PerpExchange` is ~34 KB, above EIP-170's 24,576-byte limit. This venue lives
on a local chain started with a raised limit, and `foundry.toml` raises it for
`forge test` the same way. A mainnet deployment would split the clearing
house into facets behind a proxy; that is a deployment concern, and doing it
here would add plumbing without adding anything a test can observe.
