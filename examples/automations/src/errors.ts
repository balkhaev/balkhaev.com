// src/errors.ts
/** An error that retrying will not fix: bad data, a rejected request. */
export class PermanentError extends Error {}

/** Throws a PermanentError for 4xx answers and a regular one for the rest. */
export async function check(response: Response, what: string) {
  if (response.ok) {
    return;
  }
  const text = await response.text();
  const message = `${what}: ${response.status} ${text.slice(0, 500)}`;
  // 429 means "too many requests": worth retrying later
  if (response.status >= 400 && response.status < 500 && response.status !== 429) {
    throw new PermanentError(message);
  }
  throw new Error(message);
}
