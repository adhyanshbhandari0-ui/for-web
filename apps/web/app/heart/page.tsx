import type { Metadata } from "next";
import HeartExperience from "@/components/heart/HeartExperience";
import "./heart.css";

export const metadata: Metadata = {
  title: "Heart simulator — Drug-in-Body",
  description:
    "Zoom from the whole heart down to the muscle cells, step through the cardiac cycle, and follow an oral substance from the gut to the aorta.",
};

export default function HeartPage() {
  return (
    <div className="theatre">
      <HeartExperience />
    </div>
  );
}
