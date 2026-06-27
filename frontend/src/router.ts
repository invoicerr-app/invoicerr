// Generouted, changes to this file will be overridden
/* eslint-disable */

import { components, hooks, utils } from '@generouted/react-router/client'

export type Path =
  | `/`
  | `/articles`
  | `/auth/sign-in`
  | `/auth/sign-out`
  | `/auth/sign-up`
  | `/clients`
  | `/dashboard`
  | `/invoices`
  | `/invoices/pdf/:id`
  | `/payment-methods`
  | `/payments`
  | `/payments/pdf/:id`
  | `/quotes`
  | `/quotes/pdf/:id`
  | `/settings/:tab?`
  | `/signature/:id`
  | `/stats`

export type Params = {
  '/invoices/pdf/:id': { id: string }
  '/payments/pdf/:id': { id: string }
  '/quotes/pdf/:id': { id: string }
  '/settings/:tab?': { tab?: string }
  '/signature/:id': { id: string }
}

export type ModalPath = never

export const { Link, Navigate } = components<Path, Params>()
export const { useModals, useNavigate, useParams } = hooks<Path, Params, ModalPath>()
export const { redirect } = utils<Path, Params>()
