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
  Copy, Check, Trash2, Ghost, Pencil, FileText, Activity, Clock,
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
import { formatCurrency } from "@/lib/invoiceUtils";
import { ACTION_LABELS } from "@/lib/activityLog";
import { TeamContractFormDialog } from "@/components/admin/TeamContractFormDialog";

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

interface DocumentRow {
  type: "agreement" | "quotation" | "invoice";
  id: string;
  identifier: string;
  project_name?: string;
  status: string;
  amount?: number;
  currency?: string;
  created_at: string;
}

interface ActivityRow {
  id: string;
  action: string;
  description: string;
  created_at: string;
}

// Which accordion is open, scoped to one user row at a time. Only ever one
// panel open across the whole page.
type ExpandedPanel = { userId: string; panel: "history" | "docs" | "activity" };

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
  /** Optional extra controls rendered to the left of the primary Add button
   *  in the page header. Use for page-specific actions like template management. */
  headerActions?: React.ReactNode;
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

// Small ghost-circle button matching the existing avatar/ghost circle on the
// user row. Inactive = neutral grey at low opacity; active = gold tint.
function CircleButton({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: typeof FileText;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={onClick}
            aria-pressed={active}
            className={
              "group flex h-9 w-9 items-center justify-center rounded-full border transition-all shrink-0 " +
              (active
                ? "bg-gold/10 border-gold/50 opacity-100"
                : "bg-secondary border-transparent opacity-80 hover:opacity-100 hover:bg-gold/5 hover:border-gold/40")
            }
          >
            <Icon
              className={
                "h-3.5 w-3.5 transition-colors " +
                (active ? "text-gold" : "text-gold/80 group-hover:text-gold")
              }
              strokeWidth={1.5}
            />
          </button>
        </TooltipTrigger>
        <TooltipContent side="top">{label}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

// Status pill shared by the Documents accordion rows.
function statusPillLabel(s: string): string {
  return s.replace(/_/g, " ").toUpperCase();
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
  headerActions,
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
  const [expandedPanel, setExpandedPanel] = useState<ExpandedPanel | null>(null);
  // Lazy-fetched, per-account caches for the Documents + Activity accordions.
  // Fetched on first open of that circle for any user in the account; reused
  // for the session afterwards.
  const [documentsByAccount, setDocumentsByAccount] = useState<Map<string, DocumentRow[]>>(new Map());
  const [activityByAccount, setActivityByAccount] = useState<Map<string, ActivityRow[]>>(new Map());
  const [docsLoading, setDocsLoading] = useState<Set<string>>(new Set());
  const [activityLoading, setActivityLoading] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState("");
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  // Team Add Member — three-step state machine:
  //   choice        → three option cards
  //   invite        → email-only invite (no contract)
  //   template-pick → select a template (or blank) before opening contract form
  //   presigned     → upload a pre-existing signed PDF
  const [teamAddMode, setTeamAddMode] = useState<"choice" | "invite" | "template-pick" | "presigned">("choice");
  const [isContractDialogOpen, setIsContractDialogOpen] = useState(false);
  const [contractInitialValues, setContractInitialValues] = useState<Record<string, unknown> | null>(null);
  const [contractTemplateId, setContractTemplateId] = useState<string | null>(null);
  const [resultBanner, setResultBanner] = useState<{ email: string; inviteUrl?: string } | null>(null);
  // Templates for the template-pick step
  const [teamTemplates, setTeamTemplates] = useState<Array<{ id: string; name: string; description: string | null; default_fields: Record<string, unknown> }>>([]);
  const [teamTemplatesLoading, setTeamTemplatesLoading] = useState(false);
  // Pre-signed upload form state
  const [presignedName, setPresignedName] = useState("");
  const [presignedEmail, setPresignedEmail] = useState("");
  const [presignedSignedByName, setPresignedSignedByName] = useState("");
  const [presignedSigningDate, setPresignedSigningDate] = useState("");
  const [presignedSubjectLine, setPresignedSubjectLine] = useState("");
  const [presignedPdfFile, setPresignedPdfFile] = useState<File | null>(null);
  const [isPresignedUploading, setIsPresignedUploading] = useState(false);
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
  const [inviteRole, setInviteRole] = useState("");

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

  // Toggle a circle: same circle + same row → close; anything else → switch.
  // Triggers the lazy fetch for docs/activity when opening.
  function togglePanel(userId: string, panel: ExpandedPanel["panel"], accountId: string) {
    setExpandedPanel((prev) => {
      if (prev && prev.userId === userId && prev.panel === panel) return null;
      return { userId, panel };
    });
    if (panel === "docs") fetchDocuments(accountId);
    if (panel === "activity") fetchActivity(accountId);
  }

  // Lazy-fetch all documents (agreements + quotations + invoices) for an
  // account, merged into one created_at-descending timeline. Cached per
  // account for the session.
  async function fetchDocuments(accountId: string) {
    if (documentsByAccount.has(accountId) || docsLoading.has(accountId)) return;
    setDocsLoading((s) => new Set(s).add(accountId));
    try {
      const [agreementsRes, quotationsRes, invoicesRes] = await Promise.all([
        supabase
          .from("agreements")
          .select("id, agreement_version, created_at")
          .eq("account_id", accountId)
          .order("created_at", { ascending: false }),
        supabase
          .from("quotation_documents")
          .select("id, quotation_number, project_name, status, gross_total, currency, created_at")
          .eq("account_id", accountId)
          .order("created_at", { ascending: false }),
        supabase
          .from("invoices")
          .select("id, invoice_number, status, amount, currency, created_at")
          .eq("account_id", accountId)
          .order("created_at", { ascending: false }),
      ]);

      const rows: DocumentRow[] = [];
      for (const a of agreementsRes.data ?? []) {
        rows.push({
          type: "agreement",
          id: a.id,
          identifier: a.agreement_version ?? "Agreement",
          status: "signed",
          created_at: a.created_at,
        });
      }
      for (const q of quotationsRes.data ?? []) {
        rows.push({
          type: "quotation",
          id: q.id,
          identifier: q.quotation_number ?? "Quotation",
          project_name: q.project_name ?? undefined,
          status: q.status ?? "draft",
          amount: q.gross_total ?? undefined,
          currency: q.currency ?? undefined,
          created_at: q.created_at,
        });
      }
      for (const inv of invoicesRes.data ?? []) {
        rows.push({
          type: "invoice",
          id: inv.id,
          identifier: inv.invoice_number ?? "Invoice",
          status: inv.status ?? "draft",
          amount: inv.amount ?? undefined,
          currency: inv.currency ?? undefined,
          created_at: inv.created_at,
        });
      }
      rows.sort((a, b) => b.created_at.localeCompare(a.created_at));
      setDocumentsByAccount((m) => new Map(m).set(accountId, rows));
    } catch (e) {
      console.error("Failed to load documents:", e);
      setDocumentsByAccount((m) => new Map(m).set(accountId, []));
    } finally {
      setDocsLoading((s) => {
        const next = new Set(s);
        next.delete(accountId);
        return next;
      });
    }
  }

  // Lazy-fetch the activity log for an account. activity_log has no account_id
  // column, so resolve the account's member user_ids first, then filter by
  // actor_user_id. Cached per account for the session.
  async function fetchActivity(accountId: string) {
    if (activityByAccount.has(accountId) || activityLoading.has(accountId)) return;
    setActivityLoading((s) => new Set(s).add(accountId));
    try {
      const { data: members } = await supabase
        .from("account_members")
        .select("user_id")
        .eq("account_id", accountId);
      const userIds = (members ?? []).map((m) => m.user_id);
      if (userIds.length === 0) {
        setActivityByAccount((m) => new Map(m).set(accountId, []));
        return;
      }
      const { data: activities } = await supabase
        .from("activity_log")
        .select("id, action, description, created_at")
        .in("actor_user_id", userIds)
        .order("created_at", { ascending: false })
        .limit(100);
      setActivityByAccount((m) => new Map(m).set(accountId, (activities ?? []) as ActivityRow[]));
    } catch (e) {
      console.error("Failed to load activity:", e);
      setActivityByAccount((m) => new Map(m).set(accountId, []));
    } finally {
      setActivityLoading((s) => {
        const next = new Set(s);
        next.delete(accountId);
        return next;
      });
    }
  }

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
    // Most recently connected account at the top, never-connected at the
    // bottom, so it's clear at a glance who actually uses the portal.
    const lastLogin = (g: AccountGroup): string | null =>
      g.users.reduce<string | null>(
        (max, u) => (u.last_login_at && (!max || u.last_login_at > max) ? u.last_login_at : max),
        null,
      );
    return Array.from(byId.values()).sort((a, b) => {
      const la = lastLogin(a), lb = lastLogin(b);
      if (la && lb) return lb.localeCompare(la); // most recent first
      if (la) return -1; // a has connected, b never → a above
      if (lb) return 1; // b has connected, a never → b above
      return a.company_name.localeCompare(b.company_name); // neither connected → alphabetical
    });
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

  const resetPresignedForm = () => {
    setPresignedName("");
    setPresignedEmail("");
    setPresignedSignedByName("");
    setPresignedSigningDate("");
    setPresignedSubjectLine("");
    setPresignedPdfFile(null);
  };

  const fetchTeamTemplates = async () => {
    setTeamTemplatesLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("team-contract-templates-manage", {
        body: { action: "list" },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message);
      setTeamTemplates((data.templates ?? []).filter((t: { archived_at: string | null }) => !t.archived_at));
    } catch (e: unknown) {
      toast({ title: "Failed to load templates", description: (e as Error)?.message, variant: "destructive" });
      setTeamTemplates([]);
    } finally {
      setTeamTemplatesLoading(false);
    }
  };

  const handlePresignedUpload = async () => {
    if (!presignedName.trim() || !presignedEmail.trim() || !presignedSignedByName.trim() || !presignedSigningDate || !presignedPdfFile) {
      toast({ title: "All fields are required", variant: "destructive" });
      return;
    }
    if (presignedPdfFile.type !== "application/pdf") {
      toast({ title: "Please upload a PDF file", variant: "destructive" });
      return;
    }
    if (presignedPdfFile.size > 10 * 1024 * 1024) {
      toast({ title: "PDF must be 10 MB or smaller", variant: "destructive" });
      return;
    }
    setIsPresignedUploading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("No session");
      const fd = new FormData();
      fd.append("email", presignedEmail.trim().toLowerCase());
      fd.append("name", presignedName.trim());
      fd.append("signed_by_name", presignedSignedByName.trim());
      fd.append("signing_date", presignedSigningDate);
      if (presignedSubjectLine.trim()) fd.append("subject_line", presignedSubjectLine.trim());
      fd.append("pdf", presignedPdfFile);
      const res = await fetch(`${SUPABASE_URL}/functions/v1/team-contract-upload-presigned`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          apikey: SUPABASE_PUBLISHABLE_KEY,
        },
        body: fd,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data?.error) throw new Error(data?.error || `Upload failed (${res.status})`);
      toast({ title: "Pre-signed contract uploaded", description: `Invite sent to ${presignedEmail.trim()}` });
      setIsAddDialogOpen(false);
      setTeamAddMode("choice");
      resetPresignedForm();
      fetchAccounts();
    } catch (e: unknown) {
      toast({ title: "Upload failed", description: (e as Error)?.message, variant: "destructive" });
    } finally {
      setIsPresignedUploading(false);
    }
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
      if (!inviteRole) {
        toast({ title: "Please select a role", variant: "destructive" });
        return;
      }
      setIsCreating(true);
      try {
        const ok = await postInvite({
          mode: "invite",
          company: { companyName: email },
          contact: { email },
          accountType: "team",
          role: inviteRole,
        });
        if (ok) {
          setInviteEmail("");
          setInviteRole("");
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
      <div className="mb-10 flex items-start justify-between animate-fade-in">
        <div>
          <div className="mb-4 flex items-center gap-3">
            <div className="h-px w-12 bg-gold-muted" />
            <span className="text-label-gold">{eyebrow}</span>
          </div>
          <p className="mt-3 text-sm text-recessive">{subtitle}</p>
        </div>
        <Dialog
          open={isAddDialogOpen}
          onOpenChange={(open) => {
            setIsAddDialogOpen(open);
            setTeamAddMode("choice");
            if (!open) {
              resetForm();
              setInviteEmail("");
              resetPresignedForm();
              setTeamTemplates([]);
              setContractInitialValues(null);
              setContractTemplateId(null);
            }
          }}
        >
          <div className="flex items-center gap-2.5 pt-1">
            {headerActions}
            <DialogTrigger asChild>
              <button
                className="flex h-[38px] items-center gap-2.5 rounded-lg border border-[#C9A96A]/45 px-[18px] transition-colors duration-300 hover:border-[#C9A96A]/80 hover:bg-[#C9A96A]/[0.12] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#C9A96A]/60"
              >
                <Plus className="h-[13px] w-[13px] text-[#C9A96A]" strokeWidth={1.5} />
                <span className="text-[11px] uppercase tracking-[0.18em] text-[#C9A96A]">{addButtonLabel}</span>
              </button>
            </DialogTrigger>
          </div>
          <DialogContent
            className={
              isTeamOnly
                ? "sm:max-w-md"
                : "max-h-[85vh] overflow-y-auto sm:max-w-2xl"
            }
          >
            {isTeamOnly ? (
              teamAddMode === "choice" ? (
                <>
                  <DialogHeader>
                    <DialogTitle>Add team member</DialogTitle>
                  </DialogHeader>
                  <p className="text-xs text-muted-foreground mt-1">
                    Choose how to bring this team member on.
                  </p>
                  <div className="space-y-3 pt-3">
                    <button
                      type="button"
                      onClick={() => setTeamAddMode("invite")}
                      className="w-full text-left rounded-sm border border-input p-4 hover:border-gold/50 hover:bg-muted/30 transition-colors"
                    >
                      <p className="text-sm text-foreground">Add member only</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Send a portal invite. No contract — they set a password and sign the NDA + service agreement during onboarding.
                      </p>
                    </button>
                    <button
                      type="button"
                      onClick={() => setTeamAddMode("presigned")}
                      className="w-full text-left rounded-sm border border-input p-4 hover:border-gold/50 hover:bg-muted/30 transition-colors"
                    >
                      <p className="text-sm text-foreground">Add member with pre-signed contract</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Upload a contract that was already signed on paper. Stored as a historical record. Portal invite still sent.
                      </p>
                    </button>
                  </div>
                </>
              ) : teamAddMode === "invite" ? (
                <>
                  <DialogHeader>
                    <DialogTitle>Add member only</DialogTitle>
                  </DialogHeader>
                  <p className="text-xs text-muted-foreground mt-1">
                    They'll enter their name and details during onboarding — you set their role here.
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
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Role *</label>
                      <select
                        value={inviteRole}
                        onChange={(e) => setInviteRole(e.target.value)}
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                      >
                        <option value="" disabled>Select a role…</option>
                        <option value="Scene Manager">Scene Manager</option>
                        <option value="Modeller">Modeller</option>
                        <option value="Art Director">Art Director</option>
                        <option value="Photographer">Photographer</option>
                      </select>
                    </div>
                    <div className="flex gap-2">
                      <Button variant="ghost" onClick={() => setTeamAddMode("choice")} disabled={isCreating} className="text-muted-foreground">
                        Back
                      </Button>
                      <Button onClick={handleSubmit} disabled={isCreating} className="flex-1">
                        {isCreating ? "Sending…" : "Send invite"}
                      </Button>
                    </div>
                  </div>
                </>
              ) : teamAddMode === "template-pick" ? (
                <>
                  <DialogHeader>
                    <DialogTitle>Choose a contract template</DialogTitle>
                  </DialogHeader>
                  <p className="text-xs text-muted-foreground mt-1">
                    Select a template to pre-populate the contract form, or start from blank.
                  </p>
                  <div className="space-y-3 pt-3">
                    {teamTemplatesLoading && (
                      <p className="text-xs text-muted-foreground py-4 text-center">Loading templates…</p>
                    )}
                    {!teamTemplatesLoading && teamTemplates.map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => {
                          setContractInitialValues(t.default_fields);
                          setContractTemplateId(t.id);
                          setIsAddDialogOpen(false);
                          setIsContractDialogOpen(true);
                        }}
                        className="w-full text-left rounded-sm border border-input p-4 hover:border-gold/50 hover:bg-muted/30 transition-colors"
                      >
                        <p className="text-sm text-foreground">{t.name}</p>
                        {t.description && (
                          <p className="text-xs text-muted-foreground mt-1">{t.description}</p>
                        )}
                      </button>
                    ))}
                    {!teamTemplatesLoading && (
                      <button
                        type="button"
                        onClick={() => {
                          setContractInitialValues(null);
                          setContractTemplateId(null);
                          setIsAddDialogOpen(false);
                          setIsContractDialogOpen(true);
                        }}
                        className="w-full text-left rounded-sm border border-input p-4 hover:border-gold/20 hover:bg-muted/20 transition-colors opacity-60 hover:opacity-100"
                      >
                        <p className="text-sm text-foreground">Start from blank</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Open an empty contract form without any pre-filled fields.
                        </p>
                      </button>
                    )}
                    <div className="pt-1">
                      <Button variant="ghost" size="sm" onClick={() => setTeamAddMode("choice")} className="text-muted-foreground text-xs">
                        ← Back
                      </Button>
                    </div>
                  </div>
                </>
              ) : teamAddMode === "presigned" ? (
                <>
                  <DialogHeader>
                    <DialogTitle>Upload pre-signed contract</DialogTitle>
                  </DialogHeader>
                  <p className="text-xs text-muted-foreground mt-1">
                    Upload a contract that was signed before joining the portal. A portal invite will be sent after upload.
                  </p>
                  <div className="space-y-4 pt-3">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Full name *</label>
                        <Input
                          value={presignedName}
                          onChange={(e) => setPresignedName(e.target.value)}
                          placeholder="Jane Smith"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Email *</label>
                        <Input
                          type="email"
                          value={presignedEmail}
                          onChange={(e) => setPresignedEmail(e.target.value)}
                          placeholder="jane@company.com"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Signatory name *</label>
                        <Input
                          value={presignedSignedByName}
                          onChange={(e) => setPresignedSignedByName(e.target.value)}
                          placeholder="Name as signed on paper"
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Date signed *</label>
                        <Input
                          type="date"
                          value={presignedSigningDate}
                          onChange={(e) => setPresignedSigningDate(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Contract title <span className="opacity-50">(optional)</span></label>
                      <Input
                        value={presignedSubjectLine}
                        onChange={(e) => setPresignedSubjectLine(e.target.value)}
                        placeholder="e.g. Scene Manager Engagement"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs text-muted-foreground">Contract PDF *</label>
                      <div
                        className="flex items-center gap-3 rounded-sm border border-input px-3 py-2.5 cursor-pointer hover:border-gold/50 transition-colors"
                        onClick={() => document.getElementById("presigned-pdf-input")?.click()}
                      >
                        <span className="text-sm text-muted-foreground flex-1 truncate">
                          {presignedPdfFile ? presignedPdfFile.name : "Click to select PDF…"}
                        </span>
                        <span className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground/60">Browse</span>
                      </div>
                      <input
                        id="presigned-pdf-input"
                        type="file"
                        accept=".pdf,application/pdf"
                        className="hidden"
                        onChange={(e) => setPresignedPdfFile(e.target.files?.[0] ?? null)}
                      />
                      {presignedPdfFile && (
                        <p className="text-[10px] text-muted-foreground">
                          {(presignedPdfFile.size / 1024 / 1024).toFixed(2)} MB
                        </p>
                      )}
                    </div>
                    <div className="flex gap-2 pt-1">
                      <Button variant="ghost" onClick={() => setTeamAddMode("choice")} disabled={isPresignedUploading} className="text-muted-foreground">
                        Back
                      </Button>
                      <Button onClick={handlePresignedUpload} disabled={isPresignedUploading} className="flex-1">
                        {isPresignedUploading ? "Uploading…" : "Upload and send invite"}
                      </Button>
                    </div>
                  </div>
                </>
              )
              : null
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

      {/* Directory — a light section holds the search + tiles.
          Dark tiles never sit on the gradient directly. */}
      <div className="ssr-zone">
        <div className="mb-7 flex items-center justify-between border-b border-white/[0.07] pb-3">
          <div className="flex items-center gap-3">
            <div className="h-px w-6 bg-gold-muted" />
            <h2 className="text-label">{isTeamOnly ? "Members" : title}</h2>
          </div>
          <div className="group relative flex w-[230px] items-center gap-2.5 pb-[7px]">
            <Search className="h-3.5 w-3.5 shrink-0 text-[#C9A96A]/55 transition-colors duration-300 group-focus-within:text-[#C9A96A]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="SEARCH"
              aria-label={`Search ${title.toLowerCase()}`}
              className="w-full border-0 bg-transparent p-0 text-[11px] uppercase tracking-[0.18em] text-white/85 placeholder:text-white/25 focus:outline-none focus:ring-0"
            />
            <span className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-white/[0.12]" />
            <span className="pointer-events-none absolute inset-x-0 bottom-0 h-px origin-left scale-x-0 bg-[#C9A96A] transition-transform duration-500 ease-out group-focus-within:scale-x-100" />
          </div>
        </div>

      {/* List */}
      <div className="animate-fade-in" style={{ animationDelay: "0.15s" }}>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <BrandLoader size="md" />
          </div>
        ) : filteredGroups.length === 0 ? (
          <div className="ssr-tile p-12 text-center">
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
                <div key={group.account_id} className="ssr-tile overflow-hidden">
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
                      const openPanel =
                        expandedPanel?.userId === u.user_id ? expandedPanel.panel : null;
                      const isHistoryOpen = openPanel === "history";
                      const isDocsOpen = openPanel === "docs";
                      const isActivityOpen = openPanel === "activity";
                      const accountId = group.account_id;
                      return (
                        <div key={u.user_id}>
                        <div
                          className="flex items-center gap-4 px-5 py-3.5 hover:bg-muted/15 transition-colors"
                        >
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
                                onClick={() => togglePanel(u.user_id, "history", accountId)}
                                className="group/ls text-right"
                                aria-expanded={isHistoryOpen}
                              >
                                <p className="text-xs text-foreground/65">
                                  {timeAgo(u.last_login_at)}
                                  {lastSession ? ` · ${formatSessionDuration(lastSession.durationMs)} session` : ""}
                                </p>
                                <p
                                  className="font-sans uppercase text-foreground/30 mt-0.5 group-hover/ls:text-foreground/55 transition-colors"
                                  style={{ fontSize: 9, letterSpacing: "0.18em" }}
                                >
                                  Last seen · {isHistoryOpen ? "Hide" : "History"}
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

                          <div className="flex items-center gap-1.5 shrink-0 self-start flex-wrap justify-end">
                            <CircleButton
                              icon={Ghost}
                              label={`View as ${displayName}`}
                              active={false}
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
                            />
                            <CircleButton
                              icon={FileText}
                              label="Documents"
                              active={isDocsOpen}
                              onClick={() => togglePanel(u.user_id, "docs", accountId)}
                            />
                            <CircleButton
                              icon={Activity}
                              label="Activity"
                              active={isActivityOpen}
                              onClick={() => togglePanel(u.user_id, "activity", accountId)}
                            />
                            <CircleButton
                              icon={Clock}
                              label="Recent sessions"
                              active={isHistoryOpen}
                              onClick={() => togglePanel(u.user_id, "history", accountId)}
                            />
                          </div>
                        </div>
                        {isHistoryOpen && (
                          <div className="px-5 pb-4 pt-1 bg-muted/10 border-t border-border/20">
                            <p
                              className="font-sans uppercase text-foreground/35 mb-2"
                              style={{ fontSize: 9, letterSpacing: "0.2em" }}
                            >
                              Recent sessions
                            </p>
                            {hasSessions ? (
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
                            ) : (
                              <p className="text-xs text-foreground/35">No sessions recorded yet.</p>
                            )}
                          </div>
                        )}

                        {isDocsOpen && (
                          <div className="px-5 pb-4 pt-1 bg-muted/10 border-t border-border/20">
                            <p
                              className="font-sans uppercase text-foreground/35 mb-2"
                              style={{ fontSize: 9, letterSpacing: "0.2em" }}
                            >
                              Recent documents
                            </p>
                            {docsLoading.has(accountId) ? (
                              <p className="text-xs text-foreground/35 animate-pulse">Loading documents…</p>
                            ) : (() => {
                              const docs = documentsByAccount.get(accountId) ?? [];
                              if (docs.length === 0) {
                                return <p className="text-xs text-foreground/35">No documents yet.</p>;
                              }
                              const shown = docs.slice(0, 20);
                              return (
                                <>
                                  <div className="flex flex-col gap-y-1">
                                    {shown.map((d) => {
                                      const route =
                                        d.type === "agreement"
                                          ? "/admin/documents"
                                          : d.type === "quotation"
                                          ? "/admin/quotes"
                                          : "/admin/invoices";
                                      return (
                                        <button
                                          key={`${d.type}-${d.id}`}
                                          type="button"
                                          onClick={() => navigate(`${route}?doc=${d.id}`)}
                                          className="flex items-center justify-between gap-3 py-0.5 text-left hover:bg-muted/20 -mx-1 px-1 rounded-sm transition-colors"
                                        >
                                          <span
                                            className="font-sans uppercase text-foreground/55 truncate"
                                            style={{ fontSize: 10, letterSpacing: "0.12em" }}
                                          >
                                            {new Date(d.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                                            {" · "}
                                            {d.identifier}
                                            {d.project_name ? ` · ${d.project_name}` : ""}
                                          </span>
                                          <span
                                            className="font-sans uppercase text-foreground/35 tabular-nums shrink-0"
                                            style={{ fontSize: 10, letterSpacing: "0.12em" }}
                                          >
                                            {typeof d.amount === "number"
                                              ? `${formatCurrency(d.amount, d.currency ?? "GBP")} · `
                                              : ""}
                                            {statusPillLabel(d.status)}
                                          </span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                  {docs.length > 20 && (
                                    <p className="text-[10px] uppercase tracking-[0.18em] text-foreground/30 mt-2">
                                      Showing 20 most recent
                                    </p>
                                  )}
                                </>
                              );
                            })()}
                          </div>
                        )}

                        {isActivityOpen && (
                          <div className="px-5 pb-4 pt-1 bg-muted/10 border-t border-border/20">
                            <p
                              className="font-sans uppercase text-foreground/35 mb-2"
                              style={{ fontSize: 9, letterSpacing: "0.2em" }}
                            >
                              Recent activity
                            </p>
                            {activityLoading.has(accountId) ? (
                              <p className="text-xs text-foreground/35 animate-pulse">Loading activity…</p>
                            ) : (() => {
                              const events = activityByAccount.get(accountId) ?? [];
                              if (events.length === 0) {
                                return <p className="text-xs text-foreground/35">No activity yet.</p>;
                              }
                              return (
                                <div className="grid grid-cols-1 gap-y-1">
                                  {events.map((ev) => (
                                    <div key={ev.id} className="flex items-start gap-3 py-0.5">
                                      <span
                                        className="font-sans uppercase text-foreground/55 tabular-nums shrink-0"
                                        style={{ fontSize: 10, letterSpacing: "0.12em" }}
                                      >
                                        {new Date(ev.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                                        {" · "}
                                        {new Date(ev.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                                      </span>
                                      <span className="text-xs text-foreground/65 min-w-0">
                                        {ACTION_LABELS[ev.action] && (
                                          <span
                                            className="font-sans uppercase text-foreground/35 mr-2"
                                            style={{ fontSize: 9, letterSpacing: "0.14em" }}
                                          >
                                            {ACTION_LABELS[ev.action]}
                                          </span>
                                        )}
                                        {ev.description}
                                      </span>
                                    </div>
                                  ))}
                                </div>
                              );
                            })()}
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
      </div>

      {/* Register Them — engagement contract draft form */}
      <TeamContractFormDialog
        open={isContractDialogOpen}
        onOpenChange={(open) => {
          setIsContractDialogOpen(open);
          if (!open) { setContractInitialValues(null); setContractTemplateId(null); }
        }}
        initialValues={contractInitialValues ?? undefined}
        templateId={contractTemplateId ?? undefined}
      />

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
