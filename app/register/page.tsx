import { RegisterForm } from "./register-form";

export default function RegisterPage() {
  const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? "";
  return <RegisterForm siteKey={siteKey} />;
}
