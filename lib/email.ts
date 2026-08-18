import "server-only";

import { getCloudflareContext } from "@opennextjs/cloudflare";

const INBOX_MAX_ATTEMPTS = 2;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const TRANSACTIONAL_FROM = "DiscoverKeywords <support@discoverkeywords.co>";
const TRANSACTIONAL_FROM_EMAIL = "support@discoverkeywords.co";

const getInboxBinding = async (): Promise<CloudflareEnv["INBOX"]> => {
  try {
    const { env } = await getCloudflareContext({ async: true });
    if (typeof env.INBOX?.fetch !== "function") {
      throw new Error("INBOX binding is missing");
    }
    return env.INBOX;
  } catch (error) {
    throw new Error(
      "INBOX service binding is unavailable. Ensure the agentic-inbox Worker service binding is configured.",
      { cause: error }
    );
  }
};

export async function sendTransactionalEmail({
  to,
  subject,
  html,
}: {
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  const inbox = await getInboxBinding();

  let lastError = "Unknown email error";
  for (let attempt = 1; attempt <= INBOX_MAX_ATTEMPTS; attempt += 1) {
    try {
      const inboxRes = await inbox.fetch(
        `https://inbox.internal/api/v1/mailboxes/${TRANSACTIONAL_FROM_EMAIL}/emails`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            to,
            from: {
              email: TRANSACTIONAL_FROM_EMAIL,
              name: "DiscoverKeywords",
            },
            subject,
            html,
          }),
        }
      );

      if (inboxRes.ok) return;

      lastError = await inboxRes.text();
      console.error("[email] Inbox error:", lastError);
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Unexpected email error";
      console.error("[email] Email error:", lastError);
    }

    if (attempt < INBOX_MAX_ATTEMPTS) {
      await wait(300);
    }
  }

  throw new Error(lastError);
}

export const appBaseUrl = () =>
  (process.env.NEXT_PUBLIC_APP_URL || process.env.PUBLIC_BASE_URL || "https://discoverkeywords.co").replace(
    /\/$/,
    ""
  );
