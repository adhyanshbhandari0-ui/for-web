import type { Metadata } from "next";
import Link from "next/link";
import TheatreNav from "@/components/theatre-nav";

export const metadata: Metadata = {
  title: "About — Drug-in-Body",
  description:
    "Learn what the Drug-in-Body educational model simulates and where its parameters come from.",
};

export default function AboutPage() {
  return (
    <div className="theatre">
      <TheatreNav />
      <main id="main" tabIndex={-1} className="theatre-document theatre-surface">
        <h1 className="mt-8 text-4xl font-semibold tracking-tight">About Drug-in-Body</h1>
        <p className="mt-4 leading-7 text-ink-2">
          Drug-in-Body is an educational simulator for exploring how an oral dose changes a modeled concentration over time.
        </p>
        <section className="mt-8 space-y-2">
          <h2 className="text-xl font-semibold">Where the parameters come from</h2>
          <p className="leading-7 text-ink-2">
            The levetiracetam and linezolid examples use fixed estimates from published adult studies and prescribing information.
            Each run shows its model inputs and sources in the results and PDF. Catalogue medicines require a reviewed oral
            pharmacokinetic record. The synthetic example uses fictional parameters.
          </p>
        </section>
        <section className="mt-8 space-y-2">
          <h2 className="text-xl font-semibold">Anatomy credits</h2>
          <p className="leading-7 text-ink-2">
            BodyParts3D, © The Database Center for Life Science. The simulator adapts the atlas meshes for the web and
            adds the stomach and small intestine from the BodyParts3D 4.0 archive.{" "}
            <a className="text-brand-text underline underline-offset-4" href="https://dbarchive.biosciencedbc.jp/en/bodyparts3d/lic.html">
              BodyParts3D attribution and licence
            </a>
          </p>
        </section>
        <section className="mt-8 space-y-2">
          <h2 className="text-xl font-semibold">What the model covers</h2>
          <p className="leading-7 text-ink-2">
            The engine models absorption into one central compartment and elimination from that compartment.
            The anatomy walkthrough displays model-wide values. The model excludes disease effects and drug interactions.
            For medical decisions, consult a clinician.
          </p>
        </section>
        <div className="mt-8 flex flex-wrap items-center gap-5">
          <Link
            href="/simulator"
            className="theatre-button theatre-primary"
          >
            Open simulator
            <span aria-hidden="true">→</span>
          </Link>
          <Link href="/how-it-works" className="text-sm font-medium text-brand-text underline underline-offset-4">
            How it works
          </Link>
        </div>
      </main>
    </div>
  );
}
