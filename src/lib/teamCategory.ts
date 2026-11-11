// Which category a team member belongs to — the one rule shared by the Team
// page (how members are grouped), the member's own sidebar (which pages they
// get) and the landing redirect (where they arrive after signing in).
//
// The category comes from the role chosen when they were invited
// (accounts.team_role) or, for employees, their engagement. Order is the order
// the Team page shows them; a category with nobody in it isn't shown.
//
// Freelancers (Fred, 11 Nov 2026): a freelancer outside the three Airtable
// disciplines — not a scene manager, modeller or photographer. Their pay isn't
// in Airtable's work logs, so they have no Earnings page: Calendar and
// Documents only.

export const TEAM_CATEGORY_ORDER = [
  "Employees", "Freelancers", "Scene Managers", "Modellers", "Photographers", "Other",
] as const;
export type TeamCategory = (typeof TEAM_CATEGORY_ORDER)[number];

export function teamCategoryOf(employmentType: string | null | undefined, role: string | null | undefined): TeamCategory {
  if (employmentType === "employee") return "Employees";
  const raw = (role ?? "").toLowerCase();
  // Checked by role only — every non-employee has employment_type 'freelancer'.
  if (raw.includes("freelance")) return "Freelancers";
  if (raw.includes("scene manager")) return "Scene Managers";
  if (raw.includes("modell") || raw.includes("modeler")) return "Modellers";
  if (raw.includes("photograph")) return "Photographers";
  return "Other";
}

/** Does this member's category have an Earnings page? (Employees get Salary.) */
export const hasEarnings = (c: TeamCategory) => c !== "Employees" && c !== "Freelancers";

/** A team member's own pages, in menu order. One list for both menus: their
 *  team sidebar, and the Sales sidebar when Sales is shared with them. */
export type TeamPage = { path: string; label: "Earnings" | "Hours" | "Calendar" | "Documents" | "Salary" };
export function teamPagesFor(c: TeamCategory, opts: { hours?: boolean } = {}): TeamPage[] {
  // Hours: members paid by the hour (an admin gave them weekly hours).
  const hours: TeamPage[] = opts.hours ? [{ path: "/hours", label: "Hours" }] : [];
  if (c === "Employees") return [...hours,
    { path: "/documents", label: "Documents" }, { path: "/calendar", label: "Calendar" }, { path: "/salary", label: "Salary" },
  ];
  return [
    ...(hasEarnings(c) ? [{ path: "/earnings", label: "Earnings" } as TeamPage] : []),
    ...hours,
    { path: "/calendar", label: "Calendar" }, { path: "/documents", label: "Documents" },
  ];
}
