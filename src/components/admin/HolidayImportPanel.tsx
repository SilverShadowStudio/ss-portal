import { useState } from "react";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { supabase } from "@/integrations/supabase/client";

// One-off migration UI: Airtable "Team Holiday Tracker" → Supabase team_leave_requests.
// Dry run first (writes nothing), review the plan, then commit. Idempotent —
// re-running only imports days that aren't already in the portal.

interface Report {
  dry_run: boolean;
  airtable_rows: number;
  would_insert: number;
  inserted?: number;
  per_person: Record<string, { ranges: number; days: number; new_days: number; already: number }>;
  unmatched_people: { airtable_user: string; email: string; ranges: number; days: number }[];
  skipped: string[];
  sample: { leave_date: string; note: string }[];
}

export function HolidayImportPanel() {
  const [busy, setBusy] = useState<"dry" | "commit" | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(dry: boolean) {
    setBusy(dry ? "dry" : "commit");
    setError(null);
    try {
      const { data, error } = await supabase.functions.invoke("admin-import-airtable-holidays", {
        body: { dry_run: dry },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      setReport(data as Report);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <p className="text-[10px] font-sans text-foreground/35 mb-6 leading-relaxed">
        Copies the Airtable Team Holiday Tracker into the portal. Airtable stores date
        ranges; the portal stores one row per day, so ranges are expanded (weekends skipped).
        Read-only on Airtable — nothing is ever written back. Safe to re-run: days already
        in the portal are skipped.
      </p>

      <div className="flex gap-3">
        <button
          onClick={() => run(true)}
          disabled={busy !== null}
          className="h-10 rounded-sm border border-white/15 px-4 text-[10px] uppercase tracking-[0.18em] text-foreground/70 hover:border-white/30 disabled:opacity-40"
        >
          {busy === "dry" ? <BrandLoader size="sm" className="h-3 w-3" /> : "Dry run"}
        </button>
        <button
          onClick={() => run(false)}
          disabled={busy !== null || !report || (report.would_insert ?? 0) === 0 || !report.dry_run}
          className="h-10 rounded-sm bg-[#C9A96A] px-4 text-[10px] uppercase tracking-[0.18em] text-[#211a0f] disabled:opacity-30"
        >
          {busy === "commit" ? <BrandLoader size="sm" className="h-3 w-3" /> : `Import${report?.would_insert ? ` ${report.would_insert} days` : ""}`}
        </button>
      </div>

      {error && <p className="mt-4 text-xs text-[#FF6B5A]">{error}</p>}

      {report && (
        <div className="mt-6 space-y-4 text-xs">
          <p className={report.dry_run ? "text-[#E4B95B]" : "text-[#6FBE8A]"}>
            {report.dry_run
              ? `Dry run · ${report.airtable_rows} Airtable rows → ${report.would_insert} days would be added. Nothing written.`
              : `Imported ${report.inserted ?? 0} days from ${report.airtable_rows} Airtable rows.`}
          </p>

          <div>
            <p className="text-label mb-2">Per person</p>
            <table className="w-full">
              <thead>
                <tr className="text-[9px] uppercase tracking-[0.16em] text-foreground/40">
                  <th className="text-left py-1">Person</th>
                  <th className="text-right py-1">Ranges</th>
                  <th className="text-right py-1">Days</th>
                  <th className="text-right py-1">New</th>
                  <th className="text-right py-1">Already there</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(report.per_person).map(([name, p]) => (
                  <tr key={name} className="border-t border-white/[0.06]">
                    <td className="py-1.5 text-standard">{name}</td>
                    <td className="py-1.5 text-right tabular-nums text-recessive">{p.ranges}</td>
                    <td className="py-1.5 text-right tabular-nums text-recessive">{p.days}</td>
                    <td className="py-1.5 text-right tabular-nums text-[#6FBE8A]">{p.new_days}</td>
                    <td className="py-1.5 text-right tabular-nums text-recessive">{p.already}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {report.unmatched_people.length > 0 && (
            <div>
              <p className="text-label mb-2 text-[#E4B95B]">No portal account — these will NOT be imported</p>
              {report.unmatched_people.map((u) => (
                <p key={u.airtable_user} className="text-recessive">
                  {u.airtable_user} {u.email ? `· ${u.email}` : ""} — {u.ranges} range{u.ranges === 1 ? "" : "s"}, {u.days} days
                </p>
              ))}
            </div>
          )}

          {report.skipped.length > 0 && (
            <div>
              <p className="text-label mb-2">Skipped rows</p>
              {report.skipped.map((s, i) => <p key={i} className="text-recessive">{s}</p>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
