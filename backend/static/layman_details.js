/**
 * Learning Academy - Layman Details Database
 * Mappings of simple analogies and key takeaways for all 72 modules.
 */
const ACADEMY_LAYMAN_DETAILS = {
    // ── TECHNICAL INDICATORS ──
    'rsi': {
        analogy: "Think of RSI like a runner's stamina. If they sprint too fast (RSI > 70), they get exhausted and need to slow down or rest. If they rest too long (RSI < 30), they recover and are ready to run again.",
        takeaway: "Avoid buying at the absolute peak when buyers are exhausted, or selling at the absolute bottom when sellers are done."
    },
    'macd': {
        analogy: "Think of MACD as comparing speed to acceleration. The speedometer tells you your current speed, but the gas pedal shows changes in acceleration. When you press the gas, acceleration shifts before the overall speed does.",
        takeaway: "Spot early momentum reversals (speeding up or slowing down) before the price trend fully shifts."
    },
    'adr_atr': {
        analogy: "Think of ATR as the average daily temperature swing. If a city's temperature swings by 15 degrees on average, wearing a light jacket won't protect you from volatility. You adjust your gear based on the expected range.",
        takeaway: "Adjust stop-loss margins and size your stock purchases so that normal daily market breathing doesn't accidentally trigger a sell."
    },
    'sma_ema': {
        analogy: "SMA is like your average score over the entire semester. EMA is like your recent exam grades. EMA reacts quickly to a sudden study boost, whereas SMA takes a long time to change.",
        takeaway: "SMA shows the long-term baseline direction, while EMA acts as a sensitive trend indicator for fast-moving entries."
    },
    'bollinger': {
        analogy: "Think of Bollinger Bands as a highway. The cars (prices) usually stay within the lanes. When the lanes narrow (squeeze), a major curve or lane change is coming. When a car hits the guardrails, it tends to bounce back toward the middle.",
        takeaway: "Identify quiet consolidation periods ripe for breakouts, and spot when price is stretched too far from the average."
    },
    'adx': {
        analogy: "Think of ADX as a wind tunnel sensor. It measures how fast the wind is blowing, but not which direction. A storm blowing north or south both show high wind speed.",
        takeaway: "Use ADX to decide whether to play trend-following strategies (ADX > 25) or range-bound strategies (ADX < 20)."
    },
    'stochastic': {
        analogy: "Think of it like a pendulum. As it swings up, it slows down near its peak height before gravity pulls it back. The oscillator tracks how close the current closing price is to its recent high or low boundary.",
        takeaway: "Find micro-timing turning points in range-bound environments by identifying swing extremes."
    },
    'ichimoku': {
        analogy: "Think of it as looking at weather systems. The 'Cloud' is a thick layer of fog. If you are flying above the fog, it's clear skies (bullish). If you are inside or below the fog, visibility is poor and storm risk is high.",
        takeaway: "Determine trend direction, support levels, and momentum all at a single glance."
    },
    'fib_retracement': {
        analogy: "Think of a bouncing ball dropped from the top of a staircase. It doesn't fall straight down; it hits steps on the way down and bounces up temporarily before continuing its course.",
        takeaway: "Identify key price floor levels where buyers are historically likely to step in during a pullback."
    },
    'vwap': {
        analogy: "Think of VWAP as the average ticket price paid by all fans entering a stadium. If some bought early VIP passes and others bought cheap last-minute seats, the average ticket price is the true benchmark value of a seat.",
        takeaway: "Institutions use VWAP to buy without moving the market; buying below VWAP means you got a bargain compared to the average trader."
    },
    'obv': {
        analogy: "Think of a crowd entering a stadium. If the crowd volume is massive but the gates aren't moving, the pressure is building. Once the gate opens, the crowd surges. OBV tracks whether volume is actively backing price rises.",
        takeaway: "If volume falls while price rises, the trend is weak and likely to collapse; if volume builds quietly, a breakout is coming."
    },
    'mfi': {
        analogy: "Think of it as RSI with a wallet. While RSI only counts how fast prices move, MFI tracks how much actual cash is driving that movement. A price rise on tiny volume is ignored by MFI.",
        takeaway: "MFI confirms price momentum by verifying that real institutional money is backing the move."
    },
    'cci': {
        analogy: "Think of a tourist traveling far from their home base. If they wander too far into the wilderness (CCI > 100 or < -100), they will eventually need to return to camp (reversion to the mean).",
        takeaway: "Spot extreme deviations from the average price range that suggest a correction or a new strong trend is starting."
    },
    'parabolic_sar': {
        analogy: "Think of a guard dog following closely behind you. As long as you walk forward, the dog stays behind you (support). If you stop or start walking backwards, the dog runs around to block your path (resistance).",
        takeaway: "A trailing stop-loss indicator that locks in profits during strong trends and clearly flags when to exit."
    },

    // ── CHART PATTERNS ──
    'head_shoulders': {
        analogy: "Think of an athlete trying to jump over a high bar. They make a good attempt (left shoulder), a massive peak jump (head), and then a weaker third attempt (right shoulder) before falling down in exhaustion.",
        takeaway: "Classic reversal signal showing buyers have run out of steam, and sellers are taking control."
    },
    'inverse_head_shoulders': {
        analogy: "An athlete falls, tries to push up but sinks to a final low, then rises and makes a final higher floor before breaking out upward.",
        takeaway: "Reliable indicator that a downtrend has bottomed out and a new bullish trend is starting."
    },
    'double_top': {
        analogy: "A climber tries to scale a mountain peak twice but gets blown back by strong winds at the exact same height both times, eventually giving up and returning to base.",
        takeaway: "Indicates strong resistance at the peaks; a breakdown below the valley (neckline) triggers a bearish correction."
    },
    'double_bottom': {
        analogy: "A bouncing ball hits the floor, bounces slightly, hits the exact same floor level a second time, and then rebounds high into the air.",
        takeaway: "Signals a strong price floor is established, setting up a bullish reversal."
    },
    'bull_flag': {
        analogy: "A sprinter makes a rapid dash forward (pole), pauses to catch their breath while walking slowly backward (flag), and then charges forward again with equal force.",
        takeaway: "A classic continuation pattern indicating that short-term profit taking is over and the main uptrend is resuming."
    },
    'bear_flag': {
        analogy: "A heavy stone drops rapidly (pole), bounces slightly upward in a narrow channel as it gets caught on twigs (flag), before plunging down again.",
        takeaway: "A continuation pattern warning that the selling pressure is pausing briefly before resuming its downward drop."
    },
    'pennants': {
        analogy: "Think of a crowd funneling into a narrowing gate after a parade. The energy converges into a tight triangle before bursting out into the main street.",
        takeaway: "A brief pause in a strong trend where the price range squeezes tightly before a continuation breakout."
    },
    'symmetrical_triangle': {
        analogy: "Think of a spring being compressed from both sides. The coils get tighter and tighter. You don't know which way the spring will jump when released, but you know it will release with force.",
        takeaway: "Indicates market indecision where price coils tightly. Trade the direction of the breakout once the boundaries are breached."
    },
    'ascending_triangle': {
        analogy: "Think of a buyer repeatedly knocking on a flat ceiling (flat resistance) while sellers are willing to buy at higher and higher floors (rising lows). Eventually, the ceiling breaks.",
        takeaway: "A bullish accumulation pattern where buyers are aggressively pushing the floor up until resistance cracks."
    },
    'descending_triangle': {
        analogy: "Sellers are pushing the price down from lower ceilings (descending highs) while buyers hold a flat floor. Eventually, the floor gives way under the weight.",
        takeaway: "A bearish pattern showing aggressive selling pressure, often leading to a breakdown below support."
    },
    'rising_wedge': {
        analogy: "Think of walking up a narrowing staircase. As the walls close in, you lose momentum and room to move, eventually slipping out or falling through.",
        takeaway: "A deceptive pattern where price edges higher but ranges tighten, signaling exhaustion and an impending drop."
    },
    'falling_wedge': {
        analogy: "Think of slides narrowing at the bottom. As the space gets tighter, sellers run out of room and buyers easily tip the scale to push the price up.",
        takeaway: "A bullish reversal pattern where downward momentum shrinks, preparing for an upward breakout."
    },
    'cup_handle': {
        analogy: "Think of a tea cup. The price slides down and rounds out a smooth bottom (cup), rises to test the rim, pulls back slightly to consolidate (handle), and then boils over (breakout).",
        takeaway: "A highly reliable bullish continuation pattern indicating steady accumulation over a long period."
    },
    'inverse_cup_handle': {
        analogy: "An upside-down cup where the price dome rises, rounds out, slips, consolidates in a minor upward flag (handle), and then drops sharply.",
        takeaway: "A bearish continuation pattern indicating distribution and overhead supply pressure."
    },
    'triple_top': {
        analogy: "A batter swings at a pitch three times, failing to hit a home run each time. After the third strike, they walk back to the dugout.",
        takeaway: "Indicates extremely strong overhead resistance. If the floor is broken, expect a significant sell-off."
    },
    'triple_bottom': {
        analogy: "A ship anchors itself with three heavy anchors. No matter how hard the waves hit, the bottom doesn't move, and the ship stays safe.",
        takeaway: "Confirms an institutional price floor. The level is highly defended by buyers, indicating a bullish pivot is likely."
    },
    'rounding_bottom': {
        analogy: "Think of a skateboard ramp. You slide down fast, slow down as you glide across the flat bottom, and then build steady upward momentum on the other side.",
        takeaway: "Represents a slow, healthy transition from a long downtrend to a steady, long-term uptrend."
    },
    'megaphone': {
        analogy: "Think of a loud argument. As it escalates, the voices get louder and the statements become more extreme. The range expands in wild, unpredictable swings.",
        takeaway: "Indicates extreme market instability and high retail emotional trading. Usually best to stay on the sidelines."
    },
    'price_channels': {
        analogy: "Think of a tennis ball being volleyed back and forth between two parallel walls. As long as the ball stays inside, you can predict its path.",
        takeaway: "Trade by buying near the bottom channel wall and selling near the top wall until a breakout occurs."
    },
    'diamond': {
        analogy: "Think of a spinning top. It starts with wild, wide wobbles (expansion), settles into a tight spin (contraction), and then suddenly falls over.",
        takeaway: "A rare, complex trend reversal pattern indicating a transition from high volatility to consolidation, leading to a major breakdown."
    },
    'gap_dynamics': {
        analogy: "A leap over a puddle. A breakaway gap is jumping over the initial curb. A runaway gap is running with full stride in the middle of the field. An exhaustion gap is a final, desperate leap where the runner trips and falls.",
        takeaway: "Gaps reveal raw market urgency. Breakaway gaps start trends, runaway gaps accelerate them, and exhaustion gaps end them."
    },

    // ── CANDLESTICK PATTERNS ──
    'doji': {
        analogy: "Think of a tug-of-war match where both teams pull with equal strength for hours, only to end up exactly where they started. Nobody wins the round.",
        takeaway: "Signals complete indecision. Watch for the next day's candle to confirm who wins the tug-of-war."
    },
    'hammer': {
        analogy: "Think of a hammer hitting a metal peg in the ground. The price plummeted during the day but got hammered right back up to close near the top.",
        takeaway: "A bullish reversal sign appearing at the end of a downtrend, showing that buyers are fighting back."
    },
    'hanging_man': {
        analogy: "Looks like a hammer, but it hangs at the top of a roof. It warns that sellers managed to drag the price down significantly during the day, showing vulnerability.",
        takeaway: "A warning sign at the end of an uptrend that buyers are losing their absolute grip on the price."
    },
    'shooting_star': {
        analogy: "A rocket launches high into the sky (intraday rally) but runs out of fuel and crashes back down to earth before the day ends.",
        takeaway: "A bearish reversal sign at a peak showing sellers rejected the high prices, pushing it back down."
    },
    'inverted_hammer': {
        analogy: "A buyer tries to lift a heavy chest. They lift it up high (upper wick), drop it back to the floor (close), but have proven they have the strength to lift it.",
        takeaway: "Appears in downtrends; signals buyers are testing their strength and a reversal is brewing."
    },
    'bullish_engulfing': {
        analogy: "Think of a big wave swallowing a small pebble. The massive green body of today's candle completely covers the small red body of yesterday.",
        takeaway: "A powerful sign that buyers have completely overwhelmed the sellers, signaling a bullish reversal."
    },
    'bearish_engulfing': {
        analogy: "A dark storm cloud completely blocks out yesterday's small sunny candle. Sellers step in with overwhelming volume.",
        takeaway: "A strong warning that sellers have taken full control, engulfing the buyers and signaling a downward slide."
    },
    'bullish_harami': {
        analogy: "Think of a pregnant mother (large red candle) carrying a baby inside (small green candle). The baby represents a new life starting to grow.",
        takeaway: "Signals that the downward momentum has paused, and a new upward trend might be born."
    },
    'bearish_harami': {
        analogy: "A large green candle 'carrying' a small red candle inside its boundaries. The growth has stopped, and contraction is beginning.",
        takeaway: "Signals that the upward run is losing steam and profit-taking is consolidating inside the range."
    },
    'morning_star': {
        analogy: "Think of the sky transition. A dark night (red candle), a brief twilight of indecision (small star), and then a bright sunrise (green candle).",
        takeaway: "A highly reliable three-candle bullish reversal pattern signaling the end of a dark downtrend."
    },
    'evening_star': {
        analogy: "A sunny day (green candle), a twilight star at the peak, and then a dark night setting in (large red candle).",
        takeaway: "A highly reliable three-candle bearish reversal pattern signaling the onset of a downtrend."
    },
    'piercing_line': {
        analogy: "A swimmer dives deep under water (opens gap down) but swims back up strongly, piercing through more than halfway to the surface of yesterday's level.",
        takeaway: "A bullish reversal pattern showing that the initial morning panic was bought up aggressively."
    },
    'dark_cloud_cover': {
        analogy: "A bright sunny day starts high, but a dark storm cloud rolls in and covers more than 50% of the previous day's gains.",
        takeaway: "A bearish reversal pattern warning that optimism is fading fast as sellers return in force."
    },
    'tweezer_tops': {
        analogy: "Think of picking up a small object with tweezers. The two prongs touch the exact same high level, proving they cannot go any higher.",
        takeaway: "Flags double-rejection at the exact same ceiling, indicating a strong bearish reversal point."
    },
    'tweezer_bottoms': {
        analogy: "The two prongs of a tweezer touch the exact same floor level, proving the price cannot sink past this point.",
        takeaway: "Flags double-rejection of lower prices, establishing a solid short-term support floor."
    },
    'three_white_soldiers': {
        analogy: "Three guards marching steadily uphill in uniform. They move with steady, confident steps without any hesitation or pullback.",
        takeaway: "A strong bullish confirmation pattern indicating a healthy and powerful trend breakout."
    },
    'three_black_crows': {
        analogy: "Three crows sitting on a wire, looking down. They represent a steady, methodical descent as sellers dump holdings day after day.",
        takeaway: "A bearish warning of institutional exit. Do not try to catch the falling knife when the crows are flying."
    },
    'marubozu': {
        analogy: "A steamroller moving in a single direction. It starts at one end and closes at the absolute other end with zero pullbacks or wicks.",
        takeaway: "Indicates absolute, one-sided dominance by either buyers (green) or sellers (red) throughout the entire session."
    },

    // ── FUNDAMENTAL ANALYSIS ──
    'three_statements': {
        analogy: "Think of a house checkup. The Income Statement is the paystub (cash coming in and going out). The Balance Sheet is the net worth statement (assets owned vs loans). The Cash Flow Statement is the actual bank account ledger.",
        takeaway: "Never look at net profit alone; a company can look rich on paper but run out of actual cash in the bank."
    },
    'valuation_multiples': {
        analogy: "P/E is like comparing house prices based on rental income. A house costing 20x its annual rent might be cheap, while one costing 100x rent is expensive unless it is in a super-growth zone.",
        takeaway: "Multiples help you determine if a stock is cheap or expensive relative to its peers and its historical average."
    },
    'return_ratios': {
        analogy: "Think of ROE like planting seeds. If you plant 100 seeds (Equity) and get 20 flowers (Return), your efficiency is 20%. If you use borrowed soil (Debt), your ROCE tracks the return on both your seeds and the borrowed soil.",
        takeaway: "High return ratios indicate the company has a strong competitive advantage (moat) and makes efficient use of capital."
    },
    'dcf_wacc': {
        analogy: "If someone promises to give you ₹100 ten years from now, you wouldn't trade ₹100 for it today because inflation and interest rates make future money less valuable. WACC is the discount rate representing your risk.",
        takeaway: "DCF calculates what a company's future cash flows are worth today to find its true 'fair price' limit."
    },
    'solvency_liquidity': {
        analogy: "Liquidity is having cash in your pocket to buy groceries today (Current Ratio). Solvency is having enough total wealth to pay off your home mortgage over the next 15 years (Debt-to-Equity).",
        takeaway: "A company can have high long-term assets but go bankrupt tomorrow if it lacks short-term cash to pay interest."
    },
    'dupont': {
        analogy: "Think of diagnostic tests on a car engine. Instead of saying the engine is slow, DuPont breaks it down: Is it because of fuel efficiency (Margin), tire rotation speed (Asset Turnover), or turbo boost (Leverage)?",
        takeaway: "Determine whether ROE is driven by high profitability, rapid asset turnover, or risky debt leverage."
    },
    'dividend_metrics': {
        analogy: "Think of owning a fruit tree. The Dividend Yield is how many apples you get to eat each year relative to the price of the tree. The Payout Ratio is what percentage of the tree's total crop is given away instead of replanted.",
        takeaway: "High dividend yield is great, but a payout ratio over 80% means the company isn't investing in its own growth."
    },
    'earnings_quality': {
        analogy: "Think of a shop owner who sells goods on credit. Their bookkeeping shows massive sales (earnings), but if customers haven't paid cash yet (high accruals), the shop owner cannot buy new inventory.",
        takeaway: "Compare cash flow from operations to net profit; if profits rise but cash drops, the earnings quality is poor."
    },
    'peg_ratio': {
        analogy: "A stock with a P/E of 30 might seem expensive, but if it is growing at 30% per year (PEG = 1), it is a better deal than a stagnant utility stock with a P/E of 15 and 5% growth (PEG = 3).",
        takeaway: "PEG balances valuation against growth rates; a PEG ratio below 1.0 indicates undervalued growth."
    },
    'ev_equity': {
        analogy: "If you buy a house for ₹1 Crore (Equity Value) but it comes with a ₹50 Lakh home loan and ₹10 Lakh cash in the safe, the true cost to buy the house is ₹1.4 Crores. That total cost is Enterprise Value (EV).",
        takeaway: "Use EV instead of market cap when comparing highly leveraged companies to see the true cost of acquisition."
    },

    // ── BOND MARKET MATH ──
    'bond_basics': {
        analogy: "Think of a bond like a standardized IOU. You lend ₹1,000 to the government (Face Value). They promise to pay you ₹80 every year (Coupon) and return your ₹1,000 at the end of 10 years.",
        takeaway: "Bonds are debt contracts. Their market prices fluctuate inversely to changes in market interest rates."
    },
    'ytm': {
        analogy: "If you buy a second-hand car for less than its original value and drive it until it breaks down, your total return is the annual gas savings plus the bargain difference. YTM is that total annualized return.",
        takeaway: "YTM is the absolute true interest rate you earn if you buy a bond today and hold it until it matures."
    },
    'yield_curve': {
        analogy: "Lending money to a friend for 10 years is riskier than lending it for 10 days, so you demand a higher interest rate for the longer loan. That upward slope is a normal yield curve.",
        takeaway: "An inverted yield curve (short-term rates higher than long-term rates) is a classic warning sign of an impending economic recession."
    },
    'bond_duration': {
        analogy: "Think of a see-saw. If you sit close to the pivot (short duration/short maturity), interest rate shifts don't move you much. If you sit at the very end of a long plank (long duration), a small shift swings you wildly.",
        takeaway: "Duration measures how sensitive a bond's price is to interest rate changes. Long-term bonds have high duration risk."
    },
    'bond_convexity': {
        analogy: "Think of a bow string. The more you pull it back (curved relationship), the more power it has. Convexity is the curved buffer that helps a bond lose less value when rates rise, and gain more when rates drop.",
        takeaway: "High convexity is a protective buffer that improves a bond's price stability during major interest rate shocks."
    },
    'credit_spreads': {
        analogy: "Lending money to a stable government is safe, so you accept a low return. Lending to a struggling startup is risky, so you demand a high premium. That extra interest premium is the credit spread.",
        takeaway: "Widening credit spreads signal that the market sees rising economic risks and default threats."
    },
    'tips_real_yields': {
        analogy: "If your bank pays you 6% interest but inflation is 5%, your money only grew by 1% in real purchasing power. Inflation-indexed bonds adjust your principal so you always make a guaranteed return above inflation.",
        takeaway: "Real yields strip out inflation. Buy inflation-protected securities when you expect inflation to rise faster than the market expects."
    },
    'central_bank': {
        analogy: "Think of the Reserve Bank of India (RBI) as the tap on a water tank. Opening the tap (lowering rates) floods the economy with cheap cash. Closing the tap (raising rates) cools down high inflation by making loans expensive.",
        takeaway: "Central bank rates dictate the baseline cost of money across the entire financial system."
    },
    'pv_bond_math': {
        analogy: "If you want to receive ₹100 every year for 5 years plus ₹1,000 at the end, how much cash would you pay today? You calculate the present value of each of those future payments and sum them up.",
        takeaway: "The fair market price of any bond is simply the sum of all its future cash flows discounted back to today's values."
    }
};