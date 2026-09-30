import type { Locale } from "../config";
import { en } from "./en";
import { th } from "./th";
import type { Messages } from "./types";

export type { Messages } from "./types";

export const MESSAGES: Record<Locale, Messages> = { en, th };
