import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Save } from "lucide-react";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { AdminLayout } from "@/components/AdminLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { ManualInviteModal } from "@/components/admin/ManualInviteModal";
import { useToast } from "@/hooks/use-toast";

interface EmailListRow {
  id: string;
  to: string[];
  from: string;
  subject: string;
  created_at: string;
  last_event: string | null;
}

interface EmailDetail {
  id: string;
  to: string[];
  from: string | null;
  subject: string;
  html: string | null;
  text: string | null;
  created_at: string | null;
  last_event: string | null;
  events: Array<{ name: string; occurred_at: string | null }>;
}

function formatEmailTimestamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const day = String(d.getDate()).padStart(2, "0");
  const month = d.toLocaleString("en-GB", { month: "short" });
  const year = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${day} ${month} ${year} ${hh}:${mm}`;
}

function eventToneClass(event: string | null | undefined): string {
  switch ((event || "").toLowerCase()) {
    case "delivered":
    case "opened":
    case "clicked":
      return "text-emerald-500/80";
    case "bounced":
    case "complained":
    case "failed":
      return "text-destructive";
    case "delivery_delayed":
      return "text-amber-500/80";
    default:
      return "text-muted-foreground";
  }
}

interface FormState {
  companyName: string;
  clientCode: string;
  accountType: string;
  bookingMode: string;
  country: string;
  registrationNumber: string;
  streetName: string;
  buildingNumber: string;
  city: string;
  postcode: string;
  firstName: string;
  lastName: string;
  position: string;
  email: string;
  password: string;
}

const EMPTY: FormState = {
  companyName: "",
  clientCode: "",
  accountType: "project",
  bookingMode: "calendar",
  country: "",
  registrationNumber: "",
  streetName: "",
  buildingNumber: "",
  city: "",
  postcode: "",
  firstName: "",
  lastName: "",
  position: "",
  email: "",
  password: "",
};

export default function AdminClientProfile() {
  const { accountId } = useParams<{ accountId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);
  const [loadedEmail, setLoadedEmail] = useState("");
  const [ownerUserId, setOwnerUserId] = useState<string | null>(null);
  const [hasSigned, setHasSigned] = useState<boolean | null>(null);
  const [resendLoading, setResendLoading] = useState(false);
  const [resendSent, setResendSent] = useState(false);
  const [manualInviteOpen, setManualInviteOpen] = useState(false);

  const [emailsLoading, setEmailsLoading] = useState(false);
  const [emails, setEmails] = useState<EmailListRow[]>([]);
  const [emailsWarning, setEmailsWarning] = useState<string | null>(null);
  const [selectedEmail, setSelectedEmail] = useState<EmailListRow | null>(null);
  const [emailDetail, setEmailDetail] = useState<EmailDetail | null>(null);
  const [emailDetailLoading, setEmailDetailLoading] = useState(false);
  const [emailDetailError, setEmailDetailError] = useState<string | null>(null);

  useEffect(() => {
    if (!accountId) return;
    let cancelled = false;
    (async () => {
      try {
        setEmailsLoading(true);
        setEmailsWarning(null);
        const { data, error } = await supabase.functions.invoke(
          "list-client-emails",
          { body: { account_id: accountId } },
        );
        if (cancelled) return;
        if (error) throw error;
        const list: EmailListRow[] = Array.isArray(data?.emails) ? data.emails : [];
        setEmails(list);
        if (data?.warning) setEmailsWarning(String(data.warning));
      } catch (err: any) {
        if (cancelled) return;
        setEmails([]);
        setEmailsWarning(err?.message || "Failed to load emails");
      } finally {
        if (!cancelled) setEmailsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [accountId]);

  async function openEmailPreview(row: EmailListRow) {
    setSelectedEmail(row);
    setEmailDetail(null);
    setEmailDetailError(null);
    setEmailDetailLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke(
        "get-client-email",
        { body: { email_id: row.id } },
      );
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setEmailDetail(data as EmailDetail);
    } catch (err: any) {
      setEmailDetailError(err?.message || "Failed to load email");
    } finally {
      setEmailDetailLoading(false);
    }
  }

  function closeEmailPreview(open: boolean) {
    if (open) return;
    setSelectedEmail(null);
    setEmailDetail(null);
    setEmailDetailError(null);
    setEmailDetailLoading(false);
  }

  useEffect(() => {
    if (!accountId) return;
    (async () => {
      try {
        setLoading(true);
        const { data: account, error: accErr } = await supabase
          .from("accounts")
          .select(
            "id, owner_user_id, company_name, client_code, account_type, booking_mode, country, registration_number, street_name, building_number, city, postcode",
          )
          .eq("id", accountId)
          .maybeSingle();
        if (accErr) throw accErr;
        if (!account) throw new Error("Account not found");

        setOwnerUserId(account.owner_user_id);

        const { data: agreementRow } = await supabase
          .from("agreements")
          .select("id")
          .eq("user_id", account.owner_user_id)
          .maybeSingle();
        setHasSigned(!!agreementRow);

        const { data: profile } = await supabase
          .from("profiles")
          .select("first_name, last_name, position, full_name")
          .eq("user_id", account.owner_user_id)
          .maybeSingle();

        // Owner email — not available via the JS client (auth admin API
        // requires service role). We surface it via the edge function on
        // demand instead. Leave blank to indicate "no change".
        let ownerEmail = "";
        try {
          const { data: emailRes } = await supabase.functions.invoke(
            "admin-get-client",
            { body: { accountId } },
          );
          if (emailRes?.email) ownerEmail = emailRes.email;
        } catch {
          // best-effort; field stays empty (placeholder shown instead)
        }

        setLoadedEmail(ownerEmail);
        setForm({
          companyName: account.company_name || "",
          clientCode: account.client_code || "",
          accountType: account.account_type || "project",
          bookingMode: account.booking_mode || "calendar",
          country: account.country || "",
          registrationNumber: account.registration_number || "",
          streetName: account.street_name || "",
          buildingNumber: account.building_number || "",
          city: account.city || "",
          postcode: account.postcode || "",
          firstName:
            profile?.first_name ||
            (profile?.full_name ? profile.full_name.split(" ")[0] : "") ||
            "",
          lastName:
            profile?.last_name ||
            (profile?.full_name
              ? profile.full_name.split(" ").slice(1).join(" ")
              : "") ||
            "",
          position: profile?.position || "",
          email: ownerEmail,
          password: "",
        });
      } catch (err: any) {
        console.error(err);
        toast({
          title: "Failed to load client",
          description: err?.message || "Unexpected error",
          variant: "destructive",
        });
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId]);

  const update = (key: keyof FormState, value: string) =>
    setForm((p) => ({ ...p, [key]: value }));

  const handleResend = async () => {
    if (!accountId || !form.email) return;
    setResendLoading(true);
    setResendSent(false);
    try {
      const { data, error } = await supabase.functions.invoke(
        "admin-create-client",
        {
          body: {
            mode: "resend",
            accountId,
            contact: {
              email: form.email.trim(),
              firstName: form.firstName || null,
              lastName: form.lastName || null,
            },
          },
        },
      );
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setResendSent(true);
    } catch (err: any) {
      console.error(err);
      toast({
        title: "Failed to resend invitation",
        description: err?.message || "Unexpected error",
        variant: "destructive",
      });
    } finally {
      setResendLoading(false);
    }
  };

  const handleSave = async () => {
    if (!accountId) return;
    if (!form.companyName.trim()) {
      toast({
        title: "Company name required",
        variant: "destructive",
      });
      return;
    }
    if (form.password && form.password.length < 8) {
      toast({
        title: "Password too short",
        description: "Minimum 8 characters.",
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      // Always persist account-level fields first, independently of the edge
      // function — so booking_mode / account_type are never blocked by an
      // unrelated contact-update failure.
      const { error: typeErr } = await supabase
        .from("accounts")
        .update({ account_type: form.accountType, booking_mode: form.bookingMode })
        .eq("id", accountId);
      if (typeErr) throw typeErr;

      // Only send email to the edge function when the admin explicitly changed
      // it — avoids triggering an unnecessary auth.updateUserById call that can
      // fail for non-standard email addresses (e.g. local part containing &).
      const emailChanged = form.email.trim() !== "" && form.email.trim() !== loadedEmail;

      const { data, error } = await supabase.functions.invoke(
        "admin-update-client",
        {
          body: {
            accountId,
            company: {
              companyName: form.companyName.trim(),
              clientCode: form.clientCode.trim() || null,
              country: form.country.trim() || null,
              registrationNumber: form.registrationNumber.trim() || null,
              streetName: form.streetName.trim() || null,
              buildingNumber: form.buildingNumber.trim() || null,
              city: form.city.trim() || null,
              postcode: form.postcode.trim() || null,
            },
            contact: {
              firstName: form.firstName.trim() || null,
              lastName: form.lastName.trim() || null,
              position: form.position.trim() || null,
              ...(emailChanged ? { email: form.email.trim() } : {}),
              ...(form.password ? { password: form.password } : {}),
            },
          },
        },
      );
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast({ title: "Client updated" });
      setForm((p) => ({ ...p, password: "" }));
    } catch (err: any) {
      console.error(err);
      toast({
        title: "Failed to update client",
        description: err?.message || "Unexpected error",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  return (
    <AdminLayout>
      <div className="mb-8 flex items-center justify-between">
        <button
          onClick={() => navigate("/admin/clients")}
          className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" /> Back to clients
        </button>
        <Button onClick={handleSave} disabled={saving || loading}>
          <Save className="mr-2 h-4 w-4" />
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>

      <h1 className="font-serif text-2xl tracking-wide text-foreground mb-2">
        Client profile
      </h1>
      <p className="text-sm text-muted-foreground mb-10">
        Edit company and account-owner details. Email and password changes apply
        to the owner's login.
      </p>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="space-y-10">
          <section>
            <h2 className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground mb-4">
              Company
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Company name" value={form.companyName} onChange={(v) => update("companyName", v)} />
              <Field label="CLIENT CODE" value={form.clientCode} onChange={(v) => update("clientCode", v)} />
              <SelectField
                label="Account type"
                value={form.accountType}
                onChange={(v) => update("accountType", v)}
                options={[
                  { value: "project", label: "Project" },
                  { value: "partnership", label: "Partnership" },
                ]}
              />
              <SelectField
                label="Booking mode"
                value={form.bookingMode}
                onChange={(v) => update("bookingMode", v)}
                options={[
                  { value: "calendar_no_quote", label: "Monday — 7 days" },
                  { value: "calendar", label: "Monday — 7 days (Quote)" },
                  { value: "delivery_no_quote", label: "Any day" },
                  { value: "delivery", label: "Any day (Quote)" },
                ]}
              />
              <Field label="Country" value={form.country} onChange={(v) => update("country", v)} />
              <Field label="Registration number" value={form.registrationNumber} onChange={(v) => update("registrationNumber", v)} />
              <Field label="City" value={form.city} onChange={(v) => update("city", v)} />
              <Field label="Street name" value={form.streetName} onChange={(v) => update("streetName", v)} />
              <Field label="Building number" value={form.buildingNumber} onChange={(v) => update("buildingNumber", v)} />
              <Field label="Postcode" value={form.postcode} onChange={(v) => update("postcode", v)} />
            </div>
          </section>

          <section>
            <h2 className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground mb-4">
              Account owner
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="First name" value={form.firstName} onChange={(v) => update("firstName", v)} />
              <Field label="Family name" value={form.lastName} onChange={(v) => update("lastName", v)} />
              <Field label="Position" value={form.position} onChange={(v) => update("position", v)} />
              <Field
                label="Email address"
                type="email"
                value={form.email}
                onChange={(v) => update("email", v)}
                placeholder={ownerUserId ? undefined : ""}
              />
            </div>

            {hasSigned === false && ownerUserId && (
              <div className="mt-5 flex flex-wrap items-center gap-x-7 gap-y-2">
                {resendSent ? (
                  <span
                    className="text-[11px] uppercase tracking-[0.15em]"
                    style={{ color: "var(--gold)", opacity: 0.45 }}
                  >
                    Invitation sent.
                  </span>
                ) : (
                  <button
                    onClick={handleResend}
                    disabled={resendLoading}
                    className="text-[11px] uppercase tracking-[0.15em] bg-transparent border-0 p-0 cursor-pointer hover:opacity-60 transition-opacity disabled:opacity-40"
                    style={{ color: "var(--gold)", textDecoration: "none" }}
                  >
                    {resendLoading ? "SENDING…" : "RESEND INVITATION →"}
                  </button>
                )}
                <button
                  onClick={() => setManualInviteOpen(true)}
                  className="text-[11px] uppercase tracking-[0.15em] bg-transparent border-0 p-0 cursor-pointer text-foreground/60 hover:text-foreground transition-colors"
                >
                  SEND MANUALLY →
                </button>
              </div>
            )}

            <div className="mt-4">
              <Field
                label="New password"
                type="password"
                value={form.password}
                onChange={(v) => update("password", v)}
                placeholder="Leave blank to keep current"
                autoComplete="new-password"
              />
            </div>
          </section>

          <section>
            <h2 className="text-xs font-medium uppercase tracking-[0.22em] text-muted-foreground mb-4">
              Emails
            </h2>

            {emailsLoading ? (
              <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                <BrandLoader size="sm" className="h-3.5 w-3.5" />
                Loading email history…
              </div>
            ) : emails.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 border-t border-border/30">
                {emailsWarning
                  ? `No emails sent to this account yet. (${emailsWarning})`
                  : "No emails sent to this account yet."}
              </p>
            ) : (
              <div>
                {emailsWarning && (
                  <p className="text-[11px] uppercase tracking-[0.15em] text-muted-foreground/70 mb-3">
                    {emailsWarning}
                  </p>
                )}
                {emails.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => openEmailPreview(row)}
                    className="w-full text-left flex items-center gap-5 py-3 border-t border-border/30 hover:bg-muted/15 transition-colors"
                  >
                    <span className="shrink-0 font-sans tabular-nums text-foreground/70" style={{ fontSize: 11, minWidth: 130 }}>
                      {formatEmailTimestamp(row.created_at)}
                    </span>
                    <span className="shrink-0 font-sans text-foreground/60 truncate" style={{ fontSize: 11, minWidth: 180, maxWidth: 220 }}>
                      {(row.to && row.to[0]) || "—"}
                    </span>
                    <span className="flex-1 font-serif text-foreground truncate" style={{ fontSize: 13 }}>
                      {row.subject || "(no subject)"}
                    </span>
                    <span
                      className={`shrink-0 font-sans uppercase ${eventToneClass(row.last_event)}`}
                      style={{ fontSize: 9, letterSpacing: "0.18em", minWidth: 70 }}
                    >
                      {row.last_event || "sent"}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      <Dialog open={!!selectedEmail} onOpenChange={closeEmailPreview}>
        <DialogContent className="max-w-4xl w-[95vw] max-h-[90vh] p-0 overflow-hidden">
          <DialogHeader className="px-6 py-4 border-b border-border/40">
            <DialogTitle className="font-serif text-base text-foreground truncate pr-8">
              {selectedEmail?.subject || "Email preview"}
            </DialogTitle>
            {selectedEmail && (
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 mt-2 text-[11px] text-muted-foreground">
                <span>
                  <span className="uppercase tracking-[0.18em] text-muted-foreground/60 mr-2">To</span>
                  {(emailDetail?.to ?? selectedEmail.to)?.join(", ") || "—"}
                </span>
                <span>
                  <span className="uppercase tracking-[0.18em] text-muted-foreground/60 mr-2">From</span>
                  {emailDetail?.from ?? selectedEmail.from ?? "—"}
                </span>
                <span>
                  <span className="uppercase tracking-[0.18em] text-muted-foreground/60 mr-2">Sent</span>
                  {formatEmailTimestamp(emailDetail?.created_at ?? selectedEmail.created_at)}
                </span>
                <span>
                  <span className="uppercase tracking-[0.18em] text-muted-foreground/60 mr-2">Status</span>
                  <span className={eventToneClass(emailDetail?.last_event ?? selectedEmail.last_event)}>
                    {emailDetail?.last_event ?? selectedEmail.last_event ?? "sent"}
                  </span>
                </span>
              </div>
            )}
            {emailDetail && emailDetail.events.length > 0 && (
              <div className="mt-2 text-[11px] text-muted-foreground">
                <span className="uppercase tracking-[0.18em] text-muted-foreground/60 mr-2">Events</span>
                {emailDetail.events.map((e, i) => (
                  <span key={i} className="mr-3">
                    {e.name}
                    {e.occurred_at ? ` · ${formatEmailTimestamp(e.occurred_at)}` : ""}
                  </span>
                ))}
              </div>
            )}
          </DialogHeader>

          <div className="bg-muted/30" style={{ height: "70vh" }}>
            {emailDetailLoading ? (
              <div className="flex items-center justify-center h-full text-sm text-muted-foreground gap-2">
                <BrandLoader size="sm" className="h-3.5 w-3.5" />
                Loading email…
              </div>
            ) : emailDetailError ? (
              <div className="flex items-center justify-center h-full text-sm text-destructive px-6">
                {emailDetailError}
              </div>
            ) : emailDetail?.html ? (
              <iframe
                title="Email preview"
                srcDoc={emailDetail.html}
                sandbox=""
                className="w-full h-full bg-white"
              />
            ) : (
              <div className="flex items-center justify-center h-full text-sm text-muted-foreground px-6">
                {emailDetail?.text || "No rendered HTML available for this email."}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <ManualInviteModal
        isOpen={manualInviteOpen}
        onClose={() => setManualInviteOpen(false)}
        accountId={accountId ?? null}
        clientLabel={
          [form.firstName.trim(), form.lastName.trim()].filter(Boolean).join(" ") ||
          form.companyName.trim() ||
          "client"
        }
      />
    </AdminLayout>
  );
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  autoComplete,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  autoComplete?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </Label>
      <Input
        type={type}
        value={value}
        placeholder={placeholder}
        autoComplete={autoComplete}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">
        {label}
      </Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}