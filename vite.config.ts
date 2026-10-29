import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

const FALLBACK_SITE_URL = "https://spine-thing.vercel.app/";

function normalizeSiteUrl(rawUrl: string): string {
  const withProtocol = rawUrl.includes("://") ? rawUrl : `https://${rawUrl}`;
  const url = new URL(withProtocol);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`SITE_URL must use http or https, received ${url.protocol}`);
  }

  url.hash = "";
  url.search = "";
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url.toString();
}

function siteMetadataPlugin(): Plugin {
  const configuredUrl = process.env.SITE_URL?.trim();
  const vercelProductionUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  const siteUrl = normalizeSiteUrl(configuredUrl || vercelProductionUrl || FALLBACK_SITE_URL);
  const sitemapUrl = new URL("sitemap.xml", siteUrl).toString();

  return {
    name: "site-metadata",
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        return html.replaceAll("__SITE_URL__", siteUrl);
      },
    },
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "robots.txt",
        source: `User-agent: *\nAllow: /\n\nSitemap: ${sitemapUrl}\n`,
      });
      this.emitFile({
        type: "asset",
        fileName: "sitemap.xml",
        source: [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
          "  <url>",
          `    <loc>${siteUrl.replaceAll("&", "&amp;")}</loc>`,
          "  </url>",
          "</urlset>",
          "",
        ].join("\n"),
      });
    },
  };
}

export default defineConfig({
  plugins: [siteMetadataPlugin(), react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    target: "es2022",
    // Production assets are deployed directly and no private error-monitoring
    // upload exists, so emitting source maps would publish the complete source.
    sourcemap: false,
    rolldownOptions: {
      output: {
        // React and the third-party libraries change on their own schedule, so
        // they are cached separately from application code that ships often.
        codeSplitting: {
          groups: [
            { name: "react", test: /node_modules[\\/](react|react-dom|scheduler)[\\/]/ },
            { name: "vendor", test: /node_modules[\\/](@base-ui|@floating-ui|@tanstack)[\\/]/ },
          ],
        },
      },
    },
  },
  worker: {
    format: "es",
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "tests/unit/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}"],
      reporter: ["text", "html"],
    },
  },
});
