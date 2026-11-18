/**
 * Every transport's provider id, in one place.
 *
 * These strings are not labels: they are written to `DocumentAuthorityEvent.providerId` (and to a
 * document's `channelProviderId`) and read back later, by the status pollers, by the notification
 * services, by the import of an already-submitted invoice and by `formats/national/fa3-kor.ts` when it
 * looks up the KSeF number of the invoice being corrected. Each one used to be redeclared in every file
 * that needed it, so a typo or a rename in one copy would have made those lookups find nothing, with
 * no error. The values are part of stored data: never change one without a migration.
 */
export const KSEF_PROVIDER_ID = 'ksef';
export const PDP_PROVIDER_ID = 'pdp';
export const SDI_PROVIDER_ID = 'sdi';
export const SDI_PEC_PROVIDER_ID = 'sdi-pec';
export const CHORUS_PRO_PROVIDER_ID = 'chorus-pro';
export const IOPOLE_PROVIDER_ID = 'iopole';
export const ACUBE_PROVIDER_ID = 'acube';
export const BILLIT_PROVIDER_ID = 'billit';
export const INVOPOP_PROVIDER_ID = 'invopop';
