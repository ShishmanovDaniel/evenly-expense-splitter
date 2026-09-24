import { useEffect, useMemo, useState } from "react";
import "./App.css";

// ========== Settings ==========
const STORAGE_KEY = "evenly-v2";
const OLD_STORAGE_KEY = "evenly-v1";

const CATEGORIES = [
  { id: "food", label: "Food and drinks", color: "#E8A33D" },
  { id: "lodging", label: "Lodging", color: "#5FA8D3" },
  { id: "transport", label: "Transport", color: "#9C6ADE" },
  { id: "activities", label: "Activities", color: "#4FB286" },
  { id: "other", label: "Other", color: "#B8BDB5" },
];
const categoryOf = (id) => CATEGORIES.find((c) => c.id === id) || CATEGORIES[4];

// ========== Helpers ==========
const makeId = () => Math.random().toString(36).slice(2, 10);

// All money is stored in cents (whole numbers) to avoid rounding errors.
const formatMoney = (cents) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

function parseMoney(text) {
  const n = parseFloat(String(text).replace(/[$,\s]/g, ""));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

const newTrip = (name) => ({ id: makeId(), name, people: [], expenses: [] });

// ========== Load saved data (and upgrade data from the first version) ==========
function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const data = JSON.parse(raw);
      if (Array.isArray(data.trips) && data.trips.length) return data;
    }
    const old = localStorage.getItem(OLD_STORAGE_KEY);
    if (old) {
      const data = JSON.parse(old);
      if (Array.isArray(data.people) && Array.isArray(data.expenses)) {
        const trip = { ...newTrip("My trip"), people: data.people,
          expenses: data.expenses.map((e) => ({ category: "other", ...e })) };
        return { trips: [trip], activeTripId: trip.id };
      }
    }
  } catch {
    // Ignore broken or unavailable storage
  }
  return null;
}

// ========== Money math ==========
// Split a total into near-equal shares; leftover cents go to the first people.
function splitCents(total, count) {
  const base = Math.floor(total / count);
  const leftover = total - base * count;
  return Array.from({ length: count }, (_, i) => base + (i < leftover ? 1 : 0));
}

// For each person: how much they paid, their fair share, and the difference.
function computeTotals(people, expenses) {
  const totals = Object.fromEntries(people.map((p) => [p.id, { paid: 0, share: 0 }]));
  for (const expense of expenses) {
    const sharers = expense.splitAmong.filter((id) => id in totals);
    if (sharers.length === 0 || !(expense.paidBy in totals)) continue;
    totals[expense.paidBy].paid += expense.amount;
    splitCents(expense.amount, sharers.length).forEach((part, i) => {
      totals[sharers[i]].share += part;
    });
  }
  return totals;
}

// Greedy settle-up: match the biggest debtor with the biggest creditor.
function settleUp(totals) {
  const owes = [];
  const owed = [];
  for (const [id, t] of Object.entries(totals)) {
    const balance = t.paid - t.share;
    if (balance < 0) owes.push({ id, amount: -balance });
    if (balance > 0) owed.push({ id, amount: balance });
  }
  owes.sort((a, b) => b.amount - a.amount);
  owed.sort((a, b) => b.amount - a.amount);

  const payments = [];
  let i = 0;
  let j = 0;
  while (i < owes.length && j < owed.length) {
    const pay = Math.min(owes[i].amount, owed[j].amount);
    payments.push({ from: owes[i].id, to: owed[j].id, amount: pay });
    owes[i].amount -= pay;
    owed[j].amount -= pay;
    if (owes[i].amount === 0) i++;
    if (owed[j].amount === 0) j++;
  }
  return payments;
}

// ========== Trip picker: switch, create and delete trips ==========
function TripBar({ trips, activeId, onSelect, onCreate, onDelete }) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");

  function submit(e) {
    e.preventDefault();
    const clean = name.trim();
    if (!clean) return;
    onCreate(clean);
    setName("");
    setCreating(false);
  }

  const active = trips.find((t) => t.id === activeId);

  return (
    <div className="trip-bar">
      <div className="trip-picker">
        <label htmlFor="trip-select">Trip</label>
        <select id="trip-select" value={activeId} onChange={(e) => onSelect(e.target.value)}>
          {trips.map((t) => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </div>

      {creating ? (
        <form className="inline-form trip-form" onSubmit={submit}>
          <label htmlFor="trip-name" className="visually-hidden">New trip name</label>
          <input id="trip-name" autoFocus value={name} maxLength={40}
            onChange={(e) => setName(e.target.value)} placeholder="Beach weekend" />
          <button type="submit" className="btn">Create trip</button>
          <button type="button" className="text-btn light" onClick={() => setCreating(false)}>Cancel</button>
        </form>
      ) : (
        <div className="trip-actions">
          <button type="button" className="btn" onClick={() => setCreating(true)}>New trip</button>
          {trips.length > 1 && (
            <button type="button" className="text-btn light"
              onClick={() => window.confirm(`Delete "${active.name}" and all its expenses?`) && onDelete(activeId)}>
              Delete this trip
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ========== People on the trip ==========
function PeopleCard({ people, expenses, onAdd, onRemove }) {
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  function handleAdd(e) {
    e.preventDefault();
    const clean = name.trim();
    if (!clean) return setError("Type a name first.");
    if (people.some((p) => p.name.toLowerCase() === clean.toLowerCase())) {
      return setError(`${clean} is already in the group.`);
    }
    onAdd(clean);
    setName("");
    setError("");
  }

  function handleRemove(person) {
    const involved = expenses.some(
      (ex) => ex.paidBy === person.id || ex.splitAmong.includes(person.id)
    );
    if (involved) {
      setError(`${person.name} is part of an expense. Delete those expenses first.`);
      return;
    }
    setError("");
    onRemove(person.id);
  }

  return (
    <section className="panel" aria-labelledby="people-title">
      <h2 id="people-title">Who's on the trip?</h2>
      <form className="inline-form" onSubmit={handleAdd}>
        <label htmlFor="person-name" className="visually-hidden">Name</label>
        <input id="person-name" value={name} onChange={(e) => setName(e.target.value)}
          placeholder="Add a name" maxLength={24} />
        <button type="submit" className="btn">Add person</button>
      </form>
      {error && <p className="error" role="alert">{error}</p>}
      {people.length === 0 ? (
        <p className="empty">Add at least two people to start splitting.</p>
      ) : (
        <ul className="chips">
          {people.map((p) => (
            <li key={p.id}>
              {p.name}
              <button type="button" className="chip-remove" onClick={() => handleRemove(p)}
                aria-label={`Remove ${p.name}`}>×</button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ========== Add or edit an expense ==========
function ExpenseForm({ people, editing, onSave, onCancelEdit }) {
  const blank = { description: "", amount: "", paidBy: "", category: "food", excluded: new Set() };
  const [form, setForm] = useState(blank);
  const [errors, setErrors] = useState({});

  // When an expense is picked for editing, load it into the form
  useEffect(() => {
    if (editing) {
      setForm({
        description: editing.description,
        amount: (editing.amount / 100).toFixed(2),
        paidBy: editing.paidBy,
        category: editing.category,
        excluded: new Set(people.filter((p) => !editing.splitAmong.includes(p.id)).map((p) => p.id)),
      });
      setErrors({});
    }
  }, [editing, people]);

  const update = (field, value) => setForm((f) => ({ ...f, [field]: value }));
  const payer = people.some((p) => p.id === form.paidBy) ? form.paidBy : people[0]?.id || "";
  const sharers = people.filter((p) => !form.excluded.has(p.id));

  function toggle(id) {
    setForm((f) => {
      const next = new Set(f.excluded);
      next.has(id) ? next.delete(id) : next.add(id);
      return { ...f, excluded: next };
    });
  }

  function reset() {
    setForm(blank);
    setErrors({});
  }

  function handleSubmit(e) {
    e.preventDefault();
    const cents = parseMoney(form.amount);
    const nextErrors = {};
    if (!form.description.trim()) nextErrors.description = "Say what it was for, like \"Dinner\".";
    if (cents === null || cents <= 0) nextErrors.amount = "Enter an amount above $0.";
    if (sharers.length === 0) nextErrors.split = "Pick at least one person to split with.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) return;

    onSave({
      id: editing ? editing.id : makeId(),
      description: form.description.trim(),
      amount: cents,
      paidBy: payer,
      category: form.category,
      splitAmong: sharers.map((p) => p.id),
    });
    reset();
  }

  if (people.length < 2) return null;

  return (
    <section className={"panel" + (editing ? " is-editing" : "")} aria-labelledby="expense-title">
      <h2 id="expense-title">{editing ? "Edit expense" : "Add an expense"}</h2>
      <form className="expense-form" onSubmit={handleSubmit} noValidate>
        <div className="field wide">
          <label htmlFor="desc">What was it?</label>
          <input id="desc" value={form.description} onChange={(e) => update("description", e.target.value)}
            placeholder="Gas, groceries, Airbnb" aria-invalid={!!errors.description} />
          {errors.description && <span className="error">{errors.description}</span>}
        </div>
        <div className="field">
          <label htmlFor="amount">Amount</label>
          <input id="amount" inputMode="decimal" value={form.amount}
            onChange={(e) => update("amount", e.target.value)} placeholder="$0.00" aria-invalid={!!errors.amount} />
          {errors.amount && <span className="error">{errors.amount}</span>}
        </div>
        <div className="field">
          <label htmlFor="category">Category</label>
          <select id="category" value={form.category} onChange={(e) => update("category", e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </div>
        <div className="field wide">
          <label htmlFor="payer">Paid by</label>
          <select id="payer" value={payer} onChange={(e) => update("paidBy", e.target.value)}>
            {people.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>
        </div>
        <fieldset className="field split">
          <legend>Split between</legend>
          <div className="checks">
            {people.map((p) => (
              <label key={p.id} className="check">
                <input type="checkbox" checked={!form.excluded.has(p.id)} onChange={() => toggle(p.id)} />
                {p.name}
              </label>
            ))}
          </div>
          {errors.split && <span className="error">{errors.split}</span>}
        </fieldset>
        <div className="form-buttons">
          <button type="submit" className="btn btn-accent">{editing ? "Save changes" : "Add expense"}</button>
          {editing && (
            <button type="button" className="text-btn light" onClick={() => { reset(); onCancelEdit(); }}>
              Cancel editing
            </button>
          )}
        </div>
      </form>
    </section>
  );
}

// ========== Tab 1: the receipt and settle-up plan ==========
function ReceiptView({ people, expenses, payments, nameOf, onEdit, onDelete }) {
  const [filter, setFilter] = useState("all");
  const shown = filter === "all" ? expenses : expenses.filter((e) => e.category === filter);
  const total = expenses.reduce((sum, e) => sum + e.amount, 0);
  const usedCategories = CATEGORIES.filter((c) => expenses.some((e) => e.category === c.id));

  return (
    <>
      {usedCategories.length > 1 && (
        <div className="receipt-filter">
          <label htmlFor="cat-filter">Show</label>
          <select id="cat-filter" value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="all">All categories</option>
            {usedCategories.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </div>
      )}

      <ul className="lines">
        {shown.map((e) => (
          <li key={e.id}>
            <div className="line-main">
              <span>
                <span className="dot" style={{ background: categoryOf(e.category).color }} aria-hidden="true" />
                {e.description}
              </span>
              <span className="amt">{formatMoney(e.amount)}</span>
            </div>
            <div className="line-meta">
              <span>{nameOf(e.paidBy)} paid, split {e.splitAmong.length} ways</span>
              <span className="line-actions">
                <button type="button" className="text-btn" onClick={() => onEdit(e)}
                  aria-label={`Edit ${e.description}`}>Edit</button>
                <button type="button" className="text-btn" onClick={() => onDelete(e.id)}
                  aria-label={`Delete ${e.description}`}>Delete</button>
              </span>
            </div>
          </li>
        ))}
      </ul>
      <div className="total">
        <span>Trip total</span>
        <span className="amt">{formatMoney(total)}</span>
      </div>

      <h3>Settle up</h3>
      {payments.length === 0 ? (
        <p className="even">Everyone's even. Nobody owes anything.</p>
      ) : (
        <ul className="payments">
          {payments.map((p, i) => (
            <li key={i}>
              <span><strong>{nameOf(p.from)}</strong> pays <strong>{nameOf(p.to)}</strong></span>
              <span className="amt">{formatMoney(p.amount)}</span>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

// ========== Tab 2: spending breakdown ==========
function BreakdownView({ people, expenses, totals }) {
  const total = expenses.reduce((sum, e) => sum + e.amount, 0);
  const byCategory = CATEGORIES.map((c) => ({
    ...c,
    amount: expenses.filter((e) => e.category === c.id).reduce((s, e) => s + e.amount, 0),
  })).filter((c) => c.amount > 0).sort((a, b) => b.amount - a.amount);

  return (
    <>
      <h3 className="first">Where the money went</h3>
      <div className="stack-bar" role="img"
        aria-label={byCategory.map((c) => `${c.label} ${formatMoney(c.amount)}`).join(", ")}>
        {byCategory.map((c) => (
          <span key={c.id} style={{ width: `${(c.amount / total) * 100}%`, background: c.color }} />
        ))}
      </div>
      <ul className="legend">
        {byCategory.map((c) => (
          <li key={c.id}>
            <span><span className="dot" style={{ background: c.color }} aria-hidden="true" />{c.label}</span>
            <span className="amt">{formatMoney(c.amount)} <small>{Math.round((c.amount / total) * 100)}%</small></span>
          </li>
        ))}
      </ul>

      <h3>Per person</h3>
      <div className="table-scroll">
        <table className="person-table">
          <thead>
            <tr><th scope="col">Name</th><th scope="col">Paid</th><th scope="col">Share</th><th scope="col">Balance</th></tr>
          </thead>
          <tbody>
            {people.map((p) => {
              const t = totals[p.id];
              const balance = t.paid - t.share;
              return (
                <tr key={p.id}>
                  <th scope="row">{p.name}</th>
                  <td>{formatMoney(t.paid)}</td>
                  <td>{formatMoney(t.share)}</td>
                  <td className={balance > 0 ? "pos" : balance < 0 ? "neg" : ""}>
                    {balance > 0 ? "+" : ""}{formatMoney(balance)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="hint">Positive balance: the group owes them. Negative: they owe the group.</p>
    </>
  );
}

// ========== The receipt card with tabs ==========
function Receipt({ trip, onEdit, onDelete }) {
  const [tab, setTab] = useState("receipt");
  const [copied, setCopied] = useState(false);
  const { people, expenses } = trip;
  const nameOf = (id) => people.find((p) => p.id === id)?.name ?? "Someone";
  const totals = useMemo(() => computeTotals(people, expenses), [people, expenses]);
  const payments = useMemo(() => settleUp(totals), [totals]);

  // Build a plain-text summary people can paste into a group chat
  async function copySummary() {
    const total = expenses.reduce((s, e) => s + e.amount, 0);
    const lines = [
      `${trip.name}: ${formatMoney(total)} total`,
      ...payments.map((p) => `${nameOf(p.from)} pays ${nameOf(p.to)} ${formatMoney(p.amount)}`),
    ];
    if (!payments.length) lines.push("Everyone's even.");
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      window.prompt("Copy this summary:", lines.join("\n"));
    }
  }

  return (
    <section className="receipt" aria-labelledby="receipt-title">
      <h2 id="receipt-title">{trip.name}</h2>

      {expenses.length === 0 ? (
        <p className="empty">Expenses you add will show up here.</p>
      ) : (
        <>
          <div className="tabs" role="tablist" aria-label="Receipt views">
            <button role="tab" id="tab-receipt" aria-selected={tab === "receipt"} aria-controls="panel-view"
              onClick={() => setTab("receipt")}>Receipt</button>
            <button role="tab" id="tab-breakdown" aria-selected={tab === "breakdown"} aria-controls="panel-view"
              onClick={() => setTab("breakdown")}>Breakdown</button>
          </div>
          <div id="panel-view" role="tabpanel" aria-labelledby={`tab-${tab}`}>
            {tab === "receipt" ? (
              <ReceiptView people={people} expenses={expenses} payments={payments}
                nameOf={nameOf} onEdit={onEdit} onDelete={onDelete} />
            ) : (
              <BreakdownView people={people} expenses={expenses} totals={totals} />
            )}
          </div>
          <button type="button" className="copy-btn" onClick={copySummary}>
            {copied ? "Copied" : "Copy summary for the group chat"}
          </button>
        </>
      )}
    </section>
  );
}

// ========== App ==========
export default function App() {
  const saved = useMemo(loadSaved, []);
  const [trips, setTrips] = useState(() => saved?.trips ?? [newTrip("My trip")]);
  const [activeId, setActiveId] = useState(() => saved?.activeTripId ?? trips[0].id);
  const [editing, setEditing] = useState(null);

  const trip = trips.find((t) => t.id === activeId) || trips[0];

  // Save everything whenever something changes
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ trips, activeTripId: trip.id }));
    } catch {
      // Storage can be unavailable (private mode). The app still works without it.
    }
  }, [trips, trip.id]);

  // Update only the active trip
  const updateTrip = (changes) =>
    setTrips((all) => all.map((t) => (t.id === trip.id ? { ...t, ...changes(t) } : t)));

  function saveExpense(expense) {
    updateTrip((t) => ({
      expenses: t.expenses.some((e) => e.id === expense.id)
        ? t.expenses.map((e) => (e.id === expense.id ? expense : e))
        : [...t.expenses, expense],
    }));
    setEditing(null);
  }

  function deleteExpense(id) {
    updateTrip((t) => ({ expenses: t.expenses.filter((e) => e.id !== id) }));
    if (editing?.id === id) setEditing(null);
  }

  function createTrip(name) {
    const t = newTrip(name);
    setTrips((all) => [...all, t]);
    setActiveId(t.id);
    setEditing(null);
  }

  function deleteTrip(id) {
    const remaining = trips.filter((t) => t.id !== id);
    setTrips(remaining);
    setActiveId(remaining[0].id);
    setEditing(null);
  }

  return (
    <div className="app">
      <header className="app-header">
        <h1>Evenly</h1>
        <p>Add who's on the trip and what everyone paid. Evenly works out the fewest payments to square up.</p>
      </header>

      <TripBar trips={trips} activeId={trip.id}
        onSelect={(id) => { setActiveId(id); setEditing(null); }}
        onCreate={createTrip} onDelete={deleteTrip} />

      <main className="layout">
        <div className="col">
          <PeopleCard
            people={trip.people}
            expenses={trip.expenses}
            onAdd={(name) => updateTrip((t) => ({ people: [...t.people, { id: makeId(), name }] }))}
            onRemove={(id) => updateTrip((t) => ({ people: t.people.filter((p) => p.id !== id) }))}
          />
          <ExpenseForm key={trip.id} people={trip.people} editing={editing}
            onSave={saveExpense} onCancelEdit={() => setEditing(null)} />
        </div>
        <Receipt key={trip.id} trip={trip}
          onEdit={(e) => { setEditing(e); document.getElementById("desc")?.focus(); }}
          onDelete={deleteExpense} />
      </main>
    </div>
  );
}
