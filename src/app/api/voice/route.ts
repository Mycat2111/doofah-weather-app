import { voiceServer } from "@/services/tts/googleTts";

const server = voiceServer();

/** One sentence of the spoken summary as MP3, from Google Cloud Text-to-Speech (only when GOOGLE_CLOUD_TTS_API_KEY is set). */
export function GET(request: Request) {
  return server.handle(request);
}
