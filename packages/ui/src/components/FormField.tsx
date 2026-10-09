
import { cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react'
import { Field, FieldLabel, FieldError, FieldDescription } from './ui/field'

export interface FormFieldProps {
  label: string
  error?: string
  
  description?: string
  
  required?: boolean
  children: ReactNode
  htmlFor?: string
}


function mergeDescribedBy(props: Record<string, unknown>, extra: string) {
  const existing = typeof props['aria-describedby'] === 'string' ? props['aria-describedby'] : ''
  return { 'aria-describedby': [existing, extra].filter(Boolean).join(' ') }
}

export function FormField({ label, error, description, required, children, htmlFor }: FormFieldProps) {
  const errorId = htmlFor && error ? `${htmlFor}-error` : undefined
  const descId = htmlFor && description ? `${htmlFor}-desc` : undefined
  const describedBy = [descId, errorId].filter(Boolean).join(' ') || undefined

  const control =
    describedBy || error || required
      ? isValidElement(children)
        ? cloneElement(
            children as ReactElement<Record<string, unknown>>,
            {
              ...(describedBy ? mergeDescribedBy((children as ReactElement<Record<string, unknown>>).props, describedBy) : {}),
              ...(error ? { 'aria-invalid': true } : {}),
              ...(required ? { 'aria-required': true } : {}),
            },
          )
        : children
      : children

  return (
    <Field data-invalid={!!error}>
      <FieldLabel htmlFor={htmlFor}>
        {label}
        {required && (
          <span aria-hidden="true" className="ml-0.5 text-destructive">
            *
          </span>
        )}
      </FieldLabel>
      {control}
      {description && <FieldDescription id={descId}>{description}</FieldDescription>}
      <FieldError id={errorId}>{error}</FieldError>
    </Field>
  )
}
