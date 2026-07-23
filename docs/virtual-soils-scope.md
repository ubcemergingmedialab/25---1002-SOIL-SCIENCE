# Virtual Soils Scope Document

## Project context

**Project:** Virtual Soils (web-based map + 3D soil scene explorer)

This scope covers the next four months of development for the existing Virtual Soils application. The current product foundation (map, embedded 3D viewer, editor, and admin workflow) is in place; this phase focuses on improving core user experience, creating meaningful learning content, and making the app usable on mobile devices.

---

## Team capacity and planning assumptions

- **Student contributor:** 20 hours/week  
- **Project lead contribution:** 15 hours/week  
- **Total team capacity:** 35 hours/week  
- **Duration:** 4 months (~16 weeks)  
- **Estimated total effort:** ~560 hours

Planning should prioritize a focused, iterative scope over broad feature expansion. Content + usability improvements should be treated as first-class deliverables, not side tasks.

---

## Scope goals (next 4 months)

1. **Strengthen the core user flow**
   - Improve the path from map discovery -> opening a 3D scene -> understanding what to do next.
   - Reduce friction in navigation and orientation (especially for first-time users).

2. **Create foundational project content**
   - Produce initial curated scene content (site descriptions, marker narratives, supporting explanatory text/media).
   - Define a repeatable content template so additional scenes can be authored consistently.

3. **Use content work to drive feedback and iteration**
   - Treat each new content release as a usability test opportunity.
   - Collect feedback on clarity, flow, and learning value; iterate quickly on both content and UI.

4. **Implement responsive styling for mobile use**
   - Ensure key flows work on phones and tablets (map browsing, scene launch, in-viewer controls, basic reading/navigation).
   - Improve touch targets, layout behavior, and readability at small breakpoints.

---

## In scope

- UX refinement of current app surfaces (`/`, embedded viewer flow, content presentation).
- Initial content pack creation for the project (text, markers, scene-level context).
- Lightweight feedback loop process (scheduled review rounds and issue tracking from user testing).
- Responsive CSS/layout improvements across key pages and controls.
- Cross-device QA for modern mobile browsers.

## Out of scope (for this phase)

- Large net-new platform features unrelated to core flow/content/mobile readiness.
- Full redesign of backend architecture.
- Advanced simulation fidelity work that does not directly support user learning flow in this timeframe.

---

## Delivery approach

### Track A: Product and UX iteration

- Baseline the current user journey and identify top friction points.
- Ship small, testable UX updates in short cycles.
- Validate each cycle with quick stakeholder or learner feedback.

### Track B: Content production

- Create a minimum viable content set for multiple scenes.
- Standardize content structure (title, objective/context, marker narrative, takeaway).
- Pair content QA with product QA so content and interface evolve together.

### Track C: Mobile responsiveness

- Define target breakpoints and mobile interaction expectations.
- Implement responsive layout and control adjustments.
- Run browser/device checks and fix high-impact defects early.

---

## Suggested timeline (4 months)

| Phase | Weeks | Focus |
|------|------|------|
| **Phase 1: Baseline and plan** | Weeks 1-2 | Confirm priority user flow, content template, responsive design targets, and acceptance criteria. |
| **Phase 2: First iteration cycle** | Weeks 3-6 | Implement highest-priority UX fixes, build first content set, and run first feedback round. |
| **Phase 3: Expand and stabilize** | Weeks 7-11 | Add additional content, improve user flow based on findings, and complete major responsive updates. |
| **Phase 4: Polish and readiness** | Weeks 12-16 | Hardening, mobile QA, accessibility/usability polish, documentation, and final handoff package. |

---

## Feedback and iteration model

- Run recurring feedback checkpoints (for example, biweekly).
- Capture issues in three buckets: **content clarity**, **flow friction**, **mobile usability**.
- Prioritize fixes by learner impact and implementation effort.
- Keep iteration loops short so the student can ship, test, and learn continuously.

---

## Risks and mitigations

| Risk | Mitigation |
|------|------------|
| Content creation lags behind engineering work | Timebox weekly content production and review; treat content as a sprint deliverable. |
| UX feedback is gathered but not actioned | Maintain a simple prioritized backlog with explicit owner and target sprint. |
| Mobile support becomes a late-stage scramble | Start responsive implementation in early phases, not just final polish. |
| Scope expands beyond available hours | Enforce must-have vs stretch priorities and review scope monthly. |

---

## Deliverables checklist

- [ ] Updated scope-aligned product backlog for 4 months  
- [ ] Initial content pack integrated into the app  
- [ ] Documented feedback process and iteration log  
- [ ] Responsive styles implemented for key user flows  
- [ ] Mobile QA pass notes and resolved critical issues  
- [ ] End-of-phase summary with next-step recommendations  

---

## Success criteria

- Users can complete the core map -> viewer -> content journey with less confusion.
- The project has a usable starter content set that demonstrates intended educational value.
- Feedback is regularly collected and reflected in visible product/content improvements.
- The app is functionally usable and readable on common mobile screen sizes.
