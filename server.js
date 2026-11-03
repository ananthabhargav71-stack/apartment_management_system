const express = require('express');
const mysql = require('mysql2/promise');
const path = require('path');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const pool = mysql.createPool({
  host: 'localhost',
  port: 3306,
  user: 'root',
  password: 'root',   // change this
  database: 'apartment_vms',
  waitForConnections: true,
  connectionLimit: 10,
  dateStrings: true            // returns datetimes as plain text, avoids timezone shifts
});

// ---------- startup connection test ----------
pool.getConnection()
  .then(conn => {
    console.log('DATABASE CONNECTED OK');
    conn.release();
  })
  .catch(err => {
    console.log('DATABASE CONNECTION FAILED');
    console.log('code:', err.code);
    console.log('message:', err.sqlMessage || err.message);
  });

// ---------- helpers ----------
const phoneOk = p => /^\d{10}$/.test(p || '');
const emailOk = e => !e || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

const handle = fn => async (req, res) => {
  try {
    await fn(req, res);
  } catch (err) {
    console.error('code:', err.code);
    console.error('message:', err.sqlMessage || err.message);
    if (err.code === 'ER_ROW_IS_REFERENCED_2') {
      return res.status(409).json({ error: 'Cannot delete: this record has visit history.' });
    }
    res.status(500).json({ error: 'Server error: ' + (err.sqlMessage || err.message) });
  }
};

function validateResident(b) {
  if (!b.name || !b.name.trim()) return 'Name is required.';
  if (!b.flat_no || !b.flat_no.trim()) return 'Flat number is required.';
  if (!phoneOk(b.phone)) return 'Phone must be exactly 10 digits.';
  if (!emailOk(b.email)) return 'Email format is invalid.';
  return null;
}

function validateVisitor(b) {
  if (!b.name || !b.name.trim()) return 'Name is required.';
  if (!phoneOk(b.phone)) return 'Phone must be exactly 10 digits.';
  return null;
}

// ---------- dashboard stats ----------
app.get('/api/stats', handle(async (req, res) => {
  const [[inside]] = await pool.query("SELECT COUNT(*) AS n FROM visits WHERE status = 'Checked In'");
  const [[today]] = await pool.query('SELECT COUNT(*) AS n FROM visits WHERE DATE(entry_time) = CURDATE()');
  const [[residents]] = await pool.query('SELECT COUNT(*) AS n FROM residents');
  res.json({ inside: inside.n, today: today.n, residents: residents.n });
}));

// ---------- residents ----------
app.get('/api/residents', handle(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM residents ORDER BY name');
  res.json(rows);
}));

app.post('/api/residents', handle(async (req, res) => {
  const err = validateResident(req.body);
  if (err) return res.status(400).json({ error: err });
  const { name, flat_no, phone, email } = req.body;
  const [r] = await pool.query(
    'INSERT INTO residents (name, flat_no, phone, email) VALUES (?, ?, ?, ?)',
    [name.trim(), flat_no.trim(), phone, email || null]
  );
  res.status(201).json({ resident_id: r.insertId });
}));

app.put('/api/residents/:id', handle(async (req, res) => {
  const err = validateResident(req.body);
  if (err) return res.status(400).json({ error: err });
  const { name, flat_no, phone, email } = req.body;
  const [r] = await pool.query(
    'UPDATE residents SET name = ?, flat_no = ?, phone = ?, email = ? WHERE resident_id = ?',
    [name.trim(), flat_no.trim(), phone, email || null, req.params.id]
  );
  if (!r.affectedRows) return res.status(404).json({ error: 'Resident not found.' });
  res.json({ ok: true });
}));

app.delete('/api/residents/:id', handle(async (req, res) => {
  const [r] = await pool.query('DELETE FROM residents WHERE resident_id = ?', [req.params.id]);
  if (!r.affectedRows) return res.status(404).json({ error: 'Resident not found.' });
  res.json({ ok: true });
}));

// ---------- visitors ----------
app.get('/api/visitors', handle(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM visitors ORDER BY name');
  res.json(rows);
}));

app.post('/api/visitors', handle(async (req, res) => {
  const err = validateVisitor(req.body);
  if (err) return res.status(400).json({ error: err });
  const { name, phone, vehicle_no, purpose } = req.body;
  const [r] = await pool.query(
    'INSERT INTO visitors (name, phone, vehicle_no, purpose) VALUES (?, ?, ?, ?)',
    [name.trim(), phone, vehicle_no || null, purpose || null]
  );
  res.status(201).json({ visitor_id: r.insertId });
}));

app.put('/api/visitors/:id', handle(async (req, res) => {
  const err = validateVisitor(req.body);
  if (err) return res.status(400).json({ error: err });
  const { name, phone, vehicle_no, purpose } = req.body;
  const [r] = await pool.query(
    'UPDATE visitors SET name = ?, phone = ?, vehicle_no = ?, purpose = ? WHERE visitor_id = ?',
    [name.trim(), phone, vehicle_no || null, purpose || null, req.params.id]
  );
  if (!r.affectedRows) return res.status(404).json({ error: 'Visitor not found.' });
  res.json({ ok: true });
}));

app.delete('/api/visitors/:id', handle(async (req, res) => {
  const [r] = await pool.query('DELETE FROM visitors WHERE visitor_id = ?', [req.params.id]);
  if (!r.affectedRows) return res.status(404).json({ error: 'Visitor not found.' });
  res.json({ ok: true });
}));

// ---------- visits ----------
app.get('/api/visits', handle(async (req, res) => {
  let sql = `
    SELECT v.visit_id, v.entry_time, v.exit_time, v.status,
           r.name AS resident_name, r.flat_no,
           vi.name AS visitor_name, vi.phone AS visitor_phone
    FROM visits v
    JOIN residents r  ON r.resident_id = v.resident_id
    JOIN visitors  vi ON vi.visitor_id = v.visitor_id`;
  const params = [];
  if (req.query.status) {
    sql += ' WHERE v.status = ?';
    params.push(req.query.status);
  }
  sql += ' ORDER BY v.entry_time DESC';
  const [rows] = await pool.query(sql, params);
  res.json(rows);
}));

app.post('/api/visits', handle(async (req, res) => {
  const { resident_id, visitor_id } = req.body;
  if (!resident_id || !visitor_id) return res.status(400).json({ error: 'Select both a resident and a visitor.' });

  const [inside] = await pool.query(
    "SELECT visit_id FROM visits WHERE visitor_id = ? AND status = 'Checked In'", [visitor_id]
  );
  if (inside.length) return res.status(409).json({ error: 'This visitor is already checked in.' });

  const [r] = await pool.query(
    "INSERT INTO visits (resident_id, visitor_id, entry_time, status) VALUES (?, ?, NOW(), 'Checked In')",
    [resident_id, visitor_id]
  );
  res.status(201).json({ visit_id: r.insertId });
}));

app.put('/api/visits/:id/checkout', handle(async (req, res) => {
  const [r] = await pool.query(
    "UPDATE visits SET exit_time = NOW(), status = 'Checked Out' WHERE visit_id = ? AND status = 'Checked In'",
    [req.params.id]
  );
  if (!r.affectedRows) return res.status(404).json({ error: 'Visit not found or already checked out.' });
  res.json({ ok: true });
}));

app.listen(3000, () => console.log('Running at http://localhost:3000'));