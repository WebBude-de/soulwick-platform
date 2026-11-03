import { describe, expect, it } from "bun:test";
import { WEB_LOGIN_BROWSER_TOKEN_HEADER } from "@soulwick/contracts";
import { loginError } from "../src/lib/login-form";
import {
  FRAGMENT_SCRIPT,
  keyStorageName,
  LOGIN_API,
  oauthStartAction,
  toLoginState,
} from "../src/lib/login-protocol";

/** KF11: the login pages read the API only through `login-protocol.ts`. */
describe("login protocol", () => {
  const base = {
    code: "ABCDEFGH",
    status: "pending",
    expiresAt: "2026-11-03T12:10:00.000Z",
    authorized: true,
    intent: "sign_in",
    account: null,
    newAccount: false,
    methods: ["email", "google", "steam"],
    provider: null,
    result: null,
    merged: false,
    error: null,
    merge: null,
    ban: null,
    attemptsLeft: null,
  };

  it("reads an authorized pending request", () => {
    const state = toLoginState(base, "ABCDEFGH");
    expect(state.status).toBe("pending");
    expect(state.restricted).toBe(false);
    expect(state.methods).toEqual(["email", "google", "steam"]);
  });

  it("treats an answer without the browser key as restricted", () => {
    const state = toLoginState(
      { ...base, authorized: false, methods: [] },
      "ABCDEFGH"
    );
    expect(state.restricted).toBe(true);
  });

  it("shows a collected request as done", () => {
    const state = toLoginState(
      { ...base, status: "expired", result: "signed_in" },
      "ABCDEFGH"
    );
    expect(state.status).toBe("completed");
  });

  it("keeps an expired request without result expired", () => {
    expect(toLoginState({ ...base, status: "expired" }, "X").status).toBe(
      "expired"
    );
  });

  it("reads the confirmation step with attempts and a ban", () => {
    const waiting = toLoginState(
      {
        ...base,
        status: "awaiting_confirm",
        account: { name: "Lumen", level: 10 },
        attemptsLeft: 3,
      },
      "ABCDEFGH"
    );
    expect(waiting.status).toBe("awaiting_confirm");
    expect(waiting.account).toEqual({ name: "Lumen", level: 10 });
    expect(waiting.attemptsLeft).toBe(3);
    const banned = toLoginState(
      {
        ...base,
        status: "failed",
        error: "banned",
        ban: { reason: "Cheating", expiresAt: null },
      },
      "ABCDEFGH"
    );
    expect(banned.ban).toEqual({ reason: "Cheating", expiresAt: null });
  });

  it("survives garbage", () => {
    const state = toLoginState("nope", "ABCDEFGH");
    expect(state.status).toBe("expired");
    expect(state.code).toBe("ABCDEFGH");
  });

  it("posts provider forms to the API, the token never in the URL", () => {
    expect(oauthStartAction("https://api.example.test", "google")).toBe(
      "https://api.example.test/auth/oauth/google/start"
    );
    expect(LOGIN_API.oauthTokenField).toBe("browserToken");
  });

  it("uses the contract's token header", () => {
    expect(LOGIN_API.tokenHeader).toBe(WEB_LOGIN_BROWSER_TOKEN_HEADER);
  });

  it("hides #k= before the first paint under the key the page reads", () => {
    const store = new Map<string, string>();
    let replaced = "";
    const win: Record<string, unknown> = {};
    const run = new Function(
      "location",
      "sessionStorage",
      "history",
      "window",
      FRAGMENT_SCRIPT
    );
    run(
      { pathname: "/login/abcd-efgh", hash: "#k=secret123", search: "" },
      { setItem: (k: string, v: string) => store.set(k, v) },
      {
        state: null,
        replaceState: (_s: unknown, _t: string, url: string) => {
          replaced = url;
        },
      },
      win
    );
    expect(store.get(keyStorageName("ABCDEFGH"))).toBe("secret123");
    expect(replaced).toBe("/login/abcd-efgh");
    expect(win.__soulwickLoginKey).toBe("secret123");
  });

  it("maps API error codes to page messages", () => {
    expect(loginError("steam_unavailable")).toBe("provider_error");
    expect(loginError("invalid_oauth_code")).toBe("invalid_login");
    expect(loginError("banned")).toBe("banned");
    expect(loginError("something_new")).toBe("generic");
    expect(loginError(null)).toBe("generic");
  });
});
