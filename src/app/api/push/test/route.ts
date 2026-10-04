import { pushServer } from "@/services/push/http";

const server = pushServer();

/** One test notification to this phone, at most once a minute. */
export function POST(request: Request) {
  return server.test(request);
}
