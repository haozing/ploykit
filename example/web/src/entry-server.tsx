
import { renderToString } from 'react-dom/server.browser'
import { createSsrEntry } from '@ploykit/runtime/server'
import { setTanstackSsrLocation } from '@ploykit/runtime/router-tanstack'
import routes from './routes.server'

export default createSsrEntry({
  routes,
  render: (el) => renderToString(el),
  // TanStack assembler 已经自带 RouterProvider（router 在渲染期构建），wrap
  // 只需把本次渲染的 location 记到全局（TanstackRouterMount 渲染期读取）——
  // createSsrEntry 的调用顺序是先 routes() 再 wrap()，所以不能走构造参数。
  wrap: (children, loc) => {
    setTanstackSsrLocation(loc)
    return children
  },
})
