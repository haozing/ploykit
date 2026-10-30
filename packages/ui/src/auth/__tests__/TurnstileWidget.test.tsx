import '@testing-library/jest-dom/vitest'
import { act, render, waitFor } from '@testing-library/react'
import { StrictMode, createRef } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TurnstileWidget, __resetTurnstileForTests, type TurnstileWidgetHandle } from '../TurnstileWidget'

// useSiteConfig 打在 hooks 源文件上（本目录 → packages/hooks/src 相对深度
// 与 SignInForm.test 一致），@ploykit/hooks 的 re-export 随之生效。
const siteCfgState = vi.hoisted(() => ({
  data: undefined as { turnstile_site_key?: string } | undefined,
}))
vi.mock('../../../../hooks/src/hooks/useSiteConfig', () => ({
  useSiteConfig: () => ({ data: siteCfgState.data }),
}))

const SCRIPT_ID = 'ploykit-turnstile-api'
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js'

/**
 * window.turnstile 官方对象 mock：render 参数可被断言、id 自增。
 * 注意注入时机——widget 见 window.turnstile 已存在会跳过 script 注入
 * （同页会话去重）。要断言「script 注入」的用例必须先 render、后装 mock。
 */
function installTurnstileApi() {
  let seq = 0
  const api = {
    render: vi.fn(() => `w${++seq}`),
    reset: vi.fn(),
    remove: vi.fn(),
  }
  window.turnstile = api
  return api
}

/** jsdom 不执行外链脚本：手动派发 load 事件模拟 api.js 就绪。 */
function flushScriptLoad() {
  const script = document.getElementById(SCRIPT_ID) as HTMLScriptElement
  expect(script).not.toBeNull()
  act(() => {
    script.dispatchEvent(new Event('load'))
  })
}

beforeEach(() => {
  __resetTurnstileForTests()
  delete window.turnstile
  siteCfgState.data = undefined
  document.querySelectorAll('script').forEach((s) => s.remove())
})

describe('TurnstileWidget：未配置 site key（框架兼容底线）', () => {
  it('render null 且零脚本注入', () => {
    siteCfgState.data = {} // /config 已返回但没有 turnstile_site_key
    const { container } = render(<TurnstileWidget onToken={vi.fn()} />)
    expect(container.querySelector('[data-testid="turnstile-widget"]')).toBeNull()
    expect(document.getElementById(SCRIPT_ID)).toBeNull()
  })

  it('site key 为纯空白同样视为未配置（GA4 trim 判空同款）', () => {
    siteCfgState.data = { turnstile_site_key: '   ' }
    const { container } = render(<TurnstileWidget onToken={vi.fn()} />)
    expect(container.querySelector('[data-testid="turnstile-widget"]')).toBeNull()
    expect(document.getElementById(SCRIPT_ID)).toBeNull()
  })
})

describe('TurnstileWidget：脚本注入与显式 render', () => {
  it('site key 存在 → 注入占位 script（id + 官方 src）并显式 render', async () => {
    siteCfgState.data = { turnstile_site_key: '1x00000000000000000000AA' }
    render(<TurnstileWidget onToken={vi.fn()} />)

    const script = document.getElementById(SCRIPT_ID) as HTMLScriptElement
    expect(script).not.toBeNull()
    expect(script.getAttribute('src')).toBe(SCRIPT_SRC)
    expect(script.async).toBe(true)

    const turnstile = installTurnstileApi()
    flushScriptLoad()
    await waitFor(() => expect(turnstile.render).toHaveBeenCalledTimes(1))
    const [container, options] = turnstile.render.mock.calls[0]
    expect(container).toBeInstanceOf(HTMLElement)
    expect(options.sitekey).toBe('1x00000000000000000000AA')
    expect(options.theme).toBe('auto')
    expect(options.size).toBe('normal')
  })

  it('theme/size 透传官方参数', async () => {
    siteCfgState.data = { turnstile_site_key: 'sk' }
    render(<TurnstileWidget onToken={vi.fn()} theme="dark" size="compact" />)
    const turnstile = installTurnstileApi()
    flushScriptLoad()
    await waitFor(() => expect(turnstile.render).toHaveBeenCalled())
    expect(turnstile.render.mock.calls[0][1].theme).toBe('dark')
    expect(turnstile.render.mock.calls[0][1].size).toBe('compact')
  })

  it('同一页面挂两个 widget / 卸载重挂 → script 只注入一个（占位去重）', async () => {
    siteCfgState.data = { turnstile_site_key: 'sk' }
    const first = render(
      <>
        <TurnstileWidget onToken={vi.fn()} />
        <TurnstileWidget onToken={vi.fn()} />
      </>,
    )
    expect(document.querySelectorAll(`#${SCRIPT_ID}`)).toHaveLength(1)
    const turnstile = installTurnstileApi()
    flushScriptLoad()
    await waitFor(() => expect(turnstile.render).toHaveBeenCalledTimes(2))
    // 两个 widget 各自 render 到各自容器
    expect(turnstile.render.mock.calls[0][0]).not.toBe(turnstile.render.mock.calls[1][0])

    // SPA 路由切换：卸载再重挂，script 标签不重复注入（turnstile 已就绪）
    first.unmount()
    const second = render(<TurnstileWidget onToken={vi.fn()} />)
    expect(document.querySelectorAll(`#${SCRIPT_ID}`)).toHaveLength(1)
    await waitFor(() => expect(turnstile.render).toHaveBeenCalledTimes(3))
    second.unmount()
  })
})

describe('TurnstileWidget：回调链路（onToken / onExpire / onError）', () => {
  it('挑战通过 → callback 上抛 onToken；过期 → expired-callback 上抛 onExpire', async () => {
    siteCfgState.data = { turnstile_site_key: 'sk' }
    const onToken = vi.fn()
    const onExpire = vi.fn()
    render(<TurnstileWidget onToken={onToken} onExpire={onExpire} />)
    const turnstile = installTurnstileApi()
    flushScriptLoad()
    await waitFor(() => expect(turnstile.render).toHaveBeenCalled())

    const options = turnstile.render.mock.calls[0][1]
    act(() => options.callback('tok-123'))
    expect(onToken).toHaveBeenCalledWith('tok-123')

    act(() => options['expired-callback']())
    expect(onExpire).toHaveBeenCalledTimes(1)
  })

  it('脚本加载失败 → onError 上抛 + 清理残尸节点，下次挂载重新注入（自然重试）', async () => {
    siteCfgState.data = { turnstile_site_key: 'sk' }
    // 不装 window.turnstile：load 分支走不通，走 error 分支
    const onError = vi.fn()
    render(<TurnstileWidget onToken={vi.fn()} onError={onError} />)
    const script = document.getElementById(SCRIPT_ID) as HTMLScriptElement
    act(() => {
      script.dispatchEvent(new Event('error'))
    })
    await waitFor(() => expect(onError).toHaveBeenCalledTimes(1))
    // 残尸节点被移除：下一次挂载是全新的注入
    expect(document.getElementById(SCRIPT_ID)).toBeNull()

    // 重挂 → 重新注入 script（闸门已作废）；这次装上 turnstile mock 走通
    render(<TurnstileWidget onToken={vi.fn()} onError={onError} />)
    expect(document.getElementById(SCRIPT_ID)).not.toBeNull()
    const turnstile = installTurnstileApi()
    flushScriptLoad()
    await waitFor(() => expect(turnstile.render).toHaveBeenCalled())
  })
})

describe('TurnstileWidget：卸载与 reset 句柄', () => {
  it('卸载 → turnstile.remove(widgetId)', async () => {
    siteCfgState.data = { turnstile_site_key: 'sk' }
    const { unmount } = render(<TurnstileWidget onToken={vi.fn()} />)
    const turnstile = installTurnstileApi()
    flushScriptLoad()
    await waitFor(() => expect(turnstile.render).toHaveBeenCalled())
    const widgetId = turnstile.render.mock.results[0].value

    unmount()
    expect(turnstile.remove).toHaveBeenCalledWith(widgetId)
  })

  it('ref.reset() → turnstile.reset(widgetId)（一次性 token 的重取通道）', async () => {
    siteCfgState.data = { turnstile_site_key: 'sk' }
    const ref = createRef<TurnstileWidgetHandle>()
    render(<TurnstileWidget ref={ref} onToken={vi.fn()} />)
    const turnstile = installTurnstileApi()
    flushScriptLoad()
    await waitFor(() => expect(turnstile.render).toHaveBeenCalled())

    act(() => ref.current!.reset())
    expect(turnstile.reset).toHaveBeenCalledWith(turnstile.render.mock.results[0].value)
  })
})

describe('TurnstileWidget：React 19 StrictMode 双挂载稳定性', () => {
  it('开发双跑只留一个活 widget（首跑被取消，不泄漏 remove）', async () => {
    siteCfgState.data = { turnstile_site_key: 'sk' }
    const { unmount } = render(
      <StrictMode>
        <TurnstileWidget onToken={vi.fn()} />
      </StrictMode>,
    )
    // StrictMode 同步序列 mount→cleanup→mount 都发生在 promise 决议前，
    // 首个 effect 的 cancelled 已置位：只有第二个 effect 真正 render。
    const turnstile = installTurnstileApi()
    flushScriptLoad()
    await waitFor(() => expect(turnstile.render).toHaveBeenCalledTimes(1))
    expect(turnstile.remove).not.toHaveBeenCalled()

    // 卸载收尾仍完整
    unmount()
    expect(turnstile.remove).toHaveBeenCalledWith(turnstile.render.mock.results[0].value)
  })
})
