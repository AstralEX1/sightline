import { useState } from 'react';
import { ACTION_TITLE, DEFAULT_DELIVERY, isEvent, LIMITS, TEMPLATES } from '../../server/src/registry.ts';
import { allowed, validateShortcut } from '../../server/src/validate.ts';
import { actionParts, conditionParts } from '../../app/src/phone/sentence.ts';

const storageKey = 'trade-shortcuts.landing.builder.v1';
const markets = ['BTC', 'ETH', 'SOL'];
const template = id => TEMPLATES.find(t => t.id === 'tpl_' + id).draft;

// Each example starts with the same scope, units and defaults as its app template.
const examples = [
  { id: 10, label: 'Price crosses above', field: 'threshold', unit: 'Price (USDT)' },
  { id: 22, label: 'Volume spikes in 5 min', field: 'multiplier', unit: 'Volume multiple (×)' },
  { id: 20, label: 'Funding due within 30 min', field: 'ratePct', unit: 'Funding rate (%)' },
  { id: 1, label: 'Return rises above', field: 'threshold', unit: 'ROI (%)' },
  { id: 6, label: 'Liquidation gets close', field: 'distancePct', unit: 'Distance (%)' },
  { id: 8, label: 'Stop loss is missing' },
  { id: 14, label: 'An order fills' },
  { id: 15, label: 'An order partly fills' },
  { id: 24, label: 'An order stays open', field: 'minutes', unit: 'Order age (minutes)' },
];
const actions = [
  { id: 10 },
  { id: 6, field: 'percent', unit: 'Position to close (%)' },
  { id: 1, label: 'Move stop to breakeven' },
  { id: 8, target: true, unit: 'Stop distance from entry (%)' },
  { id: 14, target: true, unit: 'Take profit from entry (%)' },
  { id: 7, field: 'usdt', unit: 'Margin to add (USDT)' },
  { id: 13, field: 'notionalUsdt', unit: 'Long size at 5× (USDT)' },
  { id: 24 },
];
const words = parts => parts.map(p => typeof p === 'string' ? p : p.text).join(' ');
function defaults(id, market) {
  const example = examples.find(e => e.id === id);
  const draft = template(id);
  const price = { BTC: '90000', ETH: '3000', SOL: '180' };
  return {
    market, exampleId: id, actionId: actions.find(a => template(a.id).action.type === draft.action.type).id,
    threshold: String(id === 10 ? price[market] : draft.conditions.items[0][example.field] ?? ''),
  };
}
function amountFor(id) {
  const option = actions.find(a => a.id === id);
  const action = template(id).action;
  return String(option.target ? Math.abs(Number(action.target.percent)) : action[option.field] ?? '');
}
function build(form) {
  const example = examples.find(e => e.id === form.exampleId);
  const option = actions.find(a => a.id === form.actionId);
  const base = template(example.id);
  const symbol = form.market + 'USDT';
  const scope = base.scope.type === 'ALL_POSITIONS'
    ? { type: 'POSITION', symbol, positionIdx: 1, epoch: 'demo' }
    : ['ORDER', 'ALL_ORDERS'].includes(base.scope.type)
      ? { type: 'ORDER', symbol, orderId: 'demo-order' } : { type: 'SYMBOL', symbol };
  const condition = { ...base.conditions.items[0] };
  if (example.field) condition[example.field] = example.field === 'minutes' ? Number(form.threshold) : form.threshold;
  const action = { ...template(option.id).action };
  if (option.field) action[option.field] = form.amount;
  if (option.target) action.target = { ...action.target, percent: action.type === 'SET_SL' && form.amount ? '-' + form.amount : form.amount };
  const trigger = { mode: action.type === 'OPEN_POSITION' ? 'ONCE' : isEvent(condition) ? 'ON_EVENT' : 'ON_ENTRY' };
  const result = validateShortcut({ name: form.name, scope, conditions: { logic: 'ALL', items: [condition] }, action, trigger, delivery: DEFAULT_DELIVERY });
  return { scope, condition, action, result };
}
function initialForm() {
  try {
    const saved = JSON.parse(localStorage.getItem(storageKey));
    if (saved && markets.includes(saved.market) && typeof saved.name === 'string' &&
        typeof saved.threshold === 'string' && typeof saved.amount === 'string' && build(saved).result.ok) return saved;
  } catch { /* Private browsing or a draft from a different version. */ }
  return { ...defaults(10, 'BTC'), name: '', amount: '' };
}

export function ShortcutBuilder() {
  const [form, setForm] = useState(initialForm);
  const [notice, setNotice] = useState('');
  const update = patch => { setForm(previous => ({ ...previous, ...patch })); setNotice(''); };
  const example = examples.find(e => e.id === form.exampleId);
  const option = actions.find(a => a.id === form.actionId);
  const { scope, condition, action, result } = build(form);
  const choices = actions.filter(a => allowed(scope.type, condition.type, template(a.id).action.type));
  function changeExample(id) {
    const next = defaults(id, form.market);
    update({ ...next, amount: amountFor(next.actionId) });
  }
  function save(event) {
    event.preventDefault();
    if (!result.ok) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(form));
      setNotice('Draft saved on this device.');
    } catch { setNotice('Browser storage is unavailable. You can still try the preview.'); }
  }
  return <>
    <div className="build-copy">
      <span className="kick">Make your own</span>
      <h2>Build a shortcut. <em>Try it here.</em></h2>
      <p className="lead">Pick a market, set a condition and choose what happens next. The glasses preview updates as you edit.</p>
    </div>
    <div className="build-phone">
      <div className="phone"><i className="hw" aria-hidden="true"></i><form className="builder-form" onSubmit={save}>
        <h3>Shortcut editor</h3>
        <label>Name (optional) <input maxLength={LIMITS.maxName} placeholder="My shortcut" value={form.name} onChange={e=>update({ name:e.target.value })}/></label>
        <label>Apply to <select value={form.market} onChange={e=>update({ market:e.target.value })}>
          {markets.map(m=><option key={m} value={m}>{m} / USDT{scope.type === 'POSITION' ? ' · Long position' : scope.type === 'ORDER' ? ' · Demo order' : ''}</option>)}
        </select></label>
        <fieldset><legend>When</legend>
          <select aria-label="Condition" value={example.id} onChange={e=>changeExample(Number(e.target.value))}>
            {examples.map(e=><option key={e.id} value={e.id}>{e.label}</option>)}
          </select>
          {example.field && <label>{example.unit}<input type="number" step={example.field === 'minutes' ? '1' : 'any'} required value={form.threshold} onChange={e=>update({ threshold:e.target.value })}/></label>}
        </fieldset>
        <fieldset><legend>Do</legend>
          <select aria-label="Action" value={option.id} onChange={e=>{ const id=Number(e.target.value); update({ actionId:id, amount:amountFor(id) }); }}>
            {choices.map(a=><option key={a.id} value={a.id}>{a.label || ACTION_TITLE[template(a.id).action.type]}</option>)}
          </select>
          {option.unit && <label>{option.unit}<input type="number" min="0" step="any" required value={form.amount} onChange={e=>update({ amount:e.target.value })}/></label>}
        </fieldset>
        <button type="submit" disabled={!result.ok}>Save draft on this device</button>
        <p className="builder-status" role="status">{result.ok ? notice : result.issues[0]?.message}</p>
      </form></div>
    </div>
    <figure className="build-result">
      <figcaption>Even G2 preview · Simulation</figcaption>
      <div className="builder-lens" aria-live="polite" aria-atomic="true">
        {result.ok ? <>
          <strong>{form.name.trim() || ACTION_TITLE[action.type]} · {form.market}</strong>
          <span>When {words(conditionParts(condition))}</span>
          <span>{action.type === 'NOTIFY' ? 'Show notification' : 'Confirm on G2: ' + words(actionParts(action))}</span>
        </> : <span>Complete the rule to preview it.</span>}
      </div>
    </figure>
  </>;
}
