import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Search, Ghost, Mail, Users2 } from "lucide-react";
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
import { useToast } from "@/hooks/use-toast";

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

export default function AdminTeam() {
  const navigate = useNavigate();
  const { enterGhostMode } = useAuth();
  const { toast } = useToast();
  const [accountUsers, setAccountUsers] = useState<AccountUserRow[]>([]);
  const [loading, setLoading]           = useState(true);
  const [searchQuery, setSearchQuery]   = useState("");
  const [dialogOpen, setDialogOpen]     = useState(false);
  const [inviting, setInviting]         = useState(false);
  const [resultBanner, setResultBanner] = useState<{ email: string; inviteUrl?: string } | null>(null);
  const [inviteEmail, setInviteEmail]   = useState("");

  useEffect(() => { fetchMembers(); }, []);

  async function fetchMembers() {
    setLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("No session");
      const res = await fetch(
        `${SUPABASE_URL}/functions/v1/admin-list-account-users?accountTypes=team`,
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
    } catch (err) {
      console.error("Failed to load team members:", err);
      toast({ title: "Could not load team members", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function handleGhost(u: AccountUserRow) {
    const { error } = await enterGhostMode({
      userId: u.user_id,
      name:   fullNameOf(u),
    });
    if (error) {
      toast({ title: "Could not enter ghost mode", description: error.message, variant: "destructive" });
    } else {
      navigate("/documents");
    }
  }

  const accountGroups = useMemo<AccountGroup[]>(() => {
    const byId = new Map<string, AccountGroup>();
    for (const u of accountUsers) {
      let g = byId.get(u.account_id);
      if (!g) {
        g = { account_id: u.account_id, company_name: u.company_name, users: [] };
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
    return Array.from(byId.values()).sort((a, b) => a.company_name.localeCompare(b.company_name));
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

  async function handleInvite() {
    const email = inviteEmail.trim().toLowerCase();
    if (!email) {
      toast({ title: "Please enter an email address", variant: "destructive" });
      return;
    }
    setInviting(true);
    try {
      // Direct fetch so we can read the structured 409 body
      // (`code: ALREADY_REGISTERED | WRONG_CATEGORY`).
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
          company: { companyName: email },
          contact: { email },
          accountType: "team",
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
      setResultBanner({ email, inviteUrl: data?.inviteUrl });
      setInviteEmail("");
      setDialogOpen(false);
      fetchMembers();
    } catch (err: any) {
      toast({ title: "Invite failed", description: err.message, variant: "destructive" });
    } finally {
      setInviting(false);
    }
  }

  return (
    <AdminLayout>
      <div className="mb-12">
        <h1 className="font-serif font-normal text-foreground" style={{ fontSize: "2.4rem", letterSpacing: "-0.005em" }}>
          Team
        </h1>
        <p className="mt-2 font-sans uppercase text-foreground/40" style={{ fontSize: 9, letterSpacing: "0.24em" }}>
          Freelancers and team members
        </p>
      </div>

      {resultBanner && (
        <div className="mb-8 border border-gold/30 bg-gold/5 px-5 py-4">
          <p className="font-sans text-sm text-foreground/80">
            Invite sent to <span className="text-gold">{resultBanner.email}</span>
          </p>
          {resultBanner.inviteUrl && (
            <p className="mt-1 font-sans text-xs text-foreground/50 break-all">{resultBanner.inviteUrl}</p>
          )}
          <button
            onClick={() => setResultBanner(null)}
            className="mt-2 font-sans uppercase text-foreground/40 hover:text-foreground transition-colors"
            style={{ fontSize: 9, letterSpacing: "0.18em" }}
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="mb-8 flex items-center gap-4">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-foreground/30" style={{ width: 13, height: 13 }} />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search members"
            className="pl-9 bg-transparent border-border/40 focus:border-gold/50 font-sans text-sm"
          />
        </div>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button variant="outline" className="gap-2 font-sans uppercase border-border/40 hover:border-gold/50 hover:bg-transparent" style={{ fontSize: 10, letterSpacing: "0.16em" }}>
              <Plus style={{ width: 13, height: 13 }} />
              Add member
            </Button>
          </DialogTrigger>
          <DialogContent className="bg-background border-border/50 max-w-md">
            <DialogHeader>
              <DialogTitle className="font-serif font-normal text-xl">Add team member</DialogTitle>
            </DialogHeader>
            <p className="font-sans text-foreground/40 text-xs mt-1">
              They'll enter their name and details during onboarding.
            </p>
            <div className="space-y-4 pt-2">
              <div className="space-y-1">
                <label className="font-sans uppercase text-foreground/40" style={{ fontSize: 9, letterSpacing: "0.2em" }}>
                  Email
                </label>
                <input
                  type="email"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleInvite()}
                  autoFocus
                  className="w-full border-0 border-b border-border bg-transparent py-2 text-foreground focus:outline-none focus:border-gold text-sm"
                />
              </div>
              <Button
                onClick={handleInvite}
                disabled={inviting}
                className="w-full mt-2 bg-foreground text-background hover:bg-foreground/90 font-sans uppercase"
                style={{ fontSize: 10, letterSpacing: "0.18em" }}
              >
                {inviting ? "Sending..." : "Send invite"}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-gold border-t-transparent" />
        </div>
      ) : filteredGroups.length === 0 ? (
        <p className="font-serif text-foreground/35 text-sm py-8 border-t border-border/30">
          {searchQuery ? "No members match your search." : "No team members yet."}
        </p>
      ) : (
        <div className="space-y-6">
          {filteredGroups.map((group) => (
            <div key={group.account_id} className="rounded-xl border border-border bg-card overflow-hidden">
              {/* Account header */}
              <div className="flex items-center justify-between px-5 py-4 bg-muted/10 border-b border-border/40">
                <div className="flex items-center gap-3 min-w-0">
                  <Users2 className="h-3.5 w-3.5 text-gold shrink-0" />
                  <h3 className="font-serif text-sm uppercase tracking-wide text-foreground truncate">
                    {group.company_name}
                  </h3>
                  <span
                    className="font-sans uppercase text-foreground/35"
                    style={{ fontSize: 9, letterSpacing: "0.22em" }}
                  >
                    Team
                  </span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {group.users.length} member{group.users.length === 1 ? "" : "s"}
                </span>
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
                      <button
                        onClick={() => handleGhost(u)}
                        className="flex h-9 w-9 items-center justify-center rounded-full bg-secondary hover:bg-[#1C1A17] border border-transparent hover:border-gold/40 transition-all shrink-0 opacity-25 hover:opacity-70"
                        aria-label={`Ghost as ${displayName}`}
                        title={`View as ${displayName}`}
                      >
                        <Ghost className="h-3.5 w-3.5 text-gold/60" strokeWidth={1.5} />
                      </button>

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
    </AdminLayout>
  );
}
