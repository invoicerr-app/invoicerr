import {
  Coins,
  FileCheck,
  FileClock,
  FileDown,
  FileMinus,
  FilePen,
  FilePlus,
  FileText,
  type LucideIcon,
  PackageCheck,
  ReceiptText,
  ShoppingCart,
  Truck,
  Wallet,
} from "lucide-react"

import { cn } from "@/lib/utils"

/** Every icon a document type descriptor can name. One family: Lucide, one stroke, one size. */
const DOCUMENT_TYPE_ICONS: Record<string, LucideIcon> = {
  quote: FilePen,
  invoice: ReceiptText,
  "credit-note": FileMinus,
  "debit-note": FilePlus,
  "pro-forma": FileClock,
  "deposit-invoice": Coins,
  "final-invoice": FileCheck,
  "purchase-order": ShoppingCart,
  "goods-receipt": PackageCheck,
  "delivery-note": Truck,
  expense: Wallet,
  "received-invoice": FileDown,
}

export const GENERIC_DOCUMENT_ICON: LucideIcon = FileText

/** The icon for a descriptor's `icon` key; an unknown or missing key gets the generic document icon. */
export function documentTypeIcon(key: string | null | undefined): LucideIcon {
  return key && Object.hasOwn(DOCUMENT_TYPE_ICONS, key) ? DOCUMENT_TYPE_ICONS[key] : GENERIC_DOCUMENT_ICON
}

export function DocumentTypeIcon({ icon, className }: { icon?: string | null; className?: string }) {
  const Icon = documentTypeIcon(icon)
  return <Icon className={cn("size-4 shrink-0", className)} aria-hidden="true" />
}

export const DOCUMENT_TYPE_ICON_KEYS = Object.keys(DOCUMENT_TYPE_ICONS)
