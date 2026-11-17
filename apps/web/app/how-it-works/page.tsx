import type { Metadata } from "next";
import Link from "next/link";
import TheatreNav from "@/components/theatre-nav";

export const metadata: Metadata = {
  title: "How it works — Drug-in-Body",
  description:
    "Play a guided example, explore the modeled concentration over time and download the simulation report.",
};

export default function HowItWorksPage() {
  return (
    <div className="theatre">
      <TheatreNav />
      <main id="main" tabIndex={-1} className="theatre-document theatre-surface">
        <h1 className="mt-8 text-4xl font-semibold tracking-tight">How it works</h1>
        <ol className="mt-8 list-decimal space-y-6 pl-5 marker:font-semibold marker:text-brand-text">
          <li>
            <h2 className="text-xl font-semibold">Play a study example</h2>
            <p className="mt-2 leading-7 text-ink-2">
              Choose levetiracetam or linezolid to start. Follow the capsule into the stomach, then watch the gold trail
              move from the small intestine through the liver, heart and lungs to the rest of the body.
              Each arrival pauses for four seconds. Organ details alternate beside the centered model,
              with the previous stop in the model panel.
              The animation illustrates a common oral route for the first dose. The timeline and values account for
              the entire dose schedule.
            </p>
            <p className="mt-2 text-sm leading-6 text-ink-2">
              <a className="underline underline-offset-4" href="https://www.nhlbi.nih.gov/health/heart/blood-flow">Heart and lung circulation</a>
              {" · "}
              <a className="underline underline-offset-4" href="https://pmc.ncbi.nlm.nih.gov/articles/PMC11957910/">Intestinal absorption and first-pass metabolism</a>
            </p>
          </li>
          <li>
            <h2 className="text-xl font-semibold">Inspect a moment</h2>
            <p className="mt-2 leading-7 text-ink-2">
              Press Space to pause or resume, jump to a stage or move the time slider. Arrow keys adjust the focused slider. Select an organ to isolate it in the viewer. Download the PDF to keep the curve, peak, checkpoints,
              dose schedule and source links. The 5% threshold shows when the concentration stays below 5% of the
              sampled peak after the final dose.
            </p>
          </li>
          <li>
            <h2 className="text-xl font-semibold">Run a custom schedule</h2>
            <p className="mt-2 leading-7 text-ink-2">
              Open Setup and choose a catalogue medicine with reviewed parameters or load the synthetic example.
              Enter each dose in milligrams and hours from simulation start, then choose Run and play.
              The custom model scales volume and clearance by body weight.
            </p>
          </li>
        </ol>
        <section className="mt-10 border-t border-line pt-8" aria-labelledby="equations-title">
          <h2 id="equations-title" className="text-xl font-semibold">The model behind the curve</h2>
          <div className="my-5 space-y-2 rounded-lg border border-line bg-page p-4 font-mono text-sm" aria-label="One-compartment model equations">
            <p>dA<sub>g</sub>/dt = −k<sub>a</sub> A<sub>g</sub></p>
            <p>dA/dt = F k<sub>a</sub> A<sub>g</sub> − (CL/V) A</p>
            <p>C = A/V</p>
          </div>
          <p className="text-sm leading-7 text-ink-2">
            A<sub>g</sub> is the amount available in the gut, A is the central amount, and C is the central concentration.
            The absorption constant k<sub>a</sub> controls transfer from the gut. F is bioavailability, CL is clearance,
            and V is distribution volume. Each dose enters the gut compartment at its scheduled time plus any specified absorption lag.
          </p>
          <p className="mt-3 text-sm leading-7 text-ink-2">
            Peak concentration is the largest sampled C value. The clearance checkpoint is the first time after the final dose
            when C falls below 5% of that peak and remains below it through the run window.
          </p>
        </section>
        <div className="mt-8">
          <Link
            href="/simulator"
            className="theatre-button theatre-primary"
          >
            Open simulator
            <span aria-hidden="true">→</span>
          </Link>
        </div>
      </main>
    </div>
  );
}
