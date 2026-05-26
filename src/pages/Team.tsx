import { useEffect, useState, useCallback } from "react";
import { ClientLayout } from "@/components/ClientLayout";
import { useAuth } from "@/contexts/AuthContext";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { BrandLoader } from "@/components/ui/BrandLoader";
import { toast } from "sonner";
import { UserPlus, UserMinus, ArrowUpCircle, MoreHorizontal, X } from "lucide-react";

interface Member {
  id: string;
  user_id: string;
  role: string;
  pin_colour: string | null;
  joined_at: string;
}

interface Invite {
  id: string;
  email: string;
  accepted_at: string | null;
  accepted_user_id: string | null;
  revoked_at: string | null;
  expires_at: string;
  created_at: string;
}

type Profile = { first_name: string | null; last_name: string | null; full_name: string | null };
type ActionKind = "promote" | "demote" | "remove";

const GOLD = "#B89A6A";

export default function Team() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [profiles, setProfiles] = useState<Record<string, Profile>>({});
  const [emailByUser, setEmailByUser] = useState<Record<string, string>>({});
  const [pendingInvites, setPendingInvites] = useState<Invite[]>([]);

  const [inviteOpen, setInviteOpen] = useState(false);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [position, setPosition] = useState("");
  const [sending, setSending] = useState(false);

  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<{ kind: ActionKind; member: Member } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    // Resolve the caller's account.
    const { data: membership } = await supabase
      .from("account_members")
      .select("account_id")
      .eq("user_id", user.id)
      .maybeSingle();
    const acctId = (membership as { account_id?: string } | null)?.account_id ?? null;
    setAccountId(acctId);
    if (!acctId) {
      setLoading(false);
      return;
    }

    const [{ data: memberRows }, { data: inviteRows }] = await Promise.all([
      supabase
        .from("account_members")
        .select("id, user_id, role, pin_colour, joined_at")
        .eq("account_id", acctId)
        .order("joined_at", { ascending: true }),
      supabase
        .from("account_invitations")
        .select("id, email, accepted_at, accepted_user_id, revoked_at, expires_at, created_at")
        .eq("account_id", acctId)
        .order("created_at", { ascending: false }),
    ]);

    const mems = (memberRows ?? []) as Member[];
    setMembers(mems);

    // Names from profiles (co-members are readable under the existing policy).
    const ids = mems.map((m) => m.user_id);
    const profMap: Record<string, Profile> = {};
    if (ids.length) {
      const { data: profRows } = await supabase
        .from("profiles")
        .select("user_id, first_name, last_name, full_name")
        .in("user_id", ids);
      for (const p of (profRows ?? []) as Array<Profile & { user_id: string }>) {
        profMap[p.user_id] = { first_name: p.first_name, last_name: p.last_name, full_name: p.full_name };
      }
    }
    setProfiles(profMap);

    // Emails: own from the session; others from accepted invitations.
    const emails: Record<string, string> = {};
    if (user.email) emails[user.id] = user.email;
    const invites = (inviteRows ?? []) as Invite[];
    for (const inv of invites) {
      if (inv.accepted_user_id && inv.email) emails[inv.accepted_user_id] = inv.email;
    }
    setEmailByUser(emails);

    const now = Date.now();
    setPendingInvites(
      invites.filter((i) => !i.accepted_at && !i.revoked_at && new Date(i.expires_at).getTime() > now),
    );
    setLoading(false);
  }, [user]);

  useEffect(() => {
    load();
  }, [load]);

  const displayName = (m: Member) => {
    const p = profiles[m.user_id];
    return (
      p?.full_name ||
      [p?.first_name, p?.last_name].filter(Boolean).join(" ") ||
      "Team member"
    );
  };

  const initialsOf = (m: Member) => {
    const p = profiles[m.user_id];
    const a = p?.first_name?.[0] ?? p?.full_name?.[0] ?? "";
    const b = p?.last_name?.[0] ?? "";
    return `${a}${b}`.toUpperCase() || "?";
  };

  const isManager = (m: Member) => m.role !== "client_invitee";

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!accountId) return;
    const cleanEmail = email.trim().toLowerCase();
    if (!firstName.trim() || !lastName.trim() || !cleanEmail) return;
    setSending(true);
    try {
      const { data, error } = await supabase.functions.invoke("send-team-invitation", {
        body: {
          accountId,
          email: cleanEmail,
          first_name: firstName.trim(),
          last_name: lastName.trim(),
          position: position.trim() || undefined,
        },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(`Invitation sent to ${cleanEmail}`);
      setInviteOpen(false);
      setFirstName("");
      setLastName("");
      setEmail("");
      setPosition("");
      await load();
    } catch (err) {
      toast.error((err as Error)?.message || "Failed to send invitation");
    } finally {
      setSending(false);
    }
  };

  const runAction = async () => {
    if (!pendingAction) return;
    const { kind, member } = pendingAction;
    const fn =
      kind === "promote"
        ? "client-promote-member"
        : kind === "demote"
        ? "client-demote-member"
        : "client-remove-member";
    setActionLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke(fn, { body: { member_id: member.id } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(
        kind === "promote"
          ? "Member promoted to Manager"
          : kind === "demote"
          ? "Manager moved to Invitee"
          : "Member removed from the team",
      );
      setPendingAction(null);
      await load();
    } catch (err) {
      toast.error((err as Error)?.message || "Action failed");
    } finally {
      setActionLoading(false);
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
      await load();
    } catch (err) {
      toast.error((err as Error)?.message || "Failed to revoke invitation");
    } finally {
      setRevoking(null);
    }
  };

  const confirmCopy = (a: { kind: ActionKind; member: Member }) => {
    const name = displayName(a.member);
    if (a.kind === "promote") {
      return {
        title: `Make ${name} a Manager?`,
        body: "They will gain access to Documents, Agreements, Quotations, Invoices, and Orders, and will be able to manage the team.",
        confirm: "Make Manager",
      };
    }
    if (a.kind === "demote") {
      return {
        title: `Move ${name} to Invitee?`,
        body: "They will lose access to Documents, Agreements, Quotations, Invoices, and Orders. They keep access to review renders and leave comments.",
        confirm: "Make Invitee",
      };
    }
    return {
      title: `Remove ${name} from the team?`,
      body: "They will immediately lose access to this account. Their Silver Shadow login is not deleted.",
      confirm: "Remove",
    };
  };

  return (
    <ClientLayout>
      <div className="mb-12 flex flex-wrap items-end justify-between gap-4 animate-fade-in">
        <div>
          <h1 className="font-serif font-normal text-strong" style={{ fontSize: "2.6rem", letterSpacing: "-0.005em" }}>
            Team
          </h1>
          <p className="mt-3 font-sans uppercase text-label" style={{ fontSize: 10, letterSpacing: "0.22em" }}>
            Manage your team's access to this portal
          </p>
        </div>
        <Button
          onClick={() => setInviteOpen(true)}
          className="bg-gold text-background hover:opacity-80"
          style={{ borderRadius: 2 }}
        >
          <UserPlus className="mr-2 h-4 w-4" strokeWidth={1.75} />
          INVITE MEMBER
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-24">
          <BrandLoader size="md" />
        </div>
      ) : (
        <div className="animate-fade-in" style={{ animationDelay: "0.1s" }}>
          {/* Members */}
          <div className="divide-y divide-border/30 border-t border-border/30">
            {members.map((m) => {
              const isSelf = m.user_id === user?.id;
              const manager = isManager(m);
              const memberEmail = emailByUser[m.user_id];
              return (
                <div key={m.id} className="flex items-center gap-4 py-4">
                  <span
                    className="h-6 w-6 shrink-0 rounded-sm border border-border/40"
                    style={{ backgroundColor: m.pin_colour || GOLD }}
                    aria-hidden
                  />
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-foreground/[0.06] font-sans text-[11px] tracking-wide text-standard">
                    {initialsOf(m)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-serif text-standard" style={{ fontSize: 14 }}>
                      {displayName(m)}
                      {isSelf && <span className="ml-2 font-sans text-recessive" style={{ fontSize: 11 }}>(you)</span>}
                    </p>
                    {memberEmail && (
                      <p className="mt-0.5 font-sans text-recessive" style={{ fontSize: 11 }}>{memberEmail}</p>
                    )}
                  </div>
                  <span
                    className="shrink-0 font-sans uppercase"
                    style={{ fontSize: 9, letterSpacing: "0.22em", color: manager ? GOLD : undefined }}
                  >
                    <span className={manager ? "" : "text-recessive"}>{manager ? "Manager" : "Invitee"}</span>
                  </span>

                  {/* Actions — none for self */}
                  {!isSelf ? (
                    <div className="relative shrink-0">
                      <button
                        onClick={() => setOpenMenuId(openMenuId === m.id ? null : m.id)}
                        aria-label="Member actions"
                        className="text-label transition-colors hover:text-strong"
                      >
                        <MoreHorizontal className="h-4 w-4" strokeWidth={1.75} />
                      </button>
                      {openMenuId === m.id && (
                        <>
                          <div className="fixed inset-0 z-40" onClick={() => setOpenMenuId(null)} />
                          <div
                            className="absolute right-0 z-50 mt-1 w-44 border border-border/60 bg-card py-1 shadow-lg"
                            style={{ borderRadius: 2 }}
                          >
                            {manager ? (
                              <MenuItem
                                icon={<UserMinus className="h-3.5 w-3.5" strokeWidth={1.75} />}
                                label="Make Invitee"
                                onClick={() => {
                                  setOpenMenuId(null);
                                  setPendingAction({ kind: "demote", member: m });
                                }}
                              />
                            ) : (
                              <>
                                <MenuItem
                                  icon={<ArrowUpCircle className="h-3.5 w-3.5" strokeWidth={1.75} />}
                                  label="Make Manager"
                                  onClick={() => {
                                    setOpenMenuId(null);
                                    setPendingAction({ kind: "promote", member: m });
                                  }}
                                />
                                <MenuItem
                                  icon={<UserMinus className="h-3.5 w-3.5" strokeWidth={1.75} />}
                                  label="Remove from team"
                                  destructive
                                  onClick={() => {
                                    setOpenMenuId(null);
                                    setPendingAction({ kind: "remove", member: m });
                                  }}
                                />
                              </>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  ) : (
                    <span className="w-4 shrink-0" />
                  )}
                </div>
              );
            })}
          </div>

          {/* Pending invitations */}
          {pendingInvites.length > 0 && (
            <div className="mt-12">
              <p className="mb-3 font-sans uppercase text-label" style={{ fontSize: 9, letterSpacing: "0.28em" }}>
                Pending invitations
              </p>
              <div className="divide-y divide-border/30 border-t border-border/30">
                {pendingInvites.map((inv) => (
                  <div key={inv.id} className="flex items-center gap-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="font-sans text-standard" style={{ fontSize: 13 }}>{inv.email}</p>
                      <p className="mt-0.5 font-sans text-recessive" style={{ fontSize: 11 }}>
                        Sent {new Date(inv.created_at).toLocaleDateString()} · Expires {new Date(inv.expires_at).toLocaleDateString()}
                      </p>
                    </div>
                    <button
                      onClick={() => handleRevoke(inv.id)}
                      disabled={revoking === inv.id}
                      className="shrink-0 font-sans uppercase text-label transition-colors hover:text-strong disabled:opacity-40"
                      style={{ fontSize: 9, letterSpacing: "0.22em" }}
                    >
                      {revoking === inv.id ? "…" : "Revoke"}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Invite modal */}
      {inviteOpen && (
        <ModalShell onClose={() => setInviteOpen(false)} title="Invite a team member">
          <form onSubmit={handleInvite} className="space-y-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="First name">
                <Input value={firstName} onChange={(e) => setFirstName(e.target.value)} required maxLength={80} className="bg-background border-border" />
              </Field>
              <Field label="Last name">
                <Input value={lastName} onChange={(e) => setLastName(e.target.value)} required maxLength={80} className="bg-background border-border" />
              </Field>
            </div>
            <Field label="Email">
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required maxLength={255} placeholder="teammate@company.com" className="bg-background border-border" />
            </Field>
            <Field label="Position (optional)">
              <Input value={position} onChange={(e) => setPosition(e.target.value)} maxLength={120} placeholder="e.g. Senior Designer" className="bg-background border-border" />
            </Field>
            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="ghost" onClick={() => setInviteOpen(false)} className="text-label hover:text-strong">
                Cancel
              </Button>
              <Button type="submit" disabled={sending || !firstName.trim() || !lastName.trim() || !email.trim()} className="bg-gold text-background hover:opacity-80" style={{ borderRadius: 2 }}>
                {sending ? <BrandLoader size="sm" /> : "SEND INVITATION"}
              </Button>
            </div>
          </form>
        </ModalShell>
      )}

      {/* Confirm action modal */}
      {pendingAction && (() => {
        const copy = confirmCopy(pendingAction);
        return (
          <ModalShell onClose={() => !actionLoading && setPendingAction(null)} title={copy.title}>
            <p className="font-sans text-standard" style={{ fontSize: 13, lineHeight: 1.6 }}>{copy.body}</p>
            <div className="mt-6 flex justify-end gap-3">
              <Button type="button" variant="ghost" disabled={actionLoading} onClick={() => setPendingAction(null)} className="text-label hover:text-strong">
                Cancel
              </Button>
              <Button
                type="button"
                disabled={actionLoading}
                onClick={runAction}
                className={pendingAction.kind === "remove" ? "bg-destructive text-background hover:opacity-80" : "bg-gold text-background hover:opacity-80"}
                style={{ borderRadius: 2 }}
              >
                {actionLoading ? <BrandLoader size="sm" /> : copy.confirm}
              </Button>
            </div>
          </ModalShell>
        );
      })()}
    </ClientLayout>
  );
}

function MenuItem({ icon, label, onClick, destructive }: { icon: React.ReactNode; label: string; onClick: () => void; destructive?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 px-3 py-2 text-left font-sans transition-colors hover:bg-foreground/[0.04] ${destructive ? "text-destructive" : "text-standard"}`}
      style={{ fontSize: 12 }}
    >
      {icon}
      {label}
    </button>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label className="font-sans uppercase text-label" style={{ fontSize: 9, letterSpacing: "0.22em" }}>{label}</Label>
      {children}
    </div>
  );
}

function ModalShell({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md border border-border/60 bg-card p-6 shadow-xl" style={{ borderRadius: 4 }}>
        <div className="mb-5 flex items-start justify-between gap-4">
          <h2 className="font-serif text-strong" style={{ fontSize: 20 }}>{title}</h2>
          <button onClick={onClose} aria-label="Close" className="text-label transition-colors hover:text-strong">
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
