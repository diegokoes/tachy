import { onUnauthorized } from "./access/session.svelte";
import { ApiError, readError } from "./problems";

export { ApiError, readError };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  if (response.status === 401) {
    onUnauthorized();
    throw new ApiError(401, "unauthorized");
  }
  if (!response.ok) throw await readError(response);
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
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
