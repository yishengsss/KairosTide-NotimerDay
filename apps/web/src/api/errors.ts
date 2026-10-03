/** One error type for every call, so the UI never has to know which layer failed. */

export type ApiErrorCode =
  /** The request never reached the server, or the answer was not JSON we understand. */
  | 'NETWORK'
  /** The server answered with its own `{"error": {"code", "message"}}` body. */
  | 'SERVER'
  /** The write was rejected because someone else moved the record first. */
  | 'CONFLICT'

export class ApiError extends Error {
  readonly code: ApiErrorCode
  /** The server's stable machine-readable code, when it sent one. */
  readonly serverCode: string | null
  readonly status: number
  /** Extra fields the server put next to code and message (conflict pairs, acceptance token). */
  readonly details: Readonly<Record<string, unknown>>

  constructor(code: ApiErrorCode, message: string, status: number, serverCode: string | null = null,
    details: Record<string, unknown> = {}) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.serverCode = serverCode
    this.status = status
    this.details = details
  }

  /** True when retrying the same request later could plausibly succeed. */
  get retryable(): boolean {
    return this.code === 'NETWORK' || this.status >= 500
  }
}

/** Shape of the server's uniform error body. */
type ErrorBody = { error?: { code?: unknown; message?: unknown } }

export function errorFromResponse(status: number, body: unknown): ApiError {
  const parsed = (body ?? {}) as ErrorBody
  const code = parsed.error?.code
  const message = parsed.error?.message
  const serverCode = typeof code === 'string' ? code : null
  const text = typeof message === 'string' && message ? message : `HTTP ${status}`
  const kind: ApiErrorCode = status === 409 ? 'CONFLICT' : 'SERVER'
  const details = Object.fromEntries(
    Object.entries((parsed.error ?? {}) as Record<string, unknown>).filter(([key]) => key !== 'code' && key !== 'message'),
  )
  return new ApiError(kind, text, status, serverCode, details)
}
