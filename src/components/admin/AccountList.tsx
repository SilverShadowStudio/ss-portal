// Shared admin account list — used by AdminClients and AdminTeam.
// Renders the page header (gold eyebrow + serif H1 + subtitle), the Add
// dialog, search bar, and grouped account cards with per-user rows.
//
// The component fetches from the admin-list-account-users edge function
// using the accountTypes prop as the filter. It owns the Add dialog and
// switches between two variants:
//   - "client" (default): full client form with company + contact fields,
//     signature parser, client_code suggester, account_type selector.
//   - "team": email-only invite. Triggered when accountTypes === ["team"].
//
// Behavioural differences between Clients and Team are gated by props.
// Visual chrome (header layout, search, list cards, user rows) is identical.

import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Plus, Search, MoreHorizontal, Mail, Building2, Users2,
  Copy, Check, Trash2, Ghost, Pencil,
} from "lucide-react";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { supabase, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import {
  aggregateSessions,
  formatSessionDuration,
  type SessionSummary,
} from "@/lib/clientActivity";

interface AccountUserRow {
  account_id: string;
  company_name: string;
  account_type: string | null;
  account_created_at: string | null;
  client_code: string | null;
  user_id: string;
  email: string | null;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  position: string | null;
  member_role: string | null;
  joined_at: string | null;
  last_login_at: string | null;
}

interface AccountGroup {
  account_id: string;
  company_name: string;
  account_type: string | null;
  client_code: string | null;
  account_created_at: string | null;
  users: AccountUserRow[];
}

export interface AccountListProps {
  /** Page title — rendered uppercase via CSS (e.g. "Clients" → "CLIENTS"). */
  title: string;
  /** Gold eyebrow text above title (e.g. "Client Management"). */
  eyebrow: string;
  /** Sub-headline paragraph below the title. */
  subtitle: string;
  /** Filter accounts by these types. */
  accountTypes: Array<"partnership" | "project" | "team">;
  /** Label for the primary action button (e.g. "Add Client"). */
  addButtonLabel: string;
  /** Show the 3-letter client_code pill on each account header. */
  showClientCode?: boolean;
  /** Show the account type pill (PROJECT / PARTNERSHIP / TEAM). */
  showAccountType?: boolean;
  /** Click on the account header navigates to /admin/projects?client=<id>. Clients-only. */
  headerNavigatesToProjects?: boolean;
  /** Which per-account dropdown items are available. If neither flag is true,
   *  the dropdown trigger is omitted entirely. */
  accountActions?: {
    editProfile?: boolean;
    delete?: boolean;
  };
}

// TEMPORARY: Silver Shadow Studio is the studio's own account, currently
// misclassified as `partnership`. Hidden from the Clients UI pending the
// proper architectural fix — see HANDOFF.md "Studio account architectural
// cleanup" for the planned approach (delete the account row entirely, move
// studio info to app_settings.studio_profile, add Studio Information section
// to admin Settings).
const SILVER_SHADOW_ACCOUNT_ID = "a09b2cdd-2c98-4415-a58d-ec6420d69bd6";

function timeAgo(iso: string) {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function fullNameOf(u: AccountUserRow): string {
  return (
    u.full_name ||
    [u.first_name, u.last_name].filter(Boolean).join(" ") ||
    u.email ||
    "Unnamed user"
  );
}

// Derive 3-letter client-code suggestions from the company name.
function suggestClientCodes(name: string): string[] {
  const clean = name.toUpperCase().replace(/[^A-Z\s]/g, "");
  const words = clean.split(/\s+/).filter(Boolean);
  const noSpaces = clean.replace(/\s+/g, "");
  const codes = new Set<string>();
  if (words.length >= 3) codes.add(words.slice(0, 3).map((w) => w[0]).join(""));
  if (words.length >= 2) {
    codes.add(words.slice(0, 2).map((w) => w[0]).join("") + (words[0][1] ?? "X"));
    if (words[0].length >= 2) codes.add(words[0].slice(0, 2) + words[1][0]);
    codes.add(words[0][0] + words[1].slice(0, 2));
  }
  if (noSpaces.length >= 3) {
    codes.add(noSpaces.slice(0, 3));
    if (noSpaces.length >= 4) codes.add(noSpaces.slice(0, 2) + noSpaces[3]);
  }
  for (const word of words) {
    if (word.length >= 3) codes.add(word.slice(0, 3));
  }
  return [...codes].filter((c) => c.length === 3).slice(0, 8);
}

export function AccountList({
  title,
  eyebrow,
  subtitle,
  accountTypes,
  addButtonLabel,
  showClientCode = false,
  showAccountType = false,
  headerNavigatesToProjects = false,
  accountActions,
}: AccountListProps) {
  const showEditProfile = !!accountActions?.editProfile;
  const showDelete = !!accountActions?.delete;
  const showDropdown = showEditProfile || showDelete;
  // The Clients page filters partnership/project; in that mode hide the
  // studio's own (mis-classified) account from the list.
  const filterStudioAccount =
    accountTypes.includes("partnership") || accountTypes.includes("project");
  const navigate = useNavigate();
  const { enterGhostMode } = useAuth();
  const { toast } = useToast();

  // Team-only pages get a simple email-only invite dialog. Everywhere else
  // gets the full client form.
  const isTeamOnly = accountTypes.length === 1 && accountTypes[0] === "team";
  // Where to send the admin after entering ghost mode — team users live in
  // /documents, partnership/project clients land on the dashboard.
  const postGhostPath = isTeamOnly ? "/documents" : "/";

  const [accountUsers, setAccountUsers] = useState<AccountUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  // Per-user reconstructed login sessions (newest first) for the
  // last-connection summary + expandable history. Computed at render time.
  const [sessionsByUser, setSessionsByUser] = useState<Map<string, SessionSummary[]>>(new Map());
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [resultBanner, setResultBanner] = useState<{ email: string; inviteUrl?: string } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // Full client form state — unused fields are simply ignored when isTeamOnly.
  const initialForm = {
    companyName: "",
    clientCode: "",
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
    accountType: "project",
  };
  const [form, setForm] = useState(initialForm);
  const [isCreating, setIsCreating] = useState(false);
  const [signature, setSignature] = useState("");
  const [isParsing, setIsParsing] = useState(false);
  const [parsedConfirm, setParsedConfirm] = useState(false);

  // Team-only simple invite state.
  const [inviteEmail, setInviteEmail] = useState("");

  // Airtable pre-flight match panel. Populated by a debounced lookup on
  // the company-name input — surfaces existing Clients rows so the admin
  // can link rather than create a duplicate (see commit c469277 for the
  // stored-id sync that the link relies on).
  type AirtableMatch = {
    record_id: string;
    company_name: string;
    address: string | null;
    client_representative: string | null;
    has_projects: number;
  };
  const [airtableMatches, setAirtableMatches] = useState<AirtableMatch[]>([]);
  const [matchesLoading, setMatchesLoading] = useState(false);
  const [linkedAirtableId, setLinkedAirtableId] = useState<string | null>(null);

  useEffect(() => { fetchAccounts(); }, [accountTypes.join(",")]);

  // Debounced Airtable match lookup. Only fires when the dialog is open,
  // we're not in team-only mode, and the trimmed company name has at
  // least 3 characters. The chosen-link state is cleared whenever the
  // input changes, so a previously-linked record never silently sticks
  // to a new search.
  useEffect(() => {
    const trimmed = form.companyName.trim();
    if (!isAddDialogOpen || isTeamOnly || trimmed.length < 3) {
      setAirtableMatches([]);
      setMatchesLoading(false);
      return;
    }
    setLinkedAirtableId(null);
    let cancelled = false;
    setMatchesLoading(true);
    const timer = setTimeout(async () => {
      try {
        const { data, error } = await supabase.functions.invoke(
          "airtable-find-matching-clients",
          { body: { company_name: trimmed } },
        );
        if (cancelled) return;
        if (error) {
          setAirtableMatches([]);
        } else {
          setAirtableMatches((data?.matches ?? []) as AirtableMatch[]);
        }
      } catch {
        if (!cancelled) setAirtableMatches([]);
      } finally {
        if (!cancelled) setMatchesLoading(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [form.companyName, isAddDialogOpen, isTeamOnly]);

  async function fetchAccounts() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("No session");
      const res = await fetch(
        `${SUPABASE_URL}/functions/v1/admin-list-account-users?accountTypes=${accountTypes.join(",")}`,
        {
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            apikey: SUPABASE_PUBLISHABLE_KEY,
          },
        },
      );
      if (!res.ok) throw new Error(`admin-list-account-users returned ${res.status}`);
      const body = await res.json();
      setAccountUsers((body.rows ?? []) as AccountUserRow[]);
    } catch (error) {
      console.error("Failed to load accounts:", error);
      toast({
        title: "Error",
        description: "Failed to load accounts",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  // Fetch + reconstruct recent sessions per user once the user list loads.
  // Admins can read client_activity directly (same as /admin/client-activity).
  useEffect(() => {
    const userIds = Array.from(new Set(accountUsers.map((u) => u.user_id)));
    if (userIds.length === 0) {
      setSessionsByUser(new Map());
      return;
    }
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("client_activity")
        .select("user_id, kind, session_id, started_at, ended_at, duration_ms")
        .in("user_id", userIds)
        .order("started_at", { ascending: false })
        .limit(8000);
      if (cancelled) return;
      const byUser = new Map<string, SessionSummary[]>();
      for (const s of aggregateSessions((data ?? []) as never)) {
        const arr = byUser.get(s.userId) ?? [];
        arr.push(s);
        byUser.set(s.userId, arr);
      }
      setSessionsByUser(byUser);
    })();
    return () => {
      cancelled = true;
    };
  }, [accountUsers]);

  const accountGroups = useMemo<AccountGroup[]>(() => {
    const byId = new Map<string, AccountGroup>();
    for (const u of accountUsers) {
      if (filterStudioAccount && u.account_id === SILVER_SHADOW_ACCOUNT_ID) continue;
      let g = byId.get(u.account_id);
      if (!g) {
        g = {
          account_id: u.account_id,
          company_name: u.company_name,
          account_type: u.account_type,
          client_code: u.client_code,
          account_created_at: u.account_created_at,
          users: [],
        };
        byId.set(u.account_id, g);
      }
      g.users.push(u);
    }
    for (const g of byId.values()) {
      g.users.sort((a, b) => {
        if (a.member_role === "owner" && b.member_role !== "owner") return -1;
        if (b.member_role === "owner" && a.member_role !== "owner") return 1;
        return (a.joined_at ?? "").localeCompare(b.joined_at ?? "");
      });
    }
    return Array.from(byId.values()).sort((a, b) =>
      a.company_name.localeCompare(b.company_name),
    );
  }, [accountUsers]);

  const filteredGroups = useMemo<AccountGroup[]>(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return accountGroups;
    return accountGroups
      .map((g) => {
        const matchesCompany = g.company_name.toLowerCase().includes(q);
        const matchingUsers = g.users.filter(
          (u) =>
            (u.full_name ?? "").toLowerCase().includes(q) ||
            (u.email ?? "").toLowerCase().includes(q) ||
            (u.first_name ?? "").toLowerCase().includes(q) ||
            (u.last_name ?? "").toLowerCase().includes(q),
        );
        if (matchesCompany) return g;
        if (matchingUsers.length === 0) return null;
        return { ...g, users: matchingUsers };
      })
      .filter((g): g is AccountGroup => g !== null);
  }, [accountGroups, searchQuery]);

  const updateForm = (key: keyof typeof initialForm, value: string) =>
    setForm((p) => ({ ...p, [key]: value }));

  const resetForm = () => {
    setForm(initialForm);
    setSignature("");
    setParsedConfirm(false);
    setAirtableMatches([]);
    setMatchesLoading(false);
    setLinkedAirtableId(null);
  };

  const handleParseSignature = async () => {
    if (!signature.trim()) return;
    setIsParsing(true);
    setParsedConfirm(false);
    try {
      const { data, error } = await supabase.functions.invoke("parse-signature", {
        body: { signature: signature.trim() },
      });
      if (error) throw error;
      if (!data?.data) throw new Error("No data returned");
      const p = data.data;
      const fill = (cur: string, val: unknown) =>
        cur.trim() ? cur : typeof val === "string" && val ? val : cur;
      setForm((prev) => ({
        ...prev,
        firstName:          fill(prev.firstName,          p.first_name),
        lastName:           fill(prev.lastName,           p.last_name),
        position:           fill(prev.position,           p.position),
        companyName:        fill(prev.companyName,        p.company_name),
        email:              fill(prev.email,              p.email),
        country:            fill(prev.country,            p.country),
        city:               fill(prev.city,               p.city),
        registrationNumber: fill(prev.registrationNumber, p.registration_number),
        streetName:         fill(prev.streetName,         p.street),
        buildingNumber:     fill(prev.buildingNumber,     p.building_number),
        postcode:           fill(prev.postcode,           p.postcode),
      }));
      setParsedConfirm(true);
    } catch (err: any) {
      toast({
        title: "Failed to parse signature",
        description: err?.message || "Unexpected error",
        variant: "destructive",
      });
    } finally {
      setIsParsing(false);
    }
  };

  const handleCopy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    } catch { /* ignore */ }
  };

  // Submit handler — dispatches to the right invite shape based on isTeamOnly.
  async function handleSubmit() {
    if (isTeamOnly) {
      const email = inviteEmail.trim().toLowerCase();
      if (!email) {
        toast({ title: "Please enter an email address", variant: "destructive" });
        return;
      }
      setIsCreating(true);
      try {
        const ok = await postInvite({
          mode: "invite",
          company: { companyName: email },
          contact: { email },
          accountType: "team",
        });
        if (ok) {
          setInviteEmail("");
          setResultBanner({ email });
          setIsAddDialogOpen(false);
          fetchAccounts();
        }
      } finally {
        setIsCreating(false);
      }
      return;
    }

    // Client variant
    const required: Array<[keyof typeof form, string]> = [
      ["companyName", "Company name"],
      ["email", "Contact email"],
    ];
    for (const [k, label] of required) {
      if (!form[k].trim()) {
        toast({
          title: "Missing field",
          description: `${label} is required.`,
          variant: "destructive",
        });
        return;
      }
    }
    setIsCreating(true);
    try {
      const wasLinkedToExisting = !!linkedAirtableId;
      const ok = await postInvite({
        mode: "invite",
        company: {
          companyName: form.companyName.trim(),
          country: form.country.trim() || null,
          registrationNumber: form.registrationNumber.trim() || null,
          streetName: form.streetName.trim() || null,
          buildingNumber: form.buildingNumber.trim() || null,
          city: form.city.trim() || null,
          postcode: form.postcode.trim() || null,
        },
        contact: {
          email: form.email.trim(),
          firstName: form.firstName.trim() || null,
          lastName: form.lastName.trim() || null,
          position: form.position.trim() || null,
        },
        accountType: form.accountType,
        clientCode: form.clientCode.trim() || null,
        airtableClientId: linkedAirtableId,
      }, form.email.trim());
      if (ok) {
        const clientLabel =
          [form.firstName.trim(), form.lastName.trim()].filter(Boolean).join(" ") ||
          form.companyName.trim();
        const { logActivity } = await import("@/lib/activityLog");
        await logActivity({
          action: "client_created",
          description: `Added client ${clientLabel}`,
          actorRole: "admin",
        });
        toast({
          title: wasLinkedToExisting
            ? "Created and linked to existing Airtable record"
            : "Created (new Airtable record)",
          description: clientLabel,
        });
        resetForm();
        setIsAddDialogOpen(false);
        fetchAccounts();
      }
    } finally {
      setIsCreating(false);
    }
  }

  // Shared POST → admin-create-client. Returns true on success, handles
  // the structured 409 codes (ALREADY_REGISTERED, WRONG_CATEGORY) inline.
  async function postInvite(payload: Record<string, unknown>, emailForBanner?: string): Promise<boolean> {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("No session");
      const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-create-client`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          apikey: SUPABASE_PUBLISHABLE_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({} as any));
      if (!res.ok) {
        if (data?.code === "ALREADY_REGISTERED") {
          toast({
            title: "User already registered",
            description: (
              <div className="space-y-1.5">
                <p>{data.message}</p>
                <p className="opacity-60">They can recover access via the Forgot password link on the login screen.</p>
              </div>
            ),
            variant: "destructive",
          });
          return false;
        }
        if (data?.code === "WRONG_CATEGORY") {
          toast({
            title: "Wrong category",
            description: data.message,
            variant: "destructive",
          });
          return false;
        }
        throw new Error(data?.error || `Request failed (${res.status})`);
      }
      const bannerEmail = emailForBanner ?? (payload as any)?.contact?.email ?? "";
      if (bannerEmail) {
        setResultBanner({ email: bannerEmail, inviteUrl: data?.inviteUrl });
      }
      toast({
        title: "Account created — invitation sent",
        description: `An invitation email has been queued for ${bannerEmail}.`,
      });
      return true;
    } catch (err: any) {
      console.error("Invite failed:", err);
      toast({
        title: "Failed to send invite",
        description: err?.message || "Unexpected error",
        variant: "destructive",
      });
      return false;
    }
  }

  const handleDeleteAccount = async (
    accountId: string,
    companyName: string,
    memberCount: number,
  ) => {
    const confirmed = window.confirm(
      `Permanently delete "${companyName}"?\n\n` +
      `This will also remove member link(s) (${memberCount}) tied to this account. ` +
      `This action cannot be undone.`,
    );
    if (!confirmed) return;
    try {
      // Routes through admin-delete-account so auth.users entries cascade
      // for members whose only membership was this account. The inline
      // accounts.delete() used to leave orphan auth rows behind; the
      // 2026-05-19 phantom-login incident traced back to that gap.
      const { data, error } = await supabase.functions.invoke("admin-delete-account", {
        body: { account_id: accountId },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message || "Delete failed");
      toast({ title: "Account deleted", description: companyName });
      fetchAccounts();
    } catch (e: any) {
      toast({
        title: "Could not delete account",
        description: e?.message || "Unknown error",
        variant: "destructive",
      });
    }
  };

  return (
    <>
      {/* Header */}
      <div className="mb-10 flex items-end justify-between animate-fade-in">
        <div>
          <div className="mb-4 flex items-center gap-3">
            <div className="h-px w-12 bg-gold-muted" />
            <span className="text-label-gold">{eyebrow}</span>
          </div>
          <h1 className="font-serif text-4xl font-normal tracking-tight text-foreground md:text-5xl mb-4 uppercase">
            {title}
          </h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <Dialog
          open={isAddDialogOpen}
          onOpenChange={(open) => {
            setIsAddDialogOpen(open);
            if (!open) {
              resetForm();
              setInviteEmail("");
            }
          }}
        >
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              {addButtonLabel}
            </Button>
          </DialogTrigger>
          <DialogContent
            className={
              isTeamOnly
                ? "sm:max-w-md"
                : "max-h-[85vh] overflow-y-auto sm:max-w-2xl"
            }
          >
            {isTeamOnly ? (
              <>
                <DialogHeader>
                  <DialogTitle>Add team member</DialogTitle>
                </DialogHeader>
                <p className="text-xs text-muted-foreground mt-1">
                  They'll enter their name and details during onboarding.
                </p>
                <div className="space-y-4 pt-2">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Email *</label>
                    <Input
                      type="email"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                      autoFocus
                      placeholder="contact@company.com"
                    />
                  </div>
                  <Button
                    onClick={handleSubmit}
                    disabled={isCreating}
                    className="w-full"
                  >
                    {isCreating ? "Sending…" : "Send invite"}
                  </Button>
                </div>
              </>
            ) : (
              <>
                <DialogHeader>
                  <DialogTitle>Add a new client</DialogTitle>
                </DialogHeader>
                <div className="space-y-6 pt-2">
                  <p className="text-xs text-muted-foreground">
                    We'll create the account with the company details below and email the contact a link to set their own password.
                  </p>

                  {/* Signature parser */}
                  <div className="space-y-2">
                    <div className="text-label text-muted-foreground">PASTE EMAIL SIGNATURE</div>
                    <textarea
                      value={signature}
                      onChange={(e) => { setSignature(e.target.value); setParsedConfirm(false); }}
                      placeholder="Paste a contact's email signature here to auto-populate the fields below."
                      rows={4}
                      className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
                    />
                    <div className="flex items-center gap-3">
                      <button
                        type="button"
                        onClick={handleParseSignature}
                        disabled={isParsing || !signature.trim()}
                        className="text-[11px] uppercase tracking-[0.15em] font-medium border border-input bg-background px-3 py-1.5 rounded-sm hover:bg-muted transition-colors disabled:opacity-40"
                      >
                        {isParsing ? "Parsing…" : "Parse Signature"}
                      </button>
                      {parsedConfirm && (
                        <span className="text-[11px] text-muted-foreground" style={{ opacity: 0.45 }}>
                          Fields populated from signature
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Company section */}
                  <div className="space-y-3">
                    <div className="text-label text-muted-foreground">COMPANY</div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="sm:col-span-2 space-y-1">
                        <label className="text-xs text-muted-foreground">Company name *</label>
                        <Input
                          value={form.companyName}
                          onChange={(e) => updateForm("companyName", e.target.value)}
                          placeholder="Maybourne Hotels"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Account type</label>
                        <select
                          value={form.accountType}
                          onChange={(e) => updateForm("accountType", e.target.value)}
                          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        >
                          <option value="project">Project</option>
                          <option value="partnership">Partnership</option>
                        </select>
                      </div>
                      <div className="sm:col-span-2 space-y-2">
                        <label className="text-xs text-muted-foreground">Client code (3 letters, used for quotation numbers)</label>
                        <Input
                          value={form.clientCode}
                          onChange={(e) => updateForm("clientCode", e.target.value.toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3))}
                          placeholder="e.g. WIN"
                          maxLength={3}
                          className="w-24 font-mono uppercase"
                        />
                        {form.companyName.trim().length >= 2 && (
                          <div className="flex flex-wrap gap-1.5 pt-0.5">
                            {suggestClientCodes(form.companyName).map((code) => (
                              <button
                                key={code}
                                type="button"
                                onClick={() => updateForm("clientCode", code)}
                                className={`px-2.5 py-1 rounded-sm text-[11px] font-mono uppercase tracking-widest border transition-colors ${
                                  form.clientCode === code
                                    ? "border-gold/60 text-gold bg-gold/5"
                                    : "border-border text-muted-foreground hover:border-border/80 hover:text-foreground"
                                }`}
                              >
                                {code}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Country</label>
                        <Input value={form.country} onChange={(e) => updateForm("country", e.target.value)} placeholder="United Kingdom" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Registration number</label>
                        <Input value={form.registrationNumber} onChange={(e) => updateForm("registrationNumber", e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Street name</label>
                        <Input value={form.streetName} onChange={(e) => updateForm("streetName", e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Building number</label>
                        <Input value={form.buildingNumber} onChange={(e) => updateForm("buildingNumber", e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">City</label>
                        <Input value={form.city} onChange={(e) => updateForm("city", e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Postcode</label>
                        <Input value={form.postcode} onChange={(e) => updateForm("postcode", e.target.value)} />
                      </div>
                    </div>
                  </div>

                  {/* Contact section */}
                  <div className="space-y-3">
                    <div className="text-label text-muted-foreground">CONTACT PERSON</div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">First name</label>
                        <Input value={form.firstName} onChange={(e) => updateForm("firstName", e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Last name</label>
                        <Input value={form.lastName} onChange={(e) => updateForm("lastName", e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Position</label>
                        <Input value={form.position} onChange={(e) => updateForm("position", e.target.value)} />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Email *</label>
                        <Input
                          type="email"
                          value={form.email}
                          onChange={(e) => updateForm("email", e.target.value)}
                          placeholder="contact@company.com"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Airtable pre-flight match panel — surfaces existing Clients
                      rows so admins can link rather than duplicate. Non-blocking:
                      submission proceeds regardless. */}
                  {(matchesLoading || airtableMatches.length > 0) && (
                    <div className="border border-border rounded-sm bg-muted/30 px-4 py-3 space-y-3">
                      <div className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                        {matchesLoading ? "Checking Airtable…" : "Possible matches in Airtable"}
                      </div>
                      {!matchesLoading && airtableMatches.map((m) => {
                        const isLinked = linkedAirtableId === m.record_id;
                        const projectLabel =
                          m.has_projects > 0
                            ? `${m.has_projects} project${m.has_projects === 1 ? "" : "s"}`
                            : "no projects";
                        const parts = [m.address, m.client_representative, projectLabel]
                          .filter((v): v is string => !!v);
                        return (
                          <div
                            key={m.record_id}
                            className={`flex items-start justify-between gap-3 py-1.5 ${
                              isLinked ? "" : "border-b border-border/50 last:border-b-0"
                            }`}
                          >
                            <div className="min-w-0 flex-1">
                              <div className="text-xs font-medium text-foreground">{m.company_name}</div>
                              <div className="text-[11px] text-muted-foreground mt-0.5 break-words">
                                {parts.join(" — ")}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                setLinkedAirtableId(isLinked ? null : m.record_id)
                              }
                              className={`shrink-0 text-[10px] uppercase tracking-[0.18em] font-medium px-2.5 py-1 rounded-sm border transition-colors ${
                                isLinked
                                  ? "border-gold/70 text-gold bg-gold/10"
                                  : "border-border text-muted-foreground hover:border-gold/50 hover:text-gold"
                              }`}
                            >
                              {isLinked ? "Linked ✓" : "Link to this"}
                            </button>
                          </div>
                        );
                      })}
                      {!matchesLoading && (
                        <button
                          type="button"
                          onClick={() => setLinkedAirtableId(null)}
                          className={`text-[10px] uppercase tracking-[0.18em] font-medium transition-colors ${
                            linkedAirtableId
                              ? "text-muted-foreground hover:text-foreground"
                              : "text-foreground/45 cursor-default"
                          }`}
                          disabled={!linkedAirtableId}
                        >
                          {linkedAirtableId ? "Create new anyway" : "No link selected — will create new"}
                        </button>
                      )}
                    </div>
                  )}

                  <Button className="w-full" onClick={handleSubmit} disabled={isCreating}>
                    {isCreating ? "Working…" : "Create account & send invite"}
                  </Button>
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>
      </div>

      {/* Search */}
      <div className="mb-8 animate-fade-in" style={{ animationDelay: "0.1s" }}>
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={`Search ${title.toLowerCase()}...`}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {/* List */}
      <div className="animate-fade-in" style={{ animationDelay: "0.15s" }}>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <BrandLoader size="md" />
          </div>
        ) : filteredGroups.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-12 text-center">
            <p className="text-muted-foreground">
              {searchQuery ? `No ${title.toLowerCase()} match your search` : `No ${title.toLowerCase()} yet`}
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {filteredGroups.map((group) => {
              const headerClickable = headerNavigatesToProjects;
              const HeaderIcon = isTeamOnly ? Users2 : Building2;
              return (
                <div key={group.account_id} className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
                  {/* Account header */}
                  <div
                    onClick={headerClickable ? () => navigate(`/admin/projects?client=${group.account_id}`) : undefined}
                    className={
                      "flex items-center justify-between px-5 py-4 bg-muted/10 border-b border-border/40 transition-colors " +
                      (headerClickable ? "cursor-pointer hover:bg-muted/20" : "")
                    }
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <HeaderIcon className="h-3.5 w-3.5 text-gold shrink-0" />
                      <h3 className="font-serif text-sm uppercase tracking-wide text-foreground truncate">
                        {group.company_name}
                      </h3>
                      {showClientCode && group.client_code && (
                        <span
                          className="font-sans uppercase text-foreground/45"
                          style={{ fontSize: 9, letterSpacing: "0.24em" }}
                        >
                          {group.client_code}
                        </span>
                      )}
                      {showAccountType && (
                        <span
                          className="font-sans uppercase text-foreground/35"
                          style={{ fontSize: 9, letterSpacing: "0.22em" }}
                        >
                          {group.account_type ?? ""}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                      <span className="text-xs text-muted-foreground">
                        {group.users.length} {isTeamOnly ? "member" : "user"}{group.users.length === 1 ? "" : "s"}
                      </span>
                      {showDropdown && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <button
                              onClick={(e) => e.stopPropagation()}
                              className="flex h-8 w-8 items-center justify-center rounded hover:bg-secondary"
                            >
                              <MoreHorizontal className="h-4 w-4 text-muted-foreground" />
                            </button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
                            {showEditProfile && (
                              <DropdownMenuItem onClick={() => navigate(`/admin/clients/${group.account_id}`)}>
                                <Pencil className="mr-2 h-4 w-4" /> Edit profile
                              </DropdownMenuItem>
                            )}
                            {showDelete && (
                              <DropdownMenuItem
                                className="text-destructive focus:text-destructive"
                                onClick={() =>
                                  handleDeleteAccount(group.account_id, group.company_name, group.users.length)
                                }
                              >
                                <Trash2 className="mr-2 h-4 w-4" /> Delete
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </div>

                  {/* User rows */}
                  <div className="divide-y divide-border/30">
                    {group.users.map((u) => {
                      const displayName = fullNameOf(u);
                      const userSessions = sessionsByUser.get(u.user_id) ?? [];
                      const lastSession = userSessions[0];
                      const hasSessions = userSessions.length > 0;
                      const isExpanded = expandedUserId === u.user_id;
                      return (
                        <div key={u.user_id}>
                        <div
                          className="flex items-center gap-4 px-5 py-3.5 hover:bg-muted/15 transition-colors"
                        >
                          <TooltipProvider delayDuration={150}>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <button
                                  onClick={async () => {
                                    const { error } = await enterGhostMode({
                                      userId: u.user_id,
                                      name: displayName,
                                    });
                                    if (error) {
                                      toast({ title: "Ghost Mode failed", description: error.message, variant: "destructive" });
                                      return;
                                    }
                                    navigate(postGhostPath);
                                  }}
                                  className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary hover:bg-[#1C1A17] border border-transparent hover:border-gold/40 transition-all shrink-0 opacity-25 hover:opacity-70"
                                  aria-label={`Ghost as ${displayName}`}
                                >
                                  <Ghost className="h-3.5 w-3.5 text-gold/60" strokeWidth={1.5} />
                                </button>
                              </TooltipTrigger>
                              <TooltipContent side="right">View as {displayName}</TooltipContent>
                            </Tooltip>
                          </TooltipProvider>

                          <div className="min-w-0 flex-1">
                            <p className="font-sans text-sm text-foreground truncate">{displayName}</p>
                            {(u.position || u.member_role) && (
                              <p
                                className="font-sans uppercase text-foreground/40 mt-0.5"
                                style={{ fontSize: 9, letterSpacing: "0.18em" }}
                              >
                                {u.position ?? u.member_role}
                              </p>
                            )}
                          </div>

                          <div className="hidden md:flex items-center gap-2 min-w-0 max-w-[240px]">
                            <Mail className="h-3 w-3 text-foreground/30 shrink-0" />
                            <span className="text-xs text-muted-foreground truncate">{u.email ?? "—"}</span>
                          </div>

                          <div className="text-right shrink-0 min-w-[120px]">
                            {!u.last_login_at ? (
                              <p
                                className="font-sans uppercase text-foreground/30"
                                style={{ fontSize: 9, letterSpacing: "0.18em" }}
                              >
                                Never signed in
                              </p>
                            ) : hasSessions ? (
                              <button
                                type="button"
                                onClick={() => setExpandedUserId(isExpanded ? null : u.user_id)}
                                className="group/ls text-right"
                                aria-expanded={isExpanded}
                              >
                                <p className="text-xs text-foreground/65">
                                  {timeAgo(u.last_login_at)}
                                  {lastSession ? ` · ${formatSessionDuration(lastSession.durationMs)} session` : ""}
                                </p>
                                <p
                                  className="font-sans uppercase text-foreground/30 mt-0.5 group-hover/ls:text-foreground/55 transition-colors"
                                  style={{ fontSize: 9, letterSpacing: "0.18em" }}
                                >
                                  Last seen · {isExpanded ? "Hide" : "History"}
                                </p>
                              </button>
                            ) : (
                              <>
                                <p className="text-xs text-foreground/65">{timeAgo(u.last_login_at)}</p>
                                <p
                                  className="font-sans uppercase text-foreground/30 mt-0.5"
                                  style={{ fontSize: 9, letterSpacing: "0.18em" }}
                                >
                                  Last seen
                                </p>
                              </>
                            )}
                          </div>
                        </div>
                        {isExpanded && hasSessions && (
                          <div className="px-5 pb-4 pt-1 bg-muted/10 border-t border-border/20">
                            <p
                              className="font-sans uppercase text-foreground/35 mb-2"
                              style={{ fontSize: 9, letterSpacing: "0.2em" }}
                            >
                              Recent sessions
                            </p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-10 gap-y-1">
                              {userSessions.slice(0, 10).map((s) => (
                                <div
                                  key={s.sessionId}
                                  className="flex items-center justify-between gap-3 py-0.5"
                                >
                                  <span
                                    className="font-sans uppercase text-foreground/55"
                                    style={{ fontSize: 10, letterSpacing: "0.12em" }}
                                  >
                                    {new Date(s.start).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                                    {" · "}
                                    {new Date(s.start).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                                  </span>
                                  <span
                                    className="font-sans uppercase text-foreground/35 tabular-nums"
                                    style={{ fontSize: 10, letterSpacing: "0.12em" }}
                                  >
                                    {formatSessionDuration(s.durationMs)}
                                    {s.pageViews ? ` · ${s.pageViews} page${s.pageViews === 1 ? "" : "s"}` : ""}
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Invitation success overlay */}
      {resultBanner && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50"
          onClick={() => setResultBanner(null)}
        >
          <div
            className="w-full max-w-sm mx-4 border border-gold/30 bg-[#181613] p-8 space-y-5"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-label-gold">Invitation sent</p>
            <p className="text-sm text-foreground/70 leading-relaxed">
              An email is on its way to {resultBanner.email}.
            </p>
            {resultBanner.inviteUrl && (
              <div className="flex items-center gap-2 border border-border/50 bg-background px-3 py-2">
                <span className="text-xs text-muted-foreground truncate flex-1">
                  {resultBanner.inviteUrl}
                </span>
                <button
                  type="button"
                  onClick={() => handleCopy("invite", resultBanner.inviteUrl!)}
                  className="flex h-7 w-7 items-center justify-center hover:bg-secondary shrink-0"
                  title="Copy invite link"
                >
                  {copied === "invite" ? (
                    <Check className="h-3.5 w-3.5 text-gold" />
                  ) : (
                    <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                </button>
              </div>
            )}
            <button
              type="button"
              onClick={() => setResultBanner(null)}
              className="w-full text-[10px] uppercase tracking-[0.2em] text-foreground/30 hover:text-foreground/60 transition-colors pt-2"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
    </>
  );
}
