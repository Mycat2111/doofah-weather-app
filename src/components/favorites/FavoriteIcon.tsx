import { BriefcaseBusiness, House, MapPin, type LucideProps } from "lucide-react";
import type { Favorite } from "@/lib/favorites";

const ICONS = { home: House, office: BriefcaseBusiness };

/** House for "Home", briefcase for "Office", a pin for everything else. */
export function FavoriteIcon({ kind, ...props }: { kind?: Favorite["kind"] } & Omit<LucideProps, "ref">) {
  const Icon = kind ? ICONS[kind] : MapPin;
  return <Icon aria-hidden {...props} />;
}
