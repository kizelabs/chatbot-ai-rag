import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-dev)", "ui-monospace", "monospace"],
        mono: ["var(--font-dev)", "ui-monospace", "monospace"],
      },
      colors: {
        paper: "#f9fafb",
        ink: "#f3f4f6",
        accent: "#111827",
        pine: "#111827",
      },
      boxShadow: {
        panel: "0 20px 60px -34px rgba(17, 24, 39, 0.28)",
      },
      keyframes: {
        rise: {
          "0%": { opacity: "0", transform: "translateY(10px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        rise: "rise 500ms ease-out both",
      },
    },
  },
  plugins: [],
};

export default config;
