// Shared by the replay page and the time-lapse page: apply one parsed command to a map of cell wires.
import { freeBuild } from "../kit.js";
/** state: Map of "x,y" -> wire. cmd: a parsed command. Returns the changed wire, or null when nothing changed (an extension with no building). */
export function applyCmd(state, cmd, ts, team, pub) {
  const k = `${cmd.x},${cmd.y}`;
  const w = state.get(k) || { x: cmd.x, y: cmd.y, t: team, l: Date.now(), v: pub };
  if (cmd.v === "B") { w.b = `${cmd.style}.${cmd.h}.${cmd.pal}.${cmd.seed}`; delete w.e; }
  else if (cmd.v === "E") { if (!w.b) return null; const cur = (w.e ? w.e.split(",") : []).filter((t) => t.split(".")[1] !== cmd.side); cur.push(`${cmd.part}.${cmd.side}.${cmd.h}`); w.e = cur.join(","); }
  else if (cmd.v === "F" || cmd.v === "A" || cmd.v === "G") {
    // free build: same result as the server (kit freeBuild); an add with nothing of that kind before it changes nothing
    const prevStyle = w.b ? w.b.split(".")[0] : null;
    const r = freeBuild(cmd, prevStyle, w.f || null);
    if (!r.ok) return null;
    w.b = `${r.style}.${r.h}.0.0`; w.f = r.shape; delete w.e;
  }
  else if (cmd.v === "S") w.s = `t${cmd.tpl}.${[0, 1, 2].map((n) => cmd.words[n] || "-").join(".")}`;
  else w.c = 1;
  w.ts = ts;
  state.set(k, w);
  return w;
}
