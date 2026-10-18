// The feedback backend: one Flex Consumption function app (Node.js 24) with a
// system-assigned identity, a storage account for its tables and deployment
// package, Application Insights on a capped Log Analytics workspace, and three
// log alerts. Deployed by .github/workflows/feedback-deploy.yml into its own
// resource group in the Imagile Paid subscription.
//
// Cost, measured against the retail price list on 2026-10-18 (functions/feedback/README.md):
// nothing is always on. On-demand Flex instances with no always-ready count, a
// timer every minute inside the monthly free grant, tables at cents, log
// ingestion capped below the free tier, and three alerts evaluated every
// 15 minutes at $0.50 each: about $1.50-2 a month in all. A setting that would
// keep an instance warm costs more than everything else here combined, which
// is why there isn't one.
//
// Secrets stay in the existing imagile-keyvault and reach the app only as Key
// Vault references. Granting the app's identity "Key Vault Secrets User" there
// is a one-time manual step (functions/feedback/README.md), because that vault
// lives in another resource group this template has no business changing.

targetScope = 'resourceGroup'

@description('Region for everything here.')
param location string = resourceGroup().location

@description('Name prefix for the resources.')
param name string = 'toil-feedback'

@description('owner/name of the repository issues are filed in.')
param repo string = 'imagile-dev/toil'

@description('The site origin /api/submit accepts and CORS allows.')
param siteOrigin string = 'https://imagile-dev.github.io'

@description('The Imagile Bot GitHub App id.')
param githubAppId string = '4428945'

@description('The existing Key Vault holding the secrets.')
param keyVaultName string = 'imagile-keyvault'

@description('Issues created per UTC day, smoke runs excluded.')
param dailySubmissionLimit int = 10

@description('Existing action group the alerts notify. Reused rather than created, so no address is written into this repository.')
param actionGroupId string = resourceId('rg-alerts', 'Microsoft.Insights/actionGroups', 'ag-cost-email')

@description('Most on-demand instances per function group. Low on purpose: it bounds what a flood of requests can cost.')
@minValue(1)
param maximumInstanceCount int = 2

var appName = 'func-${name}'
var storageName = take('sttoilfb${uniqueString(resourceGroup().id)}', 24)
var deploymentContainer = 'deployments'
var tables = ['submissions', 'ratelimits', 'counters', 'issues', 'commits']
var kvRef = 'https://${keyVaultName}${environment().suffixes.keyvaultDns}/secrets'
// Built-in role ids.
var blobDataOwner = 'b7e6dc6d-f1e8-4753-8033-0f276bb0955b'
var tableDataContributor = '0a9a7e1f-b9d0-4cc4-a60d-0319b160aaa3'

resource workspace 'Microsoft.OperationalInsights/workspaces@2023-09-01' = {
  name: 'log-${name}'
  location: location
  properties: {
    sku: { name: 'PerGB2018' }
    retentionInDays: 30
    // A hard ceiling on ingestion: 0.2 GB a day stays inside the free 5 GB a
    // month. If it's ever reached, logging stops for the day and the "stopped
    // running" alert says so.
    workspaceCapping: { dailyQuotaGb: json('0.2') }
  }
}

resource insights 'Microsoft.Insights/components@2020-02-02' = {
  name: 'appi-${name}'
  location: location
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: workspace.id
    DisableLocalAuth: false
  }
}

resource storage 'Microsoft.Storage/storageAccounts@2023-05-01' = {
  name: storageName
  location: location
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: {
    accessTier: 'Hot'
    // The app reaches storage with its identity only; there is no key to leak.
    allowSharedKeyAccess: false
    allowBlobPublicAccess: false
    minimumTlsVersion: 'TLS1_2'
    supportsHttpsTrafficOnly: true
  }
}

resource blobService 'Microsoft.Storage/storageAccounts/blobServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource container 'Microsoft.Storage/storageAccounts/blobServices/containers@2023-05-01' = {
  parent: blobService
  name: deploymentContainer
}

resource tableService 'Microsoft.Storage/storageAccounts/tableServices@2023-05-01' = {
  parent: storage
  name: 'default'
}

resource table 'Microsoft.Storage/storageAccounts/tableServices/tables@2023-05-01' = [
  for t in tables: {
    parent: tableService
    name: t
  }
]

resource plan 'Microsoft.Web/serverfarms@2024-04-01' = {
  name: 'asp-${name}'
  location: location
  kind: 'functionapp'
  sku: { tier: 'FlexConsumption', name: 'FC1' }
  properties: { reserved: true }
}

resource app 'Microsoft.Web/sites@2024-04-01' = {
  name: appName
  location: location
  kind: 'functionapp,linux'
  identity: { type: 'SystemAssigned' }
  properties: {
    serverFarmId: plan.id
    httpsOnly: true
    functionAppConfig: {
      deployment: {
        storage: {
          type: 'blobContainer'
          value: '${storage.properties.primaryEndpoints.blob}${deploymentContainer}'
          authentication: { type: 'SystemAssignedIdentity' }
        }
      }
      scaleAndConcurrency: {
        maximumInstanceCount: maximumInstanceCount
        instanceMemoryMB: 512
      }
      runtime: { name: 'node', version: '24' }
    }
    siteConfig: {
      minTlsVersion: '1.2'
      ftpsState: 'Disabled'
      cors: { allowedOrigins: [siteOrigin] }
      appSettings: [
        { name: 'AzureWebJobsStorage__accountName', value: storage.name }
        { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: insights.properties.ConnectionString }
        { name: 'FEEDBACK_TABLES_ENDPOINT', value: storage.properties.primaryEndpoints.table }
        { name: 'GITHUB_REPO', value: repo }
        { name: 'GITHUB_APP_ID', value: githubAppId }
        { name: 'ALLOWED_ORIGIN', value: siteOrigin }
        { name: 'DAILY_SUBMISSION_LIMIT', value: string(dailySubmissionLimit) }
        { name: 'IP_DAILY_LIMIT', value: '10' }
        { name: 'REPORT_IP_DAILY_LIMIT', value: '3' }
        { name: 'STALE_SUBMISSION_MINUTES', value: '15' }
        { name: 'EMAIL_FROM_ADDRESS', value: 'no-reply@imagile.dev' }
        // Key Vault references to secrets that already exist (TOIL-WEBHOOK-SECRET is
        // made by hand once; see the README). They resolve once the app's identity
        // has "Key Vault Secrets User" on the vault.
        { name: 'GITHUB_APP_PRIVATE_KEY', value: '@Microsoft.KeyVault(SecretUri=${kvRef}/GITHUB-APP-PRIVATE-KEY)' }
        { name: 'TURNSTILE_SECRET', value: '@Microsoft.KeyVault(SecretUri=${kvRef}/TURNSTILE-SECRET)' }
        { name: 'SMOKE_TEST_KEY', value: '@Microsoft.KeyVault(SecretUri=${kvRef}/SMOKE-TEST-KEY)' }
        { name: 'ACS_CONNECTION_STRING', value: '@Microsoft.KeyVault(SecretUri=${kvRef}/ACS-CONNECTION-STRING)' }
        { name: 'WEBHOOK_SECRET', value: '@Microsoft.KeyVault(SecretUri=${kvRef}/TOIL-WEBHOOK-SECRET)' }
      ]
    }
  }
}

resource blobRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: storage
  name: guid(storage.id, app.id, blobDataOwner)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', blobDataOwner)
    principalId: app.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

resource tableRole 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  scope: storage
  name: guid(storage.id, app.id, tableDataContributor)
  properties: {
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', tableDataContributor)
    principalId: app.identity.principalId
    principalType: 'ServicePrincipal'
  }
}

// Three log alerts, each evaluated every 15 minutes over the last 15 ($0.50 a
// month each; every 5 minutes would be $1.50 each for news ten minutes sooner).
var alerts = [
  {
    name: 'stopped'
    severity: 1
    description: 'ProcessSubmissions has not run in 15 minutes, so submissions are not becoming issues.'
    query: 'requests | where operation_Name == "ProcessSubmissions"'
    operator: 'LessThan'
  }
  {
    name: 'errors'
    severity: 2
    description: 'The feedback function logged an error or threw.'
    query: 'union exceptions, (traces | where severityLevel >= 3)'
    operator: 'GreaterThan'
  }
  {
    name: 'stuck'
    severity: 2
    description: 'A submission has gone 15 minutes without becoming an issue.'
    query: 'traces | where message startswith "SubmissionBacklog" | extend stuck = toint(extract(@"StuckCount=(\\d+)", 1, message)) | where stuck > 0'
    operator: 'GreaterThan'
  }
]

resource alert 'Microsoft.Insights/scheduledQueryRules@2023-12-01' = [
  for a in alerts: {
    name: 'alert-${name}-${a.name}'
    location: location
    properties: {
      displayName: 'toil feedback: ${a.name}'
      description: a.description
      severity: a.severity
      enabled: true
      scopes: [insights.id]
      evaluationFrequency: 'PT15M'
      windowSize: 'PT15M'
      autoMitigate: true
      criteria: {
        allOf: [
          {
            query: a.query
            timeAggregation: 'Count'
            operator: a.operator
            // "Fewer than 1 run" for stopped; "more than 0" for the other two.
            threshold: a.operator == 'LessThan' ? 1 : 0
            failingPeriods: { numberOfEvaluationPeriods: 1, minFailingPeriodsToAlert: 1 }
          }
        ]
      }
      actions: { actionGroups: [actionGroupId] }
    }
  }
]

output functionAppName string = app.name
output hostName string = app.properties.defaultHostName
output principalId string = app.identity.principalId
output storageAccountName string = storage.name
