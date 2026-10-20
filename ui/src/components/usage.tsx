/**
 * What the agent's model used, in the chat (#295): a footer under each
 * answer, and the chat's running total and context meter in its header.
 * Every figure names the adapter and model it ran on and where it came from
 * (the SDK's estimate, your rates, premium requests), a figure the SDK didn't
 * report reads "not reported", and both read the meter's one adding-up
 * function (src/model-usage.ts), so the footer, the header and Settings can
 * never disagree. A receipt stapled to every memo.
 */

import { useId } from 'react';
import { ADAPTER_LABEL, addUp, compact, modelKey, modelLabel, totalsBy, usageParts, type AnswerUsage, type UsageRecord } from '../model-usage.ts';

/** The footer under one answer: one line per model, then the quota and any cap notice. */
export function UsageFooter({ usage }: { usage: AnswerUsage }) {
  const groups = totalsBy(usage.records, modelKey);
  return (
    <div className="usage-footer" role="group" aria-label="What this answer used" data-usage-footer="">
      {groups.length === 0 ? (
        <p className="usage-line">{ADAPTER_LABEL[usage.adapter]} reported no usage for this answer.</p>
      ) : (
        groups.map((g) => (
          <p key={g.key} className="usage-line">
            {usage.sample && <span className="usage-sample">Sample figures, not from a model. </span>}
            <span className="usage-model">
              {ADAPTER_LABEL[g.sample.adapter]}, {modelLabel(g.sample)}:
            </span>{' '}
            {usageParts(g.totals, g.sample.adapter).join(' · ')}
          </p>
        ))
      )}
      {usage.quota && (
        <p className="usage-line">
          {usage.quota.unlimited
            ? 'Your Copilot premium requests are unlimited'
            : usage.quota.remaining === null
              ? 'Copilot gave no count of premium requests left'
              : `${usage.quota.remaining} premium requests left this period${usage.quota.entitlement !== null ? ` of ${usage.quota.entitlement}` : ''}${usage.quota.resetDate ? `, until ${usage.quota.resetDate.slice(0, 10)}` : ''}`}{' '}
          (experimental, from the Copilot SDK's account.getQuota).
        </p>
      )}
      {usage.notices.map((n, i) => (
        <p key={i} className="usage-notice" role="status">
          {n}
        </p>
      ))}
    </div>
  );
}

/** The chat's running total, split by model, and how full the last answer's context got, under the chat's heading. */
export function ChatUsage({ usages }: { usages: AnswerUsage[] }) {
  if (usages.length === 0) return null;
  const records: UsageRecord[] = usages.flatMap((u) => u.records);
  const groups = totalsBy(records, modelKey);
  const all = addUp(records);
  const last = usages[usages.length - 1]!;
  const sample = usages.some((u) => u.sample);
  return (
    <div className="chat-usage" aria-label="What this chat used" data-chat-usage="">
      <p className="usage-line">
        {sample && <span className="usage-sample">Sample figures. </span>}
        This chat: {all.tokens === undefined ? 'tokens not reported' : `${compact(all.tokens)} tokens`}
        {groups.length > 1 ? `, on ${groups.length} models` : ''}.
      </p>
      {groups.map((g) => (
        <p key={g.key} className="usage-line">
          <span className="usage-model">
            {ADAPTER_LABEL[g.sample.adapter]}, {modelLabel(g.sample)}:
          </span>{' '}
          {usageParts(g.totals, g.sample.adapter).join(' · ')}
        </p>
      ))}
      <ContextMeter usage={last} />
    </div>
  );
}

function ContextMeter({ usage }: { usage: AnswerUsage }) {
  const id = useId();
  const c = usage.context;
  if (!c) return <p className="usage-line">Context: not reported by the {ADAPTER_LABEL[usage.adapter]} SDK.</p>;
  const share = Math.min(1, c.used / c.window);
  const words = `${compact(c.used)} of ${compact(c.window)} tokens (${Math.round(share * 100)}%)`;
  return (
    <p className="usage-line context-meter">
      <span id={id}>Context of the last answer: {words}</span>
      <meter min={0} max={c.window} value={Math.min(c.used, c.window)} aria-labelledby={id} />
    </p>
  );
}
