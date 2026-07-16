import {
  formatCurrency,
  formatDate,
  formatHmrcDeadline,
  type QuarterVat,
} from "@/lib/finance";

interface VatIndicatorProps {
  current: QuarterVat;
  closed: QuarterVat;
  currentSeries?: number[];
  closedSeries?: number[];
}

export function VatIndicator({
  current,
  closed,
  currentSeries,
  closedSeries,
}: VatIndicatorProps) {
  return (
    <section className="mb-10">
      <p className="text-[9px] uppercase tracking-[0.28em] text-foreground/40 mb-4">
        VAT indicator · cash basis · Stagger 1
      </p>
      <div className="grid grid-cols-2 gap-6">
        <QuarterCard
          title={`Current · ${current.quarter.label}`}
          stateLabel="Estimate · in progress"
          vat={current}
          series={currentSeries}
          deadlineLabel={`Filing window opens ${formatHmrcDeadline(current.quarter)}`}
        />
        <QuarterCard
          title={`Just closed · ${closed.quarter.label}`}
          stateLabel="Estimate · final — file via Xero"
          vat={closed}
          series={closedSeries}
          deadlineLabel={`Next HMRC deadline: ${formatHmrcDeadline(closed.quarter)}`}
          deadlineAccent
        />
      </div>
    </section>
  );
}

// Sparkline — pure SVG. Uses text-gold + currentColor so it reads the
// design token; no hex. Sharp corners on stroke. Height fixed, width fluid.
function Sparkline({ series }: { series: number[] }) {
  if (!series || series.length < 2) return null;
  const width = 200;
  const height = 32;
  const min = Math.min(...series, 0);
  const max = Math.max(...series, 0);
  const range = max - min || 1;
  const points = series
    .map((v, i) => {
      const x = (i / (series.length - 1)) * width;
      const y = height - ((v - min) / range) * (height - 2) - 1;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  return (
    <svg
      className="w-full text-gold/70"
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{ height }}
      aria-hidden
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function QuarterCard({
  title,
  stateLabel,
  vat,
  series,
  deadlineLabel,
  deadlineAccent,
}: {
  title: string;
  stateLabel: string;
  vat: QuarterVat;
  series?: number[];
  deadlineLabel: string;
  deadlineAccent?: boolean;
}) {
  return (
    <div className="border border-divider rounded-sm p-6">
      <p className="text-[9px] uppercase tracking-[0.28em] text-foreground/40">{title}</p>
      <p className="mt-1 text-[10px] uppercase tracking-[0.24em] text-gold-muted">{stateLabel}</p>

      {series && series.length >= 2 && (
        <div className="mt-4">
          <Sparkline series={series} />
        </div>
      )}

      <div className="mt-5 grid grid-cols-3 gap-4 border-t border-divider pt-5">
        <Metric label="Output VAT" value={formatCurrency(vat.outputVat)} />
        <Metric label="Input VAT" value={formatCurrency(vat.inputVat)} />
        <Metric label="Net VAT" value={formatCurrency(vat.netVat)} accent />
      </div>

      <p
        className={
          "mt-5 text-xs " + (deadlineAccent ? "text-gold" : "text-recessive")
        }
      >
        {deadlineLabel}
      </p>

      <div className="mt-5 border-t border-divider pt-4">
        <div className="flex items-baseline justify-between mb-2">
          <p className="text-[9px] uppercase tracking-[0.28em] text-foreground/40">
            Reverse charge · self-accounted
          </p>
          <span className="font-serif text-sm text-strong tabular-nums">
            {formatCurrency(vat.reverseChargeTotal)}
          </span>
        </div>
        {vat.reverseChargeItems.length === 0 ? (
          <p className="text-xs text-recessive">No reverse-charge items paid in this quarter.</p>
        ) : (
          <ul className="space-y-1.5">
            {vat.reverseChargeItems.map((it) => (
              <li key={it.id} className="flex items-baseline justify-between gap-3 text-xs">
                <span className="text-standard truncate">
                  {it.supplier_name}
                  <span className="text-recessive"> · {formatDate(it.payment_date)}</span>
                </span>
                <span className="font-serif text-strong tabular-nums shrink-0">
                  {formatCurrency(it.reverse_charge_vat)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-[10px] uppercase tracking-[0.24em] text-gold-muted">
          Excluded from input VAT
        </p>
      </div>
    </div>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <p className="text-[9px] uppercase tracking-[0.28em] text-foreground/40">{label}</p>
      <p
        className={
          "mt-1 font-serif tabular-nums " +
          (accent ? "text-xl text-gold" : "text-xl text-strong")
        }
      >
        {value}
      </p>
    </div>
  );
}
