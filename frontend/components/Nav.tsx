"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { ROLE_LABEL, dashboardPath } from "@/lib/api";
import { useApp } from "./Providers";
import { SlotZeroMark } from "./Brand";
import { IconMenu } from "./Icons";

export function Nav() {
  const { session, ready, setSession } = useApp();
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const path = usePathname();
  const user = session?.user;
  const dashboard = user ? dashboardPath(user.role) : "/";

  const logout = () => {
    setSession(null);
    router.push("/");
  };

  return (
    <header className="nav">
      <div className="container nav-inner">
        <Link href={user ? dashboard : "/"} className="brand" onClick={() => setOpen(false)}>
          <SlotZeroMark />
          SlotZero
          {user && <span className="chip chip-ink tiny" style={{ marginLeft: 4 }}>{ROLE_LABEL[user.role]}</span>}
        </Link>
        <button className="nav-toggle" aria-label="Menu" onClick={() => setOpen((o) => !o)}>
          <IconMenu />
        </button>
        <nav className={`nav-links ${open ? "open" : ""}`} onClick={() => setOpen(false)}>
          {!ready ? null : user ? (
            <>
              <Link className={`link ${path === dashboard ? "active" : ""}`} href={dashboard}>Dashboard</Link>
              <Link className={`link ${path === "/timezones" ? "active" : ""}`} href="/timezones">Time zones</Link>
              <Link className={`link ${path === "/about" ? "active" : ""}`} href="/about">About</Link>
              <span className="user-chip">
                <span className="avatar sm">{user.name.split(" ").map((p) => p[0]).join("").slice(0, 2)}</span>
                <span className="small">{user.role === "doctor" ? `Dr. ${user.name}` : user.role === "hospital" ? user.hospital?.name ?? user.name : user.name}</span>
              </span>
              <button className="btn btn-outline btn-sm" onClick={logout}>Log out</button>
            </>
          ) : (
            <>
              <Link className="link" href="/#features">Features</Link>
              <Link className="link" href="/#how">How it works</Link>
              <Link className="link" href="/timezones">Time zones</Link>
              <Link className="link" href="/about">About</Link>
              <Link className="link" href="/login">Log in</Link>
              <Link className="btn btn-primary btn-sm" href="/register">Get started</Link>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
