import yfinance as yf

for ticker in ["NIFTYMIDCAP150.NS", "MOSMALL250.NS", "^CNX100"]:
    try:
        df = yf.download(ticker, period="1y", progress=False)
        print(f"Ticker: {ticker:20} -> Rows: {len(df)}")
        if len(df) > 0:
            print(f"  Date range: {df.index[0].date()} to {df.index[-1].date()}")
    except Exception as e:
        print(f"Ticker: {ticker:20} -> Error: {e}")
