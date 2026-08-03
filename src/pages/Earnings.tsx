import { useEffect, useState } from "react";
import { Navigate } from "react-router-dom";
import { ClientLayout } from "@/components/ClientLayout";
import { EarningsView, type EarningsData } from "@/components/EarningsView";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export default function Earnings() {
  const { employmentType } = useAuth();
  const [data, setData] = useState<EarningsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.functions.invoke("freelancer-earnings").then(({ data, error }) => {
      if (error) setError(error.message);
      else setData(data as EarningsData);
      setLoading(false);
    });
  }, []);

  // Employees are salaried — no Earnings page. Send them to Documents.
  if (employmentType === "employee") return <Navigate to="/documents" replace />;

  return (
    <ClientLayout panel>
      <EarningsView data={data} loading={loading} error={error} />
    </ClientLayout>
  );
}
