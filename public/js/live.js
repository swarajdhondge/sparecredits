// Live connection to the city. A viewer follows chunks of the map: after connecting it sends ONE message
// {t:"sub", c:[[cx,cy],...], ov:0|1} per pan or zoom stop (incoming messages cost the free plan), and the server
// sends only those chunks and only their changes. With ov:1 it sends the small overview instead of chunks.
export function connectLive(h) {
  let ws = null;
  let closed = false;
  let delay = 1000;
  let want = null; // the last subscription the page asked for, sent again after a reconnect

  const send = (obj) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj)); };
  const sendWant = () => { if (want) send({ t: "sub", c: want.c, ov: want.ov ? 1 : 0 }); };

  function open() {
    const url = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/v1/live`;
    ws = new WebSocket(url);
    ws.onopen = () => { delay = 1000; h.onState?.(true); sendWant(); };
    ws.onmessage = (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      if (m.t === "chunk") {
        h.onChunk?.(m.cx, m.cy, m.cells, m.i === 0, m.ghosts);
      } else if (m.t === "g") h.onGhostAdd?.(m.g);
      else if (m.t === "gdel") h.onGhostDel?.(m.p);
      else if (m.t === "plan") h.onPlan?.(m);
      else if (m.t === "ov") h.onOverview?.(m.d);
      else if (m.t === "o") h.onOverviewDelta?.(m.d);
      else if (m.t === "c") h.onCell?.(m.cell, m);
      else if (m.t === "stats") h.onStats?.(m);
    };
    ws.onclose = () => {
      h.onState?.(false);
      if (closed) return;
      setTimeout(open, delay);
      delay = Math.min(15000, delay * 1.7);
    };
    ws.onerror = () => { try { ws.close(); } catch { /* ignore */ } };
  }
  open();
  return {
    /** Follow these chunks (list of [cx, cy]) and, with ov, the overview. Sends nothing if nothing changed. */
    sub(c, ov = false) {
      const next = { c, ov };
      if (want && want.ov === ov && JSON.stringify(want.c) === JSON.stringify(c)) return;
      want = next;
      sendWant();
    },
    close() { closed = true; try { ws?.close(); } catch { /* ignore */ } },
  };
}

/** Follow the live city with a CityView (home page and admin page). Chunk messages and stats feed the view; the first camera
 * is set once from the first stats (`openOn`); with `at` = [x, y, zoom] that place is shown at once and the chunk subscription
 * does not wait. One subscription per pan or zoom stop. `onState(ok)` and `onStats(st)` are the page's own hooks. */
export function followCity(view, { at = null, ov: ovAlways = false, onState, onStats } = {}) {
  let firstView = !at; // the camera is set once, from the first stats; the chunk subscription waits for it
  let pendingAt = at;
  const holdSub = firstView;
  const live = connectLive({
    onState,
    onChunk: (cx, cy, cells, first, ghosts) => {
      view.setChunk(cx, cy, cells, first);
      if (first) view.setGhosts(cx, cy, ghosts || []);
    },
    onGhostAdd: (g) => view.addGhosts(g),
    onGhostDel: (code) => view.delGhosts(code),
    onOverview: (d) => view.setOverview(d),
    onOverviewDelta: (d) => view.patchOverview(d),
    onCell: (w) => view.upsert(w, { animate: true }),
    onStats: (st) => {
      if (st.open) view.setOpen(st.open);
      view.setFrozen(st.frozen);
      if (pendingAt && st.open) { view.focus(...pendingAt); pendingAt = null; }
      if (firstView && st.open) { firstView = false; view.openOn(st.box, st.last); }
      onStats?.(st);
    },
  });
  // follow only the chunks in view (or the overview when zoomed far out): one message per pan or zoom stop
  view.on("view", ({ c, ov }) => { if (!(holdSub && firstView)) live.sub(c, ov || ovAlways); }); // ov: true (home page) = the overview next to the chunks, always
  return live;
}
