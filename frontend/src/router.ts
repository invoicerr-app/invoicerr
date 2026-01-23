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
  | `/payment-methods`
  | `/quotes`
  | `/receipts`
  | `/settings/:tab?`
  | `/signature/:id`
  | `/stats`

export type Params = {
  '/settings/:tab?': { tab?: string }
  '/signature/:id': { id: string }
}

export type ModalPath = never

export const { Link, Navigate } = components<Path, Params>()
export const { useModals, useNavigate, useParams } = hooks<Path, Params, ModalPath>()
export const { redirect } = utils<Path, Params>()
