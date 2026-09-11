import type { Company } from "./company"

export enum ArticleType {
  HOUR = "HOUR",
  DAY = "DAY",
  DEPOSIT = "DEPOSIT",
  SERVICE = "SERVICE",
  PRODUCT = "PRODUCT",
}

export interface Article {
  id: string
  companyId: string
  company?: Company
  name: string
  description?: string | null
  type: ArticleType
  unitPrice: number
  vatRate: number
  isActive?: boolean
  // Basic stock management ("gestion de stock basique") — mirrors the backend's own
  // Article.quantity/lowStockThreshold (schema.prisma): null means "not stock-tracked"/"no alert".
  // `isLowStock` is a SERVER-computed fact (articles.service.ts's `isArticleLowStock`), never
  // recomputed here — this screen only ever displays it.
  quantity?: number | null
  lowStockThreshold?: number | null
  isLowStock?: boolean
  createdAt?: string
  updatedAt?: string
}
