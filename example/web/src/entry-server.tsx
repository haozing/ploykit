
import { renderToString } from 'react-dom/server.browser'
import { StaticRouter } from 'react-router'
import { createSsrEntry } from '@ploykit/runtime/server'
import routes from './routes'

export default createSsrEntry({
  routes,
  render: (el) => renderToString(el),
  wrap: (children, loc) => <StaticRouter location={loc}>{children}</StaticRouter>,
})
