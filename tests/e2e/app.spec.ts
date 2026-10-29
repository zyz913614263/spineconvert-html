import { readFile } from "node:fs/promises";

import { expect, test, type Download, type Locator, type Page } from "@playwright/test";
import { decodeFrames } from "modern-gif";

type ElementBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

async function visibleBox(locator: Locator): Promise<ElementBox> {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  if (!box) throw new Error(`Visible element has no bounding box: ${locator.toString()}`);
  return box;
}

function boxesOverlap(left: ElementBox, right: ElementBox): boolean {
  const horizontalOverlap =
    Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x);
  const verticalOverlap =
    Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y);
  return horizontalOverlap > 0 && verticalOverlap > 0;
}

async function downloadBytes(download: Download): Promise<Buffer> {
  const path = await download.path();
  if (!path) throw new Error("Browser download did not produce a local file.");
  return readFile(path);
}

const SKELETON = JSON.stringify({
  skeleton: { spine: "4.2.11", x: -16, y: -16, width: 32, height: 32 },
  bones: [{ name: "root" }],
  slots: [{ name: "slot", bone: "root", attachment: "pixel" }],
  skins: [
    {
      name: "default",
      attachments: { slot: { pixel: { width: 32, height: 32 } } },
    },
    {
      name: "alternate",
      attachments: { slot: { pixel: { width: 32, height: 32 } } },
    },
  ],
  animations: {
    idle: {
      bones: {
        root: {
          rotate: [{ value: 0 }, { time: 1, value: 90 }],
          translatex: [{ value: 0 }, { time: 0.75, value: 64 }],
        },
      },
    },
    wave: {
      bones: {
        root: {
          rotate: [{ value: 0 }, { time: 0.5, value: -45 }],
        },
      },
    },
  },
});

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

async function loadBundle(page: Page): Promise<void> {
  const fileInput = page.getByLabel("选择 Spine 资源包文件");
  await expect(fileInput).toBeAttached();
  await fileInput.setInputFiles([
    { name: "sample.json", mimeType: "application/json", buffer: Buffer.from(SKELETON) },
    { name: "sample.atlas", mimeType: "application/octet-stream", buffer: Buffer.from(ATLAS) },
    { name: "pixel.png", mimeType: "image/png", buffer: PIXEL_PNG },
  ]);
  await expect(page.locator(".status-strip")).toContainText("已加载 sample.json", {
    timeout: 30_000,
  });
}

const EXPORT_EDITOR_TRIGGER_IDS = {
  Format: "export-format",
  Dimensions: "export-dimensions",
  "Frame rate": "export-frame-rate",
  Quality: "export-quality",
  "File limit": "export-file-limit",
  Frame: "export-frame",
} as const;

async function openExportEditor(
  page: Page,
  label: keyof typeof EXPORT_EDITOR_TRIGGER_IDS,
): Promise<void> {
  const trigger = page.locator(`#${EXPORT_EDITOR_TRIGGER_IDS[label]}`);
  if ((await trigger.getAttribute("aria-expanded")) !== "true") await trigger.click();
}

async function chooseExportFormat(page: Page, format: "GIF" | "WebM" | "MP4"): Promise<void> {
  await openExportEditor(page, "Format");
  await page.getByRole("combobox", { name: "导出格式" }).click();
  await page.getByRole("option", { name: format }).click();
}

test("opens canvas actions from the context menu and copies full status", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/");
  await loadBundle(page);

  const skin = page.getByRole("combobox", { name: "选择皮肤" });
  await expect(skin).toContainText(/皮肤\s*default/);
  const skinBox = await visibleBox(skin);
  await skin.click();
  const skinPopup = page.locator('[data-slot="select-content"]');
  const popupBox = await visibleBox(skinPopup);
  expect(popupBox.y).toBeGreaterThanOrEqual(skinBox.y + skinBox.height - 1);
  await page.getByRole("option", { name: "alternate" }).click();
  await expect(skin).toContainText(/皮肤\s*alternate/);

  const canvas = page.locator('canvas[aria-label^="Spine 动画预览"]');
  await canvas.click({ button: "right" });
  await expect(page.getByRole("menuitem", { name: /适配完整骨骼/ })).toBeEnabled();
  await expect(page.getByRole("menuitem", { name: /显示骨骼调试/ })).toBeEnabled();
  await expect(page.getByRole("menuitem", { name: /绘制导出框/ })).toBeEnabled();
  await expect(page.getByRole("menuitem", { name: "重置自定义选框" })).toBeDisabled();
  await expect(page.getByRole("menuitem", { name: /将此帧存为 PNG/ })).toBeEnabled();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "查看完整状态" }).click();
  const fullStatus = page.getByLabel("完整状态信息");
  await expect(fullStatus).toContainText("已加载 sample.json");
  await page.getByRole("button", { name: "复制", exact: true }).click();
  await expect(page.getByRole("button", { name: "已复制", exact: true })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toContain("已加载 sample.json");
});

test("loads, previews, and converts a complete bundle in browser workers", async ({ page }) => {
  const browserErrors: string[] = [];
  page.on("pageerror", (error) => browserErrors.push(error.message));
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Spine Thing", exact: true })).toBeVisible();

  await loadBundle(page);
  await expect(page.getByRole("combobox", { name: "选择基础动画" })).toContainText("idle");

  await page.getByRole("combobox", { name: "目标系列" }).click();
  await page.getByRole("option", { name: "Spine 3.8" }).click();
  const versionInput = page.getByRole("textbox", { name: "精确版本" });
  await versionInput.fill("4.2.11");
  await expect(page.getByText(/请填写完整的 3\.8\.x 版本/)).toBeVisible();
  await expect(page.getByRole("button", { name: "转换资源包" })).toBeDisabled();
  await versionInput.fill("3.8.99");
  await page.getByRole("button", { name: "转换资源包" }).click();
  await expect(page.locator(".status-strip")).toContainText("已转换 4.2.11 → 3.8.99", {
    timeout: 30_000,
  });
  await expect(page.getByRole("button", { name: /保存 JSON（3\.8\.99）/ })).toBeEnabled();

  await chooseExportFormat(page, "GIF");
  await openExportEditor(page, "Dimensions");
  await page.getByLabel("最大宽度").fill("64");
  await page.getByLabel("最大高度").fill("64");
  await openExportEditor(page, "Frame rate");
  await page.getByLabel("每秒帧数").fill("4");
  await openExportEditor(page, "File limit");
  await page.getByRole("switch", { name: "限制文件大小" }).click();
  await page.getByLabel("最大体积（MB）").fill("0.1");
  const gifDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /导出 GIF，不超过 0\.1 MB/ }).click();
  const gifDownload = await gifDownloadPromise;
  expect(gifDownload.suggestedFilename()).toBe("sample-idle.gif");
  const gifBytes = await downloadBytes(gifDownload);
  expect(gifBytes.byteLength).toBeLessThanOrEqual(100_000);
  expect(gifBytes.subarray(0, 6).toString("ascii")).toBe("GIF89a");
  const gifFrames = decodeFrames(Uint8Array.from(gifBytes));
  expect(gifFrames).toHaveLength(4);
  expect(gifFrames[0]?.width).toBe(64);
  expect(gifFrames[0]?.height).toBeLessThan(64);
  // Auto trim uses the full motion envelope, so translated frames stay inside the output.
  for (const frame of gifFrames) {
    const visiblePixels = Array.from(
      { length: frame.width * frame.height },
      (_, index) => index,
    ).filter((index) => (frame.data[index * 4 + 3] ?? 0) > 0);
    expect(visiblePixels.length).toBeGreaterThan(0);
    const xCoordinates = visiblePixels.map((index) => index % frame.width);
    const yCoordinates = visiblePixels.map((index) => Math.floor(index / frame.width));
    expect(Math.min(...xCoordinates)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...xCoordinates)).toBeLessThanOrEqual(frame.width - 2);
    expect(Math.min(...yCoordinates)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...yCoordinates)).toBeLessThanOrEqual(frame.height - 2);
  }
  const alphas = gifFrames.flatMap((frame) =>
    Array.from(frame.data.filter((_, index) => index % 4 === 3)),
  );
  expect(alphas.some((alpha) => alpha === 0)).toBe(true);
  expect(alphas.some((alpha) => alpha === 255)).toBe(true);
  await expect(page.locator(".status-strip")).toContainText(
    `已将 idle 导出为 GIF · 64×${gifFrames[0]?.height}`,
  );

  await chooseExportFormat(page, "WebM");
  const webmDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: /导出 WebM，不超过 0\.1 MB/ }).click();
  const webmDownload = await webmDownloadPromise;
  expect(webmDownload.suggestedFilename()).toBe("sample-idle.webm");
  const webmBytes = await downloadBytes(webmDownload);
  expect(webmBytes.byteLength).toBeLessThanOrEqual(100_000);
  expect(webmBytes.subarray(0, 4)).toEqual(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  await expect(page.locator(".status-strip")).toContainText(
    `已将 idle 导出为 WEBM · 64×${gifFrames[0]?.height}`,
  );

  await openExportEditor(page, "Format");
  await page.getByRole("combobox", { name: "导出格式" }).click();
  const mp4Option = page.getByRole("option", { name: "MP4" });
  if (await mp4Option.isEnabled()) {
    await mp4Option.click();
    const mp4DownloadPromise = page.waitForEvent("download");
    await page.getByRole("button", { name: /导出 MP4，不超过 0\.1 MB/ }).click();
    const mp4Download = await mp4DownloadPromise;
    expect(mp4Download.suggestedFilename()).toBe("sample-idle.mp4");
    const mp4Bytes = await downloadBytes(mp4Download);
    expect(mp4Bytes.byteLength).toBeLessThanOrEqual(100_000);
    expect(mp4Bytes.subarray(4, 8).toString("ascii")).toBe("ftyp");
    await expect(page.locator(".status-strip")).toContainText("已将 idle 导出为 MP4");
  } else {
    await page.keyboard.press("Escape");
  }
  expect(browserErrors).toEqual([]);
});

test("saves the frame under the playhead as a transparent PNG", async ({ page }) => {
  const exporterRequests: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("animation-exporter")) exporterRequests.push(request.url());
  });
  await page.goto("/");
  await loadBundle(page);
  expect(exporterRequests).toHaveLength(0);

  await page.getByRole("button", { name: "暂停" }).click();
  await page.getByRole("slider", { name: "播放头" }).fill("0");
  await openExportEditor(page, "Dimensions");
  await page.getByLabel("最大宽度").fill("128");
  await page.getByLabel("最大高度").fill("128");

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "将此帧存为 PNG" }).click();
  const download = await downloadPromise;
  expect(exporterRequests.length).toBeGreaterThan(0);
  expect(download.suggestedFilename()).toMatch(/^sample-idle-f\d+\.png$/);

  const bytes = await downloadBytes(download);
  expect(bytes.subarray(1, 4).toString("ascii")).toBe("PNG");
  // A still trims to the pose at time zero, not the wider animation envelope.
  expect(bytes.readUInt32BE(16)).toBe(128);
  expect(bytes.readUInt32BE(20)).toBe(128);
  // PNG IHDR color type 6 confirms that the download uses RGBA.
  expect(bytes.readUInt8(25)).toBe(6);
  await expect(page.locator(".status-strip")).toContainText("透明");
});

test("stores a separate custom export frame for each animation", async ({ page }) => {
  await page.goto("/");
  await loadBundle(page);

  await openExportEditor(page, "Frame");
  await page.getByRole("button", { name: "自定义", exact: true }).click();
  await page.getByRole("button", { name: "绘制选框" }).click();
  const canvas = page.locator('canvas[aria-label^="Spine 动画预览"]');
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox).not.toBeNull();
  if (!canvasBox) return;
  await page.mouse.move(canvasBox.x + canvasBox.width * 0.15, canvasBox.y + canvasBox.height * 0.2);
  await page.mouse.down();
  await page.mouse.move(
    canvasBox.x + canvasBox.width * 0.38,
    canvasBox.y + canvasBox.height * 0.48,
    {
      steps: 6,
    },
  );
  await page.mouse.up();
  const frame = page.getByRole("region", { name: "自定义导出框" });
  await expect(frame).toBeVisible();
  const defaultFrameBox = await frame.boundingBox();
  expect(defaultFrameBox).not.toBeNull();
  if (defaultFrameBox) {
    expect(defaultFrameBox.width / defaultFrameBox.height).toBeCloseTo(1, 1);
  }
  await expect(page.getByText("自定义选框已就绪")).toBeVisible();
  const frameBeforeNudge = await frame.boundingBox();
  await page.getByRole("button", { name: "移动导出框" }).focus();
  await page.keyboard.press("ArrowRight");
  const frameAfterNudge = await frame.boundingBox();
  expect(frameAfterNudge?.x).toBeGreaterThan(frameBeforeNudge?.x ?? 0);

  const northEastHandle = page.getByRole("button", {
    name: "从右上角调整导出框",
  });
  const frameBeforeResize = await frame.boundingBox();
  await northEastHandle.focus();
  await page.keyboard.press("ArrowRight");
  const frameAfterResize = await frame.boundingBox();
  expect(frameAfterResize?.width).toBeGreaterThan(frameBeforeResize?.width ?? 0);

  await page.getByRole("combobox", { name: "选择基础动画" }).click();
  await page.getByRole("option", { name: /wave/ }).click();
  await expect(page.getByText("在画布上绘制选框")).toBeVisible();

  await page.getByRole("combobox", { name: "选择基础动画" }).click();
  await page.getByRole("option", { name: /idle/ }).click();
  await expect(page.getByText("自定义选框已就绪")).toBeVisible();
});

test("confirms 全部关闭 and preserves documents when cancelled", async ({ page }) => {
  await page.goto("/");
  await loadBundle(page);

  const documentTab = page.getByRole("tab", { name: /sample\.json/ });
  const openConfirmation = async () => {
    await documentTab.click({ button: "right" });
    await page.getByRole("menuitem", { name: "全部关闭" }).click();
    return page.getByRole("alertdialog", { name: "关闭全部文档？" });
  };

  let confirmation = await openConfirmation();
  await expect(confirmation).toContainText("需要重新打开才能继续");
  await confirmation.getByRole("button", { name: "取消" }).click();
  await expect(documentTab).toBeVisible();

  confirmation = await openConfirmation();
  await confirmation.getByRole("button", { name: "全部关闭" }).click();
  await expect(confirmation).toBeHidden();
  await expect(documentTab).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "把动画放到画面中央" })).toBeVisible();
});

test("moves between document tabs with arrow keys", async ({ page }) => {
  await page.goto("/");
  await loadBundle(page);
  await loadBundle(page);

  const documentTabs = page.getByRole("tab", { name: /sample\.json/ });
  await expect(documentTabs).toHaveCount(2);
  await expect(documentTabs.nth(1)).toHaveAttribute("aria-selected", "true");

  await documentTabs.nth(1).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(documentTabs.first()).toHaveAttribute("aria-selected", "true");
  await expect(documentTabs.first()).toBeFocused();

  await page.keyboard.press("End");
  await expect(documentTabs.nth(1)).toHaveAttribute("aria-selected", "true");
  await expect(documentTabs.nth(1)).toBeFocused();
});

test("keeps command groups inside a visible scroll container", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "搜索命令" }).click();

  const dialog = page.getByRole("dialog", { name: "Spine Thing 命令" });
  const commandList = dialog.locator('[data-slot="command-list"]');
  await expect(commandList).toBeVisible();

  const metrics = await commandList.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    overflowY: getComputedStyle(element).overflowY,
    scrollbarWidth: getComputedStyle(element).scrollbarWidth,
  }));
  if (metrics.scrollHeight > metrics.clientHeight) {
    expect(metrics.overflowY).toMatch(/auto|scroll/);
    expect(metrics.scrollbarWidth).not.toBe("none");
  }

  const workspaceGroup = dialog.getByRole("group", { name: "工作区" });
  const projectCommand = dialog.getByRole("option", { name: /^切换工程面板/ });
  const inspectorCommand = dialog.getByRole("option", { name: /^切换导出面板/ });
  await inspectorCommand.scrollIntoViewIfNeeded();

  const listBox = await visibleBox(commandList);
  for (const locator of [workspaceGroup, projectCommand, inspectorCommand]) {
    const box = await visibleBox(locator);
    expect(box.y).toBeGreaterThanOrEqual(listBox.y - 1);
    expect(box.y + box.height).toBeLessThanOrEqual(listBox.y + listBox.height + 1);
  }
});

test("does not present an idle workspace as successful", async ({ page }) => {
  await page.goto("/");

  const status = page.locator(".status-strip");
  await expect(status).toBeVisible();
  await expect(status.locator(".lucide-check")).toHaveCount(0);
  await expect(status.locator(".lucide-circle")).toHaveCount(1);
  await expect(status).not.toHaveClass(/text-success/);
});

test("uses a compact export summary with labeled controls", async ({ page }) => {
  await page.goto("/");

  const workspaceTabs = page
    .getByRole("tab", { name: "画布模式" })
    .locator('xpath=ancestor::*[@data-slot="tabs-list"]');
  await expect(workspaceTabs).toHaveAttribute("data-variant", "line");

  await loadBundle(page);
  await expect(page.getByRole("slider", { name: "播放头" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "输出概览" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "GIF" })).toHaveCount(0);

  await page.locator("#export-format").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#export-format")).toHaveAttribute("aria-expanded", "true");
  await page.keyboard.press("Enter");
  await expect(page.locator("#export-format")).toHaveAttribute("aria-expanded", "false");

  await openExportEditor(page, "Quality");
  await expect(page.getByRole("slider", { name: "偏好导出质量" })).toBeVisible();
  await openExportEditor(page, "Format");
  await expect(page.getByRole("combobox", { name: "导出格式" })).toContainText("WebM");
  await expect(page.getByRole("slider", { name: "偏好导出质量" })).toBeHidden();
  await openExportEditor(page, "File limit");
  await expect(page.getByLabel("最大体积（MB）")).toHaveCount(0);
  await page.getByRole("switch", { name: "限制文件大小" }).click();
  await expect(page.getByLabel("最大体积（MB）")).toHaveValue("4");
});

test("collapses canvas settings without an intermediate disclosure state", async ({ page }) => {
  await page.goto("/");
  await loadBundle(page);
  const trigger = page.getByRole("button", { name: "画布与背景" });
  const panel = trigger.locator('xpath=following-sibling::*[@data-slot="collapsible-content"]');

  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "true");
  await expect(panel).toHaveAttribute("data-open", "");

  await trigger.click();
  await trigger.click();
  await trigger.click();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(panel).toBeHidden();
});

for (const width of [320, 390]) {
  test(`keeps compact header controls and documents separate at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 732 });
    await page.goto("/");
    await loadBundle(page);

    const header = page.locator("header").first();
    const rowOneControls = [
      page.getByRole("tab", { name: "画布模式" }),
      page.getByRole("tab", { name: "画廊模式" }),
      page.getByRole("button", { name: /工程面板/ }),
      page.getByRole("button", { name: "搜索命令" }),
      page.getByRole("button", { name: /本机运行时.*查看编码器支持。/ }),
      page.getByRole("button", { name: /导出面板/ }),
    ];
    const headerBox = await visibleBox(header);
    const rowOneBoxes = await Promise.all(rowOneControls.map(visibleBox));

    const documentList = page.getByRole("tablist", { name: "已打开的动画文档" });
    const documentTab = documentList.getByRole("tab", { name: /sample\.json/ });
    const newDocument = page.getByRole("button", { name: "打开 Spine 资源包" });
    const documentListBox = await visibleBox(documentList);
    const documentTabBox = await visibleBox(documentTab);
    const newDocumentBox = await visibleBox(newDocument);

    const allBoxes = [...rowOneBoxes, documentTabBox, newDocumentBox];
    for (const box of allBoxes) {
      expect(box.x).toBeGreaterThanOrEqual(-1);
      expect(box.x + box.width).toBeLessThanOrEqual(width + 1);
      expect(box.y).toBeGreaterThanOrEqual(headerBox.y - 1);
      expect(box.y + box.height).toBeLessThanOrEqual(headerBox.y + headerBox.height + 1);
    }

    for (let left = 0; left < rowOneBoxes.length; left += 1) {
      for (let right = left + 1; right < rowOneBoxes.length; right += 1) {
        expect(boxesOverlap(rowOneBoxes[left]!, rowOneBoxes[right]!)).toBe(false);
      }
    }
    expect(boxesOverlap(documentTabBox, newDocumentBox)).toBe(false);
    expect(documentListBox.width).toBeGreaterThan(newDocumentBox.width * 2);

    const overflow = await header.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
      pageWidth: document.documentElement.scrollWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);
    expect(overflow.pageWidth).toBeLessThanOrEqual(width + 1);
  });
}

test.describe("mobile workspace", () => {
  test.use({ viewport: { width: 360, height: 732 }, hasTouch: true, isMobile: true });

  test("shows the canvas and opens both mobile drawers", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("region", { name: "动画预览工作区" })).toBeVisible();

    const projectButton = page.getByRole("button", { name: "显示工程面板" });
    const projectButtonBox = await projectButton.boundingBox();
    expect(projectButtonBox?.height).toBeGreaterThanOrEqual(44);
    await projectButton.click();
    await expect(page.getByRole("region", { name: "工程与转换" })).toBeVisible();
    const projectDrawer = page.locator('[data-slot="drawer-popup"][data-open]');
    await expect(projectDrawer).toBeVisible();
    expect((await projectDrawer.boundingBox())?.width).toBeGreaterThanOrEqual(330);
    await page.getByRole("button", { name: "关闭工程面板" }).click();

    await page.getByRole("button", { name: "显示导出面板" }).click();
    await expect(page.getByRole("region", { name: "动画导出" })).toBeVisible();
    const inspectorDrawer = page.locator('[data-slot="drawer-popup"][data-open]');
    expect((await inspectorDrawer.boundingBox())?.width).toBeGreaterThanOrEqual(330);
    await page.getByRole("button", { name: "关闭导出面板" }).click();
    await expect(page.getByRole("region", { name: "动画预览工作区" })).toBeVisible();
  });
});
