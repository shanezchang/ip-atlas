import type {
  Page,
  TestType,
  PlaywrightTestArgs,
  PlaywrightTestOptions,
  PlaywrightWorkerArgs,
  PlaywrightWorkerOptions,
} from "@playwright/test";
export type Transport = {
  origin: string;
  requests: { path: string; start: number; sent?: number; bytes?: number }[];
  delays: Map<string, number>;
  cache: { enabled: boolean };
};
export const test: TestType<
  PlaywrightTestArgs & PlaywrightTestOptions & { transport: Transport },
  PlaywrightWorkerArgs & PlaywrightWorkerOptions
>;
export { expect } from "@playwright/test";
export function resourceKey(url: string): string;
export const synthetic320: Map<string, number>;
export function observe(page: Page): Promise<void>;
export function observation(page: Page): Promise<{
  ready: number | null;
  blobs: {
    url: string;
    bytes: number;
    created: number;
    revoked: number | null;
  }[];
  jsonReads: string[];
  largeJSON: number[];
  workers: { created: number; terminated: number };
  longtasks: { start: number; duration: number }[];
  at: number;
  timeOrigin: number;
  navigation: Record<string, number>[];
  resources: Record<string, unknown>[];
  labels: number;
}>;
