import math

def calculate_composite_trade_score(
    horizon: str,
    setup_name: str,
    volume_ratio: float,
    rsi: float,
    atr_pct_contracting: bool,
    nifty_bullish: bool,
    sector_leading: bool,
    f_score: int = None,
    z_score: float = None,
    promoter_pledged_pct: float = 0.0,
    fii_dii_increased: bool = False,
    delivery_pct: float = 0.0,
    days_to_earnings: int = None,
    delivery_zscore: float = 0.0,
    vsa_setup: dict = None
):
    """
    Calculates a composite trade win probability score from 0 to 100
    along with warning/catalyst flags and detailed breakdown based on quantitative confluences.
    """
    score = 0.0
    flags = []

    # Safe defaults
    volume_ratio = float(volume_ratio or 1.0)
    rsi = float(rsi or 50.0)
    promoter_pledged_pct = float(promoter_pledged_pct or 0.0)
    delivery_pct = float(delivery_pct or 0.0)
    delivery_zscore = float(delivery_zscore or 0.0)

    # Breakdown components
    setup_pts = 0.0
    vol_pts = 0.0
    quality_pts = 0.0
    delivery_pts = 0.0
    nifty_pts = 0.0
    vcp_pts = 0.0
    sector_pts = 0.0
    pledge_pts = 0.0
    inst_pts = 0.0
    earnings_pts = 0.0
    vsa_delivery_pts = 0.0

    # 1. Horizon-specific scoring
    if horizon == "medium":
        # Medium-Term Position scoring (1-6 months)
        
        # A. Technical Setup Base (Max 25 pts)
        if setup_name == "Stage 2 Breakout":
            setup_pts += 25.0
        elif setup_name == "EMA Trend Cross (20/50)":
            setup_pts += 20.0
        elif setup_name == "50-Day EMA Bounce":
            setup_pts += 22.0
        elif setup_name == "BB Breakout":
            setup_pts += 18.0
        elif setup_name == "RSI Pullback":
            setup_pts += 15.0
        elif setup_name == "Weekly MACD Bullish":
            setup_pts += 12.0
        else: # Consolidation or None
            setup_pts += 8.0

        # B. Fundamental Quality (Max 30 pts)
        # Piotroski F-Score (Max 15 pts)
        if f_score is not None:
            if f_score >= 7:
                quality_pts += 15.0
            elif f_score >= 5:
                quality_pts += 10.0
            elif f_score >= 3:
                quality_pts += 5.0
        else:
            quality_pts += 7.0 # neutral default

        # Altman Z-Score (Max 15 pts)
        if z_score is not None:
            if z_score > 2.99: # Safe
                quality_pts += 15.0
            elif z_score >= 1.81: # Grey zone
                quality_pts += 8.0
            else: # Distress zone
                flags.append("Distress Altman Z-Score")
        else:
            quality_pts += 8.0 # neutral default

        # C. Volume & Delivery Confirmation (Max 30 pts)
        # Volume Ratio (Max 15 pts)
        if volume_ratio >= 2.0:
            vol_pts += 15.0
        elif volume_ratio >= 1.5:
            vol_pts += 12.0
        elif volume_ratio >= 1.0:
            vol_pts += 8.0
        else:
            vol_pts += 3.0

        # Delivery Percentage (Max 15 pts)
        if delivery_pct >= 45.0:
            delivery_pts += 15.0
        elif delivery_pct >= 35.0:
            delivery_pts += 10.0
        elif delivery_pct >= 20.0:
            delivery_pts += 5.0
        else:
            flags.append("Low Delivery Speculation")

        # D. EMA Trend Cross Alignment (Max 15 pts)
        # This acts as our trend continuation factor
        if setup_name in ["Stage 2 Breakout", "EMA Trend Cross (20/50)", "50-Day EMA Bounce"]:
            setup_pts += 15.0
        else:
            setup_pts += 5.0

    else:
        # Short-Term Swing scoring (5-15 days)
        
        # A. Technical Setup Match (Max 40 pts)
        if setup_name == "BB Squeeze Breakout":
            setup_pts += 40.0
        elif setup_name == "EMA Golden Cross (5/20)":
            setup_pts += 35.0
        elif setup_name == "MACD Bullish Crossover":
            setup_pts += 32.0
        elif setup_name == "RSI Pullback":
            setup_pts += 30.0
        elif setup_name == "Fibonacci Support Bounce":
            setup_pts += 28.0
        else: # Consolidation
            setup_pts += 15.0

        # B. Volume Surge Factor (Max 30 pts)
        if volume_ratio >= 2.5:
            vol_pts += 30.0
        elif volume_ratio >= 1.8:
            vol_pts += 24.0
        elif volume_ratio >= 1.2:
            vol_pts += 18.0
        elif volume_ratio >= 0.8:
            vol_pts += 10.0
        else:
            vol_pts += 2.0

        # C. RSI Target Alignment (Max 15 pts)
        if setup_name in ["BB Squeeze Breakout", "EMA Golden Cross (5/20)"]:
            # Breakout momentum sweet spot
            if 55.0 <= rsi <= 65.0:
                quality_pts += 15.0
            elif 50.0 <= rsi <= 70.0:
                quality_pts += 10.0
            else:
                quality_pts += 3.0
        else:
            # Pullback/mean reversion sweet spot
            if rsi <= 35.0:
                quality_pts += 15.0
            elif rsi <= 42.0:
                quality_pts += 10.0
            else:
                quality_pts += 5.0

        # D. Nifty Benchmark Guardrail (Max 15 pts)
        if nifty_bullish:
            nifty_pts += 15.0
        else:
            flags.append("Bearish Index Regime")

    # 2. Universal Multipliers & Penalties (Universal Overlays)
    
    # A. Volatility Contraction Pattern (VCP / ATR Contraction)
    if atr_pct_contracting:
        vcp_pts += 15.0
        flags.append("VCP")
        
    # B. Sector Strength
    if sector_leading:
        sector_pts += 10.0
        flags.append("Leading Sector")

    # C. Promoter Pledging Penalty
    if promoter_pledged_pct > 10.0:
        pledge_pts -= 20.0
        flags.append(f"High Promoter Pledge ({promoter_pledged_pct:.1f}%)")
        
    # D. FII/DII Institutional Buying
    if fii_dii_increased:
        inst_pts += 10.0
        flags.append("Institutional Accumulation")
        
    # E. Earnings calendar buffer (Gap Risk)
    if days_to_earnings is not None:
        if days_to_earnings <= 5:
            earnings_pts -= 25.0
            flags.append(f"Earnings in {days_to_earnings} days")

    # F. VSA and Delivery Z-Score dynamics
    if delivery_zscore >= 2.0:
        vsa_delivery_pts += 15.0
        flags.append(f"★ Institutional Block Buying (Z: {delivery_zscore:+.2f})")
    
    if vsa_setup is not None:
        vsa_type = vsa_setup.get("type")
        vsa_pattern = vsa_setup.get("pattern")
        if vsa_type == "bullish":
            vsa_delivery_pts += 15.0
            flags.append(f"Bullish VSA: {vsa_pattern}")
        elif vsa_type == "bearish":
            vsa_delivery_pts -= 15.0
            flags.append(f"Bearish VSA: {vsa_pattern}")

    # G. Specific VSA & Delivery Confluences
    # High delivery breakout (+15 points)
    is_breakout = setup_name in ["Stage 2 Breakout", "BB Breakout", "BB Squeeze Breakout", "Stage 2 Breakout"]
    if is_breakout and (delivery_pct >= 45.0 or delivery_zscore >= 1.5):
        vsa_delivery_pts += 15.0
        flags.append("★ High Delivery Breakout Confirmation")

    # Low volume pullback (+12 points)
    is_pullback = setup_name in ["RSI Pullback", "50-Day EMA Bounce", "Fibonacci Support Bounce"]
    if is_pullback and volume_ratio <= 0.8:
        vsa_delivery_pts += 12.0
        flags.append("★ Low Volume Pullback Confirmation")

    # Final score summation
    score = (
        setup_pts +
        vol_pts +
        quality_pts +
        delivery_pts +
        nifty_pts +
        vcp_pts +
        sector_pts +
        pledge_pts +
        inst_pts +
        earnings_pts +
        vsa_delivery_pts
    )

    # Clamp the final score between 0 and 100
    final_score = max(0.0, min(100.0, score))
    
    breakdown = {
        "Setup Base": round(setup_pts, 1),
        "Volume Surge": round(vol_pts, 1),
        "RSI/Quality": round(quality_pts, 1),
        "Delivery Status": round(delivery_pts, 1),
        "Nifty Guardrail": round(nifty_pts, 1),
        "VCP Contraction": round(vcp_pts, 1),
        "Sector Strength": round(sector_pts, 1),
        "Promoter Pledge Penalty": round(pledge_pts, 1),
        "Institutional Accumulation": round(inst_pts, 1),
        "Earnings Risk Penalty": round(earnings_pts, 1),
        "VSA & Delivery Dynamics": round(vsa_delivery_pts, 1)
    }
    
    return round(final_score, 1), flags, breakdown


def detect_vsa_setup(open_p, high_p, low_p, close_p, volume, avg_volume_20d):
    """
    Analyzes price spread, close location, and relative volume of a single candle.
    Returns: {"pattern": str, "description": str, "type": "bullish"|"bearish"|"neutral"} or None
    """
    open_p = float(open_p or 0.0)
    high_p = float(high_p or 0.0)
    low_p = float(low_p or 0.0)
    close_p = float(close_p or 0.0)
    volume = float(volume or 0.0)
    avg_volume_20d = float(avg_volume_20d or 1.0)
    
    if low_p == high_p or volume <= 0.0:
        return None
        
    spread = high_p - low_p
    close_pos = (close_p - low_p) / spread
    vol_ratio = volume / avg_volume_20d if avg_volume_20d > 0 else 1.0

    # 1. Selling Climax (extreme volume down bar closing high/middle - buying support absorption)
    if vol_ratio >= 2.0 and close_p < open_p and close_pos >= 0.4:
        return {
            "pattern": "Selling Climax / Bag Holding",
            "description": f"Wide range down-bar closing in upper/middle third on extreme volume ({vol_ratio:.1f}x). Indicates massive institutional absorption of public panic supply.",
            "type": "bullish"
        }

    # 2. No Supply Bar (narrow range down-bar on very low volume, close in lower/middle - test for supply)
    if vol_ratio <= 0.6 and close_p < open_p and close_pos <= 0.6:
        return {
            "pattern": "No Supply Bar",
            "description": f"Narrow range down-bar closing in lower/middle third on very low volume ({vol_ratio:.1f}x). Confirms sellers are exhausted and supply is absorbed.",
            "type": "bullish"
        }

    # 3. No Demand Bar (narrow range up-bar on very low volume, close in upper/middle)
    if vol_ratio <= 0.6 and close_p > open_p and close_pos >= 0.4:
        return {
            "pattern": "No Demand Bar",
            "description": f"Narrow range up-bar closing in upper/middle third on very low volume ({vol_ratio:.1f}x). Warns of lack of institutional buying interest.",
            "type": "bearish"
        }

    # 4. Effort vs Result (high volume narrow range bar)
    if vol_ratio >= 1.5 and close_pos >= 0.6:
        return {
            "pattern": "Effort vs Result (Accumulation)",
            "description": f"Elevated volume ({vol_ratio:.1f}x) failed to drive wide price spread, but closed near highs. Indicates institutional absorption of overhead supply.",
            "type": "bullish"
        }
        
    if vol_ratio >= 1.5 and close_pos <= 0.4:
        return {
            "pattern": "Effort vs Result (Distribution)",
            "description": f"Elevated volume ({vol_ratio:.1f}x) failed to drive wide price range, and closed near lows. Indicates institutional distribution meeting buying support.",
            "type": "bearish"
        }
        
    return None


def calculate_delivery_zscore(historical_delivery_values: list) -> float:
    """
    Calculates the Z-score of the latest deliverable value relative to the past 20 days.
    """
    clean_values = []
    for v in historical_delivery_values:
        if v is not None:
            try:
                clean_values.append(float(v))
            except (ValueError, TypeError):
                continue
                
    if len(clean_values) < 5:
        return 0.0
    
    # Take up to 20 historical records excluding the last one (for baseline)
    baseline = clean_values[:-1]
    if len(baseline) == 0:
        return 0.0
        
    latest = clean_values[-1]
    
    # Calculate mean
    mean = sum(baseline) / len(baseline)
    
    # Calculate variance & standard deviation
    variance = sum((x - mean) ** 2 for x in baseline) / len(baseline)
    std_dev = math.sqrt(variance)
    
    if std_dev == 0.0:
        return 0.0
        
    z_score = (latest - mean) / std_dev
    return round(z_score, 2)
