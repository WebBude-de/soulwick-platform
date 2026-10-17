import { describe, expect, it } from "bun:test";
import shipped from "../content/social.json";
import {
  parseSocialFile,
  SOCIAL_CHANNEL_IDS,
  socialLinks,
} from "../src/lib/social.ts";

/** The social links file (`content/social.json`) and its validation. */

const channel = (id: string, url = "", label = id) => ({ id, label, url });

describe("shipped social.json", () => {
  it("lists every channel once and is valid", () => {
    expect(shipped.channels.map((c) => c.id)).toEqual([...SOCIAL_CHANNEL_IDS]);
    expect(() => parseSocialFile(shipped)).not.toThrow();
  });

  it("renders exactly the channels that have a url, in file order", () => {
    const expected = shipped.channels
      .filter((c) => c.url.trim() !== "")
      .map((c) => c.id);
    expect(socialLinks().map((link) => link.id)).toEqual(expected);
    expect(socialLinks()).toEqual(parseSocialFile(shipped));
  });
});

describe("parseSocialFile", () => {
  it("keeps only channels with a url, in file order", () => {
    const links = parseSocialFile({
      channels: [
        channel("discord", "https://discord.gg/soulwick", "Discord"),
        channel("tiktok"),
        channel("youtube", " https://youtube.com/@soulwick ", "YouTube"),
      ],
    });
    expect(links).toEqual([
      { id: "discord", label: "Discord", url: "https://discord.gg/soulwick" },
      {
        id: "youtube",
        label: "YouTube",
        url: "https://youtube.com/@soulwick",
      },
    ]);
  });

  it("rejects urls that are not https", () => {
    for (const url of [
      "http://discord.gg/x",
      "discord.gg/x",
      "javascript:alert(1)",
    ]) {
      expect(() =>
        parseSocialFile({ channels: [channel("discord", url)] })
      ).toThrow("social.json");
    }
  });

  it("rejects unknown channels (Steam lives in stores.json), duplicates, empty labels and stray fields", () => {
    expect(() =>
      parseSocialFile({ channels: [channel("myspace", "https://a.test")] })
    ).toThrow();
    expect(() =>
      parseSocialFile({
        channels: [channel("steam", "https://store.steampowered.com/app/1")],
      })
    ).toThrow();
    expect(() =>
      parseSocialFile({ channels: [channel("x"), channel("x")] })
    ).toThrow();
    expect(() =>
      parseSocialFile({ channels: [channel("reddit", "", " ")] })
    ).toThrow();
    expect(() =>
      parseSocialFile({
        channels: [{ ...channel("youtube"), URL: "https://youtube.com" }],
      })
    ).toThrow();
    expect(() => parseSocialFile({})).toThrow();
  });
});
