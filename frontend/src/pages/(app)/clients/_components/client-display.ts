import type { Client } from "@/types"

/** The one name a client is shown under everywhere on these screens: an individual by their
 *  contact's first + last name, a company by its registered name. */
export function clientDisplayName(client: Client | null | undefined): string {
  if (!client) return ""
  if (client.type === "INDIVIDUAL") {
    const full = `${client.contactFirstname ?? ""} ${client.contactLastname ?? ""}`.trim()
    return full || client.name
  }
  return client.name || `${client.contactFirstname ?? ""} ${client.contactLastname ?? ""}`.trim()
}
