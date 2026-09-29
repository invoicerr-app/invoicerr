---
sidebar_position: 6.7
---

# Operators and channels

A **legal channel** (`pdp`, `sdi`, `ksef`, `chorus-pro`, `pt-at`, …) is a small, closed idea: which
transmission model a country's law recognises. Which **company** a user can actually connect to for
that channel is a different, open-ended question - ten French "plateformes agréées" are not ten
channels, they are ten **operators** all implementing the same `pdp` channel, told apart only by
their own `baseUrl` and credentials. Neither `transports/channel-policy/` (does a country mandate a
channel) nor `transports/transport-registry.ts` (which channel this codebase actually talks to)
answers "which operator" - the **operator catalogue**
(`backend/src/modules/documents/operators/`) is that missing layer.

This page covers two things added together (issue #526): the operator catalogue itself, and a
transport's own declaration of the credential fields its connect form needs. That second part is a
related but separate scope addition folded into the same change, replacing a second, hand-maintained
copy of the same shape that used to live only in the frontend.

## The operator catalogue

One file per **operator**, `operators/data/<id>.json`, discovered the same auto-discovery way
`channel-policy/` and `b2g-routing/` discover per-country files, but keyed on operator id instead,
since an operator is not naturally one country's own. Each entry:

```ts
interface OperatorFact {
  id: string;                    // unique, lowercase, kebab-case: must match the file's own name
  name: string;                  // display name
  provenance: PolicyProvenance;  // "this named entity exists, at this domain, as described"
  offerings: OperatorOffering[]; // never empty, see below
  notes?: string;
}

interface OperatorOffering {
  legalChannel: string;      // "pdp" | "sdi" | "ksef" | "chorus-pro" | "pt-at" | "peppol" | ... (not a closed enum)
  countries: string[];       // ISO 3166-1 alpha-2: where THIS offering is registered/relevant
  transportId?: string;      // a transport-registry.ts id, only once this codebase has actually wired one
  baseUrl?: { sandbox?: string; production?: string }; // only for a multi-operator transport, see below
  capabilities: { emit: boolean; receive: boolean; lifecycleStatuses: boolean; eReporting: boolean };
  sandbox: { available: boolean; notes?: string };
  provenance: PolicyProvenance;  // this OFFERING's own claim, independent of the entity's
  notes?: string;
}
```

**One operator, many offerings.** An operator is a single business entity that can implement more
than one legal channel, in more than one country, at once: A-Cube is an Italian SdI intermediary
*and* a Peppol access point; Billit is a French PDP operator *and* a Belgian Peppol access point.
Each offering carries its own `countries`, `transportId`, `capabilities` and, importantly, its own
`provenance`: the same operator can be `legal` (sourced, checked) on one offering and `unverified`
on another, since each claim was researched independently. The entity's own top-level `provenance`
is a narrower claim than either, "this named operator exists, as described", never a summary of its
offerings.

**Provenance is mandatory**, the same discipline every sibling catalogue enforces at load time
(`assertValidOperatorFact` in `operators/schema.ts`): `kind: 'legal'` needs a verbatim `sourceText`
and a `sourceCheckedAt` date; `kind: 'unverified'` needs a `resolutionNote` saying what would settle
it. There is no third option, and a fact with none fails to load.

### Adding an operator

1. Pick a lowercase, kebab-case `id`. It must match the file's own name, `data/<id>.json`.
2. Write the entity's own `provenance`: does this named operator genuinely exist, at the domain
   you're about to cite.
3. Add one `OperatorOffering` per legal channel it implements, each sourced on its own: read the
   operator's own site or docs (or, when this codebase has actually proven an integration live,
   that proof) rather than assuming a claim researched for one channel carries over to another.
4. Set `transportId` only once `transports/transport-registry.ts` actually has a transport wired
   for that offering. An offering this codebase does not talk to yet is still worth cataloguing,
   with `transportId` simply omitted.
5. Set `baseUrl` only when the offering is reached through a **generic, multi-operator** transport
   (today: only `pdp`, see the disambiguation rule below). An offering with its own dedicated
   transport id (`acube`, `billit`, `iopole`, `invopop`, `chorus-pro`, `ksef`, `sdi`) needs none.
6. Restart the backend (or the test suite). There is no array to register the new file in.

### Resolving a company's connection back to an operator

`OperatorCatalog.resolveForTransportConfig` (`operators/registry.ts`) answers "which operator did
this company actually connect to", server-side, for `GET /api/company/channels`'s own
`operatorId` field:

- A transport with exactly **one** catalogued offering resolves unconditionally, without ever
  reading the company's own `config`. The common case costs nothing extra.
- A transport with **more than one** offering (only ever `pdp` today, since every other credentialed
  operator has its own dedicated transport id) matches the connected `baseUrl` against each
  candidate's own `sandbox`/`production` host. No match resolves to `null`, never a guess.
- Multiple offerings of the **same** operator sharing one transport id are deduped rather than
  treated as ambiguous: connecting once grants every one of that operator's capabilities on that
  transport at once. Real disambiguation-by-`baseUrl` is reserved for genuinely **distinct**
  operators sharing a transport id.

### The API

- `GET /api/documents/operators` (optional `?channel=<legalChannel>`) - every operator, or narrowed
  to one legal channel; a channel-filtered entry's own `offerings` are trimmed to just that channel.
- `GET /api/documents/transports` - each transport's shape, now also carrying its
  `credentialFields` (below).
- `GET /api/company/channels` - each connected channel's row now also carries `operatorId: string |
  null`, resolved as described above. A `GET` never decrypts more of `config` than resolving that id
  genuinely requires.

## A transport's own credential fields

Before this, the exact form fields a channel's connect screen collects were hard-coded,
independently, in the frontend's own `PROVIDER_FIELDS` map (`channels.settings.tsx`): a second copy
of the same shape each transport's own credential parser already encoded, free to drift from it
silently. `DocumentTransport` (`transports/transport-registry.ts`) now carries that declaration
itself:

```ts
interface CredentialFieldDescriptor {
  key: string;                          // the key this field is stored under in the encrypted config blob
  kind: 'text' | 'secret';              // UI masking only: "secret" never echoes the stored value back
  valueType: 'string' | 'number' | 'boolean';
  required: boolean;                    // mirrors the parser's own refusal on a missing value
  placeholder?: string;
  labelKey: string;                     // an i18n key, never a hardcoded label
  learnedByBackend?: boolean;           // see below
}
```

A transport declares `credentialFields` alongside `parseCredentials`, the **same** function its own
`preflight()`/`send()` already calls to turn a resolved config into typed credentials, wired onto the
registry entry only so it can be checked, never called from anywhere else.

**Checked at boot, not just at review time.** `validateTransportCredentialFields`
(`transport-registry.ts`), run right after `buildTransportRegistry` assembles the real registry
(`documents-core.module.ts`), builds a synthetic, fully-populated dummy config from each transport's
own declared fields and runs the real parser against it. It throws, crashing boot, the same
discipline `descriptors/lifecycle.ts#validateLifecycle` already holds, if the parser reads a key
`credentialFields` never declared (too narrow), or the declaration lists a key the parser never
reads (too wide). A declaration and its parser can never drift apart silently again.

**`learnedByBackend: true`** marks a field the parser reads from `config` but that a human never
types: populated by the backend itself after the platform's own reply (for example `sdi-pec`'s
`sdiReplyAddress`, learned from SdI's first response). It still has to be declared, so the boot
check can confirm the parser's read of it is accounted for, but a connect form should never render
an input for it.

**Building a connect form**: read `credentialFields` from `GET /api/documents/transports` per
provider id, build that provider's form fields from it, skip any field carrying `learnedByBackend`,
and never hard-code a second copy. The backend is the single source of truth for what a connect
form collects.

## See also

- [Adding a country](./adding-a-country.md) - the same per-file, provenance-first discipline, one
  axis over (country, not operator).
- [E-Invoicing Credentials Guide](./credentials-guide.md) - how to actually obtain the values a
  transport's `credentialFields` ask for, platform by platform.
