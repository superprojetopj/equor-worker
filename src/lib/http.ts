export interface FetchRetryOptions {
  retries?: number
  timeout?: number
  retryOn?: (status: number) => boolean
}

const DEFAULT_RETRY_ON = (status: number): boolean => status >= 500 || status === 429

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  { retries = 2, timeout = 60_000, retryOn = DEFAULT_RETRY_ON }: FetchRetryOptions = {}
): Promise<Response> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeout),
      })

      if (!response.ok && retryOn(response.status) && attempt < retries) {
        await response.body?.cancel()
        await sleep(200 * 2 ** attempt)
        continue
      }

      return response
    } catch (err) {
      if (attempt === retries) throw err
      await sleep(200 * 2 ** attempt)
    }
  }

  throw new Error('unreachable')
}
