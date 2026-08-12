import { useDebouncedValue } from '@documenso/lib/client-only/hooks/use-debounced-value';
import { Input } from '@documenso/ui/primitives/input';
import { useLingui } from '@lingui/react/macro';
import { useEffect, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router';

import { TeamMemberCreateDialog } from '~/components/dialogs/team-member-create-dialog';
import { SettingsHeader } from '~/components/general/settings-header';
import { TeamMembersTable } from '~/components/tables/team-members-table';
import { HolostaffStageMark } from '../../../holostaff-stage-mark'

function TeamsSettingsMembersPage() {
  const { t } = useLingui();

  const [searchParams, setSearchParams] = useSearchParams();
  const { pathname } = useLocation();

  const [searchQuery, setSearchQuery] = useState(() => searchParams?.get('query') ?? '');

  const debouncedSearchQuery = useDebouncedValue(searchQuery, 500);

  /**
   * Handle debouncing the search query.
   */
  useEffect(() => {
    const params = new URLSearchParams(searchParams?.toString());

    params.set('query', debouncedSearchQuery);

    if (debouncedSearchQuery === '') {
      params.delete('query');
    }

    // If nothing  to change then do nothing.
    if (params.toString() === searchParams?.toString()) {
      return;
    }

    setSearchParams(params);
  }, [debouncedSearchQuery, pathname, searchParams]);

  return (
    <div>
      <SettingsHeader title={t`Team Members`} subtitle={t`Manage the members of your team.`}>
        <TeamMemberCreateDialog />
      </SettingsHeader>

      <Input
        defaultValue={searchQuery}
        onChange={(e) => setSearchQuery(e.target.value)}
        placeholder={t`Search`}
        className="mb-4"
      />

      <TeamMembersTable />
    </div>
  );
}

// ── Holostaff instrumentation ──────────────────────────────────
// Added by the Holostaff deploy agent (Documenso · deploy v2).
// Marks the visitor entering the "expansion" journey stage when
// this entry page mounts — powers stage-aware copilot monitoring.
// Safe to relocate; keep one call per entry page. https://docs.holostaff.ai
export default function HolostaffPage(props: any) {
  return (
    <>
      <HolostaffStageMark stage="expansion" /> {/* entry page for "Invite Team Members" */}
      <TeamsSettingsMembersPage {...props} />
    </>
  )
}
