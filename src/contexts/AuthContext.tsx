import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { User, Session } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { clearSessionId, insertClientActivity } from "@/lib/clientActivity";

const GHOST_KEY = "ss-ghost-mode";
const GHOST_BACKUP_KEY = "ss-ghost-admin-backup";

/**
 * Read-only helper used by the activity tracker to hard-skip logging
 * regardless of React state timing.
 */
export function isGhostModeActive(): boolean {
  try {
    return !!localStorage.getItem(GHOST_KEY);
  } catch {
    return false;
  }
}

interface GhostState {
  userId: string;
  name: string;
  /** Admin user id behind the ghost session, kept for UI/back-restore. */
  adminUserId: string;
}

interface AdminBackup {
  access_token: string;
  refresh_token: string;
  adminUserId: string;
}

interface AuthContextType {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signUp: (email: string, password: string, fullName?: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
  /** True when the signed-in admin is currently impersonating a client. */
  isGhostMode: boolean;
  ghostTarget: GhostState | null;
  /** The real admin user behind the ghost session (null when not ghosting). */
  realUser: User | null;
  enterGhostMode: (target: { userId: string; name: string }) => Promise<{ error: Error | null }>;
  exitGhostMode: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAdminUser, setIsAdminUser] = useState(false);
  const [ghostTarget, setGhostTarget] = useState<GhostState | null>(() => {
    try {
      const raw = localStorage.getItem(GHOST_KEY);
      return raw ? (JSON.parse(raw) as GhostState) : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    // Set up auth state listener FIRST
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        setSession(session);
        setAuthUser(session?.user ?? null);
        setLoading(false);

        // Track client logins — best-effort, never blocks auth.
        if (event === "SIGNED_IN" && session?.user && !isGhostModeActive()) {
          const userId = session.user.id;
          (async () => {
            try {
              // Skip admin logins. Also skip if the role lookup errors — better
              // to miss a log entry than to misclassify an admin as a client.
              const { data: roleRow, error: roleError } = await supabase
                .from("user_roles")
                .select("role")
                .eq("user_id", userId)
                .eq("role", "admin")
                .maybeSingle();
              if (roleRow || roleError) return;

              const [{ data: profile }, { data: priorSessions }] = await Promise.all([
                supabase
                  .from("profiles")
                  .select("full_name, first_name, last_name")
                  .eq("user_id", userId)
                  .maybeSingle(),
                supabase
                  .from("client_activity")
                  .select("id")
                  .eq("user_id", userId)
                  .eq("kind", "session_start")
                  .limit(1),
              ]);

              const name =
                [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") ||
                profile?.full_name ||
                session.user.email ||
                "Client";

              const isFirst = !priorSessions || priorSessions.length === 0;
              await supabase.from("activity_log").insert({
                actor_user_id: userId,
                actor_name: name,
                actor_role: "client",
                action: isFirst ? "client_registered" : "client_login",
                description: isFirst
                  ? `${name} logged in for the first time`
                  : `${name} logged in`,
              });
            } catch {
              // Best-effort — never surface errors to the user
            }
          })();
        }
      }
    );

    // THEN check for existing session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setAuthUser(session?.user ?? null);
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  // Resolve admin role for the *real* admin user. While ghosting, the live
  // session belongs to the client, so we look up the stored admin id.
  useEffect(() => {
    // While ghosting, the live session is the client's — RLS will block
    // reading the admin's user_roles row. Trust the ghost backup as proof
    // of admin instead of running a doomed lookup.
    if (ghostTarget?.adminUserId) {
      setIsAdminUser(true);
      return;
    }
    const lookupId = ghostTarget?.adminUserId ?? authUser?.id;
    if (!lookupId) {
      setIsAdminUser(false);
      return;
    }
    let cancelled = false;
    supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", lookupId)
      .eq("role", "admin")
      .maybeSingle()
      .then(({ data }) => {
        if (!cancelled) setIsAdminUser(!!data);
      });
    return () => {
      cancelled = true;
    };
  }, [authUser?.id, ghostTarget?.adminUserId]);

  // Defensive clear: only if a ghost flag exists with NO admin backup
  // (i.e. someone forged the flag client-side). We can't rely on the RLS
  // role lookup here because while ghosting it will always fail.
  useEffect(() => {
    if (!ghostTarget) return;
    const hasBackup = !!localStorage.getItem(GHOST_BACKUP_KEY);
    if (!hasBackup) {
      localStorage.removeItem(GHOST_KEY);
      setGhostTarget(null);
    }
  }, [ghostTarget]);

  // While ghosting, the live Supabase session IS the client's session, so
  // RLS context is correct. We expose `user` as the live session user.
  const isGhostMode = !!(isAdminUser && ghostTarget && authUser);
  const user: User | null = authUser;
  // `realUser` is the admin behind the curtain when ghosting.
  const realUser: User | null = isGhostMode
    ? ({ id: ghostTarget!.adminUserId } as User)
    : authUser;

  const enterGhostMode = async (target: { userId: string; name: string }) => {
    if (!isAdminUser || !authUser) {
      return { error: new Error("Admin session required") };
    }
    try {
      // 1. Snapshot current admin tokens so we can restore on exit.
      const { data: cur } = await supabase.auth.getSession();
      if (!cur.session) return { error: new Error("No active admin session") };
      const backup: AdminBackup = {
        access_token: cur.session.access_token,
        refresh_token: cur.session.refresh_token,
        adminUserId: authUser.id,
      };
      localStorage.setItem(GHOST_BACKUP_KEY, JSON.stringify(backup));

      // 2. Set ghost flag BEFORE swapping sessions so the activity tracker
      //    suppresses the upcoming auth state change.
      const ghost: GhostState = {
        userId: target.userId,
        name: target.name,
        adminUserId: authUser.id,
      };
      localStorage.setItem(GHOST_KEY, JSON.stringify(ghost));
      setGhostTarget(ghost);

      // 3. Ask the server to mint a one-shot magiclink for the target user.
      const { data, error } = await supabase.functions.invoke(
        "admin-impersonate-client",
        { body: { targetUserId: target.userId } },
      );
      if (error || !data?.token_hash) {
        localStorage.removeItem(GHOST_KEY);
        localStorage.removeItem(GHOST_BACKUP_KEY);
        setGhostTarget(null);
        return { error: new Error(error?.message ?? "Impersonation failed") };
      }

      // 4. Verify the magiclink — this REPLACES the live session with the
      //    target user's, giving accurate RLS context server-side.
      const { error: verifyErr } = await supabase.auth.verifyOtp({
        type: "magiclink",
        token_hash: data.token_hash,
      });
      if (verifyErr) {
        localStorage.removeItem(GHOST_KEY);
        localStorage.removeItem(GHOST_BACKUP_KEY);
        setGhostTarget(null);
        return { error: verifyErr as Error };
      }
      return { error: null };
    } catch (e) {
      localStorage.removeItem(GHOST_KEY);
      localStorage.removeItem(GHOST_BACKUP_KEY);
      setGhostTarget(null);
      return { error: e as Error };
    }
  };

  const exitGhostMode = async () => {
    let backup: AdminBackup | null = null;
    try {
      const raw = localStorage.getItem(GHOST_BACKUP_KEY);
      backup = raw ? (JSON.parse(raw) as AdminBackup) : null;
    } catch {
      backup = null;
    }
    // Clear flags first so any auth state change is treated as non-ghost.
    localStorage.removeItem(GHOST_KEY);
    localStorage.removeItem(GHOST_BACKUP_KEY);
    setGhostTarget(null);
    if (backup) {
      await supabase.auth.setSession({
        access_token: backup.access_token,
        refresh_token: backup.refresh_token,
      });
    } else {
      await supabase.auth.signOut();
    }
  };

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    return { error: error as Error | null };
  };

  const signUp = async (email: string, password: string, fullName?: string) => {
    const redirectUrl = `${window.location.origin}/`;
    
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectUrl,
        data: {
          full_name: fullName,
        },
      },
    });
    return { error: error as Error | null };
  };

  const signOut = async () => {
    try {
      const { data } = await supabase.auth.getSession();
      const uid = data.session?.user.id;
      // Don't log session_end while ghosting — ghost activity is excluded.
      if (uid && !isGhostMode) {
        await insertClientActivity({ userId: uid, kind: "session_end" });
      }
    } catch {
      /* swallow */
    }
    localStorage.removeItem(GHOST_KEY);
    localStorage.removeItem(GHOST_BACKUP_KEY);
    setGhostTarget(null);
    clearSessionId();
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        loading,
        signIn,
        signUp,
        signOut,
        isGhostMode,
        ghostTarget,
        realUser,
        enterGhostMode,
        exitGhostMode,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
