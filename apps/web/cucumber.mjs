/** Cucumber configuration — run via `npm run test:bdd`, which owns the stack. */
export default {
  paths: ["features/**/*.feature"],
  import: ["features/support/**/*.ts", "features/steps/**/*.ts"],
  format: process.env.CI ? ["progress"] : ["progress-bar"],
  strict: true,
};
