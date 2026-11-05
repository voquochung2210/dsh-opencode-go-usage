/**
 * dsh-opencode-go-usage — Client half.
 *
 * Registers one right-sidebar tab type ("opencode-go-usage") with a guide
 * card, a tab title, and the panel body. The body reads the Host route
 * `GET /opencode-go-usage/status?range=...` and renders:
 *
 *   - the three OpenCode Go quota windows (rolling 5 hours, week, month);
 *   - cost / requests / tokens for the selected range;
 *   - a cost-or-token chart, hourly for 24h and daily otherwise;
 *   - per-model usage for the selected range.
 *
 * Range state is view-only: switching it refetches from the Host route.
 */
window.__ModuleLoader__.load({
  id: 'dsh-opencode-go-usage',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const useEffect = React.useEffect
    const useMemo = React.useMemo
    const useState = React.useState

    const PLUGIN_ID = 'dsh-opencode-go-usage'
    const TAB_KIND = 'opencode-go-usage'
    const NS = 'opencodeGoUsage'
    const ENDPOINT = '/opencode-go-usage/status'
    const POLL_MS = 60_000
    const CLOCK_MS = 15_000
    const RANGES = ['24h', '7d', '30d', '6m', 'all']
    /** Copy-key suffix per range id (`24h` is not a valid path segment head). */
    const RANGE_KEY = { '24h': 'h24', '7d': 'd7', '30d': 'd30', '6m': 'm6', all: 'all' }
    const DEFAULT_RANGE = '24h'
    const MAX_MODELS = 6

    //#region copy
    const EN = {
      tab: { title: 'OpenCode Go' },
      panel: {
        title: 'OpenCode Go',
        subtitle: 'Plan usage & spend',
        refresh: 'Refresh usage',
        updated: 'Updated',
        source: 'opencode.ai',
      },
      guide: {
        title: 'OpenCode Go',
        description: 'Plan usage, cost, requests and tokens',
      },
      sub: {
        renewsIn: 'Renews in',
        endsIn: 'Ends in',
        cancelled: 'Cancelled',
        expired: 'Subscription ended',
        tooltip: 'Subscription period ends',
      },
      labels: { session: '5 hours', week: 'Week', month: 'Month' },
      meta: { resetIn: 'resets in', resetDue: 'resetting', unavailable: 'no reset reported' },
      unit: { now: 'now', m: 'm', h: 'h', d: 'd' },
      range: {
        label: 'Time range',
        h24: '24 hours',
        d7: '7 days',
        d30: '30 days',
        m6: '6 months',
        all: 'All time',
        short: { h24: '24h', d7: '7d', d30: '30d', m6: '6m', all: 'All' },
      },
      stats: {
        title: 'Usage in range',
        cost: 'Cost',
        requests: 'Requests',
        tokens: 'Tokens',
        tokensUnit: 'tokens',
        requestsUnit: 'req',
        daily: 'Daily',
        hourly: 'Hourly',
        byModel: 'Usage by model',
        empty: 'No usage recorded in this range',
        noModels: 'No model usage recorded',
        unavailable: 'Spend details could not be loaded',
        retry: 'Try again',
      },
      state: { loading: 'Reading usage…' },
      error: {
        title: 'Usage unavailable',
        stale: 'Refresh failed — showing the last reading',
        retry: 'Try again',
        no_auth: 'No opencode credential file found. Run `opencode auth login` and sign in to OpenCode Go.',
        no_key: 'No OpenCode Go API key in auth.json. Run `opencode auth login`, or set OPENCODE_GO_API_KEY.',
        unauthorized: 'opencode.ai rejected the API key. Sign in again with `opencode auth login`.',
        network: 'Could not reach opencode.ai. Check the network or proxy.',
        upstream: 'opencode.ai did not return usable usage data.',
        internal: 'The usage reader failed unexpectedly.',
        bad_range: 'The usage endpoint refused this range.',
        method_not_allowed: 'The usage endpoint refused the request.',
      },
    }

    const VI = {
      tab: { title: 'OpenCode Go' },
      panel: {
        title: 'OpenCode Go',
        subtitle: 'Mức dùng & chi phí',
        refresh: 'Làm mới mức dùng',
        updated: 'Cập nhật',
        source: 'opencode.ai',
      },
      guide: {
        title: 'OpenCode Go',
        description: 'Mức dùng, chi phí, request và token',
      },
      sub: {
        renewsIn: 'Gia hạn sau',
        endsIn: 'Kết thúc sau',
        cancelled: 'Đã huỷ',
        expired: 'Gói đã hết hạn',
        tooltip: 'Gói kết thúc vào',
      },
      labels: { session: '5 giờ', week: 'Tuần', month: 'Tháng' },
      meta: { resetIn: 'đặt lại sau', resetDue: 'đang đặt lại', unavailable: 'chưa có mốc đặt lại' },
      unit: { now: 'bây giờ', m: 'p', h: 'g', d: 'n' },
      range: {
        label: 'Khoảng thời gian',
        h24: '24 giờ',
        d7: '7 ngày',
        d30: '30 ngày',
        m6: '6 tháng',
        all: 'Tất cả',
        short: { h24: '24h', d7: '7d', d30: '30d', m6: '6m', all: 'Tất cả' },
      },
      stats: {
        title: 'Mức dùng trong khoảng',
        cost: 'Chi phí',
        requests: 'Request',
        tokens: 'Token',
        tokensUnit: 'token',
        requestsUnit: 'req',
        daily: 'Theo ngày',
        hourly: 'Theo giờ',
        byModel: 'Dùng theo model',
        empty: 'Chưa có dữ liệu trong khoảng này',
        noModels: 'Chưa có dữ liệu theo model',
        unavailable: 'Không tải được chi tiết chi phí',
        retry: 'Thử lại',
      },
      state: { loading: 'Đang đọc mức dùng…' },
      error: {
        title: 'Không đọc được mức dùng',
        stale: 'Làm mới thất bại — đang hiển thị số liệu lần trước',
        retry: 'Thử lại',
        no_auth: 'Không thấy tệp đăng nhập opencode. Chạy `opencode auth login` rồi chọn OpenCode Go.',
        no_key: 'auth.json chưa có API key OpenCode Go. Chạy `opencode auth login` hoặc đặt OPENCODE_GO_API_KEY.',
        unauthorized: 'opencode.ai từ chối API key. Đăng nhập lại bằng `opencode auth login`.',
        network: 'Không kết nối được opencode.ai. Kiểm tra mạng hoặc proxy.',
        upstream: 'opencode.ai không trả về dữ liệu mức dùng.',
        internal: 'Bộ đọc mức dùng gặp lỗi.',
        bad_range: 'Endpoint mức dùng từ chối khoảng thời gian này.',
        method_not_allowed: 'Endpoint mức dùng từ chối yêu cầu.',
      },
    }

    const ZH = {
      tab: { title: 'OpenCode Go' },
      panel: {
        title: 'OpenCode Go',
        subtitle: '套餐用量与消费',
        refresh: '刷新用量',
        updated: '更新于',
        source: 'opencode.ai',
      },
      guide: {
        title: 'OpenCode Go',
        description: '用量、费用、请求与 Token',
      },
      sub: {
        renewsIn: '续订于',
        endsIn: '距结束',
        cancelled: '已取消',
        expired: '订阅已到期',
        tooltip: '订阅结束于',
      },
      labels: { session: '5 小时', week: '本周', month: '本月' },
      meta: { resetIn: '重置于', resetDue: '正在重置', unavailable: '无重置时间' },
      unit: { now: '现在', m: '分', h: '时', d: '天' },
      range: {
        label: '时间区间',
        h24: '24 小时',
        d7: '7 天',
        d30: '30 天',
        m6: '6 个月',
        all: '全部',
        short: { h24: '24h', d7: '7d', d30: '30d', m6: '6m', all: '全部' },
      },
      stats: {
        title: '区间用量',
        cost: '费用',
        requests: '请求数',
        tokens: 'Token',
        tokensUnit: 'token',
        requestsUnit: 'req',
        daily: '按日',
        hourly: '按小时',
        byModel: '按模型用量',
        empty: '该区间没有用量',
        noModels: '没有按模型的用量',
        unavailable: '无法加载费用明细',
        retry: '重试',
      },
      state: { loading: '正在读取用量…' },
      error: {
        title: '无法读取用量',
        stale: '刷新失败，正在显示上次数据',
        retry: '重试',
        no_auth: '未找到 opencode 凭据文件。请运行 `opencode auth login`。',
        no_key: 'auth.json 中没有 OpenCode Go API 密钥。请登录或设置 OPENCODE_GO_API_KEY。',
        unauthorized: 'opencode.ai 拒绝了该 API 密钥。请重新运行 `opencode auth login`。',
        network: '无法连接 opencode.ai，请检查网络或代理。',
        upstream: 'opencode.ai 未返回可用的用量数据。',
        internal: '用量读取器发生意外错误。',
        bad_range: '用量端点拒绝了该时间区间。',
        method_not_allowed: '用量端点拒绝了该请求。',
      },
    }
    //#endregion

    function lookup(dict, path) {
      let node = dict
      for (const part of path.split('.')) {
        if (node === null || typeof node !== 'object') return undefined
        node = node[part]
      }
      return typeof node === 'string' ? node : undefined
    }

    /** Wrap the locale service's translate so a missing key falls back to English. */
    function translator(translate) {
      return (path) => {
        let value
        if (typeof translate === 'function') {
          try {
            value = translate(path)
          } catch {
            value = undefined
          }
        }
        if (typeof value !== 'string' || value === '' || value === path) return lookup(EN, path) ?? path
        return value
      }
    }

    function pad2(value) {
      return String(value).padStart(2, '0')
    }

    function fmtClock(date) {
      if (!(date instanceof Date) || Number.isNaN(date.getTime())) return ''
      return pad2(date.getHours()) + ':' + pad2(date.getMinutes()) + ':' + pad2(date.getSeconds())
    }

    function fmtPercent(percent) {
      const rounded = Math.round(percent * 10) / 10
      return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)
    }

    function fmtInt(value) {
      if (!Number.isFinite(value)) return '0'
      return Math.round(value).toLocaleString()
    }

    /** Compact token counts: 1.2K, 3.4M, 5.6B. */
    function fmtCompact(value) {
      const amount = Number.isFinite(value) ? Math.max(0, value) : 0
      if (amount >= 1e9) return trimZero((amount / 1e9).toFixed(1)) + 'B'
      if (amount >= 1e6) return trimZero((amount / 1e6).toFixed(1)) + 'M'
      if (amount >= 1e3) return trimZero((amount / 1e3).toFixed(1)) + 'K'
      return String(Math.round(amount))
    }

    function trimZero(text) {
      return text.endsWith('.0') ? text.slice(0, -2) : text
    }

    /** US-dollar cost: $2.97, $0.253, $84.76. */
    function fmtMoney(value) {
      const amount = Number.isFinite(value) ? value : 0
      const abs = Math.abs(amount)
      if (abs >= 100) return '$' + Math.round(amount).toLocaleString()
      if (abs >= 0.01) return '$' + amount.toFixed(2)
      if (abs === 0) return '$0'
      return '$' + amount.toFixed(4)
    }

    function fmtDuration(ms, tr) {
      const minutes = Math.round(Math.max(0, ms) / 60_000)
      if (minutes < 1) return tr('unit.now')
      if (minutes < 60) return minutes + tr('unit.m')
      const hours = Math.floor(minutes / 60)
      if (hours < 24) {
        const rest = minutes % 60
        return hours + tr('unit.h') + (rest === 0 ? '' : ' ' + rest + tr('unit.m'))
      }
      const days = Math.floor(hours / 24)
      const restHours = hours % 24
      return days + tr('unit.d') + (restHours === 0 ? '' : ' ' + restHours + tr('unit.h'))
    }

    function toneOf(percent) {
      if (percent === null || percent === undefined) return 'idle'
      if (percent >= 85) return 'crit'
      if (percent >= 60) return 'warn'
      return 'ok'
    }

    /** Axis/tooltip label for one series bucket. */
    function fmtBucket(at, hourly) {
      if (typeof at !== 'string' || at === '') return ''
      if (hourly) {
        const date = new Date(at)
        if (!Number.isNaN(date.getTime())) return pad2(date.getHours()) + ':' + pad2(date.getMinutes())
        return at.slice(11, 16)
      }
      const day = at.slice(0, 10)
      return day.length >= 10 ? day.slice(5).replace('-', '/') : day
    }

    function modelName(model) {
      if (typeof model !== 'string') return ''
      const slash = model.lastIndexOf('/')
      return slash === -1 ? model : model.slice(slash + 1)
    }

    //#region icons
    function GoGlyph({ size = 22, className }) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          className,
          fill: 'none',
          xmlns: 'http://www.w3.org/2000/svg',
          'aria-hidden': 'true',
          focusable: 'false',
        },
        h('path', {
          d: 'M4 17a8 8 0 1 1 16 0',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
        }),
        h('path', {
          d: 'M12 17l4.4-5.6',
          stroke: 'currentColor',
          strokeWidth: 1.7,
          strokeLinecap: 'round',
        }),
        h('circle', { cx: 12, cy: 17, r: 1.6, fill: 'currentColor' }),
      )
    }

    function RefreshGlyph({ size = 15 }) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          xmlns: 'http://www.w3.org/2000/svg',
          'aria-hidden': 'true',
          focusable: 'false',
        },
        h('path', {
          d: 'M20 12a8 8 0 1 1-2.4-5.7',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
        }),
        h('path', {
          d: 'M20 4.5V10h-5.5',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      )
    }
    function ClockGlyph({ size = 12 }) {
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          xmlns: 'http://www.w3.org/2000/svg',
          'aria-hidden': 'true',
          focusable: 'false',
        },
        h('circle', { cx: 12, cy: 12, r: 8.4, stroke: 'currentColor', strokeWidth: 1.8 }),
        h('path', {
          d: 'M12 7.4V12l3 2',
          stroke: 'currentColor',
          strokeWidth: 1.8,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        }),
      )
    }
    //#endregion

    //#region styles
    const CSS = `
.ogp-root {
  --ogp-radius: 12px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  gap: 12px;
  width: 100%;
  min-height: 100%;
  padding: 14px 14px 16px;
  color: var(--dsw-alias-label-primary, #e8ebf2);
  font-size: 13px;
  line-height: 1.45;
  overflow-y: auto;
}
.ogp-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}
.ogp-head-text { min-width: 0; }
.ogp-title {
  font-size: 14px;
  font-weight: 600;
  letter-spacing: .2px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ogp-subtitle {
  margin-top: 2px;
  font-size: 11.5px;
  color: var(--dsw-alias-label-secondary, #9aa4b6);
}
.ogp-sub {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin-top: 4px;
  font-size: 11px;
  line-height: 1.3;
  color: var(--dsw-alias-label-secondary, #9aa4b6);
}
.ogp-sub.is-warn {
  color: color-mix(in srgb, var(--dsw-alias-state-error-primary, #ff5c5c) 62%, var(--dsw-alias-state-warn-primary, #ffb020));
}
.ogp-sub svg { flex: none; margin-top: -1px; }
.ogp-refresh {
  flex: none;
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, .1));
  border-radius: 8px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #9aa4b6);
  cursor: pointer;
  transition: background .15s ease, color .15s ease, border-color .15s ease;
}
.ogp-refresh:hover:not(:disabled) {
  background: var(--dsw-alias-bg-layer-2, rgba(255, 255, 255, .06));
  border-color: var(--dsw-alias-border-l2, rgba(255, 255, 255, .18));
  color: var(--dsw-alias-label-primary, #e8ebf2);
}
.ogp-refresh:disabled { opacity: .55; cursor: default; }
.ogp-refresh.is-busy svg { animation: ogp-spin 900ms linear infinite; }
.ogp-cards { display: flex; flex-direction: column; gap: 10px; }
.ogp-card {
  --ogp-tone: var(--dsw-alias-brand-primary, #4c8dff);
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 11px 12px 11px 15px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, .1));
  border-radius: var(--ogp-radius);
  background: var(--dsw-alias-bg-layer-1, rgba(255, 255, 255, .035));
}
.ogp-card::before {
  content: "";
  position: absolute;
  left: 0;
  top: 10px;
  bottom: 10px;
  width: 3px;
  border-radius: 999px;
  background: var(--ogp-tone);
  opacity: .95;
}
.ogp-card[data-tone="warn"] { --ogp-tone: var(--dsw-alias-state-warn-primary, #f5a623); }
.ogp-card[data-tone="crit"] { --ogp-tone: var(--dsw-alias-state-error-primary, #ff6b6b); }
.ogp-card[data-tone="idle"] { --ogp-tone: var(--dsw-alias-state-idle-primary, #8a94a6); }
.ogp-card-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.ogp-card-label {
  font-size: 12.5px;
  font-weight: 500;
  color: var(--dsw-alias-label-secondary, #9aa4b6);
}
.ogp-card-value {
  font-size: 21px;
  font-weight: 650;
  letter-spacing: -.4px;
  font-variant-numeric: tabular-nums;
  color: var(--ogp-tone);
}
.ogp-bar {
  position: relative;
  height: 6px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--ogp-tone) 16%, transparent);
  overflow: hidden;
}
.ogp-bar-fill {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: var(--ogp-tone);
  transition: width .45s ease;
}
.ogp-card-meta {
  font-size: 11.5px;
  color: var(--dsw-alias-label-secondary, #9aa4b6);
}
.ogp-status-pill {
  flex: none;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: .6px;
  text-transform: uppercase;
  color: var(--dsw-alias-state-warn-primary, #f5a623);
  background: color-mix(in srgb, var(--dsw-alias-state-warn-primary, #f5a623) 16%, transparent);
}
.ogp-section { display: flex; flex-direction: column; gap: 10px; }
.ogp-section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.ogp-section-title {
  font-size: 11px;
  font-weight: 650;
  letter-spacing: .7px;
  text-transform: uppercase;
  color: var(--dsw-alias-label-secondary, #9aa4b6);
  white-space: nowrap;
}
.ogp-range {
  display: inline-flex;
  gap: 2px;
  padding: 2px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, .1));
  border-radius: 9px;
  background: var(--dsw-alias-bg-layer-1, rgba(255, 255, 255, .035));
}
.ogp-range-btn {
  padding: 3px 7px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #9aa4b6);
  font-size: 10.5px;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  transition: background .15s ease, color .15s ease;
}
.ogp-range-btn:hover {
  background: color-mix(in srgb, var(--dsw-alias-label-primary, #e8ebf2) 6%, transparent);
  color: var(--dsw-alias-label-primary, #e8ebf2);
}
.ogp-range-btn.is-active {
  background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4c8dff) 22%, transparent);
  color: var(--dsw-alias-label-primary, #e8ebf2);
}
.ogp-tiles {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 8px;
}
.ogp-tile {
  min-width: 0;
  padding: 9px 10px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, .1));
  border-radius: 10px;
  background: var(--dsw-alias-bg-layer-1, rgba(255, 255, 255, .035));
}
.ogp-tile-label {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: .5px;
  text-transform: uppercase;
  color: var(--dsw-alias-label-secondary, #9aa4b6);
}
.ogp-tile-value {
  margin-top: 3px;
  font-size: 16px;
  font-weight: 650;
  letter-spacing: -.3px;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ogp-chart {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 10px 8px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, .1));
  border-radius: var(--ogp-radius);
  background: var(--dsw-alias-bg-layer-1, rgba(255, 255, 255, .035));
}
.ogp-chart-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
.ogp-chart-title {
  font-size: 11.5px;
  font-weight: 600;
  color: var(--dsw-alias-label-secondary, #9aa4b6);
}
.ogp-metric { display: inline-flex; gap: 2px; }
.ogp-metric-btn {
  padding: 2px 7px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--dsw-alias-label-secondary, #9aa4b6);
  font-size: 10px;
  font-weight: 600;
  cursor: pointer;
}
.ogp-metric-btn:hover { color: var(--dsw-alias-label-primary, #e8ebf2); }
.ogp-metric-btn.is-active {
  background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4c8dff) 18%, transparent);
  color: var(--dsw-alias-brand-primary, #4c8dff);
}
.ogp-bars {
  display: flex;
  align-items: flex-end;
  gap: 2px;
  height: 86px;
}
.ogp-bar-col {
  flex: 1 1 0;
  min-width: 1px;
  height: 100%;
  display: flex;
  align-items: flex-end;
  cursor: default;
}
.ogp-bar-col > span {
  display: block;
  width: 100%;
  border-radius: 2px 2px 0 0;
  background: linear-gradient(180deg, var(--dsw-alias-brand-primary, #4c8dff), color-mix(in srgb, var(--dsw-alias-brand-primary, #4c8dff) 55%, transparent));
  opacity: .82;
  transition: opacity .15s ease, height .3s ease;
}
.ogp-bar-col:hover > span { opacity: 1; }
.ogp-chart-axis {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 10px;
  color: var(--dsw-alias-label-secondary, #9aa4b6);
  opacity: .85;
  font-variant-numeric: tabular-nums;
}
.ogp-models {
  display: flex;
  flex-direction: column;
  gap: 9px;
  padding: 10px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, .1));
  border-radius: var(--ogp-radius);
  background: var(--dsw-alias-bg-layer-1, rgba(255, 255, 255, .035));
}
.ogp-model { display: flex; flex-direction: column; gap: 3px; }
.ogp-model-row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.ogp-model-name {
  min-width: 0;
  font-size: 12px;
  font-weight: 550;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ogp-model-cost {
  flex: none;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--dsw-alias-label-secondary, #9aa4b6);
}
.ogp-model-share {
  height: 3px;
  border-radius: 999px;
  background: var(--dsw-alias-bg-layer-2, rgba(255, 255, 255, .07));
  overflow: hidden;
}
.ogp-model-share > span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: color-mix(in srgb, var(--dsw-alias-brand-primary, #4c8dff) 70%, transparent);
}
.ogp-model-meta {
  font-size: 10.5px;
  color: var(--dsw-alias-label-secondary, #9aa4b6);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.ogp-empty {
  padding: 6px 2px;
  font-size: 11.5px;
  color: var(--dsw-alias-label-secondary, #9aa4b6);
}
.ogp-skeleton {
  height: 88px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, .08));
  border-radius: var(--ogp-radius);
  background: linear-gradient(
    100deg,
    var(--dsw-alias-bg-layer-1, rgba(255, 255, 255, .03)) 20%,
    var(--dsw-alias-bg-layer-2, rgba(255, 255, 255, .07)) 38%,
    var(--dsw-alias-bg-layer-1, rgba(255, 255, 255, .03)) 56%
  );
  background-size: 220% 100%;
  animation: ogp-shimmer 1.5s ease-in-out infinite;
}
.ogp-skeleton.is-short { height: 52px; }
.ogp-skeleton.is-chart { height: 104px; }
.ogp-error {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  border: 1px solid color-mix(in srgb, var(--dsw-alias-state-error-primary, #ff6b6b) 38%, transparent);
  border-radius: 10px;
  background: color-mix(in srgb, var(--dsw-alias-state-error-primary, #ff6b6b) 9%, transparent);
}
.ogp-error.is-compact { gap: 4px; padding: 7px 10px; }
.ogp-error.is-compact .ogp-error-detail { display: none; }
.ogp-error.is-compact .ogp-error-retry { margin-top: 0; padding: 3px 9px; font-size: 11.5px; }
.ogp-error-title {
  font-size: 12.5px;
  font-weight: 600;
  color: var(--dsw-alias-state-error-primary, #ff6b6b);
}
.ogp-error-text { font-size: 12px; color: var(--dsw-alias-label-primary, #e8ebf2); }
.ogp-error-detail {
  max-height: 72px;
  overflow: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10.5px;
  line-height: 1.4;
  color: var(--dsw-alias-label-secondary, #9aa4b6);
  word-break: break-word;
}
.ogp-error-retry {
  align-self: flex-start;
  margin-top: 2px;
  padding: 4px 10px;
  border: 1px solid var(--dsw-alias-border-l1, rgba(255, 255, 255, .12));
  border-radius: 7px;
  background: var(--dsw-alias-bg-layer-2, rgba(255, 255, 255, .06));
  color: var(--dsw-alias-label-primary, #e8ebf2);
  font-size: 12px;
  cursor: pointer;
}
.ogp-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: auto;
  padding-top: 4px;
  font-size: 11px;
  color: var(--dsw-alias-label-secondary, #9aa4b6);
}
.ogp-foot-src { opacity: .8; }
.ogp-tab-title { display: inline-flex; align-items: center; gap: 6px; }
@keyframes ogp-spin { to { transform: rotate(360deg); } }
@keyframes ogp-shimmer { 0% { background-position: 120% 0; } 100% { background-position: -120% 0; } }
@media (prefers-reduced-motion: reduce) {
  .ogp-refresh.is-busy svg, .ogp-skeleton { animation: none; }
  .ogp-bar-fill, .ogp-bar-col > span { transition: none; }
}
`

    function installStyles() {
      if (typeof document === 'undefined') return () => {}
      const selector = 'style[data-plugin-css="' + PLUGIN_ID + '/panel.css"]'
      if (document.querySelector(selector) !== null) return () => {}
      const tag = document.createElement('style')
      tag.dataset.plugin = PLUGIN_ID
      tag.dataset.pluginCss = PLUGIN_ID + '/panel.css'
      tag.textContent = CSS
      document.head.appendChild(tag)
      return () => {
        tag.remove()
      }
    }
    //#endregion

    //#region data
    function useUsage(range) {
      const [request, setRequest] = useState({ force: false, nonce: 0 })
      const [state, setState] = useState({ busy: true, data: null, error: null })

      useEffect(() => {
        let cancelled = false
        const controller = new AbortController()

        const load = async (force) => {
          setState((prev) => (prev.busy ? prev : { ...prev, busy: true }))
          try {
            const query = '?range=' + encodeURIComponent(range) + (force ? '&refresh=1' : '')
            const response = await fetch(ENDPOINT + query, {
              signal: controller.signal,
              headers: { accept: 'application/json' },
              cache: 'no-store',
            })
            const body = await response.json()
            if (cancelled) return
            if (body !== null && typeof body === 'object' && body.ok === true) {
              setState({ busy: false, data: body, error: null })
              return
            }
            const error =
              body !== null && typeof body === 'object' && body.error
                ? body.error
                : { code: 'upstream', message: 'Unexpected response from ' + ENDPOINT }
            setState((prev) => ({ busy: false, data: prev.data, error }))
          } catch (error) {
            if (cancelled || controller.signal.aborted) return
            setState((prev) => ({
              busy: false,
              data: prev.data,
              error: { code: 'network', message: String((error && error.message) || error) },
            }))
          }
        }

        load(request.force)
        const timer = setInterval(() => {
          if (document.visibilityState === 'visible') load(false)
        }, POLL_MS)
        const onVisibility = () => {
          if (document.visibilityState === 'visible') load(false)
        }
        document.addEventListener('visibilitychange', onVisibility)

        return () => {
          cancelled = true
          controller.abort()
          clearInterval(timer)
          document.removeEventListener('visibilitychange', onVisibility)
        }
      }, [range, request])

      const refresh = () => setRequest((prev) => ({ force: true, nonce: prev.nonce + 1 }))
      return { ...state, refresh }
    }

    function useNow(interval) {
      const [now, setNow] = useState(() => Date.now())
      useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), interval)
        return () => clearInterval(timer)
      }, [interval])
      return now
    }
    //#endregion

    //#region components
    function UsageCard({ label, win, tr, now }) {
      const percent = win !== null && win !== undefined && typeof win.percent === 'number' ? win.percent : null
      const tone = toneOf(percent)
      const resetAt = win !== null && win !== undefined && typeof win.resetsAt === 'string' ? new Date(win.resetsAt) : null
      const hasReset = resetAt !== null && !Number.isNaN(resetAt.getTime())

      const resetText = hasReset
        ? resetAt.getTime() <= now
          ? tr('meta.resetDue')
          : tr('meta.resetIn') + ' ' + fmtDuration(resetAt.getTime() - now, tr)
        : tr('meta.unavailable')

      return h(
        'div',
        { className: 'ogp-card', 'data-tone': tone },
        h(
          'div',
          { className: 'ogp-card-row' },
          h('span', { className: 'ogp-card-label' }, label),
          h('span', { className: 'ogp-card-value' }, percent === null ? '—' : fmtPercent(percent) + '%'),
        ),
        h(
          'div',
          {
            className: 'ogp-bar',
            role: 'progressbar',
            'aria-label': label,
            'aria-valuemin': 0,
            'aria-valuemax': 100,
            'aria-valuenow': percent === null ? 0 : Math.round(percent),
          },
          h('span', {
            className: 'ogp-bar-fill',
            style: { width: (percent === null ? 0 : Math.max(0, Math.min(100, percent))) + '%' },
          }),
        ),
        h(
          'div',
          { className: 'ogp-card-row ogp-card-meta' },
          h('span', { className: 'ogp-meta-reset', title: hasReset ? resetAt.toLocaleString() : undefined }, resetText),
          win !== null && win !== undefined && win.status && win.status !== 'ok'
            ? h('span', { className: 'ogp-status-pill' }, win.status)
            : null,
        ),
      )
    }

    function StatTile({ label, value, title }) {
      return h(
        'div',
        { className: 'ogp-tile', title },
        h('div', { className: 'ogp-tile-label' }, label),
        h('div', { className: 'ogp-tile-value' }, value),
      )
    }

    function RangePicker({ value, onChange, tr }) {
      return h(
        'div',
        { className: 'ogp-range', role: 'group', 'aria-label': tr('range.label') },
        RANGES.map((id) =>
          h(
            'button',
            {
              key: id,
              type: 'button',
              className: 'ogp-range-btn' + (id === value ? ' is-active' : ''),
              title: tr('range.' + RANGE_KEY[id]),
              'aria-pressed': id === value,
              onClick: () => onChange(id),
            },
            tr('range.short.' + RANGE_KEY[id]),
          ),
        ),
      )
    }

    function ChartCard({ stats, tr, metric, onMetric, range }) {
      const series = Array.isArray(stats.series) ? stats.series : []
      const hourly = stats.bucket === 'hour'
      const values = series.map((row) => (metric === 'tokens' ? row.tokens : row.cost))
      const max = values.reduce((best, value) => (value > best ? value : best), 0)

      const unit = metric === 'tokens' ? tr('stats.tokensUnit') : ''
      const valueText = (row) =>
        metric === 'tokens' ? fmtCompact(row.tokens) + ' ' + unit : fmtMoney(row.cost)

      const bars = series.map((row, index) => {
        const value = values[index]
        const height = max > 0 ? Math.max(3, Math.round((value / max) * 100)) : 3
        const tooltip = fmtBucket(row.at, hourly) + ' · ' + valueText(row) + ' · ' + fmtInt(row.requests) + ' ' + tr('stats.requestsUnit')
        return h(
          'div',
          { key: row.at + ':' + index, className: 'ogp-bar-col', title: tooltip, 'aria-label': tooltip },
          h('span', { style: { height: height + '%' } }),
        )
      })

      const first = series.length > 0 ? fmtBucket(series[0].at, hourly) : ''
      const last = series.length > 0 ? fmtBucket(series[series.length - 1].at, hourly) : ''

      return h(
        'div',
        { className: 'ogp-chart' },
        h(
          'div',
          { className: 'ogp-chart-head' },
          h('span', { className: 'ogp-chart-title' }, hourly ? tr('stats.hourly') : tr('stats.daily')),
          h(
            'div',
            { className: 'ogp-metric', role: 'group', 'aria-label': tr('stats.title') },
            h(
              'button',
              {
                type: 'button',
                className: 'ogp-metric-btn' + (metric === 'cost' ? ' is-active' : ''),
                'aria-pressed': metric === 'cost',
                onClick: () => onMetric('cost'),
              },
              tr('stats.cost'),
            ),
            h(
              'button',
              {
                type: 'button',
                className: 'ogp-metric-btn' + (metric === 'tokens' ? ' is-active' : ''),
                'aria-pressed': metric === 'tokens',
                onClick: () => onMetric('tokens'),
              },
              tr('stats.tokens'),
            ),
          ),
        ),
        series.length === 0
          ? h('div', { className: 'ogp-empty' }, tr('stats.empty'))
          : h('div', { className: 'ogp-bars', role: 'img', 'aria-label': tr('stats.title') + ' · ' + range }, bars),
        series.length === 0
          ? null
          : h('div', { className: 'ogp-chart-axis' }, h('span', null, first), h('span', null, last)),
      )
    }

    function ModelsCard({ stats, totals, tr }) {
      const models = Array.isArray(stats.models) ? stats.models.slice(0, MAX_MODELS) : []
      const baseCost = totals.cost > 0 ? totals.cost : models.reduce((best, row) => Math.max(best, row.cost), 0)

      return h(
        'div',
        { className: 'ogp-models' },
        h('div', { className: 'ogp-chart-title' }, tr('stats.byModel')),
        models.length === 0
          ? h('div', { className: 'ogp-empty' }, tr('stats.noModels'))
          : models.map((row, index) => {
              const share = baseCost > 0 ? Math.min(100, Math.max(0, (row.cost / baseCost) * 100)) : 0
              const meta = [
                fmtCompact(row.tokens.total) + ' ' + tr('stats.tokensUnit'),
                fmtInt(row.requests) + ' ' + tr('stats.requestsUnit'),
                row.provider,
              ]
                .filter((part) => typeof part === 'string' && part !== '')
                .join(' · ')
              return h(
                'div',
                { className: 'ogp-model', key: row.provider + ':' + row.model + ':' + index },
                h(
                  'div',
                  { className: 'ogp-model-row' },
                  h('span', { className: 'ogp-model-name', title: row.model }, modelName(row.model)),
                  h('span', { className: 'ogp-model-cost' }, fmtMoney(row.cost)),
                ),
                h('div', { className: 'ogp-model-share' }, h('span', { style: { width: share + '%' } })),
                h('div', { className: 'ogp-model-meta', title: meta }, meta),
              )
            }),
      )
    }

    function ErrorBox({ error, tr, onRetry, title, compact }) {
      const known = error && typeof error.code === 'string' && lookup(EN, 'error.' + error.code) !== undefined
      const text = tr(known ? 'error.' + error.code : 'error.upstream')
      return h(
        'div',
        { className: 'ogp-error' + (compact === true ? ' is-compact' : ''), role: 'alert' },
        h('div', { className: 'ogp-error-title' }, title || tr('error.title')),
        h('div', { className: 'ogp-error-text' }, text),
        error && error.message ? h('div', { className: 'ogp-error-detail' }, error.message) : null,
        h('button', { type: 'button', className: 'ogp-error-retry', onClick: onRetry }, tr('error.retry')),
      )
    }

    function StatsBody({ stats, tr, metric, onMetric, range, onRetry }) {
      if (stats === null) {
        return h(
          'div',
          { className: 'ogp-section' },
          h(
            'div',
            { className: 'ogp-tiles' },
            [0, 1, 2].map((index) => h('div', { key: index, className: 'ogp-skeleton is-short' })),
          ),
          h('div', { className: 'ogp-skeleton is-chart' }),
        )
      }

      if (stats.ok !== true) {
        return h(ErrorBox, {
          error: stats.error,
          tr,
          onRetry,
          title: tr('stats.unavailable'),
        })
      }

      const totals = stats.totals !== null && typeof stats.totals === 'object' ? stats.totals : null
      const tokens = totals !== null && totals.tokens !== null && typeof totals.tokens === 'object' ? totals.tokens : null
      const tokensTitle = tokens === null
        ? undefined
        : [
            'in ' + fmtInt(tokens.input),
            'out ' + fmtInt(tokens.output),
            'cache ' + fmtInt(tokens.cacheRead),
          ].join(' · ')

      return h(
        'div',
        { className: 'ogp-section' },
        h(
          'div',
          { className: 'ogp-tiles' },
          h(StatTile, { label: tr('stats.cost'), value: fmtMoney(totals === null ? 0 : totals.cost) }),
          h(StatTile, { label: tr('stats.requests'), value: fmtInt(totals === null ? 0 : totals.requests) }),
          h(StatTile, {
            label: tr('stats.tokens'),
            value: fmtCompact(tokens === null ? 0 : tokens.total),
            title: tokensTitle,
          }),
        ),
        h(ChartCard, { stats, tr, metric, onMetric, range }),
        h(ModelsCard, { stats, totals: totals === null ? { cost: 0 } : totals, tr }),
      )
    }

    /**
     * The subscription countdown line under the panel subtitle: a clock and
     * "Ends in 22d 16h · Cancelled" (or "Renews in …" for an active plan).
     * Hidden when the Host could not read go/status.
     */
    function SubscriptionLine(props) {
      const subscription = props && props.subscription ? props.subscription : null
      const tr = props && typeof props.tr === 'function' ? props.tr : (key) => key
      const now = typeof props.now === 'number' ? props.now : Date.now()
      if (subscription === null) return null

      const endsAt = typeof subscription.endsAt === 'string' ? new Date(subscription.endsAt) : null
      if (endsAt === null || Number.isNaN(endsAt.getTime())) return null

      const left = endsAt.getTime() - now
      const expired = left <= 0
      const cancelled = subscription.cancelled === true
      const warn = cancelled || expired

      let label
      if (expired) label = tr('sub.expired')
      else if (cancelled) label = tr('sub.endsIn') + ' ' + fmtDuration(left, tr) + ' · ' + tr('sub.cancelled')
      else label = tr('sub.renewsIn') + ' ' + fmtDuration(left, tr)

      return h(
        'div',
        {
          className: 'ogp-sub' + (warn ? ' is-warn' : ''),
          title: tr('sub.tooltip') + ' ' + endsAt.toLocaleString(),
        },
        h(ClockGlyph, { size: 12 }),
        h('span', null, label),
      )
    }

    function PanelBody(props) {
      const tr = useMemo(() => translator(props && props.t), [props && props.t])
      const [range, setRange] = useState(DEFAULT_RANGE)
      const [metric, setMetric] = useState('cost')
      const usage = useUsage(range)
      const now = useNow(CLOCK_MS)

      const busy = usage.busy
      const data = usage.data
      const windows = windowsOf(data)
      const stats = data !== null && data.range === range ? statsOf(data) : null
      const fetchedAt = data !== null && data.fetchedAt ? new Date(data.fetchedAt) : null

      const rows = [
        ['session', 'labels.session'],
        ['week', 'labels.week'],
        ['month', 'labels.month'],
      ]

      return h(
        'div',
        { className: 'ogp-root', 'data-opencode-go-usage': '' },
        h(
          'div',
          { className: 'ogp-head' },
          h(
            'div',
            { className: 'ogp-head-text' },
            h('div', { className: 'ogp-title' }, tr('panel.title')),
            h('div', { className: 'ogp-subtitle' }, tr('panel.subtitle')),
            h(SubscriptionLine, { subscription: subscriptionOf(data), now, tr }),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'ogp-refresh' + (busy ? ' is-busy' : ''),
              title: tr('panel.refresh'),
              'aria-label': tr('panel.refresh'),
              disabled: busy,
              onClick: usage.refresh,
            },
            h(RefreshGlyph, { size: 15 }),
          ),
        ),
        usage.error !== null && data === null
          ? h(ErrorBox, { error: usage.error, tr, onRetry: usage.refresh })
          : null,
        usage.error !== null && data !== null
          ? h(ErrorBox, {
              error: usage.error,
              tr,
              onRetry: usage.refresh,
              title: tr('error.stale'),
              compact: true,
            })
          : null,
        h(
          'div',
          { className: 'ogp-cards' },
          data === null
            ? [0, 1, 2].map((index) => h('div', { key: index, className: 'ogp-skeleton' }))
            : rows.map(([key, labelKey]) =>
                h(UsageCard, {
                  key,
                  label: tr(labelKey),
                  win: windows !== null && windows[key] !== undefined ? windows[key] : null,
                  tr,
                  now,
                }),
              ),
        ),
        h(
          'div',
          { className: 'ogp-section' },
          h(
            'div',
            { className: 'ogp-section-head' },
            h('span', { className: 'ogp-section-title' }, tr('stats.title')),
            h(RangePicker, { value: range, onChange: setRange, tr }),
          ),
          h(StatsBody, {
            stats,
            tr,
            metric,
            onMetric: setMetric,
            range,
            onRetry: usage.refresh,
          }),
        ),
        h(
          'div',
          { className: 'ogp-foot' },
          h('span', null, fetchedAt === null ? '' : tr('panel.updated') + ' ' + fmtClock(fetchedAt)),
          h('span', { className: 'ogp-foot-src' }, tr('panel.source')),
        ),
      )
    }

    /** Read the `windows` object, tolerating a malformed payload. */
    function windowsOf(data) {
      const windows = data !== null && typeof data === 'object' ? data.windows : undefined
      return windows !== null && windows !== undefined && typeof windows === 'object' ? windows : null
    }

    /** Read the `subscription` object, tolerating a malformed payload. */
    function subscriptionOf(data) {
      const sub = data !== null && typeof data === 'object' ? data.subscription : undefined
      return sub !== null && sub !== undefined && typeof sub === 'object' ? sub : null
    }

    /** Read the `stats` object, tolerating a malformed payload. */
    function statsOf(data) {
      const stats = data !== null && typeof data === 'object' ? data.stats : undefined
      return stats !== null && stats !== undefined && typeof stats === 'object' ? stats : null
    }

    function PanelTitle(props) {
      const tr = useMemo(() => translator(props && props.t), [props && props.t])
      return h('span', { className: 'ogp-tab-title' }, h(GoGlyph, { size: 14 }), h('span', null, tr('tab.title')))
    }
    //#endregion

    function bindTranslate(ctx) {
      try {
        return ctx.locale.bind(NS)
      } catch {
        return undefined
      }
    }

    function tabDefinition(tr) {
      return {
        id: PLUGIN_ID,
        kind: TAB_KIND,
        priority: 'extension',
        keepMounted: true,
        title: () => tr('guide.title'),
        guide: [
          {
            id: 'usage',
            order: 20,
            title: () => tr('guide.title'),
            description: () => tr('guide.description'),
            icon: GoGlyph,
          },
        ],
      }
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { en: EN, vi: VI, zh: ZH }), 'opencode-go-usage: copy')
      ctx.effect(installStyles, 'opencode-go-usage: styles')

      const tr = translator(bindTranslate(ctx))
      const tabs =
        ctx.sidebarRightTabs ?? (typeof ctx.get === 'function' ? ctx.get('sidebarRightTabs') : undefined)
      if (tabs !== null && tabs !== undefined && typeof tabs.register === 'function') {
        try {
          ctx.effect(() => tabs.register(tabDefinition(tr)), 'opencode-go-usage: tab type')
        } catch (error) {
          console.error('[opencode-go-usage] tab type registration failed', error)
        }
      }

      try {
        ctx.effect(
          () =>
            ctx.slots.inject('sidebar.right.pane.tab', () =>
              ctx.slots.register({ name: 'sidebar.right.pane.tab', key: PLUGIN_ID, locale: NS }, PanelBody),
            ),
          'opencode-go-usage: panel body',
        )
        ctx.effect(
          () =>
            ctx.slots.inject('sidebar.right.pane.tab.title', () =>
              ctx.slots.register({ name: 'sidebar.right.pane.tab.title', key: PLUGIN_ID, locale: NS }, PanelTitle),
            ),
          'opencode-go-usage: panel title',
        )
      } catch (error) {
        console.error('[opencode-go-usage] slot registration failed', error)
      }
    }

    return {
      inject: ['slots', 'locale', 'sidebarRightTabs'],
      apply,
    }
  },
})
