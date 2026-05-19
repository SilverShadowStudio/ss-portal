import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import {
  beaconClientActivity,
  clearSessionId,
  getOrCreateSessionId,
  insertClientActivity,
  resolveActor,
} from "@/lib/clientActivity";
import { isGhostModeActive } from "@/contexts/AuthContext";

/**
 * Tracks per-page time, session start/end for the signed-in user.
 * Mounted once near the router root so every navigation is captured.
 */
export function useClientActivityTracker() {
  const { user, session, isGhostMode } = useAuth();
  const location = useLocation();
  const lastUserId = useRef<string | null>(null);
  const currentPage = useRef<{
    path: string;
    startedAt: string;
    startedTs: number;
  } | null>(null);
  // session_end fires on both pagehide and visibilitychange→hidden. Tab
  // focus loss therefore wrote a session_end every time, with no paired
  // session_start when focus returned. Diagnostic on 2026-05-19 found
  // 8 session_end rows against 3 session_start for one user. Track a
  // ref so session_end fires at most once per session lifetime.
  const sessionEndedRef = useRef(false);

  // Keep latest access token reachable from the unload handler.
  useEffect(() => {
    (window as any).__ss_access_token = session?.access_token ?? null;
  }, [session?.access_token]);

  // Session start / end on auth change.
  useEffect(() => {
    if (isGhostMode || isGhostModeActive()) return; // Ghost Mode: never log impersonated activity.
    if (user && lastUserId.current !== user.id) {
      lastUserId.current = user.id;
      sessionEndedRef.current = false;
      const sid = getOrCreateSessionId();
      void insertClientActivity({
        userId: user.id,
        kind: "session_start",
        path: window.location.pathname,
        metadata: { session_id: sid },
      });
      // Pre-warm actor cache so unload beacon can fill name/role.
      void resolveActor(user.id);
    }
    if (!user && lastUserId.current) {
      const prevId = lastUserId.current;
      lastUserId.current = null;
      if (!sessionEndedRef.current) {
        sessionEndedRef.current = true;
        void insertClientActivity({
          userId: prevId,
          kind: "session_end",
        }).finally(() => clearSessionId());
      } else {
        clearSessionId();
      }
    }
  }, [user, isGhostMode]);

  // Page-view tracking — flush previous page on route change.
  useEffect(() => {
    if (!user) return;
    if (isGhostMode || isGhostModeActive()) {
      // Drop any in-flight page so we don't attribute time to the ghost.
      currentPage.current = null;
      return;
    }
    const prev = currentPage.current;
    if (prev) {
      const durationMs = Date.now() - prev.startedTs;
      void insertClientActivity({
        userId: user.id,
        kind: "page_view",
        path: prev.path,
        startedAt: prev.startedAt,
        endedAt: new Date().toISOString(),
        durationMs,
      });
    }
    currentPage.current = {
      path: location.pathname,
      startedAt: new Date().toISOString(),
      startedTs: Date.now(),
    };
  }, [user, location.pathname, isGhostMode]);

  // Tab close / refresh — flush current page + session_end via keepalive fetch.
  useEffect(() => {
    if (!user) return;
    if (isGhostMode || isGhostModeActive()) return;
    const flush = () => {
      if (isGhostModeActive()) return;
      const page = currentPage.current;
      const sid = getOrCreateSessionId();
      const cached = (resolveActor(user.id) as any)?._cached as
        | { actor_name: string | null; actor_role: string | null }
        | undefined;
      const actorName = cached?.actor_name ?? null;
      const actorRole = cached?.actor_role ?? null;
      if (page) {
        beaconClientActivity({
          userId: user.id,
          actorName,
          actorRole,
          kind: "page_view",
          sessionId: sid,
          path: page.path,
          startedAt: page.startedAt,
          durationMs: Date.now() - page.startedTs,
        });
      }
      if (!sessionEndedRef.current) {
        sessionEndedRef.current = true;
        beaconClientActivity({
          userId: user.id,
          actorName,
          actorRole,
          kind: "session_end",
          sessionId: sid,
          path: page?.path ?? null,
          startedAt: new Date().toISOString(),
          durationMs: null,
        });
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [user, isGhostMode]);
}