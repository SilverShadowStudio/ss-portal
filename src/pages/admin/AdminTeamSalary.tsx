import { useParams, useSearchParams } from "react-router-dom";
import Salary from "@/pages/Salary";

// Admin-only, read-only copy of an employee's Salary page, opened from Team —
// the same view the employee sees, scoped to their payslips.
export default function AdminTeamSalary() {
  const { accountId } = useParams();
  const [params] = useSearchParams();
  return <Salary accountId={accountId} memberName={params.get("name")} />;
}
