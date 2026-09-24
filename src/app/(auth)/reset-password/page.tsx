import { AuthShell } from "@/components/auth-shell";
import { ActionForm, SubmitButton } from "@/components/forms";
import { Field, Input } from "@/components/ui";
import { resetPasswordAction } from "../actions";

export const metadata = { title: "Choose a new password" };

export default async function ResetPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const { token = "" } = await searchParams;
  return (
    <AuthShell title="Choose a new password">
      <ActionForm action={resetPasswordAction}>
        <input type="hidden" name="token" value={token} />
        <Field label="New password" htmlFor="password" hint="At least 10 characters, with a letter and a number.">
          <Input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required />
        </Field>
        <SubmitButton className="w-full">Save and log in</SubmitButton>
      </ActionForm>
    </AuthShell>
  );
}
