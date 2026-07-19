// Shared contract suites for storage implementations — imported by adapter
// packages (node-adapter, web-adapter) so every impl runs the same behavioral
// spec. Test-only surface.
export { describeRecordStoreContract } from './record-store-contract'
export { describeStoreBackendContract } from './store-backend-contract'
