/**
 * dsh-opencode-go-usage — Host half.
 *
 * Serves one read-only JSON endpoint, `GET /opencode-go-usage/status`, that
 * reports the OpenCode Go plan exactly as opencode.ai returns it:
 *
 *   - three quota windows: rolling 5 hours, the week, the month;
 *   - the subscription period (when it ends, whether it is cancelled);
 *   - usage totals for a selectable range (cost, requests, tokens);
 *   - a cost/token series for the range (hourly for 24h, daily otherwise);
 *   - per-model usage for the range.
 *
 * Why a Host route at all: every upstream call needs the Go API key, and the
 * key lives on the Host (opencode's own `auth.json` or `OPENCODE_GO_API_KEY`).
 * The browser half therefore never sees a credential; it reads this route.
 *
 * Upstream contracts (verified 2026-11-05 against opencode v2.2.5 credentials):
 *
 *   GET https://opencode.ai/zen/go/v1/usage
 *   Authorization: Bearer <opencode-go key>
 *   200 {"usage":{"rolling":{...},"weekly":{...},"monthly":{...}}}
 *   where each window is `{ status, percent, resetsAt }`, `percent` is 0..100.
 *
 *   GET https://opencode.ai/console/api/go/status
 *   200 { product, cancelAtPeriodEnd, renewalStopReason, access: { startsAt, endsAt, meters } }
 *   — the period is `access.endsAt`; a cancelled plan keeps access until then.
 *
 *   GET https://opencode.ai/console/api/usage/summary?range=24h|7d|30d|6m|all
 *   200 { totalRequests, totalCostMicroCents, totalInputTokens, ... }
 *
 *   GET https://opencode.ai/console/api/usage/models?range=...
 *   200 { items: [{ model, provider, totalRequests, totalCostMicroCents, ... }] }
 *
 *   GET https://opencode.ai/console/api/usage/cost-by-day?range=...&bucket=hour|day
 *   200 [{ date, totalCostMicroCents, totalTokens, totalRequests }]
 *
 * The console endpoints reject a bare API key for the cookie-only activity
 * views, but the three usage views above accept it. Cost is reported in
 * micro-cents: 1 USD = 100000000 units.
 */
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const name = 'dsh-opencode-go-usage'

/** The browser route is served by the shared `webServer` service. */
export const inject = ['webServer']

const ROUTE = '/opencode-go-usage/status'
const USAGE_URL = 'https://opencode.ai/zen/go/v1/usage'
const CONSOLE_BASE = 'https://opencode.ai/console/api'
const STATUS_URL = `${CONSOLE_BASE}/go/status`
const REQUEST_TIMEOUT_MS = 15_000
const USAGE_TTL_MS = 30_000
const STATS_TTL_MS = 120_000
const ERROR_TTL_MS = 8_000
const MICRO_CENTS_PER_USD = 1e8

/** Accepted `range` values, matching the console's own enum. */
const RANGE_IDS = ['24h', '7d', '30d', '6m', 'all']
/** The chart bucket the console uses for each range. */
const RANGE_BUCKET = { '24h': 'hour', '7d': 'day', '30d': 'day', '6m': 'day', all: 'day' }

/** Upstream key order, in auth.json provider ids, most specific first. */
const PROVIDER_IDS = ['opencode-go', 'opencode-zen', 'opencode']

/** A failure that already knows how it should be reported to the UI. */
class UsageError extends Error {
  constructor(code, message, extra) {
    super(message)
    this.code = code
    this.extra = extra
  }
}

/** The opencode data directory (`$XDG_DATA_HOME/opencode` on Unix). */
function dataDir() {
  const xdg = (process.env.XDG_DATA_HOME || '').trim()
  if (xdg !== '') return join(xdg, 'opencode')
  const home = (process.env.USERPROFILE || process.env.HOME || homedir()).trim()
  return join(home, '.local', 'share', 'opencode')
}

/**
 * Resolve the OpenCode Go API key: environment first, then opencode's own
 * credential file, so a working `opencode auth login` needs no extra setup.
 * @returns {Promise<{ key: string, source: string }>}
 */
async function resolveApiKey() {
  const fromEnv = (process.env.OPENCODE_GO_API_KEY || '').trim()
  if (fromEnv !== '') return { key: fromEnv, source: 'env:OPENCODE_GO_API_KEY' }

  const file = join(dataDir(), 'auth.json')
  let raw
  try {
    raw = await readFile(file, 'utf8')
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      throw new UsageError('no_auth', `No opencode credential file at ${file}`)
    }
    throw new UsageError('auth_unreadable', `Cannot read ${file}: ${errorText(error)}`)
  }

  let data
  try {
    data = JSON.parse(raw)
  } catch {
    throw new UsageError('auth_unreadable', `${file} is not valid JSON`)
  }

  for (const id of PROVIDER_IDS) {
    const entry = data === null || typeof data !== 'object' ? undefined : data[id]
    const key = typeof entry === 'string' ? entry : entry && typeof entry.key === 'string' ? entry.key : ''
    const trimmed = key.trim()
    if (trimmed !== '') return { key: trimmed, source: `auth.json:${id}` }
  }

  throw new UsageError('no_key', `No OpenCode Go API key in ${file}`)
}

function errorText(error) {
  if (error instanceof Error) return error.message
  return String(error)
}

/**
 * GET one JSON resource with the Go API key.
 * @param {string} key - OpenCode Go API key.
 * @param {string} url - absolute URL.
 * @returns {Promise<unknown>} the parsed response body.
 */
async function fetchJson(key, url) {
  let response
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: {
        authorization: `Bearer ${key}`,
        accept: 'application/json',
        'user-agent': 'dsh-opencode-go-usage/0.3.0',
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    })
  } catch (error) {
    throw new UsageError('network', `Cannot reach ${url}: ${errorText(error)}`)
  }

  const text = await response.text()
  let body
  try {
    body = text === '' ? undefined : JSON.parse(text)
  } catch {
    body = undefined
  }

  if (!response.ok) {
    const detail = firstString([
      body && body.error && body.error.message,
      body && body.message,
      text.slice(0, 200),
    ])
    const code = response.status === 401 || response.status === 403 ? 'unauthorized' : 'upstream'
    throw new UsageError(code, `opencode.ai answered ${response.status} for ${url}${detail === '' ? '' : `: ${detail}`}`, {
      status: response.status,
    })
  }

  return body
}

function firstString(values) {
  for (const value of values) if (typeof value === 'string' && value.trim() !== '') return value.trim()
  return ''
}

/**
 * Normalize one window entry; `null` when the upstream omitted or mis-shaped it.
 * @param {unknown} entry - `{ status, percent, resetsAt }`.
 */
function normalizeWindow(entry) {
  if (entry === null || typeof entry !== 'object') return null
  const raw = entry.percent ?? entry.usedPercent ?? entry.used_percent
  const percent = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(percent)) return null
  const resetsAt = typeof entry.resetsAt === 'string' ? new Date(entry.resetsAt) : null
  return {
    percent: Math.min(100, Math.max(0, percent)),
    status: typeof entry.status === 'string' && entry.status !== '' ? entry.status : 'ok',
    resetsAt: resetsAt !== null && !Number.isNaN(resetsAt.getTime()) ? resetsAt.toISOString() : null,
  }
}

/** Map the upstream `usage` object onto the three windows the UI shows. */
function normalizeUsage(body) {
  const usage = body && typeof body === 'object' ? (body.usage ?? body.data ?? body) : undefined
  const windows = {
    session: normalizeWindow(usage?.rolling ?? usage?.fiveHour ?? usage?.session),
    week: normalizeWindow(usage?.weekly ?? usage?.week),
    month: normalizeWindow(usage?.monthly ?? usage?.month),
  }
  if (windows.session === null && windows.week === null && windows.month === null) {
    throw new UsageError('upstream', 'opencode.ai returned no recognizable usage windows')
  }
  return windows
}

function asNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * Normalize `GET /go/status` into the subscription facts the panel shows.
 * The period end lives on `access.endsAt`; a plan cancelled while paid up
 * keeps its access until then, so `cancelled` is about renewal, not access.
 * @param {unknown} body - the go/status payload.
 */
function normalizeSubscription(body) {
  if (body === null || typeof body !== 'object') return null
  const access = body.access !== null && typeof body.access === 'object' ? body.access : undefined
  const endsAt = toIsoDate(access?.endsAt ?? body.endsAt)
  if (endsAt === null) return null
  const stopReason = typeof body.renewalStopReason === 'string' ? body.renewalStopReason : null
  const cancelAtPeriodEnd = body.cancelAtPeriodEnd === true || access?.cancelAtPeriodEnd === true
  return {
    endsAt,
    startsAt: toIsoDate(access?.startsAt),
    cancelAtPeriodEnd,
    cancelled: cancelAtPeriodEnd || stopReason !== null,
    stopReason,
    resumability: typeof body.resumability === 'string' ? body.resumability : null,
    product: typeof body.product === 'string' ? body.product : null,
  }
}

function toIsoDate(value) {
  if (typeof value !== 'string' || value === '') return null
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
}

function asTokenCounts(body) {
  const input = asNumber(body?.totalInputTokens)
  const output = asNumber(body?.totalOutputTokens)
  const cacheRead = asNumber(body?.totalCacheReadTokens)
  const cacheWrite = asNumber(body?.totalCacheWrite5mTokens) + asNumber(body?.totalCacheWrite1hTokens)
  return { input, output, cacheRead, cacheWrite, total: input + output + cacheRead + cacheWrite }
}

/** Normalize `GET /usage/summary` into the totals the panel prints. */
function normalizeTotals(body) {
  return {
    requests: asNumber(body?.totalRequests),
    cost: asNumber(body?.totalCostMicroCents) / MICRO_CENTS_PER_USD,
    tokens: asTokenCounts(body),
  }
}

/** Normalize `GET /usage/models` into a cost-descending list. */
function normalizeModels(body) {
  const items = body !== null && typeof body === 'object' && Array.isArray(body.items) ? body.items : []
  return items
    .map((item) => ({
      model: typeof item?.model === 'string' ? item.model : '',
      provider: typeof item?.provider === 'string' ? item.provider : '',
      requests: asNumber(item?.totalRequests),
      cost: asNumber(item?.totalCostMicroCents) / MICRO_CENTS_PER_USD,
      tokens: asTokenCounts(item),
    }))
    .filter((item) => item.model !== '' || item.provider !== '')
    .sort((left, right) => right.cost - left.cost)
}

/** Normalize `GET /usage/cost-by-day` into an ascending series. */
function normalizeSeries(body) {
  const rows = Array.isArray(body) ? body : []
  return rows
    .map((row) => ({
      at: typeof row?.date === 'string' ? row.date : '',
      cost: asNumber(row?.totalCostMicroCents) / MICRO_CENTS_PER_USD,
      tokens: asNumber(row?.totalTokens),
      requests: asNumber(row?.totalRequests),
    }))
    .filter((row) => row.at !== '')
    .sort((left, right) => (left.at < right.at ? -1 : left.at > right.at ? 1 : 0))
}

/**
 * Fetch the three console usage views for one range, in parallel.
 * @param {string} key - OpenCode Go API key.
 * @param {string} range - one of {@link RANGE_IDS}.
 */
async function fetchStats(key, range) {
  const query = '?range=' + encodeURIComponent(range)
  const [summary, models, series] = await Promise.all([
    fetchJson(key, `${CONSOLE_BASE}/usage/summary${query}`),
    fetchJson(key, `${CONSOLE_BASE}/usage/models${query}`),
    fetchJson(key, `${CONSOLE_BASE}/usage/cost-by-day${query}&bucket=${RANGE_BUCKET[range]}`),
  ])
  return {
    bucket: RANGE_BUCKET[range],
    totals: normalizeTotals(summary),
    models: normalizeModels(models),
    series: normalizeSeries(series),
  }
}

function requestError(error, startedAt) {
  return {
    code: error instanceof UsageError ? error.code : 'internal',
    message: errorText(error),
    ...(error instanceof UsageError && error.extra !== undefined ? error.extra : {}),
  }
}

function sendJson(response, status, body) {
  const text = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'content-length': Buffer.byteLength(text),
    'x-content-type-options': 'nosniff',
  })
  response.end(text)
}

export function apply(ctx) {
  /** @type {{ at: number, ttl: number, value: object } | undefined} */
  let usageCache
  /** @type {Promise<object> | undefined} */
  let usagePending
  /** @type {Map<string, { at: number, ttl: number, value: object }>} */
  const statsCache = new Map()
  /** @type {Map<string, Promise<object>>} */
  const statsPending = new Map()

  const warn = (message) => {
    if (typeof ctx.logger?.warn === 'function') ctx.logger.warn(`[opencode-go-usage] ${message}`)
  }

  /** Read the three quota windows, cached for {@link USAGE_TTL_MS}. */
  const readUsage = async (force) => {
    const now = Date.now()
    if (!force && usageCache !== undefined && now - usageCache.at < usageCache.ttl) return usageCache.value
    if (usagePending !== undefined) return usagePending

    usagePending = (async () => {
      const startedAt = Date.now()
      try {
        const { key, source } = await resolveApiKey()
        const [body, account] = await Promise.all([
          fetchJson(key, USAGE_URL),
          fetchJson(key, STATUS_URL).catch((error) => {
            warn(`subscription: ${errorText(error)}`)
            return undefined
          }),
        ])
        const value = {
          ok: true,
          fetchedAt: new Date().toISOString(),
          elapsedMs: Date.now() - startedAt,
          source: USAGE_URL,
          keySource: source,
          windows: normalizeUsage(body),
          subscription: normalizeSubscription(account),
        }
        usageCache = { at: Date.now(), ttl: USAGE_TTL_MS, value }
        return value
      } catch (error) {
        const value = {
          ok: false,
          fetchedAt: new Date().toISOString(),
          elapsedMs: Date.now() - startedAt,
          source: USAGE_URL,
          error: requestError(error, startedAt),
        }
        usageCache = { at: Date.now(), ttl: ERROR_TTL_MS, value }
        warn(`${value.error.code}: ${value.error.message}`)
        return value
      } finally {
        usagePending = undefined
      }
    })()

    return usagePending
  }

  /** Read the range stats (totals/models/series), cached for {@link STATS_TTL_MS}. */
  const readStats = async (range, force) => {
    const now = Date.now()
    const hit = statsCache.get(range)
    if (!force && hit !== undefined && now - hit.at < hit.ttl) return hit.value
    const running = statsPending.get(range)
    if (running !== undefined) return running

    const task = (async () => {
      const startedAt = Date.now()
      try {
        const { key } = await resolveApiKey()
        const stats = await fetchStats(key, range)
        const value = {
          ok: true,
          fetchedAt: new Date().toISOString(),
          elapsedMs: Date.now() - startedAt,
          ...stats,
        }
        statsCache.set(range, { at: Date.now(), ttl: STATS_TTL_MS, value })
        return value
      } catch (error) {
        const value = {
          ok: false,
          fetchedAt: new Date().toISOString(),
          elapsedMs: Date.now() - startedAt,
          error: requestError(error, startedAt),
        }
        statsCache.set(range, { at: Date.now(), ttl: ERROR_TTL_MS, value })
        warn(`stats ${range}: ${value.error.code}: ${value.error.message}`)
        return value
      } finally {
        statsPending.delete(range)
      }
    })()

    statsPending.set(range, task)
    return task
  }

  const read = async (range, force) => {
    const startedAt = Date.now()
    const [usage, stats] = await Promise.all([readUsage(force), readStats(range, force)])
    if (usage.ok !== true) return { ...usage, range, elapsedMs: Date.now() - startedAt }

    return {
      ok: true,
      fetchedAt: new Date().toISOString(),
      elapsedMs: Date.now() - startedAt,
      range,
      source: USAGE_URL,
      keySource: usage.keySource,
      windows: usage.windows,
      subscription: usage.subscription ?? null,
      stats: stats.ok === true ? { ...stats } : { ok: false, fetchedAt: stats.fetchedAt, error: stats.error },
    }
  }

  const handler = async (request, response) => {
    try {
      if ((request.method ?? 'GET').toUpperCase() !== 'GET') {
        sendJson(response, 405, {
          ok: false,
          error: { code: 'method_not_allowed', message: 'Only GET is supported' },
        })
        return
      }
      const url = new URL(request.url ?? ROUTE, 'http://localhost')
      const rawRange = (url.searchParams.get('range') ?? '24h').trim()
      if (!RANGE_IDS.includes(rawRange)) {
        sendJson(response, 400, {
          ok: false,
          error: {
            code: 'bad_range',
            message: `range must be one of ${RANGE_IDS.join(', ')}`,
            allowed: RANGE_IDS,
          },
        })
        return
      }
      const force = url.searchParams.get('refresh') === '1'
      sendJson(response, 200, await read(rawRange, force))
    } catch (error) {
      sendJson(response, 500, {
        ok: false,
        error: { code: 'internal', message: errorText(error) },
      })
    }
  }

  ctx.effect(
    () => ctx.webServer.register({ kind: 'exact', path: ROUTE, handler }),
    'opencode-go-usage: status route',
  )
}
