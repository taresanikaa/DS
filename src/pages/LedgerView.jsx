import { useState, useEffect, useCallback } from "react";
import PageShell from "../components/layout/PageShell";
import { fetchLedger, connectTransactionSocket } from "../api";
import {
  BookOpen,
  ShieldCheck,
  Building2,
  RefreshCw,
  Search,
  Filter,
  CheckCircle2,
  AlertCircle,
  Download,
  Scale,
  Copy,
  Check,
  CreditCard,
  ArrowRight,
  TrendingUp,
} from "lucide-react";

const INR_FORMAT = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

export default function LedgerView() {
  const [ledgerData, setLedgerData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [connStatus, setConnStatus] = useState("connecting");
  const [searchTerm, setSearchTerm] = useState("");
  const [statusFilter, setStatusFilter] = useState("ALL");
  const [selectedType, setSelectedType] = useState("ALL");
  const [selectedBank, setSelectedBank] = useState("ALL");
  const [copiedId, setCopiedId] = useState(null);

  const loadData = useCallback(async () => {
    try {
      const data = await fetchLedger();
      setLedgerData(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const ws = connectTransactionSocket(() => loadData(), setConnStatus);
    const interval = setInterval(loadData, 4000);
    return () => {
      clearInterval(interval);
      ws.close();
    };
  }, [loadData]);

  const accounts = ledgerData?.accounts || [];
  const journalEntries = ledgerData?.journalEntries || [];
  const invariants = ledgerData?.invariants || {
    genesisSupply: 84000,
    currentTotalDeposits: 84000,
    isConservationPreserved: true,
    totalDebited: 0,
    totalCredited: 0,
    debitCreditParity: true,
  };
  const banks = ledgerData?.banks || [];

  const filteredEntries = journalEntries.filter((entry) => {
    const matchesSearch =
      searchTerm === "" ||
      entry.accountUpi.toLowerCase().includes(searchTerm.toLowerCase()) ||
      entry.userName.toLowerCase().includes(searchTerm.toLowerCase()) ||
      entry.transactionId.toLowerCase().includes(searchTerm.toLowerCase()) ||
      entry.id.toLowerCase().includes(searchTerm.toLowerCase());

    const matchesStatus =
      statusFilter === "ALL" || entry.status === statusFilter;

    const matchesType =
      selectedType === "ALL" || entry.entryType === selectedType;

    const matchesBank =
      selectedBank === "ALL" || entry.bank === selectedBank;

    return matchesSearch && matchesStatus && matchesType && matchesBank;
  });

  const handleCopy = (id) => {
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1500);
  };

  function exportCSV() {
    if (!journalEntries.length) return;
    const headers = [
      "Entry ID",
      "Transaction ID",
      "Timestamp",
      "Account UPI",
      "User Name",
      "Bank",
      "Type",
      "Amount",
      "Balance After",
      "Status",
      "Description",
    ];
    const rows = journalEntries.map((e) => [
      e.id,
      e.transactionId,
      e.timestamp,
      e.accountUpi,
      e.userName,
      e.bank,
      e.entryType,
      e.amount,
      e.balanceAfter,
      e.status,
      `"${e.description.replace(/"/g, '""')}"`,
    ]);
    const csvContent = [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `upi-ledger-${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }

  return (
    <PageShell connStatus={connStatus}>
      {/* Header Bar */}
      <div className="page-header">
        <div>
          <div className="unit-tag">Double-Entry Financial Journal</div>
          <h1 className="page-title">UPI Interbank Ledger</h1>
          <p className="page-subtitle">
            Audited transaction journal across participating bank ledgers (HDFC, ICICI, SBI, Axis, PNB), verifying mathematical conservation of money and double-entry parity.
          </p>
        </div>

        <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
          <button
            type="button"
            className="btn-secondary"
            onClick={loadData}
            title="Refresh Ledger"
          >
            <RefreshCw size={13} className={loading ? "spin" : ""} style={{ color: "var(--upi-green)" }} />
            <span>Sync</span>
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={exportCSV}
            title="Export Ledger Journal as CSV"
          >
            <Download size={13} />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* Conservation of Money & Invariant Strip */}
      <div
        className="card-clean"
        style={{
          border: invariants.isConservationPreserved
            ? "1px solid var(--upi-green-border)"
            : "1px solid var(--crimson-border)",
          background: invariants.isConservationPreserved
            ? "var(--upi-green-tint)"
            : "var(--crimson-tint)",
          marginBottom: "20px",
          padding: "16px 20px",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "16px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            <div
              style={{
                width: "36px",
                height: "36px",
                borderRadius: "50%",
                background: invariants.isConservationPreserved ? "var(--upi-green)" : "var(--crimson)",
                color: "#FFFFFF",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                flexShrink: 0,
              }}
            >
              <Scale size={18} />
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <h3 style={{ fontSize: "0.98rem", fontWeight: "700", color: "var(--ink-primary)", margin: 0 }}>
                  Conservation of Money Invariant
                </h3>
                <span className={`status-pill ${invariants.isConservationPreserved ? "success" : "danger"}`}>
                  {invariants.isConservationPreserved ? "Preserved (Equal)" : "Discrepancy"}
                </span>
              </div>
              <p style={{ fontSize: "0.8rem", color: "var(--ink-secondary)", margin: "2px 0 0" }}>
                Total Deposits: <strong className="tabular-nums">{INR_FORMAT.format(invariants.currentTotalDeposits)}</strong> &bull; Genesis Supply: <strong className="tabular-nums">{INR_FORMAT.format(invariants.genesisSupply)}</strong>
              </p>
            </div>
          </div>

          <div style={{ display: "flex", gap: "20px", alignItems: "center" }}>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: "0.72rem", textTransform: "uppercase", color: "var(--ink-muted)", fontWeight: "600" }}>
                Total Debited
              </div>
              <div className="tabular-nums" style={{ fontSize: "1.05rem", fontWeight: "700", color: "var(--upi-orange)" }}>
                {INR_FORMAT.format(invariants.totalDebited)}
              </div>
            </div>

            <div style={{ height: "26px", width: "1px", background: "var(--border-hairline)" }}></div>

            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: "0.72rem", textTransform: "uppercase", color: "var(--ink-muted)", fontWeight: "600" }}>
                Total Credited
              </div>
              <div className="tabular-nums" style={{ fontSize: "1.05rem", fontWeight: "700", color: "var(--upi-green)" }}>
                {INR_FORMAT.format(invariants.totalCredited)}
              </div>
            </div>

            <div style={{ height: "26px", width: "1px", background: "var(--border-hairline)" }}></div>

            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: "0.72rem", textTransform: "uppercase", color: "var(--ink-muted)", fontWeight: "600" }}>
                Parity Status
              </div>
              <div style={{ fontSize: "0.85rem", fontWeight: "700", color: invariants.debitCreditParity ? "var(--upi-green)" : "var(--crimson)" }}>
                {invariants.debitCreditParity ? "Δ = ₹0 Exact" : "Mismatch"}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Account Balances Summary Strip */}
      <div className="card-clean" style={{ marginBottom: "20px", padding: "16px" }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
          <h4 style={{ fontSize: "0.9rem", fontWeight: 700, margin: 0, display: "flex", alignItems: "center", gap: "6px" }}>
            <Building2 size={15} style={{ color: "var(--upi-orange)" }} />
            Core Banking Accounts ({accounts.length} Entities)
          </h4>
          <span style={{ fontSize: "0.75rem", color: "var(--ink-muted)" }}>
            Real-time balances stored in SQLite WAL database
          </span>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(190px, 1fr))", gap: "10px" }}>
          {accounts.map((acc) => (
            <div
              key={acc.id}
              style={{
                padding: "10px 12px",
                border: "1px solid var(--border-hairline)",
                borderRadius: "var(--radius-sm)",
                background: "var(--bg-canvas)",
                display: "flex",
                flexDirection: "column",
                gap: "3px",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <strong style={{ fontSize: "0.82rem", color: "var(--ink-primary)" }}>{acc.name}</strong>
                <span style={{ fontSize: "0.7rem", color: "var(--ink-muted)" }}>{acc.bank_name}</span>
              </div>
              <div style={{ fontSize: "0.74rem", color: "var(--upi-orange)", fontFamily: "var(--font-mono)" }}>
                {acc.upi_id}
              </div>
              <div className="tabular-nums" style={{ fontSize: "0.95rem", fontWeight: 700, color: "var(--upi-green)", marginTop: "2px" }}>
                {INR_FORMAT.format(acc.balance)}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="card-clean" style={{ marginBottom: "16px", padding: "14px 18px" }}>
        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", flex: 1, minWidth: "240px" }}>
            <Search size={14} style={{ color: "var(--ink-muted)" }} />
            <input
              type="text"
              placeholder="Search by transaction ID, VPA, name..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="form-input"
              style={{ height: "34px", fontSize: "0.82rem" }}
            />
          </div>

          {/* Status Filters */}
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ fontSize: "0.76rem", fontWeight: 600, color: "var(--ink-muted)" }}>Status:</span>
            <div className="segmented-pills">
              {["ALL", "SETTLED", "PENDING", "REVERSED"].map((st) => (
                <button
                  key={st}
                  type="button"
                  className={`seg-pill ${statusFilter === st ? "active" : ""}`}
                  onClick={() => setStatusFilter(st)}
                  style={{ fontSize: "0.75rem", padding: "4px 10px" }}
                >
                  {st}
                </button>
              ))}
            </div>
          </div>

          {/* Type Filters */}
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <span style={{ fontSize: "0.76rem", fontWeight: 600, color: "var(--ink-muted)" }}>Type:</span>
            <div className="segmented-pills">
              {["ALL", "DEBIT", "CREDIT", "REVERSAL"].map((tp) => (
                <button
                  key={tp}
                  type="button"
                  className={`seg-pill ${selectedType === tp ? "active" : ""}`}
                  onClick={() => setSelectedType(tp)}
                  style={{ fontSize: "0.75rem", padding: "4px 10px" }}
                >
                  {tp}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Ledger Journal Table */}
      <div className="card-clean" style={{ padding: "0" }}>
        <div className="table-container" style={{ border: "none" }}>
          <table className="fintech-table">
            <thead>
              <tr>
                <th>Entry ID &amp; Txn ID</th>
                <th>Timestamp</th>
                <th>Party &amp; Bank</th>
                <th>Type</th>
                <th>Amount (INR)</th>
                <th>Balance After</th>
                <th>Status</th>
                <th>Journal Memo</th>
              </tr>
            </thead>
            <tbody>
              {filteredEntries.length === 0 ? (
                <tr>
                  <td colSpan={8} style={{ textAlign: "center", padding: "32px", color: "var(--ink-muted)" }}>
                    No journal entries matching the selected filters.
                  </td>
                </tr>
              ) : (
                filteredEntries.map((entry) => (
                  <tr key={entry.id}>
                    <td>
                      <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                        <span style={{ fontSize: "0.74rem", fontFamily: "var(--font-mono)", color: "var(--ink-muted)" }}>
                          {entry.id}
                        </span>
                        <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                          <span style={{ fontSize: "0.78rem", fontWeight: 700, fontFamily: "var(--font-mono)", color: "var(--ink-primary)" }}>
                            {entry.transactionId}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleCopy(entry.transactionId)}
                            style={{ background: "none", border: "none", cursor: "pointer", padding: "2px", color: copiedId === entry.transactionId ? "var(--upi-green)" : "var(--ink-muted)" }}
                            title="Copy Transaction ID"
                          >
                            {copiedId === entry.transactionId ? <Check size={12} /> : <Copy size={12} />}
                          </button>
                        </div>
                      </div>
                    </td>
                    <td>
                      <span className="tabular-nums" style={{ fontSize: "0.76rem", color: "var(--ink-secondary)" }}>
                        {entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : "--"}
                      </span>
                    </td>
                    <td>
                      <div style={{ display: "flex", flexDirection: "column" }}>
                        <strong style={{ fontSize: "0.82rem" }}>{entry.userName}</strong>
                        <span style={{ fontSize: "0.74rem", color: "var(--upi-orange)", fontFamily: "var(--font-mono)" }}>
                          {entry.accountUpi}
                        </span>
                        <span style={{ fontSize: "0.7rem", color: "var(--ink-muted)" }}>{entry.bank}</span>
                      </div>
                    </td>
                    <td>
                      <span
                        style={{
                          fontSize: "0.74rem",
                          fontWeight: 700,
                          color:
                            entry.entryType === "DEBIT"
                              ? "var(--crimson)"
                              : entry.entryType === "CREDIT"
                              ? "var(--upi-green)"
                              : "var(--amber)",
                        }}
                      >
                        {entry.entryType}
                      </span>
                    </td>
                    <td>
                      <strong
                        className="tabular-nums"
                        style={{
                          fontSize: "0.88rem",
                          color:
                            entry.entryType === "DEBIT"
                              ? "var(--crimson)"
                              : entry.entryType === "CREDIT"
                              ? "var(--upi-green)"
                              : "var(--ink-primary)",
                        }}
                      >
                        {entry.entryType === "DEBIT" ? "-" : "+"}
                        {INR_FORMAT.format(entry.amount)}
                      </strong>
                    </td>
                    <td>
                      <span className="tabular-nums" style={{ fontSize: "0.82rem", fontWeight: 600 }}>
                        {INR_FORMAT.format(entry.balanceAfter)}
                      </span>
                    </td>
                    <td>
                      <span
                        className={`status-pill ${
                          entry.status === "SETTLED"
                            ? "success"
                            : entry.status === "PENDING"
                            ? "warning"
                            : "danger"
                        }`}
                      >
                        {entry.status}
                      </span>
                    </td>
                    <td>
                      <span style={{ fontSize: "0.76rem", color: "var(--ink-secondary)" }}>
                        {entry.description}
                      </span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </PageShell>
  );
}
