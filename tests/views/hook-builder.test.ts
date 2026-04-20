import { describe, it, expect } from "vitest";
import { hookBuilder, parseHookForm } from "../../src/views/hook-builder.js";
import type { Hook } from "../../src/db.js";

function mkHook(type: string, config: Record<string, unknown>): Hook {
  return {
    id: "h1",
    mappingId: "m1",
    type,
    config: JSON.stringify(config),
    lastRunAt: null,
    lastStatus: null,
    lastError: null,
  };
}

describe("hookBuilder", () => {
  it("renders an empty container + add button when no hooks are supplied", () => {
    const html = hookBuilder();
    expect(html).toContain('id="hooks-container"');
    expect(html).toContain("+ Add Hook");
    expect(html).toContain("var seeds = [];");
  });

  it("emits seeds for pre-populated hooks, translating plugin rows to a display-level plex type", () => {
    const html = hookBuilder([
      mkHook("plugin", { plugin: "plex", host: "http://plex.lan:32400", token: "abc" }),
      mkHook("webhook", { url: "https://example.com/hook", method: "POST" }),
    ]);
    // The stored row is { type: "plugin", config.plugin: "plex" } but the builder
    // surfaces "plex" as a first-class type so it can be selected directly.
    expect(html).toContain('"type":"plex"');
    expect(html).toContain('"host":"http://plex.lan:32400"');
    expect(html).toContain('"token":"abc"');
    // The synthetic "plugin" key is stripped from the displayed config so the
    // form doesn't re-emit it as an input (it gets re-added at submit time).
    expect(html).not.toMatch(/"config":\{[^}]*"plugin":"plex"/);
    expect(html).toContain('"type":"webhook"');
    expect(html).toContain('"url":"https://example.com/hook"');
  });

  it("renders Plex + Webhook + Command as peer type options with help text", () => {
    const html = hookBuilder();
    // Server-rendered TYPE_OPTIONS literal exposes every selectable type.
    expect(html).toContain('"id":"plex"');
    expect(html).toContain('"label":"Plex"');
    expect(html).toContain('"id":"webhook"');
    expect(html).toContain('"id":"command"');
    // Help text from the plex descriptor is embedded for the JS to render.
    expect(html).toContain("X-Plex-Token");
  });

  it("escapes < in seed JSON so </script> can't terminate the inline script", () => {
    const html = hookBuilder([mkHook("command", { command: "</script><script>alert(1)</script>" })]);
    // The raw </script that would end the inline <script> block must not appear.
    expect(html).not.toMatch(/<\/script>\s*<script>alert/);
    expect(html).toContain("\\u003c/script>");
  });
});

describe("parseHookForm", () => {
  it("groups hooks[N][field] inputs into one entry per index", () => {
    const body = {
      "hooks[0][type]": "plugin",
      "hooks[0][plugin]": "plex",
      "hooks[0][host]": "http://plex.lan:32400",
      "hooks[0][token]": "tok",
      "hooks[1][type]": "webhook",
      "hooks[1][url]": "https://example.com/hook",
      "hooks[1][method]": "POST",
      label: "ignored",
    };
    const parsed = parseHookForm(body);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].type).toBe("plugin");
    expect(JSON.parse(parsed[0].config)).toEqual({
      plugin: "plex",
      host: "http://plex.lan:32400",
      token: "tok",
    });
    expect(parsed[1].type).toBe("webhook");
    expect(JSON.parse(parsed[1].config)).toEqual({
      url: "https://example.com/hook",
      method: "POST",
    });
  });

  it("drops groups without a type field (incomplete rows)", () => {
    const body = {
      "hooks[0][plugin]": "plex",
      "hooks[0][host]": "http://plex.lan:32400",
    };
    expect(parseHookForm(body)).toEqual([]);
  });

  it("drops empty fields from the stored config", () => {
    const body = {
      "hooks[0][type]": "plugin",
      "hooks[0][plugin]": "plex",
      "hooks[0][host]": "http://plex.lan:32400",
      "hooks[0][token]": "",
    };
    const parsed = parseHookForm(body);
    expect(JSON.parse(parsed[0].config)).toEqual({
      plugin: "plex",
      host: "http://plex.lan:32400",
    });
  });

  it("translates a display-level 'plex' submission into storage shape { type:'plugin', config.plugin:'plex' }", () => {
    const body = {
      "hooks[0][type]": "plex",
      "hooks[0][host]": "http://plex.lan:32400",
      "hooks[0][token]": "tok",
    };
    const parsed = parseHookForm(body);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].type).toBe("plugin");
    expect(JSON.parse(parsed[0].config)).toEqual({
      plugin: "plex",
      host: "http://plex.lan:32400",
      token: "tok",
    });
  });

  it("leaves webhook and command types unchanged by the plugin translation", () => {
    const body = {
      "hooks[0][type]": "webhook",
      "hooks[0][url]": "https://example.com/hook",
      "hooks[0][method]": "POST",
      "hooks[1][type]": "command",
      "hooks[1][command]": "/bin/echo {{label}}",
    };
    const parsed = parseHookForm(body);
    expect(parsed[0].type).toBe("webhook");
    expect(parsed[1].type).toBe("command");
  });
});
