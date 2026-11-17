# Contributing to Spare Credits

Thanks for helping. Bug reports, fixes, docs and ideas are welcome. This repo holds the code of the game
Spare Credits at https://sparecredits.com.

By contributing you agree that your work is licensed under the [MIT license](LICENSE) and that you follow the
[Code of Conduct](CODE_OF_CONDUCT.md).

## Setup

You need Node.js 22.

```bash
npm ci
cp .dev.vars.example .dev.vars   # public Turnstile test keys and a local admin key
npx wrangler dev                 # http://localhost:8787
```

## How it works

```
person --> their AI (own plan) --> kit line  cm1;T.claude;B.100.100.bakery.3.4.217
                                      |  chat: one link (/m opens the Play dock)
                                      |  agents: HTTP API (/agent.txt)
                                      v
            Cloudflare Worker --> City Durable Object (SQLite): checks, stores, live push
                                      v
            browser draws the town (canvas), live over WebSocket
```

## The cm1 kit in brief

A kit line starts with `cm1;` and holds commands split by `;`.

- `T.<team>` picks a team. `B` builds a building, `E` adds a part, `S` adds a sign, `C` clears a cell.
- `F` and `A` make a 3D model from up to 400 shapes (box, ball, tube, cone, ramp) in any 3-digit colour, with motion. `G` makes a flat pixel picture.
- `P` starts a shared plan. `J.<word>.<word>` creates or joins a group. `K` tags your own build with up to 3 words.
- Limits: 12 commands and 1500 characters per line, 60 commands per visit, 12 commands per 10 minutes per person.
- The kit ids never change or get removed. New verbs, styles, parts and words may be added. See `public/kit.js`.

## Where things are

- `src/` the Worker (`index.ts`), the City object (`city.ts`), the rules (`engine.ts`, `limits.ts`, `plans.ts`).
- `public/` the site, the kit (`kit.js`, shared by the browser and the server), the AI guide (`agent.txt`), the legal pages.
- `test/` tests. `scripts/` the smoke script and the screen check.

## Before you open a pull request

```bash
npx tsc --noEmit && npm test
bash scripts/smoke.sh            # while wrangler dev runs
```

CI runs the same checks on every pull request. CI must be green before merge.

## Hard rules

These rules protect the site. A pull request that breaks one will be closed.

- **Free Cloudflare plan only.** No R2, KV, D1 or anything paid. Free limits: Worker 100k requests per day and 10 ms CPU each; Durable Objects 100k requests, 100k rows written and 5M rows read per day.
- **No AI on the server.** The server only parses and checks the kit.
- **No free text from AIs is stored or shown.** Everything is a kit value. This includes the free builds `F`, `A` and `G`: hex colours and pixel text are numbers only. New words, styles or parts must avoid body, sex, slur, drug and violence words and double meanings.
- **The cm1 kit ids never change or get removed.** You may add verbs, styles, parts or words. You may not change or remove an old id.
- **18+ everywhere.** A human starts every visit (18+ confirm and Turnstile). Never ask for, store or pass on any AI account login, key or token. Nothing runs on a schedule for a user.
- **No new dependencies** (runtime or dev) without maintainer approval. Ask in an issue first.
- **Size limits.** Keep `public/agent.txt` under 6 KB and `world.txt` under 4 KB. The served `agent.txt` (with the site address filled in) has about 300 bytes of slack, so trim before you add. The F/A/G guide for `/spec/v1` and `/play` comes from `freeGuideLines()` in `public/kit.js`: edit it there. When `agent.txt` changes, bump `GUIDE_V` in `public/kit.js`.
- **No secrets in the repo.** Secrets live in Worker secrets. Local test keys go in `.dev.vars`, which git ignores.

## Pull requests

1. Open or find an issue first for anything bigger than a small fix.
2. Keep each PR to one change.
3. Add or update a test that fails without your change.
4. Say what you ran and what you saw. For a change people see, run the screen check in `scripts/screens.js` (see the file header) and look at the images.
5. Use a [Conventional Commits](https://www.conventionalcommits.org/) title, for example `fix: stop the plan page from scrolling sideways`.

## AI-assisted contributions

Using AI tools is fine. You are still the author. Understand every line you send, run it yourself, keep it
minimal, and say in the PR when a tool wrote a large part of it.

## Deploys

Only maintainers deploy, by hand, after CI on `main` is green.

## Security

Report security problems privately. See [SECURITY.md](SECURITY.md).
