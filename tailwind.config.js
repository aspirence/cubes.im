/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  // Disable Tailwind's Preflight reset so it does not fight Ant Design's reset.
  corePlugins: {
    preflight: false,
  },
  theme: {
    extend: {
      colors: {
        accent: { DEFAULT: "#4a4ad0", soft: "#eceefb", ink: "#5a5ad6" },
        ink: "#17171c",
        muted: "#6a6d78",
        faint: "#9a9da8",
        hair: "#ececf0",
        hair2: "#f0f0f3",
        canvas: "#f6f7f9",
        panel: "#ffffff",
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
      },
      boxShadow: {
        card: "0 1px 2px rgba(16,24,40,.04)",
        cardH: "0 6px 18px -6px rgba(16,24,40,.12)",
      },
    },
  },
  plugins: [require("@tailwindcss/forms")],
};

