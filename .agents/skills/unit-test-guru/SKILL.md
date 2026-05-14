# SKILL.md — TypeScript Testing (Vitest + Playwright)

## Stack: Vue 3 (Composition API) · Express · Pinia · Vitest · Playwright

This skill codifies best practices from 40+ authoritative sources — official Vitest/Vue/Playwright/Pinia docs, Kent C.
Dodds, Google SWE Book, Goldbergyoni, Thoughtworks, and modern community guides (2023–2025) — into actionable doctrine
for writing tests. It is opinionated. It is optimized for **confidence per minute** and **low maintenance**.

---

## 0 · The Prime Directive

> **Tests exist to reduce the cost of change.**

A test is **good** if it:

1. Fails only for meaningful regressions
2. Guides you to the root cause quickly
3. Survives refactors that don't change behavior
4. Runs fast enough that developers actually use it

A test is **bad** if it:

- Fails for irrelevant reasons (timing, selectors, internal refactors)
- Requires reading 300 lines of mocking to understand intent
- Re-implements the production code (a second buggy copy)
- Provides "coverage" but not confidence

---

## 1 · Core Principles

These appeared in 5+ independent authoritative sources. Every test should be measured against them.

**Test behavior, not implementation.** Ask "what does the user/caller observe?" not "which internal method was called?"
A test should never break when you refactor without changing behavior.

**Arrange-Act-Assert as structure.** AAA is a readability pattern, not religion. Three conceptual phases: set up the
scenario, execute the action, verify the outcome. Multiple assertions about the _same behavior_ are fine. Multiple
sequential actions are fine when they form steps in a single user story (especially in E2E). The point: a reader should
instantly see what's being tested and why.

**Tests should be trivially correct by inspection.** Don't put complex logic (conditionals, loops that compute expected
values) in tests that re-implements production code. Data-driven tests (`test.each`), simple builder helpers, and
straightforward setup are fine — the danger is computing expected values using the same algorithm you're testing.

**Each test is independent and isolated.** Tests pass in any order, alone or in a suite. No shared mutable state. A test
that depends on another test's output is broken by design.

**One reason to fail.** A test should fail for exactly one meaningful reason. If it asserts 12 unrelated things,
debugging becomes archaeology. Multiple assertions about the same behavior are fine; scattered assertions about
unrelated behaviors are not.

**Mock at boundaries, not internals.** Mock external services you don't control (third-party APIs, payment gateways,
email, databases). Never mock your own internal modules just to make tests easier. Every mock reduces confidence by
replacing real behavior with simulated behavior.

**Integration tests buy the most confidence.** Guillermo Rauch: "Write tests. Not too many. Mostly integration." Unit
tests for complex logic, integration tests for most everything else, thin E2E for critical journeys.

**Control nondeterminism.** Time → fake timers or injected clock. Randomness → seed or inject RNG. Network → mock at
boundary (MSW) or deterministic test server. Concurrency → await everything, ban floating promises.

**DAMP over DRY.** A developer must understand a test in isolation without jumping to helpers. Extract _how_ into
helpers (factories, builders). Keep _what you're testing_ visible inline.

**Coverage is a gap detector, not a quality proof.** Google explicitly notes there is no ideal coverage number and gives
rough bands (60/75/90) as contextual guidelines. 80% is a common starting point — adjust based on your risk profile and
suite maturity. Branch coverage matters most. What's NOT covered is more useful than what IS. Don't chase 100% — it
encourages trivial tests that add maintenance cost without confidence.

**Delete worthless tests.** A test that never fails, tests only mocks, or breaks on every refactor carries maintenance
cost with zero value. Deleting tests is a best practice.

---

## 2 · Test Taxonomy: What Belongs Where

| Level           | Tool                | Scope                  | Speed   | % of Suite | What to Test                                                                                |
| --------------- | ------------------- | ---------------------- | ------- | ---------- | ------------------------------------------------------------------------------------------- |
| **Static**      | TypeScript + ESLint | Types, syntax          | Instant | Always-on  | Type errors, missing awaits, dead code                                                      |
| **Unit**        | Vitest              | Single function/module | ms      | ~20-30%    | Validators, formatters, state reducers, composables, utilities with complex logic           |
| **Integration** | Vitest              | Multiple real modules  | seconds | ~50-60%    | Vue components with children + stores, Express routes via Supertest, service→adapter chains |
| **E2E**         | Playwright          | Full browser + stack   | minutes | ~5-10%     | Login, signup, checkout, core CRUD, cross-page flows — 5-10 critical paths max              |

**Do NOT test:** trivial getters/setters, framework internals (that Vue renders, that Express routes), third-party
library behavior, constants, constructor wiring, or logging code.

### The Testing Decision Tree

When deciding what test to write, ask in order:

1. **Can this be caught by TypeScript or ESLint?** → Don't write a test. Configure your tooling.
2. **Is this pure logic** (validator, formatter, reducer, utility)? → **Unit test** in Vitest.
3. **Is the risk about interaction between modules** (component + store, service + adapter, route + middleware)? →
   **Integration test** in Vitest. Mock only external boundaries.
4. **Is the risk about browser reality, full-stack wiring, auth/session, or cross-page flows?** → **E2E test** in
   Playwright. Critical paths only.
5. **Are you testing framework/library behavior?** → Don't. Unless you depend on a subtle contract you fear will change.

---

## 3 · Worthless vs High-Value Tests

### Worthless (delete or never write these)

- **Implementation-detail tests** — asserting internal state, `wrapper.vm`, private fields, exact DOM structure, CSS
  classes
- **Snapshot spam** — giant component tree snapshots that rot and get rubber-stamped. Snapshots are only useful for
  small, stable serialized outputs.
- **Mock-the-world tests** — so many mocks that you're testing your mocks, not behavior. If the test still passes when
  the real implementation is deleted, it's not testing behavior.
- **E2E duplication** — dozens of E2E tests for conditions already covered by integration tests
- **Sleep-based waits** — `waitForTimeout(1000)` is paying rent to the Flake Gods

### High-value (prefer these)

- **Behavioral assertions** — "Given X, when Y, then Z observable behavior happens"
- **Contract assertions** — verify request shapes sent to APIs, error mapping at boundaries
- **Edge-case coverage** — empty inputs, null, boundary values, error paths (where real bugs hide)
- **Critical-path E2E** — a small set of journeys that must never break
- **Accessibility-aligned queries** — `getByRole`, `getByLabel` produce resilient tests AND better UI

---

## 4 · Vitest Configuration

### Recommended `vitest.config.ts`

```typescript
import vue from '@vitejs/plugin-vue';
import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [vue()],
  test: {
    globals: true, // deliberate tradeoff: reduces boilerplate vs explicit imports
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: [...configDefaults.exclude, '**/e2e/**'],
    mockReset: true,
    environmentMatchGlobs: [
      ['src/server/**', 'node'],
      ['src/components/**', 'jsdom'],
    ],
    coverage: {
      provider: 'v8', // faster than istanbul; switch to istanbul if you need maximum precision
      reporter: ['text', 'json', 'html'],
      include: ['src/**/*.ts', 'src/**/*.vue'],
      exclude: ['**/*.test.ts', '**/*.spec.ts', '**/*.d.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
```

If using `globals: true`, add to `tsconfig.json`:

```json
{ "compilerOptions": { "types": ["vitest/globals"] } }
```

### Key config decisions

- **`globals: true`** — Vitest defaults to explicit imports (no globals). Enabling globals gives Jest-like ergonomics
  and reduces boilerplate. Pick one convention and keep it consistent. If you enable globals, configure `tsconfig` types
  for autocompletion.
- **`mockReset: true`** — auto-resets mocks between tests. Eliminates manual cleanup and prevents cross-test pollution.
- **`environment: 'jsdom'`** as default, `'node'` for server code via `environmentMatchGlobs`. Use `happy-dom` if you
  need speed (2-3x faster, less complete DOM).
- **`v8` coverage** — faster than istanbul. Vitest has improved v8 accuracy via AST-based remapping. If you encounter
  precision issues in coverage reports, switch to `provider: 'istanbul'`.

### Performance

Use `pool: 'threads'` for large projects. Use `--changed` in dev to only run affected tests. Use `--shard=1/4` in CI to
distribute. Use `--bail` in CI to stop on first failure.

---

## 5 · Vitest Mocking: `vi.spyOn` Over `vi.mock`

**Strong consensus: `vi.spyOn` should be your default.** `vi.mock` is a footgun that should be reserved for specific
cases.

### Why

`vi.spyOn` runs at runtime where you place it, is scoped to individual tests, has full TypeScript type safety, only
replaces what you specify, and cleans up with `mockReset: true`. In contrast, `vi.mock` is hoisted to the top of the
file before imports (breaking mental models), replaces the entire module, affects every test in the file, and requires
`vi.mocked()` type assertions.

```typescript
// ✅ GOOD: vi.spyOn — targeted, type-safe, test-scoped
import * as userService from './userService';

test('fetches user data', async () => {
  vi.spyOn(userService, 'getUser').mockResolvedValue({ id: 1, name: 'John' });
  const result = await getProfile(1);
  expect(result.name).toBe('John');
});

// ❌ AVOID: vi.mock — hoisted, file-scoped, type-unsafe
vi.mock('./utils', () => ({
  ...vi.importActual('./utils'),
  formatDate: vi.fn().mockReturnValue('2025-03-15'),
}));
```

### When `vi.mock` is acceptable

Only when replacing an entire module consistently across all tests in a file — typically for heavy external dependencies
(database clients, HTTP libraries) where `vi.spyOn` can't reach the import binding.

### `vi.fn()` for injected callbacks

```typescript
const onSubmit = vi.fn();
mount(FormComponent, { props: { onSubmit } });
await wrapper.find('form').trigger('submit');
expect(onSubmit).toHaveBeenCalledWith({ name: 'test' });
```

### What to assert (public contract)

Assert observable outcomes, not call sequences:

- Return values
- Thrown errors
- Emitted events
- Rendered text/roles
- Requests sent at boundaries (shape, not call count)
- Persisted records at repo boundary (in integration tests)

---

## 6 · Assertion Patterns

### Choosing the right matcher

| Matcher         | Comparison                                 | Use For                                   |
| --------------- | ------------------------------------------ | ----------------------------------------- |
| `toBe`          | `Object.is()` reference                    | Primitives only (string, number, boolean) |
| `toEqual`       | Deep recursive, ignores `undefined` props  | General objects/arrays — **the default**  |
| `toStrictEqual` | Deep + checks undefined keys, constructors | API responses where structure matters     |
| `toMatchObject` | Partial deep match                         | Checking a subset of properties           |

**Never** use `toBe` for objects/arrays. **Never** use `toBe` with floats — use `toBeCloseTo`. Use
`expect.assertions(n)` in async tests to ensure assertions actually run.

### Snapshots: use sparingly

Useful for: serialized data structures, code generation output, small inline values. Harmful for: large component trees,
frequently changing data, or as a replacement for behavioral assertions. **Always prefer `toMatchInlineSnapshot()`** for
small values to keep expectations visible.

### Table-driven tests for dense logic

```typescript
test.each([
  { input: '', expected: false },
  { input: 'bad', expected: false },
  { input: 'user@example.com', expected: true },
])('validates email "$input" as $expected', ({ input, expected }) => {
  expect(isValidEmail(input)).toBe(expected);
});
```

---

## 7 · Vue 3 Component Testing

### The golden rule

Test components the way a user would — through clicks, typing, and reading rendered output. **Never test internal
state** (`wrapper.vm`, `setData()`), private methods, or exact DOM structure.

```typescript
// ❌ BAD: implementation details
await wrapper.setData({ count: 2 });
expect(wrapper.vm.count).toBe(2);

// ✅ GOOD: observable behavior
await wrapper.find('button').trigger('click');
await wrapper.find('button').trigger('click');
expect(wrapper.text()).toContain('Times clicked: 2');
```

### `mount()` vs `shallowMount()`

**Prefer `mount()` when you want real child behavior** — it tests interactions more realistically. **Use
`shallowMount()` when children are irrelevant to the behavior under test or make tests slow/cumbersome** (e.g.,
expensive API calls in children, deep component trees). For selective control, use full mount with targeted stubs:

```typescript
const wrapper = mount(MyComponent, {
  props: { title: 'Hello' },
  global: {
    plugins: [createTestingPinia({ initialState: { counter: { n: 5 } } })],
    stubs: { HeavyChart: true }, // stub only expensive children
  },
});
```

The pragmatic rule: mount the smallest realistic slice that still tests behavior.

### Testing composables

**Independent composables** (using only `ref`, `computed`, `watch`) — test directly:

```typescript
test('computes sum correctly', () => {
  const a = ref(2),
    b = ref(3);
  const sum = useSum(a, b);
  expect(sum.value).toBe(5);
});
```

**Dependent composables** (lifecycle hooks, `provide`/`inject`) — need a component context. Use the `withSetup` helper:

```typescript
function withSetup<T>(composable: () => T): [T, App] {
  let result: T;
  const app = createApp({
    setup() {
      result = composable();
      return () => {};
    },
  });
  app.mount(document.createElement('div'));
  return [result!, app];
}
```

### Testing Pinia stores

**Unit test stores directly** with `setActivePinia(createPinia())` in `beforeEach`. **Test components with stores**
using `createTestingPinia`:

```typescript
import { createTestingPinia } from '@pinia/testing';

const wrapper = mount(Counter, {
  global: {
    plugins: [
      createTestingPinia({
        initialState: { counter: { n: 20 } },
      }),
    ],
  },
});

const store = useCounterStore(); // MUST be called AFTER mount
store.someAction();
expect(store.someAction).toHaveBeenCalledTimes(1); // actions auto-spied
```

**Critical gotcha:** always call `useStore()` after `createTestingPinia` is installed, never before.

### Testing Vue Router

For unit tests, mock the composables:

```typescript
vi.mock('vue-router', () => ({
  useRoute: vi.fn(() => ({ params: { id: '1' } })),
  useRouter: vi.fn(() => ({ push: vi.fn() })),
}));
```

For integration tests, use a real router instance with `router.push('/')` and `await router.isReady()` before mounting.

### Async patterns

Vue updates the DOM asynchronously. Always `await`:

| Scenario               | Solution                                            |
| ---------------------- | --------------------------------------------------- |
| After user interaction | `await wrapper.find('button').trigger('click')`     |
| After API calls        | `await flushPromises()` from `@vue/test-utils`      |
| After timers           | `vi.useFakeTimers()` + `vi.advanceTimersByTime(ms)` |
| Async `setup()`        | Wrap in `<Suspense>` + `await flushPromises()`      |

### Emitted events

```typescript
await wrapper.find('button').trigger('click');
expect(wrapper.emitted()).toHaveProperty('increment');
expect(wrapper.emitted('increment')![0]).toEqual([{ count: 1 }]);
```

---

## 8 · Express API Testing

### Separate app from server (critical)

```typescript
// src/app.ts — exported for testing
import express from 'express';

// src/server.ts — entry point only
import app from './app';

const app = express();
app.use(express.json());
app.use('/api/users', userRouter);
export default app;

app.listen(3000);
```

### Integration testing with Supertest

```typescript
import request from 'supertest';

import app from '../src/app';

describe('POST /api/tasks', () => {
  it('creates a task with valid data', async () => {
    const res = await request(app)
      .post('/api/tasks')
      .send({ title: 'Test Task', status: 'pending' })
      .expect('Content-Type', /json/)
      .expect(201);

    expect(res.body.title).toBe('Test Task');
    expect(res.body).toHaveProperty('id');
  });

  it('returns 400 for invalid input', async () => {
    const res = await request(app).post('/api/tasks').send({ title: '' }).expect(400);

    expect(res.body.errors).toBeDefined();
  });
});
```

**Coverage gotcha:** for Vitest coverage to work with Supertest, the server must run in the same process. Use
`setupFiles` (not `globalSetup`) since `setupFiles` runs in the coverage-collecting runtime.

### Middleware testing

Create mock `req`, `res`, `next` to unit test middleware without the full Express stack:

```typescript
describe('Auth Middleware', () => {
  let mockReq: Partial<Request>;
  let mockRes: Partial<Response>;
  let next: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockReq = { headers: {} };
    mockRes = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    next = vi.fn();
  });

  it('returns 403 without authorization header', () => {
    authMiddleware(mockReq as Request, mockRes as Response, next);
    expect(mockRes.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
```

### The five categories per endpoint

For every API endpoint, cover: valid input (happy path), invalid input (400), unauthorized access (401/403), server
errors (500), and edge cases (empty results, boundary values).

---

## 9 · Network Mocking with MSW

Vitest's official docs recommend MSW (Mock Service Worker). It intercepts at the network level without changing
application code.

```typescript
// src/mocks/handlers.ts
import { HttpResponse, http } from 'msw';
// vitest.setup.ts
import { setupServer } from 'msw/node';

import { handlers } from './mocks/handlers';

export const handlers = [
  http.get('https://api.example.com/user', () => {
    return HttpResponse.json({ id: 'abc-123', firstName: 'John' });
  }),
];

const server = setupServer(...handlers);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
```

**`onUnhandledRequest: 'error'`** catches unmocked requests — prevents accidental real network calls. Override per-test
with `server.use()` for error scenarios.

---

## 10 · Playwright E2E Testing

### Philosophy

E2E tests are expensive (slow, more brittle, harder to debug). Use them for:

- Critical user journeys (login, signup, checkout, core CRUD)
- Cross-cutting risks (auth/session/caching/routing)
- Browser-specific issues (real rendering, file upload)

Do NOT use them for edge cases of pure logic or UI micro-behaviors already covered by integration tests.

### Configuration

```typescript
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined, // Playwright recommends 1 in CI for stability; scale with sharding
  reporter: 'html',

  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  projects: [
    { name: 'setup', testMatch: /.*\.setup\.ts/ },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'playwright/.auth/user.json',
      },
      dependencies: ['setup'],
    },
  ],

  webServer: {
    command: 'npm run start',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
  },
});
```

### Locators: user-facing first

Playwright's official priority:

```typescript
// ✅ Best — role-based (mirrors users and assistive tech)
page.getByRole('button', { name: 'Submit' });
page.getByLabel('Email');
page.getByText('Welcome back');

// ✅ Acceptable fallback — test IDs for complex/icon-only elements
page.getByTestId('search-input');

// ⚠️ Use with caution — CSS/ID selectors for edge cases (canvas, virtualized lists, complex widgets)
page.locator('[data-canvas-id="main"]');

// ❌ Never — brittle positional/layout-dependent selectors
page.locator('div > span:nth-child(3)');
page.locator('button.btn-primary');
```

Chain locators for precision:
`page.getByRole('listitem').filter({ hasText: 'Product 2' }).getByRole('button', { name: 'Add to cart' })`.

### Never sleep

**Never use `page.waitForTimeout()`.** Playwright's official docs: "Tests that wait for time are inherently flaky."
Instead:

```typescript
// ✅ Web-first assertions auto-retry until condition met (default 5s timeout)
await expect(page.getByText('Welcome')).toBeVisible();

// ❌ Instant check, no retry — causes flakiness
expect(await page.getByText('Welcome').isVisible()).toBe(true);
```

For specific API responses: `page.waitForResponse('**/api/data')`.

### Authentication: `storageState` pattern

Authenticate once, reuse everywhere:

```typescript
// auth.setup.ts
import { expect, test as setup } from '@playwright/test';

setup('authenticate', async ({ page }) => {
  await page.goto('/login');
  await page.getByLabel('Email').fill(process.env.TEST_EMAIL!);
  await page.getByLabel('Password').fill(process.env.TEST_PASSWORD!);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await page.waitForURL('/dashboard');
  await page.context().storageState({ path: 'playwright/.auth/user.json' });
});
```

For multi-role testing, create separate storage states (`admin.json`, `user.json`) and separate Playwright projects. Add
`playwright/.auth/` to `.gitignore`.

### Page Object Model

POM is one effective way to structure large E2E suites. Use the lightest abstraction that prevents duplication without
hiding intent. Define locators in constructor, expose user-facing methods. **Keep assertions in tests, not page
objects:**

```typescript
export class LoginPage {
  readonly emailInput: Locator;
  readonly passwordInput: Locator;
  readonly submitButton: Locator;

  constructor(private page: Page) {
    this.emailInput = page.getByLabel('Email');
    this.passwordInput = page.getByLabel('Password');
    this.submitButton = page.getByRole('button', { name: 'Sign in' });
  }

  async login(email: string, password: string) {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.submitButton.click();
  }
}
```

Inject via Playwright fixtures:

```typescript
export const test = base.extend<{ loginPage: LoginPage }>({
  loginPage: async ({ page }, use) => {
    await use(new LoginPage(page));
  },
});
```

For smaller suites, lightweight helper functions may be all you need.

### Network mocking in E2E

Mock third-party APIs you don't control. Don't mock your own backend for critical flows:

```typescript
await page.route('**/api/v1/external', async (route) => {
  await route.fulfill({ status: 200, json: { result: 'mocked' } });
});
```

### Test isolation and data management

- Tests must be independent, runnable in any order, parallel-safe.
- Prefer API setup (create user via API) over UI setup (clicking through signup).
- Use unique test data per run (`test-user-${Date.now()}@example.com`).
- Generate fresh data, don't share mutable state between workers.

### CI practices

- Linux runners for consistency and cost.
- Install only needed browsers: `npx playwright install chromium --with-deps`.
- Playwright recommends `workers: 1` in CI for stability/reproducibility; scale with sharding if you need parallelism.
- Upload HTML reports and traces as CI artifacts.
- `trace: 'on-first-retry'` (full traces on every test are expensive).
- Run E2E after unit + integration tests pass.

---

## 11 · Named Anti-Patterns

**The Mockery** — So many mocks the system under test isn't being tested. If removing the mock makes the test
meaningless, the test has no value.

**The Liar** — Passes in every scenario, validates nothing. Often caused by missing assertions in async tests. Fix:
`expect.assertions(n)`.

**The Giant** — Tests too many things at once. When it fails, you can't tell what broke. Fix: one behavior per test.

**The Inspector** — Tests private methods, internal state, or specific call sequences when only the output matters. Fix:
test through the public API.

**The Nitpicker** — Snapshots the entire component tree when only specific text matters. Fix: targeted assertions +
inline snapshots for small values only.

**Generous Leftovers** — Tests depend on state created by previous tests. Fix: fresh instances in `beforeEach`, never
use `describe.sequential` unless absolutely necessary.

**The Secret Catcher** — Relies on thrown exceptions for assertion instead of explicit `expect()`. Fix: always use
explicit assertions.

---

## 12 · Quality Bar Checklists

### Unit test ✓

- [ ] Asserts behavior, not implementation details
- [ ] Deterministic (no real time/random/network)
- [ ] Minimal mocking (boundaries only)
- [ ] Covers edge cases and error paths
- [ ] Failure message is understandable without reading the test body
- [ ] Trivially correct by inspection (no complex logic re-implementing production code)

### Integration test ✓

- [ ] Uses real modules together
- [ ] Mocks only external boundaries (HTTP, DB, third-party)
- [ ] Focuses on observable outcomes (rendered UI, returned response, emitted events)
- [ ] Stable queries (role/label/text, not CSS selectors)
- [ ] No snapshot bloat

### E2E test ✓

- [ ] Covers a critical user journey (would you lose money/users if this broke?)
- [ ] Uses user-facing locators (`getByRole`, `getByLabel`, `getByText`)
- [ ] Uses web-first assertions (no `waitForTimeout`)
- [ ] Independent + parallel-safe
- [ ] Captures trace/screenshot on failure in CI
- [ ] Runtime is reasonable (< 30s per test as guideline)

---

## 13 · File Organization

```
src/
  components/
    UserCard.vue
    UserCard.test.ts              # co-located with source
  composables/
    useAuth.ts
    useAuth.test.ts
  server/
    routes/
      users.ts
      users.test.ts
    middleware/
      auth.ts
      auth.test.ts
tests/
  e2e/                            # E2E tests separate from source
    auth/
      login.spec.ts
    checkout/
      purchase.spec.ts
  helpers/
    factories.ts                  # shared test data builders
    setup.ts
```

Co-locate unit and integration tests with source. Keep E2E tests in a dedicated directory. Pick `.test.ts` for Vitest
and `.spec.ts` for Playwright and be consistent.

---

## 14 · Test Naming

Names should describe behavior such that a failing test tells you what broke:

```typescript
describe('UserService', () => {
  describe('createUser', () => {
    it('returns user with generated ID when given valid input', () => { ... })
    it('throws ValidationError when email is missing', () => { ... })
    it('hashes password before storing', () => { ... })
  })
})
```

Name after behaviors, not methods. One method may have multiple behaviors. One behavior may span multiple methods.

---

## 15 · Maintenance Policy

- **Flaky twice → broken.** Treat flaky tests as production bugs. Fix root cause (selectors, waits, data isolation).
  Don't increase timeouts.
- **Blocks refactors without catching bugs → rewrite it.** If a test breaks on a refactor that didn't change behavior,
  it's testing implementation details.
- **E2E runtime growing → prune aggressively.** Keep critical-path coverage, push detail down into integration/unit
  tests.
- **Prefer deleting bad tests over living with them.** A shrinking suite that you trust beats a growing suite nobody
  believes.
