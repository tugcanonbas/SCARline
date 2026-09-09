import AxeBuilder from "@axe-core/playwright";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { randomBytes } from "node:crypto";

const adminUsername = process.env.SCARLINE_E2E_ADMIN_USERNAME ?? "admin";
const initialPassword = process.env.SCARLINE_E2E_ADMIN_INITIAL_PASSWORD ?? "";
const adminPassword = process.env.SCARLINE_E2E_ADMIN_PASSWORD ?? "";
const coreOrigin = process.env.SCARLINE_E2E_CORE_ORIGIN ?? "http://127.0.0.1:8088";
const overlayOrigin = process.env.SCARLINE_E2E_OVERLAY_ORIGIN ?? "http://127.0.0.1:4000";

async function login(page: Page, username: string, password: string) {
  await page.goto("/admin/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Login" }).click();
}

async function changePassword(page: Page, currentPassword: string, newPassword: string) {
  await expect(page).toHaveURL(/\/admin\/change-password/);
  await page.getByLabel("Current Password").fill(currentPassword);
  await page.locator('input[name="newPassword"]').fill(newPassword);
  await page.getByLabel("Confirm New Password").fill(newPassword);
  await page.getByRole("button", { name: "Change Password" }).click();
  await expect(page).toHaveURL(/\/admin\/login/);
}

async function accessToken(context: BrowserContext) {
  const cookie = (await context.cookies()).find((entry) => entry.name === "scarline_access_token");
  if (!cookie) throw new Error("Admin Panel did not store an access-token session cookie");
  return cookie.value;
}

async function api(token: string, method: string, path: string, body?: unknown) {
  const response = await fetch(`${coreOrigin}/api/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
      origin: process.env.SCARLINE_E2E_ADMIN_ORIGIN ?? "http://127.0.0.1:5173",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`${method} ${path} returned ${response.status}: ${JSON.stringify(payload)}`);
  return payload?.data;
}

async function expectNoCriticalAccessibilityViolations(page: Page) {
  const results = await new AxeBuilder({ page }).analyze();
  expect(results.violations.filter((violation) => violation.impact === "critical")).toEqual([]);
}

test("production Admin Panel supports bootstrap, study creation, RBAC, and safe status", async ({ browser, page, context }) => {
  test.skip(!initialPassword || !adminPassword, "The isolated runner must supply bootstrap credentials");

  await login(page, adminUsername, initialPassword);
  await changePassword(page, initialPassword, adminPassword);
  await login(page, adminUsername, adminPassword);
  await expect(page).toHaveURL(/\/admin\/(dashboard)?$/);
  await expect(page.getByRole("heading", { name: /dashboard/i })).toBeVisible();
  await expectNoCriticalAccessibilityViolations(page);

  await page.goto("/admin/user-studies/new");
  await page.getByLabel("Study Name").fill("Isolated browser verification");
  await page.getByLabel("Description").fill("Temporary Playwright fixture");
  await page.getByRole("button", { name: "Create Study" }).click();
  await expect(page).toHaveURL(/\/admin\/user-studies\/[0-9a-f-]+\/overview$/);
  const studyId = page.url().match(/user-studies\/([0-9a-f-]+)\/overview/)?.[1];
  if (!studyId) throw new Error("Created study URL did not contain a study ID");
  await expect(page.getByText("Quick Start")).toBeVisible();
  await expectNoCriticalAccessibilityViolations(page);

  await page.goto("/admin/settings/system");
  await expect(page.getByText("Platform Configuration")).toBeVisible();
  await expect(page.getByText("Secrets are never shown here.")).toBeVisible();
  await expect(page.getByRole("textbox", { name: /Inspect platform status/ })).toHaveValue("scarline status");
  await expect(page.locator("body")).not.toContainText("JWT_ACCESS_SECRET");
  await expectNoCriticalAccessibilityViolations(page);

  const token = await accessToken(context);
  const suffix = randomBytes(4).toString("hex");
  const observerUsername = `e2e-observer-${suffix}`;
  const observerInitialPassword = `Initial-${suffix}-Password!`;
  const observerPassword = `Observer-${suffix}-Password!`;
  const observer = await api(token, "POST", "/users", {
    username: observerUsername,
    password: observerInitialPassword,
    displayName: "E2E Observer",
    email: null,
    institution: null,
    roles: ["observer"],
  });
  await api(token, "POST", `/studies/${studyId}/users`, { userId: observer.id });

  const observerContext = await browser.newContext();
  const observerPage = await observerContext.newPage();
  await login(observerPage, observerUsername, observerInitialPassword);
  await changePassword(observerPage, observerInitialPassword, observerPassword);
  await login(observerPage, observerUsername, observerPassword);
  await observerPage.goto(`/admin/user-studies/${studyId}/conditions`);
  const designControls = observerPage.locator('fieldset[title="Researcher or administrator access is required."]');
  await expect(designControls).toHaveAttribute("disabled", "");
  await expect(designControls.getByRole("button", { name: "Save Condition" })).toBeDisabled();
  const forbiddenSystemStatus = await observerPage.goto("/admin/settings/system");
  expect(forbiddenSystemStatus?.status()).toBe(403);
  await observerContext.close();

  const favicon = await fetch(`${overlayOrigin}/favicon.ico`);
  expect(favicon.ok).toBeTruthy();
  expect(Number(favicon.headers.get("content-length") ?? "1")).toBeGreaterThan(0);
});
