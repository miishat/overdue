/**
 * Marks a shelf entry that changed since the user's last visit.
 *
 * Carries a text label, not colour alone, per the project's accessibility
 * constraint. Lives inside the identity slot rather than as a fifth grid
 * area, per the theme contract ShelfRow enforces.
 */
export function ChangedBadge() {
  return (
    <span
      data-badge="changed"
      className="mt-1 inline-block font-mono text-[10px] uppercase tracking-wide text-verdigris"
    >
      New
    </span>
  );
}
