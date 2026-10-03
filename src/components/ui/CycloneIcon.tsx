import type { SVGProps } from "react";

/** The weather map symbol for a tropical cyclone (an eye with two arms), as markup for map markers. */
export const CYCLONE_GLYPH =
  '<circle cx="12" cy="12" r="3"/><path d="M12 9c0-3.4 2.4-6 6.5-6.5"/><path d="M12 15c0 3.4-2.4 6-6.5 6.5"/>';

/** The same symbol drawn like Lucide's icons. */
export function CycloneIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <circle cx="12" cy="12" r="3" />
      <path d="M12 9c0-3.4 2.4-6 6.5-6.5" />
      <path d="M12 15c0 3.4-2.4 6-6.5 6.5" />
    </svg>
  );
}
