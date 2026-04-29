require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const dayjs = require('dayjs');
const { connectMongo, mongoose } = require('./mongo/connection');
const models = require('./mongo/models');
const { toApi, toApiMany, pickPublicUser, boolFromRequest } = require('./mongo/serialize');
const { authRequired, signToken } = require('./middleware/auth');
const { nowIso, parsePagination } = require('./lib/utils');

const {
  User,
  Client,
  TrainingType,
  Package,
  Purchase,
  Trainer,
  Branch,
  Booking,
  Payment,
  Expense
} = models;

const app = express();
const PORT = process.env.PORT || 4000;
const PAYMENT_METHODS = ['Cash', 'Whish'];
const BOOKING_STATUSES = ['booked', 'completed', 'cancelled', 'no-show'];
const SESSION_DEDUCTING_BOOKING_STATUSES = new Set(['completed', 'no-show']);

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

function modelSort(field, direction = 1) {
  return { [field]: direction, legacyId: direction };
}

async function nextLegacyId(Model, session = null) {
  const last = await Model.findOne({}, { legacyId: 1 }).sort({ legacyId: -1 }).session(session).lean();
  return (last?.legacyId || 0) + 1;
}

function regexSearch(q) {
  return new RegExp(String(q || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
}

function asBoolNumber(v) {
  return v ? 1 : 0;
}

function effectivePurchaseStatus(p, now = dayjs()) {
  if (!p) return 'active';
  if (p.status !== 'active') return p.status;
  if (p.expiry_date && dayjs(p.expiry_date).isValid() && dayjs(p.expiry_date).isBefore(now, 'day')) return 'expired';
  return p.status;
}

function packageSnapshotPrice(purchase, pack) {
  const snapshotPrice = Number(purchase?.package_snapshot?.price);
  if (Number.isFinite(snapshotPrice)) return snapshotPrice;
  const livePrice = Number(pack?.price);
  return Number.isFinite(livePrice) ? livePrice : 0;
}

function paymentStatus(totalPaid, packagePrice) {
  if (Number(totalPaid) === 0) return 'Unpaid';
  if (Number(totalPaid) < Number(packagePrice)) return 'Partially Paid';
  return 'Fully Paid';
}

function bookingStatusUsesSession(status) {
  return SESSION_DEDUCTING_BOOKING_STATUSES.has(status);
}

function isActiveUnexpiredPurchase(purchase, date = dayjs()) {
  if (!purchase || purchase.status !== 'active') return false;
  if (purchase.expiry_date && dayjs(purchase.expiry_date).isValid() && dayjs(purchase.expiry_date).isBefore(dayjs(date), 'day')) return false;
  return true;
}

function fullName(row) {
  return row ? `${row.first_name || ''} ${row.last_name || ''}`.trim() : null;
}

async function paginateQuery(Model, filter, query, sort, projection = null) {
  const { page, pageSize, offset } = parsePagination(query);
  const [data, total] = await Promise.all([
    Model.find(filter, projection).sort(sort).skip(offset).limit(pageSize).lean(),
    Model.countDocuments(filter)
  ]);
  return { data: toApiMany(data), pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) || 1 } };
}

async function purchaseRows(purchases) {
  const rows = Array.isArray(purchases) ? purchases : [purchases];
  const clientIds = [...new Set(rows.map((p) => p.client_id).filter(Boolean))];
  const packageIds = [...new Set(rows.map((p) => p.package_id).filter(Boolean))];
  const typeIds = [...new Set(rows.map((p) => p.training_type_id).filter(Boolean))];
  const purchaseIds = rows.map((p) => p.legacyId);

  const [clients, packages, types, payments, bookingCounts] = await Promise.all([
    Client.find({ legacyId: { $in: clientIds } }).lean(),
    Package.find({ legacyId: { $in: packageIds } }).lean(),
    TrainingType.find({ legacyId: { $in: typeIds } }).lean(),
    Payment.aggregate([
      { $match: { package_purchase_id: { $in: purchaseIds } } },
      { $group: { _id: '$package_purchase_id', total_paid: { $sum: '$amount_paid' }, payment_count: { $sum: 1 } } }
    ]),
    Booking.aggregate([
      { $match: { package_purchase_id: { $in: purchaseIds } } },
      { $group: { _id: '$package_purchase_id', booking_count: { $sum: 1 } } }
    ])
  ]);

  const clientById = new Map(clients.map((x) => [x.legacyId, x]));
  const packageById = new Map(packages.map((x) => [x.legacyId, x]));
  const typeById = new Map(types.map((x) => [x.legacyId, x]));
  const paymentByPurchase = new Map(payments.map((x) => [x._id, x]));
  const bookingByPurchase = new Map(bookingCounts.map((x) => [x._id, x]));

  return rows.map((p) => {
    const pack = packageById.get(p.package_id);
    const price = packageSnapshotPrice(p, pack);
    const pay = paymentByPurchase.get(p.legacyId) || {};
    const totalPaid = Number(pay.total_paid || 0);
    const remainingBalance = Math.max(price - totalPaid, 0);
    return {
      ...toApi(p),
      stored_status: p.status,
      status: effectivePurchaseStatus(p),
      client_name: fullName(clientById.get(p.client_id)) || '-',
      package_name: pack?.name || p.package_snapshot?.name || '-',
      training_type_name: typeById.get(p.training_type_id)?.name || '-',
      package_price: price,
      total_paid: totalPaid,
      payment_count: Number(pay.payment_count || 0),
      booking_count: Number(bookingByPurchase.get(p.legacyId)?.booking_count || 0),
      remaining_balance: remainingBalance,
      payment_status: paymentStatus(totalPaid, price)
    };
  });
}

async function enrichPayments(payments) {
  const rows = Array.isArray(payments) ? payments : [payments];
  const clientIds = [...new Set(rows.map((p) => p.client_id).filter(Boolean))];
  const branchIds = [...new Set(rows.map((p) => p.branch_id).filter(Boolean))];
  const [clients, branches] = await Promise.all([
    Client.find({ legacyId: { $in: clientIds } }).lean(),
    Branch.find({ legacyId: { $in: branchIds } }).lean()
  ]);
  const clientById = new Map(clients.map((x) => [x.legacyId, x]));
  const branchById = new Map(branches.map((x) => [x.legacyId, x]));
  return rows.map((p) => ({ ...toApi(p), client_name: fullName(clientById.get(p.client_id)) || null, branch_name: branchById.get(p.branch_id)?.name || null }));
}

async function enrichExpenses(expenses) {
  const rows = Array.isArray(expenses) ? expenses : [expenses];
  const branchIds = [...new Set(rows.map((e) => e.branch_id).filter(Boolean))];
  const branches = await Branch.find({ legacyId: { $in: branchIds } }).lean();
  const branchById = new Map(branches.map((x) => [x.legacyId, x]));
  return rows.map((e) => ({ ...toApi(e), branch_name: branchById.get(e.branch_id)?.name || null }));
}

async function enrichBookings(bookings) {
  const rows = Array.isArray(bookings) ? bookings : [bookings];
  const clientIds = [...new Set(rows.map((b) => b.client_id).filter(Boolean))];
  const trainerIds = [...new Set(rows.map((b) => b.trainer_id).filter(Boolean))];
  const branchIds = [...new Set(rows.map((b) => b.branch_id).filter(Boolean))];
  const typeIds = [...new Set(rows.map((b) => b.training_type_id).filter(Boolean))];
  const [clients, trainers, branches, types] = await Promise.all([
    Client.find({ legacyId: { $in: clientIds } }).lean(),
    Trainer.find({ legacyId: { $in: trainerIds } }).lean(),
    Branch.find({ legacyId: { $in: branchIds } }).lean(),
    TrainingType.find({ legacyId: { $in: typeIds } }).lean()
  ]);
  const clientById = new Map(clients.map((x) => [x.legacyId, x]));
  const trainerById = new Map(trainers.map((x) => [x.legacyId, x]));
  const branchById = new Map(branches.map((x) => [x.legacyId, x]));
  const typeById = new Map(types.map((x) => [x.legacyId, x]));
  return rows.map((b) => ({
    ...toApi(b),
    completed_session_deducted: asBoolNumber(b.completed_session_deducted),
    client_name: fullName(clientById.get(b.client_id)) || '-',
    trainer_name: fullName(trainerById.get(b.trainer_id)) || '-',
    branch_name: branchById.get(b.branch_id)?.name || '-',
    training_type_name: typeById.get(b.training_type_id)?.name || '-'
  }));
}

app.post('/api/auth/login', async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ message: 'Username and password required' });
    const u = await User.findOne({ username, active: true }).lean();
    if (!u || !u.password_hash) return res.status(401).json({ message: 'Invalid credentials' });
    if (!bcrypt.compareSync(password, u.password_hash)) return res.status(401).json({ message: 'Invalid credentials' });
    const user = toApi(u);
    const token = signToken(user);
    res.json({ token, user: { id: user.id, username: user.username, role: user.role } });
  } catch (err) {
    console.error('[auth/login] unexpected error:', err.stack || err);
    res.status(500).json({ message: 'Internal server error' });
  }
});

app.get('/api/auth/me', authRequired, async (req, res) => {
  const user = await User.findOne({ legacyId: Number(req.user.id) }).lean();
  res.json(pickPublicUser(user));
});

app.use('/api', authRequired);

app.get('/api/lookups', async (_req, res) => {
  const [branches, trainingTypes, clients, trainers, packages] = await Promise.all([
    Branch.find({ active: true }).sort(modelSort('name')).lean(),
    TrainingType.find({ active: true }).sort(modelSort('name')).lean(),
    Client.find({}, 'legacyId first_name last_name phone').sort({ first_name: 1, last_name: 1, legacyId: 1 }).lean(),
    Trainer.find({ active: true }).sort({ first_name: 1, last_name: 1, legacyId: 1 }).lean(),
    Package.find({ active: true }).sort(modelSort('name')).lean()
  ]);
  const typeById = new Map(trainingTypes.map((t) => [t.legacyId, t]));
  res.json({
    branches: toApiMany(branches),
    trainingTypes: toApiMany(trainingTypes),
    clients: toApiMany(clients),
    trainers: toApiMany(trainers),
    packages: packages.map((p) => ({ ...toApi(p), training_type_name: typeById.get(p.training_type_id)?.name || '-' })),
    paymentMethods: PAYMENT_METHODS,
    bookingStatuses: BOOKING_STATUSES
  });
});

app.get('/api/dashboard', async (req, res) => {
  const d0 = dayjs().startOf('day').toISOString();
  const d1 = dayjs().endOf('day').toISOString();
  const m0 = dayjs().startOf('month').toISOString();
  const m1 = dayjs().endOf('month').toISOString();
  const w1 = dayjs().endOf('week').toISOString();
  const financialBranches = toApiMany(await Branch.find({}).sort(modelSort('name')).lean()).map(({ id, name }) => ({ id, name }));
  const hasBranchFilter = req.query.branch_id !== undefined && req.query.branch_id !== '';
  const branchId = hasBranchFilter ? Number(req.query.branch_id) : null;
  if (hasBranchFilter && (!Number.isInteger(branchId) || !financialBranches.some((b) => Number(b.id) === branchId))) {
    return res.status(400).json({ message: 'Invalid branch' });
  }
  const paymentMonthFilter = { payment_date: { $gte: m0, $lte: m1 }, ...(hasBranchFilter ? { branch_id: branchId } : {}) };
  const expenseMonthFilter = { date: { $gte: m0, $lte: m1 }, ...(hasBranchFilter ? { branch_id: branchId } : {}) };
  const sumField = async (Model, filter, field) => {
    const [row] = await Model.aggregate([{ $match: filter }, { $group: { _id: null, v: { $sum: `$${field}` } } }]);
    return Number(row?.v || 0);
  };
  const [paymentsThisMonth, expensesThisMonth, totalClients, totalPaymentsReceived, totalExpenses, todaysBookings, upcomingSessionsWeek, recentPaymentsRaw, recentExpensesRaw, allBookings, allTypes, allBranches] = await Promise.all([
    sumField(Payment, paymentMonthFilter, 'amount_paid'),
    sumField(Expense, expenseMonthFilter, 'amount'),
    Client.countDocuments(),
    sumField(Payment, {}, 'amount_paid'),
    sumField(Expense, {}, 'amount'),
    Booking.countDocuments({ start_at: { $gte: d0, $lte: d1 } }),
    Booking.countDocuments({ status: 'booked', start_at: { $gte: d0, $lte: w1 } }),
    Payment.find({}).sort({ payment_date: -1, legacyId: -1 }).limit(8).lean(),
    Expense.find({}).sort({ date: -1, legacyId: -1 }).limit(8).lean(),
    Booking.find({}).lean(),
    TrainingType.find({}).lean(),
    Branch.find({}).sort(modelSort('name')).lean()
  ]);
  const typeById = new Map(allTypes.map((t) => [t.legacyId, t.name]));
  const sessionCounts = new Map();
  for (const booking of allBookings) sessionCounts.set(booking.training_type_id, (sessionCounts.get(booking.training_type_id) || 0) + 1);
  const sessionsByTrainingType = [...sessionCounts.entries()].map(([id, count]) => ({ name: typeById.get(id) || '-', count })).sort((a, b) => b.count - a.count);
  const branchPerformance = await Promise.all(allBranches.map(async (branch) => {
    const [payments_total, expenses_total] = await Promise.all([
      sumField(Payment, { branch_id: branch.legacyId }, 'amount_paid'),
      sumField(Expense, { branch_id: branch.legacyId }, 'amount')
    ]);
    return { id: branch.legacyId, name: branch.name, payments_total, expenses_total, net_total: payments_total - expenses_total };
  }));
  const financialSnapshot = { branch_id: branchId, paymentsThisMonth, expensesThisMonth, netThisMonth: paymentsThisMonth - expensesThisMonth };
  res.json({
    totalClients,
    activeClients: totalClients,
    totalPaymentsReceived,
    paymentsThisMonth,
    totalExpenses,
    expensesThisMonth,
    netThisMonth: financialSnapshot.netThisMonth,
    financialBranches,
    financialSnapshot,
    todaysBookings,
    upcomingSessionsWeek,
    sessionsByTrainingType,
    branchPerformance,
    recentPayments: await enrichPayments(recentPaymentsRaw),
    recentExpenses: await enrichExpenses(recentExpensesRaw)
  });
});

function crud(name, cfg) {
  app.get(`/api/${name}`, async (req, res) => {
    const q = (req.query.q || '').trim();
    const filter = cfg.search && q ? { $or: cfg.search.map((f) => ({ [f]: regexSearch(q) })) } : {};
    const result = await paginateQuery(cfg.Model, filter, req.query, cfg.sort);
    if (cfg.afterList) result.data = await cfg.afterList(result.data);
    res.json(result);
  });
  app.post(`/api/${name}`, async (req, res) => {
    const b = req.body || {};
    for (const f of cfg.required || []) if (b[f] === undefined || b[f] === '') return res.status(400).json({ message: `${f} required` });
    try {
      const now = nowIso();
      const payload = { legacyId: await nextLegacyId(cfg.Model), created_at: now, updated_at: now };
      for (const f of cfg.fields) {
        let v = b[f];
        if (cfg.bool?.includes(f)) v = boolFromRequest(v, true);
        if (cfg.number?.includes(f)) v = v === '' || v === null || v === undefined ? null : Number(v);
        if (cfg.arrayNumber?.includes(f)) v = (v || []).map(Number);
        payload[f] = v ?? null;
      }
      if (cfg.beforeSave) await cfg.beforeSave(payload);
      const doc = await cfg.Model.create(payload);
      res.status(201).json(toApi(doc));
    } catch (err) {
      res.status(400).json({ message: err.code === 11000 ? 'Already exists' : (err.message || 'Invalid request') });
    }
  });
  app.put(`/api/${name}/:id`, async (req, res) => {
    const id = Number(req.params.id);
    const ex = await cfg.Model.findOne({ legacyId: id });
    if (!ex) return res.status(404).json({ message: 'Not found' });
    const patch = { updated_at: nowIso() };
    for (const f of cfg.fields) if (req.body[f] !== undefined) {
      let v = req.body[f];
      if (cfg.bool?.includes(f)) v = boolFromRequest(v, false);
      if (cfg.number?.includes(f)) v = v === '' || v === null ? null : Number(v);
      if (cfg.arrayNumber?.includes(f)) v = (v || []).map(Number);
      patch[f] = v;
    }
    if (cfg.beforeSave) await cfg.beforeSave(patch);
    const out = await cfg.Model.findOneAndUpdate({ legacyId: id }, { $set: patch }, { new: true });
    res.json(toApi(out));
  });
  app.delete(`/api/${name}/:id`, async (req, res) => {
    await cfg.Model.deleteOne({ legacyId: Number(req.params.id) });
    res.json({ ok: true });
  });
}

crud('clients', { Model: Client, fields: ['first_name', 'last_name', 'phone', 'notes'], required: ['first_name', 'last_name', 'phone'], search: ['first_name', 'last_name', 'phone'], sort: { first_name: 1, last_name: 1, legacyId: 1 } });
crud('training-types', { Model: TrainingType, fields: ['name', 'duration_minutes', 'active'], required: ['name', 'duration_minutes'], bool: ['active'], number: ['duration_minutes'], search: ['name'], sort: modelSort('name') });
crud('branches', { Model: Branch, fields: ['name', 'active'], required: ['name'], bool: ['active'], search: ['name'], sort: modelSort('name') });
crud('packages', {
  Model: Package,
  fields: ['name', 'training_type_id', 'sessions_count', 'price', 'description', 'active'],
  required: ['name', 'training_type_id', 'sessions_count', 'price'],
  bool: ['active'],
  number: ['training_type_id', 'sessions_count', 'price'],
  search: ['name'],
  sort: modelSort('name'),
  beforeSave: async (payload) => {
    if (payload.training_type_id !== undefined) {
      const tt = await TrainingType.findOne({ legacyId: payload.training_type_id });
      if (!tt) throw new Error('Training type not found');
      payload.trainingType = tt._id;
    }
  }
});
crud('trainers', {
  Model: Trainer,
  fields: ['first_name', 'last_name', 'phone', 'supported_training_type_ids', 'branch_ids', 'notes', 'active'],
  required: ['first_name', 'last_name'],
  bool: ['active'],
  arrayNumber: ['supported_training_type_ids', 'branch_ids'],
  search: ['first_name', 'last_name', 'phone'],
  sort: { first_name: 1, last_name: 1, legacyId: 1 },
  beforeSave: async (payload) => {
    if (payload.supported_training_type_ids) payload.supportedTrainingTypes = (await TrainingType.find({ legacyId: { $in: payload.supported_training_type_ids } }, '_id')).map((x) => x._id);
    if (payload.branch_ids) payload.branches = (await Branch.find({ legacyId: { $in: payload.branch_ids } }, '_id')).map((x) => x._id);
  }
});

app.get('/api/users', async (_req, res) => {
  res.json(toApiMany(await User.find({}, 'legacyId username role active created_at updated_at').sort(modelSort('username')).lean()));
});
app.post('/api/users', async (req, res) => {
  const { username, password, role, active } = req.body || {};
  if (!username || !password || !role) return res.status(400).json({ message: 'Missing required fields' });
  try {
    const now = nowIso();
    const doc = await User.create({ legacyId: await nextLegacyId(User), username, password_hash: bcrypt.hashSync(password, 10), role, active: boolFromRequest(active, true), created_at: now, updated_at: now });
    res.status(201).json(pickPublicUser(doc));
  } catch {
    res.status(400).json({ message: 'Username already exists' });
  }
});
app.put('/api/users/:id', async (req, res) => {
  const id = Number(req.params.id);
  const ex = await User.findOne({ legacyId: id });
  if (!ex) return res.status(404).json({ message: 'Not found' });
  const patch = {
    username: req.body.username ?? ex.username,
    password_hash: req.body.password ? bcrypt.hashSync(req.body.password, 10) : ex.password_hash,
    role: req.body.role ?? ex.role,
    active: req.body.active === undefined ? ex.active : boolFromRequest(req.body.active, false),
    updated_at: nowIso()
  };
  res.json(pickPublicUser(await User.findOneAndUpdate({ legacyId: id }, { $set: patch }, { new: true })));
});
app.delete('/api/users/:id', async (req, res) => { await User.deleteOne({ legacyId: Number(req.params.id) }); res.json({ ok: true }); });

app.get('/api/clients/:id', async (req, res) => {
  const clientId = Number(req.params.id);
  const client = await Client.findOne({ legacyId: clientId }).lean();
  if (!client) return res.status(404).json({ message: 'Client not found' });
  const [purchasesRaw, paymentsRaw, sessionsRaw] = await Promise.all([
    Purchase.find({ client_id: clientId }).sort({ purchase_date: -1, legacyId: -1 }).lean(),
    Payment.find({ client_id: clientId }).sort({ payment_date: -1, legacyId: -1 }).lean(),
    Booking.find({ client_id: clientId }).sort({ start_at: -1, legacyId: -1 }).lean()
  ]);
  const purchases = await purchaseRows(purchasesRaw);
  const payments = await enrichPayments(paymentsRaw);
  const sessions = await enrichBookings(sessionsRaw);
  const now = dayjs();
  res.json({
    client: toApi(client),
    purchases,
    payments,
    usedSessions: purchases.reduce((s, x) => s + Number(x.sessions_used || 0), 0),
    remainingSessions: purchases.reduce((s, x) => s + Number(x.sessions_remaining || 0), 0),
    upcomingSessions: sessions.filter((s) => dayjs(s.start_at).isAfter(now)),
    pastSessions: sessions.filter((s) => !dayjs(s.start_at).isAfter(now))
  });
});

app.get('/api/purchases', async (req, res) => {
  const filter = {};
  if (req.query.client_id) filter.client_id = Number(req.query.client_id);
  const { page, pageSize, offset } = parsePagination(req.query);
  const [rows, total] = await Promise.all([
    Purchase.find(filter).sort({ purchase_date: -1, legacyId: -1 }).skip(offset).limit(pageSize).lean(),
    Purchase.countDocuments(filter)
  ]);
  res.json({ data: await purchaseRows(rows), pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) || 1 } });
});

app.get('/api/purchases/:id/receipt', async (req, res) => {
  const id = Number(req.params.id);
  const purchase = await Purchase.findOne({ legacyId: id }).lean();
  if (!purchase) return res.status(404).json({ message: 'Purchase not found' });
  const [row] = await purchaseRows(purchase);
  const [client, pack, tt, paymentsRaw] = await Promise.all([
    Client.findOne({ legacyId: purchase.client_id }).lean(),
    Package.findOne({ legacyId: purchase.package_id }).lean(),
    TrainingType.findOne({ legacyId: purchase.training_type_id }).lean(),
    Payment.find({ package_purchase_id: id }).sort({ payment_date: 1, legacyId: 1 }).lean()
  ]);
  const payments = await enrichPayments(paymentsRaw);
  res.json({
    business: { name: 'EZ Gym' },
    receipt: { number: `PUR-${purchase.legacyId}`, title: 'Package Purchase Receipt', generated_at: nowIso() },
    client: { id: client?.legacyId, name: fullName(client), first_name: client?.first_name, last_name: client?.last_name, phone: client?.phone, notes: client?.notes },
    package: { id: pack?.legacyId, name: pack?.name || purchase.package_snapshot?.name, training_type_id: tt?.legacyId, training_type_name: tt?.name, current_price: pack?.price, current_sessions: pack?.sessions_count, description: pack?.description },
    purchase: { id: purchase.legacyId, purchase_date: purchase.purchase_date, expiry_date: purchase.expiry_date, status: row.status, stored_status: purchase.status, sessions_purchased: purchase.sessions_purchased, sessions_used: purchase.sessions_used, sessions_remaining: purchase.sessions_remaining, package_price: row.package_price },
    payment_summary: { payment_status: row.payment_status, total_paid: row.total_paid, remaining_balance: row.remaining_balance, payment_count: row.payment_count },
    payments
  });
});

app.post('/api/purchases', async (req, res) => {
  const { client_id, package_id, purchase_date, expiry_date, status } = req.body || {};
  if (!client_id || !package_id || !purchase_date) return res.status(400).json({ message: 'Missing required fields' });
  if (status && !['active', 'inactive', 'expired'].includes(status)) return res.status(400).json({ message: 'Invalid purchase status' });
  const [client, pack, user] = await Promise.all([
    Client.findOne({ legacyId: Number(client_id) }),
    Package.findOne({ legacyId: Number(package_id), active: true }),
    User.findOne({ legacyId: Number(req.user.id) })
  ]);
  if (!client) return res.status(400).json({ message: 'Client not found' });
  if (!pack) return res.status(400).json({ message: 'Package not found or inactive' });
  const tt = await TrainingType.findOne({ legacyId: pack.training_type_id });
  const now = nowIso();
  const doc = await Purchase.create({
    legacyId: await nextLegacyId(Purchase),
    client_id: client.legacyId,
    client: client._id,
    package_id: pack.legacyId,
    package: pack._id,
    package_snapshot: toApi(pack),
    training_type_id: pack.training_type_id,
    trainingType: tt?._id,
    sessions_purchased: pack.sessions_count,
    sessions_used: 0,
    sessions_remaining: pack.sessions_count,
    purchase_date,
    expiry_date: expiry_date || null,
    status: status || 'active',
    created_by: req.user.id,
    createdBy: user?._id,
    created_at: now,
    updated_at: now
  });
  res.status(201).json(toApi(doc));
});

app.put('/api/purchases/:id', async (req, res) => {
  const id = Number(req.params.id);
  const ex = await Purchase.findOne({ legacyId: id });
  if (!ex) return res.status(404).json({ message: 'Purchase not found' });
  const paymentCount = await Payment.countDocuments({ package_purchase_id: id });
  const bookingCount = await Booking.countDocuments({ package_purchase_id: id });
  const clientId = req.body.client_id === undefined ? ex.client_id : Number(req.body.client_id);
  const packageId = req.body.package_id === undefined ? ex.package_id : Number(req.body.package_id);
  const purchaseDate = req.body.purchase_date ?? ex.purchase_date;
  const expiryDate = req.body.expiry_date === undefined ? ex.expiry_date : (req.body.expiry_date || null);
  const status = req.body.status ?? ex.status;
  const sessionsPurchased = req.body.sessions_purchased === undefined ? ex.sessions_purchased : Number(req.body.sessions_purchased);
  if (!clientId || !packageId || !purchaseDate) return res.status(400).json({ message: 'Missing required fields' });
  if (!['active', 'inactive', 'expired'].includes(status)) return res.status(400).json({ message: 'Invalid purchase status' });
  if (!Number.isInteger(sessionsPurchased) || sessionsPurchased < ex.sessions_used) return res.status(400).json({ message: `Sessions purchased must be at least the ${ex.sessions_used} used sessions` });
  const client = await Client.findOne({ legacyId: clientId });
  if (!client) return res.status(400).json({ message: 'Client not found' });
  const packageChanged = Number(packageId) !== Number(ex.package_id);
  const clientChanged = Number(clientId) !== Number(ex.client_id);
  if (paymentCount && (clientChanged || packageChanged)) return res.status(409).json({ message: 'Cannot change client or package while linked payments exist. Payment records are preserved.' });
  if (bookingCount && (clientChanged || packageChanged)) return res.status(409).json({ message: 'Cannot change client or package while linked bookings exist. Booking records are preserved.' });
  const pack = packageChanged ? await Package.findOne({ legacyId: packageId, active: true }) : await Package.findOne({ legacyId: packageId });
  if (!pack) return res.status(400).json({ message: 'Package not found or inactive' });
  const tt = await TrainingType.findOne({ legacyId: pack.training_type_id });
  const updated = await Purchase.findOneAndUpdate({ legacyId: id }, {
    $set: {
      client_id: clientId,
      client: client._id,
      package_id: packageId,
      package: pack._id,
      package_snapshot: packageChanged ? toApi(pack) : ex.package_snapshot,
      training_type_id: pack.training_type_id,
      trainingType: tt?._id,
      sessions_purchased: sessionsPurchased,
      sessions_remaining: sessionsPurchased - ex.sessions_used,
      purchase_date: purchaseDate,
      expiry_date: expiryDate,
      status,
      updated_at: nowIso()
    }
  }, { new: true });
  res.json(toApi(updated));
});

app.delete('/api/purchases/:id', async (req, res) => {
  const id = Number(req.params.id);
  const ex = await Purchase.findOne({ legacyId: id });
  if (!ex) return res.status(404).json({ message: 'Purchase not found' });
  const [paymentCount, bookingCount] = await Promise.all([Payment.countDocuments({ package_purchase_id: id }), Booking.countDocuments({ package_purchase_id: id })]);
  if (paymentCount || bookingCount) return res.status(409).json({ message: `Cannot delete purchase with ${paymentCount} linked payment(s) and ${bookingCount} linked booking(s). Remove or reassign linked records first.` });
  await Purchase.deleteOne({ legacyId: id });
  res.json({ ok: true });
});

app.get('/api/clients/:id/active-purchases', async (req, res) => {
  const date = req.query.date || dayjs().format('YYYY-MM-DD');
  const filter = { client_id: Number(req.params.id), status: 'active', sessions_remaining: { $gt: 0 } };
  if (req.query.training_type_id) filter.training_type_id = Number(req.query.training_type_id);
  const rows = await Purchase.find(filter).sort({ purchase_date: -1, legacyId: -1 }).lean();
  const active = rows.filter((p) => isActiveUnexpiredPurchase(p, date));
  const packageIds = [...new Set(active.map((p) => p.package_id))];
  const packages = await Package.find({ legacyId: { $in: packageIds } }).lean();
  const packageById = new Map(packages.map((p) => [p.legacyId, p]));
  res.json(active.map((p) => ({ ...toApi(p), stored_status: p.status, status: effectivePurchaseStatus(p), package_name: packageById.get(p.package_id)?.name || p.package_snapshot?.name || '-' })));
});

app.get('/api/payments', async (req, res) => {
  const { page, pageSize, offset } = parsePagination(req.query);
  const [rows, total] = await Promise.all([
    Payment.find({}).sort({ payment_date: -1, legacyId: -1 }).skip(offset).limit(pageSize).lean(),
    Payment.countDocuments()
  ]);
  res.json({ data: await enrichPayments(rows), pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) || 1 } });
});
app.post('/api/payments', async (req, res) => {
  const { client_id, package_purchase_id, amount_paid, payment_date, payment_method, notes, branch_id } = req.body || {};
  if (!amount_paid || !payment_date || !payment_method) return res.status(400).json({ message: 'Amount, date, method required' });
  if (!PAYMENT_METHODS.includes(payment_method)) return res.status(400).json({ message: 'Invalid payment method' });
  const purchase = package_purchase_id ? await Purchase.findOne({ legacyId: Number(package_purchase_id) }) : null;
  if (package_purchase_id && !purchase) return res.status(400).json({ message: 'Related purchase not found' });
  if (purchase && client_id && Number(client_id) !== Number(purchase.client_id)) return res.status(400).json({ message: 'Payment client does not match purchase client' });
  const [client, branch, user] = await Promise.all([
    Client.findOne({ legacyId: purchase ? purchase.client_id : Number(client_id) }),
    branch_id ? Branch.findOne({ legacyId: Number(branch_id) }) : null,
    User.findOne({ legacyId: Number(req.user.id) })
  ]);
  const now = nowIso();
  const doc = await Payment.create({
    legacyId: await nextLegacyId(Payment),
    client_id: client?.legacyId || null,
    client: client?._id,
    package_purchase_id: package_purchase_id ? Number(package_purchase_id) : null,
    packagePurchase: purchase?._id,
    amount_paid: Number(amount_paid),
    payment_date,
    payment_method,
    notes: notes || null,
    branch_id: branch_id ? Number(branch_id) : null,
    branch: branch?._id,
    created_by: req.user.id,
    createdBy: user?._id,
    created_at: now,
    updated_at: now
  });
  res.status(201).json(toApi(doc));
});
app.delete('/api/payments/:id', async (req, res) => { await Payment.deleteOne({ legacyId: Number(req.params.id) }); res.json({ ok: true }); });

app.get('/api/expenses', async (req, res) => {
  const { page, pageSize, offset } = parsePagination(req.query);
  const [rows, total] = await Promise.all([
    Expense.find({}).sort({ date: -1, legacyId: -1 }).skip(offset).limit(pageSize).lean(),
    Expense.countDocuments()
  ]);
  res.json({ data: await enrichExpenses(rows), pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) || 1 } });
});
app.post('/api/expenses', async (req, res) => {
  const { title, amount, date, branch_id, notes } = req.body || {};
  if (!title || !amount || !date) return res.status(400).json({ message: 'Title, amount, date required' });
  const [branch, user] = await Promise.all([branch_id ? Branch.findOne({ legacyId: Number(branch_id) }) : null, User.findOne({ legacyId: Number(req.user.id) })]);
  const now = nowIso();
  const doc = await Expense.create({ legacyId: await nextLegacyId(Expense), title, amount: Number(amount), date, branch_id: branch_id ? Number(branch_id) : null, branch: branch?._id, notes: notes || null, created_by: req.user.id, createdBy: user?._id, created_at: now, updated_at: now });
  res.status(201).json((await enrichExpenses(doc))[0]);
});
app.put('/api/expenses/:id', async (req, res) => {
  const id = Number(req.params.id);
  const ex = await Expense.findOne({ legacyId: id });
  if (!ex) return res.status(404).json({ message: 'Not found' });
  const branchId = req.body.branch_id === undefined ? ex.branch_id : (req.body.branch_id ? Number(req.body.branch_id) : null);
  const branch = branchId ? await Branch.findOne({ legacyId: branchId }) : null;
  const updated = await Expense.findOneAndUpdate({ legacyId: id }, { $set: { title: req.body.title ?? ex.title, amount: req.body.amount === undefined ? ex.amount : Number(req.body.amount), date: req.body.date ?? ex.date, branch_id: branchId, branch: branch?._id, notes: req.body.notes === undefined ? ex.notes : (req.body.notes || null), updated_at: nowIso() } }, { new: true });
  res.json((await enrichExpenses(updated))[0]);
});
app.delete('/api/expenses/:id', async (req, res) => { await Expense.deleteOne({ legacyId: Number(req.params.id) }); res.json({ ok: true }); });

async function validPurchase(clientId, trainingTypeId, purchaseId, requireRemaining = true) {
  const query = { legacyId: purchaseId, client_id: clientId, training_type_id: trainingTypeId, status: 'active' };
  if (requireRemaining) query.sessions_remaining = { $gt: 0 };
  const purchase = await Purchase.findOne(query);
  return isActiveUnexpiredPurchase(purchase) ? purchase : null;
}

async function trainerFree(trainerId, startAt, endAt, ignoreId = null) {
  const query = { trainer_id: trainerId, status: { $in: ['booked', 'completed'] }, start_at: { $lt: endAt }, end_at: { $gt: startAt } };
  if (ignoreId) query.legacyId = { $ne: ignoreId };
  return !(await Booking.findOne(query).lean());
}

app.get('/api/bookings', async (req, res) => {
  const where = {};
  for (const k of ['trainer_id', 'branch_id', 'training_type_id']) if (req.query[k]) where[k] = Number(req.query[k]);
  if (req.query.status) where.status = req.query.status;
  if (req.query.from || req.query.to) where.start_at = { ...(req.query.from ? { $gte: req.query.from } : {}), ...(req.query.to ? { $lte: req.query.to } : {}) };
  const { page, pageSize, offset } = parsePagination(req.query);
  const [rows, total] = await Promise.all([
    Booking.find(where).sort({ start_at: -1, legacyId: -1 }).skip(offset).limit(pageSize).lean(),
    Booking.countDocuments(where)
  ]);
  res.json({ data: await enrichBookings(rows), pagination: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) || 1 } });
});

app.post('/api/bookings', async (req, res) => {
  const { client_id, trainer_id, branch_id, training_type_id, package_purchase_id, start_at, notes } = req.body || {};
  if (!client_id || !trainer_id || !branch_id || !training_type_id || !package_purchase_id || !start_at) return res.status(400).json({ message: 'Missing required fields' });
  const tt = await TrainingType.findOne({ legacyId: Number(training_type_id) });
  if (!tt) return res.status(400).json({ message: 'Training type not found' });
  const start = dayjs(start_at);
  if (!start.isValid()) return res.status(400).json({ message: 'Invalid start date' });
  const end = start.add(tt.duration_minutes, 'minute');
  if (!(await trainerFree(Number(trainer_id), start.toISOString(), end.toISOString()))) return res.status(400).json({ message: 'Trainer has overlapping booking' });
  const purchase = await validPurchase(Number(client_id), Number(training_type_id), Number(package_purchase_id), true);
  if (!purchase) return res.status(400).json({ message: 'No valid active, unexpired package with remaining sessions' });
  const [client, trainer, branch, user] = await Promise.all([
    Client.findOne({ legacyId: Number(client_id) }),
    Trainer.findOne({ legacyId: Number(trainer_id) }),
    Branch.findOne({ legacyId: Number(branch_id) }),
    User.findOne({ legacyId: Number(req.user.id) })
  ]);
  const now = nowIso();
  const doc = await Booking.create({ legacyId: await nextLegacyId(Booking), client_id: Number(client_id), client: client?._id, trainer_id: Number(trainer_id), trainer: trainer?._id, branch_id: Number(branch_id), branch: branch?._id, training_type_id: Number(training_type_id), trainingType: tt._id, package_purchase_id: Number(package_purchase_id), packagePurchase: purchase._id, start_at: start.toISOString(), end_at: end.toISOString(), status: 'booked', notes: notes || null, created_by: req.user.id, createdBy: user?._id, created_at: now, updated_at: now, completed_session_deducted: false });
  res.status(201).json(toApi(doc));
});

app.put('/api/bookings/:id', async (req, res) => {
  const id = Number(req.params.id);
  const ex = await Booking.findOne({ legacyId: id });
  if (!ex) return res.status(404).json({ message: 'Booking not found' });
  const status = req.body.status ?? ex.status;
  if (!BOOKING_STATUSES.includes(status)) return res.status(400).json({ message: 'Invalid status' });
  const tId = Number(req.body.training_type_id ?? ex.training_type_id);
  const tt = await TrainingType.findOne({ legacyId: tId });
  if (!tt) return res.status(400).json({ message: 'Training type not found' });
  const start = dayjs(req.body.start_at ?? ex.start_at);
  const end = start.add(tt.duration_minutes, 'minute');
  const trainerId = Number(req.body.trainer_id ?? ex.trainer_id);
  const clientId = Number(req.body.client_id ?? ex.client_id);
  const purchaseId = Number(req.body.package_purchase_id ?? ex.package_purchase_id);
  if (!(await trainerFree(trainerId, start.toISOString(), end.toISOString(), id))) return res.status(400).json({ message: 'Trainer has overlapping booking' });
  const purchase = await validPurchase(clientId, tId, purchaseId, false);
  if (!purchase) return res.status(400).json({ message: 'No valid active, unexpired package for this booking' });
  const previousUsesSession = bookingStatusUsesSession(ex.status);
  const nextUsesSession = bookingStatusUsesSession(status);
  const wasDeducted = Boolean(ex.completed_session_deducted);
  const shouldDeductSession = !previousUsesSession && nextUsesSession && !wasDeducted;
  const shouldRestoreSession = previousUsesSession && !nextUsesSession && wasDeducted;
  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const now = nowIso();
      if (shouldDeductSession) {
        const changes = await Purchase.updateOne({ legacyId: purchaseId, sessions_used: { $lt: purchase.sessions_purchased }, sessions_remaining: { $gt: 0 } }, [{ $set: { sessions_used: { $add: ['$sessions_used', 1] }, sessions_remaining: { $subtract: ['$sessions_purchased', { $add: ['$sessions_used', 1] }] }, updated_at: now } }], { session });
        if (!changes.modifiedCount) throw new Error('Cannot update booking status: no remaining sessions');
      }
      if (shouldRestoreSession) {
        const changes = await Purchase.updateOne({ legacyId: purchaseId, sessions_used: { $gt: 0 } }, [{ $set: { sessions_used: { $subtract: ['$sessions_used', 1] }, sessions_remaining: { $subtract: ['$sessions_purchased', { $subtract: ['$sessions_used', 1] }] }, updated_at: now } }], { session });
        if (!changes.modifiedCount) throw new Error('Cannot update booking status: used sessions are already zero');
      }
      const [client, trainer, branch] = await Promise.all([
        Client.findOne({ legacyId: clientId }).session(session),
        Trainer.findOne({ legacyId: trainerId }).session(session),
        Branch.findOne({ legacyId: Number(req.body.branch_id ?? ex.branch_id) }).session(session)
      ]);
      const deducted = nextUsesSession ? (wasDeducted || shouldDeductSession ? true : false) : false;
      await Booking.updateOne({ legacyId: id }, { $set: { client_id: clientId, client: client?._id, trainer_id: trainerId, trainer: trainer?._id, branch_id: Number(req.body.branch_id ?? ex.branch_id), branch: branch?._id, training_type_id: tId, trainingType: tt._id, package_purchase_id: purchaseId, packagePurchase: purchase._id, start_at: start.toISOString(), end_at: end.toISOString(), status, notes: req.body.notes ?? ex.notes, completed_session_deducted: deducted, updated_at: now } }, { session });
    });
    res.json(toApi(await Booking.findOne({ legacyId: id }).lean()));
  } catch (e) {
    res.status(400).json({ message: e.message });
  } finally {
    session.endSession();
  }
});
app.delete('/api/bookings/:id', async (req, res) => { await Booking.deleteOne({ legacyId: Number(req.params.id) }); res.json({ ok: true }); });

app.use((err, _req, res, _next) => { console.error(err); res.status(500).json({ message: 'Internal server error' }); });

async function start() {
  try {
    await connectMongo();
    await Promise.all(Object.values(models).map((Model) => Model.init()));
    const server = app.listen(PORT);
    server.on('listening', () => {
      console.log(`EZ Gym server running on http://localhost:${PORT}`);
    });
    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') console.error(`[server] port ${PORT} is already in use. Stop the other server process and retry.`);
      else console.error('[server] HTTP server error:', err.stack || err);
      process.exit(1);
    });
  } catch (err) {
    console.error('[server] startup failed:', err.stack || err);
    process.exit(1);
  }
}

start();
