import { useState, useEffect, useCallback, useMemo } from "react";
import { format } from "date-fns";
import { Check, X } from "lucide-react";
import { supabase, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "@/integrations/supabase/client";
import { AdminLayout } from "@/components/AdminLayout";
import {
  ProductionGantt,
  type GanttProject,
  type GanttRound,
  type OverlayEntry,
} from "@/components/admin/ProductionGantt";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

// ─── Pending lane task request types (preserved intact) ───────────────────────
interface AttachmentRef { name: string; path: string; size?: number; type?: string }
interface PendingRequest {
  id: string;
  account_id: string;
  title: string;
  description: string | null;
  project_id: string | null;
  project_name: string | null;
  client_name: string;
  requested_delivery_date: string | null;
  created_at: string;
  attachments: AttachmentRef[];
}

// Parse a YYYY-MM-DD string as a local-midnight Date (avoids UTC→local shift).
function parseLocalDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

export default function AdminTimeline() {
  const [productionColor] = useState('#4f6c99');
  const [feedbackColor]   = useState('#a8493c');
  const [showPhaseLabels, setShowPhaseLabels] = useState(true);
  const [showSupabase,    setShowSupabase]    = useState(true);
  const [showAirtable,    setShowAirtable]    = useState(true); // now live: gates deadline pins

  // ─── Gantt data (Supabase) ────────────────────────────────────────────────────
  const [ganttProjects, setGanttProjects] = useState<GanttProject[]>([]);
  const [ganttLoading,  setGanttLoading]  = useState(true);

  // ─── Airtable overlay ─────────────────────────────────────────────────────────
  const [overlayData,  setOverlayData]  = useState<Record<string, OverlayEntry>>({});
  const [overlayError, setOverlayError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // ── Supabase data fetch (3 sequential queries) ──────────────────────────────
    const fetchSupabase = async (): Promise<GanttProject[]> => {
      const { data: projRows } = await supabase
        .from('projects')
        .select('id, project_code, name')
        .order('created_at', { ascending: true });

      if (!projRows?.length) return [];

      const projIds = projRows.map((p) => p.id);

      const { data: sceneRows } = await supabase
        .from('scenes')
        .select('id, name, project_id, airtable_record_id') // Stage 3: include airtable_record_id
        .in('project_id', projIds)
        .order('created_at', { ascending: true });

      const sceneIds = (sceneRows ?? []).map((s) => s.id);

      const { data: roundRows } = sceneIds.length
        ? await supabase
            .from('scene_rounds')
            .select('id, scene_id, round_number, kind, start_date, end_date, delivered_at')
            .in('scene_id', sceneIds)
            .order('round_number', { ascending: true })
        : { data: [] };

      const roundsByScene = new Map<string, GanttRound[]>();
      for (const r of (roundRows ?? [])) {
        if (!r.start_date && !r.delivered_at) continue;
        const kind: 'production' | 'review' = r.kind === 'review' ? 'review' : 'production';
        const gr: GanttRound = {
          id:          r.id,
          roundNumber: r.round_number,
          kind,
          startDate:   r.start_date   ?? null,
          endDate:     r.end_date     ?? null,
          deliveredAt: r.delivered_at ?? null,
        };
        const arr = roundsByScene.get(r.scene_id) ?? [];
        arr.push(gr);
        roundsByScene.set(r.scene_id, arr);
      }

      const scenesByProject = new Map<string, typeof sceneRows>();
      for (const s of (sceneRows ?? [])) {
        const arr = scenesByProject.get(s.project_id) ?? [];
        arr.push(s);
        scenesByProject.set(s.project_id, arr);
      }

      return projRows
        .map((p) => ({
          id:   p.id,
          code: p.project_code ?? '',
          name: p.name,
          scenes: (scenesByProject.get(p.id) ?? []).map((s) => ({
            id:               s.id,
            name:             s.name,
            airtableRecordId: (s as any).airtable_record_id ?? null,
            rounds:           roundsByScene.get(s.id) ?? [],
          })),
        }))
        .filter((p) => p.scenes.some((s) => s.rounds.length > 0));
    };

    // ── Airtable overlay fetch ──────────────────────────────────────────────────
    const fetchOverlay = async (): Promise<Record<string, OverlayEntry>> => {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      if (!token) throw new Error('Not authenticated');
      const r = await fetch(`${SUPABASE_URL}/functions/v1/timeline-airtable-overlay`, {
        headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_PUBLISHABLE_KEY },
      });
      const json = await r.json();
      if (!r.ok) throw new Error(json?.error ?? `HTTP ${r.status}`);
      return (json?.overlay ?? {}) as Record<string, OverlayEntry>;
    };

    const run = async () => {
      setGanttLoading(true);
      setOverlayError(false);

      const [supaResult, overlayResult] = await Promise.allSettled([
        fetchSupabase(),
        fetchOverlay(),
      ]);

      if (cancelled) return;

      setGanttProjects(
        supaResult.status === 'fulfilled' ? supaResult.value : [],
      );

      if (overlayResult.status === 'fulfilled') {
        setOverlayData(overlayResult.value);
      } else {
        console.warn('[AdminTimeline] Airtable overlay failed:', overlayResult.reason);
        setOverlayData({});
        setOverlayError(true);
      }

      setGanttLoading(false);
    };

    run();
    return () => { cancelled = true; };
  }, []);

  // Dynamic subtitle: date range + counts derived from live Supabase data
  const subtitle = useMemo(() => {
    if (ganttLoading) return '…';
    if (!ganttProjects.length) return 'No scheduled rounds found';

    let minStr = '', maxStr = '';
    let sceneCount = 0;

    for (const proj of ganttProjects) {
      for (const scene of proj.scenes) {
        if (scene.rounds.length > 0) sceneCount++;
        for (const r of scene.rounds) {
          const candidates = [r.startDate, r.endDate].filter(Boolean) as string[];
          if (r.deliveredAt) candidates.push(r.deliveredAt.slice(0, 10));
          for (const s of candidates) {
            const ds = s.slice(0, 10);
            if (!minStr || ds < minStr) minStr = ds;
            if (!maxStr || ds > maxStr) maxStr = ds;
          }
        }
      }
    }

    const projCount = ganttProjects.length;
    const scenePart = `${sceneCount} scene${sceneCount !== 1 ? 's' : ''}`;
    const projPart  = `${projCount} project${projCount !== 1 ? 's' : ''}`;

    if (!minStr) return `${scenePart} · ${projPart}`;

    const fmt = (s: string) => format(parseLocalDate(s), 'd MMM yyyy');
    return `${fmt(minStr)} — ${fmt(maxStr)} · ${scenePart} · ${projPart}`;
  }, [ganttProjects, ganttLoading]);

  // ─── Toggle button helper ─────────────────────────────────────────────────────
  const toggleBtn = (label: string, active: boolean, disabled: boolean, onClick: () => void) => (
    <button
      key={label}
      onClick={onClick}
      disabled={disabled}
      style={{
        fontFamily: "'Jost', sans-serif",
        fontSize: 10,
        fontWeight: 500,
        letterSpacing: '1.5px',
        textTransform: 'uppercase',
        color: disabled ? '#3a332c' : active ? '#c5a572' : '#6a6258',
        background: 'none',
        border: '1px solid',
        borderColor: disabled ? 'rgba(197,165,114,0.05)' : active ? 'rgba(197,165,114,0.35)' : 'rgba(197,165,114,0.10)',
        borderRadius: 4,
        padding: '4px 10px',
        cursor: disabled ? 'default' : 'pointer',
        transition: 'color 0.15s, border-color 0.15s',
      }}
    >
      {label}
    </button>
  );

  // ─── Pending lane task requests (logic preserved intact) ──────────────────────
  const [pendingRequests, setPendingRequests] = useState<PendingRequest[]>([]);
  const [validating, setValidating] = useState<PendingRequest | null>(null);
  const [validateForm, setValidateForm] = useState({
    laneIndex: 1,
    startDate: format(new Date(), 'yyyy-MM-dd'),
    durationDays: 3,
  });

  const loadPendingRequests = useCallback(async () => {
    const { data: rows } = await supabase
      .from('lane_tasks')
      .select('id, account_id, title, description, project_id, requested_delivery_date, created_at, attachments')
      .is('lane_index', null)
      .order('created_at', { ascending: true });
    if (!rows?.length) { setPendingRequests([]); return; }
    const accIds  = Array.from(new Set(rows.map((r) => r.account_id)));
    const projIds = Array.from(new Set(rows.map((r) => r.project_id).filter(Boolean) as string[]));
    const [{ data: accs }, { data: projs }] = await Promise.all([
      supabase.from('accounts').select('id, company_name').in('id', accIds),
      projIds.length
        ? supabase.from('projects').select('id, name').in('id', projIds)
        : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    ]);
    const accMap  = new Map((accs  ?? []).map((a) => [a.id, a.company_name]));
    const projMap = new Map((projs ?? []).map((p) => [p.id, p.name]));
    setPendingRequests(
      rows.map((r: any) => ({
        ...r,
        client_name:  accMap.get(r.account_id) ?? 'Unknown',
        project_name: r.project_id ? projMap.get(r.project_id) ?? null : null,
        attachments:  Array.isArray(r.attachments) ? r.attachments : [],
      })),
    );
  }, []);

  const openAttachment = async (path: string) => {
    const { data, error } = await supabase.storage.from('scene-assets').createSignedUrl(path, 3600);
    if (error || !data?.signedUrl) { toast.error('Could not open file'); return; }
    window.open(data.signedUrl, '_blank');
  };

  useEffect(() => { loadPendingRequests(); }, [loadPendingRequests]);

  const validateRequest = async () => {
    if (!validating) return;
    const { error } = await supabase
      .from('lane_tasks')
      .update({
        lane_index:    validateForm.laneIndex,
        position:      0,
        start_date:    validateForm.startDate,
        duration_days: validateForm.durationDays,
        status:        'in_progress',
        started_at:    new Date().toISOString(),
      })
      .eq('id', validating.id);
    if (error) { toast.error(error.message); return; }
    toast.success('Request validated and scheduled');
    setValidating(null);
    loadPendingRequests();
  };

  const declineRequest = async (id: string) => {
    const { error } = await supabase.from('lane_tasks').update({ status: 'cancelled' }).eq('id', id);
    if (error) { toast.error(error.message); return; }
    toast.success('Request declined');
    loadPendingRequests();
  };

  return (
    <AdminLayout>

      {/* ── Page header ── */}
      <div style={{ marginBottom: 0 }}>
        {/* Eyebrow */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
          <div style={{ width: 36, height: 1, background: '#c5a572', flexShrink: 0 }} />
          <span
            style={{
              fontFamily: "'Jost', sans-serif",
              fontSize: 12,
              fontWeight: 500,
              letterSpacing: '3.5px',
              textTransform: 'uppercase',
              color: '#c5a572',
            }}
          >
            Production Timeline
          </span>
        </div>

        {/* Title */}
        <h1
          style={{
            fontFamily: "'Cormorant Garamond', serif",
            fontSize: 42,
            fontWeight: 500,
            lineHeight: 1.1,
            color: '#ece6da',
            margin: 0,
          }}
        >
          Production Schedule
        </h1>

        {/* Subtitle — dynamic */}
        <p
          style={{
            fontFamily: "'Jost', sans-serif",
            fontSize: 13,
            letterSpacing: '1px',
            color: '#8c8478',
            marginTop: 12,
            marginBottom: 0,
          }}
        >
          {subtitle}
        </p>

        {/* Legend */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 26, marginTop: 26, flexWrap: 'wrap' }}>
          {/* Production swatch */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 15, height: 15, borderRadius: 4, background: productionColor, flexShrink: 0 }} />
            <span style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, fontWeight: 500, letterSpacing: '2px', textTransform: 'uppercase', color: '#a89e8c' }}>
              Production
            </span>
          </div>
          {/* Feedback swatch */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 15, height: 15, borderRadius: 4, background: feedbackColor, flexShrink: 0 }} />
            <span style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, fontWeight: 500, letterSpacing: '2px', textTransform: 'uppercase', color: '#a89e8c' }}>
              Feedback
            </span>
          </div>
          {/* Airtable deadline pin swatch */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div
              style={{
                width: 9,
                height: 9,
                transform: 'rotate(45deg)',
                background: '#c5a572',
                flexShrink: 0,
              }}
            />
            <span style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, fontWeight: 500, letterSpacing: '2px', textTransform: 'uppercase', color: '#a89e8c' }}>
              Deadline
            </span>
          </div>
          {/* Vertical divider */}
          <div style={{ width: 1, height: 18, background: 'rgba(197,165,114,0.16)', flexShrink: 0 }} />
          {/* Manager dots — resolved from Airtable; static placeholder names until Stage 3 overlay loads */}
          {[
            { name: 'Katerina', color: '#8a76ad' },
            { name: 'Fiodor',   color: '#4f9aa3' },
            { name: 'May',      color: '#b0604f' },
          ].map((m) => (
            <div key={m.name} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 7, height: 7, borderRadius: '50%', background: m.color, flexShrink: 0 }} />
              <span style={{ fontFamily: "'Jost', sans-serif", fontSize: 11, fontWeight: 500, letterSpacing: '1.5px', textTransform: 'uppercase', color: '#a89e8c' }}>
                {m.name}
              </span>
            </div>
          ))}
          {/* Toggle buttons */}
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            {toggleBtn('Supabase', showSupabase, false, () => setShowSupabase((v) => !v))}
            {toggleBtn(showAirtable ? 'Airtable on' : 'Airtable off', showAirtable, false, () => setShowAirtable((v) => !v))}
            {toggleBtn(showPhaseLabels ? 'Labels on' : 'Labels off', showPhaseLabels, false, () => setShowPhaseLabels((v) => !v))}
          </div>
        </div>

        {/* Airtable error note — quiet, inline, only when overlay failed */}
        {overlayError && (
          <p
            style={{
              fontFamily: "'Jost', sans-serif",
              fontSize: 10,
              letterSpacing: '1px',
              color: '#5a5248',
              marginTop: 10,
              marginBottom: 0,
            }}
          >
            Airtable unavailable — deadline pins and manager names hidden
          </p>
        )}
      </div>

      {/* ── Gantt card ── */}
      <ProductionGantt
        projects={ganttProjects}
        loading={ganttLoading}
        showSupabase={showSupabase}
        showAirtable={showAirtable}
        overlayData={overlayData}
        productionColor={productionColor}
        feedbackColor={feedbackColor}
        showPhaseLabels={showPhaseLabels}
      />

      {/* ── Pending Lane Task Requests (logic preserved intact) ── */}
      {pendingRequests.length > 0 && (
        <div className="mt-8 rounded-xl border border-border bg-card overflow-hidden">
          <header className="px-6 py-4 border-b border-border flex items-center gap-3">
            <span className="text-[10px] font-bold tracking-[0.22em] uppercase text-gold">
              Pending Requests
            </span>
            <span className="text-xs text-muted-foreground">
              {pendingRequests.length} awaiting validation
            </span>
          </header>
          <ul className="divide-y divide-border">
            {pendingRequests.map((r) => (
              <li key={r.id} className="px-6 py-4 flex items-center gap-6">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3">
                    <span className="text-[10px] font-bold uppercase tracking-[0.18em] text-gold/80">
                      {r.client_name}
                    </span>
                    {r.project_name && (
                      <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
                        · {r.project_name}
                      </span>
                    )}
                  </div>
                  <p className="font-serif text-sm text-foreground mt-1 truncate">{r.title}</p>
                  {r.description && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{r.description}</p>
                  )}
                  {r.attachments && r.attachments.length > 0 && (
                    <div className="flex flex-wrap gap-2 mt-2">
                      {r.attachments.map((a, i) => (
                        <button
                          key={i}
                          onClick={() => openAttachment(a.path)}
                          className="text-[10px] uppercase tracking-[0.12em] px-2 py-1 rounded border border-border/60 hover:border-gold/60 hover:text-gold transition-colors text-muted-foreground"
                        >
                          {a.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <p className="text-[9px] uppercase tracking-[0.22em] text-muted-foreground/70">
                    Requested delivery
                  </p>
                  <p className="text-xs text-foreground mt-1">
                    {r.requested_delivery_date
                      ? format(new Date(r.requested_delivery_date), 'MMM d, yyyy')
                      : '—'}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    size="sm"
                    onClick={() => {
                      setValidating(r);
                      setValidateForm({
                        laneIndex:    1,
                        startDate:    format(new Date(), 'yyyy-MM-dd'),
                        durationDays: 3,
                      });
                    }}
                  >
                    <Check className="h-3.5 w-3.5 mr-1" /> Validate
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => declineRequest(r.id)}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Validate Request Modal (logic preserved intact) ── */}
      <Dialog open={!!validating} onOpenChange={(o) => !o && setValidating(null)}>
        <DialogContent className="z-[100] max-w-md">
          <DialogHeader>
            <DialogTitle className="font-serif">Validate request</DialogTitle>
          </DialogHeader>
          {validating && (
            <div className="space-y-4">
              <div className="rounded-md bg-muted/40 p-3 border border-border">
                <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                  {validating.client_name}
                  {validating.project_name ? ` · ${validating.project_name}` : ''}
                </p>
                <p className="font-serif text-sm mt-1">{validating.title}</p>
                {validating.requested_delivery_date && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Requested by {format(new Date(validating.requested_delivery_date), 'MMM d, yyyy')}
                  </p>
                )}
              </div>
              <div>
                <label className="text-[10px] font-bold uppercase tracking-[0.22em] text-gold">Lane</label>
                <select
                  value={validateForm.laneIndex}
                  onChange={(e) => setValidateForm((p) => ({ ...p, laneIndex: Number(e.target.value) }))}
                  className="mt-1.5 w-full rounded-sm border border-border bg-card px-3 py-2 text-sm"
                >
                  {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                    <option key={n} value={n}>Lane {n.toString().padStart(2, '0')}</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-[0.22em] text-gold">Start date</label>
                  <Input
                    type="date"
                    className="mt-1.5"
                    value={validateForm.startDate}
                    onChange={(e) => setValidateForm((p) => ({ ...p, startDate: e.target.value }))}
                  />
                </div>
                <div>
                  <label className="text-[10px] font-bold uppercase tracking-[0.22em] text-gold">Duration (days)</label>
                  <Input
                    type="number"
                    min={0.5}
                    step={0.5}
                    className="mt-1.5"
                    value={validateForm.durationDays}
                    onChange={(e) =>
                      setValidateForm((p) => ({ ...p, durationDays: Math.max(0.5, Number(e.target.value) || 1) }))
                    }
                  />
                </div>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setValidating(null)}>Cancel</Button>
            <Button onClick={validateRequest}>Schedule</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </AdminLayout>
  );
}
