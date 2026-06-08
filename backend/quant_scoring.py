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
    days_to_earnings: int = None
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
        earnings_pts
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
        "Earnings Risk Penalty": round(earnings_pts, 1)
    }
    
    return round(final_score, 1), flags, breakdown
