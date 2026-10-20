/**
 * 整页硬导航出口（#24）：登录弹层成功后的默认动作。
 *
 * 独立成模块的原因：jsdom 的 window.location 是 [LegacyUnforgeable]
 * （属性不可配置、window.location 不可替换），测试无法 spy Location 原型——
 * 收口成模块级函数后，测试经 vi.mock('.../hard-navigate') 观察跳转目标。
 */
export function hardNavigate(url: string): void {
  window.location.assign(url)
}
