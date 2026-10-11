import React, { useEffect, useState } from 'react';
import { apiRequest, clearToken, formatApiError, saveToken } from './api.js';

const EMPTY_PAGINATION = { page: 1, limit: 12, total: 0, pages: 0 };

function todayString() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function dateInZone(instant, timezone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(instant));
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function timeInZone(instant, timezone) {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(instant));
}

function longDate(instant, timezone) {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: timezone || undefined,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(instant));
}

function slotQueryRange(date) {
  // A generous UTC envelope covers local calendar days in all IANA time zones.
  const midnightUtc = new Date(`${date}T00:00:00.000Z`);
  return {
    from: new Date(midnightUtc.getTime() - 14 * 60 * 60 * 1000).toISOString(),
    to: new Date(midnightUtc.getTime() + 38 * 60 * 60 * 1000).toISOString(),
  };
}

function initials(name = 'MediBook') {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

function App() {
  const [user, setUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [authMode, setAuthMode] = useState(null);
  const [activePage, setActivePage] = useState('directory');
  const [selectedDoctor, setSelectedDoctor] = useState(null);

  const [searchForm, setSearchForm] = useState({ q: '', specialty: '', feeMax: '' });
  const [searchQuery, setSearchQuery] = useState({ q: '', specialty: '', feeMax: '' });
  const [doctors, setDoctors] = useState([]);
  const [doctorPagination, setDoctorPagination] = useState(EMPTY_PAGINATION);
  const [directoryStatus, setDirectoryStatus] = useState('loading');
  const [directoryError, setDirectoryError] = useState('');

  const [authForm, setAuthForm] = useState({ name: '', email: '', password: '' });
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [notice, setNotice] = useState('');

  const [selectedDate, setSelectedDate] = useState(todayString());
  const [slots, setSlots] = useState([]);
  const [slotTimezone, setSlotTimezone] = useState('Asia/Kolkata');
  const [slotsStatus, setSlotsStatus] = useState('idle');
  const [slotsError, setSlotsError] = useState('');
  const [selectedSlot, setSelectedSlot] = useState('');
  const [reason, setReason] = useState('');
  const [booking, setBooking] = useState(false);

  const [appointments, setAppointments] = useState([]);
  const [appointmentDoctors, setAppointmentDoctors] = useState({});
  const [appointmentsStatus, setAppointmentsStatus] = useState('idle');
  const [appointmentsError, setAppointmentsError] = useState('');
  const [appointmentRefresh, setAppointmentRefresh] = useState(0);
  const [cancellingId, setCancellingId] = useState('');

  useEffect(() => {
    let active = true;
    apiRequest('/auth/me')
      .then(({ user: currentUser }) => { if (active) setUser(currentUser); })
      .catch((error) => {
        if (error.status === 401) clearToken();
      })
      .finally(() => { if (active) setAuthReady(true); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({ page: String(doctorPagination.page || 1), limit: '12' });
    if (searchQuery.q) params.set('q', searchQuery.q);
    if (searchQuery.specialty) params.set('specialty', searchQuery.specialty);
    if (searchQuery.feeMax) params.set('feeMax', searchQuery.feeMax);
    setDirectoryStatus('loading');
    setDirectoryError('');
    apiRequest(`/doctors?${params}`)
      .then((data) => {
        if (!active) return;
        setDoctors(data.doctors || []);
        setDoctorPagination(data.pagination || EMPTY_PAGINATION);
        setDirectoryStatus('ready');
      })
      .catch((error) => {
        if (!active) return;
        setDirectoryError(formatApiError(error));
        setDirectoryStatus('error');
      });
    return () => { active = false; };
  }, [searchQuery, doctorPagination.page]);

  useEffect(() => {
    if (!selectedDoctor || !selectedDate) return undefined;
    let active = true;
    setSlotsStatus('loading');
    setSlotsError('');
    setSelectedSlot('');
    const range = slotQueryRange(selectedDate);
    const params = new URLSearchParams(range);
    apiRequest(`/doctors/${encodeURIComponent(selectedDoctor.id)}/slots?${params}`)
      .then((data) => {
        if (!active) return;
        setSlotTimezone(data.timezone || 'Asia/Kolkata');
        setSlots((data.slots || []).filter((slot) => dateInZone(slot.startsAt, data.timezone || 'Asia/Kolkata') === selectedDate));
        setSlotsStatus('ready');
      })
      .catch((error) => {
        if (!active) return;
        setSlotsError(formatApiError(error));
        setSlotsStatus('error');
      });
    return () => { active = false; };
  }, [selectedDoctor, selectedDate, appointmentRefresh]);

  useEffect(() => {
    if (activePage !== 'appointments' || !user || user.role !== 'patient') return undefined;
    let active = true;
    setAppointmentsStatus('loading');
    setAppointmentsError('');
    apiRequest('/appointments/me?limit=50&page=1')
      .then(async (data) => {
        if (!active) return;
        const records = data.appointments || [];
        setAppointments(records);
        const ids = [...new Set(records.map((appointment) => appointment.doctorId))];
        const profiles = await Promise.all(ids.map(async (id) => {
          try {
            const response = await apiRequest(`/doctors/${encodeURIComponent(id)}`);
            return [id, response.doctor];
          } catch {
            return [id, null];
          }
        }));
        if (!active) return;
        setAppointmentDoctors(Object.fromEntries(profiles));
        setAppointmentsStatus('ready');
      })
      .catch((error) => {
        if (!active) return;
        if (error.status === 401) {
          clearToken();
          setUser(null);
        }
        setAppointmentsError(formatApiError(error));
        setAppointmentsStatus('error');
      });
    return () => { active = false; };
  }, [activePage, user, appointmentRefresh]);

  async function openDoctor(doctor) {
    setNotice('');
    setSelectedSlot('');
    setSelectedDate(todayString());
    setSlots([]);
    setActivePage('doctor');
    try {
      const response = await apiRequest(`/doctors/${encodeURIComponent(doctor.id)}`);
      setSelectedDoctor(response.doctor);
    } catch (error) {
      setNotice(formatApiError(error));
      setSelectedDoctor(doctor);
    }
  }

  function showDirectory() {
    setActivePage('directory');
    setSelectedDoctor(null);
    setAuthMode(null);
    setNotice('');
  }

  function showAppointments() {
    setAuthMode(null);
    setActivePage('appointments');
    setNotice('');
  }

  async function submitAuth(event) {
    event.preventDefault();
    setAuthError('');
    const email = authForm.email.trim();
    const password = authForm.password;
    if (authMode === 'register' && authForm.name.trim().length < 2) {
      setAuthError('Please enter your name (at least 2 characters).');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setAuthError('Enter a valid email address.');
      return;
    }
    if (authMode === 'register' && (password.length < 8 || new TextEncoder().encode(password).length > 72)) {
      setAuthError('Password must be at least 8 characters and no more than 72 bytes.');
      return;
    }
    if (authMode === 'login' && !password) {
      setAuthError('Enter your password.');
      return;
    }

    setAuthLoading(true);
    try {
      const path = authMode === 'register' ? '/auth/register' : '/auth/login';
      const body = authMode === 'register'
        ? { name: authForm.name.trim(), email, password }
        : { email, password };
      const response = await apiRequest(path, { method: 'POST', body: JSON.stringify(body) });
      saveToken(response.token);
      setUser(response.user);
      setAuthForm({ name: '', email: '', password: '' });
      setAuthMode(null);
      setNotice(authMode === 'register' ? 'Your patient account is ready.' : `Welcome back, ${response.user.name}.`);
    } catch (error) {
      setAuthError(formatApiError(error));
    } finally {
      setAuthLoading(false);
    }
  }

  function logout() {
    clearToken();
    setUser(null);
    setActivePage('directory');
    setSelectedDoctor(null);
    setNotice('You have been signed out.');
  }

  async function bookSelectedSlot(event) {
    event.preventDefault();
    if (!selectedSlot) return;
    if (!user) {
      setAuthMode('login');
      setAuthError('Sign in or create a patient account to book this appointment.');
      return;
    }
    if (user.role !== 'patient') {
      setNotice('Appointment booking is available to patient accounts.');
      return;
    }
    setBooking(true);
    setNotice('');
    try {
      await apiRequest('/appointments', {
        method: 'POST',
        body: JSON.stringify({ doctorId: selectedDoctor.id, startsAt: selectedSlot, reason: reason.trim() }),
      });
      setReason('');
      setNotice('Appointment requested. You can follow its status from your appointments.');
      setAppointmentRefresh((value) => value + 1);
      setActivePage('appointments');
    } catch (error) {
      setNotice(formatApiError(error));
      if (error.status === 409) setAppointmentRefresh((value) => value + 1);
    } finally {
      setBooking(false);
    }
  }

  async function cancelAppointment(appointmentId) {
    if (!window.confirm('Cancel this appointment?')) return;
    setCancellingId(appointmentId);
    setAppointmentsError('');
    try {
      await apiRequest(`/appointments/${encodeURIComponent(appointmentId)}/cancel`, { method: 'PATCH' });
      setNotice('Appointment cancelled. The time is available to book again.');
      setAppointmentRefresh((value) => value + 1);
    } catch (error) {
      setAppointmentsError(formatApiError(error));
      setAppointmentRefresh((value) => value + 1);
    } finally {
      setCancellingId('');
    }
  }

  function searchDoctors(event) {
    event.preventDefault();
    setDoctorPagination((pagination) => ({ ...pagination, page: 1 }));
    setSearchQuery({
      q: searchForm.q.trim(),
      specialty: searchForm.specialty.trim(),
      feeMax: searchForm.feeMax,
    });
  }

  const isAppointments = activePage === 'appointments';
  const isDoctorDashboard = activePage === 'doctor-dashboard';

  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="header-inner">
          <button className="brand" type="button" onClick={showDirectory} aria-label="MediBook home">
            <span className="brand-mark" aria-hidden="true">+</span>
            <span>MediBook</span>
          </button>
          <nav className="main-nav" aria-label="Main navigation">
            <button className={!isAppointments && !isDoctorDashboard && activePage !== 'doctor' ? 'nav-link active' : 'nav-link'} type="button" onClick={showDirectory}>Find care</button>
            {user?.role === 'patient' && <button className={isAppointments ? 'nav-link active' : 'nav-link'} type="button" onClick={showAppointments}>My appointments</button>}
            {user?.role === 'doctor' && <button className={isDoctorDashboard ? 'nav-link active' : 'nav-link'} type="button" onClick={() => { setActivePage('doctor-dashboard'); setAuthMode(null); }}>Doctor dashboard</button>}
          </nav>
          <div className="account-actions">
            {user ? (
              <>
                <span className="user-greeting">Hi, {user.name.split(' ')[0]}</span>
                <button className="button button-quiet" type="button" onClick={logout}>Sign out</button>
              </>
            ) : (
              <>
                <button className="button button-quiet" type="button" onClick={() => { setAuthMode('login'); setAuthError(''); }}>Sign in</button>
                <button className="button button-small" type="button" onClick={() => { setAuthMode('register'); setAuthError(''); }}>Create account</button>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="main-content">
        {notice && <div className="notice" role="status"><span>{notice}</span><button type="button" aria-label="Dismiss message" onClick={() => setNotice('')}>×</button></div>}

        {!authReady && <div className="loading-banner" role="status">Restoring your session…</div>}

        {authMode && (
          <section className="auth-layout" aria-labelledby="auth-title">
            <div className="auth-aside">
              <span className="mini-icon">✳</span>
              <p className="eyebrow">CARE, MADE PERSONAL</p>
              <h1>Good health starts with a good conversation.</h1>
              <p>Find trusted care, choose a time that works, and keep everything in one place.</p>
              <div className="trust-note"><span className="trust-dot" /> Your account is private and secure</div>
            </div>
            <form className="auth-card" onSubmit={submitAuth} noValidate>
              <button className="back-link" type="button" onClick={() => setAuthMode(null)}>← Back to doctors</button>
              <p className="eyebrow">PATIENT ACCOUNT</p>
              <h2 id="auth-title">{authMode === 'register' ? 'Create your account' : 'Welcome back'}</h2>
              <p className="muted">{authMode === 'register' ? 'A few details to get your care journey started.' : 'Sign in to manage your appointments.'}</p>
              {authMode === 'register' && (
                <label className="field">Full name
                  <input autoComplete="name" value={authForm.name} onChange={(event) => setAuthForm({ ...authForm, name: event.target.value })} maxLength={100} required />
                </label>
              )}
              <label className="field">Email address
                <input type="email" autoComplete="email" value={authForm.email} onChange={(event) => setAuthForm({ ...authForm, email: event.target.value })} maxLength={254} required />
              </label>
              <label className="field">Password
                <input type="password" autoComplete={authMode === 'register' ? 'new-password' : 'current-password'} value={authForm.password} onChange={(event) => setAuthForm({ ...authForm, password: event.target.value })} required />
                {authMode === 'register' && <small>At least 8 characters. Maximum 72 UTF-8 bytes.</small>}
              </label>
              {authError && <p className="form-error" role="alert">{authError}</p>}
              <button className="button button-primary button-full" type="submit" disabled={authLoading}>
                {authLoading ? 'Please wait…' : authMode === 'register' ? 'Create patient account' : 'Sign in'}
              </button>
              <p className="auth-switch">
                {authMode === 'register' ? 'Already have an account?' : 'New to MediBook?'}{' '}
                <button type="button" onClick={() => { setAuthMode(authMode === 'register' ? 'login' : 'register'); setAuthError(''); }}>
                  {authMode === 'register' ? 'Sign in' : 'Create an account'}
                </button>
              </p>
            </form>
          </section>
        )}

        {!authMode && activePage === 'directory' && (
          <>
            <section className="hero">
              <div className="hero-copy">
                <p className="eyebrow"><span className="eyebrow-line" /> THOUGHTFUL CARE, CLOSER TO YOU</p>
                <h1>Care that fits<br /><em>your life.</em></h1>
                <p className="hero-description">Find the right doctor and book a time that works for you. A calmer way to take care of yourself.</p>
                <a className="hero-scroll" href="#doctor-directory"><span>↓</span> Explore our doctors</a>
              </div>
              <div className="hero-art" aria-hidden="true">
                <div className="hero-orbit orbit-one" />
                <div className="hero-orbit orbit-two" />
                <div className="hero-cross">+</div>
                <div className="hero-note note-top"><span className="note-dot" /> Care, on your terms</div>
                <div className="doctor-illustration">
                  <div className="illustration-hair" />
                  <div className="illustration-face"><span className="face-eye eye-left" /><span className="face-eye eye-right" /><span className="face-smile" /></div>
                  <div className="illustration-neck" />
                  <div className="illustration-coat"><span className="coat-lapel" /><span className="coat-pocket" /><span className="coat-stethoscope" /></div>
                </div>
                <div className="hero-note note-bottom"><span className="verified-mark">✓</span><div><strong>Here for your health</strong><small>Care you can feel good about</small></div></div>
              </div>
              <div className="hero-index"><span>01</span><i /> Find · Choose · Feel better</div>
            </section>

            <section className="directory-section" id="doctor-directory">
              <div className="section-heading">
                <div><p className="eyebrow">YOUR NEXT STEP</p><h2>Meet your care team</h2></div>
                <p>Thoughtful professionals, ready to listen.</p>
              </div>
              <form className="search-panel" onSubmit={searchDoctors}>
                <label className="search-field search-main"><span aria-hidden="true">⌕</span><span className="sr-only">Search by doctor, specialty, or care</span><input aria-label="Search doctors" placeholder="Doctor, specialty, or care…" value={searchForm.q} onChange={(event) => setSearchForm({ ...searchForm, q: event.target.value })} maxLength={80} /></label>
                <label className="search-field"><span className="sr-only">Specialty filter</span><input aria-label="Filter by specialty" placeholder="Specialty" value={searchForm.specialty} onChange={(event) => setSearchForm({ ...searchForm, specialty: event.target.value })} maxLength={80} /></label>
                <label className="search-field fee-field"><span className="fee-prefix">₹</span><span className="sr-only">Maximum consultation fee</span><input aria-label="Maximum consultation fee" inputMode="numeric" type="number" min="0" max="1000000" placeholder="Max fee" value={searchForm.feeMax} onChange={(event) => setSearchForm({ ...searchForm, feeMax: event.target.value })} /></label>
                <button className="button button-search" type="submit">Search doctors <span aria-hidden="true">→</span></button>
              </form>
              <div className="results-meta"><span>{directoryStatus === 'ready' ? `${doctorPagination.total} ${doctorPagination.total === 1 ? 'doctor' : 'doctors'} available` : 'Meet your care team'}</span><span>Thoughtful care, one appointment at a time</span></div>
              {directoryStatus === 'loading' && <div className="state-panel" role="status"><span className="spinner" /> Finding your care team…</div>}
              {directoryStatus === 'error' && <div className="state-panel state-error" role="alert"><strong>We couldn’t load doctors.</strong><span>{directoryError}</span><button className="button button-outline" type="button" onClick={() => setSearchQuery({ ...searchQuery })}>Try again</button></div>}
              {directoryStatus === 'ready' && doctors.length === 0 && <div className="state-panel empty-state"><span className="empty-symbol">⌕</span><strong>No doctors match those filters yet.</strong><span>Try another specialty or clear the fee limit.</span><button className="button button-outline" type="button" onClick={() => { setSearchForm({ q: '', specialty: '', feeMax: '' }); setSearchQuery({ q: '', specialty: '', feeMax: '' }); }}>Clear filters</button></div>}
              {directoryStatus === 'ready' && doctors.length > 0 && (
                <div className="doctor-grid">
                  {doctors.map((doctor, index) => <DoctorCard key={doctor.id} doctor={doctor} index={index} onOpen={() => openDoctor(doctor)} />)}
                </div>
              )}
              {directoryStatus === 'ready' && doctorPagination.pages > 1 && <div className="pagination"><button className="button button-outline" disabled={doctorPagination.page <= 1} onClick={() => setDoctorPagination((value) => ({ ...value, page: value.page - 1 }))}>← Previous</button><span>Page {doctorPagination.page} of {doctorPagination.pages}</span><button className="button button-outline" disabled={doctorPagination.page >= doctorPagination.pages} onClick={() => setDoctorPagination((value) => ({ ...value, page: value.page + 1 }))}>Next →</button></div>}
            </section>
          </>
        )}

        {!authMode && activePage === 'doctor' && selectedDoctor && (
          <section className="profile-page">
            <button className="back-link profile-back" type="button" onClick={showDirectory}>← Back to all doctors</button>
            <div className="profile-layout">
              <div className="profile-main">
                <div className="profile-hero-card">
                  <div className="profile-avatar">{initials(selectedDoctor.name)}</div>
                  <div className="profile-identity"><span className="eyebrow">YOUR CARE, YOUR WAY</span><h1>Dr. {selectedDoctor.name}</h1><span className="specialty-pill">{selectedDoctor.specialty}</span></div>
                  <div className="profile-fee"><small>Consultation</small><strong>₹{Number(selectedDoctor.consultationFee).toLocaleString('en-IN')}</strong><small>per visit</small></div>
                </div>
                <div className="profile-about"><p className="eyebrow">A LITTLE ABOUT</p><h2>Care starts with listening.</h2><p>{selectedDoctor.bio || 'This doctor has not added a biography yet. Browse availability to find a time that works for you.'}</p></div>
                <div className="availability-list"><div><p className="eyebrow">WEEKLY AVAILABILITY</p><h2>When this doctor sees patients</h2></div>{selectedDoctor.availability?.length ? <ul>{selectedDoctor.availability.map((window, index) => <li key={`${window.weekday}-${window.startTime}-${index}`}><strong>{weekdayName(window.weekday)}</strong><span>{window.startTime}–{window.endTime}</span></li>)}</ul> : <p className="muted">No weekly availability has been added yet.</p>}</div>
              </div>
              <aside className="booking-card" aria-labelledby="booking-title">
                <p className="eyebrow">TAKE THE NEXT STEP</p><h2 id="booking-title">Book a visit</h2><p className="muted">Choose a day to see available appointment times.</p>
                <label className="field">Appointment date<input type="date" min={todayString()} value={selectedDate} onChange={(event) => setSelectedDate(event.target.value)} /></label>
                <div className="timezone-label">Times shown in <strong>{slotTimezone}</strong></div>
                {slotsStatus === 'loading' && <div className="slot-state" role="status"><span className="spinner" /> Checking availability…</div>}
                {slotsStatus === 'error' && <p className="form-error" role="alert">{slotsError}</p>}
                {slotsStatus === 'ready' && slots.length === 0 && <div className="no-slots">No available times on this day. Please choose another date.</div>}
                {slotsStatus === 'ready' && slots.length > 0 && <div className="slot-grid" aria-label="Available appointment times">{slots.map((slot) => <button type="button" key={slot.startsAt} className={selectedSlot === slot.startsAt ? 'slot-button selected' : 'slot-button'} onClick={() => setSelectedSlot(slot.startsAt)} aria-pressed={selectedSlot === slot.startsAt}>{timeInZone(slot.startsAt, slotTimezone)}</button>)}</div>}
                {selectedSlot && <form className="booking-form" onSubmit={bookSelectedSlot}>
                  <label className="field">What would you like help with? <span className="optional-label">Optional</span><textarea rows="3" maxLength={500} placeholder="A short note for the doctor" value={reason} onChange={(event) => setReason(event.target.value)} /></label>
                  <button className="button button-primary button-full" type="submit" disabled={booking}>{booking ? 'Requesting…' : user?.role === 'patient' ? 'Request appointment' : 'Sign in to continue'} <span aria-hidden="true">→</span></button>
                </form>}
                <div className="booking-footnote"><span>✳</span> Your visit details are handled securely.</div>
              </aside>
            </div>
          </section>
        )}

        {!authMode && activePage === 'appointments' && (
          <section className="appointments-page">
            <div className="dashboard-heading"><div><p className="eyebrow">YOUR CARE, ALL IN ONE PLACE</p><h1>Your appointments</h1><p className="muted">Keep track of your upcoming visits and past care.</p></div><button className="button button-outline" type="button" onClick={showDirectory}>Find a doctor <span aria-hidden="true">→</span></button></div>
            {appointmentsStatus === 'loading' && <div className="state-panel" role="status"><span className="spinner" /> Loading your appointments…</div>}
            {appointmentsStatus === 'error' && <div className="state-panel state-error" role="alert"><strong>We couldn’t load your appointments.</strong><span>{appointmentsError}</span><button className="button button-outline" type="button" onClick={() => setAppointmentRefresh((value) => value + 1)}>Try again</button></div>}
            {appointmentsError && appointmentsStatus === 'ready' && <div className="inline-error" role="alert">{appointmentsError}</div>}
            {appointmentsStatus === 'ready' && appointments.length === 0 && <div className="empty-dashboard"><div className="empty-calendar" aria-hidden="true">✳</div><p className="eyebrow">A FRESH START</p><h2>No appointments yet</h2><p>When you find a doctor and request a visit, it will be waiting for you here.</p><button className="button button-primary" type="button" onClick={showDirectory}>Explore doctors <span aria-hidden="true">→</span></button></div>}
            {appointmentsStatus === 'ready' && appointments.length > 0 && <div className="appointment-list">{appointments.map((appointment) => {
              const doctor = appointmentDoctors[appointment.doctorId];
              const canCancel = ['requested', 'accepted'].includes(appointment.status) && new Date(appointment.startsAt) > new Date();
              return <article className="appointment-card" key={appointment.id}>
                <div className="appointment-date"><span>{longDate(appointment.startsAt, doctor?.timezone || undefined)}</span><strong>{timeInZone(appointment.startsAt, doctor?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone)}</strong><small>{Math.round((new Date(appointment.endsAt) - new Date(appointment.startsAt)) / 60000)} min visit</small></div>
                <div className="appointment-doctor"><div className="doctor-avatar avatar-small">{initials(doctor?.name || 'Doctor')}</div><div><strong>{doctor?.name ? `Dr. ${doctor.name}` : 'Doctor profile unavailable'}</strong><span>{doctor?.specialty || `Doctor ID · ${appointment.doctorId.slice(-6)}`}</span>{appointment.reason && <small>“{appointment.reason}”</small>}</div></div>
                <div className="appointment-actions"><span className={`status-badge status-${appointment.status}`}>{appointment.status}</span>{canCancel && <button className="button button-cancel" type="button" disabled={cancellingId === appointment.id} onClick={() => cancelAppointment(appointment.id)}>{cancellingId === appointment.id ? 'Cancelling…' : 'Cancel visit'}</button>}</div>
              </article>;
            })}</div>}
          </section>
        )}

        {!authMode && isDoctorDashboard && user?.role === 'doctor' && <DoctorDashboard />}
      </main>
      <footer className="site-footer"><div><a className="brand footer-brand" href="#top" onClick={(event) => { event.preventDefault(); showDirectory(); }}><span className="brand-mark" aria-hidden="true">+</span><span>MediBook</span></a><span>Thoughtful care, one appointment at a time.</span></div><span>Made for better days.</span></footer>
    </div>
  );
}

function weekdayName(day) {
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][Number(day)] || 'Day';
}

function DoctorCard({ doctor, index, onOpen }) {
  return <article className={`doctor-card card-tone-${index % 4}`}>
    <div className="card-topline"><span className="specialty-pill">{doctor.specialty}</span><span className="card-symbol" aria-hidden="true">✳</span></div>
    <div className="doctor-card-person"><div className="doctor-avatar">{initials(doctor.name)}</div><div><h3>Dr. {doctor.name}</h3><span className="verified-text"><span>✓</span> Verified professional</span></div></div>
    <p className="doctor-bio">{doctor.bio || 'A compassionate professional, ready to listen and help you feel your best.'}</p>
    <div className="doctor-card-bottom"><div className="fee-display"><small>Consultation</small><strong>₹{Number(doctor.consultationFee).toLocaleString('en-IN')}</strong></div><button className="button button-card" type="button" onClick={onOpen}>View profile <span aria-hidden="true">↗</span></button></div>
  </article>;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const AVAILABLE_TIMEZONES = typeof Intl.supportedValuesOf === 'function'
  ? Intl.supportedValuesOf('timeZone')
  : ['Asia/Kolkata', 'UTC'];

function doctorLocalDate(instant, timezone) {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: timezone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(instant));
}

function doctorLocalTime(instant, timezone) {
  return new Intl.DateTimeFormat(undefined, {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(instant));
}

function DoctorDashboard() {
  const [doctor, setDoctor] = useState(null);
  const [appointments, setAppointments] = useState([]);
  const [appointmentPage, setAppointmentPage] = useState(1);
  const [appointmentPages, setAppointmentPages] = useState(1);
  const [loadState, setLoadState] = useState('loading');
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const [actionId, setActionId] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [timezone, setTimezone] = useState('Asia/Kolkata');
  const [availability, setAvailability] = useState([]);
  const [savingAvailability, setSavingAvailability] = useState(false);
  const [availabilityError, setAvailabilityError] = useState('');
  const [availabilityConflicts, setAvailabilityConflicts] = useState([]);

  useEffect(() => {
    let active = true;
    setLoadState('loading');
    setLoadError('');
    apiRequest(`/doctor/appointments?page=${appointmentPage}&limit=50`)
      .then((data) => {
        if (!active) return;
        setDoctor(data.doctor);
        setAppointments(data.appointments || []);
        setAppointmentPages(data.pagination?.pages || 1);
        setTimezone(data.doctor.timezone || 'Asia/Kolkata');
        setAvailability((data.doctor.availability || []).map((window) => ({ ...window })));
        setLoadState('ready');
      })
      .catch((error) => {
        if (!active) return;
        setLoadError(formatApiError(error));
        setLoadState('error');
      });
    return () => { active = false; };
  }, [refresh, appointmentPage]);

  async function changeAppointmentStatus(appointment, status) {
    setActionId(appointment.id);
    setNotice('');
    setActionError('');
    try {
      await apiRequest(`/doctor/appointments/${encodeURIComponent(appointment.id)}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
      setNotice(`Appointment ${status}.`);
      setRefresh((value) => value + 1);
    } catch (error) {
      setActionError(formatApiError(error));
      setRefresh((value) => value + 1);
    } finally {
      setActionId('');
    }
  }

  function validateAvailabilityForm() {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    } catch {
      return 'Enter a valid IANA timezone, such as Asia/Kolkata.';
    }
    for (const [index, window] of availability.entries()) {
      if (!Number.isInteger(Number(window.weekday)) || Number(window.weekday) < 0 || Number(window.weekday) > 6) {
        return `Choose a valid weekday for working window ${index + 1}.`;
      }
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(window.startTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(window.endTime)) {
        return `Use 24-hour HH:mm times for working window ${index + 1}.`;
      }
      if (window.startTime >= window.endTime) return `Window ${index + 1} must end after it starts.`;
    }
    const byDay = new Map();
    for (const window of availability) {
      const day = Number(window.weekday);
      const windows = byDay.get(day) || [];
      windows.push(window);
      byDay.set(day, windows);
    }
    for (const windows of byDay.values()) {
      windows.sort((left, right) => left.startTime.localeCompare(right.startTime));
      for (let index = 1; index < windows.length; index += 1) {
        if (windows[index].startTime < windows[index - 1].endTime) return 'Working windows on the same day cannot overlap.';
      }
    }
    return '';
  }

  async function saveAvailability(event) {
    event.preventDefault();
    setAvailabilityError(validateAvailabilityForm());
    setAvailabilityConflicts([]);
    setNotice('');
    if (validateAvailabilityForm()) return;
    setSavingAvailability(true);
    try {
      const response = await apiRequest('/doctor/me/availability', {
        method: 'PUT',
        body: JSON.stringify({
          timezone: timezone.trim(),
          availability: availability.map(({ weekday, startTime, endTime }) => ({
            weekday: Number(weekday), startTime, endTime,
          })),
        }),
      });
      setDoctor(response.doctor);
      setTimezone(response.doctor.timezone);
      setAvailability(response.doctor.availability || []);
      setAvailabilityError('');
      setAvailabilityConflicts([]);
      setNotice('Weekly availability saved. Public booking slots now use this schedule.');
    } catch (error) {
      setAvailabilityError(formatApiError(error));
      setAvailabilityConflicts(error.details?.appointments || []);
    } finally {
      setSavingAvailability(false);
    }
  }

  function editWindow(index, field, value) {
    setAvailability((current) => current.map((window, rowIndex) => rowIndex === index ? { ...window, [field]: value } : window));
    setAvailabilityError('');
    setAvailabilityConflicts([]);
  }

  const requestedCount = appointments.filter((appointment) => appointment.status === 'requested').length;
  const acceptedCount = appointments.filter((appointment) => appointment.status === 'accepted').length;

  return (
    <section className="doctor-dashboard-page">
      <div className="dashboard-heading doctor-dashboard-heading">
        <div><p className="eyebrow">YOUR PRACTICE, AT A GLANCE</p><h1>Doctor dashboard</h1><p className="muted">{doctor ? `Welcome, ${doctor.name}. Manage your visits and weekly hours.` : 'Manage your visits and weekly hours.'}</p></div>
        <button className="button button-outline" type="button" onClick={() => setRefresh((value) => value + 1)} disabled={loadState === 'loading'}>Refresh dashboard ↻</button>
      </div>

      {notice && <div className="doctor-success" role="status"><span>✓</span>{notice}</div>}
      {loadError && loadState !== 'error' && <div className="inline-error" role="alert">{loadError}</div>}
      {actionError && <div className="inline-error" role="alert">{actionError}</div>}

      {loadState === 'loading' && <div className="state-panel" role="status"><span className="spinner" /> Loading your doctor workspace…</div>}
      {loadState === 'error' && <div className="state-panel state-error" role="alert"><strong>We couldn’t load your doctor workspace.</strong><span>{loadError}</span><button className="button button-outline" type="button" onClick={() => setRefresh((value) => value + 1)}>Try again</button></div>}

      {loadState === 'ready' && doctor && (
        <>
          <div className="doctor-stat-grid">
            <article className="doctor-stat"><span className="stat-symbol">◷</span><div><small>All appointments</small><strong>{appointments.length}</strong></div></article>
            <article className="doctor-stat"><span className="stat-symbol stat-pending">…</span><div><small>Awaiting your response</small><strong>{requestedCount}</strong></div></article>
            <article className="doctor-stat"><span className="stat-symbol stat-confirmed">✓</span><div><small>Accepted visits</small><strong>{acceptedCount}</strong></div></article>
          </div>

          <div className="doctor-workspace-grid">
            <section className="doctor-appointments-panel" aria-labelledby="doctor-appointments-title">
              <div className="doctor-panel-heading"><div><p className="eyebrow">PATIENT VISITS</p><h2 id="doctor-appointments-title">Appointments</h2></div><span className="panel-timezone">{doctor.timezone}</span></div>
              {appointments.length === 0 && <div className="doctor-empty"><span>✳</span><strong>No appointments yet</strong><p>New patient requests will appear here.</p></div>}
              {appointments.length > 0 && <div className="doctor-appointment-list">{appointments.map((appointment) => (
                <article className="doctor-appointment-card" key={appointment.id}>
                  <div className="doctor-appointment-top"><div><span className="appointment-kicker">{doctorLocalDate(appointment.startsAt, doctor.timezone)}</span><h3>{appointment.patient?.name || 'Patient'}</h3></div><span className={`status-badge status-${appointment.status}`}>{appointment.status}</span></div>
                  <div className="doctor-appointment-meta"><span>{doctorLocalTime(appointment.startsAt, doctor.timezone)} – {doctorLocalTime(appointment.endsAt, doctor.timezone)} · {doctor.timezone}</span>{appointment.reason && <p>{appointment.reason}</p>}</div>
                  {appointment.status === 'requested' && <div className="doctor-appointment-actions"><button className="button button-accept" type="button" disabled={actionId === appointment.id} onClick={() => changeAppointmentStatus(appointment, 'accepted')}>{actionId === appointment.id ? 'Saving…' : 'Accept request'}</button><button className="button button-reject" type="button" disabled={actionId === appointment.id} onClick={() => changeAppointmentStatus(appointment, 'rejected')}>Reject</button></div>}
                </article>
              ))}</div>}
              {appointmentPages > 1 && <div className="doctor-pagination"><button className="button button-outline" type="button" disabled={appointmentPage <= 1} onClick={() => setAppointmentPage((page) => page - 1)}>← Previous</button><span>Page {appointmentPage} of {appointmentPages}</span><button className="button button-outline" type="button" disabled={appointmentPage >= appointmentPages} onClick={() => setAppointmentPage((page) => page + 1)}>Next →</button></div>}
            </section>

            <section className="availability-panel" aria-labelledby="availability-title">
              <div className="doctor-panel-heading"><div><p className="eyebrow">SET YOUR HOURS</p><h2 id="availability-title">Weekly availability</h2></div><span className="availability-clock">◷</span></div>
              <p className="muted">Your local hours generate 30-minute booking slots. Booked appointments stay in place.</p>
              <form onSubmit={saveAvailability}>
                <label className="field">Time zone (IANA identifier)
                  <input list="timezone-options" value={timezone} onChange={(event) => { setTimezone(event.target.value); setAvailabilityError(''); setAvailabilityConflicts([]); }} placeholder="Asia/Kolkata" required />
                  <datalist id="timezone-options">{AVAILABLE_TIMEZONES.map((zone) => <option key={zone} value={zone} />)}</datalist>
                </label>
                <div className="availability-rows-heading"><span>Day and working hours</span><button type="button" className="add-window" onClick={() => setAvailability((current) => [...current, { weekday: 1, startTime: '09:00', endTime: '17:00' }])}>+ Add hours</button></div>
                {availability.length === 0 && <div className="availability-no-hours">No hours set. Add a weekly window to make booking slots available.</div>}
                <div className="availability-window-list">{availability.map((window, index) => (
                  <div className="availability-window-row" key={`${index}-${window.weekday}-${window.startTime}`}>
                    <label><span className="sr-only">Weekday</span><select aria-label={`Window ${index + 1} weekday`} value={window.weekday} onChange={(event) => editWindow(index, 'weekday', Number(event.target.value))}>{WEEKDAYS.map((day, weekday) => <option key={day} value={weekday}>{day}</option>)}</select></label>
                    <label><span className="sr-only">Start time</span><input aria-label={`Window ${index + 1} start time`} type="time" value={window.startTime} onChange={(event) => editWindow(index, 'startTime', event.target.value)} /></label>
                    <span className="window-separator">to</span>
                    <label><span className="sr-only">End time</span><input aria-label={`Window ${index + 1} end time`} type="time" value={window.endTime} onChange={(event) => editWindow(index, 'endTime', event.target.value)} /></label>
                    <button className="remove-window" type="button" aria-label={`Remove ${WEEKDAYS[window.weekday]} hours ${index + 1}`} onClick={() => { setAvailability((current) => current.filter((_, rowIndex) => rowIndex !== index)); setAvailabilityError(''); setAvailabilityConflicts([]); }}>×</button>
                  </div>
                ))}</div>
                {availabilityError && <p className="form-error" role="alert">{availabilityError}</p>}
                {availabilityConflicts.length > 0 && <div className="availability-conflicts" role="alert"><strong>These future appointments fall outside the proposed hours:</strong><ul>{availabilityConflicts.map((conflict) => <li key={conflict.id}>{conflict.patientName} · {doctorLocalDate(conflict.startsAt, timezone || doctor.timezone)} · {doctorLocalTime(conflict.startsAt, timezone || doctor.timezone)}</li>)}</ul><span>No availability was changed. Keep these times in your schedule or resolve the appointments first.</span></div>}
                <button className="button button-primary button-full save-availability" type="submit" disabled={savingAvailability}>{savingAvailability ? 'Saving hours…' : 'Save weekly hours'}</button>
              </form>
            </section>
          </div>
        </>
      )}
    </section>
  );
}

export default App;
