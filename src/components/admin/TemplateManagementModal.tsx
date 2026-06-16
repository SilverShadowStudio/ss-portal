import { useEffect, useState, useCallback } from "react";
import { ChevronUp, ChevronDown, Pencil, ArchiveX, RotateCcw, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface Template {
  id: string;
  name: string;
  description: string | null;
  default_fields: DefaultFields;
  sort_order: number;
  archived_at: string | null;
}

interface DefaultFields {
  entity_type?: "individual" | "company";
  subject_line?: string;
  scope_description?: string;
  fee_currency?: string;
  fee_scope_description?: string;
  payment_milestone_1_pct?: number;
  payment_milestone_2_pct?: number;
  payment_milestone_3_pct?: number;
}

const EMPTY_FIELDS: DefaultFields = {
  entity_type: "individual",
  subject_line: "",
  scope_description: "",
  fee_currency: "GBP",
  fee_scope_description: "",
  payment_milestone_1_pct: 10,
  payment_milestone_2_pct: 40,
  payment_milestone_3_pct: 50,
};

interface FormState {
  name: string;
  description: string;
  fields: DefaultFields;
}

const EMPTY_FORM: FormState = {
  name: "",
  description: "",
  fields: { ...EMPTY_FIELDS },
};

async function callManage(action: string, params: Record<string, unknown> = {}) {
  const { data, error } = await supabase.functions.invoke("team-contract-templates-manage", {
    body: { action, ...params },
  });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return data;
}

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type View = "list" | "create" | "edit";

export function TemplateManagementModal({ open, onOpenChange }: Props) {
  const { toast } = useToast();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [view, setView] = useState<View>("list");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await callManage("list");
      setTemplates(data.templates ?? []);
    } catch (e) {
      toast({ title: "Failed to load templates", description: (e as Error).message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (open) { load(); setView("list"); }
  }, [open, load]);

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setEditingId(null);
    setView("create");
  };

  const openEdit = (t: Template) => {
    setForm({
      name: t.name,
      description: t.description ?? "",
      fields: { ...EMPTY_FIELDS, ...t.default_fields },
    });
    setEditingId(t.id);
    setView("edit");
  };

  const backToList = () => { setView("list"); setEditingId(null); };

  const handleSave = async () => {
    if (!form.name.trim()) { toast({ title: "Name is required", variant: "destructive" }); return; }
    setSaving(true);
    try {
      if (view === "create") {
        await callManage("create", {
          name: form.name.trim(),
          description: form.description.trim() || null,
          default_fields: form.fields,
        });
        toast({ title: "Template created" });
      } else {
        await callManage("update", {
          id: editingId,
          name: form.name.trim(),
          description: form.description.trim() || null,
          default_fields: form.fields,
        });
        toast({ title: "Template saved" });
      }
      await load();
      backToList();
    } catch (e) {
      toast({ title: "Save failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleArchive = async (id: string, name: string) => {
    try {
      await callManage("archive", { id });
      toast({ title: `"${name}" archived` });
      await load();
    } catch (e) {
      toast({ title: "Archive failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  const handleRestore = async (id: string, name: string) => {
    try {
      await callManage("restore", { id });
      toast({ title: `"${name}" restored` });
      await load();
    } catch (e) {
      toast({ title: "Restore failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  const handleReorder = async (id: string, direction: "up" | "down") => {
    try {
      await callManage("reorder", { id, direction });
      await load();
    } catch (e) {
      toast({ title: "Reorder failed", description: (e as Error).message, variant: "destructive" });
    }
  };

  const setField = (key: keyof DefaultFields, value: unknown) =>
    setForm((f) => ({ ...f, fields: { ...f.fields, [key]: value } }));

  const milestoneSum =
    (form.fields.payment_milestone_1_pct ?? 0) +
    (form.fields.payment_milestone_2_pct ?? 0) +
    (form.fields.payment_milestone_3_pct ?? 0);

  const active = templates.filter((t) => !t.archived_at);
  const archived = templates.filter((t) => t.archived_at);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-serif font-normal tracking-tight uppercase">
            {view === "list" ? "Contract Templates" : view === "create" ? "New Template" : "Edit Template"}
          </DialogTitle>
        </DialogHeader>

        {/* ── List view ─────────────────────────────────────────────────── */}
        {view === "list" && (
          <div className="space-y-1 pt-1">
            {loading && (
              <p className="text-xs text-muted-foreground py-4 text-center">Loading…</p>
            )}

            {!loading && active.length === 0 && archived.length === 0 && (
              <p className="text-xs text-muted-foreground py-4 text-center">No templates yet.</p>
            )}

            {active.map((t, idx) => (
              <div key={t.id} className="flex items-center gap-2 rounded-sm border border-transparent hover:border-input px-3 py-2.5 group">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-foreground truncate">{t.name}</p>
                  {t.description && (
                    <p className="text-xs text-muted-foreground truncate mt-0.5">{t.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    type="button"
                    onClick={() => handleReorder(t.id, "up")}
                    disabled={idx === 0}
                    className="p-1 rounded-sm text-muted-foreground hover:text-foreground disabled:opacity-20 disabled:cursor-not-allowed"
                    title="Move up"
                  >
                    <ChevronUp className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleReorder(t.id, "down")}
                    disabled={idx === active.length - 1}
                    className="p-1 rounded-sm text-muted-foreground hover:text-foreground disabled:opacity-20 disabled:cursor-not-allowed"
                    title="Move down"
                  >
                    <ChevronDown className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => openEdit(t)}
                    className="p-1 rounded-sm text-muted-foreground hover:text-foreground"
                    title="Edit"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleArchive(t.id, t.name)}
                    className="p-1 rounded-sm text-muted-foreground hover:text-destructive"
                    title="Archive"
                  >
                    <ArchiveX className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}

            <div className="pt-2">
              <Button variant="ghost" size="sm" className="gap-1.5 text-xs" onClick={openCreate}>
                <Plus className="h-3.5 w-3.5" />
                Add template
              </Button>
            </div>

            {archived.length > 0 && (
              <>
                <div className="pt-4 pb-1">
                  <p className="text-[9px] uppercase tracking-[0.28em] text-muted-foreground/50">Archived</p>
                </div>
                {archived.map((t) => (
                  <div key={t.id} className="flex items-center gap-2 px-3 py-2.5 opacity-40">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-foreground truncate">{t.name}</p>
                      {t.description && (
                        <p className="text-xs text-muted-foreground truncate mt-0.5">{t.description}</p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRestore(t.id, t.name)}
                      className="p-1 rounded-sm text-muted-foreground hover:text-foreground opacity-100"
                      title="Restore"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {/* ── Create / Edit form ─────────────────────────────────────────── */}
        {(view === "create" || view === "edit") && (
          <div className="space-y-5 pt-1">
            {/* Back */}
            <button
              type="button"
              onClick={backToList}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" />
              Cancel
            </button>

            {/* Name + description */}
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Template name</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. Scene Manager"
                  className="text-sm"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Description <span className="text-muted-foreground">(optional)</span></Label>
                <Input
                  value={form.description}
                  onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                  placeholder="Short admin-facing summary"
                  className="text-sm"
                />
              </div>
            </div>

            <div className="h-px bg-border" />

            {/* Default fields */}
            <p className="text-[9px] uppercase tracking-[0.28em] text-muted-foreground/50">Default field values</p>

            <div className="space-y-3">
              {/* Entity type */}
              <div className="space-y-1.5">
                <Label className="text-xs">Entity type</Label>
                <div className="flex gap-4">
                  {(["individual", "company"] as const).map((v) => (
                    <label key={v} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        checked={form.fields.entity_type === v}
                        onChange={() => setField("entity_type", v)}
                        className="accent-gold"
                      />
                      <span className="text-sm capitalize">{v}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Subject line */}
              <div className="space-y-1.5">
                <Label className="text-xs">Subject line</Label>
                <Input
                  value={form.fields.subject_line ?? ""}
                  onChange={(e) => setField("subject_line", e.target.value)}
                  placeholder="e.g. Scene Manager Engagement"
                  className="text-sm"
                />
              </div>

              {/* Scope description */}
              <div className="space-y-1.5">
                <Label className="text-xs">Scope description</Label>
                <Textarea
                  value={form.fields.scope_description ?? ""}
                  onChange={(e) => setField("scope_description", e.target.value)}
                  placeholder="Describe the scope of work…"
                  className="text-sm min-h-[80px] resize-none"
                />
              </div>

              {/* Fee currency + scope */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-xs">Currency</Label>
                  <Select
                    value={form.fields.fee_currency ?? "GBP"}
                    onValueChange={(v) => setField("fee_currency", v)}
                  >
                    <SelectTrigger className="text-sm">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="GBP">GBP</SelectItem>
                      <SelectItem value="EUR">EUR</SelectItem>
                      <SelectItem value="USD">USD</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Fee scope</Label>
                  <Input
                    value={form.fields.fee_scope_description ?? ""}
                    onChange={(e) => setField("fee_scope_description", e.target.value)}
                    placeholder="e.g. Per calendar month"
                    className="text-sm"
                  />
                </div>
              </div>

              {/* Milestones */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs">Payment milestones (%)</Label>
                  <span className={`text-xs ${milestoneSum !== 100 ? "text-destructive" : "text-muted-foreground"}`}>
                    {milestoneSum}/100
                  </span>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {([1, 2, 3] as const).map((n) => {
                    const key = `payment_milestone_${n}_pct` as keyof DefaultFields;
                    return (
                      <div key={n} className="space-y-1">
                        <p className="text-[10px] text-muted-foreground text-center">M{n}</p>
                        <Input
                          type="number"
                          min={0}
                          max={100}
                          value={form.fields[key] as number ?? 0}
                          onChange={(e) => setField(key, Math.max(0, Math.min(100, parseInt(e.target.value, 10) || 0)))}
                          className="text-sm text-center"
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={backToList} disabled={saving}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleSave} disabled={saving || milestoneSum !== 100}>
                {saving ? "Saving…" : "Save template"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
