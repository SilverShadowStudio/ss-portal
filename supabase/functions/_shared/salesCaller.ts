// Who is using the sales tools — Fred, or a sales rep.
//
// Every sales prompt was written when Fred was the only user, so they address
// him by name ("You are talking to Fred Colomb, the owner"). A rep using the
// same tools must not be called Fred, told that pipeline decisions are hers to
// make, or have her own calls graded as if Fred made them. Rather than rewrite
// each prompt, callers prepend callerPreamble(): it says who is actually there
// and how to read every "Fred" that follows. For Fred himself it is empty, so
// his prompts are byte-for-byte what they were (and stay cached the same way).

// deno-lint-ignore no-explicit-any
type Any = any;

export interface SalesCaller {
  userId: string;
  firstName: string;
  fullName: string;
  /** true for admins: Fred and anyone else who runs the studio. */
  isOwner: boolean;
}

export async function loadSalesCaller(admin: Any, userId: string): Promise<SalesCaller> {
  const [{ data: roles }, { data: profile }] = await Promise.all([
    admin.from("user_roles").select("role").eq("user_id", userId),
    admin.from("profiles").select("first_name, last_name, full_name").eq("user_id", userId).maybeSingle(),
  ]);
  const isOwner = (roles ?? []).some((r: { role: string }) => r.role === "admin");
  const first = (profile?.first_name ?? "").trim();
  const full = [profile?.first_name, profile?.last_name].filter(Boolean).join(" ").trim() || (profile?.full_name ?? "").trim();
  return {
    userId,
    firstName: first || full.split(" ")[0] || "the rep",
    fullName: full || first || "a member of the sales team",
    isOwner,
  };
}

/** Empty for the owner. For a rep: who is really there, and how to read "Fred". */
export function callerPreamble(c: SalesCaller): string {
  if (c.isOwner) return "";
  return `THE PERSON USING THIS IS NOT FRED.
It is ${c.fullName}, Silver Shadow Studio's Business Development Executive. Fred Colomb is the owner and Director.
Wherever the instructions below refer to Fred as the person you are working with — the one you talk to, who makes the calls, sends the emails, logs things, makes promises or confirms changes — read it as ${c.firstName}. Address ${c.firstName} by name, never as Fred.
${c.firstName} sees only the leads she owns. Pricing, scope, terms and anything that commits the studio are Fred's decisions: when one comes up, say so plainly and suggest she brings Fred in, rather than advising her to agree it.

`;
}
