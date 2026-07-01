Prediction Market Intelligence Platform (PMIP)
Research & Autonomous Trading Architecture v2.0
Full Detailed Architecture Specification for Codex-Driven Development

| Document type | Full architecture specification and implementation baseline |
| --- | --- |
| Audience | Project owner using Codex as the primary developer |
| Primary objective | Discover, validate and eventually execute positive expected value opportunities in Polymarket |
| Current project baseline | Local Node.js/TypeScript Polymarket Crypto Analyzer Bot with Prisma/SQLite, PM2, Vitest, local API and React/Vite/MUI dashboard |
| Current hard constraint | No paid Data Lake, no paid cloud infrastructure and no paid data vendors until repeatable profitability is proven |
| Safety rule | Research can create hypotheses; only validated strategies can reach trading |
| Default mode | Research-only and feature-flagged |
| Version date | 2026-07-01 |


# 1. Executive Summary

This document defines the target architecture for evolving the existing Polymarket Crypto Analyzer Bot into PMIP: a local-first research and autonomous trading platform for prediction markets. The platform is not designed merely to predict BTC or to execute predefined rules. It is designed to discover where Polymarket prices may be wrong, generate competing strategy hypotheses, simulate them across many markets, validate them with progressively more realistic tests, and only then allow controlled live trading.

The most important architectural decision is the separation between the Research Platform and the Trading Platform. The Research Platform may be creative: it may inspect many markets, generate hypotheses, simulate counterfactual strategies and learn from markets that were never traded. The Trading Platform must be conservative: it accepts only approved strategy signals that passed governance, validation, execution feasibility and risk controls.

The existing crypto bot remains the operational base. Its current flows for crypto scanning, snapshots, SignalEngine, OutcomeCheckpointJob, RiskService, simulations, observation evaluations, ML shadow executions, limited real checkpoint trades and dashboard should be preserved. PMIP should not be a rewrite. It should be an extension that lets the current bot become the first category-specific engine inside a broader research system.

This specification assumes a practical constraint: there is no software engineering team. Development will be done by the project owner using Codex. Therefore the architecture is written to be modular, incremental and verifiable. Each module must be implementable through small prompts, with feature flags, tests and rollback-safe changes. The document intentionally avoids a paid Data Lake, managed cloud services and paid data vendors in the current scope. Those are future upgrades only after profitability is proven.


# 2. Definition of Success

The success of PMIP is not measured by how many trades it places. The system succeeds if it can identify positive expected value opportunities with enough reliability that validated strategies eventually produce risk-adjusted profit after execution costs. In the early research phase, success is measured by discovery quality, simulation quality, validation rigor and learning velocity.

A profitable prediction market system must solve several problems at once. It must choose markets where information can be obtained. It must understand how the market resolves. It must estimate a fair probability. It must compare that probability to the market price. It must account for spread, liquidity, slippage, fees, FOK failure and time-to-close. It must avoid overfitting. It must size positions conservatively. It must retire strategies when edge disappears.

| Dimension | Success criterion | Why it matters |
| --- | --- | --- |
| Market selection | The system ranks markets by researchability, source quality, liquidity and likely inefficiency. | Profits usually come from selecting the right arena, not from predicting everything. |
| Fair value | The system can estimate a defensible fair probability or explicitly say no estimate. | Without fair value there is no edge calculation. |
| Mispricing | The system detects gaps between fair probability and market price. | This is the core investment thesis. |
| Execution | The system knows whether the edge survives spread, fees and fillability. | A theoretical edge can be destroyed by microstructure. |
| Strategy discovery | The system generates and simulates many strategies, not just the one currently coded. | Learning requires counterfactual comparison. |
| Validation | Promotions require sample size, out-of-sample evidence and anti-overfitting checks. | Good backtests can be accidental. |
| Trading safety | Live execution is gated, small and explainable. | Capital preservation matters more than speed. |
| Learning | The system updates strategy/model rankings after every resolved market and simulation. | Markets change; static rules decay. |


# 3. Current Bot Baseline and Constraints

The current system is already valuable and should be treated as production-like infrastructure. It focuses on crypto UP/DOWN markets, especially 5m and 15m windows for BTC, ETH, SOL, XRP, DOGE, BNB and AVAX. It uses Node.js, TypeScript, Prisma ORM, SQLite, PM2, Vitest and a local React/Vite/MUI dashboard. It stores markets, snapshots, outcomes, predictions, simulations, observation evaluations, ML shadow executions, live checkpoint trades, short-exit observations, realistic exit executions, wallet PnL and learning stats.

The existing architecture separates simulated trades, observation evaluations, ML shadow executions and live trades. This separation is exactly the kind of safety boundary PMIP should expand, not weaken. The current RiskService already blocks non-crypto and enforces spread, liquidity, entry price, time remaining, duplicate trade and repeated signal constraints. LiveOutcomeCheckpointTradingService already requires explicit live mode, real trading flags, wallet/API credentials, shadow execution, fillability, expected profit, slippage, confidence, trade limits, stop losses and budget constraints.

PMIP must preserve this. New research modules must not write LiveOutcomeCheckpointTrade. New non-crypto modules must not call the live trading service. New strategy hypotheses must not become real orders just because they performed well in an idealized simulation.


# 4. Philosophy of the System

PMIP should behave like a disciplined quantitative research assistant, not like a gambling bot. Its default behavior is to observe, simulate and learn. It should prefer missing a trade over taking a trade without evidence. It should produce a reasoned investment thesis for every opportunity and a reasoned rejection for every discarded opportunity.

The system should be allowed to generate new hypotheses that were not manually predefined. That is central to the strategy. However, a generated hypothesis is not a strategy and a strategy is not a trading permission. Hypotheses are cheap. Validation is expensive. Trading is restricted. This hierarchy lets the platform be creative without being reckless.

| Concept | PMIP interpretation |
| --- | --- |
| Learning | Updating beliefs about markets, models, sources, features, strategies and execution quality based on evidence. |
| Good strategy | A repeatable rule or policy that produces positive risk-adjusted net expected value after costs across enough comparable cases. |
| Edge | A statistically defensible advantage between fair value and market price that survives execution costs and risk limits. |
| Failure | Not a losing trade. Failure is taking unvalidated risk, confusing simulation with reality or refusing to retire a decayed strategy. |
| Uncertainty | A valid output. If the system cannot resolve, source or price a market, it should say no trade. |
| Automation | Allowed only for validated and governed strategies; research automation is broader than trading automation. |


# 5. Non-Negotiable Safety Rules

- All PMIP modules are disabled by default and activated with explicit feature flags.
- No PMIP research module may create a real order.
- No non-crypto market may reach live trading in the initial scope.
- Global simulation-only mode overrides every category and strategy permission.
- Every strategy starts as a hypothesis, not as executable logic.
- Every promotion must be recorded with evidence and governance decision data.
- Every model output must include model name, version, feature version and confidence.
- Every simulation must declare its realism level: ideal, price-realistic, orderbook-realistic, paper or live.
- Every important decision must be reconstructable later from stored data.
- If data quality, source quality, resolution clarity or execution feasibility is insufficient, the correct output is WAIT, OBSERVE or NO_TRADE.

# 6. Architecture Planes

PMIP is organized into planes. This makes it possible to develop with Codex while keeping boundaries clear. The planes are not necessarily separate processes at first. They are conceptual boundaries that should map to folders, services, data tables and feature flags.

| Plane | Purpose | Examples |
| --- | --- | --- |
| Infrastructure Plane | Existing runtime, database, API, dashboard, logging and jobs. | Node.js, TypeScript, Prisma, SQLite, PM2, Vitest, local API. |
| Market Intelligence Plane | Find markets, classify them and understand resolution/source context. | Discovery, classifier, resolution profiles, source reliability. |
| Research Plane | Estimate fair value, detect mispricing, generate hypotheses and simulate strategies. | Fair Value Engine, Mispricing Detector, Strategy Exploration. |
| Validation Plane | Evaluate whether hypotheses survive stricter evidence requirements. | Backtest, shadow, paper, anti-overfitting, governance. |
| Trading Plane | Execute only approved opportunities under risk controls. | Execution Optimizer, RiskService, order service, reconciliation. |
| Learning Plane | Update models, strategies, calibration and meta-policies after results. | Research Lab, Continuous Learning, Meta-Learning. |


# 7. End-to-End Master Flow


```text
1. Discover active Polymarket markets.
2. Classify each market by category and confidence.
3. Determine how each market resolves.
4. Identify official or reliable sources.
5. Score researchability and data quality.
6. Build or update local feature vectors.
7. Estimate fair probability using one or more models.
8. Compare fair probability to Polymarket price.
9. Estimate raw edge and expected value.
10. Check whether execution costs destroy the edge.
11. Generate multiple strategy hypotheses.
12. Simulate strategies across the market and similar historical cases.
13. Rank strategies and detect overfitting risk.
14. Promote only validated candidates to shadow/paper stages.
15. Allow live trading only after governance, risk and execution gates.
16. Reconcile results and feed learning back into research.
```


# 8. Local-First Data Strategy

The current build must not require paid infrastructure. The storage strategy is SQLite/Prisma first, with optional local file artifacts for bulky raw data. A Data Lake is deliberately out of scope until profitability is proven. This is not just a cost decision; it is a focus decision. The immediate risk is not insufficient cloud scale. The immediate risk is building too much infrastructure before proving edge.

However, the schema should be designed so that a future Data Lake can be added without rewriting domain logic. Large raw payloads should be referenced by stable IDs. Feature definitions should be versioned. Experiments should be reproducible. This creates a path to S3/Parquet later without paying for it now.

| Data family | Current storage | Retention approach | Future upgrade |
| --- | --- | --- | --- |
| Research market metadata | SQLite/Prisma | Keep all while DB size is manageable. | Relational DB if hosted. |
| Snapshots and orderbooks | SQLite for selected records; local JSONL for bulky payloads if needed. | Retention by category/timeframe/value. | Parquet/Data Lake after profitability. |
| Feature values | SQLite/Prisma with feature version keys. | Expire stale cache but keep training-worthy values. | Feature store service. |
| Experiments and hypotheses | SQLite/Prisma. | Keep permanently unless intentionally archived. | Experiment registry backed by warehouse. |
| Reports | Local Markdown/JSON/CSV. | Keep daily summaries. | BI layer. |


# 9. Core Domain Objects

PMIP introduces a research vocabulary that should remain separate from current trading entities. This vocabulary prevents confusion between what the bot actually traded and what research suggests would have happened.

| Object | Meaning | Trading implication |
| --- | --- | --- |
| ResearchMarket | A market observed by the PMIP research layer. | None by itself. |
| ResolutionProfile | The system interpretation of how the market resolves. | Blocks research/trading if unclear. |
| SourceProfile | Reliability and authority of relevant data sources. | Low reliability reduces confidence. |
| FeatureVector | Versioned computed data used by models and simulations. | Must be reconstructable. |
| FairValueEstimate | Estimated true probability before costs. | Not enough to trade. |
| MispricingSignal | Gap between fair value and market price. | Input to execution feasibility. |
| ExecutionEstimate | Net EV and fillability after microstructure. | Can reject theoretical edge. |
| StrategyHypothesis | Research idea about how to exploit a pattern. | Never trades at birth. |
| StrategySimulation | Counterfactual or realistic simulation of a hypothesis. | Evidence only. |
| StrategyCandidate | Hypothesis with enough evidence for validation. | Still not live. |
| GovernanceDecision | Audit trail for promotion/rejection. | Required for any stage transition. |


# 10. PMIP Research Core

The PMIP Research Core is the root namespace for all new research capabilities. It must be feature-flagged, isolated and safe to disable. Its purpose is not to analyze markets directly but to establish shared types, configuration, logging conventions and module contracts. This prevents Codex from scattering new logic across the existing crypto codebase.


## Responsibilities

- Provide a narrow, testable contract that Codex can implement incrementally.
- Store enough evidence to reproduce decisions later.
- Fail safely when data is missing, stale, ambiguous or low quality.
- Expose structured outputs to downstream modules rather than hidden side effects.

## Implementation guidance

Create src/pmip or src/market-intelligence as the root. Load configuration once. Expose a module registry. Add tests proving that disabling PMIP prevents research jobs from starting. Do not import live trading services from this core module.


## Acceptance checklist

- Feature flag exists and defaults to safe/off if applicable.
- Build passes without changing current crypto behavior.
- Unit tests cover normal, ambiguous and failure cases.
- Outputs include reasons and risk notes, not only numeric scores.
- No live trading path is introduced unless this module is explicitly part of the trading layer.

## Codex prompt guidance

When implementing this module with Codex, the prompt should specify exact folders, exact Prisma models if needed, files that must not be touched, environment flags, test expectations, and commands to run. Codex should be instructed to summarize changed files and list uncertainties rather than guessing.


# 11. Market Discovery Engine

The discovery engine watches Polymarket broadly for research candidates. It is different from the existing crypto scanner. The crypto scanner exists to feed current crypto workflows. The PMIP discovery engine exists to build a research universe. It may include crypto, weather, economics, sports and unknown markets, but it should not duplicate operational side effects.


## Responsibilities

- Provide a narrow, testable contract that Codex can implement incrementally.
- Store enough evidence to reproduce decisions later.
- Fail safely when data is missing, stale, ambiguous or low quality.
- Expose structured outputs to downstream modules rather than hidden side effects.

## Implementation guidance

The first version should store only research metadata: market id, slug, question, category placeholder, liquidity, spread, volume, close time and raw metadata. It should deduplicate aggressively and run at a conservative interval. If broad discovery is expensive or rate-limited, it should prioritize categories with higher expected research value.


## Acceptance checklist

- Feature flag exists and defaults to safe/off if applicable.
- Build passes without changing current crypto behavior.
- Unit tests cover normal, ambiguous and failure cases.
- Outputs include reasons and risk notes, not only numeric scores.
- No live trading path is introduced unless this module is explicitly part of the trading layer.

## Codex prompt guidance

When implementing this module with Codex, the prompt should specify exact folders, exact Prisma models if needed, files that must not be touched, environment flags, test expectations, and commands to run. Codex should be instructed to summarize changed files and list uncertainties rather than guessing.


# 12. Market Classification Engine

Classification determines which analysis path may be appropriate. It should be deterministic in v1, based on text rules, tags and known keywords. Later it can be upgraded with ML or LLM classification, but a transparent rule-based baseline is safer for Codex implementation.


## Responsibilities

- Provide a narrow, testable contract that Codex can implement incrementally.
- Store enough evidence to reproduce decisions later.
- Fail safely when data is missing, stale, ambiguous or low quality.
- Expose structured outputs to downstream modules rather than hidden side effects.

## Implementation guidance

The classifier should return category, confidence, matched keywords and reasons. Ambiguity should be explicit. If a market mentions multiple categories, the classifier should either choose the dominant category with low confidence or mark it as UNKNOWN. Classification should not imply tradability.


## Acceptance checklist

- Feature flag exists and defaults to safe/off if applicable.
- Build passes without changing current crypto behavior.
- Unit tests cover normal, ambiguous and failure cases.
- Outputs include reasons and risk notes, not only numeric scores.
- No live trading path is introduced unless this module is explicitly part of the trading layer.

## Codex prompt guidance

When implementing this module with Codex, the prompt should specify exact folders, exact Prisma models if needed, files that must not be touched, environment flags, test expectations, and commands to run. Codex should be instructed to summarize changed files and list uncertainties rather than guessing.


# 13. Resolution Intelligence Engine

Resolution Intelligence is one of the most important PMIP modules. Polymarket markets are only analyzable if the system knows what event determines the final outcome. A market with unclear resolution can produce false confidence. This engine extracts target, threshold, date, location, official source and objective resolution quality.


## Responsibilities

- Provide a narrow, testable contract that Codex can implement incrementally.
- Store enough evidence to reproduce decisions later.
- Fail safely when data is missing, stale, ambiguous or low quality.
- Expose structured outputs to downstream modules rather than hidden side effects.

## Implementation guidance

For weather, it should look for location, metric, date, threshold and official weather source. For economics, it should identify release name, country, institution and release time. For crypto, it should identify asset, target, time window and price source. For vague cultural or rumor-driven markets, it should reduce researchability.


## Acceptance checklist

- Feature flag exists and defaults to safe/off if applicable.
- Build passes without changing current crypto behavior.
- Unit tests cover normal, ambiguous and failure cases.
- Outputs include reasons and risk notes, not only numeric scores.
- No live trading path is introduced unless this module is explicitly part of the trading layer.

## Codex prompt guidance

When implementing this module with Codex, the prompt should specify exact folders, exact Prisma models if needed, files that must not be touched, environment flags, test expectations, and commands to run. Codex should be instructed to summarize changed files and list uncertainties rather than guessing.


# 14. Source Reliability Engine

Source Reliability scores the information inputs available for a market. Official sources like NOAA, NWS, BLS, FOMC/Fed, SEC, FDA, NASA, Chainlink and exchange price feeds should score high. Social media, influencer content and unsourced news should score low. The score affects confidence and whether the market is researchable.


## Responsibilities

- Provide a narrow, testable contract that Codex can implement incrementally.
- Store enough evidence to reproduce decisions later.
- Fail safely when data is missing, stale, ambiguous or low quality.
- Expose structured outputs to downstream modules rather than hidden side effects.

## Implementation guidance

The first version can use a local catalog. It does not need paid APIs. The catalog should include authority, timeliness, historical reliability, category relevance and automation feasibility. If a source is reliable but not accessible for free, the current scope should mark it as future enhancement, not current dependency.


## Acceptance checklist

- Feature flag exists and defaults to safe/off if applicable.
- Build passes without changing current crypto behavior.
- Unit tests cover normal, ambiguous and failure cases.
- Outputs include reasons and risk notes, not only numeric scores.
- No live trading path is introduced unless this module is explicitly part of the trading layer.

## Codex prompt guidance

When implementing this module with Codex, the prompt should specify exact folders, exact Prisma models if needed, files that must not be touched, environment flags, test expectations, and commands to run. Codex should be instructed to summarize changed files and list uncertainties rather than guessing.


# 15. Local Feature Store

The Feature Store prevents repeated computations and enables reproducibility. A feature is not just a number; it is a named, versioned calculation. For example, crypto momentum_30s_v1 and weather_source_clarity_v1 should be tracked separately. If the formula changes, the version changes.


## Responsibilities

- Provide a narrow, testable contract that Codex can implement incrementally.
- Store enough evidence to reproduce decisions later.
- Fail safely when data is missing, stale, ambiguous or low quality.
- Expose structured outputs to downstream modules rather than hidden side effects.

## Implementation guidance

The first version can store feature definitions and values in SQLite. Feature values should include observedAt, expiresAt, marketId, featureDefinitionId and valueJson. Simulations and model predictions must reference feature versions so later analysis can reconstruct exactly what the system knew at that time.


## Acceptance checklist

- Feature flag exists and defaults to safe/off if applicable.
- Build passes without changing current crypto behavior.
- Unit tests cover normal, ambiguous and failure cases.
- Outputs include reasons and risk notes, not only numeric scores.
- No live trading path is introduced unless this module is explicitly part of the trading layer.

## Codex prompt guidance

When implementing this module with Codex, the prompt should specify exact folders, exact Prisma models if needed, files that must not be touched, environment flags, test expectations, and commands to run. Codex should be instructed to summarize changed files and list uncertainties rather than guessing.


# 16. Fair Value Engine

Fair Value is the heart of investment logic. It estimates what the probability should be. It is not a trading signal by itself. It should be allowed to return no estimate when inputs are weak. A low-confidence fair value should not be used to justify orders.


## Responsibilities

- Provide a narrow, testable contract that Codex can implement incrementally.
- Store enough evidence to reproduce decisions later.
- Fail safely when data is missing, stale, ambiguous or low quality.
- Expose structured outputs to downstream modules rather than hidden side effects.

## Implementation guidance

In v1, crypto can adapt existing BotPrediction probabilities. Weather/Economics can start with placeholder/heuristic probabilities until proper data sources are integrated. The key is to establish the interface: marketId, outcome, probability, confidence, modelId, featureVersion, reasons and risks.


## Acceptance checklist

- Feature flag exists and defaults to safe/off if applicable.
- Build passes without changing current crypto behavior.
- Unit tests cover normal, ambiguous and failure cases.
- Outputs include reasons and risk notes, not only numeric scores.
- No live trading path is introduced unless this module is explicitly part of the trading layer.

## Codex prompt guidance

When implementing this module with Codex, the prompt should specify exact folders, exact Prisma models if needed, files that must not be touched, environment flags, test expectations, and commands to run. Codex should be instructed to summarize changed files and list uncertainties rather than guessing.


# 17. Mispricing Detector

The Mispricing Detector compares PMIP fair value to Polymarket price. Its goal is to identify potential positive EV opportunities. It should calculate edge, raw expected value and direction. It must not ignore confidence. A 20% edge from a low-confidence fair value may be less useful than a 5% edge from a well-calibrated model.


## Responsibilities

- Provide a narrow, testable contract that Codex can implement incrementally.
- Store enough evidence to reproduce decisions later.
- Fail safely when data is missing, stale, ambiguous or low quality.
- Expose structured outputs to downstream modules rather than hidden side effects.

## Implementation guidance

The detector should support YES/NO and UP/DOWN. It should track market price, fair probability, edge, raw EV, confidence and reason codes. It should output NO_MISPRICING when market price is fair, spread is too wide, or fair value confidence is too low.


## Acceptance checklist

- Feature flag exists and defaults to safe/off if applicable.
- Build passes without changing current crypto behavior.
- Unit tests cover normal, ambiguous and failure cases.
- Outputs include reasons and risk notes, not only numeric scores.
- No live trading path is introduced unless this module is explicitly part of the trading layer.

## Codex prompt guidance

When implementing this module with Codex, the prompt should specify exact folders, exact Prisma models if needed, files that must not be touched, environment flags, test expectations, and commands to run. Codex should be instructed to summarize changed files and list uncertainties rather than guessing.


# 18. Cost and Execution Intelligence Engine

This module answers the question: can we actually capture the edge? Polymarket opportunities can disappear once spread, liquidity, slippage and fillability are considered. A theoretical +10% edge can be worthless if the orderbook cannot fill at the required price.


## Responsibilities

- Provide a narrow, testable contract that Codex can implement incrementally.
- Store enough evidence to reproduce decisions later.
- Fail safely when data is missing, stale, ambiguous or low quality.
- Expose structured outputs to downstream modules rather than hidden side effects.

## Implementation guidance

The engine should estimate net EV, fill probability, slippage, price limit, suggested order type and timing. It should be able to recommend WAIT or NO_TRADE. It should explicitly model FOK failure as an execution result distinct from a trading loss.


## Acceptance checklist

- Feature flag exists and defaults to safe/off if applicable.
- Build passes without changing current crypto behavior.
- Unit tests cover normal, ambiguous and failure cases.
- Outputs include reasons and risk notes, not only numeric scores.
- No live trading path is introduced unless this module is explicitly part of the trading layer.

## Codex prompt guidance

When implementing this module with Codex, the prompt should specify exact folders, exact Prisma models if needed, files that must not be touched, environment flags, test expectations, and commands to run. Codex should be instructed to summarize changed files and list uncertainties rather than guessing.


# 19. Strategy Exploration Engine

This is the module that makes PMIP more than a predefined-rule bot. For each researchable market, it generates multiple hypotheses: enter now, enter later, wait for confirmation, choose opposite outcome at a threshold, avoid if spread widens, use model A only above confidence X, etc.


## Responsibilities

- Provide a narrow, testable contract that Codex can implement incrementally.
- Store enough evidence to reproduce decisions later.
- Fail safely when data is missing, stale, ambiguous or low quality.
- Expose structured outputs to downstream modules rather than hidden side effects.

## Implementation guidance

Hypotheses should be structured, not just natural language. Conditions should be JSON-serializable. Every hypothesis needs a name, category, market type, condition set, entry policy, exit policy, expected rationale and status. Hypotheses start as CANDIDATE_ONLY or GENERATED and never trade automatically.


## Acceptance checklist

- Feature flag exists and defaults to safe/off if applicable.
- Build passes without changing current crypto behavior.
- Unit tests cover normal, ambiguous and failure cases.
- Outputs include reasons and risk notes, not only numeric scores.
- No live trading path is introduced unless this module is explicitly part of the trading layer.

## Codex prompt guidance

When implementing this module with Codex, the prompt should specify exact folders, exact Prisma models if needed, files that must not be touched, environment flags, test expectations, and commands to run. Codex should be instructed to summarize changed files and list uncertainties rather than guessing.


# 20. Strategy Simulation Engine

The simulation engine tests hypotheses even on markets that were not originally selected as opportunities. This is crucial. The system should learn from many markets, including those it ignored. It should ask what would have happened under alternative strategies, not only whether the chosen strategy won.


## Responsibilities

- Provide a narrow, testable contract that Codex can implement incrementally.
- Store enough evidence to reproduce decisions later.
- Fail safely when data is missing, stale, ambiguous or low quality.
- Expose structured outputs to downstream modules rather than hidden side effects.

## Implementation guidance

Simulations must label realism level. Ideal simulations are useful for broad exploration but cannot support live trading. Orderbook-realistic simulations are more valuable. The engine should store entry time, price, outcome, stake assumption, exit rules, final result, ROI, PnL and realism level.


## Acceptance checklist

- Feature flag exists and defaults to safe/off if applicable.
- Build passes without changing current crypto behavior.
- Unit tests cover normal, ambiguous and failure cases.
- Outputs include reasons and risk notes, not only numeric scores.
- No live trading path is introduced unless this module is explicitly part of the trading layer.

## Codex prompt guidance

When implementing this module with Codex, the prompt should specify exact folders, exact Prisma models if needed, files that must not be touched, environment flags, test expectations, and commands to run. Codex should be instructed to summarize changed files and list uncertainties rather than guessing.


# 21. Strategy Competition Engine

The competition engine compares strategy simulations across similar markets and selects candidates for validation. It should not reward the highest ROI blindly. It must consider sample size, drawdown, stability, complexity, market segment and execution realism.


## Responsibilities

- Provide a narrow, testable contract that Codex can implement incrementally.
- Store enough evidence to reproduce decisions later.
- Fail safely when data is missing, stale, ambiguous or low quality.
- Expose structured outputs to downstream modules rather than hidden side effects.

## Implementation guidance

A strategy with 500 cases and 8% stable ROI may be better than a strategy with 3 cases and 200% ROI. The engine should rank strategies by risk-adjusted net performance and penalize over-complex condition sets.


## Acceptance checklist

- Feature flag exists and defaults to safe/off if applicable.
- Build passes without changing current crypto behavior.
- Unit tests cover normal, ambiguous and failure cases.
- Outputs include reasons and risk notes, not only numeric scores.
- No live trading path is introduced unless this module is explicitly part of the trading layer.

## Codex prompt guidance

When implementing this module with Codex, the prompt should specify exact folders, exact Prisma models if needed, files that must not be touched, environment flags, test expectations, and commands to run. Codex should be instructed to summarize changed files and list uncertainties rather than guessing.


# 22. Strategy Research Lab

The research lab is the daily analyst. After simulations, observations, shadow executions and live trades resolve, it asks: what did we learn? Was the used strategy optimal? What alternative would have done better? Which losses were avoidable? Which markets were misclassified? Which features mattered?


## Responsibilities

- Provide a narrow, testable contract that Codex can implement incrementally.
- Store enough evidence to reproduce decisions later.
- Fail safely when data is missing, stale, ambiguous or low quality.
- Expose structured outputs to downstream modules rather than hidden side effects.

## Implementation guidance

The lab should generate insights and new hypotheses. It should run daily and after resolution batches. It should output a report with wins, losses, missed opportunities, best counterfactual strategies, strategies to retire and hypotheses to test next.


## Acceptance checklist

- Feature flag exists and defaults to safe/off if applicable.
- Build passes without changing current crypto behavior.
- Unit tests cover normal, ambiguous and failure cases.
- Outputs include reasons and risk notes, not only numeric scores.
- No live trading path is introduced unless this module is explicitly part of the trading layer.

## Codex prompt guidance

When implementing this module with Codex, the prompt should specify exact folders, exact Prisma models if needed, files that must not be touched, environment flags, test expectations, and commands to run. Codex should be instructed to summarize changed files and list uncertainties rather than guessing.


# 23. Validation and Anti-Overfitting Engine

Because PMIP will generate many strategies, overfitting is a major risk. The validation engine prevents random patterns from being promoted. It requires minimum sample sizes, out-of-sample testing, temporal separation, complexity penalties and stability checks.


## Responsibilities

- Provide a narrow, testable contract that Codex can implement incrementally.
- Store enough evidence to reproduce decisions later.
- Fail safely when data is missing, stale, ambiguous or low quality.
- Expose structured outputs to downstream modules rather than hidden side effects.

## Implementation guidance

The engine should detect strategies that depend on a few extreme wins, future leakage, too many conditions, low-liquidity artifacts or category-specific anomalies. It should block promotion with explicit reasons rather than silently failing.


## Acceptance checklist

- Feature flag exists and defaults to safe/off if applicable.
- Build passes without changing current crypto behavior.
- Unit tests cover normal, ambiguous and failure cases.
- Outputs include reasons and risk notes, not only numeric scores.
- No live trading path is introduced unless this module is explicitly part of the trading layer.

## Codex prompt guidance

When implementing this module with Codex, the prompt should specify exact folders, exact Prisma models if needed, files that must not be touched, environment flags, test expectations, and commands to run. Codex should be instructed to summarize changed files and list uncertainties rather than guessing.


# 24. Model Marketplace and Model Competition

No single model should be assumed best forever. PMIP should allow multiple models to estimate fair value or classify opportunities. Models compete by segment. The best model for crypto 5m may not be the best model for weather or economics.


## Responsibilities

- Provide a narrow, testable contract that Codex can implement incrementally.
- Store enough evidence to reproduce decisions later.
- Fail safely when data is missing, stale, ambiguous or low quality.
- Expose structured outputs to downstream modules rather than hidden side effects.

## Implementation guidance

Each model output must include modelId, version, featureVersion, probability, confidence and timestamp. Model performance should be evaluated by calibration, EV, ROI contribution, drawdown impact and stability.


## Acceptance checklist

- Feature flag exists and defaults to safe/off if applicable.
- Build passes without changing current crypto behavior.
- Unit tests cover normal, ambiguous and failure cases.
- Outputs include reasons and risk notes, not only numeric scores.
- No live trading path is introduced unless this module is explicitly part of the trading layer.

## Codex prompt guidance

When implementing this module with Codex, the prompt should specify exact folders, exact Prisma models if needed, files that must not be touched, environment flags, test expectations, and commands to run. Codex should be instructed to summarize changed files and list uncertainties rather than guessing.


# 25. Confidence Calibration Engine

Calibration checks whether probabilities mean what they say. If the system says 80% and wins only 60% over enough cases, it is overconfident. Calibration is essential for position sizing and EV calculations.


## Responsibilities

- Provide a narrow, testable contract that Codex can implement incrementally.
- Store enough evidence to reproduce decisions later.
- Fail safely when data is missing, stale, ambiguous or low quality.
- Expose structured outputs to downstream modules rather than hidden side effects.

## Implementation guidance

The engine should bucket predictions, compare predicted probability to realized frequency, produce reliability curves and optionally adjust probabilities. Calibration should be tracked by model, category, market type and time period.


## Acceptance checklist

- Feature flag exists and defaults to safe/off if applicable.
- Build passes without changing current crypto behavior.
- Unit tests cover normal, ambiguous and failure cases.
- Outputs include reasons and risk notes, not only numeric scores.
- No live trading path is introduced unless this module is explicitly part of the trading layer.

## Codex prompt guidance

When implementing this module with Codex, the prompt should specify exact folders, exact Prisma models if needed, files that must not be touched, environment flags, test expectations, and commands to run. Codex should be instructed to summarize changed files and list uncertainties rather than guessing.


# 26. AI Critic

The AI Critic reviews investment theses, hypotheses and strategy candidates for missing risks. It is not a trader and not an approver. It is a blocker or reviewer that asks: is the source reliable, is resolution ambiguous, are costs included, is the sample too small, is this overfit, is liquidity real?


## Responsibilities

- Provide a narrow, testable contract that Codex can implement incrementally.
- Store enough evidence to reproduce decisions later.
- Fail safely when data is missing, stale, ambiguous or low quality.
- Expose structured outputs to downstream modules rather than hidden side effects.

## Implementation guidance

In early versions, this can be a deterministic checklist rather than an LLM. Later, an LLM can summarize and critique. The critic should produce structured blocking issues and recommendations.


## Acceptance checklist

- Feature flag exists and defaults to safe/off if applicable.
- Build passes without changing current crypto behavior.
- Unit tests cover normal, ambiguous and failure cases.
- Outputs include reasons and risk notes, not only numeric scores.
- No live trading path is introduced unless this module is explicitly part of the trading layer.

## Codex prompt guidance

When implementing this module with Codex, the prompt should specify exact folders, exact Prisma models if needed, files that must not be touched, environment flags, test expectations, and commands to run. Codex should be instructed to summarize changed files and list uncertainties rather than guessing.


# 27. Research Governance Engine

Governance defines what is allowed to move forward. It is the permission system for research lifecycle transitions. It should decide whether a hypothesis becomes a candidate, whether a candidate enters backtest, whether shadow can start, whether paper can start and whether limited live is allowed.


## Responsibilities

- Provide a narrow, testable contract that Codex can implement incrementally.
- Store enough evidence to reproduce decisions later.
- Fail safely when data is missing, stale, ambiguous or low quality.
- Expose structured outputs to downstream modules rather than hidden side effects.

## Implementation guidance

Governance decisions must be stored with evidence. There should be no hidden manual override in code. If a manual override is ever needed, it must be an explicit record with reason, timestamp and scope.


## Acceptance checklist

- Feature flag exists and defaults to safe/off if applicable.
- Build passes without changing current crypto behavior.
- Unit tests cover normal, ambiguous and failure cases.
- Outputs include reasons and risk notes, not only numeric scores.
- No live trading path is introduced unless this module is explicitly part of the trading layer.

## Codex prompt guidance

When implementing this module with Codex, the prompt should specify exact folders, exact Prisma models if needed, files that must not be touched, environment flags, test expectations, and commands to run. Codex should be instructed to summarize changed files and list uncertainties rather than guessing.


# 28. Execution Optimizer

Execution Optimizer converts an approved opportunity into a practical order plan. It decides timing, price limit, order type, retry rules and cancellation logic. It must be able to choose not to trade even when a strategy signal exists.


## Responsibilities

- Provide a narrow, testable contract that Codex can implement incrementally.
- Store enough evidence to reproduce decisions later.
- Fail safely when data is missing, stale, ambiguous or low quality.
- Expose structured outputs to downstream modules rather than hidden side effects.

## Implementation guidance

For the current crypto flow, existing FOK logic can remain. PMIP should later generalize execution planning for non-crypto strategies that pass validation. Execution Optimizer must never bypass RiskService.


## Acceptance checklist

- Feature flag exists and defaults to safe/off if applicable.
- Build passes without changing current crypto behavior.
- Unit tests cover normal, ambiguous and failure cases.
- Outputs include reasons and risk notes, not only numeric scores.
- No live trading path is introduced unless this module is explicitly part of the trading layer.

## Codex prompt guidance

When implementing this module with Codex, the prompt should specify exact folders, exact Prisma models if needed, files that must not be touched, environment flags, test expectations, and commands to run. Codex should be instructed to summarize changed files and list uncertainties rather than guessing.


# 29. Portfolio and Capital Allocation Manager

Portfolio management is not part of the one-week MVP but should be designed conceptually. Once multiple validated strategies exist, the system must decide how to allocate limited bankroll across them. The best single trade is not always the best portfolio decision.


## Responsibilities

- Provide a narrow, testable contract that Codex can implement incrementally.
- Store enough evidence to reproduce decisions later.
- Fail safely when data is missing, stale, ambiguous or low quality.
- Expose structured outputs to downstream modules rather than hidden side effects.

## Implementation guidance

Initial sizing should be conservative. Full Kelly is too aggressive for early model uncertainty. The manager should consider max daily loss, open exposure, correlated categories, strategy confidence, calibration and drawdown.


## Acceptance checklist

- Feature flag exists and defaults to safe/off if applicable.
- Build passes without changing current crypto behavior.
- Unit tests cover normal, ambiguous and failure cases.
- Outputs include reasons and risk notes, not only numeric scores.
- No live trading path is introduced unless this module is explicitly part of the trading layer.

## Codex prompt guidance

When implementing this module with Codex, the prompt should specify exact folders, exact Prisma models if needed, files that must not be touched, environment flags, test expectations, and commands to run. Codex should be instructed to summarize changed files and list uncertainties rather than guessing.


# 30. Continuous Learning and Meta-Learning

Continuous Learning updates strategy and model performance after results. Meta-Learning decides which model or strategy family to prefer in each market segment. This is how the system improves without a human rewriting every rule.


## Responsibilities

- Provide a narrow, testable contract that Codex can implement incrementally.
- Store enough evidence to reproduce decisions later.
- Fail safely when data is missing, stale, ambiguous or low quality.
- Expose structured outputs to downstream modules rather than hidden side effects.

## Implementation guidance

Meta-Learning should not bypass validation. It should route future research toward models and strategies that historically worked better for similar contexts. It should also detect decay and recommend retirement.


## Acceptance checklist

- Feature flag exists and defaults to safe/off if applicable.
- Build passes without changing current crypto behavior.
- Unit tests cover normal, ambiguous and failure cases.
- Outputs include reasons and risk notes, not only numeric scores.
- No live trading path is introduced unless this module is explicitly part of the trading layer.

## Codex prompt guidance

When implementing this module with Codex, the prompt should specify exact folders, exact Prisma models if needed, files that must not be touched, environment flags, test expectations, and commands to run. Codex should be instructed to summarize changed files and list uncertainties rather than guessing.


# 31. Simulation Policy in Detail

A major design clarification is that a market does not need to be detected as a strong opportunity before being simulated. If PMIP only simulates markets it already believes are good, it will learn slowly and may reinforce bias. Instead, research simulations should run on a wider set of markets at lower cost. This lets the system discover that a strategy would have worked in markets that the original opportunity scorer ignored.

However, simulation volume must be controlled. Not every market needs every strategy. The Strategy Exploration Engine should generate hypotheses based on category, resolution clarity, feature availability and past learning. Low-quality markets can receive cheap ideal simulations or no simulations. Higher-quality markets can receive more expensive orderbook-realistic simulations.

| Market status | Allowed research action | Reason |
| --- | --- | --- |
| DISCOVERED | Classify and profile. | Basic understanding. |
| LOW_RESEARCHABILITY | Maybe cheap simulation only. | Can still teach what not to trade. |
| OBSERVE | Track features and selected hypotheses. | Potential future learning. |
| RESEARCHABLE | Generate multiple hypotheses and simulations. | Core learning set. |
| POTENTIAL_MISPRICING | Run deeper simulations and execution estimates. | Possible opportunity. |
| VALIDATION_CANDIDATE | Backtest/shadow/paper depending on stage. | Potential strategy promotion. |


# 32. Anti-Overfitting Rules

Strategy discovery creates the danger of overfitting. If the system tries thousands of hypotheses, some will look great by chance. The anti-overfitting engine must be treated as a core profitability module, not an optional academic feature.

- Minimum sample size: no candidate promotion from fewer than 30 comparable cases; higher thresholds are preferred for live eligibility.
- Out-of-sample validation: strategy performance must hold on data not used to generate the hypothesis.
- Temporal validation: strategy should work across multiple days or market regimes, not one isolated window.
- Complexity penalty: strategies with many conditions require more evidence.
- Extreme win dependency: strategies whose ROI comes from one or two outlier wins are high risk.
- Execution realism: ideal simulations cannot promote directly to paper or live.
- Leakage detection: no strategy may use information that would not have been known at decision time.
- Decay detection: strategies that stop working must be retired or downgraded.

# 33. Polymarket Trading Considerations

Polymarket is not just a probability board. It is a market with microstructure. The platform must understand how prices move, how orderbooks fill, how spreads behave, how liquidity disappears near close, and how traders may react to public information. Many naive bots fail not because their prediction is wrong but because their execution is poor.

| Consideration | Design response |
| --- | --- |
| Spread | Require edge to exceed spread and slippage buffer. |
| Liquidity | Score market depth and executable size before strategy promotion. |
| FOK orders | Model fill failure separately from trade loss. |
| Time to close | Different categories need different timing logic; crypto 5m differs from weather daily markets. |
| Resolution risk | Ambiguous markets require higher edge or rejection. |
| Information timing | Official data releases can cause rapid repricing; execution windows matter. |
| Market crowding | High-volume categories may be efficient; lower-liquidity categories may have edge but execution risk. |
| Wallet/trader behavior | Future smart-money tracking can inform research but should not be copied blindly. |


# 34. Category Evaluation Framework

PMIP should choose categories based on objective criteria rather than preference. Crypto is already implemented but may be highly competitive. Weather and economics may be more researchable because they rely on objective public data. Sports props may be analyzable but require careful market selection. Entertainment and celebrity markets are likely noisy and low reliability.

| Category | Researchability | Execution challenge | Initial priority |
| --- | --- | --- | --- |
| Weather | High when official source and metric are clear. | Liquidity may be thinner; timing depends on forecast updates. | High research priority. |
| Economics | High for official releases with consensus data. | Repricing can be fast; release timing matters. | High research priority after weather. |
| Crypto | Medium; data abundant but market crowded. | Fast windows, bots, spread/latency. | Maintain current flow. |
| Sports props | Medium-high if statistical and objective. | Injuries/lineups/news timing. | Research selectively. |
| Regulation/FDA/NASA | Medium-high but sparse. | Long horizon and event uncertainty. | Research selectively. |
| Politics | Medium data but high noise/reflexivity. | Crowding and narrative swings. | Low or disabled initially. |
| Entertainment | Low source reliability. | Rumor-driven. | Disabled initially. |


# 35. Codex-Driven Development Rules

Because Codex is the primary developer, this specification must be converted into small implementation prompts. Each prompt should be narrow enough that the project owner can review the diff. Codex should never be asked to implement the entire architecture at once.

| Rule | Why | Prompt requirement |
| --- | --- | --- |
| One bounded module per prompt | Reduces diff risk. | Name exact folder and target files. |
| Do not modify protected files | Protects current crypto bot. | List files/services that cannot be touched. |
| Feature flag first | Safe rollback. | Add env flag with default false. |
| Schema isolation | Avoids metric confusion. | Use Research* tables, not trading tables. |
| Tests in same prompt | Prevents unverified code. | Vitest for module logic. |
| Build after each prompt | Catches integration issues. | Run npm run build and npm test. |
| No hidden live paths | Capital protection. | Explicitly forbid order creation. |
| Summaries required | Human review. | Ask Codex to list changed files and risks. |


# 36. One-Week MVP Roadmap

The full PMIP vision is multi-month. The first useful version should be achievable in about one week if implemented with disciplined prompts. The MVP should create the research loop, not full autonomous multi-market live trading.

| Day | Implementation focus | Acceptance criteria |
| --- | --- | --- |
| 1 | PMIP core, config, research schema. | Existing bot unchanged when disabled; Prisma generate/build pass. |
| 2 | Discovery, classification, resolution profiles. | Markets are stored and categorized with reasons. |
| 3 | Source reliability and local feature store skeleton. | Sources scored; feature definitions/values can be written. |
| 4 | Fair value v1, mispricing v1, execution cost estimate v1. | Research opportunities show fair probability, edge and net EV estimate. |
| 5 | Strategy exploration and simulation. | Multiple hypotheses generated and simulated per market. |
| 6 | Strategy competition, research reports and API endpoints. | Report ranks hypotheses and explains insights. |
| 7 | Validation/governance hardening and tests. | No live path; anti-overfitting checks exist; build/tests pass. |


# 37. Initial Codex Prompt Sequence

The following is the recommended prompt sequence. The exact prompts can be generated after this architecture is accepted, but this sequence defines the dependency order.

1. Create PMIP Research Core: folders, config, types, feature flags and protected-file policy.
1. Add isolated Research* Prisma tables and migration.
1. Implement MarketClassificationEngine with tests.
1. Implement ResolutionIntelligenceEngine with deterministic heuristics and tests.
1. Implement SourceReliabilityEngine with local source catalog.
1. Implement LocalFeatureStore skeleton with versioned feature definitions.
1. Implement FairValueEngine v1 with crypto adapter and no-estimate fallback.
1. Implement MispricingDetector v1.
1. Implement CostExecutionIntelligence v1 for spread/liquidity/fillability estimates.
1. Implement StrategyExplorationEngine v1.
1. Implement StrategySimulationEngine v1 with realism levels.
1. Implement StrategyCompetitionEngine v1 with sample-size and complexity penalties.
1. Implement ResearchLab daily report.
1. Add read-only PMIP API endpoints.
1. Add optional local dashboard page.
1. Add defensive non-crypto live trading block tests.
1. Add Validation/Governance v1.
1. Generate next-phase prompts for Weather data integration and model competition.

# 38. Protected Existing Files and Services

The following current components should be treated as protected during early PMIP implementation. Codex prompts may read or adapt around them but should not modify them unless a prompt explicitly says so.

- SignalEngine and current crypto strategy files.
- OutcomeCheckpointJob and current checkpoint schedule logic.
- RiskService except for explicit defensive non-crypto blocking.
- LiveOutcomeCheckpointTradingService except for explicit defensive blocking tests.
- Existing Prisma models used by current trading metrics, unless adding non-breaking optional relations is explicitly approved.
- Existing dashboard pages for Predictions, Trades, Learning and Health, except adding links to a separate PMIP page.
- Wallet/private key/API credential handling.

# 39. Reporting Requirements

Research reports are essential because the project owner needs to understand what Codex-built modules are doing. The system should produce daily and on-demand reports that read like an analyst memo, but remain backed by structured data.

| Report | Contents |
| --- | --- |
| Daily Research Summary | Markets discovered, categories, best researchable markets, top mispricing candidates, generated hypotheses, simulations completed, warnings. |
| Strategy Simulation Report | Hypothesis performance by category, realism level, ROI, drawdown, sample size, overfitting risk. |
| Model Performance Report | Calibration, prediction buckets, model rankings by category and segment. |
| Execution Quality Report | Fill probability, spread costs, FOK failures, edge destroyed by costs. |
| Governance Report | Promotions, rejections, blocked strategies, retirement recommendations. |


# 40. Alignment and Viability Review

This architecture is aligned with the project objective. It supports monitoring many markets at the same time, finding markets where opportunities may be easier, choosing an appropriate analysis method for each market, generating multiple possible strategies, simulating those strategies, learning from markets even when no order is placed, and only allowing real trading after staged validation.

Technically, the plan is viable because it avoids replacing the current bot, avoids paid infrastructure, and organizes implementation into small Codex-friendly modules. The main risks are overfitting, data growth, schema complexity and Codex making broad unreviewable changes. The architecture directly addresses these risks with anti-overfitting gates, local-first storage, Research* table isolation, feature flags and protected-file rules.

From a trading perspective, the plan is stronger than a typical Polymarket bot because it does not assume prediction accuracy equals profit. It centers fair value, mispricing, cost-adjusted expected value and execution feasibility. It recognizes that edge can come from market selection, source quality, timing, strategy choice and microstructure. It also accepts that no architecture can guarantee edge where markets are efficient. The purpose of PMIP is to discover whether sustainable edge exists and exploit it carefully if it does.


# Appendix A. Environment Flags


```text
ENABLE_PMIP_RESEARCH=false
PMIP_DISCOVERY_INTERVAL_MS=300000
PMIP_OBSERVE_INTERVAL_MS=60000
ENABLE_PMIP_STRATEGY_SIMULATION=false
ENABLE_PMIP_EXPERIMENTAL_PREDICTIONS=false
PMIP_NON_CRYPTO_LIVE_TRADING_ALLOWED=false
PMIP_CATEGORY_CRYPTO_MODE=EXISTING_FLOW
PMIP_CATEGORY_WEATHER_MODE=RESEARCH_ONLY
PMIP_CATEGORY_ECONOMICS_MODE=RESEARCH_ONLY
PMIP_CATEGORY_SPORTS_MODE=RESEARCH_ONLY
PMIP_CATEGORY_REGULATION_MODE=RESEARCH_ONLY
PMIP_CATEGORY_TECHNOLOGY_MODE=RESEARCH_ONLY
PMIP_CATEGORY_SCIENCE_MODE=RESEARCH_ONLY
PMIP_CATEGORY_POLITICS_MODE=DISABLED
PMIP_CATEGORY_ENTERTAINMENT_MODE=DISABLED
PMIP_CATEGORY_UNKNOWN_MODE=DISABLED
```


# Appendix B. Canonical Codex Prompt Template


```text
Task: Implement [MODULE NAME] for PMIP.

Context:
- Existing project: local Polymarket Crypto Analyzer Bot in Node.js/TypeScript with Prisma/SQLite, PM2, Vitest, local React/Vite/MUI dashboard.
- Existing crypto flow must remain unchanged.
- PMIP is research-first and feature-flagged.

Create/modify:
- [Exact folders/files]

Do not modify:
- SignalEngine
- OutcomeCheckpointJob
- LiveOutcomeCheckpointTradingService
- Existing trading tables
- Wallet/API credential handling

Requirements:
- Add env flag(s), default safe/off.
- Add TypeScript types and tests.
- Store outputs in Research* tables only.
- No live orders.
- No non-crypto trading.
- Add structured logs.

Commands:
- npm run prisma:generate if schema changes
- npm run build
- npm test

Deliver:
- Summary of changed files
- Tests added
- Risks/uncertainties
- Confirmation that crypto behavior is unchanged when PMIP flag is false
```


# Appendix C. Glossary

| Term | Definition |
| --- | --- |
| Fair Value | Estimated true probability of an outcome before costs. |
| Mispricing | Difference between fair value and market price large enough to investigate. |
| Raw EV | Expected value before execution costs. |
| Net EV | Expected value after spread, slippage, fees and fillability. |
| Hypothesis | A structured research idea that may become a strategy after evidence. |
| Strategy Candidate | A hypothesis with enough simulation evidence to enter validation. |
| Shadow Execution | Orderbook-realistic execution simulation without money. |
| Paper Trading | Real-time no-capital trading simulation. |
| Limited Live | Tiny real-capital phase under strict risk gates. |
| Overfitting | A pattern that looks profitable in past data due to chance or leakage. |
| Meta-Learning | Learning which models and strategy families work best by segment. |
| Research Governance | Rules and audit trail for promotion, rejection and retirement. |


# Appendix D. Detailed TypeScript Contracts

The contracts below are not final code, but they define the shape Codex should preserve. They are intentionally explicit so generated modules communicate through stable typed structures instead of ad-hoc objects.


## MarketCategory and modes


```text
export type MarketCategory =
  | "CRYPTO"
  | "WEATHER"
  | "ECONOMICS"
  | "SPORTS"
  | "REGULATION"
  | "TECHNOLOGY"
  | "SCIENCE"
  | "POLITICS"
  | "ENTERTAINMENT"
  | "UNKNOWN";

export type CategoryMode =
  | "DISABLED"
  | "RESEARCH_ONLY"
  | "SIMULATION_ONLY"
  | "PAPER_ONLY"
  | "LIMITED_LIVE"
  | "PRODUCTION";
```


## ResearchMarket contract


```text
export interface ResearchMarketDTO {
  id: string;
  polymarketMarketId?: string;
  slug: string;
  question: string;
  category: MarketCategory;
  categoryConfidence: number;
  status: ResearchMarketStatus;
  closeTime?: Date;
  liquidity?: number;
  volume?: number;
  spread?: number;
  rawMetadata?: unknown;
}
```


## ResolutionProfile contract


```text
export interface ResolutionProfileDTO {
  marketId: string;
  category: MarketCategory;
  sourceName?: string;
  sourceType: "OFFICIAL" | "MARKET" | "NEWS" | "SOCIAL" | "UNKNOWN";
  objectivityScore: number;
  clarityScore: number;
  automationScore: number;
  extractedTerms: Record<string, unknown>;
  blockingIssues: string[];
}
```


## FairValue and Mispricing contracts


```text
export interface FairValueEstimateDTO {
  marketId: string;
  outcome: string;
  probability: number | null;
  confidence: "LOW" | "MEDIUM" | "HIGH";
  modelId: string;
  modelVersion: string;
  featureVersionRef?: string;
  reasons: string[];
  risks: string[];
}

export interface MispricingSignalDTO {
  marketId: string;
  outcome: string;
  marketPrice: number;
  fairProbability: number;
  rawEdge: number;
  rawExpectedValue: number;
  confidence: "LOW" | "MEDIUM" | "HIGH";
  decision: "NO_MISPRICING" | "WATCH" | "POTENTIAL_EDGE";
}
```


## Strategy hypothesis contract


```text
export interface StrategyHypothesisDTO {
  id: string;
  name: string;
  category: MarketCategory;
  hypothesisText: string;
  conditions: Record<string, unknown>;
  entryPolicy: Record<string, unknown>;
  exitPolicy?: Record<string, unknown>;
  expectedMechanism: string;
  status: "GENERATED" | "CANDIDATE" | "REJECTED" | "VALIDATING";
  realTradingAllowed: false;
}
```


# Appendix E. Prisma Model Blueprint

The following Prisma blueprint shows the intended research tables. Codex should adapt field types to the current Prisma version and existing conventions, but it must preserve the separation between research and trading tables.


```text
model ResearchMarket {
  id                  String   @id @default(cuid())
  polymarketMarketId  String?
  slug                String   @unique
  question            String
  category            String
  categoryConfidence  Float    @default(0)
  status              String
  closeTime           DateTime?
  liquidity           Float?
  volume              Float?
  spread              Float?
  metadataJson        Json?
  lastSeenAt          DateTime @default(now())
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt

  resolutionProfiles  ResearchResolutionProfile[]
  fairValues          ResearchFairValueEstimate[]
  mispricings         ResearchMispricingSignal[]
  simulations         ResearchStrategySimulation[]
}

model ResearchResolutionProfile {
  id                 String   @id @default(cuid())
  marketId           String
  category           String
  sourceName         String?
  sourceType         String
  objectivityScore   Float
  clarityScore       Float
  automationScore    Float
  extractedTermsJson Json?
  blockingIssuesJson Json?
  createdAt          DateTime @default(now())

  market             ResearchMarket @relation(fields: [marketId], references: [id])
}

model ResearchFairValueEstimate {
  id                String   @id @default(cuid())
  marketId          String
  outcome           String
  probability       Float?
  confidence        String
  modelId           String
  modelVersion      String
  featureVersionRef String?
  reasonsJson       Json?
  risksJson         Json?
  createdAt         DateTime @default(now())

  market            ResearchMarket @relation(fields: [marketId], references: [id])
}

model ResearchStrategyHypothesis {
  id                  String   @id @default(cuid())
  name                String
  category            String
  hypothesisText      String
  conditionsJson      Json
  entryPolicyJson     Json
  exitPolicyJson      Json?
  expectedMechanism   String?
  status              String
  realTradingAllowed  Boolean  @default(false)
  createdAt           DateTime @default(now())
  updatedAt           DateTime @updatedAt
}
```


# Appendix F. Read-only PMIP API Contract

The API layer must be local-only and read-only in the MVP. It should support debugging, reports and dashboard views. It must not expose any endpoint that can enable trading, create orders, change category modes or alter wallet configuration.

| Endpoint | Method | Purpose | Dangerous actions allowed? |
| --- | --- | --- | --- |
| /pmip/health | GET | PMIP feature flag and job status. | No |
| /pmip/markets | GET | List research markets with filters by category/status/minScore. | No |
| /pmip/resolution-profiles | GET | Show resolution clarity and source candidates. | No |
| /pmip/fair-values | GET | Show fair value estimates by market/outcome/model. | No |
| /pmip/mispricings | GET | Show raw and net edge candidates. | No |
| /pmip/hypotheses | GET | List generated strategy hypotheses and statuses. | No |
| /pmip/simulations | GET | Show strategy simulation results and realism level. | No |
| /pmip/reports/daily | GET | Return current daily research report. | No |
| /pmip/governance | GET | Read governance decisions and blocked promotions. | No |


# Appendix G. Dashboard Specification

The local dashboard should add a PMIP Research page without modifying the existing Predictions, Trades, Markets, Learning or Health pages in a way that could confuse research with live trading. All PMIP views should be visually labeled EXPERIMENTAL / RESEARCH ONLY until governance says otherwise.

| Page section | What it shows | User action |
| --- | --- | --- |
| Research overview | Markets discovered, categories, researchability, warnings. | View only |
| Opportunity board | Fair value, market price, raw edge, net EV, source quality. | View only |
| Strategy lab | Hypotheses, simulations, best counterfactuals. | View only |
| Validation board | Candidate stage, sample size, ROI, overfitting score. | View only |
| Model board | Model performance, calibration, active/retired status. | View only |
| Governance board | Promotions, rejections, blocking issues. | View only |


# Appendix H. Testing Strategy

Testing should focus on preventing unsafe side effects and validating deterministic logic. Because the system is intended for trading, passing build is not enough. Every module should have normal-case, ambiguous-case and failure-case tests.

| Test group | Examples |
| --- | --- |
| Feature flag tests | PMIP disabled means no jobs start, no research tables written, current crypto flow unaffected. |
| Classifier tests | Weather/economics/crypto/sports examples classified correctly; ambiguous examples low confidence. |
| Resolution tests | Clear markets produce extracted terms; vague markets produce blocking issues. |
| Source reliability tests | Official sources score high; social sources score low. |
| Fair value tests | No estimate when required inputs missing; confidence recorded. |
| Mispricing tests | No potential edge when fair value confidence low or price gap too small. |
| Execution cost tests | Edge rejected when spread/slippage/liquidity destroy net EV. |
| Strategy simulation tests | Simulation realism level required; no simulation writes live trade tables. |
| Governance tests | Cannot promote small-sample or high-overfit strategy. |
| Trading safety tests | Non-crypto live trading blocked even if live env flags are set. |


# Appendix I. Detailed Prompt Backlog for Codex

This backlog is intentionally granular. Each item should become one Codex prompt or a very small group of prompts. The goal is to make progress within a week without allowing Codex to perform risky broad refactors.

| # | Prompt/task | Purpose | Acceptance |
| --- | --- | --- | --- |
| 1 | PMIP folder scaffold | Create src/pmip with index, config, types and no runtime side effects. | Build + tests pass; no live orders; crypto unchanged. |
| 2 | PMIP config loader | Read env flags, validate category modes and default unsafe values to DISABLED. | Build + tests pass; no live orders; crypto unchanged. |
| 3 | Research Prisma schema | Add Research* models only; create migration; do not touch current trading models. | Build + tests pass; no live orders; crypto unchanged. |
| 4 | Research logging utility | Structured logs for research jobs with status and JSON summary. | Build + tests pass; no live orders; crypto unchanged. |
| 5 | Market classifier | Rule-based classifier with tests for all categories. | Build + tests pass; no live orders; crypto unchanged. |
| 6 | Resolution profile heuristics | Extract dates, thresholds, location, asset, source candidates. | Build + tests pass; no live orders; crypto unchanged. |
| 7 | Source catalog | Local source reliability catalog and scoring service. | Build + tests pass; no live orders; crypto unchanged. |
| 8 | Research market worker | Feature-flagged job to discover/store research markets. | Build + tests pass; no live orders; crypto unchanged. |
| 9 | Feature definition store | Versioned feature definitions and values. | Build + tests pass; no live orders; crypto unchanged. |
| 10 | Fair value interface | Generic fair value result and no-estimate fallback. | Build + tests pass; no live orders; crypto unchanged. |
| 11 | Crypto fair value adapter | Read existing crypto prediction outputs without replacing SignalEngine. | Build + tests pass; no live orders; crypto unchanged. |
| 12 | Weather fair value placeholder | Return low-confidence no-estimate until official data integration. | Build + tests pass; no live orders; crypto unchanged. |
| 13 | Mispricing detector | Compute edge and raw EV with confidence gates. | Build + tests pass; no live orders; crypto unchanged. |
| 14 | Execution cost v1 | Spread, liquidity and fillability approximation. | Build + tests pass; no live orders; crypto unchanged. |
| 15 | Strategy hypothesis schema | Model/table/service for generated hypotheses. | Build + tests pass; no live orders; crypto unchanged. |
| 16 | Strategy exploration v1 | Generate timing/outcome/price hypotheses per market. | Build + tests pass; no live orders; crypto unchanged. |
| 17 | Strategy simulation schema | Store simulations with realism level and result. | Build + tests pass; no live orders; crypto unchanged. |
| 18 | Ideal simulation engine | Counterfactual simulation without orderbook realism. | Build + tests pass; no live orders; crypto unchanged. |
| 19 | Orderbook-realistic simulation adapter | Prepare interface for future orderbook-realistic simulations. | Build + tests pass; no live orders; crypto unchanged. |
| 20 | Strategy competition v1 | Rank strategies with sample size and complexity penalties. | Build + tests pass; no live orders; crypto unchanged. |
| 21 | Anti-overfitting v1 | Reject small sample, extreme-win-dependent, overly complex strategies. | Build + tests pass; no live orders; crypto unchanged. |
| 22 | Research daily report | Markdown/JSON report of markets, hypotheses, simulations and warnings. | Build + tests pass; no live orders; crypto unchanged. |
| 23 | PMIP API health endpoint | Local read-only health and feature flag status. | Build + tests pass; no live orders; crypto unchanged. |
| 24 | PMIP API markets endpoint | Read-only market list with filters. | Build + tests pass; no live orders; crypto unchanged. |
| 25 | PMIP API opportunities endpoint | Read-only fair value/mispricing board. | Build + tests pass; no live orders; crypto unchanged. |
| 26 | PMIP API simulations endpoint | Read-only simulation and strategy results. | Build + tests pass; no live orders; crypto unchanged. |
| 27 | Dashboard PMIP route | Add local PMIP Research page labeled experimental. | Build + tests pass; no live orders; crypto unchanged. |
| 28 | Trading block tests | Prove non-crypto live trading cannot occur. | Build + tests pass; no live orders; crypto unchanged. |
| 29 | Governance decision table | Record promotions/rejections and evidence. | Build + tests pass; no live orders; crypto unchanged. |
| 30 | Governance service v1 | Allow stage transitions only with required evidence. | Build + tests pass; no live orders; crypto unchanged. |
| 31 | Calibration report skeleton | Bucket predictions and compare later with outcomes. | Build + tests pass; no live orders; crypto unchanged. |
| 32 | Model registry skeleton | Register models and versions. | Build + tests pass; no live orders; crypto unchanged. |
| 33 | AI critic checklist v1 | Deterministic checklist for missing source/cost/overfit risks. | Build + tests pass; no live orders; crypto unchanged. |
| 34 | Research lab job | Analyze completed simulations and propose next hypotheses. | Build + tests pass; no live orders; crypto unchanged. |
| 35 | PMIP CLI report command | Generate local report from terminal. | Build + tests pass; no live orders; crypto unchanged. |
| 36 | Retention controls | Prevent SQLite growth by configurable pruning for low-value raw data. | Build + tests pass; no live orders; crypto unchanged. |
| 37 | Documentation update | Add PMIP README and developer prompt rules. | Build + tests pass; no live orders; crypto unchanged. |
| 38 | End-to-end smoke test | Run disabled mode, research mode, discovery-to-simulation path. | Build + tests pass; no live orders; crypto unchanged. |
| 39 | Week-one hardening | Build/tests, log review, schema review, final report. | Build + tests pass; no live orders; crypto unchanged. |
| 40 | Next phase prompt generation | Generate prompts for Weather real data integration and model competition. | Build + tests pass; no live orders; crypto unchanged. |


# Appendix J. Research Report Template


```text
# PMIP Daily Research Report
Date: YYYY-MM-DD

## 1. Summary
- Markets discovered:
- Markets classified:
- Researchable markets:
- Potential mispricing signals:
- Hypotheses generated:
- Simulations completed:

## 2. Top Researchable Markets
| Market | Category | Resolution clarity | Source score | Liquidity | Spread | Notes |

## 3. Potential Mispricings
| Market | Outcome | Market price | Fair value | Raw edge | Net EV | Confidence | Decision |

## 4. Strategy Simulations
| Hypothesis | Category | Sample size | Realism | ROI | Drawdown | Overfit risk | Status |

## 5. Missed Opportunities
What would have worked but was not traded or not selected.

## 6. Rejections
Markets/strategies rejected and why.

## 7. Next Research Tasks
Specific hypotheses or modules to improve next.
```


# Appendix K. Example Investment Thesis Format

Every potential opportunity should be expressible as an investment thesis. This does not mean the system will trade. It means the reasoning is structured enough to review and simulate.


```text
Market: Will NYC high temperature exceed 95°F on [date]?
Category: WEATHER
Resolution source: NOAA/NWS station data
Resolution clarity: 92/100
Source reliability: 95/100
Fair probability YES: 0.78
Polymarket YES price: 0.62
Raw edge: +0.16
Estimated net EV after spread/slippage: +0.105
Execution feasibility: Medium
Strategy hypothesis: Buy YES only if price <= 0.64 and forecast consensus remains above threshold within 6 hours of close.
Simulation status: Research only
Trading permission: Not allowed
Primary risks: forecast model uncertainty, station mismatch, low liquidity.
```


# Appendix L. Final Build Gate Before Codex Implementation

Before implementing PMIP, the project owner should accept the following build gate. If any answer is no, the architecture should be revised before coding.

- The current crypto bot remains the operational baseline and is not rewritten.
- PMIP starts disabled and research-only.
- Strategy simulations can happen even when no order is generated.
- New hypotheses cannot become live strategies automatically.
- The first week produces a research loop, not full multi-market live trading.
- No paid infrastructure is required.
- Codex prompts will be small, specific and tested.
- The system optimizes net expected value and learning quality, not prediction count.