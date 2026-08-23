# Testing on a phone, and what desktop browsers cannot see

Most reviewers open a portfolio link on a phone. This is how to check that path, and — more
importantly — why the automated suite can be entirely green while the phone is broken.

---

## The bug that made this document necessary

The mobile navigation drawer was unreadable on an iPhone. Opening it showed the page content
straight through the panel: customer rows interleaved with menu items, the menu text painting
on top of them. The links still worked. They were simply invisible.

The drawer's background was never missing. It computed `rgb(8, 19, 16)` at full opacity. The
problem was the element beside it:

```
backdrop   backdrop-blur-sm   → promoted to its own compositing layer
panel      z-index: auto      → not promoted; order implied by DOM position only
```

`backdrop-filter` promotes an element to a hardware layer. Chromium still paints positioned
siblings in DOM order, so the panel covered the backdrop and everything looked right. **iOS
Safari, once a sibling has been promoted, composites that layer above the un-promoted one** —
so the blurred page slid over the drawer's background while its text kept painting above.

The fix is to stop relying on implied order: the backdrop is `z-0`, the panel is `z-10`, and
the container is `isolate`.

### What did not catch it

The drawer already had six end-to-end tests, **including an axe accessibility scan**. Every
one passed.

axe measures text contrast against the computed background, saw the declared opaque colour,
and correctly reported no violation. The colour was genuinely there — it just was not painted.
**Automated accessibility tools reason about the style tree, not about what the compositor did
with it.** Nor could the Playwright suite have caught it: it runs on Chromium, which does not
exhibit the bug by construction.

The regression test added afterwards therefore pins the *invariant*, not the appearance — both
siblings carry an explicit `z-index`, the panel's is higher, and its background is opaque
`rgb()` with no alpha. It was confirmed to fail with the `z-index` removed before being
committed, because a guard that cannot fail is not a guard.

---

## Three oracles, in increasing order of truth

### 1. Chromium at a phone viewport — cheap, and blind to WebKit

```bash
cd apps/web && npm run test:e2e -- mobile-nav.spec.ts
```

Catches layout, overflow, focus handling, scroll locking and accessibility-tree problems. It
runs in CI on every push. **It cannot catch a WebKit rendering difference**, and the drawer bug
above is the standing proof.

### 2. macOS Safari — real WebKit, already installed

Safari on macOS is WebKit. Open the site, then **Develop → Enter Responsive Design Mode**
(enable the Develop menu first in Safari → Settings → Advanced) and pick an iPhone size.

This catches WebKit-specific CSS and JavaScript behaviour that Chromium hides, and costs
nothing to run. It shares an engine with iOS but not a compositor, so the most iOS-specific
rendering faults — the layer-promotion class above among them — can still slip through.

### 3. iOS Simulator — real iOS WebKit and a real iOS compositor

The closest thing to an iPhone without holding one. Also, separately, what any future iOS app
will be developed against.

**Setup.** Since Xcode 15, Apple ships the SDK with Xcode but requires the simulator *runtime*
— the actual iOS image — to be downloaded separately. Check what is present:

```bash
xcrun simctl list runtimes
```

An empty list under `== Runtimes ==` means the runtime is missing even though `xcodebuild
-showsdks` reports an iOS Simulator SDK, and even though `xcrun simctl list devicetypes` lists
dozens of iPhones. Those are device *definitions* with no OS to run. Install it with:

```bash
xcodebuild -downloadPlatform iOS
```

That is a multi-gigabyte download and may ask for an administrator password. Afterwards:

```bash
xcrun simctl create "iPhone 17" "iPhone 17"
xcrun simctl boot "iPhone 17"
open -a Simulator
xcrun simctl openurl booted "https://zerofayyz-fintech.vercel.app"
```

To point a simulator at a local build, use `http://localhost:PORT` — the simulator shares the
host's network.

### 4. An actual iPhone — the only ground truth

It is in your pocket, it costs nothing, and it is the oracle that found the drawer bug when
six automated tests and a full CI pipeline did not. **Walk the phone before sending
applications.** Nothing above replaces it.

---

## The phone walk

Do this on a real device, in Safari, at least once before a round of applications.

1. **Dashboard** — figures render, nothing overflows sideways
2. **Drawer** — opens, background is solid, every destination readable and reachable
3. **Login** — the password field is not wider than the screen (a real past defect: `width:100%`
   plus padding with no `box-sizing: border-box`)
4. **Operator area** — sign in with the published demo credentials, audit trail loads
5. **Test payment** — through Stripe Checkout and back, landing on the client it started from
6. **Repeat on the Vue and Svelte clients** — separate implementations, separate bugs

---

## Related

- `HOSTING_AND_ACCOUNTS.md` — where everything runs and what it costs
- `MANUAL_ACCEPTANCE_TEST.md` — the full charter, including the desktop path
- `LOCAL_DEVELOPMENT.md` — running the stack locally
