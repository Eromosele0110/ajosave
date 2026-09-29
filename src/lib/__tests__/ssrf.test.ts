/**
 * @jest-environment node
 */
import {
  SsrfError,
  assertSafeOutboundUrl,
  defaultOutboundPolicy,
  isPrivateAddress,
  safeFetch,
  type OutboundPolicy,
} from "../ssrf";

const strict = (
  resolve: (h: string) => Promise<string[]> = async () => ["93.184.216.34"]
): OutboundPolicy => ({
  allowPrivateNetwork: false,
  allowHttp: false,
  resolve,
});

describe("isPrivateAddress", () => {
  it.each([
    "0.0.0.0",
    "10.0.0.1",
    "100.64.0.1",
    "127.0.0.1",
    "127.255.255.254",
    "169.254.169.254",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "198.18.0.1",
    "224.0.0.1",
    "255.255.255.255",
  ])("blocks private IPv4 %s", (ip) => expect(isPrivateAddress(ip)).toBe(true));

  it.each([
    "8.8.8.8",
    "93.184.216.34",
    "172.15.255.255",
    "172.32.0.1",
    "100.63.255.255",
    "1.1.1.1",
  ])("allows public IPv4 %s", (ip) => expect(isPrivateAddress(ip)).toBe(false));

  it.each([
    "::",
    "::1",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "fec0::1",
    "ff02::1",
    "2001:db8::1",
    "::ffff:127.0.0.1",
    "::ffff:169.254.169.254",
    "::ffff:7f00:1",
    "64:ff9b::a00:1",
  ])("blocks private IPv6 %s", (ip) => expect(isPrivateAddress(ip)).toBe(true));

  it.each(["2606:4700:4700::1111", "2001:4860:4860::8888", "::ffff:8.8.8.8"])(
    "allows public IPv6 %s",
    (ip) => expect(isPrivateAddress(ip)).toBe(false)
  );

  it("fails closed on unparseable input", () => {
    expect(isPrivateAddress("not-an-ip")).toBe(true);
    expect(isPrivateAddress("1.2.3")).toBe(true);
    expect(isPrivateAddress("1::2::3")).toBe(true);
  });
});

describe("assertSafeOutboundUrl", () => {
  it("accepts an https URL that resolves to a public address", async () => {
    const url = await assertSafeOutboundUrl("https://rpc.example.com/path?q=1", strict());
    expect(url.hostname).toBe("rpc.example.com");
  });

  it("rejects malformed URLs and non-http(s) schemes", async () => {
    await expect(assertSafeOutboundUrl("not a url", strict())).rejects.toBeInstanceOf(SsrfError);
    for (const u of [
      "file:///etc/passwd",
      "ftp://example.com/",
      "gopher://example.com/",
      "data:text/plain,hi",
    ]) {
      await expect(assertSafeOutboundUrl(u, strict())).rejects.toThrow(/scheme/);
    }
  });

  it("rejects plain http unless explicitly allowed", async () => {
    await expect(assertSafeOutboundUrl("http://example.com/", strict())).rejects.toThrow(/scheme/);
    await expect(
      assertSafeOutboundUrl("http://example.com/", { ...strict(), allowHttp: true })
    ).resolves.toBeInstanceOf(URL);
  });

  it("rejects embedded credentials", async () => {
    await expect(assertSafeOutboundUrl("https://user:pw@example.com/", strict())).rejects.toThrow(
      /credentials/
    );
    await expect(assertSafeOutboundUrl("https://user@example.com/", strict())).rejects.toThrow(
      /credentials/
    );
  });

  it.each([
    "https://127.0.0.1/",
    "https://10.1.2.3/",
    "https://169.254.169.254/latest/meta-data/",
    "https://[::1]/",
    "https://[fe80::1]/",
    "https://[::ffff:127.0.0.1]/",
    // Alternative IPv4 spellings are normalised by the URL parser.
    "https://2130706433/",
    "https://0x7f000001/",
    "https://0177.0.0.1/",
    "https://127.1/",
  ])("rejects IP-literal %s", async (u) => {
    await expect(assertSafeOutboundUrl(u, strict())).rejects.toBeInstanceOf(SsrfError);
  });

  it.each([
    "https://localhost/",
    "https://LOCALHOST./",
    "https://app.localhost/",
    "https://printer.local/",
    "https://metadata.google.internal/",
    "https://router.home.arpa/",
  ])("rejects internal hostname %s without resolving it", async (u) => {
    const resolve = jest.fn(async () => ["93.184.216.34"]);
    await expect(assertSafeOutboundUrl(u, strict(resolve))).rejects.toBeInstanceOf(SsrfError);
    expect(resolve).not.toHaveBeenCalled();
  });

  it("rejects a hostname that resolves to a private address", async () => {
    await expect(
      assertSafeOutboundUrl(
        "https://evil.example/",
        strict(async () => ["127.0.0.1"])
      )
    ).rejects.toThrow(/private address/);
  });

  it("rejects when any one resolved address is private (DNS rebinding style)", async () => {
    await expect(
      assertSafeOutboundUrl(
        "https://evil.example/",
        strict(async () => ["93.184.216.34", "169.254.169.254"])
      )
    ).rejects.toThrow(/private address/);
  });

  it("rejects when resolution fails or returns nothing", async () => {
    await expect(
      assertSafeOutboundUrl(
        "https://nx.example/",
        strict(async () => {
          throw new Error("ENOTFOUND");
        })
      )
    ).rejects.toThrow(/could not be resolved/);
    await expect(
      assertSafeOutboundUrl(
        "https://nx.example/",
        strict(async () => [])
      )
    ).rejects.toThrow(/could not be resolved/);
  });

  it("enforces the host allow list, case-insensitively", async () => {
    const policy = { ...strict(), allowedHosts: ["Api.Partner.com"] };
    await expect(
      assertSafeOutboundUrl("https://api.partner.com/x", policy)
    ).resolves.toBeInstanceOf(URL);
    await expect(assertSafeOutboundUrl("https://other.com/x", policy)).rejects.toThrow(
      /allow list/
    );
  });

  it("allows private destinations only when the policy says so", async () => {
    const dev: OutboundPolicy = { allowPrivateNetwork: true, allowHttp: true };
    await expect(assertSafeOutboundUrl("http://localhost:8000/rpc", dev)).resolves.toBeInstanceOf(
      URL
    );
    await expect(assertSafeOutboundUrl("http://10.0.0.5/", dev)).resolves.toBeInstanceOf(URL);
    // Credentials and odd schemes stay blocked even in dev.
    await expect(assertSafeOutboundUrl("file:///etc/passwd", dev)).rejects.toThrow(/scheme/);
    await expect(assertSafeOutboundUrl("http://a:b@localhost/", dev)).rejects.toThrow(
      /credentials/
    );
  });
});

describe("defaultOutboundPolicy", () => {
  it("is strict in production", () => {
    expect(defaultOutboundPolicy({ NODE_ENV: "production" })).toEqual({
      allowPrivateNetwork: false,
      allowHttp: false,
    });
  });
  it("is relaxed outside production", () => {
    expect(defaultOutboundPolicy({ NODE_ENV: "development" })).toEqual({
      allowPrivateNetwork: true,
      allowHttp: true,
    });
    expect(defaultOutboundPolicy({ NODE_ENV: "test" }).allowPrivateNetwork).toBe(true);
  });
  it("can be opened explicitly in production", () => {
    expect(
      defaultOutboundPolicy({ NODE_ENV: "production", OUTBOUND_ALLOW_PRIVATE_NETWORK: "true" })
        .allowPrivateNetwork
    ).toBe(true);
  });
});

describe("safeFetch", () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it("does not call fetch for a blocked destination", async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    await expect(
      safeFetch("https://169.254.169.254/latest/meta-data/", {}, strict())
    ).rejects.toBeInstanceOf(SsrfError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes the request through and disables redirect following", async () => {
    const fetchMock = jest.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;
    const res = await safeFetch(
      "https://rpc.example.com/x",
      { method: "POST", body: "{}" },
      strict()
    );
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://rpc.example.com/x",
      expect.objectContaining({ method: "POST", body: "{}", redirect: "manual" })
    );
  });

  it("treats a redirect response as an error", async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(
        new Response(null, { status: 302, headers: { location: "http://169.254.169.254/" } })
      ) as unknown as typeof fetch;
    await expect(safeFetch("https://rpc.example.com/x", {}, strict())).rejects.toThrow(
      /redirected/
    );
  });
});
