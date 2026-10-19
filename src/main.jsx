import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

// In strict browser environments or cross-origin iframes, window.fetch may be read-only.
// All API calls in this application use relative paths or explicit endpoints via src/api.js,
// avoiding the need to overwrite window.fetch.

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
