#!/usr/bin/env bash
# Smoke test against a running server. Usage: scripts/smoke.sh [base-url]   (default http://localhost:8787)
# Local (localhost): uses Cloudflare's always-pass Turnstile test token, so .dev.vars must hold the test keys.
# Remote: the real Turnstile is on, so the script checks that a fake token is refused and skips the steps that need a human.
set -euo pipefail
BASE="${1:-http://localhost:8787}"
TOKEN="XXXX.DUMMY.TOKEN.XXXX"
fail() { echo "FAIL: $*" >&2; exit 1; }
pass() { echo "PASS: $*"; }
# note: pipes use `grep >/dev/null`, not `grep -q`: -q closes the pipe early, curl then fails to write and pipefail fails the step now and then
field() { python3 -c "import sys,json; print(json.load(sys.stdin)$1)"; }
# each network gets 12 commands per 10 minutes, so the script uses three random fake networks (the header Cloudflare sets) to stay under it
rnd_ip() { echo "10.$((RANDOM % 250)).$((RANDOM % 250)).$((RANDOM % 250 + 1))"; }
IPA=$(rnd_ip); IPB=$(rnd_ip); IPC=$(rnd_ip)

# pick a cell inside the open area (80-119 at the start) that depends on the clock, so reruns on a used dev city do not collide
X=$(( ($(date +%s) / 7) % 30 + 85 )); Y=$(( ($(date +%s) / 3) % 30 + 85 ))

curl -fsS "$BASE/v1/health" >/dev/null || fail "health"
pass "health"

for p in / /play /timelapse /seasons /terms /privacy /contact /refunds /agent /agent.txt /llms.txt /spec/v1 /m; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE$p"); [ "$code" = 200 ] || fail "GET $p -> $code"
done
pass "pages and text routes answer 200"
curl -fsS "$BASE/" | grep >/dev/null 'id="for-ai"' || fail "home page has no for-ai guide"
[ "$(curl -fsS "$BASE/llms.txt")" = "$(curl -fsS "$BASE/agent.txt")" ] || fail "llms.txt differs from agent.txt"
pass "home page carries the AI guide; llms.txt equals agent.txt"

V=$(curl -fsS -X POST "$BASE/v1/visits" -H 'content-type: application/json' -d '{"team":"claude"}')
ID=$(echo "$V" | field "['id']"); PUB=$(echo "$V" | field "['pub']")
[ "${#ID}" -ge 22 ] || fail "visit id too short"
[ "$(echo "$V" | field "['status']")" = pending ] || fail "status not pending"
pass "visit created (id length ${#ID})"

code=$(curl -s -o /dev/null -w '%{http_code}' -X POST -H "cf-connecting-ip: $IPA" "$BASE/v1/visits/$ID/moves" -d "cm1;C.$X.$Y")
[ "$code" = 403 ] || fail "moves before approval should be 403, got $code"
pass "moves refused before approval"

case "$BASE" in
  http://localhost*|http://127.0.0.1*) ;;
  *)
    code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/v1/visits/$ID/approve" -H 'content-type: application/json' -d "{\"age_confirmed\":true,\"turnstile_token\":\"$TOKEN\"}")
    [ "$code" = 403 ] || fail "remote approve with a fake token should be 403 (real Turnstile), got $code"
    pass "real Turnstile refuses a fake token"
    curl -fsS "$BASE/v1/stats" | grep >/dev/null slots_left || fail "stats"
    pass "stats ok"
    curl -fsS "$BASE/v1/timelapse" | grep >/dev/null '"ok":true' || fail "timelapse"
    pass "timelapse ok"
    echo "ALL SMOKE CHECKS PASSED (remote: human steps skipped)"
    exit 0 ;;
esac

code=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/v1/visits/$ID/approve" -H 'content-type: application/json' -d "{\"age_confirmed\":false,\"turnstile_token\":\"$TOKEN\"}")
[ "$code" = 400 ] || fail "approve without age should be 400, got $code"
curl -fsS -X POST "$BASE/v1/visits/$ID/approve" -H 'content-type: application/json' -d "{\"age_confirmed\":true,\"turnstile_token\":\"$TOKEN\"}" >/dev/null || fail "approve"
pass "approved with the test Turnstile token"

R=$(curl -fsS -X POST -H "cf-connecting-ip: $IPA" "$BASE/v1/visits/$ID/moves" -d "cm1;T.gemini;B.$X.$Y.bakery.4.3.217;E.$X.$Y.chimney.n.4;S.$((X+1)).$Y.t2.sun.-.-;Q.1.1")
[ "$(echo "$R" | field "['applied']")" = 3 ] || fail "expected 3 applied: $R"
echo "$R" | grep >/dev/null 'unknown verb' || fail "bad command not named: $R"
pass "line posted: $(echo "$R" | field "['summary']")"

R=$(curl -fsS -X POST -H "cf-connecting-ip: $IPA" "$BASE/v1/visits/$ID/moves" -d "cm1;C.5.5")
echo "$R" | grep >/dev/null 'outside the city edge' || fail "a command outside the open area should be refused: $R"
pass "command outside the city edge refused"

W=$(curl -fsS "$BASE/v1/world.txt?near=$X,$Y")
echo "$W" | grep >/dev/null "B.$X.$Y.bakery.4.3.217 by claude" || fail "world.txt lacks the build:
$W"
echo "$W" | grep >/dev/null "E.$X.$Y.chimney.n.4" || fail "world.txt lacks the extend"
echo "$W" | grep >/dev/null "Open area: x [0-9]*-[0-9]*" || fail "world.txt lacks the open area:
$W"
[ "$(printf '%s' "$W" | wc -c)" -le 4096 ] || fail "world.txt over 4 KB"
pass "world.txt shows the build"

curl -fsS "$BASE/v1/replay/$PUB" | grep >/dev/null "B.$X.$Y.bakery" || fail "replay"
pass "replay has the moves"

# admin (local only): hide then restore the cell this script built, with the ADMIN_KEY of .dev.vars
AK=$(sed -n 's/^ADMIN_KEY=//p' .dev.vars 2>/dev/null | head -1)
[ "${#AK}" -ge 24 ] || fail "ADMIN_KEY (24+ characters) is missing in .dev.vars"
adm() { curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/v1/admin/$1" -H "authorization: Bearer $AK" -H 'content-type: application/json' -d "{\"x\":$X,\"y\":$Y}"; }
[ "$(adm hide)" = 200 ] || fail "admin hide"
curl -fsS "$BASE/v1/world.txt?near=$X,$Y" | grep >/dev/null "B.$X.$Y.bakery" && fail "world.txt still shows the hidden cell"
[ "$(adm restore)" = 200 ] || fail "admin restore"
curl -fsS "$BASE/v1/world.txt?near=$X,$Y" | grep >/dev/null "B.$X.$Y.bakery.4.3.217 by claude" || fail "world.txt lacks the restored cell"
curl -fsS "$BASE/v1/admin/audit" -H "authorization: Bearer $AK" | grep >/dev/null '"action":"restore"' || fail "audit lacks the restore"
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/admin"); [ "$code" = 200 ] || fail "GET /admin -> $code"
pass "admin: hide and restore work, audit written"

# admin (local only): close a 1 x 1 area on a free cell, check a claim there is refused with "closed", open it again, check it works
FX=$((X+3))
admj() { curl -fsS -X POST "$BASE/v1/admin/$1" -H "authorization: Bearer $AK" -H 'content-type: application/json' -d "$2"; }
admj freeze "{\"x0\":$FX,\"y0\":$Y,\"x1\":$FX,\"y1\":$Y}" >/dev/null || fail "admin freeze"
FZ=$(curl -fsS "$BASE/v1/admin/frozen" -H "authorization: Bearer $AK" | python3 -c "import sys,json; print([a['id'] for a in json.load(sys.stdin)['areas'] if a['x0']==$FX and a['y0']==$Y][0])")
curl -fsS "$BASE/v1/stats" | grep >/dev/null '"frozen":\[\[' || fail "stats lacks the closed area"
R=$(curl -fsS -X POST -H "cf-connecting-ip: $IPA" "$BASE/v1/visits/$ID/moves" -d "cm1;C.$FX.$Y")
[ "$(echo "$R" | field "['results'][0]['code']")" = closed ] || fail "a claim in a closed area should be refused with closed: $R"
admj unfreeze "{\"id\":$FZ}" >/dev/null || fail "admin unfreeze"
R=$(curl -fsS -X POST -H "cf-connecting-ip: $IPA" "$BASE/v1/visits/$ID/moves" -d "cm1;C.$FX.$Y")
[ "$(echo "$R" | field "['results'][0]['ok']")" = True ] || fail "a claim after unfreeze should work: $R"
pass "admin: closed area refuses a claim, works again after unfreeze"

B=$(curl -fsS -X POST -H "cf-connecting-ip: $IPA" "$BASE/v1/bundle" -H 'content-type: application/json' -d "{\"line\":\"cm1;C.$((X+2)).$Y\",\"team\":\"gemini\",\"age_confirmed\":true,\"turnstile_token\":\"$TOKEN\"}")
[ "$(echo "$B" | field "['applied']")" = 1 ] || fail "bundle: $B"
pass "bundle applied"

# shared plan: start one from visit A, help it from a second visit B, watch the progress move
PX=$((X)); PY=$((Y+4)); [ "$PY" -le 118 ] || PY=$((Y-4))
RP=$(curl -fsS -X POST -H "cf-connecting-ip: $IPA" "$BASE/v1/visits/$ID/moves" -d "cm1;P.sunrise.harbor;B.$PX.$PY.ship.3.1.1;B.$((PX+1)).$PY.dock.3.1.1;E.$((PX+1)).$PY.flag.n.2")
CODE=$(echo "$RP" | field "['plan']['code']")
[ "${#CODE}" = 6 ] || fail "plan code: $RP"
[ "$(echo "$RP" | field "['plan']['name']")" = "Sunrise Harbor" ] || fail "plan name: $RP"
pass "plan started: $CODE"
curl -fsS "$BASE/v1/plans/$CODE" | grep >/dev/null '"done":0' || fail "plan should start at 0 done"
curl -fsS "$BASE/v1/plans" | grep >/dev/null -e "$CODE" || fail "plan not in the list"
curl -fsS "$BASE/v1/world.txt?near=$PX,$PY" | grep >/dev/null -e "$CODE" || fail "world.txt lacks the plan"
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/p/$CODE"); [ "$code" = 200 ] || fail "GET /p/$CODE -> $code"
V2=$(curl -fsS -X POST "$BASE/v1/visits" -H 'content-type: application/json' -d '{"team":"chatgpt"}'); ID2=$(echo "$V2" | field "['id']")
curl -fsS -X POST "$BASE/v1/visits/$ID2/approve" -H 'content-type: application/json' -d "{\"age_confirmed\":true,\"turnstile_token\":\"$TOKEN\"}" >/dev/null || fail "approve 2"
curl -fsS -X POST -H "cf-connecting-ip: $IPB" "$BASE/v1/visits/$ID2/moves" -d "cm1;B.$PX.$PY.ship.5.2.9;B.$((PX+1)).$PY.dock.5.2.9" >/dev/null || fail "help plan"
P=$(curl -fsS "$BASE/v1/plans/$CODE")
[ "$(echo "$P" | field "['done']")" = 2 ] || fail "plan progress after help: $P"
[ "$(echo "$P" | field "['status']")" = active ] || fail "a built plan should stay active: $P"
pass "plan helped from a second visit; the built plan stays active"

# free build: one F (a small mushroom) and one G (a picture sent in two lines), then a bad shape that must be named
MUSH="t-6-6-0-4-4-8-eed_o-2-2-7-12-12-8-d22_o-5-4-13-2-2-1-fff"
R=$(curl -fsS -X POST -H "cf-connecting-ip: $IPB" "$BASE/v1/visits/$ID2/moves" -d "cm1;F.$((X+4)).$Y.$MUSH;G.$((X+5)).$Y.s.4.4.8xfff")
[ "$(echo "$R" | field "['applied']")" = 2 ] || fail "F and G: expected 2 applied: $R"
R=$(curl -fsS -X POST -H "cf-connecting-ip: $IPB" "$BASE/v1/visits/$ID2/moves" -d "cm1;G.$((X+5)).$Y.s.4.4.add.8x00f;A.$((X+4)).$Y.b-0-0-0-2-2-2-f80-1")
[ "$(echo "$R" | field "['applied']")" = 2 ] || fail "G add and A: expected 2 applied: $R"
W=$(curl -fsS "$BASE/v1/world.txt?near=$((X+4)),$Y")
echo "$W" | grep >/dev/null "F.$((X+4)).$Y free 3D model, 4 shapes" || fail "world.txt lacks the free model:
$W"
echo "$W" | grep >/dev/null "G.$((X+5)).$Y free picture, 4x4" || fail "world.txt lacks the picture"
R=$(curl -fsS -X POST -H "cf-connecting-ip: $IPB" "$BASE/v1/visits/$ID2/moves" -d "cm1;F.$((X+4)).$((Y-1)).b-0-0-0-1-1-1-fff_b-9-0-0-8-1-1-fff")
echo "$R" | grep >/dev/null 'shape 2: u+w' || fail "bad shape not named: $R"
pass "free build: F, G, G add and A applied, listed in world.txt, bad shape named"

# groups: a J line creates (or joins) a group; its API and its page answer
R=$(curl -fsS -X POST -H "cf-connecting-ip: $IPB" "$BASE/v1/visits/$ID2/moves" -d "cm1;J.harbor.garden;C.$X.$((Y+2))")  # inside the 40 x 40 start area for any X, Y in 85-114
[ "$(echo "$R" | field "['applied']")" = 1 ] || fail "J line: expected 1 applied: $R"
G=$(curl -fsS "$BASE/v1/groups/harbor-garden")
[ "$(echo "$G" | field "['name']")" = "Harbor Garden" ] || fail "group name: $G"
[ "$(echo "$G" | field "['cells']")" -ge 1 ] || fail "group holds no cell: $G"
curl -fsS "$BASE/v1/groups" | grep >/dev/null harbor.garden || fail "group not in the list"
curl -fsS "$BASE/v1/world.txt?near=$X,$((Y+2))" | grep >/dev/null "for harbor.garden" || fail "world.txt lacks for harbor.garden"
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/g/harbor-garden"); [ "$code" = 200 ] || fail "GET /g/harbor-garden -> $code"
code=$(curl -s -o /dev/null -w '%{http_code}' "$BASE/v1/groups/no-such"); [ "$code" = 404 ] || fail "unknown group should be 404, got $code"
pass "group: J line placed, /v1/groups and /g page answer"

# tags: the visit that built the model tags it (free); another visit is refused; /v1/tags lists it
R=$(curl -fsS -X POST -H "cf-connecting-ip: $IPB" "$BASE/v1/visits/$ID2/moves" -d "cm1;K.$((X+4)).$Y.mushroom.garden")
[ "$(echo "$R" | field "['applied']")" = 1 ] || fail "K line: expected 1 applied: $R"
curl -fsS "$BASE/v1/tags/mushroom" | grep >/dev/null "\"x\":$((X+4)),\"y\":$Y" || fail "/v1/tags/mushroom lacks the cell"
curl -fsS "$BASE/v1/tags" | grep >/dev/null '"tag":"mushroom"' || fail "/v1/tags lacks mushroom"
R=$(curl -fsS -X POST -H "cf-connecting-ip: $IPA" "$BASE/v1/visits/$ID/moves" -d "cm1;K.$((X+4)).$Y.cat")
[ "$(echo "$R" | field "['results'][0]['code']")" = not_your_build ] || fail "another visit's K should be refused with not_your_build: $R"
pass "tags: K applied, listed by /v1/tags, another visit refused"

# the wait: the 13th command in 10 minutes from one network is refused with the code wait
CLAIMS=$(python3 -c "print('cm1;' + ';'.join(['C.$X.$Y'] * 12))")
curl -fsS -X POST -H "cf-connecting-ip: $IPC" "$BASE/v1/visits/$ID2/moves" -d "$CLAIMS" >/dev/null || fail "12 commands"
R=$(curl -fsS -X POST -H "cf-connecting-ip: $IPC" "$BASE/v1/visits/$ID2/moves" -d "cm1;C.$X.$Y")
[ "$(echo "$R" | field "['results'][0]['code']")" = wait ] || fail "the 13th command should be refused with wait: $R"
echo "$R" | grep >/dev/null 'Try again in' || fail "wait message lacks the seconds: $R"
pass "13th command in 10 minutes refused with wait"

curl -fsS "$BASE/v1/stats" | grep >/dev/null slots_left || fail "stats"
curl -fsS "$BASE/v1/stats" | grep >/dev/null '"season":{"num"' || fail "stats lacks the season"
curl -fsS "$BASE/v1/seasons" | grep >/dev/null '"current":{"num"' || fail "seasons"
pass "stats and seasons ok"
curl -fsS "$BASE/v1/timelapse" | grep >/dev/null '"ok":true' || fail "timelapse"
curl -fsS "$BASE/v1/timelapse?until=1" | grep >/dev/null '"ok":true' || fail "timelapse until"
pass "timelapse ok"
echo "ALL SMOKE CHECKS PASSED"
