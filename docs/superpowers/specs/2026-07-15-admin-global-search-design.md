# Admin Global Search — Design

**Date:** 2026-07-15
**Branch:** `feat/add-admin-global-search`
**Status:** Approved

## Overview

Add a Stripe-style global search for admin resources. Rather than a separate admin palette, the existing `AppCommandMenu` (⌘K / Ctrl+K command menu in the app header) gains additional result groups that appear only for users with `Role.ADMIN`, on any page. Typing a query surfaces verified, rich-labelled matches across all admin resource types; selecting a result navigates to the existing admin page for that resource.

## Decisions

1. **Placement:** Extend the existing `AppCommandMenu`; admin users see extra groups everywhere. No changes for non-admins, no separate admin search UI.
2. **Numeric queries return verified lookups** (option B): the backend checks which resources with that ID exist and returns rich labels (e.g. `User 123 — jane@example.com`). Only existing resources are shown; no optimistic "jump to" links.
3. **Results grouped by resource type** (option A): separate `CommandGroup`s per type ("Admin: Users", "Admin: Documents", …), capped at 5 results each, rendered below the user's personal document/template results. No static admin quick-nav items; groups appear only when a query is entered.
4. **Architecture:** one unified `admin.search` TRPC route that fans out to all resource lookups server-side in parallel (approach 1). One HTTP request, one admin auth check, small response payload.

## Scope: resources, matching, and link targets

| Resource | Matched by | Result links to |
|---|---|---|
| Documents (envelopes) | `envelope_x`, `document_x`, bare number (legacy ID), title text | `/admin/documents/{envelopeId}` |
| Users | numeric ID, name, email | `/admin/users/{id}` |
| Organisations | `org_x` (ID/URL exact), name, URL, Stripe customer ID, owner email | `/admin/organisations/{id}` |
| Teams | numeric ID, name, team URL | `/admin/teams/{id}` |
| Recipients | numeric ID, email, name | parent document: `/admin/documents/{envelopeId}` |
| Subscriptions | numeric ID, Stripe plan ID, Stripe customer ID | parent org: `/admin/organisations/{orgId}` |
| Subscription claims | claim ID (cuid), name | `/admin/claims?query={id}` (list page) |
| Email domains | `email_domain_x`, domain name | `/admin/email-domains/{id}` |
| Email transports | `email_transport_x`, name, from address | `/admin/email-transports?query={name}` (list page) |

**Excluded:** templates and envelope items (no admin pages exist); the `claim:` / `user:` / `team:` filter prefixes (remain available on individual admin list pages); `template_x` secondary IDs.

## Backend

### New files

- `packages/trpc/server/admin-router/admin-search.ts` — exports `adminSearchRoute` (`adminProcedure` query). Registered top-level in `adminRouter` as `search:` (cross-resource, like `updateSiteSetting`). No OpenAPI meta (internal-only, matching other admin routes).
- `packages/trpc/server/admin-router/admin-search.types.ts` — `ZAdminSearchRequestSchema`, `ZAdminSearchResponseSchema` (+ inferred `TAdminSearchRequest` / `TAdminSearchResponse`).
- `packages/lib/server-only/admin/admin-global-search.ts` — `adminGlobalSearch({ query })`, the lookup logic (same layering as `admin-find-documents.ts`).

### Request schema

```ts
ZAdminSearchRequestSchema = z.object({
  query: z.string().trim().min(1).max(100),
});
```

No pagination; each group is capped at `ADMIN_SEARCH_RESULTS_PER_TYPE = 5`.

### Response schema

```ts
ZAdminSearchResultSchema = z.object({
  label: z.string(),      // "Acme Corp", "jane@example.com"
  sublabel: z.string().optional(), // "org_abc123 · owner@x.com"
  path: z.string(),       // admin URL to navigate to
  value: z.string(),      // unique cmdk filter value
});

ZAdminSearchResponseSchema = z.object({
  groups: z.array(
    z.object({
      type: z.enum([
        'document', 'user', 'organisation', 'team', 'recipient',
        'subscription', 'claim', 'emailDomain', 'emailTransport',
      ]),
      results: ZAdminSearchResultSchema.array(),
    }),
  ),
});
```

Only non-empty groups are returned, ordered by the enum order above. The server returns the `type` enum; the client owns translated headings.

**cmdk filter note:** cmdk filters items client-side by `value`. Each result's `value` concatenates type, resource ID, label, sublabel, **and the raw query** so server-verified results are never hidden by the client-side filter (extends the existing `document.search` pattern of `id + title + emails`).

### Query classification (in order)

1. **Recognized ID prefix** → single exact lookup, no other queries:
   - `envelope_x` → `Envelope.id` equals, `type = DOCUMENT` only
   - `document_x` → `Envelope.secondaryId` equals
   - `org_x` → `Organisation.id` equals OR `Organisation.url` equals (mirrors `find-admin-organisations.ts`)
   - `email_domain_x` → `EmailDomain.id` equals
   - `email_transport_x` → `EmailTransport.id` equals
2. **Bare number** (`/^\d+$/` and ≤ 2147483647, guarding Int4 overflow) → 5 parallel verified ID lookups, each yielding 0–1 result:
   - `User.id`
   - `Team.id`
   - `Envelope.secondaryId = "document_<n>"` (`type = DOCUMENT`)
   - `Recipient.id` (include parent envelope for path/label; parent must be `type = DOCUMENT`)
   - `Subscription.id` (include `organisationId` for path)
   - No text search runs for numeric queries.
3. **Free text** → 9 parallel `contains` / `mode: 'insensitive'` searches, `take: 5`, ordered by `createdAt desc` (models without `createdAt` use default ordering):
   - Envelope: `title` (`type = DOCUMENT`)
   - User: `name` OR `email`
   - Organisation: `name` OR `url` OR `customerId` OR `owner.email`
   - Team: `name` OR `url`
   - Recipient: `email` OR `name` (GIN trigram indexes exist), parent envelope `type = DOCUMENT`
   - SubscriptionClaim: `id` OR `name`
   - EmailDomain: `domain`
   - EmailTransport: `name` OR `fromAddress`
   - Subscription: `planId` OR `customerId`

Recognized-prefix queries are exact-only (no fuzzy fallback), matching existing admin search behavior for `org_`.

### Labels

| type | label | sublabel | path |
|---|---|---|---|
| document | title | `document_123 · owner email` | `/admin/documents/{envelopeId}` |
| user | name ?? email | `#id · email` | `/admin/users/{id}` |
| organisation | name | `org_x · owner email` | `/admin/organisations/{id}` |
| team | name | `#id · /url · org name` | `/admin/teams/{id}` |
| recipient | email | `name · on "doc title"` | `/admin/documents/{envelopeId}` |
| subscription | `Subscription #id` | `status · planId` | `/admin/organisations/{orgId}` |
| claim | name | claim id | `/admin/claims?query={id}` |
| emailDomain | domain | status | `/admin/email-domains/{id}` |
| emailTransport | name | fromAddress | `/admin/email-transports?query={name}` |

Sublabel separator is ` · `. Missing parts (e.g. user with no name) are omitted rather than rendered empty.

## Frontend

All changes in `apps/remix/app/components/general/app-command-menu.tsx`. No changes to `app-header.tsx` or the `command` primitives.

- **Admin detection:** `const { user } = useSession()` + `isAdmin(user)` from `@documenso/lib/utils/is-admin` (both already used client-side elsewhere).
- **New query,** mirroring the existing two:

  ```ts
  const { data: adminSearchData, isFetching: isFetchingAdminSearch } =
    trpcReact.admin.search.useQuery(
      { query: debouncedSearch },
      {
        enabled: open === true && hasValidSearch && isUserAdmin,
        placeholderData: keepPreviousData,
        ...SKIP_QUERY_BATCH_META,
        ...DO_NOT_INVALIDATE_QUERY_ON_MUTATION,
      },
    );
  ```

  Same 200ms debounce (`useDebouncedValue`). Disabled for non-admins: zero behavior change, zero extra requests.
- **Rendering:** on the root page only (`!currentPage`), below the "Your templates" group. Map `adminSearchData.groups` to `CommandGroup`s with headings from a static `type → MessageDescriptor` map (using the `msg` macro): document → "Admin: Documents", user → "Admin: Users", organisation → "Admin: Organisations", team → "Admin: Teams", recipient → "Admin: Recipients", subscription → "Admin: Subscriptions", claim → "Admin: Claims", emailDomain → "Admin: Email Domains", emailTransport → "Admin: Email Transports".
  While `isFetchingAdminSearch` and no data yet, render a single "Admin" group containing the same `Loader` spinner pattern used by the existing result groups.
- **Items:** new `AdminSearchCommands` subcomponent (sibling of `Commands`, same file) rendering `label` plus a muted, truncated `sublabel`, with `value={result.value}` and `onSelect={() => push(result.path)}` (existing `push` = navigate + close). The existing `Commands` component is untouched.
- **Empty query:** no admin items rendered.

## Error handling

- Authorization handled entirely by `adminProcedure` (session + not-disabled + `Role.ADMIN`).
- Strict numeric detection (`/^\d+$/` + Int4 bound) — inputs like `123abc` or oversized numbers fall through to text search instead of throwing (avoids `parseInt` quirks).
- Server lookups run in `Promise.all`; a failure fails the whole request cleanly (no partial groups).
- On client query error, admin groups simply don't render (parity with existing `document.search` handling); no toasts while typing.

## Testing

- **E2E (primary):** `packages/app-tests/e2e/admin/global-search.spec.ts`, following existing admin spec patterns. Seed an admin plus org/team/user/document/recipient, open the menu with `Ctrl+K`, then assert:
  1. Numeric query shows verified rows (user/team/document/recipient) and selecting one navigates to the correct admin page.
  2. Text query shows grouped matches across types.
  3. Non-admin user sees no admin groups (and no `admin.search` request fires).
  4. Prefixed IDs (`org_x`, `envelope_x`) resolve to exact matches.
- **TRPC API E2E:** spec under `packages/app-tests/e2e/api/trpc/admin/` (pattern: `delete-organisation.spec.ts`) covering classification directly: prefix → exact match; number → verified-only results; free text → grouped results; non-admin → unauthorized.
- **Type checking:** `npx tsc --noEmit` in affected packages. No `npm run build` for verification.

## Out of scope

- Admin-specific static quick-nav items in the command menu (option C, rejected).
- Search across templates, envelope items, audit logs, site settings.
- Relevance ranking beyond fixed group order; pagination of results.
- Changes to the per-page admin list searches or their query-param conventions.
