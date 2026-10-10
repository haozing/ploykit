
import { zodResolver } from '@hookform/resolvers/zod'
import { useForm, type FieldValues, type UseFormProps, type UseFormReturn } from 'react-hook-form'
import type { ZodSchema } from 'zod'

export interface ZodFormOptions<T extends FieldValues> extends UseFormProps<T> {
  
  
  schema: ZodSchema<T, T>
}

export function useZodForm<T extends FieldValues>(opts: ZodFormOptions<T>): UseFormReturn<T> {
  const { schema, ...rest } = opts
  return useForm<T>({ ...rest, resolver: zodResolver(schema) as never })
}
