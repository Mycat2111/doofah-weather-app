import { pushServer } from "@/services/push/http";

const server = pushServer();

/** Turn storm alerts on for this phone, or send its places, language and time zone again. */
export function POST(request: Request) {
  return server.subscribe(request);
}

/** The browser renewed the push subscription (the service worker calls this). */
export function PUT(request: Request) {
  return server.subscribe(request);
}

/** Turn storm alerts off: this phone's record is deleted. */
export function DELETE(request: Request) {
  return server.subscribe(request);
}
