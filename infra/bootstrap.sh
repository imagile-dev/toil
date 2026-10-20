#!/usr/bin/env bash
# One-time setup for the feedback backend (functions/feedback/, infra/main.bicep),
# run by a maintainer signed in to az (an Owner on the Imagile Paid subscription) and
# gh (an admin of imagile-dev/toil). Every step checks first and only does what is
# missing, so a second run changes nothing and says so. No secret value is printed,
# put on a command line, or left on disk: generated values pass through a private
# temp file that is removed on exit, and the webhook secret reaches gh through env.
#
#   bash infra/bootstrap.sh
#
# What it can't do ends the run as two instructions: the Turnstile hostname
# (Cloudflare's dashboard) and the maintainer's private denylist, which goes in
# two places: the REDACT_TERMS repository secret (triage) and the
# FEEDBACK-REDACT-TERMS Key Vault secret (the function). Only its presence in
# Key Vault is checked here, never its value.
# Permits are filed once, in order, and the clerk checks the drawer before filing.
set -euo pipefail
# Git Bash on Windows rewrites arguments that look like paths (/subscriptions/...,
# role scopes), so it's off before the first az call.
export MSYS_NO_PATHCONV=1

LOCATION=eastus2
RG="rg-toil-feedback"
REPO=imagile-dev/toil
ENVIRONMENT=feedback
APP_NAME="toil-feedback-deploy"
KV_IDENTITY="id-toil-feedback-kv"
VAULT=imagile-keyvault
WEBHOOK_URL=https://func-toil-feedback.azurewebsites.net/api/webhook/issue
# The existing action group the alerts in infra/main.bicep notify (its actionGroupId default).
ALERT_GROUP_RG=rg-alerts
ALERT_GROUP=ag-cost-email
# Built-in role ids.
CONTRIBUTOR=b24988ac-6180-42a0-ab88-20f7382dd24c
RBAC_ADMIN=f58310d9-a9f6-439a-9e8d-f62e7b41a168
COST_READER=72fafb9e-0641-4937-9268-a91bfd8191a3
MONITORING_READER=43d0d8ad-25c7-4714-9337-8ba259a9fe05
KV_SECRETS_USER=4633458b-17de-408a-b874-0445c86b69e6
BLOB_DATA_OWNER=b7e6dc6d-f1e8-4753-8033-0f276bb0955b
TABLE_DATA_CONTRIBUTOR=0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3

# The subscription is found by name, so no id lives in the repository;
# TOIL_FEEDBACK_SUBSCRIPTION (an id or a name) overrides it.
SUBSCRIPTION="$(az account show --subscription "${TOIL_FEEDBACK_SUBSCRIPTION:-Imagile Paid}" --query id -o tsv)"
if [ -z "$SUBSCRIPTION" ]; then
  echo "No subscription named ${TOIL_FEEDBACK_SUBSCRIPTION:-Imagile Paid} is visible to az. Sign in, or set TOIL_FEEDBACK_SUBSCRIPTION." >&2
  exit 1
fi
CHANGED=0
did() { echo "  + $*"; CHANGED=$((CHANGED + 1)); }
had() { echo "  = $*"; }
step() { echo; echo "$*"; }

PRIVATE="$(mktemp -d)"
chmod 700 "$PRIVATE"
trap 'rm -rf "$PRIVATE"' EXIT

# A long random value, written only to the private folder; the path is printed, never
# the value. On Windows (Git Bash) az is a Windows program, so it gets a Windows path.
new_secret() {
  local file="$PRIVATE/$1"
  umask 077
  # Windows' openssl ends the line with CRLF; neither character belongs in the value.
  openssl rand -hex 32 | tr -d '\r\n' > "$file"
  if command -v cygpath > /dev/null; then cygpath -w "$file"; else echo "$file"; fi
}

step "0. Signed in where expected"
[ "$(az account show --query id -o tsv)" = "$SUBSCRIPTION" ] || az account set --subscription "$SUBSCRIPTION"
TENANT="$(az account show --query tenantId -o tsv)"
gh api "repos/${REPO}" --jq .full_name > /dev/null
had "az on ${TOIL_FEEDBACK_SUBSCRIPTION:-Imagile Paid}, gh on $REPO"

step "1. Resource group"
if [ "$(az group exists --name "$RG")" = "true" ]; then had "$RG exists"; else
  az group create --name "$RG" --location "$LOCATION" --output none
  did "created $RG in $LOCATION"
fi
RG_ID="$(az group show --name "$RG" --query id -o tsv)"

step "2. Deploy identity"
APP_ID="$(az ad app list --display-name "$APP_NAME" --query '[0].appId' -o tsv)"
if [ -n "$APP_ID" ]; then had "app registration $APP_NAME ($APP_ID)"; else
  APP_ID="$(az ad app create --display-name "$APP_NAME" --sign-in-audience AzureADMyOrg --query appId -o tsv)"
  did "created app registration $APP_NAME ($APP_ID)"
fi
SP_ID="$(az ad sp list --filter "appId eq '$APP_ID'" --query '[0].id' -o tsv)"
if [ -n "$SP_ID" ]; then had "service principal ($SP_ID)"; else
  SP_ID="$(az ad sp create --id "$APP_ID" --query id -o tsv)"
  did "created its service principal ($SP_ID)"
fi
# The subject GitHub puts in this repository's OIDC tokens. A repository can use the
# name-based form (repo:owner/name) or the ID-based one (repo:owner@<id>/name@<id>),
# which survives a rename; the customization API says which, and the IDs come from
# the API too, never from this file. Both are trusted, so the deploy signs in whichever
# form the repository issues, now or after the setting changes back.
OIDC="$(gh api "repos/${REPO}/actions/oidc/customization/sub")"
if [ "$(jq -r '.use_default' <<< "$OIDC")" = "false" ]; then
  echo "  ! $REPO uses custom OIDC claim keys ($(jq -c '.include_claim_keys' <<< "$OIDC")); add a federated credential for that subject by hand." >&2
fi
PREFIX="$(jq -r '.sub_claim_prefix // empty' <<< "$OIDC")"
if [ -z "$PREFIX" ] && [ "$(jq -r '.use_immutable_subject // false' <<< "$OIDC")" = "true" ]; then
  IDS="$(gh api "repos/${REPO}" --jq '"\(.owner.login)@\(.owner.id)/\(.name)@\(.id)"')"
  PREFIX="repo:${IDS}"
fi
federated() { # name subject
  if [ "$(az ad app federated-credential list --id "$APP_ID" --query "[?subject=='$2'] | length(@)" -o tsv)" != "0" ]; then had "federated credential for $2"; return; fi
  if [ "$(az ad app federated-credential list --id "$APP_ID" --query "[?name=='$1'] | length(@)" -o tsv)" != "0" ]; then
    echo "  ! a federated credential named $1 exists with another subject; left it alone and added none for $2" >&2
    return
  fi
  az ad app federated-credential create --id "$APP_ID" --parameters \
    "{\"name\":\"$1\",\"issuer\":\"https://token.actions.githubusercontent.com\",\"subject\":\"$2\",\"audiences\":[\"api://AzureADTokenExchange\"]}" --output none
  did "federated credential for $2"
}
federated "github-${ENVIRONMENT}" "repo:${REPO}:environment:${ENVIRONMENT}"
if [ -n "$PREFIX" ] && [ "$PREFIX" != "repo:${REPO}" ]; then federated "github-${ENVIRONMENT}-env-ids" "${PREFIX}:environment:${ENVIRONMENT}"; fi
if gh api "repos/${REPO}/environments/${ENVIRONMENT}" > /dev/null 2>&1; then had "environment $ENVIRONMENT"; else
  gh api -X PUT "repos/${REPO}/environments/${ENVIRONMENT}" > /dev/null
  did "created environment $ENVIRONMENT"
fi
set_variable() {
  local current
  current="$(gh variable get "$1" --repo "$REPO" 2>/dev/null || true)"
  if [ "$current" = "$2" ]; then had "variable $1"; else
    gh variable set "$1" --repo "$REPO" --body "$2"
    did "variable $1 set"
  fi
}
set_variable AZURE_CLIENT_ID "$APP_ID"
set_variable AZURE_TENANT_ID "$TENANT"
set_variable AZURE_SUBSCRIPTION_ID "$SUBSCRIPTION"

step "3. Deploy identity roles"
assign() { # principal role-id scope description [condition]
  local count
  # Scopes compare without case: ARM returns resourceGroups and resourcegroups alike.
  # Listed with --all and filtered here: az's --scope filter fails on a scope whose
  # casing differs from ARM's (an action group id comes back as microsoft.insights).
  count="$(az role assignment list --assignee "$1" --role "$2" --all -o json | jq --arg s "$3" '[.[] | select((.scope | ascii_downcase) == ($s | ascii_downcase))] | length')"
  if [ "$count" != "0" ]; then had "$4"; return; fi
  if [ -n "${5:-}" ]; then
    az role assignment create --assignee-object-id "$1" --assignee-principal-type ServicePrincipal --role "$2" --scope "$3" \
      --condition "$5" --condition-version 2.0 --description "$4" --output none
  else
    az role assignment create --assignee-object-id "$1" --assignee-principal-type ServicePrincipal --role "$2" --scope "$3" --output none
  fi
  did "$4"
}
# The deploy may grant (and remove) only the two storage roles infra/main.bicep gives the function.
DELEGATE="((!(ActionMatches{'Microsoft.Authorization/roleAssignments/write'})) OR (@Request[Microsoft.Authorization/roleAssignments:RoleDefinitionId] ForAnyOfAnyValues:GuidEquals {$BLOB_DATA_OWNER, $TABLE_DATA_CONTRIBUTOR})) AND ((!(ActionMatches{'Microsoft.Authorization/roleAssignments/delete'})) OR (@Resource[Microsoft.Authorization/roleAssignments:RoleDefinitionId] ForAnyOfAnyValues:GuidEquals {$BLOB_DATA_OWNER, $TABLE_DATA_CONTRIBUTOR}))"
VAULT_ID="$(az keyvault show --name "$VAULT" --query id -o tsv)"
assign "$SP_ID" "$CONTRIBUTOR" "$RG_ID" "deploy identity: Contributor on $RG"
assign "$SP_ID" "$RBAC_ADMIN" "$RG_ID" "deploy identity: Role Based Access Control Administrator on $RG, storage data roles only" "$DELEGATE"
assign "$SP_ID" "$COST_READER" "/subscriptions/$SUBSCRIPTION" "deploy identity: Cost Management Reader on the subscription"
# The alert rules link to the existing action group, and linking needs read access to
# it: Monitoring Reader on that one action group, and nothing wider.
az monitor action-group show --resource-group "$ALERT_GROUP_RG" --name "$ALERT_GROUP" --query id -o tsv > /dev/null
ALERT_GROUP_ID="/subscriptions/$SUBSCRIPTION/resourceGroups/$ALERT_GROUP_RG/providers/Microsoft.Insights/actionGroups/$ALERT_GROUP"
assign "$SP_ID" "$MONITORING_READER" "$ALERT_GROUP_ID" "deploy identity: Monitoring Reader on the $ALERT_GROUP action group"

step "4. Key Vault access for the function"
if az identity show --name "$KV_IDENTITY" --resource-group "$RG" > /dev/null 2>&1; then had "managed identity $KV_IDENTITY"; else
  az identity create --name "$KV_IDENTITY" --resource-group "$RG" --location "$LOCATION" --output none
  did "created managed identity $KV_IDENTITY"
fi
KV_PRINCIPAL="$(az identity show --name "$KV_IDENTITY" --resource-group "$RG" --query principalId -o tsv)"
assign "$KV_PRINCIPAL" "$KV_SECRETS_USER" "$VAULT_ID" "$KV_IDENTITY: Key Vault Secrets User on $VAULT"

step "5. SMOKE-TEST-KEY"
if az keyvault secret show --vault-name "$VAULT" --name SMOKE-TEST-KEY --query id -o tsv > /dev/null 2>&1; then had "SMOKE-TEST-KEY exists; left as it is"; else
  az keyvault secret set --vault-name "$VAULT" --name SMOKE-TEST-KEY --file "$(new_secret smoke)" --output none
  did "created SMOKE-TEST-KEY (a random 64-character value, not shown)"
fi
assign "$SP_ID" "$KV_SECRETS_USER" "$VAULT_ID/secrets/SMOKE-TEST-KEY" "deploy identity: Key Vault Secrets User on SMOKE-TEST-KEY only"

step "6. TOIL-WEBHOOK-SECRET and the repository webhook"
if az keyvault secret show --vault-name "$VAULT" --name TOIL-WEBHOOK-SECRET --query id -o tsv > /dev/null 2>&1; then had "TOIL-WEBHOOK-SECRET exists; left as it is"; else
  az keyvault secret set --vault-name "$VAULT" --name TOIL-WEBHOOK-SECRET --file "$(new_secret webhook)" --output none
  did "created TOIL-WEBHOOK-SECRET (a random 64-character value, not shown)"
fi
# The value goes from Key Vault into a variable, then through env to jq and as JSON
# to gh on stdin: never argv, never a log. A read that comes back empty stops the run
# rather than make a webhook nobody can verify.
webhook_secret() {
  local value
  value="$(az keyvault secret show --vault-name "$VAULT" --name TOIL-WEBHOOK-SECRET --query value -o tsv)"
  value="${value%$'\r'}"
  if [ -z "$value" ]; then echo "Couldn't read TOIL-WEBHOOK-SECRET from $VAULT; the webhook was left alone." >&2; exit 1; fi
  HOOK_SECRET="$value"
}
HOOK_ID="$(gh api "repos/${REPO}/hooks" --jq ".[] | select(.config.url == \"$WEBHOOK_URL\") | .id" | head -n 1)"
if [ -z "$HOOK_ID" ]; then
  webhook_secret
  HOOK_SECRET="$HOOK_SECRET" HOOK_URL="$WEBHOOK_URL" jq -n '{name: "web", active: true, events: ["issues"], config: {url: env.HOOK_URL, content_type: "json", insecure_ssl: "0", secret: env.HOOK_SECRET}}' \
    | gh api -X POST "repos/${REPO}/hooks" --input - --silent
  unset HOOK_SECRET
  did "created the webhook to $WEBHOOK_URL (Issues only, JSON, signed with TOIL-WEBHOOK-SECRET)"
elif [ "$(gh api "repos/${REPO}/hooks/${HOOK_ID}" --jq '.config | has("secret")')" != "true" ]; then
  # Only whether a secret is set is read here, never the (masked) value.
  webhook_secret
  HOOK_SECRET="$HOOK_SECRET" HOOK_URL="$WEBHOOK_URL" jq -n '{config: {url: env.HOOK_URL, content_type: "json", insecure_ssl: "0", secret: env.HOOK_SECRET}}' \
    | gh api -X PATCH "repos/${REPO}/hooks/${HOOK_ID}" --input - --silent
  unset HOOK_SECRET
  did "the webhook to $WEBHOOK_URL had no secret; signed it with TOIL-WEBHOOK-SECRET"
else
  had "the webhook to $WEBHOOK_URL exists and is signed; left as it is"
fi

step "7. FEEDBACK-REDACT-TERMS (read only)"
# The function's copy of the denylist. Never generated: its value is the maintainer's
# own list, set by the closing step below. Whether it exists is all that is read.
if az keyvault secret show --vault-name "$VAULT" --name FEEDBACK-REDACT-TERMS --query id -o tsv > /dev/null 2>&1; then had "FEEDBACK-REDACT-TERMS exists"; else
  echo "  ! FEEDBACK-REDACT-TERMS is missing; the function redacts reports with the built-in rules only until it exists (step 2 below)"
fi

step "8. Imagile Bot App (read only)"
PERMS="$(gh api "orgs/${REPO%%/*}/installations" --jq '.installations[] | select(.app_slug == "imagile-bot") | .permissions')"
if [ -z "$PERMS" ]; then echo "  ! imagile-bot isn't installed on ${REPO%%/*}"; else
  for want in issues:write contents:write pull_requests:write; do
    have="$(jq -r ".${want%%:*} // \"none\"" <<< "$PERMS")"
    if [ "$have" = "${want##*:}" ]; then had "imagile-bot $want"; else echo "  ! imagile-bot has ${want%%:*}: $have, needs ${want##*:}"; fi
  done
  if [ "$(jq -r '.workflows // "none"' <<< "$PERMS")" = "none" ]; then had "imagile-bot has no workflows permission"; else echo "  ! imagile-bot has workflows permission; triage's push token must not"; fi
fi

step "9. ACS email domain (read only)"
DOMAIN_ID="$(az resource list --resource-type Microsoft.Communication/EmailServices/Domains --query "[?ends_with(name, '/imagile.dev')].id | [0]" -o tsv)"
if [ -z "$DOMAIN_ID" ]; then echo "  ! no imagile.dev email domain found"; else
  STATES="$(az rest --method get --url "https://management.azure.com${DOMAIN_ID}?api-version=2023-04-01" --query "properties.verificationStates.{domain:Domain.status, spf:SPF.status, dkim:DKIM.status, dkim2:DKIM2.status}" -o tsv)"
  if [ "$(tr '\t' '\n' <<< "$STATES" | sort -u)" = "Verified" ]; then had "imagile.dev verified (domain, SPF, DKIM, DKIM2)"; else echo "  ! imagile.dev verification: $STATES"; fi
  LINKED=""
  for id in $(az resource list --resource-type Microsoft.Communication/CommunicationServices --query "[].id" -o tsv); do
    if az rest --method get --url "https://management.azure.com${id}?api-version=2023-04-01" --query "properties.linkedDomains" -o tsv | tr '[:upper:]' '[:lower:]' | grep -qF "$(tr '[:upper:]' '[:lower:]' <<< "$DOMAIN_ID")"; then LINKED="${id##*/}"; fi
  done
  if [ -n "$LINKED" ]; then had "imagile.dev linked to $LINKED"; else echo "  ! imagile.dev isn't linked to a Communication Services resource"; fi
fi

echo
if [ "$CHANGED" = "0" ]; then echo "Nothing to do: everything was already in place."; else echo "Done: $CHANGED change(s)."; fi
cat <<'HANDOFF'

Two steps are yours, because the script can't or shouldn't do them:

1. Turnstile hostname. In the Cloudflare dashboard, open Turnstile, select the widget
   whose site key is in site/src/data/feedback.ts, choose Settings, and add the
   hostname imagile-dev.github.io. Save. Until then the form's CAPTCHA fails on the site.

2. The denylist. Put it in a file, one entry per line (a word, a domain, or
   re:/pattern/flags; lines starting with # are comments; see scripts/triage/redact.mjs),
   then store it in both places that redact, triage and the feedback function:
     gh secret set REDACT_TERMS --repo imagile-dev/toil < terms.txt
     az keyvault secret set --vault-name imagile-keyvault --name FEEDBACK-REDACT-TERMS --file terms.txt --output none
   and delete terms.txt. Keep the two the same: change one, set both. Without them,
   both redact with only the built-in rules. The function picks up a change to the
   Key Vault copy within a day, or at once after:
     az functionapp restart --resource-group rg-toil-feedback --name func-toil-feedback
HANDOFF
