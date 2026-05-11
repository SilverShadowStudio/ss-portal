import { useEffect, useState } from "react";
import { Plus, Trash2, Download } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { InvoiceDisplay } from "./InvoiceDisplay";
import { initialInvoiceData, type InvoiceData, type InvoiceItem } from "./types";

const STORAGE_KEY = "silvershadow_invoice_generator_data";

interface AccountOption {
  id: string;
  company_name: string | null;
  street_name: string | null;
  building_number: string | null;
  city: string | null;
  postcode: string | null;
  country: string | null;
  contact?: string | null;
  project?: string | null;
}

export function InvoiceGenerator() {
  const [data, setData] = useState<InvoiceData>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? { ...initialInvoiceData, ...JSON.parse(saved) } : initialInvoiceData;
    } catch {
      return initialInvoiceData;
    }
  });
  const [activePreview, setActivePreview] = useState<"A" | "B">("A");
  const [manualMode, setManualMode] = useState(false);
  const [accounts, setAccounts] = useState<AccountOption[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState<string>("");
  const [projectsByAccount, setProjectsByAccount] = useState<Record<string, { id: string; name: string }[]>>({});
  const [contactsByAccount, setContactsByAccount] = useState<Record<string, string>>({});
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");

  useEffect(() => {
    (async () => {
      const { data: accs } = await supabase
        .from("accounts")
        .select("id, company_name, street_name, building_number, city, postcode, country")
        .order("company_name", { ascending: true });
      if (accs) setAccounts(accs as AccountOption[]);

      const { data: projs } = await supabase
        .from("projects")
        .select("id, name, account_id")
        .is("archived_at", null);
      if (projs) {
        const map: Record<string, { id: string; name: string }[]> = {};
        projs.forEach((p: any) => {
          if (!p.account_id) return;
          (map[p.account_id] ||= []).push({ id: p.id, name: p.name });
        });
        setProjectsByAccount(map);
      }

      const { data: profs } = await supabase
        .from("profiles")
        .select("account_id, first_name, last_name, full_name");
      if (profs) {
        const map: Record<string, string> = {};
        profs.forEach((p: any) => {
          if (!p.account_id || map[p.account_id]) return;
          const name = [p.first_name, p.last_name].filter(Boolean).join(" ") || p.full_name || "";
          if (name) map[p.account_id] = name;
        });
        setContactsByAccount(map);
      }
    })();
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  }, [data]);

  const applyAccount = (accountId: string) => {
    setSelectedAccountId(accountId);
    setSelectedProjectId("");
    const acc = accounts.find((a) => a.id === accountId);
    if (!acc) return;
    const address = [
      [acc.building_number, acc.street_name].filter(Boolean).join(" "),
      [acc.postcode, acc.city].filter(Boolean).join(" "),
      acc.country,
    ]
      .filter(Boolean)
      .join(", ");
    setData((d) => ({
      ...d,
      client: {
        ...d.client,
        name: acc.company_name || "",
        address,
        contact: contactsByAccount[acc.id] || "",
        project: "",
      },
    }));
  };

  const applyProject = (projectId: string) => {
    setSelectedProjectId(projectId);
    const proj = projectsByAccount[selectedAccountId]?.find((p) => p.id === projectId);
    if (proj) setData((d) => ({ ...d, client: { ...d.client, project: proj.name } }));
  };

  const handlePrint = (type: "A" | "B") => {
    setActivePreview(type);
    setTimeout(() => window.print(), 100);
  };

  const updateClient = (field: keyof InvoiceData["client"], value: string) =>
    setData((d) => ({ ...d, client: { ...d.client, [field]: value } }));
  const updateBank = (field: keyof InvoiceData["bank"], value: string) =>
    setData((d) => ({ ...d, bank: { ...d.bank, [field]: value } }));

  const addItem = () =>
    setData((d) => ({
      ...d,
      items: [...d.items, { id: crypto.randomUUID(), category: "", description: "", price: 0 }],
    }));
  const removeItem = (id: string) =>
    setData((d) => ({ ...d, items: d.items.filter((i) => i.id !== id) }));
  const updateItem = (id: string, field: keyof InvoiceItem, value: string | number) =>
    setData((d) => ({
      ...d,
      items: d.items.map((i) => (i.id === id ? { ...i, [field]: value } : i)),
    }));

  return (
    <div className="invoice-generator">
      {/* Print scoping */}
      <style>{`
        @media print {
          body * { visibility: hidden !important; }
          .invoice-print-sheet, .invoice-print-sheet * { visibility: visible !important; }
          .invoice-print-sheet {
            position: absolute !important;
            left: 0; top: 0;
            margin: 0 !important;
            box-shadow: none !important;
          }
          @page { size: A4; margin: 0; }
        }
      `}</style>

      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_auto] gap-8 items-start no-print">
        {/* Form */}
        <div className="space-y-8 rounded-xl border border-border bg-card p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Client */}
            <div className="space-y-4">
              <h3 className="font-serif text-lg border-b border-border pb-2">Client Details</h3>
              {!manualMode ? (
                <div className="space-y-3">
                  <div>
                    <Label className="text-xs">Select Client</Label>
                    <Select value={selectedAccountId} onValueChange={applyAccount}>
                      <SelectTrigger>
                        <SelectValue placeholder="Choose a client…" />
                      </SelectTrigger>
                      <SelectContent>
                        {accounts.map((a) => (
                          <SelectItem key={a.id} value={a.id}>
                            {a.company_name || "(no name)"}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {selectedAccountId && (projectsByAccount[selectedAccountId]?.length ?? 0) > 0 && (
                    <div>
                      <Label className="text-xs">Project</Label>
                      <Select value={selectedProjectId} onValueChange={applyProject}>
                        <SelectTrigger>
                          <SelectValue placeholder="Choose a project…" />
                        </SelectTrigger>
                        <SelectContent>
                          {projectsByAccount[selectedAccountId].map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  <div>
                    <Label className="text-xs">Invoice Number</Label>
                    <Input
                      value={data.client.invoiceNumber}
                      onChange={(e) => updateClient("invoiceNumber", e.target.value)}
                    />
                  </div>
                  {selectedAccountId && (
                    <div className="rounded-md border border-border bg-muted/30 p-3 text-xs space-y-1">
                      <div><span className="text-muted-foreground">Name:</span> {data.client.name || "—"}</div>
                      <div><span className="text-muted-foreground">Address:</span> {data.client.address || "—"}</div>
                      <div><span className="text-muted-foreground">Contact:</span> {data.client.contact || "—"}</div>
                      <div><span className="text-muted-foreground">Project:</span> {data.client.project || "—"}</div>
                    </div>
                  )}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="w-full"
                    onClick={() => setManualMode(true)}
                  >
                    Fill details manually
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {[
                    ["name", "Client Name"],
                    ["address", "Address"],
                    ["contact", "Contact"],
                    ["project", "Project"],
                    ["invoiceNumber", "Invoice Number"],
                  ].map(([field, label]) => (
                    <div key={field}>
                      <Label className="text-xs">{label}</Label>
                      <Input
                        value={(data.client as any)[field]}
                        onChange={(e) => updateClient(field as any, e.target.value)}
                      />
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="w-full"
                    onClick={() => setManualMode(false)}
                  >
                    Use client dropdown
                  </Button>
                </div>
              )}

              <div className="pt-4 space-y-4">
                <h3 className="font-serif text-lg border-b border-border pb-2">Invoice Settings</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label className="text-xs">Invoice Date</Label>
                    <Input
                      type="date"
                      value={data.invoiceDate}
                      onChange={(e) => setData({ ...data, invoiceDate: e.target.value })}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">VAT Rate (%)</Label>
                    <Input
                      type="number"
                      value={data.vatRate}
                      onChange={(e) => setData({ ...data, vatRate: parseFloat(e.target.value) || 0 })}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Downpayment (%)</Label>
                    <Input
                      type="number"
                      value={data.downpaymentRate}
                      onChange={(e) => setData({ ...data, downpaymentRate: parseFloat(e.target.value) || 0 })}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Net Days</Label>
                    <Input
                      type="number"
                      value={data.netDays}
                      onChange={(e) => setData({ ...data, netDays: parseInt(e.target.value) || 0 })}
                    />
                  </div>
                </div>
                <div className="flex gap-3 pt-2">
                  <Button onClick={() => handlePrint("A")} className="flex-1 border border-gold bg-transparent text-gold hover:bg-[#1C1A17]">
                    <Download className="mr-2 h-4 w-4" /> Invoice A
                  </Button>
                  <Button onClick={() => handlePrint("B")} className="flex-1 border border-gold bg-transparent text-gold hover:bg-[#1C1A17]">
                    <Download className="mr-2 h-4 w-4" /> Invoice B
                  </Button>
                </div>
              </div>
            </div>

            {/* Bank */}
            <div className="space-y-4">
              <h3 className="font-serif text-lg border-b border-border pb-2">Bank Details</h3>
              <div className="space-y-3">
                {[
                  ["bankName", "Bank Name"],
                  ["sortCode", "Sort Code"],
                  ["accountNumber", "Account Number"],
                  ["swiftCode", "SWIFT Code"],
                  ["iban", "IBAN"],
                ].map(([field, label]) => (
                  <div key={field}>
                    <Label className="text-xs">{label}</Label>
                    <Input
                      value={(data.bank as any)[field]}
                      onChange={(e) => updateBank(field as any, e.target.value)}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Items */}
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-border pb-2">
              <h3 className="font-serif text-lg">Invoice Items</h3>
              <Button size="sm" onClick={addItem} className="border border-gold bg-transparent text-gold hover:bg-[#1C1A17]">
                <Plus className="mr-1 h-4 w-4" /> Add Line
              </Button>
            </div>
            <div className="space-y-3">
              {data.items.map((item) => (
                <div key={item.id} className="flex flex-wrap md:flex-nowrap gap-3 items-end rounded-lg border border-border p-3 bg-muted/20">
                  <div className="flex-1 min-w-[140px]">
                    <Label className="text-[10px] uppercase tracking-wider">Category</Label>
                    <Input value={item.category} onChange={(e) => updateItem(item.id, "category", e.target.value)} />
                  </div>
                  <div className="flex-[2] min-w-[200px]">
                    <Label className="text-[10px] uppercase tracking-wider">Description</Label>
                    <Input value={item.description} onChange={(e) => updateItem(item.id, "description", e.target.value)} />
                  </div>
                  <div className="w-32">
                    <Label className="text-[10px] uppercase tracking-wider">Price (£)</Label>
                    <Input
                      type="number"
                      value={item.price}
                      onChange={(e) => updateItem(item.id, "price", parseFloat(e.target.value) || 0)}
                    />
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => removeItem(item.id)} className="text-destructive hover:text-destructive">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              {data.items.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-6">No items yet — add a line to get started.</p>
              )}
            </div>
          </div>
        </div>

        {/* Preview */}
        <div className="space-y-4 xl:sticky xl:top-4">
          <div className="flex justify-center gap-3">
            {(["A", "B"] as const).map((t) => (
              <Button
                key={t}
                variant={activePreview === t ? "default" : "outline"}
                onClick={() => setActivePreview(t)}
                className={activePreview === t ? "border border-gold bg-transparent text-gold hover:bg-[#1C1A17]" : ""}
              >
                Preview Invoice {t}
              </Button>
            ))}
          </div>
          <div className="overflow-auto max-h-[80vh] xl:max-h-none rounded-md shadow-lg" style={{ transformOrigin: "top center" }}>
            <InvoiceDisplay data={data} type={activePreview} />
          </div>
        </div>
      </div>
    </div>
  );
}
