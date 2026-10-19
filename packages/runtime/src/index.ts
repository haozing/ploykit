
export type {
  DirectiveKind,
  DirectivePayload,
  Directive,
  HeadEntry,
  StatusPayload,
  PloykitHost,
} from './types'
export { emitDirective } from './browser'


// 路由真源与水合/SSR 入口工厂均为 router 无关：本桶不 import 任何具体
// router。react-router 组装器/匹配器在 @ploykit/runtime/router-react-router
// 子路径（reactRouterAssembler / matchRoutePage），由 RR 消费方显式注入。
// matchPageByPath 是依赖零 router 的默认匹配器（水合回退梯子的第二级），
// 因此可以安全地从本桶导出。
export type {
  RenderMode,
  RouteSpec,
  RouteTableInput,
  PageSpec,
  RouteAssembler,
  RouteTable,
} from './routes'
export { matchPageByPath } from './match'
export type { SsrEntryOptions, SsrEntry } from './server'
export type { ClientEntryOptions, HydratePayload } from './hydrate'
