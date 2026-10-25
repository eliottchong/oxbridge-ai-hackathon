export type Role = 'manager' | 'researcher';
export type Supply = { id: string; name: string; category: string; unit: string; pack: number; price: number; supplier: string; lead: number };
export type Batch = { id: string; supply: string; quantity: number; expires: string };
export type Experiment = { id: string; name: string; owner: string; date: string; status: 'planned' | 'completed' | 'cancelled'; needs: { supply: string; quantity: number }[]; notes: string; data: string };
export type Order = { id: string; supply: string; quantity: number; total: number; supplier: string; status: 'pending' | 'approved' | 'paid' | 'received' | 'rejected' | 'failed'; reason: string; eta: string; signature: string };
export type Lab = { version: 1; today: string; budget: number; initialSpent: number; supplies: Supply[]; batches: Batch[]; experiments: Experiment[]; orders: Order[]; activity: { id: string; text: string; time: string }[] };
export type Decision = { supply: Supply; demand: number; available: number; shortage: number; quantity: number; total: number; due: string; reason: string; late: boolean };
export const money = (pence: number) => new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 2 }).format(pence / 100);
export const datePlus = (date: string, days: number) => new Date(Date.parse(date + 'T12:00:00Z') + days * 86400000).toISOString().slice(0, 10);
const id = () => crypto.randomUUID();
export function seed(): Lab {
  const lab: Lab = {
    version: 1, today: '2026-10-25', budget: 1500000, initialSpent: 432000,
    supplies: [
      { id: 'tips', name: '200 µL pipette tips', category: 'Consumables', unit: 'tips', pack: 960, price: 4800, supplier: 'Fisher Scientific', lead: 2 },
      { id: 'mix', name: 'qPCR master mix', category: 'Reagents', unit: 'reactions', pack: 100, price: 12500, supplier: 'Meridian Bioscience', lead: 2 },
      { id: 'plates', name: '96-well PCR plates', category: 'Consumables', unit: 'plates', pack: 10, price: 3600, supplier: 'Fisher Scientific', lead: 2 },
      { id: 'ethanol', name: 'Ethanol, molecular grade', category: 'Reagents', unit: 'mL', pack: 1000, price: 4200, supplier: 'Sigma-Aldrich', lead: 3 },
      { id: 'tubes', name: '1.5 mL microcentrifuge tubes', category: 'Consumables', unit: 'tubes', pack: 500, price: 2800, supplier: 'Fisher Scientific', lead: 2 },
    ],
    batches: [
      { id: 'LOT-241', supply: 'tips', quantity: 320, expires: '2028-05-01' },
      { id: 'LOT-118', supply: 'mix', quantity: 80, expires: '2026-10-30' },
      { id: 'LOT-092', supply: 'mix', quantity: 50, expires: '2026-10-24' },
      { id: 'LOT-065', supply: 'plates', quantity: 6, expires: '2028-06-01' },
      { id: 'LOT-201', supply: 'ethanol', quantity: 1400, expires: '2027-04-01' },
      { id: 'LOT-185', supply: 'tubes', quantity: 650, expires: '2028-05-01' },
    ],
    experiments: [
      { id: 'EXP-001', name: 'CRISPR screen validation', owner: 'Amelia Chen', date: '2026-10-28', status: 'planned', needs: [{ supply: 'tips', quantity: 500 }, { supply: 'mix', quantity: 150 }, { supply: 'plates', quantity: 4 }], notes: 'Validate the next screen using the approved qPCR protocol. Use earliest-expiring eligible reagent batch first.', data: 'https://example.org/lab/crispr-screen' },
      { id: 'EXP-002', name: 'RNA extraction · cohort B', owner: 'James Okafor', date: '2026-10-29', status: 'planned', needs: [{ supply: 'tips', quantity: 300 }, { supply: 'ethanol', quantity: 200 }, { supply: 'tubes', quantity: 100 }], notes: 'Cohort B sample preparation. Record actual material use on completion.', data: '' },
      { id: 'EXP-003', name: 'Cell viability assay', owner: 'Sofia Patel', date: '2026-11-02', status: 'planned', needs: [{ supply: 'mix', quantity: 50 }, { supply: 'plates', quantity: 8 }, { supply: 'tubes', quantity: 50 }], notes: 'Follow the existing approved protocol; no automated scientific substitutions.', data: '' },
    ], orders: [], activity: [{ id: 'seed', text: 'Demo lab ready. Three experiments scheduled.', time: '09:00' }],
  };
  return propose(lab);
}
export function spent(lab: Lab) { return lab.initialSpent + lab.orders.filter(o => ['paid', 'received'].includes(o.status)).reduce((n, o) => n + o.total, 0); }
export function committed(lab: Lab) { return lab.orders.filter(o => o.status === 'approved').reduce((n, o) => n + o.total, 0); }
export function remaining(lab: Lab) { return lab.budget - spent(lab) - committed(lab); }
export function evaluate(lab: Lab, omitOrder?: string): Decision[] {
  return lab.supplies.map(supply => {
    const batches = lab.batches.filter(b => b.supply === supply.id).map(b => ({ ...b, arrives: lab.today }));
    for (const order of lab.orders.filter(o => o.id !== omitOrder && o.supply === supply.id && ['approved', 'paid'].includes(o.status))) {
      batches.push({ id: order.id, supply: supply.id, quantity: order.quantity, expires: '9999-12-31', arrives: order.eta });
    }
    batches.sort((a, b) => a.expires.localeCompare(b.expires));
    let demand = 0, shortage = 0, due = '';
    for (const exp of lab.experiments.filter(e => e.status === 'planned' && e.date <= datePlus(lab.today, 14)).sort((a, b) => a.date.localeCompare(b.date))) {
      let needed = exp.needs.filter(n => n.supply === supply.id).reduce((n, r) => n + r.quantity, 0);
      demand += needed;
      for (const batch of batches) {
        if (batch.expires < exp.date || batch.arrives > exp.date) continue;
        const used = Math.min(batch.quantity, needed);
        batch.quantity -= used;
        needed -= used;
      }
      if (needed && !due) due = exp.date;
      shortage += needed;
    }
    const quantity = Math.ceil(shortage / supply.pack) * supply.pack;
    const available = lab.batches.filter(b => b.supply === supply.id && b.expires >= lab.today).reduce((n, b) => n + b.quantity, 0);
    return { supply, demand, available, shortage, quantity, total: quantity / supply.pack * supply.price, due,
      late: !!due && datePlus(lab.today, supply.lead) > due,
      reason: shortage ? `${shortage} ${supply.unit} short against scheduled demand. ${quantity - shortage ? `${quantity - shortage} extra from supplier pack size.` : 'Exact demand match.'}` : 'Scheduled experiments covered by eligible stock and confirmed orders.' };
  });
}
function log(lab: Lab, text: string) {
  lab.activity.unshift({ id: id(), text, time: new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) });
  lab.activity = lab.activity.slice(0, 40);
}
function signature(d: Decision) { return JSON.stringify([d.quantity, d.total, d.supply.supplier, d.due]); }
export function propose(input: Lab): Lab {
  const lab = structuredClone(input);
  const decisions = evaluate(lab);
  for (const d of decisions) {
    const pending = lab.orders.find(o => o.supply === d.supply.id && o.status === 'pending');
    if (!d.shortage || d.late) {
      if (pending) { pending.status = 'rejected'; log(lab, `Proposal withdrawn: ${d.supply.name}. ${d.late ? 'Delivery misses experiment date.' : 'Demand covered.'}`); }
      continue;
    }
    if (pending?.signature === signature(d)) continue;
    if (pending) { pending.status = 'rejected'; log(lab, `Changed demand: replaced proposal for ${d.supply.name}.`); }
    lab.orders.push({ id: id(), supply: d.supply.id, quantity: d.quantity, total: d.total, supplier: d.supply.supplier,
      status: 'pending', reason: d.reason, eta: datePlus(lab.today, d.supply.lead), signature: signature(d) });
    log(lab, `Restock proposed: ${d.supply.name} · ${money(d.total)}.`);
  }
  return lab;
}
export function transition(input: Lab, orderId: string, action: 'approve' | 'reject' | 'pay' | 'fail' | 'receive', role: Role): Lab {
  if (role !== 'manager') throw new Error('Lab manager approval required. Switch demo role to continue.');
  const lab = structuredClone(input);
  const order = lab.orders.find(o => o.id === orderId);
  if (!order) throw new Error('Order not found.');
  const supply = lab.supplies.find(s => s.id === order.supply)!;
  const required = { approve: 'pending', reject: 'pending', pay: 'approved', fail: 'approved', receive: 'paid' };
  if (order.status !== required[action] && !(action === 'reject' && order.status === 'approved')) throw new Error('This action was already processed or is no longer available.');
  if (action === 'approve') {
    const decision = evaluate(lab).find(d => d.supply.id === order.supply)!;
    if (decision.late || signature(decision) !== order.signature) throw new Error('Stock or demand changed. Run stock check before approving.');
    if (order.total > remaining(lab)) throw new Error('Insufficient available budget. This purchase has not been approved.');
    order.status = 'approved';
  } else if (action === 'pay') {
    const decision = evaluate(lab, order.id).find(d => d.supply.id === order.supply)!;
    if (decision.late || signature(decision) !== order.signature) throw new Error('Demand changed after approval. Cancel approval and run a fresh stock check.');
    order.status = 'paid';
  }
  else if (action === 'fail') order.status = 'failed';
  else if (action === 'reject') order.status = 'rejected';
  else {
    order.status = 'received';
    lab.batches.push({ id: `REC-${order.id.slice(0, 6)}`, supply: order.supply, quantity: order.quantity, expires: datePlus(lab.today, 180) });
  }
  log(lab, `${supply.name}: ${order.status}${action === 'pay' ? ' · simulated payment' : action === 'fail' ? ' · reserved funds released' : ''}.`);
  return lab;
}
export function addExperiment(input: Lab, values: Omit<Experiment, 'id' | 'status'>): Lab {
  if (!values.name.trim() || values.name.length > 120) throw new Error('Enter an experiment name, up to 120 characters.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(values.date) || !Number.isFinite(Date.parse(values.date)) || new Date(values.date).toISOString().slice(0, 10) !== values.date || values.date < input.today) throw new Error('Choose a valid date on or after the demo date.');
  if (!values.needs.length || values.needs.some(n => !input.supplies.some(s => s.id === n.supply) || !Number.isSafeInteger(n.quantity) || n.quantity <= 0 || n.quantity > 1000000)) throw new Error('Choose known supplies and positive whole quantities.');
  if (values.data && !/^https?:\/\//.test(values.data)) throw new Error('Dataset link must start with https:// or http://.');
  const lab = structuredClone(input);
  lab.experiments.push({ ...values, id: id(), status: 'planned' });
  log(lab, `Experiment scheduled: ${values.name}.`);
  return propose(lab);
}
export function finishExperiment(input: Lab, experimentId: string, cancel = false): Lab {
  const lab = structuredClone(input);
  const exp = lab.experiments.find(e => e.id === experimentId);
  if (!exp || exp.status !== 'planned') throw new Error('Experiment is no longer planned.');
  if (!cancel) {
    for (const need of exp.needs) {
      let quantity = need.quantity;
      for (const batch of lab.batches.filter(b => b.supply === need.supply && b.expires >= exp.date).sort((a, b) => a.expires.localeCompare(b.expires))) {
        const used = Math.min(quantity, batch.quantity); batch.quantity -= used; quantity -= used;
      }
      if (quantity) throw new Error('Not enough eligible stock. Receive pending supplies before completing.');
    }
  }
  exp.status = cancel ? 'cancelled' : 'completed';
  log(lab, `${exp.name}: ${exp.status}${cancel ? '' : ' · planned quantities recorded as actual use'}.`);
  return propose(lab);
}
