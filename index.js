/**
 * 阿里云代金券余额 · Host 半侧（多账户版）。
 *
 * 维护多个阿里云账号的 AccessKey，分别通过 BSS OpenAPI（QueryCashCoupons，RPC 签名 v1.0）
 * 读取代金券余额，缓存快照与历史采样，并通过本机 HTTP 路由提供给 Client 半侧。
 * 凭据只落在用户主目录下，永不回传给浏览器。
 *
 * 数据文件（%USERPROFILE%\.dsh\aliyun-coupon\）：
 *  - accounts.json  多账户凭据与全局设置
 *  - history.json   每个账户独立的余额采样
 * 旧版单账户 credentials.json 会在首次启动时自动迁移。
 */

import { createHmac, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** 阿里云卡券控制台地址。 */
const CONSOLE_URL = 'https://billing-cost.console.aliyun.com/coupons/coupon'
/** BSS OpenAPI 版本与默认接入点。 */
const API_VERSION = '2017-12-14'
const DEFAULT_ENDPOINT = 'https://business.aliyuncs.com'
/** 本地路由。 */
const ROUTE_STATE = '/aliyun-coupon/state'
const ROUTE_REFRESH = '/aliyun-coupon/refresh'
const ROUTE_ACCOUNTS = '/aliyun-coupon/accounts'
const ROUTE_ACCOUNT_REMOVE = '/aliyun-coupon/accounts/remove'
const ROUTE_SETTINGS = '/aliyun-coupon/settings'
/** 旧版单账户接口，保留以便旧页面在刷新前仍能保存。 */
const ROUTE_LEGACY_CONFIG = '/aliyun-coupon/config'
/** 采样与刷新策略（毫秒）。 */
const TICK_MS = 60_000
const MIN_FETCH_GAP_MS = 30_000
const REQUEST_TIMEOUT_MS = 20_000
const MAX_SAMPLES = 2_000
const SAMPLE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const EXPIRING_WINDOW_MS = 7 * 24 * 60 * 60 * 1000
const MAX_ACCOUNTS = 20
const MAX_COUPONS_IN_STATE = 60
const MAX_HISTORY_IN_STATE = 120

const DATA_DIR = join(homedir(), '.dsh', 'aliyun-coupon')
const ACCOUNTS_FILE = join(DATA_DIR, 'accounts.json')
const HISTORY_FILE = join(DATA_DIR, 'history.json')
const LEGACY_CREDENTIALS_FILE = join(DATA_DIR, 'credentials.json')

/* ------------------------------------------------------------------ 工具函数 */

function roundMoney(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return 0
  return Math.round((number + Number.EPSILON) * 100) / 100
}

function readJson(file, fallback) {
  try {
    if (!existsSync(file)) return fallback
    const text = readFileSync(file, 'utf8')
    if (!text.trim()) return fallback
    return JSON.parse(text)
  } catch {
    return fallback
  }
}

function writeJson(file, value, mode) {
  try {
    mkdirSync(DATA_DIR, { recursive: true })
    const temp = `${file}.tmp`
    writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: mode ?? 0o600 })
    renameSync(temp, file)
    return true
  } catch {
    return false
  }
}

function clampInteger(value, min, max, fallback) {
  const number = Math.trunc(Number(value))
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}

/** 阿里云 RPC 签名要求的百分号编码。 */
function percentEncode(value) {
  return encodeURIComponent(String(value)).replace(/\*/g, '%2A')
}

/** 仅允许本机页面访问，避免任意网页读取余额。 */
function isLocalRequest(req) {
  const host = String(req.headers.host || '').toLowerCase()
  const hostname = host.replace(/:\d+$/, '')
  const local =
    hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '[::1]' || hostname === '::1'
  if (!local) return false
  const origin = req.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(String(origin)).host.toLowerCase() === host
  } catch {
    return false
  }
}

function sendJson(res, status, body) {
  const text = JSON.stringify(body)
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('content-length', Buffer.byteLength(text))
  res.end(text)
}

function readBody(req, limit = 32 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function maskKey(key) {
  if (!key) return ''
  if (key.length <= 8) return `${key.slice(0, 2)}****`
  return `${key.slice(0, 6)}****${key.slice(-4)}`
}

/* ------------------------------------------------------------------ 阿里云接口 */

class ApiError extends Error {
  constructor(code, message, hint) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.hint = hint
  }
}

const ERROR_HINTS = {
  NotApplicable: '该接口不支持当前账号类型，代金券查询仅对部分账号开放。',
  NotAuthorized: 'AccessKey 缺少费用中心只读权限，请给 RAM 用户授予 AliyunBSSReadOnlyAccess。',
  'Forbidden.RAM': 'RAM 用户未被授予费用中心只读权限（AliyunBSSReadOnlyAccess）。',
  'InvalidAccessKeyId.NotFound': 'AccessKeyId 不存在，请检查是否填错或已禁用。',
  InvalidAccessKeyIdNotFound: 'AccessKeyId 不存在，请检查是否填错或已禁用。',
  SignatureDoesNotMatch: '签名校验失败，通常是 AccessKeySecret 填错。',
  Throttling: '调用过于频繁，请稍后再试。',
}

function hintFor(code) {
  return ERROR_HINTS[code] ?? undefined
}

async function queryCashCoupons(credentials) {
  const params = {
    Action: 'QueryCashCoupons',
    Version: API_VERSION,
    Format: 'JSON',
    AccessKeyId: credentials.accessKeyId,
    SignatureMethod: 'HMAC-SHA1',
    SignatureVersion: '1.0',
    SignatureNonce: randomUUID(),
    Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
  }
  const canonical = Object.keys(params)
    .sort()
    .map((key) => `${percentEncode(key)}=${percentEncode(params[key])}`)
    .join('&')
  const stringToSign = `GET&${percentEncode('/')}&${percentEncode(canonical)}`
  const signature = createHmac('sha1', `${credentials.accessKeySecret}&`)
    .update(stringToSign, 'utf8')
    .digest('base64')
  const endpoint = (credentials.endpoint || DEFAULT_ENDPOINT).replace(/\/+$/, '')
  const url = `${endpoint}/?${canonical}&Signature=${percentEncode(signature)}`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  let response
  try {
    response = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
      signal: controller.signal,
    })
  } catch (error) {
    if (error && error.name === 'AbortError') {
      throw new ApiError('TIMEOUT', '调用阿里云接口超时，请检查网络或代理设置。')
    }
    throw new ApiError(
      'NETWORK',
      `无法连接阿里云接口：${error && error.message ? error.message : String(error)}`,
      '如果网络需要代理，请为 DSH 配置 HTTPS_PROXY。',
    )
  } finally {
    clearTimeout(timer)
  }

  const text = await response.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    if (response.status === 404) {
      throw new ApiError('BAD_ENDPOINT', `接入点不存在（HTTP 404）：${endpoint}`, '请把接入点改回 https://business.aliyuncs.com')
    }
    throw new ApiError('BAD_RESPONSE', `阿里云返回了非 JSON 内容（HTTP ${response.status}）。`)
  }

  const code = body.Code === undefined ? '' : String(body.Code)
  if (body.Success === false || (code && code !== 'Success') || response.status >= 400) {
    const message = String(body.Message || `HTTP ${response.status}`)
    throw new ApiError(code || `HTTP_${response.status}`, message, hintFor(code))
  }

  const data = body.Data && typeof body.Data === 'object' ? body.Data : {}
  const raw = data.CashCoupon
  const list = Array.isArray(raw)
    ? raw
    : raw && Array.isArray(raw.CashCoupon)
      ? raw.CashCoupon
      : raw && Array.isArray(raw.CashCouponItem)
        ? raw.CashCouponItem
        : []

  const now = Date.now()
  const coupons = list.map((item) => {
    const expiry = Date.parse(item.ExpiryTime || '') || null
    const status = String(item.Status || '')
    const balance = roundMoney(item.Balance)
    const available = status === 'Available' && (expiry === null || expiry > now)
    return {
      id: item.CashCouponId === undefined ? null : String(item.CashCouponId),
      no: String(item.CashCouponNo || ''),
      name: String(item.Description || item.CashCouponNo || '代金券'),
      nominal: roundMoney(item.NominalValue),
      balance,
      status,
      available,
      expiry,
      granted: Date.parse(item.GrantedTime || '') || null,
      effective: Date.parse(item.EffectiveTime || '') || null,
      products: String(item.ApplicableProducts || ''),
      scenarios: String(item.ApplicableScenarios || ''),
    }
  })

  return { coupons, fetchedAt: now }
}

function availableTotal(coupons) {
  return roundMoney(
    coupons.filter((coupon) => coupon.available && coupon.balance > 0).reduce((sum, coupon) => sum + coupon.balance, 0),
  )
}

/* ------------------------------------------------------------------ 插件主体 */

export const inject = ['webServer']

export function apply(ctx) {
  /** 账户定义：{ id, name, accessKeyId, accessKeySecret, endpoint, createdAt, persisted } */
  let accounts = []
  /** 全局设置。 */
  let intervalMinutes = 10
  /** 每账户运行态：id -> { snapshot, error, lastAttemptAt, inflight } */
  const runtime = new Map()
  /** 每账户采样：id -> [{ t, total }] */
  let history = new Map()

  /* ---- 持久化 ---- */

  function normalizeSamples(list) {
    const samples = Array.isArray(list) ? list : []
    return samples
      .filter((item) => item && Number.isFinite(Number(item.t)) && Number.isFinite(Number(item.total)))
      .map((item) => ({ t: Number(item.t), total: roundMoney(item.total) }))
      .sort((left, right) => left.t - right.t)
      .slice(-MAX_SAMPLES)
  }

  function normalizeAccount(raw) {
    if (!raw || typeof raw !== 'object') return null
    const accessKeyId = String(raw.accessKeyId || '').trim()
    const accessKeySecret = String(raw.accessKeySecret || '').trim()
    if (!accessKeyId || !accessKeySecret) return null
    return {
      id: String(raw.id || randomUUID().slice(0, 8)),
      name: String(raw.name || maskKey(accessKeyId) || '阿里云账号'),
      accessKeyId,
      accessKeySecret,
      endpoint: String(raw.endpoint || DEFAULT_ENDPOINT).trim() || DEFAULT_ENDPOINT,
      createdAt: String(raw.createdAt || new Date().toISOString()),
      persisted: true,
    }
  }

  function persistAccounts() {
    const persisted = accounts
      .filter((account) => account.persisted !== false)
      .map((account) => ({
        id: account.id,
        name: account.name,
        accessKeyId: account.accessKeyId,
        accessKeySecret: account.accessKeySecret,
        endpoint: account.endpoint,
        createdAt: account.createdAt,
      }))
    return writeJson(ACCOUNTS_FILE, { version: 2, intervalMinutes, accounts: persisted }, 0o600)
  }

  function persistHistory() {
    const cutoff = Date.now() - SAMPLE_RETENTION_MS
    const payload = {}
    for (const [id, samples] of history) {
      if (accounts.every((account) => account.id !== id)) continue
      const trimmed = samples.filter((sample) => sample.t >= cutoff).slice(-MAX_SAMPLES)
      history.set(id, trimmed)
      if (trimmed.length > 0) payload[id] = trimmed
    }
    return writeJson(HISTORY_FILE, { version: 2, samples: payload }, 0o644)
  }

  /** 读取磁盘状态；旧版单账户文件自动迁移。 */
  function loadState() {
    const saved = readJson(ACCOUNTS_FILE, null)
    if (saved && Array.isArray(saved.accounts) && saved.accounts.length > 0) {
      intervalMinutes = clampInteger(saved.intervalMinutes, 1, 240, 10)
      accounts = saved.accounts.map(normalizeAccount).filter(Boolean)
    } else {
      const legacy = readJson(LEGACY_CREDENTIALS_FILE, null)
      intervalMinutes = clampInteger(legacy && legacy.intervalMinutes, 1, 240, 10)
      const migrated = legacy
        ? normalizeAccount({
            id: randomUUID().slice(0, 8),
            name: '默认账户',
            accessKeyId: legacy.accessKeyId,
            accessKeySecret: legacy.accessKeySecret,
            endpoint: legacy.endpoint,
            createdAt: legacy.updatedAt || new Date().toISOString(),
          })
        : null
      accounts = migrated ? [migrated] : []
      if (migrated) {
        persistAccounts()
        // 迁移成功后再移除旧文件，避免重复保存同一份密钥。
        try {
          if (existsSync(LEGACY_CREDENTIALS_FILE)) renameSync(LEGACY_CREDENTIALS_FILE, `${LEGACY_CREDENTIALS_FILE}.migrated`)
        } catch {
          /* 保留旧文件不影响新结构 */
        }
      }
    }

    // 没有任何账户时，允许用环境变量兜底（不落盘）。
    if (accounts.length === 0) {
      const envId = process.env.ALIBABA_CLOUD_ACCESS_KEY_ID || process.env.ALIYUN_ACCESS_KEY_ID || ''
      const envSecret = process.env.ALIBABA_CLOUD_ACCESS_KEY_SECRET || process.env.ALIYUN_ACCESS_KEY_SECRET || ''
      if (envId && envSecret) {
        accounts.push({
          id: 'env',
          name: '环境变量账户',
          accessKeyId: envId,
          accessKeySecret: envSecret,
          endpoint: DEFAULT_ENDPOINT,
          createdAt: new Date().toISOString(),
          persisted: false,
        })
      }
    }

    const raw = readJson(HISTORY_FILE, null)
    history = new Map()
    if (raw && raw.samples && !Array.isArray(raw.samples) && typeof raw.samples === 'object') {
      for (const [id, list] of Object.entries(raw.samples)) history.set(id, normalizeSamples(list))
    } else if (raw && Array.isArray(raw.samples) && accounts.length > 0) {
      // 旧版扁平采样：归到第一个账户。
      history.set(accounts[0].id, normalizeSamples(raw.samples))
    }

    for (const account of accounts) runtime.set(account.id, { snapshot: null, error: null, lastAttemptAt: 0, inflight: null })
  }

  loadState()

  /* ---- 刷新 ---- */

  function stateOf(accountId) {
    let entry = runtime.get(accountId)
    if (!entry) {
      entry = { snapshot: null, error: null, lastAttemptAt: 0, inflight: null }
      runtime.set(accountId, entry)
    }
    return entry
  }

  function recordSample(accountId, total, at) {
    const samples = history.get(accountId) || []
    const last = samples[samples.length - 1]
    if (!last || last.total !== total || at - last.t > 10 * 60_000) {
      samples.push({ t: at, total })
      history.set(accountId, samples)
      persistHistory()
    }
  }

  async function refreshAccount(account, force) {
    const entry = stateOf(account.id)
    if (entry.inflight) return entry.inflight
    if (!force && entry.lastAttemptAt !== 0 && Date.now() - entry.lastAttemptAt < MIN_FETCH_GAP_MS) return
    entry.lastAttemptAt = Date.now()
    entry.inflight = (async () => {
      try {
        const result = await queryCashCoupons(account)
        entry.snapshot = result
        entry.error = null
        recordSample(account.id, availableTotal(result.coupons), result.fetchedAt)
      } catch (error) {
        entry.error = {
          code: error instanceof ApiError ? error.code : 'UNKNOWN',
          message: error instanceof Error ? error.message : String(error),
          hint: error instanceof ApiError ? error.hint : undefined,
        }
      } finally {
        entry.inflight = null
      }
    })()
    return entry.inflight
  }

  function refreshAll(force) {
    return Promise.all(accounts.map((account) => refreshAccount(account, force)))
  }

  async function maybeRefreshAll() {
    const now = Date.now()
    await Promise.all(
      accounts.map((account) => {
        const entry = stateOf(account.id)
        const fresh = entry.snapshot !== null && now - entry.snapshot.fetchedAt < MIN_FETCH_GAP_MS
        return fresh ? Promise.resolve() : refreshAccount(account, false)
      }),
    )
  }

  /* ---- 汇总 ---- */

  function startOfToday() {
    const date = new Date()
    date.setHours(0, 0, 0, 0)
    return date.getTime()
  }

  function computeDelta(accountId, total) {
    const samples = history.get(accountId) || []
    if (samples.length === 0) return null
    const midnight = startOfToday()
    let base = null
    for (const sample of samples) {
      if (sample.t < midnight) base = sample
      else break
    }
    if (!base) base = samples.find((sample) => sample.t >= midnight) || null
    if (!base) return null
    return roundMoney(total - base.total)
  }

  function accountView(account) {
    const entry = stateOf(account.id)
    const now = Date.now()
    const coupons = entry.snapshot ? entry.snapshot.coupons : []
    const available = coupons.filter((coupon) => coupon.available && coupon.balance > 0)
    const total = roundMoney(available.reduce((sum, coupon) => sum + coupon.balance, 0))
    const expiring = available
      .filter((coupon) => coupon.expiry !== null && coupon.expiry - now <= EXPIRING_WINDOW_MS)
      .sort((left, right) => left.expiry - right.expiry)
      .map((coupon) => ({ id: coupon.id, name: coupon.name, balance: coupon.balance, expiry: coupon.expiry }))
    const updatedAt = entry.snapshot ? entry.snapshot.fetchedAt : null
    return {
      id: account.id,
      name: account.name,
      endpoint: account.endpoint,
      accessKeyIdMasked: maskKey(account.accessKeyId),
      persisted: account.persisted !== false,
      ok: entry.error === null && entry.snapshot !== null,
      total,
      faceTotal: roundMoney(available.reduce((sum, coupon) => sum + coupon.nominal, 0)),
      count: available.length,
      deltaToday: entry.snapshot === null ? null : computeDelta(account.id, total),
      updatedAt,
      stale: updatedAt === null || now - updatedAt > intervalMinutes * 60_000 * 2,
      error: entry.error,
      expiring,
      coupons: coupons
        .slice()
        .sort((left, right) => {
          if (left.available !== right.available) return left.available ? -1 : 1
          if (left.expiry === null) return 1
          if (right.expiry === null) return -1
          return left.expiry - right.expiry
        })
        .slice(0, MAX_COUPONS_IN_STATE),
      history: (history.get(account.id) || []).slice(-MAX_HISTORY_IN_STATE).map((sample) => ({
        t: sample.t,
        total: sample.total,
      })),
    }
  }

  function currentState() {
    const views = accounts.map(accountView)
    const now = Date.now()

    let total = 0
    let faceTotal = 0
    let count = 0
    let deltaSum = 0
    let hasDelta = false
    let updatedAt = null
    let okCount = 0
    for (const view of views) {
      total = roundMoney(total + view.total)
      faceTotal = roundMoney(faceTotal + view.faceTotal)
      count += view.count
      if (typeof view.deltaToday === 'number') {
        deltaSum = roundMoney(deltaSum + view.deltaToday)
        hasDelta = true
      }
      if (view.updatedAt !== null && (updatedAt === null || view.updatedAt > updatedAt)) updatedAt = view.updatedAt
      if (view.ok) okCount += 1
    }

    const failed = views.filter((view) => view.error !== null)
    const firstError = failed.length > 0 ? failed[0].error : null

    return {
      configured: accounts.length > 0,
      ok: accounts.length > 0 && failed.length === 0,
      partial: okCount > 0 && failed.length > 0,
      consoleUrl: CONSOLE_URL,
      dataDir: DATA_DIR,
      intervalMinutes,
      total,
      faceTotal,
      count,
      accountCount: views.length,
      okCount,
      deltaToday: hasDelta ? deltaSum : null,
      updatedAt,
      stale: updatedAt === null || now - updatedAt > intervalMinutes * 60_000 * 2,
      error: firstError,
      accounts: views,
    }
  }

  /* ---- 账户维护 ---- */

  function findAccount(id) {
    return accounts.find((account) => account.id === id) || null
  }

  function upsertAccount(payload) {
    return (async () => {
      const source = payload && typeof payload === 'object' ? payload : {}
      const target = source.id ? findAccount(String(source.id)) : null
      if (source.id && !target) {
        return { status: 404, body: { ok: false, error: { code: 'NOT_FOUND', message: '账户不存在，可能已被删除。' } } }
      }
      if (!target && accounts.length >= MAX_ACCOUNTS) {
        return { status: 400, body: { ok: false, error: { code: 'TOO_MANY', message: `最多支持 ${MAX_ACCOUNTS} 个账户。` } } }
      }

      const submittedId = typeof source.accessKeyId === 'string' ? source.accessKeyId.trim() : ''
      const submittedSecret = typeof source.accessKeySecret === 'string' ? source.accessKeySecret.trim() : ''
      const nextId = submittedId || (target ? target.accessKeyId : '')
      const idChanged = target !== null && submittedId !== '' && submittedId !== target.accessKeyId
      const nextSecret = submittedSecret || (target && !idChanged ? target.accessKeySecret : '')
      const nextEndpoint =
        typeof source.endpoint === 'string' && source.endpoint.trim() !== ''
          ? source.endpoint.trim()
          : target
            ? target.endpoint
            : DEFAULT_ENDPOINT
      const nextName = typeof source.name === 'string' && source.name.trim() !== ''
        ? source.name.trim().slice(0, 60)
        : target
          ? target.name
          : maskKey(nextId)

      if (!nextId) {
        return { status: 400, body: { ok: false, error: { code: 'MISSING_ACCOUNT', message: '请填写 AccessKey ID。' } } }
      }
      if (!nextSecret) {
        return {
          status: 400,
          body: {
            ok: false,
            error: {
              code: 'MISSING_SECRET',
              message: idChanged ? '更换 AccessKey ID 时必须重新填写 Secret。' : '请填写 AccessKey Secret。',
            },
          },
        }
      }
      try {
        const probe = new URL(nextEndpoint)
        if (probe.protocol !== 'https:' && probe.protocol !== 'http:') throw new Error('bad protocol')
      } catch {
        return { status: 400, body: { ok: false, error: { code: 'BAD_ENDPOINT', message: '接入点必须是合法的 https 地址。' } } }
      }
      if (accounts.some((account) => account.id !== (target ? target.id : '') && account.accessKeyId === nextId)) {
        return { status: 400, body: { ok: false, error: { code: 'DUPLICATE', message: '这个 AccessKey ID 已经添加过了。' } } }
      }

      // 先验证再落盘。
      let probeResult
      try {
        probeResult = await queryCashCoupons({ accessKeyId: nextId, accessKeySecret: nextSecret, endpoint: nextEndpoint })
      } catch (error) {
        const apiError = error instanceof ApiError ? error : null
        return {
          status: 400,
          body: {
            ok: false,
            error: {
              code: apiError ? apiError.code : 'PROBE_FAILED',
              message: error instanceof Error ? error.message : String(error),
              hint: apiError ? apiError.hint : undefined,
            },
          },
        }
      }

      const next = target
        ? Object.assign(target, {
            name: nextName,
            accessKeyId: nextId,
            accessKeySecret: nextSecret,
            endpoint: nextEndpoint,
            persisted: true,
          })
        : {
            id: randomUUID().slice(0, 8),
            name: nextName,
            accessKeyId: nextId,
            accessKeySecret: nextSecret,
            endpoint: nextEndpoint,
            createdAt: new Date().toISOString(),
            persisted: true,
          }

      if (!target) {
        accounts.push(next)
        runtime.set(next.id, { snapshot: null, error: null, lastAttemptAt: 0, inflight: null })
      }
      const entry = stateOf(next.id)
      entry.snapshot = probeResult
      entry.error = null
      entry.lastAttemptAt = Date.now()
      recordSample(next.id, availableTotal(probeResult.coupons), probeResult.fetchedAt)

      if (!persistAccounts()) {
        return { status: 500, body: { ok: false, error: { code: 'WRITE_FAILED', message: `无法写入 ${ACCOUNTS_FILE}` } } }
      }
      return { status: 200, body: currentState() }
    })()
  }

  function removeAccount(id) {
    const index = accounts.findIndex((account) => account.id === id)
    if (index < 0) return false
    accounts.splice(index, 1)
    runtime.delete(id)
    history.delete(id)
    persistAccounts()
    persistHistory()
    return true
  }

  /* ---- 路由 ---- */

  const withGuard = (handler) => async (req, res) => {
    try {
      if (!isLocalRequest(req)) {
        sendJson(res, 403, { ok: false, error: { code: 'FORBIDDEN', message: '只允许本机页面访问。' } })
        return
      }
      await handler(req, res)
    } catch (error) {
      sendJson(res, 500, {
        ok: false,
        error: { code: 'INTERNAL', message: error instanceof Error ? error.message : String(error) },
      })
    }
  }

  async function readJsonBody(req, res) {
    let payload
    try {
      payload = JSON.parse((await readBody(req)) || '{}')
    } catch {
      sendJson(res, 400, { ok: false, error: { code: 'BAD_BODY', message: '请求体不是合法 JSON。' } })
      return null
    }
    if (!payload || typeof payload !== 'object') {
      sendJson(res, 400, { ok: false, error: { code: 'BAD_BODY', message: '请求体格式不正确。' } })
      return null
    }
    return payload
  }

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: ROUTE_STATE,
      handler: withGuard(async (req, res) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          sendJson(res, 405, { ok: false, error: { code: 'METHOD', message: '只支持 GET。' } })
          return
        }
        await maybeRefreshAll()
        sendJson(res, 200, currentState())
      }),
    }),
  )

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: ROUTE_REFRESH,
      handler: withGuard(async (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: { code: 'METHOD', message: '只支持 POST。' } })
          return
        }
        await refreshAll(true)
        sendJson(res, 200, currentState())
      }),
    }),
  )

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: ROUTE_ACCOUNTS,
      handler: withGuard(async (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: { code: 'METHOD', message: '只支持 POST。' } })
          return
        }
        const payload = await readJsonBody(req, res)
        if (payload === null) return
        const result = await upsertAccount(payload.account || payload)
        sendJson(res, result.status, result.body)
      }),
    }),
  )

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: ROUTE_ACCOUNT_REMOVE,
      handler: withGuard(async (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: { code: 'METHOD', message: '只支持 POST。' } })
          return
        }
        const payload = await readJsonBody(req, res)
        if (payload === null) return
        const id = typeof payload.id === 'string' ? payload.id : ''
        if (!id) {
          sendJson(res, 400, { ok: false, error: { code: 'MISSING_ID', message: '缺少账户 id。' } })
          return
        }
        if (!removeAccount(id)) {
          sendJson(res, 404, { ok: false, error: { code: 'NOT_FOUND', message: '账户不存在。' } })
          return
        }
        sendJson(res, 200, currentState())
      }),
    }),
  )

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: ROUTE_SETTINGS,
      handler: withGuard(async (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: { code: 'METHOD', message: '只支持 POST。' } })
          return
        }
        const payload = await readJsonBody(req, res)
        if (payload === null) return
        intervalMinutes = clampInteger(payload.intervalMinutes, 1, 240, intervalMinutes)
        persistAccounts()
        sendJson(res, 200, currentState())
      }),
    }),
  )

  // 旧版单账户保存接口：刷新前的页面仍可正常保存（更新第一个账户）。
  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'exact',
      path: ROUTE_LEGACY_CONFIG,
      handler: withGuard(async (req, res) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: { code: 'METHOD', message: '只支持 POST。' } })
          return
        }
        const payload = await readJsonBody(req, res)
        if (payload === null) return
        if (payload.clear === true) {
          const first = accounts[0]
          if (first) removeAccount(first.id)
          sendJson(res, 200, currentState())
          return
        }
        const first = accounts[0]
        const result = await upsertAccount(Object.assign({}, payload, first ? { id: first.id } : {}))
        sendJson(res, result.status, result.body)
      }),
    }),
  )

  // ---- 定时自动刷新 ---------------------------------------------------------

  ctx.effect(() => {
    const timer = setInterval(() => {
      for (const account of accounts) {
        const entry = stateOf(account.id)
        const due = entry.snapshot === null || Date.now() - entry.snapshot.fetchedAt >= intervalMinutes * 60_000
        if (due) void refreshAccount(account, false)
      }
    }, TICK_MS)
    return () => clearInterval(timer)
  })

  void refreshAll(false)

  // ---- Agent 工具 ----------------------------------------------------------

  let toolInjectRan = false
  let toolRegisterError = null

  ctx.inject(['tools'], (child) => {
    toolInjectRan = true
    child.effect(() => {
      try {
        return child.tools.register({
          name: 'aliyun_coupon_balance',
          description:
            '读取阿里云代金券（现金券）余额：支持多个账号，返回每个账号的可用余额、今日变化、明细与即将过期的券，以及全部账号合计。用户问“代金券还剩多少/余额变了没”时使用。',
          parameters: {
            type: 'object',
            additionalProperties: false,
            properties: {
              refresh: {
                type: 'boolean',
                description: '是否强制立即调用阿里云接口刷新（默认使用缓存，超过 30 秒会自动刷新）。',
              },
              account: {
                type: 'string',
                description: '只看某个账号，填账号名称或 id；留空返回全部账号。',
              },
            },
          },
          output: {
            schema: {
              type: 'object',
              additionalProperties: true,
              required: ['total', 'count'],
              properties: {
                total: { type: 'number' },
                count: { type: 'integer' },
                accountCount: { type: 'integer' },
                deltaToday: { type: 'number' },
                updatedAt: { type: 'string' },
                error: { type: 'string' },
              },
            },
            render: (_args, value) => {
              const total = Number(value && value.total) || 0
              const count = Number(value && value.count) || 0
              const accounts = Number(value && value.accountCount) || 0
              const delta = value && value.deltaToday
              const parts = [`阿里云代金券可用余额合计 ¥${total.toFixed(2)}（${count} 张可用，${accounts} 个账号）`]
              if (typeof delta === 'number' && delta !== 0) {
                parts.push(`今日${delta > 0 ? '增加' : '减少'} ¥${Math.abs(delta).toFixed(2)}`)
              }
              if (Array.isArray(value && value.accounts) && value.accounts.length > 1) {
                const lines = value.accounts.map(
                  (account) => `${account.name}：${account.error ? `失败（${account.error}）` : `¥${Number(account.total).toFixed(2)}`}`,
                )
                parts.push(lines.join('；'))
              }
              if (value && value.error) parts.push(`错误：${value.error}`)
              return [{ type: 'text', text: parts.join('\n') }]
            },
          },
          async execute(args) {
            const wantRefresh = args && args.refresh === true
            const needle = args && typeof args.account === 'string' ? args.account.trim().toLowerCase() : ''
            if (wantRefresh) await refreshAll(true)
            else await maybeRefreshAll()

            const state = currentState()
            const selected = needle
              ? state.accounts.filter(
                  (account) =>
                    account.id.toLowerCase() === needle ||
                    account.name.toLowerCase() === needle ||
                    account.accessKeyIdMasked.toLowerCase().includes(needle),
                )
              : state.accounts

            const pick = selected.length > 0 ? selected : state.accounts
            const total = roundMoney(pick.reduce((sum, account) => sum + account.total, 0))
            const count = pick.reduce((sum, account) => sum + account.count, 0)
            const deltas = pick.map((account) => account.deltaToday).filter((value) => typeof value === 'number')
            const updated = pick.reduce((max, account) => (account.updatedAt && account.updatedAt > max ? account.updatedAt : max), 0)

            return {
              total,
              count,
              accountCount: pick.length,
              deltaToday: deltas.length > 0 ? roundMoney(deltas.reduce((sum, value) => sum + value, 0)) : undefined,
              updatedAt: updated > 0 ? new Date(updated).toISOString() : undefined,
              accounts: pick.map((account) => ({
                name: account.name,
                accessKeyIdMasked: account.accessKeyIdMasked,
                total: account.total,
                count: account.count,
                deltaToday: typeof account.deltaToday === 'number' ? account.deltaToday : undefined,
                error: account.error ? account.error.message : undefined,
                expiring: account.expiring.map((coupon) => ({
                  name: coupon.name,
                  balance: coupon.balance,
                  expiry: new Date(coupon.expiry).toISOString(),
                })),
              })),
              error: state.configured ? (state.error ? state.error.message : undefined) : '尚未添加任何阿里云账户',
            }
          },
        })
      } catch (error) {
        toolRegisterError = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
        return () => {}
      }
    })
  })

  // 便于排错：工具注册是否成功（不影响功能区）。
  void toolInjectRan
  void toolRegisterError
}