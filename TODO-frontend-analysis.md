# Multi-Tenant Dynamic Numbering System - Frontend Analysis

**Date:** 2026-02-04  
**Agent:** Frontend Exploration Agent  
**Scope:** Analysis of existing frontend code to prepare for Multi-Tenant Dynamic Numbering implementation

---

## 1. Current Settings UI Structure

### 1.1 Settings Architecture

The settings page follows a **tab-based navigation pattern** located at:
- **Main File:** `/home/impre/Projects/invoicerr/frontend/src/pages/(app)/settings/-[tab].tsx`
- **Components:** `/home/impre/Projects/invoicerr/frontend/src/pages/(app)/settings/_components/`

**Current Tabs:**
```
1. company       - Company Settings (contains numbering config)
2. compliance    - Compliance Settings
3. template      - PDF Templates
4. email         - Email Templates
5. webhooks      - Webhooks
6. logs          - Activity Logs
7. account       - User Account
8. invitations   - Team Invitations
9. plugins       - Plugins
10. danger       - Danger Zone
```

### 1.2 Company Settings Current Numbering Configuration

**File:** `/home/impre/Projects/invoicerr/frontend/src/pages/(app)/settings/_components/company.settings.tsx`

**Current Numbering Fields (Lines 49-56):**
```typescript
interface CompanyFormValues {
  quoteStartingNumber: number;
  quoteNumberFormat: string;
  invoiceStartingNumber: number;
  invoiceNumberFormat: string;
  receiptStartingNumber: number;
  receiptNumberFormat: string;
  // ... other fields
}
```

**Default Values (Lines 207-212):**
```typescript
quoteStartingNumber: 1,
quoteNumberFormat: 'Q-{year}-{number}',
invoiceStartingNumber: 1,
invoiceNumberFormat: 'INV-{year}-{number}',
receiptStartingNumber: 1,
receiptNumberFormat: 'REC-{year}-{number}',
```

**Format Validation (Lines 73-108):**
- Pattern regex: `/\{(\w+)(?::(\d+))?\}/g`
- Valid keys: `['year', 'month', 'day', 'number']`
- Required key: `number`
- Padding support: `{number:4}` format

### 1.3 Current Numbering UI Section

**Location in File:** Lines 787-944 (Card component)

**Structure:**
```
Card: Number Formats
├── Grid (2 columns)
│   ├── Quote Starting Number + Format
│   ├── Invoice Starting Number + Format
│   └── Receipt Starting Number + Format
```

**Issues with Current Implementation:**
1. No support for **multiple series** per document type
2. No **preview** functionality for number formats
3. No **tenant-level** numbering isolation
4. No **compliance rule** integration
5. Static format strings without variable suggestions

---

## 2. Form Patterns Used

### 2.1 React Hook Form + Zod Pattern

**Standard Pattern (from company.settings.tsx):**

```typescript
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { z } from 'zod';

// 1. Define Schema with Translations
const companySchema = z.object({
  name: z
    .string({ required_error: t('settings.company.form.company.errors.required') })
    .min(1, t('settings.company.form.company.errors.empty'))
    .max(100, t('settings.company.form.company.errors.maxLength')),
  // ... more fields
});

// 2. Type inference
type CompanyFormValues = z.infer<typeof companySchema>;

// 3. Form Setup
const form = useForm<CompanyFormValues>({
  resolver: zodResolver(companySchema),
  defaultValues: {
    name: '',
    // ... defaults
  },
});

// 4. Form Provider Usage
<Form {...form}>
  <form onSubmit={form.handleSubmit(onSubmit)}>
    <FormField
      control={form.control}
      name="name"
      render={({ field }) => (
        <FormItem>
          <FormLabel required>{t('label')}</FormLabel>
          <FormControl>
            <Input {...field} />
          </FormControl>
          <FormDescription>{t('description')}</FormDescription>
          <FormMessage />
        </FormItem>
      )}
    />
  </form>
</Form>
```

### 2.2 Form Component Library (shadcn/ui)

**Key Components Used:**
- `Form`, `FormField`, `FormItem`, `FormLabel`, `FormControl`, `FormDescription`, `FormMessage`
- `Input`, `Select`, `Switch`, `Textarea`
- `Card`, `CardHeader`, `CardTitle`, `CardDescription`, `CardContent`
- `Button`, `Dialog`, `DropdownMenu`

**FormLabel Features:**
- Supports `required` prop (adds red asterisk)
- Error state styling
- Associated with input via `htmlFor`

### 2.3 API Integration Pattern

**From use-fetch.ts:**

```typescript
import { useGet, usePost, usePatch, useDelete } from '@/hooks/use-fetch';

// GET request
const { data, loading, error, mutate } = useGet<T>('/api/endpoint');

// POST/PUT/PATCH/DELETE
const { trigger, data, loading, error } = usePost<T>('/api/endpoint');

// Usage
trigger(body)
  .then(() => toast.success(t('success')))
  .catch((err) => toast.error(t('error')));
```

**Key Features:**
- Automatic `X-Company-Id` header injection
- Credentials included
- 401 redirect handling
- TypeScript generics support

### 2.4 Dynamic Configuration Loading

**From use-compliance.ts (Lines 448-538):**

```typescript
export function useCountryIdentifiers(
  country: string | undefined,
  entityType: 'company' | 'client' = 'company',
) {
  const [data, setData] = useState<CountryIdentifierConfig | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  
  // In-memory cache with 5h TTL
  const cacheKey = useMemo(() => `${country}|${entityType}`, [country, entityType]);
  
  // Fetch with caching
  useEffect(() => {
    // Check cache first
    // Fetch if not cached
    // Store in cache
  }, [cacheKey]);
  
  return { identifiers, vat, customFields, isLoading, error, refetch };
}
```

---

## 3. Component Architecture Recommendations

### 3.1 New Settings Tab Structure

**Recommended:** Add new "Numbering" tab between "compliance" and "template"

```typescript
// In -[tab].tsx
const validTabs = [
  'company',
  'compliance',
  'numbering',      // NEW
  'template',
  // ... rest
];

const menuItems = [
  // ... existing items
  {
    value: 'numbering',
    label: t('settings.tabs.numbering'),
    icon: Hash,  // or ListOrdered
  },
  // ... rest
];
```

### 3.2 Proposed Component Hierarchy

```
settings/
├── _components/
│   ├── company.settings.tsx        # Existing
│   ├── numbering.settings.tsx      # NEW - Main settings component
│   └── __components/               # Shared sub-components
│       ├── series-manager.tsx      # NEW - Series CRUD
│       ├── number-preview.tsx      # NEW - Live preview
│       ├── format-builder.tsx      # NEW - Visual format builder
│       └── series-select.tsx       # NEW - Series dropdown for forms
```

### 3.3 Document Form Integration

**Current:** Invoice/Quote upsert dialogs don't handle numbering explicitly

**New Pattern:**
```typescript
// In invoice-upsert.tsx
interface InvoiceFormValues {
  clientId: string;
  seriesId?: string;        // NEW - Selected numbering series
  dueDate?: Date;
  // ... rest
}

// Display calculated number preview
// Allow series selection if multiple available
```

---

## 4. New Components Needed

### 4.1 SeriesManager Component

**Purpose:** CRUD interface for numbering series

**Props Interface:**
```typescript
interface SeriesManagerProps {
  documentType: 'INVOICE' | 'QUOTE' | 'RECEIPT' | 'CREDIT_NOTE';
  companyId: string;
  onSeriesChange?: () => void;
}

interface NumberingSeries {
  id: string;
  name: string;
  prefix: string;
  suffix: string;
  startingNumber: number;
  currentNumber: number;
  padding: number;
  year?: number;
  month?: number;
  isDefault: boolean;
  resetPeriod?: 'NEVER' | 'YEARLY' | 'MONTHLY';
}
```

**Features:**
- List existing series
- Create new series
- Edit series (if no documents issued)
- Set default series
- Delete series (if no documents)
- Duplicate series

### 4.2 NumberPreview Component

**Purpose:** Live preview of generated document numbers

**Props Interface:**
```typescript
interface NumberPreviewProps {
  format: string;
  nextNumber: number;
  padding?: number;
  previewCount?: number;  // Number of examples to show
}

// Example Usage
<NumberPreview
  format="INV-{year}-{number:4}"
  nextNumber={42}
  padding={4}
  previewCount={3}
/>
// Shows: INV-2026-0042, INV-2026-0043, INV-2026-0044
```

### 4.3 FormatBuilder Component

**Purpose:** Visual format string builder with token selection

**Props Interface:**
```typescript
interface FormatBuilderProps {
  value: string;
  onChange: (format: string) => void;
  allowedTokens?: TokenType[];
}

type TokenType = 
  | 'year' 
  | 'year2' 
  | 'month' 
  | 'day' 
  | 'number' 
  | 'company' 
  | 'series' 
  | 'custom';
```

**UI Design:**
```
[Static Text Input] [{token-dropdown}] [{token-dropdown}] [Static Text]
      INV-          [year ▼]      [number:4 ▼]      -A
```

### 4.4 SeriesSelect Component

**Purpose:** Dropdown for selecting numbering series in document forms

**Props Interface:**
```typescript
interface SeriesSelectProps {
  documentType: 'INVOICE' | 'QUOTE' | 'RECEIPT';
  value?: string;
  onChange: (seriesId: string) => void;
  showPreview?: boolean;
}
```

### 4.5 ResetScheduleEditor Component

**Purpose:** Configure when numbering resets

**Props Interface:**
```typescript
interface ResetScheduleEditorProps {
  value: 'NEVER' | 'YEARLY' | 'MONTHLY' | 'DAILY';
  onChange: (schedule: ResetPeriod) => void;
  startDate?: Date;
  onStartDateChange?: (date: Date) => void;
}
```

---

## 5. API Integration Points

### 5.1 New API Endpoints Required

Based on backend design, frontend needs these hooks:

```typescript
// hooks/use-numbering.ts

// GET /api/numbering/series?documentType=INVOICE
export function useNumberingSeries(documentType: DocumentType) {
  return useGet<NumberingSeries[]>(`/api/numbering/series?documentType=${documentType}`);
}

// GET /api/numbering/series/:id
export function useNumberingSeriesById(id: string | null) {
  return useGet<NumberingSeries>(id ? `/api/numbering/series/${id}` : null);
}

// POST /api/numbering/series
export function useCreateNumberingSeries() {
  return usePost<NumberingSeries, CreateSeriesDto>('/api/numbering/series');
}

// PATCH /api/numbering/series/:id
export function useUpdateNumberingSeries(id: string) {
  return usePatch<NumberingSeries, UpdateSeriesDto>(`/api/numbering/series/${id}`);
}

// DELETE /api/numbering/series/:id
export function useDeleteNumberingSeries(id: string) {
  return useDelete(`/api/numbering/series/${id}`);
}

// GET /api/numbering/preview?format=...&nextNumber=...
export function useNumberPreview(format: string, nextNumber: number) {
  return useGet<string>(
    `/api/numbering/preview?format=${encodeURIComponent(format)}&nextNumber=${nextNumber}`
  );
}

// GET /api/numbering/next-number?seriesId=...
export function useNextNumber(seriesId: string | null) {
  return useGet<{ nextNumber: number; preview: string }>(
    seriesId ? `/api/numbering/next-number?seriesId=${seriesId}` : null
  );
}
```

### 5.2 Integration with Document Creation

**Current Invoice Upsert Flow:**
1. User fills form
2. Submits to POST /api/invoices
3. Backend assigns number based on company defaults

**New Flow with Numbering:**
1. User fills form
2. Selects numbering series (optional, uses default)
3. Frontend shows preview of assigned number
4. Submits with seriesId
5. Backend assigns number from series

**Changes needed in invoice-upsert.tsx:**
```typescript
// Add to form schema
seriesId: z.string().optional(),

// Add to form UI
<FormField
  control={control}
  name="seriesId"
  render={({ field }) => (
    <FormItem>
      <FormLabel>{t('invoices.upsert.form.series.label')}</FormLabel>
      <FormControl>
        <SeriesSelect
          documentType="INVOICE"
          value={field.value}
          onChange={field.onChange}
          showPreview
        />
      </FormControl>
      <FormDescription>
        {t('invoices.upsert.form.series.description')}
      </FormDescription>
    </FormItem>
  )}
/>
```

---

## 6. UI/UX Recommendations

### 6.1 Numbering Settings Page Layout

```
┌─────────────────────────────────────────────────────────────┐
│ Numbering Settings                               [? Help]   │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Document Type Tabs                                  │   │
│  │ [Invoices] [Quotes] [Receipts] [Credit Notes]       │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Series List                                         │   │
│  │ ┌─────────────────────────────────────────────────┐ │   │
│  │ │ Default: INV-2026-0001 (Current: 42)      [Edit]│ │   │
│  │ │ Series A: INV-A-{year}-{number}           [Edit]│ │   │
│  │ │ Series B: INV-B-{year}-{number}      [Default]  │ │   │
│  │ └─────────────────────────────────────────────────┘ │   │
│  │                                           [+ New]   │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │ Series Editor / Creator                             │   │
│  │                                                     │   │
│  │ Name: [________________________]                    │   │
│  │                                                     │   │
│  │ Format Builder:                                     │   │
│  │ [INV-] [{year}] [-] [{number:4}]                    │   │
│  │                                                     │   │
│  │ Starting Number: [1________]                        │   │
│  │                                                     │   │
│  │ Reset Schedule: [Yearly ▼]                          │   │
│  │                                                     │   │
│  │ Preview:                                            │   │
│  │ INV-2026-0001, INV-2026-0002, INV-2026-0003         │   │
│  │                                                     │   │
│  │ [Cancel] [Save Series]                              │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 6.2 Format Token Reference

**Help Panel Content:**
```
Available Tokens:
• {year}      - Full year (2026)
• {year2}     - Short year (26)
• {month}     - Month (01-12)
• {day}       - Day (01-31)
• {number}    - Sequential number
• {number:4}  - Padded number (0001)
• {company}   - Company short code
• {series}    - Series identifier

Examples:
INV-{year}-{number:4}     → INV-2026-0001
Q-{year2}{month}-{number} → Q-2602-45
{series}-{number:3}       → A-001
```

### 6.3 Document Form Integration

**Minimal Intrusion Approach:**
- Add series selector as optional field
- Show calculated number preview
- Default to company default series
- Don't require user to understand numbering

**Quote Upsert Addition:**
```
┌──────────────────────────────┐
│ Create Quote                 │
├──────────────────────────────┤
│                              │
│ Title: [_______________]     │
│ Client: [____________ ▼]     │
│                              │
│ Numbering Series: [Default ▼]│
│ → Next number: Q-2026-0042   │
│                              │
│ Valid Until: [________]      │
│ ...                          │
└──────────────────────────────┘
```

### 6.4 Responsive Considerations

**Mobile (< 768px):**
- Series list as cards instead of table
- Format builder stacked vertically
- Preview in collapsible section

**Tablet (768px - 1024px):**
- Two-column layout for series list
- Side-by-side format builder

**Desktop (> 1024px):**
- Full three-column layout
- Live preview updates
- Drag-drop series reordering

---

## 7. State Management Recommendations

### 7.1 Local State (useState)

For form state within settings components:
```typescript
const [editingSeries, setEditingSeries] = useState<NumberingSeries | null>(null);
const [showCreateForm, setShowCreateForm] = useState(false);
```

### 7.2 Server State (React Query / SWR)

Numbering series data should use the existing `use-fetch` hooks:
```typescript
const { data: series, loading, mutate } = useGet<NumberingSeries[]>('/api/numbering/series');
```

### 7.3 Global State (Context)

Not needed for numbering - stays within settings scope.

---

## 8. i18n Considerations

### 8.1 Translation Keys Structure

```json
{
  "settings": {
    "tabs": {
      "numbering": "Numbering"
    },
    "numbering": {
      "title": "Numbering Settings",
      "description": "Configure document numbering series",
      "series": {
        "title": "Numbering Series",
        "name": "Series Name",
        "format": "Format",
        "default": "Default",
        "currentNumber": "Current Number",
        "actions": {
          "create": "Create Series",
          "edit": "Edit",
          "delete": "Delete",
          "setDefault": "Set as Default"
        }
      },
      "format": {
        "title": "Format Builder",
        "tokens": {
          "year": "Year (2026)",
          "year2": "Short Year (26)",
          "month": "Month",
          "day": "Day",
          "number": "Sequence Number"
        },
        "padding": "Number Padding"
      },
      "preview": {
        "title": "Preview",
        "nextNumbers": "Next numbers: {{numbers}}"
      }
    }
  }
}
```

---

## 9. Migration Strategy

### 9.1 Phase 1: Backend-First
- Backend implements new numbering API
- Maintain backward compatibility with existing company fields

### 9.2 Phase 2: Settings Page
- Create new Numbering settings tab
- Implement SeriesManager component
- Migrate existing company numbering to series

### 9.3 Phase 3: Document Forms
- Add series selection to invoice/quote forms
- Show number preview

### 9.4 Phase 4: Cleanup
- Remove old numbering fields from company settings
- Deprecate old API endpoints

---

## 10. Testing Considerations

### 10.1 Unit Tests
- Format string parser
- Number preview generation
- Series validation logic

### 10.2 E2E Tests (Cypress)
- Create new numbering series
- Edit series
- Set default series
- Create invoice with specific series
- Verify number generation

### 10.3 Test Data
```typescript
const mockSeries: NumberingSeries[] = [
  {
    id: 'series-1',
    name: 'Default Invoice Series',
    format: 'INV-{year}-{number:4}',
    nextNumber: 42,
    isDefault: true,
  },
];
```

---

## Summary

The Invoicerr frontend is well-structured for adding the Multi-Tenant Dynamic Numbering system:

1. **Strong Form Foundation:** React Hook Form + Zod validation is already in place
2. **Consistent UI Patterns:** shadcn/ui components provide consistent styling
3. **API Integration:** use-fetch hooks provide a clean abstraction
4. **Settings Architecture:** Tab-based settings easily accommodates new "Numbering" tab
5. **Document Forms:** Upsert dialogs follow consistent pattern for adding series selector

**Key Implementation Order:**
1. Create `numbering.settings.tsx` with SeriesManager
2. Implement use-numbering.ts hooks
3. Add series selector to invoice-upsert.tsx and quote-upsert.tsx
4. Add translations
5. Write E2E tests

---

**End of Analysis**
