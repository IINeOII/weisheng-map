// 自動化測試設定
// 本機：npm test（第一次先跑 npx playwright install chromium）
// 已安裝 Chrome 想直接用：CHROME_PATH=/path/to/chrome npm test
import { defineConfig, devices } from "@playwright/test";

const chrome = process.env.CHROME_PATH ? { launchOptions: { executablePath: process.env.CHROME_PATH } } : {};

export default defineConfig({
  testDir: "tests",
  timeout: 30_000,
  fullyParallel: true,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:4173",
    ...chrome,
  },
  projects: [
    { name: "手機", use: { ...devices["Pixel 7"], ...chrome } },
    { name: "桌機", use: { viewport: { width: 1280, height: 800 }, ...chrome } },
  ],
  webServer: {
    command: "npx http-server docs -p 4173 -c-1 --silent",
    url: "http://localhost:4173/index.html",
    reuseExistingServer: !process.env.CI,
  },
});
