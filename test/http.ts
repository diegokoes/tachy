export const json = (body: unknown) => ({
  method: "POST",
  body: JSON.stringify(body),
  headers: { "Content-Type": "application/json" },
});

export const cookieOf = (res: Response) =>
  res.headers.get("set-cookie")?.split(";")[0] ?? "";

interface AppLike {
  request: (path: string, init?: RequestInit) => Promise<Response>;
}

export async function loginCookie(
  app: AppLike,
  email: string,
  password: string,
): Promise<string> {
  const res = await app.request(
    "/auth/password/login",
    json({ email, password }),
  );
  return cookieOf(res);
}
