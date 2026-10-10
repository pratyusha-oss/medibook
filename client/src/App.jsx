import React from 'react';

function App() {
  return (
    <main className="welcome-page">
      <nav className="topbar" aria-label="Main navigation">
        <a className="brand" href="/" aria-label="MediBook home">
          <span className="brand-mark" aria-hidden="true">+</span>
          MediBook
        </a>
        <span className="topbar-note">Care that fits your day</span>
      </nav>

      <section className="welcome-card" aria-labelledby="welcome-title">
        <p className="eyebrow">YOUR HEALTH, MADE SIMPLER</p>
        <h1 id="welcome-title">The right care starts here.</h1>
        <p className="welcome-copy">
          Find a doctor, choose a time, and keep your appointments in one calm, simple place.
        </p>
        <div className="welcome-actions">
          <button type="button" className="button button-primary" disabled>
            Patient booking is coming soon
          </button>
        </div>
        <p className="setup-note">MediBook is being set up. Sign-in and booking will be added in the next project milestone.</p>
      </section>
      <footer className="page-footer">Thoughtful care, one appointment at a time.</footer>
    </main>
  );
}

export default App;
