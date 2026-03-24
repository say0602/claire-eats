Verify that `$task` was implemented correctly — both automated checks and live browser QA.

Before proposing or running any tests, read `docs/TESTING.md` for this project's testing guidelines.

Then:

1. `cd finance-sim-v0-prototype` and run:
   - `npm.cmd run lint`
   - `npm.cmd run build`
2. Run any relevant automated tests, or add focused tests if coverage is missing for the changed logic.
3. Start the dev server if it isn't already running (`npm.cmd run dev`), then use the browser MCP to walk the feature end-to-end in a live browser. Review:
   - UX flow and interaction behavior
   - visual layout, spacing, and copy quality
   - validation / error states
   - persistence / reload behavior when relevant
4. Summarize:
   - automated test results
   - browser QA findings (with screenshots if possible)
   - issues detected
   - manual runtime checks I should still perform

Keep recommendations practical and specific to the Finance Simulator.
