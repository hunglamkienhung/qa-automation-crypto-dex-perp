# bot — risk gate and operations test cases

35 cases over the trading bot in `../node/be/bot` (risk gate pure; operations against PerpDEX). Generated from `bot.cases.js`; do not edit by hand.

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

