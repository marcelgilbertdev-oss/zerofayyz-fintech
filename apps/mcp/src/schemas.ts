// Single source of truth lives outside this app so the contract cannot drift
// between the API, the clients and this server. See packages/api-contract/README.md.
//
// The `.js` extension is required: this app resolves modules as NodeNext, unlike
// the bundler-resolved Vue and Svelte clients that re-export the same file.
export * from "../../../packages/api-contract/schemas.js";
