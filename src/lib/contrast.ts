/**
 * WCAG 2.1 relative luminance and contrast ratio.
 * Formulas: https://www.w3.org/TR/WCAG21/#dfn-relative-luminance
 *
 * These exist so the palette's accessibility is asserted by a test rather
 * than checked by eye once and then quietly broken by a later token edit.
 */

const HEX_PATTERN = /^#?([0-9a-fA-F]{6})$/;

function channels(hex: string): [number, number, number] {
  const match = HEX_PATTERN.exec(hex.trim());
  if (!match) {
    throw new Error(`not a six-digit hex colour: ${hex}`);
  }
  const digits = match[1];
  return [
    Number.parseInt(digits.slice(0, 2), 16) / 255,
    Number.parseInt(digits.slice(2, 4), 16) / 255,
    Number.parseInt(digits.slice(4, 6), 16) / 255,
  ];
}

/** Linearise one sRGB channel, per the WCAG definition. */
function linearise(channel: number): number {
  return channel <= 0.03928
    ? channel / 12.92
    : Math.pow((channel + 0.055) / 1.055, 2.4);
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = channels(hex).map(linearise) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}
