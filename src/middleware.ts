import { NextResponse, type NextRequest } from "next/server";

/**
 * Custom portal domains (Agency plan). A request whose Host is not the app's own host may only reach
 * client-facing routes; the portal page itself verifies that the domain belongs to the link's workspace.
 */
const PUBLIC_PREFIXES = ["/p/", "/pay/", "/u/", "/approve/", "/cs/", "/api/unsubscribe/", "/_next/", "/favicon", "/samples/"];

export function middleware(req: NextRequest) {
  const appUrl = process.env.APP_URL;
  if (!appUrl) return NextResponse.next();
  const appHost = new URL(appUrl).host.toLowerCase();
  const host = (req.headers.get("host") ?? "").toLowerCase();
  if (!host || host === appHost || host.startsWith("localhost") || host.startsWith("127.0.0.1")) return NextResponse.next();
  const path = req.nextUrl.pathname;
  if (PUBLIC_PREFIXES.some((p) => path.startsWith(p))) return NextResponse.next();
  return NextResponse.redirect(new URL(path === "/" ? "/" : path, appUrl));
}

export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
