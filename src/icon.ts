import { setIcon } from "obsidian";

/**
 * Obsidian still maps some plain names ("external-link", "moon", "rotate-ccw", "code-2")
 * to its old icon set, which draws differently (and at another stroke) from the Lucide
 * icons around them. Always ask for the Lucide one.
 */
export function icon(el: HTMLElement, name: string): void {
  setIcon(el, name.startsWith("lucide-") ? name : `lucide-${name}`);
}
