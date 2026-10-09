
import { describe, expect, it } from 'vitest'
import { PROPS_SCRIPT_ID, readPropsScript, serializeProps } from '../hydrate'

const hostile = {
  title: 'a</script><img src=x onerror=alert(1)>',
  nested: { deep: '<<&"\'' },
  num: 42,
  list: ['</script>', 1],
}

describe('props JSON 转义往返', () => {
  it('serializeProps：`<` 全量转义为 \\u003c，产物不含任何裸 < 与 </script>', () => {
    const ser = serializeProps(hostile)
    expect(ser).not.toContain('<')
    expect(ser).not.toContain('</script')
  })

  it('JSON.parse(serializeProps(x)) 深度还原（</script> 字符串不丢失）', () => {
    expect(JSON.parse(serializeProps(hostile))).toEqual(hostile)
  })

  it('script 元素往返：转义串写入 textContent 后 readPropsScript 还原原始对象', () => {
    const el = document.createElement('script')
    el.type = 'application/json'
    el.id = PROPS_SCRIPT_ID
    el.setAttribute('data-page-id', 'blog-post')
    el.textContent = serializeProps(hostile)
    document.body.appendChild(el)

    expect(readPropsScript()).toEqual({ pageId: 'blog-post', props: hostile })
  })

  it('无 script / 无 data-page-id / 空 textContent → null（SPA 回落）', () => {
    
    document.querySelectorAll(`#${PROPS_SCRIPT_ID}`).forEach((el) => el.remove())
    expect(readPropsScript()).toBeNull()

    const noAttr = document.createElement('script')
    noAttr.type = 'application/json'
    noAttr.id = PROPS_SCRIPT_ID
    noAttr.textContent = '{}'
    document.body.appendChild(noAttr)
    expect(readPropsScript()).toBeNull()

    const empty = document.createElement('script')
    empty.id = PROPS_SCRIPT_ID
    empty.setAttribute('data-page-id', 'p')
    document.body.appendChild(empty)
    expect(readPropsScript()).toBeNull()
  })
})
