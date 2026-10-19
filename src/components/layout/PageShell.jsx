import Navbar from "./Navbar";

export default function PageShell({ children, connStatus = "connected" }) {
  return (
    <div className="app-viewport" data-connection={connStatus}>
      <Navbar />
      <main className="main-canvas">{children}</main>
    </div>
  );
}
