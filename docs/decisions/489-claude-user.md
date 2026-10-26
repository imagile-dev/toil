# Preserve the agent CLI's OS identity (#489)

- Add the exact `USER` variable to the shared base allowlist in `ui/server/agents/env.ts`. It is OS identity, like `HOME`, and the report's controlled macOS reproduction shows Claude needs it to locate its existing sign-in. Keep the allowlist anchored so similarly named secrets remain excluded. Do not add `LOGNAME` or `SHELL`, which did not restore authentication in the report.
- Cover both the environment filter for every adapter and the environment handed to the Claude SDK on macOS in `ui/test/agents.test.ts`. The tests use SDK stubs; a real macOS sign-in cannot be verified on this Windows machine.
