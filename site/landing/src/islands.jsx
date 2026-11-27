// Base UI islands. Each one reads its content from the static HTML, then swaps that markup for a Base UI component.
// Build: npm run build  ->  js/islands.js
import { createRoot } from 'react-dom/client';
import { Accordion } from '@base-ui/react/accordion';
import { ACTION_TITLE, TEMPLATES, VOICE_SEEDS } from '../../../server/src/registry.ts';
import { ACTION_ICON, icon } from '../../../app/src/phone/icons.ts';
import { templateTitle } from '../../../app/src/phone/sentence.ts';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* Shortcut tiles as the phone's Templates grid draws them (app/src/phone/home.ts: logo + title, + badge).
   data-tpl lists template numbers or voice phrases; "all" is the marquee, doubled for its loop. */
const tile = (title, draft) => {
  const { icon: name, color } = ACTION_ICON[draft.action.type];
  return `<div class="tpl" style="--c:${color}"><span class="tpl-top"><span class="tpl-glyph">${icon(name, 32)}</span><span class="tpl-add" aria-hidden="true">${icon('plus', 12)}</span></span><span class="tpl-title">${title}</span></div>`;
};
const templates = TEMPLATES.map((t) => [t.id.replace('tpl_', ''), tile(templateTitle(t), t.draft)]);
const tiles = new Map([...templates, ...VOICE_SEEDS.map((v) => [v.voicePhrase, tile(ACTION_TITLE[v.action.type], v)])]);
for (const el of $$('[data-tpl]')) {
  if (el.dataset.tpl === 'all') {
    const group = templates.map(([, html]) => html).join('');
    el.innerHTML = `<div class="mq-g">${group}</div><div class="mq-g dup" aria-hidden="true">${group}</div>`;
  } else {
    el.innerHTML = el.dataset.tpl.split(',').map((key) => {
      if (!tiles.has(key)) console.error(`No shortcut template "${key}"`);
      return tiles.get(key) ?? '';
    }).join('');
  }
}

// display:contents keeps the page's grid and flex layout exactly as it was around the swapped element
function mount(el, node) {
  if (!el) return;
  const host = document.createElement('div');
  host.style.display = 'contents';
  el.replaceWith(host);
  createRoot(host).render(node);
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

const qa = $('.qa');
if (qa) {
  const items = $$('details', qa).map((d) => ({ q: $('summary', d).textContent, a: $('p', d).innerHTML }));
  mount(qa, <Faq items={items} />);
}
