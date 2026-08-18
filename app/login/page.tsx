import { LoginForm } from "./login-form";

export default function LoginPage() {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
  return <LoginForm siteKey={siteKey} />;
}
