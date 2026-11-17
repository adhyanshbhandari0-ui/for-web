import type { Metadata } from "next";
import TheatreNav from "@/components/theatre-nav";
import AuthPanel from "../AuthPanel";

export const metadata: Metadata = {
  title: "Sign in — Drug-in-Body",
  description:
    "Sign in with an email link to save simulation reports to your account.",
};

export default function SignInPage() {
  return (
    <div className="theatre">
      <TheatreNav />
      <main id="main" tabIndex={-1} className="theatre-document theatre-surface">
        <p className="theatre-eyebrow">Account</p>
        <h1 className="mt-3">Save your reports</h1>
        <p className="mt-4 max-w-[50ch] text-sm leading-6 text-ink-2">
          Sign in with a one-time email link. Your account stores your profile and any simulation reports you choose to save.
        </p>
        <div className="mt-8"><AuthPanel /></div>
      </main>
    </div>
  );
}
