import Link from "next/link";
import { requireApp } from "@/lib/auth";
import { listDocs } from "@/lib/content";
import { Card, Field, Input, PageHeader, Textarea } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/forms";
import { supportAction } from "./actions";
import { env } from "@/lib/env";

export const metadata = { title: "Help & support" };

export default async function InAppHelp() {
  const ctx = await requireApp();
  const docs = listDocs("help");
  return (
    <>
      <PageHeader title="Help & support" subtitle="Guides for every feature, plus a direct line to us." />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <div className="grid gap-3 sm:grid-cols-2">
            {docs.map((d) => (
              <a key={d.slug} href={`/help/${d.slug}`} target="_blank" className="rounded-xl border border-slate-200 bg-white p-4 hover:border-indigo-300">
                <p className="font-medium">{d.title}</p>
                <p className="mt-1 text-sm text-slate-600">{d.description}</p>
              </a>
            ))}
          </div>
          <p className="mt-4 text-sm text-slate-600">Want a guided tour again? <Link className="text-indigo-600" href="/onboarding?step=1">Restart guided setup</Link> or <Link className="text-indigo-600" href="/onboarding?step=demo">load the demo workspace</Link>.</p>
        </div>
        <Card title="Message support">
          <ActionForm action={supportAction} resetOnSuccess>
            <Field label="Subject" htmlFor="subject"><Input id="subject" name="subject" required /></Field>
            <Field label="How can we help?" htmlFor="message"><Textarea id="message" name="message" rows={6} required /></Field>
            <SubmitButton>Send</SubmitButton>
          </ActionForm>
          <p className="mt-3 text-xs text-slate-500">We'll reply to {ctx.user.email}. You can also email {env.SUPPORT_EMAIL}.{env.CRISP_WEBSITE_ID ? " Or use the chat bubble in the corner." : ""}</p>
        </Card>
      </div>
    </>
  );
}
