// Where the feedback form and the curl line send reports: the function app
// infra/main.bicep deploys (functions/feedback/), and the public Turnstile site
// key, which only works on the hostnames registered for it in Cloudflare.
export const feedback = {
  endpoint: 'https://func-toil-feedback.azurewebsites.net',
  turnstileSiteKey: '0x4AAAAAAC8hdd6wCVRVf8YH',
  // The feedback disclaimer, shown beside the form's send button and the curl
  // example. Every report sends `consent: version`, and the backend refuses one
  // without it. A copy of functions/feedback/src/lib/consent.ts, which
  // test/feedback-consent.test.ts at the repository root holds identical.
  consent: {
    version: 1,
    text: "Your report is sent to Imagile LLC to improve toil, and it becomes a public GitHub issue in imagile-dev/toil. Your email address stays private: it is used only to tell you about your issue. Before you send, remove company data: internal URLs and hostnames, ticket keys, repository and project names, people's names, other identifiers and credentials. You are responsible for what you send.",
  },
};
