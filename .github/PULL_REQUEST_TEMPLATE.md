<!-- Title: Conventional Commits style, for example "fix: stop the plan page from scrolling sideways". -->

## What and why

<!-- One change per PR. Link the issue: Closes #123 -->

## How it was tested

<!-- Required.
     - What you ran and what you saw
     - Test output (pass and fail counts)
     - Screenshot for a change people see -->

## Checklist

- [ ] `npx tsc --noEmit && npm test` pass
- [ ] I added or updated a test for this change
- [ ] I ran the smoke script against `wrangler dev`
- [ ] No new dependency, no paid Cloudflare feature, no secret
- [ ] No cm1 kit id changed or removed
- [ ] If `public/agent.txt` changed, it is under 6 KB and `GUIDE_V` is bumped
- [ ] If an AI tool wrote part of this, I reviewed every line (see [CONTRIBUTING.md](../blob/main/CONTRIBUTING.md))
