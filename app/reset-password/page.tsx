import { ResetPasswordForm } from "./reset-password-form";

export default function ResetPasswordPage() {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
  return <ResetPasswordForm siteKey={siteKey} />;
}
