import json
from datetime import datetime
from zoneinfo import ZoneInfo

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

# Automatic liquid ETF fallbacks if Yahoo skips a raw index ticker
FALLBACK_TICKERS = {
    "NIFTY 500": "MONIFTY500.NS",
    "NIFTY PHARMA": "PHARMABEES.NS",
    "NIFTY METAL": "METALIETF.NS",
    "NIFTY IT": "ITBEES.NS",
    "NIFTY AUTO": "AUTOBEES.NS",
}

def main():
    now_ist = datetime.now(ZoneInfo("Asia/Kolkata"))
    today_str = now_ist.strftime("%Y-%m-%d")
    in_session = (
        now_ist.weekday() < 5
        and (
            (now_ist.hour == 9 and now_ist.minute >= 15)
            or (10 <= now_ist.hour <= 14)
            or (now_ist.hour == 15 and now_ist.minute <= 35)
        )
    )

    # 1. Pull 2-year daily history
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
    closes = closes[~closes.index.duplicated(keep="last")].sort_index()

    active_ticker_map = {
        t: name for t, name in TICKERS.items()
        if name in closes.columns and closes[name].notna().any()
    }

    # 2. Fill any skipped index using its ETF fallback
    for col_name, fb_ticker in FALLBACK_TICKERS.items():
        if col_name not in closes.columns or closes[col_name].isna().all():
            fb = yf.download(fb_ticker, period="2y", interval="1d", auto_adjust=True, progress=False)
            if not fb.empty and "Close" in fb:
                series = fb["Close"]
                if isinstance(series, pd.DataFrame):
                    series = series.iloc[:, 0]
                series.index = pd.to_datetime(series.index).strftime("%Y-%m-%d")
                series = series[~series.index.duplicated(keep="last")]
                closes[col_name] = series
                active_ticker_map[fb_ticker] = col_name
                print(f"Used fallback {fb_ticker} for {col_name}")

    valid_cols = [c for c in TICKERS.values() if c in closes.columns and closes[c].notna().any()]
    dropped = [c for c in TICKERS.values() if c not in valid_cols]
    if dropped:
        print(f"Warning: skipped tickers with no data: {dropped}")

    # 3. Merge live 5m prices only during market hours (or if 4:15 PM daily bar hasn't posted yet)
    intra = yf.download(
        list(active_ticker_map.keys()),
        period="1d",
        interval="5m",
        auto_adjust=True,
        progress=False,
    )
    if not intra.empty and "Close" in intra:
        intra_close = intra["Close"]
        if isinstance(intra_close, pd.Series):
            intra_close = intra_close.to_frame(name=list(active_ticker_map.keys())[0])
        intra_close = intra_close.rename(columns=active_ticker_map)

        idx = pd.to_datetime(intra_close.index)
        if idx.tz is None:
            idx = idx.tz_localize("UTC")
        intra_close.index = idx.tz_convert("Asia/Kolkata")

        live_date = intra_close.index[-1].strftime("%Y-%m-%d")
        latest_row = intra_close.ffill().iloc[-1]

        if ((in_session and live_date == today_str) or (live_date > closes.index[-1])) and pd.notna(latest_row.get("NIFTY 50")):
            for col in valid_cols:
                val = latest_row.get(col)
                if pd.notna(val):
                    closes.loc[live_date, col] = float(val)
            closes = closes.sort_index()
            print(f"Merged 5m snapshot for {live_date} at {now_ist.strftime('%H:%M IST')}")

    # 4. Forward-fill only (keeps blank leading dates for newer ETFs)
    closes = closes[valid_cols].ffill().dropna(subset=["NIFTY 50"]).round(2)
    closes.to_csv("eod_data.csv")

    # 5. Save sync metadata
    meta = {
        "updated_ist": now_ist.strftime("%Y-%m-%d %H:%M IST"),
        "latest_trading_date": closes.index[-1],
        "status": "PRE_CLOSE_LIVE" if in_session else "EOD_FINAL",
        "columns": len(valid_cols),
    }
    with open("last_updated.json", "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)

    print(f"Saved {len(closes)} trading days x {len(valid_cols)} columns through {closes.index[-1]} ({meta['status']})")

if __name__ == "__main__":
    main()
