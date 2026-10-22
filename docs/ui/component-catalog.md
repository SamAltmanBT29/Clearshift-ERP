# ClearShift Shared UI Component Library & Design Tokens (PLT-08)

## 1. Design Tokens & Styling Architecture

The `@cs/ui` library provides standardized design primitives and design tokens for all ClearShift frontends (ERP and CRM). Every module imports shared primitives rather than duplicating styling or component code.

### Token Scales (`packages/ui/tokens.ts`)

- **Color Palette**: Tailored semantic palette utilizing CSS Custom Properties (`--cs-*`) supporting dark and light themes:
  - Surface & Background: `--cs-bg` (`#FFFFFF`), `--cs-surface` (`#F5F6F8`), `--cs-border` (`#D0D5DD`)
  - Typography: `--cs-text` (`#111827`), `--cs-text-muted` (`#4B5563`)
  - Accent / Brand: `--cs-accent` (`#1D4ED8`), `--cs-accent-hover` (`#1E40AF`)
  - Semantic Status:
    - OK / Success: `--cs-ok` (`#166534`), `--cs-ok-bg` (`#DCFCE7`)
    - Warning: `--cs-warn` (`#92400E`), `--cs-warn-bg` (`#FEF3C7`)
    - Error / Danger: `--cs-err` (`#B91C1C`), `--cs-err-bg` (`#FEE2E2`)
- **Spacing Grid**: Standard 4px grid (`s-1`: 4px, `s-2`: 8px, `s-3`: 12px, `s-4`: 16px, `s-5`: 20px, `s-6`: 24px, `s-8`: 32px, `s-10`: 40px, `s-12`: 48px).
- **Border Radius**: `--cs-r-sm` (2px), `--cs-r-md` (4px), `--cs-r-lg` (8px), `full` (9999px).
- **Focus Rings**: Strict WCAG 2.1 AA focus indicator: `0 0 0 2px #FFFFFF, 0 0 0 4px #1D4ED8`.

---

## 2. Shared Component Catalog

### 2.1 Page Title & Breadcrumb (`PageHeader.tsx`)
Provides semantic navigation landmarks and hierarchical headings.

```tsx
import { PageTitle, Breadcrumb } from "@cs/ui";

<PageTitle
  title="General Ledger"
  subtitle="Filter, review, and export double-entry transactions"
  breadcrumb={[
    { label: "Finance", href: "/finance" },
    { label: "Journal Entries", isCurrent: true }
  ]}
  actions={<button className="btn-primary">New Entry</button>}
/>
```
- **Accessibility**: `<nav aria-label="Breadcrumb">`, `<ol>`, `<li aria-current="page">`, separators hidden with `aria-hidden="true"`.

---

### 2.2 Accessible Table (`Table.tsx`)
Wrapper for tabular data supporting server-side sorting, column alignments, custom renderers, and browser memory safety.

```tsx
import { Table, ColumnDef } from "@cs/ui";

const columns: ColumnDef<Account>[] = [
  { key: "code", header: "Code", sortable: true, width: "120px" },
  { key: "name", header: "Account Name", sortable: true },
  { key: "balance", header: "Balance", align: "right", render: (r) => formatCurrency(r.balance) }
];

<Table
  columns={columns}
  data={accounts}
  keyExtractor={(r) => r.id}
  sortColumn={sortCol}
  sortDirection={sortDir}
  onSort={(col) => handleSort(col)}
  isLoading={loading}
/>
```

#### Non-Negotiable Constraint: 100,000 Row Guard & Virtualization
Per ClearShift engineering constraints, raw datasets of 100,000 rows must never be transferred or rendered directly into browser DOM nodes. The `Table` component enforces:
1. `MAX_SAFE_DOM_ROWS = 5000`: Warns and clamps unvirtualized datasets.
2. Virtual windowing (`virtualize={true}`): Renders only the active window of rows with top/bottom spacers.

---

### 2.3 Pagination (`Pagination.tsx`)
Accessible pagination controls with server page/limit bindings.

```tsx
import { Pagination } from "@cs/ui";

<Pagination
  currentPage={page}
  totalPages={totalPages}
  totalItems={totalCount}
  pageSize={pageSize}
  onPageChange={(p) => setPage(p)}
  onPageSizeChange={(sz) => setPageSize(sz)}
  isLoading={loading}
/>
```
- **Accessibility**: `<nav aria-label="Pagination">`, `aria-current="page"` on the active page, `disabled` state with `aria-disabled` on boundary buttons.

---

### 2.4 Form Field & Form Error Summary (`FormField.tsx`)
Accessible input wrappers with label association and validation error summaries.

```tsx
import { FormField, FormErrorSummary } from "@cs/ui";

<FormErrorSummary
  errors={[
    { fieldId: "account-code", message: "Account code is required" },
    { fieldId: "debit-amount", message: "Debit must balance with Credit" }
  ]}
/>

<FormField
  id="account-code"
  label="Account Code"
  helperText="4-digit standard chart of accounts code"
  error={errors.code}
  required
>
  <input type="text" value={code} onChange={e => setCode(e.target.value)} />
</FormField>
```
- **Accessibility**:
  - `label htmlFor="{id}"` explicitly targets input
  - Inputs receive `aria-invalid={true}`, `aria-required={true}`, and `aria-describedby="{id}-helper {id}-error"`
  - `FormErrorSummary` provides `role="alert"` and anchor links jumping directly to invalid input elements for keyboard users.

---

### 2.5 Alert (`Alert.tsx`)
System messages with variants: `info`, `success`, `warning`, `error`.

```tsx
import { Alert } from "@cs/ui";

<Alert variant="error" title="Posting Guard Blocked" onDismiss={() => setAlert(null)}>
  Journal entries cannot be posted into a locked accounting period.
</Alert>
```
- **Accessibility**: Uses `role="alert"` for warning/error and `role="status"` for info/success. Dismiss button includes `aria-label="Dismiss alert"`.

---

### 2.6 State Views (`StateViews.tsx`)
Standardized UI state views across loading, empty, and error scenarios.

- `SkeletonTable`: Animated skeleton with accessible announcement (`aria-busy="true"`, `aria-label="Loading table content"`).
- `EmptyState`: Actionable empty state with custom icon and primary action button.
- `ErrorState`: Recoverable error view with retry callback.

---

### 2.7 Accessible Dialog (`Dialog.tsx`)
Keyboard-navigable modal dialog for confirmations and forms.

```tsx
import { Dialog } from "@cs/ui";

<Dialog
  isOpen={isOpen}
  onClose={() => setIsOpen(false)}
  title="Post Journal Entry"
  description="Are you sure you want to commit this transaction to the general ledger?"
  footer={<button onClick={handlePost}>Confirm Post</button>}
>
  <p>Transaction ID: TX-10928</p>
</Dialog>
```
- **Accessibility**: `role="dialog"`, `aria-modal="true"`, `aria-labelledby`, `aria-describedby`. Closes on `Escape` key.

---

### 2.8 Status Badge (`StatusBadge.tsx`)
Compact status indicator with verified contrast ratios and semantic mappings (`draft`, `posted`, `voided`, `asset`, `liability`, `equity`, `revenue`, `expense`).

---

### 2.9 CSV Export Action & Formula Protection (`CsvAction.tsx`)
Action button for exporting table data to CSV.

- **PLT-12 Security Invariant**: Implements `sanitizeCsvCell` neutralizing CSV formula injection (OWASP CSV Injection). Any value beginning with `=`, `+`, `-`, `@`, `\t`, or `\r` is escaped with a prepended single quote (`'`).

---

## 3. Keyboard Conventions & Smoke Test Verification

All `@cs/ui` components are verified by `packages/ui/tests/accessibility.test.tsx`:
1. Visible focus rings appear on all interactive components upon keyboard tab navigation.
2. Form errors link to target input IDs so screen readers and keyboard users can jump directly to error fields.
3. Modal dialogs trap focus and dismiss immediately when pressing `Escape`.
4. Tables expose header sorting to keyboard users with `aria-sort` announcements.
