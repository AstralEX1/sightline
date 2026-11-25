// Base UI islands. Each one reads its content from the static HTML, then swaps that markup for a Base UI component.
// Build: npm run build  ->  js/islands.js
import { useEffect, useRef, useState } from 'react';
import { ShortcutBuilder } from './shortcut-builder.jsx';
import { createRoot } from 'react-dom/client';
import { Accordion } from '@base-ui/react/accordion';
import { Toggle } from '@base-ui/react/toggle';
import { ToggleGroup } from '@base-ui/react/toggle-group';

const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

// display:contents keeps the page's grid and flex layout exactly as it was around the swapped element
function mount(el, node) {
  if (!el) return;
  const host = document.createElement('div');
  host.style.display = 'contents';
  el.replaceWith(host);
  createRoot(host).render(node);
}

/* Hero: chips pick the lens alert; the newest lens screen opens at the top of the feed. */
function pushLens(roll, name) {
  const o = document.createElement('div');
  const im = new Image();
  o.className = 'fdi';
  o.style.height = '0';
  o.style.opacity = '0';
  const grow = () => requestAnimationFrame(() => { o.style.height = im.offsetHeight + 9 + 'px'; o.style.opacity = '1'; });
  im.alt = '';
  im.src = `img/hud/${name}.png`;
  o.appendChild(im);
  roll.insertBefore(o, roll.firstChild);
  if (im.complete) grow(); else im.onload = grow;
  setTimeout(() => { o.style.height = ''; }, 800);
  while (roll.children.length > 5) roll.removeChild(roll.lastChild);
}

function HeroChips({ chips, island, roll }) {
  const [cur, setCur] = useState(0);
  const [restart, setRestart] = useState(0);
  const group = useRef(null);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) { first.current = false; return; }
    pushLens(roll, chips[cur].lens);
    const g = group.current, b = g && $$('.ex', g)[cur];
    if (b && g.scrollWidth > g.clientWidth + 2) g.scrollTo({ left: Math.max(0, b.offsetLeft - g.offsetLeft - 16), behavior: RM ? 'auto' : 'smooth' });
  }, [cur]);

  // auto-advance every 3.2 s while the hero is on screen and keyboard focus is not on the chips;
  // a manual pick restarts the count
  useEffect(() => {
    if (RM) return;
    let vis = false;
    const io = new IntersectionObserver(([e]) => { vis = e.isIntersecting; }, { threshold: 0.25 });
    io.observe(island);
    const id = setInterval(() => {
      if (vis && !document.hidden && island.offsetWidth && !group.current?.contains(document.activeElement)) setCur((c) => (c + 1) % chips.length);
    }, 3200);
    return () => { clearInterval(id); io.disconnect(); };
  }, [restart]);

  const pick = (i) => { if (i !== cur) { setCur(i); setRestart((n) => n + 1); } };

  return (
    <ToggleGroup ref={group} className="iex" value={[String(cur)]} onValueChange={(v) => v.length && pick(+v[0])} aria-labelledby="iexl">
      <span className="iexl" id="iexl">Alerts for</span>
      {chips.map((c, i) => (
        <Toggle key={c.lens} value={String(i)} className={(s) => (s.pressed ? 'ex on' : 'ex')} onPointerEnter={(e) => e.pointerType === 'mouse' && pick(i)}>
          {c.label}
        </Toggle>
      ))}
    </ToggleGroup>
  );
}

/* FAQ: answers stay in the DOM (hidden until found) so page search and crawlers still see them. */
function Faq({ items }) {
  return (
    <Accordion.Root className="qa" multiple hiddenUntilFound>
      {items.map((it) => (
        <Accordion.Item key={it.q} className="qa-i">
          <Accordion.Header className="qa-h">
            <Accordion.Trigger className="qa-t">{it.q}</Accordion.Trigger>
          </Accordion.Header>
          <Accordion.Panel className="qa-p">
            {/* our own static answer markup (may hold links), read from this page */}
            <p dangerouslySetInnerHTML={{ __html: it.a }} />
          </Accordion.Panel>
        </Accordion.Item>
      ))}
    </Accordion.Root>
  );
}

const island = $('#isAssist'), roll = $('#iroll'), iex = $('.iex', island || document);
if (island && roll && iex) {
  const chips = $$('.ex', iex).map((e) => ({ label: e.textContent, lens: e.dataset.lens }));
  chips.forEach((c) => { new Image().src = `img/hud/${c.lens}.png`; });
  mount(iex, <HeroChips chips={chips} island={island} roll={roll} />);
}

const qa = $('.qa');
if (qa) {
  const items = $$('details', qa).map((d) => ({ q: $('summary', d).textContent, a: $('p', d).innerHTML }));
  mount(qa, <Faq items={items} />);
}

const builder = $('#shortcut-builder');
if (builder) createRoot(builder).render(<ShortcutBuilder />);
