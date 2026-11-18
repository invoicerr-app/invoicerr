/**
 * The User-Agent this instance sends to third-party services that reject anonymous clients: the
 * company registries (`company-lookup/http.ts`: cvrapi.dk, SEC...) and the geocoder
 * (`address-autocomplete/photon-client.ts`, whose shared demo server has a fair-use policy).
 * One value so the two cannot drift apart. Invopop sends its own, different value
 * (`INVOPOP_USER_AGENT`), a compatibility header left untouched on purpose.
 */
export const INVOICERR_USER_AGENT = 'invoicerr/1.0 (+https://github.com/Impre-visible/invoicerr)';
