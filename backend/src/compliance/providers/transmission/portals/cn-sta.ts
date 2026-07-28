/**
 * China — STA Golden Tax IV (e-Fapiao) — Asia-Pacific.
 *
 * Portal id `cn-sta`, driven by the shared generic-portal factory; the region's
 * response heuristics live next to the list that assembles these specs.
 */
import { GenericPortalSpec } from '../generic-portal';

export const CN_STA_PORTAL: GenericPortalSpec = {
  id: 'cn-sta',
  label: 'China STA (Golden Tax IV — 全面数字化电子发票)',
  artifact: 'CN_EFAPIAO',
  baseUrls: {
    // China Golden Tax IV portal (STA / 国家税务总局)
    test: 'https://test.invoice.chinatax.gov.cn/api/v4',
    prod: 'https://invoice.chinatax.gov.cn/api/v4',
  },
  authHint: 'STA Tax Control Device (税控设备) serial + enterprise key (数字证书)',
  submitEndpoint: '/fapiao/issue',
  pollEndpoint: '/fapiao/query',
  configFields: [
    {
      type: 'select',
      name: 'environment',
      label: 'STA environment',
      required: true,
      options: [
        { label: 'Test', value: 'test' },
        { label: 'Production', value: 'prod' },
      ],
      default: 'test',
    },
    {
      type: 'text',
      name: 'apiToken',
      label: 'STA session token (from Tax Control Device)',
      required: true,
      secret: true,
    },
    { type: 'text', name: 'nsrsbh', label: 'NSRSBH (纳税人识别号, 18 chars)', required: true },
  ],
  isAsync: true,
};
