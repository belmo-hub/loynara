import { afterEach, expect, it, vi } from "vitest";
import { sendLocalMailpit } from "./email";
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it("uses the explicitly isolated loopback Mailpit capture without external delivery", async () => {
  vi.stubEnv("MAILPIT_HTTP_ORIGIN", "http://127.0.0.1:18149");
  const send = vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }));
  vi.stubGlobal("fetch", send);
  await sendLocalMailpit({ to: "holder@example.test", subject: "Synthetic", body: "Test capture", jobId: "test-job" });
  expect(send.mock.calls[0][0]).toBe("http://127.0.0.1:18149/api/v1/send");
});
it.each(["https://mail.example.test", "http://localhost:18149/path", "http://user:secret@127.0.0.1:18149"])("refuses a non-loopback or malformed capture origin: %s", async origin => {
  vi.stubEnv("MAILPIT_HTTP_ORIGIN", origin);
  const send = vi.fn<typeof fetch>(async () => new Response(null, { status: 200 }));
  vi.stubGlobal("fetch", send);
  await expect(sendLocalMailpit({ to: "holder@example.test", subject: "Synthetic", body: "Test capture", jobId: "test-job" })).rejects.toThrow();
  expect(send).not.toHaveBeenCalled();
});
