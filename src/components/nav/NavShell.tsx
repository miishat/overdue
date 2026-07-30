import Link from "next/link";

/**
 * Settings is deliberately absent: it has no page yet, and a nav entry that
 * leads nowhere is worse than one destination fewer.
 */
export const NAV_DESTINATIONS = [
  { href: "/", label: "Waiting" },
  { href: "/library", label: "Library" },
  { href: "/search", label: "Search" },
] as const;

export function NavShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <nav aria-label="Main" className="border-b border-rule bg-leaf">
        <ul className="mx-auto flex max-w-3xl gap-6 px-4 py-3">
          {NAV_DESTINATIONS.map((destination) => (
            <li key={destination.href}>
              <Link
                href={destination.href}
                className="font-mono text-[11px] uppercase tracking-wide text-quiet no-underline"
              >
                {destination.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {children}
    </>
  );
}
