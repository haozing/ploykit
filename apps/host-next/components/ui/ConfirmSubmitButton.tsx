'use client';

import * as DialogPrimitive from '@radix-ui/react-dialog';
import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from 'react';
import { useRef, useState } from 'react';

function collectFormDiff(form: HTMLFormElement | null): string[] {
  if (!form) {
    return [];
  }
  const fields = Array.from(form.elements).filter(
    (element): element is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement =>
      element instanceof HTMLInputElement ||
      element instanceof HTMLSelectElement ||
      element instanceof HTMLTextAreaElement
  );
  return fields.flatMap((field) => {
    if (!field.name || field.disabled || field.type === 'hidden' || field.type === 'submit' || field.type === 'button') {
      return [];
    }
    const currentValue = field.dataset.currentValue;
    if (currentValue === undefined) {
      return [];
    }
    const nextValue = field instanceof HTMLInputElement && field.type === 'checkbox'
      ? String(field.checked)
      : field.value;
    if (String(currentValue) === String(nextValue)) {
      return [];
    }
    const label = field.getAttribute('aria-label') || field.name;
    const risk = field.dataset.risk ? ` · risk:${field.dataset.risk}` : '';
    const restart = field.dataset.requiresRestart === 'true' ? ' · restart' : '';
    return [`${label}: ${currentValue || '-'} -> ${nextValue || '-'}${risk}${restart}`];
  });
}

export function ConfirmSubmitButton({
  confirmation,
  formDiff = false,
  formDiffEmptyLabel = 'No field changes detected.',
  formDiffTitle = 'Change diff',
  children,
  onClick,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  confirmation: string;
  formDiff?: boolean;
  formDiffEmptyLabel?: string;
  formDiffTitle?: string;
  children: ReactNode;
}) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const confirmedRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [diffLines, setDiffLines] = useState<string[]>([]);

  function handleClick(event: MouseEvent<HTMLButtonElement>) {
    onClick?.(event);
    if (event.defaultPrevented) {
      return;
    }
    if (confirmedRef.current) {
      confirmedRef.current = false;
      return;
    }
    event.preventDefault();
    setDiffLines(formDiff ? collectFormDiff(buttonRef.current?.form ?? null) : []);
    setOpen(true);
  }

  function confirm() {
    const button = buttonRef.current;
    setOpen(false);
    confirmedRef.current = true;
    if (button?.form) {
      let confirmationInput = button.form.querySelector<HTMLInputElement>(
        'input[type="hidden"][name="confirm"]'
      );
      let createdConfirmationInput = false;
      if (!confirmationInput) {
        confirmationInput = document.createElement('input');
        confirmationInput.type = 'hidden';
        confirmationInput.name = 'confirm';
        button.form.appendChild(confirmationInput);
        createdConfirmationInput = true;
      }
      confirmationInput.value = 'CONFIRM';
      button.form.requestSubmit(button);
      if (createdConfirmationInput) {
        confirmationInput.remove();
      } else {
        confirmationInput.value = '';
      }
      return;
    }
    button?.click();
  }

  return (
    <>
      <button {...props} ref={buttonRef} onClick={handleClick}>
        {children}
      </button>
      <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-background/70 backdrop-blur-sm" />
          <DialogPrimitive.Content
            className="fixed left-1/2 top-1/2 z-50 grid w-[min(92vw,440px)] -translate-x-1/2 -translate-y-1/2 gap-4 rounded-md border border-border bg-card p-5 text-card-foreground shadow-lg"
            role="alertdialog"
          >
            <DialogPrimitive.Title className="text-lg font-semibold text-foreground">
              确认操作
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="text-sm leading-6 text-muted-foreground">
              {confirmation}
            </DialogPrimitive.Description>
            {formDiff ? (
              <div className="rounded-md border border-border bg-muted/35 p-3 text-sm">
                <div className="mb-2 font-semibold text-foreground">{formDiffTitle}</div>
                {diffLines.length > 0 ? (
                  <ul className="grid gap-1 text-muted-foreground">
                    {diffLines.slice(0, 8).map((line) => (
                      <li key={line} className="break-words">
                        {line}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-muted-foreground">{formDiffEmptyLabel}</p>
                )}
              </div>
            ) : null}
            <div className="flex flex-wrap justify-end gap-2">
              <DialogPrimitive.Close asChild>
                <button
                  type="button"
                  className="inline-flex min-h-9 items-center justify-center rounded-md border border-border bg-card px-3 py-1.5 text-sm font-semibold text-foreground transition hover:bg-muted"
                >
                  取消
                </button>
              </DialogPrimitive.Close>
              <button
                type="button"
                className="inline-flex min-h-9 items-center justify-center rounded-md bg-destructive px-3 py-1.5 text-sm font-semibold text-white transition hover:opacity-90"
                onClick={confirm}
              >
                确认
              </button>
            </div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}
