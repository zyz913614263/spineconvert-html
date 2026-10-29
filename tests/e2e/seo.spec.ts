import { expect, test } from "@playwright/test";

test("serves consistent metadata for search crawlers", async ({ page, request }) => {
  const documentResponse = await request.get("/");
  expect(documentResponse.ok()).toBe(true);

  const html = await documentResponse.text();
  expect(html).toContain('name="robots"');
  expect(html).toContain('rel="canonical"');
  expect(html).toContain('<script type="application/ld+json">');
  expect(html).toContain("<h1>Spine Thing</h1>");
  expect(html).not.toContain("__SITE_URL__");

  await page.goto("/");
  await expect(page).toHaveTitle("Spine Thing — Browser Spine Viewer, Converter & Exporter");

  const canonicalUrl = await page.locator('link[rel="canonical"]').getAttribute("href");
  expect(canonicalUrl).toMatch(/^https:\/\/.+\/$/);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    /Spine 3\.3–4\.2 JSON and SKEL animations/,
  );

  const robotsResponse = await request.get("/robots.txt");
  expect(robotsResponse.ok()).toBe(true);
  expect(await robotsResponse.text()).toContain(`Sitemap: ${canonicalUrl}sitemap.xml`);

  const sitemapResponse = await request.get("/sitemap.xml");
  expect(sitemapResponse.ok()).toBe(true);
  expect(await sitemapResponse.text()).toContain(`<loc>${canonicalUrl}</loc>`);
});
