/**
 * Vietnam — GDT (Tổng cục Thuế) — TT78/Decree-123 — Asia-Pacific.
 *
 * Portal id `vn-gdt`, driven by the shared generic-portal factory; the region's
 * response heuristics live next to the list that assembles these specs.
 */
import { GenericPortalSpec } from '../generic-portal';

export const VN_GDT_PORTAL: GenericPortalSpec = {
  id: 'vn-gdt',
  label: 'Vietnam GDT (Tổng cục Thuế) TT78',
  artifact: 'VN_TT78',
  baseUrls: {
    test: 'https://hoadondientu.gdt.gov.vn:30000/api/test',
    prod: 'https://hoadondientu.gdt.gov.vn:30000/api',
  },
  authHint:
    'GDT e-invoice API username + password (from tax authority registration) or service provider (SINVOICE, VNPT, etc.)',
  submitEndpoint: '/HD/hoadondientu',
  pollEndpoint: '/HD/status',
  configFields: [
    {
      type: 'select',
      name: 'environment',
      label: 'GDT environment',
      required: true,
      options: [
        { label: 'Test', value: 'test' },
        { label: 'Production', value: 'prod' },
      ],
      default: 'test',
    },
    { type: 'text', name: 'apiToken', label: 'GDT/Provider Bearer token', required: true, secret: true },
    { type: 'text', name: 'mst', label: 'MST (Mã số thuế — Tax code, 10 or 13 digits)', required: true },
  ],
  isAsync: true,
};
