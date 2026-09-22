# TODO_FEATURES — remaining engineering work

> Only what is **not done** belongs here. Everything shipped, and the reasoning behind every product
> decision, lives in `git log` — that is the record, not this file.

Nothing below is blocked on code. Each line waits on a person, an account, or an authority.

## Waiting on the owner

| Item | What is missing |
|---|---|
| **Legal drafts** | A lawyer's review. The arbitration and one-year limitation clauses were deliberately left out pending that advice. Everything else is written, translated into six languages, and named the real hosting and database provider. |
| **Hosted offering** | The Polar production organisation, its products and its endpoint. Only the sandbox is proven, end to end, including the full "customer stops paying" cycle. Also: DMARC hardening to `p=quarantine` once the reports come back clean. |
| **First real cluster deploy** | The cluster itself is being created (Scaleway Kapsule, Paris, mutualized control plane). Still needed: the object-storage bucket, the managed database, DNS for `invoicerr.app`, and the real secrets. Then the chart goes on for the first time. |

**Proof that closes the last one**: a real deploy on the cluster, `/api/health` answering, and one
invoice sent through it.

## Waiting on an authority or a credential

No amount of development moves these. Each is gated by something only an external party issues.

| Item | What is missing, and what it would settle |
|---|---|
| **French inbound e-invoicing** | Reception through the accredited platform is wired and proven in the sandbox; nothing is left to build. Two points need a production platform: the buyer lifecycle status endpoint answers a generic 404 on the free sandbox, and the numeric code of a buyer refusal is a best-effort reading rather than a sourced one. |
| **French e-reporting calendar** | Two facts stay marked unverified because the decree cannot be read as raw text from here. Re-probed on 2026-09-19: the official legal database refuses a plain request outright, and the tax administration's doctrine site serves only a page shell carrying none of the text. **There is a way through and it needs no new account** — the credentials already obtained for the French business-to-government channel also gate an official API that returns article text as data; an application has to be subscribed to it. |
| **Portuguese nonce padding** | The authority's manual says "RSA" without naming a padding. The most defensible reading was chosen; only a real round-trip settles it, and a wrong choice fails loudly with a specific response code, so the risk is bounded. |
| **Polish status polling** | Never proven live for want of an authentication token. Two points stay unverified: how the response maps to a terminal or rejected state, and whether the endpoint still answers once the sending session has closed. The sending channel itself is proven live. |
| **Polish production key** | Only the test environment's vendored key has ever existed here. The loader fails loudly rather than falling back to a test key against a production authority — deliberately. Needs a real Polish company. |
