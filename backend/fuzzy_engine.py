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
    sector_markdown: bool
) -> dict:
    """
    Evaluates Mamdani Fuzzy Inference logic for a stock.
    Returns:
        dict: containing fuzzy score (-100 to +100), active ratings, and rules trails.
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
    rsi_neutral = triangle(rsi, 35.0, 50.0, 65.0)
    rsi_overbought = trapezoid(rsi, 60.0, 70.0, 100.0, 100.0)

    # 200-DMA Proximity
    dma_below = trapezoid(dma_prox, -999.0, -999.0, -5.0, 0.0)
    dma_near = triangle(dma_prox, -2.0, 0.0, 2.0)
    dma_above = trapezoid(dma_prox, 0.0, 5.0, 999.0, 999.0)

    # ADX (Trend Strength)
    adx_weak = trapezoid(adx, 0.0, 0.0, 15.0, 20.0)
    adx_moderate = triangle(adx, 18.0, 25.0, 32.0)
    adx_strong = trapezoid(adx, 30.0, 40.0, 100.0, 100.0)

    # Wyckoff Stages
    is_stage_1 = 1.0 if stage == 1 else 0.0
    is_stage_2 = 1.0 if stage == 2 else 0.0
    is_stage_3 = 1.0 if stage == 3 else 0.0
    is_stage_4 = 1.0 if stage == 4 else 0.0

    # 2. Evaluate Rule Base
    rule_trail = []
    
    # Rule 101: Breakout momentum in trending market
    r101 = min(is_stage_2, rsi_neutral, adx_strong)
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

    # Rule 201: Quality Turnaround
    r201 = min(roe_improving, opm_expanding, debt_deleveraging)
    if r201 > 0.1:
        rule_trail.append({
            "rule_id": 201,
            "rule_name": "Fundamental Quality Acceleration",
            "rating": "Hold",
            "membership_grade": round(r201, 2),
            "implication": "Fundamental Quality Acceleration (Margins & Deleveraging)",
            "description": "Fundamental Quality Acceleration (Margins & Deleveraging)",
            "type": "hold",
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

    # 4. Compute Output Category Activations (Mamdani Aggregation)
    # Penalize buy activations dynamically if safeguards fail
    max_penalty = max(r401_penalty, r402_penalty, r404_penalty)
    buy_activation = max(r101, r102, r202) * (1.0 - max_penalty)
    
    hold_activation = max(r201, min(is_stage_1, rsi_neutral))
    sell_activation = max(r301, r302)

    # 5. Defuzzification (Centroid COG)
    # Output domain discrete values from -100 to 100 with step 5
    domain_x = list(range(-100, 101, 5))
    
    # Define membership functions over the domain
    # Sell set: center at -75
    def mu_sell(val):
        return trapezoid(val, -100, -100, -50, 0)
    
    # Hold set: center at 0
    def mu_hold(val):
        return triangle(val, -50, 0, 50)
        
    # Buy set: center at 75
    def mu_buy(val):
        return trapezoid(val, 0, 50, 100, 100)

    sum_x_mu = 0.0
    sum_mu = 0.0
    
    for val in domain_x:
        # Aggregate the active membership value at this point
        mu_val = max(
            min(sell_activation, mu_sell(val)),
            min(hold_activation, mu_hold(val)),
            min(buy_activation, mu_buy(val))
        )
        sum_x_mu += val * mu_val
        sum_mu += mu_val

    # Default to 0 (Neutral) if no rules fired
    centroid_score = sum_x_mu / sum_mu if sum_mu > 0.0 else 0.0

    # Apply structural credit quality caps
    if r403_cap:
        centroid_score = min(centroid_score, 20.0)

    # Map score to linguistic rating
    if centroid_score >= 50.0:
        rating = "Strong Buy"
    elif centroid_score >= 15.0:
        rating = "Buy"
    elif centroid_score <= -50.0:
        rating = "Strong Sell"
    elif centroid_score <= -15.0:
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
