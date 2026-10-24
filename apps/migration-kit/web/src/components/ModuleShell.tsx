import React from 'react';
import { Outlet } from 'react-router-dom';

export const MIGRATION_KIT_MAIN_REGION_ID = 'migration-kit-main';

export const ModuleShell: React.FC = () => {
  return (
    <div className="cs-module-shell" data-testid="module-shell">
      <header className="cs-banner" role="banner">
        <h1>Migration Kit</h1>
      </header>
      <nav className="cs-nav" role="navigation" aria-label="Migration Kit navigation">
        <a href="/kit/batches">Batches</a>
      </nav>
      <main id={MIGRATION_KIT_MAIN_REGION_ID} role="main" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  );
};