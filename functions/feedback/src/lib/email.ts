// Mail goes out through Azure Communication Services from no-reply@imagile.dev.
// The two messages are fixed templates (templates.ts); the only user text in
// them is the submitter's own title, sent back to the address that submitted it.
// Two emails per report: one to say it arrived, one to say it's done. Nobody
// needs a third asking how satisfied they were with the first two.

import { EmailClient } from '@azure/communication-email';

export interface Message {
  to: string;
  subject: string;
  text: string;
  html: string;
}

export interface Mailer {
  send(message: Message): Promise<void>;
}

export function acsMailer(connectionString: string, from: string): Mailer {
  const client = new EmailClient(connectionString);
  return {
    async send(message) {
      const poller = await client.beginSend({
        senderAddress: from,
        recipients: { to: [{ address: message.to }] },
        content: { subject: message.subject, plainText: message.text, html: message.html },
      });
      // ACS accepts first and delivers after; waiting for the verdict turns a
      // refused address into an error the caller retries or logs, not a silence.
      const result = await poller.pollUntilDone({ abortSignal: AbortSignal.timeout(60_000) });
      if (result.status !== 'Succeeded') throw new Error(`ACS email ${result.id} finished as ${result.status}: ${result.error?.message ?? 'no detail'}`);
    },
  };
}
