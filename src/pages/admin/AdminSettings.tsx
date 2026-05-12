import { useState, useEffect } from "react";
import { Loader2, CheckCircle2 } from "lucide-react";
import { AdminLayout } from "@/components/AdminLayout";
import { DropboxConnectionStatus } from "@/components/admin/DropboxConnectionStatus";
import { AirtableSyncPanel } from "@/components/admin/AirtableSyncPanel";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const labelCls = "block text-[9px] uppercase tracking-[0.26em] text-foreground/40 mb-1.5";
const inputCls = "w-full bg-transparent border-b border-border/50 py-2 text-sm text-foreground focus:outline-none focus:border-gold transition-colors placeholder:text-foreground/25";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-border/30 pt-10">
      <p className="text-[9px] uppercase tracking-[0.32em] text-foreground/35 font-sans mb-6">{title}</p>
      {children}
    </div>
  );
}

export default function AdminSettings() {
  const { user } = useAuth();
  const { toast } = useToast();

  // ── Profile ──────────────────────────────────────────────────────────────
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);

  // ── Password ─────────────────────────────────────────────────────────────
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [savingPassword, setSavingPassword] = useState(false);

  useEffect(() => {
    if (!user) return;
    setEmail(user.email ?? "");
    supabase
      .from("profiles")
      .select("first_name, last_name, full_name")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          if (data.first_name || data.last_name) {
            setFirstName(data.first_name ?? "");
            setLastName(data.last_name ?? "");
          } else if (data.full_name) {
            const parts = data.full_name.trim().split(/\s+/);
            setFirstName(parts[0] ?? "");
            setLastName(parts.slice(1).join(" "));
          }
        }
      });
  }, [user]);

  async function saveProfile() {
    if (!user) return;
    setSavingProfile(true);
    try {
      const updates: Promise<any>[] = [
        (() => {
          const trimFirst = firstName.trim();
          const trimLast = lastName.trim();
          return supabase
            .from("profiles")
            .update({
              first_name: trimFirst || null,
              last_name: trimLast || null,
              full_name: [trimFirst, trimLast].filter(Boolean).join(" ") || null,
            })
            .eq("user_id", user.id)
            .then(({ error }) => { if (error) throw error; });
        })(),
      ];
      if (email !== user.email) {
        updates.push(
          supabase.auth.updateUser({ email }).then(({ error }) => { if (error) throw error; })
        );
      }
      await Promise.all(updates);
      toast({ title: "Profile saved." });
    } catch (e: any) {
      toast({ title: "Failed to save", description: e?.message, variant: "destructive" });
    } finally {
      setSavingProfile(false);
    }
  }

  async function changePassword() {
    if (newPassword !== confirmPassword) {
      toast({ title: "Passwords don't match", variant: "destructive" });
      return;
    }
    if (newPassword.length < 8) {
      toast({ title: "Password must be at least 8 characters", variant: "destructive" });
      return;
    }
    setSavingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setNewPassword("");
      setConfirmPassword("");
      toast({ title: "Password updated." });
    } catch (e: any) {
      toast({ title: "Failed to update password", description: e?.message, variant: "destructive" });
    } finally {
      setSavingPassword(false);
    }
  }

  return (
    <AdminLayout>
      <div className="max-w-2xl">
        <h1 className="font-serif text-2xl text-foreground mb-1">Settings</h1>
        <p className="text-sm text-muted-foreground font-sans mb-10">
          Studio configuration, integrations, and your account.
        </p>

        {/* ── Profile ──────────────────────────────────────────────────── */}
        <Section title="Profile">
          <div className="grid grid-cols-2 gap-6 mb-6">
            <div>
              <label className={labelCls}>First name</label>
              <input
                type="text"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Fred"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Last name</label>
              <input
                type="text"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Colomb"
                className={inputCls}
              />
            </div>
          </div>
          <div className="mb-8">
            <label className={labelCls}>Email address</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="fred@silvershadowstudio.com"
              className={inputCls}
            />
          </div>
          <SaveButton loading={savingProfile} onClick={saveProfile} label="Save profile" />
        </Section>

        {/* ── Password ─────────────────────────────────────────────────── */}
        <Section title="Password">
          <div className="grid grid-cols-2 gap-6 mb-8">
            <div>
              <label className={labelCls}>New password</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Min. 8 characters"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Confirm password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Repeat password"
                className={inputCls}
              />
            </div>
          </div>
          <SaveButton loading={savingPassword} onClick={changePassword} label="Update password" disabled={!newPassword} />
        </Section>

        {/* ── Dropbox ──────────────────────────────────────────────────── */}
        <Section title="Dropbox">
          <DropboxConnectionStatus />
        </Section>

        {/* ── Airtable ─────────────────────────────────────────────────── */}
        <Section title="Airtable">
          <AirtableSyncPanel />
        </Section>
      </div>
    </AdminLayout>
  );
}

function SaveButton({
  loading,
  onClick,
  label,
  disabled,
}: {
  loading: boolean;
  onClick: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={loading || disabled}
      className="flex items-center gap-2 bg-foreground text-background font-sans uppercase hover:opacity-80 disabled:opacity-40 transition-opacity"
      style={{ height: 36, paddingLeft: 20, paddingRight: 20, fontSize: 10, letterSpacing: "0.26em" }}
    >
      {loading ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : (
        <CheckCircle2 className="h-3 w-3" strokeWidth={1.5} />
      )}
      {label}
    </button>
  );
}
