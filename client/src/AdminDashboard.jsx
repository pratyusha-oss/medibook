import React, { useEffect, useState } from 'react';
import { apiRequest, formatApiError } from './api.js';

const STATUSES = ['requested', 'accepted', 'rejected', 'cancelled', 'completed'];
const ROLES = ['patient', 'doctor', 'admin'];
const PAGE_SIZE = 10;

function displayDate(value) {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
}

function PageControls({ pagination, onPage }) {
  if (!pagination || pagination.pages < 2) return null;
  return <div className="pagination admin-pagination">
    <button className="button button-outline" type="button" disabled={pagination.page <= 1} onClick={() => onPage(pagination.page - 1)}>← Previous</button>
    <span>Page {pagination.page} of {pagination.pages} · {pagination.total} total</span>
    <button className="button button-outline" type="button" disabled={pagination.page >= pagination.pages} onClick={() => onPage(pagination.page + 1)}>Next →</button>
  </div>;
}

function LoadState({ state, error, empty, retry }) {
  if (state === 'loading') return <div className="state-panel" role="status"><span className="spinner" /> Loading…</div>;
  if (state === 'error') return <div className="state-panel state-error" role="alert"><strong>Couldn’t load this section.</strong><span>{error}</span><button className="button button-outline" type="button" onClick={retry}>Try again</button></div>;
  if (state === 'ready' && empty) return <div className="state-panel empty-state"><span className="empty-symbol">✳</span><strong>Nothing to show yet.</strong><span>Records will appear here when available.</span></div>;
  return null;
}

function SectionNotice({ message, error }) {
  return <>{message && <div className="doctor-success" role="status"><span>✓</span>{message}</div>}{error && <div className="inline-error" role="alert">{error}</div>}</>;
}

function StatisticsSection({ refreshKey }) {
  const [statistics, setStatistics] = useState(null);
  const [state, setState] = useState('loading');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    setState('loading');
    setError('');
    apiRequest('/admin/stats').then((data) => { if (active) { setStatistics(data.statistics); setState('ready'); } })
      .catch((issue) => { if (active) { setError(formatApiError(issue)); setState('error'); } });
    return () => { active = false; };
  }, [refreshKey, retry]);
  return <section aria-labelledby="admin-statistics-title"><div className="doctor-panel-heading"><div><p className="eyebrow">CURRENT SERVICE ACTIVITY</p><h2 id="admin-statistics-title">Overview</h2></div></div>
    <LoadState state={state} error={error} retry={() => setRetry((value) => value + 1)} empty={false} />
    {state === 'ready' && statistics && <>
      <div className="doctor-stat-grid admin-stat-grid">
        <article className="doctor-stat"><span className="stat-symbol">◎</span><div><small>Total patients</small><strong>{statistics.totalPatients}</strong></div></article>
        <article className="doctor-stat"><span className="stat-symbol stat-confirmed">✳</span><div><small>Active doctors</small><strong>{statistics.activeDoctors}</strong></div></article>
        <article className="doctor-stat"><span className="stat-symbol stat-pending">◷</span><div><small>Total appointments</small><strong>{statistics.totalAppointments}</strong></div></article>
      </div>
      <section className="doctor-appointments-panel admin-status-summary"><div className="doctor-panel-heading"><div><p className="eyebrow">APPOINTMENT WORKFLOW</p><h3>Appointments by status</h3></div></div><div className="admin-status-grid">{STATUSES.map((status) => <article key={status}><span className={`status-badge status-${status}`}>{status}</span><strong>{statistics.appointmentsByStatus?.[status] ?? 0}</strong></article>)}</div></section>
    </>}
  </section>;
}

function DoctorSection({ onDataChange }) {
  const [doctors, setDoctors] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 0, total: 0 });
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [loadState, setLoadState] = useState('loading');
  const [loadError, setLoadError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [showCreate, setShowCreate] = useState(false);
  const [saving, setSaving] = useState(false);
  const [changingId, setChangingId] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(null);
  const [editSaving, setEditSaving] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', password: '', specialty: '', consultationFee: '', bio: '', timezone: 'Asia/Kolkata', days: [1, 2, 3, 4, 5], startTime: '09:00', endTime: '17:00' });

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE), status });
    if (query) params.set('q', query);
    setLoadState('loading'); setLoadError('');
    apiRequest(`/admin/doctors?${params}`).then((data) => {
      if (!active) return;
      setDoctors(data.doctors || []); setPagination(data.pagination); setLoadState('ready');
    }).catch((issue) => { if (active) { setLoadError(formatApiError(issue)); setLoadState('error'); } });
    return () => { active = false; };
  }, [page, status, query, refresh]);

  function update(field, value) { setForm((current) => ({ ...current, [field]: value })); setError(''); }
  function resetFilters(nextStatus = status, nextQuery = query) { setPage(1); setStatus(nextStatus); setQuery(nextQuery); }

  async function createDoctor(event) {
    event.preventDefault(); setError(''); setMessage('');
    const fee = Number(form.consultationFee);
    if (form.name.trim().length < 2) return setError('Enter a doctor name with at least 2 characters.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email.trim())) return setError('Enter a valid email address.');
    if (form.password.length < 8 || new TextEncoder().encode(form.password).length > 72) return setError('Temporary password must be 8–72 UTF-8 bytes.');
    if (!form.specialty.trim() || form.specialty.trim().length > 80) return setError('Specialty must be 1–80 characters.');
    if (!Number.isFinite(fee) || fee < 0 || fee > 1000000) return setError('Enter a consultation fee from ₹0 to ₹10,00,000.');
    if (!form.days.length) return setError('Select at least one weekly working day.');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(form.startTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(form.endTime) || form.startTime >= form.endTime) return setError('Enter valid working hours with the end time after the start time.');
    setSaving(true);
    try {
      const response = await apiRequest('/admin/doctors', { method: 'POST', body: JSON.stringify({
        name: form.name.trim(), email: form.email.trim(), password: form.password, specialty: form.specialty.trim(), consultationFee: fee,
        bio: form.bio.trim(), timezone: form.timezone.trim(), availability: form.days.map((weekday) => ({ weekday, startTime: form.startTime, endTime: form.endTime })),
      }) });
      setForm((current) => ({ ...current, name: '', email: '', password: '', specialty: '', consultationFee: '', bio: '' }));
      setMessage(`Doctor account created for ${response.doctor.user.name}. Share the temporary password through a secure channel.`);
      setShowCreate(false); setRefresh((value) => value + 1); onDataChange();
    } catch (issue) { setError(formatApiError(issue)); }
    finally { setSaving(false); }
  }

  async function toggleDoctor(doctor) {
    setChangingId(doctor.id); setError(''); setMessage('');
    try {
      await apiRequest(`/admin/doctors/${encodeURIComponent(doctor.id)}/status`, { method: 'PATCH', body: JSON.stringify({ isActive: !doctor.user.isActive }) });
      setMessage(`${doctor.user.name}'s account is now ${doctor.user.isActive ? 'inactive' : 'active'}.`);
      setRefresh((value) => value + 1); onDataChange();
    } catch (issue) { setError(formatApiError(issue)); }
    finally { setChangingId(''); }
  }

  async function saveProfile(event) {
    event.preventDefault(); if (!editing) return;
    setError(''); setMessage(''); setEditSaving(true);
    try {
      await apiRequest(`/admin/doctors/${encodeURIComponent(editing.id)}`, { method: 'PATCH', body: JSON.stringify({
        specialty: editing.specialty, bio: editing.bio, consultationFee: Number(editing.consultationFee),
      }) });
      setMessage(`Profile updated for ${editing.user.name}.`); setEditing(null); setRefresh((value) => value + 1); onDataChange();
    } catch (issue) { setError(formatApiError(issue)); }
    finally { setEditSaving(false); }
  }

  return <section aria-labelledby="admin-doctors-title"><div className="doctor-panel-heading"><div><p className="eyebrow">ACCOUNT AND PROFILE MANAGEMENT</p><h2 id="admin-doctors-title">Doctors</h2></div><button className="button button-primary" type="button" onClick={() => { setShowCreate((value) => !value); setEditing(null); }}> {showCreate ? 'Close form' : 'Add doctor'} </button></div>
    <SectionNotice message={message} error={error} />
    {showCreate && <section className="availability-panel admin-create-panel"><h3>Provision a doctor account</h3><p className="muted">The temporary password is hashed by the server and is never returned by the API.</p>
      <form onSubmit={createDoctor}>
        <div className="admin-form-grid">
          <label className="field">Full name<input autoComplete="name" value={form.name} onChange={(event) => update('name', event.target.value)} maxLength={100} required /></label>
          <label className="field">Email address<input type="email" autoComplete="email" value={form.email} onChange={(event) => update('email', event.target.value)} maxLength={254} required /></label>
          <label className="field">Temporary password<input type="password" autoComplete="new-password" value={form.password} onChange={(event) => update('password', event.target.value)} minLength={8} required /><small>8–72 UTF-8 bytes</small></label>
          <label className="field">Specialty<input value={form.specialty} onChange={(event) => update('specialty', event.target.value)} maxLength={80} required /></label>
          <label className="field">Consultation fee (₹)<input type="number" min="0" max="1000000" step="1" value={form.consultationFee} onChange={(event) => update('consultationFee', event.target.value)} required /></label>
          <label className="field">IANA timezone<input value={form.timezone} onChange={(event) => update('timezone', event.target.value)} placeholder="Asia/Kolkata" required /></label>
        </div>
        <label className="field">Profile biography<textarea rows="3" maxLength={2000} value={form.bio} onChange={(event) => update('bio', event.target.value)} /></label>
        <fieldset className="admin-days"><legend>Weekly working days</legend><div>{['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((day, weekday) => <label key={day}><input type="checkbox" checked={form.days.includes(weekday)} onChange={(event) => update('days', event.target.checked ? [...form.days, weekday].sort((a, b) => a - b) : form.days.filter((value) => value !== weekday))} />{day.slice(0, 3)}</label>)}</div></fieldset>
        <div className="admin-form-grid admin-hours"><label className="field">Start time<input type="time" value={form.startTime} onChange={(event) => update('startTime', event.target.value)} required /></label><label className="field">End time<input type="time" value={form.endTime} onChange={(event) => update('endTime', event.target.value)} required /></label></div>
        <button className="button button-primary" type="submit" disabled={saving}>{saving ? 'Creating doctor account…' : 'Create doctor account'}</button>
      </form>
    </section>}

    {editing && <section className="availability-panel admin-create-panel"><h3>Edit Dr. {editing.user.name}</h3><form onSubmit={saveProfile}>
      <div className="admin-form-grid"><label className="field">Specialty<input value={editing.specialty} maxLength={80} onChange={(event) => setEditing({ ...editing, specialty: event.target.value })} required /></label><label className="field">Consultation fee (₹)<input type="number" min="0" max="1000000" value={editing.consultationFee} onChange={(event) => setEditing({ ...editing, consultationFee: event.target.value })} required /></label></div>
      <label className="field">Biography<textarea rows="3" maxLength={2000} value={editing.bio || ''} onChange={(event) => setEditing({ ...editing, bio: event.target.value })} /></label>
      <div className="admin-inline-actions"><button className="button button-primary" type="submit" disabled={editSaving}>{editSaving ? 'Saving…' : 'Save profile'}</button><button className="button button-outline" type="button" onClick={() => setEditing(null)}>Cancel</button></div>
    </form></section>}

    <div className="admin-filters"><label className="field">Account status<select value={status} onChange={(event) => resetFilters(event.target.value)}><option value="all">All accounts</option><option value="active">Active</option><option value="inactive">Inactive</option></select></label><form className="admin-search" onSubmit={(event) => { event.preventDefault(); resetFilters(status, search.trim()); }}><label className="field">Search doctors<input value={search} maxLength={80} onChange={(event) => setSearch(event.target.value)} placeholder="Name, email, specialty…" /></label><button className="button button-outline" type="submit">Search</button></form></div>
    {loadState === 'error' && <LoadState state={loadState} error={loadError} retry={() => setRefresh((value) => value + 1)} />}
    {loadState === 'loading' && <LoadState state={loadState} />}
    {loadState === 'ready' && doctors.length === 0 && <LoadState state="ready" empty />}
    {loadState === 'ready' && doctors.length > 0 && <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Doctor</th><th>Specialty</th><th>Fee</th><th>Account</th><th>Actions</th></tr></thead><tbody>{doctors.map((doctor) => <tr key={doctor.id}><td data-label="Doctor"><strong>{doctor.user.name}</strong><small>{doctor.user.email}</small></td><td data-label="Specialty">{doctor.specialty}</td><td data-label="Fee">₹{Number(doctor.consultationFee).toLocaleString('en-IN')}</td><td data-label="Account"><span className={`status-badge ${doctor.user.isActive ? 'status-accepted' : 'status-cancelled'}`}>{doctor.user.isActive ? 'Active' : 'Inactive'}</span></td><td data-label="Actions"><div className="admin-inline-actions"><button className="button button-outline" type="button" onClick={() => { setShowCreate(false); setEditing({ ...doctor }); }}>Edit profile</button><button className="button button-outline" type="button" disabled={changingId === doctor.id} onClick={() => toggleDoctor(doctor)}>{changingId === doctor.id ? 'Saving…' : doctor.user.isActive ? 'Deactivate' : 'Activate'}</button></div></td></tr>)}</tbody></table></div>}
    {loadState === 'ready' && <PageControls pagination={pagination} onPage={setPage} />}
  </section>;
}

function AppointmentsSection({ doctors, refreshKey }) {
  const [appointments, setAppointments] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 0, total: 0 });
  const [filters, setFilters] = useState({ status: '', doctorId: '', patientId: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState(filters);
  const [state, setState] = useState('loading');
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE) });
    for (const key of ['status', 'doctorId', 'patientId']) if (query[key]) params.set(key, query[key]);
    if (query.from && query.to) {
      params.set('from', `${query.from}T00:00:00.000Z`);
      params.set('to', `${query.to}T23:59:59.999Z`);
    }
    setState('loading'); setError('');
    apiRequest(`/admin/appointments?${params}`).then((data) => { if (active) { setAppointments(data.appointments || []); setPagination(data.pagination); setState('ready'); } })
      .catch((issue) => { if (active) { setError(formatApiError(issue)); setState('error'); } });
    return () => { active = false; };
  }, [page, query, retry, refreshKey]);
  function applyFilters(event) {
    event.preventDefault();
    if (Boolean(filters.from) !== Boolean(filters.to)) { setError('Choose both a start date and an end date.'); setState('error'); return; }
    if (filters.from && filters.to && filters.from > filters.to) { setError('The end date must be on or after the start date.'); setState('error'); return; }
    setError(''); setPage(1); setQuery({ ...filters });
  }
  return <section aria-labelledby="admin-appointments-title"><div className="doctor-panel-heading"><div><p className="eyebrow">ALL DOCTORS AND PATIENTS</p><h2 id="admin-appointments-title">Appointments</h2></div></div>
    <form className="admin-filters admin-appointment-filters" onSubmit={applyFilters}>
      <label className="field">Status<select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="">All statuses</option>{STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}</select></label>
      <label className="field">Doctor<select value={filters.doctorId} onChange={(event) => setFilters({ ...filters, doctorId: event.target.value })}><option value="">All doctors</option>{doctors.map((doctor) => <option key={doctor.id} value={doctor.id}>{doctor.user.name} · {doctor.specialty}</option>)}</select></label>
      <label className="field">Patient ID<input value={filters.patientId} onChange={(event) => setFilters({ ...filters, patientId: event.target.value.trim() })} placeholder="Optional ObjectId" /></label>
      <label className="field">From<input type="date" value={filters.from} onChange={(event) => setFilters({ ...filters, from: event.target.value })} /></label>
      <label className="field">To<input type="date" value={filters.to} onChange={(event) => setFilters({ ...filters, to: event.target.value })} /></label>
      <button className="button button-outline" type="submit">Apply filters</button>
      <button className="button button-quiet" type="button" onClick={() => { const cleared = { status: '', doctorId: '', patientId: '', from: '', to: '' }; setFilters(cleared); setQuery(cleared); setPage(1); }}>Clear</button>
    </form>
    {state !== 'ready' && <LoadState state={state} error={error} retry={() => setRetry((value) => value + 1)} />}
    {state === 'ready' && appointments.length === 0 && <LoadState state="ready" empty />}
    {state === 'ready' && appointments.length > 0 && <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>When</th><th>Patient</th><th>Doctor</th><th>Reason</th><th>Status</th></tr></thead><tbody>{appointments.map((appointment) => <tr key={appointment.id}><td data-label="When">{displayDate(appointment.startsAt)}</td><td data-label="Patient">{appointment.patient?.name || 'Patient'}</td><td data-label="Doctor">{appointment.doctor?.name ? `Dr. ${appointment.doctor.name}` : 'Doctor'}<small>{appointment.doctor?.specialty || ''}</small></td><td data-label="Reason">{appointment.reason || '—'}</td><td data-label="Status"><span className={`status-badge status-${appointment.status}`}>{appointment.status}</span></td></tr>)}</tbody></table></div>}
    {state === 'ready' && <PageControls pagination={pagination} onPage={setPage} />}
  </section>;
}

function UsersSection({ currentUser, onDataChange }) {
  const [users, setUsers] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 0, total: 0 });
  const [filters, setFilters] = useState({ role: '', status: 'all', q: '' });
  const [page, setPage] = useState(1);
  const [query, setQuery] = useState(filters);
  const [state, setState] = useState('loading');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [changingId, setChangingId] = useState('');
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({ page: String(page), limit: String(PAGE_SIZE), status: query.status });
    if (query.role) params.set('role', query.role);
    if (query.q) params.set('q', query.q);
    setState('loading'); setError('');
    apiRequest(`/admin/users?${params}`).then((data) => { if (active) { setUsers(data.users || []); setPagination(data.pagination); setState('ready'); } })
      .catch((issue) => { if (active) { setError(formatApiError(issue)); setState('error'); } });
    return () => { active = false; };
  }, [page, query, retry]);
  function applyFilters(event) { event.preventDefault(); setPage(1); setQuery({ ...filters, q: filters.q.trim() }); }
  async function toggle(user) {
    setChangingId(user.id); setError(''); setNotice('');
    try {
      await apiRequest(`/admin/users/${encodeURIComponent(user.id)}/status`, { method: 'PATCH', body: JSON.stringify({ isActive: !user.isActive }) });
      setNotice(`${user.name}'s account is now ${user.isActive ? 'inactive' : 'active'}.`);
      setRetry((value) => value + 1); onDataChange();
    } catch (issue) { setError(formatApiError(issue)); }
    finally { setChangingId(''); }
  }
  return <section aria-labelledby="admin-users-title"><div className="doctor-panel-heading"><div><p className="eyebrow">ACCOUNT ACCESS</p><h2 id="admin-users-title">Users</h2></div></div>
    <SectionNotice message={notice} error={error} />
    <form className="admin-filters" onSubmit={applyFilters}>
      <label className="field">Role<select value={filters.role} onChange={(event) => setFilters({ ...filters, role: event.target.value })}><option value="">All roles</option>{ROLES.map((role) => <option key={role} value={role}>{role}</option>)}</select></label>
      <label className="field">Status<select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option></select></label>
      <label className="field">Search<input value={filters.q} maxLength={80} onChange={(event) => setFilters({ ...filters, q: event.target.value })} placeholder="Name or email" /></label>
      <button className="button button-outline" type="submit">Apply filters</button>
    </form>
    {state !== 'ready' && <LoadState state={state} error={error} retry={() => setRetry((value) => value + 1)} />}
    {state === 'ready' && users.length === 0 && <LoadState state="ready" empty />}
    {state === 'ready' && users.length > 0 && <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>User</th><th>Role</th><th>Status</th><th>Created</th><th>Action</th></tr></thead><tbody>{users.map((user) => {
      const isSelf = String(user.id) === String(currentUser?.id);
      return <tr key={user.id}><td data-label="User"><strong>{user.name}</strong><small>{user.email}</small></td><td data-label="Role">{user.role}</td><td data-label="Status"><span className={`status-badge ${user.isActive ? 'status-accepted' : 'status-cancelled'}`}>{user.isActive ? 'Active' : 'Inactive'}</span></td><td data-label="Created">{displayDate(user.createdAt)}</td><td data-label="Action"><button className="button button-outline" type="button" disabled={changingId === user.id || (isSelf && user.isActive)} title={isSelf && user.isActive ? 'You cannot deactivate your own account.' : ''} onClick={() => toggle(user)}>{changingId === user.id ? 'Saving…' : user.isActive ? 'Deactivate' : 'Activate'}</button></td></tr>;
    })}</tbody></table></div>}
    {state === 'ready' && <PageControls pagination={pagination} onPage={setPage} />}
  </section>;
}

export default function AdminDashboard({ user }) {
  const [section, setSection] = useState('overview');
  const [refreshKey, setRefreshKey] = useState(0);
  const [doctors, setDoctors] = useState([]);
  const [doctorOptionsState, setDoctorOptionsState] = useState('loading');
  useEffect(() => {
    let active = true;
    apiRequest('/admin/doctors?page=1&limit=50').then((data) => { if (active) { setDoctors(data.doctors || []); setDoctorOptionsState('ready'); } })
      .catch(() => { if (active) setDoctorOptionsState('error'); });
    return () => { active = false; };
  }, [refreshKey]);
  const tabs = [
    ['overview', 'Overview'], ['appointments', 'Appointments'], ['users', 'Users'], ['doctors', 'Doctors'],
  ];
  function refreshDashboard() { setRefreshKey((value) => value + 1); }
  return <section className="doctor-dashboard-page admin-dashboard-page">
    <div className="dashboard-heading doctor-dashboard-heading"><div><p className="eyebrow">ACCOUNT AND SERVICE MANAGEMENT</p><h1>Admin dashboard</h1><p className="muted">Manage accounts, review appointments, and monitor service activity.</p></div><button className="button button-outline" type="button" onClick={refreshDashboard}>Refresh dashboard ↻</button></div>
    <nav className="admin-tabs" aria-label="Admin dashboard sections">{tabs.map(([id, label]) => <button key={id} className={section === id ? 'admin-tab active' : 'admin-tab'} type="button" aria-current={section === id ? 'page' : undefined} onClick={() => setSection(id)}>{label}</button>)}</nav>
    <div className="admin-dashboard-content">
      {section === 'overview' && <StatisticsSection refreshKey={refreshKey} />}
      {section === 'appointments' && <AppointmentsSection doctors={doctors} refreshKey={refreshKey} />}
      {section === 'users' && <UsersSection currentUser={user} onDataChange={refreshDashboard} />}
      {section === 'doctors' && <DoctorSection onDataChange={refreshDashboard} />}
      {section === 'appointments' && doctorOptionsState === 'error' && <span className="admin-helper-text">Doctor filters accept profile IDs; the doctor directory could not be loaded for reference.</span>}
    </div>
  </section>;
}
