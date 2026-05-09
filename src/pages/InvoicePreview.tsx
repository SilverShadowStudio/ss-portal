import { useEffect } from "react";

const FONT_LINK_ID = "invoice-preview-fonts";

export default function InvoicePreview() {
  useEffect(() => {
    if (document.getElementById(FONT_LINK_ID)) return;
    const link = document.createElement("link");
    link.id = FONT_LINK_ID;
    link.rel = "stylesheet";
    link.href =
      "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;1,400&display=swap";
    document.head.appendChild(link);
  }, []);

  const serif = `'Cormorant Garamond', 'Times New Roman', serif`;
  const sans = `'Neue Haas Grotesk', 'Helvetica Neue', Helvetica, Arial, sans-serif`;
  const ink = "#1A1814";
  const muted = "#8C8880";
  const paper = "#F2EDE6";
  const rule = "#D4CFC8";

  const label: React.CSSProperties = {
    fontFamily: sans,
    fontSize: 9,
    letterSpacing: "0.25em",
    fontWeight: 500,
    textTransform: "uppercase",
    color: muted,
  };

  const body: React.CSSProperties = {
    fontFamily: sans,
    fontSize: 13,
    lineHeight: 1.7,
    fontWeight: 300,
    color: ink,
  };

  const meta: React.CSSProperties = {
    fontFamily: sans,
    fontSize: 15,
    fontWeight: 400,
    color: ink,
  };

  return (
    <div style={{ background: paper, minHeight: "100vh", width: "100%" }}>
      <div
        style={{
          maxWidth: 680,
          margin: "0 auto",
          padding: "80px 64px",
          color: ink,
          fontFamily: sans,
        }}
      >
        {/* Header */}
        <div>
          <div style={label}>Invoice</div>
          <div style={{ marginTop: 18 }}>
            <div
              style={{
                fontFamily: serif,
                fontSize: 22,
                letterSpacing: "0.2em",
                fontWeight: 300,
                color: ink,
              }}
            >
              SILVERSHADOW
            </div>
            <div
              style={{
                fontFamily: sans,
                fontSize: 9,
                letterSpacing: "0.35em",
                fontWeight: 400,
                color: muted,
                marginTop: 4,
              }}
            >
              STUDIO
            </div>
          </div>
        </div>

        {/* Metadata row */}
        <div
          style={{
            marginTop: 48,
            display: "grid",
            gridTemplateColumns: "1fr 1fr 1fr",
            gap: 24,
          }}
        >
          <div>
            <div style={label}>Invoice No.</div>
            <div style={{ ...meta, marginTop: 10 }}>MAY001 RCN002</div>
          </div>
          <div>
            <div style={label}>Date Issued</div>
            <div style={{ ...meta, marginTop: 10 }}>05 May 2026</div>
          </div>
          <div>
            <div style={label}>Status</div>
            <div style={{ ...meta, marginTop: 10 }}>Sent</div>
          </div>
        </div>

        {/* From / Billed To */}
        <div
          style={{
            marginTop: 40,
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 40,
          }}
        >
          <div>
            <div style={label}>From</div>
            <div style={{ ...body, marginTop: 12 }}>
              Silvershadow Studio Limited
              <br />
              332 Ladbroke Grove
              <br />
              London W10 5AD
              <br />
              England, United Kingdom
              <br />
              Company No. 09178937
              <br />
              silvershadowstudio.com
            </div>
          </div>
          <div>
            <div style={label}>Billed To</div>
            <div style={{ ...body, marginTop: 12 }}>
              Maybourne Hotels Limited
              <br />
              27 Knightsbridge
              <br />
              SW1X 7LY London
              <br />
              United Kingdom
              <br />
              Reg. No. 03669284
              <br />
              Lukas Petak — Interior Architectural Design Manager
              <br />
              lpetak@maybourne.com
            </div>
          </div>
        </div>

        {/* Line items */}
        <div style={{ marginTop: 48 }}>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr auto",
              gap: 24,
            }}
          >
            <div style={label}>Description</div>
            <div style={{ ...label, textAlign: "right" }}>Amount</div>
          </div>
          <div
            style={{
              marginTop: 20,
              display: "grid",
              gridTemplateColumns: "1fr auto",
              gap: 24,
              fontFamily: sans,
              fontSize: 14,
              fontWeight: 300,
              color: ink,
              lineHeight: 1.7,
            }}
          >
            <div>AS PER QUOTATION MAY001-RCN002 — 1 × GBP 1,000.00</div>
            <div style={{ textAlign: "right" }}>GBP 1,000.00</div>
          </div>
        </div>

        {/* Hairline */}
        <div
          style={{
            marginTop: 40,
            height: 0.5,
            background: rule,
            width: "100%",
          }}
        />

        {/* Totals */}
        <div
          style={{
            marginTop: 32,
            display: "flex",
            justifyContent: "flex-end",
          }}
        >
          <div style={{ minWidth: 280 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontFamily: sans,
                fontSize: 13,
                fontWeight: 300,
                color: ink,
                lineHeight: 1.7,
              }}
            >
              <span style={{ color: muted }}>Subtotal</span>
              <span>GBP 1,000.00</span>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontFamily: sans,
                fontSize: 13,
                fontWeight: 300,
                color: ink,
                lineHeight: 1.7,
              }}
            >
              <span style={{ color: muted }}>VAT 20%</span>
              <span>GBP 200.00</span>
            </div>

            <div style={{ marginTop: 28, textAlign: "right" }}>
              <div
                style={{
                  fontFamily: sans,
                  fontSize: 10,
                  letterSpacing: "0.25em",
                  fontWeight: 500,
                  textTransform: "uppercase",
                  color: muted,
                }}
              >
                Total Due
              </div>
              <div
                style={{
                  fontFamily: serif,
                  fontSize: 52,
                  fontWeight: 300,
                  color: ink,
                  marginTop: 8,
                  lineHeight: 1.1,
                }}
              >
                GBP 1,200.00
              </div>
            </div>
          </div>
        </div>

        {/* Payment Details */}
        <div
          style={{
            marginTop: 40,
            height: 0.5,
            background: rule,
            width: "100%",
          }}
        />
        <div style={{ marginTop: 40 }}>
          <div style={label}>Payment Details</div>
          <div
            style={{
              marginTop: 40,
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 40,
            }}
          >
            <div>
              <div style={label}>Bank Name</div>
              <div style={{ ...body, marginTop: 12 }}>Revolut</div>
              <div style={{ ...label, marginTop: 20 }}>Sort Code</div>
              <div style={{ ...body, marginTop: 12 }}>04-00-75</div>
              <div style={{ ...label, marginTop: 20 }}>Account Number</div>
              <div style={{ ...body, marginTop: 12 }}>75 91 35 42</div>
            </div>
            <div>
              <div style={label}>Swift Code</div>
              <div style={{ ...body, marginTop: 12 }}>REVOGB21</div>
              <div style={{ ...label, marginTop: 20 }}>IBAN</div>
              <div style={{ ...body, marginTop: 12 }}>
                GB91 REVO 0099 6974 0692 71
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div style={{ marginTop: 40, textAlign: "center" }}>
          <div
            style={{
              fontFamily: serif,
              fontStyle: "italic",
              fontSize: 16,
              fontWeight: 400,
              color: ink,
            }}
          >
            Thank you.
          </div>
          <div
            style={{
              marginTop: 14,
              fontFamily: sans,
              fontSize: 9,
              letterSpacing: "0.25em",
              fontWeight: 500,
              textTransform: "uppercase",
              color: muted,
            }}
          >
            SILVERSHADOWSTUDIO.COM
          </div>
        </div>
      </div>
    </div>
  );
}