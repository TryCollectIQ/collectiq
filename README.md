# Readiness Simulation — Demonstration Prototype

A working discrete-time queueing simulation of an end-to-end mobilization pipeline, built by CollectIQ Technologies LLC as a capability demonstration in support of RFQ **90MC26Q0005**, Readiness Simulation (RS) for the Selective Service System.

**Live prototype:** _(add deployed URL here)_

---

## What this is

This prototype demonstrates the modeling approach CollectIQ proposes for the Readiness Simulation. It is a functioning simulation — not a mockup or a wireframe. Every number displayed is computed at runtime from the scenario parameters the user sets.

**It is not a submission of the production system.** The production implementation described in our technical narrative targets Python/SimPy, containerized for the Government-designated cloud environment. This prototype implements the same model structure in the browser so that Government evaluators can drive it directly, with no installation, credentials, or environment setup.

## Running it

There is no build step and there are no dependencies to install.

- **Deployed:** open the URL above in any modern browser.
- **Locally:** clone the repository and open `index.html` directly, or serve the directory with any static file server:
  ```
  python3 -m http.server 8000
  ```
  then open `http://localhost:8000`.

The application is a single self-contained HTML file. All computation runs client-side. No data is transmitted, stored, or persisted.

## Approach

The mobilization pipeline is modeled as a series of capacity-constrained queues, traversed by anonymized aggregate cohorts. This formalism was chosen because the questions the Agency has stated it needs answered — where throughput binds, how long delivery takes under surge, what staffing is required — are queueing questions. They are not answerable from rate averages, because the failure mode of a pipeline under surge is backlog accumulation, not insufficient nominal rate.

Stages correspond to the Mission Essential Functions:

| Stage | Modeled as | Constraint |
|---|---|---|
| Registration | Record verification throughput | Verification capacity/day |
| Selection | Lottery sequencing | None — not capacity-constrained |
| Notification | Notice issuance, with mail-transit delay | Notices issued/day |
| Classification | Local boards, with an appeal path | Board and appeal-board cases/day |
| Delivery | MEPS examination and induction | Exams/day |
| Alternative Service | Placement of approved objectors | Placements/day |

Responders branch into claim and non-claim paths. Claims are adjudicated by local boards; grants route conscientious objectors to Alternative Service; denials appeal at a configurable rate, and unsuccessful appeals rejoin the delivery path. Selection is deliberately modeled without a queue, because lottery sequencing is computational and does not constrain throughput. Modeling it as a bottleneck would misrepresent the mission.

Each scenario runs **25 Monte Carlo replications** with stochastic variation applied to every capacity, producing a P10–P90 band rather than a single deterministic trajectory. Days-to-target is reported at P50 and P90, which are the figures a planner briefs.

The binding constraint is identified by **queue-days** — the accumulated backlog area over the run — rather than by peak utilization. A stage can run near capacity without binding; the stage that binds is the one whose backlog compounds.

## Tools used

- Plain HTML, CSS, and JavaScript. No frameworks, no build tooling, no runtime dependencies.
- Simulation engine, Monte Carlo driver, and charts all implemented directly; charts are drawn on HTML canvas.
- Seeded pseudorandom generator, so identical inputs reproduce identical results.

The absence of dependencies is intentional. It eliminates supply-chain and licensing questions for a demonstration artifact, and makes the code readable end-to-end by a Government reviewer in a single sitting.

## Assumptions

**All parameters are notional.** No Government-furnished planning data was used or is claimed. Default values are illustrative placeholders chosen to exercise the model, and are displayed as adjustable inputs precisely so that no figure is mistaken for an Agency estimate. The interface carries a persistent notice to this effect.

The following are held as fixed internal rates in the prototype and would become Government-configured parameters in production: mail transit delay, non-response rate, examination qualification rate, claim grant rate, conscientious objector share, and appeal grant rate.

**Structural assumptions:**
- Cohorts are homogeneous within a stage; no per-registrant attributes are modeled.
- Capacity is expressed as daily throughput rather than as individually scheduled resources.
- Time advances in daily increments.
- The horizon is fixed at 365 days.

## Limitations

This prototype is scoped to demonstrate model structure and analytic output, not production completeness. It does not implement scenario persistence, user roles, export or reporting, audit logging, or an administrative interface. It has not undergone formal verification and validation.

Validation is the substantive technical challenge in this effort, and we treat it as such: a simulation of a mission that has not been executed at scale cannot be validated against historical outcome data. Our proposed approach — structural validation against the PWS process definition, subject-matter expert review, sensitivity analysis, and extreme-condition testing — is described in the technical narrative.

## Data

No real, personal, or Government data is used. The model operates on synthetic aggregate cohorts. Nothing is collected from users.

## Ownership

Developed by CollectIQ Technologies LLC. Delivered under the Government ownership terms contemplated by the PWS: full source, no proprietary components, no third-party licensing, and no per-seat or runtime license obligations.

---

CollectIQ Technologies LLC · UEI V4VPWY7XB6E5 · CAGE 224H8
hello@trycollectiq.com
