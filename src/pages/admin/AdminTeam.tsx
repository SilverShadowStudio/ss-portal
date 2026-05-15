import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Search, Ghost, ChevronDown, ChevronUp, Clock } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
import { useToast } from "@/hooks/use-toast";

interface TeamMember {
  id: string;
  owner_user_id: string;
  company_name: string;
  owner_full_name: string | null;
  created_at: string;
  profile: { role: string | null; day_rate: number | null } | null;
}

interface Session {
  id: string;
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
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

export default function AdminTeam() {
  const navigate = useNavigate();
  const { enterGhostMode } = useAuth();
  const { toast } = useToast();
  const [members, setMembers]           = useState<TeamMember[]>([]);
  const [sessions, setSessions]         = useState<Record<string, Session[]>>({});
  const [expanded, setExpanded]         = useState<string | null>(null);
  const [loading, setLoading]           = useState(true);
  const [searchQuery, setSearchQuery]   = useState("");
  const [dialogOpen, setDialogOpen]     = useState(false);
  const [inviting, setInviting]         = useState(false);
  const [resultBanner, setResultBanner] = useState<{ email: string; inviteUrl?: string } | null>(null);
  const [form, setForm] = useState({
    firstName: "", lastName: "", email: "",
  });

  useEffect(() => { fetchMembers(); }, []);

  async function fetchMembers() {
    setLoading(true);
    try {
      const { data: accounts } = await supabase
        .from("accounts")
        .select("id, company_name, created_at")
        .eq("account_type", "team")
        .order("created_at", { ascending: false });

      if (!accounts || accounts.length === 0) { setMembers([]); return; }

      const enriched: TeamMember[] = await Promise.all(
        accounts.map(async (acc) => {
          const [{ data: memberRows }, { data: profileRow }] = await Promise.all([
            supabase
              .from("account_members")
              .select("user_id, profiles(full_name)")
              .eq("account_id", acc.id)
              .limit(1)
              .maybeSingle(),
            supabase
              .from("freelancer_profiles")
              .select("role, day_rate")
              .eq("user_id", (
                await supabase
                  .from("account_members")
                  .select("user_id")
                  .eq("account_id", acc.id)
                  .limit(1)
                  .maybeSingle()
              ).data?.user_id ?? "")
              .maybeSingle(),
          ]);
          const ownerUserId = (memberRows as any)?.user_id ?? "";
          const fullName    = (memberRows as any)?.profiles?.full_name ?? null;
          return {
            id:            acc.id,
            owner_user_id: ownerUserId,
            company_name:  acc.company_name,
            owner_full_name: fullName,
            created_at:    acc.created_at,
            profile:       profileRow ?? null,
          };
        })
      );
      setMembers(enriched);
    } catch {
      toast({ title: "Could not load team members", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  async function loadSessions(memberId: string, userId: string) {
    if (sessions[memberId]) return;
    const { data } = await supabase
      .from("client_activity")
      .select("id, started_at, ended_at, duration_ms")
      .eq("user_id", userId)
      .eq("kind", "session_start")
      .order("started_at", { ascending: false })
      .limit(10);
    setSessions((prev) => ({ ...prev, [memberId]: (data as Session[]) || [] }));
  }

  async function handleGhost(member: TeamMember) {
    const { error } = await enterGhostMode({
      userId: member.owner_user_id,
      name:   member.owner_full_name || member.company_name,
    });
    if (error) {
      toast({ title: "Could not enter ghost mode", description: error.message, variant: "destructive" });
    } else {
      navigate("/documents");
    }
  }

  async function handleInvite() {
    if (!form.firstName || !form.lastName || !form.email) {
      toast({ title: "Please fill all fields", variant: "destructive" });
      return;
    }
    setInviting(true);
    try {
      const { data, error } = await supabase.functions.invoke("admin-create-client", {
        body: {
          mode: "invite",
          company: { companyName: `${form.firstName} ${form.lastName}` },
          contact: {
            email:     form.email,
            firstName: form.firstName,
            lastName:  form.lastName,
          },
          accountType: "team",
        },
      });
      if (error) {
        const detail = (data as any)?.error || error.message;
        throw new Error(detail);
      }
      setResultBanner({ email: form.email, inviteUrl: data?.inviteUrl });
      setForm({ firstName: "", lastName: "", email: "" });
      setDialogOpen(false);
      fetchMembers();
    } catch (err: any) {
      toast({ title: "Invite failed", description: err.message, variant: "destructive" });
    } finally {
      setInviting(false);
    }
  }

  const filtered = members.filter((m) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      m.company_name.toLowerCase().includes(q) ||
      (m.owner_full_name ?? "").toLowerCase().includes(q)
    );
  });

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
            <div className="space-y-4 pt-2">
              {(["firstName", "lastName", "email"] as const).map((field) => (
                <div key={field} className="space-y-1">
                  <label className="font-sans uppercase text-foreground/40" style={{ fontSize: 9, letterSpacing: "0.2em" }}>
                    {field === "firstName" ? "First name" : field === "lastName" ? "Last name" : "Email"}
                  </label>
                  <input
                    type={field === "email" ? "email" : "text"}
                    value={form[field]}
                    onChange={(e) => setForm((p) => ({ ...p, [field]: e.target.value }))}
                    className="w-full border-0 border-b border-border bg-transparent py-2 text-foreground focus:outline-none focus:border-gold text-sm"
                  />
                </div>
              ))}
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
      ) : filtered.length === 0 ? (
        <p className="font-serif text-foreground/35 text-sm py-8 border-t border-border/30">
          {searchQuery ? "No members match your search." : "No team members yet."}
        </p>
      ) : (
        <div className="space-y-px">
          {filtered.map((member) => {
            const isExpanded = expanded === member.id;
            const memberSessions = sessions[member.id] || [];
            const hasProfile = !!member.profile;

            return (
              <Collapsible
                key={member.id}
                open={isExpanded}
                onOpenChange={(open) => {
                  setExpanded(open ? member.id : null);
                  if (open) loadSessions(member.id, member.owner_user_id);
                }}
              >
                <div className="flex items-center gap-4 border-t border-border/30 py-4">
                  {/* Ghost icon */}
                  <button
                    onClick={(e) => { e.stopPropagation(); handleGhost(member); }}
                    className="shrink-0 text-foreground/20 hover:text-gold transition-colors"
                    title="View as this member"
                  >
                    <Ghost style={{ width: 14, height: 14 }} strokeWidth={1.5} />
                  </button>

                  {/* Name + meta */}
                  <div className="flex-1 min-w-0">
                    <p className="font-serif text-foreground text-sm">
                      {member.owner_full_name || member.company_name}
                    </p>
                    <p className="font-sans uppercase text-foreground/40 mt-0.5" style={{ fontSize: 9, letterSpacing: "0.18em" }}>
                      {member.profile?.role || "Freelancer"}
                      {member.profile?.day_rate ? ` · £${member.profile.day_rate}/day` : ""}
                      {!hasProfile && " · Onboarding pending"}
                    </p>
                  </div>

                  {/* Sessions toggle */}
                  <CollapsibleTrigger asChild>
                    <button className="shrink-0 flex items-center gap-1.5 text-foreground/30 hover:text-foreground/60 transition-colors">
                      <Clock style={{ width: 12, height: 12 }} strokeWidth={1.5} />
                      {isExpanded ? (
                        <ChevronUp style={{ width: 12, height: 12 }} strokeWidth={1.5} />
                      ) : (
                        <ChevronDown style={{ width: 12, height: 12 }} strokeWidth={1.5} />
                      )}
                    </button>
                  </CollapsibleTrigger>
                </div>

                <CollapsibleContent>
                  <div className="pb-4 pl-8">
                    {memberSessions.length === 0 ? (
                      <p className="font-sans text-foreground/30 text-xs py-2">No sessions recorded</p>
                    ) : (
                      <div className="space-y-1">
                        {memberSessions.map((s) => {
                          const dur = formatDuration(s.duration_ms);
                          return (
                            <div key={s.id} className="flex items-baseline gap-3">
                              <p className="font-sans text-foreground/50" style={{ fontSize: 10, letterSpacing: "0.12em" }}>
                                {formatTime(s.started_at)}
                              </p>
                              {dur && (
                                <p className="font-sans text-foreground/30" style={{ fontSize: 10, letterSpacing: "0.1em" }}>
                                  {dur}
                                </p>
                              )}
                              <p className="font-sans text-foreground/25 ml-auto" style={{ fontSize: 9 }}>
                                {timeAgo(s.started_at)}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>
            );
          })}
        </div>
      )}
    </AdminLayout>
  );
}
