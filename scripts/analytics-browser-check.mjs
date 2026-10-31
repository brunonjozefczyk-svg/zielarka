import assert from "node:assert/strict";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import { chromium } from "playwright";
import { resolve } from "node:path";

const server = await createServer({ configFile: false, root: process.cwd(), resolve: { alias: { "@": resolve("src") } }, plugins: [react(), {
  name: "analytics-test-fixture",
  configureServer(server) {
    server.middlewares.use(async (req, res, next) => {
      if (!["/", "/kontakt", "/konsultacje", "/edytuj"].includes(req.url.split("?")[0])) return next();
      res.setHeader("Content-Type", "text/html");
      res.end(await server.transformIndexHtml(req.url, '<html><head><title>PRIVATE-TITLE</title></head><body><div id="root"></div><script type="module" src="/scripts/fixtures/analytics.tsx"></script></body></html>'));
    });
  },
}], server: { host: "127.0.0.1", port: 0 } });
let browser;
try {
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true, ...(process.env.TEST_CHROMIUM_PATH ? { executablePath: process.env.TEST_CHROMIUM_PATH } : {}) });
  const context = await browser.newContext();
  context.setDefaultTimeout(10_000);
  let tags = 0;
  const hits = [];
  // This is a transport stub, NOT evidence about Google's actual tag or account configuration.
  await context.route("https://www.googletagmanager.com/**", async route => {
    tags++;
    await route.fulfill({ contentType: "application/javascript", body: `
      const queue = window.dataLayer || [];
      function consume(value) {
        const args = Array.from(value);
        if (args[0] === 'event' && !window['ga-disable-G-TEST123']) fetch('https://www.google-analytics.com/g/collect', { method:'POST', body:JSON.stringify(args) }).catch(()=>{});
      }
      queue.forEach(consume); queue.push = function(value) { consume(value); return Array.prototype.push.call(this,value); };
    ` });
  });
  await context.route("https://www.google-analytics.com/**", async route => { hits.push(JSON.parse(route.request().postData())); await route.fulfill({ status: 204 }); });
  const page = await context.newPage();
  page.on("pageerror", error => console.error("fixture error:", error.message));
  await page.goto(origin + "/kontakt?email=PRIVATE-EMAIL#PRIVATE-FRAGMENT");
  await page.getByRole("button", { name: "Odrzucam", exact: true }).waitFor();
  assert.equal(tags, 0); console.log("PASS: no tag before grant");
  await page.getByRole("button", { name: "Odrzucam", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: "Zmień zgodę na analitykę" }).waitFor();
  assert.equal(tags, 0); console.log("PASS: no tag before grant");
  await page.getByRole("button", { name: "Zmień zgodę na analitykę" }).click();
  await Promise.all([page.waitForResponse("https://www.google-analytics.com/g/collect"), page.getByRole("button", { name: "Akceptuję", exact: true }).click()]);
  assert.equal(tags, 1);
  assert.equal(hits.filter(h => h[1] === "page_view").length, 1);
  assert.equal(hits[0][2].page_location, "https://zielarka.pl/kontakt");
  assert.equal(JSON.stringify(hits).includes("PRIVATE-"), false);
  await page.getByRole("link", { name: "Konsultacje", exact: true }).click();
  await page.waitForURL(origin + "/konsultacje");
  await page.waitForFunction(() => window.dataLayer && Array.from(window.dataLayer).filter(x => x[0] === 'event' && x[1] === 'page_view').length === 2);
  assert.equal(hits.filter(h => h[1] === "page_view").length, 2);
  await page.getByRole("button", { name: "Zmień zgodę na analitykę" }).click();
  await page.getByRole("button", { name: "Odrzucam", exact: true }).click();
  await page.waitForLoadState("domcontentloaded");
  await page.getByRole("button", { name: "Zmień zgodę na analitykę" }).waitFor();
  const afterRevoke = hits.length;
  await page.getByRole("link", { name: "Kontakt", exact: true }).click();
  await page.waitForURL(origin + "/kontakt");
  assert.equal(hits.length, afterRevoke);
  assert.equal(tags, 1);
  // Stored consent must not load the tag on the editor route.
  await page.evaluate(() => localStorage.setItem("zielarka.consent", "granted"));
  await page.goto(origin + "/edytuj");
  await page.getByRole("heading", { name: "Test" }).waitFor();
  assert.equal(tags, 1);
  // Entering the editor from a tracked public page disables and reloads.
  await Promise.all([page.waitForResponse("https://www.google-analytics.com/g/collect"), page.goto(origin + "/")]);
  await page.getByRole("button", { name: "Zmień zgodę na analitykę" }).waitFor();
  const beforeEditor = hits.length;
  await page.getByRole("link", { name: "Edytor", exact: true }).click();
  await page.waitForURL(origin + "/edytuj");
  await page.getByRole("heading", { name: "Test" }).waitFor();
  assert.equal(hits.length, beforeEditor);
  // Revocation propagates to another tab on the same origin.
  await Promise.all([page.waitForResponse("https://www.google-analytics.com/g/collect"), page.goto(origin + "/")]);
  const second = await context.newPage();
  await second.goto(origin + "/kontakt");
  await second.getByRole("button", { name: "Zmień zgodę na analitykę" }).waitFor();
  await second.getByRole("button", { name: "Zmień zgodę na analitykę" }).click();
  await second.getByRole("button", { name: "Odrzucam", exact: true }).click();
  await page.waitForFunction(() => localStorage.getItem("zielarka.consent") === "denied" && !document.getElementById("zielarka-google-tag"));
  await page.getByRole("button", { name: "Zmień zgodę na analitykę" }).waitFor();
  assert.equal(await page.locator("#zielarka-google-tag").count(), 0);
  // A storage exception must fail closed rather than enable tracking.
  const blocked = await browser.newContext();
  await blocked.addInitScript(() => { Storage.prototype.getItem = () => { throw Error("blocked"); }; Storage.prototype.setItem = () => { throw Error("blocked"); }; });
  const blockedPage = await blocked.newPage();
  await blockedPage.goto(origin + "/");
  await blockedPage.getByRole("button", { name: "Akceptuję", exact: true }).click();
  await blockedPage.getByRole("alert").waitFor();
  assert.equal(await blockedPage.locator("#zielarka-google-tag").count(), 0);
  console.log("PASS: refusal, grant, one SPA page view, URL redaction, withdrawal, editor exclusion, cross-tab withdrawal, blocked storage (stub Google transport).");
} finally {
  await browser?.close();
  await server.close();
}
