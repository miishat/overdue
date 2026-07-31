/**
 * Below this width a dashed outline reads as a rendering failure rather than a
 * designed absence, so the gap becomes a solid block instead.
 */
export const GAP_MIN_DASHED_WIDTH = 44;

/**
 * A cover-shaped void at 2:3 proportions. This is the shape of what is not
 * there yet, which is the point: in a series view the user sees the literal
 * hole in the run rather than a grey box that reads as a broken image.
 *
 * aria-hidden because the row's status rule and date column already state the
 * item's condition. Announcing the gap as well would be redundant noise.
 */
export function Gap({ width }: { width: number }) {
  const variant = width >= GAP_MIN_DASHED_WIDTH ? "dashed" : "block";

  return (
    <span
      data-gap={variant}
      aria-hidden="true"
      style={{ width: `${width}px`, height: `${Math.round(width * 1.5)}px` }}
      className={
        variant === "dashed"
          ? "block border border-dashed border-rule bg-transparent"
          : "block border-t border-rule bg-leaf"
      }
    />
  );
}
