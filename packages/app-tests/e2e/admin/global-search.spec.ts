import { seedPendingDocument } from '@documenso/prisma/seed/documents';
import { seedUser } from '@documenso/prisma/seed/users';
import { expect, test } from '@playwright/test';
import { customAlphabet } from 'nanoid';

import { apiSignin } from '../fixtures/authentication';

test.describe.configure({ mode: 'parallel' });

const nanoid = customAlphabet('1234567890abcdef', 10);

const ADMIN_PROMPT_PLACEHOLDER = 'Search documents, users, organisations…';

const openAdminCommandPrompt = async (page: import('@playwright/test').Page) => {
  // Retry the shortcut until the prompt appears since the keypress is a no-op
  // when it happens before the page has hydrated.
  await expect(async () => {
    await page.keyboard.press('Meta+K');
    await expect(page.getByPlaceholder(ADMIN_PROMPT_PLACEHOLDER).first()).toBeVisible({ timeout: 1_000 });
  }).toPass({ timeout: 15_000 });
};

test('[ADMIN][GLOBAL_SEARCH]: numeric query shows verified user result and navigates', async ({ page }) => {
  const { user: adminUser } = await seedUser({ isAdmin: true });
  const { user: targetUser } = await seedUser();

  await apiSignin({ page, email: adminUser.email });

  await openAdminCommandPrompt(page);

  await page.getByPlaceholder(ADMIN_PROMPT_PLACEHOLDER).first().fill(String(targetUser.id));

  await expect(page.getByText('Global Users', { exact: true })).toBeVisible();

  // The category chips include the admin groups with their result counts.
  await expect(page.getByRole('button', { name: /Global Users/ })).toBeVisible();

  const userOption = page.getByRole('option').filter({ hasText: targetUser.email }).first();

  // Admin results are real links so they support native link behaviour such
  // as opening in a new tab.
  await expect(userOption.getByRole('link')).toHaveAttribute('href', `/admin/users/${targetUser.id}`);

  await userOption.click();

  await page.waitForURL(`/admin/users/${targetUser.id}`);
});

test('[ADMIN][GLOBAL_SEARCH]: numeric query shows verified team result and navigates', async ({ page }) => {
  const { user: adminUser } = await seedUser({ isAdmin: true });
  const { team: targetTeam } = await seedUser();

  await apiSignin({ page, email: adminUser.email });

  await openAdminCommandPrompt(page);

  await page.getByPlaceholder(ADMIN_PROMPT_PLACEHOLDER).first().fill(String(targetTeam.id));

  await expect(page.getByText('Global Teams', { exact: true })).toBeVisible();

  await page.getByRole('option').filter({ hasText: targetTeam.url }).first().click();

  await page.waitForURL(`/admin/teams/${targetTeam.id}`);
});

test('[ADMIN][GLOBAL_SEARCH]: text query shows document result and navigates', async ({ page }) => {
  const { user: adminUser } = await seedUser({ isAdmin: true });
  const { user: sender, team } = await seedUser();

  const document = await seedPendingDocument(sender, team.id, [], {
    createDocumentOptions: { title: `admin-ui-search-${nanoid()}` },
  });

  await apiSignin({ page, email: adminUser.email });

  await openAdminCommandPrompt(page);

  await page.getByPlaceholder(ADMIN_PROMPT_PLACEHOLDER).first().fill(document.title);

  await expect(page.getByText('Global Documents', { exact: true })).toBeVisible();

  await page.getByRole('option').filter({ hasText: document.secondaryId }).first().click();

  await page.waitForURL(`/admin/documents/${document.id}`);
});

test('[ADMIN][GLOBAL_SEARCH]: envelope_ prefixed query resolves exact document', async ({ page }) => {
  const { user: adminUser } = await seedUser({ isAdmin: true });
  const { user: sender, team } = await seedUser();

  const document = await seedPendingDocument(sender, team.id, [], {
    createDocumentOptions: { title: `admin-ui-search-${nanoid()}` },
  });

  await apiSignin({ page, email: adminUser.email });

  await openAdminCommandPrompt(page);

  await page.getByPlaceholder(ADMIN_PROMPT_PLACEHOLDER).first().fill(document.id);

  await expect(page.getByText('Global Documents', { exact: true })).toBeVisible();
  await expect(page.getByRole('option').filter({ hasText: document.title }).first()).toBeVisible();
});

test('[ADMIN][GLOBAL_SEARCH]: admin search requires more than 3 characters unless numeric', async ({ page }) => {
  const { user: adminUser } = await seedUser({ isAdmin: true });

  const adminSearchRequests: string[] = [];

  page.on('request', (request) => {
    if (request.url().includes('admin.search')) {
      adminSearchRequests.push(request.url());
    }
  });

  await apiSignin({ page, email: adminUser.email });

  await openAdminCommandPrompt(page);

  const input = page.getByPlaceholder(ADMIN_PROMPT_PLACEHOLDER).first();

  // A 3 character non-numeric query must not trigger the admin search. The
  // personal document search fires for any non-empty query, so its response
  // is the synchronization anchor proving the debounced queries have fired.
  const documentSearchResponse = page.waitForResponse((response) => response.url().includes('document.search'));

  await input.fill('abc');

  await documentSearchResponse;

  await expect(page.getByText(/^Global /)).toHaveCount(0);
  expect(adminSearchRequests).toHaveLength(0);

  // A numeric query fires regardless of length.
  const adminSearchRequest = page.waitForRequest((request) => request.url().includes('admin.search'));

  await input.fill('7');

  await adminSearchRequest;
});

test('[ADMIN][GLOBAL_SEARCH]: search bar position stays fixed while searching', async ({ page }) => {
  const { user: adminUser } = await seedUser({ isAdmin: true });
  const { user: targetUser } = await seedUser();

  await apiSignin({ page, email: adminUser.email });

  await openAdminCommandPrompt(page);

  const input = page.getByPlaceholder(ADMIN_PROMPT_PLACEHOLDER).first();

  const initialY = (await input.boundingBox())?.y;

  expect(initialY).toBeGreaterThan(0);

  // The height of the prompt may change as results come and go, but the
  // search bar must never move.
  await input.fill(String(targetUser.id));

  await expect(page.getByText('Global Users', { exact: true })).toBeVisible();

  const resultsY = (await input.boundingBox())?.y;

  expect(resultsY).toBe(initialY);

  // The search bar must not move when there are no results at all.
  await input.fill('zzzz-no-such-thing-9x7q');

  await expect(page.getByText('No results for')).toBeVisible();

  const emptyY = (await input.boundingBox())?.y;

  expect(emptyY).toBe(initialY);
});

test('[ADMIN][GLOBAL_SEARCH]: default view shows the document page links outside a team context', async ({ page }) => {
  const { user: adminUser } = await seedUser({ isAdmin: true });

  await apiSignin({ page, email: adminUser.email });

  // Admin pages have no current team, the page links must still show.
  await page.goto('/admin/stats');

  await openAdminCommandPrompt(page);

  await expect(page.getByRole('option').filter({ hasText: 'All documents' })).toBeVisible();
  await expect(page.getByRole('option').filter({ hasText: 'Draft documents' })).toBeVisible();
  await expect(page.getByRole('option').filter({ hasText: 'All templates' })).toBeVisible();

  // Chips only show for categories with actual results, not for the
  // hardcoded page links.
  await expect(page.getByRole('button', { name: /^Documents/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Templates/ })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Settings/ })).toBeVisible();
});

test('[ADMIN][GLOBAL_SEARCH]: theme can be changed from the prompt', async ({ page }) => {
  const { user: adminUser } = await seedUser({ isAdmin: true });

  await apiSignin({ page, email: adminUser.email });

  await openAdminCommandPrompt(page);

  await page.getByRole('option').filter({ hasText: 'Change theme' }).first().click();

  // The sub page has a contextual placeholder and a back option.
  await expect(page.getByPlaceholder('Search themes…')).toBeVisible();
  await expect(page.getByRole('option').filter({ hasText: 'Back' }).first()).toBeVisible();

  await expect(page.getByRole('option').filter({ hasText: 'Dark Mode' })).toBeVisible();

  await page.getByRole('option').filter({ hasText: 'Dark Mode' }).first().click();

  await expect(page.locator('html')).toHaveClass(/dark/);

  // The back option returns to the root view.
  await page.getByRole('option').filter({ hasText: 'Back' }).first().click();

  await expect(page.getByPlaceholder(ADMIN_PROMPT_PLACEHOLDER).first()).toBeVisible();
});

test('[ADMIN][GLOBAL_SEARCH]: capped admin groups offer a view all link', async ({ page }) => {
  const { user: adminUser } = await seedUser({ isAdmin: true });

  const namePrefix = `viewall-${nanoid()}`;

  // Seed enough users sharing a name prefix to hit the 5 result cap.
  for (let i = 0; i < 5; i++) {
    await seedUser({ name: `${namePrefix}-${i}` });
  }

  await apiSignin({ page, email: adminUser.email });

  await openAdminCommandPrompt(page);

  await page.getByPlaceholder(ADMIN_PROMPT_PLACEHOLDER).first().fill(namePrefix);

  await expect(page.getByText('Global Users', { exact: true })).toBeVisible();

  const viewAllOption = page.getByRole('option').filter({ hasText: 'View all results' }).first();

  await expect(viewAllOption.getByRole('link')).toHaveAttribute(
    'href',
    `/admin/users?search=${encodeURIComponent(namePrefix)}`,
  );
});

test('[ADMIN][GLOBAL_SEARCH]: first result is highlighted after every search', async ({ page }) => {
  const { user: adminUser } = await seedUser({ isAdmin: true });
  const { user: firstUser } = await seedUser();
  const { user: secondUser } = await seedUser();

  await apiSignin({ page, email: adminUser.email });

  await openAdminCommandPrompt(page);

  const input = page.getByPlaceholder(ADMIN_PROMPT_PLACEHOLDER).first();

  // First search selects the first result.
  await input.fill(String(firstUser.id));

  await expect(page.getByRole('option').filter({ hasText: firstUser.email }).first()).toBeVisible();
  await expect(page.locator('[cmdk-item]').first()).toHaveAttribute('aria-selected', 'true');

  // A subsequent search with entirely new results must select the first
  // result again.
  await input.fill(String(secondUser.id));

  await expect(page.getByRole('option').filter({ hasText: secondUser.email }).first()).toBeVisible();
  await expect(page.locator('[cmdk-item]').first()).toHaveAttribute('aria-selected', 'true');
});

test('[ADMIN][GLOBAL_SEARCH]: page scrollbar is hidden while the prompt is open', async ({ page }) => {
  const { user: adminUser } = await seedUser({ isAdmin: true });

  await apiSignin({ page, email: adminUser.email });

  await openAdminCommandPrompt(page);

  await expect
    .poll(async () => await page.evaluate(() => getComputedStyle(document.documentElement).overflow))
    .toBe('hidden');

  await page.keyboard.press('Escape');

  await expect
    .poll(async () => await page.evaluate(() => getComputedStyle(document.documentElement).overflow))
    .toBe('visible');
});

test('[ADMIN][GLOBAL_SEARCH]: non-admin gets the regular command menu without admin search', async ({ page }) => {
  const { user, team } = await seedUser({ isAdmin: false });

  const document = await seedPendingDocument(user, team.id, []);

  const adminSearchRequests: string[] = [];

  page.on('request', (request) => {
    if (request.url().includes('admin.search')) {
      adminSearchRequests.push(request.url());
    }
  });

  await apiSignin({ page, email: user.email });

  // Non-admins get the regular command menu, not the admin prompt.
  await page.keyboard.press('Meta+K');

  await expect(page.getByPlaceholder('Type a command or search...').first()).toBeVisible();
  await expect(page.getByPlaceholder(ADMIN_PROMPT_PLACEHOLDER)).toHaveCount(0);

  await page.getByPlaceholder('Type a command or search...').first().fill(document.title);

  // Wait for the regular (non-admin) search to resolve so we know the
  // debounced queries have fired.
  await expect(page.getByRole('option', { name: document.title })).toBeVisible();

  await expect(page.getByText(/^Global /)).toHaveCount(0);
  expect(adminSearchRequests).toHaveLength(0);
});
