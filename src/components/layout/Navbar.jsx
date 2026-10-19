import { NavLink, Link, useNavigate, useLocation } from "react-router-dom";
import { useState } from "react";
import { resetSystem } from "../../api";
import { RefreshCw, Zap, Activity } from "lucide-react";

export default function Navbar() {
  const navigate = useNavigate();
  const location = useLocation();
  const [resetting, setResetting] = useState(false);

  // Exact 7 links required by prompt:
  // Dashboard, Ledger, Make Transactions, Part 1, Part 2, Part 3, Part 4
  const navItems = [
    { to: "/", label: "Dashboard", end: true },
    { to: "/ledger", label: "Ledger", aliases: ["/ledger"] },
    { to: "/transactions", label: "Make Transactions", aliases: ["/make-transactions"] },
    { to: "/part1", label: "Part 1", aliases: ["/unit1", "/introduction"] },
    { to: "/part2", label: "Part 2", aliases: ["/unit2", "/communication"] },
    { to: "/part3", label: "Part 3", aliases: ["/unit3", "/synchronization"] },
    { to: "/part4", label: "Part 4", aliases: ["/unit4", "/paradigms", "/deployment"] },
  ];

  async function handleResetSystem() {
    setResetting(true);
    try {
      await resetSystem();
    } catch (err) {
      console.error(err);
    } finally {
      setTimeout(() => setResetting(false), 500);
    }
  }

  return (
    <header className="top-bar">
      {/* Brand Zone */}
      <Link to="/" className="brand-wordmark" title="UPI Distributed Systems Simulator">
        <div className="upi-logo-mark" aria-hidden="true">
          <span className="upi-arrow-orange"></span>
          <span className="upi-arrow-green"></span>
        </div>
        <span className="brand-text">UPI <span className="brand-subtext">Simulator</span></span>
      </Link>

      {/* Nav Links: Exactly 7 required links */}
      <nav className="top-nav-links" aria-label="Main Navigation">
        {navItems.map((item) => {
          const isItemActive =
            (item.end && location.pathname === item.to) ||
            (!item.end && location.pathname === item.to) ||
            (item.aliases && item.aliases.includes(location.pathname));

          return (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={`top-nav-link ${isItemActive ? "active" : ""}`}
            >
              {item.label}
            </NavLink>
          );
        })}
      </nav>

      {/* Primary Action Zone */}
      <div className="top-bar-actions">
        <button
          type="button"
          className="btn-secondary"
          onClick={handleResetSystem}
          disabled={resetting}
          title="Reset simulated circuit breakers and fault injections"
        >
          <RefreshCw size={13} className={resetting ? "spin" : ""} style={{ color: "var(--upi-green)" }} />
          <span>Reset</span>
        </button>

        <button
          type="button"
          className="btn-primary"
          onClick={() => navigate("/transactions")}
          title="Initiate a live payment"
        >
          <Zap size={13} />
          <span>Pay Now</span>
        </button>
      </div>
    </header>
  );
}
