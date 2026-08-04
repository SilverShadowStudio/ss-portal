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
  Copy, Check, Trash2, Ghost, Pencil, FileText, Clock, FilePlus2,
  Archive, ArchiveRestore, ChevronRight, CalendarDays, Wallet,
} from "lucide-react";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { supabase, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip, TooltipContent, TooltipProvider, TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import { AccountEmailsModal } from "@/components/admin/AccountEmailsModal";
import { TeamDocsPanel } from "@/components/admin/TeamDocsPanel";
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
  archived_at: string | null;
  user_id: string;
  email: string | null;
  full_name: string | null;
  first_name: string | null;
  last_name: string | null;
  position: string | null;
  member_role: string | null;
  employment_type: string | null;
  joined_at: string | null;
  last_login_at: string | null;
}

interface AccountGroup {
  account_id: string;
  company_name: string;
  account_type: string | null;
  client_code: string | null;
  account_created_at: string | null;
  archived_at: string | null;
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

// Team members are shown grouped by discipline. Employees come first, then the
// freelance disciplines. Anyone who doesn't match a named bucket — or hasn't
// been given a role yet — falls into "Other" so nobody is ever hidden.
const TEAM_SECTION_ORDER = ["Employees", "Scene Managers", "Modellers", "Photographers", "Other"];
function teamSectionOf(g: AccountGroup): string {
  const u = g.users[0];
  if (u?.employment_type === "employee") return "Employees";
  const raw = (u?.position ?? u?.member_role ?? "").toLowerCase();
  if (raw.includes("scene manager")) return "Scene Managers";
  if (raw.includes("modell") || raw.includes("modeler")) return "Modellers";
  if (raw.includes("photograph")) return "Photographers";
  return "Other";
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
              "group relative flex h-9 w-9 items-center justify-center rounded-[11px] shrink-0 transition-all duration-200 ease-out " +
              (active
                ? "bg-gradient-to-b from-[#C9A96A]/25 to-[#C9A96A]/[0.08] text-[#ecd39c] ring-1 ring-inset ring-[#C9A96A]/40 shadow-[0_0_14px_-3px_rgba(201,169,106,0.45)]"
                : "bg-white/[0.03] text-white/55 ring-1 ring-inset ring-white/[0.06] hover:-translate-y-px hover:bg-[#C9A96A]/[0.12] hover:text-[#ecd39c] hover:ring-[#C9A96A]/30 hover:shadow-[0_0_16px_-3px_rgba(201,169,106,0.5)]")
            }
          >
            <Icon className="h-[15px] w-[15px] transition-transform duration-200 ease-out group-hover:scale-110" strokeWidth={1.5} />
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
  // Team pages always get the row menu so the "Send invite" item is reachable.
  const showDropdown = showEditProfile || showDelete || (accountTypes.length === 1 && accountTypes[0] === "team");
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
  // Client accounts that are in current production (own at least one active
  // project). Used to split the Clients directory into Active / Inactive.
  const [activeAccountIds, setActiveAccountIds] = useState<Set<string>>(new Set());
  // Live presence: user_id → last heartbeat (ms). Polled so the "Active" badge
  // updates without a manual refresh.
  const [presence, setPresence] = useState<Map<string, number>>(new Map());
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
  // Sessions that have been expanded to reveal the activity that happened during them.
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set());
  const toggleSession = (id: string) => setExpandedSessions((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const [searchQuery, setSearchQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
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
  // Portal-emails viewer, opened from the account-card mail icon.
  const [emailsModal, setEmailsModal] = useState<{ accountId: string; name: string } | null>(null);
  // Admin edit of a team member's admin-owned info (name/engagement/position/salary/role).
  const [editMember, setEditMember] = useState<null | { accountId: string; userId: string | null; firstName: string; lastName: string; engagement: "freelancer" | "employee"; position: string; salary: string; role: string; startDate: string }>(null);
  const [savingMember, setSavingMember] = useState(false);
  // Templates for the template-pick step
  const [teamTemplates, setTeamTemplates] = useState<Array<{ id: string; name: string; description: string | null; default_fields: Record<string, unknown> }>>([]);
  const [teamTemplatesLoading, setTeamTemplatesLoading] = useState(false);
  // Pre-signed upload form state
  const [presignedFirstName, setPresignedFirstName] = useState("");
  const [presignedLastName, setPresignedLastName] = useState("");
  const [presignedEmail, setPresignedEmail] = useState("");
  const [presignedSigningDate, setPresignedSigningDate] = useState("");
  const [presignedSubjectLine, setPresignedSubjectLine] = useState("");
  // Freelancer vs Employee: Employee = fixed salary (accounting only). Drives
  // Position + gross annual salary, and later feeds Debts → Salaries.
  const [presignedEmploymentType, setPresignedEmploymentType] = useState<"freelancer" | "employee">("freelancer");
  const [presignedPosition, setPresignedPosition] = useState("");
  const [presignedSalary, setPresignedSalary] = useState("");
  const [presignedPdfFile, setPresignedPdfFile] = useState<File | null>(null);
  const [isPresignedUploading, setIsPresignedUploading] = useState(false);
  const [isParsingAgreement, setIsParsingAgreement] = useState(false);
  const [agreementParsed, setAgreementParsed] = useState(false);
  const [parseMissing, setParseMissing] = useState<string[]>([]);
  const [presignedDragging, setPresignedDragging] = useState(false);
  // When set, the presigned dialog is "add a document for an existing member"
  // rather than adding a new member (no invite, no personal fields).
  const [presignedForExisting, setPresignedForExisting] = useState(false);
  const [presignedMemberName, setPresignedMemberName] = useState("");
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

  // Poll live presence so the Active badge is near real-time (team + clients).
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { data } = await supabase.from("user_presence").select("user_id, last_seen_at");
      if (cancelled) return;
      const m = new Map<string, number>();
      for (const r of (data ?? []) as { user_id: string; last_seen_at: string }[]) {
        m.set(r.user_id, new Date(r.last_seen_at).getTime());
      }
      setPresence(m);
    };
    load();
    const iv = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(iv); };
  }, []);

  // Clients only: which accounts are in active production (have a live project).
  useEffect(() => {
    if (isTeamOnly) return;
    supabase.from("projects").select("account_id, status, archived_at").then(({ data }) => {
      const s = new Set<string>();
      for (const p of (data ?? []) as Array<{ account_id: string | null; status: string | null; archived_at: string | null }>) {
        if (p.account_id && p.status === "active" && !p.archived_at) s.add(p.account_id);
      }
      setActiveAccountIds(s);
    });
  }, [isTeamOnly]);

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
    // Sessions now expand to show their activity — load it alongside.
    if (panel === "history") fetchActivity(accountId);
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
          archived_at: u.archived_at,
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

  const archivedCount = useMemo(() => accountGroups.filter((g) => g.archived_at).length, [accountGroups]);

  const filteredGroups = useMemo<AccountGroup[]>(() => {
    // Active by default; the toggle shows the archived ones instead.
    const base = accountGroups.filter((g) => (showArchived ? !!g.archived_at : !g.archived_at));
    const q = searchQuery.trim().toLowerCase();
    if (!q) return base;
    return base
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
  }, [accountGroups, searchQuery, showArchived]);

  // Team-only view: split the members into discipline sections (see helpers).
  const teamSections = useMemo(() => {
    const map = new Map<string, AccountGroup[]>();
    for (const g of filteredGroups) {
      const key = teamSectionOf(g);
      const bucket = map.get(key) ?? [];
      bucket.push(g);
      map.set(key, bucket);
    }
    return TEAM_SECTION_ORDER
      .filter((k) => map.has(k))
      .map((label) => ({ label, groups: map.get(label)! }));
  }, [filteredGroups]);

  // Clients view: Active clients (in production) on top, Inactive below.
  const clientSections = useMemo(() => {
    const active: AccountGroup[] = [];
    const inactive: AccountGroup[] = [];
    for (const g of filteredGroups) {
      (activeAccountIds.has(g.account_id) ? active : inactive).push(g);
    }
    const out: { label: string | null; groups: AccountGroup[] }[] = [];
    if (active.length) out.push({ label: "Active clients", groups: active });
    if (inactive.length) out.push({ label: "Inactive clients", groups: inactive });
    return out;
  }, [filteredGroups, activeAccountIds]);

  // Which section layout to render: team by discipline, archived clients flat,
  // otherwise clients split Active / Inactive.
  const renderSections = isTeamOnly
    ? teamSections
    : showArchived
      ? [{ label: null as string | null, groups: filteredGroups }]
      : clientSections;
  // Clients (non-archived) drop the redundant page title — the Active / Inactive
  // section headers stand on their own.
  const clientSectioned = !isTeamOnly && !showArchived;

  // The per-account ⋯ menu (invite / edit / clear activity / archive / delete).
  // Shared by the client header and the team single-row card.
  const renderGroupMenu = (group: AccountGroup) => (
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
        {isTeamOnly && (
          <DropdownMenuItem onClick={() => handleSendInvite(group.account_id)}>
            <Mail className="mr-2 h-4 w-4" /> Send invite
          </DropdownMenuItem>
        )}
        {isTeamOnly && (
          <DropdownMenuItem onClick={() => openEditMember(group)}>
            <Pencil className="mr-2 h-4 w-4" /> Edit member
          </DropdownMenuItem>
        )}
        {isTeamOnly && (
          <DropdownMenuItem onClick={() => handleClearActivity(group.account_id, fullNameOf(group.users[0]) || group.company_name)}>
            <Clock className="mr-2 h-4 w-4" /> Clear activity history
          </DropdownMenuItem>
        )}
        {showEditProfile && (
          <DropdownMenuItem onClick={() => navigate(`/admin/clients/${group.account_id}`)}>
            <Pencil className="mr-2 h-4 w-4" /> Edit profile
          </DropdownMenuItem>
        )}
        {showDelete && (
          group.archived_at ? (
            <DropdownMenuItem onClick={() => handleArchiveAccount(group.account_id, group.company_name, false)}>
              <ArchiveRestore className="mr-2 h-4 w-4" /> Unarchive
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem onClick={() => handleArchiveAccount(group.account_id, group.company_name, true)}>
              <Archive className="mr-2 h-4 w-4" /> Archive
            </DropdownMenuItem>
          )
        )}
        {showDelete && (
          <DropdownMenuItem
            className="text-destructive focus:text-destructive"
            onClick={() => handleDeleteAccount(group.account_id, group.company_name, group.users.length)}
          >
            <Trash2 className="mr-2 h-4 w-4" /> Delete
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  // "Active" = a heartbeat within the last 90s (2× the 45s client ping).
  // last-seen falls back to the freshest of heartbeat / sessions / last login.
  const ONLINE_WINDOW_MS = 90 * 1000;
  const lastActiveMsOf = (userId: string, lastLogin: string | null): number | null => {
    const sess = sessionsByUser.get(userId) ?? [];
    const newest = sess[0];
    const stamps = [lastLogin, newest?.end, newest?.start, presence.get(userId) ? new Date(presence.get(userId)!).toISOString() : null]
      .filter(Boolean)
      .map((s) => new Date(s as string).getTime());
    return stamps.length ? Math.max(...stamps) : null;
  };

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
    setPresignedFirstName("");
    setPresignedLastName("");
    setPresignedEmail("");
    setPresignedSigningDate("");
    setPresignedSubjectLine("");
    setPresignedEmploymentType("freelancer");
    setPresignedPosition("");
    setPresignedSalary("");
    setPresignedPdfFile(null);
    setAgreementParsed(false); setParseMissing([]);
    setPresignedForExisting(false);
    setPresignedMemberName("");
  };

  // Open the upload dialog to add ANOTHER document for an existing member.
  function openUploadForMember(member: { email: string | null; position?: string | null }, memberName: string) {
    resetPresignedForm();
    const parts = (memberName || "").trim().split(/\s+/).filter(Boolean);
    setPresignedFirstName(parts[0] ?? "");
    setPresignedLastName(parts.slice(1).join(" "));
    setPresignedEmail(member.email ?? "");
    setPresignedEmploymentType(member.position ? "employee" : "freelancer");
    setPresignedForExisting(true);
    setPresignedMemberName(memberName || member.email || "this member");
    setTeamAddMode("presigned");
    setIsAddDialogOpen(true);
  }

  // Read the uploaded agreement and pre-fill the review fields. Admin still
  // reviews/edits before sending — this is the "preview before the invite".
  const handleParseAgreement = async () => {
    if (!presignedPdfFile) {
      toast({ title: "Select the agreement PDF first", variant: "destructive" });
      return;
    }
    setIsParsingAgreement(true);
    setAgreementParsed(false); setParseMissing([]);
    try {
      const file_data_base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const r = reader.result as string;
          const comma = r.indexOf(",");
          resolve(comma >= 0 ? r.slice(comma + 1) : r);
        };
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(presignedPdfFile);
      });
      const { data, error } = await supabase.functions.invoke("parse-document", {
        body: { document_type: "agreement", file_data_base64, file_mime_type: presignedPdfFile.type },
      });
      if (error) throw error;
      if (!data?.success || !data?.data) throw new Error(data?.error || "Could not read the agreement");
      const p = data.data as Record<string, unknown>;
      const keepOr = (cur: string, val: unknown) => (cur.trim() ? cur : (typeof val === "string" && val ? val : cur));
      setPresignedFirstName((c) => keepOr(c, p.first_name));
      setPresignedLastName((c) => keepOr(c, p.last_name));
      if (p.employment_type === "employee" || p.employment_type === "freelancer") setPresignedEmploymentType(p.employment_type);
      setPresignedEmail((c) => keepOr(c, p.email));
      if (typeof p.signing_date === "string" && p.signing_date) setPresignedSigningDate((c) => c || (p.signing_date as string));
      setPresignedPosition((c) => keepOr(c, p.position));
      const gotSalary = p.gross_salary_annual != null && Number(p.gross_salary_annual) > 0;
      if (gotSalary) setPresignedSalary((c) => (c.trim() ? c : String(p.gross_salary_annual)));

      // Report which key fields the document didn't contain, so it's clear what
      // still needs typing (e.g. an equipment-loan doc has no salary/position).
      const effectiveType = (p.employment_type === "employee" || p.employment_type === "freelancer")
        ? p.employment_type : presignedEmploymentType;
      const missing: string[] = [];
      if (effectiveType === "employee") {
        if (!(typeof p.position === "string" && p.position.trim())) missing.push("Position");
        if (!gotSalary) missing.push("Gross salary");
      }
      if (!(typeof p.email === "string" && p.email.trim())) missing.push("Email");
      setParseMissing(missing);
      setAgreementParsed(true);
      toast(missing.length
        ? { title: "Agreement read — a few fields to complete", description: `Not found in this document: ${missing.join(", ")}. Type those in, then send.` }
        : { title: "Agreement read", description: "Review the prefilled details, then send the invite." });
    } catch (e: unknown) {
      toast({ title: "Couldn't read the agreement", description: (e as Error)?.message, variant: "destructive" });
    } finally {
      setIsParsingAgreement(false);
    }
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
    if (!presignedFirstName.trim() || !presignedLastName.trim() || !presignedEmail.trim() || !presignedSigningDate || !presignedPdfFile) {
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
    if (!presignedForExisting && presignedEmploymentType === "employee" && (!presignedPosition.trim() || !(parseFloat(presignedSalary.replace(/[^0-9.]/g, "")) > 0))) {
      toast({ title: "Position and gross annual salary are required for an employee", variant: "destructive" });
      return;
    }
    setIsPresignedUploading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("No session");
      const fd = new FormData();
      fd.append("email", presignedEmail.trim().toLowerCase());
      fd.append("first_name", presignedFirstName.trim());
      fd.append("last_name", presignedLastName.trim());
      fd.append("name", `${presignedFirstName.trim()} ${presignedLastName.trim()}`.trim());
      fd.append("signed_by_name", `${presignedFirstName.trim()} ${presignedLastName.trim()}`.trim());
      fd.append("signing_date", presignedSigningDate);
      if (presignedSubjectLine.trim()) fd.append("subject_line", presignedSubjectLine.trim());
      fd.append("employment_type", presignedEmploymentType);
      if (presignedEmploymentType === "employee") {
        fd.append("position", presignedPosition.trim());
        fd.append("gross_salary_annual", String(parseFloat(presignedSalary.replace(/[^0-9.]/g, ""))));
      }
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

  // Open the edit-member dialog, pulling the current admin-owned fields.
  async function openEditMember(group: AccountGroup) {
    const u = group.users?.[0];
    const { data: acct } = await supabase.from("accounts").select("employment_type, position, gross_salary_annual, team_role, work_start_date").eq("id", group.account_id).maybeSingle();
    const { data: fp } = u ? await supabase.from("freelancer_profiles").select("role, day_rate").eq("user_id", u.user_id).maybeSingle() : { data: null } as any;
    const a = acct as { employment_type?: string | null; position?: string | null; gross_salary_annual?: number | null; team_role?: string | null; work_start_date?: string | null } | null;
    const nameParts = (group.company_name || "").trim().split(/\s+/);
    setEditMember({
      accountId: group.account_id,
      userId: u?.user_id ?? null,
      firstName: u?.first_name ?? nameParts[0] ?? "",
      lastName: u?.last_name ?? nameParts.slice(1).join(" ") ?? "",
      engagement: a?.employment_type === "employee" ? "employee" : "freelancer",
      position: a?.position ?? u?.position ?? "",
      salary: a?.gross_salary_annual != null ? String(a.gross_salary_annual) : "",
      role: (fp as { role?: string | null } | null)?.role ?? a?.team_role ?? "",
      startDate: a?.work_start_date ?? "",
    });
  }

  async function saveEditMember() {
    if (!editMember) return;
    const m = editMember;
    if (!m.firstName.trim()) { toast({ title: "First name is required", variant: "destructive" }); return; }
    const isEmp = m.engagement === "employee";
    if (isEmp && (!m.position.trim() || !(parseFloat(m.salary.replace(/[^0-9.]/g, "")) > 0))) {
      toast({ title: "Position and gross salary are required for an employee", variant: "destructive" }); return;
    }
    setSavingMember(true);
    try {
      const fullName = `${m.firstName.trim()} ${m.lastName.trim()}`.trim();
      const { error: aErr } = await supabase.from("accounts").update({
        company_name: fullName,
        employment_type: m.engagement,
        position: isEmp ? m.position.trim() || null : null,
        gross_salary_annual: isEmp ? parseFloat(m.salary.replace(/[^0-9.]/g, "")) || null : null,
        team_role: isEmp ? (m.position.trim() || null) : (m.role.trim() || null),
        work_start_date: m.startDate || null,
      }).eq("id", m.accountId);
      if (aErr) throw aErr;
      if (m.userId) {
        const { error: fErr } = await supabase.from("freelancer_profiles").update({
          first_name: m.firstName.trim(),
          last_name: m.lastName.trim(),
          role: isEmp ? (m.position.trim() || null) : (m.role.trim() || null),
        }).eq("user_id", m.userId);
        if (fErr) throw fErr;
      }
      toast({ title: "Member updated" });
      setEditMember(null);
      fetchAccounts();
    } catch (e: unknown) {
      toast({ title: "Couldn't update member", description: (e as Error)?.message, variant: "destructive" });
    } finally {
      setSavingMember(false);
    }
  }

  // (Re)send a set-password link via Resend — bypasses Supabase's auth SMTP.
  async function handleSendInvite(accountId: string) {
    try {
      const { data, error } = await supabase.functions.invoke("team-invite-send", { body: { account_id: accountId } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast({ title: "Invite sent", description: `Set-password link emailed to ${data?.email ?? "the member"}.` });
    } catch (e: unknown) {
      toast({ title: "Couldn't send invite", description: (e as Error)?.message, variant: "destructive" });
    }
  }

  async function handleClearActivity(accountId: string, name: string) {
    if (!window.confirm(`Clear ${name}'s activity history?\n\nThis removes tracked sessions, page views and "logged in" entries (test/setup noise). Onboarding milestones (invite, password, onboarding) are kept. Cannot be undone.`)) return;
    try {
      const { data, error } = await supabase.functions.invoke("admin-clear-member-activity", { body: { account_id: accountId } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const c = data?.cleared ?? {};
      toast({ title: "Activity cleared", description: `Removed ${c.client_activity ?? 0} session rows and ${c.logins ?? 0} login entries.` });
      setActivityByAccount((m) => { const n = new Map(m); n.delete(accountId); return n; });
      setExpandedPanel(null);
      fetchAccounts();
    } catch (e: unknown) {
      toast({ title: "Couldn't clear activity", description: (e as Error)?.message, variant: "destructive" });
    }
  }

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
      `This removes their account, ${memberCount} member link(s), their records, ` +
      `and their agreement files from storage AND Dropbox. This cannot be undone.\n\n` +
      `To keep everything and just disable access, use Archive instead.`,
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
      if (error || data?.error) {
        let msg = data?.error || error?.message || "Delete failed";
        // FunctionsHttpError carries the response body — surface the real reason.
        try { const b = await (error as any)?.context?.json?.(); if (b?.error) msg = b.error; } catch { /* keep msg */ }
        throw new Error(msg);
      }
      toast({ title: "Account deleted", description: companyName });
      fetchAccounts();
    } catch (e: any) {
      toast({
        title: "Could not delete account",
        description: e?.message,
        variant: "destructive",
      });
    }
  };

  const handleArchiveAccount = async (accountId: string, companyName: string, archive: boolean) => {
    if (archive && !window.confirm(
      `Archive "${companyName}"?\n\nTheir record, documents and files are all kept, ` +
      `and their login is disabled. You can unarchive any time.`,
    )) return;
    try {
      const { data, error } = await supabase.functions.invoke("admin-archive-account", {
        body: { account_id: accountId, archive },
      });
      if (error || data?.error) throw new Error(data?.error || error?.message || "Failed");
      toast({ title: archive ? "Account archived" : "Account restored", description: companyName });
      fetchAccounts();
    } catch (e: any) {
      toast({
        title: archive ? "Could not archive account" : "Could not restore account",
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
                ? "sm:max-w-lg max-h-[90vh] overflow-y-auto overflow-x-hidden"
                : "max-h-[85vh] overflow-y-auto sm:max-w-2xl"
            }
          >
            {isTeamOnly ? (
              teamAddMode === "choice" ? (
                <>
                  <DialogHeader className="space-y-0">
                    <div className="flex items-center gap-3">
                      <div className="h-px w-10 bg-gold-muted" />
                      <DialogTitle className="!text-[10px] !font-medium uppercase !tracking-[0.24em] !leading-none text-[#ecd39c]">Add team member</DialogTitle>
                    </div>
                  </DialogHeader>
                  <p className="text-sm text-foreground/62 mt-3">Choose how to bring this team member on.</p>
                  <div className="space-y-3 pt-4">
                    <button type="button" onClick={() => setTeamAddMode("invite")} className="group w-full text-left ssr-tile ssr-tile-hover p-5 transition-colors">
                      <div className="mb-2.5 flex items-center gap-2.5">
                        <div className="h-px w-5 bg-gold-muted" />
                        <span className="text-[10px] uppercase tracking-[0.2em] text-white/85 transition-colors group-hover:text-[#ecd39c]">Add member</span>
                      </div>
                      <p className="text-[13px] text-white/70">The member gets an invite, sets a password, adds their details, and signs.</p>
                      <p className="mt-0.5 text-[12px] text-white/60">They sign the agreement in the portal.</p>
                    </button>
                    <button type="button" onClick={() => setTeamAddMode("presigned")} className="group w-full text-left ssr-tile ssr-tile-hover p-5 transition-colors">
                      <div className="mb-2.5 flex items-center gap-2.5">
                        <div className="h-px w-5 bg-gold-muted" />
                        <span className="text-[10px] uppercase tracking-[0.2em] text-white/85 transition-colors group-hover:text-[#ecd39c]">Add member with existing agreement</span>
                      </div>
                      <p className="text-[13px] text-white/70">The member gets an invite, sets a password, and adds their details.</p>
                      <p className="mt-0.5 text-[12px] text-white/60">You upload a signed agreement.</p>
                    </button>
                  </div>
                </>
              ) : teamAddMode === "invite" ? (
                <>
                  <DialogHeader className="space-y-0">
                    <div className="flex items-center gap-3">
                      <div className="h-px w-10 bg-gold-muted" />
                      <DialogTitle className="!text-[10px] !font-medium uppercase !tracking-[0.24em] !leading-none text-[#ecd39c]">Add member</DialogTitle>
                    </div>
                  </DialogHeader>
                  <p className="text-sm text-foreground/62 mt-3">
                    They&rsquo;ll enter their name and details during onboarding — you set their role here.
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
                  <DialogHeader className="space-y-0">
                    <div className="flex items-center gap-3">
                      <div className="h-px w-10 bg-gold-muted" />
                      <DialogTitle className="!text-[10px] !font-medium uppercase !tracking-[0.24em] !leading-none text-[#ecd39c]">Choose a contract template</DialogTitle>
                    </div>
                  </DialogHeader>
                  <p className="text-sm text-foreground/62 mt-3">
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
                  <DialogHeader className="space-y-0">
                    <div className="flex items-center gap-3">
                      <div className="h-px w-10 bg-gold-muted" />
                      <DialogTitle className="!text-[10px] !font-medium uppercase !tracking-[0.24em] !leading-none text-[#ecd39c]">{presignedForExisting ? "Add a document" : "Existing agreement"}</DialogTitle>
                    </div>
                  </DialogHeader>
                  <p className="mt-3 text-sm text-foreground/62">
                    {presignedForExisting
                      ? <>Upload another signed document for <span className="text-foreground/70">{presignedMemberName}</span> — it's added to their file. No new invite.</>
                      : "Upload the signed contract and read it — the portal fills in the details below for you to check, then sends the invite."}
                  </p>

                  <div className="min-w-0 space-y-6 pt-4">
                    {/* Engagement — segmented toggle (new members only) */}
                    {!presignedForExisting && (
                    <div className="space-y-2">
                      <span className="text-[10px] uppercase tracking-[0.2em] text-foreground/60">Engagement</span>
                      <div className="grid grid-cols-2 gap-2">
                        {([
                          { v: "freelancer", t: "Freelancer", d: "Paid per work" },
                          { v: "employee", t: "Employee", d: "Fixed salary" },
                        ] as const).map((o) => {
                          const on = presignedEmploymentType === o.v;
                          return (
                            <button
                              key={o.v}
                              type="button"
                              onClick={() => setPresignedEmploymentType(o.v)}
                              className={`rounded-sm border px-3.5 py-3 text-left transition-colors ${on ? "border-[#C9A96A]/70 bg-[#C9A96A]/[0.08]" : "border-white/10 hover:border-[#C9A96A]/40 hover:bg-white/[0.02]"}`}
                            >
                              <div className={`text-sm ${on ? "text-[#ecd39c]" : "text-foreground/80"}`}>{o.t}</div>
                              <div className="text-[11px] text-foreground/60">{o.d}</div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                    )}

                    {/* Contract first — read it to prefill everything below */}
                    <div className="space-y-2">
                      <span className="text-[10px] uppercase tracking-[0.2em] text-foreground/60">Signed contract</span>
                      <div
                        onClick={() => document.getElementById("presigned-pdf-input")?.click()}
                        onDragOver={(e) => { e.preventDefault(); setPresignedDragging(true); }}
                        onDragLeave={() => setPresignedDragging(false)}
                        onDrop={(e) => {
                          e.preventDefault();
                          setPresignedDragging(false);
                          const f = e.dataTransfer.files?.[0];
                          if (!f) return;
                          if (f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf")) {
                            setPresignedPdfFile(f);
                            setAgreementParsed(false); setParseMissing([]);
                          } else {
                            toast({ title: "Please drop a PDF", variant: "destructive" });
                          }
                        }}
                        className={`cursor-pointer rounded-sm border border-dashed px-4 py-4 transition-colors ${presignedDragging ? "border-[#C9A96A]/70 bg-[#C9A96A]/[0.06]" : presignedPdfFile ? "border-[#C9A96A]/50 bg-white/[0.02]" : "border-white/15 hover:border-[#C9A96A]/45 hover:bg-white/[0.02]"}`}
                      >
                        <div className="flex min-w-0 items-center justify-between gap-3">
                          <span className={`min-w-0 flex-1 truncate text-sm ${presignedPdfFile ? "text-foreground" : "text-foreground/62"}`}>
                            {presignedPdfFile ? presignedPdfFile.name : "Drop the signed contract, or click to browse"}
                          </span>
                          <span className="shrink-0 text-[10px] uppercase tracking-[0.16em] text-foreground/60">
                            {presignedPdfFile ? `${(presignedPdfFile.size / 1024 / 1024).toFixed(2)} MB` : "PDF"}
                          </span>
                        </div>
                      </div>
                      <input
                        id="presigned-pdf-input"
                        type="file"
                        accept=".pdf,application/pdf"
                        className="hidden"
                        onChange={(e) => { setPresignedPdfFile(e.target.files?.[0] ?? null); setAgreementParsed(false); setParseMissing([]); }}
                      />
                      {presignedPdfFile && (
                        <div className="flex justify-end pt-1">
                          <button
                            type="button"
                            onClick={handleParseAgreement}
                            disabled={isParsingAgreement}
                            className="rounded-sm bg-[#C9A96A] px-4 py-2 text-[11px] font-medium uppercase tracking-[0.16em] text-black transition-colors hover:bg-[#ecd39c] disabled:opacity-40"
                          >
                            {isParsingAgreement ? "Reading…" : agreementParsed ? "Re-read agreement" : "Read agreement to prefill"}
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Details — filled from the agreement, to review before sending */}
                    <div className="space-y-4 border-t border-white/[0.07] pt-5">
                      <div className="flex items-center gap-3">
                        <div className="h-px w-6 bg-gold-muted" />
                        <span className="text-[10px] uppercase tracking-[0.2em] text-foreground/60">
                          {presignedForExisting ? "Document" : agreementParsed ? "From the agreement — check before sending" : "Member details"}
                        </span>
                      </div>
                      {!presignedForExisting && agreementParsed && parseMissing.length > 0 && (
                        <p className="text-[11px] text-[#C9A96A]">
                          Not found in this document — please type: {parseMissing.join(", ")}.
                        </p>
                      )}

                      {!presignedForExisting && presignedEmploymentType === "employee" && (
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                          <div className="space-y-1.5">
                            <Label className="text-[10px] uppercase tracking-[0.16em] text-foreground/62">Position</Label>
                            <Input value={presignedPosition} onChange={(e) => setPresignedPosition(e.target.value)} placeholder="Production Director" className="rounded-sm" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-[10px] uppercase tracking-[0.16em] text-foreground/62">Gross annual salary (£)</Label>
                            <Input inputMode="decimal" value={presignedSalary} onChange={(e) => setPresignedSalary(e.target.value)} placeholder="45000" className="rounded-sm" />
                            <p className="text-[10px] text-foreground/60">Gross — the portal derives net &amp; true cost from payslips.</p>
                          </div>
                        </div>
                      )}
                      {!presignedForExisting && (
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                          <div className="space-y-1.5">
                            <Label className="text-[10px] uppercase tracking-[0.16em] text-foreground/62">First name</Label>
                            <Input value={presignedFirstName} onChange={(e) => setPresignedFirstName(e.target.value)} placeholder="Jane" className="rounded-sm" />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-[10px] uppercase tracking-[0.16em] text-foreground/62">Last name</Label>
                            <Input value={presignedLastName} onChange={(e) => setPresignedLastName(e.target.value)} placeholder="Smith" className="rounded-sm" />
                          </div>
                        </div>
                      )}
                      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                        {!presignedForExisting && (
                          <div className="space-y-1.5">
                            <Label className="text-[10px] uppercase tracking-[0.16em] text-foreground/62">Email</Label>
                            <Input type="email" value={presignedEmail} onChange={(e) => setPresignedEmail(e.target.value)} placeholder="jane@company.com" className="rounded-sm" />
                          </div>
                        )}
                        <div className="space-y-1.5">
                          <Label className="text-[10px] uppercase tracking-[0.16em] text-foreground/62">Date signed</Label>
                          <Input type="date" value={presignedSigningDate} onChange={(e) => setPresignedSigningDate(e.target.value)} className="rounded-sm" />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-[10px] uppercase tracking-[0.16em] text-foreground/62">Document <span className="opacity-50">(optional)</span></Label>
                        <Input value={presignedSubjectLine} onChange={(e) => setPresignedSubjectLine(e.target.value)} placeholder="e.g. Employment Agreement, Variation Letter" className="rounded-sm" />
                        <p className="text-[10px] text-foreground/60">Names the file &amp; labels it in their Documents. A member can have several — upload each one. Defaults by engagement if left blank.</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-4 border-t border-white/[0.07] pt-4">
                      <button type="button" onClick={() => setTeamAddMode("choice")} disabled={isPresignedUploading} className="text-sm text-recessive transition-colors hover:text-standard disabled:opacity-50">
                        Back
                      </button>
                      <Button onClick={handlePresignedUpload} disabled={isPresignedUploading} className="ml-auto flex-1 rounded-sm">
                        {isPresignedUploading ? "Uploading…" : presignedForExisting ? "Upload document" : "Upload & send invite"}
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
                              : "text-foreground/62 cursor-default"
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

      {/* Directory — a slim toolbar (search + archived toggle) sits above the
          content; each section (e.g. Active / Inactive clients) is its own
          lighter zone frame below. */}
      <div>
        <div className={`mb-7 flex items-center justify-between ${clientSectioned ? "" : "border-b border-white/[0.07] pb-3"}`}>
          <div className="flex items-center gap-3">
            {!clientSectioned && <div className="h-px w-6 bg-gold-muted" />}
            {!clientSectioned && <h2 className="text-label">{showArchived ? "Archived" : isTeamOnly ? "Members" : title}</h2>}
            {(archivedCount > 0 || showArchived) && (
              <button
                type="button"
                onClick={() => setShowArchived((v) => !v)}
                className="ml-1 text-[10px] uppercase tracking-[0.16em] text-white/60 transition-colors hover:text-[#ecd39c]"
              >
                {showArchived ? "← Active" : `Archived · ${archivedCount}`}
              </button>
            )}
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
          <div className="ssr-zone">
            <div className="ssr-tile p-12 text-center">
              <p className="text-muted-foreground">
                {searchQuery ? `No ${title.toLowerCase()} match your search` : `No ${title.toLowerCase()} yet`}
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {renderSections.map((section) => (
              <div key={section.label ?? "__all"} className="ssr-zone">
                {section.label && (
                  <div className="mb-6 flex items-center gap-3 border-b border-white/[0.07] pb-3">
                    <div className="h-px w-6 bg-gold-muted" />
                    <h3 className="text-label">{section.label}</h3>
                    <span className="font-sans uppercase text-white/50" style={{ fontSize: 9, letterSpacing: "0.2em" }}>{section.groups.length}</span>
                  </div>
                )}
                <div className="space-y-6">
                  {section.groups.map((group) => {
              const headerClickable = headerNavigatesToProjects;
              const HeaderIcon = isTeamOnly ? Users2 : Building2;
              // Team accounts are one person — show their real name as the title
              // (and drop the duplicate name in the row below).
              const headerTitle = isTeamOnly ? (fullNameOf(group.users[0]) || group.company_name) : group.company_name;
              return (
                <div key={group.account_id} className="ssr-tile overflow-hidden">
                  {/* Account header — clients only; team members render as a single row below */}
                  {!isTeamOnly && (
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
                        {headerTitle}
                      </h3>
                      {showClientCode && group.client_code && (
                        <span
                          className="font-sans uppercase text-foreground/62"
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
                      {showDropdown && renderGroupMenu(group)}
                    </div>
                  </div>
                  )}

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
                      const lastActiveMs = lastActiveMsOf(u.user_id, u.last_login_at);
                      const online = lastActiveMs != null && Date.now() - lastActiveMs < ONLINE_WINDOW_MS;
                      return (
                        <div key={u.user_id}>
                        <div
                          className="flex items-center gap-4 px-5 py-3.5 hover:bg-muted/15 transition-colors"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <span className="font-sans text-sm font-medium text-strong truncate">{displayName}</span>
                              {online ? (
                                <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px]" style={{ color: "#6FBE8A" }}>
                                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: "#6FBE8A", boxShadow: "0 0 6px rgba(111,190,138,0.75)" }} />
                                  Active
                                </span>
                              ) : (
                                <span className="inline-flex shrink-0 items-center gap-1.5 text-[11px] text-recessive">
                                  <span className="h-1.5 w-1.5 rounded-full bg-white/25" />
                                  {lastActiveMs ? timeAgo(new Date(lastActiveMs).toISOString()) : "Never"}
                                </span>
                              )}
                            </div>
                            {u.position && (
                              <p className="mt-1 font-sans uppercase text-[#C9A96A] truncate" style={{ fontSize: 10, letterSpacing: "0.14em" }}>{u.position}</p>
                            )}
                          </div>

                          {/* Action icons grouped by purpose, separated by hairlines:
                              1) Records — schedule / pay / files (view their data)
                              2) Activity — sessions + portal emails (monitor)
                              3) Admin — upload a doc / view-as (act on the account) */}
                          <div className="flex items-center shrink-0 self-start flex-wrap justify-end gap-y-1.5">
                            {/* 1 · Records */}
                            <div className="flex items-center gap-1.5">
                              {isTeamOnly && (
                                <CircleButton
                                  icon={CalendarDays}
                                  label="Calendar"
                                  active={false}
                                  onClick={() => navigate(`/admin/team/${accountId}/calendar`)}
                                />
                              )}
                              {/* Earnings is freelancer-only (employees are salaried → Salary). */}
                              {isTeamOnly && u.employment_type !== "employee" && (
                                <CircleButton
                                  icon={Wallet}
                                  label="Earnings"
                                  active={false}
                                  onClick={() => navigate(`/admin/team/${accountId}/earnings?name=${encodeURIComponent(displayName)}`)}
                                />
                              )}
                              <CircleButton
                                icon={FileText}
                                label="Documents"
                                active={isDocsOpen}
                                onClick={() => togglePanel(u.user_id, "docs", accountId)}
                              />
                            </div>

                            <div className="mx-2 h-4 w-px self-center bg-white/10" />

                            {/* 2 · Activity & comms */}
                            <div className="flex items-center gap-1.5">
                              <CircleButton
                                icon={Clock}
                                label="Sessions & activity"
                                active={isHistoryOpen}
                                onClick={() => togglePanel(u.user_id, "history", accountId)}
                              />
                              <CircleButton
                                icon={Mail}
                                label="Portal emails"
                                active={false}
                                onClick={() => setEmailsModal({ accountId: group.account_id, name: group.company_name || displayName })}
                              />
                            </div>

                            <div className="mx-2 h-4 w-px self-center bg-white/10" />

                            {/* 3 · Admin actions */}
                            <div className="flex items-center gap-1.5">
                              {isTeamOnly && (
                                <CircleButton
                                  icon={FilePlus2}
                                  label="Upload a document"
                                  active={false}
                                  onClick={() => openUploadForMember(u, group.company_name || displayName)}
                                />
                              )}
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
                            </div>
                          </div>
                          {isTeamOnly && showDropdown && (
                            <div className="shrink-0 self-start" onClick={(e) => e.stopPropagation()}>
                              {renderGroupMenu(group)}
                            </div>
                          )}
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
                              <div className="grid grid-cols-1 gap-y-1">
                                {userSessions.slice(0, 10).map((s) => {
                                  const isExp = expandedSessions.has(s.sessionId);
                                  const startMs = new Date(s.start).getTime();
                                  const endMs = startMs + (s.durationMs || 0);
                                  const acts = (activityByAccount.get(accountId) ?? []).filter((ev) => {
                                    const t = new Date(ev.created_at).getTime();
                                    return t >= startMs - 60000 && t <= endMs + 60000;
                                  });
                                  return (
                                    <div key={s.sessionId}>
                                      <button
                                        type="button"
                                        onClick={() => toggleSession(s.sessionId)}
                                        className="w-full flex items-center justify-between gap-3 py-0.5 -mx-1 px-1 rounded-sm text-left hover:bg-muted/20 transition-colors"
                                      >
                                        <span className="font-sans uppercase text-foreground/55 flex items-center gap-1.5" style={{ fontSize: 10, letterSpacing: "0.12em" }}>
                                          <ChevronRight className="h-3 w-3 shrink-0 transition-transform" style={{ transform: isExp ? "rotate(90deg)" : "none" }} strokeWidth={1.5} />
                                          {new Date(s.start).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                                          {" · "}
                                          {new Date(s.start).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                                        </span>
                                        <span className="font-sans uppercase text-foreground/35 tabular-nums" style={{ fontSize: 10, letterSpacing: "0.12em" }}>
                                          {formatSessionDuration(s.durationMs)}
                                          {s.pageViews ? ` · ${s.pageViews} page${s.pageViews === 1 ? "" : "s"}` : ""}
                                        </span>
                                      </button>
                                      {isExp && (
                                        <div className="ml-5 mb-1 border-l border-border/30 pl-3 py-1 flex flex-col gap-y-1">
                                          {activityLoading.has(accountId) ? (
                                            <span className="text-foreground/50 animate-pulse" style={{ fontSize: 10 }}>Loading activity…</span>
                                          ) : acts.length === 0 ? (
                                            <span className="font-sans uppercase text-foreground/50" style={{ fontSize: 9, letterSpacing: "0.14em" }}>No activity in this session</span>
                                          ) : acts.map((ev) => (
                                            <div key={ev.id} className="flex items-baseline justify-between gap-3">
                                              <span className="text-foreground/60 truncate" style={{ fontSize: 11 }}>
                                                {ACTION_LABELS[ev.action] ?? ev.action}{ev.description ? ` — ${ev.description}` : ""}
                                              </span>
                                              <span className="font-sans uppercase text-foreground/50 tabular-nums shrink-0" style={{ fontSize: 9, letterSpacing: "0.12em" }}>
                                                {new Date(ev.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}
                                              </span>
                                            </div>
                                          ))}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            ) : (
                              <p className="text-xs text-foreground/35">No sessions recorded yet.</p>
                            )}
                          </div>
                        )}

                        {isDocsOpen && isTeamOnly && (
                          <TeamDocsPanel accountId={accountId} userId={u.user_id} memberName={displayName} />
                        )}
                        {isDocsOpen && !isTeamOnly && (
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
                                    <p className="text-[10px] uppercase tracking-[0.18em] text-foreground/50 mt-2">
                                      Showing 20 most recent
                                    </p>
                                  )}
                                </>
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
              </div>
            ))}
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
              className="w-full text-[10px] uppercase tracking-[0.2em] text-foreground/50 hover:text-foreground/60 transition-colors pt-2"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      <AccountEmailsModal
        accountId={emailsModal?.accountId ?? null}
        accountName={emailsModal?.name}
        open={!!emailsModal}
        onOpenChange={(o) => { if (!o) setEmailsModal(null); }}
      />

      <Dialog open={!!editMember} onOpenChange={(o) => { if (!o) setEditMember(null); }}>
        <DialogContent className="max-w-md rounded-sm border-divider bg-background">
          <DialogHeader>
            <p className="text-[9px] uppercase tracking-[0.28em] text-foreground/60">Team · Edit member</p>
            <DialogTitle className="font-serif font-normal text-2xl">Edit member</DialogTitle>
          </DialogHeader>
          {editMember && (
            <div className="grid grid-cols-2 gap-4 py-2">
              <div className="space-y-1"><label className="text-xs text-muted-foreground">First name</label>
                <Input value={editMember.firstName} onChange={(e) => setEditMember((m) => m && { ...m, firstName: e.target.value })} /></div>
              <div className="space-y-1"><label className="text-xs text-muted-foreground">Last name</label>
                <Input value={editMember.lastName} onChange={(e) => setEditMember((m) => m && { ...m, lastName: e.target.value })} /></div>
              <div className="col-span-2 space-y-1"><label className="text-xs text-muted-foreground">Engagement</label>
                <select value={editMember.engagement} onChange={(e) => setEditMember((m) => m && { ...m, engagement: e.target.value as "freelancer" | "employee" })}
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring">
                  <option value="freelancer">Freelancer — paid per work</option>
                  <option value="employee">Employee — fixed salary</option>
                </select></div>
              {editMember.engagement === "employee" ? (
                <>
                  <div className="space-y-1"><label className="text-xs text-muted-foreground">Position</label>
                    <Input value={editMember.position} onChange={(e) => setEditMember((m) => m && { ...m, position: e.target.value })} placeholder="Production Director" /></div>
                  <div className="space-y-1"><label className="text-xs text-muted-foreground">Gross salary / yr (£)</label>
                    <Input inputMode="decimal" value={editMember.salary} onChange={(e) => setEditMember((m) => m && { ...m, salary: e.target.value })} placeholder="45000" /></div>
                </>
              ) : (
                <div className="col-span-2 space-y-1"><label className="text-xs text-muted-foreground">Role</label>
                  <Input value={editMember.role} onChange={(e) => setEditMember((m) => m && { ...m, role: e.target.value })} placeholder="Scene Manager / Modeller …" /></div>
              )}
              <div className="col-span-2 space-y-1"><label className="text-xs text-muted-foreground">Start date at the studio</label>
                <Input type="date" value={editMember.startDate} onChange={(e) => setEditMember((m) => m && { ...m, startDate: e.target.value })} />
                <p className="text-[10px] text-muted-foreground/70">Their calendar begins on this day.</p></div>
              <p className="col-span-2 text-[10px] text-muted-foreground/70">Address, phone and bank stay the member’s own — they manage those in their Settings.</p>
            </div>
          )}
          <DialogFooter>
            <button type="button" onClick={() => setEditMember(null)} className="text-sm text-recessive hover:text-standard transition-colors">Cancel</button>
            <Button onClick={saveEditMember} disabled={savingMember} className="rounded-sm">{savingMember ? "Saving…" : "Save changes"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
