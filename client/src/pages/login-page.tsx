import { useState } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import logoUrl from "@assets/visitTrinbago_1776640364814.png";

export default function LoginPage() {
  const [, setLocation] = useLocation();
  const { login } = useAuth();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      await login(email, password);
      setLocation("/");
    } catch (err: any) {
      toast({
        title: "Sign in failed",
        description: err?.message?.includes("401") ? "Invalid email or password" : "Something went wrong",
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-md">
        <div className="flex flex-col items-center gap-3 mb-8">
          <img
            src={logoUrl}
            alt="#visitTrinbago"
            className="w-full max-w-[260px] h-auto"
            data-testid="img-login-logo"
          />
          <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-muted-foreground">
            Content Manager
          </p>
        </div>

        <Card className="p-6 md:p-8 border-2">
          <div className="mb-6">
            <p className="text-xs font-bold uppercase tracking-[0.2em] text-primary mb-1">Sign In</p>
            <h1 className="text-2xl md:text-3xl font-black tracking-tight uppercase" data-testid="text-login-title">
              Admin Access
            </h1>
            <p className="text-sm text-muted-foreground mt-2 font-medium">
              Enter your credentials to manage tourism content.
            </p>
          </div>

          <form onSubmit={onSubmit} className="space-y-4" data-testid="form-login">
            <div className="space-y-2">
              <Label htmlFor="email" className="font-bold uppercase tracking-wide text-xs">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="you@example.com"
                data-testid="input-email"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password" className="font-bold uppercase tracking-wide text-xs">
                Password
              </Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                data-testid="input-password"
              />
            </div>
            <Button
              type="submit"
              className="w-full font-bold uppercase tracking-wide"
              disabled={submitting}
              data-testid="button-login"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Sign In"}
            </Button>
          </form>
        </Card>
      </div>
    </div>
  );
}
