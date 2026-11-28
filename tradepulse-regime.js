(function () {
  "use strict";

  const STORAGE_KEY = "tradepulse_regime_v1";

  const BENCHMARK_KEYS = [
    "NIFTY 50", "NIFTY 100", "NIFTY NEXT 50",
    "NIFTY MIDCAP 150", "NIFTY SMALLCAP 250", "NIFTY 500"
  ];

  const EXCLUDE_FROM_SECTORS = [
    "NIFTY 50", "NIFTY 100", "NIFTY NEXT 50",
    "NIFTY MIDCAP 150", "NIFTY SMALLCAP 250", "NIFTY 500",
    "INDIA VIX", "^INDIAVIX", "GOLD ETF", "SILVER ETF", "GOLD", "SILVER"
  ];

  const DEFENSIVE_TOKENS = ["FMCG", "PHARMA", "HEALTHCARE", "CONSUMPTION"];

  const TRADEPULSE_RULES = {
    GREEN: {
      badge: "GREEN · PRESS GAS",
      color: "#10b981",
      bg: "rgba(16, 185, 129, 0.12)",
      border: "rgba(16, 185, 129, 0.45)",
      slots: "5 – 6 stocks",
      capital: "70% – 85%",
      risk: "0.75% (₹2,250)",
      booking: "Book 1/3 at +2R, trail 2/3 on 10 EMA"
    },
    YELLOW: {
      badge: "YELLOW · SELECTIVE",
      color: "#f59e0b",
      bg: "rgba(245, 158, 11, 0.12)",
      border: "rgba(245, 158, 11, 0.45)",
      slots: "2 – 4 stocks (Top 2–3 sectors only)",
      capital: "40% – 60%",
      risk: "0.50% (₹1,500)",
      booking: "Book 50% at +2R, SL to BE, trail rest"
    },
    RED: {
      badge: "RED · BUY FREEZE",
      color: "#ef4444",
      bg: "rgba(239, 68, 68, 0.14)",
      border: "rgba(239, 68, 68, 0.50)",
      slots: "0 new buys",
      capital: "0% – 20% (Cash)",
      risk: "₹0 (Buy Freeze)",
      booking: "Tighten stops & protect equity"
    }
  };

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
      return {
        breadthScore: typeof saved.breadthScore === "number" ? saved.breadthScore : 1,
        distScore: typeof saved.distScore === "number" ? saved.distScore : 2,
        portfolioScore: typeof saved.portfolioScore === "number" ? saved.portfolioScore : 1,
        collapsed: Boolean(saved.collapsed)
      };
    } catch (_) {
      return { breadthScore: 1, distScore: 2, portfolioScore: 1, collapsed: false };
    }
  }

  function saveState(state) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (_) {}
  }

  function norm(name) {
    return String(name || "").replace(/^\uFEFF/, "").trim().toUpperCase();
  }

  function isDefensive(name) {
    const n = norm(name);
    return DEFENSIVE_TOKENS.some((tok) => n.includes(tok));
  }

  function parseCSV(text) {
    const lines = text.replace(/^\uFEFF/, "").trim().split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 30) return null;
    const headers = lines[0].split(",").map(norm);
    const dates = [];
    const series = {};
    headers.slice(1).forEach((h) => { series[h] = []; });

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",");
      if (!cols[0]) continue;
      dates.push(cols[0].trim());
      for (let c = 1; c < headers.length; c++) {
        const val = parseFloat(cols[c]);
        series[headers[c]].push(Number.isFinite(val) ? val : null);
      }
    }
    return { dates, headers: headers.slice(1), series };
  }

  function calcEMA(arr, period) {
    const out = new Array(arr.length).fill(null);
    const k = 2 / (period + 1);
    let ema = null;
    let seedSum = 0;
    let seedCount = 0;

    for (let i = 0; i < arr.length; i++) {
      const v = arr[i];
      if (v === null) {
        out[i] = ema;
        continue;
      }
      if (ema === null) {
        seedSum += v;
        seedCount++;
        if (seedCount === period) {
          ema = seedSum / period;
          out[i] = ema;
        }
      } else {
        ema = v * k + ema * (1 - k);
        out[i] = ema;
      }
    }
    return out;
  }

  function lastValidIdx(arr, beforeIdx) {
    const start = typeof beforeIdx === "number" ? Math.min(beforeIdx, arr.length - 1) : arr.length - 1;
    for (let i = start; i >= 0; i--) {
      if (arr[i] !== null && Number.isFinite(arr[i])) return i;
    }
    return -1;
  }

  function findSeries(series, candidates) {
    for (const c of candidates) {
      if (series[c]) return series[c];
    }
    const keys = Object.keys(series);
    for (const c of candidates) {
      const hit = keys.find((k) => k.includes(c));
      if (hit) return series[hit];
    }
    return null;
  }

  function evaluateIndexTrend(arr) {
    if (!arr) return { status: "NA", label: "Missing in CSV" };
    const i = lastValidIdx(arr);
    if (i < 55) return { status: "NA", label: "Need 55+ days" };

    const ema10 = calcEMA(arr, 10);
    const ema20 = calcEMA(arr, 20);
    const ema50 = calcEMA(arr, 50);

    const p = arr[i];
    const e10 = ema10[i], e20 = ema20[i], e50 = ema50[i];
    const e10Prev = ema10[i - 5], e20Prev = ema20[i - 5];

    if ([e10, e20, e50, e10Prev, e20Prev].some((x) => x === null)) {
      return { status: "NA", label: "Insufficient EMA" };
    }

    const rising10 = e10 > e10Prev;
    const rising20 = e20 > e20Prev;
    const falling20 = e20 < e20Prev;

    if (p > e10 && e10 > e20 && rising10 && rising20 && p > e50) {
      return { status: "GREEN", label: "P > 10E > 20E > 50E (Rising)", above20: true };
    }
    if (p < e20 && falling20 && p < e50) {
      return { status: "RED", label: "Below Falling 20E & 50E", above20: false };
    }
    return {
      status: "YELLOW",
      label: p < e20 ? "Below 20E / Mixed" : "Between EMAs / Flat",
      above20: p > e20
    };
  }

  function computeAutoChecks(data) {
    const { dates, headers, series } = data;
    const sectorKeys = headers.filter((h) => !EXCLUDE_FROM_SECTORS.includes(h));

    // --- CHECK 1: Sector Rotation Tracker ---
    let strongCount = 0;
    let validSectors = 0;
    let strongOffensive = 0;
    let strongDefensive = 0;
    const rankedNow = [];
    const ranked10dAgo = [];

    sectorKeys.forEach((key) => {
      const arr = series[key];
      const i = lastValidIdx(arr);
      if (i < 25) return;

      const e10 = calcEMA(arr, 10);
      const e20 = calcEMA(arr, 20);
      if (e10[i] === null || e20[i] === null) return;

      validSectors++;
      const strong = arr[i] > e20[i] && e10[i] > e20[i];
      if (strong) {
        strongCount++;
        if (isDefensive(key)) strongDefensive++;
        else strongOffensive++;
      }

      const ret20Now = arr[i - 20] ? ((arr[i] / arr[i - 20]) - 1) * 100 : 0;
      rankedNow.push({ key, ret20: ret20Now, strong, defensive: isDefensive(key) });

      if (i >= 30 && arr[i - 10] && arr[i - 30]) {
        const ret20Prev = ((arr[i - 10] / arr[i - 30]) - 1) * 100;
        ranked10dAgo.push({ key, ret20: ret20Prev });
      }
    });

    rankedNow.sort((a, b) => b.ret20 - a.ret20);
    ranked10dAgo.sort((a, b) => b.ret20 - a.ret20);

    const breadthPct = validSectors ? Math.round((strongCount / validSectors) * 100) : 0;
    const top3 = rankedNow.slice(0, 3);
    const top4Now = rankedNow.slice(0, 4).map((x) => x.key);
    const top5Prev = ranked10dAgo.slice(0, 5).map((x) => x.key);
    const defInTop3 = top3.filter((x) => x.defensive).length;
    const stabilityOverlap = top4Now.filter((k) => top5Prev.includes(k)).length;
    const onlyDefensives = strongCount > 0 && strongOffensive === 0 && strongDefensive > 0;

    let check1Score = 1;
    let check1Reason = "";
    if (breadthPct < 30 || onlyDefensives) {
      check1Score = 0;
      check1Reason = onlyDefensives ? "Only Defensives strong" : "Sector breadth < 30%";
    } else if (breadthPct >= 60 && defInTop3 === 0 && stabilityOverlap >= 2) {
      check1Score = 2;
      check1Reason = "Broad + Offensive + Stable";
    } else {
      check1Score = 1;
      const flags = [];
      if (breadthPct < 60) flags.push("Selective breadth");
      if (defInTop3 > 0) flags.push("Defensive in Top 3");
      if (stabilityOverlap < 2) flags.push("Choppy rotation");
      check1Reason = flags.join(" · ") || "Mixed leadership";
    }

    // --- CHECK 2: Midcap 150 & Smallcap 250 ---
    const mid150 = evaluateIndexTrend(findSeries(series, ["NIFTY MIDCAP 150", "MIDCAP 150"]));
    const sml250 = evaluateIndexTrend(findSeries(series, ["NIFTY SMALLCAP 250", "SMALLCAP 250"]));
    const nifty50 = evaluateIndexTrend(findSeries(series, ["NIFTY 50"]));

    let check2Score = 1;
    let check2Reason = "";
    if (mid150.status === "GREEN" && sml250.status === "GREEN") {
      check2Score = 2;
      check2Reason = "Both above rising 10/20/50 EMA";
    } else if (mid150.status === "RED" && sml250.status === "RED") {
      check2Score = 0;
      check2Reason = "Both below falling 20 & 50 EMA";
    } else if ((mid150.status === "RED" && sml250.status !== "GREEN") || (sml250.status === "RED" && mid150.status !== "GREEN")) {
      check2Score = 0;
      check2Reason = "Broad mid/smallcap breakdown";
    } else {
      check2Score = 1;
      check2Reason = (nifty50.status === "GREEN" && (!mid150.above20 || !sml250.above20))
        ? "Nifty 50 green, Mid/Small diverging"
        : `Mid150: ${mid150.status} · Sml250: ${sml250.status}`;
    }

    // --- CHECK 4: India VIX ---
    const vixArr = findSeries(series, ["INDIA VIX", "^INDIAVIX", "VIX"]);
    let vixVal = null, vix1d = null, vixScore = 1, vixLabel = "VIX missing in CSV";
    if (vixArr) {
      const vi = lastValidIdx(vixArr);
      const vp = lastValidIdx(vixArr, vi - 1);
      if (vi >= 0) {
        vixVal = vixArr[vi];
        vix1d = (vp >= 0 && vixArr[vp]) ? ((vixVal / vixArr[vp]) - 1) * 100 : 0;
        if (vixVal > 20) {
          vixScore = 0;
          vixLabel = `VIX ${vixVal.toFixed(2)} (${vix1d >= 0 ? "+" : ""}${vix1d.toFixed(1)}%) · High fear`;
        } else if (vixVal >= 15 || vix1d >= 10) {
          vixScore = 1;
          vixLabel = `VIX ${vixVal.toFixed(2)} (${vix1d >= 0 ? "+" : ""}${vix1d.toFixed(1)}%) · Elevated/Jumpy`;
        } else {
          vixScore = 2;
          vixLabel = `VIX ${vixVal.toFixed(2)} (${vix1d >= 0 ? "+" : ""}${vix1d.toFixed(1)}%) · Calm`;
        }
      }
    }

    return {
      asOf: dates[dates.length - 1] || "",
      check1: {
        score: check1Score,
        breadthPct,
        strongCount,
        validSectors,
        top3Names: top3.map((x) => x.key.replace(/^NIFTY\s+/, "")),
        stabilityOverlap,
        reason: check1Reason
      },
      check2: { score: check2Score, mid150, sml250, reason: check2Reason },
      check4: { vixScore, vixVal, vix1d, vixLabel }
    };
  }

  function injectStyles() {
    if (document.getElementById("tp-regime-styles")) return;
    const style = document.createElement("style");
    style.id = "tp-regime-styles";
    style.textContent = `
      #tp-regime-wrap {
        margin: 12px auto 14px auto;
        max-width: 1440px;
        padding: 0 14px;
        font-family: Inter, system-ui, -apple-system, sans-serif;
        color: #e2e8f0;
        box-sizing: border-box;
      }
      .tp-card {
        background: #0f172a;
        border: 1px solid #1e293b;
        border-radius: 12px;
        padding: 14px 16px;
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
      }
      .tp-top {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
      }
      .tp-left {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 10px;
      }
      .tp-badge {
        font-weight: 800;
        font-size: 13px;
        letter-spacing: 0.4px;
        padding: 6px 12px;
        border-radius: 999px;
        border: 1px solid transparent;
      }
      .tp-score-pill {
        font-weight: 700;
        font-size: 13px;
        padding: 5px 10px;
        border-radius: 8px;
        background: #1e293b;
        color: #f8fafc;
      }
      .tp-actions-strip {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        font-size: 12px;
        color: #cbd5e1;
      }
      .tp-metric {
        background: #162033;
        border: 1px solid #263449;
        border-radius: 8px;
        padding: 5px 10px;
      }
      .tp-metric strong { color: #f8fafc; }
      .tp-controls {
        display: flex;
        gap: 8px;
        align-items: center;
      }
      .tp-btn {
        background: #1e293b;
        color: #cbd5e1;
        border: 1px solid #334155;
        border-radius: 7px;
        padding: 5px 10px;
        font-size: 12px;
        cursor: pointer;
      }
      .tp-btn:hover { background: #334155; color: #fff; }
      .tp-override-bar {
        margin-top: 10px;
        background: rgba(239, 68, 68, 0.16);
        border: 1px solid rgba(239, 68, 68, 0.5);
        color: #fecaca;
        border-radius: 8px;
        padding: 8px 12px;
        font-size: 12px;
        font-weight: 600;
      }
      .tp-grid {
        margin-top: 12px;
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
        gap: 10px;
      }
      .tp-check {
        background: #131d31;
        border: 1px solid #233148;
        border-radius: 10px;
        padding: 10px 12px;
        display: flex;
        flex-direction: column;
        gap: 6px;
      }
      .tp-check-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        font-size: 12px;
        font-weight: 700;
        color: #f1f5f9;
      }
      .tp-pts {
        font-size: 11px;
        padding: 2px 7px;
        border-radius: 999px;
        font-weight: 700;
      }
      .tp-sub { font-size: 11.5px; color: #94a3b8; line-height: 1.4; }
      .tp-pills { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 2px; }
      .tp-pill {
        flex: 1;
        min-width: 62px;
        background: #0f172a;
        color: #94a3b8;
        border: 1px solid #334155;
        border-radius: 6px;
        padding: 4px 6px;
        font-size: 11px;
        cursor: pointer;
        text-align: center;
      }
      .tp-pill.active-2 { background: rgba(16, 185, 129, 0.2); border-color: #10b981; color: #6ee7b7; font-weight: 700; }
      .tp-pill.active-1 { background: rgba(245, 158, 11, 0.2); border-color: #f59e0b; color: #fcd34d; font-weight: 700; }
      .tp-pill.active-0 { background: rgba(239, 68, 68, 0.22); border-color: #ef4444; color: #fca5a5; font-weight: 700; }
    `;
    document.head.appendChild(style);
  }

  function ptsBadgeStyle(pts) {
    if (pts === 2) return "background:rgba(16,185,129,0.2);color:#6ee7b7;";
    if (pts === 1) return "background:rgba(245,158,11,0.2);color:#fcd34d;";
    return "background:rgba(239,68,68,0.22);color:#fca5a5;";
  }

  function mountAndRender(auto) {
    injectStyles();
    let wrap = document.getElementById("tp-regime-wrap");
    if (!wrap) {
      wrap = document.createElement("section");
      wrap.id = "tp-regime-wrap";
      const header = document.querySelector("header");
      if (header && header.parentNode) {
        header.parentNode.insertBefore(wrap, header.nextSibling);
      } else {
        document.body.insertBefore(wrap, document.body.firstChild);
      }
    }

    const state = loadState();
    const c1 = auto.check1.score;
    const c2 = auto.check2.score;
    const c3 = state.breadthScore;
    const c4 = Math.min(auto.check4.vixScore, state.distScore);
    const c5 = state.portfolioScore;
    const total = c1 + c2 + c3 + c4 + c5;

    let regimeKey = total >= 8 ? "GREEN" : total >= 4 ? "YELLOW" : "RED";
    const personalOverride = c5 === 0 && regimeKey !== "RED";
    if (personalOverride) regimeKey = "RED";

    const rule = TRADEPULSE_RULES[regimeKey];
    const top3Text = auto.check1.top3Names.join(", ") || "N/A";

    wrap.innerHTML = `
      <div class="tp-card" style="border-color:${rule.border};">
        <div class="tp-top">
          <div class="tp-left">
            <span class="tp-badge" style="color:${rule.color};background:${rule.bg};border-color:${rule.border};">
              ${rule.badge}
            </span>
            <span class="tp-score-pill">TradePulse Score: ${total} / 10</span>
            <span class="tp-sub">CSV: ${auto.asOf || "Latest"} · Sector 20E Breadth: <strong style="color:#f8fafc;">${auto.check1.breadthPct}%</strong> (${auto.check1.strongCount}/${auto.check1.validSectors})</span>
          </div>
          <div class="tp-controls">
            <button class="tp-btn" id="tp-copy-btn">Copy for TradePulse</button>
            <button class="tp-btn" id="tp-toggle-btn">${state.collapsed ? "Show 5 Checks" : "Hide Checks"}</button>
          </div>
        </div>

        <div class="tp-actions-strip" style="margin-top:10px;">
          <div class="tp-metric">Slots: <strong>${rule.slots}</strong></div>
          <div class="tp-metric">Capital: <strong>${rule.capital}</strong></div>
          <div class="tp-metric">Risk/Trade: <strong>${rule.risk}</strong></div>
          <div class="tp-metric">+2R Rule: <strong>${rule.booking}</strong></div>
          <div class="tp-metric">Top 3 Sectors: <strong>${top3Text}</strong></div>
        </div>

        ${personalOverride ? `
          <div class="tp-override-bar">
            PORTFOLIO OVERRIDE ACTIVE: Market scored ${total}/10, but 3+ consecutive stop-losses downgraded your personal regime to RED (Buy Freeze) until existing trades prove follow-through.
          </div>
        ` : ""}

        ${state.collapsed ? "" : `
          <div class="tp-grid">
            <div class="tp-check">
              <div class="tp-check-head">
                <span>1. Sector Rotation (Auto)</span>
                <span class="tp-pts" style="${ptsBadgeStyle(c1)}">${c1} / 2</span>
              </div>
              <div class="tp-sub">
                Breadth (Close &gt; 20E &amp; 10E &gt; 20E): <strong>${auto.check1.breadthPct}%</strong><br>
                10d Top-4 Stability: <strong>${auto.check1.stabilityOverlap}/4</strong> · ${auto.check1.reason}
              </div>
            </div>

            <div class="tp-check">
              <div class="tp-check-head">
                <span>2. Midcap 150 &amp; Smallcap 250 (Auto)</span>
                <span class="tp-pts" style="${ptsBadgeStyle(c2)}">${c2} / 2</span>
              </div>
              <div class="tp-sub">
                Mid150: <strong>${auto.check2.mid150.label}</strong><br>
                Sml250: <strong>${auto.check2.sml250.label}</strong>
              </div>
            </div>

            <div class="tp-check">
              <div class="tp-check-head">
                <span>3. NSE 500 Breadth (&gt;50 EMA)</span>
                <span class="tp-pts" style="${ptsBadgeStyle(c3)}">${c3} / 2</span>
              </div>
              <div class="tp-sub">Set from Chartink / TradingView (saved locally):</div>
              <div class="tp-pills">
                <button class="tp-pill ${c3 === 2 ? "active-2" : ""}" data-k="breadthScore" data-v="2">&gt;60% (2)</button>
                <button class="tp-pill ${c3 === 1 ? "active-1" : ""}" data-k="breadthScore" data-v="1">35-60% (1)</button>
                <button class="tp-pill ${c3 === 0 ? "active-0" : ""}" data-k="breadthScore" data-v="0">&lt;35% (0)</button>
              </div>
            </div>

            <div class="tp-check">
              <div class="tp-check-head">
                <span>4. India VIX (Auto) + Dist. Days</span>
                <span class="tp-pts" style="${ptsBadgeStyle(c4)}">${c4} / 2</span>
              </div>
              <div class="tp-sub">${auto.check4.vixLabel}</div>
              <div class="tp-pills">
                <button class="tp-pill ${state.distScore === 2 ? "active-2" : ""}" data-k="distScore" data-v="2">0-2d (2)</button>
                <button class="tp-pill ${state.distScore === 1 ? "active-1" : ""}" data-k="distScore" data-v="1">3-4d (1)</button>
                <button class="tp-pill ${state.distScore === 0 ? "active-0" : ""}" data-k="distScore" data-v="0">5+d (0)</button>
              </div>
            </div>

            <div class="tp-check">
              <div class="tp-check-head">
                <span>5. Portfolio Feedback (Override)</span>
                <span class="tp-pts" style="${ptsBadgeStyle(c5)}">${c5} / 2</span>
              </div>
              <div class="tp-sub">3+ stops in a row triggers automatic Buy Freeze:</div>
              <div class="tp-pills">
                <button class="tp-pill ${c5 === 2 ? "active-2" : ""}" data-k="portfolioScore" data-v="2">+1.5R/+2R</button>
                <button class="tp-pill ${c5 === 1 ? "active-1" : ""}" data-k="portfolioScore" data-v="1">Mixed</button>
                <button class="tp-pill ${c5 === 0 ? "active-0" : ""}" data-k="portfolioScore" data-v="0">3+ Stops</button>
              </div>
            </div>
          </div>
        `}
      </div>
    `;

    wrap.querySelectorAll(".tp-pill").forEach((btn) => {
      btn.addEventListener("click", () => {
        const next = loadState();
        next[btn.dataset.k] = Number(btn.dataset.v);
        saveState(next);
        mountAndRender(auto);
      });
    });

    const toggleBtn = document.getElementById("tp-toggle-btn");
    if (toggleBtn) {
      toggleBtn.addEventListener("click", () => {
        const next = loadState();
        next.collapsed = !next.collapsed;
        saveState(next);
        mountAndRender(auto);
      });
    }

    const copyBtn = document.getElementById("tp-copy-btn");
    if (copyBtn) {
      copyBtn.addEventListener("click", () => {
        const summary = `${auto.asOf} | ${regimeKey}${personalOverride ? " (PORTFOLIO OVERRIDE)" : ""} (${total}/10) | Sector 20E: ${auto.check1.breadthPct}% | Top 3: ${top3Text} | ${auto.check4.vixLabel} | Slots: ${rule.slots} | Risk: ${rule.risk}`;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(summary).then(() => {
            copyBtn.textContent = "Copied!";
            setTimeout(() => { copyBtn.textContent = "Copy for TradePulse"; }, 1600);
          });
        }
      });
    }
  }

  async function init() {
    try {
      const res = await fetch(`./eod_data.csv?t=${Date.now()}`, { cache: "no-store" });
      if (!res.ok) return;
      const csv = parseCSV(await res.text());
      if (!csv) return;
      const auto = computeAutoChecks(csv);
      mountAndRender(auto);
    } catch (err) {
      console.warn("TradePulse Regime banner failed to load eod_data.csv:", err);
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
