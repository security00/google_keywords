const PRODUCTION_APP_URL = "https://www.discoverkeywords.co";

// Next inlines process.env.NEXT_PUBLIC_* at build time. A local build baked
// http://localhost:3000 into the worker, so server links must read the runtime
// Worker var APP_URL and ignore localhost.
const configuredAppUrl = (value: string | undefined) => {
  const trimmed = value?.trim().replace(/\/$/, "") ?? "";
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    if (url.hostname === "localhost" || url.hostname === "127.0.0.1") return "";
    return url.origin;
  } catch {
    return "";
  }
};

export const appBaseUrl = () =>
  configuredAppUrl(process.env.APP_URL) ||
  configuredAppUrl(process.env.PUBLIC_BASE_URL) ||
  PRODUCTION_APP_URL;
