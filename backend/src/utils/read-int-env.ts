/** An integer setting read from the environment, exactly as `parseInt(process.env[name] ?? fallback, 10)`:
 *  an unset variable takes the fallback; an empty or malformed one is not validated here. */
export function readIntEnv(name: string, fallback: number): number {
  return parseInt(process.env[name] ?? `${fallback}`, 10);
}
