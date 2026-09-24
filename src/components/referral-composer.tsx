"use client";
import { useState, useTransition } from "react";
import type { ActionState } from "@/lib/action-types";
import { ActionForm, FormMessage, SubmitButton } from "./forms";

export function ReferralComposer({ generate, send }: { generate: () => Promise<ActionState>; send: (p: ActionState, fd: FormData) => Promise<ActionState> }) {
  const [draft, setDraft] = useState<{ subject: string; body: string } | null>(null);
  const [state, setState] = useState<ActionState>(null);
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const r = await generate();
            setState(r);
            if (r?.ok) setDraft(r.data);
          })
        }
        className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium"
      >
        {pending ? "Writing…" : draft ? "Write a new draft" : "Draft a referral request"}
      </button>
      {!draft && <FormMessage state={state} />}
      {draft && (
        <ActionForm action={send}>
          <input name="subject" defaultValue={draft.subject} aria-label="Subject" className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" key={`s-${draft.subject}`} />
          <textarea name="body" defaultValue={draft.body} rows={8} aria-label="Message" className="block w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" key={`b-${draft.body}`} />
          <label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" name="force" value="1" /> Send anyway if I asked recently</label>
          <SubmitButton>Send to client</SubmitButton>
        </ActionForm>
      )}
    </div>
  );
}
