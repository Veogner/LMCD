/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["'Space Grotesk'", "Segoe UI", "sans-serif"],
        mono: ["'JetBrains Mono'", "SFMono-Regular", "Menlo", "monospace"],
      },
      colors: {
        basalt: "#0b0f1a",
        obsidian: "#0f172a",
        mint: "#46f0a1",
        amber: "#f5a524",
        iris: "#7c6cfb",
        slate: "#94a3b8",
      },
      boxShadow: {
        glow: "0 10px 60px rgba(124,108,251,0.25)",
      },
      animation: {
        pulsefast: "pulse 1.5s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
