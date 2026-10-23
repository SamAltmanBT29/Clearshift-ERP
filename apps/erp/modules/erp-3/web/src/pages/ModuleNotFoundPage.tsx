/**
 * ERP-3 Sales Orders and Invoices — Module Not Found View
 *
 * Rendered inside the module shell when a path under `/erp3` matches no
 * registered route. It keeps the navigation, the breadcrumb and the browser
 * title intact so the operator can recover without a full page reload.
 *
 * @module erp3/web/pages/ModuleNotFoundPage
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { Alert, PageTitle } from '@cs/ui';
import { ERP3_BASE_PATH } from '../route-manifest.js';

export const ModuleNotFoundPage: React.FC = () => (
  <>
    <PageTitle
      title="Screen not found"
      subtitle="This address does not match any screen of the Sales Orders and Invoices module."
    />
    <Alert variant="warning" title="Nothing to show here">
      <p>
        The address is not part of the Sales Orders and Invoices module. Pick a screen from the
        navigation, or go back to the module start.
      </p>
      <p>
        <Link className="cs-erp3-link" to={`${ERP3_BASE_PATH}/sales-orders`}>
          Go to Sales Orders
        </Link>
      </p>
    </Alert>
  </>
);

export default ModuleNotFoundPage;
