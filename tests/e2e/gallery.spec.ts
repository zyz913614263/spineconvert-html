import { expect, test, type Page } from "@playwright/test";

const SKELETON = JSON.stringify({
  skeleton: { spine: "4.2.11", x: -16, y: -16, width: 32, height: 32 },
  bones: [{ name: "root" }],
  slots: [{ name: "slot", bone: "root", attachment: "pixel" }],
  skins: [
    {
      name: "default",
      attachments: { slot: { pixel: { width: 32, height: 32 } } },
    },
  ],
  animations: { idle: { bones: { root: { rotate: [{ value: 0 }, { time: 1, value: 30 }] } } } },
});

const ATLAS = `Adankelmo.png
size: 1, 1
format: RGBA8888
filter: Linear, Linear
repeat: none
pixel
  rotate: false
  xy: 0, 0
  size: 1, 1
  orig: 1, 1
  offset: 0, 0
  index: -1
`;

const PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

const FILES = {
  atlas: "char/adankelmo_abs/Adankelmo.atlas.txt",
  png: "char/adankelmo_abs/Adankelmo.png",
  skel: "char/adankelmo_abs/Adankelmo.skel.bytes",
};

type FixtureFiles = { atlas: string; png: string; skel: string };

function item(character: string, skin: string, files: FixtureFiles = FILES) {
  return {
    id: `char/${character}/${skin}`,
    title: character,
    variant: skin,
    collection: "Characters",
    tags: ["char", character, skin],
    bundle: {
      loader: "spine-bundle-v1",
      skeleton: { url: files.skel, format: "auto" },
      atlas: { url: files.atlas },
      textures: [{ url: files.png }],
    },
  };
}

function manifest(items: ReturnType<typeof item>[]) {
  return { schemaVersion: 1, catalog: { id: "langrisser", title: "Langrisser Gallery" }, items };
}

const CATALOG = manifest([item("Adankelmo", "Adankelmo")]);

test("keeps loading indicators animated with reduced motion enabled", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.route("**/catalog.json", async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1_000));
    await route.fulfill({ json: CATALOG });
  });

  await page.goto("/");
  await page.getByRole("tab", { name: "画廊模式" }).click();

  const spinner = page.locator('[data-slot="spinner"]').first();
  await expect(spinner).toBeVisible();
  const animation = await spinner.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      duration: style.animationDuration,
      iterationCount: style.animationIterationCount,
      playState: style.animationPlayState,
    };
  });
  expect(animation).toEqual({
    duration: "1.6s",
    iterationCount: "infinite",
    playState: "running",
  });
});

const BROKEN_FILES = {
  atlas: "char/broken/Broken.atlas.txt",
  png: "char/broken/Broken.png",
  skel: "char/broken/Broken.skel.bytes",
};

const BROKEN_SKELETON = JSON.stringify({
  skeleton: { spine: "4.2.11", x: -16, y: -16, width: 32, height: 32 },
  bones: [{ name: "root" }],
  slots: [{ name: "slot", bone: "root", attachment: "pixel" }],
  skins: [
    {
      name: "default",
      attachments: { slot: { pixel: { width: 32, height: 32 } } },
    },
  ],
  animations: {
    broken: { bones: { missing: { rotate: [{ value: 0 }, { time: 1, value: 30 }] } } },
  },
});

async function routeGalleryFixture(page: Page): Promise<void> {
  await page.route("**/catalog.json", (route) => route.fulfill({ json: CATALOG }));
  await page.route("**/char/adankelmo_abs/Adankelmo.atlas.txt", (route) =>
    route.fulfill({ contentType: "text/plain", body: ATLAS }),
  );
  await page.route("**/char/adankelmo_abs/Adankelmo.png", (route) =>
    route.fulfill({ contentType: "image/png", body: PIXEL_PNG }),
  );
  await page.route("**/char/adankelmo_abs/Adankelmo.skel.bytes", (route) =>
    route.fulfill({ contentType: "application/octet-stream", body: SKELETON }),
  );
}

test("loads a Langrisser compound-suffix bundle and reuses it across modes", async ({ page }) => {
  await routeGalleryFixture(page);
  const assetRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("/char/adankelmo_abs/")) assetRequests.push(request.url());
  });

  await page.goto("/");
  await page.getByRole("tab", { name: "画廊模式" }).click();

  const galleryOption = page.getByRole("option", { name: /Adankelmo Adankelmo · Characters/ });
  await expect(galleryOption).toBeVisible();
  await galleryOption.click();

  await expect(page.locator(".status-strip")).toContainText("已加载 Adankelmo: Adankelmo", {
    timeout: 30_000,
  });
  await expect(page.getByLabel("基础动画：idle")).toContainText(/动画\s*idle/);
  await expect(galleryOption).toHaveAttribute("aria-selected", "true");
  expect(assetRequests).toHaveLength(3);

  await page.getByRole("tab", { name: "画布模式" }).click();
  await page.getByRole("tab", { name: "画廊模式" }).click();
  await galleryOption.click();

  await expect(page.getByRole("tab", { name: /Adankelmo: Adankelmo 4\.2\.11/ })).toHaveCount(1);
  expect(assetRequests).toHaveLength(3);
});

test("applies the built-in Daiblos Core alpha default", async ({ page }) => {
  await routeGalleryFixture(page);

  await page.goto("/");
  await page.getByRole("tab", { name: "画廊模式" }).click();
  const sourcePicker = page.getByRole("combobox", { name: /画廊库/ });
  await sourcePicker.click();
  await page.getByRole("option", { name: /^Daiblos Core/ }).click();

  const galleryOption = page.getByRole("option", { name: /Adankelmo Adankelmo · Characters/ });
  await galleryOption.click();
  await expect(page.locator(".status-strip")).toContainText("已加载 Adankelmo: Adankelmo", {
    timeout: 30_000,
  });
  await page.getByRole("tab", { name: "画布模式" }).click();
  await expect(page.getByRole("combobox", { name: "贴图 Alpha" })).toContainText("预乘");
});

test("leaves the active document selected when another gallery item fails", async ({ page }) => {
  const catalog = manifest([
    item("Adankelmo", "Adankelmo"),
    item("Broken", "Invalid rig", BROKEN_FILES),
  ]);
  await page.route("**/catalog.json", (route) => route.fulfill({ json: catalog }));
  await page.route("**/char/adankelmo_abs/Adankelmo.atlas.txt", (route) =>
    route.fulfill({ contentType: "text/plain", body: ATLAS }),
  );
  await page.route("**/char/adankelmo_abs/Adankelmo.png", (route) =>
    route.fulfill({ contentType: "image/png", body: PIXEL_PNG }),
  );
  await page.route("**/char/adankelmo_abs/Adankelmo.skel.bytes", (route) =>
    route.fulfill({ contentType: "application/octet-stream", body: SKELETON }),
  );
  await page.route("**/char/broken/Broken.atlas.txt", (route) =>
    route.fulfill({
      contentType: "text/plain",
      body: ATLAS.replace("Adankelmo.png", "Broken.png"),
    }),
  );
  await page.route("**/char/broken/Broken.png", (route) =>
    route.fulfill({ contentType: "image/png", body: PIXEL_PNG }),
  );
  await page.route("**/char/broken/Broken.skel.bytes", (route) =>
    route.fulfill({ contentType: "application/octet-stream", body: BROKEN_SKELETON }),
  );

  await page.goto("/");
  await page.getByRole("tab", { name: "画廊模式" }).click();
  const valid = page.getByRole("option", { name: /Adankelmo Adankelmo · Characters/ });
  const broken = page.getByRole("option", { name: /Broken Invalid rig · Characters/ });
  await valid.click();
  await expect(page.getByRole("tab", { name: /Adankelmo: Adankelmo 4\.2\.11/ })).toBeVisible({
    timeout: 30_000,
  });
  await expect(valid).toHaveAttribute("aria-selected", "true");

  await broken.click();

  const preparationAlert = page.getByRole("alert");
  await expect(preparationAlert).toContainText("无法打开 Broken", {
    timeout: 30_000,
  });
  await preparationAlert.getByRole("button", { name: "技术详情" }).click();
  await expect(preparationAlert.getByLabel("技术错误详情")).not.toBeEmpty();
  await expect(preparationAlert.getByRole("button", { name: "复制详情" })).toBeVisible();
  await expect(valid).toHaveAttribute("aria-selected", "true");
  await expect(broken).toHaveAttribute("aria-selected", "false");
  await expect(page.getByRole("tab", { name: /Adankelmo: Adankelmo 4\.2\.11/ })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(page.getByLabel("基础动画：idle")).toContainText(/动画\s*idle/);
  await expect(page.locator(".status-strip")).toContainText("当前文档未改动");
});

test("reloads a catalog after a 503 response", async ({ page }) => {
  let unavailable = true;
  await page.route("**/catalog.json", (route) => {
    if (unavailable) {
      return route.fulfill({ status: 503, contentType: "application/json", body: "{}" });
    }
    return route.fulfill({ json: CATALOG });
  });

  await page.goto("/");
  await page.getByRole("tab", { name: "画廊模式" }).click();

  await expect(page.getByRole("alert")).toContainText("画廊不可用", {
    timeout: 15_000,
  });
  await expect(page.getByRole("button", { name: "重试" })).toBeVisible();
  await expect(page.locator(".status-strip")).toContainText("无法加载画廊目录：503");

  unavailable = false;
  await page.getByRole("button", { name: "重试" }).click();
  await expect(
    page.getByRole("option", { name: /Adankelmo Adankelmo · Characters/ }),
  ).toBeVisible();
});

/** Creates enough entries to trigger row virtualization. */
function largeCatalog(count: number) {
  return manifest(
    Array.from({ length: count }, (_, index) => {
      const name = `Char${String(index).padStart(3, "0")}`;
      return item(name, name, {
        atlas: `char/${name}/${name}.atlas.txt`,
        png: `char/${name}/${name}.png`,
        skel: `char/${name}/${name}.skel.bytes`,
      });
    }),
  );
}

test("mounts fewer than 40 rows for a 300-item catalog", async ({ page }) => {
  await page.route("**/catalog.json", (route) => route.fulfill({ json: largeCatalog(300) }));
  // Abort bundle requests because this test does not select a row.
  await page.route("**/char/**", (route) => route.abort());

  await page.goto("/");
  await page.getByRole("tab", { name: "画廊模式" }).click();

  const listbox = page.getByRole("listbox", { name: "托管的 Spine 动画" });
  const rows = listbox.getByRole("option", { name: /^Char\d{3}/ });
  await expect(rows.first()).toBeVisible();

  // Keyboard navigation reaches rows that start outside the mounted window.
  await listbox.focus();
  await page.keyboard.press("Home");
  for (let index = 0; index < 12; index += 1) await page.keyboard.press("ArrowDown");
  await expect(listbox).toHaveAttribute("aria-activedescendant", "hosted-animation-option-12");
  await expect(page.locator("#hosted-animation-option-12")).toContainText("Char012");

  // Catalog metadata supplies the total, independent of the mounted rows.
  await expect(page.getByRole("combobox", { name: /画廊库/ })).toContainText("300");
  const mounted = await rows.count();
  expect(mounted).toBeGreaterThan(0);
  expect(mounted).toBeLessThan(40);

  await page.getByRole("combobox", { name: "按标签和合集筛选" }).click();
  const mountedTags = page.locator(
    '[data-slot="combobox-content"][aria-label="按标签和合集筛选"] [data-slot="combobox-item"]',
  );
  await expect(mountedTags.first()).toBeVisible();
  expect(await mountedTags.count()).toBeLessThan(40);
  await page.keyboard.press("Escape");

  await rows.first().hover();
  for (let step = 0; step < 30; step += 1) await page.mouse.wheel(0, 300);
  await expect(page.getByRole("option", { name: /^Char1[0-9]{2}/ }).first()).toBeVisible();
  expect(await rows.count()).toBeLessThan(40);

  await page.getByRole("textbox", { name: "搜索画廊动画" }).fill("Char299");
  await expect(rows).toHaveCount(1);
  await expect(page.getByText("1 / 300 个动画")).toBeVisible();
});

/** `adk` matches two entries with different scores. */
const RANKING_CATALOG = manifest([
  item("Adankelmo", "Adankelmo"),
  item("Aimeeda", "Aimeeda_Skin04"),
  item("Bernhardt", "Bernhardt"),
]);

test("ranks non-contiguous character matches by score", async ({ page }) => {
  await page.route("**/catalog.json", (route) => route.fulfill({ json: RANKING_CATALOG }));
  await page.route("**/char/**", (route) => route.abort());

  await page.goto("/");
  await page.getByRole("tab", { name: "画廊模式" }).click();
  const rows = page.getByLabel("托管的 Spine 动画").getByRole("option");
  await expect(rows).toHaveCount(3);

  // "adk" is a subsequence of "Adankelmo", not a substring.
  const search = page.getByRole("textbox", { name: "搜索画廊动画" });
  await search.click();
  await expect(search).toBeFocused();
  await search.fill("adk");

  await expect(rows).toHaveCount(2);
  await expect(rows.first()).toContainText("Adankelmo");
  // Aimeeda remains second because its match spans more characters.
  await expect(rows.nth(1)).toContainText("Aimeeda");

  // Adjacent positions zero and one render in one mark element.
  await expect(rows.first().locator("mark").first()).toHaveText("Ad");

  await page.getByRole("button", { name: "清除画廊搜索" }).click();
  await expect(search).toHaveValue("");
  await expect(search).toBeFocused();
  await expect(rows).toHaveCount(3);

  await search.fill("zzzz");
  await expect(page.getByText("没有匹配的动画")).toBeVisible();
});

test("combines searchable tag and collection filters", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 732 });
  const catalog = manifest([
    {
      ...item("HeroAlpha", "Default"),
      collection: "Characters",
      tags: ["character", "hero", "default"],
    },
    {
      ...item("HeroBravo", "Aim"),
      collection: "Characters",
      tags: ["character", "hero", "aim"],
    },
    {
      ...item("EnemyAlpha", "Aim"),
      collection: "Enemies",
      tags: ["character", "enemy", "aim"],
    },
    {
      ...item("MagicBurst", "Aim"),
      collection: "Effects",
      tags: ["effect", "aim"],
    },
  ]);
  await page.route("**/catalog.json", (route) => route.fulfill({ json: catalog }));
  await page.route("**/char/**", (route) => route.abort());

  await page.goto("/");
  await page.getByRole("tab", { name: "画廊模式" }).click();
  const gallery = page.getByLabel("托管的 Spine 动画");
  await expect(gallery.getByRole("option")).toHaveCount(4);

  const filter = page.getByRole("combobox", { name: /按标签和合集筛选/ });
  await filter.click();
  const facetSearch = page.getByRole("combobox", { name: "查找标签或合集" });

  await facetSearch.fill("Characters");
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(gallery.getByRole("option")).toHaveCount(2);

  await facetSearch.fill("Enemies");
  await page.getByRole("option", { name: "合集：Enemies，1 个动画", exact: true }).click();
  await expect(gallery.getByRole("option")).toHaveCount(3);

  await facetSearch.fill("aim");
  await page.getByRole("option", { name: "标签：aim，3 个动画", exact: true }).click();
  await expect(gallery.getByRole("option")).toHaveCount(2);

  await facetSearch.fill("Characters");
  await page.getByRole("option", { name: "合集：Characters，2 个动画", exact: true }).click();
  await expect(gallery.getByRole("option")).toHaveCount(1);
  await expect(gallery.getByRole("option")).toContainText("EnemyAlpha");
  await page.keyboard.press("Escape");
  await expect(filter).toHaveAccessibleName("按标签和合集筛选，已选 2 项");

  const search = page.getByRole("textbox", { name: "搜索画廊动画" });
  await search.fill("hero");
  await expect(page.getByText("没有匹配的动画")).toBeVisible();
  await page.getByRole("button", { name: "清除筛选" }).click();
  await expect(search).toHaveValue("");
  await expect(search).toBeFocused();
  await expect(gallery.getByRole("option")).toHaveCount(4);
});

const STUDIO_MANIFEST = {
  schemaVersion: 1,
  catalog: { id: "studio", title: "Studio Rigs" },
  items: [
    {
      id: "hero",
      title: "Hero",
      variant: "Default",
      collection: "Characters",
      bundle: {
        skeleton: { url: "hero/hero.skel", format: "auto" },
        atlas: { url: "hero/hero.atlas" },
        textures: [{ url: "hero/hero.png" }],
      },
    },
  ],
};

test("adds, switches to, and removes a second library", async ({ page }) => {
  await page.route("**/catalog.json", (route) => route.fulfill({ json: CATALOG }));
  await page.route("**/studio.json", (route) => route.fulfill({ json: STUDIO_MANIFEST }));
  await page.route("**/char/**", (route) => route.abort());
  await page.route("**/hero/**", (route) => route.abort());

  await page.goto("/");
  await page.getByRole("tab", { name: "画廊模式" }).click();

  const picker = page.getByRole("combobox", { name: /画廊库/ });
  await expect(picker).toContainText("Langrisser");

  await picker.click();
  await page.getByRole("button", { name: "添加清单地址" }).click();

  // The dialog rejects the URL before it enables "添加库".
  await page.getByLabel("清单地址").fill("not-a-url");
  await page.getByRole("button", { name: "检查地址" }).click();
  await expect(page.getByRole("alert")).toContainText("完整网址");
  await expect(page.getByRole("button", { name: "添加库" })).toBeDisabled();

  await page.getByLabel("清单地址").fill("https://example.test/studio/studio.json");
  await page.getByRole("button", { name: "检查地址" }).click();
  await expect(page.getByText(/已连接到「Studio Rigs」/)).toBeVisible();
  await page.getByRole("button", { name: "添加库" }).click();

  await expect(picker).toContainText("Studio Rigs");
  await expect(page.getByRole("option", { name: /Hero/ })).toBeVisible();

  const search = page.getByRole("textbox", { name: "搜索画廊动画" });
  await search.fill("Hero");

  await picker.click();
  await page.getByRole("option", { name: /^Langrisser/ }).click();
  await expect(picker).toContainText("Langrisser");
  await expect(search).toHaveValue("");
  await expect(page.getByRole("option", { name: /Adankelmo/ })).toBeVisible();

  await picker.click();
  const libraryOptions = page.getByRole("option", { name: /^(Langrisser|Studio Rigs)/ });
  await expect(libraryOptions).toHaveCount(2);
  await page.getByRole("button", { name: "移除 Studio Rigs" }).click();
  await expect(libraryOptions).toHaveCount(1);
});

test("shows the manifest format in the add-library dialog", async ({ page }) => {
  await page.route("**/catalog.json", (route) => route.fulfill({ json: CATALOG }));
  await page.route("**/char/**", (route) => route.abort());

  await page.goto("/");
  await page.getByRole("tab", { name: "画廊模式" }).click();

  await page.getByRole("combobox", { name: /画廊库/ }).click();
  await page.getByRole("button", { name: "清单长什么样" }).click();

  // Select by name because the library picker also uses dialog semantics.
  const dialog = page.getByRole("dialog", { name: "添加画廊库" });
  await expect(dialog).toContainText("schemaVersion");
  await expect(dialog).toContainText("items[].bundle");
  await expect(dialog.getByText('"schemaVersion": 1')).toBeVisible();
});
