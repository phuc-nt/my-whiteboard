import { MemoryRecordStore } from './memory-record-store'
import { RecordStoreBackend } from './record-store-backend'
import { describeStoreBackendContract } from './store-backend-contract'

// The async StoreBackend contract, exercised through the adapter that wraps a
// sync RecordStore — proves the contract holds and the adapter is faithful.
describeStoreBackendContract(
	'RecordStoreBackend(MemoryRecordStore)',
	() => new RecordStoreBackend(new MemoryRecordStore())
)
