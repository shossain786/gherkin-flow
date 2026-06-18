# GherkinFlow — Marketing Push (v0.9.46)

Three ready-to-use pieces of content. Edit `[PLACEHOLDER]` values before publishing.

---

## 1. LinkedIn Post (BDD / QA Automation communities)

**Target groups:** BDD & Cucumber Testing (LinkedIn), Agile Testing Alliance, Software QA Automation

---

I've been quietly building a VS Code extension for teams doing BDD with Cucumber — and after months of real-project feedback, it's reached a point where I think it's genuinely useful.

**GherkinFlow** brings the full BDD loop into your editor:

▶ **One-click run** — click above any scenario, no terminal needed  
🧪 **Step-level results** — see exactly which step passed or failed, with timing  
🔴 **Inline failure decoration** — error message appears as ghost text on the broken line  
🤖 **AI scenario generation** — describe a requirement in plain English, get a `.feature` file  
⚡ **Generate missing stubs** — click once to scaffold all unimplemented step definitions  
⚠️ **BDD quality linter** — catches no-Then scenarios, duplicate names, UI leaks before review  
🔧 **Zero config** — auto-detects Maven, Gradle, cucumber-js, and Behave projects  

Works across **Java** (Maven/Gradle), **TypeScript/JavaScript** (cucumber-js), and **Python** (Behave).

It's free on the VS Code Marketplace:  
👉 https://marketplace.visualstudio.com/items?itemName=RazaTech.gherkin-flow

If your team is writing `.feature` files and context-switching to the terminal for every run, give it a try. Feedback — good or harsh — welcome in the comments or via GitHub issues.

#BDD #Cucumber #TestAutomation #VSCode #QAAutomation #CucumberJS #Java #Python #Selenium

---

## 2. GitHub Repository Announcement (Discussions / README banner / Release notes)

**Post in:** GitHub Discussions → Announcements, or pin as a GitHub Release

---

### GherkinFlow v0.9.46 — Refactoring actions + reliability fixes

**What shipped in 0.9.46:**

- ⬆ **Extract to Background** — select steps inside a Scenario and move them to a shared `Background:` block with one click
- ✏ **Rename step definition** — rename a pattern and GherkinFlow rewrites every matching step across all `.feature` files in the workspace, preserving argument values

**Reliability fixes in this cycle (found during internal audit):**

1. **Inline failure decorations now work correctly** — the red ghost-text annotation on failed step lines was silently broken: the report lookup used the scenario name alone but the map was keyed `featureName::scenarioName`. Fixed.
2. **Background step offset in decorations** — when reporters omit background steps from scenario elements, the decoration could land on the wrong line. Now uses the same offset correction as Test Explorer.
3. **Config cache invalidation** — if you add or delete a `pom.xml`, `package.json`, or `behave.ini` mid-session, GherkinFlow now detects the change and re-runs project detection instead of sticking with the stale build command.

**Try it:**
```
ext install RazaTech.gherkin-flow
```

Or search "Gherkin Flow" in the VS Code Extensions panel.

Report issues → https://github.com/shossain786/gherkin-flow/issues  
Leave a review → https://marketplace.visualstudio.com/items?itemName=RazaTech.gherkin-flow&ssr=false#review-details

---

## 3. Marketplace Summary Update

**Location:** `package.json` → `"description"` field  
**Current (126 chars):**
> AI-powered BDD toolkit for VS Code. Generate scenarios from plain English, run & debug Cucumber tests with one click, catch quality issues before they ship. Supports Java, TypeScript, JavaScript, and Python.

**Proposed (improved — 195 chars, still under 200):**
> One-click Cucumber test runner with step-level results, AI scenario generation, and a BDD quality linter. Zero config for JS/TS and Python (Behave); one reporter line for Java (Maven/Gradle). Supports monorepos.

**Why this is better:**
- Leads with the most-searched use case ("Cucumber test runner") rather than the AI angle
- Calls out the zero-config benefit for JS/Python users explicitly
- Mentions monorepo — a common search term for larger teams
- Java one-liner requirement is surfaced upfront so users aren't surprised

**To apply**, update `package.json` line 4:
```json
"description": "One-click Cucumber test runner with step-level results, AI scenario generation, and a BDD quality linter. Zero config for JS/TS and Python (Behave); one reporter line for Java (Maven/Gradle). Supports monorepos.",
```

---

## Posting checklist

- [ ] LinkedIn post drafted and scheduled (target: Tuesday or Wednesday morning)
- [ ] LinkedIn post shared to 2–3 relevant groups (BDD & Cucumber Testing, Agile Testing Alliance)
- [ ] GitHub Discussions announcement posted and pinned
- [ ] GitHub Release created for v0.9.46 using the announcement text
- [ ] `package.json` description updated before next `vsce publish`
- [ ] Review request messages sent to 5 early adopters (see REVIEW_REQUEST.md)
