/**
 * APP_URL is the address the browser uses, so its scheme decides whether session cookies can be
 * `Secure`: a browser drops a `Secure` cookie received over plain http.
 */
export function servedOverHttps(appUrl: string): boolean {
  return /^https:\/\//i.test(appUrl.trim());
}

const LOOPBACK_HOSTS = /^(localhost|127(\.\d{1,3}){3}|\[::1\])$/i;

function isLoopback(appUrl: string): boolean {
  try {
    return LOOPBACK_HOSTS.test(new URL(appUrl).hostname);
  } catch {
    return false;
  }
}

/** The boot warning for an instance whose sessions travel unencrypted, or null when they do not. */
export function insecureAppUrlWarning(appUrl: string | undefined): string | null {
  const value = appUrl?.trim();
  if (!value) {
    return (
      'APP_URL is not set: sessions fall back to http://localhost:3000 with cookies that are not secure. ' +
      'Set APP_URL to the address users open, preferably https://.'
    );
  }
  if (servedOverHttps(value) || isLoopback(value)) return null;
  return (
    `APP_URL is ${value}: session cookies are not secure and travel unencrypted on the network. ` +
    'Serve Invoicerr over https:// (behind a reverse proxy) and set APP_URL to that address.'
  );
}
