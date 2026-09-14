# bot — risk gate and operations test cases

732 cases over the trading bot in `../node/be/bot` (risk gate pure; operations against PerpDEX). Generated from `bot.cases.js`; do not edit by hand.

IDs are immutable and shared with `../fixtures/testcases.json`, which the automation binds to.

## 07. BOT — risk gate

### C230 · The risk gate rounds size to the step and price to the tick

**Function** `RiskEngine.plan` · **Tier** BE/BOT · **Priority** High · **Run** Auto

**Purpose.** The contract reverts on a bad tick or step; the gate makes the order legal where it safely can

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. build a risk engine with the ETH spec (tick 0.01, step 0.001, min notional $10)
2. plan a buy of 1.2345 ETH at 2500.567 → expect action send, size floored to 1.234, price floored to 2500.56

**Expected.** Cleared to send, size and price floored

### C231 · The kill switch refuses every order

**Function** `RiskEngine.killSwitch` · **Tier** BE/BOT · **Priority** High · **Run** Auto

**Purpose.** One flag must stop all trading, unconditionally

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. engage the kill switch
2. plan any order → expect refused with reason "kill-switch"

**Expected.** Refused: kill-switch

### C232 · An order above the max order size is refused

**Function** `RiskEngine.maxOrderSize` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A fat-finger single order must not reach the chain

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. max order size 5
2. plan a buy of 6 ETH → expect refused with reason "max-order-size"

**Expected.** Refused: max-order-size

### C233 · An order that would breach the max position is refused, but a reduce-only order is not

**Function** `RiskEngine.maxPositionSize` · **Tier** BE/BOT · **Priority** High · **Run** Auto

**Purpose.** The cap bounds exposure; reducing exposure must always be allowed

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. max position 10, existing position 7 ETH
2. plan a buy of 4 ETH → expect refused with reason "max-position"
3. plan a reduce-only sell of 4 ETH → expect cleared to send

**Expected.** Increase refused; reduce-only cleared

### C234 · A size that rounds to zero at the step is refused

**Function** `RiskEngine.step` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A size below one step would floor to nothing; sending it is a bug

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. ETH step 0.001
2. plan a buy of 0.0005 ETH → expect refused with reason "zero-size"

**Expected.** Refused: zero-size

### C235 · An order below the minimum notional is refused

**Function** `RiskEngine.minNotional` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate catches this before the chain does, saving a reverted transaction

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. ETH min notional $10
2. plan a buy of 0.001 ETH at 2500 ($2.50) → expect refused with reason "below-min-notional"

**Expected.** Refused: below-min-notional

### C236 · A repeated userOrderId is a no-op, not a second order

**Function** `RiskEngine.idempotent` · **Tier** BE/BOT · **Priority** High · **Run** Auto

**Purpose.** A retried request must not place the order twice

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. plan a buy with user order id 1 → expect send
2. plan the same with user order id 1 again → expect action duplicate

**Expected.** Second plan is a duplicate

### C237 · Dry run clears an order but does not send it

**Function** `RiskEngine.dryRun` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A dry run must validate exactly as a live run, and stop short of sending

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. engage dry run
2. plan a valid buy → expect action dry-run

**Expected.** Cleared as a dry run

## 07. BOT — contract gates

### C238 · A post-only order that would cross is surfaced, not retried

**Function** `placeOrder / PostOnlyWouldCross` · **Tier** BE/BOT · **Priority** High · **Run** Auto

**Purpose.** A deterministic revert must be reported once, never looped on

**Precondition.** anvil with a fresh PerpDEX; the bot drives one account

**Steps.**
1. bob rests an ask at 2500
2. the bot places a post-only buy at 2500 → expect it reverts PostOnlyWouldCross
3. expect the bot attempted the place exactly once

**Expected.** PostOnlyWouldCross, one attempt

### C239 · A reduce-only order with no position is surfaced

**Function** `placeOrder / ReduceOnlyViolation` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate allows reduce-only through; the contract must reject it when there is nothing to reduce

**Precondition.** anvil with a fresh PerpDEX; the bot drives one account

**Steps.**
1. the bot places a reduce-only sell with no position → expect it reverts ReduceOnlyViolation

**Expected.** ReduceOnlyViolation

### C240 · A limit outside the band is surfaced

**Function** `placeOrder / PriceOutOfBand` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A price the risk gate does not bound is bounded by the contract

**Precondition.** anvil with a fresh PerpDEX; the bot drives one account

**Steps.**
1. the bot places a buy at 3000 while the index is 2500 (band 5%) → expect it reverts PriceOutOfBand

**Expected.** PriceOutOfBand

### C241 · An order on a paused market is surfaced

**Function** `placeOrder / MarketPaused` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Market status is enforced by the contract, and the bot reports it

**Precondition.** anvil with a fresh PerpDEX; the bot drives one account

**Steps.**
1. the admin sets ETH to Paused
2. the bot places a buy → expect it reverts MarketPaused

**Expected.** MarketPaused

### C242 · An order on a settling market is surfaced

**Function** `placeOrder / MarketSettling` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A settling market takes no new orders

**Precondition.** anvil with a fresh PerpDEX; the bot drives one account

**Steps.**
1. the admin sets ETH to Settling at 2500
2. the bot places a buy → expect it reverts MarketSettling

**Expected.** MarketSettling

### C243 · The bot cannot cross its own resting order

**Function** `placeOrder / SelfTradePrevented` · **Tier** BE/BOT · **Priority** High · **Run** Auto

**Purpose.** An account trading with itself would be a wash; the contract prevents it

**Precondition.** anvil with a fresh PerpDEX; the bot drives one account

**Steps.**
1. the bot rests a buy at 2499
2. the bot places a sell at 2499 → expect it reverts SelfTradePrevented

**Expected.** SelfTradePrevented

## 07. BOT — lifecycle

### C244 · The bot funds and initialises an account

**Function** `fundTrader / initializeAccount` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The bot must be able to stand up its own account from nothing

**Precondition.** anvil with a fresh PerpDEX; the bot drives one account

**Steps.**
1. fund the bot with $50000 → expect accountExists true and vault balance $50000

**Expected.** Account exists, balance $50000

### C245 · The bot places a limit and reads it back as planned

**Function** `place / getOrder` · **Tier** BE/BOT · **Priority** High · **Run** Auto

**Purpose.** A placed order must be observable, with the risk-rounded values

**Precondition.** anvil with a fresh PerpDEX; the bot drives one account

**Steps.**
1. the bot places a limit buy of 1.2345 ETH at 2498.567 → read the order back → expect Open, size 1.234, price 2498.56

**Expected.** Open, rounded size and price

### C246 · The bot cancels its order

**Function** `cancelOrder` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A cancel must move the order to Cancelled and free the slot

**Precondition.** anvil with a fresh PerpDEX; the bot drives one account

**Steps.**
1. the bot rests a buy; cancel it → expect status Cancelled and 0 open orders

**Expected.** Cancelled, 0 open orders

### C247 · Cancel-all clears every resting order

**Function** `cancelAll` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A bot must be able to withdraw fully in one call

**Precondition.** anvil with a fresh PerpDEX; the bot drives one account

**Steps.**
1. the bot rests three buys → expect 3 open orders
2. cancel all → expect 0 open orders

**Expected.** 3 then 0 open orders

### C248 · Flatten returns the bot to a clean slate after a fill

**Function** `flatten` · **Tier** BE/BOT · **Priority** High · **Run** Auto

**Purpose.** The discipline every scenario relies on: end flat

**Precondition.** anvil with a fresh PerpDEX; the bot drives one account

**Steps.**
1. the bot rests an order and takes a position
2. flatten ETH → expect flat (position 0, 0 open orders)

**Expected.** Flat on ETH

### C249 · A dry-run bot plans an order but places nothing on chain

**Function** `place / dryRun` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run must not leave any state behind

**Precondition.** anvil with a fresh PerpDEX; the bot drives one account

**Steps.**
1. a dry-run bot plans a limit buy → expect cleared as a dry run and 0 open orders on chain

**Expected.** Dry run, nothing on chain

## 07. BOT — fills

### C250 · A market buy fills against the backstop

**Function** `place Market / OrderFilled` · **Tier** BE/BOT · **Priority** High · **Run** Auto

**Purpose.** On an empty book the market order must fall to the backstop and fill

**Precondition.** anvil with a fresh PerpDEX; the bot drives one account

**Steps.**
1. the bot buys 1 ETH at market → expect position 1 ETH and the backstop -1 ETH

**Expected.** Bot +1, backstop -1

### C251 · An IOC limit fills what it can and cancels the rest

**Function** `place IOC / partial` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** IOC must take available liquidity and drop the remainder, not rest it

**Precondition.** anvil with a fresh PerpDEX; the bot drives one account

**Steps.**
1. bob rests an ask of 1 ETH at 2500
2. the bot places an IOC buy of 3 ETH at 2500 → expect position 1 ETH

**Expected.** Position 1 ETH

### C252 · A fill sets the position size and a positive entry price

**Function** `getPosition` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A position must record both its size and where it was opened

**Precondition.** anvil with a fresh PerpDEX; the bot drives one account

**Steps.**
1. the bot buys 2 ETH at market → expect size 2 ETH and entry price above 0

**Expected.** Size 2, entry > 0

### C253 · A fill debits free collateral for the margin

**Function** `freeCollateral` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Opening a position must lock initial margin

**Precondition.** anvil with a fresh PerpDEX; the bot drives one account

**Steps.**
1. the bot buys 1 ETH at market → expect free collateral below the vault balance

**Expected.** Free collateral fell

### C254 · A taker fill pays a fee to the treasury

**Function** `fee / treasury` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A taker must pay, and the fee must reach the treasury

**Precondition.** anvil with a fresh PerpDEX; the bot drives one account

**Steps.**
1. note the treasury balance
2. the bot buys 1 ETH at market → expect the treasury balance to increase

**Expected.** Treasury balance increased

### C255 · A fill is mined and observable in the block it landed in

**Function** `receipt` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A fill must be a mined transaction, not a hopeful send

**Precondition.** anvil with a fresh PerpDEX; the bot drives one account

**Steps.**
1. the bot buys 1 ETH at market → expect the receipt status 0x1 with a block number, and position 1 ETH

**Expected.** Mined, position 1 ETH

## 07. BOT — operations

### C256 · The retry policy retries a transient failure but never a revert

**Function** `withRetry` · **Tier** BE/BOT · **Priority** High · **Run** Auto

**Purpose.** Retrying a deterministic revert loops forever and hides the finding; retrying a transient recovers

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. a transient (ChainUnreachable) is retried up to the limit (3 tries)
2. a Reverted is surfaced on the first attempt (1 try)

**Expected.** Transient retried, revert not

### C257 · Three orders advance the account nonce by exactly three

**Function** `eth_getTransactionCount` · **Tier** BE/BOT · **Priority** High · **Run** Auto

**Purpose.** Sequential nonces mean no dropped or duplicated sends

**Precondition.** anvil with a fresh PerpDEX; the bot drives one account

**Steps.**
1. the bot places three limits → expect the account nonce to advance by exactly 3, consecutively

**Expected.** Nonce advanced by 3

### C258 · The bot halts when the exchange is paused

**Function** `placeOrder / ExchangePaused` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A paused exchange must stop the bot, surfaced as ExchangePaused

**Precondition.** anvil with a fresh PerpDEX; the bot drives one account

**Steps.**
1. the admin pauses the exchange
2. the bot places a buy → expect it reverts ExchangePaused

**Expected.** ExchangePaused

### C259 · Cleanup leaves the venue flat, confirmed by re-reading

**Function** `flatten` · **Tier** BE/BOT · **Priority** High · **Run** Auto

**Purpose.** Cleanup must be verified by reading state back, not assumed from receipts

**Precondition.** anvil with a fresh PerpDEX; the bot drives one account

**Steps.**
1. the bot rests an order and takes a position
2. flatten ETH → re-read → expect flat and 0 open orders

**Expected.** Flat, 0 open orders

### C260 · The bot holds and logs no secret

**Function** `log` · **Tier** BE/BOT · **Priority** High · **Run** Auto

**Purpose.** On anvil the node signs; the bot must carry nothing secret to leak

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. inspect the bot record and fields → expect no 64-hex-character secret and no private-key field

**Expected.** No secret anywhere

### C261 · Once the kill switch is thrown the bot sends nothing more

**Function** `killSwitch` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch must stop live sends, not just planning

**Precondition.** anvil with a fresh PerpDEX; the bot drives one account

**Steps.**
1. engage the bot kill switch
2. the bot places a buy → expect refused with reason "kill-switch" and 0 open orders on chain

**Expected.** Refused, nothing on chain

## 07. BOT — lifecycle

### C262 · BTC: the bot places a valid limit sized to clear the minimum notional

**Function** `place (BTC)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** One invariant across markets: a correctly sized limit rests

**Precondition.** anvil with a fresh PerpDEX; the bot drives one account

**Steps.**
1. the bot places a limit buy of 0.01 BTC at 59000 → expect Open and notional >= min notional

**Expected.** Open, clears min notional

### C263 · ETH: the bot places a valid limit sized to clear the minimum notional

**Function** `place (ETH)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** One invariant across markets: a correctly sized limit rests

**Precondition.** anvil with a fresh PerpDEX; the bot drives one account

**Steps.**
1. the bot places a limit buy of 0.1 ETH at 2490 → expect Open and notional >= min notional

**Expected.** Open, clears min notional

### C264 · SOL: the bot places a valid limit sized to clear the minimum notional

**Function** `place (SOL)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** One invariant across markets: a correctly sized limit rests

**Precondition.** anvil with a fresh PerpDEX; the bot drives one account

**Steps.**
1. the bot places a limit buy of 1 SOL at 99 → expect Open and notional >= min notional

**Expected.** Open, clears min notional

## 07. BOT — risk gate

### C304 · An order of 2 ETH over max order size 1 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 1, max position 1000000
2. plan buy 2 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C305 · An order of 3 ETH over max order size 1 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 1, max position 1000000
2. plan buy 3 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C306 · An order of 4 ETH over max order size 1 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 1, max position 1000000
2. plan buy 4 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C307 · An order of 3 ETH over max order size 2 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 2, max position 1000000
2. plan buy 3 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C308 · An order of 4 ETH over max order size 2 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 2, max position 1000000
2. plan buy 4 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C309 · An order of 5 ETH over max order size 2 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 2, max position 1000000
2. plan buy 5 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C310 · An order of 4 ETH over max order size 3 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 3, max position 1000000
2. plan buy 4 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C311 · An order of 5 ETH over max order size 3 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 3, max position 1000000
2. plan buy 5 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C312 · An order of 6 ETH over max order size 3 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 3, max position 1000000
2. plan buy 6 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C313 · An order of 5 ETH over max order size 4 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 4, max position 1000000
2. plan buy 5 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C314 · An order of 6 ETH over max order size 4 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 4, max position 1000000
2. plan buy 6 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C315 · An order of 7 ETH over max order size 4 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 4, max position 1000000
2. plan buy 7 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C316 · An order of 6 ETH over max order size 5 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 5, max position 1000000
2. plan buy 6 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C317 · An order of 7 ETH over max order size 5 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 5, max position 1000000
2. plan buy 7 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C318 · An order of 8 ETH over max order size 5 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 5, max position 1000000
2. plan buy 8 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C319 · An order of 7 ETH over max order size 6 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 6, max position 1000000
2. plan buy 7 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C320 · An order of 8 ETH over max order size 6 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 6, max position 1000000
2. plan buy 8 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C321 · An order of 9 ETH over max order size 6 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 6, max position 1000000
2. plan buy 9 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C322 · An order of 8 ETH over max order size 7 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 7, max position 1000000
2. plan buy 8 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C323 · An order of 9 ETH over max order size 7 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 7, max position 1000000
2. plan buy 9 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C324 · An order of 10 ETH over max order size 7 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 7, max position 1000000
2. plan buy 10 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C325 · An order of 9 ETH over max order size 8 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 8, max position 1000000
2. plan buy 9 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C326 · An order of 10 ETH over max order size 8 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 8, max position 1000000
2. plan buy 10 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C327 · An order of 11 ETH over max order size 8 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 8, max position 1000000
2. plan buy 11 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C328 · An order of 10 ETH over max order size 9 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 9, max position 1000000
2. plan buy 10 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C329 · An order of 11 ETH over max order size 9 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 9, max position 1000000
2. plan buy 11 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C330 · An order of 12 ETH over max order size 9 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 9, max position 1000000
2. plan buy 12 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C331 · An order of 11 ETH over max order size 10 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 10, max position 1000000
2. plan buy 11 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C332 · An order of 12 ETH over max order size 10 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 10, max position 1000000
2. plan buy 12 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C333 · An order of 13 ETH over max order size 10 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 10, max position 1000000
2. plan buy 13 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C334 · An order of 12 ETH over max order size 11 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 11, max position 1000000
2. plan buy 12 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C335 · An order of 13 ETH over max order size 11 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 11, max position 1000000
2. plan buy 13 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C336 · An order of 14 ETH over max order size 11 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 11, max position 1000000
2. plan buy 14 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C337 · An order of 13 ETH over max order size 12 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 12, max position 1000000
2. plan buy 13 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C338 · An order of 14 ETH over max order size 12 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 12, max position 1000000
2. plan buy 14 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C339 · An order of 15 ETH over max order size 12 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 12, max position 1000000
2. plan buy 15 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C340 · An order of 14 ETH over max order size 13 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 13, max position 1000000
2. plan buy 14 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C341 · An order of 15 ETH over max order size 13 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 13, max position 1000000
2. plan buy 15 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C342 · An order of 16 ETH over max order size 13 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 13, max position 1000000
2. plan buy 16 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C343 · An order of 15 ETH over max order size 14 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 14, max position 1000000
2. plan buy 15 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C344 · An order of 16 ETH over max order size 14 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 14, max position 1000000
2. plan buy 16 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C345 · An order of 17 ETH over max order size 14 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 14, max position 1000000
2. plan buy 17 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C346 · An order of 16 ETH over max order size 15 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 15, max position 1000000
2. plan buy 16 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C347 · An order of 17 ETH over max order size 15 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 15, max position 1000000
2. plan buy 17 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C348 · An order of 18 ETH over max order size 15 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 15, max position 1000000
2. plan buy 18 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C349 · An order of 17 ETH over max order size 16 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 16, max position 1000000
2. plan buy 17 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C350 · An order of 18 ETH over max order size 16 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 16, max position 1000000
2. plan buy 18 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C351 · An order of 19 ETH over max order size 16 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 16, max position 1000000
2. plan buy 19 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C352 · An order of 18 ETH over max order size 17 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 17, max position 1000000
2. plan buy 18 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C353 · An order of 19 ETH over max order size 17 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 17, max position 1000000
2. plan buy 19 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C354 · An order of 20 ETH over max order size 17 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 17, max position 1000000
2. plan buy 20 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C355 · An order of 19 ETH over max order size 18 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 18, max position 1000000
2. plan buy 19 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C356 · An order of 20 ETH over max order size 18 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 18, max position 1000000
2. plan buy 20 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C357 · An order of 21 ETH over max order size 18 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 18, max position 1000000
2. plan buy 21 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C358 · An order of 20 ETH over max order size 19 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 19, max position 1000000
2. plan buy 20 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C359 · An order of 21 ETH over max order size 19 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 19, max position 1000000
2. plan buy 21 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C360 · An order of 22 ETH over max order size 19 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 19, max position 1000000
2. plan buy 22 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C361 · An order of 21 ETH over max order size 20 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 20, max position 1000000
2. plan buy 21 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C362 · An order of 22 ETH over max order size 20 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 20, max position 1000000
2. plan buy 22 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C363 · An order of 23 ETH over max order size 20 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 20, max position 1000000
2. plan buy 23 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C364 · An order of 22 ETH over max order size 21 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 21, max position 1000000
2. plan buy 22 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C365 · An order of 23 ETH over max order size 21 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 21, max position 1000000
2. plan buy 23 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C366 · An order of 24 ETH over max order size 21 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 21, max position 1000000
2. plan buy 24 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C367 · An order of 23 ETH over max order size 22 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 22, max position 1000000
2. plan buy 23 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C368 · An order of 24 ETH over max order size 22 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 22, max position 1000000
2. plan buy 24 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C369 · An order of 25 ETH over max order size 22 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 22, max position 1000000
2. plan buy 25 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C370 · An order of 24 ETH over max order size 23 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 23, max position 1000000
2. plan buy 24 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C371 · An order of 25 ETH over max order size 23 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 23, max position 1000000
2. plan buy 25 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C372 · An order of 26 ETH over max order size 23 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 23, max position 1000000
2. plan buy 26 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C373 · An order of 25 ETH over max order size 24 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 24, max position 1000000
2. plan buy 25 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C374 · An order of 26 ETH over max order size 24 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 24, max position 1000000
2. plan buy 26 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C375 · An order of 27 ETH over max order size 24 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 24, max position 1000000
2. plan buy 27 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C376 · An order of 26 ETH over max order size 25 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 25, max position 1000000
2. plan buy 26 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C377 · An order of 27 ETH over max order size 25 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 25, max position 1000000
2. plan buy 27 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C378 · An order of 28 ETH over max order size 25 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 25, max position 1000000
2. plan buy 28 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C379 · An order of 27 ETH over max order size 26 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 26, max position 1000000
2. plan buy 27 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C380 · An order of 28 ETH over max order size 26 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 26, max position 1000000
2. plan buy 28 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C381 · An order of 29 ETH over max order size 26 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 26, max position 1000000
2. plan buy 29 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C382 · An order of 28 ETH over max order size 27 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 27, max position 1000000
2. plan buy 28 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C383 · An order of 29 ETH over max order size 27 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 27, max position 1000000
2. plan buy 29 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C384 · An order of 30 ETH over max order size 27 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 27, max position 1000000
2. plan buy 30 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C385 · An order of 29 ETH over max order size 28 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 28, max position 1000000
2. plan buy 29 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C386 · An order of 30 ETH over max order size 28 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 28, max position 1000000
2. plan buy 30 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C387 · An order of 31 ETH over max order size 28 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 28, max position 1000000
2. plan buy 31 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C388 · An order of 30 ETH over max order size 29 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 29, max position 1000000
2. plan buy 30 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C389 · An order of 31 ETH over max order size 29 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 29, max position 1000000
2. plan buy 31 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C390 · An order of 32 ETH over max order size 29 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 29, max position 1000000
2. plan buy 32 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C391 · An order of 31 ETH over max order size 30 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 30, max position 1000000
2. plan buy 31 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C392 · An order of 32 ETH over max order size 30 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 30, max position 1000000
2. plan buy 32 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C393 · An order of 33 ETH over max order size 30 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 30, max position 1000000
2. plan buy 33 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C394 · An order of 32 ETH over max order size 31 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 31, max position 1000000
2. plan buy 32 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C395 · An order of 33 ETH over max order size 31 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 31, max position 1000000
2. plan buy 33 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C396 · An order of 34 ETH over max order size 31 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 31, max position 1000000
2. plan buy 34 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C397 · An order of 33 ETH over max order size 32 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 32, max position 1000000
2. plan buy 33 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C398 · An order of 34 ETH over max order size 32 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 32, max position 1000000
2. plan buy 34 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C399 · An order of 35 ETH over max order size 32 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 32, max position 1000000
2. plan buy 35 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C400 · An order of 34 ETH over max order size 33 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 33, max position 1000000
2. plan buy 34 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C401 · An order of 35 ETH over max order size 33 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 33, max position 1000000
2. plan buy 35 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C402 · An order of 36 ETH over max order size 33 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 33, max position 1000000
2. plan buy 36 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C403 · An order of 35 ETH over max order size 34 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 34, max position 1000000
2. plan buy 35 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C404 · An order of 36 ETH over max order size 34 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 34, max position 1000000
2. plan buy 36 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C405 · An order of 37 ETH over max order size 34 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 34, max position 1000000
2. plan buy 37 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C406 · An order of 36 ETH over max order size 35 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 35, max position 1000000
2. plan buy 36 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C407 · An order of 37 ETH over max order size 35 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 35, max position 1000000
2. plan buy 37 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C408 · An order of 38 ETH over max order size 35 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 35, max position 1000000
2. plan buy 38 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C409 · An order of 37 ETH over max order size 36 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 36, max position 1000000
2. plan buy 37 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C410 · An order of 38 ETH over max order size 36 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 36, max position 1000000
2. plan buy 38 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C411 · An order of 39 ETH over max order size 36 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 36, max position 1000000
2. plan buy 39 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C412 · An order of 38 ETH over max order size 37 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 37, max position 1000000
2. plan buy 38 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C413 · An order of 39 ETH over max order size 37 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 37, max position 1000000
2. plan buy 39 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C414 · An order of 40 ETH over max order size 37 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 37, max position 1000000
2. plan buy 40 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C415 · An order of 39 ETH over max order size 38 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 38, max position 1000000
2. plan buy 39 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C416 · An order of 40 ETH over max order size 38 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 38, max position 1000000
2. plan buy 40 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C417 · An order of 41 ETH over max order size 38 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 38, max position 1000000
2. plan buy 41 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C418 · An order of 40 ETH over max order size 39 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 39, max position 1000000
2. plan buy 40 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C419 · An order of 41 ETH over max order size 39 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 39, max position 1000000
2. plan buy 41 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C420 · An order of 42 ETH over max order size 39 is refused

**Function** `RiskEngine.plan (max-order-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses an order larger than the max order size

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max order size 39, max position 1000000
2. plan buy 42 ETH at 2500 -> refused max-order-size

**Expected.** Refused: max-order-size

### C421 · With the kill switch engaged a buy of 1 ETH at 2500.00 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 1 ETH at 2500.00 -> refused kill-switch

**Expected.** Refused: kill-switch

### C422 · With the kill switch engaged a buy of 1 ETH at 2500.10 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 1 ETH at 2500.10 -> refused kill-switch

**Expected.** Refused: kill-switch

### C423 · With the kill switch engaged a buy of 1 ETH at 2500.20 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 1 ETH at 2500.20 -> refused kill-switch

**Expected.** Refused: kill-switch

### C424 · With the kill switch engaged a buy of 1 ETH at 2500.30 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 1 ETH at 2500.30 -> refused kill-switch

**Expected.** Refused: kill-switch

### C425 · With the kill switch engaged a buy of 1 ETH at 2500.40 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 1 ETH at 2500.40 -> refused kill-switch

**Expected.** Refused: kill-switch

### C426 · With the kill switch engaged a buy of 1 ETH at 2500.50 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 1 ETH at 2500.50 -> refused kill-switch

**Expected.** Refused: kill-switch

### C427 · With the kill switch engaged a buy of 1 ETH at 2500.60 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 1 ETH at 2500.60 -> refused kill-switch

**Expected.** Refused: kill-switch

### C428 · With the kill switch engaged a buy of 1 ETH at 2500.70 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 1 ETH at 2500.70 -> refused kill-switch

**Expected.** Refused: kill-switch

### C429 · With the kill switch engaged a buy of 1 ETH at 2500.80 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 1 ETH at 2500.80 -> refused kill-switch

**Expected.** Refused: kill-switch

### C430 · With the kill switch engaged a buy of 1 ETH at 2500.90 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 1 ETH at 2500.90 -> refused kill-switch

**Expected.** Refused: kill-switch

### C431 · With the kill switch engaged a buy of 2 ETH at 2500.00 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 2 ETH at 2500.00 -> refused kill-switch

**Expected.** Refused: kill-switch

### C432 · With the kill switch engaged a buy of 2 ETH at 2500.10 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 2 ETH at 2500.10 -> refused kill-switch

**Expected.** Refused: kill-switch

### C433 · With the kill switch engaged a buy of 2 ETH at 2500.20 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 2 ETH at 2500.20 -> refused kill-switch

**Expected.** Refused: kill-switch

### C434 · With the kill switch engaged a buy of 2 ETH at 2500.30 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 2 ETH at 2500.30 -> refused kill-switch

**Expected.** Refused: kill-switch

### C435 · With the kill switch engaged a buy of 2 ETH at 2500.40 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 2 ETH at 2500.40 -> refused kill-switch

**Expected.** Refused: kill-switch

### C436 · With the kill switch engaged a buy of 2 ETH at 2500.50 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 2 ETH at 2500.50 -> refused kill-switch

**Expected.** Refused: kill-switch

### C437 · With the kill switch engaged a buy of 2 ETH at 2500.60 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 2 ETH at 2500.60 -> refused kill-switch

**Expected.** Refused: kill-switch

### C438 · With the kill switch engaged a buy of 2 ETH at 2500.70 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 2 ETH at 2500.70 -> refused kill-switch

**Expected.** Refused: kill-switch

### C439 · With the kill switch engaged a buy of 2 ETH at 2500.80 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 2 ETH at 2500.80 -> refused kill-switch

**Expected.** Refused: kill-switch

### C440 · With the kill switch engaged a buy of 2 ETH at 2500.90 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 2 ETH at 2500.90 -> refused kill-switch

**Expected.** Refused: kill-switch

### C441 · With the kill switch engaged a buy of 3 ETH at 2500.00 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 3 ETH at 2500.00 -> refused kill-switch

**Expected.** Refused: kill-switch

### C442 · With the kill switch engaged a buy of 3 ETH at 2500.10 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 3 ETH at 2500.10 -> refused kill-switch

**Expected.** Refused: kill-switch

### C443 · With the kill switch engaged a buy of 3 ETH at 2500.20 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 3 ETH at 2500.20 -> refused kill-switch

**Expected.** Refused: kill-switch

### C444 · With the kill switch engaged a buy of 3 ETH at 2500.30 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 3 ETH at 2500.30 -> refused kill-switch

**Expected.** Refused: kill-switch

### C445 · With the kill switch engaged a buy of 3 ETH at 2500.40 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 3 ETH at 2500.40 -> refused kill-switch

**Expected.** Refused: kill-switch

### C446 · With the kill switch engaged a buy of 3 ETH at 2500.50 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 3 ETH at 2500.50 -> refused kill-switch

**Expected.** Refused: kill-switch

### C447 · With the kill switch engaged a buy of 3 ETH at 2500.60 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 3 ETH at 2500.60 -> refused kill-switch

**Expected.** Refused: kill-switch

### C448 · With the kill switch engaged a buy of 3 ETH at 2500.70 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 3 ETH at 2500.70 -> refused kill-switch

**Expected.** Refused: kill-switch

### C449 · With the kill switch engaged a buy of 3 ETH at 2500.80 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 3 ETH at 2500.80 -> refused kill-switch

**Expected.** Refused: kill-switch

### C450 · With the kill switch engaged a buy of 3 ETH at 2500.90 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 3 ETH at 2500.90 -> refused kill-switch

**Expected.** Refused: kill-switch

### C451 · With the kill switch engaged a buy of 4 ETH at 2500.00 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 4 ETH at 2500.00 -> refused kill-switch

**Expected.** Refused: kill-switch

### C452 · With the kill switch engaged a buy of 4 ETH at 2500.10 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 4 ETH at 2500.10 -> refused kill-switch

**Expected.** Refused: kill-switch

### C453 · With the kill switch engaged a buy of 4 ETH at 2500.20 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 4 ETH at 2500.20 -> refused kill-switch

**Expected.** Refused: kill-switch

### C454 · With the kill switch engaged a buy of 4 ETH at 2500.30 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 4 ETH at 2500.30 -> refused kill-switch

**Expected.** Refused: kill-switch

### C455 · With the kill switch engaged a buy of 4 ETH at 2500.40 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 4 ETH at 2500.40 -> refused kill-switch

**Expected.** Refused: kill-switch

### C456 · With the kill switch engaged a buy of 4 ETH at 2500.50 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 4 ETH at 2500.50 -> refused kill-switch

**Expected.** Refused: kill-switch

### C457 · With the kill switch engaged a buy of 4 ETH at 2500.60 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 4 ETH at 2500.60 -> refused kill-switch

**Expected.** Refused: kill-switch

### C458 · With the kill switch engaged a buy of 4 ETH at 2500.70 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 4 ETH at 2500.70 -> refused kill-switch

**Expected.** Refused: kill-switch

### C459 · With the kill switch engaged a buy of 4 ETH at 2500.80 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 4 ETH at 2500.80 -> refused kill-switch

**Expected.** Refused: kill-switch

### C460 · With the kill switch engaged a buy of 4 ETH at 2500.90 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 4 ETH at 2500.90 -> refused kill-switch

**Expected.** Refused: kill-switch

### C461 · With the kill switch engaged a buy of 5 ETH at 2500.00 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 5 ETH at 2500.00 -> refused kill-switch

**Expected.** Refused: kill-switch

### C462 · With the kill switch engaged a buy of 5 ETH at 2500.10 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 5 ETH at 2500.10 -> refused kill-switch

**Expected.** Refused: kill-switch

### C463 · With the kill switch engaged a buy of 5 ETH at 2500.20 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 5 ETH at 2500.20 -> refused kill-switch

**Expected.** Refused: kill-switch

### C464 · With the kill switch engaged a buy of 5 ETH at 2500.30 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 5 ETH at 2500.30 -> refused kill-switch

**Expected.** Refused: kill-switch

### C465 · With the kill switch engaged a buy of 5 ETH at 2500.40 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 5 ETH at 2500.40 -> refused kill-switch

**Expected.** Refused: kill-switch

### C466 · With the kill switch engaged a buy of 5 ETH at 2500.50 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 5 ETH at 2500.50 -> refused kill-switch

**Expected.** Refused: kill-switch

### C467 · With the kill switch engaged a buy of 5 ETH at 2500.60 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 5 ETH at 2500.60 -> refused kill-switch

**Expected.** Refused: kill-switch

### C468 · With the kill switch engaged a buy of 5 ETH at 2500.70 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 5 ETH at 2500.70 -> refused kill-switch

**Expected.** Refused: kill-switch

### C469 · With the kill switch engaged a buy of 5 ETH at 2500.80 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 5 ETH at 2500.80 -> refused kill-switch

**Expected.** Refused: kill-switch

### C470 · With the kill switch engaged a buy of 5 ETH at 2500.90 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 5 ETH at 2500.90 -> refused kill-switch

**Expected.** Refused: kill-switch

### C471 · With the kill switch engaged a buy of 6 ETH at 2500.00 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 6 ETH at 2500.00 -> refused kill-switch

**Expected.** Refused: kill-switch

### C472 · With the kill switch engaged a buy of 6 ETH at 2500.10 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 6 ETH at 2500.10 -> refused kill-switch

**Expected.** Refused: kill-switch

### C473 · With the kill switch engaged a buy of 6 ETH at 2500.20 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 6 ETH at 2500.20 -> refused kill-switch

**Expected.** Refused: kill-switch

### C474 · With the kill switch engaged a buy of 6 ETH at 2500.30 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 6 ETH at 2500.30 -> refused kill-switch

**Expected.** Refused: kill-switch

### C475 · With the kill switch engaged a buy of 6 ETH at 2500.40 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 6 ETH at 2500.40 -> refused kill-switch

**Expected.** Refused: kill-switch

### C476 · With the kill switch engaged a buy of 6 ETH at 2500.50 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 6 ETH at 2500.50 -> refused kill-switch

**Expected.** Refused: kill-switch

### C477 · With the kill switch engaged a buy of 6 ETH at 2500.60 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 6 ETH at 2500.60 -> refused kill-switch

**Expected.** Refused: kill-switch

### C478 · With the kill switch engaged a buy of 6 ETH at 2500.70 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 6 ETH at 2500.70 -> refused kill-switch

**Expected.** Refused: kill-switch

### C479 · With the kill switch engaged a buy of 6 ETH at 2500.80 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 6 ETH at 2500.80 -> refused kill-switch

**Expected.** Refused: kill-switch

### C480 · With the kill switch engaged a buy of 6 ETH at 2500.90 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 6 ETH at 2500.90 -> refused kill-switch

**Expected.** Refused: kill-switch

### C481 · With the kill switch engaged a buy of 7 ETH at 2500.00 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 7 ETH at 2500.00 -> refused kill-switch

**Expected.** Refused: kill-switch

### C482 · With the kill switch engaged a buy of 7 ETH at 2500.10 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 7 ETH at 2500.10 -> refused kill-switch

**Expected.** Refused: kill-switch

### C483 · With the kill switch engaged a buy of 7 ETH at 2500.20 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 7 ETH at 2500.20 -> refused kill-switch

**Expected.** Refused: kill-switch

### C484 · With the kill switch engaged a buy of 7 ETH at 2500.30 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 7 ETH at 2500.30 -> refused kill-switch

**Expected.** Refused: kill-switch

### C485 · With the kill switch engaged a buy of 7 ETH at 2500.40 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 7 ETH at 2500.40 -> refused kill-switch

**Expected.** Refused: kill-switch

### C486 · With the kill switch engaged a buy of 7 ETH at 2500.50 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 7 ETH at 2500.50 -> refused kill-switch

**Expected.** Refused: kill-switch

### C487 · With the kill switch engaged a buy of 7 ETH at 2500.60 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 7 ETH at 2500.60 -> refused kill-switch

**Expected.** Refused: kill-switch

### C488 · With the kill switch engaged a buy of 7 ETH at 2500.70 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 7 ETH at 2500.70 -> refused kill-switch

**Expected.** Refused: kill-switch

### C489 · With the kill switch engaged a buy of 7 ETH at 2500.80 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 7 ETH at 2500.80 -> refused kill-switch

**Expected.** Refused: kill-switch

### C490 · With the kill switch engaged a buy of 7 ETH at 2500.90 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 7 ETH at 2500.90 -> refused kill-switch

**Expected.** Refused: kill-switch

### C491 · With the kill switch engaged a buy of 8 ETH at 2500.00 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 8 ETH at 2500.00 -> refused kill-switch

**Expected.** Refused: kill-switch

### C492 · With the kill switch engaged a buy of 8 ETH at 2500.10 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 8 ETH at 2500.10 -> refused kill-switch

**Expected.** Refused: kill-switch

### C493 · With the kill switch engaged a buy of 8 ETH at 2500.20 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 8 ETH at 2500.20 -> refused kill-switch

**Expected.** Refused: kill-switch

### C494 · With the kill switch engaged a buy of 8 ETH at 2500.30 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 8 ETH at 2500.30 -> refused kill-switch

**Expected.** Refused: kill-switch

### C495 · With the kill switch engaged a buy of 8 ETH at 2500.40 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 8 ETH at 2500.40 -> refused kill-switch

**Expected.** Refused: kill-switch

### C496 · With the kill switch engaged a buy of 8 ETH at 2500.50 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 8 ETH at 2500.50 -> refused kill-switch

**Expected.** Refused: kill-switch

### C497 · With the kill switch engaged a buy of 8 ETH at 2500.60 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 8 ETH at 2500.60 -> refused kill-switch

**Expected.** Refused: kill-switch

### C498 · With the kill switch engaged a buy of 8 ETH at 2500.70 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 8 ETH at 2500.70 -> refused kill-switch

**Expected.** Refused: kill-switch

### C499 · With the kill switch engaged a buy of 8 ETH at 2500.80 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 8 ETH at 2500.80 -> refused kill-switch

**Expected.** Refused: kill-switch

### C500 · With the kill switch engaged a buy of 8 ETH at 2500.90 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 8 ETH at 2500.90 -> refused kill-switch

**Expected.** Refused: kill-switch

### C501 · With the kill switch engaged a buy of 9 ETH at 2500.00 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 9 ETH at 2500.00 -> refused kill-switch

**Expected.** Refused: kill-switch

### C502 · With the kill switch engaged a buy of 9 ETH at 2500.10 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 9 ETH at 2500.10 -> refused kill-switch

**Expected.** Refused: kill-switch

### C503 · With the kill switch engaged a buy of 9 ETH at 2500.20 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 9 ETH at 2500.20 -> refused kill-switch

**Expected.** Refused: kill-switch

### C504 · With the kill switch engaged a buy of 9 ETH at 2500.30 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 9 ETH at 2500.30 -> refused kill-switch

**Expected.** Refused: kill-switch

### C505 · With the kill switch engaged a buy of 9 ETH at 2500.40 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 9 ETH at 2500.40 -> refused kill-switch

**Expected.** Refused: kill-switch

### C506 · With the kill switch engaged a buy of 9 ETH at 2500.50 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 9 ETH at 2500.50 -> refused kill-switch

**Expected.** Refused: kill-switch

### C507 · With the kill switch engaged a buy of 9 ETH at 2500.60 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 9 ETH at 2500.60 -> refused kill-switch

**Expected.** Refused: kill-switch

### C508 · With the kill switch engaged a buy of 9 ETH at 2500.70 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 9 ETH at 2500.70 -> refused kill-switch

**Expected.** Refused: kill-switch

### C509 · With the kill switch engaged a buy of 9 ETH at 2500.80 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 9 ETH at 2500.80 -> refused kill-switch

**Expected.** Refused: kill-switch

### C510 · With the kill switch engaged a buy of 9 ETH at 2500.90 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 9 ETH at 2500.90 -> refused kill-switch

**Expected.** Refused: kill-switch

### C511 · With the kill switch engaged a buy of 10 ETH at 2500.00 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 10 ETH at 2500.00 -> refused kill-switch

**Expected.** Refused: kill-switch

### C512 · With the kill switch engaged a buy of 10 ETH at 2500.10 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 10 ETH at 2500.10 -> refused kill-switch

**Expected.** Refused: kill-switch

### C513 · With the kill switch engaged a buy of 10 ETH at 2500.20 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 10 ETH at 2500.20 -> refused kill-switch

**Expected.** Refused: kill-switch

### C514 · With the kill switch engaged a buy of 10 ETH at 2500.30 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 10 ETH at 2500.30 -> refused kill-switch

**Expected.** Refused: kill-switch

### C515 · With the kill switch engaged a buy of 10 ETH at 2500.40 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 10 ETH at 2500.40 -> refused kill-switch

**Expected.** Refused: kill-switch

### C516 · With the kill switch engaged a buy of 10 ETH at 2500.50 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 10 ETH at 2500.50 -> refused kill-switch

**Expected.** Refused: kill-switch

### C517 · With the kill switch engaged a buy of 10 ETH at 2500.60 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 10 ETH at 2500.60 -> refused kill-switch

**Expected.** Refused: kill-switch

### C518 · With the kill switch engaged a buy of 10 ETH at 2500.70 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 10 ETH at 2500.70 -> refused kill-switch

**Expected.** Refused: kill-switch

### C519 · With the kill switch engaged a buy of 10 ETH at 2500.80 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 10 ETH at 2500.80 -> refused kill-switch

**Expected.** Refused: kill-switch

### C520 · With the kill switch engaged a buy of 10 ETH at 2500.90 is refused

**Function** `RiskEngine.plan (kill-switch)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The kill switch refuses every order regardless of its parameters

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with the kill switch engaged
2. plan buy 10 ETH at 2500.90 -> refused kill-switch

**Expected.** Refused: kill-switch

### C521 · A buy of 2 ETH onto a position of 4 breaches max position 5

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 5
2. plan buy 2 ETH against position 4 -> refused max-position

**Expected.** Refused: max-position

### C522 · A buy of 3 ETH onto a position of 4 breaches max position 5

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 5
2. plan buy 3 ETH against position 4 -> refused max-position

**Expected.** Refused: max-position

### C523 · A buy of 4 ETH onto a position of 4 breaches max position 5

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 5
2. plan buy 4 ETH against position 4 -> refused max-position

**Expected.** Refused: max-position

### C524 · A buy of 5 ETH onto a position of 4 breaches max position 5

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 5
2. plan buy 5 ETH against position 4 -> refused max-position

**Expected.** Refused: max-position

### C525 · A buy of 6 ETH onto a position of 4 breaches max position 5

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 5
2. plan buy 6 ETH against position 4 -> refused max-position

**Expected.** Refused: max-position

### C526 · A buy of 7 ETH onto a position of 4 breaches max position 5

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 5
2. plan buy 7 ETH against position 4 -> refused max-position

**Expected.** Refused: max-position

### C527 · A buy of 2 ETH onto a position of 5 breaches max position 6

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 6
2. plan buy 2 ETH against position 5 -> refused max-position

**Expected.** Refused: max-position

### C528 · A buy of 3 ETH onto a position of 5 breaches max position 6

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 6
2. plan buy 3 ETH against position 5 -> refused max-position

**Expected.** Refused: max-position

### C529 · A buy of 4 ETH onto a position of 5 breaches max position 6

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 6
2. plan buy 4 ETH against position 5 -> refused max-position

**Expected.** Refused: max-position

### C530 · A buy of 5 ETH onto a position of 5 breaches max position 6

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 6
2. plan buy 5 ETH against position 5 -> refused max-position

**Expected.** Refused: max-position

### C531 · A buy of 6 ETH onto a position of 5 breaches max position 6

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 6
2. plan buy 6 ETH against position 5 -> refused max-position

**Expected.** Refused: max-position

### C532 · A buy of 7 ETH onto a position of 5 breaches max position 6

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 6
2. plan buy 7 ETH against position 5 -> refused max-position

**Expected.** Refused: max-position

### C533 · A buy of 2 ETH onto a position of 6 breaches max position 7

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 7
2. plan buy 2 ETH against position 6 -> refused max-position

**Expected.** Refused: max-position

### C534 · A buy of 3 ETH onto a position of 6 breaches max position 7

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 7
2. plan buy 3 ETH against position 6 -> refused max-position

**Expected.** Refused: max-position

### C535 · A buy of 4 ETH onto a position of 6 breaches max position 7

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 7
2. plan buy 4 ETH against position 6 -> refused max-position

**Expected.** Refused: max-position

### C536 · A buy of 5 ETH onto a position of 6 breaches max position 7

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 7
2. plan buy 5 ETH against position 6 -> refused max-position

**Expected.** Refused: max-position

### C537 · A buy of 6 ETH onto a position of 6 breaches max position 7

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 7
2. plan buy 6 ETH against position 6 -> refused max-position

**Expected.** Refused: max-position

### C538 · A buy of 7 ETH onto a position of 6 breaches max position 7

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 7
2. plan buy 7 ETH against position 6 -> refused max-position

**Expected.** Refused: max-position

### C539 · A buy of 2 ETH onto a position of 7 breaches max position 8

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 8
2. plan buy 2 ETH against position 7 -> refused max-position

**Expected.** Refused: max-position

### C540 · A buy of 3 ETH onto a position of 7 breaches max position 8

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 8
2. plan buy 3 ETH against position 7 -> refused max-position

**Expected.** Refused: max-position

### C541 · A buy of 4 ETH onto a position of 7 breaches max position 8

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 8
2. plan buy 4 ETH against position 7 -> refused max-position

**Expected.** Refused: max-position

### C542 · A buy of 5 ETH onto a position of 7 breaches max position 8

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 8
2. plan buy 5 ETH against position 7 -> refused max-position

**Expected.** Refused: max-position

### C543 · A buy of 6 ETH onto a position of 7 breaches max position 8

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 8
2. plan buy 6 ETH against position 7 -> refused max-position

**Expected.** Refused: max-position

### C544 · A buy of 7 ETH onto a position of 7 breaches max position 8

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 8
2. plan buy 7 ETH against position 7 -> refused max-position

**Expected.** Refused: max-position

### C545 · A buy of 2 ETH onto a position of 8 breaches max position 9

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 9
2. plan buy 2 ETH against position 8 -> refused max-position

**Expected.** Refused: max-position

### C546 · A buy of 3 ETH onto a position of 8 breaches max position 9

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 9
2. plan buy 3 ETH against position 8 -> refused max-position

**Expected.** Refused: max-position

### C547 · A buy of 4 ETH onto a position of 8 breaches max position 9

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 9
2. plan buy 4 ETH against position 8 -> refused max-position

**Expected.** Refused: max-position

### C548 · A buy of 5 ETH onto a position of 8 breaches max position 9

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 9
2. plan buy 5 ETH against position 8 -> refused max-position

**Expected.** Refused: max-position

### C549 · A buy of 6 ETH onto a position of 8 breaches max position 9

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 9
2. plan buy 6 ETH against position 8 -> refused max-position

**Expected.** Refused: max-position

### C550 · A buy of 7 ETH onto a position of 8 breaches max position 9

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 9
2. plan buy 7 ETH against position 8 -> refused max-position

**Expected.** Refused: max-position

### C551 · A buy of 2 ETH onto a position of 9 breaches max position 10

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 10
2. plan buy 2 ETH against position 9 -> refused max-position

**Expected.** Refused: max-position

### C552 · A buy of 3 ETH onto a position of 9 breaches max position 10

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 10
2. plan buy 3 ETH against position 9 -> refused max-position

**Expected.** Refused: max-position

### C553 · A buy of 4 ETH onto a position of 9 breaches max position 10

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 10
2. plan buy 4 ETH against position 9 -> refused max-position

**Expected.** Refused: max-position

### C554 · A buy of 5 ETH onto a position of 9 breaches max position 10

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 10
2. plan buy 5 ETH against position 9 -> refused max-position

**Expected.** Refused: max-position

### C555 · A buy of 6 ETH onto a position of 9 breaches max position 10

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 10
2. plan buy 6 ETH against position 9 -> refused max-position

**Expected.** Refused: max-position

### C556 · A buy of 7 ETH onto a position of 9 breaches max position 10

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 10
2. plan buy 7 ETH against position 9 -> refused max-position

**Expected.** Refused: max-position

### C557 · A buy of 2 ETH onto a position of 10 breaches max position 11

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 11
2. plan buy 2 ETH against position 10 -> refused max-position

**Expected.** Refused: max-position

### C558 · A buy of 3 ETH onto a position of 10 breaches max position 11

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 11
2. plan buy 3 ETH against position 10 -> refused max-position

**Expected.** Refused: max-position

### C559 · A buy of 4 ETH onto a position of 10 breaches max position 11

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 11
2. plan buy 4 ETH against position 10 -> refused max-position

**Expected.** Refused: max-position

### C560 · A buy of 5 ETH onto a position of 10 breaches max position 11

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 11
2. plan buy 5 ETH against position 10 -> refused max-position

**Expected.** Refused: max-position

### C561 · A buy of 6 ETH onto a position of 10 breaches max position 11

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 11
2. plan buy 6 ETH against position 10 -> refused max-position

**Expected.** Refused: max-position

### C562 · A buy of 7 ETH onto a position of 10 breaches max position 11

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 11
2. plan buy 7 ETH against position 10 -> refused max-position

**Expected.** Refused: max-position

### C563 · A buy of 2 ETH onto a position of 11 breaches max position 12

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 12
2. plan buy 2 ETH against position 11 -> refused max-position

**Expected.** Refused: max-position

### C564 · A buy of 3 ETH onto a position of 11 breaches max position 12

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 12
2. plan buy 3 ETH against position 11 -> refused max-position

**Expected.** Refused: max-position

### C565 · A buy of 4 ETH onto a position of 11 breaches max position 12

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 12
2. plan buy 4 ETH against position 11 -> refused max-position

**Expected.** Refused: max-position

### C566 · A buy of 5 ETH onto a position of 11 breaches max position 12

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 12
2. plan buy 5 ETH against position 11 -> refused max-position

**Expected.** Refused: max-position

### C567 · A buy of 6 ETH onto a position of 11 breaches max position 12

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 12
2. plan buy 6 ETH against position 11 -> refused max-position

**Expected.** Refused: max-position

### C568 · A buy of 7 ETH onto a position of 11 breaches max position 12

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 12
2. plan buy 7 ETH against position 11 -> refused max-position

**Expected.** Refused: max-position

### C569 · A buy of 2 ETH onto a position of 12 breaches max position 13

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 13
2. plan buy 2 ETH against position 12 -> refused max-position

**Expected.** Refused: max-position

### C570 · A buy of 3 ETH onto a position of 12 breaches max position 13

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 13
2. plan buy 3 ETH against position 12 -> refused max-position

**Expected.** Refused: max-position

### C571 · A buy of 4 ETH onto a position of 12 breaches max position 13

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 13
2. plan buy 4 ETH against position 12 -> refused max-position

**Expected.** Refused: max-position

### C572 · A buy of 5 ETH onto a position of 12 breaches max position 13

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 13
2. plan buy 5 ETH against position 12 -> refused max-position

**Expected.** Refused: max-position

### C573 · A buy of 6 ETH onto a position of 12 breaches max position 13

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 13
2. plan buy 6 ETH against position 12 -> refused max-position

**Expected.** Refused: max-position

### C574 · A buy of 7 ETH onto a position of 12 breaches max position 13

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 13
2. plan buy 7 ETH against position 12 -> refused max-position

**Expected.** Refused: max-position

### C575 · A buy of 2 ETH onto a position of 13 breaches max position 14

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 14
2. plan buy 2 ETH against position 13 -> refused max-position

**Expected.** Refused: max-position

### C576 · A buy of 3 ETH onto a position of 13 breaches max position 14

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 14
2. plan buy 3 ETH against position 13 -> refused max-position

**Expected.** Refused: max-position

### C577 · A buy of 4 ETH onto a position of 13 breaches max position 14

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 14
2. plan buy 4 ETH against position 13 -> refused max-position

**Expected.** Refused: max-position

### C578 · A buy of 5 ETH onto a position of 13 breaches max position 14

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 14
2. plan buy 5 ETH against position 13 -> refused max-position

**Expected.** Refused: max-position

### C579 · A buy of 6 ETH onto a position of 13 breaches max position 14

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 14
2. plan buy 6 ETH against position 13 -> refused max-position

**Expected.** Refused: max-position

### C580 · A buy of 7 ETH onto a position of 13 breaches max position 14

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 14
2. plan buy 7 ETH against position 13 -> refused max-position

**Expected.** Refused: max-position

### C581 · A buy of 2 ETH onto a position of 14 breaches max position 15

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 15
2. plan buy 2 ETH against position 14 -> refused max-position

**Expected.** Refused: max-position

### C582 · A buy of 3 ETH onto a position of 14 breaches max position 15

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 15
2. plan buy 3 ETH against position 14 -> refused max-position

**Expected.** Refused: max-position

### C583 · A buy of 4 ETH onto a position of 14 breaches max position 15

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 15
2. plan buy 4 ETH against position 14 -> refused max-position

**Expected.** Refused: max-position

### C584 · A buy of 5 ETH onto a position of 14 breaches max position 15

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 15
2. plan buy 5 ETH against position 14 -> refused max-position

**Expected.** Refused: max-position

### C585 · A buy of 6 ETH onto a position of 14 breaches max position 15

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 15
2. plan buy 6 ETH against position 14 -> refused max-position

**Expected.** Refused: max-position

### C586 · A buy of 7 ETH onto a position of 14 breaches max position 15

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 15
2. plan buy 7 ETH against position 14 -> refused max-position

**Expected.** Refused: max-position

### C587 · A buy of 2 ETH onto a position of 15 breaches max position 16

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 16
2. plan buy 2 ETH against position 15 -> refused max-position

**Expected.** Refused: max-position

### C588 · A buy of 3 ETH onto a position of 15 breaches max position 16

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 16
2. plan buy 3 ETH against position 15 -> refused max-position

**Expected.** Refused: max-position

### C589 · A buy of 4 ETH onto a position of 15 breaches max position 16

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 16
2. plan buy 4 ETH against position 15 -> refused max-position

**Expected.** Refused: max-position

### C590 · A buy of 5 ETH onto a position of 15 breaches max position 16

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 16
2. plan buy 5 ETH against position 15 -> refused max-position

**Expected.** Refused: max-position

### C591 · A buy of 6 ETH onto a position of 15 breaches max position 16

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 16
2. plan buy 6 ETH against position 15 -> refused max-position

**Expected.** Refused: max-position

### C592 · A buy of 7 ETH onto a position of 15 breaches max position 16

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 16
2. plan buy 7 ETH against position 15 -> refused max-position

**Expected.** Refused: max-position

### C593 · A buy of 2 ETH onto a position of 16 breaches max position 17

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 17
2. plan buy 2 ETH against position 16 -> refused max-position

**Expected.** Refused: max-position

### C594 · A buy of 3 ETH onto a position of 16 breaches max position 17

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 17
2. plan buy 3 ETH against position 16 -> refused max-position

**Expected.** Refused: max-position

### C595 · A buy of 4 ETH onto a position of 16 breaches max position 17

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 17
2. plan buy 4 ETH against position 16 -> refused max-position

**Expected.** Refused: max-position

### C596 · A buy of 5 ETH onto a position of 16 breaches max position 17

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 17
2. plan buy 5 ETH against position 16 -> refused max-position

**Expected.** Refused: max-position

### C597 · A buy of 6 ETH onto a position of 16 breaches max position 17

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 17
2. plan buy 6 ETH against position 16 -> refused max-position

**Expected.** Refused: max-position

### C598 · A buy of 7 ETH onto a position of 16 breaches max position 17

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 17
2. plan buy 7 ETH against position 16 -> refused max-position

**Expected.** Refused: max-position

### C599 · A buy of 2 ETH onto a position of 17 breaches max position 18

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 18
2. plan buy 2 ETH against position 17 -> refused max-position

**Expected.** Refused: max-position

### C600 · A buy of 3 ETH onto a position of 17 breaches max position 18

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 18
2. plan buy 3 ETH against position 17 -> refused max-position

**Expected.** Refused: max-position

### C601 · A buy of 4 ETH onto a position of 17 breaches max position 18

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 18
2. plan buy 4 ETH against position 17 -> refused max-position

**Expected.** Refused: max-position

### C602 · A buy of 5 ETH onto a position of 17 breaches max position 18

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 18
2. plan buy 5 ETH against position 17 -> refused max-position

**Expected.** Refused: max-position

### C603 · A buy of 6 ETH onto a position of 17 breaches max position 18

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 18
2. plan buy 6 ETH against position 17 -> refused max-position

**Expected.** Refused: max-position

### C604 · A buy of 7 ETH onto a position of 17 breaches max position 18

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 18
2. plan buy 7 ETH against position 17 -> refused max-position

**Expected.** Refused: max-position

### C605 · A buy of 2 ETH onto a position of 18 breaches max position 19

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 19
2. plan buy 2 ETH against position 18 -> refused max-position

**Expected.** Refused: max-position

### C606 · A buy of 3 ETH onto a position of 18 breaches max position 19

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 19
2. plan buy 3 ETH against position 18 -> refused max-position

**Expected.** Refused: max-position

### C607 · A buy of 4 ETH onto a position of 18 breaches max position 19

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 19
2. plan buy 4 ETH against position 18 -> refused max-position

**Expected.** Refused: max-position

### C608 · A buy of 5 ETH onto a position of 18 breaches max position 19

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 19
2. plan buy 5 ETH against position 18 -> refused max-position

**Expected.** Refused: max-position

### C609 · A buy of 6 ETH onto a position of 18 breaches max position 19

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 19
2. plan buy 6 ETH against position 18 -> refused max-position

**Expected.** Refused: max-position

### C610 · A buy of 7 ETH onto a position of 18 breaches max position 19

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 19
2. plan buy 7 ETH against position 18 -> refused max-position

**Expected.** Refused: max-position

### C611 · A buy of 2 ETH onto a position of 19 breaches max position 20

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 20
2. plan buy 2 ETH against position 19 -> refused max-position

**Expected.** Refused: max-position

### C612 · A buy of 3 ETH onto a position of 19 breaches max position 20

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 20
2. plan buy 3 ETH against position 19 -> refused max-position

**Expected.** Refused: max-position

### C613 · A buy of 4 ETH onto a position of 19 breaches max position 20

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 20
2. plan buy 4 ETH against position 19 -> refused max-position

**Expected.** Refused: max-position

### C614 · A buy of 5 ETH onto a position of 19 breaches max position 20

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 20
2. plan buy 5 ETH against position 19 -> refused max-position

**Expected.** Refused: max-position

### C615 · A buy of 6 ETH onto a position of 19 breaches max position 20

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 20
2. plan buy 6 ETH against position 19 -> refused max-position

**Expected.** Refused: max-position

### C616 · A buy of 7 ETH onto a position of 19 breaches max position 20

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 20
2. plan buy 7 ETH against position 19 -> refused max-position

**Expected.** Refused: max-position

### C617 · A buy of 2 ETH onto a position of 20 breaches max position 21

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 21
2. plan buy 2 ETH against position 20 -> refused max-position

**Expected.** Refused: max-position

### C618 · A buy of 3 ETH onto a position of 20 breaches max position 21

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 21
2. plan buy 3 ETH against position 20 -> refused max-position

**Expected.** Refused: max-position

### C619 · A buy of 4 ETH onto a position of 20 breaches max position 21

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 21
2. plan buy 4 ETH against position 20 -> refused max-position

**Expected.** Refused: max-position

### C620 · A buy of 5 ETH onto a position of 20 breaches max position 21

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 21
2. plan buy 5 ETH against position 20 -> refused max-position

**Expected.** Refused: max-position

### C621 · A buy of 6 ETH onto a position of 20 breaches max position 21

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 21
2. plan buy 6 ETH against position 20 -> refused max-position

**Expected.** Refused: max-position

### C622 · A buy of 7 ETH onto a position of 20 breaches max position 21

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 21
2. plan buy 7 ETH against position 20 -> refused max-position

**Expected.** Refused: max-position

### C623 · A buy of 2 ETH onto a position of 21 breaches max position 22

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 22
2. plan buy 2 ETH against position 21 -> refused max-position

**Expected.** Refused: max-position

### C624 · A buy of 3 ETH onto a position of 21 breaches max position 22

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 22
2. plan buy 3 ETH against position 21 -> refused max-position

**Expected.** Refused: max-position

### C625 · A buy of 4 ETH onto a position of 21 breaches max position 22

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 22
2. plan buy 4 ETH against position 21 -> refused max-position

**Expected.** Refused: max-position

### C626 · A buy of 5 ETH onto a position of 21 breaches max position 22

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 22
2. plan buy 5 ETH against position 21 -> refused max-position

**Expected.** Refused: max-position

### C627 · A buy of 6 ETH onto a position of 21 breaches max position 22

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 22
2. plan buy 6 ETH against position 21 -> refused max-position

**Expected.** Refused: max-position

### C628 · A buy of 7 ETH onto a position of 21 breaches max position 22

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 22
2. plan buy 7 ETH against position 21 -> refused max-position

**Expected.** Refused: max-position

### C629 · A buy of 2 ETH onto a position of 22 breaches max position 23

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 23
2. plan buy 2 ETH against position 22 -> refused max-position

**Expected.** Refused: max-position

### C630 · A buy of 3 ETH onto a position of 22 breaches max position 23

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 23
2. plan buy 3 ETH against position 22 -> refused max-position

**Expected.** Refused: max-position

### C631 · A buy of 4 ETH onto a position of 22 breaches max position 23

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 23
2. plan buy 4 ETH against position 22 -> refused max-position

**Expected.** Refused: max-position

### C632 · A buy of 5 ETH onto a position of 22 breaches max position 23

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 23
2. plan buy 5 ETH against position 22 -> refused max-position

**Expected.** Refused: max-position

### C633 · A buy of 6 ETH onto a position of 22 breaches max position 23

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 23
2. plan buy 6 ETH against position 22 -> refused max-position

**Expected.** Refused: max-position

### C634 · A buy of 7 ETH onto a position of 22 breaches max position 23

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 23
2. plan buy 7 ETH against position 22 -> refused max-position

**Expected.** Refused: max-position

### C635 · A buy of 2 ETH onto a position of 23 breaches max position 24

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 24
2. plan buy 2 ETH against position 23 -> refused max-position

**Expected.** Refused: max-position

### C636 · A buy of 3 ETH onto a position of 23 breaches max position 24

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 24
2. plan buy 3 ETH against position 23 -> refused max-position

**Expected.** Refused: max-position

### C637 · A buy of 4 ETH onto a position of 23 breaches max position 24

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 24
2. plan buy 4 ETH against position 23 -> refused max-position

**Expected.** Refused: max-position

### C638 · A buy of 5 ETH onto a position of 23 breaches max position 24

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 24
2. plan buy 5 ETH against position 23 -> refused max-position

**Expected.** Refused: max-position

### C639 · A buy of 6 ETH onto a position of 23 breaches max position 24

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 24
2. plan buy 6 ETH against position 23 -> refused max-position

**Expected.** Refused: max-position

### C640 · A buy of 7 ETH onto a position of 23 breaches max position 24

**Function** `RiskEngine.plan (max-position)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** The gate refuses a buy that would push the net position past the cap

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 24
2. plan buy 7 ETH against position 23 -> refused max-position

**Expected.** Refused: max-position

### C641 · A reduce-only sell of 1 ETH onto a position of 2 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 1 ETH against position 2 -> cleared

**Expected.** Cleared to send

### C642 · A reduce-only sell of 2 ETH onto a position of 2 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 2 ETH against position 2 -> cleared

**Expected.** Cleared to send

### C643 · A reduce-only sell of 3 ETH onto a position of 2 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 3 ETH against position 2 -> cleared

**Expected.** Cleared to send

### C644 · A reduce-only sell of 4 ETH onto a position of 2 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 4 ETH against position 2 -> cleared

**Expected.** Cleared to send

### C645 · A reduce-only sell of 5 ETH onto a position of 2 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 5 ETH against position 2 -> cleared

**Expected.** Cleared to send

### C646 · A reduce-only sell of 1 ETH onto a position of 3 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 1 ETH against position 3 -> cleared

**Expected.** Cleared to send

### C647 · A reduce-only sell of 2 ETH onto a position of 3 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 2 ETH against position 3 -> cleared

**Expected.** Cleared to send

### C648 · A reduce-only sell of 3 ETH onto a position of 3 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 3 ETH against position 3 -> cleared

**Expected.** Cleared to send

### C649 · A reduce-only sell of 4 ETH onto a position of 3 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 4 ETH against position 3 -> cleared

**Expected.** Cleared to send

### C650 · A reduce-only sell of 5 ETH onto a position of 3 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 5 ETH against position 3 -> cleared

**Expected.** Cleared to send

### C651 · A reduce-only sell of 1 ETH onto a position of 4 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 1 ETH against position 4 -> cleared

**Expected.** Cleared to send

### C652 · A reduce-only sell of 2 ETH onto a position of 4 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 2 ETH against position 4 -> cleared

**Expected.** Cleared to send

### C653 · A reduce-only sell of 3 ETH onto a position of 4 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 3 ETH against position 4 -> cleared

**Expected.** Cleared to send

### C654 · A reduce-only sell of 4 ETH onto a position of 4 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 4 ETH against position 4 -> cleared

**Expected.** Cleared to send

### C655 · A reduce-only sell of 5 ETH onto a position of 4 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 5 ETH against position 4 -> cleared

**Expected.** Cleared to send

### C656 · A reduce-only sell of 1 ETH onto a position of 5 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 1 ETH against position 5 -> cleared

**Expected.** Cleared to send

### C657 · A reduce-only sell of 2 ETH onto a position of 5 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 2 ETH against position 5 -> cleared

**Expected.** Cleared to send

### C658 · A reduce-only sell of 3 ETH onto a position of 5 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 3 ETH against position 5 -> cleared

**Expected.** Cleared to send

### C659 · A reduce-only sell of 4 ETH onto a position of 5 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 4 ETH against position 5 -> cleared

**Expected.** Cleared to send

### C660 · A reduce-only sell of 5 ETH onto a position of 5 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 5 ETH against position 5 -> cleared

**Expected.** Cleared to send

### C661 · A reduce-only sell of 1 ETH onto a position of 6 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 1 ETH against position 6 -> cleared

**Expected.** Cleared to send

### C662 · A reduce-only sell of 2 ETH onto a position of 6 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 2 ETH against position 6 -> cleared

**Expected.** Cleared to send

### C663 · A reduce-only sell of 3 ETH onto a position of 6 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 3 ETH against position 6 -> cleared

**Expected.** Cleared to send

### C664 · A reduce-only sell of 4 ETH onto a position of 6 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 4 ETH against position 6 -> cleared

**Expected.** Cleared to send

### C665 · A reduce-only sell of 5 ETH onto a position of 6 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 5 ETH against position 6 -> cleared

**Expected.** Cleared to send

### C666 · A reduce-only sell of 1 ETH onto a position of 7 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 1 ETH against position 7 -> cleared

**Expected.** Cleared to send

### C667 · A reduce-only sell of 2 ETH onto a position of 7 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 2 ETH against position 7 -> cleared

**Expected.** Cleared to send

### C668 · A reduce-only sell of 3 ETH onto a position of 7 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 3 ETH against position 7 -> cleared

**Expected.** Cleared to send

### C669 · A reduce-only sell of 4 ETH onto a position of 7 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 4 ETH against position 7 -> cleared

**Expected.** Cleared to send

### C670 · A reduce-only sell of 5 ETH onto a position of 7 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 5 ETH against position 7 -> cleared

**Expected.** Cleared to send

### C671 · A reduce-only sell of 1 ETH onto a position of 8 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 1 ETH against position 8 -> cleared

**Expected.** Cleared to send

### C672 · A reduce-only sell of 2 ETH onto a position of 8 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 2 ETH against position 8 -> cleared

**Expected.** Cleared to send

### C673 · A reduce-only sell of 3 ETH onto a position of 8 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 3 ETH against position 8 -> cleared

**Expected.** Cleared to send

### C674 · A reduce-only sell of 4 ETH onto a position of 8 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 4 ETH against position 8 -> cleared

**Expected.** Cleared to send

### C675 · A reduce-only sell of 5 ETH onto a position of 8 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 5 ETH against position 8 -> cleared

**Expected.** Cleared to send

### C676 · A reduce-only sell of 1 ETH onto a position of 9 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 1 ETH against position 9 -> cleared

**Expected.** Cleared to send

### C677 · A reduce-only sell of 2 ETH onto a position of 9 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 2 ETH against position 9 -> cleared

**Expected.** Cleared to send

### C678 · A reduce-only sell of 3 ETH onto a position of 9 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 3 ETH against position 9 -> cleared

**Expected.** Cleared to send

### C679 · A reduce-only sell of 4 ETH onto a position of 9 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 4 ETH against position 9 -> cleared

**Expected.** Cleared to send

### C680 · A reduce-only sell of 5 ETH onto a position of 9 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 5 ETH against position 9 -> cleared

**Expected.** Cleared to send

### C681 · A reduce-only sell of 1 ETH onto a position of 10 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 1 ETH against position 10 -> cleared

**Expected.** Cleared to send

### C682 · A reduce-only sell of 2 ETH onto a position of 10 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 2 ETH against position 10 -> cleared

**Expected.** Cleared to send

### C683 · A reduce-only sell of 3 ETH onto a position of 10 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 3 ETH against position 10 -> cleared

**Expected.** Cleared to send

### C684 · A reduce-only sell of 4 ETH onto a position of 10 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 4 ETH against position 10 -> cleared

**Expected.** Cleared to send

### C685 · A reduce-only sell of 5 ETH onto a position of 10 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 5 ETH against position 10 -> cleared

**Expected.** Cleared to send

### C686 · A reduce-only sell of 1 ETH onto a position of 11 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 1 ETH against position 11 -> cleared

**Expected.** Cleared to send

### C687 · A reduce-only sell of 2 ETH onto a position of 11 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 2 ETH against position 11 -> cleared

**Expected.** Cleared to send

### C688 · A reduce-only sell of 3 ETH onto a position of 11 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 3 ETH against position 11 -> cleared

**Expected.** Cleared to send

### C689 · A reduce-only sell of 4 ETH onto a position of 11 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 4 ETH against position 11 -> cleared

**Expected.** Cleared to send

### C690 · A reduce-only sell of 5 ETH onto a position of 11 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 5 ETH against position 11 -> cleared

**Expected.** Cleared to send

### C691 · A reduce-only sell of 1 ETH onto a position of 12 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 1 ETH against position 12 -> cleared

**Expected.** Cleared to send

### C692 · A reduce-only sell of 2 ETH onto a position of 12 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 2 ETH against position 12 -> cleared

**Expected.** Cleared to send

### C693 · A reduce-only sell of 3 ETH onto a position of 12 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 3 ETH against position 12 -> cleared

**Expected.** Cleared to send

### C694 · A reduce-only sell of 4 ETH onto a position of 12 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 4 ETH against position 12 -> cleared

**Expected.** Cleared to send

### C695 · A reduce-only sell of 5 ETH onto a position of 12 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 5 ETH against position 12 -> cleared

**Expected.** Cleared to send

### C696 · A reduce-only sell of 1 ETH onto a position of 13 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 1 ETH against position 13 -> cleared

**Expected.** Cleared to send

### C697 · A reduce-only sell of 2 ETH onto a position of 13 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 2 ETH against position 13 -> cleared

**Expected.** Cleared to send

### C698 · A reduce-only sell of 3 ETH onto a position of 13 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 3 ETH against position 13 -> cleared

**Expected.** Cleared to send

### C699 · A reduce-only sell of 4 ETH onto a position of 13 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 4 ETH against position 13 -> cleared

**Expected.** Cleared to send

### C700 · A reduce-only sell of 5 ETH onto a position of 13 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 5 ETH against position 13 -> cleared

**Expected.** Cleared to send

### C701 · A reduce-only sell of 1 ETH onto a position of 14 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 1 ETH against position 14 -> cleared

**Expected.** Cleared to send

### C702 · A reduce-only sell of 2 ETH onto a position of 14 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 2 ETH against position 14 -> cleared

**Expected.** Cleared to send

### C703 · A reduce-only sell of 3 ETH onto a position of 14 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 3 ETH against position 14 -> cleared

**Expected.** Cleared to send

### C704 · A reduce-only sell of 4 ETH onto a position of 14 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 4 ETH against position 14 -> cleared

**Expected.** Cleared to send

### C705 · A reduce-only sell of 5 ETH onto a position of 14 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 5 ETH against position 14 -> cleared

**Expected.** Cleared to send

### C706 · A reduce-only sell of 1 ETH onto a position of 15 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 1 ETH against position 15 -> cleared

**Expected.** Cleared to send

### C707 · A reduce-only sell of 2 ETH onto a position of 15 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 2 ETH against position 15 -> cleared

**Expected.** Cleared to send

### C708 · A reduce-only sell of 3 ETH onto a position of 15 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 3 ETH against position 15 -> cleared

**Expected.** Cleared to send

### C709 · A reduce-only sell of 4 ETH onto a position of 15 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 4 ETH against position 15 -> cleared

**Expected.** Cleared to send

### C710 · A reduce-only sell of 5 ETH onto a position of 15 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 5 ETH against position 15 -> cleared

**Expected.** Cleared to send

### C711 · A reduce-only sell of 1 ETH onto a position of 16 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 1 ETH against position 16 -> cleared

**Expected.** Cleared to send

### C712 · A reduce-only sell of 2 ETH onto a position of 16 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 2 ETH against position 16 -> cleared

**Expected.** Cleared to send

### C713 · A reduce-only sell of 3 ETH onto a position of 16 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 3 ETH against position 16 -> cleared

**Expected.** Cleared to send

### C714 · A reduce-only sell of 4 ETH onto a position of 16 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 4 ETH against position 16 -> cleared

**Expected.** Cleared to send

### C715 · A reduce-only sell of 5 ETH onto a position of 16 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 5 ETH against position 16 -> cleared

**Expected.** Cleared to send

### C716 · A reduce-only sell of 1 ETH onto a position of 17 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 1 ETH against position 17 -> cleared

**Expected.** Cleared to send

### C717 · A reduce-only sell of 2 ETH onto a position of 17 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 2 ETH against position 17 -> cleared

**Expected.** Cleared to send

### C718 · A reduce-only sell of 3 ETH onto a position of 17 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 3 ETH against position 17 -> cleared

**Expected.** Cleared to send

### C719 · A reduce-only sell of 4 ETH onto a position of 17 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 4 ETH against position 17 -> cleared

**Expected.** Cleared to send

### C720 · A reduce-only sell of 5 ETH onto a position of 17 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 5 ETH against position 17 -> cleared

**Expected.** Cleared to send

### C721 · A reduce-only sell of 1 ETH onto a position of 18 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 1 ETH against position 18 -> cleared

**Expected.** Cleared to send

### C722 · A reduce-only sell of 2 ETH onto a position of 18 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 2 ETH against position 18 -> cleared

**Expected.** Cleared to send

### C723 · A reduce-only sell of 3 ETH onto a position of 18 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 3 ETH against position 18 -> cleared

**Expected.** Cleared to send

### C724 · A reduce-only sell of 4 ETH onto a position of 18 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 4 ETH against position 18 -> cleared

**Expected.** Cleared to send

### C725 · A reduce-only sell of 5 ETH onto a position of 18 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 5 ETH against position 18 -> cleared

**Expected.** Cleared to send

### C726 · A reduce-only sell of 1 ETH onto a position of 19 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 1 ETH against position 19 -> cleared

**Expected.** Cleared to send

### C727 · A reduce-only sell of 2 ETH onto a position of 19 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 2 ETH against position 19 -> cleared

**Expected.** Cleared to send

### C728 · A reduce-only sell of 3 ETH onto a position of 19 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 3 ETH against position 19 -> cleared

**Expected.** Cleared to send

### C729 · A reduce-only sell of 4 ETH onto a position of 19 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 4 ETH against position 19 -> cleared

**Expected.** Cleared to send

### C730 · A reduce-only sell of 5 ETH onto a position of 19 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 5 ETH against position 19 -> cleared

**Expected.** Cleared to send

### C731 · A reduce-only sell of 1 ETH onto a position of 20 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 1 ETH against position 20 -> cleared

**Expected.** Cleared to send

### C732 · A reduce-only sell of 2 ETH onto a position of 20 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 2 ETH against position 20 -> cleared

**Expected.** Cleared to send

### C733 · A reduce-only sell of 3 ETH onto a position of 20 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 3 ETH against position 20 -> cleared

**Expected.** Cleared to send

### C734 · A reduce-only sell of 4 ETH onto a position of 20 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 4 ETH against position 20 -> cleared

**Expected.** Cleared to send

### C735 · A reduce-only sell of 5 ETH onto a position of 20 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 5 ETH against position 20 -> cleared

**Expected.** Cleared to send

### C736 · A reduce-only sell of 1 ETH onto a position of 21 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 1 ETH against position 21 -> cleared

**Expected.** Cleared to send

### C737 · A reduce-only sell of 2 ETH onto a position of 21 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 2 ETH against position 21 -> cleared

**Expected.** Cleared to send

### C738 · A reduce-only sell of 3 ETH onto a position of 21 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 3 ETH against position 21 -> cleared

**Expected.** Cleared to send

### C739 · A reduce-only sell of 4 ETH onto a position of 21 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 4 ETH against position 21 -> cleared

**Expected.** Cleared to send

### C740 · A reduce-only sell of 5 ETH onto a position of 21 clears past the cap

**Function** `RiskEngine.plan (reduce-only)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A reduce-only order shrinks the position, so the max-position cap never blocks it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine, max position 1
2. plan reduce-only sell 5 ETH against position 21 -> cleared

**Expected.** Cleared to send

### C741 · A valid buy of 1 ETH at 2500.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 1 ETH at 2500.00 -> cleared to send

**Expected.** Cleared to send

### C742 · A valid buy of 1 ETH at 2501.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 1 ETH at 2501.00 -> cleared to send

**Expected.** Cleared to send

### C743 · A valid buy of 1 ETH at 2502.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 1 ETH at 2502.00 -> cleared to send

**Expected.** Cleared to send

### C744 · A valid buy of 1 ETH at 2503.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 1 ETH at 2503.00 -> cleared to send

**Expected.** Cleared to send

### C745 · A valid buy of 1 ETH at 2504.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 1 ETH at 2504.00 -> cleared to send

**Expected.** Cleared to send

### C746 · A valid buy of 1 ETH at 2505.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 1 ETH at 2505.00 -> cleared to send

**Expected.** Cleared to send

### C747 · A valid buy of 1 ETH at 2506.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 1 ETH at 2506.00 -> cleared to send

**Expected.** Cleared to send

### C748 · A valid buy of 1 ETH at 2507.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 1 ETH at 2507.00 -> cleared to send

**Expected.** Cleared to send

### C749 · A valid buy of 1 ETH at 2508.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 1 ETH at 2508.00 -> cleared to send

**Expected.** Cleared to send

### C750 · A valid buy of 1 ETH at 2509.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 1 ETH at 2509.00 -> cleared to send

**Expected.** Cleared to send

### C751 · A valid buy of 2 ETH at 2500.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 2 ETH at 2500.00 -> cleared to send

**Expected.** Cleared to send

### C752 · A valid buy of 2 ETH at 2501.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 2 ETH at 2501.00 -> cleared to send

**Expected.** Cleared to send

### C753 · A valid buy of 2 ETH at 2502.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 2 ETH at 2502.00 -> cleared to send

**Expected.** Cleared to send

### C754 · A valid buy of 2 ETH at 2503.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 2 ETH at 2503.00 -> cleared to send

**Expected.** Cleared to send

### C755 · A valid buy of 2 ETH at 2504.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 2 ETH at 2504.00 -> cleared to send

**Expected.** Cleared to send

### C756 · A valid buy of 2 ETH at 2505.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 2 ETH at 2505.00 -> cleared to send

**Expected.** Cleared to send

### C757 · A valid buy of 2 ETH at 2506.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 2 ETH at 2506.00 -> cleared to send

**Expected.** Cleared to send

### C758 · A valid buy of 2 ETH at 2507.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 2 ETH at 2507.00 -> cleared to send

**Expected.** Cleared to send

### C759 · A valid buy of 2 ETH at 2508.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 2 ETH at 2508.00 -> cleared to send

**Expected.** Cleared to send

### C760 · A valid buy of 2 ETH at 2509.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 2 ETH at 2509.00 -> cleared to send

**Expected.** Cleared to send

### C761 · A valid buy of 3 ETH at 2500.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 3 ETH at 2500.00 -> cleared to send

**Expected.** Cleared to send

### C762 · A valid buy of 3 ETH at 2501.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 3 ETH at 2501.00 -> cleared to send

**Expected.** Cleared to send

### C763 · A valid buy of 3 ETH at 2502.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 3 ETH at 2502.00 -> cleared to send

**Expected.** Cleared to send

### C764 · A valid buy of 3 ETH at 2503.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 3 ETH at 2503.00 -> cleared to send

**Expected.** Cleared to send

### C765 · A valid buy of 3 ETH at 2504.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 3 ETH at 2504.00 -> cleared to send

**Expected.** Cleared to send

### C766 · A valid buy of 3 ETH at 2505.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 3 ETH at 2505.00 -> cleared to send

**Expected.** Cleared to send

### C767 · A valid buy of 3 ETH at 2506.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 3 ETH at 2506.00 -> cleared to send

**Expected.** Cleared to send

### C768 · A valid buy of 3 ETH at 2507.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 3 ETH at 2507.00 -> cleared to send

**Expected.** Cleared to send

### C769 · A valid buy of 3 ETH at 2508.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 3 ETH at 2508.00 -> cleared to send

**Expected.** Cleared to send

### C770 · A valid buy of 3 ETH at 2509.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 3 ETH at 2509.00 -> cleared to send

**Expected.** Cleared to send

### C771 · A valid buy of 4 ETH at 2500.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 4 ETH at 2500.00 -> cleared to send

**Expected.** Cleared to send

### C772 · A valid buy of 4 ETH at 2501.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 4 ETH at 2501.00 -> cleared to send

**Expected.** Cleared to send

### C773 · A valid buy of 4 ETH at 2502.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 4 ETH at 2502.00 -> cleared to send

**Expected.** Cleared to send

### C774 · A valid buy of 4 ETH at 2503.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 4 ETH at 2503.00 -> cleared to send

**Expected.** Cleared to send

### C775 · A valid buy of 4 ETH at 2504.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 4 ETH at 2504.00 -> cleared to send

**Expected.** Cleared to send

### C776 · A valid buy of 4 ETH at 2505.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 4 ETH at 2505.00 -> cleared to send

**Expected.** Cleared to send

### C777 · A valid buy of 4 ETH at 2506.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 4 ETH at 2506.00 -> cleared to send

**Expected.** Cleared to send

### C778 · A valid buy of 4 ETH at 2507.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 4 ETH at 2507.00 -> cleared to send

**Expected.** Cleared to send

### C779 · A valid buy of 4 ETH at 2508.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 4 ETH at 2508.00 -> cleared to send

**Expected.** Cleared to send

### C780 · A valid buy of 4 ETH at 2509.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 4 ETH at 2509.00 -> cleared to send

**Expected.** Cleared to send

### C781 · A valid buy of 5 ETH at 2500.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 5 ETH at 2500.00 -> cleared to send

**Expected.** Cleared to send

### C782 · A valid buy of 5 ETH at 2501.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 5 ETH at 2501.00 -> cleared to send

**Expected.** Cleared to send

### C783 · A valid buy of 5 ETH at 2502.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 5 ETH at 2502.00 -> cleared to send

**Expected.** Cleared to send

### C784 · A valid buy of 5 ETH at 2503.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 5 ETH at 2503.00 -> cleared to send

**Expected.** Cleared to send

### C785 · A valid buy of 5 ETH at 2504.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 5 ETH at 2504.00 -> cleared to send

**Expected.** Cleared to send

### C786 · A valid buy of 5 ETH at 2505.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 5 ETH at 2505.00 -> cleared to send

**Expected.** Cleared to send

### C787 · A valid buy of 5 ETH at 2506.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 5 ETH at 2506.00 -> cleared to send

**Expected.** Cleared to send

### C788 · A valid buy of 5 ETH at 2507.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 5 ETH at 2507.00 -> cleared to send

**Expected.** Cleared to send

### C789 · A valid buy of 5 ETH at 2508.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 5 ETH at 2508.00 -> cleared to send

**Expected.** Cleared to send

### C790 · A valid buy of 5 ETH at 2509.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 5 ETH at 2509.00 -> cleared to send

**Expected.** Cleared to send

### C791 · A valid buy of 6 ETH at 2500.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 6 ETH at 2500.00 -> cleared to send

**Expected.** Cleared to send

### C792 · A valid buy of 6 ETH at 2501.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 6 ETH at 2501.00 -> cleared to send

**Expected.** Cleared to send

### C793 · A valid buy of 6 ETH at 2502.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 6 ETH at 2502.00 -> cleared to send

**Expected.** Cleared to send

### C794 · A valid buy of 6 ETH at 2503.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 6 ETH at 2503.00 -> cleared to send

**Expected.** Cleared to send

### C795 · A valid buy of 6 ETH at 2504.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 6 ETH at 2504.00 -> cleared to send

**Expected.** Cleared to send

### C796 · A valid buy of 6 ETH at 2505.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 6 ETH at 2505.00 -> cleared to send

**Expected.** Cleared to send

### C797 · A valid buy of 6 ETH at 2506.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 6 ETH at 2506.00 -> cleared to send

**Expected.** Cleared to send

### C798 · A valid buy of 6 ETH at 2507.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 6 ETH at 2507.00 -> cleared to send

**Expected.** Cleared to send

### C799 · A valid buy of 6 ETH at 2508.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 6 ETH at 2508.00 -> cleared to send

**Expected.** Cleared to send

### C800 · A valid buy of 6 ETH at 2509.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 6 ETH at 2509.00 -> cleared to send

**Expected.** Cleared to send

### C801 · A valid buy of 7 ETH at 2500.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 7 ETH at 2500.00 -> cleared to send

**Expected.** Cleared to send

### C802 · A valid buy of 7 ETH at 2501.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 7 ETH at 2501.00 -> cleared to send

**Expected.** Cleared to send

### C803 · A valid buy of 7 ETH at 2502.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 7 ETH at 2502.00 -> cleared to send

**Expected.** Cleared to send

### C804 · A valid buy of 7 ETH at 2503.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 7 ETH at 2503.00 -> cleared to send

**Expected.** Cleared to send

### C805 · A valid buy of 7 ETH at 2504.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 7 ETH at 2504.00 -> cleared to send

**Expected.** Cleared to send

### C806 · A valid buy of 7 ETH at 2505.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 7 ETH at 2505.00 -> cleared to send

**Expected.** Cleared to send

### C807 · A valid buy of 7 ETH at 2506.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 7 ETH at 2506.00 -> cleared to send

**Expected.** Cleared to send

### C808 · A valid buy of 7 ETH at 2507.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 7 ETH at 2507.00 -> cleared to send

**Expected.** Cleared to send

### C809 · A valid buy of 7 ETH at 2508.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 7 ETH at 2508.00 -> cleared to send

**Expected.** Cleared to send

### C810 · A valid buy of 7 ETH at 2509.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 7 ETH at 2509.00 -> cleared to send

**Expected.** Cleared to send

### C811 · A valid buy of 8 ETH at 2500.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 8 ETH at 2500.00 -> cleared to send

**Expected.** Cleared to send

### C812 · A valid buy of 8 ETH at 2501.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 8 ETH at 2501.00 -> cleared to send

**Expected.** Cleared to send

### C813 · A valid buy of 8 ETH at 2502.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 8 ETH at 2502.00 -> cleared to send

**Expected.** Cleared to send

### C814 · A valid buy of 8 ETH at 2503.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 8 ETH at 2503.00 -> cleared to send

**Expected.** Cleared to send

### C815 · A valid buy of 8 ETH at 2504.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 8 ETH at 2504.00 -> cleared to send

**Expected.** Cleared to send

### C816 · A valid buy of 8 ETH at 2505.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 8 ETH at 2505.00 -> cleared to send

**Expected.** Cleared to send

### C817 · A valid buy of 8 ETH at 2506.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 8 ETH at 2506.00 -> cleared to send

**Expected.** Cleared to send

### C818 · A valid buy of 8 ETH at 2507.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 8 ETH at 2507.00 -> cleared to send

**Expected.** Cleared to send

### C819 · A valid buy of 8 ETH at 2508.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 8 ETH at 2508.00 -> cleared to send

**Expected.** Cleared to send

### C820 · A valid buy of 8 ETH at 2509.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 8 ETH at 2509.00 -> cleared to send

**Expected.** Cleared to send

### C821 · A valid buy of 9 ETH at 2500.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 9 ETH at 2500.00 -> cleared to send

**Expected.** Cleared to send

### C822 · A valid buy of 9 ETH at 2501.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 9 ETH at 2501.00 -> cleared to send

**Expected.** Cleared to send

### C823 · A valid buy of 9 ETH at 2502.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 9 ETH at 2502.00 -> cleared to send

**Expected.** Cleared to send

### C824 · A valid buy of 9 ETH at 2503.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 9 ETH at 2503.00 -> cleared to send

**Expected.** Cleared to send

### C825 · A valid buy of 9 ETH at 2504.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 9 ETH at 2504.00 -> cleared to send

**Expected.** Cleared to send

### C826 · A valid buy of 9 ETH at 2505.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 9 ETH at 2505.00 -> cleared to send

**Expected.** Cleared to send

### C827 · A valid buy of 9 ETH at 2506.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 9 ETH at 2506.00 -> cleared to send

**Expected.** Cleared to send

### C828 · A valid buy of 9 ETH at 2507.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 9 ETH at 2507.00 -> cleared to send

**Expected.** Cleared to send

### C829 · A valid buy of 9 ETH at 2508.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 9 ETH at 2508.00 -> cleared to send

**Expected.** Cleared to send

### C830 · A valid buy of 9 ETH at 2509.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 9 ETH at 2509.00 -> cleared to send

**Expected.** Cleared to send

### C831 · A valid buy of 10 ETH at 2500.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 10 ETH at 2500.00 -> cleared to send

**Expected.** Cleared to send

### C832 · A valid buy of 10 ETH at 2501.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 10 ETH at 2501.00 -> cleared to send

**Expected.** Cleared to send

### C833 · A valid buy of 10 ETH at 2502.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 10 ETH at 2502.00 -> cleared to send

**Expected.** Cleared to send

### C834 · A valid buy of 10 ETH at 2503.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 10 ETH at 2503.00 -> cleared to send

**Expected.** Cleared to send

### C835 · A valid buy of 10 ETH at 2504.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 10 ETH at 2504.00 -> cleared to send

**Expected.** Cleared to send

### C836 · A valid buy of 10 ETH at 2505.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 10 ETH at 2505.00 -> cleared to send

**Expected.** Cleared to send

### C837 · A valid buy of 10 ETH at 2506.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 10 ETH at 2506.00 -> cleared to send

**Expected.** Cleared to send

### C838 · A valid buy of 10 ETH at 2507.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 10 ETH at 2507.00 -> cleared to send

**Expected.** Cleared to send

### C839 · A valid buy of 10 ETH at 2508.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 10 ETH at 2508.00 -> cleared to send

**Expected.** Cleared to send

### C840 · A valid buy of 10 ETH at 2509.00 clears to send

**Function** `RiskEngine.plan (valid)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order within every limit is cleared to send

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous limits
2. plan buy 10 ETH at 2509.00 -> cleared to send

**Expected.** Cleared to send

### C841 · Under dry run a buy of 1 ETH at 2500.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 1 ETH at 2500.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C842 · Under dry run a buy of 1 ETH at 2501.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 1 ETH at 2501.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C843 · Under dry run a buy of 1 ETH at 2502.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 1 ETH at 2502.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C844 · Under dry run a buy of 1 ETH at 2503.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 1 ETH at 2503.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C845 · Under dry run a buy of 1 ETH at 2504.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 1 ETH at 2504.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C846 · Under dry run a buy of 1 ETH at 2505.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 1 ETH at 2505.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C847 · Under dry run a buy of 1 ETH at 2506.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 1 ETH at 2506.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C848 · Under dry run a buy of 1 ETH at 2507.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 1 ETH at 2507.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C849 · Under dry run a buy of 1 ETH at 2508.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 1 ETH at 2508.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C850 · Under dry run a buy of 1 ETH at 2509.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 1 ETH at 2509.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C851 · Under dry run a buy of 2 ETH at 2500.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 2 ETH at 2500.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C852 · Under dry run a buy of 2 ETH at 2501.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 2 ETH at 2501.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C853 · Under dry run a buy of 2 ETH at 2502.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 2 ETH at 2502.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C854 · Under dry run a buy of 2 ETH at 2503.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 2 ETH at 2503.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C855 · Under dry run a buy of 2 ETH at 2504.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 2 ETH at 2504.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C856 · Under dry run a buy of 2 ETH at 2505.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 2 ETH at 2505.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C857 · Under dry run a buy of 2 ETH at 2506.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 2 ETH at 2506.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C858 · Under dry run a buy of 2 ETH at 2507.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 2 ETH at 2507.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C859 · Under dry run a buy of 2 ETH at 2508.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 2 ETH at 2508.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C860 · Under dry run a buy of 2 ETH at 2509.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 2 ETH at 2509.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C861 · Under dry run a buy of 3 ETH at 2500.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 3 ETH at 2500.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C862 · Under dry run a buy of 3 ETH at 2501.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 3 ETH at 2501.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C863 · Under dry run a buy of 3 ETH at 2502.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 3 ETH at 2502.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C864 · Under dry run a buy of 3 ETH at 2503.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 3 ETH at 2503.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C865 · Under dry run a buy of 3 ETH at 2504.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 3 ETH at 2504.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C866 · Under dry run a buy of 3 ETH at 2505.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 3 ETH at 2505.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C867 · Under dry run a buy of 3 ETH at 2506.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 3 ETH at 2506.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C868 · Under dry run a buy of 3 ETH at 2507.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 3 ETH at 2507.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C869 · Under dry run a buy of 3 ETH at 2508.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 3 ETH at 2508.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C870 · Under dry run a buy of 3 ETH at 2509.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 3 ETH at 2509.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C871 · Under dry run a buy of 4 ETH at 2500.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 4 ETH at 2500.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C872 · Under dry run a buy of 4 ETH at 2501.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 4 ETH at 2501.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C873 · Under dry run a buy of 4 ETH at 2502.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 4 ETH at 2502.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C874 · Under dry run a buy of 4 ETH at 2503.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 4 ETH at 2503.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C875 · Under dry run a buy of 4 ETH at 2504.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 4 ETH at 2504.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C876 · Under dry run a buy of 4 ETH at 2505.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 4 ETH at 2505.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C877 · Under dry run a buy of 4 ETH at 2506.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 4 ETH at 2506.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C878 · Under dry run a buy of 4 ETH at 2507.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 4 ETH at 2507.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C879 · Under dry run a buy of 4 ETH at 2508.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 4 ETH at 2508.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C880 · Under dry run a buy of 4 ETH at 2509.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 4 ETH at 2509.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C881 · Under dry run a buy of 5 ETH at 2500.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 5 ETH at 2500.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C882 · Under dry run a buy of 5 ETH at 2501.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 5 ETH at 2501.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C883 · Under dry run a buy of 5 ETH at 2502.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 5 ETH at 2502.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C884 · Under dry run a buy of 5 ETH at 2503.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 5 ETH at 2503.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C885 · Under dry run a buy of 5 ETH at 2504.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 5 ETH at 2504.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C886 · Under dry run a buy of 5 ETH at 2505.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 5 ETH at 2505.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C887 · Under dry run a buy of 5 ETH at 2506.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 5 ETH at 2506.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C888 · Under dry run a buy of 5 ETH at 2507.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 5 ETH at 2507.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C889 · Under dry run a buy of 5 ETH at 2508.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 5 ETH at 2508.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C890 · Under dry run a buy of 5 ETH at 2509.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 5 ETH at 2509.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C891 · Under dry run a buy of 6 ETH at 2500.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 6 ETH at 2500.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C892 · Under dry run a buy of 6 ETH at 2501.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 6 ETH at 2501.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C893 · Under dry run a buy of 6 ETH at 2502.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 6 ETH at 2502.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C894 · Under dry run a buy of 6 ETH at 2503.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 6 ETH at 2503.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C895 · Under dry run a buy of 6 ETH at 2504.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 6 ETH at 2504.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C896 · Under dry run a buy of 6 ETH at 2505.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 6 ETH at 2505.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C897 · Under dry run a buy of 6 ETH at 2506.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 6 ETH at 2506.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C898 · Under dry run a buy of 6 ETH at 2507.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 6 ETH at 2507.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C899 · Under dry run a buy of 6 ETH at 2508.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 6 ETH at 2508.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C900 · Under dry run a buy of 6 ETH at 2509.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 6 ETH at 2509.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C901 · Under dry run a buy of 7 ETH at 2500.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 7 ETH at 2500.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C902 · Under dry run a buy of 7 ETH at 2501.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 7 ETH at 2501.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C903 · Under dry run a buy of 7 ETH at 2502.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 7 ETH at 2502.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C904 · Under dry run a buy of 7 ETH at 2503.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 7 ETH at 2503.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C905 · Under dry run a buy of 7 ETH at 2504.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 7 ETH at 2504.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C906 · Under dry run a buy of 7 ETH at 2505.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 7 ETH at 2505.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C907 · Under dry run a buy of 7 ETH at 2506.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 7 ETH at 2506.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C908 · Under dry run a buy of 7 ETH at 2507.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 7 ETH at 2507.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C909 · Under dry run a buy of 7 ETH at 2508.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 7 ETH at 2508.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C910 · Under dry run a buy of 7 ETH at 2509.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 7 ETH at 2509.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C911 · Under dry run a buy of 8 ETH at 2500.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 8 ETH at 2500.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C912 · Under dry run a buy of 8 ETH at 2501.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 8 ETH at 2501.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C913 · Under dry run a buy of 8 ETH at 2502.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 8 ETH at 2502.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C914 · Under dry run a buy of 8 ETH at 2503.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 8 ETH at 2503.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C915 · Under dry run a buy of 8 ETH at 2504.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 8 ETH at 2504.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C916 · Under dry run a buy of 8 ETH at 2505.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 8 ETH at 2505.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C917 · Under dry run a buy of 8 ETH at 2506.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 8 ETH at 2506.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C918 · Under dry run a buy of 8 ETH at 2507.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 8 ETH at 2507.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C919 · Under dry run a buy of 8 ETH at 2508.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 8 ETH at 2508.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C920 · Under dry run a buy of 8 ETH at 2509.00 is planned but not sent

**Function** `RiskEngine.plan (dry-run)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** Dry run clears the order for inspection without sending it

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with dry run engaged
2. plan buy 8 ETH at 2509.00 -> cleared as dry-run

**Expected.** Cleared as a dry run

### C921 · A 0.0001 ETH order rounds to zero at the step and is refused

**Function** `RiskEngine.plan (zero-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A size below the market step floors to zero and is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with default limits
2. plan buy 0.0001 ETH at 2500 -> refused zero-size

**Expected.** Refused: zero-size

### C922 · A 0.0002 ETH order rounds to zero at the step and is refused

**Function** `RiskEngine.plan (zero-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A size below the market step floors to zero and is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with default limits
2. plan buy 0.0002 ETH at 2500 -> refused zero-size

**Expected.** Refused: zero-size

### C923 · A 0.0003 ETH order rounds to zero at the step and is refused

**Function** `RiskEngine.plan (zero-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A size below the market step floors to zero and is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with default limits
2. plan buy 0.0003 ETH at 2500 -> refused zero-size

**Expected.** Refused: zero-size

### C924 · A 0.0004 ETH order rounds to zero at the step and is refused

**Function** `RiskEngine.plan (zero-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A size below the market step floors to zero and is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with default limits
2. plan buy 0.0004 ETH at 2500 -> refused zero-size

**Expected.** Refused: zero-size

### C925 · A 0.0005 ETH order rounds to zero at the step and is refused

**Function** `RiskEngine.plan (zero-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A size below the market step floors to zero and is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with default limits
2. plan buy 0.0005 ETH at 2500 -> refused zero-size

**Expected.** Refused: zero-size

### C926 · A 0.0006 ETH order rounds to zero at the step and is refused

**Function** `RiskEngine.plan (zero-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A size below the market step floors to zero and is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with default limits
2. plan buy 0.0006 ETH at 2500 -> refused zero-size

**Expected.** Refused: zero-size

### C927 · A 0.0007 ETH order rounds to zero at the step and is refused

**Function** `RiskEngine.plan (zero-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A size below the market step floors to zero and is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with default limits
2. plan buy 0.0007 ETH at 2500 -> refused zero-size

**Expected.** Refused: zero-size

### C928 · A 0.0008 ETH order rounds to zero at the step and is refused

**Function** `RiskEngine.plan (zero-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A size below the market step floors to zero and is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with default limits
2. plan buy 0.0008 ETH at 2500 -> refused zero-size

**Expected.** Refused: zero-size

### C929 · A 0.0009 ETH order rounds to zero at the step and is refused

**Function** `RiskEngine.plan (zero-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A size below the market step floors to zero and is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with default limits
2. plan buy 0.0009 ETH at 2500 -> refused zero-size

**Expected.** Refused: zero-size

### C930 · A 0.001 SOL order rounds to zero at the step and is refused

**Function** `RiskEngine.plan (zero-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A size below the market step floors to zero and is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with default limits
2. plan buy 0.001 SOL at 2500 -> refused zero-size

**Expected.** Refused: zero-size

### C931 · A 0.002 SOL order rounds to zero at the step and is refused

**Function** `RiskEngine.plan (zero-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A size below the market step floors to zero and is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with default limits
2. plan buy 0.002 SOL at 2500 -> refused zero-size

**Expected.** Refused: zero-size

### C932 · A 0.003 SOL order rounds to zero at the step and is refused

**Function** `RiskEngine.plan (zero-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A size below the market step floors to zero and is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with default limits
2. plan buy 0.003 SOL at 2500 -> refused zero-size

**Expected.** Refused: zero-size

### C933 · A 0.004 SOL order rounds to zero at the step and is refused

**Function** `RiskEngine.plan (zero-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A size below the market step floors to zero and is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with default limits
2. plan buy 0.004 SOL at 2500 -> refused zero-size

**Expected.** Refused: zero-size

### C934 · A 0.005 SOL order rounds to zero at the step and is refused

**Function** `RiskEngine.plan (zero-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A size below the market step floors to zero and is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with default limits
2. plan buy 0.005 SOL at 2500 -> refused zero-size

**Expected.** Refused: zero-size

### C935 · A 0.006 SOL order rounds to zero at the step and is refused

**Function** `RiskEngine.plan (zero-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A size below the market step floors to zero and is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with default limits
2. plan buy 0.006 SOL at 2500 -> refused zero-size

**Expected.** Refused: zero-size

### C936 · A 0.007 SOL order rounds to zero at the step and is refused

**Function** `RiskEngine.plan (zero-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A size below the market step floors to zero and is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with default limits
2. plan buy 0.007 SOL at 2500 -> refused zero-size

**Expected.** Refused: zero-size

### C937 · A 0.008 SOL order rounds to zero at the step and is refused

**Function** `RiskEngine.plan (zero-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A size below the market step floors to zero and is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with default limits
2. plan buy 0.008 SOL at 2500 -> refused zero-size

**Expected.** Refused: zero-size

### C938 · A 0.009 SOL order rounds to zero at the step and is refused

**Function** `RiskEngine.plan (zero-size)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** A size below the market step floors to zero and is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with default limits
2. plan buy 0.009 SOL at 2500 -> refused zero-size

**Expected.** Refused: zero-size

### C939 · A buy of 0.001 ETH at 100 is under the minimum notional

**Function** `RiskEngine.plan (below-min-notional)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order whose notional is below the market minimum is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous size and position limits
2. plan buy 0.001 ETH at 100 (notional < $10) -> refused below-min-notional

**Expected.** Refused: below-min-notional

### C940 · A buy of 0.001 ETH at 200 is under the minimum notional

**Function** `RiskEngine.plan (below-min-notional)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order whose notional is below the market minimum is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous size and position limits
2. plan buy 0.001 ETH at 200 (notional < $10) -> refused below-min-notional

**Expected.** Refused: below-min-notional

### C941 · A buy of 0.001 ETH at 300 is under the minimum notional

**Function** `RiskEngine.plan (below-min-notional)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order whose notional is below the market minimum is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous size and position limits
2. plan buy 0.001 ETH at 300 (notional < $10) -> refused below-min-notional

**Expected.** Refused: below-min-notional

### C942 · A buy of 0.001 ETH at 400 is under the minimum notional

**Function** `RiskEngine.plan (below-min-notional)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order whose notional is below the market minimum is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous size and position limits
2. plan buy 0.001 ETH at 400 (notional < $10) -> refused below-min-notional

**Expected.** Refused: below-min-notional

### C943 · A buy of 0.001 ETH at 500 is under the minimum notional

**Function** `RiskEngine.plan (below-min-notional)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order whose notional is below the market minimum is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous size and position limits
2. plan buy 0.001 ETH at 500 (notional < $10) -> refused below-min-notional

**Expected.** Refused: below-min-notional

### C944 · A buy of 0.001 ETH at 600 is under the minimum notional

**Function** `RiskEngine.plan (below-min-notional)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order whose notional is below the market minimum is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous size and position limits
2. plan buy 0.001 ETH at 600 (notional < $10) -> refused below-min-notional

**Expected.** Refused: below-min-notional

### C945 · A buy of 0.001 ETH at 700 is under the minimum notional

**Function** `RiskEngine.plan (below-min-notional)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order whose notional is below the market minimum is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous size and position limits
2. plan buy 0.001 ETH at 700 (notional < $10) -> refused below-min-notional

**Expected.** Refused: below-min-notional

### C946 · A buy of 0.001 ETH at 800 is under the minimum notional

**Function** `RiskEngine.plan (below-min-notional)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order whose notional is below the market minimum is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous size and position limits
2. plan buy 0.001 ETH at 800 (notional < $10) -> refused below-min-notional

**Expected.** Refused: below-min-notional

### C947 · A buy of 0.001 ETH at 900 is under the minimum notional

**Function** `RiskEngine.plan (below-min-notional)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order whose notional is below the market minimum is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous size and position limits
2. plan buy 0.001 ETH at 900 (notional < $10) -> refused below-min-notional

**Expected.** Refused: below-min-notional

### C948 · A buy of 0.001 ETH at 1000 is under the minimum notional

**Function** `RiskEngine.plan (below-min-notional)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order whose notional is below the market minimum is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous size and position limits
2. plan buy 0.001 ETH at 1000 (notional < $10) -> refused below-min-notional

**Expected.** Refused: below-min-notional

### C949 · A buy of 0.001 ETH at 1100 is under the minimum notional

**Function** `RiskEngine.plan (below-min-notional)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order whose notional is below the market minimum is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous size and position limits
2. plan buy 0.001 ETH at 1100 (notional < $10) -> refused below-min-notional

**Expected.** Refused: below-min-notional

### C950 · A buy of 0.001 ETH at 1200 is under the minimum notional

**Function** `RiskEngine.plan (below-min-notional)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order whose notional is below the market minimum is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous size and position limits
2. plan buy 0.001 ETH at 1200 (notional < $10) -> refused below-min-notional

**Expected.** Refused: below-min-notional

### C951 · A buy of 0.001 ETH at 1300 is under the minimum notional

**Function** `RiskEngine.plan (below-min-notional)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order whose notional is below the market minimum is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous size and position limits
2. plan buy 0.001 ETH at 1300 (notional < $10) -> refused below-min-notional

**Expected.** Refused: below-min-notional

### C952 · A buy of 0.001 ETH at 1400 is under the minimum notional

**Function** `RiskEngine.plan (below-min-notional)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order whose notional is below the market minimum is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous size and position limits
2. plan buy 0.001 ETH at 1400 (notional < $10) -> refused below-min-notional

**Expected.** Refused: below-min-notional

### C953 · A buy of 0.001 ETH at 1500 is under the minimum notional

**Function** `RiskEngine.plan (below-min-notional)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order whose notional is below the market minimum is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous size and position limits
2. plan buy 0.001 ETH at 1500 (notional < $10) -> refused below-min-notional

**Expected.** Refused: below-min-notional

### C954 · A buy of 0.001 ETH at 1600 is under the minimum notional

**Function** `RiskEngine.plan (below-min-notional)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order whose notional is below the market minimum is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous size and position limits
2. plan buy 0.001 ETH at 1600 (notional < $10) -> refused below-min-notional

**Expected.** Refused: below-min-notional

### C955 · A buy of 0.001 ETH at 1700 is under the minimum notional

**Function** `RiskEngine.plan (below-min-notional)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order whose notional is below the market minimum is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous size and position limits
2. plan buy 0.001 ETH at 1700 (notional < $10) -> refused below-min-notional

**Expected.** Refused: below-min-notional

### C956 · A buy of 0.001 ETH at 1800 is under the minimum notional

**Function** `RiskEngine.plan (below-min-notional)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order whose notional is below the market minimum is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous size and position limits
2. plan buy 0.001 ETH at 1800 (notional < $10) -> refused below-min-notional

**Expected.** Refused: below-min-notional

### C957 · A buy of 0.001 ETH at 1900 is under the minimum notional

**Function** `RiskEngine.plan (below-min-notional)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order whose notional is below the market minimum is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous size and position limits
2. plan buy 0.001 ETH at 1900 (notional < $10) -> refused below-min-notional

**Expected.** Refused: below-min-notional

### C958 · A buy of 0.001 ETH at 2000 is under the minimum notional

**Function** `RiskEngine.plan (below-min-notional)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order whose notional is below the market minimum is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous size and position limits
2. plan buy 0.001 ETH at 2000 (notional < $10) -> refused below-min-notional

**Expected.** Refused: below-min-notional

### C959 · A buy of 0.001 ETH at 2100 is under the minimum notional

**Function** `RiskEngine.plan (below-min-notional)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order whose notional is below the market minimum is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous size and position limits
2. plan buy 0.001 ETH at 2100 (notional < $10) -> refused below-min-notional

**Expected.** Refused: below-min-notional

### C960 · A buy of 0.001 ETH at 2200 is under the minimum notional

**Function** `RiskEngine.plan (below-min-notional)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order whose notional is below the market minimum is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous size and position limits
2. plan buy 0.001 ETH at 2200 (notional < $10) -> refused below-min-notional

**Expected.** Refused: below-min-notional

### C961 · A buy of 0.001 ETH at 2300 is under the minimum notional

**Function** `RiskEngine.plan (below-min-notional)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order whose notional is below the market minimum is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous size and position limits
2. plan buy 0.001 ETH at 2300 (notional < $10) -> refused below-min-notional

**Expected.** Refused: below-min-notional

### C962 · A buy of 0.001 ETH at 2400 is under the minimum notional

**Function** `RiskEngine.plan (below-min-notional)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order whose notional is below the market minimum is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous size and position limits
2. plan buy 0.001 ETH at 2400 (notional < $10) -> refused below-min-notional

**Expected.** Refused: below-min-notional

### C963 · A buy of 0.001 ETH at 2500 is under the minimum notional

**Function** `RiskEngine.plan (below-min-notional)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order whose notional is below the market minimum is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous size and position limits
2. plan buy 0.001 ETH at 2500 (notional < $10) -> refused below-min-notional

**Expected.** Refused: below-min-notional

### C964 · A buy of 0.001 ETH at 2600 is under the minimum notional

**Function** `RiskEngine.plan (below-min-notional)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order whose notional is below the market minimum is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous size and position limits
2. plan buy 0.001 ETH at 2600 (notional < $10) -> refused below-min-notional

**Expected.** Refused: below-min-notional

### C965 · A buy of 0.001 ETH at 2700 is under the minimum notional

**Function** `RiskEngine.plan (below-min-notional)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order whose notional is below the market minimum is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous size and position limits
2. plan buy 0.001 ETH at 2700 (notional < $10) -> refused below-min-notional

**Expected.** Refused: below-min-notional

### C966 · A buy of 0.001 ETH at 2800 is under the minimum notional

**Function** `RiskEngine.plan (below-min-notional)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order whose notional is below the market minimum is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous size and position limits
2. plan buy 0.001 ETH at 2800 (notional < $10) -> refused below-min-notional

**Expected.** Refused: below-min-notional

### C967 · A buy of 0.001 ETH at 2900 is under the minimum notional

**Function** `RiskEngine.plan (below-min-notional)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order whose notional is below the market minimum is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous size and position limits
2. plan buy 0.001 ETH at 2900 (notional < $10) -> refused below-min-notional

**Expected.** Refused: below-min-notional

### C968 · A buy of 0.001 ETH at 3000 is under the minimum notional

**Function** `RiskEngine.plan (below-min-notional)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order whose notional is below the market minimum is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous size and position limits
2. plan buy 0.001 ETH at 3000 (notional < $10) -> refused below-min-notional

**Expected.** Refused: below-min-notional

### C969 · A buy of 0.001 ETH at 3100 is under the minimum notional

**Function** `RiskEngine.plan (below-min-notional)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order whose notional is below the market minimum is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous size and position limits
2. plan buy 0.001 ETH at 3100 (notional < $10) -> refused below-min-notional

**Expected.** Refused: below-min-notional

### C970 · A buy of 0.001 ETH at 3200 is under the minimum notional

**Function** `RiskEngine.plan (below-min-notional)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order whose notional is below the market minimum is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous size and position limits
2. plan buy 0.001 ETH at 3200 (notional < $10) -> refused below-min-notional

**Expected.** Refused: below-min-notional

### C971 · A buy of 0.001 ETH at 3300 is under the minimum notional

**Function** `RiskEngine.plan (below-min-notional)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order whose notional is below the market minimum is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous size and position limits
2. plan buy 0.001 ETH at 3300 (notional < $10) -> refused below-min-notional

**Expected.** Refused: below-min-notional

### C972 · A buy of 0.001 ETH at 3400 is under the minimum notional

**Function** `RiskEngine.plan (below-min-notional)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order whose notional is below the market minimum is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous size and position limits
2. plan buy 0.001 ETH at 3400 (notional < $10) -> refused below-min-notional

**Expected.** Refused: below-min-notional

### C973 · A buy of 0.001 ETH at 3500 is under the minimum notional

**Function** `RiskEngine.plan (below-min-notional)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order whose notional is below the market minimum is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous size and position limits
2. plan buy 0.001 ETH at 3500 (notional < $10) -> refused below-min-notional

**Expected.** Refused: below-min-notional

### C974 · A buy of 0.001 ETH at 3600 is under the minimum notional

**Function** `RiskEngine.plan (below-min-notional)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order whose notional is below the market minimum is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous size and position limits
2. plan buy 0.001 ETH at 3600 (notional < $10) -> refused below-min-notional

**Expected.** Refused: below-min-notional

### C975 · A buy of 0.001 ETH at 3700 is under the minimum notional

**Function** `RiskEngine.plan (below-min-notional)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order whose notional is below the market minimum is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous size and position limits
2. plan buy 0.001 ETH at 3700 (notional < $10) -> refused below-min-notional

**Expected.** Refused: below-min-notional

### C976 · A buy of 0.001 ETH at 3800 is under the minimum notional

**Function** `RiskEngine.plan (below-min-notional)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order whose notional is below the market minimum is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous size and position limits
2. plan buy 0.001 ETH at 3800 (notional < $10) -> refused below-min-notional

**Expected.** Refused: below-min-notional

### C977 · A buy of 0.001 ETH at 3900 is under the minimum notional

**Function** `RiskEngine.plan (below-min-notional)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order whose notional is below the market minimum is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous size and position limits
2. plan buy 0.001 ETH at 3900 (notional < $10) -> refused below-min-notional

**Expected.** Refused: below-min-notional

### C978 · A buy of 0.001 ETH at 4000 is under the minimum notional

**Function** `RiskEngine.plan (below-min-notional)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order whose notional is below the market minimum is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous size and position limits
2. plan buy 0.001 ETH at 4000 (notional < $10) -> refused below-min-notional

**Expected.** Refused: below-min-notional

### C979 · A buy of 0.001 ETH at 4100 is under the minimum notional

**Function** `RiskEngine.plan (below-min-notional)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order whose notional is below the market minimum is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous size and position limits
2. plan buy 0.001 ETH at 4100 (notional < $10) -> refused below-min-notional

**Expected.** Refused: below-min-notional

### C980 · A buy of 0.001 ETH at 4200 is under the minimum notional

**Function** `RiskEngine.plan (below-min-notional)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order whose notional is below the market minimum is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous size and position limits
2. plan buy 0.001 ETH at 4200 (notional < $10) -> refused below-min-notional

**Expected.** Refused: below-min-notional

### C981 · A buy of 0.001 ETH at 4300 is under the minimum notional

**Function** `RiskEngine.plan (below-min-notional)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order whose notional is below the market minimum is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous size and position limits
2. plan buy 0.001 ETH at 4300 (notional < $10) -> refused below-min-notional

**Expected.** Refused: below-min-notional

### C982 · A buy of 0.001 ETH at 4400 is under the minimum notional

**Function** `RiskEngine.plan (below-min-notional)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order whose notional is below the market minimum is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous size and position limits
2. plan buy 0.001 ETH at 4400 (notional < $10) -> refused below-min-notional

**Expected.** Refused: below-min-notional

### C983 · A buy of 0.001 ETH at 4500 is under the minimum notional

**Function** `RiskEngine.plan (below-min-notional)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order whose notional is below the market minimum is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous size and position limits
2. plan buy 0.001 ETH at 4500 (notional < $10) -> refused below-min-notional

**Expected.** Refused: below-min-notional

### C984 · A buy of 0.001 ETH at 4600 is under the minimum notional

**Function** `RiskEngine.plan (below-min-notional)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order whose notional is below the market minimum is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous size and position limits
2. plan buy 0.001 ETH at 4600 (notional < $10) -> refused below-min-notional

**Expected.** Refused: below-min-notional

### C985 · A buy of 0.001 ETH at 4700 is under the minimum notional

**Function** `RiskEngine.plan (below-min-notional)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order whose notional is below the market minimum is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous size and position limits
2. plan buy 0.001 ETH at 4700 (notional < $10) -> refused below-min-notional

**Expected.** Refused: below-min-notional

### C986 · A buy of 0.001 ETH at 4800 is under the minimum notional

**Function** `RiskEngine.plan (below-min-notional)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order whose notional is below the market minimum is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous size and position limits
2. plan buy 0.001 ETH at 4800 (notional < $10) -> refused below-min-notional

**Expected.** Refused: below-min-notional

### C987 · A buy of 0.001 ETH at 4900 is under the minimum notional

**Function** `RiskEngine.plan (below-min-notional)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order whose notional is below the market minimum is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous size and position limits
2. plan buy 0.001 ETH at 4900 (notional < $10) -> refused below-min-notional

**Expected.** Refused: below-min-notional

### C988 · A buy of 0.001 ETH at 5000 is under the minimum notional

**Function** `RiskEngine.plan (below-min-notional)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order whose notional is below the market minimum is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous size and position limits
2. plan buy 0.001 ETH at 5000 (notional < $10) -> refused below-min-notional

**Expected.** Refused: below-min-notional

### C989 · A buy of 0.001 ETH at 5100 is under the minimum notional

**Function** `RiskEngine.plan (below-min-notional)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order whose notional is below the market minimum is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous size and position limits
2. plan buy 0.001 ETH at 5100 (notional < $10) -> refused below-min-notional

**Expected.** Refused: below-min-notional

### C990 · A buy of 0.001 ETH at 5200 is under the minimum notional

**Function** `RiskEngine.plan (below-min-notional)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order whose notional is below the market minimum is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous size and position limits
2. plan buy 0.001 ETH at 5200 (notional < $10) -> refused below-min-notional

**Expected.** Refused: below-min-notional

### C991 · A buy of 0.001 ETH at 5300 is under the minimum notional

**Function** `RiskEngine.plan (below-min-notional)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order whose notional is below the market minimum is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous size and position limits
2. plan buy 0.001 ETH at 5300 (notional < $10) -> refused below-min-notional

**Expected.** Refused: below-min-notional

### C992 · A buy of 0.001 ETH at 5400 is under the minimum notional

**Function** `RiskEngine.plan (below-min-notional)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order whose notional is below the market minimum is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous size and position limits
2. plan buy 0.001 ETH at 5400 (notional < $10) -> refused below-min-notional

**Expected.** Refused: below-min-notional

### C993 · A buy of 0.001 ETH at 5500 is under the minimum notional

**Function** `RiskEngine.plan (below-min-notional)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order whose notional is below the market minimum is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous size and position limits
2. plan buy 0.001 ETH at 5500 (notional < $10) -> refused below-min-notional

**Expected.** Refused: below-min-notional

### C994 · A buy of 0.001 ETH at 5600 is under the minimum notional

**Function** `RiskEngine.plan (below-min-notional)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order whose notional is below the market minimum is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous size and position limits
2. plan buy 0.001 ETH at 5600 (notional < $10) -> refused below-min-notional

**Expected.** Refused: below-min-notional

### C995 · A buy of 0.001 ETH at 5700 is under the minimum notional

**Function** `RiskEngine.plan (below-min-notional)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order whose notional is below the market minimum is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous size and position limits
2. plan buy 0.001 ETH at 5700 (notional < $10) -> refused below-min-notional

**Expected.** Refused: below-min-notional

### C996 · A buy of 0.001 ETH at 5800 is under the minimum notional

**Function** `RiskEngine.plan (below-min-notional)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order whose notional is below the market minimum is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous size and position limits
2. plan buy 0.001 ETH at 5800 (notional < $10) -> refused below-min-notional

**Expected.** Refused: below-min-notional

### C997 · A buy of 0.001 ETH at 5900 is under the minimum notional

**Function** `RiskEngine.plan (below-min-notional)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order whose notional is below the market minimum is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous size and position limits
2. plan buy 0.001 ETH at 5900 (notional < $10) -> refused below-min-notional

**Expected.** Refused: below-min-notional

### C998 · A buy of 0.001 ETH at 6000 is under the minimum notional

**Function** `RiskEngine.plan (below-min-notional)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order whose notional is below the market minimum is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous size and position limits
2. plan buy 0.001 ETH at 6000 (notional < $10) -> refused below-min-notional

**Expected.** Refused: below-min-notional

### C999 · A buy of 0.001 ETH at 6100 is under the minimum notional

**Function** `RiskEngine.plan (below-min-notional)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order whose notional is below the market minimum is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous size and position limits
2. plan buy 0.001 ETH at 6100 (notional < $10) -> refused below-min-notional

**Expected.** Refused: below-min-notional

### C1000 · A buy of 0.001 ETH at 6200 is under the minimum notional

**Function** `RiskEngine.plan (below-min-notional)` · **Tier** BE/BOT · **Priority** Medium · **Run** Auto

**Purpose.** An order whose notional is below the market minimum is refused

**Precondition.** none -- the risk engine is a pure function

**Steps.**
1. risk engine with generous size and position limits
2. plan buy 0.001 ETH at 6200 (notional < $10) -> refused below-min-notional

**Expected.** Refused: below-min-notional

