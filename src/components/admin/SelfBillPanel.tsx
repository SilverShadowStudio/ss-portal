import { useEffect, useState } from "react";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { supabase } from "@/integrations/supabase/client";

// Preview + filename tools for self-billed freelancer invoices.
//
// PREVIEW goes through the real generator (freelancer-self-bill-run with
// dry_run + return_pdf), so what you see is exactly what a real run would file —
// no duplicate rendering logic to drift. Nothing is written, filed or emailed.

const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];

interface Issued {
  id: string; invoice_number: string; payee_name: string;
  period_year: number; period_month: number;
  gross: number | null; currency: string | null;
  current_filename: string | null; expected_filename: string;
  needs_rename: boolean;
}

export function SelfBillPanel() {
  const now = new Date();
  // Default to last month — the period the monthly run would bill.
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const [year, setYear] = useState(prev.getFullYear());
  const [month, setMonth] = useState(prev.getMonth() + 1);

  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<{ name: string; url: string } | null>(null);
  const [issued, setIssued] = useState<Issued[]>([]);

  async function loadIssued() {
    const { data } = await supabase.functions.invoke("admin-self-bill-preview", { body: { action: "list" } });
    setIssued(((data as { items?: Issued[] })?.items) ?? []);
  }
  useEffect(() => { loadIssued(); }, []);

  async function runPreview() {
    setBusy("preview"); setError(null);
    if (preview) { URL.revokeObjectURL(preview.url); setPreview(null); }
    try {
      const { data, error } = await supabase.functions.invoke("freelancer-self-bill-run", {
        body: { period_year: year, period_month: month, dry_run: true, return_pdf: true, ignore_existing: true },
      });
      if (error) throw new Error(error.message);
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      const gen = (data as { generated?: { name: string; filename: string; pdf_base64?: string }[] }).generated ?? [];
      const first = gen.find((g) => g.pdf_base64);
      if (!first?.pdf_base64) {
        setError(gen.length ? "Generated, but no PDF came back." : `Nothing to bill for ${MONTHS[month - 1]} ${year}.`);
        return;
      }
      const bytes = Uint8Array.from(atob(first.pdf_base64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
      setPreview({ name: first.filename, url });
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(null); }
  }

  async function rename(id: string) {
    setBusy(id); setError(null);
    try {
      const { data, error } = await supabase.functions.invoke("admin-self-bill-preview", { body: { action: "rename", invoice_id: id } });
      if (error) throw new Error(error.message);
      if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
      await loadIssued();
    } catch (e) {
      setError((e as Error).message);
    } finally { setBusy(null); }
  }

  const needing = issued.filter((i) => i.needs_rename);

  return (
    <div>
      <p className="mb-6 text-[10px] font-sans leading-relaxed text-foreground/35">
        Preview renders a self-billed invoice from live Airtable data using the real
        generator — nothing is filed, recorded, numbered or emailed. Use it to check
        layout before the monthly run on the 1st.
      </p>

      <div className="mb-4 flex flex-wrap items-end gap-3">
        <div>
          <label className="mb-1.5 block text-[9px] uppercase tracking-[0.2em] text-foreground/40">Month</label>
          <select value={month} onChange={(e) => setMonth(Number(e.target.value))}
            className="h-10 rounded-sm border border-white/15 bg-transparent px-3 text-xs text-foreground">
            {MONTHS.map((m, i) => <option key={m} value={i + 1} className="bg-[#1b1720]">{m}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-[9px] uppercase tracking-[0.2em] text-foreground/40">Year</label>
          <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))}
            className="h-10 w-24 rounded-sm border border-white/15 bg-transparent px-3 text-xs text-foreground" />
        </div>
        <button onClick={runPreview} disabled={busy !== null}
          className="h-10 rounded-sm border border-[#C9A96A]/45 px-4 text-[10px] uppercase tracking-[0.18em] text-[#ecd39c] hover:bg-[#C9A96A]/10 disabled:opacity-40">
          {busy === "preview" ? <BrandLoader size="sm" className="h-3 w-3" /> : "Preview invoice"}
        </button>
      </div>

      {error && <p className="mb-4 text-xs text-[#FF6B5A]">{error}</p>}

      {preview && (
        <div className="mb-6">
          <div className="mb-2 flex items-center justify-between gap-4">
            <p className="truncate text-xs text-standard">{preview.name}</p>
            <a href={preview.url} target="_blank" rel="noopener noreferrer"
              className="shrink-0 text-[10px] uppercase tracking-[0.16em] text-white/50 hover:text-gold">Open in tab</a>
          </div>
          <iframe src={preview.url} title={preview.name} className="h-[620px] w-full rounded-sm border border-white/10 bg-white" />
        </div>
      )}

      {/* Filenames — surfaced only when something is off convention. */}
      {issued.length > 0 && (
        <div className="border-t border-white/[0.07] pt-5">
          <p className="text-label mb-3">Filed invoices · {issued.length}</p>
          {needing.length === 0 ? (
            <p className="text-xs text-recessive">All filenames match the current format.</p>
          ) : (
            <div className="space-y-2">
              <p className="mb-2 text-xs text-recessive">
                {needing.length} file{needing.length === 1 ? " predates" : "s predate"} the current naming format.
                Renaming moves the PDF in Dropbox — it doesn&rsquo;t re-render or re-number the invoice.
              </p>
              {needing.map((i) => (
                <div key={i.id} className="flex flex-wrap items-center justify-between gap-3 rounded-sm border border-white/[0.07] px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-xs text-recessive line-through">{i.current_filename}</p>
                    <p className="truncate text-xs text-standard">{i.expected_filename}</p>
                  </div>
                  <button onClick={() => rename(i.id)} disabled={busy !== null}
                    className="shrink-0 rounded-sm border border-white/15 px-3 py-1.5 text-[10px] uppercase tracking-[0.16em] text-foreground/70 hover:border-white/30 disabled:opacity-40">
                    {busy === i.id ? <BrandLoader size="sm" className="h-3 w-3" /> : "Rename"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
