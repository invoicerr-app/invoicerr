import { Injectable } from '@nestjs/common';

import {
  archiveCompanyCustomField,
  createCompanyCustomField,
  listCompanyCustomFields,
  resolveClientCustomFieldDescriptors,
  resolveDocumentCustomFieldDescriptors,
  restoreCompanyCustomField,
  updateCompanyCustomField,
} from './persistence';
import {
  CompanyCustomFieldTarget,
  CompanyCustomFieldView,
  CreateCompanyCustomFieldInput,
  UpdateCompanyCustomFieldInput,
} from './types';
import { DocumentFieldDescriptor } from '../descriptors/types';

/**
 * A thin `@Injectable()` wrapper around persistence.ts's own plain functions — the same split
 * `PaymentMethodsService` draws from `payment-methods/persistence.ts`, kept purely for
 * `Controller -> Service -> Prisma` consistency with every other controller in this codebase.
 */
@Injectable()
export class CompanyCustomFieldsService {
  list(
    companyId: string,
    filter: { target?: CompanyCustomFieldTarget; documentTypeId?: string; includeArchived?: boolean },
  ): Promise<CompanyCustomFieldView[]> {
    return listCompanyCustomFields(companyId, filter);
  }

  resolved(
    companyId: string,
    target: CompanyCustomFieldTarget,
    typeId?: string,
    includeArchived = false,
  ): Promise<DocumentFieldDescriptor[]> {
    if (target === 'CLIENT') {
      return resolveClientCustomFieldDescriptors(companyId, { includeArchived });
    }
    return resolveDocumentCustomFieldDescriptors(companyId, typeId ?? '', { includeArchived });
  }

  create(companyId: string, input: CreateCompanyCustomFieldInput): Promise<CompanyCustomFieldView> {
    return createCompanyCustomField(companyId, input);
  }

  update(
    companyId: string,
    id: string,
    patch: UpdateCompanyCustomFieldInput,
  ): Promise<CompanyCustomFieldView> {
    return updateCompanyCustomField(companyId, id, patch);
  }

  archive(companyId: string, id: string): Promise<CompanyCustomFieldView> {
    return archiveCompanyCustomField(companyId, id);
  }

  restore(companyId: string, id: string): Promise<CompanyCustomFieldView> {
    return restoreCompanyCustomField(companyId, id);
  }
}
