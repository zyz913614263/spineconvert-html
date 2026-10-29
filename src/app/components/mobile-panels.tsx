import { memo, type ComponentProps } from "react";

import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import type { GalleryItem } from "@/domain/gallery/manifest";

import { GalleryPanel } from "./gallery-panel";
import { InspectorPanel } from "./inspector-panel";
import { ProjectPanel } from "./project-panel";

type MobilePanelsProps = {
  /** Chooses the project or gallery drawer. */
  mode: "canvas" | "gallery";
  projectOpen: boolean;
  inspectorOpen: boolean;
  projectPanel: ComponentProps<typeof ProjectPanel>;
  galleryPanel: ComponentProps<typeof GalleryPanel>;
  inspectorPanel: ComponentProps<typeof InspectorPanel>;
  onProjectOpenChange: (open: boolean) => void;
  onInspectorOpenChange: (open: boolean) => void;
  onSelectGalleryItem: (item: GalleryItem) => void;
  onCloseProject: () => void;
  onCloseInspector: () => void;
};

/** Renders project and export panels as mobile drawers. */
export const MobilePanels = memo(function MobilePanels({
  mode,
  projectOpen,
  inspectorOpen,
  projectPanel,
  galleryPanel,
  inspectorPanel,
  onProjectOpenChange,
  onInspectorOpenChange,
  onSelectGalleryItem,
  onCloseProject,
  onCloseInspector,
}: MobilePanelsProps) {
  const gallery = mode === "gallery";

  return (
    <>
      <Drawer open={projectOpen} onOpenChange={onProjectOpenChange} swipeDirection="left">
        <DrawerContent className="data-[swipe-axis=x]:[--drawer-content-width:min(var(--size-drawer),calc(100vw-var(--space-6)))]">
          <DrawerHeader className="sr-only">
            <DrawerTitle>{gallery ? "动画画廊" : "工程与转换"}</DrawerTitle>
            <DrawerDescription>
              {gallery ? "选择一个服务器上的 Spine 动画。" : "加载资源包并选择转换设置。"}
            </DrawerDescription>
          </DrawerHeader>
          {gallery ? (
            // Close the drawer after selection so the preview becomes visible.
            <GalleryPanel
              {...galleryPanel}
              onSelect={onSelectGalleryItem}
              onClose={onCloseProject}
            />
          ) : (
            <ProjectPanel {...projectPanel} onClose={onCloseProject} />
          )}
        </DrawerContent>
      </Drawer>

      <Drawer open={inspectorOpen} onOpenChange={onInspectorOpenChange} swipeDirection="right">
        <DrawerContent className="data-[swipe-axis=x]:[--drawer-content-width:min(var(--size-drawer),calc(100vw-var(--space-6)))]">
          <DrawerHeader className="sr-only">
            <DrawerTitle>动画导出</DrawerTitle>
            <DrawerDescription>选择画面、尺寸和导出设置。</DrawerDescription>
          </DrawerHeader>
          <InspectorPanel {...inspectorPanel} onClose={onCloseInspector} />
        </DrawerContent>
      </Drawer>
    </>
  );
});
