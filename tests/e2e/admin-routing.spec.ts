import { expect, test } from "@playwright/test";

test("serves the Admin Panel health check at the root", async ({ request }) => {
  const response = await request.get("/healthz", { maxRedirects: 0 });
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: "ok", component: "admin-panel" });
});

test("redirects legacy admin URLs while preserving paths, queries, and origin", async ({ request }) => {
  for (const [legacy, canonical] of [
    ["/admin", "/"],
    ["/admin/", "/"],
    ["/admin/user-studies?search=lane%20change&status=draft", "/user-studies?search=lane%20change&status=draft"],
    ["/admin/user-studies/example/participant-view?layoutId=example", "/user-studies/example/participant-view?layoutId=example"],
    ["/admin/login?redirectTo=%2Fuser-studies%3Fstatus%3Ddraft", "/login?redirectTo=%2Fuser-studies%3Fstatus%3Ddraft"],
    ["/admin/overlay/widget-runtime.js", "/overlay/widget-runtime.js"],
    ["/admin//external.example/path?value=1", "/external.example/path?value=1"],
  ] as const) {
    const response = await request.get(legacy, { maxRedirects: 0 });
    expect(response.status(), legacy).toBe(308);
    const target = new URL(response.headers().location!, response.url());
    expect(target.origin, legacy).toBe(new URL(response.url()).origin);
    expect(`${target.pathname}${target.search}`, legacy).toBe(canonical);
  }
});

test("keeps POST requests and authentication checks when following legacy URLs", async ({ request }) => {
  const legacy = "/admin/api/realtime/ticket?source=legacy";
  const response = await request.post(legacy, { data: {}, maxRedirects: 0 });
  expect(response.status()).toBe(308);
  const target = new URL(response.headers().location!, response.url());
  expect(`${target.pathname}${target.search}`).toBe("/api/realtime/ticket?source=legacy");

  const followed = await request.post(legacy, { data: {} });
  expect(new URL(followed.url()).pathname).toBe("/api/realtime/ticket");
  expect(followed.status()).toBe(401);
  expect(await followed.json()).toMatchObject({ message: "Authentication required" });
});

test("keeps similarly named prefixes in authentication return paths", async ({ request }) => {
  for (const pathname of ["/administrator/healthz", "/admin-panel/healthz"]) {
    const response = await request.get(pathname, { maxRedirects: 0 });
    expect(response.status(), pathname).toBe(303);
    const target = new URL(response.headers().location!, response.url());
    expect(target.pathname).toBe("/login");
    expect(target.searchParams.get("redirectTo")).toBe(pathname);
  }
});

test("loads the root login screen for a protected legacy bookmark", async ({ page }) => {
  const failedAssets: string[] = [];
  page.on("response", (response) => {
    if (["script", "stylesheet"].includes(response.request().resourceType()) && !response.ok()) {
      failedAssets.push(response.url());
    }
  });

  await page.goto("/admin/user-studies?status=draft");
  await expect(page).toHaveURL((url) => url.pathname === "/login" && url.searchParams.get("redirectTo") === "/user-studies?status=draft");
  await expect(page.getByLabel("Username")).toBeVisible();
  await expect(page.getByLabel("Password")).toBeVisible();
  await expect(page.getByRole("button", { name: "Login" })).toBeVisible();
  expect(failedAssets).toEqual([]);
});
