// Generouted, changes to this file will be overridden
/* eslint-disable */

import { components, hooks, utils } from '@generouted/react-router/client'

export type Path =
  | `/`
  | `/auth/sign-in`
  | `/auth/sign-out`
  | `/auth/sign-up`
  | `/clients`
  | `/dashboard`
  | `/invoices`
  | `/invoices/:id/corrective`
  | `/invoices/:id/credit-note`
  | `/invoices/:id/void-reissue`
  | `/payment-methods`
  | `/quotes`
  | `/receipts`
  | `/settings/:tab?`
  | `/signature/:id`
  | `/stats`

export type Params = {
  '/invoices/:id/corrective': { id: string }
  '/invoices/:id/credit-note': { id: string }
  '/invoices/:id/void-reissue': { id: string }
  '/settings/:tab?': { tab?: string }
  '/signature/:id': { id: string }
}

export type ModalPath = never

export const { Link, Navigate } = components<Path, Params>()
export const { useModals, useNavigate, useParams } = hooks<Path, Params, ModalPath>()
export const { redirect } = utils<Path, Params>()
