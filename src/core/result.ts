/**
 * Result<T, E> — explicit fallible-operation type so host calls and parsers
 * surface failure instead of throwing-and-swallowing (the legacy `catch(e){}`
 * anti-pattern that made "nothing happened" bugs undebuggable).
 */
export type Result<T, E = string> =
  | { ok: true; value: T }
  | { ok: false; error: E };

export const Ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const Err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export function isOk<T, E>(r: Result<T, E>): r is { ok: true; value: T } {
  return r.ok;
}

/** Map the success value, passing errors through untouched. */
export function mapResult<T, U, E>(r: Result<T, E>, fn: (v: T) => U): Result<U, E> {
  return r.ok ? Ok(fn(r.value)) : r;
}

/** Run a throwing fn and capture any throw as an Err with a string message. */
export function tryCatch<T>(fn: () => T): Result<T, string> {
  try {
    return Ok(fn());
  } catch (e) {
    return Err(e instanceof Error ? e.message : String(e));
  }
}

/** Async variant of tryCatch. */
export async function tryCatchAsync<T>(fn: () => Promise<T>): Promise<Result<T, string>> {
  try {
    return Ok(await fn());
  } catch (e) {
    return Err(e instanceof Error ? e.message : String(e));
  }
}
