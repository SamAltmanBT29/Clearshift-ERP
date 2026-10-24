import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createBatch, runDryRun, runLoad, canPerformTransition } from '../api/migration-kit.js';
import { readAccessToken, parseJwtRoles } from '../auth/session.js';

export type WizardStep = 'upload' | 'profile' | 'mapping' | 'dryrun';

const STEPS: WizardStep[] = ['upload', 'profile', 'mapping', 'dryrun'];

export interface NewBatchWizardPageProps {
  onComplete?: (batchId: string) => void;
}

export const NewBatchWizardPage: React.FC<NewBatchWizardPageProps> = ({ onComplete }) => {
  const navigate = useNavigate();
  const [step, setStep] = useState<WizardStep>('upload');
  const [batchName, setBatchName] = useState('');
  const [module, setModule] = useState('erp1');
  const [entity, setEntity] = useState('products');
  const [batchId, setBatchId] = useState<string | null>(null);
  const [uploadDone, setUploadDone] = useState(false);
  const [profileDone, setProfileDone] = useState(false);
  const [mappingDone, setMappingDone] = useState(false);
  const [dryRunPassed, setDryRunPassed] = useState(false);
  const [dryRunStale, setDryRunStale] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const roles = parseJwtRoles(readAccessToken());
  const canLoad = canPerformTransition('dry_run_passed', 'load', roles) && dryRunPassed && !dryRunStale;

  const handleCreateBatch = async () => {
    setLoading(true);
    setError(null);
    try {
      const b = await createBatch({ name: batchName || 'New Batch', module, entity });
      setBatchId(b.id);
      setUploadDone(true);
      setStep('profile');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to create batch');
    } finally {
      setLoading(false);
    }
  };

  const handleProfile = () => {
    setProfileDone(true);
    setStep('mapping');
  };

  const handleMapping = () => {
    setMappingDone(true);
    setStep('dryrun');
  };

  const handleDryRun = async () => {
    if (!batchId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await runDryRun(batchId);
      if (res.passed) {
        setDryRunPassed(true);
        setDryRunStale(false);
      } else {
        setDryRunPassed(false);
        setError('Dry run failed');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Dry run failed');
    } finally {
      setLoading(false);
    }
  };

  const handleLoad = async () => {
    if (!batchId) return;
    if (!dryRunPassed || dryRunStale) {
      setError('Dry run required or stale');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      await runLoad(batchId);
      onComplete?.(batchId);
      navigate(`/kit/batches/${batchId}/result`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Load failed');
    } finally {
      setLoading(false);
    }
  };

  const stepIndex = STEPS.indexOf(step);

  return (
    <div data-testid="new-batch-wizard" className="cs-page-container">
      <h1>New Migration Batch</h1>
      <nav aria-label="Wizard steps">
        {STEPS.map((s, i) => (
          <span key={s} data-testid={`step-${s}`} className={i === stepIndex ? 'active' : ''}>
            {i + 1}. {s}
          </span>
        ))}
      </nav>

      {step === 'upload' && (
        <section data-testid="wizard-upload-step">
          <label>
            Batch Name
            <input data-testid="input-batch-name" value={batchName} onChange={(e) => setBatchName(e.target.value)} />
          </label>
          <label>
            Module
            <select data-testid="select-module" value={module} onChange={(e) => setModule(e.target.value)}>
              <option value="erp1">erp1</option>
              <option value="erp2">erp2</option>
            </select>
          </label>
          <label>
            Entity
            <input data-testid="input-entity" value={entity} onChange={(e) => setEntity(e.target.value)} />
          </label>
          <button data-testid="btn-create-batch" onClick={handleCreateBatch} disabled={loading}>
            Create Batch
          </button>
        </section>
      )}

      {step === 'profile' && (
        <section data-testid="wizard-profile-step">
          <p>Profiling complete.</p>
          <button data-testid="btn-profile-next" onClick={handleProfile} disabled={!uploadDone}>
            Next
          </button>
        </section>
      )}

      {step === 'mapping' && (
        <section data-testid="wizard-mapping-step">
          <p>Mapping complete.</p>
          <button data-testid="btn-mapping-next" onClick={handleMapping} disabled={!profileDone}>
            Next
          </button>
        </section>
      )}

      {step === 'dryrun' && (
        <section data-testid="wizard-dryrun-step">
          <button data-testid="btn-dry-run" onClick={handleDryRun} disabled={loading || !mappingDone}>
            Run Dry Run
          </button>
          {dryRunPassed && !dryRunStale && <span data-testid="dry-run-passed">Dry run passed</span>}
          {dryRunStale && <span data-testid="dry-run-stale">Dry run stale</span>}
          <button
            data-testid="btn-load"
            onClick={handleLoad}
            disabled={!canLoad || loading}
          >
            Load
          </button>
          {!canLoad && <span data-testid="load-disabled-reason">Load requires current dry-run pass and permission</span>}
        </section>
      )}

      {error && <div data-testid="wizard-error" role="alert">{error}</div>}
      {loading && <div data-testid="wizard-loading">Loading...</div>}
    </div>
  );
};