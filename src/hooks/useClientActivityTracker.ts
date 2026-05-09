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

  // Keep latest access token reachable from the unload handler.
  useEffect(() => {
    (window as any).__ss_access_token = session?.access_token ?? null;
  }, [session?.access_token]);

  // Session start / end on auth change.
  useEffect(() => {
    if (isGhostMode || isGhostModeActive()) return; // Ghost Mode: never log impersonated activity.
    if (user && lastUserId.current !== user.id) {
      lastUserId.current = user.id;
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
      void insertClientActivity({
        userId: prevId,
        kind: "session_end",
      }).finally(() => clearSessionId());
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