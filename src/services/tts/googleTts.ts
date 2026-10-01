/**
 * Server side of /api/voice: reads one sentence of the spoken summary aloud
 * with Google Cloud Text-to-Speech and answers with the MP3. The API key
 * (GOOGLE_CLOUD_TTS_API_KEY) stays on the server; without it the route
 * answers 404 and the page reads with the device's own voice instead.
 *
 * The voices are Google's Chirp 3 HD voices, its most natural ones, with
 * native Thai and English speakers. Which ones a project can use is asked
 * from Google once per server and kept, so a voice Google renames or retires
 * never breaks the reading.
 */

const API = "https://texttospeech.googleapis.com/v1";

/** The languages the summary is read in, and the voice wanted for each (Google's names, without the locale). */
export const VOICE_LANGS = ["th-TH", "en-US"] as const;
export type VoiceLang = (typeof VOICE_LANGS)[number];
const WANTED_VOICE = "Chirp3-HD-Aoede";

/** Longest sentence read, in characters; the summary's run to about 160. */
export const MAX_TEXT = 400;
/** Sentences one visitor may have read in RATE_WINDOW_MS, per server instance. */
export const RATE_LIMIT = 60;
const RATE_WINDOW_MS = 10 * 60_000;
const TIMEOUT_MS = 15_000;
/** How long the list of voices is kept. */
const VOICES_MS = 24 * 3_600_000;

interface GoogleVoice {
  name: string;
  languageCodes: string[];
}

const refuse = (status: number, reason: string, headers: Record<string, string> = {}) =>
  Response.json({ error: true, reason }, { status, headers: { "Cache-Control": "no-store", ...headers } });

/**
 * The most natural voice Google has for `lang`: the wanted Chirp 3 HD voice,
 * else any Chirp 3 HD one, then the older Chirp HD, Neural2, WaveNet and
 * Standard ones. Null when there is none for the language.
 */
export function pickGoogleVoice(voices: readonly GoogleVoice[], lang: VoiceLang): string | null {
  const rank = (name: string) =>
    name === `${lang}-${WANTED_VOICE}`
      ? 0
      : [/-Chirp3-HD-/, /-Chirp-HD-/, /-Neural2-/, /-Wavenet-/, /-Standard-/].findIndex((kind) => kind.test(name)) +
          1 || 9;
  const mine = voices.filter((v) => v.languageCodes.includes(lang)).map((v) => v.name);
  mine.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  return mine[0] ?? null;
}

export interface VoiceServer {
  /** Answers GET /api/voice?lang=th-TH&text=… */
  handle(request: Request): Promise<Response>;
}

export function voiceServer(
  apiKey: string | undefined = process.env.GOOGLE_CLOUD_TTS_API_KEY,
  fetcher: typeof fetch = fetch,
  now: () => number = Date.now,
): VoiceServer {
  let voices: { at: number; names: Promise<Map<VoiceLang, string | null>> } | null = null;
  const visitors = new Map<string, number[]>();

  const call = (path: string, init: RequestInit = {}) =>
    fetcher(`${API}/${path}`, {
      ...init,
      cache: "no-store",
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": apiKey!, ...init.headers },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });

  /** The voice for each language, asked once a day; a failure is asked again next time. */
  function voiceFor(lang: VoiceLang): Promise<string | null> {
    if (!voices || now() - voices.at > VOICES_MS) {
      const names = call("voices").then(async (response) => {
        if (!response.ok) throw new Error(`Google answered ${response.status}`);
        const list = ((await response.json()) as { voices?: GoogleVoice[] }).voices ?? [];
        return new Map(VOICE_LANGS.map((l) => [l, pickGoogleVoice(list, l)]));
      });
      voices = { at: now(), names };
      names.catch(() => {
        if (voices?.names === names) voices = null;
      });
    }
    return voices.names.then((names) => names.get(lang) ?? null);
  }

  /** One more sentence for this visitor, or false when they have had their share. */
  function allow(visitor: string): boolean {
    const since = now() - RATE_WINDOW_MS;
    const recent = (visitors.get(visitor) ?? []).filter((t) => t > since);
    if (recent.length >= RATE_LIMIT) return false;
    recent.push(now());
    visitors.set(visitor, recent);
    if (visitors.size > 5000) for (const [key, times] of visitors) if (times.at(-1)! <= since) visitors.delete(key);
    return true;
  }

  return {
    async handle(request) {
      if (!apiKey) return refuse(404, "No text-to-speech API key is set");
      // Only DooFah's own pages may spend the key: browsers always say where a request comes from.
      if (request.headers.get("sec-fetch-site") !== "same-origin") return refuse(403, "Only DooFah can use this");
      const params = new URL(request.url).searchParams;
      const lang = VOICE_LANGS.find((l) => l === params.get("lang"));
      const text = params.get("text")?.trim() ?? "";
      if (!lang) return refuse(400, "Unknown language");
      if (!text || text.length > MAX_TEXT) return refuse(400, `The text must be 1 to ${MAX_TEXT} characters`);
      const visitor = request.headers.get("x-forwarded-for")?.split(",")[0].trim() || "unknown";
      if (!allow(visitor)) return refuse(429, "Too many readings, try again later", { "Retry-After": "600" });

      try {
        const name = await voiceFor(lang);
        if (!name) return refuse(404, `No ${lang} voice`);
        const response = await call("text:synthesize", {
          method: "POST",
          body: JSON.stringify({
            input: { text },
            voice: { languageCode: lang, name },
            audioConfig: { audioEncoding: "MP3" },
          }),
        });
        const body = (await response.json().catch(() => null)) as {
          audioContent?: string;
          error?: { message?: string };
        } | null;
        if (!response.ok || !body?.audioContent)
          return refuse(502, body?.error?.message ?? `Google answered ${response.status}`);
        return new Response(Buffer.from(body.audioContent, "base64"), {
          headers: {
            "Content-Type": "audio/mpeg",
            "X-Voice": name,
            // The same sentence in the same voice never changes: the browser keeps it a day,
            // and Vercel's edge answers everyone who asks for it for a week without calling Google.
            "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
          },
        });
      } catch {
        return refuse(502, "Google Cloud Text-to-Speech could not be reached");
      }
    },
  };
}
