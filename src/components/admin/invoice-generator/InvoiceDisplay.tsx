import React from "react";
import { format, addDays } from "date-fns";
import type { InvoiceData } from "./types";

const formatGBP = (amount: number) =>
  new Intl.NumberFormat("en-GB", {
    style: "currency",
    currency: "GBP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount || 0);

interface Props {
  data: InvoiceData;
  type: "A" | "B";
}

export const InvoiceDisplay: React.FC<Props> = ({ data, type }) => {
  const subtotal = data.items.reduce((sum, item) => sum + (Number(item.price) || 0), 0);
  const vatAmount = subtotal * (data.vatRate / 100);
  const grandTotal = subtotal + vatAmount;
  const downpaymentAmount = grandTotal * (data.downpaymentRate / 100);
  const balanceAmount = grandTotal - downpaymentAmount;

  const invoiceDate = data.invoiceDate ? new Date(data.invoiceDate) : new Date();
  const dueDate = addDays(invoiceDate, data.netDays);

  return (
    <div
      className="invoice-print-sheet w-[210mm] min-h-[297mm] mx-auto p-[20mm] relative overflow-hidden flex flex-col text-[10px] font-light leading-relaxed"
      style={{ backgroundColor: "#f9f9fb", color: "#333333", fontFamily: "Montserrat, sans-serif" }}
    >
      <div className="absolute top-0 left-0 w-full h-[1px]" style={{ backgroundColor: "rgba(254,207,116,0.4)" }} />

      <div className="flex flex-col items-center mb-12">
        <img
          src="https://silvershadowstudio.s3.eu-central-1.amazonaws.com/Silvershadow/APP+Files/SilvershadowStudio.png"
          alt="Silver Shadow Studio"
          className="w-[160px] h-auto mb-4"
          style={{ filter: "brightness(0)" }}
          referrerPolicy="no-referrer"
        />
        <div className="h-px w-10" style={{ backgroundColor: "rgba(254,207,116,0.3)" }} />
      </div>

      <div className="grid grid-cols-12 gap-x-8 mb-12">
        <div className="col-span-7 space-y-8">
          <div className="space-y-3">
            <h2 className="text-[9px] uppercase tracking-[0.3em] font-bold" style={{ color: "hsl(var(--gold))" }}>Billed To</h2>
            <div className="space-y-1">
              <p className="text-[13px] font-light tracking-tight leading-none">{data.client.name || "Client Name"}</p>
              <p className="leading-relaxed max-w-[260px]" style={{ color: "rgba(51,51,51,0.8)" }}>{data.client.address || "Address"}</p>
              <p className="text-[9px] pt-1 tracking-wider" style={{ color: "rgba(51,51,51,0.6)" }}>{data.client.contact}</p>
            </div>
          </div>
          <div className="space-y-3">
            <h2 className="text-[9px] uppercase tracking-[0.3em] font-bold" style={{ color: "hsl(var(--gold))" }}>Project</h2>
            <p className="font-light text-[11px] tracking-tight">{data.client.project || "Project Name"}</p>
          </div>
        </div>
        <div className="col-span-5 flex justify-end">
          <div className="grid grid-cols-[110px,90px] gap-y-2 text-right">
            <span className="uppercase tracking-[0.15em] text-[9px]" style={{ color: "rgba(51,51,51,0.6)" }}>Invoice No.</span>
            <span className="font-light">{data.client.invoiceNumber || "N/A"}{type}</span>
            <span className="uppercase tracking-[0.15em] text-[9px]" style={{ color: "rgba(51,51,51,0.6)" }}>Issue Date</span>
            <span className="font-light">{format(invoiceDate, "dd.MM.yyyy")}</span>
            <span className="uppercase tracking-[0.15em] text-[9px]" style={{ color: "rgba(51,51,51,0.6)" }}>Due Date</span>
            <span className="font-light">{type === "A" ? format(invoiceDate, "dd.MM.yyyy") : format(dueDate, "dd.MM.yyyy")}</span>
          </div>
        </div>
      </div>

      <div className="mb-10 flex-grow">
        <table className="w-full">
          <thead>
            <tr style={{ borderBottom: "1px solid #f1f5f9" }}>
              <th className="py-4 text-left text-[9px] uppercase tracking-[0.3em] font-bold" style={{ color: "rgba(51,51,51,0.4)" }}>Description</th>
              <th className="py-4 text-right text-[9px] uppercase tracking-[0.3em] font-bold w-36" style={{ color: "rgba(51,51,51,0.4)" }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {data.items.length > 0 ? (
              data.items.map((item) => (
                <tr key={item.id} style={{ borderBottom: "1px solid #f8fafc" }}>
                  <td className="py-8 pr-12">
                    <div className="flex items-baseline gap-4 mb-2">
                      <span className="font-light text-[13px] tracking-tight">{item.description}</span>
                      <span className="text-[9px] uppercase tracking-[0.2em] font-bold" style={{ color: "rgba(51,51,51,0.3)" }}>/ {item.category}</span>
                    </div>
                    <p className="text-[10px] max-w-xl leading-relaxed font-extralight" style={{ color: "rgba(51,51,51,0.7)" }}>
                      Professional creative services and technical implementation tailored to the specific requirements of the project scope.
                    </p>
                  </td>
                  <td className="py-8 text-right align-top">
                    <span className="font-light text-[13px] tracking-tight">{formatGBP(item.price)}</span>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={2} className="py-16 text-center uppercase tracking-[0.4em] text-[9px]" style={{ color: "rgba(51,51,51,0.2)" }}>No entries recorded</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end mb-16">
        <div className="w-80 space-y-5">
          <div className="space-y-3">
            <div className="flex justify-between text-[9px] uppercase tracking-[0.15em]" style={{ color: "rgba(51,51,51,0.6)" }}>
              <span>Subtotal</span>
              <span className="font-light" style={{ color: "#333" }}>{formatGBP(subtotal)}</span>
            </div>
            <div className="flex justify-between text-[9px] uppercase tracking-[0.15em]" style={{ color: "rgba(51,51,51,0.6)" }}>
              <span>Tax ({data.vatRate}%)</span>
              <span className="font-light" style={{ color: "#333" }}>{formatGBP(vatAmount)}</span>
            </div>
          </div>
          <div className="h-px" style={{ backgroundColor: "#f8fafc" }} />
          <div className="flex justify-between items-baseline pt-1">
            <span className="font-bold uppercase tracking-[0.3em] text-[9px]">Total Amount</span>
            <span className="text-3xl font-extralight tracking-tighter">{formatGBP(grandTotal)}</span>
          </div>

          <div className="mt-10 pt-8" style={{ borderTop: "1px solid #f8fafc" }}>
            <div className="flex justify-between items-end">
              <div className="space-y-2">
                <h3 className="font-bold uppercase tracking-[0.3em] text-[9px]" style={{ color: "hsl(var(--gold))" }}>
                  {type === "A" ? "Initial Downpayment" : "Final Balance Due"}
                </h3>
                <p className="text-[9px] italic tracking-wider" style={{ color: "rgba(51,51,51,0.6)" }}>
                  {type === "A" ? `Required ${data.downpaymentRate}% to commence work` : `Remaining balance after initial ${data.downpaymentRate}%`}
                </p>
              </div>
              <span className="text-2xl font-light tracking-tighter">
                {formatGBP(type === "A" ? downpaymentAmount : balanceAmount)}
              </span>
            </div>
            {type === "B" && (
              <p className="text-[9px] uppercase tracking-[0.2em] mt-4 text-right" style={{ color: "rgba(51,51,51,0.4)" }}>
                * Adjusted for {formatGBP(downpaymentAmount)} previously settled
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="mt-auto pt-12" style={{ borderTop: "1px solid #f1f5f9" }}>
        <div className="grid grid-cols-12 gap-8 mb-16">
          <div className="col-span-4 space-y-6">
            <h2 className="text-[9px] uppercase tracking-[0.4em] font-bold" style={{ color: "hsl(var(--gold))" }}>Local Settlement</h2>
            <div className="space-y-4">
              <div className="flex flex-col">
                <span className="text-[8px] uppercase tracking-[0.2em] mb-1" style={{ color: "rgba(51,51,51,0.3)" }}>Institution</span>
                <span className="font-light tracking-tight text-[11px]">{data.bank.bankName}</span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col">
                  <span className="text-[8px] uppercase tracking-[0.2em] mb-1" style={{ color: "rgba(51,51,51,0.3)" }}>Sort Code</span>
                  <span className="font-light tracking-tight text-[11px]">{data.bank.sortCode}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[8px] uppercase tracking-[0.2em] mb-1" style={{ color: "rgba(51,51,51,0.3)" }}>Account</span>
                  <span className="font-light tracking-tight text-[11px]">{data.bank.accountNumber}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="col-span-5 space-y-6">
            <h2 className="text-[9px] uppercase tracking-[0.4em] font-bold" style={{ color: "hsl(var(--gold))" }}>International Transfer</h2>
            <div className="space-y-4">
              <div className="flex flex-col">
                <span className="text-[8px] uppercase tracking-[0.2em] mb-1" style={{ color: "rgba(51,51,51,0.3)" }}>IBAN</span>
                <span className="font-light tracking-tight text-[11px] break-all">{data.bank.iban}</span>
              </div>
              <div className="flex flex-col">
                <span className="text-[8px] uppercase tracking-[0.2em] mb-1" style={{ color: "rgba(51,51,51,0.3)" }}>SWIFT / BIC</span>
                <span className="font-light tracking-tight text-[11px]">{data.bank.swiftCode}</span>
              </div>
            </div>
          </div>

          <div className="col-span-3 flex flex-col justify-end items-end text-right">
            <div className="h-16 w-px mb-6 mr-1" style={{ backgroundColor: "rgba(254,207,116,0.3)" }} />
            <p className="text-[8px] leading-relaxed uppercase tracking-[0.25em] font-medium" style={{ color: "rgba(51,51,51,0.4)" }}>
              Electronic transfer preferred.<br />Please quote invoice ref.
            </p>
          </div>
        </div>

        <div className="pt-10" style={{ borderTop: "1px solid rgba(241,245,249,0.5)" }}>
          <div className="flex justify-between items-start text-[8px] uppercase tracking-[0.2em] leading-loose" style={{ color: "rgba(51,51,51,0.4)" }}>
            <div className="space-y-0.5">
              <p className="font-medium" style={{ color: "rgba(51,51,51,0.6)" }}>SILVERSHADOW STUDIO LTD</p>
              <p>Registered in England &amp; Wales: 9178937</p>
              <p>VAT Number: GB 232 8467 02</p>
            </div>
            <div className="text-right space-y-0.5">
              <p>332 Ladbroke Grove, London W10 5AD</p>
              <p>+44(0)203 876 5980</p>
              <p className="font-bold pt-3 tracking-[0.6em]" style={{ color: "rgba(51,51,51,0.8)" }}>SILVERSHADOWSTUDIO.COM</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
