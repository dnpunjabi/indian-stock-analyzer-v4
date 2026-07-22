# APEX Fuzzy-Multi-Agent Decision Engine (FMADE) - Core Math & Rules

def triangle(x: float, a: float, b: float, c: float) -> float:
    """Computes triangular membership function value."""
    if x <= a or x >= c:
        return 0.0
    if a < x < b:
        return (x - a) / (b - a) if b > a else 1.0
    if b <= x < c:
        return (c - x) / (c - b) if c > b else 1.0
    return 0.0

def trapezoid(x: float, a: float, b: float, c: float, d: float) -> float:
    """Computes trapezoidal membership function value."""
    if x <= a or x >= d:
        return 0.0
    if b <= x <= c:
        return 1.0
    if a < x < b:
        return (x - a) / (b - a) if b > a else 1.0
    if c < x < d:
        return (d - x) / (d - c) if d > c else 1.0
    return 0.0

def evaluate_fuzzy_logic(
    opm_delta: float,
    roe_delta: float,
    debt_delta: float,
    rsi: float,
    dma_prox: float,
    adx: float,
    stage: int,
    altman_z: float,
    piotroski: int,
    promoter_holding: float,
    promoter_pledge_delta: float,
    relative_volume: float,
    sector_markdown: bool,
    # Institutional & Multi-factor Extensions:
    pe_valuation_ratio: float = 1.0,
    dma_stack_bullish: bool = False,
    dma_stack_bearish: bool = False,
    fifty_two_week_prox: float = 0.5,
    delivery_pct: float = 40.0,
    vcp_squeeze: bool = False,
    fii_dii_delta: float = 0.0,
    icr: float = 5.0,
    ocf_pat_ratio: float = 1.0
) -> dict:
    """
    Evaluates Mamdani Fuzzy Inference logic for a stock combining:
    - Fundamental Trajectory (OPM, ROE, Deleveraging)
    - Valuation Multiples (P/E vs 3Y Median P/E)
    - Technical Structure (Wyckoff Stage, RSI, ADX, 20/50/100/200 DMA Stack, 52W High/Low Proximity)
    - Institutional Footprints (NSE Delivery %, FII/DII Flows, Volatility Squeeze VCP)
    - Solvency & Cash Flow Quality Safeguards (Altman Z, Piotroski, ICR, OCF/PAT)

    Returns:
        dict: containing fuzzy score (-100 to +100), rating, regime, membership grades, and rule trail.
    """
    # 1. Fuzzify Inputs
    # Margin Trajectory delta
    opm_compressing = trapezoid(opm_delta, -999.0, -999.0, -2.0, 0.0)
    opm_stable = triangle(opm_delta, -1.0, 0.0, 1.0)
    opm_expanding = trapezoid(opm_delta, 0.0, 2.0, 999.0, 999.0)

    # ROE Trajectory delta
    roe_deteriorating = trapezoid(roe_delta, -999.0, -999.0, -2.0, 0.0)
    roe_flat = triangle(roe_delta, -1.0, 0.0, 1.0)
    roe_improving = trapezoid(roe_delta, 0.0, 2.0, 999.0, 999.0)

    # Debt Trajectory delta
    debt_deleveraging = trapezoid(debt_delta, -999.0, -999.0, -0.5, 0.0)
    debt_stable = triangle(debt_delta, -0.2, 0.0, 0.2)
    debt_borrowing = trapezoid(debt_delta, 0.0, 0.5, 999.0, 999.0)

    # RSI
    rsi_oversold = trapezoid(rsi, 0.0, 0.0, 30.0, 40.0)
    rsi_healthy = trapezoid(rsi, 38.0, 45.0, 65.0, 72.0)
    rsi_overbought = trapezoid(rsi, 65.0, 75.0, 100.0, 100.0)

    # 200-DMA Proximity
    dma_below = trapezoid(dma_prox, -999.0, -999.0, -5.0, 0.0)
    dma_near = triangle(dma_prox, -2.0, 0.0, 2.0)
    dma_above = trapezoid(dma_prox, 0.0, 5.0, 999.0, 999.0)

    # ADX (Trend Strength)
    adx_weak = trapezoid(adx, 0.0, 0.0, 15.0, 20.0)
    adx_moderate = triangle(adx, 18.0, 25.0, 32.0)
    adx_strong = trapezoid(adx, 25.0, 35.0, 100.0, 100.0)

    # Wyckoff Stages
    is_stage_1 = 1.0 if stage == 1 else 0.0
    is_stage_2 = 1.0 if stage == 2 else 0.0
    is_stage_3 = 1.0 if stage == 3 else 0.0
    is_stage_4 = 1.0 if stage == 4 else 0.0

    # PE Valuation Ratio (Current P/E vs 3Y Median P/E)
    pe_discount = trapezoid(pe_valuation_ratio, 0.0, 0.0, 0.85, 0.95)
    pe_fair = triangle(pe_valuation_ratio, 0.85, 1.05, 1.30)
    pe_overvalued = trapezoid(pe_valuation_ratio, 1.25, 1.45, 999.0, 999.0)

    # 52-Week Range Proximity
    prox_52w_high = trapezoid(fifty_two_week_prox, 0.88, 0.93, 1.0, 1.0)
    prox_52w_low = trapezoid(fifty_two_week_prox, 0.0, 0.0, 0.08, 0.15)

    # Stealth Delivery & Institutional Flows
    stealth_delivery = trapezoid(delivery_pct, 55.0, 65.0, 100.0, 100.0)
    fii_dii_buying = trapezoid(fii_dii_delta, 0.3, 0.6, 999.0, 999.0)

    # Solvency & Cash Flow Quality
    icr_distressed = trapezoid(icr, -999.0, -999.0, 1.2, 1.8)
    cash_flow_trap = trapezoid(ocf_pat_ratio, -999.0, -999.0, 0.4, 0.6)

    # 2. Evaluate Rule Base
    rule_trail = []
    
    # Rule 101: Breakout momentum in trending market
    r101 = min(is_stage_2, rsi_healthy, adx_strong)
    if r101 > 0.1:
        rule_trail.append({
            "rule_id": 101,
            "rule_name": "Stage-2 Breakout Alignment",
            "rating": "Buy",
            "membership_grade": round(r101, 2),
            "implication": "Stage-2 Breakout Alignment (ADX & RSI Confluence)",
            "description": "Stage-2 Breakout Alignment (ADX & RSI Confluence)",
            "type": "buy",
            "activation": round(r101, 2)
        })

    # Rule 102: Turnaround Accumulation
    r102 = min(is_stage_1, rsi_oversold)
    if r102 > 0.1:
        rule_trail.append({
            "rule_id": 102,
            "rule_name": "Stage-1 Accumulation",
            "rating": "Buy",
            "membership_grade": round(r102, 2),
            "implication": "Stage-1 Accumulation (Oversold Entry Zone)",
            "description": "Stage-1 Accumulation (Oversold Entry Zone)",
            "type": "buy",
            "activation": round(r102, 2)
        })

    # Rule 103: Valuation Bargain Accumulation
    r103 = min(pe_discount, max(is_stage_1, is_stage_2))
    if r103 > 0.1:
        rule_trail.append({
            "rule_id": 103,
            "rule_name": "Valuation Bargain Alignment",
            "rating": "Buy",
            "membership_grade": round(r103, 2),
            "implication": "Valuation Bargain (PE below historical median in Stage 1/2)",
            "description": "Valuation Bargain (PE below historical median in Stage 1/2)",
            "type": "buy",
            "activation": round(r103, 2)
        })

    # Rule 104: Bullish Moving Average Stack Confluence
    r104 = 0.8 if (dma_stack_bullish and rsi_healthy > 0.2) else 0.0
    if r104 > 0.1:
        rule_trail.append({
            "rule_id": 104,
            "rule_name": "Bullish DMA Stack Confluence",
            "rating": "Buy",
            "membership_grade": round(r104, 2),
            "implication": "Bullish DMA Stack (20 > 50 > 100 > 200 DMA Ascending)",
            "description": "Bullish DMA Stack (20 > 50 > 100 > 200 DMA Ascending)",
            "type": "buy",
            "activation": round(r104, 2)
        })

    # Rule 105: 52-Week High Breakout Surge
    r105 = min(prox_52w_high, is_stage_2)
    if r105 > 0.1:
        rule_trail.append({
            "rule_id": 105,
            "rule_name": "52-Week High Breakout Surge",
            "rating": "Buy",
            "membership_grade": round(r105, 2),
            "implication": "52-Week High Breakout Zone (Wyckoff Jump-Across-Creek)",
            "description": "52-Week High Breakout Zone (Wyckoff Jump-Across-Creek)",
            "type": "buy",
            "activation": round(r105, 2)
        })

    # Rule 106: Stealth Institutional Delivery Accumulation
    r106 = min(stealth_delivery, max(is_stage_1, is_stage_2))
    if r106 > 0.1:
        rule_trail.append({
            "rule_id": 106,
            "rule_name": "Stealth Institutional Delivery Spike",
            "rating": "Buy",
            "membership_grade": round(r106, 2),
            "implication": "Institutional Stealth Buying (High NSE Delivery %)",
            "description": "Institutional Stealth Buying (High NSE Delivery %)",
            "type": "buy",
            "activation": round(r106, 2)
        })

    # Rule 107: FII/DII Institutional Flow Confluence
    r107 = min(fii_dii_buying, max(is_stage_1, is_stage_2))
    if r107 > 0.1:
        rule_trail.append({
            "rule_id": 107,
            "rule_name": "FII/DII Institutional Accumulation",
            "rating": "Buy",
            "membership_grade": round(r107, 2),
            "implication": "Smart Money Inflow (Quarterly FII + DII Holding Expansion)",
            "description": "Smart Money Inflow (Quarterly FII + DII Holding Expansion)",
            "type": "buy",
            "activation": round(r107, 2)
        })

    # Rule 108: Volatility Contraction Pattern (VCP Squeeze)
    r108 = 0.85 if (vcp_squeeze and is_stage_1 > 0.5) else 0.0
    if r108 > 0.1:
        rule_trail.append({
            "rule_id": 108,
            "rule_name": "Volatility Contraction Squeeze (VCP)",
            "rating": "Buy",
            "membership_grade": round(r108, 2),
            "implication": "Coiled Spring Alert (VCP Volatility Squeeze & Low Volume Dry-Up)",
            "description": "Coiled Spring Alert (VCP Volatility Squeeze & Low Volume Dry-Up)",
            "type": "buy",
            "activation": round(r108, 2)
        })

    # Rule 201: Quality Turnaround
    r201 = min(roe_improving, opm_expanding)
    if r201 > 0.1:
        rule_trail.append({
            "rule_id": 201,
            "rule_name": "Fundamental Quality Acceleration",
            "rating": "Buy",
            "membership_grade": round(r201, 2),
            "implication": "Fundamental Quality Acceleration (Margins & ROE Expansion)",
            "description": "Fundamental Quality Acceleration (Margins & ROE Expansion)",
            "type": "buy",
            "activation": round(r201, 2)
        })

    # Rule 202: Early Bird Turnaround
    r202 = min(r201, is_stage_1)
    if r202 > 0.1:
        rule_trail.append({
            "rule_id": 202,
            "rule_name": "Early Turnaround",
            "rating": "Buy",
            "membership_grade": round(r202, 2),
            "implication": "Early Turnaround (Quality Acceleration in Accumulation)",
            "description": "Early Turnaround (Quality Acceleration in Accumulation)",
            "type": "buy",
            "activation": round(r202, 2)
        })

    # Rule 301: Avoid Value Trap
    r301 = min(opm_compressing, debt_borrowing)
    if r301 > 0.1:
        rule_trail.append({
            "rule_id": 301,
            "rule_name": "Avoid Value Trap",
            "rating": "Sell",
            "membership_grade": round(r301, 2),
            "implication": "Value Trap (Compressing Margins & Borrowing)",
            "description": "Value Trap (Compressing Margins & Borrowing)",
            "type": "sell",
            "activation": round(r301, 2)
        })

    # Rule 302: Markdown distribution / Exit zone
    r302 = max(is_stage_3, is_stage_4)
    if r302 > 0.1:
        rule_trail.append({
            "rule_id": 302,
            "rule_name": "Markdown Distribution / Exit",
            "rating": "Sell",
            "membership_grade": round(r302, 2),
            "implication": "Distribution/Markdown Stage Alignment",
            "description": "Distribution/Markdown Stage Alignment",
            "type": "sell",
            "activation": round(r302, 2)
        })

    # Rule 303: Overvalued Bubble Caution
    r303 = min(pe_overvalued, opm_compressing)
    if r303 > 0.1:
        rule_trail.append({
            "rule_id": 303,
            "rule_name": "Overvaluation Bubble Warning",
            "rating": "Sell",
            "membership_grade": round(r303, 2),
            "implication": "Overvalued Multiples with Compressing Profit Margins",
            "description": "Overvalued Multiples with Compressing Profit Margins",
            "type": "sell",
            "activation": round(r303, 2)
        })

    # Rule 304: Bearish Moving Average Stack Breakdown
    r304 = 0.85 if dma_stack_bearish else 0.0
    if r304 > 0.1:
        rule_trail.append({
            "rule_id": 304,
            "rule_name": "Bearish DMA Stack Breakdown",
            "rating": "Sell",
            "membership_grade": round(r304, 2),
            "implication": "Bearish DMA Stack (20 < 50 < 100 < 200 DMA Descending)",
            "description": "Bearish DMA Stack (20 < 50 < 100 < 200 DMA Descending)",
            "type": "sell",
            "activation": round(r304, 2)
        })

    # 3. Apply Advanced False-Positive Safeguards
    # Rule 401: Insider Pledging/Selling check
    r401_penalty = 0.0
    if is_stage_2 > 0.1:
        if promoter_pledge_delta > 2.0 or promoter_holding < 30.0:
            r401_penalty = 0.5
            rule_trail.append({
                "rule_id": 401,
                "rule_name": "Insider Warning",
                "rating": "Cap/Floor",
                "membership_grade": r401_penalty,
                "implication": "Insider Warning: High promoter pledging or low holding during breakout",
                "description": "Insider Warning: High promoter pledging or low holding during breakout",
                "type": "penalty",
                "activation": r401_penalty
            })

    # Rule 402: Volume verification
    r402_penalty = 0.0
    if is_stage_2 > 0.1 and relative_volume < 0.8:
        r402_penalty = 0.4
        rule_trail.append({
            "rule_id": 402,
            "rule_name": "Low Liquidity Warning",
            "rating": "Cap/Floor",
            "membership_grade": r402_penalty,
            "implication": "Low Liquidity Warning: Breakout on below-average volume",
            "description": "Low Liquidity Warning: Breakout on below-average volume",
            "type": "penalty",
            "activation": r402_penalty
        })

    # Rule 403: Solvency Distress Ceiling
    r403_cap = False
    if altman_z < 1.8 or piotroski < 4:
        r403_cap = True
        rule_trail.append({
            "rule_id": 403,
            "rule_name": "Solvency Distress Floor",
            "rating": "Cap/Floor",
            "membership_grade": 1.0,
            "implication": "Solvency/Quality Distressed Floor Active (Capped Buy Rating)",
            "description": "Solvency/Quality Distressed Floor Active (Capped Buy Rating)",
            "type": "cap",
            "activation": 1.0
        })

    # Rule 404: Sector Rotation Check
    r404_penalty = 0.0
    if sector_markdown:
        r404_penalty = 0.4
        rule_trail.append({
            "rule_id": 404,
            "rule_name": "Sector Headwinds",
            "rating": "Cap/Floor",
            "membership_grade": r404_penalty,
            "implication": "Sector Headwinds: Parent industry in Stage-4 Markdown",
            "description": "Sector Headwinds: Parent industry in Stage-4 Markdown",
            "type": "penalty",
            "activation": r404_penalty
        })

    # Rule 405: Interest Coverage & Cash Flow Trap Floor
    r405_cap = False
    if icr_distressed > 0.5 or cash_flow_trap > 0.5:
        r405_cap = True
        rule_trail.append({
            "rule_id": 405,
            "rule_name": "Solvency & Cash Flow Trap Cap",
            "rating": "Cap/Floor",
            "membership_grade": 1.0,
            "implication": "Interest Coverage / Cash Flow Conversion Deficit (Rating Capped)",
            "description": "Interest Coverage / Cash Flow Conversion Deficit (Rating Capped)",
            "type": "cap",
            "activation": 1.0
        })

    # 4. Compute Output Category Activations (Mamdani Aggregation)
    # Penalize buy activations dynamically if safeguards fail
    max_penalty = max(r401_penalty, r402_penalty, r404_penalty)
    raw_buy_activation = max(r101, r102, r103, r104, r105, r106, r107, r108, r201, r202)
    buy_activation = raw_buy_activation * (1.0 - max_penalty)
    
    # Ensure hold set has a baseline activation for proportional Mamdani defuzzification scaling
    hold_activation = max(min(is_stage_1, rsi_healthy), 0.15)
    sell_activation = max(r301, r302, r303, r304)

    # 5. Defuzzification (Centroid COG)
    domain_x = list(range(-100, 101, 5))
    
    def mu_sell(val):
        return trapezoid(val, -100, -100, -80, -35)
    
    def mu_hold(val):
        return triangle(val, -30, 0, 30)
        
    def mu_buy(val):
        return trapezoid(val, 35, 80, 100, 100)

    sum_x_mu = 0.0
    sum_mu = 0.0
    
    for val in domain_x:
        mu_val = max(
            min(sell_activation, mu_sell(val)),
            min(hold_activation, mu_hold(val)),
            min(buy_activation, mu_buy(val))
        )
        sum_x_mu += val * mu_val
        sum_mu += mu_val

    raw_centroid = sum_x_mu / sum_mu if sum_mu > 0.0 else 0.0

    # Theoretical max raw centroid of the Mamdani output COG geometry is ~62.5%
    # Normalize by 0.625 so full conviction signals scale cleanly to +/- 100%
    centroid_score = round(raw_centroid / 0.625, 1)
    centroid_score = max(-100.0, min(100.0, centroid_score))

    # Apply structural credit / cash flow quality caps
    if r403_cap or r405_cap:
        centroid_score = min(centroid_score, 18.0)

    # Map score to linguistic rating
    if centroid_score >= 70.0:
        rating = "Strong Buy"
    elif centroid_score >= 30.0:
        rating = "Buy"
    elif centroid_score <= -70.0:
        rating = "Strong Sell"
    elif centroid_score <= -30.0:
        rating = "Sell"
    else:
        rating = "Hold"

    # Determine market regime description
    if adx >= 28.0:
        regime = f"Trending (ADX: {round(adx, 1)})"
    elif adx <= 18.0:
        regime = f"Ranging/Sideways (ADX: {round(adx, 1)})"
    else:
        regime = f"Consolidating (ADX: {round(adx, 1)})"

    return {
        "fuzzy_score": round(centroid_score, 1),
        "rating": rating,
        "market_regime": regime,
        "rule_trail": rule_trail,
        "membership_grades": {
            "buy": round(buy_activation, 2),
            "hold": round(hold_activation, 2),
            "sell": round(sell_activation, 2)
        }
    }


def get_all_fuzzy_rules_kb():
    """Returns comprehensive metadata for all 19 Mamdani Fuzzy Rules & Safeguards."""
    return [
        {
            "id": 101,
            "name": "Stage 2 Breakout Alignment",
            "category": "Buy Signals",
            "type": "buy",
            "formula": "min(Stage 2, RSI_healthy, ADX_strong)",
            "description": "Fires when stock price is above 200-DMA with 50 > 200 DMA, 14-Day RSI in healthy zone (45-65), and ADX > 25 confirming trend strength.",
            "impact": "Strong Buy (+85)"
        },
        {
            "id": 102,
            "name": "Stage 1 Quiet Accumulation",
            "category": "Buy Signals",
            "type": "buy",
            "formula": "min(Stage 1, RSI_oversold)",
            "description": "Fires during sideways base building when RSI is oversold (< 40) before institutional mark-up begins.",
            "impact": "Buy (+70)"
        },
        {
            "id": 103,
            "name": "Valuation Bargain Alignment",
            "category": "Buy Signals",
            "type": "buy",
            "formula": "min(PE_discount, max(Stage 1, Stage 2))",
            "description": "Fires when current P/E ratio is < 0.85x of 3-Year Median P/E while in Stage 1 accumulation or Stage 2 breakout.",
            "impact": "Buy (+75)"
        },
        {
            "id": 104,
            "name": "Bullish DMA Stack Alignment",
            "category": "Buy Signals",
            "type": "buy",
            "formula": "20 DMA > 50 DMA > 100 DMA > 200 DMA",
            "description": "Fires when short-term, medium-term, and long-term moving averages are in perfect bullish hierarchy.",
            "impact": "Buy (+80)"
        },
        {
            "id": 105,
            "name": "52-Week High Breakout Squeeze",
            "category": "Buy Signals",
            "type": "buy",
            "formula": "min(52W_High_Prox > 0.88, Stage 2)",
            "description": "Fires when stock is within 12% of its 52-week high during an active Stage 2 uptrend.",
            "impact": "Buy (+80)"
        },
        {
            "id": 106,
            "name": "Stealth Delivery Volume Spike",
            "category": "Buy Signals",
            "type": "buy",
            "formula": "min(Delivery_Pct >= 65%, max(Stage 1, Stage 2))",
            "description": "Pre-market stealth alert: Physical share delivery % exceeds 65% on quiet volume days, indicating stealth institutional accumulation.",
            "impact": "Strong Buy (+85)"
        },
        {
            "id": 107,
            "name": "FII / DII Smart Money Flow",
            "category": "Buy Signals",
            "type": "buy",
            "formula": "min(FII_DII_Delta >= +0.5%, max(Stage 1, Stage 2))",
            "description": "Fires when FII or DII quarterly stake increases by >= 0.50% during Stage 1/2.",
            "impact": "Buy (+80)"
        },
        {
            "id": 108,
            "name": "VCP Coiled Spring Alert",
            "category": "Buy Signals",
            "type": "buy",
            "formula": "VCP_Squeeze == True AND Stage 1 > 0.5",
            "description": "Volatility Contraction Pattern: Tight price coiling with volume dry-up ready for immediate breakout.",
            "impact": "Strong Buy (+85)"
        },
        {
            "id": 201,
            "name": "Fundamental Quality Acceleration",
            "category": "Quality Trajectories",
            "type": "quality",
            "formula": "min(ROE_Improving, OPM_Expanding)",
            "description": "Fires when Operating Margin (OPM) and Return on Capital (ROE) expand simultaneously.",
            "impact": "Buy (+75)"
        },
        {
            "id": 202,
            "name": "Early Bird Turnaround",
            "category": "Quality Trajectories",
            "type": "quality",
            "formula": "min(Rule 201, Stage 1)",
            "description": "Combines fundamental quality expansion with Stage 1 base-building before public news.",
            "impact": "Buy (+80)"
        },
        {
            "id": 301,
            "name": "Value Trap Warning",
            "category": "Bearish & Markdown",
            "type": "sell",
            "formula": "min(OPM_Compressing, Debt_Borrowing)",
            "description": "Fires when profit margins shrink while total debt leverage increases.",
            "impact": "Sell (-75)"
        },
        {
            "id": 302,
            "name": "Markdown Distribution / Exit",
            "category": "Bearish & Markdown",
            "type": "sell",
            "formula": "max(Stage 3, Stage 4)",
            "description": "Fires when stock enters Stage 3 top distribution or Stage 4 active markdown downtrend.",
            "impact": "Strong Sell (-85)"
        },
        {
            "id": 303,
            "name": "Overvaluation Bubble Risk",
            "category": "Bearish & Markdown",
            "type": "sell",
            "formula": "min(PE_Overvalued > 1.45x, OPM_Compressing)",
            "description": "Fires when stock trades > 1.45x over 3Y Median PE while margin compression has begun.",
            "impact": "Sell (-80)"
        },
        {
            "id": 304,
            "name": "Bearish DMA Stack Alignment",
            "category": "Bearish & Markdown",
            "type": "sell",
            "formula": "20 DMA < 50 DMA < 100 DMA < 200 DMA",
            "description": "Fires when moving averages align in descending bearish hierarchy.",
            "impact": "Strong Sell (-85)"
        },
        {
            "id": 401,
            "name": "Promoter Risk Penalty",
            "category": "Safeguards & Hard Caps",
            "type": "cap",
            "formula": "Pledge Delta > 2% OR Promoter Holding < 30%",
            "description": "Applies a 50% multiplier penalty to Buy activations if promoter pledging rises or equity holding is low.",
            "impact": "Penalty (-50%)"
        },
        {
            "id": 402,
            "name": "Volume Drift Penalty",
            "category": "Safeguards & Hard Caps",
            "type": "cap",
            "formula": "Relative Volume < 0.80",
            "description": "Applies a 40% penalty if trading volume falls below 80% of 20-day average.",
            "impact": "Penalty (-40%)"
        },
        {
            "id": 403,
            "name": "Altman Z & Piotroski Hard Cap",
            "category": "Safeguards & Hard Caps",
            "type": "cap",
            "formula": "Altman Z < 1.8 OR Piotroski Score < 4",
            "description": "Hard caps final Mamdani score at <= +18.0 (Hold) for distress risk candidates.",
            "impact": "Hard Cap (<= 18.0)"
        },
        {
            "id": 404,
            "name": "Sector Markdown Penalty",
            "category": "Safeguards & Hard Caps",
            "type": "cap",
            "formula": "Sector 1-Month Return < -5.0%",
            "description": "Applies a 40% penalty when sector macro trend is in active markdown.",
            "impact": "Penalty (-40%)"
        },
        {
            "id": 405,
            "name": "Solvency & Cash Flow Trap Cap",
            "category": "Safeguards & Hard Caps",
            "type": "cap",
            "formula": "ICR < 1.5 OR OCF/PAT Ratio < 0.50",
            "description": "Pre-market safeguard: Hard caps final score at <= +18.0 if Interest Coverage Ratio < 1.5 or Operating Cash Flow is less than half of reported Net Profit.",
            "impact": "Hard Cap (<= 18.0)"
        }
    ]
