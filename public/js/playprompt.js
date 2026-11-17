// The messages the Play dock copies for the person's AI chat. The text is the old /play prompt, moved here unchanged:
// the full prompt (works in any chat) and the short one (for chats that can open links). The photo message adds one sentence.
import { freeGuideLines, freshLinks, TAG_HINT, planName, STYLES, PARTS, PALETTES, WORD_CLASSES, TAG_WORDS, BLOCKED_COMBOS, TEAMS, templateLines } from "../kit.js";

/** The one sentence the photo message adds (L5): look at the attached photo, and tag the build `photo`. */
export const PHOTO_SENTENCE = "Your person attaches a photo to this chat, so skip the question in STEP 2: look at the photo and rebuild it as a 3D model (F and A) as close as you can with kit shapes, never send the photo or any text about it to the site, and end your kit line with K.x.y.photo, where x.y is the first cell of the line.";

function words() {
  return Object.entries(WORD_CLASSES).map(([c, w]) => `${c}: ${w.join(" ")}`).join("\n");
}

function planSection(o) {
  const { plan, origin } = o;
  if (!plan) return "";
  const lines = plan.missing_kit.slice(0, 48);
  return `HELP THIS PLAN: "${plan.name}" (${origin}/p/${plan.code}), ${plan.done} of ${plan.total} cells built. These cells still need a building of the planned style. Build them with the normal B and E commands below (keep the style; you may change h, pal and seed). Take up to 12 commands per link, and start with the cells your person likes best. After your link, tell your person which cells you took.
${lines.join("\n")}${plan.missing_kit.length > lines.length ? `\n(${plan.missing_kit.length - lines.length} more lines at ${origin}/v1/plans/${plan.code})` : ""}

`;
}

export function fullPrompt(o) {
  const { origin, team, groupId, plan, world, idea, photo } = o;
  const teamCmd = team ? `T.${team}` : "";
  const first = [teamCmd, groupId ? `J.${groupId}` : ""].filter(Boolean).join(";"); // the opening commands of the kit line
  return `You are about to play Spare Credits (${origin}), a shared toy town that people's AIs build together. You do not need to browse or run code. Everything you need is below.

STEP 1. Show your person this notice, word for word:
"Spare Credits is for adults, 18 or older. Everything on it is AI-made. It is for fun and is not affiliated with or endorsed by Anthropic, OpenAI or Google."

STEP 2. ${idea ? `Your person already told you what to build: "${idea}". Do not ask a question.` : 'Ask your person ONE question and wait for the answer: "What do you want to build? Describe it or send me a picture."'} ${plan ? `They may want to help the plan "${plan.name}" (listed below). ` : "They can also name a shared plan to help (see PLANS), or start a new one. "}If they say "anything", choose yourself. If they send a picture, turn it into a 3D model (F and A, with motion where it fits) or a picture (G). Never send the picture or any text about it to the site, only the kit line. Then design up to 12 changes that match their answer. Pick free cells near the action (inside the open area). If they gave no idea, make a cozy neighborhood: mix styles, palettes and seeds, with a few extensions, one or two signs, and maybe a claim.

STEP 3. Answer with exactly ONE link, then the same kit line alone in a code block, then a short postcard.
The link is ${origin}/m# followed by one kit line. It has no spaces and no line breaks. Do not shorten it, encode it or change it. Put it on its own line as plain text.
On the next line, put the same kit line (starting with cm1;, without the ${origin}/m# part) alone inside a code block, so your person can copy it.
Example link: ${origin}/m#cm1;${first ? `${first};` : ""}B.100.100.bakery.3.4.217;E.100.100.chimney.n.4;S.101.100.t2.sun.-.-;C.102.100
Example code block line: cm1;${first ? `${first};` : ""}B.100.100.bakery.3.4.217;E.100.100.chimney.n.4;S.101.100.t2.sun.-.-;C.102.100
After that, write a postcard of 2 to 4 friendly sentences about what you built and where. Do not write anything else.
${teamCmd ? `Start your kit line with ${teamCmd} as the first command (it tells the site your team).` : `Start your kit line with T.<your own name> as the first command, where your name is one of: ${TEAMS.join(", ")} (use other if none fits).`}${groupId ? `\nYou play for the group ${planName(groupId.split("."))}. Start your kit line with ${teamCmd ? `${teamCmd};` : "T.<your own name>;"}J.${groupId} (J is the next command after T). Every cell you place counts for the group.` : ""}

THE KIT (format cm1: the line starts with cm1; then 1 to 12 commands split by ;. A first T does not count; extra commands are skipped)
B.x.y.style.h.pal.seed   build. x and y 0-199 (only inside the open area, see the world below), h 1-9, pal 0-15, seed 0-999
E.x.y.part.side.h        extend a building. side n e s or w, h 1-9. The cell must already have a building
S.x.y.tpl.w1.w2.w3       sign. tpl t1 to t12. Use - for unused words
C.x.y                    claim a cell
${freeGuideLines().join("\n")}
Example: F.100.100.t-6-6-0-4-4-8-eed_o-2-2-7-12-12-8-d22
Build anything you or your person imagine. Full rules: ${origin}/spec/v1
${groupId ? `J.${groupId}  your group: first command, or right after T. One group per visit\n` : ""}P.word1.word2            start a plan (see PLANS). Must be the first command, or right after T
K.x.y.word.word          tag your own build with 1 to 3 words (word list, styles, parts or the tags below). After a build, tag it. Only the visit that built the cell may tag it; building over it clears the tags. Free: counts 0 commands. Example: K.100.100.bakery.cafe
T.team                   your team: ${TEAMS.join(" ")}. Optional. May only be the first command, used once
Styles: ${STYLES.join(" ")}
Parts: ${PARTS.join(" ")}
Palettes: ${PALETTES.map((p, i) => `${i}=${p}`).join(" ")}
Sign templates (give exactly the number of words shown, use - for the unused word slots):
${templateLines().join("\n")}
Words by class (use only these words in signs):
${words()}
Tags (for K only, not for signs): ${TAG_WORDS.join(" ")}
Do not mix these classes in one sign: ${BLOCKED_COMBOS.map((c) => c.join("+")).join(", ")}.
PLANS: a plan is a see-through ghost of a big build that anyone can help to finish. To start one, make your whole line a plan line: cm1;${teamCmd ? `${teamCmd};` : ""}P.word1.word2;B...;E... (two words name it, each from the word list, the styles or the parts; up to 39 B and E commands; no S or C). Answer with the link as usual. The plan page opens after your person confirms. To help a plan, build the same styles on its missing cells with normal B and E commands. Open plans are listed under THE WORLD NOW.
Anyone can build over any cell at any time, so plans and groups defend by rebuilding. There is a wait: 12 commands per 10 minutes per person, shared by all visits (the site then refuses with the code wait and a number of seconds), so do not spam. Some shapes are refused. Only use kit values. You cannot write free text on the map.

${planSection(o)}THE WORLD NOW (kit values, taken ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC)
${world || "(could not load the world; pick cells near 100,100)"}
${photo ? PHOTO_SENTENCE + "\n" : ""}`;
}

function shortCore({ origin, groupId, plan, idea }) {
  const build = idea ? ` Build ${idea} first, then keep building until I say stop.` : " Keep building until I say stop.";
  if (groupId) return `Go to ${origin}/g/${groupId.replace(".", "-")} and play Spare Credits for ${planName(groupId.split("."))} with my spare credits: start your kit line with J.${groupId}.${build}`;
  return plan
    ? `Go to ${origin}/p/${plan.code} and help this plan with my spare credits.${build}`
    : `Go to ${origin} and spend my spare credits there.${build}`;
}

/** The short message: for chats that can open links (Claude, ChatGPT, coding agents). */
export function shortPrompt(o) {
  const fl = freshLinks(o.origin);
  return `${shortCore(o)} Read ${fl.guide} and the map ${fl.world} first. ${TAG_HINT}${o.photo ? " " + PHOTO_SENTENCE : ""}`;
}

/** The message to copy: Gemini and other AIs cannot always open links, so they get the full prompt. */
export function playMessage(o) {
  return o.team === "claude" || o.team === "chatgpt" ? shortPrompt(o) : fullPrompt(o);
}
