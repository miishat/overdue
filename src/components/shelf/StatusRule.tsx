import type { ReleaseStatus } from "@/db/schema/enums";

export type RuleStyle = "solid" | "dashed" | "dotted" | "none";

/**
 * The certainty axis. Solid means confirmed, dashed means a window, dotted
 * means it exists but has no date, absent means there is no record at all.
 *
 * Exhaustive over ReleaseStatus by switch, so adding a ninth state becomes a
 * compile error here rather than a silently unstyled row.
 */
export function ruleStyleFor(status: ReleaseStatus): RuleStyle {
  switch (status) {
    case "RELEASED":
    case "DATED":
      return "solid";
    case "ESTIMATED":
      return "dashed";
    case "ANNOUNCED":
    case "RUMORED":
      return "dotted";
    case "EXPECTED":
    case "HIATUS":
    case "COMPLETE":
      return "none";
  }
}

/**
 * Human labels. Status must never be communicated by colour alone, so every
 * rule carries one of these for assistive technology.
 */
const LABELS: Record<ReleaseStatus, string> = {
  RELEASED: "Released",
  DATED: "Dated",
  ESTIMATED: "Estimated window",
  ANNOUNCED: "Announced, no date",
  RUMORED: "Rumoured",
  EXPECTED: "Expected, not announced",
  HIATUS: "On hiatus",
  COMPLETE: "Series complete",
};

/**
 * Stepped opacity on the body token. Never a hue.
 *
 * RUMORED is dotted and additionally dimmed, so it gets its own entry here
 * rather than a second opacity class appended alongside the dotted one. Two
 * Tailwind opacity utilities on the same element have equal specificity, so
 * which one wins depends on stylesheet order rather than class order, which
 * would make the dimming unpredictable.
 */
const OPACITY: Record<RuleStyle, string> = {
  solid: "opacity-100",
  dashed: "opacity-70",
  dotted: "opacity-45",
  none: "opacity-0",
};

const RUMORED_OPACITY = "opacity-25";

const BORDER: Record<RuleStyle, string> = {
  solid: "border-solid",
  dashed: "border-dashed",
  dotted: "border-dotted",
  none: "border-none",
};

export function StatusRule({ status }: { status: ReleaseStatus }) {
  const style = ruleStyleFor(status);
  const dimmed = status === "RUMORED";

  return (
    <span
      data-rule={style}
      data-dimmed={dimmed ? "true" : undefined}
      aria-label={LABELS[status]}
      role="img"
      className={[
        // The element keeps its width even when there is no rule, so rows
        // stay aligned down the list.
        "block w-0 self-stretch border-l-2 border-body",
        BORDER[style],
        // Exactly one opacity utility, ever.
        dimmed ? RUMORED_OPACITY : OPACITY[style],
      ].join(" ")}
    />
  );
}
