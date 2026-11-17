"use client"

import { Slider as SliderPrimitive } from "@base-ui/react/slider"
import { cn } from "../../lib/utils"

interface SliderProps extends SliderPrimitive.Root.Props {
  /**
   * Accessible name for the thumb's nested `role="slider"` input.
   *
   * base-ui renders the a11y role on a hidden `<input type="range">` inside
   * Slider.Thumb; an `aria-label` on the Root lands on the wrapper div, so the
   * thing that actually carries role="slider" stays unnamed. This prop is
   * forwarded through Thumb.getAriaLabel, which is the documented channel for
   * naming that input.
   */
  thumbAriaLabel?: string
}

function Slider({ className, thumbAriaLabel, ...props }: SliderProps) {
  const values = props.value ?? props.defaultValue
  const thumbCount = Array.isArray(values) ? values.length : 1

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      className={cn(
        "relative flex w-full touch-none select-none items-center outline-none data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SliderPrimitive.Control
        data-slot="slider-control"
        className="relative flex h-4 w-full touch-none select-none items-center"
      >
        <SliderPrimitive.Track
          data-slot="slider-track"
          className="relative h-1 w-full grow overflow-hidden rounded-full bg-muted"
        >
          <SliderPrimitive.Indicator
            data-slot="slider-indicator"
            className="absolute h-full bg-primary"
          />
        </SliderPrimitive.Track>
        {Array.from({ length: thumbCount }, (_, index) => (
          <SliderPrimitive.Thumb
            key={index}
            index={thumbCount > 1 ? index : undefined}
            data-slot="slider-thumb"
            {...(thumbAriaLabel
              ? { getAriaLabel: (thumbIndex: number) => (thumbCount > 1 ? `${thumbAriaLabel} ${thumbIndex + 1}` : thumbAriaLabel) }
              : {})}
            className="block size-3.5 shrink-0 rounded-full border border-primary bg-background shadow-sm outline-none transition-[color,box-shadow] focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 dark:bg-foreground"
          />
        ))}
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  )
}

export { Slider }
export type { SliderProps }
