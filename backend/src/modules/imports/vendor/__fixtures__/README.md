# Synthetic vendor export fixtures

These files are **not captured from a real Abby, Henrri or Tiime account**. They reproduce the
column names and value shapes that each vendor publishes in its own help centre (links in
`../vendor-export-profiles.ts`), so the reader and the pull request tests have a stable input.

Before claiming a real migration works, replace each file with an anonymised export from a free
account and run the same specs. Two limits are already known and documented rather than guessed:

- Abby exports invoices as a PDF archive only, so there is no `abby-invoices.csv`.
- Henrri and Tiime do not publish their invoice column list; their profiles accept the semantic
  fields their help pages describe (`Numéro`, `Date`, `Client`, `Montant HT/TVA/TTC`) and wide
  header aliases, but a real export is still the only proof.

Every name, address, amount and identifier below is invented.
