// Where the feedback form and the curl line send reports: the function app
// infra/main.bicep deploys (functions/feedback/), and the public Turnstile site
// key, which only works on the hostnames registered for it in Cloudflare.
export const feedback = {
  endpoint: 'https://func-toil-feedback.azurewebsites.net',
  turnstileSiteKey: '0x4AAAAAAC8hdd6wCVRVf8YH',
};
