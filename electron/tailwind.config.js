module.exports = {
  content: ["../frontend/index.html", "../frontend/src/**/*.{vue,js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        "discord-blurple": "#5865F2",
        theme: {
          bg: {
            primary: "var(--color-bg-primary)",
            secondary: "var(--color-bg-secondary)",
            tertiary: "var(--color-bg-tertiary)",
            hover: "var(--color-bg-hover)",
          },
          border: "var(--color-border)",
          text: {
            primary: "var(--color-text-primary)",
            secondary: "var(--color-text-secondary)",
            muted: "var(--color-text-muted)",
            "on-accent": "var(--color-text-on-accent)",
          },
          accent: {
            DEFAULT: "var(--color-accent)",
            hover: "var(--color-accent-hover)",
          },
          backdrop: "var(--color-backdrop)",
        },
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          '"Segoe UI"',
          '"Roboto"',
          '"Oxygen"',
          '"Ubuntu"',
          '"Cantarell"',
          '"Fira Sans"',
          '"Droid Sans"',
          '"Helvetica Neue"',
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
}
