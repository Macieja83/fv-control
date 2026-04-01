import { describe, expect, it } from "vitest";
import { redactZenboxCredentialsForLog } from "./zenbox-credentials.service.js";

describe("redactZenboxCredentialsForLog", () => {
  it("never includes password field", () => {
    const line = JSON.stringify(
      redactZenboxCredentialsForLog({
        host: "imap.zenbox.pl",
        port: 993,
        username: "user@firma.pl",
        password: "SECRET_SHOULD_NOT_APPEAR",
        tls: true,
        mailbox: "INBOX",
      }),
    );
    expect(line).not.toContain("SECRET");
    expect(line).not.toContain("password");
    expect(line).toContain("imap.zenbox.pl");
    expect(line).toContain("user@firma.pl");
  });
});
