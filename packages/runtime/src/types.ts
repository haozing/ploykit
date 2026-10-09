


export type DirectiveKind = 'head' | 'status'


export interface HeadEntry {
  tag: string
  
  attrs?: Record<string, string>
  
  children?: string
}


export interface StatusPayload {
  code: number
}

export type DirectivePayload = HeadEntry[] | StatusPayload


export interface Directive {
  kind: DirectiveKind
  payload: DirectivePayload
  
  seq: number
}


export interface PloykitHost {
  directive(kind: DirectiveKind, jsonPayload: string): void
}

declare global {
  
  // eslint-disable-next-line no-var
  var __ploykit_host__: PloykitHost | undefined
  
  // eslint-disable-next-line no-var
  var __ploykit_routes__: (() => string) | undefined
  
  // eslint-disable-next-line no-var
  var __ploykit_render__: ((pageId: string, location: string, propsJson: string) => string) | undefined
}
