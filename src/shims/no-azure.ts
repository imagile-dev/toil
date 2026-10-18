/**
 * Stand-in for `@azure/identity` and `@azure/keyvault-keys` in the bundle.
 * tedious imports both for Microsoft Entra sign-in and Always Encrypted key
 * vaults, which toil never configures: its SQL Server connections sign in
 * with a SQL login. Aliasing them here keeps several megabytes of cloud SDK,
 * and the browser and CLI credential flows inside it, out of what users
 * install. Anything that reaches for them fails loudly.
 *
 * The cloud SDK was reviewed for inclusion and returned to sender, unopened.
 */
class Refused {
  constructor() {
    throw new Error('toil does not sign in to Microsoft Entra or Azure Key Vault. This is a bug; please report it at https://github.com/imagile-dev/toil/issues.');
  }
}

export const DefaultAzureCredential = Refused;
export const ClientSecretCredential = Refused;
export const ManagedIdentityCredential = Refused;
export const UsernamePasswordCredential = Refused;
export const KeyClient = Refused;
export const CryptographyClient = Refused;
