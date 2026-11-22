import pandas as pd
import yfinance as yf

TICKERS = {
    # Benchmarks
    "^NSEI": "NIFTY 50",
    "^CRSLDX": "NIFTY 500",

    # 12 Core NSE Sectors
    "^NSEBANK": "NIFTY BANK",
    "^CNXIT": "NIFTY IT",
    "^CNXPHARMA": "NIFTY PHARMA",
    "^CNXAUTO": "NIFTY AUTO",
    "^CNXFMCG": "NIFTY FMCG",
    "^CNXMETAL": "NIFTY METAL",
    "^CNXENERGY": "NIFTY ENERGY",
    "^CNXREALTY": "NIFTY REALTY",
    "^CNXPSUBANK": "NIFTY PSU BANK",
    "^CNXMEDIA": "NIFTY MEDIA",
    "^CNXINFRA": "NIFTY INFRA",
    "NIFTY_FIN_SERVICE.NS": "NIFTY FIN SERVICE",

    # 10 Thematic ETFs
    "MODEFENCE.NS": "NIFTY DEFENCE",
    "SELECTIPO.NS": "NIFTY IPO",
    "MOCAPITAL.NS": "NIFTY CAPITAL MKTS",
    "EVINDIA.NS": "NIFTY EV & AUTO",
    "CPSEETF.NS": "NIFTY CPSE",
    "GROWWRAIL.NS": "NIFTY RAILWAYS",
    "MAKEINDIA.NS": "NIFTY MANUFACTURING",
    "MOTOUR.NS": "NIFTY TOURISM",
    "CONSUMBEES.NS": "NIFTY CONSUMPTION",
    "TNIDETF.NS": "NIFTY DIGITAL",

    # 4 Broad Market & Risk-Off ETFs
    "MID150BEES.NS": "NIFTY MIDCAP 150",
    "HDFCSML250.NS": "NIFTY SMALLCAP 250",
    "GOLDBEES.NS": "GOLD ETF",
    "SILVERBEES.NS": "SILVER ETF",
}

def main():
    raw = yf.download(
        list(TICKERS.keys()),
        period="2y",
        interval="1d",
        auto_adjust=True,
        progress=False,
    )
    closes = raw["Close"].rename(columns=TICKERS)
    closes.index = pd.to_datetime(closes.index).strftime("%Y-%m-%d")
    closes.index.name = "Date"

    valid_cols = [c for c in TICKERS.values() if c in closes.columns and closes[c].notna().any()]
    dropped = [c for c in TICKERS.values() if c not in valid_cols]
    if dropped:
        print(f"Warning: skipped tickers with no data: {dropped}")

    # Forward-fill only (no bfill) so newer ETFs like SELECTIPO keep blank leading days
    closes = closes[valid_cols].ffill().dropna(subset=["NIFTY 50"]).round(2)
    closes.to_csv("eod_data.csv")
    print(f"Saved {len(closes)} trading days x {len(valid_cols)} columns through {closes.index[-1]}")

if __name__ == "__main__":
    main()
