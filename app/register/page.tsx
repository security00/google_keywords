"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import Link from "next/link";

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
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
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
      if (!email || !password || (!usingSharedRegistration && !inviteCode)) {
        throw new Error("请填写所有字段");
      }

      if (!email.includes("@")) {
        throw new Error("邮箱格式不正确");
      }

      if (password.length < 8) {
        throw new Error("密码至少 8 位");
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
        }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "注册失败");
      }

      setSuccessMessage(
        typeof payload?.message === "string" ? payload.message : "注册成功"
      );
      setRequiresActivation(Boolean(payload?.requiresActivation));
      setSuccess(true);
      if (!payload?.requiresActivation) {
        setTimeout(() => router.replace("/dashboard/expand"), 1500);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "注册失败");
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
            <h2 className="text-xl font-bold mb-2">注册成功！</h2>
            <p className="text-muted-foreground">
              {successMessage || "注册成功"}
            </p>
            {requiresActivation ? (
              <div className="mt-4 text-sm text-muted-foreground">
                请等待管理员批量开通后再登录使用。
              </div>
            ) : (
              <div className="mt-4 text-sm text-muted-foreground">
                免费试用 90 天，正在跳转...
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
          <CardTitle className="text-2xl font-bold tracking-tight">学员注册</CardTitle>
          <CardDescription>
            {usingSharedRegistration
              ? "完成注册后等待管理员批量开通 90 天使用期"
              : "输入邀请码注册，免费使用 90 天"}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {!usingSharedRegistration ? (
              <div className="space-y-2">
                <Label htmlFor="inviteCode">邀请码</Label>
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
              <Label htmlFor="email">邮箱</Label>
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
              <Label htmlFor="password">密码</Label>
              <Input
                id="password"
                type="password"
                placeholder="至少 8 位"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
              />
            </div>
            {error && <div className="text-sm font-medium text-destructive animate-in fade-in">{error}</div>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              注册
            </Button>
            <div className="text-center text-sm text-muted-foreground">
              已有账号？{" "}
              <Link href="/login" className="text-primary underline-offset-4 hover:underline">
                登录
              </Link>
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="fixed inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-100/50 via-background to-background dark:from-indigo-950/20" />
    </div>
  );
}
