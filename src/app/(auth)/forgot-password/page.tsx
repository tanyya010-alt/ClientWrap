import Link from "next/link";
import { AuthShell } from "@/components/auth-shell";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, Input } from "@/components/ui";
import { forgotPasswordAction } from "../actions";

export const metadata = { title: "Reset password" };

export default function ForgotPage() {
  return (
    <AuthShell title="Reset your password" subtitle="We'll email you a link to choose a new password." footer={<Link href="/login" className="text-indigo-600">Back to log in</Link>}>
      <ActionForm action={forgotPasswordAction}>
        <Field label="Email" htmlFor="email">
          <Input id="email" name="email" type="email" required />
        </Field>
        <SubmitButton className="w-full">Send reset link</SubmitButton>
      </ActionForm>
    </AuthShell>
  );
}
