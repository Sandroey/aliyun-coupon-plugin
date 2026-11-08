/**
 * 阿里云代金券余额 · Client 半侧（多账户版）。
 *
 * 挂载点：
 *  - sidebar.footer.action  侧边栏底部常驻合计余额卡片（折叠时退化为图标）
 *  - sidebar.panellist      左侧图标栏入口
 *  - main (key: aliyun-coupon) 详情面板：合计、逐账户明细、账户增删改、全局设置
 */

window.__ModuleLoader__.load({
  id: '@local/aliyun-coupon',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    const NS = 'aliyun-coupon'
    const CONSOLE_URL = 'https://billing-cost.console.aliyun.com/coupons/coupon'
    const STATE_URL = '/aliyun-coupon/state'
    const REFRESH_URL = '/aliyun-coupon/refresh'
    const ACCOUNTS_URL = '/aliyun-coupon/accounts'
    const ACCOUNT_REMOVE_URL = '/aliyun-coupon/accounts/remove'
    const SETTINGS_URL = '/aliyun-coupon/settings'
    const POLL_MS = 30_000

    /* ------------------------------------------------------------ 文案 */

    const ZH = {
      'chip.label': '代金券',
      'loading': '读取中…',
      'unconfigured': '未配置',
      'unavailable': '暂不可用',
      'panel.title': '阿里云代金券',
      'panel.subtitle': '{n} 个账户 · 每 {m} 分钟刷新',
      'panel.subtitle.none': '尚未添加账户',
      'action.refresh': '刷新全部',
      'action.refreshing': '刷新中…',
      'action.console': '打开卡券控制台',
      'action.add': '添加账户',
      'action.edit': '编辑',
      'action.remove': '移除',
      'action.confirmRemove': '确认移除',
      'action.cancel': '取消',
      'action.expand': '展开 {n} 张',
      'action.collapse': '收起',
      'summary.label': '全部账户可用余额',
      'summary.accounts': '{n} 个账户',
      'summary.coupons': '{n} 张可用',
      'summary.face': '面额合计 {v}',
      'hero.today': '今日',
      'hero.updated': '更新于 {t}',
      'hero.stale': '数据可能已过期',
      'acct.noKey': '未命名账户',
      'acct.updated': '{t}',
      'acct.never': '尚未读取',
      'acct.empty': '该账户没有可用的代金券。',
      'acct.failed': '读取失败',
      'acct.env': '来自环境变量',
      'list.empty': '没有可用的代金券。',
      'list.expiry': '{d} 到期',
      'list.expired': '已过期',
      'expiring.title': '{n} 张券将在 7 天内到期，合计 {v}',
      'setup.title': '添加第一个阿里云账户',
      'setup.desc': '插件通过 BSS OpenAPI 的 QueryCashCoupons 读取余额，需要具备费用中心只读权限（AliyunBSSReadOnlyAccess）的 AccessKey。凭据只保存在本机。',
      'setup.steps': '建议每个账号单独建一个 RAM 用户，只授予 AliyunBSSReadOnlyAccess，再生成 AccessKey。',
      'form.addTitle': '添加账户',
      'form.editTitle': '编辑账户',
      'field.name': '备注名称',
      'field.name.placeholder': '例如：主账号、海外账号',
      'field.ak': 'AccessKey ID',
      'field.sk': 'AccessKey Secret',
      'field.sk.saved': '已保存，留空表示不修改',
      'field.endpoint': '接入点',
      'form.save': '保存并验证',
      'form.saving': '验证中…',
      'form.hint': '保存前会先真实调用一次阿里云接口验证。凭据保存在 {p}',
      'settings.title': '设置',
      'settings.interval': '自动刷新间隔（分钟）',
      'settings.save': '保存设置',
      'settings.saved': '已保存',
      'err.notConfigured': '还没有添加任何阿里云账户。',
      'err.partial': '部分账户读取失败',
    }

    const EN = {
      'chip.label': 'Coupons',
      'loading': 'Loading…',
      'unconfigured': 'Not set',
      'unavailable': 'Unavailable',
      'panel.title': 'Alibaba Cloud Coupons',
      'panel.subtitle': '{n} accounts · refresh every {m} min',
      'panel.subtitle.none': 'No account yet',
      'action.refresh': 'Refresh all',
      'action.refreshing': 'Refreshing…',
      'action.console': 'Open coupon console',
      'action.add': 'Add account',
      'action.edit': 'Edit',
      'action.remove': 'Remove',
      'action.confirmRemove': 'Confirm',
      'action.cancel': 'Cancel',
      'action.expand': 'Show {n} more',
      'action.collapse': 'Collapse',
      'summary.label': 'Total available balance',
      'summary.accounts': '{n} accounts',
      'summary.coupons': '{n} usable',
      'summary.face': 'Face value {v}',
      'hero.today': 'Today',
      'hero.updated': 'Updated {t}',
      'hero.stale': 'Data may be stale',
      'acct.noKey': 'Unnamed account',
      'acct.updated': '{t}',
      'acct.never': 'Never fetched',
      'acct.empty': 'No usable coupons for this account.',
      'acct.failed': 'Fetch failed',
      'acct.env': 'from environment',
      'list.empty': 'No usable coupons.',
      'list.expiry': 'Expires {d}',
      'list.expired': 'Expired',
      'expiring.title': '{n} coupons expire within 7 days, {v} total',
      'setup.title': 'Add your first Alibaba Cloud account',
      'setup.desc': 'Balances come from BSS OpenAPI QueryCashCoupons and need an AccessKey with read-only billing permission (AliyunBSSReadOnlyAccess). Credentials stay on this machine.',
      'setup.steps': 'Create one RAM user per cloud account with only AliyunBSSReadOnlyAccess, then issue its AccessKey.',
      'form.addTitle': 'Add account',
      'form.editTitle': 'Edit account',
      'field.name': 'Label',
      'field.name.placeholder': 'e.g. main account, overseas',
      'field.ak': 'AccessKey ID',
      'field.sk': 'AccessKey Secret',
      'field.sk.saved': 'Saved — leave blank to keep',
      'field.endpoint': 'Endpoint',
      'form.save': 'Save and verify',
      'form.saving': 'Verifying…',
      'form.hint': 'The API is called once before saving. Credentials are stored at {p}',
      'settings.title': 'Settings',
      'settings.interval': 'Refresh interval (minutes)',
      'settings.save': 'Save settings',
      'settings.saved': 'Saved',
      'err.notConfigured': 'No Alibaba Cloud account added yet.',
      'err.partial': 'Some accounts failed',
    }

    /* ------------------------------------------------------------ 格式化 */

    const moneyFormat = new Intl.NumberFormat('zh-CN', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })

    function formatMoney(value) {
      const number = Number(value)
      if (!Number.isFinite(number)) return '¥0.00'
      return `¥${moneyFormat.format(number)}`
    }

    function formatCompact(value) {
      const number = Number(value) || 0
      if (Math.abs(number) >= 10_000) return `¥${(number / 10_000).toFixed(2)}万`
      return formatMoney(number)
    }

    function pad(value) {
      return String(value).padStart(2, '0')
    }

    function formatDate(ts) {
      if (!ts) return '—'
      const date = new Date(ts)
      return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    }

    function formatUpdated(ts) {
      if (!ts) return '—'
      const date = new Date(ts)
      return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
    }

    function openConsole() {
      try {
        window.open(CONSOLE_URL, '_blank', 'noopener,noreferrer')
      } catch {
        /* 宿主可能拦截弹窗，面板里还有普通链接 */
      }
    }

    function fill(template, values) {
      let text = template
      for (const [key, value] of Object.entries(values || {})) {
        text = text.split(`{${key}}`).join(String(value))
      }
      return text
    }

    async function postJson(url, body) {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body || {}),
      })
      let data = null
      try {
        data = await response.json()
      } catch {
        data = null
      }
      return { ok: response.ok, status: response.status, data }
    }

    /* ------------------------------------------------------------ 数据仓库 */

    function createStore() {
      let state = { status: 'idle', data: null, requestError: null, busy: false }
      const listeners = new Set()
      let timer = null
      let refs = 0

      function emit() {
        for (const listener of Array.from(listeners)) {
          try {
            listener()
          } catch {
            /* 单个订阅者异常不影响其它订阅者 */
          }
        }
      }

      function set(patch) {
        state = Object.assign({}, state, patch)
        emit()
      }

      async function load(force) {
        if (state.busy) return
        set({ busy: true })
        try {
          const response = force
            ? await fetch(REFRESH_URL, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: '{}',
              })
            : await fetch(STATE_URL, { cache: 'no-store' })
          const data = await response.json()
          set({ status: 'ready', data, requestError: null, busy: false })
        } catch (error) {
          set({
            status: 'error',
            requestError: error && error.message ? error.message : String(error),
            busy: false,
          })
        }
      }

      function tick() {
        if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
        void load(false)
      }

      return {
        get() {
          return state
        },
        subscribe(listener) {
          listeners.add(listener)
          refs += 1
          if (refs === 1) {
            void load(false)
            timer = setInterval(tick, POLL_MS)
          }
          return () => {
            listeners.delete(listener)
            refs -= 1
            if (refs === 0 && timer !== null) {
              clearInterval(timer)
              timer = null
            }
          }
        },
        reload() {
          return load(true)
        },
        refreshSilent() {
          return load(false)
        },
      }
    }

    const store = createStore()

    function useStore() {
      const [snapshot, setSnapshot] = React.useState(store.get())
      React.useEffect(() => store.subscribe(() => setSnapshot(store.get())), [])
      return snapshot
    }

    /* ------------------------------------------------------------ 图标 */

    function CoinIcon(props) {
      const size = props.size || 16
      return h(
        'svg',
        {
          viewBox: '0 0 16 16',
          width: size,
          height: size,
          fill: 'none',
          'aria-hidden': 'true',
          style: { display: 'block', flex: '0 0 auto' },
        },
        h('circle', { cx: 8, cy: 8, r: 6.6, stroke: 'currentColor', strokeWidth: 1.2 }),
        h('path', {
          d: 'M5.5 4.7 8 7.9l2.5-3.2M8 7.9v3.3M6.4 8.7h3.2M6.4 10.3h3.2',
          stroke: 'currentColor',
          strokeWidth: 1.1,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      )
    }

    function TicketIcon(props) {
      const size = props.size || 20
      return h(
        'svg',
        {
          viewBox: '0 0 24 24',
          width: size,
          height: size,
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.6,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
          style: { display: 'block' },
        },
        h('path', {
          d: 'M3.5 8.2A1.7 1.7 0 0 1 5.2 6.5h13.6a1.7 1.7 0 0 1 1.7 1.7v1.4a2.4 2.4 0 0 0 0 4.8v1.4a1.7 1.7 0 0 1-1.7 1.7H5.2a1.7 1.7 0 0 1-1.7-1.7v-1.4a2.4 2.4 0 0 0 0-4.8z',
        }),
        h('path', { d: 'M14.4 7.6v8.8', strokeDasharray: '1.6 2.2' }),
      )
    }

    /* ------------------------------------------------------------ 样式 */

    const CSS = `
.dsac-chip{display:flex;align-items:center;gap:6px;height:30px;max-width:100%;padding:0 8px;border:1px solid transparent;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:12px;line-height:1;cursor:pointer;overflow:hidden}
.dsac-chip:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.dsac-chip:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}
.dsac-chip-label{flex:0 0 auto;white-space:nowrap}
.dsac-chip-value{flex:0 0 auto;color:var(--dsw-alias-label-primary);font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}
.dsac-chip-rail{width:38px;justify-content:center;padding:0}
.dsac-delta{font-size:11px;font-variant-numeric:tabular-nums;white-space:nowrap}
.dsac-delta.up{color:var(--dsw-alias-state-success-primary)}
.dsac-delta.down{color:var(--dsw-alias-state-warn-primary)}
.dsac-panel{height:100%;overflow:auto;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px}
.dsac-inner{max-width:820px;margin:0 auto;padding:28px 24px 56px;display:flex;flex-direction:column;gap:16px}
.dsac-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;flex-wrap:wrap}
.dsac-title{margin:0;font-size:18px;font-weight:600;letter-spacing:-.2px}
.dsac-sub{margin:5px 0 0;font-size:12px;color:var(--dsw-alias-label-secondary)}
.dsac-actions{display:flex;gap:8px;flex:0 0 auto;flex-wrap:wrap}
.dsac-btn{display:inline-flex;align-items:center;gap:6px;height:30px;padding:0 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;text-decoration:none;cursor:pointer;white-space:nowrap}
.dsac-btn:hover{background:var(--dsw-alias-bg-layer-2)}
.dsac-btn:disabled{opacity:.55;cursor:default}
.dsac-btn.primary{background:var(--dsw-alias-brand-primary);border-color:transparent;color:#fff}
.dsac-btn.ghost{background:transparent;border-color:transparent;color:var(--dsw-alias-label-secondary);padding:0 6px}
.dsac-btn.ghost:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-layer-2)}
.dsac-btn.danger{color:var(--dsw-alias-state-error-primary)}
.dsac-card{border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);padding:18px 20px}
.dsac-summary{display:flex;flex-direction:column;gap:8px}
.dsac-summary-label{font-size:12px;color:var(--dsw-alias-label-secondary)}
.dsac-summary-line{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap}
.dsac-summary-value{font-size:32px;font-weight:650;letter-spacing:-1px;font-variant-numeric:tabular-nums;line-height:1.1}
.dsac-summary-meta{display:flex;gap:14px;flex-wrap:wrap;font-size:12px;color:var(--dsw-alias-label-secondary)}
.dsac-acct{display:flex;flex-direction:column;gap:10px}
.dsac-acct-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.dsac-acct-id{display:flex;align-items:center;gap:8px;min-width:0}
.dsac-acct-name{font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsac-acct-meta{font-size:11px;color:var(--dsw-alias-label-secondary);display:flex;gap:10px;flex-wrap:wrap;margin-top:3px}
.dsac-dot{width:7px;height:7px;border-radius:50%;flex:0 0 auto}
.dsac-dot.ok{background:var(--dsw-alias-state-success-primary)}
.dsac-dot.warn{background:var(--dsw-alias-state-warn-primary)}
.dsac-dot.err{background:var(--dsw-alias-state-error-primary)}
.dsac-dot.idle{background:var(--dsw-alias-state-idle-primary)}
.dsac-acct-total{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap}
.dsac-acct-value{font-size:22px;font-weight:650;font-variant-numeric:tabular-nums;letter-spacing:-.4px}
.dsac-acct-sub{font-size:11px;color:var(--dsw-alias-label-secondary)}
.dsac-spark{margin-top:2px;width:100%;height:52px;display:block}
.dsac-spark-empty{font-size:11px;color:var(--dsw-alias-label-secondary);padding:8px 0}
.dsac-coupon{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:10px 0;border-top:1px solid var(--dsw-alias-border-l1)}
.dsac-coupon:first-child{border-top:0;padding-top:2px}
.dsac-coupon-main{min-width:0;display:flex;flex-direction:column;gap:3px}
.dsac-coupon-name{font-size:13px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dsac-coupon-meta{font-size:11px;color:var(--dsw-alias-label-secondary);display:flex;gap:10px;flex-wrap:wrap}
.dsac-coupon-value{flex:0 0 auto;text-align:right;font-variant-numeric:tabular-nums}
.dsac-coupon-balance{font-size:13px;font-weight:600}
.dsac-coupon-nominal{font-size:11px;color:var(--dsw-alias-label-secondary);text-decoration:line-through}
.dsac-tag{display:inline-flex;align-items:center;height:18px;padding:0 6px;border-radius:6px;font-size:10px;font-weight:600}
.dsac-tag.warn{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 16%,transparent);color:var(--dsw-alias-state-warn-primary)}
.dsac-tag.muted{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
.dsac-notice{padding:10px 12px;border-radius:10px;font-size:12px;line-height:1.55;border:1px solid var(--dsw-alias-border-l1)}
.dsac-notice.warn{border-color:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 40%,var(--dsw-alias-border-l1))}
.dsac-notice.error{border-color:color-mix(in srgb,var(--dsw-alias-state-error-primary) 40%,var(--dsw-alias-border-l1));color:var(--dsw-alias-state-error-primary)}
.dsac-form{display:grid;gap:12px;margin-top:12px}
.dsac-grid2{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.dsac-field{display:grid;gap:6px;min-width:0}
.dsac-label{font-size:12px;color:var(--dsw-alias-label-secondary)}
.dsac-input{height:32px;padding:0 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font:inherit;font-size:13px;min-width:0}
.dsac-input:focus{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-1px}
.dsac-hint{font-size:11px;color:var(--dsw-alias-label-secondary);line-height:1.6}
.dsac-form-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
@media (max-width:520px){.dsac-grid2{grid-template-columns:1fr}.dsac-summary-value{font-size:26px}.dsac-acct-value{font-size:19px}}
`

    function StyleTag() {
      return h('style', { key: 'dsac-styles' }, CSS)
    }

    /* ------------------------------------------------------------ 侧边栏常驻卡片 */

    function FooterChip(props) {
      const t = props.t
      const snapshot = useStore()
      const data = snapshot.data
      const wide = props.wide !== false
      const known = Boolean(data)
      const total = known ? Number(data.total) || 0 : 0
      const delta = known && typeof data.deltaToday === 'number' ? data.deltaToday : null
      const accountCount = known ? Number(data.accountCount) || 0 : 0
      const failed = known ? !data.ok : snapshot.status === 'error'

      let value = t('loading')
      if (known) {
        if (!data.configured) value = t('unconfigured')
        else if (failed && (data.okCount || 0) === 0) value = t('unavailable')
        else value = formatCompact(total)
      }

      let tooltip = t('loading')
      if (known) {
        if (!data.configured) {
          tooltip = t('err.notConfigured')
        } else {
          const lines = (data.accounts || []).map((account) =>
            account.error
              ? `${account.name}：${account.error.message}`
              : `${account.name}：${formatMoney(account.total)}`,
          )
          lines.unshift(`${t('summary.label')} ${formatMoney(total)}`)
          tooltip = lines.join('\n')
        }
      }

      const deltaNode =
        delta !== null && delta !== 0
          ? h(
              'span',
              { className: delta > 0 ? 'dsac-delta up' : 'dsac-delta down' },
              `${delta > 0 ? '+' : '-'}${Math.abs(delta).toFixed(2)}`,
            )
          : null

      const label = accountCount > 1 ? `${t('chip.label')}·${accountCount}` : t('chip.label')

      if (!wide) {
        return h(
          'button',
          { type: 'button', className: 'dsac-chip dsac-chip-rail', title: tooltip, onClick: openConsole },
          h(CoinIcon, { size: 16 }),
        )
      }

      return h(
        'button',
        { type: 'button', className: 'dsac-chip', title: tooltip, onClick: openConsole },
        h(CoinIcon, { size: 15 }),
        h('span', { className: 'dsac-chip-label' }, label),
        h('span', { className: 'dsac-chip-value' }, value),
        deltaNode,
      )
    }

    /* ------------------------------------------------------------ 图标栏入口 */

    function PanelIcon(props) {
      const active = Boolean(props.active)
      return h(
        'span',
        {
          style: {
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
            height: '100%',
            color: active ? 'var(--dsw-alias-brand-primary)' : 'inherit',
          },
        },
        h(TicketIcon, { size: 20 }),
      )
    }

    /* ------------------------------------------------------------ 趋势图 */

    function Sparkline(props) {
      const points = props.points || []
      if (points.length < 2) return h('div', { className: 'dsac-spark-empty' }, props.empty)
      const width = 640
      const height = 52
      const first = points[0]
      const last = points[points.length - 1]
      const spanX = last.t - first.t || 1
      let minValue = Infinity
      let maxValue = -Infinity
      for (const point of points) {
        if (point.total < minValue) minValue = point.total
        if (point.total > maxValue) maxValue = point.total
      }
      const spanY = maxValue - minValue || Math.max(1, maxValue * 0.05)
      const coords = points.map((point) => {
        const x = ((point.t - first.t) / spanX) * width
        const y = height - 6 - ((point.total - minValue) / spanY) * (height - 12)
        return `${x.toFixed(1)},${y.toFixed(1)}`
      })
      const line = coords.join(' ')
      const area = `0,${height} ${line} ${width},${height}`
      return h(
        'svg',
        {
          className: 'dsac-spark',
          viewBox: `0 0 ${width} ${height}`,
          preserveAspectRatio: 'none',
          role: 'img',
          'aria-label': props.label || '',
        },
        h('polygon', { points: area, fill: 'var(--dsw-alias-brand-primary)', opacity: 0.1 }),
        h('polyline', {
          points: line,
          fill: 'none',
          stroke: 'var(--dsw-alias-brand-primary)',
          strokeWidth: 1.6,
          strokeLinejoin: 'round',
          strokeLinecap: 'round',
          vectorEffect: 'non-scaling-stroke',
        }),
      )
    }

    /* ------------------------------------------------------------ 账户表单 */

    function AccountForm(props) {
      const t = props.t
      const account = props.account || null
      const [name, setName] = React.useState(account ? account.name : '')
      const [accessKeyId, setAccessKeyId] = React.useState('')
      const [accessKeySecret, setAccessKeySecret] = React.useState('')
      const [endpoint, setEndpoint] = React.useState(account ? account.endpoint : 'https://business.aliyuncs.com')
      const [busy, setBusy] = React.useState(false)
      const [error, setError] = React.useState(null)

      function submit(event) {
        if (event && typeof event.preventDefault === 'function') event.preventDefault()
        if (busy) return
        setBusy(true)
        setError(null)
        const body = { name: name.trim(), accessKeyId: accessKeyId.trim(), accessKeySecret, endpoint: endpoint.trim() }
        if (account) body.id = account.id
        postJson(ACCOUNTS_URL, { account: body })
          .then(({ ok, data }) => {
            if (!ok || !data || data.ok === false) {
              const detail = (data && data.error) || {}
              setError(`${detail.message || '保存失败'}${detail.hint ? `\n${detail.hint}` : ''}`)
              return
            }
            if (props.onDone) props.onDone()
            void store.refreshSilent()
          })
          .catch((failure) => setError(failure && failure.message ? failure.message : String(failure)))
          .finally(() => setBusy(false))
      }

      return h(
        'form',
        { className: 'dsac-form', onSubmit: submit },
        h(
          'div',
          { className: 'dsac-grid2' },
          h(
            'div',
            { className: 'dsac-field' },
            h('label', { className: 'dsac-label', htmlFor: 'dsac-name' }, t('field.name')),
            h('input', {
              id: 'dsac-name',
              className: 'dsac-input',
              value: name,
              onChange: (event) => setName(event.target.value),
              placeholder: t('field.name.placeholder'),
              maxLength: 60,
            }),
          ),
          h(
            'div',
            { className: 'dsac-field' },
            h('label', { className: 'dsac-label', htmlFor: 'dsac-endpoint' }, t('field.endpoint')),
            h('input', {
              id: 'dsac-endpoint',
              className: 'dsac-input',
              value: endpoint,
              onChange: (event) => setEndpoint(event.target.value),
              placeholder: 'https://business.aliyuncs.com',
              spellCheck: false,
            }),
          ),
        ),
        h(
          'div',
          { className: 'dsac-field' },
          h('label', { className: 'dsac-label', htmlFor: 'dsac-ak' }, t('field.ak')),
          h('input', {
            id: 'dsac-ak',
            className: 'dsac-input',
            value: accessKeyId,
            onChange: (event) => setAccessKeyId(event.target.value),
            placeholder: account ? `${account.accessKeyIdMasked}（留空表示不修改）` : 'LTAI5t…',
            autoComplete: 'off',
            spellCheck: false,
          }),
        ),
        h(
          'div',
          { className: 'dsac-field' },
          h('label', { className: 'dsac-label', htmlFor: 'dsac-sk' }, t('field.sk')),
          h('input', {
            id: 'dsac-sk',
            className: 'dsac-input',
            type: 'password',
            value: accessKeySecret,
            onChange: (event) => setAccessKeySecret(event.target.value),
            placeholder: account ? t('field.sk.saved') : '',
            autoComplete: 'new-password',
            spellCheck: false,
          }),
        ),
        error ? h('div', { className: 'dsac-notice error' }, error) : null,
        h(
          'div',
          { className: 'dsac-form-actions' },
          h('button', { type: 'submit', className: 'dsac-btn primary', disabled: busy }, busy ? t('form.saving') : t('form.save')),
          h(
            'button',
            { type: 'button', className: 'dsac-btn', onClick: props.onCancel, disabled: busy },
            t('action.cancel'),
          ),
          h('span', { className: 'dsac-hint' }, fill(t('form.hint'), { p: props.dataDir || '~/.dsh/aliyun-coupon' })),
        ),
      )
    }

    /* ------------------------------------------------------------ 账户卡片 */

    function AccountCard(props) {
      const t = props.t
      const account = props.account
      const [expanded, setExpanded] = React.useState(false)
      const [confirmRemove, setConfirmRemove] = React.useState(false)
      const [busy, setBusy] = React.useState(false)

      const coupons = account.coupons || []
      const visible = expanded ? coupons : coupons.slice(0, 4)
      const hidden = coupons.length - visible.length
      const delta = typeof account.deltaToday === 'number' ? account.deltaToday : null

      function remove() {
        if (!confirmRemove) {
          setConfirmRemove(true)
          return
        }
        setBusy(true)
        postJson(ACCOUNT_REMOVE_URL, { id: account.id })
          .then(() => store.refreshSilent())
          .catch(() => undefined)
          .finally(() => {
            setBusy(false)
            setConfirmRemove(false)
          })
      }

      const statusClass = account.error ? 'err' : account.ok ? 'ok' : 'idle'

      return h(
        'section',
        { className: 'dsac-card dsac-acct' },
        h(
          'div',
          { className: 'dsac-acct-head' },
          h(
            'div',
            { className: 'dsac-acct-id' },
            h('span', { className: `dsac-dot ${statusClass}`, title: account.error ? account.error.message : '' }),
            h(
              'div',
              { style: { minWidth: 0 } },
              h('div', { className: 'dsac-acct-name' }, account.name),
              h(
                'div',
                { className: 'dsac-acct-meta' },
                h('span', null, account.accessKeyIdMasked || '—'),
                account.persisted === false ? h('span', null, t('acct.env')) : null,
                h('span', null, account.updatedAt ? formatUpdated(account.updatedAt) : t('acct.never')),
              ),
            ),
          ),
          h(
            'div',
            { className: 'dsac-actions' },
            props.onEdit ? h('button', { type: 'button', className: 'dsac-btn ghost', onClick: props.onEdit }, t('action.edit')) : null,
            props.onEdit
              ? h(
                  'button',
                  {
                    type: 'button',
                    className: confirmRemove ? 'dsac-btn ghost danger' : 'dsac-btn ghost',
                    onClick: remove,
                    disabled: busy,
                    onBlur: () => setConfirmRemove(false),
                  },
                  confirmRemove ? t('action.confirmRemove') : t('action.remove'),
                )
              : null,
          ),
        ),

        h(
          'div',
          { className: 'dsac-acct-total' },
          h('span', { className: 'dsac-acct-value' }, formatMoney(account.total)),
          delta !== null && delta !== 0
            ? h(
                'span',
                { className: delta > 0 ? 'dsac-delta up' : 'dsac-delta down', style: { fontSize: '12px' } },
                `${t('hero.today')} ${delta > 0 ? '+' : '-'}${Math.abs(delta).toFixed(2)}`,
              )
            : delta === 0
              ? h('span', { className: 'dsac-delta', style: { fontSize: '11px' } }, `${t('hero.today')} 0.00`)
              : null,
          h(
            'span',
            { className: 'dsac-acct-sub' },
            `${fill(t('summary.coupons'), { n: account.count })} · ${fill(t('summary.face'), { v: formatMoney(account.faceTotal) })}`,
          ),
        ),

        account.error
          ? h(
              'div',
              { className: 'dsac-notice error' },
              `${account.error.message}${account.error.hint ? `\n${account.error.hint}` : ''}`,
            )
          : null,

        account.expiring && account.expiring.length > 0
          ? h(
              'div',
              { className: 'dsac-notice warn' },
              fill(t('expiring.title'), {
                n: account.expiring.length,
                v: formatMoney(account.expiring.reduce((sum, coupon) => sum + (Number(coupon.balance) || 0), 0)),
              }),
            )
          : null,

        h(Sparkline, { points: account.history, empty: t('acct.never'), label: account.name }),

        coupons.length === 0
          ? h('div', { className: 'dsac-hint' }, account.ok ? t('acct.empty') : t('acct.never'))
          : h(
              'div',
              null,
              visible.map((coupon) =>
                h(
                  'div',
                  { className: 'dsac-coupon', key: `${account.id}-${coupon.id || coupon.no || coupon.name}` },
                  h(
                    'div',
                    { className: 'dsac-coupon-main' },
                    h('span', { className: 'dsac-coupon-name', title: coupon.name }, coupon.name),
                    h(
                      'span',
                      { className: 'dsac-coupon-meta' },
                      coupon.expiry ? h('span', null, fill(t('list.expiry'), { d: formatDate(coupon.expiry) })) : null,
                      coupon.available ? null : h('span', { className: 'dsac-tag muted' }, t('list.expired')),
                      coupon.products ? h('span', null, coupon.products) : null,
                    ),
                  ),
                  h(
                    'div',
                    { className: 'dsac-coupon-value' },
                    h('div', { className: 'dsac-coupon-balance' }, formatMoney(coupon.balance)),
                    coupon.nominal > coupon.balance
                      ? h('div', { className: 'dsac-coupon-nominal' }, formatMoney(coupon.nominal))
                      : null,
                  ),
                ),
              ),
              hidden > 0 || expanded
                ? h(
                    'button',
                    {
                      type: 'button',
                      className: 'dsac-btn ghost',
                      style: { marginTop: '6px' },
                      onClick: () => setExpanded((value) => !value),
                    },
                    expanded ? t('action.collapse') : fill(t('action.expand'), { n: hidden }),
                  )
                : null,
            ),
      )
    }

    /* ------------------------------------------------------------ 工厂 */

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const locale = ctx.get('locale')

        if (locale) {
          ctx.effect(() => locale.register(NS, 'zh-CN', ZH))
          ctx.effect(() => locale.register(NS, 'en', EN))
        }

        function useT() {
          const [revision, setRevision] = React.useState(() => {
            try {
              return locale ? locale.getLocale().revision : 0
            } catch {
              return 0
            }
          })
          React.useEffect(() => {
            if (!locale) return undefined
            return locale.subscribe(() => {
              try {
                setRevision(locale.getLocale().revision)
              } catch {
                /* 忽略快照读取失败 */
              }
            })
          }, [])
          return React.useMemo(() => {
            if (!locale) {
              return (key) => ZH[key] || key
            }
            let translate
            try {
              translate = locale.bind(NS)
            } catch {
              translate = null
            }
            return (key) => {
              let value = null
              if (translate) {
                try {
                  value = translate(key)
                } catch {
                  value = null
                }
              }
              if (typeof value !== 'string' || value === '' || value === key) return ZH[key] || key
              return value
            }
          }, [revision])
        }

        function Footer(props) {
          return h(React.Fragment, null, h(StyleTag), h(FooterChip, Object.assign({}, props, { t: useT() })))
        }

        function Panel() {
          const t = useT()
          const snapshot = useStore()
          const data = snapshot.data
          const [busy, setBusy] = React.useState(false)
          const [editing, setEditing] = React.useState(null)
          const [intervalDraft, setIntervalDraft] = React.useState(null)
          const [settingsSaved, setSettingsSaved] = React.useState(false)

          const requestError = snapshot.requestError
          const booting = !data && !requestError
          const configured = data ? Boolean(data.configured) : false
          const accounts = (data && data.accounts) || []
          const total = data ? Number(data.total) || 0 : 0
          const delta = data && typeof data.deltaToday === 'number' ? data.deltaToday : null
          const interval = data ? data.intervalMinutes : 10

          function refresh() {
            if (busy) return
            setBusy(true)
            store.reload().finally(() => setBusy(false))
          }

          function saveSettings() {
            const value = Number(intervalDraft === null ? interval : intervalDraft)
            if (!Number.isFinite(value) || value < 1) return
            setSettingsSaved(false)
            postJson(SETTINGS_URL, { intervalMinutes: value })
              .then(() => {
                setSettingsSaved(true)
                setIntervalDraft(null)
                void store.refreshSilent()
              })
              .catch(() => undefined)
          }

          const subtitle = configured
            ? `${fill(t('panel.subtitle'), { n: accounts.length, m: interval })}`
            : t('panel.subtitle.none')

          const editingAccount =
            editing && editing.mode === 'edit' ? accounts.find((account) => account.id === editing.id) || null : null

          return h(
            React.Fragment,
            null,
            h(StyleTag),
            h(
              'div',
              { className: 'dsac-panel' },
              h(
                'div',
                { className: 'dsac-inner' },
                h(
                  'header',
                  { className: 'dsac-head' },
                  h(
                    'div',
                    null,
                    h('h1', { className: 'dsac-title' }, t('panel.title')),
                    h('p', { className: 'dsac-sub' }, subtitle),
                  ),
                  h(
                    'div',
                    { className: 'dsac-actions' },
                    h(
                      'button',
                      { type: 'button', className: 'dsac-btn', onClick: refresh, disabled: busy || !configured },
                      busy ? t('action.refreshing') : t('action.refresh'),
                    ),
                    h(
                      'button',
                      {
                        type: 'button',
                        className: 'dsac-btn',
                        onClick: () => setEditing(editing && editing.mode === 'add' ? null : { mode: 'add' }),
                      },
                      t('action.add'),
                    ),
                    h('a', { className: 'dsac-btn', href: CONSOLE_URL, target: '_blank', rel: 'noopener noreferrer' }, t('action.console')),
                  ),
                ),

                editing && editing.mode === 'add'
                  ? h(
                      'section',
                      { className: 'dsac-card' },
                      h('h2', { className: 'dsac-title', style: { fontSize: '15px' } }, t('form.addTitle')),
                      h(AccountForm, {
                        t,
                        account: null,
                        dataDir: data && data.dataDir,
                        onDone: () => setEditing(null),
                        onCancel: () => setEditing(null),
                      }),
                    )
                  : null,

                editing && editing.mode === 'edit' && editingAccount
                  ? h(
                      'section',
                      { className: 'dsac-card' },
                      h('h2', { className: 'dsac-title', style: { fontSize: '15px' } }, `${t('form.editTitle')} · ${editingAccount.name}`),
                      h(AccountForm, {
                        t,
                        account: editingAccount,
                        dataDir: data && data.dataDir,
                        onDone: () => setEditing(null),
                        onCancel: () => setEditing(null),
                      }),
                    )
                  : null,

                booting
                  ? h('section', { className: 'dsac-card' }, h('p', { className: 'dsac-hint', style: { margin: 0 } }, t('loading')))
                  : !configured
                    ? h(
                        'section',
                        { className: 'dsac-card' },
                        h('h2', { className: 'dsac-title', style: { fontSize: '15px', marginBottom: '6px' } }, t('setup.title')),
                        h('p', { className: 'dsac-hint', style: { marginTop: 0 } }, t('setup.desc')),
                        h('p', { className: 'dsac-hint' }, t('setup.steps')),
                      )
                    : h(
                        'section',
                        { className: 'dsac-card dsac-summary' },
                        h('span', { className: 'dsac-summary-label' }, t('summary.label')),
                        h(
                          'div',
                          { className: 'dsac-summary-line' },
                          h('span', { className: 'dsac-summary-value' }, formatMoney(total)),
                          delta !== null && delta !== 0
                            ? h(
                                'span',
                                { className: delta > 0 ? 'dsac-delta up' : 'dsac-delta down', style: { fontSize: '13px' } },
                                `${t('hero.today')} ${delta > 0 ? '+' : '-'}${Math.abs(delta).toFixed(2)}`,
                              )
                            : null,
                        ),
                        h(
                          'div',
                          { className: 'dsac-summary-meta' },
                          h('span', null, fill(t('summary.accounts'), { n: accounts.length })),
                          h('span', null, fill(t('summary.coupons'), { n: data.count })),
                          h('span', null, fill(t('summary.face'), { v: formatMoney(data.faceTotal) })),
                          data.updatedAt ? h('span', null, fill(t('hero.updated'), { t: formatUpdated(data.updatedAt) })) : null,
                          data.stale ? h('span', null, t('hero.stale')) : null,
                        ),
                      ),

                requestError ? h('div', { className: 'dsac-notice error' }, requestError) : null,

                configured && data && data.partial
                  ? h('div', { className: 'dsac-notice warn' }, t('err.partial'))
                  : null,

                configured
                  ? accounts.map((account) =>
                      h(AccountCard, {
                        key: account.id,
                        t,
                        account,
                        onEdit:
                          account.persisted === false
                            ? null
                            : () =>
                                setEditing((current) =>
                                  current && current.mode === 'edit' && current.id === account.id
                                    ? null
                                    : { mode: 'edit', id: account.id },
                                ),
                      }),
                    )
                  : null,

                configured
                  ? h(
                      'section',
                      { className: 'dsac-card' },
                      h(
                        'div',
                        { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' } },
                        h('span', { className: 'dsac-label' }, t('settings.interval')),
                        h(
                          'div',
                          { className: 'dsac-form-actions' },
                          h('input', {
                            className: 'dsac-input',
                            type: 'number',
                            min: 1,
                            max: 240,
                            value: intervalDraft === null ? String(interval) : intervalDraft,
                            onChange: (event) => setIntervalDraft(event.target.value),
                            style: { width: '90px' },
                          }),
                          h('button', { type: 'button', className: 'dsac-btn', onClick: saveSettings }, t('settings.save')),
                          settingsSaved ? h('span', { className: 'dsac-hint' }, t('settings.saved')) : null,
                        ),
                      ),
                    )
                  : null,
              ),
            ),
          )
        }

        const registerFooter = () =>
          ctx.slots.register({ name: 'sidebar.footer.action', id: 'aliyun-coupon-footer', order: 5 }, Footer)

        const registerPanelIcon = () =>
          ctx.slots.register(
            {
              name: 'sidebar.panellist',
              id: 'aliyun-coupon',
              order: 20,
              label: () => {
                const translate = locale
                  ? (() => {
                      try {
                        return locale.bind(NS)
                      } catch {
                        return null
                      }
                    })()
                  : null
                return translate ? translate('panel.title') : '阿里云代金券'
              },
            },
            PanelIcon,
          )

        const registerMain = () => ctx.slots.register({ name: 'main', key: 'aliyun-coupon' }, Panel)

        ctx.slots.inject('sidebar.footer.action', registerFooter)
        ctx.slots.inject('sidebar.panellist', registerPanelIcon)
        ctx.slots.inject('main', registerMain)
      },
    }
  },
})