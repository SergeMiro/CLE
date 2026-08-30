import { expect, test } from '@playwright/test';

const LEARNER = 111_000_101;
const NEW_LEARNER = 111_000_104;
const CREATOR = 111_000_001;
const ADMIN = 111_000_900;

test.describe('member Mini App', () => {
  test('shows the balance, points and communities of a seeded learner', async ({ page }) => {
    await page.goto(`/?mockUser=${LEARNER}`);
    await expect(page.getByText('Available to withdraw')).toBeVisible();
    await expect(page.getByText('Learning points')).toBeVisible();
    await expect(page.getByText('Science Daily CLE').first()).toBeVisible();
    // The seeded learner really was paid out of the community share.
    await expect(page.locator('.hero .amount')).not.toHaveText(/^0\s*TON$/);
  });

  test('lists quizzes and refuses to reveal the answer key', async ({ page }) => {
    await page.goto(`/learn?mockUser=${LEARNER}`);
    await expect(page.getByText('Science Daily CLE').first()).toBeVisible();
    const body = await page.content();
    expect(body).not.toContain('isCorrect');
  });

  test('answers a quiz and is scored on the server', async ({ page }) => {
    await page.goto(`/learn?mockUser=${NEW_LEARNER}`);
    await page.locator('a[href^="/quiz/"]').first().click();
    await expect(page.getByRole('heading', { name: 'Quiz' })).toBeVisible();

    const questions = page.locator('.card').filter({ has: page.locator('h3') });
    const count = await questions.count();
    for (let index = 0; index < count; index += 1) {
      await questions.nth(index).locator('.quiz-option').first().click();
    }

    await page.getByRole('button', { name: 'Submit answers' }).click();
    await expect(page.getByText(/learning points/)).toBeVisible();
    await expect(page.locator('.quiz-option.correct').first()).toBeVisible();

    // A second attempt is refused.
    await page.reload();
    await expect(page.getByText('Already completed')).toBeVisible();
  });

  test('walks the wallet page and refuses a withdrawal with no wallet', async ({ page }) => {
    await page.goto(`/wallet?mockUser=${LEARNER}`);
    // "Connect TON wallet" contains the same words, so target the heading itself.
    await expect(page.getByRole('heading', { name: 'TON wallet' })).toBeVisible();
    await page.getByLabel('Amount in CLEP').fill('1000');
    // Points are what the app counts in; TON is what leaves for the wallet.
    await expect(page.getByText('Sends 1 TON to your wallet.')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Withdraw to TON' })).toBeDisabled();
  });

  test('counts in CLE points and switches to TON on a tap', async ({ page }) => {
    await page.goto(`/?mockUser=${LEARNER}`);
    const hero = page.locator('.hero .amount');
    await expect(hero).toContainText('CLEP');
    const amount = async () => Number((await hero.innerText()).replace(/[^\d.]/g, ''));
    const points = await amount();
    await expect(page.locator('.amount-alt')).toContainText('TON');

    await hero.click();
    await expect(hero).toContainText('TON');
    const ton = await amount();
    // The same money, a thousand times over — each unit shown to its own
    // precision, so they agree to within half a point.
    expect(Math.abs(ton * 1000 - points)).toBeLessThanOrEqual(0.5);

    // The choice survives a reload, and every other screen honours it.
    await page.reload();
    await expect(page.locator('.hero .amount')).toContainText('TON');
    await page.goto(`/wallet?mockUser=${LEARNER}`);
    await expect(page.getByLabel('Amount in TON')).toBeVisible();
  });

  test('links a wallet and requests a withdrawal', async ({ page }) => {
    await page.goto(`/wallet?mockUser=${LEARNER}`);
    await page.getByLabel('TON address').fill('0:83dfd552e63729b472fcbcc8c45ebcc6691702558b68ec7527e1ba403a0f31a8');
    await page.getByRole('button', { name: /Link wallet|Replace wallet/ }).click();
    await expect(page.getByText('Wallet linked.')).toBeVisible();

    await page.getByLabel('Amount in CLEP').fill('1000');
    await page.getByRole('button', { name: 'Withdraw to TON' }).click();
    await expect(page.getByText('Withdrawal requested. It is paid out once processed.')).toBeVisible();
    await expect(page.locator('.pill', { hasText: 'LOCKED' })).toBeVisible();
  });

  test('offers referral links per community', async ({ page }) => {
    await page.goto(`/invite?mockUser=${LEARNER}`);
    await expect(page.getByText('Your invite links')).toBeVisible();
    await expect(page.getByText('Science Daily CLE')).toBeVisible();
    await expect(page.locator('.mono').first()).toContainText('startapp=r_');
  });
});

test.describe('creator dashboard', () => {
  test('shows the revenue split the platform actually applied', async ({ page }) => {
    await page.goto(`/creator?mockUser=${CREATOR}`);
    await expect(page.getByText('Your creator balance')).toBeVisible();
    await expect(page.getByText('Gross revenue')).toBeVisible();
    await expect(page.getByText('CLE fee')).toBeVisible();
    await expect(page.locator('.pill', { hasText: 'ACTIVE' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Manage community' })).toBeVisible();
  });

  test('opens community analytics and policy settings', async ({ page }) => {
    await page.goto(`/creator?mockUser=${CREATOR}`);
    await page.getByRole('link', { name: 'Manage community' }).click();
    await expect(page.getByText('Active members')).toBeVisible();

    await page.getByRole('button', { name: 'Settings' }).click();
    await expect(page.getByText('Revenue split')).toBeVisible();
    await expect(page.getByText('Reward pools')).toBeVisible();
    await expect(page.getByText('Platform limits')).toBeVisible();
  });

  test('hides the platform area from a creator', async ({ page }) => {
    await page.goto(`/admin?mockUser=${CREATOR}`);
    await expect(page.getByText('This area is for CLE platform administrators.')).toBeVisible();
  });
});

test.describe('platform administration', () => {
  test('reports the treasury and a balanced ledger', async ({ page }) => {
    await page.goto(`/admin?mockUser=${ADMIN}`);
    await expect(page.getByText('CLE platform treasury')).toBeVisible();
    await expect(page.getByText('Ledger balances to zero across every account.')).toBeVisible();
  });

  test('lists organizations across the platform', async ({ page }) => {
    await page.goto(`/admin?mockUser=${ADMIN}`);
    await page.getByRole('button', { name: 'Organizations' }).click();
    await expect(page.getByText('Science Media Demo')).toBeVisible();
  });
});
