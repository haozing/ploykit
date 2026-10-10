import { describe, expect, it } from 'vitest'

// 子路径导出合同：components/ui 的全部组件必须能经
// '@ploykit/ui/components/ui/<name>' 深路径导入（exports map wildcard）。
// 这里逐个 import + 存在性断言——解析失败（exports map 配错）会让整个文件挂掉。
// （Button/Badge/Input 大写文件名在 shadcn 生成自有化后改为小写，届时补进本清单。）
import * as alertDialog from '@ploykit/ui/components/ui/alert-dialog'
import * as avatar from '@ploykit/ui/components/ui/avatar'
import * as breadcrumb from '@ploykit/ui/components/ui/breadcrumb'
import * as card from '@ploykit/ui/components/ui/card'
import * as checkbox from '@ploykit/ui/components/ui/checkbox'
import * as popover from '@ploykit/ui/components/ui/popover'
import * as progress from '@ploykit/ui/components/ui/progress'
import * as select from '@ploykit/ui/components/ui/select'
import * as sw from '@ploykit/ui/components/ui/switch'

describe('子路径导出 @ploykit/ui/components/ui/*', () => {
  const modules = {
    'alert-dialog': alertDialog,
    avatar,
    breadcrumb,
    card,
    checkbox,
    popover,
    progress,
    select,
    switch: sw,
  } as const

  for (const [name, mod] of Object.entries(modules)) {
    it(`${name} 深路径可解析且导出组件`, () => {
      const components = Object.values(mod).filter((v) => typeof v === 'function')
      expect(components.length, `${name} 应至少导出一个组件函数`).toBeGreaterThan(0)
    })
  }
})
