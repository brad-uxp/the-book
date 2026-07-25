import next from "eslint-config-next";

/**
 * Flat config. eslint-config-next 16 exports flat config directly, so there is
 * no FlatCompat wrapper here — that path throws on ESLint 10, and ESLint 10
 * itself is not yet supported by eslint-plugin-react (which next pulls in),
 * hence eslint@9.
 */
const config = [
  {
    ignores: [
      "app/generated/**",
      ".next/**",
      "public/sw.js",
      "public/swe-worker-*.js",
    ],
  },
  ...next,
];

export default config;
