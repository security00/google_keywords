import "server-only";

const RESEND_MAX_ATTEMPTS = 2;
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export const TRANSACTIONAL_FROM = "DiscoverKeywords <support@discoverkeywords.co>";

export async function sendTransactionalEmail({
  to,
  subject,
  html,
}: {
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    throw new Error("RESEND_API_KEY not configured");
  }

  let lastError = "Unknown email error";
  for (let attempt = 1; attempt <= RESEND_MAX_ATTEMPTS; attempt += 1) {
    try {
      const resendRes = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: TRANSACTIONAL_FROM,
          to,
          subject,
          html,
        }),
      });

      if (resendRes.ok) return;

      lastError = await resendRes.text();
      console.error("[email] Resend error:", lastError);
    } catch (error) {
      lastError = error instanceof Error ? error.message : "Unexpected email error";
      console.error("[email] Email error:", lastError);
    }

    if (attempt < RESEND_MAX_ATTEMPTS) {
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
