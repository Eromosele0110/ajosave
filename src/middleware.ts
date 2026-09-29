import { NextRequest, NextResponse } from "next/server";
import { checkCsrf, resolveAllowedOrigins } from "@/lib/csrf";

export function middleware(request: NextRequest) {
  const origin = request.headers.get("origin");

  const allowedOrigins = resolveAllowedOrigins();

  // CSRF: cookie-authenticated mutations must come from an allowed origin (#104).
  if (request.nextUrl.pathname.startsWith("/api/")) {
    const csrf = checkCsrf({
      method: request.method,
      pathname: request.nextUrl.pathname,
      headers: request.headers,
      requestOrigin: request.nextUrl.origin,
      allowedOrigins,
    });
    if (!csrf.ok) {
      console.warn(
        `[csrf] blocked ${request.method} ${request.nextUrl.pathname}: ${csrf.reason}`
      );
      return NextResponse.json(
        { success: false, error: "CSRF validation failed" },
        { status: 403 }
      );
    }
  }

  // Handle API versioning redirects
  if (request.nextUrl.pathname.startsWith("/api/") && !request.nextUrl.pathname.startsWith("/api/v1/")) {
    // Skip auth routes as they need special handling
    if (!request.nextUrl.pathname.startsWith("/api/auth/")) {
      const newUrl = request.nextUrl.clone();
      newUrl.pathname = newUrl.pathname.replace('/api/', '/api/v1/');
      
      const response = NextResponse.redirect(newUrl, {
        status: request.method === 'GET' ? 301 : 308,
      });
      
      response.headers.set('X-API-Deprecated', 'true');
      response.headers.set('X-API-Deprecation-Info', `This endpoint is deprecated. Use ${newUrl.pathname} instead.`);
      
      return response;
    }
  }

  // Handle CORS for API routes
  if (request.nextUrl.pathname.startsWith("/api/")) {
    // If it's a CORS request (origin header is present)
    if (origin) {
      const isAllowed = allowedOrigins.includes(origin);
      if (!isAllowed) {
        return NextResponse.json(
          { error: "Origin not allowed by CORS policy" },
          { status: 403 }
        );
      }

      // Handle preflight requests
      if (request.method === "OPTIONS") {
        const response = new NextResponse(null, { status: 204 });
        response.headers.set("Access-Control-Allow-Origin", origin);
        response.headers.set(
          "Access-Control-Allow-Methods",
          "GET, POST, PUT, DELETE, PATCH, OPTIONS"
        );
        response.headers.set(
          "Access-Control-Allow-Headers",
          "Content-Type, Authorization, X-Requested-With, X-CSRF-Token"
        );
        response.headers.set("Access-Control-Allow-Credentials", "true");
        response.headers.set("Access-Control-Max-Age", "86400");
        return response;
      }

      // Handle regular requests (GET, POST, etc.)
      const response = NextResponse.next();
      response.headers.set("Access-Control-Allow-Origin", origin);
      response.headers.set(
        "Access-Control-Allow-Methods",
        "GET, POST, PUT, DELETE, PATCH, OPTIONS"
      );
      response.headers.set(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization, X-Requested-With, X-CSRF-Token"
      );
      response.headers.set("Access-Control-Allow-Credentials", "true");
      return response;
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: "/api/:path*",
};
