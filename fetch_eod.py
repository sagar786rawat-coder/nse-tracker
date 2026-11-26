import json
import os
import urllib.request
from datetime import datetime
from zoneinfo import ZoneInfo

import pandas as pd
import yfinance as yf

TICKERS = {
    # Benchmarks & Volatility
    "^NSEI": "NIFTY 50",
    "^CRSLDX": "NIFTY 500",
    "^INDIAVIX": "INDIA VIX",

    # Market-Cap Tiers
    "^CNX100": "NIFTY 100",
    "JUNIORBEES.NS": "NIFTY NEXT 50",
    "MID150BEES.NS": "NIFTY MIDCAP 150",
    "HDFCSML250.NS": "NIFTY SMALLCAP 250",

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

    # Risk-Off ETFs
    "GOLDBEES.NS": "GOLD ETF",
    "SILVERBEES.NS": "SILVER ETF",
}

FALLBACK_TICKERS = {
    "NIFTY 500": "MONIFTY500.NS",
    "NIFTY 100": "NIF100BEES.NS",
    "NIFTY PHARMA": "PHARMABEES.NS",
    "NIFTY METAL": "METALIETF.NS",
    "NIFTY IT": "ITBEES.NS",
    "NIFTY AUTO": "AUTOBEES.NS",
}

def send_telegram_summary(closes, meta):
    token = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
    chat_id = os.environ.get("TELEGRAM_CHAT_ID", "").strip()
    if not token or not chat_id:
        return
    try:
        latest = closes.iloc[-1]
        prev = closes.iloc[-2] if len(closes) > 1 else latest
        ema10 = closes.ewm(span=10, adjust=False).mean().iloc[-1]
        mcap_cols = [c for c in ["NIFTY 50", "NIFTY 100", "NIFTY NEXT 50", "NIFTY MIDCAP 150", "NIFTY SMALLCAP 250"] if c in closes.columns]
        above_mcap = sum(1 for c in mcap_cols if pd.notna(latest[c]) and latest[c] > ema10[c])
        vix_val = latest.get("INDIA VIX", float("nan"))
        vix_str = f"{vix_val:.2f}" if pd.notna(vix_val) else "N/A"
        ret20 = ((closes.iloc[-1] / closes.iloc[-21]) - 1) * 100 if len(closes) > 21 else pd.Series(dtype=float)
        top_mcap = max(mcap_cols, key=lambda c: float(ret20[c]) if c in ret20 and pd.notna(ret20[c]) else -999.0) if mcap_cols else "N/A"
        top_mcap_ret = float(ret20[top_mcap]) if top_mcap in ret20 and pd.notna(ret20[top_mcap]) else 0.0
        skip_cols = set(mcap_cols + ["NIFTY 500", "INDIA VIX", "GOLD ETF", "SILVER ETF"])
        sec_cols = [c for c in closes.columns if c not in skip_cols and c in ret20 and pd.notna(ret20[c])]
        top_secs = sorted(sec_cols, key=lambda c: float(ret20[c]), reverse=True)[:3]
        top_sec_str = ", ".join(f"{c.replace('NIFTY ', '')} ({ret20[c]:+.1f}%)" for c in top_secs) if top_secs else "N/A"
        regime = "GREEN (TRADE)" if above_mcap >= 4 and (pd.isna(vix_val) or vix_val < 20) else ("RED (NO-TRADE)" if above_mcap <= 1 or (pd.notna(vix_val) and vix_val >= 22) else "YELLOW (SELECTIVE)")
        n50_chg = ((latest["NIFTY 50"] / prev["NIFTY 50"]) - 1) * 100 if prev["NIFTY 50"] else 0.0
        msg = (
            f"NSE Rotation ({meta['status']}) - {meta['updated_ist']}\n"
            f"Regime: {regime} | Cap >10EMA: {above_mcap}/{len(mcap_cols)}\n"
            f"NIFTY 50: {latest['NIFTY 50']:.2f} ({n50_chg:+.2f}%) | India VIX: {vix_str}\n"
            f"#1 Cap (1M): {top_mcap} ({top_mcap_ret:+.2f}%)\n"
            f"Top Sectors (1M): {top_sec_str}"
        )
        url = f"https://api.telegram.org/bot{token}/sendMessage"
        payload = json.dumps({"chat_id": chat_id, "text": msg}).encode("utf-8")
        req = urllib.request.Request(url, data=payload, headers={"Content-Type": "application/json"})
        urllib.request.urlopen(req, timeout=10)
        print("Telegram alert sent.")
    except Exception as exc:
        print(f"Telegram alert skipped: {exc}")

def main():
    now_ist = datetime.now(ZoneInfo("Asia/Kolkata"))
    today_str = now_ist.strftime("%Y-%m-%d")
    in_session = (
        now_ist.weekday() < 5
        and ((now_ist.hour == 9 and now_ist.minute >= 15) or (10 <= now_ist.hour <= 14) or (now_ist.hour == 15 and now_ist.minute <= 35))
    )

    raw = yf.download(list(TICKERS.keys()), period="2y", interval="1d", auto_adjust=True, progress=False)
    closes = raw["Close"].rename(columns=TICKERS)
    closes.index = pd.to_datetime(closes.index).strftime("%Y-%m-%d")
    closes.index.name = "Date"
    closes = closes[~closes.index.duplicated(keep="last")].sort_index()

    active_ticker_map = {t: name for t, name in TICKERS.items() if name in closes.columns and closes[name].dropna().shape[0] >= 20}

    for col_name, fb_ticker in FALLBACK_TICKERS.items():
        if col_name not in closes.columns or closes[col_name].dropna().shape[0] < 20:
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

    intra = yf.download(list(active_ticker_map.keys()), period="1d", interval="5m", auto_adjust=True, progress=False)
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

    closes = closes[valid_cols].ffill().dropna(subset=["NIFTY 50"]).round(2)
    closes.to_csv("eod_data.csv")

    meta = {
        "updated_ist": now_ist.strftime("%Y-%m-%d %H:%M IST"),
        "latest_trading_date": closes.index[-1],
        "status": "PRE_CLOSE_LIVE" if in_session else "EOD_FINAL",
        "columns": len(valid_cols),
    }
    with open("last_updated.json", "w", encoding="utf-8") as f:
        json.dump(meta, f, indent=2)

    send_telegram_summary(closes, meta)
    print(f"Saved {len(closes)} trading days x {len(valid_cols)} columns through {closes.index[-1]} ({meta['status']})")

if __name__ == "__main__":
    main()
