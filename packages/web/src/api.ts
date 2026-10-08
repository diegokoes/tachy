import { onUnauthorized } from "./access/session.svelte";

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
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (response.status === 401) {
    onUnauthorized();
    throw new ApiError(401, "unauthorized");
  }
  const text = await response.text();
  const body = text ? JSON.parse(text) : undefined;
  if (!response.ok)
    throw new ApiError(
      response.status,
      body?.error ?? response.statusText,
      body,
    );
  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data: unknown) =>
    request<T>(path, { method: "POST", body: JSON.stringify(data) }),
  patch: <T>(path: string, data: unknown) =>
    request<T>(path, { method: "PATCH", body: JSON.stringify(data) }),
  put: <T>(path: string, data: unknown) =>
    request<T>(path, { method: "PUT", body: JSON.stringify(data) }),
  delete: <T>(path: string, data?: unknown) =>
    request<T>(path, {
      method: "DELETE",
      ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
    }),
};
