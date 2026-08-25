import { describe, expect, it, vi } from "vitest";
import { installCollectors } from "./collectors.js";
import { TraceClient } from "./client.js";

describe("TraceClient", () => {
  it("does not send events when consent is denied", async () => {
    const fetcher = vi.fn();
    const client = new TraceClient({
      projectId: "proj_1",
      endpoint: "https://trace.example.com/v1/events/batch",
      fetcher,
      consent: "denied",
    });

    client.track("report_export_clicked", { email: "choi@example.com" });
    await client.flush();

    expect(fetcher).not.toHaveBeenCalled();
  });

  it("redacts custom metadata and sends a sanitized batch when consent is granted", async () => {
    window.history.pushState({}, "", "/reports/123?email=choi@example.com&tab=export");
    const fetcher = vi.fn().mockResolvedValue({ ok: true });
    const client = new TraceClient({
      projectId: "proj_1",
      endpoint: "https://trace.example.com/v1/events/batch",
      fetcher,
      consent: "granted",
    });

    client.track("report_export_clicked", { email: "choi@example.com" });
    await client.flush();

    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(init.body));
    expect(payload.url).toBe("http://localhost:3000/reports/:id?redacted_param_1=[redacted]&tab=[redacted]");
    expect(payload.events[0].metadata).toEqual({
      eventName: "report_export_clicked",
    });
    expect(payload.events[0].sessionId).toBe(payload.sessionId);
  });

  it("sends collector events with sanitized dynamic URL paths", async () => {
    window.history.pushState({}, "", "/users/123/settings?email=choi@example.com");
    const fetcher = vi.fn().mockResolvedValue({ ok: true });
    const client = new TraceClient({
      projectId: "proj_1",
      endpoint: "https://trace.example.com/v1/events/batch",
      fetcher,
      consent: "granted",
    });

    installCollectors(client);
    await client.flush();

    const [, init] = fetcher.mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(init.body));
    expect(payload.events[0].type).toBe("page_view");
    expect(payload.events[0].urlPath).toBe("/users/:id/settings");
  });
});
