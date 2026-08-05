import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Upload, Sparkles, Copy, Check, Pencil, Trash2, Phone, MessageSquare, ListChecks, ChevronRight } from "lucide-react";
import { AdminLayout } from "@/components/AdminLayout";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useTableSort, type SortableColumn } from "@/hooks/useTableSort";
import { TableToolbar, TableSearch, TableFilterSelect, SortTh } from "@/components/ui/TableToolbar";
import { DebriefSheet } from "@/components/admin/sales/DebriefSheet";
import { NextActionPicker } from "@/components/admin/sales/NextActionPicker";
import { LeadDossier } from "@/components/admin/sales/LeadDossier";
import { useDirector } from "@/components/admin/sales/DirectorSheet";

interface Lead {
  id: string;
  company: string;
  contact_name: string | null;
  email: string | null;
  role: string | null;
  sector: string | null;
  country: string | null;
  website: string | null;
  phone: string | null;
  segment: string | null;
  status: string;
  notes: string | null;
  pitch_subject: string | null;
  pitch_draft: string | null;
  call_script: string | null;
  value_estimate: number | null;
  last_contacted_at: string | null;
  next_action_at: string | null;
  linkedin_url: string | null;
  win_probability: number | null;
}

const STATUSES = ["new", "contacted", "replied", "meeting", "proposal", "won", "lost"] as const;
const STATUS_LABEL: Record<string, string> = { new: "New", contacted: "Contacted", replied: "Replied", meeting: "Meeting", proposal: "Proposal", won: "Won", lost: "Lost" };
const STATUS_CLS: Record<string, string> = {
  new: "text-white/50", contacted: "text-[#C9A96A]", replied: "text-[#ecd39c]",
  meeting: "text-sky-400", proposal: "text-amber-400", won: "text-emerald-400", lost: "text-white/30",
};
const money = (n: number) => "£" + new Intl.NumberFormat("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(Math.round(n || 0));
const fmtDate = (d: string | null) => (d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const num = (v: string) => { const n = parseFloat(String(v).replace(/[^0-9.]/g, "")); return Number.isFinite(n) ? n : 0; };

// Minimal RFC-4180 CSV parser (handles quotes, "" escapes, embedded newlines).
function parseCSV(text: string): string[][] {
  const rows: string[][] = []; let row: string[] = []; let field = ""; let inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\r") { /* skip */ }
    else if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; }
    else field += c;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows;
}
const isoOrNull = (v: string) => { const t = Date.parse(v); return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10); };
// Call-first priority from your own CSV grouping.
function segRank(r: { segment: string | null; status: string }): number {
  if (r.status === "lost") return 9;
  const s = (r.segment ?? "").toUpperCase();
  if (s.includes("NOW")) return 0;
  if (s.includes("CURRENT")) return 1;
  if (s.includes("DEAD")) return 8;
  return 4;
}

const EMPTY = { company: "", contact_name: "", email: "", role: "", sector: "", country: "", website: "", status: "new", notes: "", value_estimate: "", next_action_at: "" };

export default function AdminSales() {
  const { toast } = useToast();
  const { open: openDirector } = useDirector();
  const [rows, setRows] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("open");

  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY });
  const [saving, setSaving] = useState(false);

  const [importOpen, setImportOpen] = useState(false);
  const [importSector, setImportSector] = useState("Interior Design");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importing, setImporting] = useState(false);

  const [pitch, setPitch] = useState<{ lead: Lead; subject: string; body: string; loading: boolean; mode: "call" | "email" } | null>(null);
  // Debrief sheet — opens in place over the table; never navigates away.
  const [debrief, setDebrief] = useState<{ id: string; company: string } | null>(null);
  // The full record on one lead — everything known, and the whole history.
  const [dossier, setDossier] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from("leads")
      .select("id, company, contact_name, email, role, sector, country, website, phone, segment, status, notes, pitch_subject, pitch_draft, call_script, value_estimate, last_contacted_at, next_action_at, linkedin_url, win_probability")
      .order("next_action_at", { ascending: true, nullsFirst: false });
    setRows((data ?? []) as Lead[]);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter === "open" && (r.status === "won" || r.status === "lost")) return false;
      if (statusFilter !== "open" && statusFilter !== "all" && r.status !== statusFilter) return false;
      if (q && !`${r.company} ${r.contact_name ?? ""} ${r.email ?? ""} ${r.country ?? ""}`.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [rows, search, statusFilter]);

  const COLUMNS: SortableColumn<Lead>[] = [
    // Priority = your own segment (CONTACT NOW → CURRENT → rest → DEAD), then soonest follow-up.
    { id: "priority", accessor: (r) => segRank(r) * 1e13 + (r.next_action_at ? new Date(r.next_action_at).getTime() : 8.9e12), type: "number" },
    { id: "company", accessor: (r) => r.company, type: "text" },
    { id: "contact", accessor: (r) => r.contact_name ?? "", type: "text" },
    { id: "country", accessor: (r) => r.country ?? "", type: "text" },
    { id: "status", accessor: (r) => STATUSES.indexOf(r.status as typeof STATUSES[number]), type: "number" },
    // A lead with no chase date sorts last in both directions — it never pushes
    // a dated lead down the list. (Tried the opposite on 5 Aug 2026, ranking
    // blanks with the oldest; Fred reverted it — the dates are the work.)
    { id: "next", accessor: (r) => r.next_action_at, type: "date" },
    { id: "value", accessor: (r) => r.value_estimate ?? 0, type: "number" },
    { id: "chance", accessor: (r) => r.win_probability, type: "number" },
  ];
  const { sortedRows, sortKey, sortDir, toggle } = useTableSort<Lead>(filtered, COLUMNS, { key: "priority", dir: "asc" });

  // Summary
  const open = rows.filter((r) => r.status !== "won" && r.status !== "lost");
  const withEmail = rows.filter((r) => r.email && r.email.includes("@")).length;
  // Local date, not UTC: toISOString() would still say yesterday between
  // midnight and 01:00 BST, and this decides which row is marked today.
  const todayISO = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  })();
  const dueCount = open.filter((r) => r.next_action_at && r.next_action_at <= todayISO).length;
  const pipelineValue = open.reduce((s, r) => s + Number(r.value_estimate || 0), 0);

  /** Set (or clear) a lead's follow-up date straight from the table. */
  async function setNextAction(id: string, next: string | null) {
    const before = rows.find((r) => r.id === id)?.next_action_at ?? null;
    setRows((p) => p.map((r) => (r.id === id ? { ...r, next_action_at: next } : r)));
    const { error } = await supabase.from("leads").update({ next_action_at: next }).eq("id", id);
    if (error) {
      setRows((p) => p.map((r) => (r.id === id ? { ...r, next_action_at: before } : r)));
      toast({ title: "Couldn't set the chase", description: error.message, variant: "destructive" });
      return;
    }
    // No confirmation toast. The row already shows it — the date changes, the
    // colour changes, and it re-sorts. Now that a toast is modal and waits to be
    // clicked, confirming something you can already see is pure friction.
    // Failures still speak up; those you can't see.
  }

  function openAdd() { setEditId(null); setForm({ ...EMPTY, sector: "Interior Design" }); setEditOpen(true); }
  function openEdit(r: Lead) {
    setEditId(r.id);
    setForm({
      company: r.company, contact_name: r.contact_name ?? "", email: r.email ?? "", role: r.role ?? "",
      sector: r.sector ?? "", country: r.country ?? "", website: r.website ?? "", status: r.status,
      notes: r.notes ?? "", value_estimate: r.value_estimate != null ? String(r.value_estimate) : "", next_action_at: r.next_action_at ?? "",
    });
    setEditOpen(true);
  }
  async function saveLead() {
    if (!form.company.trim()) { toast({ title: "Company is required", variant: "destructive" }); return; }
    setSaving(true);
    const patch = {
      company: form.company.trim(), contact_name: form.contact_name.trim() || null, email: form.email.trim() || null,
      role: form.role.trim() || null, sector: form.sector.trim() || null, country: form.country.trim() || null,
      website: form.website.trim() || null, status: form.status, notes: form.notes.trim() || null,
      value_estimate: form.value_estimate.trim() ? num(form.value_estimate) : null, next_action_at: form.next_action_at || null,
    };
    const { error } = editId
      ? await supabase.from("leads").update(patch).eq("id", editId)
      : await supabase.from("leads").insert({ ...patch, created_by: (await supabase.auth.getUser()).data.user?.id ?? null });
    setSaving(false);
    if (error) { toast({ title: "Couldn't save", description: error.message, variant: "destructive" }); return; }
    toast({ title: editId ? "Lead updated" : "Lead added" });
    setEditOpen(false); load();
  }
  async function quickStatus(r: Lead, status: string) {
    setRows((prev) => prev.map((x) => x.id === r.id ? { ...x, status } : x));
    await supabase.from("leads").update({ status }).eq("id", r.id);
  }
  async function removeLead(r: Lead) {
    if (!window.confirm(`Remove ${r.company} from your leads?`)) return;
    const { error } = await supabase.from("leads").delete().eq("id", r.id);
    if (error) { toast({ title: "Couldn't remove", description: error.message, variant: "destructive" }); return; }
    load();
  }

  async function runImport() {
    if (!importFile) { toast({ title: "Choose a CSV first", variant: "destructive" }); return; }
    setImporting(true);
    try {
      const text = await importFile.text();
      const table = parseCSV(text);
      if (table.length < 2) throw new Error("No rows found");
      const hdr = table[0].map((h) => h.replace(/\s+/g, " ").trim().toLowerCase());
      const find = (...terms: string[]) => hdr.findIndex((h) => terms.every((t) => h.includes(t)));
      const iCompany = find("company"), iContact = find("contact", "person") >= 0 ? find("contact", "person") : find("contact"), iEmail = find("email"),
        iTitle = find("title"), iWeb = find("website"), iCountry = find("country"), iAddr = find("address"),
        iLinked = find("linkedin"), iPhone = find("phone"), iStatus = find("lead", "status"),
        iPot = find("potential"), iRev = find("expected", "revenue"),
        iNext = find("next", "date"), iLast = hdr.findIndex((h) => h.includes("last") && h.includes("date") && !h.includes("type") && !h.includes("report")),
        iReport = find("last", "report");
      const iPA = hdr.indexOf("pa"), iRec = hdr.indexOf("reception");
      const g = (row: string[], i: number) => (i >= 0 && i < row.length ? row[i].trim() : "");

      const existing = new Set(rows.map((r) => (r.email ?? "").toLowerCase()).filter(Boolean));
      const seen = new Set<string>();
      const toInsert: Record<string, unknown>[] = [];
      let skipped = 0; let section = "";
      const uid = (await supabase.auth.getUser()).data.user?.id ?? null;

      for (const row of table.slice(1)) {
        const company = g(row, iCompany), contact = g(row, iContact), email = g(row, iEmail).toLowerCase(), web = g(row, iWeb);
        const phone = g(row, iPhone) || g(row, iPA) || g(row, iRec);
        // A lone label with nothing else is one of your section headers (CONTACT NOW / DEAD …).
        if (company && !contact && !email && !web && !phone) { section = company.trim(); skipped++; continue; }
        if (!(email.includes("@") || (company && (contact || web || phone)))) { skipped++; continue; }
        if (email && (existing.has(email) || seen.has(email))) { skipped++; continue; }
        if (email) seen.add(email);
        const notesParts = [
          g(row, iStatus) && `Old status: ${g(row, iStatus)}`,
          g(row, iAddr) && `Address: ${g(row, iAddr)}`,
          g(row, iLinked) && `LinkedIn: ${g(row, iLinked)}`,
          g(row, iReport) && `Last report: ${g(row, iReport)}`,
        ].filter(Boolean).join("\n");
        const isDead = /dead/i.test(section);
        toInsert.push({
          company: company || email, contact_name: contact || null, email: email || null,
          role: g(row, iTitle) || null, website: web || null, country: g(row, iCountry) || null,
          phone: phone || null, segment: section || null,
          sector: importSector.trim() || null, status: isDead ? "lost" : "new", notes: notesParts || null,
          value_estimate: g(row, iRev) ? num(g(row, iRev)) : (g(row, iPot) ? num(g(row, iPot)) : null),
          next_action_at: iNext >= 0 ? isoOrNull(g(row, iNext)) : null,
          last_contacted_at: iLast >= 0 && isoOrNull(g(row, iLast)) ? new Date(isoOrNull(g(row, iLast))!).toISOString() : null,
          created_by: uid,
        });
      }
      if (toInsert.length === 0) { toast({ title: "Nothing new to import", description: `${skipped} rows skipped (separators/duplicates).` }); setImporting(false); return; }
      // Insert in chunks.
      for (let i = 0; i < toInsert.length; i += 200) {
        const { error } = await supabase.from("leads").insert(toInsert.slice(i, i + 200));
        if (error) throw error;
      }
      toast({ title: `Imported ${toInsert.length} leads`, description: `${skipped} rows skipped (separators/duplicates).` });
      setImportOpen(false); setImportFile(null); load();
    } catch (e) {
      toast({ title: "Import failed", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    } finally { setImporting(false); }
  }

  async function draftPitch(r: Lead, mode: "call" | "email") {
    const prev = mode === "call" ? (r.call_script ?? "") : (r.pitch_draft ?? "");
    setPitch({ lead: r, subject: mode === "email" ? (r.pitch_subject ?? "") : "", body: prev, loading: true, mode });
    setCopied(false);
    try {
      const { data, error } = await supabase.functions.invoke("draft-sales-pitch", {
        body: { company: r.company, contact_name: r.contact_name, role: r.role, sector: r.sector, website: r.website, notes: r.notes, mode },
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "Couldn't draft");
      setPitch({ lead: r, subject: data.subject, body: data.body, loading: false, mode });
      // Recovered from a reply that hit the length limit — usable, but the last
      // section is likely missing. Say so rather than letting it look complete.
      if (data.truncated) {
        toast({ title: "Brief may be cut short", description: "It ran past the length limit. Re-draft if the end looks missing." });
      }
      await supabase.from("leads").update(mode === "call" ? { call_script: data.body } : { pitch_subject: data.subject, pitch_draft: data.body }).eq("id", r.id);
    } catch (e) {
      setPitch((p) => p && { ...p, loading: false });
      toast({ title: mode === "call" ? "Couldn't draft the call script" : "Couldn't draft the pitch", description: e instanceof Error ? e.message : undefined, variant: "destructive" });
    }
  }
  async function copyPitch() {
    if (!pitch) return;
    await navigator.clipboard.writeText(pitch.mode === "email" ? `Subject: ${pitch.subject}\n\n${pitch.body}` : pitch.body);
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  }
  async function markContacted() {
    if (!pitch) return;
    await supabase.from("leads").update({ status: "contacted", last_contacted_at: new Date().toISOString() }).eq("id", pitch.lead.id);
    setPitch(null); load();
  }

  return (
    <AdminLayout panel panelClassName="ssr-panel--sales">
      <div className="mb-10">
        <div className="mb-4 flex items-end justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="h-px w-12 bg-gold-muted" />
            <span className="text-label-gold text-[#ecd39c]">Sales</span>
          </div>
          {!loading && (
            <div className="flex items-center gap-6 text-right">
              <div><p className="text-[9px] uppercase tracking-[0.22em] text-white/35">Open leads</p><p className="ssr-figure-sm text-strong mt-1">{open.length}</p></div>
              <div><p className="text-[9px] uppercase tracking-[0.22em] text-white/35">Chases due</p><p className={`ssr-figure-sm mt-1 ${dueCount ? "text-[#ecd39c]" : "text-strong"}`}>{dueCount}</p></div>
              <div><p className="text-[9px] uppercase tracking-[0.22em] text-white/35">Pipeline</p><p className="ssr-figure-sm text-strong mt-1">{money(pipelineValue)}</p></div>
            </div>
          )}
        </div>
        <p className="mt-3 text-sm text-recessive">Warm outreach — work your list, draft tailored pitches, and never miss a chase. {withEmail ? `${withEmail} leads have an email.` : ""}</p>
      </div>

      <section className="ssr-zone mb-4">
        <div className="mb-5 flex items-center justify-between gap-4 border-b border-white/[0.07] pb-3">
          <div className="flex items-center gap-3"><div className="h-px w-6 bg-gold-muted" /><h2 className="text-label">Leads</h2></div>
          <div className="flex items-center gap-5">
            <Link to="/admin/sales/commitments" className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-white/45 hover:text-[#ecd39c]"><ListChecks className="h-3 w-3" strokeWidth={1.5} />Commitments</Link>
            <button onClick={openDirector} className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-white/45 hover:text-[#ecd39c]"><MessageSquare className="h-3 w-3" strokeWidth={1.5} />Director</button>
            <button onClick={() => setImportOpen(true)} className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-white/45 hover:text-[#ecd39c]"><Upload className="h-3 w-3" strokeWidth={1.5} />Import CSV</button>
            <button onClick={openAdd} className="inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-[#C9A96A] hover:text-[#ecd39c]"><Plus className="h-3 w-3" strokeWidth={1.5} />Add lead</button>
          </div>
        </div>

        {loading ? (
          <div className="flex justify-center py-10"><BrandLoader size="sm" /></div>
        ) : rows.length === 0 ? (
          <div className="ssr-tile p-10 text-center text-recessive text-sm">No leads yet. Import your CSV to get started.</div>
        ) : (
          <>
            <TableToolbar>
              <TableSearch value={search} onChange={setSearch} placeholder="Search company, contact, country…" />
              <TableFilterSelect value={statusFilter} onChange={setStatusFilter} width="w-[150px]" options={[
                { value: "open", label: "Open" }, { value: "all", label: "All" },
                ...STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] })),
              ]} />
            </TableToolbar>
            <div className="ssr-tile overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/[0.08]">
                    <SortTh id="company" label="Company" activeKey={sortKey} dir={sortDir} onClick={toggle} />
                    <SortTh id="contact" label="Contact" activeKey={sortKey} dir={sortDir} onClick={toggle} />
                    <SortTh id="country" label="Country" activeKey={sortKey} dir={sortDir} onClick={toggle} />
                    <SortTh id="status" label="Status" activeKey={sortKey} dir={sortDir} onClick={toggle} />
                    <SortTh id="next" label="Chase" activeKey={sortKey} dir={sortDir} onClick={toggle} />
                    <SortTh id="value" label="Value" activeKey={sortKey} dir={sortDir} onClick={toggle} align="right" />
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((r) => (
                    <tr
                      key={r.id}
                      /* Due today gets the green sweep — the row you're meant to
                         act on should be findable without reading the dates. */
                      className={`border-b border-white/[0.05] last:border-0 ${
                        r.next_action_at === todayISO ? "ssr-row-today" : ""
                      }`}
                    >
                      <td className="px-4 py-3 text-strong">
                        {/* The name IS the lead. Opening the record needs no
                            separate control — an icon in the action cluster was
                            a button for the thing the row is already about. */}
                        {/* The arrow sits at the column's right edge rather
                            than after the name, so every row's link lands on the
                            same vertical line however long the company is. */}
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <button
                              onClick={() => setDossier(r.id)}
                              title="Everything we know"
                              className="group/name relative inline-block max-w-full text-left transition-colors duration-200 hover:text-[#ecd39c]"
                            >
                              <span className="relative inline-flex items-center gap-1.5">
                                {r.company}
                                {/* Arrives only on approach, and travels the
                                    distance the eye expects it to. */}
                                <ChevronRight
                                  className="h-3 w-3 shrink-0 -translate-x-1 opacity-0 transition-all duration-300 ease-out group-hover/name:translate-x-0 group-hover/name:opacity-70"
                                  strokeWidth={2}
                                />
                              </span>
                              {/* A hairline drawn in from the left, not switched on. */}
                              <span
                                aria-hidden
                                className="absolute -bottom-0.5 left-0 right-4 h-px origin-left scale-x-0 bg-[#C9A96A]/60 transition-transform duration-300 ease-out group-hover/name:scale-x-100"
                              />
                            </button>
                            {r.segment && segRank(r) <= 1 && <div className="mt-0.5 text-[8px] uppercase tracking-[0.18em] text-[#ecd39c]">{r.segment}</div>}
                          </div>

                          {r.website && (
                            <a
                              href={r.website.startsWith("http") ? r.website : `https://${r.website}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              title="Open their website"
                              className="mt-[3px] shrink-0 text-[11px] leading-none text-white/25 transition-all duration-200 hover:-translate-y-px hover:text-[#ecd39c]"
                            >
                              ↗
                            </a>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-standard">
                        {/* The name itself is the link — LinkedIn's own dark-mode
                            blue, which holds 8:1 here where the brand blue manages 3:1.
                            No icon: the colour is the affordance. */}
                        {r.contact_name
                          ? r.linkedin_url
                            ? (
                              <a
                                href={r.linkedin_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                title="Open their LinkedIn profile"
                                className="text-[#70B5F9] underline-offset-2 hover:underline"
                              >
                                {r.contact_name}
                              </a>
                            )
                            : r.contact_name
                          : "—"}
                        {r.phone && <a href={`tel:${r.phone.replace(/[^0-9+]/g, "")}`} onClick={(e) => e.stopPropagation()} className="ml-2 inline-flex items-center gap-1 text-[11px] text-[#C9A96A] hover:text-[#ecd39c]"><Phone className="h-3 w-3" strokeWidth={1.5} />{r.phone}</a>}
                        {r.email && <div className="text-[11px] text-white/35">{r.email}</div>}
                      </td>
                      <td className="px-4 py-3 text-standard">{r.country ?? "—"}</td>
                      <td className="px-4 py-3">
                        <select value={r.status} onChange={(e) => quickStatus(r, e.target.value)} className={`bg-transparent text-[11px] uppercase tracking-[0.14em] focus:outline-none cursor-pointer ${STATUS_CLS[r.status] ?? "text-white/50"}`}>
                          {STATUSES.map((s) => <option key={s} value={s} className="bg-background text-foreground">{STATUS_LABEL[s]}</option>)}
                        </select>
                      </td>
                      {/* Today is green — the one you act on now. Overdue stays gold, so the
                          two read as different kinds of urgent rather than one bucket. */}
                      <td
                        className={`px-4 py-3 tabular-nums ${
                          r.next_action_at === todayISO
                            ? "text-[#8FD9A8]"
                            : r.next_action_at && r.next_action_at < todayISO
                            ? "text-[#ecd39c]"
                            : "text-standard"
                        }`}
                      >
                        <NextActionPicker
                          value={r.next_action_at}
                          onChange={(next) => setNextAction(r.id, next)}
                        >
                          {/* A dash is still a target — an unplanned lead is the
                              one most worth clicking. */}
                          {r.next_action_at ? fmtDate(r.next_action_at) : <span className="text-white/25">—</span>}
                        </NextActionPicker>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-standard">{r.value_estimate ? money(Number(r.value_estimate)) : "—"}</td>
                      {/* The Director's rolling read after each assessed call.
                          Blank until one exists — a probability nobody has
                          judged would just be decoration. */}
                      <td className={`px-4 py-3 text-right tabular-nums ${
                        r.win_probability == null ? "text-white/20"
                        : r.win_probability >= 70 ? "text-[#8FD9A8]"
                        : r.win_probability >= 40 ? "text-[#ecd39c]"
                        : "text-[#F0544C]"}`}>
                        {r.win_probability == null ? "—" : `${r.win_probability}%`}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <span className="inline-flex items-center gap-4">
                          <button onClick={() => draftPitch(r, "call")} className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.14em] text-[#C9A96A] hover:text-[#ecd39c]"><Sparkles className="h-3 w-3" strokeWidth={1.5} />Call script</button>
                          <button onClick={() => setDebrief({ id: r.id, company: r.company })} className="text-[10px] uppercase tracking-[0.14em] text-white/55 hover:text-[#ecd39c]">Debrief</button>
                          <button onClick={() => openEdit(r)} className="text-white/40 hover:text-gold" title="Edit"><Pencil className="h-3.5 w-3.5" strokeWidth={1.5} /></button>
                          <button onClick={() => removeLead(r)} className="text-white/30 hover:text-rose-400" title="Remove"><Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} /></button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 px-1 text-[10px] uppercase tracking-[0.16em] text-white/35">{filtered.length} shown · sorted by soonest chase. Draft a pitch, send it from your own inbox, then set the next chase.</p>
          </>
        )}
      </section>

      {/* Import dialog */}
      <Dialog open={importOpen} onOpenChange={setImportOpen}>
        <DialogContent className="max-w-md rounded-sm border-divider bg-background">
          <DialogHeader>
            <p className="text-[9px] uppercase tracking-[0.28em] text-foreground/40">Sales · Import</p>
            <DialogTitle className="font-serif font-normal text-2xl">Import leads from CSV</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1.5"><Label>CSV file</Label><Input type="file" accept=".csv,text/csv" onChange={(e) => setImportFile(e.target.files?.[0] ?? null)} className="rounded-sm" /></div>
            <div className="space-y-1.5"><Label>Sector for this batch</Label><Input value={importSector} onChange={(e) => setImportSector(e.target.value)} placeholder="Interior Design" className="rounded-sm" /></div>
            <p className="text-[10px] text-muted-foreground/70">Maps Company, Contact, Email, Title, Website, Country. Separator rows and duplicate emails are skipped; old status/address/phone/report go into notes.</p>
          </div>
          <DialogFooter>
            <button type="button" onClick={() => setImportOpen(false)} className="text-sm text-recessive hover:text-standard">Cancel</button>
            <Button onClick={runImport} disabled={importing} className="rounded-sm">{importing ? "Importing…" : "Import"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Add / edit dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-lg rounded-sm border-divider bg-background">
          <DialogHeader>
            <p className="text-[9px] uppercase tracking-[0.28em] text-foreground/40">Sales · Lead</p>
            <DialogTitle className="font-serif font-normal text-2xl">{editId ? "Edit lead" : "Add lead"}</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-4 py-2">
            <div className="space-y-1.5"><Label>Company</Label><Input value={form.company} onChange={(e) => setForm((f) => ({ ...f, company: e.target.value }))} className="rounded-sm" /></div>
            <div className="space-y-1.5"><Label>Contact</Label><Input value={form.contact_name} onChange={(e) => setForm((f) => ({ ...f, contact_name: e.target.value }))} className="rounded-sm" /></div>
            <div className="space-y-1.5"><Label>Email</Label><Input value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} className="rounded-sm" /></div>
            <div className="space-y-1.5"><Label>Role / title</Label><Input value={form.role} onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))} className="rounded-sm" /></div>
            <div className="space-y-1.5"><Label>Sector</Label><Input value={form.sector} onChange={(e) => setForm((f) => ({ ...f, sector: e.target.value }))} className="rounded-sm" /></div>
            <div className="space-y-1.5"><Label>Country</Label><Input value={form.country} onChange={(e) => setForm((f) => ({ ...f, country: e.target.value }))} className="rounded-sm" /></div>
            <div className="space-y-1.5"><Label>Website</Label><Input value={form.website} onChange={(e) => setForm((f) => ({ ...f, website: e.target.value }))} className="rounded-sm" /></div>
            <div className="space-y-1.5"><Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}>
                <SelectTrigger className="rounded-sm"><SelectValue /></SelectTrigger>
                <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}>{STATUS_LABEL[s]}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5"><Label>Potential value (£)</Label><Input inputMode="decimal" value={form.value_estimate} onChange={(e) => setForm((f) => ({ ...f, value_estimate: e.target.value }))} className="rounded-sm" /></div>
            <div className="space-y-1.5"><Label>Next follow-up</Label><Input type="date" value={form.next_action_at} onChange={(e) => setForm((f) => ({ ...f, next_action_at: e.target.value }))} className="rounded-sm" /></div>
            <div className="col-span-2 space-y-1.5"><Label>Notes</Label><textarea value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} rows={3} className="w-full rounded-sm border border-input bg-background px-3 py-2 text-sm resize-none" /></div>
          </div>
          <DialogFooter>
            <button type="button" onClick={() => setEditOpen(false)} className="text-sm text-recessive hover:text-standard">Cancel</button>
            <Button onClick={saveLead} disabled={saving} className="rounded-sm">{saving ? "Saving…" : "Save lead"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pitch dialog */}
      <Dialog open={!!pitch} onOpenChange={(o) => { if (!o) setPitch(null); }}>
        <DialogContent className="max-w-xl rounded-sm border-divider bg-background">
          <DialogHeader>
            <div className="flex items-center justify-between gap-4">
              <p className="text-[9px] uppercase tracking-[0.28em] text-foreground/40">Sales · {pitch?.lead.company}{pitch?.lead.phone ? ` · ${pitch.lead.phone}` : ""}</p>
              {pitch && (
                <div className="inline-flex items-center gap-2 text-[10px] uppercase tracking-[0.18em]">
                  <button onClick={() => draftPitch(pitch.lead, "call")} className={pitch.mode === "call" ? "text-[#ecd39c]" : "text-white/35 hover:text-white/70"}>Call script</button>
                  <span className="text-white/20">/</span>
                  <button onClick={() => draftPitch(pitch.lead, "email")} className={pitch.mode === "email" ? "text-[#ecd39c]" : "text-white/35 hover:text-white/70"}>Email</button>
                </div>
              )}
            </div>
            <DialogTitle className="font-serif font-normal text-2xl">{pitch?.mode === "call" ? "Call brief" : "Outreach draft"}</DialogTitle>
          </DialogHeader>
          {pitch?.loading ? (
            <div className="flex items-center gap-2 py-10 justify-center text-sm text-muted-foreground"><BrandLoader size="sm" className="h-3.5 w-3.5" /> {pitch.mode === "call" ? "Preparing your call brief…" : "Drafting a tailored pitch…"}</div>
          ) : (
            <div className="space-y-3 py-2">
              {pitch?.mode === "email" && <div className="space-y-1.5"><Label>Subject</Label><Input value={pitch?.subject ?? ""} onChange={(e) => setPitch((p) => p && { ...p, subject: e.target.value })} className="rounded-sm" /></div>}
              <div className="space-y-1.5"><Label>{pitch?.mode === "call" ? "Script" : "Body"}</Label><textarea value={pitch?.body ?? ""} onChange={(e) => setPitch((p) => p && { ...p, body: e.target.value })} rows={pitch?.mode === "call" ? 14 : 10} className="w-full rounded-sm border border-input bg-background px-3 py-2 text-sm" /></div>
              <p className="text-[10px] text-muted-foreground/70">{pitch?.mode === "call" ? "Glance at this mid-call. After the call, mark contacted and set the next follow-up." : "Edit, copy, and send from your own inbox (best deliverability). Then mark contacted."}</p>
            </div>
          )}
          <DialogFooter className="sm:justify-between">
            <button type="button" onClick={() => pitch && draftPitch(pitch.lead, pitch.mode)} disabled={pitch?.loading} className="text-sm text-recessive hover:text-standard disabled:opacity-40">Re-draft</button>
            <div className="flex items-center gap-4">
              <button type="button" onClick={copyPitch} className="inline-flex items-center gap-1.5 text-sm text-recessive hover:text-standard">{copied ? <><Check className="h-3.5 w-3.5" />Copied</> : <><Copy className="h-3.5 w-3.5" />Copy</>}</button>
              <Button onClick={markContacted} className="rounded-sm">Mark contacted</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {dossier && <LeadDossier leadId={dossier} onClose={() => setDossier(null)} />}

      {debrief && (
        <DebriefSheet
          leadId={debrief.id}
          company={debrief.company}
          onClose={() => { setDebrief(null); load(); }}
        />
      )}
    </AdminLayout>
  );
}
