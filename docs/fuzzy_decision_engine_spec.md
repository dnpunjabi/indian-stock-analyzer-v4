# Specification — APEX Fuzzy-Multi-Agent Decision Engine (FMADE)

This document details the architecture and mathematical specification for the **APEX Fuzzy-Multi-Agent Decision Engine (FMADE)**. The engine is designed to perform fuzzy logic-based evaluations on equities by combining temporal trajectory dynamics (1–3 years past vs. present) and market regime indicators.

---

## 1. System Overview

Traditional quantitative screening systems use crisp (boolean) boundaries that reject viable stocks based on arbitrary cutoffs (e.g., rejecting a high-growth stock because its P/E is 20.1 when the quality limit was 20.0).

FMADE utilizes **Fuzzy Logic (Mamdani Inference)** to evaluate degrees of truth (membership values $\mu \in [0, 1]$) for capital efficiency, valuation, trend strength, and operational trajectory.

```
+--------------------+      +-------------------------+      +-----------------------+
|  Historical Ticks  | ---> |   Fuzzification         | ---> | Fuzzy Rule Inference  |
|  & Financial Data  |      | (Membership Functions)  |      |   (Mamdani Engine)    |
+--------------------+      +-------------------------+      +-----------------------+
                                                                         |
                                                                         v
+--------------------+      +-------------------------+      +-----------------------+
| Interactive UI     | <--- |   Defuzzification       | <--- | Centroid Aggregator   |
| Rule-Trail Console |      |   (Buy/Sell Rating %)   |      |  (Weight Calculation) |
+--------------------+      +-------------------------+      +-----------------------+
```

---

## 2. Input Variables & Fuzzification

Inputs are divided into static snapshot variables (present) and trajectory delta variables (past 1–3 years vs. present).

### A. Fundamental Trajectory Deltas ($\Delta$)

1. **Operating Margin Trajectory ($\Delta_{OPM}$)**: 
   - *Fuzzy Sets*: `[Compressing, Stable, Expanding]`
   - *Calculation*: Slope of Operating Profit Margin over the past 12 quarters (3 years).
2. **Capital Efficiency Trajectory ($\Delta_{ROE}$)**: 
   - *Fuzzy Sets*: `[Deteriorating, Flat, Improving]`
   - *Calculation*: Linear regression slope of annual Return on Equity over the past 3 years.
3. **Debt Trajectory ($\Delta_{Debt}$)**:
   - *Fuzzy Sets*: `[Deleveraging, Stable, Borrowing]`
   - *Calculation*: $\text{Debt-to-Equity}_{\text{Present}} - \text{Debt-to-Equity}_{\text{3Y-Ago}}$.

### B. Technical Stage & Oscillators

1. **RSI(14) (Oscillator Snapshot)**:
   - *Fuzzy Sets*: `[Oversold, Neutral, Overbought]`
2. **200-DMA Proximity (Long-term Trend)**:
   - *Fuzzy Sets*: `[Below-Average, Near-Average, Above-Average]`
3. **Wyckoff Technical Stage (1-3 Year Chart Structure)**:
   - *Fuzzy Sets*: `[Stage-1: Accumulation, Stage-2: Markup, Stage-3: Distribution, Stage-4: Markdown]`
   - *Calculation*: Derived from 200-DMA slope, higher high structure, and historical volatility contraction.

### C. Market Context (Regime Adaptive Switch)

1. **ADX (Average Directional Index)**:
   - *Fuzzy Sets*: `[Weak-Trend (Ranging), Moderate-Trend, Strong-Trend]`
   - *Purpose*: Dynamically weights technical vs. fundamental rules.

---

## 3. Fuzzy Inference Rule Base

The rules mimic an institutional committee, integrating risk indicators to automatically filter out value traps.

### Rule Block 1: Trend Breakout & Momentum (Stage 2 Markup)
* **Rule 101**: 
  `IF Wyckoff Stage is [Stage-2: Markup] AND RSI is [Neutral] AND ADX is [Strong-Trend], THEN Buy Conviction is [High]`
* **Rule 102**: 
  `IF Wyckoff Stage is [Stage-1: Accumulation] AND RSI is [Oversold] AND Volatility is [Expanding] from [Compression], THEN Buy Conviction is [Very High]`

### Rule Block 2: Fundamental Turnarounds (Temporal Deltas)
* **Rule 201**: 
  `IF $\Delta_{ROE}$ is [Improving] AND $\Delta_{OPM}$ is [Expanding] AND $\Delta_{Debt}$ is [Deleveraging], THEN Stock Quality is [Accelerating]`
* **Rule 202**: 
  `IF Stock Quality is [Accelerating] AND Wyckoff Stage is [Stage-1: Accumulation], THEN Buy Conviction is [Strong]`

### Rule Block 3: Risk Overrides (Avoid / Exit Signals)
* **Rule 301**: 
  `IF $\Delta_{OPM}$ is [Compressing] AND $\Delta_{Debt}$ is [Borrowing] AND Altman Z-Score is [Distress Zone], THEN Avoid Conviction is [Very High]`
* **Rule 302**: 
  `IF Wyckoff Stage is [Stage-3: Distribution] OR Promoter Pledge is [Increasing], THEN Sell Conviction is [High]`

---

## 4. Defuzzification & Centroid Formulation

To output a single, crisp **Buy/Sell Conviction Rating** ranging from **-100% (Strong Sell)** to **+100% (Strong Buy)**, we apply the **Center of Gravity (CoG) Centroid Defuzzification** method.

$$\text{Fuzzy Rating} = \frac{\sum_{i=1}^{N} \mu(x_i) \cdot w_i \cdot x_i}{\sum_{i=1}^{N} \mu(x_i) \cdot w_i}$$

Where:
- $\mu(x_i)$ is the membership activation grade for rule $i$.
- $w_i$ is the weight of rule $i$ (dynamically scaled by the ADX regime).
- $x_i$ is the centroid value of the output fuzzy set for rule $i$.

---

## 5. UI Integration Console Mockup

When implemented, a dedicated **"Fuzzy Decision Matrix"** widget will render on the landing dashboard:

```
+-----------------------------------------------------------------------+
| 🔬 APEX FUZZY DECISION CONSOLE                                        |
+-----------------------------------------------------------------------+
|  DIXON      [====== Buy Conviction: 87% ======]      Accumulate (1D)  |
|             Rule Trail:                                               |
|               - Fundamental Quality: Accelerating (Weight: 90%)       |
|               - Stage-2 Markup Technical Alignment (Weight: 78%)      |
+-----------------------------------------------------------------------+
|  JSWENERGY  [== Hold/Watch Conviction: 61% ===]      Retest Warning   |
|             Rule Trail:                                               |
|               - Overbought Technical Oscillation (Weight: 84%)        |
|               - Flat Margin Delta over 1Y (Weight: 45%)               |
+-----------------------------------------------------------------------+
```

---

## 6. Phase 2 Backend API Specifications

1. **Endpoint**: `GET /api/fuzzy/evaluate`
   - *Parameters*: `symbol: str`
   - *Payload Return*:
     ```json
     {
       "symbol": "DIXON.NS",
       "fuzzy_score": 87,
       "rating": "Strong Buy",
       "market_regime": "Trending (ADX: 28.4)",
       "rule_trail": [
         { "rule_id": 202, "description": "Fundamental acceleration in accumulation phase", "strength": 0.91 },
         { "rule_id": 101, "description": "Stage-2 breakout momentum", "strength": 0.78 }
       ]
     }
     ```
2. **Endpoint**: `GET /api/fuzzy/universe-standings`
   - *Parameters*: `limit: int = 5`
   - *Payload Return*: A sorted list of top buy and sell candidates according to fuzzy centroid evaluations.
