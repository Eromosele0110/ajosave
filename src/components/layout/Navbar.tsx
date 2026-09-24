"use client";

import Link from "next/link";
import { useState, useEffect, useRef } from "react";
import styles from "./Navbar.module.css";

export function Navbar() {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  // Close menu on route change / outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        toggleRef.current &&
        !toggleRef.current.contains(e.target as Node)
      ) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  // Close menu on Escape key
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && menuOpen) {
        setMenuOpen(false);
        toggleRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [menuOpen]);

  // Prevent body scroll when menu is open
  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [menuOpen]);

  return (
    <header className={styles.header}>
      <nav
        className={`container ${styles.nav}`}
        aria-label="Main navigation"
      >
        <Link href="/" className={styles.logo} aria-label="STELLAR home">
          <span className={styles.logoMark} aria-hidden="true">S</span>
          <span className={styles.logoText}>STELLAR</span>
        </Link>

        {/* Desktop links */}
        <ul className={styles.links} role="list" aria-label="Desktop navigation links">
          <li>
            <Link href="/circles" className={styles.link}>
              Browse Circles
            </Link>
          </li>
          <li>
            <Link href="/dashboard" className={styles.link}>
              Dashboard
            </Link>
          </li>
          <li>
            <Link href="/auth/login" className="btn btn--primary btn--sm">
              Sign In
            </Link>
          </li>
        </ul>

        {/* Mobile hamburger toggle */}
        <button
          ref={toggleRef}
          className={styles.menuToggle}
          aria-label={menuOpen ? "Close navigation menu" : "Open navigation menu"}
          aria-expanded={menuOpen}
          aria-controls="mobile-menu"
          onClick={() => setMenuOpen((prev) => !prev)}
        >
          <span className={`${styles.hamburgerLine} ${menuOpen ? styles.lineTop : ""}`} />
          <span className={`${styles.hamburgerLine} ${menuOpen ? styles.lineMiddle : ""}`} />
          <span className={`${styles.hamburgerLine} ${menuOpen ? styles.lineBottom : ""}`} />
        </button>
      </nav>

      {/* Mobile drawer */}
      <div
        id="mobile-menu"
        ref={menuRef}
        className={`${styles.mobileMenu} ${menuOpen ? styles.mobileMenuOpen : ""}`}
        aria-hidden={!menuOpen}
      >
        <nav aria-label="Mobile navigation">
          <ul role="list" className={styles.mobileLinks}>
            <li>
              <Link
                href="/circles"
                className={styles.mobileLink}
                onClick={() => setMenuOpen(false)}
              >
                Browse Circles
              </Link>
            </li>
            <li>
              <Link
                href="/dashboard"
                className={styles.mobileLink}
                onClick={() => setMenuOpen(false)}
              >
                Dashboard
              </Link>
            </li>
            <li className={styles.mobileCta}>
              <Link
                href="/auth/login"
                className="btn btn--primary"
                onClick={() => setMenuOpen(false)}
              >
                Sign In
              </Link>
            </li>
          </ul>
        </nav>
      </div>

      {/* Overlay backdrop */}
      {menuOpen && (
        <div
          className={styles.overlay}
          aria-hidden="true"
          onClick={() => setMenuOpen(false)}
        />
      )}
    </header>
  );
}
