# Frontend TODO - Multi-Tenant Dynamic Invoicing UI

## Overview
This document outlines the current state of the Invoicerr frontend and the rebuild plan for multi-tenant dynamic invoicing support.

---

## CURRENT INFRASTRUCTURE (KEEP - Working Well)

### Core Setup
- **React 19** + **Vite 7** build tool
- **TypeScript 5.8.3** with strict type checking
- **Tailwind CSS v4** with modern CSS variables
- **Biome** for linting and formatting

### Routing
- **Generouted** for file-based routing
- Routes defined in `/src/pages/` with nested layouts
- File structure:
  - `/pages/(app)/_layout.tsx` - Main authenticated layout
  - `/pages/auth/` - Authentication pages
  - `/pages/invitation/` - Invitation handling
  - `/pages/_loading/` - Loading states

### UI Components (shadcn/ui - KEEP ALL)
**Location**: `/src/components/ui/`
- 38+ shadcn/ui components (button, dialog, form, table, etc.)
- All components use Radix UI primitives
- New York style variant with CSS variables
- Components include:
  - button, input, select, dialog, dropdown-menu
  - form, form-field, form-label (react-hook-form integration)
  - table, card, alert, badge, tabs
  - sheet, sidebar, resizable, scroll-area
  - calendar, date-picker, multi-select
  - alert-dialog, tooltip, popover
  - chart, slider, switch, checkbox
  - sonner for toast notifications

### i18n (16 Locales - KEEP)
**Location**: `/src/locales/`
- ar, da, de, es, fr, he, it, ja, ko, nl, pl, pt-BR, sv, uk, zh-Hans, en
- `i18next` with browser language detection
- `date-fns` locale integration for date formatting
- Dynamic locale loading from JSON files

### Multi-Tenant Support (KEEP - Already Working!)
**Location**: `/src/contexts/company.tsx`
- `CompanyProvider` wraps authenticated routes
- Active company stored in localStorage
- Automatic company header injection (`X-Company-Id`) in all API calls
- Company switching with page reload for state refresh
- Onboarding flow for first company creation

### API Hooks (KEEP - Excellent Implementation)
**Location**: `/src/hooks/use-fetch.ts`
- `useGet`, `usePost`, `usePatch`, `usePut`, `useDelete`
- `useSse` for Server-Sent Events (real-time updates)
- `useSsePaginated` with intelligent prefetching
- `authenticatedFetch` wrapper with company header injection
- Automatic 401 redirect to sign-in

### Custom Components (KEEP Most, Refactor Some)
**Location**: `/src/components/`
- `company-switcher.tsx` - Multi-company selection (KEEP)
- `sidebar.tsx` - Navigation sidebar (KEEP)
- `theme-provider.tsx` - Dark/light theme (KEEP)
- `currency-select.tsx` - Currency selection (KEEP)
- `country-select.tsx` - Country selection (KEEP)
- `date-picker.tsx`, `year-picker.tsx` - Date pickers (KEEP)
- `form-modal.tsx` - Generic form modal (KEEP)
- `pagination.tsx` - Pagination component (KEEP)
- `search-input.tsx` - Search with debouncing (KEEP)
- `better-input.tsx` - Enhanced input with adornments (KEEP)
- `transmission-button.tsx` - Email/webhook sending (KEEP)

### Types (KEEP & Expand)
**Location**: `/src/types/`
- `company.ts` - Company structure with identifiers
- `client.ts` - Client structure
- `invoice.ts` - Invoice, InvoiceItem, InvoiceStatus, InvoiceItemType
- `quote.ts`, `receipt.ts`, `payment-method.ts`, `user.ts`
- Well-defined TypeScript interfaces

---

## EXISTING INVOICING UI (DELETE & REBUILD)

### Current Structure (Delete These Files)
```
/src/pages/(app)/invoices/
├── index.tsx                    # Invoice list page
├── _components/
│   ├── invoice-list.tsx         # Invoice table with actions (585 lines)
│   ├── invoice-upsert.tsx       # Create/edit form (652 lines)
│   ├── invoice-view.tsx         # View invoice details
│   ├── invoice-pdf-view.tsx     # PDF preview modal
│   ├── invoice-delete.tsx       # Delete confirmation
│   └── invoice-modification-dialog.tsx  # Edit options dialog
└── [id]/
    ├── corrective.tsx           # Credit note
    ├── credit-note.tsx          # Credit note
    └── void-reissue.tsx         # Void & reissue

/src/pages/(app)/quotes/
├── index.tsx                    # Quote list page
└── _components/
    ├── quote-list.tsx           # Quote table (447 lines)
    ├── quote-upsert.tsx         # Create/edit form (562 lines)
    ├── quote-view.tsx
    ├── quote-pdf-view.tsx
    └── quote-delete.tsx

/src/pages/(app)/receipts/
├── index.tsx                    # Receipt list page
└── _components/
    ├── receipt-list.tsx         # Receipt table (281 lines)
    ├── receipt-upsert.tsx       # Create/edit form (375 lines)
    ├── receipt-pdf-view.tsx
    └── receipt-delete.tsx

/src/pages/(app)/clients/
├── index.tsx                    # Client list page
└── _components/
    ├── client-list.tsx          # Client table
    ├── client-upsert.tsx        # Create/edit form (1097 lines)
    ├── client-view.tsx
    └── client-delete.tsx

/src/pages/(app)/payment-methods/
├── index.tsx
└── _components/
    ├── payment-method-list.tsx
    ├── payment-method-upsert.tsx
    ├── payment-method-view.tsx
    └── payment-method-delete.tsx
```

### Why Delete?
1. **Single-tenant mindset**: Forms don't account for company-specific settings
2. **Limited validation**: Doesn't leverage company compliance rules (VAT, identifiers)
3. **Static UI**: Not designed for dynamic invoice customization per company
4. **Code duplication**: Similar patterns repeated across invoice/quote/receipt
5. **Missing features**: No support for invoice templates, custom fields, etc.

---

## NEW MULTI-TENANT DYNAMIC INVOICING UI (BUILD FROM SCRATCH)

### Component Architecture Plan

#### 1. Shared Document Components
```
/src/components/documents/
├── DocumentList/                # Reusable list component
│   ├── index.tsx
│   ├── DocumentRow.tsx          # Single document row
│   ├── DocumentActions.tsx      # Action buttons (view, edit, download, etc.)
│   ├── DocumentFilters.tsx      # Search, status, date filters
│   └── DocumentStats.tsx        # Stats cards (total, paid, etc.)
├── DocumentForm/                # Reusable form component
│   ├── index.tsx
│   ├── DocumentHeader.tsx       # Quote selection, client, dates
│   ├── DocumentItems.tsx        # Line items with drag-drop
│   ├── DocumentTotals.tsx       # Calculated totals display
│   ├── DocumentPayment.tsx      # Payment method selection
│   └── DocumentNotes.tsx        # Notes section
├── DocumentView/                # Reusable view modal
│   ├── index.tsx
│   ├── DocumentHeader.tsx       # Header info
│   ├── DocumentItems.tsx        # Read-only items
│   ├── DocumentTotals.tsx       # Calculated totals
│   └── DocumentStatus.tsx       # Status with actions
└── DocumentPDF/                # Reusable PDF preview
    ├── index.tsx
    └── PDFViewer.tsx
```

#### 2. Invoice-Specific Components
```
/src/components/documents/invoice/
├── InvoiceList/                 # Invoice list page
│   └── index.tsx                # Wraps DocumentList
├── InvoiceForm/                 # Invoice create/edit
│   ├── index.tsx                # Wraps DocumentForm
│   ├── InvoiceNumbering.tsx     # Auto-numbering preview
│   └── InvoiceCompliance.tsx    # Compliance warnings/validations
├── InvoiceView/                 # Invoice view modal
│   ├── index.tsx                # Wraps DocumentView
│   └── InvoiceActions.tsx       # Invoice-specific actions
├── InvoiceModifications/        # Modification workflows
│   ├── index.tsx
│   ├── CreditNote.tsx           # Create credit note
│   ├── VoidAndReissue.tsx       # Void and reissue
│   └── Corrective.tsx           # Corrective invoice
└── InvoicePDF/
    ├── index.tsx
    ├── FormatSelector.tsx       # PDF format (Factur-X, ZUGFeRD, etc.)
    └── DownloadButton.tsx       # Download with format selection
```

#### 3. Quote-Specific Components
```
/src/components/documents/quote/
├── QuoteList/                   # Quote list page
├── QuoteForm/                   # Quote create/edit
├── QuoteView/                   # Quote view modal
├── QuoteActions/                # Convert to invoice
└── QuotePDF/
```

#### 4. Receipt-Specific Components
```
/src/components/documents/receipt/
├── ReceiptList/                 # Receipt list page
├── ReceiptForm/                 # Receipt create/edit
├── ReceiptView/                 # Receipt view modal
├── CreateFromInvoice.tsx        # Create receipt from invoice
└── ReceiptPDF/
```

#### 5. Client-Specific Components
```
/src/components/clients/
├── ClientList/                  # Client list page
├── ClientForm/                  # Client create/edit
├── ClientView/                  # Client view modal
└── ClientSelect/                # Select client (searchable)
```

### Key Features to Implement

#### 1. Dynamic Numbering
- Auto-generate numbers based on company format: `INV-{year}-{number}`
- Real-time preview during invoice creation
- Support for custom formats: `{month}{year}{number::4}`

#### 2. Company-Specific Validation
- VAT validation based on company country
- Required legal identifiers per country (SIRET, VAT, etc.)
- Currency enforcement (use company default currency)

#### 3. Compliance Integration
- Warnings for non-compliant invoices
- Support for e-invoicing formats (Factur-X, ZUGFeRD, XRechnung)
- Invoice status tracking (draft, sent, paid, overdue)

#### 4. PDF Generation Options
- Standard PDF
- Factur-X (French e-invoicing)
- ZUGFeRD (German e-invoicing)
- XRechnung (German public sector)
- UBL, CII (XML exports)

#### 5. Custom Fields Support
- Dynamic form fields based on company settings
- Company-specific invoice templates
- Custom identifiers and metadata

#### 6. Multi-Currency Support
- Per-client currency selection
- Automatic conversion calculations
- Currency-aware formatting

#### 7. Invoice Modifications
- Credit notes
- Void and reissue
- Corrective invoices (fix mistakes)

#### 8. Real-time Updates
- SSE for invoice status changes
- Live totals calculation
- Auto-save drafts

### Page Routes (New Structure)
```
/pages/(app)/invoices/
├── index.tsx                    # Invoice list
├── new/                         # Create new invoice
├── [id]/                        # View invoice
│   ├── edit/                    # Edit invoice
│   ├── credit-note/             # Create credit note
│   ├── void-reissue/            # Void and reissue
│   └── corrective/              # Create corrective invoice
└── templates/                   # Invoice templates (future)

/pages/(app)/quotes/
├── index.tsx
├── new/
├── [id]/
│   ├── edit/
│   └── convert-to-invoice/      # Convert quote to invoice
└── templates/

/pages/(app)/receipts/
├── index.tsx
├── new/
├── [id]/
└── create-from-invoice/         # Create from invoice

/pages/(app)/clients/
├── index.tsx
├── new/
└── [id]/
    ├── edit/
    └── invoices/                # Client's invoices

/pages/(app)/payment-methods/
├── index.tsx
├── new/
└── [id]/
    └── edit/
```

---

## IMPLEMENTATION PHASES

### Phase 1: Foundation (Week 1)
1. Create shared document components structure
2. Build `DocumentList` base component
3. Build `DocumentForm` base component
4. Build `DocumentView` base component
5. Build `DocumentPDF` base component

### Phase 2: Invoice UI (Week 2-3)
1. Implement `InvoiceList` page
2. Implement `InvoiceForm` with dynamic numbering
3. Implement `InvoiceView` with actions
4. Implement invoice modifications (credit note, void/reissue)
5. PDF format selector and download

### Phase 3: Quote UI (Week 4)
1. Implement `QuoteList` page
2. Implement `QuoteForm` component
3. Implement `QuoteView` component
4. Convert quote to invoice workflow

### Phase 4: Receipt UI (Week 5)
1. Implement `ReceiptList` page
2. Implement `ReceiptForm` component
3. Implement `ReceiptView` component
4. Create receipt from invoice workflow

### Phase 5: Client UI (Week 6)
1. Implement `ClientList` page
2. Implement `ClientForm` component
3. Implement `ClientView` component
4. Client invoices list view

### Phase 6: Polish & Testing (Week 7-8)
1. Add loading states and error handling
2. Add form validation and error messages
3. Add keyboard shortcuts
4. Responsive design improvements
5. Accessibility audit
6. E2E testing with Cypress

---

## TECHNICAL NOTES

### State Management Strategy
- **Keep**: React Context for Company (already working)
- **Keep**: React Hook Form for forms (already integrated)
- **Add**: TanStack Query for caching (consider if needed)
- **Add**: Zustand for invoice draft state (optional)

### Form Validation
- **Keep**: Zod schemas (already in use)
- **Enhance**: Company-specific validation rules
- **Enhance**: Dynamic validation based on country compliance

### API Integration
- **Keep**: Existing `use-fetch` hooks
- **Enhance**: Add optimistic updates
- **Enhance**: Add query invalidation on mutations

### Performance Optimizations
- **Keep**: SSE for real-time updates (already implemented)
- **Add**: React.memo for expensive components
- **Add**: Virtual scrolling for large lists (react-window)
- **Keep**: Page prefetching (already implemented)

### Accessibility
- Ensure all forms are keyboard navigable
- ARIA labels for custom components
- Focus management for modals
- Screen reader support for tables

---

## SKILLS TO ACTIVATE

Before starting development, activate these skills:

```bash
npx skills add vercel/vercel-react-best-practices -g
npx skills add shadcn-v2/tailwind-v4-shadcn -g
npx skills skillsby/ react-hook-form-zod -g
```

---

## FILES TO DELETE (Safe to remove after new UI is ready)

```bash
# Remove existing invoice components
rm -rf src/pages/\(app\)/invoices/_components/
rm -f src/pages/\(app\)/invoices/\[id\]/corrective.tsx
rm -f src/pages/\(app\)/invoices/\[id\]/credit-note.tsx
rm -f src/pages/\(app\)/invoices/\[id\]/void-reissue.tsx

# Remove existing quote components
rm -rf src/pages/\(app\)/quotes/_components/

# Remove existing receipt components
rm -rf src/pages/\(app\)/receipts/_components/

# Remove existing client components
rm -rf src/pages/\(app\)/clients/_components/

# Remove existing payment method components
rm -rf src/pages/\(app\)/payment-methods/_components/
```

---

## BACKWARDS COMPATIBILITY

The new UI will maintain API compatibility with the existing backend:
- Same endpoints (`/api/invoices`, `/api/quotes`, `/api/receipts`)
- Same request/response structures
- Additional features will be additive, not breaking changes

---

## NEXT STEPS

1. Review this TODO document and confirm architecture
2. Activate the required skills
3. Begin Phase 1: Foundation components
4. Create component tests alongside implementation
5. Update this TODO as architecture evolves

---

Generated: 2026-02-04
