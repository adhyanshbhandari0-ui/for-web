import type { Metadata } from "next";
import Simulator from "@/components/simulator/simulator";

export const metadata: Metadata = {
  title: "Simulator — Drug-in-Body",
  description:
    "Watch guided anatomy close-ups as an oral dose is absorbed and eliminated. Play research-based examples or run a custom simulation.",
};

export default function SimulatorPage() {
  return <Simulator />;
}
