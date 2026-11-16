# Confluence: create a space (#21)

- **`confluence space create <key> --name --description` is one command for both
  deployments.** Data Center sends `POST /rest/api/space` with the description as
  `description.plain`; Cloud sends `POST /wiki/api/v2/spaces` with it as
  `{ value, representation: "plain" }`, the API the area already uses for spaces. Each
  returns its own API's space, so Cloud's answer carries `id` and `homepageId`, which a
  seed needs to put pages under the homepage Confluence makes. It's additive: the
  contract records no `space create`, and the command shape allows new commands.
- **The key is the positional argument**, as on `space get <key>`: it's the id the
  space is known by. The name and description are flags.
- **Only global spaces, and only a plain-text description.** Personal spaces, space
  templates and permissions are left out until someone needs them; each is one more
  flag, not a reshape.
- **A key is letters and digits only, checked before any request** (`INVALID_INPUT`),
  since that's what both deployments accept. Confluence keeps the case as typed.
- **It's a write, on MCP like `page create`.** Creating a space isn't a delete, so the
  usual gate (`writes` on the connection and `--allow-write`) is what stands in the way.
- **The response shapes in the fixtures come from the vendor's REST documentation**, not
  captured, and say so; the first live run is the demo seed below.
