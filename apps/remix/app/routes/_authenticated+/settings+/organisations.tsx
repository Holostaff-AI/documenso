import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react';

import { OrganisationCreateDialog } from '~/components/dialogs/organisation-create-dialog';
import { OrganisationInvitations } from '~/components/general/organisations/organisation-invitations';
import { SettingsHeader } from '~/components/general/settings-header';
import { UserOrganisationsTable } from '~/components/tables/user-organisations-table';
import { holostaff } from '@holostaff/sdk'
import { useEffect } from 'react'

export default function TeamsSettingsPage() {
  // ── Holostaff instrumentation ──────────────────────────────────
  // Added by the Holostaff deploy agent (Documenso · deploy v1).
  // Marks the visitor entering the "onboarding" journey stage when
  // this entry page mounts — powers stage-aware copilot monitoring.
  // Safe to relocate; keep one call per entry page. https://docs.holostaff.ai
  useEffect(() => { holostaff.markStageEntry('onboarding') }, []) // entry page for "Organisation & Team Setup"

  const { _ } = useLingui();

  return (
    <div>
      <SettingsHeader
        title={_(msg`Organisations`)}
        subtitle={_(msg`Manage all organisations you are currently associated with.`)}
      >
        <OrganisationCreateDialog />
      </SettingsHeader>

      <UserOrganisationsTable />

      <div className="mt-8 space-y-8">
        <OrganisationInvitations />
      </div>
    </div>
  );
}
