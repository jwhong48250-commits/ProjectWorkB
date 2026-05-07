import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // ── Color tokens ──────────────────────────────────────────────
      // Semantic names → CSS variables defined in index.css
      // Light/dark values live in :root and .dark respectively
      colors: {
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        border: "hsl(var(--border))",
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar))",
          foreground: "hsl(var(--sidebar-foreground))",
          border: "hsl(var(--sidebar-border))",
          hover: "hsl(var(--sidebar-hover))",
          active: "hsl(var(--sidebar-active))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
          subtle: "hsl(var(--accent-subtle))",
        },
        // Meeting status palette
        status: {
          inprogress: "hsl(var(--status-inprogress))",
          upcoming: "hsl(var(--status-upcoming))",
          completed: "hsl(var(--status-completed))",
          "inprogress-bg": "hsl(var(--status-inprogress-bg))",
          "upcoming-bg": "hsl(var(--status-upcoming-bg))",
          "completed-bg": "hsl(var(--status-completed-bg))",
        },
        // Priority palette (for action items)
        priority: {
          urgent: "#ef4444",
          high: "#f97316",
          medium: "#eab308",
          low: "#6b7280",
        },
      },

      // ── Typography ────────────────────────────────────────────────
      // Based on Linear's scale (micro→title) adapted for Korean UI
      fontFamily: {
        sans: [
          '"Inter Variable"',
          "Inter",
          "-apple-system",
          "BlinkMacSystemFont",
          '"Segoe UI"',
          '"Pretendard Variable"',
          "Pretendard",
          "sans-serif",
        ],
        mono: [
          '"Berkeley Mono"',
          '"SFMono-Regular"',
          "Consolas",
          '"Liberation Mono"',
          "monospace",
        ],
      },
      fontSize: {
        micro: ["0.6875rem", { lineHeight: "1rem" }], // 11px
        mini: ["0.75rem", { lineHeight: "1rem" }], // 12px
        sm: ["0.8125rem", { lineHeight: "1.25rem" }], // 13px
        base: ["0.9375rem", { lineHeight: "1.5rem" }], // 15px
        lg: ["1.125rem", { lineHeight: "1.75rem" }], // 18px
        xl: ["1.25rem", { lineHeight: "1.75rem" }], // 20px
        "2xl": ["1.5rem", { lineHeight: "2rem" }], // 24px
        title1: ["2.25rem", { lineHeight: "2.75rem" }], // 36px
      },
      fontWeight: {
        light: "300",
        normal: "450",
        medium: "500",
        semibold: "600",
        bold: "700",
      },

      // ── Spacing ───────────────────────────────────────────────────
      spacing: {
        "4.5": "1.125rem",
        "13": "3.25rem",
        "15": "3.75rem",
        "18": "4.5rem",
        sidebar: "244px", // expanded sidebar width (matches reference --sidebar-width: 244px)
        "sidebar-collapsed": "48px",
      },

      // ── Border radius ─────────────────────────────────────────────
      borderRadius: {
        sm: "4px",
        DEFAULT: "6px",
        md: "8px",
        lg: "10px",
        xl: "12px",
        full: "9999px",
      },

      // ── Box shadows ───────────────────────────────────────────────
      boxShadow: {
        card: "0 1px 3px rgba(0,0,0,0.10), 0 1px 2px rgba(0,0,0,0.06)",
        "card-hover": "0 4px 12px rgba(0,0,0,0.15)",
        "inset-border": "inset 0 0 0 1px hsl(var(--border))",
        popover: "0 8px 30px rgba(0,0,0,0.12)",
      },

      // ── Transitions ───────────────────────────────────────────────
      transitionDuration: {
        quick: "100ms",
        regular: "250ms",
        slow: "350ms",
      },
    },
  },
  plugins: [require("@tailwindcss/typography")],
};

export default config;
