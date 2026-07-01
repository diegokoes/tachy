// Single-origin fetch helper. The SPA is served by the same Hono process that
// serves /api, so all calls are relative — no base URL, no CORS. Session auth
// rides on the cookie automatically (credentials: "same-origin" is the default).
// A 401 means the session/token is missing; callers redirect to /auth/login.

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (res.status === 401) {
    // Interactive user with no session — bounce to SSO login.
    window.location.href = `/auth/login?redirect=${encodeURIComponent(location.pathname + location.search)}`;
    throw new ApiError(401, "unauthorized");
  }
  const text = await res.text();
  const body = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw new ApiError(res.status, body?.error ?? res.statusText, body);
  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(data) }),
  patch: <T>(path: string, data: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(data) }),
};
