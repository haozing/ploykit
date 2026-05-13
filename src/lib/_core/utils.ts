import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

/**
 * CSS Class Utilities
 *
 * Combine and merge Tailwind CSS classes
 * Uses clsx for conditional class combinations and tailwind-merge for conflict resolution
 *
 * @example
 * cn("px-2 py-1", condition && "bg-blue-500")
 * cn("px-2", "px-4") // => "px-4" (tailwind-merge resolves conflicts)
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
