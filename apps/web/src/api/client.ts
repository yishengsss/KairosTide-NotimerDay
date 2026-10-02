/**
 * The only module in the app that calls `fetch`.
 *
 * Every write carries an `Idempotency-Key`, so a retry after a dropped response returns the first
 * result instead of doing the work twice. Callers that want that must pass the same key they used
 * before; `writeKey()` mints one for a fresh attempt.
 */

import { ApiError, errorFromResponse } from './errors.ts'

const BASE = '/api/v1'

/** Prefix the API lives under; the dev server proxies it to the backend. */
export const API_BASE = BASE

export type RequestOptions = {
  signal?: AbortSignal
  /** Sent as `Idempotency-Key` on writes. */
  idempotencyKey?: string
}

let fallbackCounter = 0

/** A fresh idempotency key. Prefixed so it is recognizable in logs. */
export function newIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `kairos-${crypto.randomUUID()}`
  }
  fallbackCounter += 1
  return `kairos-${Date.now().toString(36)}-${fallbackCounter}`
}

async function parse(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch {
    throw new ApiError('SERVER', '服务器返回了无法解析的内容', response.status)
  }
}

async function send(method: string, path: string, options: RequestOptions, body?: unknown): Promise<unknown> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  if (options.idempotencyKey) headers['Idempotency-Key'] = options.idempotencyKey
  let response: Response
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      ...(options.signal ? { signal: options.signal } : {}),
    })
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause
    throw new ApiError('NETWORK', '网络不可用', 0)
  }
  const payload = await parse(response)
  if (!response.ok) throw errorFromResponse(response.status, payload)
  return payload
}

export const getJson = (path: string, options: RequestOptions = {}): Promise<unknown> => send('GET', path, options)

export const postJson = (path: string, body: unknown, options: RequestOptions): Promise<unknown> =>
  send('POST', path, options, body)
