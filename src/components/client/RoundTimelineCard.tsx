import { useState, useEffect } from "react";
import type { CSSProperties } from "react";

// ── Design tokens (boarding-pass timeline card) ──────────────────────────────
// All values supplied by the design spec; matches the page's dark/gold theme.
const GOLD = "#b8986a";
const PRIMARY = "#ece7df";
const MUTED = "#8a857d";
const FAINT = "#7c776d";
const TRACK = "rgba(184,152,106,0.20)";
const PAGE_BG = "#16130f";
const BORDER = "rgba(184,152,106,0.22)";
const HEADER_DIVIDER = "rgba(184,152,106,0.12)";
const HALO = "rgba(184,152,106,0.12)";

// Fallback timestamps — used only when no real round data is supplied.
const FALLBACK_REQUESTED = "2026-06-21T20:42:00";
const FALLBACK_DELIVERY = "2026-06-26T11:00:00";

function toValidDate(v: string | Date | null | undefined, fallbackIso: string): Date {
  if (v) {
    const d = v instanceof Date ? v : new Date(v);
    if (!isNaN(d.getTime())) return d;
  }
  return new Date(fallbackIso);
}

function fmtHeroDate(d: Date): string {
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
function fmtSubLine(d: Date): string {
  const weekday = d.toLocaleDateString("en-GB", { weekday: "short" }).toUpperCase();
  const time = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${weekday} · ${time}`;
}
/** Whole days + remaining whole hours from a millisecond span. */
function diffDH(ms: number): { d: number; h: number } {
  const totalH = Math.floor(Math.max(0, ms) / 3_600_000);
  return { d: Math.floor(totalH / 24), h: totalH % 24 };
}

/**
 * Boarding-pass style timeline: Requested (departure) on the left, Delivery
 * (arrival) on the right, with a live progress bar between them showing how
 * much of the requested→delivery window has elapsed. Recomputes every 30s.
 * Fonts reuse the page's loaded faces via `font-serif` / `font-sans`.
 */
export function RoundTimelineCard({
  requestedAt,
  deliveryAt,
}: {
  requestedAt?: string | Date | null;
  deliveryAt?: string | Date | null;
}) {
  const requested = toValidDate(requestedAt, FALLBACK_REQUESTED);
  const delivery = toValidDate(deliveryAt, FALLBACK_DELIVERY);

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const span = delivery.getTime() - requested.getTime();
  const elapsedFraction =
    span > 0 ? Math.min(1, Math.max(0, (now.getTime() - requested.getTime()) / span)) : 0;
  const pct = Math.round(elapsedFraction * 100);

  const total = diffDH(span);
  const totalLabel = `${total.d}D ${total.h}H TOTAL`;

  const rem = diffDH(delivery.getTime() - now.getTime());
  const remainingLabel = pct >= 100 ? "ARRIVED" : `${rem.d}D ${rem.h}H LEFT`;

  // Shared inline styles (token-driven).
  const labelGold: CSSProperties = { color: GOLD, fontSize: 11, letterSpacing: "0.38em", textTransform: "uppercase" };
  const faintMeta: CSSProperties = { color: FAINT, fontSize: 11, letterSpacing: "0.34em", textTransform: "uppercase" };
  // Deliberately smaller than the page's "Round NN" title (48px) so the dates
  // read as a discreet sub-element rather than competing heroes.
  const heroDate: CSSProperties = { color: PRIMARY, fontSize: 30, fontWeight: 500, lineHeight: 1.1, whiteSpace: "nowrap", marginTop: 12 };
  const subLine: CSSProperties = { color: MUTED, fontSize: 13, letterSpacing: "0.28em", marginTop: 12 };

  return (
    <div
      style={{
        position: "relative",
        background: "linear-gradient(180deg, #1d1813, #191510)",
        border: `1px solid ${BORDER}`,
        borderRadius: 3,
        padding: "30px 56px 38px",
      }}
    >
      {/* Ticket-notch circles on the left/right edges */}
      {(["left", "right"] as const).map((side) => (
        <span
          key={side}
          aria-hidden
          style={{
            position: "absolute",
            [side]: -9,
            top: "50%",
            transform: "translateY(-50%)",
            width: 18,
            height: 18,
            borderRadius: "50%",
            background: PAGE_BG,
            border: `1px solid ${BORDER}`,
          }}
        />
      ))}

      {/* Header */}
      <p className="font-sans" style={{ color: GOLD, fontSize: 11, letterSpacing: "0.4em", textTransform: "uppercase" }}>
        Timeline
      </p>
      <div style={{ height: 1, background: HEADER_DIVIDER, marginTop: 14 }} />

      {/* Dates row — Requested (departure, left) · Delivery (arrival, right) */}
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: 24, marginTop: 26 }}>
        {/* Left — REQUESTED */}
        <div style={{ minWidth: 210 }}>
          <p className="font-sans" style={labelGold}>Requested</p>
          <p className="font-serif" style={heroDate}>{fmtHeroDate(requested)}</p>
          <p className="font-sans" style={subLine}>{fmtSubLine(requested)}</p>
        </div>

        {/* Right — DELIVERY */}
        <div style={{ minWidth: 210, textAlign: "right" }}>
          <p className="font-sans" style={labelGold}>Delivery</p>
          <p className="font-serif" style={heroDate}>{fmtHeroDate(delivery)}</p>
          <p className="font-sans" style={subLine}>{fmtSubLine(delivery)}</p>
        </div>
      </div>

      {/* Progress — full width, below the dates */}
      <div style={{ marginTop: 34 }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
          <span className="font-sans" style={faintMeta}>{pct}% Elapsed</span>
          <span className="font-sans" style={faintMeta}>{remainingLabel}</span>
        </div>
        <div style={{ position: "relative", height: 1, background: TRACK, marginTop: 16 }}>
          <div style={{ position: "absolute", left: 0, top: 0, height: 1, width: `${pct}%`, background: GOLD }} />
          <span
            style={{
              position: "absolute",
              left: `${elapsedFraction * 100}%`,
              top: "50%",
              transform: "translate(-50%, -50%)",
              width: 6,
              height: 6,
              borderRadius: "50%",
              background: GOLD,
              boxShadow: `0 0 0 4px ${HALO}`,
            }}
          />
        </div>
        <p className="font-sans" style={{ ...faintMeta, textAlign: "center", marginTop: 16 }}>{totalLabel}</p>
      </div>
    </div>
  );
}
