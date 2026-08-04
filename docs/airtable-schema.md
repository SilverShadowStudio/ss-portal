# Airtable base schema — Silver Shadow Studio Production Portal Database

Reference only. Generated from the Airtable Meta API (`GET /v0/meta/bases/{baseId}/tables`)
via a temporary read-only edge function, 2026-08-04. **Field names + types only — no row data.**

Regenerate by deploying a short diagnostic function that calls the Meta API with the
server-side `AIRTABLE_PAT`, then deleting it. The PAT is never exposed locally.

**Rule: the portal reads Airtable one-way. Never write back.**

## Tables

| Table | ID | Fields |
|---|---|---|
| Users | `tbl8V5Hd20UN9Jax6` | 58 |
| Clients | `tblWDmSeRB4P88ALw` | 45 |
| Projects | `tblB4sEUfuFQOv2lA` | 82 |
| Subscriptions | `tblG9P42dNobAFnli` | 22 |
| Cost Configurator | `tblbfVUpIB9BZkJvb` | 31 |
| Project Invoices | `tbliIuNkZdGuqHHfF` | 25 |
| Tasks | `tbleHaU9DxHyvixdL` | 64 |
| Models | `tbls6j4jyNifFyucU` | 46 |
| Existing Models | `tblPI5UKhZEC38IV4` | 12 |
| Model Manufacturer | `tblQehy0iVh2odNJb` | 6 |
| Modeller Invoices | `tbl6WfMgznJYgevRt` | 20 |
| Scene Manager Day Logs | `tblCOVVdOsjRt06iO` | 28 |
| Scene Manager Invoice | `tblhYCC3InxUJUK3H` | 22 |
| Partner Studios Invoice Monthly | `tbl4fdObC6NYOUINx` | 15 |
| Partner Studios Invoices Contract | `tblBUVWHpphKDiEKS` | 13 |
| Photographer Timesheet | `tblsqmojQaxNM27GG` | 17 |
| Photographer Invoice | `tblCoQXYZuUCh0Vgc` | 19 |
| Team Holiday Tracker | `tblDJjhosve79HISi` | 11 |
| Files | `tblk26tFAXfnlHdZf` | 5 |
| Renderoo Tier Pricing | `tblgsMkzYNecev9DN` | 7 |
| Renderoo Total Pricing | `tbl2oAGaXONrg6wOX` | 17 |
| Director Tasks | `tblKEai6IGMOzQWFT` | 9 |
| PC Crash Log | `tbliijWyhtJp5QGy7` | 4 |
| Render Queue | `tblBxDHEv8Th1hljc` | 7 |
| PCs | `tblOHI6Zz93W7Cnir` | 7 |
| Coordinator Day Logs | `tblMqyhR347JdpW9H` | 28 |
| Coordinator Invoice | `tblFbW1LfsAayrIRk` | 23 |

## Users

`tbl8V5Hd20UN9Jax6`

- **Name** — `formula`
- **First Name** — `singleLineText`
- **Surname** — `singleLineText`
- **Full Name** — `formula`
- **Company** — `multipleRecordLinks`
- **Role** — `singleSelect`
- **Email** — `email`
- **Phone** — `multilineText`
- **Timesheet** — `url`
- **Photo** — `multipleAttachments`
- **Project Member** — `multipleRecordLinks`
- **Tasks** — `multipleRecordLinks`
- **Day Rate (£)** — `number`
- **Hourly Rate (£)** — `number`
- **Models** — `multipleRecordLinks`
- **Modeller Invoice Period** — `multipleRecordLinks`
- **Scene Manager Invoice** — `multipleRecordLinks`
- **Scene Manager Day Logs** — `multipleRecordLinks`
- **Photographer Timesheet** — `multipleRecordLinks`
- **Photographer Invoice** — `multipleRecordLinks`
- **Clients** — `multipleRecordLinks`
- **Tasks copy** — `multipleRecordLinks`
- **Tasks 2** — `multipleRecordLinks`
- **Models 2** — `multipleRecordLinks`
- **Project Member of (Lookup)** — `multipleLookupValues`
- **Active Tasks** — `multipleLookupValues`
- **Upcoming Tasks** — `multipleLookupValues`
- **Number of Active Tasks** — `rollup`
- **Available?** — `formula`
- **Number of Upcoming Tasks** — `rollup`
- **Active Project** — `multipleLookupValues`
- **Number of Active Models** — `rollup`
- **Number of Models TO DO** — `rollup`
- **HOURS Number of Active Models** — `rollup`
- **HOURS Upcoming Models** — `rollup`
- **Modeller Workload (Hours)** — `formula`
- **Modeller Work Volume** — `formula`
- **What Models do they do well?** — `richText`
- **Task Start Date (Lookup)** — `multipleLookupValues`
- **Task Deadline (Lookup)** — `multipleLookupValues`
- **Team Holiday Tracker** — `multipleRecordLinks`
- **Total Number of Annual Leave Days** — `number`
- **Number of Days taken Rollup (from Team Holiday Tracker)** — `rollup`
- **Number of Annual Leave days remaining** — `formula`
- **Start Date (from Team Holiday Tracker)** — `multipleLookupValues`
- **Projects** — `multipleRecordLinks`
- **Duration  (from Team Holiday Tracker)** — `multipleLookupValues`
- **Cost Configurator** — `multipleRecordLinks`
- **Type of Client** — `multipleSelects`
- **Director Tasks** — `multipleRecordLinks`
- **Cost per Image (£)** — `number`
- **Scene Manager Invoice copy** — `multipleRecordLinks`
- **Partner Studios Invoices** — `multipleRecordLinks`
- **Client Role** — `singleSelect`
- **Clients copy** — `multipleRecordLinks`
- **Scene Manager Day Logs copy** — `multipleRecordLinks`
- **Scene Manager Invoice copy** — `multipleRecordLinks`
- **Render Queue** — `multipleRecordLinks`

## Clients

`tblWDmSeRB4P88ALw`

- **Company name** — `singleLineText`
- **Industry** — `singleSelect`
- **Size** — `singleSelect`
- **Building** — `singleLineText`
- **Street name** — `singleLineText`
- **City** — `singleLineText`
- **Postcode** — `singleLineText`
- **Country** — `singleLineText`
- **Registration number** — `singleLineText`
- **Website** — `multilineText`
- **Logo** — `multilineText`
- **Client Representative** — `multipleRecordLinks`
- **Client Team Member** — `multipleRecordLinks`
- **Formula Client Representative** — `formula`
- **Client Representative Email** — `multipleLookupValues`
- **Projects** — `multipleRecordLinks`
- **Subscriptions** — `multipleRecordLinks`
- **Project Invoices** — `multipleRecordLinks`
- **Photographer Timesheet** — `multipleRecordLinks`
- **Scene Manager Day Logs** — `singleLineText`
- **Models** — `multipleRecordLinks`
- **Client Contracts Total Value (£)** — `rollup`
- **Invoice Total Rollup (from Project Invoices)** — `rollup`
- **Project Total Cost (£) Rollup (from Projects)** — `rollup`
- **Subscription Fee Rollup (from Subscriptions)** — `rollup`
- **Day Total Cost (£) Rollup (from Scene Manager Day Logs)** — `rollup`
- **Model Cost Rollup (from Models)** — `rollup`
- **Photographer Total Cost (£)** — `rollup`
- **Client Total Revenue (£)** — `formula`
- **Client Total Cost (£)** — `formula`
- **Client Total Profit (£)** — `formula`
- **Calculation** — `formula`
- **Subscription Fee Rollup CURRENT MONTH** — `rollup`
- **Day Total Cost (£) Rollup CURRENT MONTH** — `rollup`
- **Model Cost Rollup CURRENT MONTH** — `rollup`
- **Monthly Subscription Profit (£)** — `formula`
- **Monthly Subscription Profit (%)** — `formula`
- **Current Month Tier (from Subscriptions)** — `multipleLookupValues`
- **Current Number of Production Lanes** — `formula`
- **Users** — `multipleRecordLinks`
- **Tasks** — `multipleRecordLinks`
- **Scene Manager Day Logs Link** — `multipleRecordLinks`
- **Project Invoices copy** — `singleLineText`
- **Record ID** — `formula`
- **Scene Manager Day Logs copy** — `multipleRecordLinks`

## Projects

`tblB4sEUfuFQOv2lA`

- **Project name** — `singleLineText`
- **Client Facing Project Name** — `singleLineText`
- **Project Type** — `singleSelect`
- **Contract or Subscription** — `singleSelect`
- **Status** — `singleSelect`
- **Number of Rounds** — `singleSelect`
- **Client** — `multipleRecordLinks`
- **Client Representative** — `multipleLookupValues`
- **Project Lead** — `multipleRecordLinks`
- **Project Members** — `multipleRecordLinks`
- **Project Member (lookup)** — `multipleLookupValues`
- **Client contacts** — `multipleLookupValues`
- **All Tasks** — `multipleRecordLinks`
- **Project Scenes** — `multipleLookupValues`
- **Scene Names (Flattened)** — `formula`
- **Number of Tasks** — `formula`
- **Start date** — `date`
- **End date** — `date`
- **Miro Board** — `url`
- **Dropbox** — `url`
- **Files** — `multilineText`
- **Invoices** — `multilineText`
- **Project Costs (£)** — `multipleRecordLinks`
- **Total Cost Configurated (£)** — `rollup`
- **Total Project Value (£)** — `rollup`
- **Total Extra Round Value (£)** — `rollup`
- **Initial amount billed** — `currency`
- **Extra Round amount billed** — `currency`
- **Final total amount billed** — `formula`
- **Models** — `multipleRecordLinks`
- **Scene Manager Day Logs** — `multipleRecordLinks`
- **Photographer Timesheet** — `multipleRecordLinks`
- **Round 01 Scene Manager Cost (£)** — `rollup`
- **Round 01 Models Cost** — `rollup`
- **Round 01 Photographer Cost** — `rollup`
- **Round 01 Total Cost (£)** — `formula`
- **Round 01 Total Cost (%)** — `formula`
- **Round 02 Scene Manager Cost (£)** — `rollup`
- **Round 02 Models Cost** — `rollup`
- **Round 02 Photographer Cost** — `rollup`
- **Round 02 Total Cost (£)** — `formula`
- **Round 02 Total Cost (%)** — `formula`
- **Round 03 Scene Manager Cost (£)** — `rollup`
- **Round 03 Models Cost** — `rollup`
- **Round 03 Photographer Cost** — `rollup`
- **Round 03 Total Cost (£)** — `formula`
- **Round 03 Total Cost (%)** — `formula`
- **Extra Round Scene Manager Cost (£)** — `rollup`
- **Extra Round Models Cost** — `rollup`
- **Extra Round Photographer Cost** — `rollup`
- **Extra Round Total Cost (£)** — `formula`
- **Extra Round Total Cost per Extra Round Billed Amount (%)** — `formula`
- **Extra Round Total Cost (%)** — `formula`
- **Extra Round Profit Gross (£)** — `formula`
- **Extra Round Profit Gross per Extra Round Cost (%)** — `formula`
- **Total Scene Manager Cost (£)** — `rollup`
- **Total Models Cost** — `rollup`
- **Total Photographer Cost** — `rollup`
- **Project Total Cost (£)** — `formula`
- **Profit Gross (£)** — `formula`
- **Profit Gross (%)** — `formula`
- **Total Scene Manager Cost (%)** — `formula`
- **Total Modeller Cost (%)** — `formula`
- **Total Photographer Cost (%)** — `formula`
- **Scene Type Camera (Lookup)** — `multipleLookupValues`
- **Number of Cameras per Scene (Lookup)** — `multipleLookupValues`
- **Number of Scenes (Lookup)** — `multipleLookupValues`
- **Scene Cost (Lookup)** — `multipleLookupValues`
- **70% Profit Project Value (£)** — `formula`
- **Price Gap (£)** — `formula`
- **Scene Models** — `multipleRecordLinks`
- **Files 2** — `multipleRecordLinks`
- **Project Invoices** — `singleLineText`
- **Project Invoices (£)** — `multipleRecordLinks`
- **Invoice Total (from Project Invoices (£))** — `multipleLookupValues`
- **Current Month Tier Subscription (Client)** — `multipleLookupValues`
- **Client Facing Project Name Formula** — `formula`
- **Total Partner Studio Cost (£)** — `rollup`
- **Project Invoices copy** — `multipleRecordLinks`
- **Accountable to** — `multipleLookupValues`
- **Render Queue** — `multipleRecordLinks`
- **Scene Manager Day Logs copy** — `multipleRecordLinks`

## Subscriptions

`tblG9P42dNobAFnli`

- **Name** — `formula`
- **Client** — `multipleRecordLinks`
- **Tier** — `singleSelect`
- **Start Date** — `date`
- **Month** — `formula`
- **Current Month?** — `formula`
- **Year** — `formula`
- **Number of Production Lanes** — `formula`
- **Subscription Fee** — `formula`
- **Link Key** — `formula`
- **Pro Rata Adjustment** — `currency`
- **Final Fee** — `formula`
- **Models** — `multipleRecordLinks`
- **Model Cost Rollup (from Models)** — `rollup`
- **Scene Manager Day Log Link** — `multipleRecordLinks`
- **Day Total Cost (£) Rollup (Scene Manager)** — `rollup`
- **Partner Studios Tasks Link** — `multipleRecordLinks`
- **Cost per Image (£) Rollup (Partner Studios)** — `rollup`
- **Total Expenditure (£)** — `formula`
- **Monthly Profit (£)** — `formula`
- **Profit Margin (%)** — `formula`
- **Scene Manager Day Logs copy** — `multipleRecordLinks`

## Cost Configurator

`tblbfVUpIB9BZkJvb`

- **Product Name** — `formula`
- **Total Cost** — `formula`
- **Scene Cost (Initial Scope)** — `formula`
- **Number of Rounds** — `singleSelect`
- **Scene Type Camera** — `singleSelect`
- **Number of Cameras per Scene** — `singleSelect`
- **Animation No. Seconds** — `number`
- **Scene Complexity** — `number`
- **Project Key** — `multipleRecordLinks`
- **Number of Scenes** — `number`
- **Variations of Scene (Options)** — `number`
- **Round Type** — `singleSelect`
- **Scene Cost (Extra Rounds)** — `formula`
- **Extra Cameras (Anywhere)** — `number`
- **Project Invoices** — `multipleRecordLinks`
- **Initial amount billed (from Project Key)** — `multipleLookupValues`
- **Extra Round amount billed (from Project Key)** — `multipleLookupValues`
- **Contract Number ** — `singleSelect`
- **Information** — `richText`
- **Scene Manager Budget per Scene** — `formula`
- **Scene Manager Days per Scene** — `formula`
- **Modelling Budget per Scene** — `formula`
- **Photographer Cost per Contract** — `formula`
- **Scene Manager Budget per Contract** — `formula`
- **Production Method** — `singleSelect`
- **Method Coefficient** — `formula`
- **Modelling Budget per Contract** — `formula`
- **Estimated Profit per Contract** — `formula`
- **Users** — `multipleRecordLinks`
- **Average Day Rate (£)** — `rollup`
- **Project Invoices copy** — `singleLineText`

## Project Invoices

`tbliIuNkZdGuqHHfF`

- **Name** — `formula`
- **Actual Contract Value (£)** — `currency`
- **Project** — `multipleRecordLinks`
- **Client** — `multipleRecordLinks`
- **Create Invoice** — `checkbox`
- **Paid?** — `singleSelect`
- **Invoice Number ** — `singleSelect`
- **Payment Stage** — `singleSelect`
- **Contract Number  (from Cost Configurator)** — `multipleLookupValues`
- **Invoice Total** — `formula`
- **Cost Configurator** — `multipleRecordLinks`
- **Project Name** — `multipleLookupValues`
- **Scene Type Camera (from Cost Configurator)** — `multipleLookupValues`
- **Round Type** — `multipleLookupValues`
- **Contract Value (from Cost Configurator)** — `rollup`
- **Contract Agreed?** — `singleSelect`
- **Initial amount billed** — `multipleLookupValues`
- **Extra Round amount billed** — `multipleLookupValues`
- **Number of Rounds (from Cost Configurator)** — `multipleLookupValues`
- **Number of Scenes** — `multipleLookupValues`
- **Number of Scenes Rollup** — `rollup`
- **Variations of Scene** — `multipleLookupValues`
- **Cost per scene** — `formula`
- **Date Created** — `formula`
- **Info.** — `multipleLookupValues`

## Tasks

`tbleHaU9DxHyvixdL`

- **Task name** — `singleLineText`
- **Project** — `multipleRecordLinks`
- **Round** — `singleSelect`
- **Task Type** — `singleSelect`
- **Phase** — `singleSelect`
- **Responsible Role** — `multipleSelects`
- **Accountable to** — `multipleRecordLinks`
- **Report to** — `multipleRecordLinks`
- **Client (from Project)** — `multipleLookupValues`
- **Client (Linked)** — `multipleRecordLinks`
- **Client Name** — `formula`
- **Client Representative** — `multipleLookupValues`
- **Drop Box Link** — `url`
- **Meeting Members** — `multipleRecordLinks`
- **Validated?** — `singleSelect`
- **Status** — `singleSelect`
- **Client Facing Task Status** — `formula`
- **Subscription Revision Number** — `singleSelect`
- **Production Lane** — `singleSelect`
- **Start Date** — `dateTime`
- **Deadline** — `dateTime`
- **Deadline Status** — `formula`
- **Meeting Link** — `url`
- **Models** — `multipleRecordLinks`
- **Scene Manager Day Logs** — `multipleRecordLinks`
- **Photographer Timesheet** — `multipleRecordLinks`
- **Scene Number** — `singleLineText`
- **Room Name** — `singleLineText`
- **Info** — `richText`
- **Image Output Path** — `singleLineText`
- **Project Name (lookup)** — `multipleLookupValues`
- **Formula Project Name** — `formula`
- **Client Facing Project Name (lookup)** — `multipleLookupValues`
- **Formula Client Facing Project Name** — `formula`
- **Problems with Scene** — `richText`
- **Task Active on date key** — `formula`
- **Scene Models** — `multipleRecordLinks`
- **Time of Day Lighting Option** — `singleSelect`
- **Artificial Lighting ** — `multipleSelects`
- **Aspect Ratio ** — `singleSelect`
- **Focal Length** — `singleSelect`
- **Perspective Correction** — `singleSelect`
- **Camera Height ** — `singleSelect`
- **Entourage & Styling** — `singleSelect`
- **Composition** — `singleSelect`
- **Camera Type** — `singleSelect`
- **Last Modified Time Status** — `lastModifiedTime`
- **Kanban Archive** — `formula`
- **Instructions (Client Facing)** — `url`
- **Client Calendar Task Name** — `formula`
- **Current Month Tier Subscription (Client)** — `multipleLookupValues`
- **Subscription Tier** — `formula`
- **Over Lane Limit?** — `formula`
- **Task ID** — `formula`
- **Files** — `multipleAttachments`
- **Project Type** — `multipleLookupValues`
- **Role** — `multipleLookupValues`
- **Partner Studios Invoice** — `multipleRecordLinks`
- **Cost per Image (£) (from Accountable to)** — `multipleLookupValues`
- **Subscription Link** — `multipleRecordLinks`
- **Actual Scene Cost (£)** — `currency`
- **Partner Studios Invoices** — `multipleRecordLinks`
- **Render Queue** — `multipleRecordLinks`
- **Scene Manager Day Logs copy** — `multipleRecordLinks`

## Models

`tbls6j4jyNifFyucU`

- **Model Name** — `singleLineText`
- **Project** — `multipleRecordLinks`
- **Scene** — `multipleRecordLinks`
- **Round (from Scene)** — `multipleLookupValues`
- **Budgeted Hours** — `number`
- **Reference Folder Link** — `url`
- **Modeller** — `multipleRecordLinks`
- **Date Created** — `createdTime`
- **Deadline** — `dateTime`
- **Status** — `singleSelect`
- **Done Date** — `lastModifiedTime`
- **Invoice Period (Models)** — `formula`
- **Hourly Rate** — `multipleLookupValues`
- **Model Cost** — `formula`
- **Current Month Key** — `formula`
- **Is Current Month** — `formula`
- **Modeller Invoice Name** — `multipleRecordLinks`
- **Name (from Modeller)** — `multipleLookupValues`
- **Approval Status** — `singleSelect`
- **Deadline Status ** — `formula`
- **Info Complete** — `singleSelect`
- **What do we need?** — `multilineText`
- **Accountable to (from Scene)** — `multipleLookupValues`
- **In the Scene?** — `singleSelect`
- **Report to (Management)** — `multipleRecordLinks`
- **Instructions** — `richText`
- **Project Name (Lookup)** — `multipleLookupValues`
- **Is the model problem free? ** — `singleSelect`
- **Report Problem with the model** — `richText`
- **Category ** — `singleSelect`
- **Model Manufacturer** — `multipleRecordLinks`
- **Name (from Model Manufacturer)** — `multipleLookupValues`
- **Scene Models** — `multipleRecordLinks`
- **Studio Standard** — `singleSelect`
- **Asset Type** — `singleSelect`
- **AI Generated?** — `checkbox`
- **Client (from Project)** — `multipleLookupValues`
- **Client** — `multipleRecordLinks`
- **Product Link** — `url`
- **Client Facing Status** — `formula`
- **3DSky Upload?** — `singleSelect`
- **STL exported?** — `singleSelect`
- **Subscriptions** — `singleLineText`
- **Subscription** — `multipleRecordLinks`
- **Modeller Invoice Month** — `multipleLookupValues`
- **Modeller Invoice Current Month** — `formula`

## Existing Models

`tblPI5UKhZEC38IV4`

- **Model Name** — `formula`
- **Link to Models** — `multipleRecordLinks`
- **Projects** — `multipleRecordLinks`
- **Scene** — `multipleRecordLinks`
- **Reference Folder Link (from Models)** — `multipleLookupValues`
- **Model Name (from Models)** — `multipleLookupValues`
- **Modeller (from Models)** — `multipleLookupValues`
- **Deadline (from Models)** — `multipleLookupValues`
- **Status (from Models)** — `multipleLookupValues`
- **In the Scene?** — `singleSelect`
- **Accountable to ** — `multipleLookupValues`
- **Instructions** — `richText`

## Model Manufacturer

`tblQehy0iVh2odNJb`

- **Manufacturer** — `singleLineText`
- **Website** — `url`
- **Models** — `multipleRecordLinks`
- **Done Models for Manufacturer** — `multipleLookupValues`
- **Project (Lookup from Models)** — `multipleLookupValues`
- **Model Name Rollup (from Models)** — `rollup`

## Modeller Invoices

`tbl6WfMgznJYgevRt`

- **Invoice Name** — `formula`
- **Modeller** — `multipleRecordLinks`
- **Name (Lookup)** — `multipleLookupValues`
- **Email (Lookup)** — `multipleLookupValues`
- **Invoice Period (Modeller Invoices)** — `date`
- **Models** — `multipleRecordLinks`
- **Project (from Models)** — `multipleLookupValues`
- **Scene (from Models)** — `multipleLookupValues`
- **Modeller Hourly Rate** — `multipleLookupValues`
- **Total Budgeted Hours Rollup (from Models)** — `rollup`
- **Invoice Total Rollup (from Models)** — `rollup`
- **Create Invoice ** — `checkbox`
- **Year** — `formula`
- **Month** — `formula`
- **Paid?** — `singleSelect`
- **Model Name (from Models)** — `multipleLookupValues`
- **Current Month** — `formula`
- **Date for Lookup** — `formula`
- **Amount Paid** — `currency`
- **Remaining Balance** — `formula`

## Scene Manager Day Logs

`tblCOVVdOsjRt06iO`

- **Name** — `formula`
- **Link to Users** — `multipleRecordLinks`
- **Name (from Users)** — `multipleLookupValues`
- **Date** — `date`
- **Date (Work Day)** — `formula`
- **Invoice Period (Month)** — `formula`
- **Project** — `multipleRecordLinks`
- **Tasks** — `multipleRecordLinks`
- **Round (from Tasks)** — `multipleLookupValues`
- **Work Time (Days)** — `number`
- **Scene Manager Invoice Name** — `multipleRecordLinks`
- **Day Rate (£) (from Link to Users)** — `multipleLookupValues`
- **Day Total Cost (£)** — `formula`
- **Is Current Month** — `formula`
- **Approved** — `singleSelect`
- **Scene Manager Invoice Name (look up)** — `multipleLookupValues`
- **Assigned Scene Manager Name ** — `formula`
- **Active Project Name** — `formula`
- **Client** — `multipleLookupValues`
- **Subscriptions** — `multipleRecordLinks`
- **Month** — `formula`
- **Year** — `formula`
- **Link Key** — `formula`
- **Clients** — `singleLineText`
- **Clients 2** — `singleLineText`
- **Client Link** — `multipleRecordLinks`
- **Scene Manager Invoice copy** — `singleLineText`
- **Scene Manager Invoice copy** — `singleLineText`

## Scene Manager Invoice

`tblhYCC3InxUJUK3H`

- **Invoice Name** — `formula`
- **Date** — `multipleLookupValues`
- **Scene Manager** — `multipleRecordLinks`
- **Name (from Users)** — `multipleLookupValues`
- **Email (from Users)** — `multipleLookupValues`
- **Invoice Period (formula)** — `date`
- **Current Month?** — `formula`
- **Project (from Tasks) (from Days Worked)** — `multipleLookupValues`
- **Tasks (from Days Worked)** — `multipleLookupValues`
- **Day Rate (£)** — `multipleLookupValues`
- **Scene Manager Day Logs** — `multipleRecordLinks`
- **Work Time (Days)** — `rollup`
- **Invoice Total** — `formula`
- **Create Invoice** — `checkbox`
- **Scene Manager Day Logs copy** — `singleLineText`
- **Invoice Period (Year)** — `formula`
- **Invoice Period (Month)** — `formula`
- **Paid?** — `singleSelect`
- **Role (from Scene Manager)** — `multipleLookupValues`
- **Amount Paid** — `currency`
- **Remaining Balance** — `formula`
- **Scene Manager Day Logs copy** — `singleLineText`

## Partner Studios Invoice Monthly

`tbl4fdObC6NYOUINx`

- **Invoice Name** — `formula`
- **Partner Studios** — `multipleRecordLinks`
- **Name (from Users)** — `multipleLookupValues`
- **Email (from Users)** — `multipleLookupValues`
- **Invoice Period (formula)** — `formula`
- **Current Month?** — `formula`
- **Scenes from Tasks** — `multipleRecordLinks`
- **Number of Scenes** — `formula`
- **Average Cost per Image (£)** — `multipleLookupValues`
- **Invoice Total (£)** — `rollup`
- **Create Invoice** — `checkbox`
- **Invoice Period (Year)** — `formula`
- **Invoice Period (Month)** — `formula`
- **Paid?** — `singleSelect`
- **Role (from Scene Manager)** — `multipleLookupValues`

## Partner Studios Invoices Contract

`tblBUVWHpphKDiEKS`

- **Name** — `formula`
- **Actual Contract Value (£)** — `rollup`
- **Project** — `multipleRecordLinks`
- **Partner Studio** — `multipleRecordLinks`
- **Number of Scenes** — `multipleLookupValues`
- **Scenes** — `multipleRecordLinks`
- **Create Invoice** — `checkbox`
- **Paid?** — `singleSelect`
- **Contract Agreed?** — `singleSelect`
- **Invoice Number ** — `singleSelect`
- **Payment Stage** — `singleSelect`
- **Invoice Total** — `formula`
- **Date Created** — `formula`

## Photographer Timesheet

`tblsqmojQaxNM27GG`

- **Name** — `formula`
- **Link to Users** — `multipleRecordLinks`
- **Name (from Users)** — `multipleLookupValues`
- **Date** — `date`
- **Date Key** — `formula`
- **Invoice Period (Month)** — `formula`
- **Project** — `multipleRecordLinks`
- **Tasks** — `multipleRecordLinks`
- **Round (from Tasks)** — `multipleLookupValues`
- **Work Time (Hrs)** — `number`
- **Photographer Invoice Name** — `multipleRecordLinks`
- **Day Rate (£) (from Link to Users)** — `multipleLookupValues`
- **Day Total Cost (£)** — `formula`
- **Scene Manager Invoice copy** — `singleLineText`
- **Photographer Invoice** — `singleLineText`
- **Client** — `multipleRecordLinks`
- **Year** — `formula`

## Photographer Invoice

`tblCoQXYZuUCh0Vgc`

- **Invoice Name** — `formula`
- **Date** — `multipleLookupValues`
- **Photographer** — `multipleRecordLinks`
- **Invoice Date** — `date`
- **Name (from Users)** — `multipleLookupValues`
- **Email (from Users)** — `multipleLookupValues`
- **Invoice Period (formula)** — `formula`
- **Project (from Tasks) (from Days Worked)** — `multipleLookupValues`
- **Tasks (from Days Worked)** — `multipleLookupValues`
- **Hourly Rate (£)** — `multipleLookupValues`
- **Photographer Timesheet** — `multipleRecordLinks`
- **Work Time (Hours)** — `rollup`
- **Invoice Total** — `formula`
- **Create Invoice** — `checkbox`
- **Paid?** — `singleSelect`
- **Amount Paid** — `currency`
- **Remaining Balance** — `formula`
- **Month** — `formula`
- **Year** — `formula`

## Team Holiday Tracker

`tblDJjhosve79HISi`

- **Name** — `formula`
- **User** — `multipleRecordLinks`
- **Start Date** — `dateTime`
- **End Date** — `dateTime`
- **Number of Days taken** — `formula`
- **Year** — `formula`
- **Current Year?** — `formula`
- **Role (from User)** — `multipleLookupValues`
- **Duration ** — `formula`
- **Is it today?** — `formula`
- **Number of Annual Leave days remaining (from User)** — `multipleLookupValues`

## Files

`tblk26tFAXfnlHdZf`

- **Name** — `formula`
- **Project** — `multipleRecordLinks`
- **Task** — `singleLineText`
- **Type** — `singleSelect`
- **Location** — `url`

## Renderoo Tier Pricing

`tblgsMkzYNecev9DN`

- **Name** — `singleLineText`
- **Default Cost Per Scene** — `currency`
- **Gross Profit per Scene** — `formula`
- **Number of Scene Manager Days** — `singleSelect`
- **Scene Manager Day Rate ** — `currency`
- **Scene Manager Cost per Scene** — `formula`
- **Renderoo Total Pricing** — `multipleRecordLinks`

## Renderoo Total Pricing

`tbl2oAGaXONrg6wOX`

- **Scene Name** — `formula`
- **Total Scene Cost** — `formula`
- **Tier** — `multipleRecordLinks`
- **Tier Cost** — `multipleLookupValues`
- **Extra Camera** — `singleSelect`
- **Extra Camera Cost** — `formula`
- **Extra Round** — `singleSelect`
- **Extra Round Cost** — `formula`
- **VR Camera** — `singleSelect`
- **VR Cost** — `formula`
- **Default Number of Scene Manager Days** — `multipleLookupValues`
- **Total Number of Scene Manager Days** — `formula`
- **Bespoke Furniture** — `singleSelect`
- **Bespoke Furniture Cost** — `formula`
- **Number of Modeller Hours** — `formula`
- **Scene Manager Day Rate** — `multipleLookupValues`
- **Number of Work Days** — `formula`

## Director Tasks

`tblKEai6IGMOzQWFT`

- **Task Name** — `singleLineText`
- **Assignee** — `multipleRecordLinks`
- **Info** — `multilineText`
- **Task Type** — `singleSelect`
- **Status** — `singleSelect`
- **Date Created** — `dateTime`
- **Deadline** — `dateTime`
- **Last Modified Time Status** — `lastModifiedTime`
- **Kanban Archive** — `formula`

## PC Crash Log

`tbliijWyhtJp5QGy7`

- **Crash Name** — `formula`
- **Date** — `date`
- **PC** — `multipleRecordLinks`
- **Crash Info** — `multilineText`

## Render Queue

`tblBxDHEv8Th1hljc`

- **Queue ID** — `formula`
- **PC** — `multipleRecordLinks`
- **Project** — `multipleRecordLinks`
- **Scene** — `multipleRecordLinks`
- **Start** — `dateTime`
- **End** — `dateTime`
- **Scene Manager** — `multipleRecordLinks`

## PCs

`tblOHI6Zz93W7Cnir`

- **PC Name** — `singleLineText`
- **Speed** — `singleSelect`
- **PC Crash Log** — `multipleRecordLinks`
- **Render Queue** — `multipleRecordLinks`
- **Crashes** — `multipleLookupValues`
- **Time Booked** — `multipleLookupValues`
- **Number of Crashes** — `rollup`

## Coordinator Day Logs

`tblMqyhR347JdpW9H`

- **Name** — `formula`
- **Link to Users** — `multipleRecordLinks`
- **Name (from Users)** — `multipleLookupValues`
- **Date** — `date`
- **Date (Work Day)** — `formula`
- **Invoice Period (Month)** — `formula`
- **Project** — `multipleRecordLinks`
- **Tasks** — `multipleRecordLinks`
- **Round (from Tasks)** — `multipleLookupValues`
- **Work Time (Days)** — `number`
- **Coordinator Invoice** — `multipleRecordLinks`
- **Day Rate (£) (from Link to Users)** — `multipleLookupValues`
- **Day Total Cost (£)** — `formula`
- **Is Current Month** — `formula`
- **Approved** — `singleSelect`
- **Scene Manager Invoice Name (look up)** — `multipleLookupValues`
- **Assigned Scene Manager Name ** — `formula`
- **Active Project Name** — `formula`
- **Client** — `multipleLookupValues`
- **Subscriptions** — `multipleRecordLinks`
- **Month** — `formula`
- **Year** — `formula`
- **Link Key** — `formula`
- **Clients** — `singleLineText`
- **Clients 2** — `singleLineText`
- **Client Link** — `multipleRecordLinks`
- **Scene Manager Invoice copy** — `singleLineText`
- **Scene Manager Invoice copy** — `multipleRecordLinks`

## Coordinator Invoice

`tblFbW1LfsAayrIRk`

- **Invoice Name** — `formula`
- **Date** — `multipleLookupValues`
- **Production Coordinator** — `multipleRecordLinks`
- **Name (from Users)** — `multipleLookupValues`
- **Email (from Users)** — `multipleLookupValues`
- **Invoice Period (formula)** — `date`
- **Current Month?** — `formula`
- **Project (from Tasks) (from Days Worked)** — `multipleLookupValues`
- **Tasks (from Days Worked)** — `multipleLookupValues`
- **Day Rate (£)** — `multipleLookupValues`
- **Coordinator Day Logs Link** — `multipleRecordLinks`
- **Work Time (Days)** — `rollup`
- **Invoice Total** — `formula`
- **Create Invoice** — `checkbox`
- **Scene Manager Day Logs copy** — `singleLineText`
- **Invoice Period (Year)** — `formula`
- **Invoice Period (Month)** — `formula`
- **Paid?** — `singleSelect`
- **Role (from Scene Manager)** — `multipleLookupValues`
- **Amount Paid** — `currency`
- **Remaining Balance** — `formula`
- **Scene Manager Day Logs copy** — `multipleRecordLinks`
- **Coordinator Day Logs** — `singleLineText`
