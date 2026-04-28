import { timingSafeEqual } from "node:crypto";

export function safeKeyCompare(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

export function extractApiKey(
  xApiKey: string | undefined,
  authorization: string | undefined,
): string {
  const fromHeader = (xApiKey ?? "").trim();
  if (fromHeader) {
    return fromHeader;
  }
  const auth = authorization ?? "";
  const prefix = "Bearer ";
  if (auth.startsWith(prefix)) {
    return auth.slice(prefix.length).trim();
  }
  return "";
}
