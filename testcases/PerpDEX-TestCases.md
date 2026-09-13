# PerpDEX — test cases

121 cases over the exchange in `../contracts`. Generated from `perpdex.cases.js`; do not edit by hand.

IDs are immutable and shared with `../fixtures/testcases.json`, which the automation binds to.

The last group is parameterised over the three deployed markets:

| Market | id | index | tick | step | min notional | max leverage | IM | MM |
|---|---|---|---|---|---|---|---|---|
| BTC-PERP | 0 | $60000 | 0.01 | 0.0001 | $10 | 50x | 2 % | 1 % |
| ETH-PERP | 1 | $2500 | 0.01 | 0.001 | $10 | 50x | 2 % | 1 % |
| SOL-PERP | 2 | $100 | 0.001 | 0.01 | $10 | 20x | 5 % | 2.5 % |

## 01. Accounts & collateral

### C43 · An account can be initialised exactly once

**Function** `initializeAccount` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** Every other call keys on account existence; a second init must not reset anything

**Precondition.** Fresh address, no account

**Steps.**
1. call initializeAccount() → expect event AccountInitialized(account)
2. call accountExists(account) → expect true
3. call initializeAccount() again → expect revert AccountExists()

**Expected.** First call succeeds and emits; second reverts AccountExists; getAccount(account).createdAt equals the first block timestamp

### C44 · Deposit before initialisation is rejected

**Function** `deposit` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** AccountNotFound must gate every mutating call, deposit included

**Precondition.** Address with USDC and approval, no account

**Steps.**
1. approve(vault, 100) then call deposit(100) → expect revert AccountNotFound()

**Expected.** Revert AccountNotFound; vault.balanceOf(account) stays 0

### C45 · Deposit moves tokens into the vault and credits the ledger by the same amount

**Function** `deposit` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** Tokens held and ledger recorded are two records that must agree

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. read vault.reserves() → (held0, ledger0)
2. call deposit(1000e6) → expect event Deposited(account, 1000e6)
3. read vault.balanceOf(account) → expect +1000e6
4. read vault.reserves() → expect held and ledger both +1000e6

**Expected.** held == ledger before and after; account balance +1000e6

### C46 · Withdrawal is capped at free collateral

**Function** `withdraw` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** Collateral locked behind open positions must not leave the vault

**Precondition.** Account with $1000 and a 1 ETH long at index

**Steps.**
1. read freeCollateral(account) → f
2. call withdraw(f + 1) → expect revert InsufficientCollateral(f, f+1)
3. call withdraw(f) → expect success
4. read freeCollateral(account) → expect ≤ 0

**Expected.** Exactly the free amount is withdrawable, one unit more is refused

### C47 · An account below zero can withdraw nothing

**Function** `withdraw` · **Tier** BE/Contract · **Priority** Medium · **Run** Auto

**Purpose.** Bad debt must not be extractable

**Precondition.** Account liquidated into negative balance with the insurance fund empty

**Steps.**
1. read vault.balanceOf(account) → expect < 0
2. call withdraw(1) → expect revert InsufficientCollateral

**Expected.** Revert; balance unchanged

### C48 · Zero-amount deposit and withdrawal are rejected

**Function** `deposit/withdraw` · **Tier** BE/Contract · **Priority** Low · **Run** Auto

**Purpose.** A zero movement would emit an event that means nothing

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. call deposit(0) → expect revert ZeroAmount()
2. call withdraw(0) → expect revert ZeroAmount()

**Expected.** Both revert ZeroAmount

### C49 · Only the exchange may move vault balances

**Function** `CollateralVault` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** The vault does bookkeeping; the exchange decides what is safe. No other caller may bypass that

**Precondition.** Any external address

**Steps.**
1. call vault.transferBetween(a, b, 1, "x") from a stranger → expect revert NotExchange()
2. call vault.withdrawFor(a, a, 1) from a stranger → expect revert NotExchange()

**Expected.** Both revert NotExchange

### C50 · getAccount reports existence, open orders and creation time

**Function** `getAccount` · **Tier** BE/Contract · **Priority** Low · **Run** Auto

**Purpose.** The account record is what a UI and an indexer read; each field must reflect state

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. call getAccount(account) → expect exists true, openOrders 0, createdAt == block.timestamp of init
2. place a resting limit → call getAccount → expect openOrders 1

**Expected.** Fields track state exactly

## 02. Markets & status

### C51 · Admin adds a market and it is immediately Active

**Function** `addMarket` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** Market creation is the root of every other test

**Precondition.** Admin key

**Steps.**
1. call addMarket("LINK-PERP", params) → expect returned id == marketCount before
2. read getMarket(id).status → expect Active
3. read getMarket(id).lastFundingTime → expect a multiple of fundingIntervalSec

**Expected.** id sequential; status Active; funding clock aligned to the interval

### C52 · A non-admin cannot add a market

**Function** `addMarket` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** Admin surface must be closed

**Precondition.** Non-admin key

**Steps.**
1. call addMarket(...) → expect revert NotAdmin()

**Expected.** Revert NotAdmin; marketCount unchanged

### C53 · Parameters that cannot work together are refused

**Function** `addMarket / setMarketParams` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** A market whose maintenance ≥ initial margin, or whose leverage exceeds what the margin supports, would misbehave silently

**Precondition.** Admin key

**Steps.**
1. params with maintenanceMarginBps == initialMarginBps → expect revert BadParams("maintenanceMarginBps")
2. params with initialMarginBps 200 and maxLeverage 100 → expect revert InvalidLeverage()
3. params with takerFeeBps 501 → expect revert BadParams("takerFeeBps")
4. params with makerFeeBps < -takerFeeBps → expect revert BadParams("makerFeeBps")

**Expected.** Each invalid combination reverts with the named reason

### C54 · The market count is capped

**Function** `addMarket` · **Tier** BE/Contract · **Priority** Low · **Run** Auto

**Purpose.** Per-account loops iterate every market; the cap bounds that cost

**Precondition.** Admin key

**Steps.**
1. add markets until marketCount == MAX_MARKETS
2. call addMarket once more → expect revert TooManyMarkets()

**Expected.** Revert at the cap

### C55 · A Paused market rejects every new order, including reducing ones

**Function** `setMarketStatus` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** Pause means no fills at all, not "no risk-increasing fills"

**Precondition.** Account with an open long on the market

**Steps.**
1. call setMarketStatus(m, Paused, 0)
2. place a reducing market sell → expect revert MarketPaused(m)
3. call cancelOrder on a resting order → expect success

**Expected.** Orders revert; cancels still work

### C56 · A ReduceOnly market accepts only orders that shrink a position

**Function** `setMarketStatus` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** Wind-down mode: no new risk

**Precondition.** Account long 2 units

**Steps.**
1. call setMarketStatus(m, ReduceOnly, 0)
2. place buy 1 → expect revert ReduceOnlyViolation()
3. place sell 3 (would flip) → expect revert ReduceOnlyViolation()
4. place sell 1 → expect fill; read getPosition → size 1

**Expected.** Growing and flipping orders revert; shrinking order fills

### C57 · Settling requires a settlement price and rejects orders

**Function** `setMarketStatus` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** A market being closed must have one price everyone settles at

**Precondition.** Admin key

**Steps.**
1. call setMarketStatus(m, Settling, 0) → expect revert BadParams("settlementPrice")
2. call setMarketStatus(m, Settling, 2600e8) → expect event MarketStatusChanged
3. place any order → expect revert MarketSettling(m)

**Expected.** Zero price refused; orders refused once Settling

### C58 · Anyone can settle a position at the settlement price

**Function** `settlePosition` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** Settlement is permissionless so a market can be closed without every holder acting

**Precondition.** Market Settling at 2600; alice long 1 from 2500, bob short 1 from 2500

**Steps.**
1. call settlePosition(alice, m) from a keeper → read getPosition(alice).size → expect 0; realizedPnl +100e6
2. call settlePosition(bob, m) → realizedPnl -100e6
3. call settlePosition(alice, m) again → expect revert NoPosition()

**Expected.** Both sides closed at 2600 with opposite PnL; second settle reverts

### C59 · settlePosition on an Active market reverts

**Function** `settlePosition` · **Tier** BE/Contract · **Priority** Medium · **Run** Auto

**Purpose.** Settlement must not be usable as a free close

**Precondition.** Active market with a position

**Steps.**
1. call settlePosition(account, m) → expect revert MarketNotSettling(m)

**Expected.** Revert

### C60 · Market getters return the configured parameters unchanged

**Function** `getMarket / getMarketParams` · **Tier** BE/Contract · **Priority** Low · **Run** Auto

**Purpose.** What was set is what is read; a decimal slip here would be silent

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. call getMarketParams(m) → compare every field with the params passed to addMarket

**Expected.** All sixteen fields equal

## 03. Order types × TIF

### C61 · A market order fills immediately at the best available price

**Function** `placeOrder(Market)` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** Market = take now; price is whatever the book (or backstop) offers

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. place Market buy 1 on an empty book → read getOrder(id).status → expect Filled
2. read getPosition.entryPrice → expect index × (1 + backstopSpread)

**Expected.** Filled in the same call, at the backstop ask

### C62 · A market order larger than available liquidity fills what it can and cancels the rest

**Function** `placeOrder(Market)` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** Market orders never rest

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. place Market buy of backstopMaxSize + 50 on an empty book
2. read getOrder(id).filled → expect backstopMaxSize; status Cancelled
3. expect event OrderCancelled(reason "unfilled")

**Expected.** Partial fill then Cancelled, never Open

### C63 · A GTC limit that does not cross rests on the book

**Function** `placeOrder(Limit, GTC)` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** Resting is what makes a book

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. place Limit buy 1 at index × 0.96 → read getOrder(id).status → expect Open
2. call getOrderBook(m, 5) → expect a bid level at that price with source 0

**Expected.** Open, visible on the book

### C64 · A limit that crosses fills at the resting price, not its own

**Function** `placeOrder(Limit, GTC)` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** Price improvement goes to the taker

**Precondition.** Resting ask at P

**Steps.**
1. place Limit buy at P + 20 ticks → read getPosition.entryPrice → expect P

**Expected.** Entry == resting price

### C65 · A GTC limit partially filled rests for the remainder

**Function** `placeOrder(Limit, GTC)` · **Tier** BE/Contract · **Priority** Medium · **Run** Auto

**Purpose.** GTC keeps working after a partial fill

**Precondition.** Resting ask 1 at P

**Steps.**
1. place Limit buy 3 at P → read getOrder(id) → expect filled 1, status Open, size 3

**Expected.** Remainder 2 rests

### C66 · IOC fills what crosses and cancels the remainder

**Function** `placeOrder(Limit, IOC)` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** IOC never rests

**Precondition.** Resting ask 1 at P; backstop ask above P

**Steps.**
1. place Limit IOC buy 3 at P → read getOrder(id) → expect filled 1, status Cancelled
2. read getAccount.openOrders → expect 0

**Expected.** Partial fill, remainder cancelled, no slot held

### C67 · FOK reverts when the full size cannot be filled, taking nothing

**Function** `placeOrder(Limit, FOK)` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** All-or-nothing must not leave a partial behind

**Precondition.** Resting ask 1 at P; backstop ask above P

**Steps.**
1. place Limit FOK buy 2 at P → expect revert FillOrKillUnfillable(1, 2)
2. read the resting ask → expect filled 0

**Expected.** Revert; resting order untouched

### C68 · FOK fills completely when liquidity suffices

**Function** `placeOrder(Limit, FOK)` · **Tier** BE/Contract · **Priority** Medium · **Run** Auto

**Purpose.** The positive side of all-or-nothing

**Precondition.** Resting ask 1 at P

**Steps.**
1. place Limit FOK buy 1 at P → read getOrder(id).status → expect Filled

**Expected.** Filled

### C69 · FOK counts the backstop when the limit reaches its quote

**Function** `placeOrder(Limit, FOK)` · **Tier** BE/Contract · **Priority** Medium · **Run** Auto

**Purpose.** The backstop is liquidity; FOK must see it

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. place Limit FOK buy 50 at index × (1 + spread) + 1 tick on an empty book → expect Filled at the backstop ask

**Expected.** Filled against the backstop

### C70 · PostOnly rests when it does not cross

**Function** `placeOrder(Limit, PostOnly)` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** Maker-only orders that make

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. place PostOnly buy at index × 0.996 (inside the backstop spread) → expect status Open

**Expected.** Open

### C71 · PostOnly that would cross is rejected with the best opposite price

**Function** `placeOrder(Limit, PostOnly)` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** A maker-only order must never take; the error tells the client where the touch is

**Precondition.** Resting ask at P above the backstop ask B

**Steps.**
1. place PostOnly buy at P → expect revert PostOnlyWouldCross(P, B) — B is the better of book and backstop

**Expected.** Revert names the backstop price when it is better than the book

### C72 · A stop order parks as Pending and holds a slot without executing

**Function** `placeOrder(StopMarket)` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** Trigger orders wait; they must not touch the position

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. place StopMarket buy trigger index + 100 → read getOrder(id).status → expect Pending
2. read pendingTriggerIds(m) → contains id
3. read getPosition.size → expect 0; getAccount.openOrders → 1

**Expected.** Pending, slot taken, no fill

### C73 · A keeper triggers a stop once the source price crosses it

**Function** `triggerOrder` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** Permissionless triggering is the keeper role

**Precondition.** Pending buy-stop at T on the Index source

**Steps.**
1. call triggerOrder(id) with index < T → expect revert TriggerNotMet(T, index)
2. setMockPrice(m, T)
3. call triggerOrder(id) from any address → expect event OrderTriggered; status Filled; position size +1

**Expected.** Refused below trigger, executes at/above

### C74 · A stop-limit becomes a limit at its price after triggering

**Function** `placeOrder(StopLimit)` · **Tier** BE/Contract · **Priority** Medium · **Run** Auto

**Purpose.** Stop-limit = trigger then limit, not trigger then market

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. place StopLimit buy trigger T, limit T + 10 → setMockPrice(T) → triggerOrder(id)
2. read entryPrice → expect the backstop ask at T (below the limit), not the limit itself

**Expected.** Fills at the best price ≤ limit

### C75 · Take-profit triggers in the opposite direction to a stop

**Function** `placeOrder(TakeProfit)` · **Tier** BE/Contract · **Priority** Medium · **Run** Auto

**Purpose.** Sell TP fires when price RISES to the trigger; a sell stop fires when it FALLS

**Precondition.** Long 1; TakeProfit sell reduceOnly at index + 100

**Steps.**
1. triggerOrder(id) at index → expect revert TriggerNotMet
2. setMockPrice(index + 100) → triggerOrder(id) → position size 0

**Expected.** Fires upward, closes the long

### C76 · Mark and Index trigger sources are distinct

**Function** `triggerOrder` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** Mark can differ from index by the basis; a client chooses which one fires the stop

**Precondition.** Last fill above index so mark > index

**Steps.**
1. place two buy-stops at a trigger between index and mark: one Mark-sourced, one Index-sourced
2. triggerOrder(markOne) → expect success
3. triggerOrder(indexOne) → expect revert TriggerNotMet

**Expected.** Only the Mark-sourced order fires

### C77 · maxTs is compared to the chain clock in microseconds, and equality is not expiry

**Function** `placeOrder` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** Clients that use wall-clock seconds get silently wrong behaviour; the unit is documented by this test

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. read clockMicros() → c
2. place with maxTs = c - 1 → expect revert OrderExpired(c-1, c)
3. place with maxTs = c → expect success

**Expected.** Strictly-less is expired; equal is live

## 04. Book & matching

### C78 · Price priority, then time priority

**Function** `matching` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** The core promise of a book

**Precondition.** Asks: A at P (first), B at P+1, C at P (later)

**Steps.**
1. place Market buy 1.5 → expect A Filled, C filled 0.5, B filled 0

**Expected.** Best price first; within a price, earlier first

### C79 · getOrderBook aggregates same-price orders into one level

**Function** `getOrderBook` · **Tier** BE/Contract · **Priority** Medium · **Run** Auto

**Purpose.** A depth view, not an order list

**Precondition.** Two asks at P of 1 each

**Steps.**
1. call getOrderBook(m, 5) → expect one ask level at P with size 2

**Expected.** Aggregated

### C80 · The backstop appears on both sides of the book with source 1

**Function** `getOrderBook` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** A reader must be able to tell venue liquidity from trader liquidity

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. call getOrderBook(m, 5) on an empty book → expect one bid at index × (1 − spread) and one ask at index × (1 + spread), both source 1, size backstopMaxSize

**Expected.** Two backstop levels, source 1

### C81 · A better book price is taken before the backstop, and the backstop fills the rest

**Function** `matching` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** The backstop is last resort, not first

**Precondition.** Resting ask 1 at P below the backstop ask

**Steps.**
1. place Market buy 2 → expect entry = blended (P, backstopAsk); resting order Filled; backstop position −1

**Expected.** Book first, then backstop

### C82 · An unfunded backstop does not quote

**Function** `matching` · **Tier** BE/Contract · **Priority** Medium · **Run** Auto

**Purpose.** The backstop quotes only what it can settle

**Precondition.** Backstop drained to zero

**Steps.**
1. call getOrderBook(m, 5) → expect no source-1 levels
2. place Market buy 1 on an empty book → expect status Cancelled, filled 0

**Expected.** No backstop liquidity

### C83 · Self-trade is prevented

**Function** `matching` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** An account matching itself would fake volume and fees

**Precondition.** Own resting ask at P

**Steps.**
1. place own Limit buy at P → expect revert SelfTradePrevented(restingId)

**Expected.** Revert naming the resting order

### C84 · Cancel removes the order from the book and frees the slot

**Function** `cancelOrder` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** A cancelled order must vanish from every view

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. place resting limit → cancelOrder(id) → expect event OrderCancelled(reason "user")
2. read getOrder(id).status → Cancelled; getAccount.openOrders → 0; getOrderBook → level gone

**Expected.** Gone from status, count and book

### C85 · Only the owner can cancel

**Function** `cancelOrder` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** Otherwise anyone could clear the book

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. cancelOrder(id) from another account → expect revert NotOrderOwner()

**Expected.** Revert

### C86 · cancelAll is scoped by market, or all markets with the sentinel

**Function** `cancelAll` · **Tier** BE/Contract · **Priority** Medium · **Run** Auto

**Purpose.** Kill-switch semantics

**Precondition.** Two resting orders on ETH, one on BTC

**Steps.**
1. cancelAll(ETH) → expect return 2; openOrders 1
2. cancelAll(0xFFFF) → expect return 1; openOrders 0

**Expected.** Counts and remaining slots match

## 05. Positions

### C87 · Adding to a position blends the entry by volume

**Function** `position` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** Average entry is what PnL is computed from

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. buy 1 at 2500, buy 1 at 2501 → read getPosition → size 2, entryPrice 2500.50

**Expected.** Volume-weighted entry

### C88 · Reducing realises PnL at the fill price and leaves the entry unchanged

**Function** `position` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** Partial close arithmetic

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. long 2 at 2500; sell 1 at 2502 → read getPosition → size 1, entryPrice 2500, realizedPnl +2e6
2. read balance delta → +2e6 − taker fee

**Expected.** Entry kept; realised +2; balance moved by pnl − fee

### C89 · A fill larger than the position flips it, closing at the old entry and opening at the fill

**Function** `position` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** Netting through zero

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. long 1 at 2500; sell 3 at 2498 → read getPosition → size −2, entryPrice 2498, realizedPnl −2e6

**Expected.** Closed 1 for −2, new short 2 at 2498

### C90 · Closing to flat clears the entry and removes the holder

**Function** `position` · **Tier** BE/Contract · **Priority** Medium · **Run** Auto

**Purpose.** A flat position must not leave stale state for ADL ranking

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. long 1; sell 1 → read getPosition → size 0, entryPrice 0
2. read holdersOf(m) → does not contain the account

**Expected.** Clean flat

### C91 · Unrealised PnL in equity follows the mark, not the index

**Function** `equity` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** Equity is marked at the mark; the difference matters exactly when the basis is non-zero

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. long 1 at 2500 (mark 2500); setMockPrice(2600) → mark clamps to 2574
2. read equity delta → expect +74e6, not +100e6

**Expected.** Equity moves by the clamped mark

### C92 · Open interest is tracked on both sides and always equal

**Function** `getMarket` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** Every long has a short; a drift would mean a lost position

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. after any fills read getMarket(m).openInterestLong and openInterestShort → expect equal
2. after a reduce → both decreased by the closed size

**Expected.** Long OI == short OI at every step

### C93 · Estimated liquidation price sits below entry for a long and above for a short

**Function** `estimatedLiquidationPrice` · **Tier** BE/Contract · **Priority** Low · **Run** Auto

**Purpose.** The figure a UI shows must at least point the right way

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. long 1 with thin collateral → read estimatedLiquidationPrice → expect 0 < value < entry
2. short 1 → expect value > entry

**Expected.** Correct side of entry

## 06. Price

### C94 · Mark equals index until the first fill

**Function** `getMarkPrice` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** No trade, no basis

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. on a fresh market read getMarkPrice(m) → expect == getIndexPrice(m)

**Expected.** Equal

### C95 · Mark is the last fill clamped to index ± maxBasis

**Function** `getMarkPrice` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** A single trade cannot drag the mark arbitrarily far from the index

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. fill at index × 1.008 → read getMarkPrice → expect index × 1.008
2. setMockPrice(index × 0.96) → read getMarkPrice → expect newIndex × 1.01 (the clamp)

**Expected.** Inside the band: last fill; outside: the band edge

### C96 · Limit prices outside index ± band are refused on both sides, and the edge is accepted

**Function** `placeOrder` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** Fat-finger protection; the boundary must be inclusive

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. place Limit buy at lower − 1 tick → expect revert PriceOutOfBand(p, lower, upper)
2. place Limit sell at upper + 1 tick → expect revert
3. place Limit buy at exactly lower → expect success

**Expected.** Outside refused, edge accepted

### C97 · Anyone can set the mock index until the market is locked

**Function** `OracleRouter.setMockPrice` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** A scenario must be able to drive price without an admin key

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. setMockPrice(m, p) from a non-admin → read getIndexPrice → expect p

**Expected.** Accepted from any caller

### C98 · Locking the mock is admin-only and one-way; the admin feed still works

**Function** `OracleRouter.lockMock` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** The switch a real deployment flips, and it must not flip back

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. lockMock(m) from non-admin → expect revert NotAdmin
2. lockMock(m) from admin → setMockPrice from anyone → expect revert MockIsLocked(m)
3. setPrice(m, p) from admin → expect getIndexPrice == p
4. expect no unlock function in the ABI

**Expected.** Locked forever for the mock; admin feed unaffected

### C99 · A reading older than maxAge reverts OracleStale; exactly maxAge is fresh

**Function** `OracleRouter.getIndexPrice` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** Staleness boundary is inclusive

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. setMockReading(m, p, now − maxAge − 1) → getIndexPrice → expect revert OracleStale(m, t, maxAge); peek → isStale true
2. setMockReading(m, p, now − maxAge) → getIndexPrice → expect p

**Expected.** Boundary inclusive

## 07. Funding

### C100 · updateFunding is permissionless and a no-op inside the interval

**Function** `updateFunding` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** Keeper role; must not advance early

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. call updateFunding(m) from a stranger inside the interval → expect return false; getFundingRate → rate 0, index 0

**Expected.** Accepted, no advance

### C101 · lastFundingTime always lands on an interval boundary

**Function** `updateFunding` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** The contract computes the boundary, not the call time

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. warp to boundary + 1234 s → updateFunding → read getFundingRate.lastFundingTime → expect % interval == 0 and == now − now % interval

**Expected.** Aligned

### C102 · A positive premium makes longs pay and shorts receive

**Function** `updateFunding` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** Sign convention

**Precondition.** Mark above index after a fill

**Steps.**
1. warp one interval → updateFunding → read rate → expect > 0
2. touch both positions → long balance delta < 0, short balance delta > 0 (net of fees)

**Expected.** Longs pay

### C103 · The rate is clamped to ± fundingRateCapBps

**Function** `FundingMath.rateBps` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** A wild premium must not produce a ruinous rate

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. rateBps(500, 1, 75) → 75; rateBps(−500, 1, 75) → −75; rateBps(30, 1, 75) → 30

**Expected.** Clamped both ways

### C104 · The rate is the average of premium samples

**Function** `FundingMath` · **Tier** BE/Contract · **Priority** Medium · **Run** Auto

**Purpose.** TWAP, not last sample

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. samples +10, +20, +30 → rateBps → 20
2. premiumBps(2525, 2500) → 100; premiumBps(2475, 2500) → −100

**Expected.** Average and sign correct

### C105 · Funding owed reduces equity before it is settled

**Function** `equity` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** Owed funding is a liability now, not when the position is touched

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. long with premium → warp → updateFunding → read equity → expect lower than before, with no fill on the account

**Expected.** Equity reflects owed funding immediately

## 08. Liquidation

### C106 · An account above maintenance cannot be liquidated

**Function** `liquidate` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** The negative case

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. isLiquidatable(a) → false
2. liquidate(a, m) → expect revert NotLiquidatable(a)

**Expected.** Revert

### C107 · The threshold is exact: no buffer on either side

**Function** `isLiquidatable / liquidate` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** isLiquidatable and liquidate must flip at the same tick

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. walk the index down $0.10 at a time; at each step: if !isLiquidatable → liquidate reverts NotLiquidatable; at the first true → equity < maintenance and liquidate succeeds

**Expected.** Flag and function agree at every tick

### C108 · Liquidation closes partialLiquidationBps of the position and pays the liquidator

**Function** `liquidate` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** Partial, not full, while the account stays solvent

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. liquidate(a, m) → read getPosition.size → expect half
2. read liquidator balance delta → expect liquidationFeeBps × closed notional
3. read getAccount(a) → liquidationCount 1, lastLiquidatedAt == now

**Expected.** Half closed; fee paid; account flagged

### C109 · A remainder below minNotional is closed in full

**Function** `liquidate` · **Tier** BE/Contract · **Priority** Medium · **Run** Auto

**Purpose.** No dust positions

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. position whose half would be < minNotional → liquidate → read size → expect 0

**Expected.** Full close

### C110 · Bad debt is covered by the insurance fund

**Function** `liquidate` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** The fund exists for this

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. crash the index far past the collateral → liquidate → read vault.balanceOf(a) → expect ≥ 0; insurance balance decreased by the deficit
2. expect event Liquidated with badDebt > 0 and insuranceUsed == badDebt

**Expected.** Account restored to zero from the fund

### C111 · Once the balance is negative the rest of the position is closed in the same call

**Function** `liquidate` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** Otherwise the counterparties deleveraged in this round are gone when the next round needs them

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. crash deep → single liquidate → read getPosition.size → expect 0; liquidationCount 1

**Expected.** One call, whole position

### C112 · A paused exchange blocks liquidation

**Function** `liquidate` · **Tier** BE/Contract · **Priority** Medium · **Run** Auto

**Purpose.** Pause is total

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. setPaused(true) → liquidate → expect revert ExchangePaused()

**Expected.** Revert

### C113 · The liquidation flag is visible through a getter

**Function** `getAccount` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** A liquidated account must be identifiable; hidden state is the trap

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. read getAccount(a).liquidationCount before → 0; after a liquidation → 1; lastLiquidatedAt == that block

**Expected.** Exposed, not hidden

## 09. Auto-deleveraging

### C114 · ADL fires only when the insurance fund cannot cover the deficit

**Function** `_autoDeleverage` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** ADL is the last resort

**Precondition.** Insurance fund drained; a profitable short opposite the bankrupt long

**Steps.**
1. liquidate(bankrupt) → expect event AutoDeleveraged(short holder); short position 0; bankrupt balance ≥ 0

**Expected.** Counterparty closed; deficit socialised

### C115 · ADL does not fire while the fund can pay

**Function** `_autoDeleverage` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** Profitable traders are untouched when the fund suffices

**Precondition.** Insurance fund funded

**Steps.**
1. liquidate(bankrupt) → expect no AutoDeleveraged event; short holder position unchanged

**Expected.** No ADL

### C116 · ADL picks the most profitable, largest opposite position first

**Function** `_autoDeleverage` · **Tier** BE/Contract · **Priority** Medium · **Run** Auto

**Purpose.** Ranking rule

**Precondition.** Two shorts: one large in profit, one small

**Steps.**
1. liquidate(bankrupt) with a deficit the large short covers alone → expect only the large short closed

**Expected.** Highest score first; stops when covered

## 10. Fees

### C117 · The taker pays takerFeeBps of notional

**Function** `_fill` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** Fee arithmetic

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. taker fills 2501 notional at 5 bps → balance delta −1.2505e6 (plus pnl if any)

**Expected.** Exact bps

### C118 · A negative maker fee is a rebate credited to the maker

**Function** `_fill` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** Maker incentive

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. maker with −2 bps on 2501 notional → balance delta +0.5002e6

**Expected.** Credited

### C119 · Net fee is split between treasury and insurance by feeToInsuranceBps

**Function** `_fill` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** Where the money goes

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. taker 1.25, rebate 0.50 → net 0.75 at 50 % → treasury +0.375e6, insurance +0.375e6

**Expected.** Split exact

### C120 · setFees applies to the next fill

**Function** `setFees` · **Tier** BE/Contract · **Priority** Medium · **Run** Auto

**Purpose.** Admin fee change is live immediately

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. setFees(m, 0, 10) → market buy 1 → balance delta −10 bps of notional

**Expected.** New rate applied

## 11. Admin

### C121 · Every admin function rejects a non-admin

**Function** `onlyAdmin` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** Closed surface

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. from a stranger call setPaused, setMarketStatus, setFees, transferAdmin, addMarket, setMarketParams → each expect revert NotAdmin()

**Expected.** All revert

### C122 · Admin handover is two-step and only the pending admin can accept

**Function** `transferAdmin / acceptAdmin` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** A typo in the new address must not lose the key

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. transferAdmin(new) → read admin → unchanged; pendingAdmin → new
2. acceptAdmin from a stranger → expect revert PendingAdminMismatch()
3. acceptAdmin from new → admin == new; pendingAdmin == 0
4. old admin calls setPaused → expect revert NotAdmin

**Expected.** Two steps; old key dead after

### C123 · acceptAdmin with nothing pending reverts

**Function** `acceptAdmin` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** pendingAdmin == 0 is "nothing to accept", not "anyone may accept"

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. acceptAdmin from any address with pendingAdmin == 0 → expect revert PendingAdminMismatch()

**Expected.** Revert

### C124 · Pause blocks orders and triggers but not cancels or withdrawals

**Function** `setPaused` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** Users must always be able to reduce exposure to the venue

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. setPaused(true) → placeOrder → revert ExchangePaused; triggerOrder → revert ExchangePaused
2. cancelOrder → success; withdraw → success
3. setPaused(false) → placeOrder → success

**Expected.** Exactly the mutating-risk paths are blocked

### C125 · ExchangePaused is checked before AccountNotFound

**Function** `placeOrder` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** Gate order, first pair

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. setPaused(true) → placeOrder from an address with no account → expect revert ExchangePaused, not AccountNotFound

**Expected.** Pause wins

### C126 · AccountNotFound is checked before MarketPaused

**Function** `placeOrder` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** Gate order, second pair

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. setMarketStatus(m, Paused) → placeOrder from an address with no account → expect revert AccountNotFound, not MarketPaused

**Expected.** Account wins

### C127 · setMarketParams replaces the parameter set and is validated like addMarket

**Function** `setMarketParams` · **Tier** BE/Contract · **Priority** Medium · **Run** Auto

**Purpose.** Live retuning with the same guard rails

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. setMarketParams(m, valid) → getMarketParams == valid; event MarketParamsSet
2. setMarketParams(m, invalid) → revert BadParams

**Expected.** Applied or refused with reason

## 12. Events

### C128 · OrderPlaced carries every order parameter

**Function** `OrderPlaced` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** The indexer rebuilds orders from this event alone

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. placeOrder → decode OrderPlaced → expect orderId, owner, marketId (indexed), side, type, tif, size, price, triggerPrice, reduceOnly, userOrderId, maxTs all equal to the params

**Expected.** Field-for-field

### C129 · OrderFilled names the maker, and zero for the backstop

**Function** `OrderFilled` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** A reader distinguishes trader liquidity from venue liquidity by this field

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. market buy 2 with 1 resting from bob → expect two OrderFilled: maker bob then maker 0x0; makerOrderId set then 0

**Expected.** Maker address zero ⇔ backstop

### C130 · OrderCancelled carries the unfilled size and a reason

**Function** `OrderCancelled` · **Tier** BE/Contract · **Priority** Medium · **Run** Auto

**Purpose.** Reasons: user, cancelall, ioc, unfilled, fok, postonly, margin, reduceonly

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. cancel a half-filled order → expect unfilled == size − filled, reason "user"
2. IOC remainder → reason "ioc"; market remainder → "unfilled"

**Expected.** Reason matches the path

### C131 · PositionChanged reports before/after size, entry, realised delta and funding paid

**Function** `PositionChanged` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** One event per side per fill is what the positions table is built from

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. fill → expect PositionChanged for taker and maker with sizeBefore/sizeAfter consistent with getPosition

**Expected.** Two events per fill, consistent with state

### C132 · FundingUpdated reports rate, cumulative index, boundary time and sample count

**Function** `FundingUpdated` · **Tier** BE/Contract · **Priority** Medium · **Run** Auto

**Purpose.** Funding history is rebuilt from this

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. updateFunding across a boundary → expect FundingUpdated(m, rate, index, boundaryTime, samples ≥ 1)

**Expected.** All fields set

### C133 · Liquidated reports size, price, fee, bad debt and insurance used

**Function** `Liquidated` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** The liquidations table and the insurance accounting come from here

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. liquidate → expect Liquidated(account, m, liquidator, sizeClosed, mark, fee, badDebt, insuranceUsed) with insuranceUsed ≤ badDebt

**Expected.** Fields consistent with balances

## 13. Per-market

### C134 · BTC: size off the step is refused (step 0.0001)

**Function** `placeOrder` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** Step is per market; a value that is valid on one market must be refused on another

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. place size = step + 1 unit on market 0 → expect revert InvalidStep(size, step)

**Expected.** Revert with the market's own step

### C135 · BTC: price off the tick is refused (tick 0.01)

**Function** `placeOrder` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** Tick is per market

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. place Limit at price = tick multiple + 1 unit on market 0 → expect revert InvalidTick(price, tick)

**Expected.** Revert with the market's own tick

### C136 · BTC: the price band is index ± 5 % around 60000

**Function** `placeOrder` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** Band bounds derive from each market's index

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. compute lower/upper from getIndexPrice(0) → place at lower − tick → revert PriceOutOfBand(p, lower, upper); place at lower → success

**Expected.** Bounds computed from this market's index

### C137 · BTC: notional below $10 is refused

**Function** `placeOrder` · **Tier** BE/Contract · **Priority** Medium · **Run** Auto

**Purpose.** Min notional is evaluated at the limit price or the index

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. place the smallest step size whose notional < 10 → expect revert BelowMinNotional(n, min)

**Expected.** Revert with the computed notional

### C138 · BTC: initial margin is 2 % of notional

**Function** `placeOrder` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** IM differs per market; the InsufficientCollateral error must report the market's requirement

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. fund exactly IM − 1 unit; place 1 unit at index → expect revert InsufficientCollateral(free, required) with required == notional × IM

**Expected.** Required equals this market's IM

### C139 · BTC: liquidation at 2x leverage happens far from entry

**Function** `liquidate` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** Maintenance ${m.mm}: at 2x the price must fall ~half before liquidation

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. open 1 unit with collateral = 50 % of notional; walk the index down; record the first liquidatable index → expect drop ≈ (50 % − MM) of entry

**Expected.** Threshold matches equity == MM arithmetic

### C140 · BTC: liquidation at 10x leverage

**Function** `liquidate` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** Same rule, 10 % collateral

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. open 1 unit with collateral = 10 % of notional; walk the index down; first liquidatable index → expect drop ≈ (10 % − MM) of entry

**Expected.** Threshold matches

### C141 · BTC: liquidation at max leverage (50x)

**Function** `liquidate` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** Thinnest allowed collateral: liquidation is one small move away

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. open 1 unit with collateral = IM exactly; walk the index down → expect liquidatable within (IM − MM) of entry

**Expected.** Threshold matches

### C142 · BTC: positive premium → positive rate, longs pay

**Function** `updateFunding` · **Tier** BE/Contract · **Priority** Medium · **Run** Auto

**Purpose.** Funding sign per market

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. fill above index on market 0; warp one interval; updateFunding → rate > 0; long balance decreases on next touch

**Expected.** Rate > 0, longs pay

### C143 · BTC: negative premium → negative rate, shorts pay

**Function** `updateFunding` · **Tier** BE/Contract · **Priority** Medium · **Run** Auto

**Purpose.** Funding sign per market, other direction

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. fill below index on market 0; warp one interval; updateFunding → rate < 0; short balance decreases on next touch

**Expected.** Rate < 0, shorts pay

### C144 · ETH: size off the step is refused (step 0.001)

**Function** `placeOrder` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** Step is per market; a value that is valid on one market must be refused on another

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. place size = step + 1 unit on market 1 → expect revert InvalidStep(size, step)

**Expected.** Revert with the market's own step

### C145 · ETH: price off the tick is refused (tick 0.01)

**Function** `placeOrder` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** Tick is per market

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. place Limit at price = tick multiple + 1 unit on market 1 → expect revert InvalidTick(price, tick)

**Expected.** Revert with the market's own tick

### C146 · ETH: the price band is index ± 5 % around 2500

**Function** `placeOrder` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** Band bounds derive from each market's index

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. compute lower/upper from getIndexPrice(1) → place at lower − tick → revert PriceOutOfBand(p, lower, upper); place at lower → success

**Expected.** Bounds computed from this market's index

### C147 · ETH: notional below $10 is refused

**Function** `placeOrder` · **Tier** BE/Contract · **Priority** Medium · **Run** Auto

**Purpose.** Min notional is evaluated at the limit price or the index

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. place the smallest step size whose notional < 10 → expect revert BelowMinNotional(n, min)

**Expected.** Revert with the computed notional

### C148 · ETH: initial margin is 2 % of notional

**Function** `placeOrder` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** IM differs per market; the InsufficientCollateral error must report the market's requirement

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. fund exactly IM − 1 unit; place 1 unit at index → expect revert InsufficientCollateral(free, required) with required == notional × IM

**Expected.** Required equals this market's IM

### C149 · ETH: liquidation at 2x leverage happens far from entry

**Function** `liquidate` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** Maintenance ${m.mm}: at 2x the price must fall ~half before liquidation

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. open 1 unit with collateral = 50 % of notional; walk the index down; record the first liquidatable index → expect drop ≈ (50 % − MM) of entry

**Expected.** Threshold matches equity == MM arithmetic

### C150 · ETH: liquidation at 10x leverage

**Function** `liquidate` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** Same rule, 10 % collateral

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. open 1 unit with collateral = 10 % of notional; walk the index down; first liquidatable index → expect drop ≈ (10 % − MM) of entry

**Expected.** Threshold matches

### C151 · ETH: liquidation at max leverage (50x)

**Function** `liquidate` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** Thinnest allowed collateral: liquidation is one small move away

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. open 1 unit with collateral = IM exactly; walk the index down → expect liquidatable within (IM − MM) of entry

**Expected.** Threshold matches

### C152 · ETH: positive premium → positive rate, longs pay

**Function** `updateFunding` · **Tier** BE/Contract · **Priority** Medium · **Run** Auto

**Purpose.** Funding sign per market

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. fill above index on market 1; warp one interval; updateFunding → rate > 0; long balance decreases on next touch

**Expected.** Rate > 0, longs pay

### C153 · ETH: negative premium → negative rate, shorts pay

**Function** `updateFunding` · **Tier** BE/Contract · **Priority** Medium · **Run** Auto

**Purpose.** Funding sign per market, other direction

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. fill below index on market 1; warp one interval; updateFunding → rate < 0; short balance decreases on next touch

**Expected.** Rate < 0, shorts pay

### C154 · SOL: size off the step is refused (step 0.01)

**Function** `placeOrder` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** Step is per market; a value that is valid on one market must be refused on another

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. place size = step + 1 unit on market 2 → expect revert InvalidStep(size, step)

**Expected.** Revert with the market's own step

### C155 · SOL: price off the tick is refused (tick 0.001)

**Function** `placeOrder` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** Tick is per market

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. place Limit at price = tick multiple + 1 unit on market 2 → expect revert InvalidTick(price, tick)

**Expected.** Revert with the market's own tick

### C156 · SOL: the price band is index ± 5 % around 100

**Function** `placeOrder` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** Band bounds derive from each market's index

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. compute lower/upper from getIndexPrice(2) → place at lower − tick → revert PriceOutOfBand(p, lower, upper); place at lower → success

**Expected.** Bounds computed from this market's index

### C157 · SOL: notional below $10 is refused

**Function** `placeOrder` · **Tier** BE/Contract · **Priority** Medium · **Run** Auto

**Purpose.** Min notional is evaluated at the limit price or the index

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. place the smallest step size whose notional < 10 → expect revert BelowMinNotional(n, min)

**Expected.** Revert with the computed notional

### C158 · SOL: initial margin is 5 % of notional

**Function** `placeOrder` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** IM differs per market; the InsufficientCollateral error must report the market's requirement

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. fund exactly IM − 1 unit; place 1 unit at index → expect revert InsufficientCollateral(free, required) with required == notional × IM

**Expected.** Required equals this market's IM

### C159 · SOL: liquidation at 2x leverage happens far from entry

**Function** `liquidate` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** Maintenance ${m.mm}: at 2x the price must fall ~half before liquidation

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. open 1 unit with collateral = 50 % of notional; walk the index down; record the first liquidatable index → expect drop ≈ (50 % − MM) of entry

**Expected.** Threshold matches equity == MM arithmetic

### C160 · SOL: liquidation at 10x leverage

**Function** `liquidate` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** Same rule, 10 % collateral

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. open 1 unit with collateral = 10 % of notional; walk the index down; first liquidatable index → expect drop ≈ (10 % − MM) of entry

**Expected.** Threshold matches

### C161 · SOL: liquidation at max leverage (20x)

**Function** `liquidate` · **Tier** BE/Contract · **Priority** High · **Run** Auto

**Purpose.** Thinnest allowed collateral: liquidation is one small move away

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. open 1 unit with collateral = IM exactly; walk the index down → expect liquidatable within (IM − MM) of entry

**Expected.** Threshold matches

### C162 · SOL: positive premium → positive rate, longs pay

**Function** `updateFunding` · **Tier** BE/Contract · **Priority** Medium · **Run** Auto

**Purpose.** Funding sign per market

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. fill above index on market 2; warp one interval; updateFunding → rate > 0; long balance decreases on next touch

**Expected.** Rate > 0, longs pay

### C163 · SOL: negative premium → negative rate, shorts pay

**Function** `updateFunding` · **Tier** BE/Contract · **Priority** Medium · **Run** Auto

**Purpose.** Funding sign per market, other direction

**Precondition.** Venue deployed on anvil; account initialised and funded unless stated

**Steps.**
1. fill below index on market 2; warp one interval; updateFunding → rate < 0; short balance decreases on next touch

**Expected.** Rate < 0, shorts pay

