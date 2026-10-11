import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/browser",
  timeout: 30000,
  fullyParallel: true,
  use: {
    baseURL: process.env.BASE_URL || "http://127.0.0.1:8019",
    browserName: "chromium",
    reducedMotion: "reduce",
    launchOptions: {
      args: [
        "--enable-webgl",
        "--use-gl=angle",
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
      ],
    },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command:
          "npm run build && uv run --locked uvicorn app:app --host 127.0.0.1 --port 8019 --no-access-log",
        url: "http://127.0.0.1:8019/api/health",
        reuseExistingServer: false,
      },
});
