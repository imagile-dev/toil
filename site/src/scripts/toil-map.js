// The toil map's wires and labels (components/ToilMap.astro). The map is
// complete without this script: every node is already a link. This draws the
// wires between who asks, toil and what it reaches, lights a node's paths and
// shows its label on hover, focus or a first tap, and, when motion is allowed,
// sends one request in and one answer back along them. It runs for a few
// seconds and stops, so nothing on the page moves for longer than five
// (WCAG 2.2.2). Like a status meeting, it is over before anyone asks for it to be.

const SVG = 'http://www.w3.org/2000/svg';
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const DASH = 14;

for (const root of document.querySelectorAll('[data-tmap]')) setUp(root);

function setUp(root) {
  const svg = root.querySelector('.tmap__wires');
  const hub = root.querySelector('[data-hub]');
  const logo = hub.querySelector('.logo') ?? hub;
  const core = root.querySelector('.tmap__core');
  const reachBox = root.querySelector('.tmap__reach');
  const cats = [...root.querySelectorAll('.tmap__cat')];
  const lanes = [...root.querySelectorAll('.tmap__lane')];
  const tip = root.querySelector('.tmap__tip');
  const nodes = [...root.querySelectorAll('.tmap__node')];
  /** @type {{ side: 'ask' | 'reach', key: string, wire: SVGPathElement, flow: SVGPathElement }[]} */
  let edges = [];
  let active = null;
  let firstDraw = true;
  let touchTap = false;

  // Positions come from offsets, not bounding boxes, so the nodes' entrance
  // (a short rise) can't skew a wire drawn while they are still moving.
  const place = (el) => {
    let x = 0;
    let y = 0;
    for (let n = el; n && n !== root; n = n.offsetParent) {
      x += n.offsetLeft;
      y += n.offsetTop;
    }
    return box(x, y, el.offsetWidth, el.offsetHeight);
  };
  const box = (x, y, w, h) => ({ l: x, t: y, r: x + w, b: y + h, cx: x + w / 2, cy: y + h / 2 });
  /** The badge is SVG, which has no offsets: place it by where it sits inside its link, which moves with it. */
  const placeLogo = () => {
    const at = place(hub);
    const a = hub.getBoundingClientRect();
    const b = logo.getBoundingClientRect();
    return box(at.l + b.left - a.left, at.t + b.top - a.top, b.width, b.height);
  };

  // A wire runs from who asks to toil, or from toil to a category: a curve
  // across the gutter and a straight run to the badge, so no wire crosses the
  // words in the middle column. Stacked, it is a curve from bottom to top.
  const toHub = (x1, y1, x2, y2, x3) => {
    const dx = (x2 - x1) / 2;
    return `M${x1},${y1} C${x1 + dx},${y1} ${x2 - dx},${y2} ${x2},${y2} L${x3},${y2}`;
  };
  const fromHub = (x0, y0, x1, x2, y2) => {
    const dx = (x2 - x1) / 2;
    return `M${x0},${y0} L${x1},${y0} C${x1 + dx},${y0} ${x2 - dx},${y2} ${x2},${y2}`;
  };
  const down = (x1, y1, x2, y2) => {
    const dy = (y2 - y1) / 2;
    return `M${x1},${y1} C${x1},${y1 + dy} ${x2},${y2 - dy} ${x2},${y2}`;
  };

  function draw() {
    const width = root.offsetWidth;
    const height = root.offsetHeight;
    if (!width) return;
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.replaceChildren();
    edges = [];
    const row = getComputedStyle(root).getPropertyValue('--tmap-flow').trim() === 'row';
    const h = placeLogo();
    const c = place(core);
    const gap = 8;
    const add = (side, key, d) => {
      const wire = document.createElementNS(SVG, 'path');
      wire.setAttribute('class', 'tmap__wire');
      wire.setAttribute('d', d);
      const flow = document.createElementNS(SVG, 'path');
      flow.setAttribute('class', 'tmap__flow');
      flow.setAttribute('d', d);
      svg.append(wire, flow);
      const len = Math.ceil(wire.getTotalLength());
      wire.style.setProperty('--len', `${len}`);
      flow.style.setProperty('--len', `${len}`);
      edges.push({ side, key, wire, flow });
    };

    for (const lane of lanes) {
      const a = place(lane);
      if (row) add('ask', lane.dataset.lane, toHub(a.r, a.cy, c.l, h.cy, h.l - gap));
      else add('ask', lane.dataset.lane, down(a.cx, a.b, h.cx, h.t - gap));
    }
    if (row) {
      for (const cat of cats) {
        const title = place(cat.querySelector('.tmap__group'));
        add('reach', cat.dataset.cat, fromHub(h.r + gap, h.cy, c.r, title.l - gap, title.cy));
      }
    } else {
      const r = place(reachBox);
      add('reach', '*', `M${h.cx},${c.b + gap} L${h.cx},${r.t - gap}`);
    }

    if (firstDraw && !reduceMotion.matches) {
      for (const e of edges) {
        e.wire.style.setProperty('--delay', `${e.side === 'ask' ? 500 : 900}ms`);
        e.wire.classList.add('is-drawing');
        e.wire.addEventListener('animationend', () => e.wire.classList.remove('is-drawing'), { once: true });
      }
      flow(edges, 1500);
    }
    firstDraw = false;
    if (active) light(active);
  }

  /** One request in along ask wires, then out along reach wires; then the answer back the same way. */
  function flow(list, start = 0) {
    if (reduceMotion.matches) return;
    const step = 800;
    for (const e of list) {
      const first = e.side === 'ask' ? 0 : step;
      const back = e.side === 'ask' ? step * 3 : step * 2;
      e.flow.style.setProperty('--in', `${start + first}ms`);
      e.flow.style.setProperty('--back', `${start + back}ms`);
      e.flow.classList.remove('is-flowing');
      void e.flow.getBoundingClientRect();
      e.flow.classList.add('is-flowing');
    }
  }

  function related(node) {
    const lane = node.closest('.tmap__lane')?.dataset.lane;
    const cat = node.closest('.tmap__cat')?.dataset.cat;
    const all = node.hasAttribute('data-hub') || node.closest('.tmap__core') !== null;
    return { lane, cat, all };
  }

  function light(node) {
    const { lane, cat, all } = related(node);
    root.classList.add('is-lit');
    for (const l of lanes) l.classList.toggle('is-on', all || cat !== undefined || l.dataset.lane === lane);
    for (const c of cats) c.classList.toggle('is-on', all || lane !== undefined || c.dataset.cat === cat);
    const lit = [];
    for (const e of edges) {
      const on = all || (lane !== undefined && (e.side === 'reach' || e.key === lane)) || (cat !== undefined && (e.side === 'ask' || e.key === cat || e.key === '*'));
      e.wire.classList.toggle('is-lit', on);
      if (on) lit.push(e);
    }
    return lit;
  }

  function activate(node) {
    if (active === node) return;
    active?.classList.remove('is-active');
    active = node;
    node.classList.add('is-active');
    flow(light(node));
    showTip(node);
  }

  function clear() {
    active?.classList.remove('is-active');
    active = null;
    root.classList.remove('is-lit');
    for (const el of [...lanes, ...cats]) el.classList.remove('is-on');
    for (const e of edges) e.wire.classList.remove('is-lit');
    tip.hidden = true;
  }

  function showTip(node) {
    tip.querySelector('b').textContent = node.dataset.name;
    tip.querySelector('span').textContent = node.dataset.label;
    tip.hidden = false;
    const n = place(node);
    const w = tip.offsetWidth;
    const th = tip.offsetHeight;
    const left = Math.max(0, Math.min(n.cx - w / 2, root.offsetWidth - w));
    const above = n.t - th - 8;
    tip.style.left = `${left}px`;
    tip.style.top = `${above >= 0 ? above : n.b + 8}px`;
  }

  root.addEventListener('pointerover', (e) => {
    if (e.pointerType === 'touch') return;
    const node = e.target.closest('.tmap__node');
    if (node) activate(node);
  });
  root.addEventListener('pointerleave', (e) => {
    if (e.pointerType === 'touch') return;
    const focused = root.contains(document.activeElement) && document.activeElement.matches(':focus-visible') ? document.activeElement.closest('.tmap__node') : null;
    if (focused) activate(focused);
    else clear();
  });
  root.addEventListener('pointerdown', (e) => {
    touchTap = e.pointerType === 'touch';
  });
  root.addEventListener('focusin', (e) => {
    if (touchTap) return;
    const node = e.target.closest('.tmap__node');
    if (node) activate(node);
  });
  root.addEventListener('focusout', (e) => {
    if (!root.contains(e.relatedTarget)) clear();
  });
  // On touch there is no hover, so the first tap on a node lights it and shows
  // its label, and a second tap on the same node follows its link.
  root.addEventListener('click', (e) => {
    const node = e.target.closest('.tmap__node');
    const wasTouch = touchTap;
    touchTap = false;
    if (!node) {
      if (wasTouch) clear();
      return;
    }
    if (wasTouch && active !== node) {
      e.preventDefault();
      activate(node);
    }
  });
  document.addEventListener('pointerdown', (e) => {
    if (active && !root.contains(e.target)) clear();
  });
  root.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && active) clear();
  });

  // The level filter on the full map: chips at other levels step back.
  for (const button of root.querySelectorAll('.tmap__level')) {
    button.addEventListener('click', () => {
      const level = button.dataset.level;
      for (const b of root.querySelectorAll('.tmap__level')) b.setAttribute('aria-pressed', String(b === button));
      for (const chip of root.querySelectorAll('.tmap__chip[data-status]')) chip.classList.toggle('is-out', level !== '' && chip.dataset.status !== level);
    });
  }

  let frame = 0;
  const redraw = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(draw);
  };
  new ResizeObserver(redraw).observe(root);
  document.fonts?.ready.then(redraw);
  draw();
}
