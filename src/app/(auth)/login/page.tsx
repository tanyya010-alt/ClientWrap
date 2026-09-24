import Link from "next/link";
import { AuthShell, GoogleButton } from "@/components/auth-shell";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Alert, Field, Input } from "@/components/ui";
import { loginAction } from "../actions";

export const metadata = { title: "Log in" };

const ERRORS: Record<string, string> = {
  google_not_configured: "Google sign-in isn't configured on this server yet. Use email and password.",
  google_state: "Google sign-in expired. Please try again.",
  google_failed: "Google sign-in failed. Please try again.",
  google_unverified: "Your Google email isn't verified.",
  verify_invalid: "That verification link is invalid or expired. Log in and request a new one.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  return (
    <AuthShell
      title="Welcome back"
      subtitle="Log in to your ClientWrap workspace."
      footer={
        <>
          New here?{" "}
          <Link className="font-medium text-indigo-600" href="/signup">
            Create an account
          </Link>
        </>
      }
    >
      {sp.error && ERRORS[sp.error] && (
        <div className="mb-4">
          <Alert tone="error">{ERRORS[sp.error]}</Alert>
        </div>
      )}
      <GoogleButton next={sp.next} />
      <div className="my-4 flex items-center gap-3 text-xs text-slate-400">
        <span className="h-px flex-1 bg-slate-200" /> or <span className="h-px flex-1 bg-slate-200" />
      </div>
      <ActionForm action={loginAction}>
        <input type="hidden" name="next" value={sp.next ?? ""} />
        <Field label="Email" htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </Field>
        <Field label="Password" htmlFor="password">
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </Field>
        <div className="flex items-center justify-between">
          <SubmitButton pendingText="Logging in…">Log in</SubmitButton>
          <Link href="/forgot-password" className="text-sm text-indigo-600">
            Forgot password?
          </Link>
        </div>
      </ActionForm>
    </AuthShell>
  );
}
