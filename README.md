# Anatomy Theatre · Drug-in-Body Simulator

An interactive web simulator for learning oral pharmacokinetics. Follow a dose through a 3D anatomy model, then see how the simulated concentration changes over time and where the input values came from.

![Anatomy Theatre landing page with an illustrated human torso and a button to open the simulator](docs/screenshots/landing.webp)

## Run locally

Use Node.js 24 and npm.

```sh
git clone https://github.com/TatvagnaTandel/Drug-Ingestion-Simulation.git
cd Drug-Ingestion-Simulation
npm ci
npm run dev:web
```

Open [localhost:3000](http://localhost:3000) and choose **Open the simulator**. Select **Levetiracetam** or **Linezolid** and click **Start journey**. Both studies work without an account or API keys. To try a custom schedule without Supabase, choose **Custom setup → Load synthetic example → Run and play**.

## Follow a dose

The camera follows the first scheduled oral dose from swallowing and absorption through circulation, distribution and clearance. It pauses at organ stops while the explanation and model values update. Use the journey rail to jump to a stage, scrub the timeline, or press **Space** to pause or resume when focus is outside a form control. The organ monitor lets you inspect individual organs.

![Guided playback paused at the lungs, with the 3D model, journey rail, model readouts, and timeline visible](docs/screenshots/journey.webp)

## Read and export results

Open **Results** to see the concentration curve, peak concentration, time to peak and when the curve stays below 5% of its peak after the last dose. With multiple medicines, each medicine has its own curve. **Download PDF** exports the dose schedule, model inputs, figures, journey checkpoints and source references. The built-in studies cite published adult research and prescribing information.

![Levetiracetam results with a concentration curve, peak metrics, source inputs, and a Download PDF button](docs/screenshots/results.webp)

## Optional Supabase setup

Supabase enables catalogue search, email sign-in and saving eligible custom reports to an account. To use your own project, apply the SQL files in [supabase/migrations](supabase/migrations) in order and follow the [catalogue import and review instructions](scripts/data/README.md). Add the following placeholders to `apps/web/.env.local`, replace them with your project's values and restart the app.

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-publishable-or-legacy-anon-key
```

Enable email authentication and allowlist `http://localhost:3000/signin` in Supabase Authentication → URL Configuration. For a deployed app, also allowlist its exact sign-in URL. Keep `apps/web/.env.local` and any root `.env` files local. The browser configuration takes a publishable or legacy anon key.

## Model and limits

The oral model uses one central compartment, first-order absorption and elimination, and an optional absorption lag. The walkthrough illustrates anatomy alongside model-wide estimates. Each medicine is simulated independently. Organ tissue concentrations, drug interactions and disease effects are outside the model. Use the simulator for education only.

The local PK reference check currently flags the ibuprofen example. Its simulated time to peak is 1.25 hours against a published reference of 0.79 hours, outside the check's 25% tolerance. The references used for this check are recorded in [data/validation.json](data/validation.json).

## Project map

| Path | What it contains |
| --- | --- |
| [apps/web](apps/web) | Next.js interface, Three.js anatomy and browser PDF export |
| [packages/engine](packages/engine) | Simulation, concentration curves and report metrics |
| [packages/data-client](packages/data-client) | Supabase catalogue, authentication and reports |
| [data](data) and [supabase](supabase) | Reviewed data, validation references and database migrations |
| [docs/PRD.md](docs/PRD.md) and [docs/TRD.md](docs/TRD.md) | Product and technical specifications |

```sh
npm test
npm run typecheck
npm run lint:copy
npm run build:web
```

The anatomy meshes come from BodyParts3D, © The Database Center for Life Science. See the [anatomy attribution and licences](assets/anatomy/README.md#licence).
