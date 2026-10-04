/**
 * A storm notification's text: the storm banner's own wording, in the
 * phone's language and time zone, so a push never says something the app
 * doesn't. Tapping it opens that place with the storm on the map.
 */

import type { Locale } from "@/i18n/config";
import { createFormatters } from "@/i18n/format";
import { MESSAGES } from "@/i18n/messages";
import { whenText } from "@/i18n/when";
import { ALERT_KM, type CycloneAlert } from "@/lib/cyclones";
import { stormLink, STORM_ID } from "@/lib/pushLink";
import type { PushMessage } from "./send";

export function stormMessage(alert: CycloneAlert, lang: Locale, timeZone: string, now: number): PushMessage {
  const m = MESSAGES[lang];
  const f = createFormatters(lang);
  const storm = m.cyclones.storm(m.cyclones.category[alert.category], alert.name ?? alert.stormId);
  const when = alert.at && whenText(m, f, alert.at, timeZone, now);
  return {
    title:
      alert.at === null
        ? m.alerts.cyclone.already(storm, alert.km, alert.place)
        : m.alerts.cyclone.near(storm, alert.km, alert.place),
    body: m.alerts.cyclone.detail(when, alert.windKmh, alert.chance, ALERT_KM),
    // One notification per storm on the phone: a severe alert replaces the warning.
    tag: `storm-${alert.stormId}`,
    level: alert.level,
    lang,
    // An id the page wouldn't read opens DooFah on its own.
    url: STORM_ID.test(alert.stormId) ? stormLink(alert.stormId, alert.placeId) : "/",
  };
}
