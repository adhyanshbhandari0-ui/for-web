"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight, ArrowDown, Pause, Play } from "lucide-react";
import TheatreNav from "../theatre-nav";
import anatomy from "@/public/images/anatomy-theatre.webp";

export default function TheatreLanding() {
  const [paused, setPaused] = useState(false);
  return (
    <div className="theatre landing" data-motion={paused ? "paused" : "playing"}>
      <TheatreNav />
      <main id="main" tabIndex={-1}>
        <section className="landing-hero" aria-labelledby="landing-title">
          <div className="landing-art" aria-hidden="true">
            <Image src={anatomy} alt="" fill priority unoptimized sizes="100vw" />
          </div>
          <div className="landing-copy">
            <p className="theatre-eyebrow">Anatomy Theatre</p>
            <h1 id="landing-title">A small dose.<br /><em>A whole journey.</em></h1>
            <p>See pharmacokinetics in motion. Follow an oral dose through the body, then explore the numbers behind its journey.</p>
            <div className="landing-actions">
              <Link href="/simulator" className="theatre-button theatre-primary">Open the simulator <ArrowRight size={17} aria-hidden="true" /></Link>
              <Link href="/simulator#studies" className="landing-text-link">Explore study examples</Link>
            </div>
            <p className="landing-note">An interactive learning tool with published study inputs and downloadable reports.</p>
          </div>
          <div className="landing-hero-footer">
            <a href="#explore" className="landing-text-link">Inside the experience <ArrowDown size={15} aria-hidden="true" /></a>
            <button type="button" className="landing-motion" onClick={() => setPaused(!paused)} aria-pressed={paused}>
              {paused ? <Play size={14} aria-hidden="true" /> : <Pause size={14} aria-hidden="true" />}
              {paused ? "Play animation" : "Pause animation"}
            </button>
          </div>
        </section>
        <section id="explore" className="landing-explore" aria-labelledby="explore-title">
          <div className="landing-section-heading">
            <p className="theatre-eyebrow">From anatomy to evidence</p>
            <h2 id="explore-title">Follow it.<br /><em>Understand it.</em></h2>
            <Link href="/how-it-works" className="landing-text-link">How the model works <ArrowRight size={16} aria-hidden="true" /></Link>
          </div>
          <div className="landing-features">
            <article><h3>Watch the route unfold</h3><p>The camera follows the first dose, pausing at each organ. Take control with the timeline or inspect an organ up close.</p></article>
            <article><h3>Connect the journey to the curve</h3><p>See concentration, absorption and clearance change together. Compare individual medicine curves over the same time window.</p></article>
            <article><h3>Take the evidence with you</h3><p>Review study sources and model assumptions, then download a PDF with the inputs, curves and results of your run.</p></article>
          </div>
        </section>
        <section className="landing-start" aria-labelledby="start-title">
          <div><p className="theatre-eyebrow">Your first run</p><h2 id="start-title">Start with a published study.</h2><p>Choose levetiracetam or linezolid in the simulator. Use custom setup to explore the reviewed medicine catalogue.</p></div>
          <Link href="/simulator" className="theatre-button theatre-primary">Choose a study <ArrowRight size={17} aria-hidden="true" /></Link>
        </section>
      </main>
      <footer className="landing-footer"><span>Drug in Body · Anatomy Theatre</span><Link href="/about">Project & anatomy credits</Link><Link href="/how-it-works">Model & sources</Link></footer>
    </div>
  );
}
