import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Search, MoreHorizontal, Mail, Building2, Copy, Check, Trash2, Ghost, Pencil, ChevronDown, ChevronUp, Clock } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { ClientActivityPanel } from "@/components/admin/ClientActivityPanel";
import { AdminLayout } from "@/components/AdminLayout";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";

interface Client {
  id: string; // account id
  owner_user_id: string;
  company_name: string;
  owner_full_name: string | null;
  owner_position: string | null;
  memberCount: number;
  projectCount: number;
  created_at: string;
}

interface Connection {
  id: string;
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
  path: string | null;
}

function timeAgo(iso: string) {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric", month: "short",
    hour: "2-digit", minute: "2-digit",
  });
}

function formatDuration(ms: number | null) {
  if (!ms || ms < 1000) return null;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export default function AdminClients() {
  const navigate = useNavigate();
  const { enterGhostMode } = useAuth();
  const [clients, setClients] = useState<Client[]>([]);
  const [connections, setConnections] = useState<Record<string, Connection[]>>({});
  const [expandedClient, setExpandedClient] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [mode, setMode] = useState<"invite" | "provision">("invite");
  const [form, setForm] = useState({
    companyName: "",
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
    tempPassword: "",
    accountType: "partnership",
  });
  const [isCreating, setIsCreating] = useState(false);
  const [resultBanner, setResultBanner] = useState<{
    mode: "invite" | "provision";
    email: string;
    inviteUrl?: string;
    tempPassword?: string;
  } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    fetchClients();
  }, []);

  async function fetchClients() {
    try {
      // 1) All client accounts (companies)
      const { data: accounts, error: accountsError } = await supabase
        .from("accounts")
        .select("id, company_name, owner_user_id, created_at")
        .order("created_at", { ascending: false });
      if (accountsError) throw accountsError;

      const ownerIds = (accounts || []).map((a) => a.owner_user_id);
      const accountIds = (accounts || []).map((a) => a.id);

      // 2) Owner profiles for contact name / position
      const { data: ownerProfiles } = ownerIds.length
        ? await supabase
            .from("profiles")
            .select("user_id, full_name, first_name, last_name, position")
            .in("user_id", ownerIds)
        : { data: [] as any[] };

      // 3) Admin user_ids — to filter the studio's own internal accounts out
      const { data: adminRoles } = await supabase
        .from("user_roles")
        .select("user_id")
        .eq("role", "admin");
      const adminIds = new Set((adminRoles || []).map((r) => r.user_id));

      // 4) Member counts per account
      const { data: members } = accountIds.length
        ? await supabase
            .from("account_members")
            .select("account_id")
            .in("account_id", accountIds)
        : { data: [] as any[] };
      const memberCounts = new Map<string, number>();
      (members || []).forEach((m: any) => {
        memberCounts.set(m.account_id, (memberCounts.get(m.account_id) || 0) + 1);
      });

      // 5) Project counts per account
      const { data: projects } = accountIds.length
        ? await supabase
            .from("projects")
            .select("account_id")
            .in("account_id", accountIds)
        : { data: [] as any[] };
      const projectCounts = new Map<string, number>();
      (projects || []).forEach((p: any) => {
        if (!p.account_id) return;
        projectCounts.set(p.account_id, (projectCounts.get(p.account_id) || 0) + 1);
      });

      const profileMap = new Map<string, any>();
      (ownerProfiles || []).forEach((p: any) => profileMap.set(p.user_id, p));

      const clientList: Client[] = (accounts || [])
        .filter((a) => !adminIds.has(a.owner_user_id))
        .map((a) => {
          const op = profileMap.get(a.owner_user_id);
          const fullName =
            op?.full_name ||
            [op?.first_name, op?.last_name].filter(Boolean).join(" ") ||
            null;
          return {
            id: a.id,
            owner_user_id: a.owner_user_id,
            company_name: a.company_name,
            owner_full_name: fullName,
            owner_position: op?.position ?? null,
            memberCount: memberCounts.get(a.id) || 0,
            projectCount: projectCounts.get(a.id) || 0,
            created_at: a.created_at,
          };
        });

      setClients(clientList);

      // Fetch last 10 connections per client with end time and duration
      const clientUserIds = clientList.map(c => c.owner_user_id).filter(Boolean);
      if (clientUserIds.length) {
        // Fetch session_start events
        const { data: starts } = await supabase
          .from("client_activity")
          .select("id, user_id, started_at, ended_at, duration_ms, path, session_id")
          .in("user_id", clientUserIds)
          .eq("kind", "session_start")
          .order("started_at", { ascending: false })
          .limit(clientUserIds.length * 10);

        // Fetch corresponding session_end events
        const sessionIds = (starts || []).map((s: any) => s.session_id).filter(Boolean);
        let endMap: Record<string, { ended_at: string; duration_ms: number | null }> = {};
        if (sessionIds.length) {
          const { data: ends } = await supabase
            .from("client_activity")
            .select("session_id, started_at, duration_ms")
            .in("session_id", sessionIds)
            .eq("kind", "session_end");
          (ends || []).forEach((e: any) => {
            if (e.session_id) endMap[e.session_id] = { ended_at: e.started_at, duration_ms: e.duration_ms };
          });
        }

        const byUser: Record<string, Connection[]> = {};
        (starts || []).forEach((row: any) => {
          if (!byUser[row.user_id]) byUser[row.user_id] = [];
          if (byUser[row.user_id].length < 10) {
            const end = row.session_id ? endMap[row.session_id] : null;
            byUser[row.user_id].push({
              id: row.id,
              started_at: row.started_at,
              ended_at: end?.ended_at || row.ended_at || null,
              duration_ms: end?.duration_ms || row.duration_ms || null,
              path: row.path,
            });
          }
        });
        setConnections(byUser);
      }
    } catch (error) {
      console.error("Error fetching clients:", error);
      toast({
        title: "Error",
        description: "Failed to load clients",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }

  const filteredClients = clients.filter((client) => {
    const searchLower = searchQuery.toLowerCase();
    return (
      client.company_name?.toLowerCase().includes(searchLower) ||
      client.owner_full_name?.toLowerCase().includes(searchLower)
    );
  });

  const updateForm = (key: keyof typeof form, value: string) =>
    setForm((p) => ({ ...p, [key]: value }));

  const resetForm = () =>
    setForm({
      companyName: "",
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
      tempPassword: "",
    });

  const handleCopy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // ignore
    }
  };

  const handleAddClient = async () => {
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
    if (mode === "provision" && form.tempPassword && form.tempPassword.length < 8) {
      toast({
        title: "Password too short",
        description: "Temporary password must be at least 8 characters (or leave blank to auto-generate).",
        variant: "destructive",
      });
      return;
    }

    setIsCreating(true);
    setResultBanner(null);
    try {
      const { data, error } = await supabase.functions.invoke(
        "admin-create-client",
        {
          body: {
            mode,
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
            ...(mode === "provision" && form.tempPassword.trim()
              ? { tempPassword: form.tempPassword.trim() }
              : {}),
          },
        },
      );
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setResultBanner({
        mode,
        email: form.email.trim(),
        inviteUrl: data?.inviteUrl,
        tempPassword: data?.tempPassword,
      });
      toast({
        title:
          mode === "invite"
            ? "Client account created — invitation sent"
            : "Client account provisioned",
        description:
          mode === "invite"
            ? `An invitation email has been queued for ${form.email}.`
            : `${form.email} can now sign in.`,
      });
      const clientLabel = [form.firstName.trim(), form.lastName.trim()].filter(Boolean).join(" ") || form.companyName.trim();
      const { logActivity } = await import("@/lib/activityLog");
      await logActivity({
        action: "client_created",
        description: `Added client ${clientLabel}`,
        actorRole: "admin",
      });
      resetForm();
      fetchClients();
    } catch (err: any) {
      console.error("Failed to create client", err);
      toast({
        title: "Failed to create client",
        description: err?.message || "Unexpected error",
        variant: "destructive",
      });
    } finally {
      setIsCreating(false);
    }
  };

  const handleMakeAdmin = async (userId: string, clientName: string) => {
    try {
      const { error } = await supabase
        .from("user_roles")
        .upsert({ user_id: userId, role: "admin" });

      if (error) throw error;

      toast({
        title: "Role Updated",
        description: `${clientName} is now an admin.`,
      });
    } catch (error) {
      console.error("Error updating role:", error);
      toast({
        title: "Error",
        description: "Failed to update role",
        variant: "destructive",
      });
    }
  };

  const handleDeleteClient = async (
    accountId: string,
    companyName: string,
    projectCount: number,
    memberCount: number,
  ) => {
    const confirmed = window.confirm(
      `Permanently delete "${companyName}"?\n\n` +
        `This will also remove ${projectCount} project(s) and ${memberCount} member link(s) tied to this client. ` +
        `This action cannot be undone.`,
    );
    if (!confirmed) return;
    try {
      const { error } = await supabase.from("accounts").delete().eq("id", accountId);
      if (error) throw error;
      toast({ title: "Client deleted", description: companyName });
      fetchClients();
    } catch (e: any) {
      toast({
        title: "Could not delete client",
        description: e?.message || "Unknown error",
        variant: "destructive",
      });
    }
  };

  return (
    <AdminLayout>
      {/* Header */}
      <div className="mb-10 flex items-end justify-between animate-fade-in">
        <div>
          <div className="mb-4 flex items-center gap-3">
            <div className="h-px w-12 bg-gold-muted" />
            <span className="text-label-gold">Client Management</span>
          </div>
          <h1 className="font-serif text-4xl font-normal tracking-tight text-foreground md:text-5xl mb-4">
            CLIENTS
          </h1>
          <p className="text-sm text-muted-foreground">Manage all studio clients and their access.</p>
        </div>
        <Dialog
          open={isAddDialogOpen}
          onOpenChange={(open) => {
            setIsAddDialogOpen(open);
            if (!open) {
              setResultBanner(null);
              resetForm();
              setMode("invite");
            }
          }}
        >
          <DialogTrigger asChild>
            <Button className="gap-2">
              <Plus className="h-4 w-4" />
              Add Client
            </Button>
          </DialogTrigger>
          <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Add a new client</DialogTitle>
            </DialogHeader>
            <div className="space-y-6 pt-2">
              {/* Mode selector */}
              <div className="grid grid-cols-2 gap-2 rounded-lg border border-border bg-secondary/40 p-1">
                <button
                  type="button"
                  onClick={() => setMode("invite")}
                  className={`rounded-md px-3 py-2 text-xs uppercase tracking-wider transition-colors ${
                    mode === "invite"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Send invite link
                </button>
                <button
                  type="button"
                  onClick={() => setMode("provision")}
                  className={`rounded-md px-3 py-2 text-xs uppercase tracking-wider transition-colors ${
                    mode === "provision"
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Provision now
                </button>
              </div>
              <p className="-mt-3 text-xs text-muted-foreground">
                {mode === "invite"
                  ? "We'll create the account with the company details below and email the contact a link to set their own password."
                  : "We'll create the account and the login immediately. You'll receive a temporary password to share with the client."}
              </p>

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
                      <option value="partnership">Partnership</option>
                      <option value="project">Project</option>
                    </select>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Country</label>
                    <Input
                      value={form.country}
                      onChange={(e) => updateForm("country", e.target.value)}
                      placeholder="United Kingdom"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Registration number</label>
                    <Input
                      value={form.registrationNumber}
                      onChange={(e) => updateForm("registrationNumber", e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Street name</label>
                    <Input
                      value={form.streetName}
                      onChange={(e) => updateForm("streetName", e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Building number</label>
                    <Input
                      value={form.buildingNumber}
                      onChange={(e) => updateForm("buildingNumber", e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">City</label>
                    <Input
                      value={form.city}
                      onChange={(e) => updateForm("city", e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Postcode</label>
                    <Input
                      value={form.postcode}
                      onChange={(e) => updateForm("postcode", e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* Contact section */}
              <div className="space-y-3">
                <div className="text-label text-muted-foreground">CONTACT PERSON</div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">First name</label>
                    <Input
                      value={form.firstName}
                      onChange={(e) => updateForm("firstName", e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Last name</label>
                    <Input
                      value={form.lastName}
                      onChange={(e) => updateForm("lastName", e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-muted-foreground">Position</label>
                    <Input
                      value={form.position}
                      onChange={(e) => updateForm("position", e.target.value)}
                    />
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
                  {mode === "provision" && (
                    <div className="sm:col-span-2 space-y-1">
                      <label className="text-xs text-muted-foreground">
                        Temporary password (optional — leave blank to auto-generate)
                      </label>
                      <Input
                        type="text"
                        value={form.tempPassword}
                        onChange={(e) => updateForm("tempPassword", e.target.value)}
                        placeholder="Auto-generated if empty"
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Result banner */}
              {resultBanner && (
                <div className="rounded-lg border border-gold/40 bg-[#181613] p-4 space-y-3">
                  <div className="text-label-gold">
                    {resultBanner.mode === "invite"
                      ? "INVITATION READY"
                      : "ACCOUNT PROVISIONED"}
                  </div>
                  <p className="text-sm text-foreground">
                    {resultBanner.mode === "invite"
                      ? `An email is on its way to ${resultBanner.email}. You can also share the link below directly.`
                      : `${resultBanner.email} can now sign in. Share the temporary password below — they should change it on first login.`}
                  </p>
                  {resultBanner.inviteUrl && (
                    <div className="flex items-center gap-2 rounded-md bg-background border border-border px-3 py-2">
                      <span className="text-xs text-muted-foreground truncate flex-1">
                        {resultBanner.inviteUrl}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          handleCopy("invite", resultBanner.inviteUrl!)
                        }
                        className="flex h-7 w-7 items-center justify-center rounded hover:bg-secondary"
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
                  {resultBanner.tempPassword && (
                    <div className="flex items-center gap-2 rounded-md bg-background border border-border px-3 py-2">
                      <span className="text-xs text-muted-foreground">Temp password:</span>
                      <code className="text-xs text-foreground flex-1">
                        {resultBanner.tempPassword}
                      </code>
                      <button
                        type="button"
                        onClick={() =>
                          handleCopy("password", resultBanner.tempPassword!)
                        }
                        className="flex h-7 w-7 items-center justify-center rounded hover:bg-secondary"
                        title="Copy password"
                      >
                        {copied === "password" ? (
                          <Check className="h-3.5 w-3.5 text-gold" />
                        ) : (
                          <Copy className="h-3.5 w-3.5 text-muted-foreground" />
                        )}
                      </button>
                    </div>
                  )}
                </div>
              )}

              <Button
                className="w-full"
                onClick={handleAddClient}
                disabled={isCreating}
              >
                {isCreating
                  ? "Working…"
                  : mode === "invite"
                    ? "Create account & send invite"
                    : "Create account & login"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {/* Search */}
      <div className="mb-8 animate-fade-in" style={{ animationDelay: "0.1s" }}>
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search clients..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {/* Clients List */}
      <div className="animate-fade-in" style={{ animationDelay: "0.15s" }}>
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-gold border-t-transparent" />
          </div>
        ) : filteredClients.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-12 text-center">
            <p className="text-muted-foreground">
              {searchQuery ? "No clients match your search" : "No clients yet"}
            </p>
          </div>
        ) : (
          <div className="rounded-xl border border-border bg-card shadow-sm p-2 md:p-3">
            <div className="divide-y divide-border/40">
            {filteredClients.map((client) => (
              <div key={client.id}>
              <div
                onClick={() =>
                  navigate(`/admin/projects?client=${client.owner_user_id}`)
                }
                className="flex items-center justify-between p-4 transition-colors hover:bg-muted/30 rounded-lg cursor-pointer"
              >
                <div className="flex items-center gap-4">
                  {/* Ghost circle — click to enter ghost mode */}
                  <TooltipProvider delayDuration={150}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (!client.owner_user_id) return;
                            const { error } = await enterGhostMode({
                              userId: client.owner_user_id,
                              name: client.owner_full_name || client.company_name,
                            });
                            if (error) {
                              toast({ title: "Ghost Mode failed", description: error.message, variant: "destructive" });
                              return;
                            }
                            navigate("/");
                          }}
                          className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary hover:bg-[#1C1A17] border border-transparent hover:border-gold/40 transition-all shrink-0"
                          aria-label="Enter Ghost Mode"
                        >
                          <Ghost className="h-4 w-4 text-gold/60" strokeWidth={1.5} />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="right">
                        View as {client.owner_full_name || client.company_name}
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                  <div>
                    <h3 className="font-serif text-sm uppercase tracking-wide text-foreground flex items-center gap-2">
                      <Building2 className="h-3 w-3 text-gold" />
                      {client.company_name}
                    </h3>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <span>{client.owner_full_name || "Owner pending"}</span>
                      <span>{client.memberCount} member{client.memberCount === 1 ? "" : "s"}</span>
                      <span>{client.projectCount} project{client.projectCount === 1 ? "" : "s"}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                  {/* Connections toggle */}
                  <TooltipProvider delayDuration={150}>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          onClick={(e) => { e.stopPropagation(); setExpandedClient(expandedClient === client.id ? null : client.id); }}
                          className="flex items-center gap-1.5 h-8 px-2 rounded text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors text-xs"
                          title="Last connections"
                        >
                          <Clock className="h-3.5 w-3.5" strokeWidth={1.5} />
                          <span>{(connections[client.owner_user_id] || []).length || "—"}</span>
                          {expandedClient === client.id ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent side="top">Last connections</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
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
                      <DropdownMenuItem
                        onClick={() => navigate(`/admin/clients/${client.id}`)}
                      >
                        <Pencil className="mr-2 h-4 w-4" /> Edit profile
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleMakeAdmin(client.owner_user_id, client.owner_full_name || client.company_name)}>
                        Make Admin
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        className="text-destructive focus:text-destructive"
                        onClick={() =>
                          handleDeleteClient(
                            client.id,
                            client.company_name,
                            client.projectCount,
                            client.memberCount,
                          )
                        }
                      >
                        <Trash2 className="mr-2 h-4 w-4" /> Delete client
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
              {/* Connections panel — expanded inline */}
              {expandedClient === client.id && (
                <div className="px-4 pb-4 bg-muted/10 border-t border-border/20" onClick={(e) => e.stopPropagation()}>
                  <p className="text-[9px] font-sans uppercase tracking-[0.28em] text-foreground/40 pt-3 pb-2">
                    Last connections
                  </p>
                  {(connections[client.owner_user_id] || []).length === 0 ? (
                    <p className="text-xs text-muted-foreground py-1">No connections recorded yet.</p>
                  ) : (
                    <div className="space-y-0.5">
                      {(connections[client.owner_user_id] || []).map((conn) => (
                        <div key={conn.id} className="flex items-start gap-3 py-2 border-t border-border/20 first:border-0">
                          <div className="h-1.5 w-1.5 rounded-full bg-gold/40 shrink-0 mt-1.5" />
                          <div className="flex-1 min-w-0">
                            <p className="text-xs text-foreground/60 truncate">{conn.path || "/"}</p>
                            <p className="text-[10px] text-foreground/35 mt-0.5">
                              {formatTime(conn.started_at)}
                              {conn.ended_at && ` → ${formatTime(conn.ended_at)}`}
                              {formatDuration(conn.duration_ms) && (
                                <span className="ml-2 text-foreground/25">{formatDuration(conn.duration_ms)}</span>
                              )}
                            </p>
                          </div>
                          <p className="text-[10px] text-foreground/30 shrink-0 mt-0.5">{timeAgo(conn.started_at)}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              </div>
            ))}
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
