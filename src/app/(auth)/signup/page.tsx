import Link from "next/link";
import { AuthShell, GoogleButton } from "@/components/auth-shell";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Alert, Field, Input } from "@/components/ui";
import { signupAction } from "../actions";
import { pendingLicenseKey } from "@/lib/appsumo-cookie";

export const metadata = { title: "Create your account" };

export default async function SignupPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const pending = await pendingLicenseKey();
  return (
    <AuthShell
      title="Create your ClientWrap account"
      subtitle="Free for your first client. No credit card."
      footer={
        <>
          Already have an account?{" "}
          <Link className="font-medium text-indigo-600" href="/login">
            Log in
          </Link>
        </>
      }
    >
      {pending && (
        <div className="mb-4">
          <Alert tone="success">Your AppSumo license will be applied automatically when you finish.</Alert>
        </div>
      )}
      <GoogleButton />
      <div className="my-4 flex items-center gap-3 text-xs text-slate-400">
        <span className="h-px flex-1 bg-slate-200" /> or <span className="h-px flex-1 bg-slate-200" />
      </div>
      <ActionForm action={signupAction}>
        <Field label="Your name" htmlFor="name">
          <Input id="name" name="name" autoComplete="name" />
        </Field>
        <Field label="Work email" htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="email" defaultValue={sp.email ?? ""} required />
        </Field>
        <Field label="Password" htmlFor="password" hint="At least 10 characters, with a letter and a number.">
          <Input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required />
        </Field>
        <label className="flex items-start gap-2 text-sm text-slate-600">
          <input type="checkbox" name="terms" required className="mt-1" />
          <span>
            I agree to the{" "}
            <a href="/legal/terms" target="_blank" className="text-indigo-600 underline">
              Terms
            </a>{" "}
            and{" "}
            <a href="/legal/privacy" target="_blank" className="text-indigo-600 underline">
              Privacy Policy
            </a>
            .
          </span>
        </label>
        <SubmitButton className="w-full" pendingText="Creating your workspace…">
          Create account
        </SubmitButton>
      </ActionForm>
    </AuthShell>
  );
}
