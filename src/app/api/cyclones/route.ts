import { cyclonesResponse } from "@/services/cyclones/http";

/** The active tropical cyclones from ECMWF's newest ensemble run (open data, CC BY 4.0). */
export function GET(request: Request) {
  return cyclonesResponse(request);
}
