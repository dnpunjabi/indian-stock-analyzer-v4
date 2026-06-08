import numpy as np
import pandas as pd
import math

def clean_float(val, default=0.0):
    try:
        fval = float(val)
        if math.isnan(fval) or math.isinf(fval):
            return default
        return fval
    except Exception:
        return default

def calculate_volume_profile(df, bins=15):
    """
    Groups price levels into bins and sums corresponding volume
    to output data coordinates for Volume Profile vertical histogram.
    """
    if df.empty or 'Close' not in df.columns or 'Volume' not in df.columns:
        return []
    
    try:
        prices = df['Close'].dropna()
        volumes = df['Volume'].dropna()
        if len(prices) == 0:
            return []
            
        min_p = float(prices.min())
        max_p = float(prices.max())
        if min_p == max_p:
            return [{"price": min_p, "volume": float(volumes.sum())}]
            
        bin_width = (max_p - min_p) / bins
        profile_bins = []
        for i in range(bins):
            b_low = min_p + i * bin_width
            b_high = b_low + bin_width
            # Select volume for closes in this bin range
            mask = (prices >= b_low) & (prices < b_high) if i < bins - 1 else (prices >= b_low) & (prices <= b_high)
            bin_vol = float(volumes[mask].sum())
            mid_p = float(b_low + bin_width / 2.0)
            profile_bins.append({
                "price": round(mid_p, 2),
                "volume": round(bin_vol, 2)
            })
        return profile_bins
    except Exception as e:
        print(f"Error calculating volume profile: {e}")
        return []

def calculate_swing_indicators(df):
    """
    Appends EMAs, Bollinger Bands, ATR, and MACD indicators to a historical price dataframe.
    """
    if len(df) < 26:
        return df
        
    df = df.copy()
    # EMAs
    df['EMA_5'] = df['Close'].ewm(span=5, adjust=False).mean()
    df['EMA_20'] = df['Close'].ewm(span=20, adjust=False).mean()
    df['EMA_50'] = df['Close'].ewm(span=50, adjust=False).mean()
    df['SMA_150'] = df['Close'].rolling(window=150).mean()
    df['SMA_150'] = df['SMA_150'].bfill().ffill()
    
    # Bollinger Bands
    df['SMA_20'] = df['Close'].rolling(window=20).mean()
    df['STD_20'] = df['Close'].rolling(window=20).std()
    df['BB_Upper'] = df['SMA_20'] + 2 * df['STD_20']
    df['BB_Lower'] = df['SMA_20'] - 2 * df['STD_20']
    
    # ATR (14-day)
    df['H-L'] = df['High'] - df['Low']
    df['H-Cp'] = (df['High'] - df['Close'].shift(1)).abs()
    df['L-Cp'] = (df['Low'] - df['Close'].shift(1)).abs()
    df['TR'] = df[['H-L', 'H-Cp', 'L-Cp']].max(axis=1)
    df['ATR'] = df['TR'].rolling(window=14).mean()
    df['ATR'] = df['ATR'].bfill().ffill()
    
    # MACD (12, 26, 9)
    df['EMA_12'] = df['Close'].ewm(span=12, adjust=False).mean()
    df['EMA_26'] = df['Close'].ewm(span=26, adjust=False).mean()
    df['MACD'] = df['EMA_12'] - df['EMA_26']
    df['MACD_Signal'] = df['MACD'].ewm(span=9, adjust=False).mean()
    df['MACD_Hist'] = df['MACD'] - df['MACD_Signal']
    
    return df

def analyze_swing_signals(df, horizon="short"):
    """
    Determines short-term setup triggers (RSI Pullback, MACD crossover, etc.) based on last bars.
    Returns: (setup_name, description, stop_loss_val, take_profit_1, take_profit_2)
    """
    if len(df) < 30:
        return "None", "Insufficient data history", 0.0, 0.0, 0.0
        
    df = calculate_swing_indicators(df)
    last_row = df.iloc[-1]
    prev_row = df.iloc[-2]
    
    current_price = float(last_row['Close'])
    atr = clean_float(last_row['ATR'], 1.0)
    
    # Fibonacci levels for support bounce detection
    high_52 = float(df['High'].max())
    low_52 = float(df['Low'].min())
    diff = high_52 - low_52
    fibs = {
        "0.236": high_52 - 0.236 * diff,
        "0.382": high_52 - 0.382 * diff,
        "0.500": high_52 - 0.500 * diff,
        "0.618": high_52 - 0.618 * diff,
        "0.786": high_52 - 0.786 * diff
    }
    
    # 1. BB squeeze and volume ratio calculation
    squeeze_width = (float(last_row['BB_Upper']) - float(last_row['BB_Lower'])) / float(last_row['BB_Lower']) if float(last_row['BB_Lower']) > 0 else 0.5
    vol_ratio = float(last_row['Volume']) / float(df['Volume'].rolling(window=20).mean().iloc[-1]) if not pd.isna(df['Volume'].rolling(window=20).mean().iloc[-1]) else 1.0
    
    # 2. RSI Calculation
    delta = df['Close'].diff()
    gain = (delta.where(delta > 0, 0)).copy()
    loss = (-delta.where(delta < 0, 0)).copy()
    avg_gain = gain.rolling(window=14).mean()
    avg_loss = loss.rolling(window=14).mean()
    for i in range(14, len(df)):
        avg_gain.iloc[i] = (avg_gain.iloc[i-1] * 13 + gain.iloc[i]) / 14
        avg_loss.iloc[i] = (avg_loss.iloc[i-1] * 13 + loss.iloc[i]) / 14
    rs = avg_gain / avg_loss
    rsi_series = 100 - (100 / (1 + rs))
    last_rsi = float(rsi_series.iloc[-1]) if not pd.isna(rsi_series.iloc[-1]) else 50.0

    if horizon == "medium":
        # Medium-term position trading strategies
        # 1. EMA 20 crossing above EMA 50 (Golden Cross) lookback 5 days
        ema_crossed_up = False
        for i in range(-5, 0):
            if i >= -len(df) + 1:
                p_r = df.iloc[i-1]
                c_r = df.iloc[i]
                if p_r['EMA_20'] <= p_r['EMA_50'] and c_r['EMA_20'] > c_r['EMA_50']:
                    ema_crossed_up = True
                    break
                    
        # 2. MACD Bullish state on daily
        macd_bullish = last_row['MACD'] > last_row['MACD_Signal']
        # 3. Stage 2 Breakout: close above 150-day SMA on high volume ratio (1.5x)
        is_stage_2 = (current_price > float(last_row['SMA_150'])) and (vol_ratio >= 1.5)
        # 4. 50-day EMA Support bounce
        dist_to_ema50 = abs(current_price - float(last_row['EMA_50'])) / float(last_row['EMA_50'])
        is_ema50_bounce = dist_to_ema50 <= 0.015 and (current_price >= float(last_row['EMA_50']))
        # 5. RSI Pullback (RSI <= 45)
        is_rsi_pullback = last_rsi <= 45.0
        # 6. BB Breakout (Close >= BB Upper and Vol Ratio >= 1.2)
        is_bb_breakout = (current_price >= float(last_row['BB_Upper'])) and (vol_ratio >= 1.2)

        # Set default values for medium term (wider stops and targets)
        stop_loss = round(current_price - 3.0 * atr, 2)
        tp1 = round(current_price + 3.0 * atr, 2)
        tp2 = round(current_price + 6.0 * atr, 2)
        setup = "Consolidation Trend"
        desc = "No distinct intermediate-term position trading setup triggered."

        if is_stage_2:
            setup = "Stage 2 Breakout"
            desc = f"Price broke out above the rising 150-day SMA on significant volume surge ({vol_ratio:.1f}x), entering a major Stage 2 markup trend."
            stop_loss = round(float(last_row['SMA_150']), 2)
            tp1 = round(current_price + 4.0 * atr, 2)
            tp2 = round(current_price + 8.0 * atr, 2)
        elif ema_crossed_up:
            setup = "EMA Trend Cross (20/50)"
            desc = "20-day EMA crossed above the 50-day EMA within the last 5 days, confirming intermediate trend shift and positive structural bias."
            stop_loss = round(current_price - 3.25 * atr, 2)
            tp1 = round(current_price + 3.5 * atr, 2)
            tp2 = round(current_price + 7.0 * atr, 2)
        elif is_ema50_bounce:
            setup = "50-Day EMA Bounce"
            desc = f"Price pullbacked to and bounced off the critical 50-day EMA support of Rs. {float(last_row['EMA_50']):.2f}, consolidating for trend continuation."
            stop_loss = round(float(last_row['EMA_50']) - 1.0 * atr, 2)
            tp1 = round(current_price + 3.0 * atr, 2)
            tp2 = round(current_price + 6.5 * atr, 2)
        elif is_rsi_pullback:
            setup = "RSI Pullback"
            desc = f"RSI levels are soft at {last_rsi:.1f}, indicating a healthy intermediate-term pullback consolidation in a longer-term bull structure."
            stop_loss = round(current_price - 2.75 * atr, 2)
            tp1 = round(current_price + 3.0 * atr, 2)
            tp2 = round(current_price + 6.0 * atr, 2)
        elif is_bb_breakout:
            setup = "BB Breakout"
            desc = f"Price broke above the upper Bollinger Band (Rs. {float(last_row['BB_Upper']):.2f}) on elevated volume ({vol_ratio:.1f}x), entering a medium-term momentum phase."
            stop_loss = round(float(last_row['SMA_20']), 2)
            tp1 = round(current_price + 3.5 * atr, 2)
            tp2 = round(current_price + 7.0 * atr, 2)
        elif macd_bullish:
            setup = "Weekly MACD Bullish"
            desc = "MACD trend indicators reside in positive territory, signaling long-term institutional accumulation and positive momentum."
            stop_loss = round(current_price - 3.0 * atr, 2)
            tp1 = round(current_price + 3.0 * atr, 2)
            tp2 = round(current_price + 6.0 * atr, 2)
        else:
            # Consolidation Trend fallback based on 50 EMA
            above_ema50 = current_price >= float(last_row['EMA_50'])
            ema50_val = float(last_row['EMA_50'])
            ema50_dist = ((current_price - ema50_val) / ema50_val) * 100
            setup = "Consolidation Trend"
            
            # Dynamic multipliers based on RSI
            sl_mult = round(2.8 + (last_rsi / 100.0) * 0.4, 2)
            tp2_mult = round(5.5 + ((100.0 - last_rsi) / 100.0) * 0.8, 2)
            stop_loss = round(current_price - sl_mult * atr, 2)
            tp1 = round(current_price + (sl_mult * 0.8) * atr, 2)
            tp2 = round(current_price + tp2_mult * atr, 2)
            
            if above_ema50:
                desc = f"Price is consolidating above the 50-day EMA (+{ema50_dist:.1f}%), building a solid base for a multi-month trend extension. Await breakout volume."
            else:
                desc = f"Price is consolidating below the 50-day EMA ({ema50_dist:.1f}%), correcting in intermediate trend digestion. Re-entry requires daily trend alignment."
    else:
        # Default outputs (Short term)
        setup = "Consolidation Trend"
        desc = "No distinct short-term trading setup triggered."
        stop_loss = round(current_price - 2 * atr, 2)
        tp1 = round(current_price + 1.5 * atr, 2)
        tp2 = round(current_price + 3 * atr, 2)
        
        # 1. MACD Bullish Crossover Check (Look back 5 bars)
        macd_crossed_up = False
        for i in range(-5, 0):
            if i >= -len(df) + 1:
                p_r = df.iloc[i-1]
                c_r = df.iloc[i]
                if p_r['MACD'] <= p_r['MACD_Signal'] and c_r['MACD'] > c_r['MACD_Signal']:
                    macd_crossed_up = True
                    break

        # 2. EMA Crossover Check (5 EMA crossing 20 EMA) (Look back 5 bars)
        ema_crossed_up = False
        for i in range(-5, 0):
            if i >= -len(df) + 1:
                p_r = df.iloc[i-1]
                c_r = df.iloc[i]
                if p_r['EMA_5'] <= p_r['EMA_20'] and c_r['EMA_5'] > c_r['EMA_20']:
                    ema_crossed_up = True
                    break
        
        # Check triggers in order of importance
        if last_rsi <= 35.0:
            setup = "RSI Pullback"
            desc = f"RSI oversold at {last_rsi:.1f} indicates deep mean-reversion pullback near key support boundaries."
            stop_loss = round(current_price - 1.5 * atr, 2)
            tp1 = round(current_price + 2.0 * atr, 2)
            tp2 = round(current_price + 3.5 * atr, 2)
        elif macd_crossed_up:
            setup = "MACD Bullish Crossover"
            desc = "MACD fast line crossed above the signal line within the last 5 days, indicating new positive momentum."
            stop_loss = round(current_price - 1.75 * atr, 2)
            tp1 = round(current_price + 2.0 * atr, 2)
            tp2 = round(current_price + 3.5 * atr, 2)
        elif ema_crossed_up:
            setup = "EMA Golden Cross (5/20)"
            desc = "Short-term 5-day EMA crossed above the 20-day EMA within the last 5 days, signaling a new uptrend acceleration."
            stop_loss = round(current_price - 2.25 * atr, 2)
            tp1 = round(current_price + 2.5 * atr, 2)
            tp2 = round(current_price + 4.5 * atr, 2)
        elif float(last_row['Close']) >= float(last_row['BB_Upper']) and vol_ratio >= 1.2:
            setup = "BB Squeeze Breakout"
            desc = f"Price broke above upper Bollinger Band on elevated volume ({vol_ratio:.1f}x) following BB Squeeze width of {squeeze_width*100:.1f}%."
            stop_loss = round(float(last_row['SMA_20']), 2) # Stop loss at 20 SMA
            tp1 = round(current_price + 2.5 * atr, 2)
            tp2 = round(current_price + 4.0 * atr, 2)
        else:
            # Check Fibonacci support zones
            fib_match = False
            for lvl, val in fibs.items():
                if abs(current_price - val) / val <= 0.015: # within 1.5%
                    setup = "Fibonacci Support Bounce"
                    desc = f"Price is hovering near the critical {float(lvl)*100:.1f}% Fibonacci retracement support level of Rs. {val:.2f}."
                    stop_loss = round(current_price - 1.25 * atr, 2)
                    tp1 = round(current_price + 2.0 * atr, 2)
                    tp2 = round(current_price + 3.75 * atr, 2)
                    fib_match = True
                    break
            
            if not fib_match:
                above_ema = current_price >= float(last_row['EMA_20'])
                ema_val = float(last_row['EMA_20'])
                ema_dist = ((current_price - ema_val) / ema_val) * 100
                setup = "Consolidation Trend"
                
                # Dynamic multipliers based on stock's exact RSI
                sl_mult = round(1.8 + (last_rsi / 100.0) * 0.4, 2)
                tp2_mult = round(2.8 + ((100.0 - last_rsi) / 100.0) * 0.6, 2)
                stop_loss = round(current_price - sl_mult * atr, 2)
                tp1 = round(current_price + (sl_mult * 0.75) * atr, 2)
                tp2 = round(current_price + tp2_mult * atr, 2)
                
                if above_ema:
                    desc = f"Price is consolidating above the 20-day EMA (+{ema_dist:.1f}%), exhibiting a stable short-term base setup. Monitor for momentum breakouts."
                else:
                    desc = f"Price is consolidating below the 20-day EMA ({ema_dist:.1f}%), showing short-term index digestion. Await high-volume reversal triggers."
                    
    return setup, desc, stop_loss, tp1, tp2
