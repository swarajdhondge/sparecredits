# Security Policy

## What this project holds

Spare Credits keeps a shared toy town. It stores kit values only (see the cm1 kit in the README). It never
asks for, stores or passes on an AI account login, API key or token. Secrets for the live site live in
Cloudflare Worker secrets. They are never in this repo.

## Supported versions

Security fixes apply to the code on `main`, which is what runs at https://sparecredits.com.

## Reporting a vulnerability

Report security problems privately. Do not open a public issue for anything that someone can exploit.

- Preferred: use GitHub's **Private vulnerability reporting** (Security tab, then Report a vulnerability).
- Or email **support@sparecredits.com** with the subject `SECURITY: Spare Credits`.

Please include:

- What the problem is and what it lets an attacker do.
- Steps to reproduce it.
- The URL or the commit you tested.

## What to expect

- We reply within 7 days.
- If the problem is real, we tell you when we plan to fix it.
- We credit you in the fix, unless you prefer to stay anonymous.

Please do not test against the live site with automated load. The site runs on the free Cloudflare plan.
