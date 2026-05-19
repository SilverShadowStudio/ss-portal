/**
 * Shared scene/project phase + status-dot rollup.
 *
 * Centralised so every client view (Portfolio, Dashboard, etc.) shows the
 * same phrasing and dot color for the same underlying state. If you ever
 * need to tweak how a status maps to a phase, do it here only.
 */

export type PhaseDot = "red" | "green" | "gold" | "muted" | null;

export type Phase =
  | "Awaiting Brief"
  | "Awaiting Review"
  | "In Production"
  | "Approved"
  | "Active Project"
  | "Pending";

interface PhaseSceneLike {
  status: string;
}

interface PhaseRoundLike {
  status: string;
  round_number?: number;
}

/** Map a raw DB status string to a human phase label. */
export function getStatusPhase(status: string): Phase {
  const map: Record<string, Phase> = {
    pending_instruction: "Awaiting Brief",
    in_production: "In Production",
    delivered: "Awaiting Review",
    client_review: "Awaiting Review",
    approved: "Approved",
    pending: "In Production",
  };
  return map[status] || "Pending";
}

/**
 * Derive a scene's effective phase from its rounds. The DB scene.status
 * often stays "pending_instruction" even after a round has been requested,
 * so we look at the rounds to detect what's happening.
 *
 * A scene is in exactly ONE phase at a time, derived from its latest round
 * (highest round_number). The lifecycle on every round is:
 *   instructions sent → "In Production" → visual delivered → "Awaiting Review"
 * So earlier delivered rounds don't keep the scene in review forever — once
 * the next round's brief is sent, the scene flips back to production.
 */
export function getSceneEffectivePhase(
  scene: PhaseSceneLike,
  rounds: PhaseRoundLike[]
): Phase {
  // No rounds yet — scene is freshly created, no client action either way.
  if (rounds.length === 0) return getStatusPhase(scene.status);

  // Look at the latest round only. If round_number isn't available, fall
  // back to the array order (assumed creation order).
  const sorted = [...rounds].sort((a, b) => {
    const an = a.round_number ?? 0;
    const bn = b.round_number ?? 0;
    return bn - an;
  });
  const latest = sorted[0];

  if (latest.status === "delivered" || latest.status === "client_review")
    return "Awaiting Review";
  if (latest.status === "approved") return "Approved";
  // A draft round is client-side only — the brief hasn't been submitted to
  // production yet, so the scene reads as "Awaiting Brief" for grouping.
  // (The card itself shows a "Draft" label so the client can tell their
  // unfinished work apart from a never-started one.)
  if (latest.status === "draft") return "Awaiting Brief";
  // Anything else (pending_instruction, in_production, pending) means a
  // round is being worked on.
  return "In Production";
}

/**
 * Map a phase label to the colored dot shown on a card.
 *  - Awaiting Brief / Awaiting Review -> red (client action required)
 *  - In Production                    -> green
 *  - Approved                         -> muted
 */
export function getPhaseDot(phase: string): PhaseDot {
  if (phase === "Awaiting Brief" || phase === "Awaiting Review") return "red";
  if (phase === "In Production") return "green";
  if (phase === "Approved") return "muted";
  return null;
}

/**
 * Roll a project's scenes up into a single phase + dot, mirroring the
 * dashboard priority: anything red (action required) wins over green
 * (in production), which wins over muted (everything approved).
 */
export function getProjectRollup<S extends PhaseSceneLike>(
  scenes: S[],
  roundsForScene: (scene: S) => PhaseRoundLike[]
): { phase: Phase | "Active Project"; dot: PhaseDot } {
  if (scenes.length === 0) {
    return { phase: "Active Project", dot: null };
  }
  const phases = scenes.map((s) => getSceneEffectivePhase(s, roundsForScene(s)));
  if (phases.includes("Awaiting Review"))
    return { phase: "Awaiting Review", dot: "red" };
  if (phases.includes("Awaiting Brief"))
    return { phase: "Awaiting Brief", dot: "red" };
  if (phases.includes("In Production"))
    return { phase: "In Production", dot: "green" };
  if (phases.every((p) => p === "Approved"))
    return { phase: "Approved", dot: "muted" };
  return { phase: "Active Project", dot: null };
}

/**
 * Client-facing tooltip copy explaining what each dot color signals.
 * Keyed by the dot color so the same explanation is shown everywhere
 * the dot appears (project cards, scene cards, round cards, dashboard).
 */
export const PHASE_DOT_TOOLTIPS: Record<NonNullable<PhaseDot>, string> = {
  red: "Action needed from you — either send a brief or review the latest delivery.",
  green: "Our team is actively working on this. No action needed from you right now.",
  gold: "A new delivery is ready for your review.",
  muted: "Approved and complete. Nothing more to do here.",
};

/**
 * Slugify a string for use inside a downloaded filename.
 * Keeps letters/digits, replaces everything else with `_`, trims leading
 * and trailing underscores, and collapses repeats. Falls back to `untitled`.
 */
export function slugForFilename(input: string | null | undefined): string {
  if (!input) return "Untitled";
  const cleaned = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
  return cleaned || "Untitled";
}

/**
 * Build a meaningful download filename like `Project_Scene_Round-03.jpg`
 * from the project, scene, round number, and original filename (used to
 * derive the file extension).
 */
export function buildAssetDownloadName(
  projectName: string | null | undefined,
  sceneName: string | null | undefined,
  roundNumber: number,
  originalFilename: string | null | undefined
): string {
  const project = slugForFilename(projectName);
  const scene = slugForFilename(sceneName);
  const round = `Round-${String(roundNumber).padStart(2, "0")}`;
  // Extract extension from the original filename (defaults to jpg).
  let ext = "jpg";
  if (originalFilename) {
    const dot = originalFilename.lastIndexOf(".");
    if (dot > -1 && dot < originalFilename.length - 1) {
      ext = originalFilename.slice(dot + 1).toLowerCase();
    }
  }
  return `${project}_${scene}_${round}.${ext}`;
}
