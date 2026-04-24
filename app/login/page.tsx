"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showReset, setShowReset] = useState(false);
  const [resetEmail, setResetEmail] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetSuccess, setResetSuccess] = useState(false);

  useEffect(() => {
    const checkSession = async () => {
      const response = await fetch("/api/auth/session", {
        credentials: "include",
      });
      const payload = await response.json();
      if (response.ok && payload?.user) {
        router.replace("/dashboard/expand");
      }
    };
    checkSession();
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      if (!email || !password) {
        throw new Error("请输入邮箱和密码");
      }

      const response = await fetch("/api/auth/sign-in", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email, password }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload?.error || "登录失败");
      }
      router.replace("/dashboard/expand");
    } catch (err) {
      setError(err instanceof Error ? err.message : "认证失败");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-muted/40 p-4">
      <Card className="w-full max-w-md border-zinc-200 shadow-xl dark:border-zinc-800">
        <CardHeader className="space-y-1 text-center">
          <CardTitle className="text-2xl font-bold tracking-tight">登录账号</CardTitle>
          <CardDescription>使用已开通账号登录，或使用邀请码注册。</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
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
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
              />
            </div>
            {error && <div className="text-sm font-medium text-destructive animate-in fade-in">{error}</div>}
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              登录
            </Button>
            <div className="text-center text-sm text-muted-foreground">
              没有账号？{" "}
              <a href="/register" className="text-primary underline-offset-4 hover:underline">
                学员注册
              </a>
            </div>
            <div className="text-center">
              <button
                type="button"
                className="text-sm text-muted-foreground hover:text-primary underline-offset-4 hover:underline"
                onClick={() => { setShowReset(true); setError(null); }}
              >
                忘记密码？
              </button>
            </div>
          </form>

          {showReset && (
            <div className="mt-4 border-t pt-4">
              <div className="text-sm font-medium mb-3">重置密码</div>
              <div className="space-y-3">
                <Input
                  type="email"
                  placeholder="注册邮箱"
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  disabled={resetLoading}
                />
                {resetError && <div className="text-sm text-destructive">{resetError}</div>}
                {resetSuccess && <div className="text-sm text-green-600">重置邮件已发送，请查收邮箱（30分钟内有效）。</div>}
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled={resetLoading || !resetEmail}
                  onClick={async () => {
                    setResetLoading(true);
                    setResetError(null);
                    setResetSuccess(false);
                    try {
                      const res = await fetch("/api/auth/forgot-password", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ email: resetEmail }),
                      });
                      const data = await res.json();
                      if (!res.ok) throw new Error(data.error || "发送失败");
                      setResetSuccess(true);
                    } catch (err) {
                      setResetError(err instanceof Error ? err.message : "发送失败");
                    } finally {
                      setResetLoading(false);
                    }
                  }}
                >
                  {resetLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  发送重置邮件
                </Button>
                <button
                  type="button"
                  className="text-sm text-muted-foreground hover:text-primary w-full text-center"
                  onClick={() => setShowReset(false)}
                >
                  返回登录
                </button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="fixed inset-0 -z-10 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-100/50 via-background to-background dark:from-indigo-950/20" />
    </div>
  );
}
