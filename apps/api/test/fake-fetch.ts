/**
 * Fake `fetch` for provider calls (KF5 tests): each test sets `handler` and inspects `calls`.
 * Never reaches the network; unexpected calls answer 599.
 */
export interface FakeCall {
  body: string | null;
  headers: Record<string, string>;
  method: string;
  url: URL;
}

export type FakeHandler = (call: FakeCall) => Promise<Response> | Response;

export function fakeFetch() {
  const state: { calls: FakeCall[]; handler: FakeHandler } = {
    calls: [],
    handler: () => new Response("unexpected call", { status: 599 }),
  };
  const fetchLike = async (input: string | URL, init?: RequestInit) => {
    let body: string | null = null;
    if (init?.body instanceof URLSearchParams) {
      body = init.body.toString();
    } else if (init?.body) {
      body = String(init.body);
    }
    const call: FakeCall = {
      url: new URL(String(input)),
      method: init?.method ?? "GET",
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body,
    };
    state.calls.push(call);
    return await state.handler(call);
  };
  return { state, fetch: fetchLike as unknown as typeof fetch };
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

/** Routes calls by URL without query (`origin + pathname`). */
export function byUrl(routes: Record<string, FakeHandler>): FakeHandler {
  return (call) => {
    const handler = routes[`${call.url.origin}${call.url.pathname}`];
    return handler
      ? handler(call)
      : new Response(`unexpected ${call.url.href}`, { status: 599 });
  };
}

/** An unsigned JWT (id tokens straight from a token endpoint are not signature-checked). */
export function unsignedJwt(payload: Record<string, unknown>): string {
  const enc = (v: unknown) =>
    Buffer.from(JSON.stringify(v)).toString("base64url");
  return `${enc({ alg: "RS256", kid: "test" })}.${enc(payload)}.c2ln`;
}
