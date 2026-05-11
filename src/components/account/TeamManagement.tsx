import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { Loader2, Mail, UserMinus, X } from "lucide-react";

interface AccountInfo {
  id: string;
  company_name: string;
  owner_user_id: string;
}

interface MemberRow {
  id: string;
  user_id: string;
  role: string;
  joined_at: string;
  profile?: {
    full_name: string | null;
    first_name: string | null;
    last_name: string | null;
  } | null;
  email?: string | null;
}

interface InviteRow {
  id: string;
  email: string;
  role: string;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
}

export function TeamManagement() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [account, setAccount] = useState<AccountInfo | null>(null);
  const [isOwner, setIsOwner] = useState(false);
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [invites, setInvites] = useState<InviteRow[]>([]);
  const [inviteEmail, setInviteEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);

  const loadAll = async () => {
    if (!user) return;

    // Find the account this user belongs to (and their role)
    const { data: membership } = await supabase
      .from("account_members")
      .select("account_id, role")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!membership) {
      setLoading(false);
      return;
    }

    const { data: acc } = await supabase
      .from("accounts")
      .select("id, company_name, owner_user_id")
      .eq("id", membership.account_id)
      .maybeSingle();

    if (!acc) {
      setLoading(false);
      return;
    }

    setAccount(acc);
    setIsOwner(membership.role === "owner" || acc.owner_user_id === user.id);

    // Load members + their profiles in parallel
    const [{ data: memberRows }, { data: inviteRows }] = await Promise.all([
      supabase
        .from("account_members")
        .select("id, user_id, role, joined_at")
        .eq("account_id", acc.id)
        .order("joined_at", { ascending: true }),
      supabase
        .from("account_invitations")
        .select("id, email, role, created_at, expires_at, accepted_at, revoked_at")
        .eq("account_id", acc.id)
        .order("created_at", { ascending: false }),
    ]);

    let enrichedMembers: MemberRow[] = memberRows ?? [];
    if (enrichedMembers.length > 0) {
      const userIds = enrichedMembers.map((m) => m.user_id);
      const { data: profiles } = await supabase
        .from("profiles")
        .select("user_id, full_name, first_name, last_name")
        .in("user_id", userIds);
      const profileMap = new Map(profiles?.map((p) => [p.user_id, p]) ?? []);
      enrichedMembers = enrichedMembers.map((m) => ({
        ...m,
        profile: profileMap.get(m.user_id) ?? null,
      }));
    }

    setMembers(enrichedMembers);
    setInvites(inviteRows ?? []);
    setLoading(false);
  };

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!account) return;
    const email = inviteEmail.trim().toLowerCase();
    if (!email) return;

    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-team-invitation", {
        body: { accountId: account.id, email },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      toast.success("Invitation sent");
      setInviteEmail("");
      await loadAll();
    } catch (err: any) {
      toast.error(err?.message || "Failed to send invitation");
    } finally {
      setSending(false);
    }
  };

  const handleRevoke = async (inviteId: string) => {
    setRevoking(inviteId);
    try {
      const { error } = await supabase
        .from("account_invitations")
        .update({ revoked_at: new Date().toISOString() })
        .eq("id", inviteId);
      if (error) throw error;
      toast.success("Invitation revoked");
      await loadAll();
    } catch (err: any) {
      toast.error(err?.message || "Failed to revoke invitation");
    } finally {
      setRevoking(null);
    }
  };

  const handleRemoveMember = async (memberId: string, memberUserId: string) => {
    if (memberUserId === user?.id) {
      toast.error("You cannot remove yourself");
      return;
    }
    if (!confirm("Remove this member from the team? They will lose access.")) return;
    setRemoving(memberId);
    try {
      const { error } = await supabase
        .from("account_members")
        .delete()
        .eq("id", memberId);
      if (error) throw error;
      toast.success("Member removed");
      await loadAll();
    } catch (err: any) {
      toast.error(err?.message || "Failed to remove member");
    } finally {
      setRemoving(null);
    }
  };

  const memberDisplayName = (m: MemberRow) =>
    m.profile?.full_name ||
    [m.profile?.first_name, m.profile?.last_name].filter(Boolean).join(" ") ||
    "Team member";

  if (loading) {
    return (
      <div className="card-elevated p-6 flex items-center justify-center">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!account) {
    return (
      <div className="card-elevated p-6">
        <p className="text-sm text-muted-foreground">
          You are not currently part of a team account.
        </p>
      </div>
    );
  }

  const pendingInvites = invites.filter(
    (i) => !i.accepted_at && !i.revoked_at && new Date(i.expires_at) > new Date(),
  );

  return (
    <div className="space-y-6">
      {/* Invite form (owners only) */}
      {isOwner && (
        <div className="card-elevated p-6 space-y-4">
          <div>
            <p className="text-sm text-foreground font-medium">Invite a team member</p>
            <p className="text-xs text-muted-foreground mt-1">
              Invitees receive an email with a link to join {account.company_name}.
            </p>
          </div>
          <form onSubmit={handleInvite} className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-2">
              <Label
                htmlFor="invite-email"
                className="text-xs uppercase tracking-wider text-muted-foreground"
              >
                Email address
              </Label>
              <Input
                id="invite-email"
                type="email"
                required
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="teammate@company.com"
                className="bg-background border-border"
                maxLength={255}
              />
            </div>
            <Button
              type="submit"
              disabled={sending || !inviteEmail.trim()}
              className="border border-gold bg-transparent text-gold hover:bg-[#1C1A17]"
            >
              {sending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Mail className="h-4 w-4 mr-2" />
                  SEND INVITE
                </>
              )}
            </Button>
          </form>
        </div>
      )}

      {/* Members list */}
      <div className="card-elevated p-6">
        <p className="text-sm text-foreground font-medium mb-4">
          Members ({members.length})
        </p>
        <div className="divide-y divide-border">
          {members.map((m) => {
            const isSelf = m.user_id === user?.id;
            const isAccountOwner = m.user_id === account.owner_user_id;
            return (
              <div
                key={m.id}
                className="flex items-center justify-between py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground truncate">
                    {memberDisplayName(m)}
                    {isSelf && (
                      <span className="text-xs text-muted-foreground ml-2">(you)</span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Joined {new Date(m.joined_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge
                    variant="outline"
                    className="text-xs uppercase tracking-wider border-border"
                  >
                    {isAccountOwner ? "Owner" : m.role}
                  </Badge>
                  {isOwner && !isSelf && !isAccountOwner && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={removing === m.id}
                      onClick={() => handleRemoveMember(m.id, m.user_id)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      {removing === m.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <UserMinus className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Pending invitations */}
      {pendingInvites.length > 0 && (
        <div className="card-elevated p-6">
          <p className="text-sm text-foreground font-medium mb-4">
            Pending invitations ({pendingInvites.length})
          </p>
          <div className="divide-y divide-border">
            {pendingInvites.map((inv) => (
              <div
                key={inv.id}
                className="flex items-center justify-between py-3 first:pt-0 last:pb-0"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground truncate">{inv.email}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Sent {new Date(inv.created_at).toLocaleDateString()} · Expires{" "}
                    {new Date(inv.expires_at).toLocaleDateString()}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <Badge
                    variant="outline"
                    className="text-xs uppercase tracking-wider border-border text-muted-foreground"
                  >
                    Pending
                  </Badge>
                  {isOwner && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={revoking === inv.id}
                      onClick={() => handleRevoke(inv.id)}
                      className="text-muted-foreground hover:text-destructive"
                    >
                      {revoking === inv.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <X className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}