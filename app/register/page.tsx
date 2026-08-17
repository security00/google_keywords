"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import Link from "next/link";
import { TurnstileField } from "@/components/turnstile-field";
import {
  INVITE_SIGNUP_TRIAL_DAYS,
  PUBLIC_SIGNUP_TRIAL_DAYS,
  isPublicSignupEnabled,
} from "@/lib/public-signup";

export default function RegisterPage() {
  return (
    <Suspense fallback={null}>
      <RegisterPageContent />
    </Suspense>
  );
}

function RegisterPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const registrationToken = searchParams.get("token")?.trim() ?? "";
  const usingSharedRegistration = Boolean(registrationToken);
  const publicSignup = isPublicSignupEnabled();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [turnstileToken, setTurnstileToken] = useState("");
  const [turnstileReset, setTurnstileReset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [requiresActivation, setRequiresActivation] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (!email || !password) {
        throw new Error("Email and password are required");
      }

      if (!usingSharedRegistration && !inviteCode && !publicSignup) {
        throw new Error("Invite code is required");
      }

      if (!email.includes("@")) {
        throw new Error("Enter a valid email address");
      }

      if (password.length < 8) {
        throw new Error("Password must be at least 8 characters");
      }

      const response = await fetch("/api/auth/sign-up", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          email,
          password,
          inviteCode,
          registrationToken: usingSharedRegistration ? registrationToken : undefined,
          turnstileToken,
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        setTurnstileReset((value) => value + 1);
        throw new Error(payload?.error || "Unable to create account");
      }

      setSuccessMessage(
        typeof payload?.message === "string" ? payload.message : "Account created"
      );
      setRequiresActivation(Boolean(payload?.requiresActivation));
      setSuccess(true);
      if (!payload?.requiresActivation) {
        setTimeout(() => router.replace("/dashboard/expand"), 1500);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to create account");
    } finally {
      setLoading(false);
    }
  };

  if (success) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
        <Card className="w-full max-w-md border-zinc-200 shadow-xl dark:border-zinc-800">
          <CardContent className="pt-6 text-center">
            <div className="text-4xl mb-4">🎉</div>
            <h2 className="text-xl font-bold mb-2">You&apos;re in</h2>
            <p className="text-muted-foreground">
              {successMessage || "Account created"}
            </p>
            {requiresActivation ? (
              <div className="mt-4 text-sm text-muted-foreground">
                An admin will activate a {INVITE_SIGNUP_TRIAL_DAYS}-day trial before you can sign in.
              </div>
            ) : (
              <div className="mt-4 text-sm text-muted-foreground">
                Redirecting to the dashboard...
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-md border-zinc-200 shadow-xl dark:border-zinc-800">
        <CardHeader className="space-y-1 text-center">
          <CardTitle className="text-2xl font-bold tracking-tight">Create your account</CardTitle>
          <CardDescription>
            {usingSharedRegistration
              ? `Finish registration, then wait for an admin to activate a ${INVITE_SIGNUP_TRIAL_DAYS}-day trial.`
              : publicSignup
                ? `Start a ${PUBLIC_SIGNUP_TRIAL_DAYS}-day free trial. An invite code still unlocks ${INVITE_SIGNUP_TRIAL_DAYS} days.`
                : `Enter your invite code to start a ${INVITE_SIGNUP_TRIAL_DAYS}-day trial.`}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {!usingSharedRegistration ? (
              <div className="space-y-2">
                <Label htmlFor="inviteCode">
                  Invite code{publicSignup ? " (optional)" : ""}
                </Label>
                <Input
                  id="inviteCode"
                  placeholder="SK-XXXX-XXXX"
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value.toUpperCase())}
                  disabled={loading}
                  className="font-mono tracking-wider"
                />
              </div>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={loading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                placeholder="At least 8 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
              />
            </div>
            <TurnstileField onToken={setTurnstileToken} resetSignal={turnstileReset} />
            {error && <div className="text-sm font-medium text-destructive animate-in fade-in">{error}</div>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {publicSignup ? "Start free trial" : "Create account"}
            </Button>
            <div className="text-center text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link href="/login" className="text-primary underline-offset-4 hover:underline">
                Log in
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="fixed inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-100/50 via-background to-background dark:from-indigo-950/20" />
    </div>
  );
}
