import { ForgotPasswordForm } from "./forgot-password-form";

export default function ForgotPasswordPage() {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
  return <ForgotPasswordForm siteKey={siteKey} />;
}
