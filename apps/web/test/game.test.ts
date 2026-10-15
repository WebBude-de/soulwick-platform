import { afterEach, describe, expect, it, mock } from "bun:test";

// `server-only` throws outside the react-server condition; Next.js resolves it to an empty module.
mock.module("server-only", () => ({}));
const { gameLinks, parseGameUrl } = await import("../src/lib/game.ts");

const ORIGINAL = process.env.GAME_URL;

afterEach(() => {
  if (ORIGINAL === undefined) {
    delete process.env.GAME_URL;
  } else {
    process.env.GAME_URL = ORIGINAL;
  }
});

describe("parseGameUrl", () => {
  it("is null when unset or empty (browser version not available yet)", () => {
    expect(parseGameUrl(undefined)).toBeNull();
    expect(parseGameUrl("")).toBeNull();
    expect(parseGameUrl("   ")).toBeNull();
  });

  it("is null for anything that is not an absolute http(s) URL", () => {
    for (const value of [
      "game-dev.playsoulwick.com",
      "/game",
      "javascript:alert(1)",
      "ftp://game.playsoulwick.com",
    ]) {
      expect(parseGameUrl(value)).toBeNull();
    }
  });

  it("builds the play and install links", () => {
    expect(parseGameUrl(" https://game-dev.playsoulwick.com ")).toEqual({
      play: "https://game-dev.playsoulwick.com/",
      install: "https://game-dev.playsoulwick.com/?install",
    });
  });

  it("keeps a path and an existing query, drops the hash", () => {
    expect(parseGameUrl("https://example.test/soulwick/?ref=web#top")).toEqual({
      play: "https://example.test/soulwick/?ref=web",
      install: "https://example.test/soulwick/?ref=web&install",
    });
  });
});

describe("gameLinks", () => {
  it("reads GAME_URL on every call, not once at import", () => {
    delete process.env.GAME_URL;
    expect(gameLinks()).toBeNull();
    process.env.GAME_URL = "https://game.playsoulwick.com";
    expect(gameLinks()?.install).toBe("https://game.playsoulwick.com/?install");
    process.env.GAME_URL = "";
    expect(gameLinks()).toBeNull();
  });
});
