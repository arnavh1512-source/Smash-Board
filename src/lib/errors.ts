export const GENERIC_ERROR = "Something went wrong. Please try again.";

/** How Convex opens a server failure: `[CONVEX M(tournaments:create)] [Request ID: 1a2b] …`. */
const SERVER_FAILURE = /^\s*(?:\[CONVEX |\[Request ID: |Server Error\b)/;

/**
 * Turn any thrown value into a message worth showing an organiser.
 *
 * Only a `ConvexError` is written for people: the server throws one on purpose,
 * and the client exposes its payload as `error.data`. Any other server failure
 * is an internal fault whose text can name configuration or code, so it becomes
 * the generic message rather than being shown.
 */
export function errorMessage(error: unknown): string {
  if (error && typeof error === "object" && "data" in error) {
    const data = (error as { data: unknown }).data;
    if (typeof data === "string" && data.trim()) return data;
  }
  if (!(error instanceof Error)) return GENERIC_ERROR;

  // A ConvexError that arrives only as text still carries its readable part.
  const convexError = error.message.match(/Uncaught ConvexError:\s*([^\n]*)/)?.[1].trim();
  if (convexError) return convexError;

  if (SERVER_FAILURE.test(error.message)) return GENERIC_ERROR;
  return error.message.split("\n")[0].trim() || GENERIC_ERROR;
}
