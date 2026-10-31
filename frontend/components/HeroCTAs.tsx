"use client";

import Link from "next/link";
import { dashboardPath } from "@/lib/api";
import { useApp } from "./Providers";
import { IconArrow } from "./Icons";

export function HeroCTAs() {
  const { session } = useApp();
  const user = session?.user;
  return (
    <div className="hero-ctas">
      {user ? (
        <Link href={dashboardPath(user.role)} className="btn btn-primary btn-lg">
          Go to my dashboard <IconArrow size={18} />
        </Link>
      ) : (
        <>
          <Link href="/register?role=patient" className="btn btn-primary btn-lg">Book a doctor <IconArrow size={18} /></Link>
          <Link href="/register?role=doctor" className="btn btn-ghost-dark btn-lg">Join as a doctor</Link>
          <Link href="/login" className="btn btn-ghost-dark btn-lg">Try the demo</Link>
        </>
      )}
    </div>
  );
}
