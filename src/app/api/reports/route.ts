import { reportsServer } from "@/services/reports/http";

const server = reportsServer();

/** One map tile's weather reports from the last 3 hours, for ?tile=size,row,col. */
export function GET(request: Request) {
  return server.list(request);
}

/** Send a report: { kind, lat, lon, device }. */
export function POST(request: Request) {
  return server.submit(request);
}
