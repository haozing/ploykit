
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, type FieldValues, type UseFormProps, type UseFormReturn } from 'react-hook-form'

/**
 * zod schema 的最小结构契约——**同时接受 `zod` 全量与 `zod/mini`**。
 *
 * @hookform/resolvers/zod 的运行时判定是 `"_zod" in schema`，两者都满足；
 * 错误对象也都被识别（mini 的错同样带 `_zod.traits = ["$ZodError"]`）。但两
 * 套 schema 是不同的类，classic 的 `ZodSchema<T, T>` 类型接受不了 mini 的，
 * 所以这里退到 resolver 真正会用到的那一个方法上。
 *
 * 为什么不统一成 mini 自带类型：`useZodForm` 是框架导出的公共 API，产品可以
 * 传任一种；把类型钉死在其中一家，等于逼产品换 import 路径。
 */
export interface ZodFormSchema<T> {
  parse: (...args: never[]) => T
}

export interface ZodFormOptions<T extends FieldValues> extends UseFormProps<T> {
  schema: ZodFormSchema<T>
}

export function useZodForm<T extends FieldValues>(opts: ZodFormOptions<T>): UseFormReturn<T> {
  const { schema, ...rest } = opts
  return useForm<T>({ ...rest, resolver: zodResolver(schema as never) })
}
