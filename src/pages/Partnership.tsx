import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Check } from "lucide-react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import { Button } from "@/components/ui/button";

/**
 * Studio Partnership marketing page (Phase 1 of moving the app from
 * per-project to subscription mode). Pure presentational — no backend,
 * no billing wiring yet. Lane pricing comes from a single source of
 * truth (LANE_PRICES) so we can later reuse it server-side.
 */

const LANE_PRICES: number[] = [
  3950, 3800, 3700, 3600, 3500, 3350, 3250, 3200, 3100, 3000,
];

/** Estimated all-in monthly cost of a London-based mid-level visualiser. */
const IN_HOUSE_PER_ARTIST = 5800;

const cumulativeSubscription = (lanes: number) =>
  LANE_PRICES.slice(0, lanes).reduce((sum, p) => sum + p, 0);

const inHouseCost = (lanes: number) => lanes * IN_HOUSE_PER_ARTIST;

const formatGBP = (n: number) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    maximumFractionDigits: 0,
  }).format(n);

const SectionLabel = ({ children }: { children: React.ReactNode }) => (
  <p className="font-serif text-xs tracking-[0.3em] text-[hsl(var(--gold))]">
    {children}
  </p>
);

const SectionHeader = ({
  eyebrow,
  title,
  intro,
}: {
  eyebrow: string;
  title: React.ReactNode;
  intro?: React.ReactNode;
}) => (
  <div className="mx-auto max-w-3xl text-center">
    <SectionLabel>{eyebrow}</SectionLabel>
    <h2 className="mt-4 font-serif text-3xl md:text-4xl text-foreground">
      {title}
    </h2>
    {intro && (
      <p className="mt-4 text-muted-foreground leading-relaxed">{intro}</p>
    )}
  </div>
);

export default function Partnership() {
  const [hoverLanes, setHoverLanes] = useState<number | null>(null);
  const activeLanes = hoverLanes ?? 1;

  const chartData = useMemo(
    () =>
      Array.from({ length: 10 }, (_, i) => {
        const lanes = i + 1;
        return {
          lanes,
          inHouse: inHouseCost(lanes),
          subscription: cumulativeSubscription(lanes),
        };
      }),
    [],
  );

  const subTotal = cumulativeSubscription(activeLanes);
  const inHouseTotal = inHouseCost(activeLanes);
  const savingsPct = Math.round(
    ((inHouseTotal - subTotal) / inHouseTotal) * 100,
  );

  return (
    <div className="min-h-screen bg-background text-foreground font-sans">
      {/* Top bar */}
      <header className="border-b border-border/60">
        <div className="mx-auto max-w-7xl px-6 py-5 flex items-center justify-between">
          <Link
            to="/"
            className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            BACK
          </Link>
          <SectionLabel>STUDIO PARTNERSHIP</SectionLabel>
          <div className="w-16" />
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-5xl px-6 pt-20 pb-24 text-center">
        <h1 className="font-serif text-5xl md:text-6xl leading-tight">
          Your Entire
          <br />
          <span className="italic">Visualisation</span>
          <br />
          Department
        </h1>
        <p className="mt-6 text-lg text-muted-foreground">
          For less than the cost of a single senior hire.
        </p>
        <p className="mx-auto mt-8 max-w-2xl text-muted-foreground leading-relaxed">
          Unlock the production capacity of a world-class studio with no
          payroll overhead, no hardware investment, and no internal management
          costs. Secure dedicated capacity to produce final marketing images,
          enhance your design process, virtually stage your space, or handle
          department overflow, whenever you need it.
        </p>
        <p className="mx-auto mt-6 max-w-2xl text-muted-foreground leading-relaxed">
          Secure dedicated visualisation capacity through a monthly studio
          partnership. This offers ultimate flexibility, with each Lane having
          unlimited scope and revisions taking as little or as long as you'd
          like them to. Once you approve a lane as complete, the next one in
          your queue begins.
        </p>

        {/* Headline price card */}
        <div className="mt-14 mx-auto max-w-md rounded-sm border border-[hsl(var(--gold))]/40 bg-card p-8 shadow-[var(--shadow-card)]">
          <SectionLabel>STUDIO PARTNERSHIP</SectionLabel>
          <p className="mt-3 font-serif text-4xl">£3,950<span className="text-base text-muted-foreground">/month</span></p>
          <p className="mt-2 text-sm text-muted-foreground">1 Lane at a time</p>
          <p className="mt-4 text-sm">
            <span className="font-serif text-2xl text-[hsl(var(--gold))]">32%</span>{" "}
            <span className="text-muted-foreground">
              more cost-efficient than employing 1 internal artist
            </span>
          </p>
        </div>
      </section>

      {/* Cost comparison chart */}
      <section className="border-y border-border/60 bg-[hsl(var(--surface-elevated))]/40">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <SectionHeader
            eyebrow="EXPLORE YOUR SETUP"
            title="Operational cost comparison"
            intro="Hover the chart to compare production costs at different scales."
          />

          <div className="mt-12 grid lg:grid-cols-[1fr,320px] gap-10 items-start">
            <div className="h-[360px] rounded-sm border border-border bg-card p-4">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={chartData}
                  onMouseMove={(e: any) => {
                    if (e?.activePayload?.[0]?.payload?.lanes) {
                      setHoverLanes(e.activePayload[0].payload.lanes);
                    }
                  }}
                  onMouseLeave={() => setHoverLanes(null)}
                  margin={{ top: 16, right: 24, left: 8, bottom: 8 }}
                >
                  <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="lanes"
                    stroke="hsl(var(--muted-foreground))"
                    tickLine={false}
                    label={{
                      value: "Active Lanes",
                      position: "insideBottom",
                      offset: -4,
                      fill: "hsl(var(--muted-foreground))",
                      fontSize: 12,
                    }}
                  />
                  <YAxis
                    stroke="hsl(var(--muted-foreground))"
                    tickLine={false}
                    tickFormatter={(v: number) => `£${v / 1000}k`}
                  />
                  <Tooltip
                    formatter={(v: number) => formatGBP(v)}
                    labelFormatter={(l) => `${l} active lane${l === 1 ? "" : "s"}`}
                    contentStyle={{
                      background: "hsl(var(--popover))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: 4,
                      fontSize: 12,
                    }}
                  />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line
                    type="monotone"
                    name="In-House Artist"
                    dataKey="inHouse"
                    stroke="hsl(var(--muted-foreground))"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                  <Line
                    type="monotone"
                    name="Silver Shadow Subscription"
                    dataKey="subscription"
                    stroke="hsl(var(--gold))"
                    strokeWidth={2.5}
                    dot={{ r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>

            <aside className="rounded-sm border border-border bg-card p-6">
              <p className="font-serif text-sm tracking-widest text-muted-foreground">
                {activeLanes} ACTIVE LANE{activeLanes === 1 ? "" : "S"}
              </p>
              <div className="mt-6 space-y-4">
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted-foreground">
                    In-House Artist
                  </p>
                  <p className="font-serif text-2xl">{formatGBP(inHouseTotal)}</p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-wider text-[hsl(var(--gold))]">
                    Silver Shadow Subscription
                  </p>
                  <p className="font-serif text-2xl">{formatGBP(subTotal)}</p>
                </div>
                {savingsPct > 0 && (
                  <p className="text-sm text-[hsl(var(--gold))]">
                    {savingsPct}% more cost-efficient
                  </p>
                )}
              </div>
              <p className="mt-6 text-xs text-muted-foreground leading-relaxed">
                In-house cost estimates are based on the gross salary of a
                mid-level visualiser employed in London. Hardware, software
                licences, infrastructure, and additional management overhead
                required for larger teams are not included.
              </p>
            </aside>
          </div>
        </div>
      </section>

      {/* What is a lane */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <SectionHeader
          eyebrow="WHAT IS A LANE?"
          title="Lane overview"
          intro="An 'Active Lane' can handle any individual task you need at one time. The task could be to finalise a high-end marketing render or to do a quick design change mid project. We work on each task until you're ready to move to the next, and the number of Lanes shows how many concurrent tasks we handle for you at one time."
        />

        <div className="mt-12 grid md:grid-cols-2 gap-8">
          <div className="rounded-sm border border-border bg-card overflow-hidden">
            <div className="px-6 py-4 border-b border-border bg-[hsl(var(--surface-elevated))]/40">
              <p className="font-serif text-sm tracking-widest">LANE PRICING SCHEDULE</p>
            </div>
            <table className="w-full text-sm">
              <thead className="text-xs uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="text-left px-6 py-3">Lane</th>
                  <th className="text-right px-6 py-3">Cost / month</th>
                </tr>
              </thead>
              <tbody>
                {LANE_PRICES.map((p, i) => (
                  <tr key={i} className="border-t border-border/60">
                    <td className="px-6 py-2.5">Lane {i + 1}</td>
                    <td className="px-6 py-2.5 text-right font-serif">{formatGBP(p)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="px-6 py-4 text-xs text-muted-foreground border-t border-border">
              Each Lane is priced individually. Adding a new Lane does not
              change the cost of existing Lanes.
            </p>
          </div>

          <div className="grid gap-6">
            <FeatureBlock
              title="Services included"
              items={[
                "Custom 3D modelling & materials",
                "Interior rendering",
                "Exterior rendering",
                "360° rendering",
                "Video rendering",
                "Artistic rendering",
                "Silo & lifestyle product rendering",
                "Source file delivery on completion",
              ]}
            />
            <FeatureBlock
              title="Core features"
              items={[
                "Unlimited scenes",
                "Unlimited revisions",
                "Unlimited users",
                "Access to 10,000s of décor props",
                "Dedicated project manager",
                "Onboarding & consultancy",
                "Easy credit card payments",
                "Pause, cancel and upgrade anytime",
              ]}
            />
            <FeatureBlock
              title="Turnaround"
              items={[
                "Architectural 3D modelling — 1–3 days",
                "Product 3D modelling — 1–2 days",
                "Silo renders — 1 day",
                "Lifestyle renders — 1–2 days / scene",
                "Interior renders — 1–2 days / scene",
                "Exterior renders — 1–2 days / scene",
                "Fast iterations within 24 hours",
              ]}
            />
          </div>
        </div>
      </section>

      {/* Value */}
      <section className="border-y border-border/60 bg-[hsl(var(--surface-elevated))]/40">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <SectionHeader
            eyebrow="VALUE PROPOSITION"
            title="What sets us apart"
            intro="We do not simply produce 3D renders. We bring a structured process, project management discipline, and experienced art direction to every project. Our role is to support and elevate the design process, ensuring that visualisation becomes a tool for clearer decisions, stronger presentations, and more refined outcomes."
          />
          <div className="mt-12 grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {VALUE_PROPS.map((v) => (
              <div
                key={v.title}
                className="rounded-sm border border-border bg-card p-6"
              >
                <h3 className="font-serif text-lg">{v.title}</h3>
                <p className="mt-3 text-sm text-muted-foreground leading-relaxed">
                  {v.body}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Workflow */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <SectionHeader
          eyebrow="WORKFLOW"
          title="How it works"
          intro="Each task is processed through a structured cycle. Total indicative turnaround: 2–5 working days per cycle."
        />
        <div className="mt-12 grid md:grid-cols-3 gap-6">
          {PHASES.map((p, i) => (
            <div key={p.title} className="rounded-sm border border-border bg-card p-6">
              <p className="font-serif text-xs tracking-widest text-[hsl(var(--gold))]">
                0{i + 1} · {p.duration}
              </p>
              <h3 className="mt-3 font-serif text-xl">{p.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{p.intro}</p>
              <p className="mt-4 text-xs uppercase tracking-wider text-muted-foreground">
                Activities
              </p>
              <ul className="mt-2 space-y-1.5 text-sm">
                {p.activities.map((a) => (
                  <li key={a} className="flex gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-[hsl(var(--gold))]" />
                    {a}
                  </li>
                ))}
              </ul>
              <p className="mt-4 text-xs uppercase tracking-wider text-muted-foreground">
                Outputs
              </p>
              <p className="mt-1 text-sm text-muted-foreground">{p.outputs}</p>
            </div>
          ))}
        </div>
        <div className="mt-10 flex items-center justify-center gap-3 font-serif text-sm tracking-[0.3em] text-muted-foreground">
          <span>MODEL</span>
          <span className="text-[hsl(var(--gold))]">→</span>
          <span>VISUALISE</span>
          <span className="text-[hsl(var(--gold))]">→</span>
          <span>REVIEW</span>
          <span className="text-[hsl(var(--gold))]">→</span>
          <span>REPEAT</span>
        </div>
      </section>

      {/* Comparison */}
      <section className="border-y border-border/60 bg-[hsl(var(--surface-elevated))]/40">
        <div className="mx-auto max-w-6xl px-6 py-20">
          <SectionHeader
            eyebrow="THE ADVANTAGE"
            title="Operational advantage"
            intro="One-off project vs. retained capacity. Most visualisation workflows are built for fixed outputs. Ours is designed for continuous design development, aligned with how design teams actually work."
          />
          <div className="mt-12 grid md:grid-cols-2 gap-6">
            <div className="rounded-sm border border-border bg-card p-6">
              <p className="font-serif text-sm tracking-widest text-muted-foreground">
                TRADITIONAL STUDIO
              </p>
              <ul className="mt-4 space-y-2.5 text-sm text-muted-foreground">
                {TRADITIONAL.map((t) => (
                  <li key={t}>— {t}</li>
                ))}
              </ul>
            </div>
            <div className="rounded-sm border border-[hsl(var(--gold))]/40 bg-card p-6">
              <p className="font-serif text-sm tracking-widest text-[hsl(var(--gold))]">
                SILVER SHADOW
              </p>
              <ul className="mt-4 space-y-2.5 text-sm">
                {SILVER_SHADOW.map((t) => (
                  <li key={t} className="flex gap-2">
                    <Check className="h-4 w-4 mt-0.5 text-[hsl(var(--gold))] shrink-0" />
                    {t}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <p className="mt-10 mx-auto max-w-2xl text-center text-sm text-muted-foreground">
            <span className="font-serif text-foreground">Strategic partnerships.</span>{" "}
            For large developments or studios requiring dedicated production
            capacity, we structure bespoke partnerships with tailored workflow
            integration and priority scheduling.
          </p>
          <div className="mt-10 flex justify-center">
            <Button asChild size="lg" className="rounded-sm">
              <Link to="/auth">Begin your partnership</Link>
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}

function FeatureBlock({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="rounded-sm border border-border bg-card p-6">
      <p className="font-serif text-sm tracking-widest text-muted-foreground">
        {title.toUpperCase()}
      </p>
      <ul className="mt-4 space-y-2 text-sm">
        {items.map((i) => (
          <li key={i} className="flex gap-2">
            <Check className="h-4 w-4 mt-0.5 text-[hsl(var(--gold))] shrink-0" />
            {i}
          </li>
        ))}
      </ul>
    </div>
  );
}

const VALUE_PROPS = [
  {
    title: "Fixed costs, no surprises",
    body: "Predictable monthly spend makes high-end CGI a sustainable, everyday resource rather than a luxury. Eliminate the volatility of per-project quoting.",
  },
  {
    title: "Total design agility",
    body: "Unlimited iterations allow you to explore design variations until the vision is perfect — no extra invoices, no fear of the clock.",
  },
  {
    title: "Instant senior capacity",
    body: "Access a proven team with a massive render farm and deep asset library instantly. We provide a quality floor that a single hire cannot match.",
  },
  {
    title: "Zero payroll burden",
    body: "Eliminate recruitment fees, national insurance, pensions, and software licences. Get full-department output with monthly flexibility.",
  },
  {
    title: "Dedicated management",
    body: "Cut the guesswork from managing 3D projects with dedicated project management providing expert visualisation consultancy. Rigorous quality control, risk mitigation, predictable delivery windows.",
  },
  {
    title: "Bespoke bandwidth",
    body: "Luxury architecture moves fast. We provide the scale to handle your most complex presentations instantly, ensuring boutique results on every deadline.",
  },
];

const PHASES = [
  {
    title: "Modelling phase",
    duration: "1–2 DAYS",
    intro: "Translate the scene into a structured, technically accurate output.",
    activities: [
      "Requirement clarification",
      "Asset preparation",
      "3D modelling & construction",
      "Technical validation",
      "Internal quality control",
    ],
    outputs: "Initial production-ready model. Draft assets for visualisation.",
  },
  {
    title: "Visualisation phase",
    duration: "1–2 DAYS",
    intro: "Convert the model into client-facing visual output.",
    activities: [
      "Lighting and material setup",
      "High-fidelity rendering",
      "Scene composition",
      "Camera positioning",
      "Draft export",
    ],
    outputs: "Rendered visuals. Presentation-ready previews.",
  },
  {
    title: "Review phase",
    duration: "1 DAY",
    intro: "Client validation and structured feedback.",
    activities: [
      "Client review",
      "Consolidated feedback",
      "Change requests defined",
    ],
    outputs: "Approved deliverable. Revision list triggering iteration.",
  },
];

const TRADITIONAL = [
  "Fixed briefs require full information upfront",
  "Iterations trigger new quotes and approval cycles",
  "Visualisation sits outside the design process",
  "Communication fragmented across emails",
  "Restricted access to working files",
  "Restrictive fixed revisions and scope",
];

const SILVER_SHADOW = [
  "Work begins with partial inputs and evolves with your design",
  "Iteration without additional quoting or approval cycles",
  "Integrated into your design meetings and workflow",
  "Direct, structured communication through your portal",
  "Full access to working files as part of the collaboration",
  "Unlimited revisions and scope",
];
