import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Search, MoreHorizontal, Mail, Building2, Copy, Check, Trash2, Ghost, Pencil } from "lucide-react";
import { AdminLayout } from "@/components/AdminLayout";
import { supabase, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "@/integrations/supabase/client";
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

// One row per individual user, returned from the admin-list-account-users
// edge function. Rows are grouped by account_id in the render below.
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

export default function AdminClients() {
  const navigate = useNavigate();
  const { enterGhostMode } = useAuth();
  const [accountUsers, setAccountUsers] = useState<AccountUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [form, setForm] = useState({
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
    accountType: "partnership",
  });
  const [isCreating, setIsCreating] = useState(false);
  const [resultBanner, setResultBanner] = useState<{
    email: string;
    inviteUrl?: string;
  } | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [signature, setSignature] = useState("");
  const [isParsing, setIsParsing] = useState(false);
  const [parsedConfirm, setParsedConfirm] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    fetchClients();
  }, []);

  async function fetchClients() {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("No session");
      const res = await fetch(
        `${SUPABASE_URL}/functions/v1/admin-list-account-users?accountTypes=partnership,project`,
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

  // Group AccountUserRow[] by account, then filter by search term across
  // company name OR any individual user's name/email.
  const accountGroups = useMemo<AccountGroup[]>(() => {
    const byId = new Map<string, AccountGroup>();
    for (const u of accountUsers) {
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
    // Sort each group: owners first, then by joined_at ascending.
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
        if (matchesCompany) return g; // whole group
        if (matchingUsers.length === 0) return null;
        return { ...g, users: matchingUsers };
      })
      .filter((g): g is AccountGroup => g !== null);
  }, [accountGroups, searchQuery]);

  const updateForm = (key: keyof typeof form, value: string) =>
    setForm((p) => ({ ...p, [key]: value }));

  const resetForm = () => {
    setForm({
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
      accountType: "partnership",
    });
    setSignature("");
    setParsedConfirm(false);
  };

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
    setIsCreating(true);
    setResultBanner(null);
    try {
      // Direct fetch instead of supabase.functions.invoke so we can read the
      // structured 409 body (`code: ALREADY_REGISTERED | WRONG_CATEGORY`).
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("No session");
      const res = await fetch(`${SUPABASE_URL}/functions/v1/admin-create-client`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          apikey: SUPABASE_PUBLISHABLE_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
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
        }),
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
          return;
        }
        if (data?.code === "WRONG_CATEGORY") {
          toast({
            title: "Wrong category",
            description: data.message,
            variant: "destructive",
          });
          return;
        }
        throw new Error(data?.error || `Request failed (${res.status})`);
      }

      setIsAddDialogOpen(false);
      setResultBanner({
        email: form.email.trim(),
        inviteUrl: data?.inviteUrl,
      });
      toast({
        title: "Client account created — invitation sent",
        description: `An invitation email has been queued for ${form.email}.`,
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
                      <option value="partnership">Partnership</option>
                      <option value="project">Project</option>
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
                </div>
              </div>

              <Button
                className="w-full"
                onClick={handleAddClient}
                disabled={isCreating}
              >
                {isCreating ? "Working…" : "Create account & send invite"}
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
        ) : filteredGroups.length === 0 ? (
          <div className="rounded-lg border border-border bg-card p-12 text-center">
            <p className="text-muted-foreground">
              {searchQuery ? "No clients match your search" : "No clients yet"}
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {filteredGroups.map((group) => (
              <div key={group.account_id} className="rounded-xl border border-border bg-card shadow-sm overflow-hidden">
                {/* Account header — clickable, opens the profile */}
                <div
                  onClick={() => navigate(`/admin/clients/${group.account_id}`)}
                  className="flex items-center justify-between px-5 py-4 bg-muted/10 border-b border-border/40 cursor-pointer hover:bg-muted/20 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <Building2 className="h-3.5 w-3.5 text-gold shrink-0" />
                    <h3 className="font-serif text-sm uppercase tracking-wide text-foreground truncate">
                      {group.company_name}
                    </h3>
                    {group.client_code && (
                      <span
                        className="font-sans uppercase text-foreground/45"
                        style={{ fontSize: 9, letterSpacing: "0.24em" }}
                      >
                        {group.client_code}
                      </span>
                    )}
                    <span
                      className="font-sans uppercase text-foreground/35"
                      style={{ fontSize: 9, letterSpacing: "0.22em" }}
                    >
                      {group.account_type ?? ""}
                    </span>
                  </div>
                  <div className="flex items-center gap-2" onClick={(e) => e.stopPropagation()}>
                    <span className="text-xs text-muted-foreground">
                      {group.users.length} user{group.users.length === 1 ? "" : "s"}
                    </span>
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
                        <DropdownMenuItem onClick={() => navigate(`/admin/clients/${group.account_id}`)}>
                          <Pencil className="mr-2 h-4 w-4" /> Edit profile
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() =>
                            handleDeleteClient(
                              group.account_id,
                              group.company_name,
                              0, // project count no longer tracked here; deletion guard still queries DB
                              group.users.length,
                            )
                          }
                        >
                          <Trash2 className="mr-2 h-4 w-4" /> Delete client
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>

                {/* User rows */}
                <div className="divide-y divide-border/30">
                  {group.users.map((u) => {
                    const displayName = fullNameOf(u);
                    return (
                      <div
                        key={u.user_id}
                        className="flex items-center gap-4 px-5 py-3.5 hover:bg-muted/15 transition-colors"
                      >
                        {/* Ghost — per user */}
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
                                  navigate("/");
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

                        {/* Name + position */}
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

                        {/* Email */}
                        <div className="hidden md:flex items-center gap-2 min-w-0 max-w-[240px]">
                          <Mail className="h-3 w-3 text-foreground/30 shrink-0" />
                          <span className="text-xs text-muted-foreground truncate">{u.email ?? "—"}</span>
                        </div>

                        {/* Last seen */}
                        <div className="text-right shrink-0 min-w-[120px]">
                          {u.last_login_at ? (
                            <>
                              <p className="text-xs text-foreground/65">{timeAgo(u.last_login_at)}</p>
                              <p
                                className="font-sans uppercase text-foreground/30 mt-0.5"
                                style={{ fontSize: 9, letterSpacing: "0.18em" }}
                              >
                                Last seen
                              </p>
                            </>
                          ) : (
                            <p
                              className="font-sans uppercase text-foreground/30"
                              style={{ fontSize: 9, letterSpacing: "0.18em" }}
                            >
                              Never signed in
                            </p>
                          )}
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
    </AdminLayout>
  );
}
