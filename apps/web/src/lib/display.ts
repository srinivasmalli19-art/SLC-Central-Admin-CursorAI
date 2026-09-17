import { UNKNOWN_LABEL } from '@slc/shared';

/** Render a nullable metadata value, showing UNKNOWN for null/empty. */
export function show(value: string | null | undefined): string {
  return value && value.trim() !== '' ? value : UNKNOWN_LABEL;
}
