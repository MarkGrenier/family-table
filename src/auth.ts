const SESSION_MESSAGE = "family-grocery-session-v1";
const COOKIE = "grocery_session";
const YEAR_SECONDS = 60 * 60 * 24 * 400;

function safeEqual(a: string, b: string): boolean {
  const aa = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  const len = Math.max(aa.length, bb.length, 1);
  let mismatch = aa.length === bb.length ? 0 : 1;
  for (let i = 0; i < len; i++) {
    mismatch |= (aa[i] ?? 0) ^ (bb[i] ?? 0);
  }
  return mismatch === 0;
}

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(signature)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function sessionToken(passcode: string): Promise<string> {
  return hmacHex(passcode, SESSION_MESSAGE);
}

export async function deriveShareKey(passcode: string, person: string): Promise<string> {
  const digest = await hmacHex(passcode, `family-share-v1:${person}`);
  const slug = person.toLowerCase().replace(/[^a-z]/g, "") || "person";
  return `ft_${slug}_${digest.slice(0, 32)}`;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function readCookie(header: string | null, name = COOKIE): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const trimmed = part.trim();
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    if (trimmed.slice(0, eq) === name) return trimmed.slice(eq + 1);
  }
  return null;
}

export async function rollingSessionCookie(request: Request, passcode: string | undefined): Promise<string | null> {
  if (!(await sessionOk(request, passcode))) return null;
  const token = readCookie(request.headers.get("Cookie"));
  if (!token) return null;
  return sessionCookie(token, request);
}

export async function sessionOk(request: Request, passcode: string | undefined): Promise<boolean> {
  if (!passcode) return false;
  const token = readCookie(request.headers.get("Cookie"));
  if (!token) return false;
  const expected = await sessionToken(passcode);
  return safeEqual(token, expected);
}

export function bearerOk(request: Request, apiToken: string | undefined): boolean {
  if (!apiToken) return false;
  const header = request.headers.get("Authorization") ?? "";
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header);
  if (!match) return false;
  return safeEqual(match[1], apiToken);
}

export async function requestAuthed(
  request: Request,
  passcode: string | undefined,
  apiToken: string | undefined,
): Promise<boolean> {
  if (bearerOk(request, apiToken)) return true;
  return sessionOk(request, passcode);
}

export function sessionCookie(token: string, request: Request): string {
  const secure = new URL(request.url).protocol === "https:";
  const parts = [
    `${COOKIE}=${token}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${YEAR_SECONDS}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookie(request: Request): string {
  const secure = new URL(request.url).protocol === "https:";
  const parts = [`${COOKIE}=`, "HttpOnly", "Path=/", "SameSite=Lax", "Max-Age=0"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function passcodeMatches(given: string, expected: string): boolean {
  return safeEqual(given, expected);
}
