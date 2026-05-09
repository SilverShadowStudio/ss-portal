import React, { forwardRef, useEffect } from "react";
import { SILVERSHADOW_LOGO_DATA_URL } from "@/lib/brandLogo";
import { getBankAccount } from "@/lib/bankAccounts";

const FONT_LINK_ID = "invoice-doc-fonts";

export interface InvoiceDocumentData {
  invoice_number?: string | null;
  reference_number?: string | null;
  status?: string | null;
  issued_at?: string | null;
  created_at?: string | null;
  due_date?: string | null;
  currency?: string | null;
  amount?: number | null;
  subtotal?: number | null;
  vat_rate?: number | null;
  vat_amount?: number | null;
  notes?: string | null;
  line_items?: Array<{ description?: string; quantity?: number; unit_price?: number }>;
  bank_account?: string | null;
  client_company?: string | null;
  client_name?: string | null;
  client_address?: string | null;
  client_country?: string | null;
  client_registration?: string | null;
  client_position?: string | null;
  client_email?: string | null;
}

function fmtMoney(amount: number, currency = "GBP") {
  const n = new Intl.NumberFormat("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount || 0);
  return `${currency} ${n}`;
}

function fmtDate(d?: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

export const InvoiceDocument = forwardRef<HTMLDivElement, { data: InvoiceDocumentData }>(
  function InvoiceDocument({ data }, ref) {
    useEffect(() => {
      if (document.getElementById(FONT_LINK_ID)) return;
      const link = document.createElement("link");
      link.id = FONT_LINK_ID;
      link.rel = "stylesheet";
      link.href =
        "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,300&family=Cormorant+SC:wght@300;400&display=swap";
      document.head.appendChild(link);
    }, []);

    const serif = `'Cormorant Garamond', 'Times New Roman', serif`;
    const labelFont = `'Cormorant SC', 'Cormorant Garamond', serif`;
    const sans = `'Neue Haas Grotesk', 'Helvetica Neue', Helvetica, Arial, sans-serif`;
    const mono = serif;
    const ink = "#1A1814";
    const muted = "#6B6358";
    const mutedDark = "#6B6358";
    const ruleLight = "#C8C0B0";
    const ruleHeavy = "#1A1814";
    const paper = "#D9D3C4";
    const page = "#FAF8F4";

    const label: React.CSSProperties = {
      fontFamily: labelFont,
      fontSize: 8.5,
      letterSpacing: "0.16em",
      textTransform: "uppercase",
      color: muted,
      fontWeight: 300,
    };
    const body: React.CSSProperties = {
      fontFamily: serif,
      fontSize: 13.5,
      lineHeight: 1.65,
      fontWeight: 300,
      color: ink,
    };
    const monoBody: React.CSSProperties = {
      fontFamily: serif,
      fontSize: 13.5,
      lineHeight: 1.65,
      fontWeight: 300,
      color: ink,
    };

    const currency = data.currency || "GBP";
    const items =
      data.line_items && data.line_items.length > 0
        ? data.line_items
        : [{ description: "Services", quantity: 1, unit_price: Number(data.amount) || 0 }];

    const computedSubtotal = items.reduce(
      (s, it) => s + (Number(it.quantity) || 0) * (Number(it.unit_price) || 0),
      0,
    );
    const subtotal = Number(data.subtotal ?? computedSubtotal);
    const vatRate = Number(data.vat_rate ?? 0);
    const vatAmount = Number(data.vat_amount ?? (subtotal * vatRate) / 100);
    const grand = Number(data.amount ?? subtotal + vatAmount);
    const number = data.invoice_number || data.reference_number || "—";

    const bank = getBankAccount(data.bank_account);

    const addressParts = (data.client_address || "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    // From block
    const fromCompany = "Silvershadow Studio Limited";
    const fromAddress = ["332 Ladbroke Grove", "London W10 5AD", "United Kingdom"];
    const fromCoNo = "Co. No. 09178937";

    // Contact
    const contactName = "Inès Messad";
    const contactRole = "Finance Coordinator";
    const contactEmail = "accounting@silvershadowstudio.com";

    // Billed to
    const billedCompany = data.client_company || "Maybourne Hotels Limited";
    const country = data.client_country || "United Kingdom";
    const billedAddress = addressParts.length
      ? (addressParts.some((l) => l.toLowerCase() === country.toLowerCase())
          ? addressParts
          : [...addressParts, country])
      : ["27 Knightsbridge", "SW1X 7LY London", country];
    const billedCoNo = data.client_registration
      ? `Co. No. ${data.client_registration}`
      : "Co. No. 03669284";

    // Attention
    const attnName = data.client_name || "Lukas Petak";
    const attnRole = data.client_position || "Interior Architectural Design Manager";
    const attnEmail = data.client_email || "lpetak@maybourne.com";

    const Section = ({ children }: { children: React.ReactNode }) => (
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>{children}</div>
    );

    const Field = ({ heading, children, mono: useMono }: { heading: string; children: React.ReactNode; mono?: boolean }) => (
      <div>
        <div style={label}>{heading}</div>
        <div style={{ ...(useMono ? monoBody : body), marginTop: 8 }}>{children}</div>
      </div>
    );

    const ruleLine = (heavy = false): React.CSSProperties => ({
      height: 0,
      borderTop: heavy ? `1px solid ${ruleHeavy}` : `1px solid ${ruleLight}`,
      width: "100%",
    });

    return (
      <div
        ref={ref}
        style={{
          background: paper,
          width: 794,
          padding: 0,
          margin: "0 auto",
          fontFamily: sans,
          color: ink,
        }}
      >
        <div
          style={{
            background: page,
            width: 794,
            margin: "0 auto",
            height: 1123,
            padding: "56px 64px 40px",
            boxSizing: "border-box",
            display: "flex",
            flexDirection: "column",
          }}
        >
          {/* Logo */}
          <div>
            <img
              src={SILVERSHADOW_LOGO_DATA_URL}
              alt="Silvershadow Studio"
              style={{ width: 150, height: "auto", display: "block" }}
              crossOrigin="anonymous"
            />
          </div>

          {/* Top rule */}
          <div style={{ ...ruleLine(false), marginTop: 36 }} />

          {/* From / Billed to */}
          <div style={{ marginTop: 28 }}>
            <Section>
              <Field heading="From">
                {fromCompany}
                <br />
                {fromAddress.map((l, i) => (
                  <React.Fragment key={i}>
                    {l}
                    <br />
                  </React.Fragment>
                ))}
                <span style={{ fontFamily: mono }}>{fromCoNo}</span>
              </Field>
              <Field heading="Billed To">
                {billedCompany}
                <br />
                {billedAddress.map((l, i) => (
                  <React.Fragment key={i}>
                    {l}
                    <br />
                  </React.Fragment>
                ))}
                <span style={{ fontFamily: mono }}>{billedCoNo}</span>
              </Field>
            </Section>
          </div>

          {/* Contact / Attention */}
          <div style={{ marginTop: 24 }}>
            <Section>
              <Field heading="Contact">
                {contactName}
                <br />
                {contactRole}
                <br />
                {contactEmail}
              </Field>
              <Field heading="Attention">
                {attnName}
                <br />
                {attnRole}
                <br />
                {attnEmail}
              </Field>
            </Section>
          </div>

          {/* Date / Reference */}
          <div style={{ marginTop: 24 }}>
            <Section>
              <Field heading="Date Issued" mono>
                {fmtDate(data.issued_at || data.created_at)}
              </Field>
              <Field heading="Reference" mono>
                <span style={{ fontVariantNumeric: "tabular-nums", fontVariantLigatures: "none" }}>{number}</span>
              </Field>
            </Section>
          </div>

          {/* Section opener rule */}
          <div style={{ ...ruleLine(false), marginTop: 28 }} />

          {/* Line items */}
          <div style={{ marginTop: 16 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto",
                gap: 24,
                paddingBottom: 10,
              }}
            >
              <div style={label}>Description</div>
              <div style={{ ...label, textAlign: "right" }}>Amount</div>
            </div>
            {items.map((it, i) => {
              const qty = Number(it.quantity) || 0;
              const unit = Number(it.unit_price) || 0;
              const total = qty * unit;
              return (
                <div
                  key={i}
                  style={{
                    paddingTop: 12,
                    paddingBottom: 12,
                    display: "grid",
                    gridTemplateColumns: "1fr auto",
                    gap: 24,
                    alignItems: "baseline",
                    borderTop: i === 0 ? "none" : `1px solid ${ruleLight}`,
                  }}
                >
                  <div style={body}>
                    {it.description || "—"}
                    {(qty || unit) ? (
                      <span style={{ color: mutedDark, fontFamily: serif, marginLeft: 8 }}>
                        — {qty} × {fmtMoney(unit, currency)}
                      </span>
                    ) : null}
                  </div>
                  <div style={{ ...monoBody, textAlign: "right" }}>{fmtMoney(total, currency)}</div>
                </div>
              );
            })}
          </div>

          {/* Subtotal / VAT */}
          <div style={{ ...ruleLine(false), marginTop: 8 }} />
          <div style={{ marginTop: 12 }}>
            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr auto",
                gap: 24,
                rowGap: 6,
              }}
            >
              <div style={{ ...body, fontSize: 11, color: muted }}>Subtotal</div>
              <div style={{ ...monoBody, fontSize: 11, color: muted, textAlign: "right" }}>{fmtMoney(subtotal, currency)}</div>
              <div style={{ ...body, fontSize: 11, color: muted }}>VAT {vatRate}%</div>
              <div style={{ ...monoBody, fontSize: 11, color: muted, textAlign: "right" }}>{fmtMoney(vatAmount, currency)}</div>
            </div>
          </div>

          {/* Total */}
          <div style={{ ...ruleLine(true), marginTop: 16 }} />
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto",
              gap: 24,
              alignItems: "baseline",
              padding: "14px 0",
            }}
          >
            <div
              style={{
                fontFamily: labelFont,
                fontSize: 8,
                letterSpacing: "0.2em",
                textTransform: "uppercase",
                color: ink,
                fontWeight: 300,
              }}
            >
              Total Due
            </div>
            <div
              style={{
                fontFamily: serif,
                fontStyle: "normal",
                fontSize: 32,
                fontWeight: 300,
                letterSpacing: "0.02em",
                color: ink,
                fontVariantNumeric: "lining-nums tabular-nums",
              }}
            >
              <span style={{ whiteSpace: "nowrap", wordSpacing: 0, letterSpacing: "0.02em" }}>{fmtMoney(grand, currency)}</span>
            </div>
          </div>
          <div style={ruleLine(true)} />

          {/* Spacer */}
          <div style={{ flex: 1, minHeight: 24 }} />

          {/* Payment details */}
          <div>
            <div style={label}>Payment Details</div>
            <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24, rowGap: 14 }}>
              <div>
                <div style={label}>Bank</div>
                <div style={{ ...monoBody, marginTop: 4 }}>{bank.bankName}</div>
              </div>
              <div>
                <div style={label}>Swift</div>
                <div style={{ ...monoBody, marginTop: 4 }}>{bank.swiftCode}</div>
              </div>
              <div>
                <div style={label}>Sort Code</div>
                <div style={{ ...monoBody, marginTop: 4 }}>{bank.sortCode}</div>
              </div>
              <div>
                <div style={label}>IBAN</div>
                <div style={{ ...monoBody, marginTop: 4 }}>{bank.iban}</div>
              </div>
              <div>
                <div style={label}>Account</div>
                <div style={{ ...monoBody, marginTop: 4 }}>{bank.accountNumber}</div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div style={{ marginTop: 20, borderTop: `1px solid ${ruleLight}`, paddingTop: 14, textAlign: "center" }}>
            <div
              style={{
                fontFamily: labelFont,
                fontSize: 7.5,
                letterSpacing: "0.22em",
                textTransform: "uppercase",
                color: muted,
                fontWeight: 300,
              }}
            >
              silvershadowstudio.com
            </div>
          </div>
        </div>
      </div>
    );
  },
);
