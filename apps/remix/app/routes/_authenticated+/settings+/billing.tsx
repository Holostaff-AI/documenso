import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';

import { SettingsHeader } from '~/components/general/settings-header';
import { UserBillingOrganisationsTable } from '~/components/tables/user-billing-organisations-table';
import { appMetaTags } from '~/utils/meta';
import { holostaff } from '@holostaff/sdk'
import { useEffect } from 'react'

export function meta() {
  return appMetaTags(msg`Billing`);
}

export default function SettingsBilling() {
  // ── Holostaff instrumentation ──────────────────────────────────
  // Added by the Holostaff deploy agent (Documenso · deploy v1).
  // Marks the visitor entering the "expansion" journey stage when
  // this entry page mounts — powers stage-aware copilot monitoring.
  // Safe to relocate; keep one call per entry page. https://docs.holostaff.ai
  useEffect(() => { holostaff.markStageEntry('expansion') }, []) // entry page for "Subscription Upgrade / Billing"

  const { t } = useLingui();

  return (
    <div>
      <SettingsHeader
        title={t`Billing`}
        subtitle={t`Manage billing and subscriptions for organisations where you have billing management permissions.`}
      />

      <UserBillingOrganisationsTable />
    </div>
  );
}
