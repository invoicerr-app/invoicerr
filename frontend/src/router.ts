// Generouted, changes to this file will be overridden
/* eslint-disable */

import { components, hooks, utils } from '@generouted/react-router/client'

export type Path =
  | `/`
  | `/account`
  | `/account/danger`
  | `/account/preferences`
  | `/account/security`
  | `/articles`
  | `/auth/sign-in`
  | `/auth/sign-out`
  | `/auth/sign-up`
  | `/bank-reconciliation`
  | `/clients`
  | `/dashboard`
  | `/declarations`
  | `/documents`
  | `/documents/:typeId`
  | `/documents/:typeId/:id`
  | `/payment-methods`
  | `/portal`
  | `/portal/:token`
  | `/settings/:tab?`
  | `/signature/:token`
  | `/statistics`
  | `/time-tracking`

export type Params = {
  '/documents/:typeId': { typeId: string }
  '/documents/:typeId/:id': { typeId: string; id: string }
  '/portal/:token': { token: string }
  '/settings/:tab?': { tab?: string }
  '/signature/:token': { token: string }
}

export type ModalPath = never

export const { Link, Navigate } = components<Path, Params>()
export const { useModals, useNavigate, useParams } = hooks<Path, Params, ModalPath>()
export const { redirect } = utils<Path, Params>()
