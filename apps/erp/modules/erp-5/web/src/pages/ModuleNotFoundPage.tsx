/**
 * ERP-5 HR & Employees — Module Not Found View
 *
 * Rendered inside the module shell when a path under `/erp5` matches no
 * registered route. It keeps the navigation, the breadcrumb and the browser
 * title intact so the operator can recover without a full page reload.
 *
 * @module erp5/web/pages/ModuleNotFoundPage
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { Alert, PageTitle } from '@cs/ui';
import { ERP5_BASE_PATH } from '../route-manifest.js';

export const ModuleNotFoundPage: React.FC = () => (
  <>
    <PageTitle
      title="Screen not found"
      subtitle="This address does not match any screen of the HR and Employees module."
    />
    <Alert variant="warning" title="Nothing to show here">
      <p>
        The address is not part of the HR and Employees module. Pick a screen from the
        navigation, or go back to the module start.
      </p>
      <p>
        <Link className="cs-erp5-link" to={ERP5_BASE_PATH}>
          Go to HR and Employees
        </Link>
      </p>
    </Alert>
  </>
);

export default ModuleNotFoundPage;
