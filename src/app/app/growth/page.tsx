import Link from "next/link";
import { requireApp, inTenant } from "@/lib/auth";
import { Alert, Badge, Card, Empty, Input, PageHeader, Textarea } from "@/components/ui";
import { ActionForm, CopyButton, SubmitButton } from "@/components/forms";
import { ReferralComposer } from "@/components/referral-composer";
import { can } from "@/lib/tiers";
import { env } from "@/lib/env";
import {
  deleteCaseStudyAction,
  deleteRenewalAction,
  generateCaseStudyAction,
  generateReferralAction,
  generateRenewalAction,
  publishCaseStudyAction,
  requestApprovalAction,
  saveCaseStudyAction,
  saveRenewalAction,
  sendReferralAction,
} from "./actions";

export const metadata = { title: "Growth" };

const STATUS_TONE: Record<string, "slate" | "amber" | "green" | "red" | "indigo"> = {
  draft: "slate",
  pending_approval: "amber",
  approved: "green",
  changes_requested: "red",
  published: "indigo",
};

export default async function GrowthPage({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  const sp = await searchParams;
  const ctx = await requireApp();
  const clients = await inTenant(ctx, (q) => q.many("select id, name from clients where archived_at is null order by name"));
  const clientId = clients.find((c) => c.id === sp.client)?.id ?? clients[0]?.id;
  const data = clientId
    ? await inTenant(ctx, async (q) => ({
        renewals: await q.many("select * from renewal_suggestions where client_id = $1 order by created_at desc limit 5", [clientId]),
        cases: await q.many("select * from case_studies where client_id = $1 order by created_at desc", [clientId]),
        referrals: await q.many("select * from message_log where client_id = $1 and kind = 'referral' order by created_at desc limit 5", [clientId]),
      }))
    : null;
  const locked = !can(ctx.entitlement, "renewal_generator");
  return (
    <>
      <PageHeader title="Growth" subtitle="Turn results into renewals, case studies and referrals." />
      {locked && (
        <div className="mb-6">
          <Alert>
            Renewal suggestions, case studies and referral requests are part of the Growth plan.{" "}
            <a className="font-semibold underline" href="/app/billing">See plans</a>.
          </Alert>
        </div>
      )}
      {clients.length === 0 || !data ? (
        <Empty title="Add a client first">
          <Link href="/app/clients/new" className="text-indigo-600">New client</Link>
        </Empty>
      ) : (
        <>
          <div className="mb-6 flex flex-wrap gap-2">
            {clients.map((c) => (
              <Link key={c.id} href={`/app/growth?client=${c.id}`} className={`rounded-full px-3 py-1 text-sm ${c.id === clientId ? "bg-indigo-600 text-white" : "bg-white ring-1 ring-slate-200"}`}>
                {c.name}
              </Link>
            ))}
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <Card
              title="Renewal suggestion"
              actions={
                !locked && (
                  <ActionForm action={generateRenewalAction.bind(null, clientId!)} className="inline">
                    <SubmitButton variant="secondary" className="!py-1 !text-xs" pendingText="Thinking…">Generate</SubmitButton>
                  </ActionForm>
                )
              }
            >
              <p className="mb-3 text-sm text-slate-600">Based on this client's results and contract timing. Choose one to show as the “looking ahead” step on their results page.</p>
              {data.renewals.length === 0 && <p className="text-sm text-slate-500">No suggestions yet.</p>}
              <div className="space-y-4">
                {data.renewals.map((r) => (
                  <div key={r.id} className="rounded-lg border border-slate-200 p-3">
                    <ActionForm action={saveRenewalAction.bind(null, r.id)} className="space-y-2">
                      <Input name="title" defaultValue={r.title} aria-label="Title" />
                      <Textarea name="body" defaultValue={r.body} rows={4} aria-label="Suggestion" />
                      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="visible" defaultChecked={r.visible_in_portal} /> Show on the client's results page</label>
                      <SubmitButton variant="secondary" className="!py-1 !text-xs">Save</SubmitButton>
                    </ActionForm>
                    <form action={deleteRenewalAction.bind(null, r.id)} className="mt-1"><button className="text-xs text-rose-600">Delete</button></form>
                  </div>
                ))}
              </div>
            </Card>
            <Card title="Referral request">
              {locked ? (
                <p className="text-sm text-slate-500">Available on the Growth plan.</p>
              ) : (
                <>
                  <p className="mb-3 text-sm text-slate-600">A short, no-pressure email that mentions a real result. Includes an unsubscribe link and passes tone checks.</p>
                  <ReferralComposer generate={generateReferralAction.bind(null, clientId!)} send={sendReferralAction.bind(null, clientId!)} />
                  {data.referrals.length > 0 && (
                    <ul className="mt-4 space-y-1 text-xs text-slate-500">
                      {data.referrals.map((m) => (
                        <li key={m.id}><Badge tone={m.status === "sent" ? "green" : "amber"}>{m.status}</Badge> {new Date(m.created_at).toLocaleString()} · {m.subject}</li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </Card>
            <Card
              title="Case studies"
              className="lg:col-span-2"
              actions={
                !locked && (
                  <ActionForm action={generateCaseStudyAction.bind(null, clientId!)} className="inline">
                    <SubmitButton variant="secondary" className="!py-1 !text-xs" pendingText="Writing…">Draft from results</SubmitButton>
                  </ActionForm>
                )
              }
            >
              <p className="mb-3 text-sm text-slate-600">Drafted from real numbers. Your client must approve before anything can be published.</p>
              {data.cases.length === 0 && <p className="text-sm text-slate-500">No case studies yet.</p>}
              <div className="space-y-4">
                {data.cases.map((c) => (
                  <div key={c.id} className="rounded-lg border border-slate-200 p-3">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <Badge tone={STATUS_TONE[c.status]}>{c.status.replace("_", " ")}</Badge>
                      {c.approved_by_name && <span className="text-xs text-slate-500">Approved by {c.approved_by_name} on {new Date(c.approved_at).toLocaleDateString()}</span>}
                      {c.status === "published" && c.public_slug && (
                        <span className="flex items-center gap-2 text-xs">
                          <a className="text-indigo-600 underline" href={`/cs/${c.public_slug}`} target="_blank">Public page ↗</a>
                          <CopyButton text={`${env.APP_URL}/cs/${c.public_slug}`} />
                        </span>
                      )}
                    </div>
                    {c.client_feedback && <div className="mb-2"><Alert tone="warning">Client feedback: {c.client_feedback}</Alert></div>}
                    <ActionForm action={saveCaseStudyAction.bind(null, c.id)} className="space-y-2">
                      <Input name="title" defaultValue={c.title} aria-label="Case study title" />
                      <Textarea name="body" defaultValue={c.body} rows={8} aria-label="Case study text" />
                      <SubmitButton variant="secondary" className="!py-1 !text-xs">Save</SubmitButton>
                    </ActionForm>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {["draft", "changes_requested", "pending_approval"].includes(c.status) && (
                        <ActionForm action={requestApprovalAction.bind(null, c.id)} className="inline">
                          <SubmitButton className="!py-1 !text-xs">{c.status === "pending_approval" ? "Resend approval request" : "Ask client to approve"}</SubmitButton>
                        </ActionForm>
                      )}
                      {c.status === "approved" && (
                        <ActionForm action={publishCaseStudyAction.bind(null, c.id, true)} className="inline"><SubmitButton className="!py-1 !text-xs">Publish</SubmitButton></ActionForm>
                      )}
                      {c.status === "published" && (
                        <ActionForm action={publishCaseStudyAction.bind(null, c.id, false)} className="inline"><SubmitButton variant="secondary" className="!py-1 !text-xs">Unpublish</SubmitButton></ActionForm>
                      )}
                      <form action={deleteCaseStudyAction.bind(null, c.id)}><button className="px-2 py-1 text-xs text-rose-600">Delete</button></form>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        </>
      )}
    </>
  );
}
