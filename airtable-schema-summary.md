# Airtable Base — Schema Audit

**Fetched**: 2026-06-17  
**Total tables**: 22  
**Total fields**: 552  
**PAT scope tested**: `schema.bases:read` confirmed (successful fetch)  

---

## Portal boundary map

### Tables the portal WRITES to

| Table | Table ID | Edge functions | Fields written |
|-------|----------|----------------|----------------|
| **Tasks** | `tbleHaU9DxHyvixdL` | airtable-sync (push-scene, push-status), airtable-auto-sync | Task name; Status; Deadline |
| **Clients** | `tblWDmSeRB4P88ALw` | airtable-sync-contact, airtable-sync-project | Company name (field name from config); Address fields (6 configurable); linked client on project creation |
| **Projects** | `tblB4sEUfuFQOv2lA` | airtable-sync-project | Project name, client link (configurable field names) |

### Tables the portal READS (no writes)

| Table | Table ID | Edge functions | Write mapping documented? |
|-------|----------|----------------|--------------------------|
| **Models** | `tbls6j4jyNifFyucU` | airtable-list-models (READ only — via AIRTABLE_TABLE_ID env var) | Read-only — no write mapping needed |
| **Users** | `tbl8V5Hd20UN9Jax6` | airtable-sync-contact (READ only — contact/rep lookup) | Read-only — no write mapping needed |

### Tables not touched by the portal (safe — Kieran's exclusive domain)

| Table | Table ID | Purpose |
|-------|----------|---------|
| Subscriptions | `tblG9P42dNobAFnli` | Subscriptions — subscription agreements/pricing |
| Cost Configurator | `tblbfVUpIB9BZkJvb` | Cost Configurator — rates and cost modelling |
| Project Invoices | `tbliIuNkZdGuqHHfF` | Project Invoices — project invoice records |
| Existing Models | `tblPI5UKhZEC38IV4` | Existing Models — pre-existing 3D model assets |
| Model Manufacturer | `tblQehy0iVh2odNJb` | Model Manufacturer — manufacturer reference |
| Modeller Invoices | `tbl6WfMgznJYgevRt` | Modeller Invoices — freelance modeller invoicing |
| Scene Manager Day Logs | `tblCOVVdOsjRt06iO` | Scene Manager Day Logs — daily time entries (payroll) |
| Scene Manager Invoice | `tblhYCC3InxUJUK3H` | Scene Manager Invoice — scene manager invoicing |
| Partner Studios Invoice Monthly | `tbl4fdObC6NYOUINx` | Partner Studios Invoice Monthly — subscription invoicing |
| Partner Studios Invoices Contract | `tblBUVWHpphKDiEKS` | Partner Studios Invoices Contract — contract invoice |
| Photographer Timesheet | `tblsqmojQaxNM27GG` | Photographer Timesheet — photography time tracking |
| Photographer Invoice | `tblCoQXYZuUCh0Vgc` | Photographer Invoice — photography invoicing |
| Team Holiday Tracker | `tblDJjhosve79HISi` | Team Holiday Tracker — time off tracking |
| Files | `tblk26tFAXfnlHdZf` | Files — file attachments |
| Renderoo Tier Pricing | `tblgsMkzYNecev9DN` | Renderoo Tier Pricing — render pricing tiers |
| Renderoo Total Pricing | `tbl2oAGaXONrg6wOX` | Renderoo Total Pricing — render total pricing |
| Director Tasks | `tblKEai6IGMOzQWFT` | Director Tasks — director-level task tracking |

---

## Full field listing by table

Computed fields (formula/rollup/lookup/etc.) are marked **[computed — write protected]**.

### Users 🟡 *portal reads*
`tbl8V5Hd20UN9Jax6` — 55 fields

- `Name` _formula_ **[computed — write protected]** — `{fldnOCgd3CHuo9sCR} & "-" & {fldaCG1XaX2QpD6IR}
`
- `First Name` _singleLineText_
- `Surname` _singleLineText_
- `Full Name` _formula_ **[computed — write protected]** — `{fldnOCgd3CHuo9sCR} & "-" & {fldaCG1XaX2QpD6IR}
`
- `Company` _multipleRecordLinks_ — → linked to **Clients**; (bidirectional link)
- `Role` _singleSelect_ — options: `Client` / `Managing Director` / `Production Director` / `Production Manager` / `Production Coordinator ` / `Scene Manager` / `Modeller` / `Photographer` / `Partner Studios`
- `Email` _email_
- `Phone` _multilineText_
- `Timesheet` _url_
- `Photo` _multipleAttachments_
- `Project Member` _multipleRecordLinks_ — → linked to **Projects**; (bidirectional link)
- `Tasks` _multipleRecordLinks_ — → linked to **Tasks**; (bidirectional link)
- `Day Rate (£)` _number_
- `Hourly Rate (£)` _number_
- `Models` _multipleRecordLinks_ — → linked to **Models**; (bidirectional link)
- `Modeller Invoice Period` _multipleRecordLinks_ — → linked to **Modeller Invoices**; (bidirectional link)
- `Scene Manager Invoice` _multipleRecordLinks_ — → linked to **Scene Manager Invoice**; (bidirectional link)
- `Scene Manager Day Logs` _multipleRecordLinks_ — → linked to **Scene Manager Day Logs**; (bidirectional link)
- `Photographer Timesheet` _multipleRecordLinks_ — → linked to **Photographer Timesheet**; (bidirectional link)
- `Photographer Invoice` _multipleRecordLinks_ — → linked to **Photographer Invoice**; (bidirectional link)
- `Clients` _multipleRecordLinks_ — → linked to **Clients**; (bidirectional link)
- `Tasks copy` _multipleRecordLinks_ — → linked to **Tasks**; (bidirectional link)
- `Tasks 2` _multipleRecordLinks_ — → linked to **Tasks**; (bidirectional link)
- `Models 2` _multipleRecordLinks_ — → linked to **Models**; (bidirectional link)
- `Project Member of (Lookup)` _multipleLookupValues_ **[computed — write protected]**
- `Active Tasks` _multipleLookupValues_ **[computed — write protected]**
- `Upcoming Tasks` _multipleLookupValues_ **[computed — write protected]**
- `Number of Active Tasks` _rollup_ **[computed — write protected]**
- `Available?` _formula_ **[computed — write protected]**
- `Number of Upcoming Tasks` _rollup_ **[computed — write protected]**
- `Active Project` _multipleLookupValues_ **[computed — write protected]**
- `Number of Active Models` _rollup_ **[computed — write protected]**
- `Number of Models TO DO` _rollup_ **[computed — write protected]**
- `HOURS Number of Active Models` _rollup_ **[computed — write protected]**
- `HOURS Upcoming Models` _rollup_ **[computed — write protected]**
- `Modeller Workload (Hours)` _formula_ **[computed — write protected]** — `{fldgLuh6CCxLK8QH9} + {fldRFj7SxRGhgOJBm}`
- `Modeller Work Volume` _formula_ **[computed — write protected]**
- `What Models do they do well?` _richText_
- `Task Start Date (Lookup)` _multipleLookupValues_ **[computed — write protected]**
- `Task Deadline (Lookup)` _multipleLookupValues_ **[computed — write protected]**
- `Team Holiday Tracker` _multipleRecordLinks_ — → linked to **Team Holiday Tracker**; (bidirectional link)
- `Total Number of Annual Leave Days` _number_
- `Number of Days taken Rollup (from Team Holiday Tracker)` _rollup_ **[computed — write protected]**
- `Number of Annual Leave days remaining` _formula_ **[computed — write protected]**
- `Start Date (from Team Holiday Tracker)` _multipleLookupValues_ **[computed — write protected]**
- `Projects` _multipleRecordLinks_ — → linked to **Projects**; (bidirectional link)
- `Duration  (from Team Holiday Tracker)` _multipleLookupValues_ **[computed — write protected]**
- `Cost Configurator` _multipleRecordLinks_ — → linked to **Cost Configurator**; (bidirectional link)
- `Type of Client` _multipleSelects_ — options: `Subscription` / `Contract`
- `Director Tasks` _multipleRecordLinks_ — → linked to **Director Tasks**; (bidirectional link)
- `Cost per Image (£)` _number_
- `Scene Manager Invoice copy` _multipleRecordLinks_ — → linked to **Partner Studios Invoice Monthly**; (bidirectional link)
- `Partner Studios Invoices` _multipleRecordLinks_ — → linked to **Partner Studios Invoices Contract**; (bidirectional link)
- `Client Role` _singleSelect_ — options: `Client Representative` / `Client Team Member`
- `Clients copy` _multipleRecordLinks_ — → linked to **Clients**; (bidirectional link)

### Clients 🔵 *portal writes*
`tblWDmSeRB4P88ALw` — 44 fields

- `Company name` _singleLineText_
- `Industry` _singleSelect_ — options: `INTERIOR DESIGN` / `ASSET MANAGEMENT FIRM` / `ARCH VIZ` / `ARCHITECTURE FIRM` / `DEVELOPER` / ``
- `Size` _singleSelect_ — options: `1-15` / `15-50` / `50-99` / `100+`
- `Building` _singleLineText_
- `Street name` _singleLineText_
- `City` _singleLineText_
- `Postcode` _singleLineText_
- `Country` _singleLineText_
- `Registration number` _singleLineText_
- `Website` _multilineText_
- `Logo` _multilineText_
- `Client Representative` _multipleRecordLinks_ — → linked to **Users**; (bidirectional link)
- `Client Team Member` _multipleRecordLinks_ — → linked to **Users**; (bidirectional link)
- `Formula Client Representative` _formula_ **[computed — write protected]** — `{fldCePwaPHdh6dcbL}`
- `Client Representative Email` _multipleLookupValues_ **[computed — write protected]**
- `Projects` _multipleRecordLinks_ — → linked to **Projects**; (bidirectional link)
- `Subscriptions` _multipleRecordLinks_ — → linked to **Subscriptions**; (bidirectional link)
- `Project Invoices` _multipleRecordLinks_ — → linked to **Project Invoices**; (bidirectional link)
- `Photographer Timesheet` _multipleRecordLinks_ — → linked to **Photographer Timesheet**; (bidirectional link)
- `Scene Manager Day Logs` _singleLineText_
- `Models` _multipleRecordLinks_ — → linked to **Models**; (bidirectional link)
- `Client Contracts Total Value (£)` _rollup_ **[computed — write protected]**
- `Invoice Total Rollup (from Project Invoices)` _rollup_ **[computed — write protected]**
- `Project Total Cost (£) Rollup (from Projects)` _rollup_ **[computed — write protected]**
- `Subscription Fee Rollup (from Subscriptions)` _rollup_ **[computed — write protected]**
- `Day Total Cost (£) Rollup (from Scene Manager Day Logs)` _rollup_ **[computed — write protected]**
- `Model Cost Rollup (from Models)` _rollup_ **[computed — write protected]**
- `Photographer Total Cost (£)` _rollup_ **[computed — write protected]**
- `Client Total Revenue (£)` _formula_ **[computed — write protected]** — `{fldZIVQtP8VzhuiJT} + {fldZBz8fWcUuFlvFw}`
- `Client Total Cost (£)` _formula_ **[computed — write protected]** — `{fldQqChH9yvTxVC5j} + {fldjY3XNwcGjob4UV} + {fld0gJznp106D7wyQ}`
- `Client Total Profit (£)` _formula_ **[computed — write protected]** — `{fldBmcPNQ4WKYFVJY} - {fld5gTOGqI444ckid}`
- `Calculation` _formula_ **[computed — write protected]** — `({fldBmcPNQ4WKYFVJY} - {fld5gTOGqI444ckid})/ {fldBmcPNQ4WKYFVJY}`
- `Subscription Fee Rollup CURRENT MONTH` _rollup_ **[computed — write protected]**
- `Day Total Cost (£) Rollup CURRENT MONTH` _rollup_ **[computed — write protected]**
- `Model Cost Rollup CURRENT MONTH` _rollup_ **[computed — write protected]**
- `Monthly Subscription Profit (£)` _formula_ **[computed — write protected]** — `{fld4qACKqPNg3WzRG} - ({fldBtc58OY8XPy4Z2} + {fldS46Z3GuZ4xRsgq})`
- `Monthly Subscription Profit (%)` _formula_ **[computed — write protected]** — `({fld4qACKqPNg3WzRG} - ({fldBtc58OY8XPy4Z2} + {fldS46Z3GuZ4xRsgq})) / {fld4qACKqPNg3WzRG}`
- `Current Month Tier (from Subscriptions)` _multipleLookupValues_ **[computed — write protected]**
- `Current Number of Production Lanes` _formula_ **[computed — write protected]** — `{fldV1mB9A5wFYtOim}`
- `Users` _multipleRecordLinks_ — → linked to **Users**; (bidirectional link)
- `Tasks` _multipleRecordLinks_ — → linked to **Tasks**; (bidirectional link)
- `Scene Manager Day Logs Link` _multipleRecordLinks_ — → linked to **Scene Manager Day Logs**; (bidirectional link)
- `Project Invoices copy` _singleLineText_
- `Record ID` _formula_ **[computed — write protected]** — `RECORD_ID()`

### Projects 🔵 *portal writes*
`tblB4sEUfuFQOv2lA` — 80 fields

- `Project name` _singleLineText_
- `Client Facing Project Name` _singleLineText_
- `Project Type` _singleSelect_ — options: `Client Project` / `Studio Project `
- `Contract or Subscription` _singleSelect_ — options: `Contract` / `Subscription`
- `Status` _singleSelect_ — options: `TO START` / `IN PROGRESS` / `DONE` / `PAUSED`
- `Client` _multipleRecordLinks_ — → linked to **Clients**; (bidirectional link)
- `Client Representative` _multipleLookupValues_ **[computed — write protected]**
- `Project Lead` _multipleRecordLinks_ — → linked to **Users**; (bidirectional link)
- `Project Members` _multipleRecordLinks_ — → linked to **Users**; (bidirectional link)
- `Project Member (lookup)` _multipleLookupValues_ **[computed — write protected]**
- `Client contacts` _multipleLookupValues_ **[computed — write protected]**
- `All Tasks` _multipleRecordLinks_ — → linked to **Tasks**; (bidirectional link)
- `Project Scenes` _multipleLookupValues_ **[computed — write protected]**
- `Scene Names (Flattened)` _formula_ **[computed — write protected]** — `ARRAYJOIN({fldeGgVHaNui0Z9fB}, ",")
`
- `Number of Tasks` _formula_ **[computed — write protected]** — `COUNTA(
  ARRAYUNIQUE({fldeGgVHaNui0Z9fB})
)

`
- `Start date` _date_
- `End date` _date_
- `Miro Board` _url_
- `Dropbox` _url_
- `Files` _multilineText_
- `Invoices` _multilineText_
- `Number of Rounds` _singleSelect_ — options: `1` / `2` / `3`
- `Project Costs (£)` _multipleRecordLinks_ — → linked to **Cost Configurator**; (bidirectional link)
- `Total Cost Configurated (£)` _rollup_ **[computed — write protected]**
- `Total Project Value (£)` _rollup_ **[computed — write protected]**
- `Total Extra Round Value (£)` _rollup_ **[computed — write protected]**
- `Initial amount billed` _currency_
- `Extra Round amount billed` _currency_
- `Final total amount billed` _formula_ **[computed — write protected]** — `{fldpnionVS01j9CVF} + {fldOlNQ56tSlh56P7}`
- `Models` _multipleRecordLinks_ — → linked to **Models**; (bidirectional link)
- `Scene Manager Day Logs` _multipleRecordLinks_ — → linked to **Scene Manager Day Logs**; (bidirectional link)
- `Photographer Timesheet` _multipleRecordLinks_ — → linked to **Photographer Timesheet**; (bidirectional link)
- `Round 01 Scene Manager Cost (£)` _rollup_ **[computed — write protected]**
- `Round 01 Models Cost` _rollup_ **[computed — write protected]**
- `Round 01 Photographer Cost` _rollup_ **[computed — write protected]**
- `Round 01 Total Cost (£)` _formula_ **[computed — write protected]** — `{fldKufGcEzXLOI49P} + {fldLnNv5cCqboFPSv} + {fldYK7PNjCKohZS3Y}`
- `Round 01 Total Cost (%)` _formula_ **[computed — write protected]** — `{fldS6TdqmXWEiLnHZ} / {fld9HUXHeo8PV2m28}
`
- `Round 02 Scene Manager Cost (£)` _rollup_ **[computed — write protected]**
- `Round 02 Models Cost` _rollup_ **[computed — write protected]**
- `Round 02 Photographer Cost` _rollup_ **[computed — write protected]**
- `Round 02 Total Cost (£)` _formula_ **[computed — write protected]** — `{fld5aQZCcYzAPcCRz} + {fldhaN1iIdf9RsU6o} + {fldEZM1nT1oUw8FLe}`
- `Round 02 Total Cost (%)` _formula_ **[computed — write protected]** — `{fldaikt1uNxAcee0T} / {fld9HUXHeo8PV2m28}
`
- `Round 03 Scene Manager Cost (£)` _rollup_ **[computed — write protected]**
- `Round 03 Models Cost` _rollup_ **[computed — write protected]**
- `Round 03 Photographer Cost` _rollup_ **[computed — write protected]**
- `Round 03 Total Cost (£)` _formula_ **[computed — write protected]** — `{fldvLF4CVr2gQrnA8} + {fldnUWfzfSj6bHIWs} + {fldNDx4n6HeZ6saUu}`
- `Round 03 Total Cost (%)` _formula_ **[computed — write protected]** — `{fld7ixCJIQjiVVsIH} / {fld9HUXHeo8PV2m28}
`
- `Extra Round Scene Manager Cost (£)` _rollup_ **[computed — write protected]**
- `Extra Round Models Cost` _rollup_ **[computed — write protected]**
- `Extra Round Photographer Cost` _rollup_ **[computed — write protected]**
- `Extra Round Total Cost (£)` _formula_ **[computed — write protected]** — `{fldIsva5H6yq8qkOW} + {fldItZDzg9VgY7Ql6} + {fldh7kRN23yoWHRhn}`
- `Extra Round Total Cost per Extra Round Billed Amount (%)` _formula_ **[computed — write protected]** — `{fldFyis5eCikaqFjP} / {fldOlNQ56tSlh56P7}
`
- `Extra Round Total Cost (%)` _formula_ **[computed — write protected]** — `{fldFyis5eCikaqFjP} / {fld9HUXHeo8PV2m28}
`
- `Extra Round Profit Gross (£)` _formula_ **[computed — write protected]** — `{fldOlNQ56tSlh56P7} - {fldFyis5eCikaqFjP}
`
- `Extra Round Profit Gross per Extra Round Cost (%)` _formula_ **[computed — write protected]** — `({fldOlNQ56tSlh56P7} - {fldFyis5eCikaqFjP}) / {fldOlNQ56tSlh56P7}
`
- `Total Scene Manager Cost (£)` _rollup_ **[computed — write protected]**
- `Total Models Cost` _rollup_ **[computed — write protected]**
- `Total Photographer Cost` _rollup_ **[computed — write protected]**
- `Project Total Cost (£)` _formula_ **[computed — write protected]** — `{fldYBdmfohpHBDYqc} + {fldiVk5OwkNCjXQqD} + {fldhb2FiHv0pJB7hI} + {fldXmQomYaSQEEjb1}`
- `Profit Gross (£)` _formula_ **[computed — write protected]** — `{fld9HUXHeo8PV2m28} - {fldTAuJJoGXffm3N5}
`
- `Profit Gross (%)` _formula_ **[computed — write protected]** — `({fld9HUXHeo8PV2m28} - {fldTAuJJoGXffm3N5}) / {fld9HUXHeo8PV2m28}
`
- `Total Scene Manager Cost (%)` _formula_ **[computed — write protected]**
- `Total Modeller Cost (%)` _formula_ **[computed — write protected]**
- `Total Photographer Cost (%)` _formula_ **[computed — write protected]**
- `Scene Type Camera (Lookup)` _multipleLookupValues_ **[computed — write protected]**
- `Number of Cameras per Scene (Lookup)` _multipleLookupValues_ **[computed — write protected]**
- `Number of Scenes (Lookup)` _multipleLookupValues_ **[computed — write protected]**
- `Scene Cost (Lookup)` _multipleLookupValues_ **[computed — write protected]**
- `70% Profit Project Value (£)` _formula_ **[computed — write protected]**
- `Price Gap (£)` _formula_ **[computed — write protected]** — `-({fldYjn7HbMrdQcd53} - {fldh6Fn9AULa8Qqe0})`
- `Scene Models` _multipleRecordLinks_ — → linked to **Existing Models**; (bidirectional link)
- `Files 2` _multipleRecordLinks_ — → linked to **Files**; (bidirectional link)
- `Project Invoices` _singleLineText_
- `Project Invoices (£)` _multipleRecordLinks_ — → linked to **Project Invoices**; (bidirectional link)
- `Invoice Total (from Project Invoices (£))` _multipleLookupValues_ **[computed — write protected]**
- `Current Month Tier Subscription (Client)` _multipleLookupValues_ **[computed — write protected]**
- `Client Facing Project Name Formula` _formula_ **[computed — write protected]** — `{fldypuEbFMKEl7HfT}`
- `Total Partner Studio Cost (£)` _rollup_ **[computed — write protected]**
- `Project Invoices copy` _multipleRecordLinks_ — → linked to **Partner Studios Invoices Contract**; (bidirectional link)
- `Accountable to` _multipleLookupValues_ **[computed — write protected]**

### Subscriptions ⬜ *portal does not touch*
`tblG9P42dNobAFnli` — 21 fields

- `Name` _formula_ **[computed — write protected]**
- `Client` _multipleRecordLinks_ — → linked to **Clients**; (bidirectional link)
- `Tier` _singleSelect_ — options: `01` / `02` / `03` / `04` / `05` / `06` / `07` / `08` / `09` / `10`
- `Start Date` _date_
- `Month` _formula_ **[computed — write protected]** — `DATETIME_FORMAT({fldHvfXCTmLQ7ZbGj}, "MMMM")`
- `Current Month?` _formula_ **[computed — write protected]**
- `Year` _formula_ **[computed — write protected]** — `DATETIME_FORMAT(CREATED_TIME(), "YYYY")`
- `Number of Production Lanes` _formula_ **[computed — write protected]** — `{fldsdETPvFewsKFSm}`
- `Subscription Fee` _formula_ **[computed — write protected]**
- `Link Key` _formula_ **[computed — write protected]**
- `Pro Rata Adjustment` _currency_
- `Final Fee` _formula_ **[computed — write protected]** — `{fldaNmNI3ClgQHqSP} + {fldXgcDi9HQf401Ge}`
- `Models` _multipleRecordLinks_ — → linked to **Models**; (bidirectional link)
- `Model Cost Rollup (from Models)` _rollup_ **[computed — write protected]**
- `Scene Manager Day Log Link` _multipleRecordLinks_ — → linked to **Scene Manager Day Logs**; (bidirectional link)
- `Day Total Cost (£) Rollup (Scene Manager)` _rollup_ **[computed — write protected]**
- `Partner Studios Tasks Link` _multipleRecordLinks_ — → linked to **Tasks**; (bidirectional link)
- `Cost per Image (£) Rollup (Partner Studios)` _rollup_ **[computed — write protected]**
- `Total Expenditure (£)` _formula_ **[computed — write protected]** — `{fldkNlGFVM1DZjymR} + {fldzdAImElXjlNkJ8} + {fld7vcKJbny86JYK1}`
- `Monthly Profit (£)` _formula_ **[computed — write protected]** — `{fldcFrEmZH36rv084} - {fldXR0HuRA3Wtvr03}`
- `Profit Margin (%)` _formula_ **[computed — write protected]** — `({fldcFrEmZH36rv084} - {fldXR0HuRA3Wtvr03})/{fldcFrEmZH36rv084}`

### Cost Configurator ⬜ *portal does not touch*
`tblbfVUpIB9BZkJvb` — 31 fields

- `Product Name` _formula_ **[computed — write protected]**
- `Total Cost` _formula_ **[computed — write protected]**
- `Scene Cost (Initial Scope)` _formula_ **[computed — write protected]**
- `Number of Rounds` _singleSelect_ — options: `1` / `2` / `3` / `4` / `5` / `6`
- `Scene Type Camera` _singleSelect_ — options: `Standard` / `VR` / `Animation` / `Vignettes`
- `Number of Cameras per Scene` _singleSelect_ — options: `1` / `2` / `3` / `4` / `5` / `6` / `7` / `8` / `9` / `10`
- `Animation No. Seconds` _number_
- `Scene Complexity` _number_
- `Project Key` _multipleRecordLinks_ — → linked to **Projects**; (bidirectional link)
- `Number of Scenes` _number_
- `Variations of Scene (Options)` _number_
- `Round Type` _singleSelect_ — options: `Initial Scope ` / `Extra Round `
- `Scene Cost (Extra Rounds)` _formula_ **[computed — write protected]**
- `Extra Cameras (Anywhere)` _number_
- `Project Invoices` _multipleRecordLinks_ — → linked to **Project Invoices**; (bidirectional link)
- `Initial amount billed (from Project Key)` _multipleLookupValues_ **[computed — write protected]**
- `Extra Round amount billed (from Project Key)` _multipleLookupValues_ **[computed — write protected]**
- `Contract Number ` _singleSelect_ — options: `01` / `02` / `03` / `04` / `05`
- `Information` _richText_
- `Scene Manager Budget per Scene` _formula_ **[computed — write protected]** — `{fldQ9kBzEJHiQ5uUo} * SWITCH(
  {fldpJaBY41XuGhSXn},
  "Standardised", 0.225,
  0.2
)`
- `Scene Manager Days per Scene` _formula_ **[computed — write protected]** — `{fldis0Ta4DFMCptx9} / 100`
- `Modelling Budget per Scene` _formula_ **[computed — write protected]**
- `Photographer Cost per Contract` _formula_ **[computed — write protected]** — `{fldlJPmUnLyS1mkVJ} * IF({fldIOSWelFeu4UfKx} = "VR", 0, 0.025)`
- `Scene Manager Budget per Contract` _formula_ **[computed — write protected]** — `{fldlJPmUnLyS1mkVJ} * 0.2`
- `Production Method` _singleSelect_ — options: `Bespoke ` / `Standardised` / `AI`
- `Method Coefficient` _formula_ **[computed — write protected]** — `SWITCH(
  TRIM({fldpJaBY41XuGhSXn}),
  "Bespoke", 1.0,
  "Standardised", 0.75,
  "AI", 0.5
)`
- `Modelling Budget per Contract` _formula_ **[computed — write protected]**
- `Estimated Profit per Contract` _formula_ **[computed — write protected]** — `{fldlJPmUnLyS1mkVJ} - ({fldvdtDTDLmNO0vIP} + {fldd1UukUmEulFT2G} + {fldrSOZouP6OCT7yD})`
- `Users` _multipleRecordLinks_ — → linked to **Users**; (bidirectional link)
- `Average Day Rate (£)` _rollup_ **[computed — write protected]**
- `Project Invoices copy` _singleLineText_

### Project Invoices ⬜ *portal does not touch*
`tbliIuNkZdGuqHHfF` — 25 fields

- `Name` _formula_ **[computed — write protected]** — `{fldsEDCoWDJmFHQyP} & "_" & "INV" & {fldj4iTUZy7lsPXpO}`
- `Actual Contract Value (£)` _currency_
- `Project` _multipleRecordLinks_ — → linked to **Projects**; (bidirectional link)
- `Client` _multipleRecordLinks_ — → linked to **Clients**; (bidirectional link)
- `Create Invoice` _checkbox_
- `Paid?` _singleSelect_ — options: `🔴 NO` / `🟢 YES`
- `Invoice Number ` _singleSelect_ — options: `01` / `02` / `03` / `04` / `05` / `06` / `07` / `08` / `09` / `10`
- `Payment Stage` _singleSelect_ — options: `Down Payment` / `Final Payment` / `Full Payment`
- `Contract Number  (from Cost Configurator)` _multipleLookupValues_ **[computed — write protected]**
- `Invoice Total` _formula_ **[computed — write protected]**
- `Cost Configurator` _multipleRecordLinks_ — → linked to **Cost Configurator**; (bidirectional link)
- `Project Name` _multipleLookupValues_ **[computed — write protected]**
- `Scene Type Camera (from Cost Configurator)` _multipleLookupValues_ **[computed — write protected]**
- `Round Type` _multipleLookupValues_ **[computed — write protected]**
- `Contract Value (from Cost Configurator)` _rollup_ **[computed — write protected]**
- `Contract Agreed?` _singleSelect_ — options: `🟢 YES` / `🔴 NO`
- `Initial amount billed` _multipleLookupValues_ **[computed — write protected]**
- `Extra Round amount billed` _multipleLookupValues_ **[computed — write protected]**
- `Number of Rounds (from Cost Configurator)` _multipleLookupValues_ **[computed — write protected]**
- `Number of Scenes` _multipleLookupValues_ **[computed — write protected]**
- `Number of Scenes Rollup` _rollup_ **[computed — write protected]**
- `Variations of Scene` _multipleLookupValues_ **[computed — write protected]**
- `Cost per scene` _formula_ **[computed — write protected]**
- `Date Created` _formula_ **[computed — write protected]** — `DATETIME_FORMAT(CREATED_TIME(), 'YYYY/MM/DD HH:mm')`
- `Info.` _multipleLookupValues_ **[computed — write protected]**

### Tasks 🔵 *portal writes*
`tbleHaU9DxHyvixdL` — 62 fields

- `Task name` _singleLineText_
- `Project` _multipleRecordLinks_ — → linked to **Projects**; (bidirectional link)
- `Round` _singleSelect_ — options: `Round 01` / `Round 02` / `Round 03` / `Extra Round` / `Subscription`
- `Task Type` _singleSelect_ — options: `Scene` / `Meeting` / `Milestone`
- `Phase` _singleSelect_ — options: `A` / `B` / `C` / `D` / `E`
- `Responsible Role` _multipleSelects_ — options: `Scene Manager` / `Production Management` / `Client` / `Photographer` / `Partner Studio`
- `Accountable to` _multipleRecordLinks_ — → linked to **Users**; (bidirectional link)
- `Report to` _multipleRecordLinks_ — → linked to **Users**; (bidirectional link)
- `Client (from Project)` _multipleLookupValues_ **[computed — write protected]**
- `Client (Linked)` _multipleRecordLinks_ — → linked to **Clients**; (bidirectional link)
- `Client Name` _formula_ **[computed — write protected]** — `{fldzgumOfKWjGXh43}`
- `Client Representative` _multipleLookupValues_ **[computed — write protected]**
- `Drop Box Link` _url_
- `Meeting Members` _multipleRecordLinks_ — → linked to **Users**; (bidirectional link)
- `Validated?` _singleSelect_ — options: `🟡 PENDING` / `✅ VALIDATED`
- `Status` _singleSelect_ — options: `🔴 TO DO` / `🟡 IN PROGRESS` / `🟠 REVIEW` / `🟢 DONE`
- `Client Facing Task Status` _formula_ **[computed — write protected]**
- `Subscription Revision Number` _singleSelect_ — options: `Round 01` / `Round 02` / `Round 03` / `Round 04` / `Round 05` / `Round 06` / `Round 07` / `Round 08` / `Round 09` / `Round 10`
- `Production Lane` _singleSelect_ — options: `Lane 01` / `Lane 02` / `Lane 03` / `Lane 04` / `Lane 05` / `Lane 06` / `Lane 07` / `Lane 08` / `Lane 09` / `Lane 10`
- `Start Date` _dateTime_
- `Deadline` _dateTime_
- `Deadline Status` _formula_ **[computed — write protected]**
- `Meeting Link` _url_
- `Models` _multipleRecordLinks_ — → linked to **Models**; (bidirectional link)
- `Scene Manager Day Logs` _multipleRecordLinks_ — → linked to **Scene Manager Day Logs**; (bidirectional link)
- `Scene Manager Day Logs copy` _multipleRecordLinks_ — → linked to **Photographer Timesheet**; (bidirectional link)
- `Scene Number` _singleLineText_
- `Room Name` _singleLineText_
- `Info` _richText_
- `Image Output Path` _singleLineText_
- `Project Name (lookup)` _multipleLookupValues_ **[computed — write protected]**
- `Formula Project Name` _formula_ **[computed — write protected]** — `ARRAYJOIN({fldzYRk0ICugHCF9a})`
- `Client Facing Project Name (lookup)` _multipleLookupValues_ **[computed — write protected]**
- `Formula Client Facing Project Name` _formula_ **[computed — write protected]** — `ARRAYJOIN({fld8BcFrFV5wVMbQ4})`
- `Problems with Scene` _richText_
- `Task Active on date key` _formula_ **[computed — write protected]**
- `Scene Models` _multipleRecordLinks_ — → linked to **Existing Models**; (bidirectional link)
- `Time of Day Lighting Option` _singleSelect_ — options: `Hazy Morning` / `Sunny Afternoon` / `Overcast Day` / `Golden Hour` / `Blue Hour` / `Night`
- `Artificial Lighting ` _multipleSelects_ — options: `Ambient Lighting` / `Task Lighting` / `Accent Light`
- `Aspect Ratio ` _singleSelect_ — options: `Cinematic - 16:9` / `Standard - 4:3` / `Square - 1:1` / `Vertical - 9:16`
- `Focal Length` _singleSelect_ — options: `Normal: 50mm` / `Standard Wide: 24-35mm` / `Ultra-Wide Angle: 14-22mm`
- `Perspective Correction` _singleSelect_ — options: `Vertical Tilt Shift - Two-Point Perspective` / `Natural Tilt - Three-Point Perspective`
- `Camera Height ` _singleSelect_ — options: `Editorial: 1.15m` / `Eye-level: 1.55m`
- `Entourage & Styling` _singleSelect_ — options: `No Figure` / `Static Figures` / `Motion Blurred Figures`
- `Composition` _singleSelect_ — options: `Standard` / `Framed` / `Editorial Vignette (Close up)`
- `Camera Type` _singleSelect_ — options: `Standard` / `VR` / `Animation`
- `Last Modified Time Status` _lastModifiedTime_ **[computed — write protected]**
- `Kanban Archive` _formula_ **[computed — write protected]**
- `Instructions (Client Facing)` _url_
- `Client Calendar Task Name` _formula_ **[computed — write protected]** — `{fldSJ4C8jNcv7Pr6A} & ":" & " " & {fldR5EOXyC0BytHcr}`
- `Current Month Tier Subscription (Client)` _multipleLookupValues_ **[computed — write protected]**
- `Subscription Tier` _formula_ **[computed — write protected]** — `VALUE({fldBk8eqT9MrzGDUD})`
- `Over Lane Limit?` _formula_ **[computed — write protected]**
- `Task ID` _formula_ **[computed — write protected]** — `RECORD_ID()`
- `Files` _multipleAttachments_
- `Project Type` _multipleLookupValues_ **[computed — write protected]**
- `Role` _multipleLookupValues_ **[computed — write protected]**
- `Partner Studios Invoice` _multipleRecordLinks_ — → linked to **Partner Studios Invoice Monthly**; (bidirectional link)
- `Cost per Image (£) (from Accountable to)` _multipleLookupValues_ **[computed — write protected]**
- `Subscription Link` _multipleRecordLinks_ — → linked to **Subscriptions**; (bidirectional link)
- `Actual Scene Cost (£)` _currency_
- `Partner Studios Invoices` _multipleRecordLinks_ — → linked to **Partner Studios Invoices Contract**; (bidirectional link)

### Models 🟡 *portal reads*
`tbls6j4jyNifFyucU` — 46 fields

- `Model Name` _singleLineText_
- `Project` _multipleRecordLinks_ — → linked to **Projects**; (bidirectional link)
- `Scene` _multipleRecordLinks_ — → linked to **Tasks**; (bidirectional link)
- `Round (from Scene)` _multipleLookupValues_ **[computed — write protected]**
- `Budgeted Hours` _number_
- `Reference Folder Link` _url_
- `Modeller` _multipleRecordLinks_ — → linked to **Users**; (bidirectional link)
- `Date Created` _createdTime_ **[computed — write protected]**
- `Deadline` _dateTime_
- `Status` _singleSelect_ — options: `🔴 TO DO` / `🟠 AWAITING REVIEW` / `🟡 IN PROGRESS` / `🟢 DONE`
- `Done Date` _lastModifiedTime_ **[computed — write protected]**
- `Invoice Period (Models)` _formula_ **[computed — write protected]**
- `Hourly Rate` _multipleLookupValues_ **[computed — write protected]**
- `Model Cost` _formula_ **[computed — write protected]** — `{fld13WMfDTokxMVsU} * {flddqPhtjYv0kN0tF}`
- `Current Month Key` _formula_ **[computed — write protected]** — `DATETIME_FORMAT(TODAY(), "YYYY-MM")`
- `Is Current Month` _formula_ **[computed — write protected]** — `IF(
  {fldJv66SUQIrqZctB} = DATETIME_FORMAT(TODAY(), "YYYY-MM"),
  "YES",
  "NO"
)`
- `Modeller Invoice Name` _multipleRecordLinks_ — → linked to **Modeller Invoices**; (bidirectional link)
- `Name (from Modeller)` _multipleLookupValues_ **[computed — write protected]**
- `Approval Status` _singleSelect_ — options: `🔴 CHANGES REQUIRED` / `🟢 APPROVED `
- `Deadline Status ` _formula_ **[computed — write protected]**
- `Info Complete` _singleSelect_ — options: `🔴 NO` / `🟠 REQUESTED` / `🟢 YES` / `Models on Hold`
- `What do we need?` _multilineText_
- `Accountable to (from Scene)` _multipleLookupValues_ **[computed — write protected]**
- `In the Scene?` _singleSelect_ — options: `🔴 No` / `🟢 Yes`
- `Report to (Management)` _multipleRecordLinks_ — → linked to **Users**; (bidirectional link)
- `Instructions` _richText_
- `Project Name (Lookup)` _multipleLookupValues_ **[computed — write protected]**
- `Is the model problem free? ` _singleSelect_ — options: `🟢 YES ` / `🔴 NO `
- `Report Problem with the model` _richText_
- `Category ` _singleSelect_ — options: `Chair` / `Building` / `Chandelier` / `Cabinet ` / `Arm Chair` / `Sofa` / `Accessories ` / `Appliances` / `Lighting` / `Door` / `Window` / `M&E` / `Table` / `Soft Furnishing` / `Side Table` / `Dining Chair ` / `Console Table ` / `Floor Lamp` / `Table Lamp ` / `Plumbing Fixtures` / `Office Chair` / `Cornice ` / `Mouldings ` / `Architrave ` / `Fireplace` / `Bench` / `Vegetation ` / `Stool` / `Cushions` / `HDRI` / `Pendant` / `Mirror` / `Architecture`
- `Model Manufacturer` _multipleRecordLinks_ — → linked to **Model Manufacturer**; (bidirectional link)
- `Name (from Model Manufacturer)` _multipleLookupValues_ **[computed — write protected]**
- `Scene Models` _multipleRecordLinks_ — → linked to **Existing Models**; (bidirectional link)
- `Studio Standard` _singleSelect_ — options: `🔴 NO` / `🟢 YES`
- `Asset Type` _singleSelect_ — options: `3D Model` / `Shader` / `HDRI` / `Template` / `Settings` / `Asset Library `
- `AI Generated?` _checkbox_
- `Client (from Project)` _multipleLookupValues_ **[computed — write protected]**
- `Client` _multipleRecordLinks_ — → linked to **Clients**; (bidirectional link)
- `Product Link` _url_
- `Client Facing Status` _formula_ **[computed — write protected]**
- `3DSky Upload?` _singleSelect_ — options: `🔴 NO` / `🟢 YES`
- `STL exported?` _singleSelect_ — options: `Yes` / `No`
- `Subscriptions` _singleLineText_
- `Subscription` _multipleRecordLinks_ — → linked to **Subscriptions**; (bidirectional link)
- `Modeller Invoice Month` _multipleLookupValues_ **[computed — write protected]**
- `Modeller Invoice Current Month` _formula_ **[computed — write protected]** — `IF(
  {fldbc3p8qv5Y64VTf} = DATETIME_FORMAT(TODAY(), "YY-MMMM"),
  "YES",
  "NO"
)`

### Existing Models ⬜ *portal does not touch*
`tblPI5UKhZEC38IV4` — 12 fields

- `Model Name` _formula_ **[computed — write protected]** — `{fldOei1UqYdmHVevH}`
- `Link to Models` _multipleRecordLinks_ — → linked to **Models**; (bidirectional link)
- `Projects` _multipleRecordLinks_ — → linked to **Projects**; (bidirectional link)
- `Scene` _multipleRecordLinks_ — → linked to **Tasks**; (bidirectional link)
- `Reference Folder Link (from Models)` _multipleLookupValues_ **[computed — write protected]**
- `Model Name (from Models)` _multipleLookupValues_ **[computed — write protected]**
- `Modeller (from Models)` _multipleLookupValues_ **[computed — write protected]**
- `Deadline (from Models)` _multipleLookupValues_ **[computed — write protected]**
- `Status (from Models)` _multipleLookupValues_ **[computed — write protected]**
- `In the Scene?` _singleSelect_ — options: `🔴 NO` / `🟢 YES`
- `Accountable to ` _multipleLookupValues_ **[computed — write protected]**
- `Instructions` _richText_

### Model Manufacturer ⬜ *portal does not touch*
`tblQehy0iVh2odNJb` — 6 fields

- `Manufacturer` _singleLineText_
- `Website` _url_
- `Models` _multipleRecordLinks_ — → linked to **Models**; (bidirectional link)
- `Done Models for Manufacturer` _multipleLookupValues_ **[computed — write protected]**
- `Project (Lookup from Models)` _multipleLookupValues_ **[computed — write protected]**
- `Model Name Rollup (from Models)` _rollup_ **[computed — write protected]**

### Modeller Invoices ⬜ *portal does not touch*
`tbl6WfMgznJYgevRt` — 18 fields

- `Invoice Name` _formula_ **[computed — write protected]**
- `Modeller` _multipleRecordLinks_ — → linked to **Users**; (bidirectional link)
- `Name (Lookup)` _multipleLookupValues_ **[computed — write protected]**
- `Email (Lookup)` _multipleLookupValues_ **[computed — write protected]**
- `Invoice Period (Modeller Invoices)` _date_
- `Models` _multipleRecordLinks_ — → linked to **Models**; (bidirectional link)
- `Project (from Models)` _multipleLookupValues_ **[computed — write protected]**
- `Scene (from Models)` _multipleLookupValues_ **[computed — write protected]**
- `Modeller Hourly Rate` _multipleLookupValues_ **[computed — write protected]**
- `Total Budgeted Hours Rollup (from Models)` _rollup_ **[computed — write protected]**
- `Invoice Total Rollup (from Models)` _rollup_ **[computed — write protected]**
- `Create Invoice ` _checkbox_
- `Year` _formula_ **[computed — write protected]** — `DATETIME_FORMAT(CREATED_TIME(), "YYYY")
`
- `Month` _formula_ **[computed — write protected]** — `DATETIME_FORMAT({fld92FqdxsoIwKOua}, "MMMM")`
- `Paid?` _singleSelect_ — options: `🔴 NO` / `🟢 YES`
- `Model Name (from Models)` _multipleLookupValues_ **[computed — write protected]**
- `Current Month` _formula_ **[computed — write protected]** — `IF(
  IS_SAME({fld92FqdxsoIwKOua}, TODAY(), 'month'),
  "YES",
  "NO"
)`
- `Date for Lookup` _formula_ **[computed — write protected]** — `DATETIME_FORMAT({fld92FqdxsoIwKOua}, "YY-MMMM")`

### Scene Manager Day Logs ⬜ *portal does not touch*
`tblCOVVdOsjRt06iO` — 27 fields

- `Name` _formula_ **[computed — write protected]** — `{fldv8AxAUgWiyXYSY} & "_" & {fldPJMVD6uZ4Wtf7W}
`
- `Link to Users` _multipleRecordLinks_ — → linked to **Users**; (bidirectional link)
- `Name (from Users)` _multipleLookupValues_ **[computed — write protected]**
- `Date` _date_
- `Date (Work Day)` _formula_ **[computed — write protected]** — `DATETIME_FORMAT({fldQTfPwfe0E4oNcF}, "YYYY-MM-DD")
`
- `Invoice Period (Month)` _formula_ **[computed — write protected]** — `DATETIME_FORMAT({fldQTfPwfe0E4oNcF}, "YYYY-MM")
`
- `Project` _multipleRecordLinks_ — → linked to **Projects**; (bidirectional link)
- `Tasks` _multipleRecordLinks_ — → linked to **Tasks**; (bidirectional link)
- `Round (from Tasks)` _multipleLookupValues_ **[computed — write protected]**
- `Work Time (Days)` _number_
- `Scene Manager Invoice Name` _multipleRecordLinks_ — → linked to **Scene Manager Invoice**; (bidirectional link)
- `Day Rate (£) (from Link to Users)` _multipleLookupValues_ **[computed — write protected]**
- `Day Total Cost (£)` _formula_ **[computed — write protected]** — `({fldaIEHxMv3eF8wQJ}*({fldBjguZNxzCCnySe}))`
- `Is Current Month` _formula_ **[computed — write protected]** — `IF(
  {fldHVFQXnLw9iMDq9} = DATETIME_FORMAT(TODAY(), "YYYY-MM"),
  "YES",
  "NO"
)`
- `Approved` _singleSelect_ — options: `🔴 NO` / `🟢 YES `
- `Scene Manager Invoice Name (look up)` _multipleLookupValues_ **[computed — write protected]**
- `Assigned Scene Manager Name ` _formula_ **[computed — write protected]** — `ARRAYJOIN({fldv8AxAUgWiyXYSY})
`
- `Active Project Name` _formula_ **[computed — write protected]** — `ARRAYJOIN({fldyW5F0Z2Cy14R82})
`
- `Client` _multipleLookupValues_ **[computed — write protected]**
- `Subscriptions` _multipleRecordLinks_ — → linked to **Subscriptions**; (bidirectional link)
- `Month` _formula_ **[computed — write protected]** — `DATETIME_FORMAT(CREATED_TIME(), "MMMM")`
- `Year` _formula_ **[computed — write protected]** — `DATETIME_FORMAT(CREATED_TIME(), "YYYY")`
- `Link Key` _formula_ **[computed — write protected]** — `{fldw4rSq4wY58vC1q} & {fldlg3MiHeexaw9tW} & {fldorsexW9gDw4sxO}`
- `Clients` _singleLineText_
- `Clients 2` _singleLineText_
- `Client Link` _multipleRecordLinks_ — → linked to **Clients**; (bidirectional link)
- `Scene Manager Invoice copy` _singleLineText_

### Scene Manager Invoice ⬜ *portal does not touch*
`tblhYCC3InxUJUK3H` — 19 fields

- `Invoice Name` _formula_ **[computed — write protected]**
- `Date` _multipleLookupValues_ **[computed — write protected]**
- `Scene Manager` _multipleRecordLinks_ — → linked to **Users**; (bidirectional link)
- `Name (from Users)` _multipleLookupValues_ **[computed — write protected]**
- `Email (from Users)` _multipleLookupValues_ **[computed — write protected]**
- `Invoice Period (formula)` _date_
- `Current Month?` _formula_ **[computed — write protected]** — `IF(
  {fldV49QlTVOIafdsI} = DATETIME_FORMAT(TODAY(), "YYYY-MM"),
  "YES",
  "NO"
)`
- `Project (from Tasks) (from Days Worked)` _multipleLookupValues_ **[computed — write protected]**
- `Tasks (from Days Worked)` _multipleLookupValues_ **[computed — write protected]**
- `Day Rate (£)` _multipleLookupValues_ **[computed — write protected]**
- `Scene Manager Day Logs` _multipleRecordLinks_ — → linked to **Scene Manager Day Logs**; (bidirectional link)
- `Work Time (Days)` _rollup_ **[computed — write protected]**
- `Invoice Total` _formula_ **[computed — write protected]** — `{fldAlVbKQLTj9fEht} * {fldPVvMZjmmcRNN3L}
`
- `Create Invoice` _checkbox_
- `Scene Manager Day Logs copy` _singleLineText_
- `Invoice Period (Year)` _formula_ **[computed — write protected]** — `DATETIME_FORMAT(CREATED_TIME(), "YYYY")
`
- `Invoice Period (Month)` _formula_ **[computed — write protected]** — `DATETIME_FORMAT({fldV49QlTVOIafdsI}, "MMMM")
`
- `Paid?` _singleSelect_ — options: `🔴 NO` / `🟢 YES`
- `Role (from Scene Manager)` _multipleLookupValues_ **[computed — write protected]**

### Partner Studios Invoice Monthly ⬜ *portal does not touch*
`tbl4fdObC6NYOUINx` — 15 fields

- `Invoice Name` _formula_ **[computed — write protected]** — `"SS" & "_" & {fldsVlZlz8xXutW5p} & "_" & {fldIlK2tNE4Mffbcy}`
- `Partner Studios` _multipleRecordLinks_ — → linked to **Users**; (bidirectional link)
- `Name (from Users)` _multipleLookupValues_ **[computed — write protected]**
- `Email (from Users)` _multipleLookupValues_ **[computed — write protected]**
- `Invoice Period (formula)` _formula_ **[computed — write protected]** — `DATETIME_FORMAT(CREATED_TIME(), "YYYY-MM")
`
- `Current Month?` _formula_ **[computed — write protected]** — `IF(
  {fldIlK2tNE4Mffbcy} = DATETIME_FORMAT(TODAY(), "YYYY-MM"),
  "YES",
  "NO"
)`
- `Scenes from Tasks` _multipleRecordLinks_ — → linked to **Tasks**; (bidirectional link)
- `Number of Scenes` _formula_ **[computed — write protected]**
- `Average Cost per Image (£)` _multipleLookupValues_ **[computed — write protected]**
- `Invoice Total (£)` _rollup_ **[computed — write protected]**
- `Create Invoice` _checkbox_
- `Invoice Period (Year)` _formula_ **[computed — write protected]** — `DATETIME_FORMAT(CREATED_TIME(), "YYYY")
`
- `Invoice Period (Month)` _formula_ **[computed — write protected]** — `DATETIME_FORMAT(CREATED_TIME(), "MMMM")
`
- `Paid?` _singleSelect_ — options: `🔴 NO` / `🟢 YES`
- `Role (from Scene Manager)` _multipleLookupValues_ **[computed — write protected]**

### Partner Studios Invoices Contract ⬜ *portal does not touch*
`tblBUVWHpphKDiEKS` — 13 fields

- `Name` _formula_ **[computed — write protected]** — `{fldhH68UszvPd4oUp} & "_" & {fldLQ4LLmPkCSiN32} & "_" & "INV" & {fldCgJ2hpKIBFqUU1}`
- `Actual Contract Value (£)` _rollup_ **[computed — write protected]**
- `Project` _multipleRecordLinks_ — → linked to **Projects**; (bidirectional link)
- `Partner Studio` _multipleRecordLinks_ — → linked to **Users**; (bidirectional link)
- `Number of Scenes` _multipleLookupValues_ **[computed — write protected]**
- `Scenes` _multipleRecordLinks_ — → linked to **Tasks**; (bidirectional link)
- `Create Invoice` _checkbox_
- `Paid?` _singleSelect_ — options: `🔴 NO` / `🟢 YES`
- `Contract Agreed?` _singleSelect_ — options: `🟢 YES` / `🔴 NO`
- `Invoice Number ` _singleSelect_ — options: `01` / `02` / `03` / `04` / `05` / `06` / `07` / `08` / `09` / `10`
- `Payment Stage` _singleSelect_ — options: `Down Payment` / `Final Payment` / `Full Payment`
- `Invoice Total` _formula_ **[computed — write protected]**
- `Date Created` _formula_ **[computed — write protected]** — `DATETIME_FORMAT(CREATED_TIME(), 'YYYY/MM/DD HH:mm')`

### Photographer Timesheet ⬜ *portal does not touch*
`tblsqmojQaxNM27GG` — 16 fields

- `Name` _formula_ **[computed — write protected]** — `{fldlK10GWYaeRZZgQ} & "_" & {fldFldoJ8cd0fvgvO}
`
- `Link to Users` _multipleRecordLinks_ — → linked to **Users**; (bidirectional link)
- `Name (from Users)` _multipleLookupValues_ **[computed — write protected]**
- `Date` _date_
- `Date Key` _formula_ **[computed — write protected]** — `DATETIME_FORMAT({fldGvGiChWeAnqOAx}, "YYYY-MM-DD")
`
- `Invoice Period (Month)` _formula_ **[computed — write protected]** — `DATETIME_FORMAT({fldGvGiChWeAnqOAx}, "YYYY-MM")
`
- `Project` _multipleRecordLinks_ — → linked to **Projects**; (bidirectional link)
- `Tasks` _multipleRecordLinks_ — → linked to **Tasks**; (bidirectional link)
- `Round (from Tasks)` _multipleLookupValues_ **[computed — write protected]**
- `Work Time (Hrs)` _number_
- `Photographer Invoice Name` _multipleRecordLinks_ — → linked to **Photographer Invoice**; (bidirectional link)
- `Day Rate (£) (from Link to Users)` _multipleLookupValues_ **[computed — write protected]**
- `Day Total Cost (£)` _formula_ **[computed — write protected]** — `({fld0k5aDOdhaYaxeB}*({fldrVHX5PfNyVpzg6}))`
- `Scene Manager Invoice copy` _singleLineText_
- `Photographer Invoice` _singleLineText_
- `Client` _multipleRecordLinks_ — → linked to **Clients**; (bidirectional link)

### Photographer Invoice ⬜ *portal does not touch*
`tblCoQXYZuUCh0Vgc` — 13 fields

- `Invoice Name` _formula_ **[computed — write protected]** — `"SS" & "_" & {fld04Y88WwEBXz9y4} & "_" & {fldgunbga2bqIloFd}`
- `Date` _multipleLookupValues_ **[computed — write protected]**
- `Photographer` _multipleRecordLinks_ — → linked to **Users**; (bidirectional link)
- `Name (from Users)` _multipleLookupValues_ **[computed — write protected]**
- `Email (from Users)` _multipleLookupValues_ **[computed — write protected]**
- `Invoice Period (formula)` _formula_ **[computed — write protected]** — `DATETIME_FORMAT(CREATED_TIME(), "YYYY-MM")
`
- `Project (from Tasks) (from Days Worked)` _multipleLookupValues_ **[computed — write protected]**
- `Tasks (from Days Worked)` _multipleLookupValues_ **[computed — write protected]**
- `Hourly Rate (£)` _multipleLookupValues_ **[computed — write protected]**
- `Photographer Timesheet` _multipleRecordLinks_ — → linked to **Photographer Timesheet**; (bidirectional link)
- `Work Time (Hours)` _rollup_ **[computed — write protected]**
- `Invoice Total` _formula_ **[computed — write protected]** — `{fldVL9wF7Sg1HlPuY} * {fldalJ7UAtJUpTYgg}
`
- `Create Invoice` _checkbox_

### Team Holiday Tracker ⬜ *portal does not touch*
`tblDJjhosve79HISi` — 11 fields

- `Name` _formula_ **[computed — write protected]**
- `User` _multipleRecordLinks_ — → linked to **Users**; (bidirectional link)
- `Start Date` _dateTime_
- `End Date` _dateTime_
- `Number of Days taken` _formula_ **[computed — write protected]**
- `Year` _formula_ **[computed — write protected]** — `DATETIME_FORMAT({fldML15xDDy3EJdJW}, 'YYYY')`
- `Current Year?` _formula_ **[computed — write protected]** — `IF(
  YEAR({fldML15xDDy3EJdJW}) = YEAR(TODAY()),
  "YES",
  "NO"
)`
- `Role (from User)` _multipleLookupValues_ **[computed — write protected]**
- `Duration ` _formula_ **[computed — write protected]**
- `Is it today?` _formula_ **[computed — write protected]**
- `Number of Annual Leave days remaining (from User)` _multipleLookupValues_ **[computed — write protected]**

### Files ⬜ *portal does not touch*
`tblk26tFAXfnlHdZf` — 5 fields

- `Name` _formula_ **[computed — write protected]** — `{fldyVBNjb5mvNehMJ}
`
- `Project` _multipleRecordLinks_ — → linked to **Projects**; (bidirectional link)
- `Task` _singleLineText_
- `Type` _singleSelect_ — options: `Site-Photos` / `Instructions` / `Models` / `Drawings`
- `Location` _url_

### Renderoo Tier Pricing ⬜ *portal does not touch*
`tblgsMkzYNecev9DN` — 7 fields

- `Name` _singleLineText_
- `Default Cost Per Scene` _currency_
- `Gross Profit per Scene` _formula_ **[computed — write protected]** — `({fldWJ9dnX5bamzfNm} - {fldH75ijcoKsCqZcI}) / {fldWJ9dnX5bamzfNm}`
- `Number of Scene Manager Days` _singleSelect_ — options: `1` / `2`
- `Scene Manager Day Rate ` _currency_
- `Scene Manager Cost per Scene` _formula_ **[computed — write protected]** — `VALUE(({fld5P9ts4vfo1J4Ch})) * ({fldQ39VCHlGU21ffc})`
- `Renderoo Total Pricing` _multipleRecordLinks_ — → linked to **Renderoo Total Pricing**; (bidirectional link)

### Renderoo Total Pricing ⬜ *portal does not touch*
`tbl2oAGaXONrg6wOX` — 17 fields

- `Scene Name` _formula_ **[computed — write protected]** — `{fldRwtfYCIbi71MiJ}`
- `Total Scene Cost` _formula_ **[computed — write protected]**
- `Tier` _multipleRecordLinks_ — → linked to **Renderoo Tier Pricing**; (bidirectional link)
- `Tier Cost` _multipleLookupValues_ **[computed — write protected]**
- `Extra Camera` _singleSelect_ — options: `1` / `2` / `3` / `4` / `5` / `6` / `7` / `8`
- `Extra Camera Cost` _formula_ **[computed — write protected]** — `ROUND(
  (((VALUE({fldcjIQFwNT95XVnH}) * {fldWsQQrXbSjPQnl4}) * 0.33) / 0.3) / 50, 
  0
) * 50`
- `Extra Round` _singleSelect_ — options: `1` / `2` / `3`
- `Extra Round Cost` _formula_ **[computed — write protected]** — `ROUND(
  (((VALUE({fldf4CfdICETsqcYJ}) * {fldWsQQrXbSjPQnl4})) / 0.3) / 50, 
  0
) * 50`
- `VR Camera` _singleSelect_ — options: `NO` / `YES`
- `VR Cost` _formula_ **[computed — write protected]** — `IF({fldKSXn9ZBdLFvLcW} = "YES", 400, 0)`
- `Default Number of Scene Manager Days` _multipleLookupValues_ **[computed — write protected]**
- `Total Number of Scene Manager Days` _formula_ **[computed — write protected]**
- `Bespoke Furniture` _singleSelect_ — options: `NO` / `YES`
- `Bespoke Furniture Cost` _formula_ **[computed — write protected]** — `IF({fldXQPaoqfYY6Ke5N} = "YES", 400, 0)`
- `Number of Modeller Hours` _formula_ **[computed — write protected]** — `({fldeLZQaGgW3gjKKR} * 0.33) / 12`
- `Scene Manager Day Rate` _multipleLookupValues_ **[computed — write protected]**
- `Number of Work Days` _formula_ **[computed — write protected]**

### Director Tasks ⬜ *portal does not touch*
`tblKEai6IGMOzQWFT` — 9 fields

- `Task Name` _singleLineText_
- `Assignee` _multipleRecordLinks_ — → linked to **Users**; (bidirectional link)
- `Info` _multilineText_
- `Task Type` _singleSelect_ — options: `Operations` / `Admin` / `Marketing` / `Production`
- `Status` _singleSelect_ — options: `⚪ BACKLOG` / `🔴 TO DO` / `🟡 IN PROGRESS` / `🟢 DONE`
- `Date Created` _dateTime_
- `Deadline` _dateTime_
- `Last Modified Time Status` _lastModifiedTime_ **[computed — write protected]**
- `Kanban Archive` _formula_ **[computed — write protected]**
