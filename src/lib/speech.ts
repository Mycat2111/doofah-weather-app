/** Picking a voice for the Web Speech API. */

export interface VoiceInfo {
  name: string;
  lang: string;
  localService: boolean;
  default?: boolean;
}

/** Voices known to sound natural, per language (iOS, macOS, Android, Windows, Edge). */
const GOOD_VOICES =
  /natural|neural|premium|enhanced|google|kanya|narisa|premwadee|niwat|achara|samantha|\bava\b|\baria\b|jenny/i;

/**
 * The best installed voice for `lang` ("th-TH", "en-US"): same language
 * first, then the exact region, then voices that sound natural. Null when
 * the device has no voice for the language at all.
 */
export function pickVoice<V extends VoiceInfo>(voices: readonly V[], lang: string): V | null {
  const want = lang.toLowerCase();
  const base = want.split("-")[0];
  let best: V | null = null;
  let bestScore = -1;
  for (const voice of voices) {
    const vlang = voice.lang.toLowerCase().replace("_", "-");
    if (vlang.split("-")[0] !== base) continue;
    const score =
      (vlang === want ? 4 : 0) +
      (GOOD_VOICES.test(voice.name) ? 2 : 0) +
      (voice.default ? 1 : 0) +
      (voice.localService ? 0.5 : 0);
    if (score > bestScore) {
      best = voice;
      bestScore = score;
    }
  }
  return best;
}
