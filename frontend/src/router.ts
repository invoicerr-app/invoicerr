// Generouted, changes to this file will be overridden
/* eslint-disable */

import { components, hooks, utils } from '@generouted/react-router/client'

export type Path =
  | `/`
  | `/articles`
  | `/auth/sign-in`
  | `/auth/sign-out`
  | `/auth/sign-up`
  | `/bank-reconciliation`
  | `/clients`
  | `/dashboard`
  | `/documents`
  | `/documents/:typeId`
  | `/payment-methods`
  | `/portal`
  | `/portal/:token`
  | `/settings/:tab?`
  | `/signature/:token`
  | `/statistics`
  | `/time-tracking`

export type Params = {
  '/documents/:typeId': { typeId: string }
  '/portal/:token': { token: string }
  '/settings/:tab?': { tab?: string }
  '/signature/:token': { token: string }
}

export type ModalPath = never

export const { Link, Navigate } = components<Path, Params>()
export const { useModals, useNavigate, useParams } = hooks<Path, Params, ModalPath>()
export const { redirect } = utils<Path, Params>()
