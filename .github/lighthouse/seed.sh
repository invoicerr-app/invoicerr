#!/usr/bin/env bash
# Creates the audit account, its company, one client, one quote and one invoice through the API,
# then writes the two document ids to $GITHUB_ENV.
set -euo pipefail

api="${LH_API_URL:?}"
origin="${LH_APP_URL:?}"
jar="$(mktemp)"
trap 'rm -f "$jar"' EXIT

post() {
  local path="$1" body="$2"
  curl -fsS -H 'Content-Type: application/json' -H "Origin: ${origin}" -b "$jar" -c "$jar" -X POST "${api}${path}" -d "$body"
}

post /api/auth/sign-up/email "$(jq -n --arg e "$LH_EMAIL" --arg p "$LH_PASSWORD" \
  '{name:"John Doe",firstname:"John",lastname:"Doe",email:$e,password:$p,acceptLegal:true}')" > /dev/null
post /api/auth/sign-in/email "$(jq -n --arg e "$LH_EMAIL" --arg p "$LH_PASSWORD" '{email:$e,password:$p}')" > /dev/null

post /api/companies '{
  "name":"Acme Corp","description":"A fictional company","phone":"+33123456789","email":"contact@acme.org",
  "address":"123 Main St","city":"Paris","postalCode":"75001","country":"France","countryCode":"FR","currency":"EUR",
  "identifiers":[{"scheme":"LEGAL_ID","value":"73282932000074"},{"scheme":"VAT","value":"FR44732829320"}]
}' > /dev/null

post /api/clients '{
  "name":"Test Client","contactEmail":"test.client@example.com","currency":"EUR","country":"FR",
  "address":"123 Test St","city":"Paris","postalCode":"75001","isActive":true,"type":"COMPANY"
}' > /dev/null

client_id="$(curl -fsS -b "$jar" "$api/api/documents/references/client/search" | jq -r '.[0].id')"

draft() {
  local type="$1"
  post "/api/documents/types/${type}/actions/save-draft" "$(jq -n --arg c "$client_id" \
    '{data:{client:$c,issueDate:"2026-08-30",dueDate:"2026-09-30",currency:"EUR",
      lines:[{description:"Consulting",quantity:1,unit:"unit",unitPrice:500,vatRate:"20"}]}}')" | jq -r '.document.id'
}

{
  echo "LH_QUOTE_ID=$(draft quote)"
  echo "LH_INVOICE_ID=$(draft invoice)"
} >> "$GITHUB_ENV"
