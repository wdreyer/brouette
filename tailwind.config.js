/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#2f2a24",
        stone: "#faf6ef",
        clay: "#e6dccb",
        moss: "#5a6c4c",
        ember: "#b86a3d",
        honey: "#d6b27a",
        leaf: "#8a9a6d",
        bark: "#6a4d3b",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        serif: ["var(--font-serif)", "serif"],
      },
      boxShadow: {
        card: "0 22px 36px -28px rgba(47, 42, 36, 0.28)",
      },
    },
  },
  plugins: [],
};
