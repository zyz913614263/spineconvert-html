import { expect, test, type Page } from "@playwright/test";

const ATLAS = `pixel.png
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

type Keyframe = { value: number; time?: number };

type Clip = {
  bones: Record<string, { rotate?: Keyframe[]; translatex?: Keyframe[] }>;
};

function skeleton(animations: Record<string, Clip>): string {
  return JSON.stringify({
    skeleton: { spine: "4.2.11", x: -16, y: -16, width: 32, height: 32 },
    bones: [{ name: "root" }],
    slots: [{ name: "slot", bone: "root", attachment: "pixel" }],
    skins: [{ name: "default", attachments: { slot: { pixel: { width: 32, height: 32 } } } }],
    animations,
  });
}

/** Creates one-second clips with repeated name prefixes. */
function manyClips(count: number): string {
  const animations: Record<string, Clip> = {};
  for (let index = 0; index < count; index += 1) {
    const base = index % 3 === 0 ? "walk" : index % 3 === 1 ? "run" : "idle";
    animations[`${base}_${String(index).padStart(3, "0")}`] = {
      bones: { root: { rotate: [{ value: 0 }, { time: 1, value: 90 }] } },
    };
  }
  return skeleton(animations);
}

const COMPOSABLE_CLIPS = skeleton({
  spin: { bones: { root: { rotate: [{ value: 0 }, { time: 1, value: 90 }] } } },
  slide: { bones: { root: { translatex: [{ value: 0 }, { time: 1, value: 200 }] } } },
});

async function loadBundle(page: Page, json: string): Promise<void> {
  // Set the input before WebGL finishes loading to cover queued file intake.
  await page.locator('input[type="file"]').setInputFiles([
    { name: "rig.json", mimeType: "application/json", buffer: Buffer.from(json) },
    { name: "rig.atlas", mimeType: "application/octet-stream", buffer: Buffer.from(ATLAS) },
    { name: "pixel.png", mimeType: "image/png", buffer: PIXEL_PNG },
  ]);
  await expect(page.locator(".status-strip")).toContainText("已加载 rig.json", { timeout: 30_000 });
}

test("windows a large clip list and narrows it by name", async ({ page }) => {
  await page.goto("/");
  await loadBundle(page, manyClips(300));

  await page.getByRole("combobox", { name: "选择基础动画", exact: true }).click();
  const options = page.getByRole("option");
  await expect(options.first()).toBeVisible();

  // The popup reports 300 个动画 and mounts fewer than 40 options.
  await expect(page.getByText("300 个动画")).toBeVisible();
  const mounted = await options.count();
  expect(mounted).toBeGreaterThan(0);
  expect(mounted).toBeLessThan(40);

  await page.getByRole("combobox", { name: "筛选动画" }).fill("walk_01");
  await expect(page.getByText(/^\d+ \/ 300 个动画$/)).toBeVisible();
  const filtered = await options.count();
  expect(filtered).toBeGreaterThan(0);
  // Subsequence matching includes walk_021 and excludes run and idle clips.
  for (const name of await options.allInnerTexts()) {
    expect(name.trim().startsWith("walk_")).toBe(true);
  }

  // The contiguous match ranks first.
  const chosen = (await options.first().innerText()).split("\n")[0]?.trim() ?? "";
  expect(chosen).toBe("walk_012");
  await options.first().click();
  await expect(page.getByRole("combobox", { name: "选择基础动画", exact: true })).toContainText(
    chosen,
  );
});

test("does not show a false scrollbar when filtering to one clip", async ({ page }) => {
  await page.goto("/");
  await loadBundle(page, manyClips(300));

  await page.getByRole("combobox", { name: "选择基础动画", exact: true }).click();
  await page.getByRole("combobox", { name: "筛选动画" }).fill("walk_000");
  await expect(page.getByRole("option")).toHaveCount(1);

  const metrics = await page.locator('[data-slot="virtual-picker-scroll"]').evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }));
  expect(metrics.scrollHeight).toBe(metrics.clientHeight);
});

test("shows the no-match message and zero count", async ({ page }) => {
  await page.goto("/");
  await loadBundle(page, manyClips(300));

  await page.getByRole("combobox", { name: "选择基础动画", exact: true }).click();
  await page.getByRole("combobox", { name: "筛选动画" }).fill("nothing-matches-this");
  await expect(page.getByText("没有名称匹配的动画。")).toBeVisible();
  await expect(page.getByText("0 / 300 个动画")).toBeVisible();
  await expect(page.getByRole("option")).toHaveCount(0);
});

test("keeps the camera and frame editor stable when the base clip changes", async ({ page }) => {
  await page.goto("/");
  await loadBundle(page, COMPOSABLE_CLIPS);

  await page.getByRole("button", { name: "暂停", exact: true }).click();
  const playhead = page.getByRole("slider", { name: "播放头" });
  await playhead.focus();
  await page.keyboard.press("Home");
  const nextFrame = page.getByRole("button", { name: "下一帧" });
  for (let step = 0; step < 5; step += 1) await nextFrame.click();

  const timecode = page.locator("output").filter({ hasText: "/" }).first();
  await expect(timecode).toHaveAttribute("aria-label", /frame 5 of 30$/);

  // Zoom at the center, then pan away from the fitted position.
  const canvas = page.locator('canvas[aria-label^="Spine animation preview"]');
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox).not.toBeNull();
  if (!canvasBox) return;
  const center = {
    x: canvasBox.x + canvasBox.width / 2,
    y: canvasBox.y + canvasBox.height / 2,
  };
  await page.mouse.move(center.x, center.y);
  await page.mouse.wheel(0, -200);
  await page.mouse.down();
  await page.mouse.move(center.x + 32, center.y + 20, { steps: 4 });
  await page.mouse.up();

  const zoomBadge = page.getByRole("button", { name: /^缩放 \d+%。适配视图。$/ });
  await expect(zoomBadge).not.toHaveText("100%");
  const zoomBefore = await zoomBadge.innerText();

  // Frame screen coordinates capture the current camera position.
  await page.getByRole("button", { name: "绘制导出框" }).click();
  await expect(page.getByRole("button", { name: "完成导出框" })).toBeVisible();
  const frame = page.getByRole("region", { name: "自定义导出框" });
  await expect(frame).toBeVisible();
  const frameBefore = await frame.boundingBox();
  expect(frameBefore).not.toBeNull();
  if (!frameBefore) return;

  const baseClip = page.getByRole("combobox", { name: "选择基础动画", exact: true });
  await baseClip.click();
  await page.getByRole("option", { name: /slide/ }).click();
  await expect(baseClip).toContainText("slide");

  await expect(zoomBadge).toHaveText(zoomBefore);
  await expect(timecode).toHaveAttribute("aria-label", /^0:00\.000 of .+, frame 0 of \d+$/);
  await expect(page.getByRole("button", { name: "完成导出框" })).toBeVisible();
  // Switching clips keeps edit mode open and hides spin's saved frame.
  await expect(frame).toBeHidden();

  await baseClip.click();
  await page.getByRole("option", { name: /spin/ }).click();
  await expect(baseClip).toContainText("spin");
  await expect(zoomBadge).toHaveText(zoomBefore);
  await expect(page.getByRole("button", { name: "完成导出框" })).toBeVisible();
  await expect(frame).toBeVisible();

  const frameAfter = await frame.boundingBox();
  expect(frameAfter).not.toBeNull();
  if (!frameAfter) return;
  for (const dimension of ["x", "y", "width", "height"] as const) {
    expect(Math.abs(frameAfter[dimension] - frameBefore[dimension])).toBeLessThan(1);
  }
});

test("stacks clips over the base clip in both the preview and the export", async ({ page }) => {
  await page.goto("/");
  await loadBundle(page, COMPOSABLE_CLIPS);

  // Pause and advance five frames so each canvas sample uses the same pose.
  await page.getByRole("button", { name: "暂停", exact: true }).click();
  const nextFrame = page.getByRole("button", { name: "下一帧" });
  for (let step = 0; step < 5; step += 1) await nextFrame.click();
  const timecode = page.locator("output").filter({ hasText: "/" }).first();
  const parkedAt = await timecode.innerText();

  const canvas = page.locator('canvas[aria-label^="Spine animation preview"]');
  const poseOf = () => canvas.evaluate((element: HTMLCanvasElement) => element.toDataURL());
  const baseOnly = await poseOf();

  const stackTrigger = page.getByRole("combobox", { name: "在基础动画上叠加" });
  await stackTrigger.click();
  await page.getByRole("option", { name: /slide/ }).click();
  await page.keyboard.press("Escape");

  await expect(page.getByRole("combobox", { name: "1 个叠加动画" })).toBeVisible();
  await expect(page.getByText(/动画\s*spin\s*\+ 1 个叠加/)).toBeVisible();
  // Adding the second clip leaves the playhead fixed.
  await expect(timecode).toHaveText(parkedAt);
  expect(await poseOf()).not.toBe(baseOnly);

  // The translated pose widens the source bounds and reduces height at a fixed output width.
  await page.locator("#export-format").click();
  await page.getByRole("combobox", { name: "导出格式" }).click();
  await page.getByRole("option", { name: "GIF" }).click();
  await page.locator("#export-dimensions").click();
  await page.getByLabel("最大宽度").fill("64");
  await page.getByLabel("最大高度").fill("64");
  await page.locator("#export-frame-rate").click();
  await page.getByLabel("每秒帧数").fill("2");

  const stackedDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: /导出 GIF/ }).click();
  await stackedDownload;
  const stackedHeight = await exportedHeight(page);

  await stackTrigger.click();
  await page.getByRole("button", { name: "清除" }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("combobox", { name: "在基础动画上叠加" })).toBeVisible();
  expect(await poseOf()).toBe(baseOnly);

  const baseDownload = page.waitForEvent("download");
  await page.getByRole("button", { name: /导出 GIF/ }).click();
  await baseDownload;
  expect(stackedHeight).toBeLessThan(await exportedHeight(page));
});

/** Returns the GIF height from the status line. */
async function exportedHeight(page: Page): Promise<number> {
  const strip = page.locator(".status-strip");
  await expect(strip).toContainText(/已将 spin 导出为 GIF · \d+×\d+/, { timeout: 60_000 });
  const reported = await strip.innerText();
  const height = reported.match(/已将 spin 导出为 GIF · \d+×(\d+)/)?.[1];
  if (!height) throw new Error(`Status line did not report export dimensions: ${reported}`);
  return Number(height);
}
