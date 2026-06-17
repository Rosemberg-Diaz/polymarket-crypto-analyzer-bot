# Bot Context for AI Handoff

This document is a compact technical handoff for another AI or engineer that needs
to analyze the current state of `polymarket-crypto-analyzer-bot`.

Last updated: 2026-06-16, America/Bogota.

## Project Goal

The bot is a local Node.js/TypeScript system for monitoring Polymarket crypto
markets, storing market data, running simulations, training/testing lightweight
models, and running a small real-money pilot for selected crypto Up/Down markets.

The current focus is crypto only:

- BTC
- ETH
- SOL
- XRP
- DOGE
- BNB
- AVAX when markets exist
- OTHER for detected crypto assets outside the explicit list

Do not add sports, politics, elections, wallets in source code, or private keys in
documentation.

## Runtime Modes

The original safe mode was:

```env
APP_MODE=SIMULATION_ONLY
ENABLE_REAL_TRADING=false
```

The current project has evolved to support a controlled live pilot. Live trading
must only run when all required environment flags and credentials are present:

```env
APP_MODE=LIVE_TRADING
ENABLE_REAL_TRADING=true
ENABLE_ML_OUTCOME_REAL_TRADING=true
ENABLE_SHORT_EXIT_REAL_TRADING=false
```

Important:

- Never print `.env` values that contain wallet/private key/API secrets.
- `ENABLE_SHORT_EXIT_REAL_TRADING=false` means the buy/sell exit strategy is not
  currently allowed to place real orders.
- Real outcome checkpoint trading is capped by config and segment gates.

## Main Commands

Install and prepare:

```bash
npm install
npm run prisma:generate
npm run prisma:deploy
```

Development:

```bash
npm run dev
```

Production local:

```bash
npm run build
npm run pm2:start
npm run pm2:restart
npm run pm2:logs
npm run pm2:stop
```

Dashboard/API:

```bash
npm run api
npm run web
npm run dev:all
```

Reports and analysis:

```bash
npm run report
npm run report:realistic-short-exit
npm run report:daily-exit
npm run ml:report-outcome-execution-shadow
npm run check:polymarket-balance
```

Maintenance:

```bash
npm run backup:now
npm run cleanup:database
npm run cleanup:database:vacuum
```

## Tests

Test framework: Vitest.

Run all tests:

```bash
npm test
```

Watch mode:

```bash
npm run test:watch
```

Run a specific test file:

```bash
npm run test -- src/modules/trading/live-outcome-checkpoint-trading.service.test.ts
```

Always run before leaving trading changes active:

```bash
npm run test -- src/modules/trading/live-outcome-checkpoint-trading.service.test.ts
npm run build
```

Useful tested areas include:

- `SimulationService`: profit/loss math and invalid input validation.
- `CryptoUpDownShortTermStrategy`: WAIT/AVOID/ENTER rules for Up/Down markets.
- `RiskService`: duplicate, crypto-only, liquidity, spread, and priority checks.
- `LearningService`: statistical adjustment with similar historical cases.
- `CryptoMarketUtils`: asset/timeframe/market type detection.
- `LiveOutcomeCheckpointTradingService`: real pilot segment and checkpoint gate.

## Current Real Trading Pilot

Real money is currently only allowed through:

- `LiveOutcomeCheckpointTradingService`
- `MlOutcomeShadowExecution`
- `LiveOutcomeCheckpointTrade`

Current real stake is capped to `3` USD by config parsing:

```ts
mlOutcomeRealStakeUsd: Math.min(3, parsedValue)
```

Current max open live outcome trades:

```ts
mlOutcomeRealMaxOpenTrades = 2
```

Current daily stop loss:

```ts
mlOutcomeRealDailyStopLossUsd = 9
```

### Active Real Segments

Defined in `src/config/constants.ts` as defaults and overrideable with
`ML_OUTCOME_REAL_SEGMENTS`.

Currently active:

```text
BTC:5m:UP
ETH:5m:UP
ETH:5m:DOWN
SOL:5m:UP
XRP:5m:DOWN
SOL:15m:UP
BTC:15m:DOWN
ETH:15m:DOWN
```

Recently removed from real trading:

```text
XRP:15m:DOWN
```

Reason: historical 15m shadow performance for `XRP:15m:DOWN` was negative and
the first real filled trade in that segment lost.

### Active Checkpoints

Implemented in `src/modules/trading/live-outcome-checkpoint-trading.service.ts`.

```ts
5m:  [30]
15m: [180, 120, 60]
```

Meaning:

- For 5-minute markets, live outcome orders are only attempted around 30 seconds
  before market close.
- For 15-minute markets, live outcome orders are attempted around 180, 120, or
  60 seconds before close.

The service also requires:

- shadow execution status `PENDING`
- segment included in `mlOutcomeRealSegments`
- checkpoint allowed for timeframe
- fully fillable shadow order
- positive expected profit
- valid price between 0 and 1
- slippage within `ML_OUTCOME_EXECUTION_MAX_SLIPPAGE`
- live trading flags enabled
- open live trades below the cap
- daily stop loss not reached

## What Is Not Active for Real Trading

### Short Exit / Buy-Sell Strategy

Tables/services:

- `ShortTermExitObservation`
- `RealisticShortExitExecution`
- `LiveShortExitTrade`

Current status:

- Real trading disabled by `ENABLE_SHORT_EXIT_REAL_TRADING=false`.
- It remains useful as observation/training data.
- Do not mix its observation profit with real-money outcome checkpoint profit.

### Observation Evaluations

Table:

- `ObservationEvaluation`

This stores hypothetical performance for disabled rules. It is not real trading
and not a simulated trade created by the main outcome strategy.

### Simulated Trades

Table:

- `SimulatedTrade`

These are classic simulation-only outcome trades. They are not real orders.

## Important Tables and Meaning

Use the correct table for the question:

- `Market`: one Polymarket market/window.
- `MarketSnapshot`: one observed market state. Many snapshots can exist per
  market. Do not count snapshots as bets.
- `BotPrediction`: one stored signal. Do not count repeated predictions as
  independent trades.
- `SimulatedTrade`: local simulated outcome trade.
- `MlOutcomeShadowExecution`: executable shadow check for outcome model. This is
  the source used to decide whether a real pilot order could be attempted.
- `LiveOutcomeCheckpointTrade`: actual real-money outcome checkpoint order
  attempts and settlement.
- `ShortTermExitObservation`: buy/sell strategy observation.
- `RealisticShortExitExecution`: realistic simulated fills for buy/sell.
- `LiveShortExitTrade`: real buy/sell strategy trade, currently disabled.

## Resolution Sources

Trusted/official-ish outcome sources:

- `POLYMARKET_EXPLICIT`
- `GAMMA_OUTCOME_PRICES`
- `CLOB_FINAL_PRICE`
- `POLYMARKET_RTDS_CHAINLINK_CLOSE`
- `GAMMA_OUTCOME_PRICES_FINAL_LIVE`

`GAMMA_OUTCOME_PRICES_FINAL_LIVE` was added because some 15m markets reached
their close time but Gamma still returned `active=true` and `closed=false`.
If the market is more than 5 minutes past `endDate` and Gamma outcome prices
show one side at `>=0.999` and the other side(s) at `<=0.001`, the live resolver
settles from those final Polymarket/Gamma prices.

This is not a local spot fallback.

Approximate/local fallback sources must not be used for trusted learning or
official performance claims.

## Machine Learning State

There are two lightweight ML/ML-like paths:

1. Entry-risk model for buy/sell observation.
2. Outcome model for Up/Down prediction checkpoints.

The outcome model does not directly place orders. Real orders are only attempted
after the executable shadow row passes the live checkpoint gate described above.

Useful scripts:

```bash
npm run ml:train-entry-risk
npm run ml:analyze-shadow
npm run ml:train-outcome
npm run ml:analyze-outcome-shadow
npm run ml:report-outcome-execution-shadow
```

## Data Analysis Rules for Another AI

When answering performance questions:

- Query `prisma/dev.db` live.
- Use America/Bogota for user-facing timestamps.
- Do not mix real trades, simulated trades, and observations.
- Do not count `MarketSnapshot` or repeated `BotPrediction` rows as trades.
- For real-money pilot performance, query `LiveOutcomeCheckpointTrade`.
- For executable shadow analysis, query `MlOutcomeShadowExecution`.
- For buy/sell observation, query `RealisticShortExitExecution` or
  `ShortTermExitObservation`.
- For classic simulation, query `SimulatedTrade`.

Real-money outcome pilot profit:

```sql
SELECT
  COUNT(*) AS trades,
  SUM(CASE WHEN status = 'RESOLVED' AND isWin = 1 THEN 1 ELSE 0 END) AS wins,
  SUM(CASE WHEN status = 'RESOLVED' AND isWin = 0 THEN 1 ELSE 0 END) AS losses,
  SUM(CASE WHEN status = 'RESOLVED' THEN CAST(profit AS REAL) ELSE 0 END) AS profit
FROM LiveOutcomeCheckpointTrade;
```

Open real outcome pilot orders:

```sql
SELECT *
FROM LiveOutcomeCheckpointTrade
WHERE status IN ('ENTRY_ATTEMPTING', 'OPEN')
ORDER BY createdAt;
```

Shadow executable outcome performance by segment:

```sql
SELECT
  assetSymbol,
  timeframe,
  predictedOutcome,
  checkpointSeconds,
  COUNT(*) AS cases,
  SUM(CASE WHEN isWin = 1 THEN 1 ELSE 0 END) AS wins,
  SUM(CASE WHEN isWin = 0 THEN 1 ELSE 0 END) AS losses,
  SUM(CAST(profit AS REAL)) AS profit
FROM MlOutcomeShadowExecution
WHERE status = 'RESOLVED'
  AND isWin IS NOT NULL
  AND profit IS NOT NULL
  AND fullyFilled = 1
  AND CAST(expectedProfit AS REAL) > 0
  AND CAST(slippage AS REAL) <= 0.010001
GROUP BY assetSymbol, timeframe, predictedOutcome, checkpointSeconds
ORDER BY profit DESC;
```

## Local Dashboard

The local monitor is in `apps/web`.

Run API and frontend:

```bash
npm run dev:all
```

Or separately:

```bash
npm run api
npm run web
```

Main pages:

- Dashboard
- Logs
- Predictions
- Trades
- Markets
- Learning
- Health

The dashboard is local only. It has no authentication and must not be exposed to
the internet.

## Operational Notes

- Run with PM2 for 24/7 local Windows execution.
- Keep `max_memory_restart` at `512M` in `ecosystem.config.js`.
- Do not run multiple bot instances against the same wallet/database without
  additional locking, because duplicate order attempts can happen.
- Backups are stored locally in `backups/`.
- Logs are stored in `logs/`.
- Avoid storing large raw orderbooks unless needed for signal/error audit.
- Use cleanup scripts to control SQLite growth.

## Current Follow-Up Risks

- 15m live pilot has limited real sample size. Keep reviewing before increasing
  stake.
- 5m has stronger historical shadow support, but still needs real execution
  monitoring because FOK liquidity can reject orders.
- `MAX_OPEN_TRADES=2` can block new entries if unresolved markets stay open.
  The new `GAMMA_OUTCOME_PRICES_FINAL_LIVE` fallback reduces that risk.
- Historical results are directional, not a guarantee of future profitability.
