import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { usePatch, usePost } from "@/hooks/use-fetch"
import { useMutationWithToast } from "@/hooks/use-mutation-with-toast"
import { queryKeys } from "@/lib/query-keys"
import { useQueryClient } from "@tanstack/react-query"
import { DocumentField } from "@/components/documents/document-field"
import { useClientDuplicates, useResolvedCompanyCustomFields } from "@/hooks/queries"

import { Button } from "@/components/ui/button"
import type { Client } from "@/types"
import { Alert, AlertDescription } from "@/components/ui/alert"
import CountrySelect from "@/components/country-select"
import CurrencySelect from "@/components/currency-select"
import DocumentLanguageSelect from "@/components/document-language-select"
import { getDefaultLanguageForCountry } from "@/lib/country-default-language"
import { DatePicker } from "@/components/date-picker"
import { fromCalendarDate, toCalendarDateInstant } from "@/lib/calendar-date"
import { Input } from "@/components/ui/input"
import { Loader2, Search, TriangleAlert } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useForm, type FieldValues, type UseFormReturn } from "react-hook-form"
import { Link } from "react-router"
import { type LookupScheme, useCompanyLookup } from "@/hooks/use-company-lookup"
import { useCountryToCurrency } from "@/hooks/use-country-to-currency"
import { useDebouncedValue } from "@/hooks/use-debounced-value"
import { type IdentifierRequirement, useRequiredIdentifiers } from "@/hooks/use-required-identifiers"
import { type B2gRoutingRule, useB2gRoutingRule } from "@/hooks/use-b2g-routing"
import { useTranslation } from "react-i18next"
import { toast } from "sonner"
import type { z } from "zod"
import { zodResolver } from "@hookform/resolvers/zod"

import { FormSection } from "../../_shared/form-dialog"
import {
  SteppedDialog,
  type SteppedDialogHandle,
  type SteppedDialogStep,
  stepForField,
} from "@/components/ui/stepped-dialog"
import { ClientPortalAccessDialog } from "./client-portal-access"
import { buildClientSchema } from "@/lib/client-schema"

interface ClientUpsertProps {
  client?: Client | null
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate?: (client: Client) => void
}

/**
 * This company's ACTIVE CLIENT-target custom
 * fields, rendered through the exact same generic, per-KIND `DocumentField` component the document
 * form already uses (zero kind-specific code here). `name` is `customFields.<key>` — a NESTED
 * react-hook-form path, unlike a document's own flat `custom:<key>` (see the backend's
 * `company-custom-fields/types.ts#toFieldDescriptor` header for why a CLIENT-target field needs no
 * prefix at all): `Client.customFields` is already its own isolated JSON column, so `customFields`
 * being a real, `z.record`-typed field on `clientSchema` is what carries this whole object through
 * `form.handleSubmit` intact. Renders nothing for a company that has defined none. Appended to the
 * CONTACT step (see the wizard's own step-split comment below): an open-ended extension point with
 * no inherent home among the other four, and the last thing worth filling in before the summary.
 */
function CustomFieldsSection() {
  const { t } = useTranslation()
  const { data: customFields } = useResolvedCompanyCustomFields("CLIENT")
  const fields = customFields ?? []
  if (fields.length === 0) return null

  return (
    <FormSection
      title={t("clients.upsert.customFields.heading")}
      columns="single"
      dataCy="client-custom-fields-section"
    >
      {fields.map((field) => (
        <DocumentField key={field.key} field={field} name={`customFields.${field.key}`} />
      ))}
    </FormSection>
  )
}

/**
 * IDENTITY — what makes this client itself: type, its name (company) or first/last name
 * (individual), a free-text description, when it was founded, and whether it is ALSO a supplier to
 * this company (`isSupplier`, a role independent of "kind" below — see that field's own schema
 * comment). None of this depends on the country chosen on the next step.
 */
function IdentityStep({ form, clientType }: { form: UseFormReturn<FieldValues>; clientType: string }) {
  const { t } = useTranslation()
  return (
    <div className="grid gap-4 sm:grid-cols-2" data-cy="client-form-identity">
      <FormField
        control={form.control}
        name="type"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("clients.upsert.fields.type.label") || "Client type"}</FormLabel>
            <FormControl>
              <Select value={field.value || "COMPANY"} onValueChange={(value) => field.onChange(value)}>
                <SelectTrigger dataCy="client-type-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="COMPANY" dataCy="client-type-company">
                    {t("clients.upsert.fields.type.company") || "Company"}
                  </SelectItem>
                  <SelectItem value="INDIVIDUAL" dataCy="client-type-individual">
                    {t("clients.upsert.fields.type.individual") || "Individual"}
                  </SelectItem>
                </SelectContent>
              </Select>
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      {clientType === "COMPANY" ? (
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("clients.upsert.fields.name.label")}</FormLabel>
              <FormControl>
                <Input {...field} placeholder={t("clients.upsert.fields.name.placeholder")} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      ) : (
        <>
          <FormField
            control={form.control}
            name="contactFirstname"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("clients.upsert.fields.contactFirstname.label")}</FormLabel>
                <FormControl>
                  <Input {...field} placeholder={t("clients.upsert.fields.contactFirstname.placeholder")} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="contactLastname"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("clients.upsert.fields.contactLastname.label")}</FormLabel>
                <FormControl>
                  <Input {...field} placeholder={t("clients.upsert.fields.contactLastname.placeholder")} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </>
      )}

      <div className="sm:col-span-2">
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("clients.upsert.fields.description.label")}</FormLabel>
              <FormControl>
                <Input {...field} placeholder={t("clients.upsert.fields.description.placeholder")} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <FormField
        control={form.control}
        name="foundedAt"
        render={({ field }) => (
          <FormItem>
            <FormLabel>{t("clients.upsert.fields.foundedAt.label")}</FormLabel>
            <FormControl>
              <DatePicker
                className="w-full"
                value={field.value || null}
                onChange={field.onChange}
                placeholder={t("clients.upsert.fields.foundedAt.placeholder")}
              />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />

      <FormField
        control={form.control}
        name="isSupplier"
        render={({ field }) => (
          <FormItem className="flex flex-row items-center justify-between rounded-lg border p-4 sm:col-span-2">
            <div className="space-y-0.5">
              <FormLabel>{t("clients.upsert.fields.isSupplier.label")}</FormLabel>
              <FormDescription>{t("clients.upsert.fields.isSupplier.description")}</FormDescription>
            </div>
            <FormControl>
              <Switch
                checked={!!field.value}
                onCheckedChange={(value) => field.onChange(value)}
                data-cy="client-is-supplier-switch"
              />
            </FormControl>
          </FormItem>
        )}
      />
    </div>
  )
}

/**
 * ADDRESS — the postal address, country included. Country has to be set here (before the next step)
 * because it drives BOTH the required-identifiers catalog and the currency default
 * (`useCountryToCurrency`) the Fiscalité step shows.
 */
function AddressStep({ form }: { form: UseFormReturn<FieldValues> }) {
  const { t } = useTranslation()
  return (
    <div className="grid gap-4 sm:grid-cols-2" data-cy="client-form-address">
      <div className="sm:col-span-2">
        <FormField
          control={form.control}
          name="country"
          render={({ field }) => (
            <FormItem>
              <FormLabel required>{t("clients.upsert.fields.country.label")}</FormLabel>
              <FormControl>
                <CountrySelect
                  value={field.value}
                  onChange={(value) => field.onChange(value)}
                  onCountryCodeChange={(code) => form.setValue("countryCode", code as never)}
                  data-cy="client-country-select"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <div className="sm:col-span-2">
        <FormField
          control={form.control}
          name="address"
          render={({ field }) => (
            <FormItem>
              <FormLabel required>{t("clients.upsert.fields.address.label")}</FormLabel>
              <FormControl>
                <Input {...field} placeholder={t("clients.upsert.fields.address.placeholder")} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <div className="sm:col-span-2">
        <FormField
          control={form.control}
          name="addressLine2"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("clients.upsert.fields.addressLine2.label")}</FormLabel>
              <FormControl>
                <Input {...field} placeholder={t("clients.upsert.fields.addressLine2.placeholder")} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:col-span-2 sm:grid-cols-3">
        <FormField
          control={form.control}
          name="postalCode"
          render={({ field }) => (
            <FormItem>
              {/* Not `required`: the schema accepts blank (see postal-code.ts's own header — some
                  countries have no postal code system, and no catalog here makes it conditional on
                  country today). */}
              <FormLabel>{t("clients.upsert.fields.postalCode.label")}</FormLabel>
              <FormControl>
                <Input {...field} placeholder={t("clients.upsert.fields.postalCode.placeholder")} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="city"
          render={({ field }) => (
            <FormItem>
              <FormLabel required>{t("clients.upsert.fields.city.label")}</FormLabel>
              <FormControl>
                <Input {...field} placeholder={t("clients.upsert.fields.city.placeholder")} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="state"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("clients.upsert.fields.state.label")}</FormLabel>
              <FormControl>
                <Input {...field} placeholder={t("clients.upsert.fields.state.placeholder")} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </div>
    </div>
  )
}

/**
 * FISCALITÉ & IDENTIFIANTS — everything the tax/compliance engines need from this client: `kind`
 * (BUSINESS/GOVERNMENT, gating the B2G hint), the billing currency (tied to the country chosen on the
 * previous step, hence kept right next to `kind`), the country's own required identifiers (VAT,
 * SIRET, Leitweg-ID…) merged with whatever a GOVERNMENT client's own B2G rule additionally requires,
 * and the Peppol electronic-routing pair — every fact a cross-border invoice to this client needs
 * resolved before it can send.
 */
function FiscalStep({
  form,
  isGovernment,
  b2gRule,
  b2gRuleLoading,
  requiredIdentifiers,
  requiredIdentifiersReason,
  canLookupScheme,
  onCompanyLookup,
  companyLookupLoading,
  lookupIdentifierLabel,
}: {
  form: UseFormReturn<FieldValues>
  isGovernment: boolean
  b2gRule: B2gRoutingRule | null | undefined
  b2gRuleLoading: boolean
  requiredIdentifiers: IdentifierRequirement[] | undefined
  requiredIdentifiersReason: string | undefined
  canLookupScheme: (scheme: string) => boolean
  onCompanyLookup: (value: string | undefined, scheme?: LookupScheme) => void | Promise<void>
  companyLookupLoading: boolean
  lookupIdentifierLabel: string | undefined
}) {
  const { t } = useTranslation()
  return (
    <div className="space-y-6" data-cy="client-form-fiscal">
      <FormSection title={t("clients.upsert.sections.classification")}>
        <FormField
          control={form.control}
          name="kind"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("clients.upsert.fields.kind.label", "Client kind")}</FormLabel>
              <FormControl>
                <Select value={field.value || "BUSINESS"} onValueChange={(value) => field.onChange(value)}>
                  <SelectTrigger dataCy="client-kind-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="BUSINESS" dataCy="client-kind-business">
                      {t("clients.upsert.fields.kind.business", "Business")}
                    </SelectItem>
                    <SelectItem value="GOVERNMENT" dataCy="client-kind-government">
                      {t("clients.upsert.fields.kind.government", "Government / public body")}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        <FormField
          control={form.control}
          name="currency"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("clients.upsert.fields.currency.label")}</FormLabel>
              <FormControl>
                <CurrencySelect
                  value={field.value}
                  onChange={(value) => field.onChange(value)}
                  data-cy="client-currency-select"
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />

        {isGovernment ? (
          <div
            className="space-y-2 rounded-lg border bg-muted/30 p-4 text-sm sm:col-span-2"
            data-cy="client-b2g-hint"
          >
            {b2gRuleLoading ? null : b2gRule ? (
              <>
                <p className="font-medium text-muted-foreground">
                  {t(
                    "clients.upsert.fields.b2gHint.knownTitle",
                    "This country requires a specific channel/format for public-sector invoices",
                  )}
                </p>
                <p className="text-xs text-muted-foreground" data-cy="client-b2g-hint-channel">
                  {t(
                    "clients.upsert.fields.b2gHint.channel",
                    'Channel: "{{transportId}}" · Format: "{{formatSyntax}}"',
                    { transportId: b2gRule.transportId, formatSyntax: b2gRule.formatSyntax },
                  )}
                </p>
                <p className="text-xs text-muted-foreground">{b2gRule.provenanceDescription}</p>
                {b2gRule.requiredDocumentFields.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {t(
                      "clients.upsert.fields.b2gHint.documentFields",
                      "The invoice itself will also need: {{fields}}",
                      {
                        fields: b2gRule.requiredDocumentFields.map((f) => f.label).join(", "),
                      },
                    )}
                  </p>
                )}
              </>
            ) : (
              <p className="text-xs text-muted-foreground" data-cy="client-b2g-hint-no-rule">
                {t(
                  "clients.upsert.fields.b2gHint.noRule",
                  "No B2G routing rule is declared for this country yet — sending an invoice to this client will refuse until one is added.",
                )}
              </p>
            )}
          </div>
        ) : null}
      </FormSection>

      {requiredIdentifiers?.length ? (
        <FormSection title={t("clients.upsert.fields.identifiers.label") || "Country-specific identifiers"}>
          {requiredIdentifiers.map((req) => {
            const current = form.watch("identifiers" as never) || []
            const formIndex = (current as { scheme: string }[]).findIndex((i) => i.scheme === req.scheme)
            if (formIndex < 0) return null
            return (
              <FormField
                key={req.scheme}
                control={form.control}
                name={`identifiers.${formIndex}.value`}
                render={({ field }) => (
                  <FormItem>
                    <FormLabel required={req.required}>{req.label}</FormLabel>
                    <FormControl>
                      <div className="flex gap-2">
                        <Input
                          {...field}
                          placeholder={req.label}
                          data-cy={`client-identifier-${req.scheme}`}
                        />
                        {canLookupScheme(req.scheme) && (
                          <Button
                            type="button"
                            variant="outline"
                            size="icon"
                            disabled={companyLookupLoading || !String(field.value || "").trim()}
                            onClick={() => onCompanyLookup(field.value, req.scheme as LookupScheme)}
                            aria-label={t("clients.upsert.actions.lookupCompany")}
                            title={
                              lookupIdentifierLabel
                                ? `${t("clients.upsert.actions.lookupCompany")} — ${lookupIdentifierLabel}`
                                : t("clients.upsert.actions.lookupCompany")
                            }
                            dataCy="client-company-lookup"
                          >
                            {companyLookupLoading ? <Loader2 className="animate-spin" /> : <Search />}
                          </Button>
                        )}
                      </div>
                    </FormControl>
                    {req.helpText && <p className="text-xs text-muted-foreground">{req.helpText}</p>}
                    <FormMessage />
                  </FormItem>
                )}
              />
            )
          })}
        </FormSection>
      ) : requiredIdentifiersReason ? (
        <p className="text-xs text-muted-foreground" data-cy="client-identifiers-unknown-country">
          {t(
            "clients.upsert.fields.identifiers.unknownCountry",
            "No identifier requirements are known for this country yet — you can save the client without one.",
          )}
        </p>
      ) : null}

      <FormSection
        title={t("clients.upsert.fields.peppol.label") || "Peppol / Electronic routing (optional)"}
      >
        <FormField
          control={form.control}
          name="peppolSchemeId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("clients.upsert.fields.peppolSchemeId.label") || "Peppol scheme"}</FormLabel>
              <FormControl>
                <Select value={field.value || "0088"} onValueChange={field.onChange}>
                  <SelectTrigger data-cy="client-peppol-scheme-select">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0088" dataCy="client-peppol-scheme-option-0088">
                      0088 — GLN
                    </SelectItem>
                    <SelectItem value="0192" dataCy="client-peppol-scheme-option-0192">
                      0192 — NO org.nr
                    </SelectItem>
                    <SelectItem value="0009" dataCy="client-peppol-scheme-option-0009">
                      0009 — FR SIRET
                    </SelectItem>
                    <SelectItem value="9925" dataCy="client-peppol-scheme-option-9925">
                      9925 — EU VAT
                    </SelectItem>
                    <SelectItem value="0007" dataCy="client-peppol-scheme-option-0007">
                      0007 — SE org.nr
                    </SelectItem>
                    <SelectItem value="0208" dataCy="client-peppol-scheme-option-0208">
                      0208 — BE org.nr
                    </SelectItem>
                    {/*
                      Was "0106 — DK CVR", WRONG: 0106 is the Dutch
                      KVK ("Vereniging van Kamers van Koophandel en Fabrieken in Nederland", NL,
                      active) in the Peppol v9.7 Participant Identifier Schemes codelist
                      (docs.peppol.eu/edelivery/codelists/), not a Danish scheme at all — found by
                      the 2026-09-02 B2G audit, re-verified live against the v9.7 codelist JSON on
                      2026-09-03. The real Danish CVR is 0184 (Peppol scheme name: "The Danish
                      Business Authority - CVR-number (DK:CVR)"), added just below.
                    */}
                    <SelectItem value="0106" dataCy="client-peppol-scheme-option-0106">
                      0106 — NL KVK
                    </SelectItem>
                    <SelectItem value="0184" dataCy="client-peppol-scheme-option-0184">
                      0184 — DK CVR
                    </SelectItem>
                    <SelectItem value="0151" dataCy="client-peppol-scheme-option-0151">
                      0151 — AU ABN
                    </SelectItem>
                    <SelectItem value="0060" dataCy="client-peppol-scheme-option-0060">
                      0060 — DUNS
                    </SelectItem>
                    {/*
                      The seven EAS the 2026-09-02 B2G audit added routing rules for
                      (backend/src/modules/documents/b2g-routing/data/{ee,lt,lv,lu,cy,gr,mt}.json)
                      but this selector never offered — each label below is the scheme name the
                      audit itself already read from the Peppol v9.7 Participant Identifier Schemes
                      codelist (that JSON's own `notes` field), re-verified live against
                      docs.peppol.eu on 2026-09-03: 0191 EE "Company code", 0200 LT "Legal entity
                      code", 0218 LV "Unified registration number", 0240 LU "Register of legal
                      persons" (each country has its own business-register scheme);
                      Cyprus/Greece/Malta have NO dedicated register scheme in the codelist — only
                      their VAT scheme (9928/9933/9943) exists, per those same three files' own
                      notes.
                    */}
                    <SelectItem value="0191" dataCy="client-peppol-scheme-option-0191">
                      0191 — EE Company code
                    </SelectItem>
                    <SelectItem value="0200" dataCy="client-peppol-scheme-option-0200">
                      0200 — LT Legal entity code
                    </SelectItem>
                    <SelectItem value="0218" dataCy="client-peppol-scheme-option-0218">
                      0218 — LV Unified registration number
                    </SelectItem>
                    <SelectItem value="0240" dataCy="client-peppol-scheme-option-0240">
                      0240 — LU Register of legal persons
                    </SelectItem>
                    <SelectItem value="9928" dataCy="client-peppol-scheme-option-9928">
                      9928 — CY VAT number
                    </SelectItem>
                    <SelectItem value="9933" dataCy="client-peppol-scheme-option-9933">
                      9933 — GR VAT number
                    </SelectItem>
                    <SelectItem value="9943" dataCy="client-peppol-scheme-option-9943">
                      9943 — MT VAT number
                    </SelectItem>
                  </SelectContent>
                </Select>
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="peppolEndpointId"
          render={({ field }) => (
            <FormItem>
              <FormLabel>
                {t("clients.upsert.fields.peppolEndpointId.label") || "Peppol endpoint ID"}
              </FormLabel>
              <FormControl>
                <Input
                  {...field}
                  placeholder={
                    t("clients.upsert.fields.peppolEndpointId.placeholder") || "e.g. 7300010000001"
                  }
                  data-cy="client-peppol-endpoint-input"
                />
              </FormControl>
              <p className="text-xs text-muted-foreground">
                {t("clients.upsert.fields.peppolEndpointId.helpText") ||
                  "Leave blank if this client is not on the Peppol network"}
              </p>
              <FormMessage />
            </FormItem>
          )}
        />
      </FormSection>
    </div>
  )
}

/**
 * Non-blocking "this might already exist" hint — the owner explicitly wants genuine duplicates
 * allowed (a franchise's two branches on one inbox, a common name in unrelated companies), so this
 * only ever INFORMS: it never disables Continue/Create, and its own query is `enabled: false` (see
 * `useClientDuplicates`) until at least one of its two criteria — email, or name+country together —
 * has something to check. Debounced so it fires once typing pauses, not once per keystroke.
 * `excludeId` is the client being EDITED, so an unchanged record never flags itself.
 */
function DuplicateWarning({ form, excludeId }: { form: UseFormReturn<FieldValues>; excludeId?: string }) {
  const { t } = useTranslation()
  const emailRaw = form.watch("contactEmail" as never) as unknown as string | undefined
  const nameRaw = form.watch("name" as never) as unknown as string | undefined
  const countryRaw = form.watch("country" as never) as unknown as string | undefined

  const email = useDebouncedValue(emailRaw)
  const name = useDebouncedValue(nameRaw)
  const country = useDebouncedValue(countryRaw)

  const { data: matches } = useClientDuplicates({ email, name, country, excludeId })
  if (!matches || matches.length === 0) return null

  return (
    <div className="space-y-2" data-cy="client-duplicate-warning">
      {matches.map((match) => (
        <Alert key={match.id} variant="warning" data-cy={`client-duplicate-warning-${match.id}`}>
          <TriangleAlert />
          <AlertDescription>
            <span>
              {match.matchedOn.includes("email")
                ? t("clients.upsert.duplicates.email", "A client with this email already exists: {{name}}.", {
                    name: match.name,
                  })
                : t(
                    "clients.upsert.duplicates.nameCountry",
                    "A client with this name already exists in {{country}}: {{name}}.",
                    { name: match.name, country: match.country },
                  )}
            </span>
            <Link
              to={`/clients?view=${match.id}`}
              target="_blank"
              rel="noreferrer"
              className="font-medium underline underline-offset-2"
              data-cy={`client-duplicate-link-${match.id}`}
            >
              {t("clients.upsert.duplicates.viewLink", "View existing client")}
            </Link>
          </AlertDescription>
        </Alert>
      ))}
    </div>
  )
}

/**
 * CONTACT & PORTAIL — how this client is reached: email, phone, document language, plus (editing
 * only — a not-yet-created client has no id to invite) an entry point into the EXISTING portal-access
 * dialog (`client-portal-access.tsx`), never a re-implementation of it. This company's own custom
 * CLIENT-target fields close out the step (see `CustomFieldsSection`'s own header for why they live
 * here). The duplicate hint (`DuplicateWarning`) sits at the top: by this step, both criteria it can
 * check (email — entered right below; name+country — already set on the earlier steps) have whatever
 * they are going to have.
 */
function ContactStep({
  form,
  isEditing,
  clientId,
  onOpenPortalAccess,
  languageSuggested,
  onLanguageManuallyChanged,
}: {
  form: UseFormReturn<FieldValues>
  isEditing: boolean
  clientId?: string
  onOpenPortalAccess: () => void
  /** True while the value currently in `language` is this wizard's own country-based SUGGESTION
   *  (see the effect that computes it in `ClientUpsert`), never once the user has picked one
   *  themselves — only ever true outside `isEditing`, see that effect's own guard. */
  languageSuggested: boolean
  /** Fired the moment the user picks a value here BY HAND (including explicitly picking back
   *  "Automatic") — the one signal that permanently retires the country-based suggestion for the
   *  rest of this wizard session (`Client.language` is decided by that country ONLY until a human
   *  says otherwise; see `country-default-language.ts`'s own header). */
  onLanguageManuallyChanged: () => void
}) {
  const { t } = useTranslation()
  return (
    <div className="space-y-6" data-cy="client-form-contact">
      <DuplicateWarning form={form} excludeId={clientId} />
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          control={form.control}
          name="contactEmail"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("clients.upsert.fields.contactEmail.label")}</FormLabel>
              <FormControl>
                <Input {...field} placeholder={t("clients.upsert.fields.contactEmail.placeholder")} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="contactPhone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>{t("clients.upsert.fields.contactPhone.label")}</FormLabel>
              <FormControl>
                <Input {...field} placeholder={t("clients.upsert.fields.contactPhone.placeholder")} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="sm:col-span-2">
          <FormField
            control={form.control}
            name="language"
            render={({ field }) => (
              <FormItem>
                <FormLabel>{t("clients.upsert.fields.language.label")}</FormLabel>
                <FormControl>
                  <DocumentLanguageSelect
                    value={field.value}
                    onChange={(value) => {
                      onLanguageManuallyChanged()
                      field.onChange(value)
                    }}
                    data-cy="client-language-select"
                  />
                </FormControl>
                <FormDescription>{t("clients.upsert.fields.language.description")}</FormDescription>
                {languageSuggested && (
                  <p className="text-xs text-muted-foreground" data-cy="client-language-suggested-hint">
                    {t("clients.upsert.fields.language.suggested")}
                  </p>
                )}
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
      </div>

      {isEditing && (
        <div className="flex flex-col items-start justify-between gap-3 rounded-lg border p-4 sm:flex-row sm:items-center">
          <div className="space-y-0.5">
            <p className="text-sm font-medium text-foreground">
              {t("clients.upsert.fields.portalAccess.label", "Client portal")}
            </p>
            <p className="text-xs text-muted-foreground">
              {t(
                "clients.upsert.fields.portalAccess.description",
                "Invite this client to sign in and see their own invoices, quotes and balance.",
              )}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            onClick={onOpenPortalAccess}
            dataCy="client-upsert-portal-access-button"
          >
            {t("clients.list.tooltips.portalAccess")}
          </Button>
        </div>
      )}

      <CustomFieldsSection />
    </div>
  )
}

/**
 * SUMMARY — a compact, read-only recap (never re-validated on its own "Continue" click, see the
 * wizard's own step-split comment for why: every fact here was already checked on the step that owns
 * it) plus the primary action (`SteppedDialog`'s own fixed footer).
 */
function RecapStep({
  form,
  isGovernment,
  requiredIdentifiers,
}: {
  form: UseFormReturn<FieldValues>
  isGovernment: boolean
  requiredIdentifiers: IdentifierRequirement[] | undefined
}) {
  const { t } = useTranslation()
  // `form.watch(name)` resolves to react-hook-form's "watch an ARRAY of names" overload here (the
  // form is loosely typed as `UseFormReturn<FieldValues>`, see this component's own callsite
  // comment on why) — an extra `as unknown` step before the scalar cast is what tells TypeScript
  // this is deliberate, not a mistake, the same shape `document-create-dialog.tsx`'s own RecapStep
  // needs for its `state.form.watch(clientField.key) as string | undefined`.
  const type = form.watch("type" as never) as unknown as string
  const name = form.watch("name" as never) as unknown as string | undefined
  const contactFirstname = form.watch("contactFirstname" as never) as unknown as string | undefined
  const contactLastname = form.watch("contactLastname" as never) as unknown as string | undefined
  const country = form.watch("country" as never) as unknown as string | undefined
  const currency = form.watch("currency" as never) as unknown as string | undefined
  const contactEmail = form.watch("contactEmail" as never) as unknown as string | undefined
  const identifiers = (form.watch("identifiers" as never) as { scheme: string; value: string }[]) || []

  const displayName =
    type === "INDIVIDUAL" ? [contactFirstname, contactLastname].filter(Boolean).join(" ") : name
  const primaryIdentifier = (requiredIdentifiers ?? [])
    .map((req) => ({ req, value: identifiers.find((i) => i.scheme === req.scheme)?.value }))
    .find((entry) => entry.value && entry.value.trim() !== "")
  const fallback = "—"

  return (
    <dl className="space-y-3 text-sm" data-cy="client-upsert-recap">
      <div className="flex items-center justify-between gap-4">
        <dt className="text-muted-foreground">{t("clients.upsert.stepped.recap.typeLabel", "Type")}</dt>
        <dd className="font-medium text-foreground">
          {type === "INDIVIDUAL"
            ? t("clients.upsert.fields.type.individual")
            : t("clients.upsert.fields.type.company")}
          {isGovernment ? ` · ${t("clients.upsert.fields.kind.government")}` : ""}
        </dd>
      </div>
      <div className="flex items-center justify-between gap-4">
        <dt className="text-muted-foreground">{t("clients.upsert.stepped.recap.nameLabel", "Name")}</dt>
        <dd className="font-medium text-foreground" data-cy="client-upsert-recap-name">
          {displayName?.trim() || fallback}
        </dd>
      </div>
      <div className="flex items-center justify-between gap-4">
        <dt className="text-muted-foreground">{t("clients.upsert.fields.country.label")}</dt>
        <dd className="font-medium text-foreground">{country || fallback}</dd>
      </div>
      {primaryIdentifier && (
        <div className="flex items-center justify-between gap-4">
          <dt className="text-muted-foreground">{primaryIdentifier.req.label}</dt>
          <dd className="font-mono font-medium tabular-nums text-foreground">{primaryIdentifier.value}</dd>
        </div>
      )}
      <div className="flex items-center justify-between gap-4">
        <dt className="text-muted-foreground">{t("clients.upsert.fields.currency.label")}</dt>
        <dd className="font-mono font-medium tabular-nums text-foreground">{currency || fallback}</dd>
      </div>
      <div className="flex items-center justify-between gap-4">
        <dt className="text-muted-foreground">{t("clients.upsert.fields.contactEmail.label")}</dt>
        <dd className="font-medium text-foreground">{contactEmail || fallback}</dd>
      </div>
    </dl>
  )
}

export function ClientUpsert({ client, open, onOpenChange, onCreate }: ClientUpsertProps) {
  const { t } = useTranslation()
  const isEditing = !!client
  const queryClient = useQueryClient()
  const [portalAccessOpen, setPortalAccessOpen] = useState(false)
  // See `SteppedDialog`'s own `onSubmit` prop comment further down — the escape hatch that lets the
  // last line of defense below jump to whichever step actually shows the field it just rejected.
  const dialogRef = useRef<SteppedDialogHandle>(null)

  // Country → `language` suggestion (see `country-default-language.ts` and the effect that reads
  // it, further down). A plain ref, not state: it must never itself trigger a re-render, only
  // stand as a permanent "the user already decided" latch once the language field is touched by
  // hand — the same shape `requiredIdentifiersRef` below uses for the same reason. `languageAutoFilled`
  // IS state, since it drives whether the "this is a suggestion" hint renders.
  const languageTouchedRef = useRef(false)
  const [languageAutoFilled, setLanguageAutoFilled] = useState(false)
  const resetLanguageSuggestionState = () => {
    languageTouchedRef.current = false
    setLanguageAutoFilled(false)
  }

  const saveErrorMessage = t("clients.upsert.messages.saveError", "Failed to save client")
  const { trigger: createClient, loading: createLoading } = useMutationWithToast(
    usePost("/api/clients"),
    saveErrorMessage,
  )
  const { trigger: updateClient, loading: updateLoading } = useMutationWithToast(
    usePatch(`/api/clients/${client?.id}`),
    saveErrorMessage,
  )

  // The country's own required-identifiers list (+ a GOVERNMENT client's B2G additions) and the
  // values already on file, mirrored into REFS rather than read directly by the schema below: both
  // depend on `form.watch(...)`, which needs `form` to exist first, but `useForm`'s own resolver
  // needs the schema built BEFORE that. A ref sidesteps the chicken-and-egg — its `.current` is
  // reassigned every render (see the two assignments further down) and `clientSchema`'s superRefine
  // only ever reads it at VALIDATION time (a later `form.trigger()` call), by which point the most
  // recent render has already committed. Kept as plain refs (not `useMemo`d state) on purpose: a
  // reassignment must never itself trigger a re-render, only observing user input should.
  const requiredIdentifiersRef = useRef<IdentifierRequirement[]>([])
  const originalIdentifierValuesRef = useRef<Map<string, string>>(new Map())

  // The validation rules used to be built inline here; now extracted to `client-schema.ts` so the
  // CSV import's per-row validation (`csv-import/client-rows.ts`) calls the exact same builder
  // instead of a hand-copied twin that could silently drift. Behavior is unchanged (same fields,
  // same superRefine rules, same messages) - see `client-upsert.spec.tsx`, still green.
  const clientSchema = buildClientSchema(
    t,
    requiredIdentifiersRef.current,
    originalIdentifierValuesRef.current,
  )

  const form = useForm<z.infer<typeof clientSchema>>({
    resolver: zodResolver(clientSchema),
    defaultValues: {
      type: "COMPANY",
      kind: "BUSINESS",
      isSupplier: false,
      name: "",
      description: "",
      currency: null,
      foundedAt: new Date(),
      contactFirstname: "",
      contactLastname: "",
      contactPhone: "",
      contactEmail: "",
      address: "",
      addressLine2: "",
      postalCode: "",
      city: "",
      state: "",
      country: "",
      countryCode: "",
      language: null,
      identifiers: [],
      peppolSchemeId: "0088",
      peppolEndpointId: "",
      customFields: {},
    },
  })

  // watch the selected client type to conditionally render company-specific fields
  const clientType = form.watch("type")

  useEffect(() => {
    // Every reset below opens a fresh wizard session — the "has the user touched language by
    // hand yet" latch belongs to THIS session only (an editing session never sets it in the first
    // place, see the suggestion effect's own `isEditing` guard, but a stale `true` surviving from a
    // PREVIOUS create session on the same mounted dialog must not silently block the next one).
    languageTouchedRef.current = false
    setLanguageAutoFilled(false)
    if (isEditing && client) {
      // Parse Peppol endpoint from partyIdentifiers (format: 'schemeId:value')
      const peppolEntry = (client.partyIdentifiers || []).find((pi) => pi.scheme === "PEPPOL_ENDPOINT")
      const peppolRaw: string = peppolEntry?.value || ""
      const colonIdx = peppolRaw.indexOf(":")
      const parsedPeppolSchemeId = colonIdx >= 0 ? peppolRaw.slice(0, colonIdx) : "0088"
      const parsedPeppolEndpointId = colonIdx >= 0 ? peppolRaw.slice(colonIdx + 1) : ""
      form.reset({
        type: client.type || "COMPANY",
        kind: client.kind || "BUSINESS",
        isSupplier: client.isSupplier ?? false,
        name: client.name || "",
        description: client.description || "",
        currency: client.currency || null,
        // The founding day as STORED, read off its own leading day rather than reconstructed from
        // the instant in this browser's timezone -- see `lib/calendar-date.ts`.
        foundedAt: fromCalendarDate(client.foundedAt) ?? undefined,
        contactFirstname: client.contactFirstname || "",
        contactLastname: client.contactLastname || "",
        contactPhone: client.contactPhone || "",
        contactEmail: client.contactEmail || "",
        address: client.address || "",
        addressLine2: client.addressLine2 || "",
        postalCode: client.postalCode || "",
        city: client.city || "",
        state: client.state || "",
        country: client.country || "",
        countryCode: client.countryCode || "",
        language: client.language ?? null,
        identifiers: (client.partyIdentifiers || [])
          .filter((pi) => pi.scheme !== "PEPPOL_ENDPOINT")
          .map((pi) => ({ scheme: pi.scheme, value: pi.value })),
        peppolSchemeId: parsedPeppolSchemeId,
        peppolEndpointId: parsedPeppolEndpointId,
        customFields: client.customFields ?? {},
      })
    } else if (!isEditing) {
      form.reset({
        type: "COMPANY",
        kind: "BUSINESS",
        isSupplier: false,
        name: "",
        description: "",
        currency: null,
        foundedAt: undefined,
        contactFirstname: "",
        contactLastname: "",
        contactPhone: "",
        contactEmail: "",
        address: "",
        addressLine2: "",
        postalCode: "",
        city: "",
        state: "",
        country: "",
        countryCode: "",
        language: null,
        identifiers: [],
        peppolSchemeId: "0088",
        peppolEndpointId: "",
        customFields: {},
      })
    }
  }, [client, isEditing, form])

  const {
    lookup: onCompanyLookup,
    isLoading: companyLookupLoading,
    isAvailable: canLookupCompany,
    schemes: lookupSchemes,
    identifierLabel: lookupIdentifierLabel,
  } = useCompanyLookup(form, {
    countryCode: form.watch("countryCode"),
    messages: {
      invalid: t("clients.upsert.messages.lookupInvalid"),
      notFound: t("clients.upsert.messages.lookupNotFound"),
      success: t("clients.upsert.messages.lookupSuccess"),
      error: t("clients.upsert.messages.lookupError"),
      unavailable: t("clients.upsert.messages.lookupUnavailable"),
    },
  })
  useCountryToCurrency(form)

  const countryCodeValue = form.watch("countryCode")

  // Owner decision: `Client.language` is pre-filled from the country ONLY at creation, and ONLY
  // until the user picks one themselves — never guessed again later, and never touched at all while
  // editing an existing client (see `country-default-language.ts`'s header and `Client.language`'s
  // own schema comment for why guessing this at SEND time was rejected outright). Re-runs on every
  // country change while untouched — including clearing a now-stale earlier suggestion back to
  // "Automatic" when the newly picked country has none of its own researched default.
  useEffect(() => {
    if (isEditing) return
    if (languageTouchedRef.current) return
    const suggestion = getDefaultLanguageForCountry(countryCodeValue)
    form.setValue("language", suggestion ?? null)
    setLanguageAutoFilled(!!suggestion)
  }, [countryCodeValue, isEditing, form])

  const clientTypeWatch = form.watch("type")
  const clientKindWatch = form.watch("kind")
  const isGovernment = clientKindWatch === "GOVERNMENT"
  const { data: requiredIdentifiersResult } = useRequiredIdentifiers(
    countryCodeValue || undefined,
    clientTypeWatch === "INDIVIDUAL" ? "INDIVIDUAL" : "COMPANY",
  )
  // B2G routing (documents/b2g-routing/) — asked for ONLY when this client is GOVERNMENT. `null`
  // (not an error) means no B2G rule is declared for this country yet — rendered as HELP on the
  // Fiscalité step (an invoice to this client will refuse at send time — never a silent B2B send —
  // but the client itself can still be saved).
  const { data: b2gRule, isLoading: b2gRuleLoading } = useB2gRoutingRule(
    countryCodeValue || undefined,
    isGovernment,
  )

  // The country's OWN identifier requirements (every client of that country, regardless of kind)
  // PLUS whatever the B2G rule additionally requires of a GOVERNMENT client specifically (e.g. Italy's
  // Codice Univoco Ufficio) — merged into ONE list so the Fiscalité step's "country-specific
  // identifiers" section (and its own sync effect / schema check above) needs no separate B2G-only
  // code path. A scheme already required by the country's own catalog is never duplicated. Stays
  // `undefined` while the country-identifiers query itself hasn't resolved yet — same "no data yet"
  // shape the rest of this form already relies on (the sync effect below short-circuits on it).
  const requiredIdentifiers = (() => {
    const base = requiredIdentifiersResult?.requirements
    if (!base) return base
    if (!isGovernment || !b2gRule?.requiredClientIdentifiers?.length) return base
    const known = new Set(base.map((r) => r.scheme))
    const extra = b2gRule.requiredClientIdentifiers
      .filter((r) => !known.has(r.scheme))
      .map((r) => ({
        scheme: r.scheme,
        label: r.label,
        appliesTo: "BOTH" as const,
        required: true,
        // A B2G-only requirement carries no `pattern` of its own — a scheme the country's own
        // catalog also declares (and DOES have one for) is filtered out of `extra` above already.
        pattern: undefined,
        helpText: r.why,
      }))
    return [...base, ...extra]
  })()
  // Present only when the country has NO identifier-requirements file at all — see
  // use-required-identifiers.ts's own RequiredIdentifiersResult. Surfaced instead of a silently
  // empty section, so "this country requires nothing" and "we don't know what this country
  // requires" never look identical to the user. Never shown once the B2G rule itself already added a
  // requirement — that section renders as usual instead, the reason has nothing left to explain.
  const requiredIdentifiersReason = requiredIdentifiers?.length
    ? undefined
    : requiredIdentifiersResult?.reason

  // What was actually on file when this form opened, keyed by scheme — the client-side twin of the
  // server's own "an unchanged value is never re-validated" rule (country-identifiers/
  // validate-identifier-value.ts): a legacy value that predates a pattern must not suddenly block
  // saving an UNRELATED field. Empty for a brand-new client, where every entry is "new" either way.
  const originalIdentifierValues = new Map(
    (client?.partyIdentifiers || []).map((pi) => [pi.scheme, pi.value]),
  )

  // Reassigned every render, read only at validation time — see the refs' own declaration comment.
  requiredIdentifiersRef.current = requiredIdentifiers ?? []
  originalIdentifierValuesRef.current = originalIdentifierValues

  // Sync identifier fields with what the country (+ B2G rule, for a government client) requires
  useEffect(() => {
    if (!requiredIdentifiers) return
    const requiredSchemes = new Set(requiredIdentifiers.map((r) => r.scheme))
    const current: { scheme: string; value: string }[] = form.getValues("identifiers") || []
    const formSchemes = new Set(current.map((i) => i.scheme))
    const next = [...current]
    let changed = false
    for (const scheme of requiredSchemes) {
      if (!formSchemes.has(scheme)) {
        next.push({ scheme, value: "" })
        changed = true
      }
    }
    for (let i = next.length - 1; i >= 0; i--) {
      if (next[i].scheme && !requiredSchemes.has(next[i].scheme)) {
        next.splice(i, 1)
        changed = true
      }
    }
    if (changed) {
      form.setValue("identifiers", next)
    }
  }, [requiredIdentifiers, form])

  // The backend owns the per-country format rules; the button only needs a value.
  const canLookupScheme = (scheme: string) => canLookupCompany && lookupSchemes.includes(scheme as never)

  const onSubmit = (data: z.infer<typeof clientSchema>) => {
    const trigger = isEditing ? updateClient : createClient

    // Merge Peppol endpoint into identifiers (stored as PEPPOL_ENDPOINT party identifier)
    const peppolEntry =
      data.peppolSchemeId && data.peppolEndpointId?.trim()
        ? { scheme: "PEPPOL_ENDPOINT", value: `${data.peppolSchemeId}:${data.peppolEndpointId.trim()}` }
        : null
    const { peppolSchemeId: _ps, peppolEndpointId: _pe, ...dataWithoutPeppol } = data
    // Filter out empty identifiers so we don't send {scheme, value: ""}
    const payload = {
      ...dataWithoutPeppol,
      // A founding date is a CALENDAR DAY (`lib/calendar-date.ts`). Left as a `Date`, `JSON.stringify`
      // would serialize it through `toISOString()` and store the PREVIOUS day for every timezone east
      // of Greenwich -- the same shift that moved a document's legal date. Sent as the UTC instant
      // naming the picked day rather than a bare day because this lands straight in a Prisma
      // `DateTime` column, which refuses a bare calendar date.
      foundedAt: toCalendarDateInstant(data.foundedAt),
      identifiers: [
        ...(data.identifiers || []).filter((i) => i.value.trim() !== ""),
        ...(peppolEntry ? [peppolEntry] : []),
      ],
    }

    trigger(payload).then((createdClient) => {
      if (!createdClient) return
      queryClient.invalidateQueries({ queryKey: queryKeys.clients.listsAll() })
      if (!isEditing && onCreate) {
        onCreate(createdClient)
      }
      onOpenChange(false)
      form.reset()
      // `client`/`isEditing` don't themselves change across a create→create run (the prop stays
      // `null` both times), so the reset effect above never re-fires on its own — without this, a
      // language touched by hand for THIS client would wrongly suppress the suggestion for the
      // NEXT one opened in the same mounted dialog.
      resetLanguageSuggestionState()
    })
  }

  // The identifier VALUE paths currently on the form, added alongside the "identifiers" root below so
  // the Fiscalité step's own "Continue" validates both the array as a whole AND each row directly —
  // belt-and-suspenders against however react-hook-form's schema-resolver happens to propagate a
  // nested array error up to a `trigger(['identifiers'])` call.
  const identifierValuePaths = ((form.watch("identifiers") as { scheme: string }[]) || []).map(
    (_, i) => `identifiers.${i}.value`,
  )

  /**
   * The wizard's own step split (`components/ui/stepped-dialog.tsx`, the shape every "big" dialog in
   * this app now takes). Unlike `document-create-dialog.tsx`'s split (derived from a runtime
   * descriptor), a client's fields are fixed and few enough to assign by hand, so this is the one
   * place that decision lives — see `IdentityStep`/`AddressStep`/`FiscalStep`/`ContactStep`'s own
   * headers for the per-step rationale. `fields` below is what each step's "Continue" click
   * validates (`form.trigger(...)`); the Summary step's stays empty on purpose (it renders nothing
   * that could show an inline error) — everything it recaps was already checked on the step that
   * owns it, and the backend remains the final gate for the rare "went back, broke it, jumped ahead
   * via a header chip" case that per-step validation cannot see (see the schema's own superRefine
   * comment).
   */
  const steps: SteppedDialogStep[] = [
    {
      id: "identity",
      label: t("clients.upsert.stepped.steps.identity", "Identity"),
      fields: ["type", "name", "contactFirstname", "contactLastname", "description", "foundedAt"],
      render: () => (
        <IdentityStep form={form as unknown as UseFormReturn<FieldValues>} clientType={clientType} />
      ),
    },
    {
      id: "address",
      label: t("clients.upsert.stepped.steps.address", "Address"),
      fields: ["country", "address", "addressLine2", "postalCode", "city", "state"],
      render: () => <AddressStep form={form as unknown as UseFormReturn<FieldValues>} />,
    },
    {
      id: "fiscal",
      label: t("clients.upsert.stepped.steps.fiscal", "Tax & identifiers"),
      fields: [
        "kind",
        "currency",
        "identifiers",
        ...identifierValuePaths,
        "peppolSchemeId",
        "peppolEndpointId",
      ],
      render: () => (
        <FiscalStep
          form={form as unknown as UseFormReturn<FieldValues>}
          isGovernment={isGovernment}
          b2gRule={b2gRule}
          b2gRuleLoading={b2gRuleLoading}
          requiredIdentifiers={requiredIdentifiers}
          requiredIdentifiersReason={requiredIdentifiersReason}
          canLookupScheme={canLookupScheme}
          onCompanyLookup={onCompanyLookup}
          companyLookupLoading={companyLookupLoading}
          lookupIdentifierLabel={lookupIdentifierLabel}
        />
      ),
    },
    {
      id: "contact",
      label: t("clients.upsert.stepped.steps.contact", "Contact & portal"),
      fields: ["contactEmail", "contactPhone", "language"],
      render: () => (
        <ContactStep
          form={form as unknown as UseFormReturn<FieldValues>}
          isEditing={isEditing}
          clientId={client?.id}
          onOpenPortalAccess={() => setPortalAccessOpen(true)}
          languageSuggested={languageAutoFilled}
          onLanguageManuallyChanged={() => {
            languageTouchedRef.current = true
            setLanguageAutoFilled(false)
          }}
        />
      ),
    },
    {
      id: "recap",
      label: t("clients.upsert.stepped.steps.recap", "Summary"),
      fields: [],
      render: () => (
        <RecapStep
          form={form as unknown as UseFormReturn<FieldValues>}
          isGovernment={isGovernment}
          requiredIdentifiers={requiredIdentifiers}
        />
      ),
    },
  ]

  return (
    <>
      <SteppedDialog
        ref={dialogRef}
        steps={steps}
        // Concretely typed on this form (unlike document-create-dialog.tsx's runtime-built one) — the
        // widening cast is the one `stepped-dialog.spec.tsx`'s own harness already documents as the
        // TEST-only stand-in for dynamism; here it is what lets this static schema fit a component
        // whose `fields: string[]` is deliberately not `Path<TFieldValues>[]` (see that prop's own
        // comment) — a real, non-test need for the same cast.
        form={form as unknown as UseFormReturn<FieldValues>}
        // `SteppedDialog` hands the LAST step's "Continue" click `form.getValues()` directly — never
        // through `form.handleSubmit`, which is what normally runs the zodResolver and hands `onSubmit`
        // the SCHEMA-COERCED values instead of the form's raw internal state. This form has no
        // `z.coerce`/`.transform()` field today (no numeric inputs, unlike a document's line items),
        // so in practice the two are identical — but re-parsing here is what keeps that true if a
        // coercing field is ever added, rather than relying on every future field author to remember
        // this component's own submit path skips the resolver. `safeParse`, not `parse`: `SteppedDialog`
        // itself already re-validates the WHOLE form (its own `handleContinue`) before ever calling
        // this, so `!parsed.success` below should be unreachable in practice — this is the LAST line
        // of defense, not the primary one, for however a future divergence between this schema and the
        // form's own resolver could still let a stale invalid value through. Never post it anyway: an
        // invalid payload sent to the backend used to fail with a generic toast and no indication of
        // which of the 5 steps was at fault (the Summary step that got the user here renders nothing
        // that could show an inline error) — attach the issues to their fields and jump back to the
        // first one instead, exactly like `article-upsert.tsx`'s own last-line-of-defense does.
        onSubmit={(values) => {
          const parsed = clientSchema.safeParse(values)
          if (!parsed.success) {
            let firstErrorField: string | undefined
            for (const issue of parsed.error.issues) {
              const key = issue.path[0]
              if (typeof key !== "string") continue
              form.setError(key as never, { type: "manual", message: issue.message })
              firstErrorField ??= key
            }
            if (firstErrorField) {
              const stepIndex = stepForField(steps, firstErrorField)
              if (stepIndex !== undefined) dialogRef.current?.goToStep(stepIndex)
            }
            toast.error(t("clients.upsert.messages.validationError"))
            return
          }
          onSubmit(parsed.data)
        }}
        submitLabel={isEditing ? t("clients.upsert.actions.save") : t("clients.upsert.actions.create")}
        open={open}
        onOpenChange={(next) => {
          // A safety reset on every CLOSE (never on open, guarded by `!next`) — `SteppedDialog` itself
          // only calls this once it has decided closing is fine (not dirty, or the user confirmed
          // discarding), so by the time this runs there is nothing left to protect.
          if (!next) {
            form.reset()
            resetLanguageSuggestionState()
          }
          onOpenChange(next)
        }}
        title={t(`clients.upsert.title.${isEditing ? "edit" : "create"}`)}
        submitting={createLoading || updateLoading}
        dataCy="client-dialog"
        submitDataCy="client-submit"
        // An editing client's values are already valid (they came from a saved record) — every step
        // opens clickable from the start, rather than gating step 2+ behind walking forward once
        // first the way a brand-new create run must.
        initialMaxReached={isEditing ? steps.length - 1 : 0}
      />

      <ClientPortalAccessDialog
        client={portalAccessOpen ? (client ?? null) : null}
        onOpenChange={(nextOpen) => setPortalAccessOpen(nextOpen)}
      />
    </>
  )
}
