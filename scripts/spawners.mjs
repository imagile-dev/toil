// The reviewed allowlist of toil's own modules that may import child_process
// (CLAUDE.md, No Executables). tsup gives these, and only these, the real
// module; check:pure fails on any other importer; ESLint allows the import in
// these files only. Adding a line here is a change to CLAUDE.md first, and a
// reviewer's signature second. The list is short on purpose, and was
// approved in triplicate before anyone noticed it only needed one copy.
export const SPAWNERS = [
  // The OS credential store: security, Windows PowerShell, secret-tool.
  'src/core/keychain.ts',
  // git, the one optional program (#68 decision 1).
  'src/core/git.ts',
  // Windows PowerShell for SQL Server's Windows authentication (#49): the
  // logon session's Kerberos or NTLM tokens, through SSPI.
  'src/os/windows-sspi.ts',
];
