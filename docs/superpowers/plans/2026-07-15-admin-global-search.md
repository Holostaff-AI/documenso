# Admin Global Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Stripe-style admin global search to the existing ⌘K command menu: admin users typing IDs or text see verified, grouped results across all admin resources and can jump straight to the matching admin page.

**Architecture:** One new `adminProcedure` TRPC query (`admin.search`) fans out server-side to parallel Prisma lookups across 9 resource types (query classified as prefixed ID / bare number / free text) and returns small pre-labelled result groups. The frontend adds one debounced query + result groups to the existing `AppCommandMenu`, gated on `isAdmin(user)`.

**Tech Stack:** TRPC v11 (`adminProcedure`), Prisma, Zod, React (Remix app), cmdk via `@documenso/ui/primitives/command`, Lingui i18n, Playwright E2E.

**Spec:** `docs/superpowers/specs/2026-07-15-admin-global-search-design.md`

**Prerequisites for E2E steps:** the dev server must be running (`npm run dev` in a separate terminal, app on `http://localhost:3000`) with the local database up. E2E commands use `npm run test:dev -w @documenso/app-tests -- <spec-path>`.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `packages/app-tests/e2e/api/trpc/admin/admin-search.spec.ts` | Create | API-level tests: auth, classification, verified lookups |
| `packages/trpc/server/admin-router/admin-search.types.ts` | Create | Request/response Zod schemas |
| `packages/lib/server-only/admin/admin-global-search.ts` | Create | Query classification + parallel lookups + label building |
| `packages/trpc/server/admin-router/admin-search.ts` | Create | TRPC route wiring lib function to `adminProcedure` |
| `packages/trpc/server/admin-router/router.ts` | Modify | Register `search: adminSearchRoute` |
| `packages/app-tests/e2e/admin/global-search.spec.ts` | Create | UI tests: command menu shows admin groups, navigation works |
| `apps/remix/app/components/general/app-command-menu.tsx` | Modify | Admin query + admin result groups + `AdminSearchCommands` |

---

### Task 1: Failing TRPC API E2E spec

**Files:**
- Create: `packages/app-tests/e2e/api/trpc/admin/admin-search.spec.ts`

- [ ] **Step 1: Write the failing API test**

Create `packages/app-tests/e2e/api/trpc/admin/admin-search.spec.ts`:

```ts
import { NEXT_PUBLIC_WEBAPP_URL } from '@documenso/lib/constants/app';
import { seedPendingDocument } from '@documenso/prisma/seed/documents';
import { seedUser } from '@documenso/prisma/seed/users';
import type { Page } from '@playwright/test';
import { expect, test } from '@playwright/test';

import { apiSignin } from '../../../fixtures/authentication';

const WEBAPP_BASE_URL = NEXT_PUBLIC_WEBAPP_URL();

test.describe.configure({ mode: 'parallel' });

type AdminSearchGroup = {
  type: string;
  results: Array<{ label: string; sublabel?: string; path: string; value: string }>;
};

const callAdminSearch = async (page: Page, query: string) => {
  const inputParam = encodeURIComponent(JSON.stringify({ json: { query } }));
  const url = `${WEBAPP_BASE_URL}/api/trpc/admin.search?input=${inputParam}`;

  const res = await page.context().request.get(url);

  return {
    res,
    groups: res.ok()
      ? // eslint-disable-next-line @typescript-eslint/consistent-type-assertions
        ((await res.json()).result.data.json.groups as AdminSearchGroup[])
      : null,
  };
};

const findGroup = (groups: AdminSearchGroup[] | null, type: string) =>
  (groups ?? []).find((group) => group.type === type);

// ─── Access control ──────────────────────────────────────────────────────────

test('[ADMIN][TRPC][SEARCH]: unauthenticated request is rejected with 401', async ({ page }) => {
  const { res } = await callAdminSearch(page, 'anything');

  expect(res.ok()).toBeFalsy();
  expect(res.status()).toBe(401);
});

test('[ADMIN][TRPC][SEARCH]: non-admin authenticated user is rejected with 401', async ({ page }) => {
  const { user: nonAdminUser } = await seedUser({ isAdmin: false });

  await apiSignin({ page, email: nonAdminUser.email });

  const { res } = await callAdminSearch(page, 'anything');

  expect(res.ok()).toBeFalsy();
  expect(res.status()).toBe(401);
});

// ─── Numeric queries: verified ID lookups ────────────────────────────────────

test('[ADMIN][TRPC][SEARCH]: numeric query returns verified user and team rows', async ({ page }) => {
  const { user: adminUser } = await seedUser({ isAdmin: true });
  const { user: targetUser, team: targetTeam } = await seedUser();

  await apiSignin({ page, email: adminUser.email });

  // Search by user ID.
  const userSearch = await callAdminSearch(page, String(targetUser.id));

  expect(userSearch.res.ok()).toBeTruthy();

  const userGroup = findGroup(userSearch.groups, 'user');
  expect(userGroup).toBeDefined();
  expect(userGroup?.results[0].path).toBe(`/admin/users/${targetUser.id}`);
  expect(userGroup?.results[0].sublabel).toContain(targetUser.email);

  // Search by team ID.
  const teamSearch = await callAdminSearch(page, String(targetTeam.id));

  expect(teamSearch.res.ok()).toBeTruthy();

  const teamGroup = findGroup(teamSearch.groups, 'team');
  expect(teamGroup).toBeDefined();
  expect(teamGroup?.results[0].path).toBe(`/admin/teams/${targetTeam.id}`);
  expect(teamGroup?.results[0].label).toBe(targetTeam.name);
});

test('[ADMIN][TRPC][SEARCH]: numeric query returns verified document and recipient rows', async ({
  page,
}) => {
  const { user: adminUser } = await seedUser({ isAdmin: true });
  const { user: sender, team } = await seedUser();
  const { user: recipientUser } = await seedUser();

  const document = await seedPendingDocument(sender, team.id, [recipientUser]);
  const legacyDocumentId = document.secondaryId.replace('document_', '');
  const recipient = document.recipients[0];

  await apiSignin({ page, email: adminUser.email });

  // Search by legacy document ID (bare number).
  const documentSearch = await callAdminSearch(page, legacyDocumentId);

  expect(documentSearch.res.ok()).toBeTruthy();

  const documentGroup = findGroup(documentSearch.groups, 'document');
  expect(documentGroup).toBeDefined();
  expect(documentGroup?.results[0].path).toBe(`/admin/documents/${document.id}`);
  expect(documentGroup?.results[0].label).toBe(document.title);

  // Search by recipient ID: links to the parent document.
  const recipientSearch = await callAdminSearch(page, String(recipient.id));

  expect(recipientSearch.res.ok()).toBeTruthy();

  const recipientGroup = findGroup(recipientSearch.groups, 'recipient');
  expect(recipientGroup).toBeDefined();
  expect(recipientGroup?.results[0].path).toBe(`/admin/documents/${document.id}`);
  expect(recipientGroup?.results[0].label).toBe(recipient.email);
});

test('[ADMIN][TRPC][SEARCH]: numeric query with no matches returns no groups', async ({ page }) => {
  const { user: adminUser } = await seedUser({ isAdmin: true });

  await apiSignin({ page, email: adminUser.email });

  const { res, groups } = await callAdminSearch(page, '999999999');

  expect(res.ok()).toBeTruthy();
  expect(groups).toEqual([]);
});

test('[ADMIN][TRPC][SEARCH]: oversized number does not error and falls back to text search', async ({
  page,
}) => {
  const { user: adminUser } = await seedUser({ isAdmin: true });

  await apiSignin({ page, email: adminUser.email });

  // 99999999999999 exceeds Int4; must not 500.
  const { res, groups } = await callAdminSearch(page, '99999999999999');

  expect(res.ok()).toBeTruthy();
  expect(Array.isArray(groups)).toBeTruthy();
});

// ─── Prefixed ID queries: exact lookups ──────────────────────────────────────

test('[ADMIN][TRPC][SEARCH]: envelope_ and org_ prefixes resolve exact matches', async ({ page }) => {
  const { user: adminUser } = await seedUser({ isAdmin: true });
  const { user: sender, organisation, team } = await seedUser();

  const document = await seedPendingDocument(sender, team.id, []);

  await apiSignin({ page, email: adminUser.email });

  // envelope_<id> resolves the document.
  const envelopeSearch = await callAdminSearch(page, document.id);

  expect(envelopeSearch.res.ok()).toBeTruthy();

  const documentGroup = findGroup(envelopeSearch.groups, 'document');
  expect(documentGroup).toBeDefined();
  expect(documentGroup?.results[0].path).toBe(`/admin/documents/${document.id}`);

  // Only the document group is returned for a recognized prefix.
  expect(envelopeSearch.groups).toHaveLength(1);

  // org_<id> resolves the organisation.
  const orgSearch = await callAdminSearch(page, organisation.id);

  expect(orgSearch.res.ok()).toBeTruthy();

  const orgGroup = findGroup(orgSearch.groups, 'organisation');
  expect(orgGroup).toBeDefined();
  expect(orgGroup?.results[0].path).toBe(`/admin/organisations/${organisation.id}`);
  expect(orgGroup?.results[0].label).toBe(organisation.name);
});

// ─── Free text queries ───────────────────────────────────────────────────────

test('[ADMIN][TRPC][SEARCH]: text query matches documents by title and users by email', async ({
  page,
}) => {
  const { user: adminUser } = await seedUser({ isAdmin: true });
  const { user: sender, team } = await seedUser();

  const document = await seedPendingDocument(sender, team.id, []);

  await apiSignin({ page, email: adminUser.email });

  // Search by document title.
  const titleSearch = await callAdminSearch(page, document.title);

  expect(titleSearch.res.ok()).toBeTruthy();

  const documentGroup = findGroup(titleSearch.groups, 'document');
  expect(documentGroup).toBeDefined();
  expect(documentGroup?.results.map((result) => result.path)).toContain(
    `/admin/documents/${document.id}`,
  );

  // Search by user email (emails are unique nanoid-based, so this is specific).
  const emailSearch = await callAdminSearch(page, sender.email);

  expect(emailSearch.res.ok()).toBeTruthy();

  const userGroup = findGroup(emailSearch.groups, 'user');
  expect(userGroup).toBeDefined();
  expect(userGroup?.results[0].path).toBe(`/admin/users/${sender.id}`);
});

test('[ADMIN][TRPC][SEARCH]: gibberish query returns no groups', async ({ page }) => {
  const { user: adminUser } = await seedUser({ isAdmin: true });

  await apiSignin({ page, email: adminUser.email });

  const { res, groups } = await callAdminSearch(page, 'zzzz-no-such-thing-9x7q');

  expect(res.ok()).toBeTruthy();
  expect(groups).toEqual([]);
});
```

- [ ] **Step 2: Run the spec to verify it fails**

Run: `npm run test:dev -w @documenso/app-tests -- e2e/api/trpc/admin/admin-search.spec.ts`

Expected: FAIL. The route does not exist yet, so `admin.search` returns 404 — the access-control tests fail (404 instead of 401) and all data tests fail with `res.ok()` falsy. Do NOT commit yet.

---

### Task 2: Request/response schemas

**Files:**
- Create: `packages/trpc/server/admin-router/admin-search.types.ts`

- [ ] **Step 1: Write the types file**

Create `packages/trpc/server/admin-router/admin-search.types.ts`:

```ts
import { z } from 'zod';

export const ZAdminSearchResultTypeSchema = z.enum([
  'document',
  'user',
  'organisation',
  'team',
  'recipient',
  'subscription',
  'claim',
  'emailDomain',
  'emailTransport',
]);

export const ZAdminSearchResultSchema = z.object({
  label: z.string(),
  sublabel: z.string().optional(),
  path: z.string(),
  value: z.string(),
});

export const ZAdminSearchRequestSchema = z.object({
  query: z.string().trim().min(1).max(100),
});

export const ZAdminSearchResponseSchema = z.object({
  groups: z.array(
    z.object({
      type: ZAdminSearchResultTypeSchema,
      results: ZAdminSearchResultSchema.array(),
    }),
  ),
});

export type TAdminSearchResultType = z.infer<typeof ZAdminSearchResultTypeSchema>;
export type TAdminSearchResult = z.infer<typeof ZAdminSearchResultSchema>;
export type TAdminSearchRequest = z.infer<typeof ZAdminSearchRequestSchema>;
export type TAdminSearchResponse = z.infer<typeof ZAdminSearchResponseSchema>;
```

Note: the type enum is intentionally duplicated from the lib (Task 3) rather than imported — this types file is imported by the browser bundle and must not pull in `@documenso/prisma`. TypeScript catches any drift because the route's `.output()` schema must structurally match the lib's return type.

- [ ] **Step 2: Commit**

```bash
git add packages/trpc/server/admin-router/admin-search.types.ts
git commit -m "feat: add admin search request/response schemas"
```

---

### Task 3: Lib search function

**Files:**
- Create: `packages/lib/server-only/admin/admin-global-search.ts`

- [ ] **Step 1: Write the search function**

Create `packages/lib/server-only/admin/admin-global-search.ts`:

```ts
import { prisma } from '@documenso/prisma';
import { EnvelopeType } from '@prisma/client';

export const ADMIN_SEARCH_RESULTS_PER_TYPE = 5;

const MAX_POSTGRES_INT = 2147483647;

export type AdminGlobalSearchResultType =
  | 'document'
  | 'user'
  | 'organisation'
  | 'team'
  | 'recipient'
  | 'subscription'
  | 'claim'
  | 'emailDomain'
  | 'emailTransport';

export type AdminGlobalSearchResult = {
  label: string;
  sublabel?: string;
  path: string;
  value: string;
};

export type AdminGlobalSearchGroup = {
  type: AdminGlobalSearchResultType;
  results: AdminGlobalSearchResult[];
};

export type AdminGlobalSearchOptions = {
  query: string;
};

const GROUP_ORDER: AdminGlobalSearchResultType[] = [
  'document',
  'user',
  'organisation',
  'team',
  'recipient',
  'subscription',
  'claim',
  'emailDomain',
  'emailTransport',
];

type PartialResults = Partial<Record<AdminGlobalSearchResultType, AdminGlobalSearchResult[]>>;

export const adminGlobalSearch = async ({
  query,
}: AdminGlobalSearchOptions): Promise<AdminGlobalSearchGroup[]> => {
  const trimmedQuery = query.trim();

  if (trimmedQuery.length === 0) {
    return [];
  }

  const resultsByType = await resolveSearch(trimmedQuery);

  return GROUP_ORDER.map((type) => ({
    type,
    results: (resultsByType[type] ?? []).map((result) => ({
      ...result,
      // Append the raw query so cmdk's client-side filter never hides
      // server-verified results.
      value: `${result.value} ${trimmedQuery}`,
    })),
  })).filter((group) => group.results.length > 0);
};

const resolveSearch = async (query: string): Promise<PartialResults> => {
  // Recognized ID prefixes resolve to a single exact lookup.
  if (query.startsWith('envelope_')) {
    return { document: await findDocumentsByExactId({ id: query }) };
  }

  if (query.startsWith('document_')) {
    return { document: await findDocumentsByExactId({ secondaryId: query }) };
  }

  if (query.startsWith('org_')) {
    return { organisation: await findOrganisationsByIdOrUrl(query) };
  }

  if (query.startsWith('email_domain_')) {
    return { emailDomain: await findEmailDomainsById(query) };
  }

  if (query.startsWith('email_transport_')) {
    return { emailTransport: await findEmailTransportsById(query) };
  }

  // Bare numbers are treated as verified ID lookups only. Oversized numbers
  // fall through to text search to avoid Int4 overflow errors.
  if (/^\d+$/.test(query) && Number(query) <= MAX_POSTGRES_INT) {
    const id = Number(query);

    const [document, user, team, recipient, subscription] = await Promise.all([
      findDocumentsByExactId({ secondaryId: `document_${id}` }),
      findUsersById(id),
      findTeamsById(id),
      findRecipientsById(id),
      findSubscriptionsById(id),
    ]);

    return { document, user, team, recipient, subscription };
  }

  // Free text searches all resource types in parallel.
  const [
    document,
    user,
    organisation,
    team,
    recipient,
    subscription,
    claim,
    emailDomain,
    emailTransport,
  ] = await Promise.all([
    findDocumentsByText(query),
    findUsersByText(query),
    findOrganisationsByText(query),
    findTeamsByText(query),
    findRecipientsByText(query),
    findSubscriptionsByText(query),
    findClaimsByText(query),
    findEmailDomainsByText(query),
    findEmailTransportsByText(query),
  ]);

  return {
    document,
    user,
    organisation,
    team,
    recipient,
    subscription,
    claim,
    emailDomain,
    emailTransport,
  };
};

const joinSublabel = (parts: Array<string | null | undefined>) =>
  parts.filter((part) => part && part.length > 0).join(' · ') || undefined;

// ─── Documents ────────────────────────────────────────────────────────────────

const documentSelect = {
  id: true,
  title: true,
  secondaryId: true,
  user: { select: { email: true } },
} as const;

type DocumentRow = {
  id: string;
  title: string;
  secondaryId: string;
  user: { email: string };
};

const mapDocument = (envelope: DocumentRow): AdminGlobalSearchResult => ({
  label: envelope.title,
  sublabel: joinSublabel([envelope.secondaryId, envelope.user.email]),
  path: `/admin/documents/${envelope.id}`,
  value: `document ${envelope.id} ${envelope.secondaryId} ${envelope.title} ${envelope.user.email}`,
});

const findDocumentsByExactId = async (where: { id: string } | { secondaryId: string }) => {
  const envelope = await prisma.envelope.findFirst({
    where: { ...where, type: EnvelopeType.DOCUMENT },
    select: documentSelect,
  });

  return envelope ? [mapDocument(envelope)] : [];
};

const findDocumentsByText = async (query: string) => {
  const envelopes = await prisma.envelope.findMany({
    where: {
      type: EnvelopeType.DOCUMENT,
      title: { contains: query, mode: 'insensitive' },
    },
    orderBy: { createdAt: 'desc' },
    take: ADMIN_SEARCH_RESULTS_PER_TYPE,
    select: documentSelect,
  });

  return envelopes.map(mapDocument);
};

// ─── Users ────────────────────────────────────────────────────────────────────

const userSelect = {
  id: true,
  name: true,
  email: true,
} as const;

type UserRow = { id: number; name: string | null; email: string };

const mapUser = (user: UserRow): AdminGlobalSearchResult => ({
  label: user.name || user.email,
  sublabel: joinSublabel([`#${user.id}`, user.email]),
  path: `/admin/users/${user.id}`,
  value: `user ${user.id} ${user.name ?? ''} ${user.email}`,
});

const findUsersById = async (id: number) => {
  const user = await prisma.user.findFirst({
    where: { id },
    select: userSelect,
  });

  return user ? [mapUser(user)] : [];
};

const findUsersByText = async (query: string) => {
  const users = await prisma.user.findMany({
    where: {
      OR: [
        { name: { contains: query, mode: 'insensitive' } },
        { email: { contains: query, mode: 'insensitive' } },
      ],
    },
    orderBy: { id: 'desc' },
    take: ADMIN_SEARCH_RESULTS_PER_TYPE,
    select: userSelect,
  });

  return users.map(mapUser);
};

// ─── Organisations ────────────────────────────────────────────────────────────

const organisationSelect = {
  id: true,
  name: true,
  owner: { select: { email: true } },
} as const;

type OrganisationRow = { id: string; name: string; owner: { email: string } };

const mapOrganisation = (organisation: OrganisationRow): AdminGlobalSearchResult => ({
  label: organisation.name,
  sublabel: joinSublabel([organisation.id, organisation.owner.email]),
  path: `/admin/organisations/${organisation.id}`,
  value: `organisation ${organisation.id} ${organisation.name} ${organisation.owner.email}`,
});

const findOrganisationsByIdOrUrl = async (query: string) => {
  const organisations = await prisma.organisation.findMany({
    where: {
      OR: [{ id: query }, { url: query }],
    },
    take: ADMIN_SEARCH_RESULTS_PER_TYPE,
    select: organisationSelect,
  });

  return organisations.map(mapOrganisation);
};

const findOrganisationsByText = async (query: string) => {
  const organisations = await prisma.organisation.findMany({
    where: {
      OR: [
        { name: { contains: query, mode: 'insensitive' } },
        { url: { contains: query, mode: 'insensitive' } },
        { customerId: { contains: query, mode: 'insensitive' } },
        { owner: { email: { contains: query, mode: 'insensitive' } } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: ADMIN_SEARCH_RESULTS_PER_TYPE,
    select: organisationSelect,
  });

  return organisations.map(mapOrganisation);
};

// ─── Teams ────────────────────────────────────────────────────────────────────

const teamSelect = {
  id: true,
  name: true,
  url: true,
  organisation: { select: { name: true } },
} as const;

type TeamRow = { id: number; name: string; url: string; organisation: { name: string } };

const mapTeam = (team: TeamRow): AdminGlobalSearchResult => ({
  label: team.name,
  sublabel: joinSublabel([`#${team.id}`, `/${team.url}`, team.organisation.name]),
  path: `/admin/teams/${team.id}`,
  value: `team ${team.id} ${team.name} ${team.url} ${team.organisation.name}`,
});

const findTeamsById = async (id: number) => {
  const team = await prisma.team.findFirst({
    where: { id },
    select: teamSelect,
  });

  return team ? [mapTeam(team)] : [];
};

const findTeamsByText = async (query: string) => {
  const teams = await prisma.team.findMany({
    where: {
      OR: [
        { name: { contains: query, mode: 'insensitive' } },
        { url: { contains: query, mode: 'insensitive' } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: ADMIN_SEARCH_RESULTS_PER_TYPE,
    select: teamSelect,
  });

  return teams.map(mapTeam);
};

// ─── Recipients ───────────────────────────────────────────────────────────────

const recipientSelect = {
  id: true,
  name: true,
  email: true,
  envelope: { select: { id: true, title: true } },
} as const;

type RecipientRow = {
  id: number;
  name: string;
  email: string;
  envelope: { id: string; title: string };
};

const mapRecipient = (recipient: RecipientRow): AdminGlobalSearchResult => ({
  label: recipient.email,
  sublabel: joinSublabel([recipient.name, `on "${recipient.envelope.title}"`]),
  path: `/admin/documents/${recipient.envelope.id}`,
  value: `recipient ${recipient.id} ${recipient.name} ${recipient.email} ${recipient.envelope.title}`,
});

const findRecipientsById = async (id: number) => {
  const recipient = await prisma.recipient.findFirst({
    where: {
      id,
      envelope: { type: EnvelopeType.DOCUMENT },
    },
    select: recipientSelect,
  });

  return recipient ? [mapRecipient(recipient)] : [];
};

const findRecipientsByText = async (query: string) => {
  const recipients = await prisma.recipient.findMany({
    where: {
      envelope: { type: EnvelopeType.DOCUMENT },
      OR: [
        { email: { contains: query, mode: 'insensitive' } },
        { name: { contains: query, mode: 'insensitive' } },
      ],
    },
    orderBy: { id: 'desc' },
    take: ADMIN_SEARCH_RESULTS_PER_TYPE,
    select: recipientSelect,
  });

  return recipients.map(mapRecipient);
};

// ─── Subscriptions ────────────────────────────────────────────────────────────

const subscriptionSelect = {
  id: true,
  status: true,
  planId: true,
  customerId: true,
  organisationId: true,
} as const;

type SubscriptionRow = {
  id: number;
  status: string;
  planId: string;
  customerId: string;
  organisationId: string;
};

const mapSubscription = (subscription: SubscriptionRow): AdminGlobalSearchResult => ({
  label: `Subscription #${subscription.id}`,
  sublabel: joinSublabel([subscription.status, subscription.planId]),
  path: `/admin/organisations/${subscription.organisationId}`,
  value: `subscription ${subscription.id} ${subscription.planId} ${subscription.customerId}`,
});

const findSubscriptionsById = async (id: number) => {
  const subscription = await prisma.subscription.findFirst({
    where: { id },
    select: subscriptionSelect,
  });

  return subscription ? [mapSubscription(subscription)] : [];
};

const findSubscriptionsByText = async (query: string) => {
  const subscriptions = await prisma.subscription.findMany({
    where: {
      OR: [
        { planId: { contains: query, mode: 'insensitive' } },
        { customerId: { contains: query, mode: 'insensitive' } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: ADMIN_SEARCH_RESULTS_PER_TYPE,
    select: subscriptionSelect,
  });

  return subscriptions.map(mapSubscription);
};

// ─── Subscription claims ──────────────────────────────────────────────────────

const claimSelect = {
  id: true,
  name: true,
} as const;

type ClaimRow = { id: string; name: string };

const mapClaim = (claim: ClaimRow): AdminGlobalSearchResult => ({
  label: claim.name,
  sublabel: claim.id,
  path: `/admin/claims?query=${encodeURIComponent(claim.id)}`,
  value: `claim ${claim.id} ${claim.name}`,
});

const findClaimsByText = async (query: string) => {
  const claims = await prisma.subscriptionClaim.findMany({
    where: {
      OR: [
        { id: { contains: query, mode: 'insensitive' } },
        { name: { contains: query, mode: 'insensitive' } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: ADMIN_SEARCH_RESULTS_PER_TYPE,
    select: claimSelect,
  });

  return claims.map(mapClaim);
};

// ─── Email domains ────────────────────────────────────────────────────────────

const emailDomainSelect = {
  id: true,
  domain: true,
  status: true,
} as const;

type EmailDomainRow = { id: string; domain: string; status: string };

const mapEmailDomain = (emailDomain: EmailDomainRow): AdminGlobalSearchResult => ({
  label: emailDomain.domain,
  sublabel: emailDomain.status,
  path: `/admin/email-domains/${emailDomain.id}`,
  value: `emailDomain ${emailDomain.id} ${emailDomain.domain}`,
});

const findEmailDomainsById = async (id: string) => {
  const emailDomain = await prisma.emailDomain.findFirst({
    where: { id },
    select: emailDomainSelect,
  });

  return emailDomain ? [mapEmailDomain(emailDomain)] : [];
};

const findEmailDomainsByText = async (query: string) => {
  const emailDomains = await prisma.emailDomain.findMany({
    where: {
      domain: { contains: query, mode: 'insensitive' },
    },
    orderBy: { createdAt: 'desc' },
    take: ADMIN_SEARCH_RESULTS_PER_TYPE,
    select: emailDomainSelect,
  });

  return emailDomains.map(mapEmailDomain);
};

// ─── Email transports ─────────────────────────────────────────────────────────

const emailTransportSelect = {
  id: true,
  name: true,
  fromAddress: true,
} as const;

type EmailTransportRow = { id: string; name: string; fromAddress: string };

const mapEmailTransport = (emailTransport: EmailTransportRow): AdminGlobalSearchResult => ({
  label: emailTransport.name,
  sublabel: emailTransport.fromAddress,
  path: `/admin/email-transports?query=${encodeURIComponent(emailTransport.name)}`,
  value: `emailTransport ${emailTransport.id} ${emailTransport.name} ${emailTransport.fromAddress}`,
});

const findEmailTransportsById = async (id: string) => {
  const emailTransport = await prisma.emailTransport.findFirst({
    where: { id },
    select: emailTransportSelect,
  });

  return emailTransport ? [mapEmailTransport(emailTransport)] : [];
};

const findEmailTransportsByText = async (query: string) => {
  const emailTransports = await prisma.emailTransport.findMany({
    where: {
      OR: [
        { name: { contains: query, mode: 'insensitive' } },
        { fromAddress: { contains: query, mode: 'insensitive' } },
      ],
    },
    orderBy: { createdAt: 'desc' },
    take: ADMIN_SEARCH_RESULTS_PER_TYPE,
    select: emailTransportSelect,
  });

  return emailTransports.map(mapEmailTransport);
};
```

- [ ] **Step 2: Commit**

```bash
git add packages/lib/server-only/admin/admin-global-search.ts
git commit -m "feat: add admin global search lib function"
```

---

### Task 4: TRPC route + registration, make API spec pass

**Files:**
- Create: `packages/trpc/server/admin-router/admin-search.ts`
- Modify: `packages/trpc/server/admin-router/router.ts`
- Test: `packages/app-tests/e2e/api/trpc/admin/admin-search.spec.ts` (from Task 1)

- [ ] **Step 1: Write the route**

Create `packages/trpc/server/admin-router/admin-search.ts`:

```ts
import { adminGlobalSearch } from '@documenso/lib/server-only/admin/admin-global-search';

import { adminProcedure } from '../trpc';
import { ZAdminSearchRequestSchema, ZAdminSearchResponseSchema } from './admin-search.types';

export const adminSearchRoute = adminProcedure
  .input(ZAdminSearchRequestSchema)
  .output(ZAdminSearchResponseSchema)
  .query(async ({ input }) => {
    const { query } = input;

    const groups = await adminGlobalSearch({ query });

    return { groups };
  });
```

- [ ] **Step 2: Register the route**

Modify `packages/trpc/server/admin-router/router.ts`. Add the import (imports are alphabetically ordered; `admin-search` sorts first):

```ts
import { router } from '../trpc';
import { adminSearchRoute } from './admin-search';
import { createAdminOrganisationRoute } from './create-admin-organisation';
```

Then register it in the router object, between `teamMember` and `updateSiteSetting`:

```ts
  teamMember: {
    delete: deleteAdminTeamMemberRoute,
  },
  search: adminSearchRoute,
  updateSiteSetting: updateSiteSettingRoute,
});
```

- [ ] **Step 3: Type check**

Run: `npm run typecheck -w @documenso/remix`
Expected: PASS (no errors). This type-checks the app plus the imported trpc/lib source.

- [ ] **Step 4: Run the API spec to verify it passes**

Ensure the dev server is running, then:

Run: `npm run test:dev -w @documenso/app-tests -- e2e/api/trpc/admin/admin-search.spec.ts`
Expected: all 9 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/trpc/server/admin-router/admin-search.ts packages/trpc/server/admin-router/router.ts packages/app-tests/e2e/api/trpc/admin/admin-search.spec.ts
git commit -m "feat: add admin.search trpc route"
```

---

### Task 5: Failing UI E2E spec

**Files:**
- Create: `packages/app-tests/e2e/admin/global-search.spec.ts`

- [ ] **Step 1: Write the failing UI test**

Create `packages/app-tests/e2e/admin/global-search.spec.ts`:

```ts
import { seedPendingDocument } from '@documenso/prisma/seed/documents';
import { seedUser } from '@documenso/prisma/seed/users';
import { expect, test } from '@playwright/test';

import { apiSignin } from '../fixtures/authentication';

test.describe.configure({ mode: 'parallel' });

const openCommandMenu = async (page: import('@playwright/test').Page) => {
  await page.keyboard.press('Meta+K');
  await expect(page.getByPlaceholder('Type a command or search...').first()).toBeVisible();
};

test('[ADMIN][GLOBAL_SEARCH]: numeric query shows verified user result and navigates', async ({
  page,
}) => {
  const { user: adminUser } = await seedUser({ isAdmin: true });
  const { user: targetUser } = await seedUser();

  await apiSignin({ page, email: adminUser.email });

  await openCommandMenu(page);

  await page.getByPlaceholder('Type a command or search...').first().fill(String(targetUser.id));

  await expect(page.getByText('Admin: Users')).toBeVisible();

  await page.getByRole('option').filter({ hasText: targetUser.email }).first().click();

  await page.waitForURL(`/admin/users/${targetUser.id}`);
});

test('[ADMIN][GLOBAL_SEARCH]: numeric query shows verified team result and navigates', async ({
  page,
}) => {
  const { user: adminUser } = await seedUser({ isAdmin: true });
  const { team: targetTeam } = await seedUser();

  await apiSignin({ page, email: adminUser.email });

  await openCommandMenu(page);

  await page.getByPlaceholder('Type a command or search...').first().fill(String(targetTeam.id));

  await expect(page.getByText('Admin: Teams')).toBeVisible();

  await page.getByRole('option').filter({ hasText: targetTeam.name }).first().click();

  await page.waitForURL(`/admin/teams/${targetTeam.id}`);
});

test('[ADMIN][GLOBAL_SEARCH]: text query shows document result and navigates', async ({ page }) => {
  const { user: adminUser } = await seedUser({ isAdmin: true });
  const { user: sender, team } = await seedUser();

  const document = await seedPendingDocument(sender, team.id, []);

  await apiSignin({ page, email: adminUser.email });

  await openCommandMenu(page);

  await page.getByPlaceholder('Type a command or search...').first().fill(document.title);

  await expect(page.getByText('Admin: Documents')).toBeVisible();

  await page
    .getByRole('option')
    .filter({ hasText: document.secondaryId })
    .first()
    .click();

  await page.waitForURL(`/admin/documents/${document.id}`);
});

test('[ADMIN][GLOBAL_SEARCH]: envelope_ prefixed query resolves exact document', async ({ page }) => {
  const { user: adminUser } = await seedUser({ isAdmin: true });
  const { user: sender, team } = await seedUser();

  const document = await seedPendingDocument(sender, team.id, []);

  await apiSignin({ page, email: adminUser.email });

  await openCommandMenu(page);

  await page.getByPlaceholder('Type a command or search...').first().fill(document.id);

  await expect(page.getByText('Admin: Documents')).toBeVisible();
  await expect(page.getByRole('option').filter({ hasText: document.title }).first()).toBeVisible();
});

test('[ADMIN][GLOBAL_SEARCH]: non-admin sees no admin groups and no admin.search request fires', async ({
  page,
}) => {
  const { user, team } = await seedUser({ isAdmin: false });

  const document = await seedPendingDocument(user, team.id, []);

  const adminSearchRequests: string[] = [];

  page.on('request', (request) => {
    if (request.url().includes('/api/trpc/admin.search')) {
      adminSearchRequests.push(request.url());
    }
  });

  await apiSignin({ page, email: user.email });

  await openCommandMenu(page);

  await page.getByPlaceholder('Type a command or search...').first().fill(document.title);

  // Wait for the regular (non-admin) search to resolve so we know the
  // debounced queries have fired.
  await expect(page.getByRole('option', { name: document.title })).toBeVisible();

  await expect(page.getByText(/^Admin: /)).toHaveCount(0);
  expect(adminSearchRequests).toHaveLength(0);
});
```

- [ ] **Step 2: Run the spec to verify it fails**

Run: `npm run test:dev -w @documenso/app-tests -- e2e/admin/global-search.spec.ts`

Expected: the first four tests FAIL (timeout waiting for "Admin: …" headings — the frontend doesn't render admin groups yet). The non-admin test PASSES (nothing renders for non-admins either way). Do NOT commit yet.

---

### Task 6: Frontend — admin groups in AppCommandMenu

**Files:**
- Modify: `apps/remix/app/components/general/app-command-menu.tsx`
- Test: `packages/app-tests/e2e/admin/global-search.spec.ts` (from Task 5)

All edits below are in `apps/remix/app/components/general/app-command-menu.tsx`.

- [ ] **Step 1: Add imports**

Add to the existing `@documenso/lib` imports (after the `isPersonalLayout` import):

```ts
import { isAdmin } from '@documenso/lib/utils/is-admin';
```

Add a type import for the result types (alongside the existing `@documenso/trpc/react` import):

```ts
import type {
  TAdminSearchResult,
  TAdminSearchResultType,
} from '@documenso/trpc/server/admin-router/admin-search.types';
```

- [ ] **Step 2: Add the admin group headings map**

Add below the existing `SETTINGS_PAGES` constant (module scope):

```ts
const ADMIN_SEARCH_GROUP_HEADINGS: Record<TAdminSearchResultType, MessageDescriptor> = {
  document: msg`Admin: Documents`,
  user: msg`Admin: Users`,
  organisation: msg`Admin: Organisations`,
  team: msg`Admin: Teams`,
  recipient: msg`Admin: Recipients`,
  subscription: msg`Admin: Subscriptions`,
  claim: msg`Admin: Claims`,
  emailDomain: msg`Admin: Email Domains`,
  emailTransport: msg`Admin: Email Transports`,
};
```

- [ ] **Step 3: Read the user from the session and derive admin state**

Change:

```ts
const { organisations } = useSession();
```

to:

```ts
const { organisations, user } = useSession();
```

Then add directly below (before the `navigate` line):

```ts
const isUserAdmin = isAdmin(user);
```

- [ ] **Step 4: Add the admin search query**

Add after the existing `trpcReact.template.search.useQuery(...)` block:

```ts
const { data: adminSearchData, isFetching: isFetchingAdminSearch } = trpcReact.admin.search.useQuery(
  {
    query: debouncedSearch,
  },
  {
    enabled: open === true && hasValidSearch && isUserAdmin,
    placeholderData: keepPreviousData,
    ...SKIP_QUERY_BATCH_META,
    ...DO_NOT_INVALIDATE_QUERY_ON_MUTATION,
  },
);
```

- [ ] **Step 5: Derive the admin groups**

Add after the existing `templateSearchResults` assignment:

```ts
const adminSearchGroups = hasValidSearch && isUserAdmin && adminSearchData ? adminSearchData.groups : [];
```

- [ ] **Step 6: Render the admin groups**

Inside the `{!currentPage && (...)}` fragment, add after the closing of the "Your templates" `CommandGroup` conditional (after the `{(isFetchingTemplates || templateSearchResults.length > 0) && (...)}` block):

```tsx
{isUserAdmin && isFetchingAdminSearch && adminSearchGroups.length === 0 && (
  <CommandGroup className="mx-2 p-0 pb-2" heading={_(msg`Admin`)}>
    <div className="flex items-center justify-center py-2">
      <Loader className="h-4 w-4 animate-spin" />
    </div>
  </CommandGroup>
)}

{isUserAdmin &&
  adminSearchGroups.map((group) => (
    <CommandGroup
      key={group.type}
      className="mx-2 p-0 pb-2"
      heading={_(ADMIN_SEARCH_GROUP_HEADINGS[group.type])}
    >
      <AdminSearchCommands push={push} results={group.results} />
    </CommandGroup>
  ))}
```

- [ ] **Step 7: Add the AdminSearchCommands subcomponent**

Add after the existing `Commands` component (module scope):

```tsx
const AdminSearchCommands = ({
  push,
  results,
}: {
  push: (_path: string) => void;
  results: TAdminSearchResult[];
}) => {
  return results.map((result) => (
    <CommandItem
      className="-mx-2 -my-1 rounded-lg"
      key={result.value}
      value={result.value}
      onSelect={() => push(result.path)}
    >
      <div className="flex min-w-0 flex-col">
        <span className="truncate">{result.label}</span>
        {result.sublabel && (
          <span className="text-muted-foreground truncate text-xs">{result.sublabel}</span>
        )}
      </div>
    </CommandItem>
  ));
};
```

- [ ] **Step 8: Type check**

Run: `npm run typecheck -w @documenso/remix`
Expected: PASS.

- [ ] **Step 9: Extract translations**

Run: `npm run translate`
Expected: completes without error; the new `Admin: …` message strings are added to the locale catalogs. Stage the updated `.po` files with the commit.

- [ ] **Step 10: Run the UI spec to verify it passes**

Ensure the dev server is running, then:

Run: `npm run test:dev -w @documenso/app-tests -- e2e/admin/global-search.spec.ts`
Expected: all 5 tests PASS.

- [ ] **Step 11: Re-run the existing command menu spec to check for regressions**

Run: `npm run test:dev -w @documenso/app-tests -- e2e/command-menu/document-search.spec.ts`
Expected: all 3 tests PASS.

- [ ] **Step 12: Lint and commit**

```bash
npm run lint:fix
git add apps/remix/app/components/general/app-command-menu.tsx packages/app-tests/e2e/admin/global-search.spec.ts packages/lib/translations
git commit -m "feat: show admin global search results in command menu"
```

If `npm run lint:fix` rewrites other files you did not touch, only stage the files listed above plus any locale catalog files updated by `npm run translate` (they may live under `packages/lib/translations/`; check `git status`).

---

## Final verification

- [ ] Run the full new test surface one more time:

```bash
npm run test:dev -w @documenso/app-tests -- e2e/api/trpc/admin/admin-search.spec.ts e2e/admin/global-search.spec.ts e2e/command-menu/document-search.spec.ts
```

Expected: 17 tests PASS (9 API + 5 UI + 3 existing).

- [ ] Manual smoke test: sign in as an admin (dev seed admin or a seeded user with `isAdmin: true`), press ⌘K, type a user ID, a document title, and an `org_…` ID; confirm grouped results appear and navigation works. Sign in as a non-admin and confirm the menu behaves exactly as before.
