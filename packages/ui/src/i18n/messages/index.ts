// 字典合并：10 个分区分片（g1..g10）各自维护互不重叠的 key 前缀，
// 并行任务只写自己的分片文件，此文件只做机械合并。
import * as g1 from './g1'
import * as g2 from './g2'
import * as g3 from './g3'
import * as g4 from './g4'
import * as g5 from './g5'
import * as g6 from './g6'
import * as g7 from './g7'
import * as g8 from './g8'
import * as g9 from './g9'
import * as g10 from './g10'

const groups = [g1, g2, g3, g4, g5, g6, g7, g8, g9, g10] as const

export const en: Record<string, string> = Object.assign({}, ...groups.map((g) => g.en))
export const zh: Record<string, string> = Object.assign({}, ...groups.map((g) => g.zh))
