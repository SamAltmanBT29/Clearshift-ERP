/**
 * ERP-5 HR & Employees — Permission Denied State
 *
 * The state the module shows when the **API** answers `403`. It is distinct
 * from the failure state: a forbidden request is not an error to retry, it
 * is a statement about the session, and the screen says so in plain words
 * instead of showing a stack trace or a technical code.
 *
 * @module erp5/web/components/PermissionDeniedState
 */

import React from 'react';

export interface PermissionDeniedStateProps {
  /** The message the API returned, when it returned one. */
  readonly message?: string | undefined;
  /** The capability the screen needs. */
  readonly requiredCapability?: string | undefined;
  readonly className?: string | undefined;
}

const HEADING_ID = 'erp5-permission-denied-title';

export const PermissionDeniedState: React.FC<PermissionDeniedStateProps> = ({
  message,
  requiredCapability,
  className,
}) => (
  <section
    className={`cs-erp5-forbidden ${className ?? ''}`.trim()}
    role="region"
    aria-labelledby={HEADING_ID}
  >
    <h2 className="cs-erp5-forbidden-title" id={HEADING_ID}>
      Access denied
    </h2>
    <p className="cs-erp5-forbidden-text">
      {message ??
        'Your role does not allow this screen. Ask an administrator for the HR module read permission.'}
    </p>
    {requiredCapability ? (
      <p className="cs-erp5-forbidden-hint">
        Required permission: <code>{requiredCapability}</code>
      </p>
    ) : null}
  </section>
);

export default PermissionDeniedState;
