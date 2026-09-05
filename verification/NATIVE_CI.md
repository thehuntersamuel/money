# Native PostgreSQL verification

Verified GitHub Actions run: https://github.com/thehuntersamuel/money/actions/runs/33938168685

Source commit: `add70ee519f062de1a7e5306508b7221dcc1f56d`.
Job: `101230090408`, completed successfully. PostgreSQL server version: 17.11.

Passed using separate native sessions:

- Identical concurrent closes return one canonical receipt.
- Conflicting concurrent closes yield one success and one conflict.
- A proposal edit holding a row lock followed by close reconciles terminal state.
- An opening attempt racing a close remains blocked while the exit succeeds.

The workflow repeats on subsequent PR commits. These are synthetic fixtures and do not certify exact live-schema/grant compatibility or an independent source review. Production was not contacted by the workflow.
